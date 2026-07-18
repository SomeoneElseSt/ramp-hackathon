// index.js — service-worker entry. Orchestrates capture (CDP + tabs + content
// script), local storage, and export. All processing is local; nothing is sent
// anywhere. Raw normalized events are stored uncorrelated; correlation + HAR +
// summary are computed at export time as global passes.

import {
  appendEvent,
  clearAll,
  countEvents,
  getAllEvents,
  getMeta,
  setMeta,
} from "../core/storage.js";
import { createTabTracker, isRestrictedUrl } from "./tabs.js";
import * as N from "../core/normalize.js";
import { correlate } from "../core/correlate.js";
import { buildSummary } from "../core/filter.js";
import { buildHar } from "../core/har.js";
import { containsForbiddenHeader } from "../core/redact.js";
import { SCHEMA_VERSION } from "../core/schema.js";
import { resolveWatchTarget } from "../integrations/index.js";

// Robust, restart-safe unique id (raw ids need only be unique, not ordered;
// export sorts by ts). Node tests use a deterministic factory instead.
function robustIdFactory() {
  let n = 0;
  return () => {
    const rnd = (crypto.getRandomValues(new Uint32Array(1))[0] || 0).toString(36);
    return `e${Date.now().toString(36)}${(n++).toString(36)}${rnd}`;
  };
}
const idFn = robustIdFactory();

let recording = false;
/** @type {Map<string, { subId: string, label: string|null, pageUrl: string|null }>} */
const activeWatches = new Map();

// ---- live stream to the reflex daemon (CONTRACT.md §0/§1) ------------------
// The extension IS the laptop sensor. It streams each already-redacted,
// already-normalized activity event to the local daemon over
// ws://localhost:8787 as role "recorder", so listeners fire in real time.
// If the daemon isn't running, events queue locally (and IndexedDB still has
// them for export). All localhost-only. Adds only an outbound WS client; the
// event envelope is unchanged (CONTRACT §1).
//
// Daemon → extension: RecorderControl {watch|unwatch|listeners} opens/focuses
// a tab via the integration harness so ambient capture has an auth surface.
const DAEMON_URL = "ws://localhost:8787";

function createDaemonClient(url, { onControl } = {}) {
  let socket = null;
  let reconnectTimer = null;
  const queue = [];
  const MAX_QUEUE = 2000;

  function connect() {
    try {
      socket = new WebSocket(url);
    } catch (_) {
      return scheduleReconnect();
    }
    socket.addEventListener("open", () => {
      try { socket.send(JSON.stringify({ role: "recorder" })); } catch (_) {}
      flush();
    });
    socket.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg && (msg.kind === "watch" || msg.kind === "unwatch" || msg.kind === "listeners")) {
          onControl?.(msg);
        }
      } catch (_) {}
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", () => { try { socket.close(); } catch (_) {} });
  }
  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000);
  }
  function flush() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    for (const ev of queue.splice(0)) socket.send(JSON.stringify(ev));
  }
  connect();

  return {
    push(ev) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify(ev)); return; } catch (_) {}
      }
      queue.push(ev);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
  };
}

const daemon = createDaemonClient(DAEMON_URL, { onControl: handleRecorderControl });

async function handleRecorderControl(msg) {
  if (msg.kind === "watch") {
    await onWatch(msg.payload);
    return;
  }
  if (msg.kind === "unwatch") {
    activeWatches.delete(msg.payload?.subId);
    updateListeningBadge();
    broadcast();
    return;
  }
  if (msg.kind === "listeners") {
    const active = msg.payload?.active || [];
    activeWatches.clear();
    for (const w of active) {
      if (w?.subId) await onWatch(w);
    }
    updateListeningBadge();
    broadcast();
  }
}

/**
 * Integration harness entry: ensure ambient capture + open/focus pageUrl.
 * @param {object} watch ListenerWatch from daemon
 */
async function onWatch(watch) {
  if (!watch?.subId) return;

  const target = resolveWatchTarget(watch);
  activeWatches.set(watch.subId, {
    subId: watch.subId,
    label: watch.label || target.moduleId || null,
    pageUrl: target.pageUrl,
  });

  if (!target.openTab || !target.pageUrl || isRestrictedUrl(target.pageUrl)) {
    updateListeningBadge();
    broadcast();
    return;
  }

  try {
    const tab = await openOrFocusTab(target.pageUrl);
    if (tab?.id != null) {
      if (!recording) {
        recording = true;
        const scope = { mode: "tabs", tabIds: [tab.id] };
        await setMeta("recording", true);
        await setMeta("startedAt", Date.now());
        await setMeta("scope", scope);
        await tabs.start(scope);
      } else {
        await tabs.includeTab(tab.id);
        const s = tabs.scope();
        await setMeta("scope", {
          mode: s.mode,
          windowId: s.windowId ?? null,
          tabIds: [...(s.tabIds || [])],
        });
      }
    }
  } catch (err) {
    console.warn("[tama] watch open-tab failed", err);
  }

  updateListeningBadge();
  broadcast();
}

async function openOrFocusTab(pageUrl) {
  let origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  // Prefer a tab already on a path prefix of pageUrl (e.g. /messaging/).
  let pathPrefix = "/";
  try {
    pathPrefix = new URL(pageUrl).pathname.replace(/\/$/, "") || "/";
  } catch (_) {}
  const ranked = existing
    .filter((t) => t.id != null && !isRestrictedUrl(t.url))
    .sort((a, b) => {
      const aHit = (a.url || "").includes(pathPrefix) ? 1 : 0;
      const bHit = (b.url || "").includes(pathPrefix) ? 1 : 0;
      return bHit - aHit;
    });
  if (ranked[0]) {
    const tab = ranked[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId != null) {
      try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    }
    // If we're on the right origin but wrong path (feed vs messaging), navigate.
    if (pathPrefix !== "/" && !(tab.url || "").includes(pathPrefix)) {
      await chrome.tabs.update(tab.id, { url: pageUrl });
    }
    return tab;
  }
  return chrome.tabs.create({ url: pageUrl, active: true });
}

function updateListeningBadge() {
  const n = activeWatches.size;
  const first = n > 0 ? [...activeWatches.values()][0] : null;
  const label = first?.label || "listen";
  try {
    if (n === 0) {
      chrome.action.setBadgeText({ text: "" });
      chrome.action.setTitle({ title: "Tama / Workflow Recorder" });
    } else {
      chrome.action.setBadgeText({ text: n > 1 ? String(n) : "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#1a7f4b" });
      chrome.action.setTitle({
        title: n === 1 ? `Tama listening: ${label}` : `Tama listening: ${n} listeners`,
      });
    }
  } catch (_) {}
}

// ---- storage sink (redaction already applied in normalize) -----------------
async function store(ev) {
  if (!ev) return;
  // Guard: never persist an event that still carries a forbidden header.
  const h = ev.data?.headers;
  if (h && containsForbiddenHeader(h)) {
    ev = { ...ev, data: { ...ev.data, headers: (ev.data.headers || []).filter((x) => !containsForbiddenHeader([x])) } };
  }
  await appendEvent(ev);
  daemon.push(ev); // feed the reflex daemon in real time (CONTRACT §1)
  broadcast();
}

let broadcastTimer = null;
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    chrome.runtime.sendMessage({ type: "state-changed" }).catch(() => {});
  }, 250);
}

// ---- sensors (debugger-free) -----------------------------------------------
// Network capture is done by injecting the MAIN-world interceptor (patches
// fetch/XHR/WebSocket/EventSource) instead of chrome.debugger — no "being
// debugged" banner. Injection is scoped to opted-in tabs only.
const injectedTabs = new Set();
const tabs = createTabTracker({
  onEvent: store,
  idFn,
  onAttach: async (tabId) => injectSensors(tabId),
  onDetach: (tabId) => injectedTabs.delete(tabId),
});

async function injectSensors(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    // MAIN-world network interceptor + isolated-world relay
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/interceptor.js"], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/relay.js"], world: "ISOLATED" });
    // DOM interaction capture
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content/content-script.js"] });
    injectedTabs.add(tabId);
  } catch (_) {
    // restricted page (chrome://, store) — can't inject; skip
  }
}

// ---- page-capture (debugger-free network capture via the MAIN-world interceptor)
function ctxOf(sender) {
  const tab = sender.tab;
  return (tab && tabs.getCtx(tab.id)) || { tabId: tab?.id ?? null, windowId: tab?.windowId ?? null, url: tab?.url ?? null, title: tab?.title ?? null };
}
function pageCaptureToEvents(rec, ctx) {
  if (rec.kind === "http") {
    const rid = idFn();
    const url = absoluteUrl(rec.url, ctx.url);
    const method = rec.method || "GET";
    return [
      N.networkRequest(
        idFn,
        { ts: rec.ts, requestId: rid, method, url, resourceType: "Fetch", headers: {}, initiator: {} },
        ctx,
      ),
      N.networkResponse(
        idFn,
        {
          ts: rec.ts,
          requestId: rid,
          method,
          url,
          status: rec.status ?? 0,
          mimeType: rec.ct || "",
          resourceType: "Fetch",
          headers: {},
        },
        ctx,
        rec.body ? { text: rec.body, base64Encoded: false, mimeType: rec.ct || "" } : null,
      ),
    ];
  }
  if (rec.kind === "sse") {
    return [N.sseMessage(idFn, { ts: rec.ts, requestId: null, url: absoluteUrl(rec.url, ctx.url), data: rec.data }, ctx)];
  }
  if (rec.kind === "ws") {
    return [N.webSocketFrame(idFn, { ts: rec.ts, direction: rec.dir, payload: rec.data, requestId: null }, ctx)];
  }
  return [];
}

function absoluteUrl(url, base) {
  if (!url) return url;
  try {
    return new URL(url, base || undefined).href;
  } catch {
    return url;
  }
}

// ---- content-script DOM events + page captures -----------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "dom-event") {
    if (!recording) return; // ignore stray events after stop
    const ev = N.domInteraction(idFn, msg.payload, ctxOf(sender));
    if (ev) store(ev);
    return; // no response needed
  }
  if (msg?.type === "page-capture") {
    if (!recording) return;
    for (const ev of pageCaptureToEvents(msg.rec, ctxOf(sender))) store(ev);
    return;
  }

  // popup commands (async)
  (async () => {
    switch (msg?.type) {
      case "get-state":
        sendResponse({
          recording,
          scope: await getMeta("scope", null),
          entryCount: await countEvents(),
          attached: [...injectedTabs],
          schemaVersion: SCHEMA_VERSION,
          listening: [...activeWatches.values()],
        });
        break;
      case "start": {
        recording = true;
        const scope = normalizeScope(msg.scope);
        await setMeta("scope", scope);
        await setMeta("startedAt", Date.now());
        await setMeta("recording", true);
        await tabs.start(scope);
        broadcast();
        sendResponse({ ok: true, scope });
        break;
      }
      case "stop":
        recording = false;
        await setMeta("recording", false);
        tabs.stop();
        injectedTabs.clear();
        // tell content scripts (interceptor relay + DOM) to stop observing
        chrome.tabs.query({}, (all) => {
          for (const t of all) chrome.tabs.sendMessage(t.id, { type: "wf-stop" }).catch(() => {});
        });
        broadcast();
        sendResponse({ ok: true });
        break;
      case "clear":
        await clearAll();
        broadcast();
        sendResponse({ ok: true });
        break;
      case "export": {
        const raw = await getAllEvents();
        const correlated = correlate(raw);
        sendResponse({
          ok: true,
          counts: { events: correlated.length },
          artifacts: buildArtifacts(correlated),
        });
        break;
      }
      case "list-tabs": {
        const all = await chrome.tabs.query({});
        sendResponse({
          tabs: all
            .filter((t) => !isRestrictedUrl(t.url))
            .map((t) => ({ id: t.id, windowId: t.windowId, title: t.title, url: t.url })),
          currentWindow: (await chrome.windows.getCurrent()).id,
        });
        break;
      }
    }
  })();
  return true; // async sendResponse for popup commands
});

function normalizeScope(scope) {
  if (!scope || scope.mode === "window") {
    return { mode: "window", windowId: scope?.windowId ?? null, tabIds: [] };
  }
  return { mode: "tabs", windowId: null, tabIds: scope.tabIds || [] };
}

function buildArtifacts(events) {
  const har = buildHar(events);
  const summary = buildSummary(events, { generatedAt: Date.now() });
  const trace = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: Date.now(),
    eventCount: events.length,
    events,
  };
  return { har, trace, summary };
}

// If the worker restarts mid-recording, restore the flag (attachments are
// re-established lazily as events arrive / tabs update).
(async () => {
  const started = await getMeta("startedAt", null);
  const scope = await getMeta("scope", null);
  const wasRecording = await getMeta("recording", false);
  if (wasRecording && scope) {
    recording = true;
    await tabs.start(normalizeScope(scope)).catch(() => {});
  }
})();
