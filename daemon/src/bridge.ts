import { WebSocketServer, WebSocket } from "ws";
import type { ActivityEvent, RoleMessage, ViewerEnvelope } from "./types.js";
import { perceiver } from "./perceive.js";
import { log } from "./logger.js";

// CONTRACT §0/§1: ws://localhost:8787 with recorder/viewer roles. Recorders push
// redacted activity events IN; the daemon broadcasts tagged envelopes to viewers.
const WS_PORT = Number(process.env.REFLEX_WS_PORT ?? 8787);
const POLL_INTERVAL_MS = Number(process.env.REFLEX_POLL_INTERVAL_MS ?? 60_000);

const viewers = new Set<WebSocket>();

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
        if (role === "viewer") viewers.add(socket);
        log(`client connected as ${role}`);
        return;
      }

      if (role === "recorder") await handleActivityEvent(msg as ActivityEvent);
      // viewers never send events (CONTRACT §0).
    });

    socket.on("close", () => {
      viewers.delete(socket);
    });
    socket.on("error", () => {
      viewers.delete(socket);
    });
  });

  // Broadcast every perceived semantic event to viewers (drives the pet).
  perceiver.emitter.on("semantic", (payload) => {
    broadcast({ kind: "semantic", payload });
  });

  // Represent the screenshot-polling baseline agent for the side-by-side demo.
  if (POLL_INTERVAL_MS > 0) {
    setInterval(() => broadcast({ kind: "poll", payload: { agent: "baseline" } }), POLL_INTERVAL_MS);
  }

  log(`WS bridge listening on ws://localhost:${WS_PORT}`);
}

async function handleActivityEvent(event: ActivityEvent): Promise<void> {
  if (!event || typeof event.id !== "string") return;
  // Forward raw to viewers first (network-health / debug), then perceive.
  broadcast({ kind: "raw", payload: event });
  await perceiver.ingest(event);
}

function broadcast(envelope: ViewerEnvelope): void {
  const data = JSON.stringify(envelope);
  for (const socket of viewers) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
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
