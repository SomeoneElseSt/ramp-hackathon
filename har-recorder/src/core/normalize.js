// normalize.js — convert raw source observations into uniform activity events.
// Each normalizer applies redaction so downstream storage/exports are clean.
// Pure module: adapters supply plain objects; no browser APIs touched here.

import { EventType, makeEvent } from "./schema.js";
import {
  normalizeUrl,
  redactHeaders,
  redactString,
  redactValue,
} from "./redact.js";

const DEFAULT_BODY_LIMIT = 256 * 1024; // 256 KB — GraphQL messaging payloads exceed 32KB

function ctxFields(ctx = {}) {
  return {
    tabId: ctx.tabId ?? null,
    windowId: ctx.windowId ?? null,
    url: ctx.url != null ? normalizeUrl(ctx.url) : null,
    title: ctx.title != null ? redactString(ctx.title) : null,
  };
}

const BINARY_MIME =
  /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|wasm|x-protobuf)/i;

// ---- network ---------------------------------------------------------------

export function networkRequest(idFn, params, ctx) {
  const init = params.initiator || {};
  return makeEvent({
    id: idFn(),
    type: EventType.NETWORK_REQUEST,
    ts: params.ts,
    ...ctxFields(ctx),
    data: {
      requestId: params.requestId,
      method: params.method,
      url: normalizeUrl(params.url),
      resourceType: params.resourceType || null,
      headers: redactHeaders(params.headers || {}),
      initiator: {
        type: init.type || null,
        url: init.url ? normalizeUrl(init.url) : null,
      },
    },
  });
}

/**
 * @param body optional { text, base64Encoded, mimeType } from CDP
 *             getResponseBody. Binary bodies must be passed as null by caller.
 */
export function networkResponse(idFn, params, ctx, body = null, opts = {}) {
  const limit = opts.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const mime = params.mimeType || "";
  let content = null;
  if (body && body.text != null && !body.base64Encoded && !BINARY_MIME.test(mime)) {
    const raw = String(body.text);
    const truncated = raw.length > limit;
    const clipped = truncated ? raw.slice(0, limit) : raw;
    // MVP: keep complete response bodies (no redaction) so perception has the
    // full network request to work with.
    content = { size: raw.length, mimeType: mime, text: clipped, truncated };
  }
  return makeEvent({
    id: idFn(),
    type: EventType.NETWORK_RESPONSE,
    ts: params.ts,
    ...ctxFields(ctx),
    data: {
      requestId: params.requestId,
      // Critical: stamp the *request* URL here. Envelope url stays page URL.
      url: params.url != null ? normalizeUrl(params.url) : null,
      method: params.method || null,
      status: params.status ?? 0,
      statusText: params.statusText || "",
      mimeType: mime,
      resourceType: params.resourceType || null,
      headers: redactHeaders(params.headers || {}),
      timing: params.timing || null,
      encodedDataLength: params.encodedDataLength ?? null,
      content,
    },
  });
}

// ---- websocket -------------------------------------------------------------

export function webSocketFrame(idFn, params, ctx, opts = {}) {
  const limit = opts.frameLimit ?? 4096;
  const raw = params.payload != null ? String(params.payload) : "";
  const truncated = raw.length > limit;
  const payload = truncated ? raw.slice(0, limit) : raw; // MVP: complete frame, no redaction
  return makeEvent({
    id: idFn(),
    type:
      params.direction === "sent"
        ? EventType.WEBSOCKET_SENT
        : EventType.WEBSOCKET_RECEIVED,
    ts: params.ts,
    ...ctxFields(ctx),
    data: {
      requestId: params.requestId || null,
      opcode: params.opcode ?? null,
      direction: params.direction || "received",
      sizeBytes: raw.length,
      truncated,
      payload,
    },
  });
}

// ---- server-sent events (SSE) ----------------------------------------------
// The realtime push channel many apps (incl. LinkedIn) hold open in the
// authenticated session. Tapping it = zero-poll detection.

export function sseMessage(idFn, params, ctx, opts = {}) {
  const limit = opts.frameLimit ?? 8192;
  const raw = params.data != null ? String(params.data) : "";
  const truncated = raw.length > limit;
  const payload = truncated ? raw.slice(0, limit) : raw; // MVP: complete frame, no redaction
  return makeEvent({
    id: idFn(),
    type: EventType.SSE_MESSAGE,
    ts: params.ts,
    ...ctxFields(ctx),
    data: {
      requestId: params.requestId || null,
      eventName: params.eventName || null,
      url: params.url ? normalizeUrl(params.url) : null,
      sizeBytes: raw.length,
      truncated,
      payload,
    },
  });
}

// ---- console ---------------------------------------------------------------

export function consoleError(idFn, entry, ctx) {
  return makeEvent({
    id: idFn(),
    type: EventType.CONSOLE_ERROR,
    ts: entry.ts,
    ...ctxFields(ctx),
    data: {
      level: entry.level || "error",
      text: redactString(String(entry.text || "")),
      source: entry.source || null,
      lineNumber: entry.lineNumber ?? null,
      stackPreview: entry.stack ? redactString(String(entry.stack).slice(0, 600)) : null,
    },
  });
}

// ---- tabs / navigation -----------------------------------------------------

export function tabEvent(idFn, type, params) {
  return makeEvent({
    id: idFn(),
    type, // tab.created | tab.closed | tab.activated
    ts: params.ts,
    tabId: params.tabId ?? null,
    windowId: params.windowId ?? null,
    url: params.url != null ? normalizeUrl(params.url) : null,
    title: params.title != null ? redactString(params.title) : null,
    data: {
      openerTabId: params.openerTabId ?? null,
      previousTabId: params.previousTabId ?? null,
    },
  });
}

export function pageNavigated(idFn, params) {
  return makeEvent({
    id: idFn(),
    type: EventType.PAGE_NAVIGATED,
    ts: params.ts,
    tabId: params.tabId ?? null,
    windowId: params.windowId ?? null,
    url: normalizeUrl(params.url),
    title: params.title != null ? redactString(params.title) : null,
    data: {
      transitionType: params.transitionType || null,
      referrer: params.referrer ? normalizeUrl(params.referrer) : null,
    },
  });
}

// ---- DOM interaction (from content script) ---------------------------------
// The content script sends compact, value-free descriptors. We still redact
// text/label fields defensively.

function redactElement(el = {}) {
  return {
    tag: el.tag || null,
    role: el.role || null,
    label: el.label != null ? redactString(el.label) : null,
    text: el.text != null ? redactString(el.text) : null,
    heading: el.heading != null ? redactString(el.heading) : null,
    locator: el.locator || null,
    inputType: el.inputType || null,
  };
}

export function domInteraction(idFn, msg, ctx) {
  const base = { id: idFn(), ts: msg.ts, ...ctxFields(ctx) };
  switch (msg.kind) {
    case "click":
      return makeEvent({
        ...base,
        type: EventType.USER_CLICKED,
        data: { element: redactElement(msg.element) },
      });
    case "submit":
      return makeEvent({
        ...base,
        type: EventType.USER_SUBMITTED,
        data: {
          form: {
            locator: msg.form?.locator || null,
            action: msg.form?.action ? normalizeUrl(msg.form.action) : null,
            method: msg.form?.method || null,
            // fields carry NAME/TYPE/LABEL only — never values
            fields: (msg.form?.fields || []).map((f) => ({
              name: f.name ? redactString(f.name) : null,
              type: f.type || null,
              label: f.label ? redactString(f.label) : null,
            })),
          },
        },
      });
    case "focus":
      return makeEvent({
        ...base,
        type: EventType.USER_FOCUSED,
        data: { element: redactElement(msg.element) },
      });
    case "dom":
      return makeEvent({
        ...base,
        type: EventType.DOM_CHANGED,
        data: {
          change: msg.change || "text-change", // dialog|alert|loading|text-change|success|error
          description: msg.description ? redactString(msg.description) : null,
          locator: msg.locator || null,
          textPreview: msg.textPreview ? redactString(String(msg.textPreview).slice(0, 400)) : null,
        },
      });
    default:
      return null;
  }
}
