// background.ts — Reflex extension service worker.
//
// CONTRACT.md §1 (Extension → daemon): push each already-redacted activity
// event to the local daemon over ws://localhost:8787 as it is captured. The
// extension only gains an outbound WS client; the event envelope is unchanged
// (see SCHEMA.md).

const DAEMON_URL = 'ws://localhost:8787';

/** Activity-event envelope pushed to the daemon (CONTRACT.md §1). */
export interface ActivityEvent {
  id: string;
  type: string;
  ts: number;
  tabId?: number | null;
  url?: string | null;
  data?: unknown;
}

export default defineBackground(() => {
  const daemon = createDaemonClient(DAEMON_URL);

  // TODO(capture lane): wire in-page fetch/XHR/WS/SSE + DOM capture here and
  // call `daemon.push(event)` for each redacted activity event.
  // For now the WS client stands up and reconnects, ready to receive events.

  console.log('[reflex] background ready — daemon client →', DAEMON_URL);

  // expose for other extension contexts (popup) if needed later
  (globalThis as any).__reflexDaemon = daemon;
});

/** Reconnecting WebSocket client to the local daemon. Buffers while offline. */
function createDaemonClient(url: string) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: ActivityEvent[] = [];

  function flush() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    for (const ev of queue.splice(0)) socket.send(JSON.stringify(ev));
  }

  function connect() {
    try {
      socket = new WebSocket(url);
    } catch {
      return scheduleReconnect();
    }
    socket.addEventListener('open', flush);
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket?.close());
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1000);
  }

  connect();

  return {
    push(event: ActivityEvent) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
      else queue.push(event);
    },
    get connected() {
      return socket?.readyState === WebSocket.OPEN;
    },
  };
}
