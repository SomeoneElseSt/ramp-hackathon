# TamaAgent

**Give browser agents reflexes. Stop polling by screenshot.**

A new modality for AI agents: instead of taking a screenshot every minute to check if something changed, an agent **subscribes** to a page and gets **pinged the instant it happens**, over the network and DOM layer the browser already emits. Reactive, not polling. Cheaper, faster, and the entities are resolved before the agent ever sees them.

**Built at the Ramp Hackathon (2026)**

---

## The Problem

Today's browser agents are **blind pollers**. To know if a LinkedIn DM arrived, an agent opens the page, screenshots it, runs a vision model, and repeats. Every minute. All day.

- **Polling is slow**: the smallest cadence a computer-use agent can hold is roughly a minute, so "instant" is up to 60 seconds late by design.
- **Screenshots are expensive**: every check is an image through a vision model plus the tokens to re-read the whole page, whether or not anything changed.
- **Agents are reactive only by brute force**: there is no way for a page to *tell* an agent "something happened." The agent has to go look.
- **Context is re-derived every time**: who sent it, what thread, what it says, all re-parsed from pixels on every poll.

> *"Tell Codex to watch my LinkedIn and ping me on a new DM. It can, but the smallest cadence is a minute, so it screenshots LinkedIn.com every 60 seconds all day. That's insane, and it's not even fast."*

The interesting layer, the network requests and WebSocket frames the page is already exchanging, is almost entirely unused as an agent modality.

---

## The Solution

TamaAgent gives agents an **event layer** for any site that runs JavaScript:

**Observe the real page traffic, resolve it into clean semantic events, and let an agent block on `wait_for_event()` until one fires.**

1. **Capture**: a local Chrome extension records the page's real network traffic (via CDP, so actual response bodies), WebSocket frames, clicks, DOM changes, and tab switches, redacted at the source.
2. **Perceive**: a perception layer turns raw traffic into resolved semantic events (`message.received` with the real sender name already joined in), inspecting only API-shaped, intent-matching endpoints.
3. **React**: an MCP server exposes `subscribe(intent)` and a blocking `wait_for_event()`. The agent subscribes, then idles at near-zero cost until a matching event arrives, then acts in under a second. No screenshots. No polling.
4. **Extend**: the same capture stream doubles as a **proactive** signal. TamaAgent records how you actually work across tabs and can surface the repeated workflows worth automating.

**One agent. One page. Zero screenshots. Reactive by design.**

---

## How it works

```
new DM lands on the page
   → page fires its own realtime/network response
   → extension (CDP) captures it, redacts it, pushes it over WS
   → daemon runs the perception getter, resolves sender + text
   → wait_for_event() unblocks, returns a clean semantic event
   → agent pings you, in < 1s, having spent ~0 tokens idling
```

The whole thesis is that last unblock: **reactivity is a long-lived tool call that resolves on a real event**, not a loop of screenshots. That is an honest primitive, and it is the difference between "checks every minute" and "reacts the moment it happens."

---

## Key Features

### Live capture layer (Chrome MV3 + CDP)

- Records **network requests/responses with real bodies** (via `chrome.debugger` / CDP), **WebSocket frames**, clicks, form submits, focus, navigation, tab switches, meaningful DOM changes, and console errors.
- Cross-tab: correlates evidence to the user action that triggered it via `actionId`.
- **Redacted at the source**: cookies, `Authorization`, CSRF, tokens, JWTs, API keys, and emails never leave the capture layer. No input values, no full DOM snapshots.

### Perception layer (the event source)

- `getEvents(raw, { intent, types })` turns raw traffic into **resolved semantic events**:
  ```jsonc
  { "type": "message.received", "source": "linkedin",
    "from": { "name": "Raphael Husbands", "profileId": "urn:li:…" },
    "text": "Okay", "ts": 1784341685706, "evidence": ["e…"] }
  ```
- **Entities resolved in the recorder**: the sender URN is joined to a name before the agent sees it, so the downstream model burns zero tokens re-deriving who and what.
- **Intent narrowing**: a watcher says `"new messages"` and only messaging endpoints are inspected (`messag/conversation/thread/inbox`), skipping telemetry and presence noise.
- **Efficiency, measured**: on a real trace, `3054 raw events → ~125 useful → the handful that matter`. That funnel is the cost story.

### Reactive MCP server

- `subscribe({ intent, types })`: register what the agent cares about, in natural language.
- `wait_for_event({ subId })`: **blocks until the next matching semantic event arrives**, then returns it. This is the reactive primitive.
- Runs as a local stdio MCP server, drops straight into any MCP client.

### Cost + speed comparison (the demo)

- Side-by-side: a screenshot-polling agent vs a Tama agent doing the same watch task.
- Live counter of **tokens / dollars / latency** on each. The delta is the pitch: fewer tokens, near-zero idle cost, sub-second reaction.

### Proactive workflow extraction

- The same capture stream exports a **compact, noise-filtered activity summary** grouped around user actions, with evidence links.
- Feed only the summary to an analysis model and it can independently name the repeated cross-tab workflow (e.g. "inbound meeting request → research sender → check calendar → reply"), flagging the one step that needs human approval.

### Privacy by construction

- Everything stays local (IndexedDB). The capture layer never exports secrets; the daemon only ever receives already-redacted events. TamaAgent observes and reacts; it does not act on your behalf without an explicit tool call.

---

## Architecture

```
┌──────────────────────────┐      WS       ┌──────────────────────────┐
│  Chrome extension (MV3)   │  redacted     │   Tama daemon (Node)    │
│  CDP network + WS + DOM    │  events       │   TypeScript             │
│  capture + redaction       │ ────────────► │   ws://localhost:8787    │
│  IndexedDB (local only)    │               │   perception + dedup     │
└──────────────────────────┘               └────────────┬─────────────┘
        │                                                │  stdio (MCP)
        │  export: HAR + trace + summary                 ▼
        ▼                                        ┌──────────────────┐
   offline workflow analysis                     │  MCP client       │
                                                 │  (any agent)      │
                                                 │  subscribe()      │
                                                 │  wait_for_event() │
                                                 └──────────────────┘
```

**Contract (frozen):**

```
Extension → daemon (WS):  { id, type, ts, tabId, url, data }              // redacted activity event
Daemon → agent (MCP):     { type, source, ts, from, to, text, evidence }  // resolved semantic event
```

---

## Tech Stack

### Extension (capture)

| Technology | Purpose |
|------------|---------|
| Chrome MV3 | Extension platform |
| `chrome.debugger` / CDP | Network + WebSocket + console with real response bodies |
| Service worker | Orchestration, messaging, export |
| Content script | Clicks, submits, focus, DOM change capture |
| IndexedDB | Local event log + recording state |
| JavaScript (ESM) | Pure, testable `core/` pipeline |

### Daemon + MCP

| Technology | Purpose |
|------------|---------|
| Node.js 18+ | Runtime |
| TypeScript | Type safety |
| `ws` | WebSocket bridge from the extension |
| MCP SDK (stdio) | `subscribe` / `wait_for_event` tools |
| Perception layer (shared) | `event-getter.js`, `intent-hints.js`, site extractors, reused unchanged |

### Demo harness

| Technology | Purpose |
|------------|---------|
| Screenshot-agent baseline | Computer-use polling agent for the comparison |
| Live counter | Tokens / dollars / latency per agent |

---

## Installation & setup

### Prerequisites

- **Node.js 18+** and npm
- **Chrome** (or Arc) with Developer mode

### 1. Load the extension

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open the popup: choose scope (**current window** or **selected tabs**) → **Start**.

Recording attaches Chrome's debugger to in-scope tabs (you will see the yellow "being debugged" banner, unavoidable with CDP) and injects the capture content script.

### 2. Run the daemon + MCP server

```bash
cd daemon
npm install
npm run dev
# WS bridge:  ws://localhost:8787
# MCP:        stdio (add to your MCP client config)
```

### 3. Point an agent at it

Add the Tama MCP server to your MCP client config, then:

```
subscribe({ intent: "new messages", types: ["message.received"] })
wait_for_event({ subId })   // blocks until a DM actually arrives
```

### Offline mode (no daemon, no agent)

Run the perception getter over an exported trace to see exactly what a listener would fire on:

```bash
node tools/get-events.js <trace.json> --intent "new messages" --live
```

`--live` shows only events that arrived *during* the recording window, what a real-time listener would catch.

---

## Project structure

```
ramp-hackathon/
├── manifest.json               # MV3 extension manifest
├── src/
│   ├── core/                   # pure, testable pipeline (no browser APIs)
│   │   ├── schema.js             # event envelope + stable types + id factory
│   │   ├── redact.js             # recursive secret redaction
│   │   ├── normalize.js          # raw CDP/DOM → uniform activity events
│   │   ├── correlate.js          # link evidence to user actions (actionId)
│   │   ├── filter.js             # compact summary: noise filter + grouping
│   │   ├── har.js                # activity events → HAR 1.2
│   │   └── storage.js            # IndexedDB (event log + recording state)
│   ├── background/             # MV3 service worker
│   │   ├── index.js              # orchestration, messaging, export
│   │   ├── cdp.js                # chrome.debugger: Network + WebSocket + console
│   │   └── tabs.js               # tab lifecycle + navigation + scope
│   ├── content/
│   │   └── content-script.js     # DOM capture: clicks, submits, focus, changes
│   ├── perception/             # the event source
│   │   ├── event-getter.js       # raw → resolved semantic events
│   │   ├── filters.js            # API-shaped, non-noise response gate
│   │   ├── intent-hints.js       # NL intent → endpoint keyword hints
│   │   └── extractors/
│   │       └── linkedin.js       # site-specific extraction + entity resolution
│   └── popup/                   # start/stop/scope/clear/export UI
├── daemon/                     # WS bridge + MCP server (live layer)
│   ├── src/
│   │   ├── bridge.ts             # ws://localhost:8787, buffers incoming events
│   │   ├── perceive.ts           # incremental getEvents + dedup by id
│   │   └── server.ts             # MCP stdio: subscribe / wait_for_event
│   └── package.json
├── tools/
│   ├── get-events.js           # run perception over a trace (offline)
│   ├── generate-episodes.js    # synthesize a realistic 3-episode recording
│   └── synth.js
├── test/                       # core pipeline tests (node --test)
├── SCHEMA.md                   # activity trace schema (v1.0.0)
└── README.md
```

---

## MCP tools & data

Semantic event (what the agent receives):

| Field | Meaning |
|-------|---------|
| `type` | `message.received`, `message.sent`, … resolved event type |
| `source` | site the event came from (e.g. `linkedin`) |
| `from` / `to` | resolved identity `{ name, profileId }`, joined in the recorder |
| `text` | the resolved content |
| `ts` | epoch ms |
| `evidence` | raw event ids the semantic event was derived from |

Tools:

| Tool | Signature | Notes |
|------|-----------|-------|
| **subscribe** | `subscribe({ intent, types? })` → `subId` | Natural-language interest; narrows which endpoints are inspected |
| **wait_for_event** | `wait_for_event({ subId })` → semantic event | **Blocks** until a matching event arrives (the reactive primitive) |
| **get_recent_events** | `get_recent_events({ subId })` → event[] | Non-blocking drain of the buffer |

Extension exports (offline analysis):

| File | What it is |
|------|------------|
| `network.har` | HAR 1.2 with workflow metadata (`_tabId`, `_actionId`, pages) |
| `activity-trace.json` | Full chronological event stream (see `SCHEMA.md`) |
| `activity-summary.json` | Compact, noise-filtered timeline grouped around user actions |

---

## The demo

**One laptop. Two windows. A live cost counter on each.**

| | Left: screenshot agent | Right: TamaAgent |
|---|---|---|
| Task | "watch LinkedIn, ping on a new DM" | same task, via MCP |
| Behavior | screenshots every 60s, vision model reads it | `wait_for_event()`, idles |
| Cost | tokens and dollars tick up while it polls | ~0 while idle |
| Latency | up to 60s | < 1s |
| The moment | still polling… | teammate sends a DM live → **event fires instantly** → agent pings |

Spoken generalization (plants the fintech flag without building it): *the same primitive watches a payment clear, an invoice flip to paid, or a chargeback post. No polling, no screenshots.*

---

## Privacy model

- **Never exported**: cookies, `Authorization`, CSRF tokens, sensitive headers, dropped in the capture layer.
- **Redaction layer (built, OFF in this build)**: recursively redacts: JWTs, bearer tokens, cloud/API keys, high-entropy blobs, emails, and sensitive-named values.
- **No input values**: focus/submit record field type and label only, never typed text; password fields are labeled, never read.
- **No full DOM snapshots**: only compact heuristic descriptions (dialog, alert, loading, success/error).
- **Local first**: capture lives in IndexedDB; the daemon only receives already-redacted events over localhost.

---

## Chrome / CDP limitations (honest)

- **One debugger per tab**: if DevTools is open on a tab, TamaAgent can't attach there.
- **The "being debugged" banner** appears on every attached tab, unavoidable with `chrome.debugger`.
- **Restricted pages** (`chrome://`, extension pages, the Web Store) can't be attached or scripted.
- **Response bodies** are captured for textual MIME types under a size cap; binary bodies are not collected.
- **MV3 service worker** can be killed when idle; recording state is persisted and restored on wake.

---

## Tests

```bash
node --test    # redaction + acceptance-workflow pipeline, no browser needed
```

The acceptance test drives the real pipeline with a synthetic cross-tab workflow and asserts redaction holds, tab-switch order is recoverable, correlation links a reply to its POST, noise is filtered, evidence ids resolve, and the HAR is well-formed.

---

## Team

**Built at the Ramp Hackathon (2026).** TamaAgent team (add names / roles).

- Extension + capture layer
- Daemon + perception bridge
- MCP surface
- Demo harness + pitch

---

## License

No `LICENSE` file is present yet. Add one (MIT, Apache-2.0, or hackathon terms) before public distribution.

---

## Acknowledgments

- **Ramp**, **Cursor**, and **Codex** for the hackathon, workshops, and credits.
- Prior art on intent-scoped, entity-resolved capture that shaped the perception layer.
- **Chrome DevTools Protocol** for making real response bodies observable.

---

**Agents shouldn't have to stare at a screen to know something happened. TamaAgent lets the page tell them.**
