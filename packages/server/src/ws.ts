import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientToServer,
  FiredEvent,
  Listener,
  PetState,
  ServerToClient,
} from "@companion/shared";
import { SLEEP_AFTER_MS, WATCHING_RESET_MS, WS_PORT } from "./config.js";
import { listListeners } from "./db.js";
import { snapshot } from "./metrics.js";

const clients = new Set<WebSocket>();
let onCaptureBatch: ((events: ClientToServer) => void) | null = null;

export function initWsServer(handler: (msg: ClientToServer) => void): void {
  onCaptureBatch = handler;
  const wss = new WebSocketServer({ port: WS_PORT });
  wss.on("connection", (socket) => {
    clients.add(socket);
    // Sync current listeners + metrics + pet state on connect.
    send(socket, { type: "listeners-sync", listeners: listListeners() });
    send(socket, { type: "metrics", metrics: snapshot() });
    send(socket, { type: "pet-state", state: currentState, reason: "connected" });

    socket.on("message", (raw) => {
      const parsed = safeParse(raw.toString());
      if (!parsed) return;
      if (parsed.type === "capture-batch") onCaptureBatch?.(parsed);
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });
  console.log(`[ws] listening on ws://localhost:${WS_PORT}`);
}

function send(socket: WebSocket, message: ServerToClient): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function broadcast(message: ServerToClient): void {
  const data = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}

export function broadcastMetrics(): void {
  broadcast({ type: "metrics", metrics: snapshot() });
}

export function broadcastListeners(): void {
  broadcast({ type: "listeners-sync", listeners: listListeners() });
}

export function broadcastProposal(listener: Listener, rationale: string): void {
  broadcast({ type: "proposal", listener, rationale });
}

// ---------------------------------------------------------------------------
// Pet state machine. sleeping is the resting state; activity nudges it up and
// timers bring it back down so the overlay reflects live listener behavior.
// ---------------------------------------------------------------------------

let currentState: PetState = "sleeping";
let watchingTimer: NodeJS.Timeout | null = null;
let sleepTimer: NodeJS.Timeout | null = null;

function setState(state: PetState, reason: string, extra?: Partial<ServerToClient>): void {
  currentState = state;
  broadcast({ type: "pet-state", state, reason, ...extra } as ServerToClient);
}

export function petWatching(reason = "activity on a watched signal"): void {
  clearTimers();
  if (currentState !== "happy" && currentState !== "needs-attention") {
    setState("watching", reason);
  }
  watchingTimer = setTimeout(() => petSleeping("quiet again"), WATCHING_RESET_MS);
}

export function petHappy(firedEvent: FiredEvent, reason = "new relevant event"): void {
  clearTimers();
  setState("happy", reason, { firedEvent });
  sleepTimer = setTimeout(() => petSleeping("returning to idle"), SLEEP_AFTER_MS);
}

export function petNeedsAttention(firedEvent: FiredEvent, reason = "approval required"): void {
  clearTimers();
  setState("needs-attention", reason, { firedEvent });
}

export function petDistressed(reason = "failure detected"): void {
  clearTimers();
  setState("distressed", reason);
  sleepTimer = setTimeout(() => petSleeping("recovered"), SLEEP_AFTER_MS);
}

export function petSleeping(reason = "idle"): void {
  clearTimers();
  setState("sleeping", reason);
}

function clearTimers(): void {
  if (watchingTimer) clearTimeout(watchingTimer);
  if (sleepTimer) clearTimeout(sleepTimer);
  watchingTimer = null;
  sleepTimer = null;
}

function safeParse(text: string): ClientToServer | null {
  try {
    return JSON.parse(text) as ClientToServer;
  } catch {
    return null;
  }
}
