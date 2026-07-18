# AGENTS.md — working context for reflex

Read this first. It's the working context for any agent or teammate picking up
this repo. We build **one after the other on `master`** — sync, do a focused
piece, push.

## Mission

Agents can *use* the web but the web can't *call them back*. Today "watch my
LinkedIn inbox" means an agent screenshots the page every ~60s, burning tokens
while nothing happens. **reflex** installs a lightweight listener inside the
user's own authenticated browser: the agent describes an event in natural
language, the system watches the right signal locally, the model **stops**, and
it's woken only when the event actually fires — with entities already resolved.

> First, we let agents subscribe to the web instead of polling it. Then, by
> learning how the user works, we help them discover what's worth subscribing to.

Everything is local. Cookies, auth headers, CSRF, and passwords never reach the
model.

## The frozen contract — do not drift

[`CONTRACT.md`](./CONTRACT.md) is frozen. Every lane builds against it
independently; changing a shape mid-build breaks integration. The essentials:

- **Extension → daemon** (WS `ws://localhost:8787`): push each already-redacted
  activity event as it's captured (the envelope in `CONTRACT.md §1`).
- **Daemon → agent** (MCP): emit **resolved semantic events**
  (`{type, from:{name}, text, evidence}`) — identities resolved *in the daemon*,
  so the model spends zero tokens working out who sent what.
- **MCP tools**: `subscribe(intent)`, `wait_for_event(subId)` (blocks — the
  reactive primitive; must not poll internally), `get_recent_events(subId)`.

## Architecture / data flow

```
browser (authenticated tab)
  └─ recorder extension ── captures fetch/XHR/WS/SSE + DOM, redacts, stores
       │  WS: redacted activity events (CONTRACT §1)
       ▼
  daemon/  bridge.ts → perceive.ts → extract.ts (general, site-agnostic)
       │      · resolves identities, dedups by stable id
       │      · broadcasts {semantic|raw|poll} to viewers (demo)
       ▼
  server.ts  MCP stdio: subscribe / wait_for_event / get_recent_events
       ▼
  Codex / any agent  ── sleeps on wait_for_event, wakes on the real event
```

## Repo layout / lanes

| Path | What it is | State |
|---|---|---|
| `har-recorder/` | **The recorder that works** — MV3 extension, debugger-free capture (in-page fetch/XHR/WS/SSE interception, no banner), exports HAR + trace + summary. Now streams events to the daemon. | **the base — build on this** |
| `daemon/` | The live layer: `bridge` (WS) · `perceive` (incremental) · `extract` (general message extraction, no per-site code) · `intent` (NL → endpoints) · `server` (MCP). | built to CONTRACT |
| `extension/` | WXT ("Tama Agent") sensor — parallel/newer scaffold with capture wired. Overlaps har-recorder; treat as secondary. | secondary |
| `demo/` | `tamagent.html`, `pet-widget.html` — the side-by-side polling-vs-listener demo + mascot. | demo lane |
| `CONTRACT.md` `PITCH.md` `README.md` | frozen interface · pitch · overview | — |

**Which recorder?** `har-recorder/` is the proven one and the daemon streams
from it — **build capture/streaming work there**, not in `extension/`.

## Run it

```bash
# daemon (live layer + MCP)
cd daemon && npm install && npm run dev          # ws://localhost:8787, MCP on stdio

# recorder: load har-recorder/ unpacked (chrome://extensions → Load unpacked → har-recorder)
#   (it has a static manifest.json — no build step)

# demo viewer
open demo/tamagent.html
```

## Rules for working here

- **Sync before you build, push when done:** `git pull --rebase origin master`
  → focused change → `git push origin master`. We share `master`.
- **Never clobber a teammate's file.** If a rebase touches someone else's lane,
  prefer theirs; keep your work additive. Lanes are in `CONTRACT.md §4`.
- **Don't change `CONTRACT.md` shapes** without telling the whole team.
- **Never send secrets to the model.** Redaction happens in the capture layer;
  the daemon rejects any event still carrying a sensitive header.
- **Consequential actions require user approval** (e.g. sending a reply). The
  system observes and prepares; it never sends on the user's behalf unprompted.

## Where to pick up next (open items)

- **Background detection.** On LinkedIn the message *content* is fetched only
  when the tab is focused; the real-time signal for a hidden tab is the realtime
  push stream (an RSC `server-stream-request`). Tapping its frames (tee the
  `ReadableStream`) is the unsolved-but-load-bearing piece for "notify me while
  away." The triggered-fetch path works when the tab is active.
- **Overlay.** "Tama is watching this tab" + the discovered functionalities it
  can listen for (see `extension/lib/functionality.ts` for the source→label
  mapping) — wire onto the recorder + daemon discovery.
- **Proactive act.** Learn a repeated workflow from recorded episodes → propose
  a listener → user approves → the same listener is created.
