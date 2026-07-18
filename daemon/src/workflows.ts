// workflows.ts — thin proactive recommendations from the observation stream.
// Heuristic for hackathon: repeated action→effect patterns + known catalog
// capabilities the user has not yet subscribed to.

import type { ActivityEvent } from "./types.js";
import type { CatalogCapability } from "./catalog.js";
import type { ListenerSummary } from "./catalog.js";

export interface WorkflowRecommendation {
  id: string;
  kind: "create_listener" | "workflow";
  title: string;
  rationale: string;
  suggestedIntent: string;
  eventType?: string;
  evidence: string[];
  score: number;
}

/**
 * Propose listeners/workflows from recent activity + discovered capabilities.
 * Deterministic heuristics only (no model) — good enough for the pet popup.
 */
export function recommendWorkflows(opts: {
  raw: ActivityEvent[];
  capabilities: CatalogCapability[];
  listeners: ListenerSummary[];
  limit?: number;
}): WorkflowRecommendation[] {
  const { raw, capabilities, listeners, limit = 5 } = opts;
  const activeIntents = new Set(listeners.map((l) => l.intent.toLowerCase()));
  const activeTypes = new Set(listeners.flatMap((l) => l.types));
  const out: WorkflowRecommendation[] = [];

  // 1) Catalog capabilities not yet covered by an active listener.
  for (const cap of capabilities) {
    if (activeTypes.has(cap.eventType)) continue;
    const intent = intentForCapability(cap);
    if (activeIntents.has(intent.toLowerCase())) continue;
    out.push({
      id: `rec_cap_${hash(cap.label)}`,
      kind: "create_listener",
      title: `Watch for: ${cap.label}`,
      rationale: `Tama saw ${cap.source} traffic (${cap.count}×). Create a listener so agents wake on ${cap.eventType}.`,
      suggestedIntent: intent,
      eventType: cap.eventType,
      evidence: [cap.sampleUrl],
      score: 50 + Math.min(cap.count, 20),
    });
  }

  // 2) Repeated host+path patterns after user actions → workflow hint.
  const episodes = condenseEpisodes(raw);
  for (const ep of episodes) {
    if (ep.count < 2) continue;
    out.push({
      id: `rec_ep_${hash(ep.key)}`,
      kind: "workflow",
      title: `You keep ${ep.label}`,
      rationale: `Seen ${ep.count} times recently. Want Tama to prepare context or create a listener next time?`,
      suggestedIntent: ep.suggestedIntent,
      evidence: ep.evidence.slice(0, 5),
      score: 20 + ep.count * 8,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function intentForCapability(cap: CatalogCapability): string {
  switch (cap.eventType) {
    case "message.received":
      return "new messages";
    case "notification.received":
      return "new notifications";
    case "connection.received":
      return "new connection requests";
    case "feed.updated":
      return "new feed posts";
    case "comment.received":
      return "new comments";
    case "order.changed":
      return "order updates";
    default:
      return cap.label.toLowerCase();
  }
}

interface Episode {
  key: string;
  label: string;
  suggestedIntent: string;
  count: number;
  evidence: string[];
}

function condenseEpisodes(raw: ActivityEvent[]): Episode[] {
  const clicks = raw.filter((e) => e.type === "user.clicked" || e.type === "user.submitted");
  const byHost = new Map<string, { count: number; evidence: string[]; pathHints: Set<string> }>();

  for (const ev of raw) {
    if (
      ev.type !== "network.response" &&
      ev.type !== "websocket.received" &&
      ev.type !== "sse.message"
    ) {
      continue;
    }
    const url = ev.url || (ev.data as { url?: string } | undefined)?.url || "";
    if (!url) continue;
    let host = "";
    let path = "";
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./, "");
      path = u.pathname;
    } catch {
      continue;
    }
    // Only count hosts where the user also clicked something recently.
    const userTouched = clicks.some((c) => (c.url || "").includes(host));
    if (!userTouched && clicks.length > 0) continue;

    const bucket = pathBucket(path);
    if (!bucket) continue;
    const key = `${host}|${bucket}`;
    const row = byHost.get(key) || { count: 0, evidence: [], pathHints: new Set<string>() };
    row.count += 1;
    row.pathHints.add(bucket);
    if (row.evidence.length < 8) row.evidence.push(ev.id);
    byHost.set(key, row);
  }

  const episodes: Episode[] = [];
  for (const [key, row] of byHost) {
    const [host, bucket] = key.split("|");
    episodes.push({
      key,
      label: `${bucket} on ${host}`,
      suggestedIntent: `updates on ${host} ${bucket}`,
      count: row.count,
      evidence: row.evidence,
    });
  }
  return episodes.sort((a, b) => b.count - a.count).slice(0, 10);
}

function pathBucket(path: string): string | null {
  const lower = path.toLowerCase();
  if (/messag|inbox|conversation|\/dm/.test(lower)) return "messaging";
  if (/notif|alert/.test(lower)) return "notifications";
  if (/calendar|event|meeting/.test(lower)) return "calendar";
  if (/search|query/.test(lower)) return "search";
  if (/feed|timeline/.test(lower)) return "feed";
  if (/order|checkout|cart/.test(lower)) return "commerce";
  return null;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
