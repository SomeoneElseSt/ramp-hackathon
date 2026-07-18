// background.ts — Tama Agent service worker.
//
// Records activity events (debugger-free): the MAIN-world interceptor + DOM
// content scripts feed page-capture / dom-event messages here; we normalize +
// redact them (shared core pipeline), store locally (IndexedDB), and push each
// already-redacted event to the daemon over ws://localhost:8787 (CONTRACT §1).

import * as N from '../lib/core/normalize.js';
import { appendEvent, countEvents } from '../lib/core/storage.js';

const DAEMON_URL = 'ws://localhost:8787';

let seq = 0;
const idFn = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
let recording = true; // Tama records by default once loaded

export default defineBackground(() => {
  const daemon = createDaemonClient(DAEMON_URL);

  async function store(ev: any) {
    if (!ev) return;
    await appendEvent(ev);
    daemon.push(ev); // CONTRACT §1: push each redacted event as it's stored
    bumpCount();
  }

  const ctxOf = (sender: any) => {
    const t = sender?.tab;
    return { tabId: t?.id ?? null, windowId: t?.windowId ?? null, url: t?.url ?? null, title: t?.title ?? null };
  };

  function pageCaptureToEvents(rec: any, ctx: any): any[] {
    if (rec.kind === 'http') {
      const rid = idFn();
      return [
        N.networkRequest(idFn, { ts: rec.ts, requestId: rid, method: rec.method || 'GET', url: rec.url, resourceType: 'Fetch', headers: {}, initiator: {} }, ctx),
        N.networkResponse(idFn, { ts: rec.ts, requestId: rid, status: rec.status ?? 0, mimeType: rec.ct || '', headers: {} }, ctx, rec.body ? { text: rec.body, base64Encoded: false, mimeType: rec.ct || '' } : null),
      ];
    }
    if (rec.kind === 'sse') return [N.sseMessage(idFn, { ts: rec.ts, requestId: null, url: rec.url, data: rec.data }, ctx)];
    if (rec.kind === 'ws') return [N.webSocketFrame(idFn, { ts: rec.ts, direction: rec.dir, payload: rec.data }, ctx)];
    return [];
  }

  chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: any) => {
    if (msg?.type === 'page-capture') {
      if (recording) for (const ev of pageCaptureToEvents(msg.rec, ctxOf(sender))) store(ev);
      return;
    }
    if (msg?.type === 'dom-event') {
      if (recording) { const ev = N.domInteraction(idFn, msg.payload, ctxOf(sender)); if (ev) store(ev); }
      return;
    }
    // popup commands
    (async () => {
      if (msg?.type === 'get-state') sendResponse({ recording, count: await countEvents(), daemon: daemon.connected });
      else if (msg?.type === 'set-recording') { recording = !!msg.on; sendResponse({ ok: true, recording }); }
    })();
    return true;
  });

  let countTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpCount() {
    if (countTimer) return;
    countTimer = setTimeout(async () => {
      countTimer = null;
      chrome.runtime.sendMessage({ type: 'count', count: await countEvents() }).catch(() => {});
    }, 400);
  }

  console.log('[tama] recording — feeding daemon at', DAEMON_URL);
});

/** Reconnecting WebSocket client to the local daemon. Buffers while offline. */
function createDaemonClient(url: string) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: unknown[] = [];

  const flush = () => { if (socket?.readyState === WebSocket.OPEN) for (const ev of queue.splice(0)) socket.send(JSON.stringify(ev)); };
  function connect() {
    try { socket = new WebSocket(url); } catch { return scheduleReconnect(); }
    socket.addEventListener('open', flush);
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket?.close());
  }
  function scheduleReconnect() { if (reconnectTimer) return; reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 1000); }
  connect();

  return {
    push(event: unknown) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); else queue.push(event); },
    get connected() { return socket?.readyState === WebSocket.OPEN; },
  };
}
