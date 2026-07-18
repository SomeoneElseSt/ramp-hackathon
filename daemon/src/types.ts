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

// CONTRACT §3 — MCP subscription.
export interface Subscription {
  subId: string;
  intent: string;
  types: string[]; // empty => any type
  keywords: string[]; // endpoint/intent narrowing keywords
  pending: SemanticEvent[]; // matched-but-undelivered events (drained by wait/get_recent)
  waiters: Array<(event: SemanticEvent) => void>;
}
