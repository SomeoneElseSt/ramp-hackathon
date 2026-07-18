// Shapes frozen by CONTRACT.md. Do not change without telling the team.

// CONTRACT §1 — Extension → daemon (redacted activity event envelope).
export interface ActivityEvent {
  id: string;
  type: string; // stable types from the recorder's schema (network.response, websocket.received, sse.message, console.error, ...)
  ts: number;
  tabId?: number | null;
  windowId?: number | null;
  url?: string | null;
  title?: string | null;
  actionId?: string | null;
  data?: unknown;
}

export interface Identity {
  name: string | null;
  profileId: string | null;
}

// CONTRACT §2 — Daemon → agent (resolved semantic event).
export interface SemanticEvent {
  type: string; // message.received | message.sent | ...
  source: string; // host the event came from, e.g. "www.linkedin.com"
  ts: number;
  from: Identity;
  to?: Identity;
  conversationId?: string | null;
  text: string;
  evidence: string[]; // raw activity-event ids this was derived from
}

// CONTRACT §0 — role handshake + viewer broadcast envelopes.
export interface RoleMessage {
  role: "recorder" | "viewer";
}

export type ViewerEnvelope =
  | { kind: "semantic"; payload: SemanticEvent }
  | { kind: "raw"; payload: ActivityEvent }
  | { kind: "poll"; payload: { agent: string } };

// CONTRACT §3 — MCP subscription / Tama listener.
// pageUrl + endpoints are additive context so the extension knows which site to
// open and which network surfaces to watch. Existing fields unchanged.
export interface Subscription {
  subId: string;
  intent: string;
  types: string[]; // empty => any type
  keywords: string[]; // endpoint/intent narrowing keywords
  pageUrl: string | null; // site to open / keep watching
  endpoints: string[]; // concrete URL/path templates to listen on
  label: string | null; // human label e.g. "New message"
  /** Arm watermark — only events with ts >= sinceTs may wake waiters (event-forward, not history scrape). */
  sinceTs: number;
  createdAt: number;
  pending: SemanticEvent[]; // matched-but-undelivered events (drained by wait/get_recent)
  /** Notify callbacks — events always land in pending first so cancelled waits don't drop DMs. */
  waiters: Array<() => void>;
}

/** Snapshot pushed to the extension when a listener is created/removed. */
export interface ListenerWatch {
  subId: string;
  intent: string;
  types: string[];
  keywords: string[];
  pageUrl: string | null;
  endpoints: string[];
  label: string | null;
  sinceTs?: number;
}

// Additive control envelopes the daemon may push to recorder clients (extension).
export type RecorderControl =
  | { kind: "watch"; payload: ListenerWatch }
  | { kind: "unwatch"; payload: { subId: string } }
  | { kind: "listeners"; payload: { active: ListenerWatch[] } };
