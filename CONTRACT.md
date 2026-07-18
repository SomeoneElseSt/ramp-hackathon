# Frozen contract

**Do not change these shapes without telling the whole team.** Every lane builds
against this independently, so if it drifts mid-build, integration fails at the
worst possible moment.

## 0. WebSocket roles (read first)

`ws://localhost:8787` now serves **two** roles. On connect, a client sends:

```jsonc
{ "role": "recorder" }   // the extension: pushes raw events IN
{ "role": "viewer" }     // TamaAgent (demo/tamagent.html): receives events OUT
```

The daemon **broadcasts** to every `viewer` using a tagged envelope:

```jsonc
{ "kind": "semantic", "payload": { /* resolved semantic event, see §2 */ } }
{ "kind": "poll",     "payload": { "agent": "baseline" } }   // baseline took a screenshot
{ "kind": "raw",      "payload": { /* raw activity event, see §1 */ } }
```

Viewers never send events. Recorders never receive them.

## 1. Extension → daemon (WebSocket)

Transport: `ws://localhost:8787`, `role: "recorder"`. The extension pushes each
**already-redacted** activity event as it is stored. No batching required.

```jsonc
{
  "id": "e0kf3a1",            // unique, stable within a recording
  "type": "network.response", // stable type, see SCHEMA.md
  "ts": 1700000000123,        // epoch ms
  "tabId": 101,
  "url": "https://…",         // sensitive query params already masked
  "data": { }                 // type-specific payload
}
```

This is the existing activity-event envelope. The extension does **not** change
its schema, it only gains an outbound WS client.

## 2. Daemon → agent (MCP)

The daemon runs the perception layer over the buffered raw events and emits
**resolved semantic events**:

```jsonc
{
  "type": "message.received",   // or message.sent
  "source": "linkedin",
  "ts": 1784341685706,
  "from": { "name": "Raphael Husbands", "profileId": "urn:li:…" },
  "to":   { "name": "You", "profileId": "urn:li:…" },
  "conversationId": "urn:li:msg_conversation:…",
  "text": "Okay",
  "evidence": ["e0kf3a1"]       // raw event ids this was derived from
}
```

Identities are resolved **in the daemon**, not by the agent. That is the point:
the downstream model spends zero tokens working out who sent what.

## 3. MCP tools

| Tool | Signature | Behavior |
|---|---|---|
| `subscribe` | `{ intent: string, types?: string[] }` → `{ subId }` | Registers interest in natural language (`"new messages"`). Narrows which endpoints are inspected. |
| `wait_for_event` | `{ subId }` → semantic event | **Blocks** until the next matching event arrives. This is the reactive primitive. |
| `get_recent_events` | `{ subId }` → event[] | Non-blocking drain of the buffer. |

`wait_for_event` blocking is the entire thesis. It must not poll internally.

## 4. Lanes (who owns what)

| Owner | Files | Never touches |
|---|---|---|
| Extension | `src/background/index.js` (add WS client only) | `daemon/` |
| Bridge + perception | `daemon/src/bridge.ts`, `daemon/src/perceive.ts` | `server.ts` |
| MCP surface | `daemon/src/server.ts` | `bridge.ts`, `perceive.ts` |
| Demo + pitch | `demo/tamagent.html`, `PITCH.md` | `daemon/` |

## 4b. TamaAgent (`demo/tamagent.html`)

Two Tamagotchi-style pets, one per agent, rendered as 1-bit pixel sprites on a
simulated LCD. The left pet belongs to the polling agent, the right is TamaAgent.

**The reframe: energy = tokens.** The energy hearts are the cost counter wearing
a costume. This is what makes the pet an argument instead of a decoration.

| | POLLER (left) | TAMAAGENT (right) |
|---|---|---|
| Idle | screenshots every 60s, **hearts draining** | asleep, **hearts full**, 0 tokens |
| Event arrives | doesn't notice, still grinding | **snaps awake instantly** |
| Next poll tick | finally notices, visibly exhausted, latency shown in red | already pinged |

Pet states, all driven by signals the extension already captures:

| State | Trigger |
|---|---|
| `asleep` | no events. The zero-cost state |
| `alert` | `kind:"semantic"` arrives → instant wake |
| `idle` | healthy traffic, 2-frame breathing animation |
| `alarmed` | `console.error` / 5xx (Layer 3) |
| `drained` | energy < 70%, poller only |

**Build order is non-negotiable:** Layer 1 (sleep + instant wake, real WS) ships
and is committed *before* Layer 2 (energy hearts), which ships before Layer 3
(hunger, XP, network-health mood). A cute pet that reacts to nothing at 3:30 is
worth zero.

Fallback: if the daemon is down, the page self-simulates and shows a loud
`SIM — not real data` badge. **Never demo with that badge showing.**

## 5. Known seam (read this)

`src/perception/event-getter.js` currently runs `getEvents()` over a **finished
trace**. The daemon needs it running **incrementally** over a growing buffer,
emitting only events not already emitted.

`getEvents` already dedups messages by id via its internal `seen` set, so the
daemon can re-run it over the accumulated buffer and diff against an
already-emitted id set. Not elegant, but correct and fast enough for the demo.

This is the riskiest piece of the build. Staff it accordingly.
