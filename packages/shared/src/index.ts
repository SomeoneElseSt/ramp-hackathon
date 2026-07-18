// Shared contract types across extension, server, and MCP.
// This is the single source of truth for the wire format.

// ---------------------------------------------------------------------------
// Pet
// ---------------------------------------------------------------------------

// Ordered by "urgency" for the overlay. sleeping = active listener, nothing happening.
export type PetState =
  | "sleeping" // listener active, idle
  | "watching" // relevant traffic arriving
  | "happy" // a task completed / a new relevant event fired
  | "distressed" // a failure was detected
  | "needs-attention"; // an agent/workflow needs approval

// ---------------------------------------------------------------------------
// Signal matching (the compiled, deterministic listener spec)
// ---------------------------------------------------------------------------

export type SignalMode = "realtime" | "poll";

// A SignalMatcher is deterministic: no model runs to evaluate it.
export interface SignalMatcher {
  mode: SignalMode;
  // Substring or glob-ish pattern the captured request URL must contain.
  urlPattern: string;
  // Optional JSON path (dot notation, [*] for arrays) into the parsed frame
  // that points at the array/object of candidate events. Empty => whole body.
  framePath?: string;
  // Optional substring an event must contain (e.g. a LinkedIn event type urn)
  // to be considered a candidate at all.
  eventTypeMatch?: string;
  // Dot-notation path to the value used as the dedup key (e.g. a message urn).
  dedupKeyPath: string;
  // Optional dot paths used only to build a human summary of the event.
  summaryPaths?: {
    sender?: string;
    preview?: string;
    conversation?: string;
  };
  // Free-text hint given to the classifier when relevance is ambiguous.
  relevanceHint?: string;
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

export type ListenerSource = "seed" | "mcp" | "discovery" | "proactive";

export type DispatchActionType = "log" | "webhook" | "codex";

export interface DispatchAction {
  type: DispatchActionType;
  // For "webhook": URL to POST the fired event to.
  url?: string;
  // For "codex": shell command template; {event} is replaced with JSON.
  command?: string;
  // Natural-language instruction handed to the dispatched agent.
  prompt?: string;
  // If true, the pet enters needs-attention instead of auto-running.
  requiresApproval?: boolean;
}

export interface Listener {
  id: string;
  name: string;
  site: string; // host, e.g. "www.linkedin.com"
  prompt: string; // the natural-language intent
  matcher: SignalMatcher;
  // When true, surviving-dedup candidates go to the classifier before firing.
  requiresClassification: boolean;
  action?: DispatchAction;
  source: ListenerSource;
  active: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Captured events (extension -> server)
// ---------------------------------------------------------------------------

export type CaptureKind = "fetch" | "xhr" | "websocket" | "eventsource";

export interface CapturedEvent {
  kind: CaptureKind;
  url: string;
  method: string;
  // Response body (or a single WS/SSE frame) as text. May be truncated.
  body: string;
  tabUrl: string;
  timestamp: number;
  // True when this is one frame of a long-lived stream (must bypass URL-throttle).
  streamed?: boolean;
}

// ---------------------------------------------------------------------------
// Fired events (server -> extension / MCP)
// ---------------------------------------------------------------------------

export interface Classification {
  relevant: boolean;
  reason: string;
}

export interface FiredEvent {
  id: string;
  listenerId: string;
  dedupKey: string;
  summary: string;
  payload: unknown;
  classification?: Classification;
  dispatched: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Metrics (the polling-vs-listener proof point)
// ---------------------------------------------------------------------------

export interface Metrics {
  eventsObserved: number; // raw captured events forwarded to server
  candidatesAfterDedup: number; // survived URL match + dedup
  classifyCalls: number; // OpenAI trigger classifications made
  idleModelCalls: number; // model calls made while no candidate present (== 0 by design)
  fired: number; // events that fired
  dispatches: number; // agents/workflows dispatched
  startedAt: number;
  // Modeled baseline: what a naive poll-every-N-seconds approach would cost.
  pollBaselinePerHour: number;
}

// ---------------------------------------------------------------------------
// WebSocket messages (server <-> extension)
// ---------------------------------------------------------------------------

export interface PetStateMessage {
  type: "pet-state";
  state: PetState;
  reason: string;
  listenerId?: string;
  firedEvent?: FiredEvent;
}

export interface ListenersSyncMessage {
  type: "listeners-sync";
  listeners: Listener[];
}

export interface MetricsMessage {
  type: "metrics";
  metrics: Metrics;
}

export interface ProposalMessage {
  type: "proposal";
  listener: Listener; // a proactively suggested (inactive) listener
  rationale: string;
}

export type ServerToClient =
  | PetStateMessage
  | ListenersSyncMessage
  | MetricsMessage
  | ProposalMessage;

// Extension -> server over WS is just batches of captured events.
export interface CaptureBatchMessage {
  type: "capture-batch";
  events: CapturedEvent[];
}

export type ClientToServer = CaptureBatchMessage;
