import { EventEmitter } from "node:events";
import type { ActivityEvent, SemanticEvent, Subscription } from "./types.js";
import { extractFrom } from "./extract.js";
import { planForIntent } from "./intent.js";
import { log } from "./logger.js";

// The perception layer. Runs incrementally over the growing raw buffer
// (CONTRACT §5), dedups semantic events by a stable key, and drives both the
// viewer broadcast (via the emitter) and the MCP blocking primitive (waiters).

const RAW_BUFFER_CAP = 5000;
const SEMANTIC_BUFFER_CAP = 500;

class Perceiver {
  readonly emitter = new EventEmitter();
  private raw: ActivityEvent[] = [];
  private semantic: SemanticEvent[] = [];
  private emittedKeys = new Set<string>();
  private subscriptions = new Map<string, Subscription>();
  // Baseline keywords keep perception (and the pet) alive before any agent subscribes.
  private baselineKeywords = planForIntent("new messages").keywords;

  counts = { raw: 0, extracted: 0, deduped: 0, emitted: 0 };

  async ingest(event: ActivityEvent): Promise<SemanticEvent[]> {
    this.counts.raw += 1;
    this.raw.push(event);
    if (this.raw.length > RAW_BUFFER_CAP) this.raw.shift();

    if (!this.isPerceivable(event)) return [];
    if (!this.urlMatchesActiveKeywords(event.url ?? "")) return [];

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

  subscribe(intent: string, types?: string[]): string {
    const plan = planForIntent(intent);
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
    log(`subscribe ${subId} intent="${intent}" keywords=[${plan.keywords.join(",")}]`);
    return subId;
  }

  hasSubscription(subId: string): boolean {
    return this.subscriptions.has(subId);
  }

  // The reactive primitive: resolves on the next matching event (or an already
  // queued one). Never polls internally — it awaits a real delivery.
  waitForEvent(subId: string): Promise<SemanticEvent> | null {
    const sub = this.subscriptions.get(subId);
    if (!sub) return null;
    const queued = sub.pending.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<SemanticEvent>((resolve) => sub.waiters.push(resolve));
  }

  getRecentEvents(subId: string): SemanticEvent[] | null {
    const sub = this.subscriptions.get(subId);
    if (!sub) return null;
    const drained = sub.pending.splice(0);
    return drained;
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
    return [...set];
  }

  private dedupKey(event: SemanticEvent, dedupId: string | null): string {
    if (dedupId) return `${event.source}|${dedupId}`;
    return `${event.source}|${event.type}|${hashCode(event.text + (event.from.name ?? ""))}`;
  }
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return hash;
}

export const perceiver = new Perceiver();
