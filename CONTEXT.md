# CONTEXT.md — shared orientation for agents

Living notes on what this repo is, how the pieces fit, and what's done vs. next.
**`CONTRACT.md` is the frozen source of truth for shapes/ports — this file is the map, not the law.** Update this file when you land something.

Last updated: 2026-07-18.

---

## What we're building — "reflex" / Tama

Give browser agents **reflexes instead of polling**. Instead of screenshotting a
page every 60s to see if something changed, an agent **subscribes** to a page and
gets **pinged the instant something happens**, over the network/DOM traffic the
browser already emits. Entities (who sent what) are resolved *before* the agent
sees them, so the downstream model spends ~0 tokens.

**Product surface (locked):**

- **Tama MCP** — single local MCP connection any agent (Codex, etc.) taps into.
- **Listener catalog grows automatically** as the extension discovers real signals
  on whatever sites the user browses — agents subscribe to those listeners; we do
  **not** ship per-site connectors (no “LinkedIn MCP pack”).
- **Same extension** organically finds endpoints / DOM events and **recommends
  workflows** (“you keep doing X after Y — want a listener?”).
- **LinkedIn** = first site we *prove* the loop on for the demo — not a dedicated
  integration lane.

Idle listeners stay **deterministic** (zero model). Models only at setup,
ambiguous classification, workflow proposal, and dispatched work.

**The pipeline:**

```
page fires real traffic (fetch/XHR/WebSocket/SSE)
  → har-recorder captures + normalizes (full body, no redaction — MVP)
  → pushes over ws://localhost:8787 as role "recorder"
  → daemon discovers listenable surfaces → listener catalog grows
  → perceives → resolved SEMANTIC events (sender+text joined)
  → broadcasts {kind:semantic} to viewers (Tama pet reacts)
  → Tama MCP wait_for_event() unblocks any agent on one connection
```

---

## Components & status

### `daemon/` — live layer (WS bridge + perception + Tama MCP). ✅ BUILT
Standalone Node/TS package (`npm install && npm run dev`). Owns `ws://localhost:8787`.
- `bridge.ts` — recorder/viewer roles; broadcasts `{kind:semantic|raw|poll}`.
- `perceive.ts` — incremental perception, dedup, waiter queue.
- `extract.ts` — **general, site-agnostic** message extraction (no per-site code).
- `intent.ts` — NL intent → endpoint keywords (+ setup-time OpenAI refine WIP).
- `endpoints.ts` — Unbrowse-style noise filter + API-shaped candidate shortlist (WIP).
- `server.ts` — MCP stdio (CONTRACT tools today; evolving into Tama listener hub).
- Tests: `test/fake-recorder.ts`, `test/mcp-client.ts`, `test/capture-seam.mjs`.

### `har-recorder/` — **the only browser extension**. ✅ CAPTURE→DAEMON WIRED
Debugger-free capture (MAIN-world interceptor patches fetch/XHR/WS/SSE) +
normalize / filter / storage. Streams each activity event to the daemon
(`role: "recorder"`). Core pipeline lives in `src/core/` including:
- `noise-patterns.js` / `endpoints.js` — organic endpoint discovery (Unbrowse-inspired)
- `functionality.js` — discovered source → human label (“New message”, …)

**WXT `extension/` deleted** — do not revive it. Build everything on har-recorder.

### `demo/tamagent.html` — pitch demo (viewer). ✅ EXISTS
Two 1-bit pixel pets. Viewer role wakes on `{kind:semantic}`, drains poller on
`{kind:poll}`. Energy = tokens. Never demo with the `SIM` badge.

---

## Plan to build (Tama MCP + organic discovery)

Ordered. Stay on `har-recorder` + `daemon`. LinkedIn is proof-only.

### 0. Cleanup — ✅ in progress / landing
- [x] Remove WXT `extension/`
- [x] Move functionality labeler → `har-recorder/src/core/functionality.js`
- [ ] Rewrite this file + `AGENTS.md` (this update)
- Keep `CONTRACT.md` shapes unchanged

### 1. Tama MCP as the listener hub
Evolve `daemon/src/server.ts` into pitch language without breaking CONTRACT:

| Tool | Role |
|------|------|
| `create_listener` / `subscribe` | Agent or user asks to watch something (NL intent) |
| `list_listeners` | What Tama currently knows how to watch (catalog + active) |
| `get_listener_events` / `wait_for_event` | Agents tap the **single** connection for fired events |
| `remove_listener` | Drop a watch |

Backend: listeners + dedup in local daemon (hackathon: in-memory / light file).
Catalog entries come from **discovered sources**, not hardcoded site packs.

### 2. Organic discovery (extension → catalog)
How support “auto keeps adding”:

1. har-recorder captures the firehose (already).
2. Unbrowse-style noise filter + API-shaped shortlist (`noise-patterns` / `endpoints`).
3. Setup-time LLM (OpenAI mini) maps intent ↔ candidates **or** labels newly seen
   surfaces as listenable functionalities.
4. New capabilities appear in `list_listeners` for any agent on Tama MCP.

Prove discovery + fire on **LinkedIn messaging** first only because the demo needs
one real wake — machinery stays site-agnostic (`extract.ts`).

### 3. Pet + workflow recommendations (same stream)
- Pet states from semantic events (sleeping / watching / happy).
- Condense recent activity → **recommend workflows** in pet/popup and optionally
  as MCP proposals; approve → same `create_listener`.

Discovery and workflow recs are two consumers of one observation stream.

### Success bar
1. One agent connects to **Tama MCP** once.
2. Extension has organically surfaced ≥1 listenable capability (`list_listeners` / pet).
3. Agent waits on that listener; a real page event (demo: LinkedIn DM) unblocks
   with resolved entities.
4. Extension surfaces ≥1 **workflow recommendation** from observed repetition
   (thin / heuristic OK for hackathon).

### Do not build
- Per-site MCP “connectors” (LinkedIn pack, Gmail pack, …)
- Second extension / WXT revival
- Continuous model over every event
- Firecracker / off-machine indexing before in-browser discovery works
- DB/deploy infra; autonomous message sending

---

## Key facts / gotchas

- **Ports:** daemon WS frozen at `8787` (CONTRACT §0).
- **Contract envelope (recorder→daemon):** `{ id, type, ts, tabId, url, data }`.
  Body at `data.content.text` (network.response) or `data.payload` (ws/sse).
- **Semantic event (daemon→agent):** `{ type, source, ts, from{name,profileId}, to?, conversationId?, text, evidence[] }`.
- **Redaction OFF (MVP):** complete network bodies for perception. Revisit before public.
- **OpenAI:** repo-root `.env` (`OPENAI_API_KEY`). Setup-time refine + extraction
  fallback only; idle path is deterministic.
- **MCP logs → stderr** — stdout is the MCP protocol channel.
- **One extension only:** `har-recorder/`.

## Lanes (CONTRACT §4)
Capture (`har-recorder/`) · Daemon (bridge/perceive) · MCP (`server.ts`) · Demo+pitch.
Stay in your lane; don’t clobber teammates.

## Run it
```bash
# 1. daemon
cd daemon && npm install && npm run dev      # ws://localhost:8787 + MCP stdio
# 2. recorder: Load unpacked → har-recorder/  (chrome://extensions)
# 3. viewer: open demo/tamagent.html  (badge must say LIVE, not SIM)
```
