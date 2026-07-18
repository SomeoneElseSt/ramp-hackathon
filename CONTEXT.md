# CONTEXT.md — shared orientation for agents

Living notes on what this repo is, how the pieces fit, and what's done vs. next.
**`CONTRACT.md` is the frozen source of truth for shapes/ports — this file is the map, not the law.** Update this file when you land something.

Last updated: 2026-07-18.

---

## What we're building — "reflex"

Give browser agents **reflexes instead of polling**. Instead of screenshotting a
page every 60s to see if something changed, an agent **subscribes** to a page and
gets **pinged the instant something happens**, over the network/DOM traffic the
browser already emits. Entities (who sent what) are resolved *before* the agent
sees them, so the downstream model spends ~0 tokens.

**The pipeline (this is the whole system):**

```
page fires real traffic (fetch/XHR/WebSocket/SSE)
  → extension captures + normalizes it (full body, no redaction — MVP)
  → pushes over ws://localhost:8787 as role "recorder"
  → daemon buffers, perceives → resolved SEMANTIC events (sender+text joined)
  → broadcasts {kind:semantic} to viewers (the Tamagotchi pet reacts)
  → MCP wait_for_event() unblocks an agent in <1s
```

---

## Components & status

### `daemon/` — live layer (WS bridge + perception + MCP). ✅ BUILT & VERIFIED
Standalone Node/TS package (`npm install && npm run dev`). Owns `ws://localhost:8787`.
- `bridge.ts` — recorder/viewer roles; broadcasts `{kind:semantic|raw|poll}`; emits a baseline `poll` tick for the demo.
- `perceive.ts` — incremental perception over the growing buffer, dedup by stable key, waiter queue behind the blocking primitive.
- `extract.ts` — **general, site-agnostic** message extraction: walks any JSON body for message containers (id/sender + text in subtree), learns/resolves identities; budgeted OpenAI fallback to index unfamiliar shapes. **No per-site code.**
- `intent.ts` — NL intent → endpoint keywords + event types (narrowing).
- `identities.ts` — accumulates name↔id, resolves sender before the agent sees it.
- `server.ts` — MCP stdio tools: `subscribe`, `wait_for_event` (blocks), `get_recent_events`.
- Tests: `test/fake-recorder.ts`, `test/mcp-client.ts`, `test/capture-seam.mjs` (drives the REAL extension normalize.js → daemon).

Verified: LinkedIn frame + a generic chat API both resolve to clean semantic events; dup + telemetry suppressed; MCP `wait_for_event` blocks then unblocks on a live event.

### `extension/` — WXT "Tama Agent" recorder. 🚧 ACTIVE (other agents)
Debugger-free capture (interceptor/relay/dom content scripts + `lib/core/*` copied from har-recorder). Background pushes to the daemon on `8787` (recorder role). Has a "functionality labeler" (`lib/functionality.ts`) mapping discovered source → listenable event. This is becoming the primary recorder.

### `har-recorder/` — standalone debugger-free recorder. ✅ CAPTURE→DAEMON WIRED
The original working capture (MAIN-world `interceptor.js` patches fetch/XHR/WS/SSE) + normalization pipeline. `src/background/index.js` now streams each normalized activity event to the daemon over WS (recorder role). Overlaps with `extension/` — two recorders, same daemon target.

### `demo/tamagent.html` — the pitch demo (viewer). ✅ EXISTS (owned by demo lane)
Two 1-bit pixel pets. Connects as `viewer`, wakes the "reflex" pet on `{kind:semantic}`, drains the "poller" pet on `{kind:poll}`. **Energy = tokens** is the core visual argument. Self-simulates with a loud `SIM` badge if the daemon is down (never demo with that badge).

---

## Key facts / gotchas

- **Ports:** daemon WS is frozen at `8787` (CONTRACT §0). Don't put anything else there.
- **Contract envelope (recorder→daemon):** `{ id, type, ts, tabId, url, data }`. Body lives at `data.content.text` (network.response) or `data.payload` (ws/sse). Stable types in `*/core/schema.js`.
- **Semantic event (daemon→agent):** `{ type, source, ts, from{name,profileId}, to?, conversationId?, text, evidence[] }`.
- **Redaction is OFF (MVP decision):** we keep **complete** network bodies so perception has full context. `normalize.js` no longer redacts body/frame text. (Revisit before anything public.)
- **OpenAI:** key in repo-root `.env` (`OPENAI_API_KEY`). Only used for the extraction fallback on unfamiliar sites; deterministic heuristic path works without it.
- **MCP logs must go to stderr** — stdout is the MCP protocol channel.
- **Two extensions exist** (`extension/` WXT and `har-recorder/`). Expect consolidation; both target the same daemon.

## Lanes (who touches what — CONTRACT §4)
Extension (capture) · Daemon (bridge/perceive) · MCP surface (server.ts) · Demo+pitch. Stay in your lane; don't edit `daemon/` from the extension lane and vice-versa.

## Run it
```bash
# 1. daemon
cd daemon && npm install && npm run dev      # ws://localhost:8787 + MCP stdio
# 2. recorder: load extension/ or har-recorder/ unpacked in Chrome, start recording on a tab
# 3. viewer: open demo/tamagent.html  (badge should say "live", not "SIM")
```

## What's next
- **Consolidate the two recorders** (or clearly designate one as the demo recorder).
- **Real poll baseline** for the demo comparison (daemon currently emits a placeholder `poll` tick).
- **Proactive workflow extraction** (README "Extend" feature) — not started.
- Harden extraction on more live sites (sender/direction/group-chat edge cases).
