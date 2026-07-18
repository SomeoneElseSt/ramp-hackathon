import { nanoid } from "nanoid";
import type { CapturedEvent, FiredEvent, Listener } from "@companion/shared";
import {
  getListener,
  insertFiredEvent,
  listListeners,
  markSeen,
} from "./db.js";
import { dedupKeyFor, resolveCandidates, safeStringify, stringAt } from "./jsonpath.js";
import { classifyCandidate } from "./classify.js";
import { dispatchEvent } from "./dispatch.js";
import { recordSamples } from "./samples.js";
import {
  recordCandidate,
  recordFired,
  recordObserved,
} from "./metrics.js";
import {
  broadcastMetrics,
  petHappy,
  petNeedsAttention,
  petWatching,
} from "./ws.js";

// Deterministic listener engine. No model runs here except the optional
// classifier, and only for a candidate that already survived dedup.
export async function processCaptureBatch(events: CapturedEvent[]): Promise<void> {
  recordObserved(events.length);
  recordSamples(events);
  const listeners = listListeners().filter((l) => l.active);
  if (listeners.length === 0) return;

  for (const event of events) {
    for (const listener of listeners) {
      await processOne(listener, event);
    }
  }
  broadcastMetrics();
}

async function processOne(listener: Listener, event: CapturedEvent): Promise<void> {
  // 1. Cheap deterministic URL gate.
  if (!event.url.includes(listener.matcher.urlPattern)) return;

  // Any traffic on a watched signal wakes the pet to "watching".
  petWatching(`activity on ${listener.name}`);

  // 2. Parse the frame (fall back to raw text as a single candidate).
  const parsed = tryParse(event.body);
  const candidates = resolveCandidates(parsed ?? event.body, listener.matcher.framePath);
  if (candidates.length === 0) return;

  const now = Date.now();
  for (const candidate of candidates) {
    // 3. Optional deterministic event-type gate (substring on serialized candidate).
    if (listener.matcher.eventTypeMatch) {
      const haystack = typeof candidate === "string" ? candidate : safeStringify(candidate);
      if (!haystack.includes(listener.matcher.eventTypeMatch)) continue;
    }

    // 4. Dedup — the heart of "already seen?".
    const key = dedupKeyFor(candidate, listener.matcher.dedupKeyPath);
    const isNew = markSeen(listener.id, key, now);
    if (!isNew) continue;
    recordCandidate();

    // 5. Only genuinely-new candidates may reach the model.
    const summary = buildSummary(listener, candidate);
    if (listener.requiresClassification) {
      const classification = await classifyCandidate(listener, summary, candidate);
      if (!classification.relevant) continue;
      await fire(listener, key, summary, candidate, classification);
      continue;
    }
    await fire(listener, key, summary, candidate);
  }
}

async function fire(
  listener: Listener,
  dedupKey: string,
  summary: string,
  payload: unknown,
  classification?: FiredEvent["classification"]
): Promise<void> {
  const event: FiredEvent = {
    id: nanoid(),
    listenerId: listener.id,
    dedupKey,
    summary,
    payload,
    classification,
    dispatched: false,
    timestamp: Date.now(),
  };

  const result = await dispatchEvent(listener, event);
  event.dispatched = result.dispatched;
  insertFiredEvent(event);
  recordFired();

  if (listener.action?.requiresApproval && !result.dispatched) {
    petNeedsAttention(event, `${listener.name}: ${summary}`);
    return;
  }
  petHappy(event, `${listener.name}: ${summary}`);
}

function buildSummary(listener: Listener, candidate: unknown): string {
  const paths = listener.matcher.summaryPaths;
  if (!paths) return `New event on ${listener.name}`;
  const sender = stringAt(candidate, paths.sender);
  const preview = stringAt(candidate, paths.preview);
  const parts: string[] = [];
  if (sender) parts.push(sender);
  if (preview) parts.push(preview.slice(0, 120));
  return parts.length > 0 ? parts.join(": ") : `New event on ${listener.name}`;
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Helper used by the HTTP API / MCP to build a listener with sane defaults.
export function buildListener(input: Partial<Listener> & Pick<Listener, "matcher">): Listener {
  return {
    id: input.id ?? nanoid(),
    name: input.name ?? "Untitled listener",
    site: input.site ?? "",
    prompt: input.prompt ?? "",
    matcher: input.matcher,
    requiresClassification: input.requiresClassification ?? false,
    action: input.action,
    source: input.source ?? "mcp",
    active: input.active ?? true,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function getListenerOrNull(id: string): Listener | null {
  return getListener(id) ?? null;
}
