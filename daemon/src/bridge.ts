import { WebSocketServer, WebSocket } from "ws";
import type {
  ActivityEvent,
  ListenerWatch,
  RecorderControl,
  RoleMessage,
  ViewerEnvelope,
} from "./types.js";
import { perceiver } from "./perceive.js";
import { log } from "./logger.js";

// CONTRACT §0/§1: ws://localhost:8787 with recorder/viewer roles.
// Recorders push activity events IN; viewers receive {semantic|raw|poll}.
// Additive: recorders ALSO receive RecorderControl (watch/unwatch/listeners)
// so the extension can open pageUrl and know which endpoints to watch.
const WS_PORT = Number(process.env.REFLEX_WS_PORT ?? 8787);
const POLL_INTERVAL_MS = Number(process.env.REFLEX_POLL_INTERVAL_MS ?? 60_000);

const viewers = new Set<WebSocket>();
const recorders = new Set<WebSocket>();

export function startBridge(): void {
  const wss = new WebSocketServer({ port: WS_PORT });

  wss.on("connection", (socket) => {
    let role: "recorder" | "viewer" | null = null;

    socket.on("message", async (raw) => {
      const msg = parse(raw.toString());
      if (!msg) return;

      // First message must be the role handshake.
      if (role === null && isRole(msg)) {
        role = msg.role;
        if (role === "viewer") {
          viewers.add(socket);
        } else {
          recorders.add(socket);
          // Sync current watches so a late-connecting extension catches up.
          sendControl(socket, {
            kind: "listeners",
            payload: { active: perceiver.listWatches() },
          });
        }
        log(`client connected as ${role}`);
        return;
      }

      if (role === "recorder") await handleActivityEvent(msg as ActivityEvent);
      // viewers never send events (CONTRACT §0).
    });

    socket.on("close", () => {
      viewers.delete(socket);
      recorders.delete(socket);
    });
    socket.on("error", () => {
      viewers.delete(socket);
      recorders.delete(socket);
    });
  });

  // Broadcast every perceived semantic event to viewers (drives the pet).
  perceiver.emitter.on("semantic", (payload) => {
    broadcastViewer({ kind: "semantic", payload });
  });

  // Push listener control plane to recorders (extension open-tab / watch UX).
  perceiver.emitter.on("watch", (payload: ListenerWatch) => {
    broadcastRecorder({ kind: "watch", payload });
    log(`→ recorders watch ${payload.subId} pageUrl=${payload.pageUrl ?? "—"}`);
  });
  perceiver.emitter.on("unwatch", (payload: { subId: string }) => {
    broadcastRecorder({ kind: "unwatch", payload });
    log(`→ recorders unwatch ${payload.subId}`);
  });
  perceiver.emitter.on("listeners", (active: ListenerWatch[]) => {
    broadcastRecorder({ kind: "listeners", payload: { active } });
  });

  // Represent the screenshot-polling baseline agent for the side-by-side demo.
  if (POLL_INTERVAL_MS > 0) {
    setInterval(
      () => broadcastViewer({ kind: "poll", payload: { agent: "baseline" } }),
      POLL_INTERVAL_MS,
    );
  }

  log(`WS bridge listening on ws://localhost:${WS_PORT}`);
}

async function handleActivityEvent(event: ActivityEvent): Promise<void> {
  if (!event || typeof event.id !== "string") return;
  // Forward raw to viewers first (network-health / debug), then perceive.
  broadcastViewer({ kind: "raw", payload: event });
  await perceiver.ingest(event);
}

function broadcastViewer(envelope: ViewerEnvelope): void {
  const data = JSON.stringify(envelope);
  for (const socket of viewers) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

function broadcastRecorder(envelope: RecorderControl): void {
  const data = JSON.stringify(envelope);
  for (const socket of recorders) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

function sendControl(socket: WebSocket, envelope: RecorderControl): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(envelope));
}

function isRole(msg: unknown): msg is RoleMessage {
  return (
    !!msg &&
    typeof msg === "object" &&
    ((msg as RoleMessage).role === "recorder" || (msg as RoleMessage).role === "viewer")
  );
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
