import { EventEmitter } from "node:events";
import type { ActivityEvent, SemanticEvent, Subscription } from "./types.js";
import { extractFrom } from "./extract.js";
import { planForIntent, refinePlanWithLLM } from "./intent.js";
import { collectEndpointCandidates } from "./endpoints.js";
import { catalog, summarizeListeners, type CatalogCapability, type ListenerSummary } from "./catalog.js";
import { recommendWorkflows, type WorkflowRecommendation } from "./workflows.js";
import { log } from "./logger.js";

// The perception layer. Runs incrementally over the growing raw buffer
// (CONTRACT §5), dedups semantic events by a stable key, and drives both the
// viewer broadcast (via the emitter) and the MCP blocking primitive (waiters).
//
// Models are used only at listener *setup* (refinePlanWithLLM) and ambiguous
// extraction — never on the idle watch path.
//
// Organic discovery: every N raw events we re-scan API-shaped endpoints into
// the capability catalog so Tama MCP list_listeners grows as the user browses.

const RAW_BUFFER_CAP = 5000;
const SEMANTIC_BUFFER_CAP = 500;
const DISCOVER_EVERY = 25;

class Perceiver {
  readonly emitter = new EventEmitter();
  private raw: ActivityEvent[] = [];
  private semantic: SemanticEvent[] = [];
  private emittedKeys = new Set<string>();
  private subscriptions = new Map<string, Subscription>();
  // Baseline keywords keep perception (and the pet) alive before any agent subscribes.
  private baselineKeywords = planForIntent("new messages").keywords;
  private sinceDiscover = 0;

  counts = { raw: 0, extracted: 0, deduped: 0, emitted: 0, discovered: 0 };

  async ingest(event: ActivityEvent): Promise<SemanticEvent[]> {
    this.counts.raw += 1;
    this.raw.push(event);
    if (this.raw.length > RAW_BUFFER_CAP) this.raw.shift();

    this.sinceDiscover += 1;
    if (this.sinceDiscover >= DISCOVER_EVERY) {
      this.sinceDiscover = 0;
      this.runDiscovery();
    }

    if (!this.isPerceivable(event)) return [];
    if (!this.urlMatchesActiveKeywords(event.url ?? dataUrl(event) ?? "")) return [];

    const extracted = await extractFrom(event);
    this.counts.extracted += extracted.length;

    const fresh: SemanticEvent[] = [];
    for (const { event: semantic, dedupId } of extracted) {
      const key = this.dedupKey(semantic, dedupId);
      if (this.emittedKeys.has(key)) {
        this.counts.deduped += 1;
        continue;
      }
      this.emittedKeys.add(key);
      this.semantic.push(semantic);
      if (this.semantic.length > SEMANTIC_BUFFER_CAP) this.semantic.shift();
      this.counts.emitted += 1;
      fresh.push(semantic);
      this.deliver(semantic);
      this.emitter.emit("semantic", semantic);
    }
    return fresh;
  }

  /** Force a discovery pass (also used by MCP list_listeners refresh). */
  runDiscovery(): CatalogCapability[] {
    const candidates = collectEndpointCandidates(this.raw);
    const fresh = catalog.ingestCandidates(candidates);
    if (fresh.length > 0) {
      this.counts.discovered += fresh.length;
      log(`discovered ${fresh.length} capabilities: ${fresh.map((f) => f.label).join(", ")}`);
      this.emitter.emit("discovered", fresh);
    }
    return fresh;
  }

  // ---- Tama listener hub --------------------------------------------------

  /** CONTRACT subscribe + Tama create_listener */
  createListener(intent: string, types?: string[]): Promise<string> {
    return this.subscribeAsync(intent, types);
  }

  subscribe(intent: string, types?: string[]): Promise<string> {
    return this.subscribeAsync(intent, types);
  }

  async subscribeAsync(intent: string, types?: string[]): Promise<string> {
    this.runDiscovery();
    const base = planForIntent(intent);
    const candidates = collectEndpointCandidates(this.raw);
    const plan = await refinePlanWithLLM(intent, base, candidates);
    const subId = "sub_" + Math.abs(hashCode(intent + this.subscriptions.size)).toString(36);
    const sub: Subscription = {
      subId,
      intent,
      types: types && types.length > 0 ? types : plan.types,
      keywords: plan.keywords,
      pending: [],
      waiters: [],
    };
    this.subscriptions.set(subId, sub);
    log(
      `create_listener ${subId} intent="${intent}" keywords=[${plan.keywords.join(",")}] candidates=${candidates.length}`,
    );
    return subId;
  }

  listListeners(): {
    active: ListenerSummary[];
    capabilities: CatalogCapability[];
  } {
    this.runDiscovery();
    return {
      active: summarizeListeners(this.subscriptions.values()),
      capabilities: catalog.list(),
    };
  }

  removeListener(subId: string): boolean {
    const sub = this.subscriptions.get(subId);
    if (!sub) return false;
    // Unblock any waiters with a no-op rejection path — resolve is safer for MCP.
    for (const waiter of sub.waiters) {
      waiter({
        type: "listener.removed",
        source: "tama",
        ts: Date.now(),
        from: { name: null, profileId: null },
        text: `listener ${subId} removed`,
        evidence: [],
      });
    }
    this.subscriptions.delete(subId);
    log(`remove_listener ${subId}`);
    return true;
  }

  hasSubscription(subId: string): boolean {
    return this.subscriptions.has(subId);
  }

  waitForEvent(subId: string): Promise<SemanticEvent> | null {
    const sub = this.subscriptions.get(subId);
    if (!sub) return null;
    const queued = sub.pending.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<SemanticEvent>((resolve) => sub.waiters.push(resolve));
  }

  getListenerEvents(subId: string): SemanticEvent[] | null {
    return this.getRecentEvents(subId);
  }

  getRecentEvents(subId: string): SemanticEvent[] | null {
    const sub = this.subscriptions.get(subId);
    if (!sub) return null;
    return sub.pending.splice(0);
  }

  proposeWorkflows(limit = 5): WorkflowRecommendation[] {
    this.runDiscovery();
    return recommendWorkflows({
      raw: this.raw,
      capabilities: catalog.list(),
      listeners: summarizeListeners(this.subscriptions.values()),
      limit,
    });
  }

  // ---- internals ----------------------------------------------------------

  private deliver(event: SemanticEvent): void {
    for (const sub of this.subscriptions.values()) {
      if (!this.matches(sub, event)) continue;
      const waiter = sub.waiters.shift();
      if (waiter) waiter(event);
      else sub.pending.push(event);
    }
  }

  private matches(sub: Subscription, event: SemanticEvent): boolean {
    if (event.type === "listener.removed") return false;
    if (sub.types.length > 0 && !sub.types.includes(event.type)) return false;
    if (sub.keywords.length === 0) return true;
    const haystack = `${event.type} ${event.source} ${event.text}`.toLowerCase();
    return sub.keywords.some((k) => haystack.includes(k));
  }

  private isPerceivable(event: ActivityEvent): boolean {
    return (
      event.type === "network.response" ||
      event.type === "websocket.received" ||
      event.type === "websocket.sent" ||
      event.type === "sse.message"
    );
  }

  private urlMatchesActiveKeywords(url: string): boolean {
    const keywords = this.activeKeywords();
    if (keywords.length === 0) return true;
    const lower = url.toLowerCase();
    return keywords.some((k) => lower.includes(k));
  }

  private activeKeywords(): string[] {
    const set = new Set(this.baselineKeywords);
    for (const sub of this.subscriptions.values()) sub.keywords.forEach((k) => set.add(k));
    // Fold path tokens from discovered capabilities so we perceive before subscribe.
    for (const cap of catalog.list()) {
      for (const part of cap.path.toLowerCase().split(/[^a-z0-9]+/)) {
        if (part.length >= 4) set.add(part);
      }
    }
    return [...set];
  }

  private dedupKey(event: SemanticEvent, dedupId: string | null): string {
    if (dedupId) return `${event.source}|${dedupId}`;
    return `${event.source}|${event.type}|${hashCode(event.text + (event.from.name ?? ""))}`;
  }
}

function dataUrl(ev: ActivityEvent): string | null {
  const data = ev.data && typeof ev.data === "object" ? (ev.data as { url?: unknown }) : null;
  return typeof data?.url === "string" ? data.url : null;
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return hash;
}

export const perceiver = new Perceiver();
