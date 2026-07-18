// schema.js — the shared event contract for the activity trace.
//
// Every captured observation is normalized into one flat "activity event"
// envelope. Both the raw trace (activity-trace.json) and the compact summary
// (activity-summary.json) are built from these. Pure module — no browser or
// Node globals — so it is imported unchanged by the service worker, the popup,
// and the Node test harness.

export const SCHEMA_VERSION = "1.0.0";

// Stable event types. Adding a type is backwards-compatible; renaming is not.
export const EventType = Object.freeze({
  TAB_CREATED: "tab.created",
  TAB_CLOSED: "tab.closed",
  TAB_ACTIVATED: "tab.activated",
  PAGE_NAVIGATED: "page.navigated",
  USER_CLICKED: "user.clicked",
  USER_SUBMITTED: "user.submitted",
  USER_FOCUSED: "user.focused",
  NETWORK_REQUEST: "network.request",
  NETWORK_RESPONSE: "network.response",
  WEBSOCKET_SENT: "websocket.sent",
  WEBSOCKET_RECEIVED: "websocket.received",
  SSE_MESSAGE: "sse.message",
  DOM_CHANGED: "dom.changed",
  CONSOLE_ERROR: "console.error",
});

// Types that represent a deliberate user action. Correlation hangs evidence
// (network/dom/console events) off the most recent action on a tab.
export const ACTION_TYPES = new Set([
  EventType.USER_CLICKED,
  EventType.USER_SUBMITTED,
]);

// Types treated as "user-meaningful" when building the compact summary.
export const MEANINGFUL_TYPES = new Set([
  EventType.TAB_ACTIVATED,
  EventType.PAGE_NAVIGATED,
  EventType.USER_CLICKED,
  EventType.USER_SUBMITTED,
  EventType.NETWORK_REQUEST,
  EventType.NETWORK_RESPONSE,
  EventType.WEBSOCKET_RECEIVED,
  EventType.DOM_CHANGED,
  EventType.CONSOLE_ERROR,
]);

/**
 * Build a normalized activity event. Callers pass whatever they have; missing
 * context is null so the shape is always uniform.
 *
 * @returns {{
 *   id: string, type: string, ts: number,
 *   tabId: number|null, windowId: number|null,
 *   url: string|null, title: string|null,
 *   actionId: string|null, data: object
 * }}
 */
export function makeEvent({
  id,
  type,
  ts,
  tabId = null,
  windowId = null,
  url = null,
  title = null,
  actionId = null,
  data = {},
}) {
  return { id, type, ts, tabId, windowId, url, title, actionId, data };
}

// Monotonic id generator (seq + short random-ish suffix derived from seq so it
// stays deterministic under test). Not cryptographic; only needs uniqueness.
export function createIdFactory(prefix = "e") {
  let seq = 0;
  return () => `${prefix}${(++seq).toString(36).padStart(6, "0")}`;
}
