import express from "express";
import cors from "cors";
import type { CapturedEvent, Listener } from "@companion/shared";
import { HTTP_PORT } from "./config.js";
import {
  deleteListener,
  getFiredEvents,
  getListener,
  listListeners,
  upsertListener,
} from "./db.js";
import {
  buildListener,
  processCaptureBatch,
} from "./listeners.js";
import { discoverListener } from "./discovery.js";
import { dispatchEvent } from "./dispatch.js";
import { snapshot } from "./metrics.js";
import { ensureSeed } from "./seed.js";
import { broadcastListeners, initWsServer } from "./ws.js";

ensureSeed();
initWsServer((msg) => {
  if (msg.type === "capture-batch") void processCaptureBatch(msg.events);
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/metrics", (_req, res) => res.json(snapshot()));

// --- Listeners CRUD (also the surface the MCP server calls) ------------------

app.get("/listeners", (_req, res) => res.json(listListeners()));

app.get("/listeners/:id", (req, res) => {
  const listener = getListener(req.params.id);
  if (!listener) return res.status(404).json({ error: "not found" });
  return res.json(listener);
});

app.post("/listeners", (req, res) => {
  const body = req.body as Partial<Listener>;
  if (!body.matcher || !body.matcher.urlPattern || !body.matcher.dedupKeyPath) {
    return res.status(400).json({ error: "matcher.urlPattern and matcher.dedupKeyPath required" });
  }
  const listener = buildListener(body as Partial<Listener> & { matcher: Listener["matcher"] });
  upsertListener(listener);
  broadcastListeners();
  return res.status(201).json(listener);
});

app.delete("/listeners/:id", (req, res) => {
  if (!getListener(req.params.id)) return res.status(404).json({ error: "not found" });
  deleteListener(req.params.id);
  broadcastListeners();
  return res.json({ ok: true });
});

app.get("/listeners/:id/events", (req, res) => {
  if (!getListener(req.params.id)) return res.status(404).json({ error: "not found" });
  return res.json(getFiredEvents(req.params.id));
});

// --- Ingest (HTTP fallback; WS is the primary path) --------------------------

app.post("/ingest", (req, res) => {
  const events = (req.body?.events ?? []) as CapturedEvent[];
  if (!Array.isArray(events)) return res.status(400).json({ error: "events must be an array" });
  void processCaptureBatch(events);
  return res.json({ ok: true, received: events.length });
});

// --- NL discovery ------------------------------------------------------------

app.post("/discover", async (req, res) => {
  const { prompt, host, name } = req.body ?? {};
  if (!prompt || !host) return res.status(400).json({ error: "prompt and host required" });
  const result = await discoverListener({ prompt, host, name });
  if ("error" in result) return res.status(422).json(result);
  upsertListener(result.listener);
  broadcastListeners();
  return res.status(201).json(result);
});

// --- Dispatch a stored event (dispatch_from_event) ---------------------------

app.post("/listeners/:id/dispatch", async (req, res) => {
  const listener = getListener(req.params.id);
  if (!listener) return res.status(404).json({ error: "not found" });
  const events = getFiredEvents(req.params.id);
  const eventId = req.body?.eventId as string | undefined;
  const event = eventId ? events.find((e) => e.id === eventId) : events[0];
  if (!event) return res.status(404).json({ error: "no fired event to dispatch" });
  const result = await dispatchEvent({ ...listener, action: listener.action }, event);
  return res.json(result);
});

app.listen(HTTP_PORT, () => {
  console.log(`[http] listening on http://localhost:${HTTP_PORT}`);
});
