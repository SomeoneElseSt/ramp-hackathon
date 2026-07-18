# CONTEXT.md — shared orientation for agents

Living notes on what this repo is, how the pieces fit, and what's done vs. next.
**`CONTRACT.md` is the frozen source of truth for activity/semantic shapes and
port `8787`.** This file is the map + build plan. Update it when you land something.

Last updated: 2026-07-18.

---

## What we're building — Tama

Give browser agents **reflexes instead of polling**. An agent (or the user)
describes what to watch; Tama finds the signal in the user's authenticated
browser, runs a **deterministic** listener at zero model cost, and wakes the
agent with entities already resolved.

**Product surface (locked):**

- **Tama MCP** — one local MCP connection any agent taps into.
- **Listener catalog grows organically** from captured traffic — not per-site
  connector packs.
- **Same extension** (`har-recorder/`) captures, discovers, and will show
  “Tama is watching this tab” + open the right page when MCP creates a listener.
- **LinkedIn** = first proof site for the demo, not a product lane.

Idle path = zero model. Models only at setup / ambiguous extract / workflow
propose / dispatched work.

```
agent ──Tama MCP──▶ daemon (listeners + perception)
                         │
                         │ RecorderControl: watch / unwatch / listeners
                         ▼
                   har-recorder (open pageUrl, watch endpoints, stream traffic)
                         │
                         │ role:recorder activity events (CONTRACT §1)
                         ▼
                   daemon perceives → semantic → wait_for_event unblocks
                         +
                   viewers get {kind:semantic|raw|poll} (demo pet)
```

---

## Components & status

| Path | Role | Status |
|------|------|--------|
| `daemon/` | WS bridge · perception · catalog · **Tama MCP** | ✅ Hub shipped (`test:tama`) |
| `har-recorder/` | Only extension — capture + stream to daemon | ✅ Capture→daemon; 🚧 Tama UI + watch control |
| `demo/` | Poller vs Tama pet viewer | ✅ Exists |
| ~~`extension/`~~ | WXT | ❌ Deleted — do not revive |

---

## Tama MCP — shipped tools (spec)

Single connection. Name in server: `tama`. CONTRACT aliases kept.

| Tool | In | Out | Behavior |
|------|----|-----|----------|
| `create_listener` / `subscribe` | `{ intent, types?, pageUrl? }` | `{ subId, pageUrl, endpoints, label, keywords }` | Compile listener from NL + discovered traffic. **Must carry page + endpoints** so the extension knows where to go and what to watch. |
| `list_listeners` | `{}` | `{ active[], capabilities[] }` | Active watches + organically discovered capabilities. |
| `wait_for_event` | `{ subId }` | semantic event | **Blocks** — the reactive primitive. No internal poll. |
| `get_listener_events` / `get_recent_events` | `{ subId }` | event[] | Non-blocking drain. |
| `remove_listener` | `{ subId }` | `{ removed }` | Drop watch; notify extension `unwatch`. |
| `propose_workflows` | `{ limit? }` | recommendations[] | Heuristic suggestions; approve → `create_listener`. |

### Listener context (additive on Subscription — locking this next)

Every active listener **must** expose enough for the extension to act:

```jsonc
{
  "subId": "sub_…",
  "intent": "new LinkedIn messages",
  "types": ["message.received"],
  "keywords": ["messag", "voyager", "inbox", …],
  "pageUrl": "https://www.linkedin.com/messaging/",   // open / focus this
  "endpoints": [                                        // watch these surfaces
    "GET https://www.linkedin.com/voyager/api/messaging/conversations"
  ],
  "label": "New message"
}
```

- `pageUrl` — inferred from matching candidates/catalog, or passed by the agent.
- `endpoints` — concrete URL/path templates from organic discovery that matched
  the intent (not raw telemetry).
- Infer at **setup** only (deterministic + optional OpenAI refine). Idle path
  only matches keywords/endpoints already stored.

Types live in `daemon/src/types.ts` (`Subscription`, `ListenerWatch`,
`RecorderControl`). Wire-through in `perceive` / `bridge` / extension is the
**next backend lock-in**.

---

## Next build — lock in (daemon ↔ extension control plane)

**Goal:** MCP `create_listener` triggers the extension to open the right tab and
stream the right traffic; popup says Tama is watching.

### A. Daemon → recorder control (additive; viewers unchanged)

CONTRACT §0 still: viewers receive `{semantic|raw|poll}` only.

**New:** daemon may push to **recorder** sockets only:

```jsonc
{ "kind": "watch",     "payload": { /* ListenerWatch */ } }
{ "kind": "unwatch",   "payload": { "subId": "…" } }
{ "kind": "listeners", "payload": { "active": [ /* ListenerWatch[] */ ] } }
```

On `create_listener` → emit `watch` + full `listeners` sync.  
On `remove_listener` → emit `unwatch` + sync.  
On recorder connect → send current `listeners` snapshot.

### B. Extension (`har-recorder`) on `watch`

1. Store active listeners in SW memory / `chrome.storage`.
2. If `pageUrl` set: focus existing tab with matching origin, else `tabs.create`.
3. Start (or keep) capture scoped to that tab/window — debugger-free interceptor
   already streams to daemon.
4. Popup: **“Tama is watching this tab”** + list active listeners
   (label, pageUrl, endpoints). Rebrand off “Workflow Recorder”; kill the
   outdated debugger-banner copy.

### C. Streaming (already mostly done)

- Extension → daemon: activity events as today (`role: "recorder"`).
- Daemon → perception → semantic → MCP waiters + viewer `kind:"semantic"`.
- Narrow ingest with listener `keywords` / `endpoints` (deterministic).

### D. Proof

1. Load har-recorder, daemon running.
2. Agent: `create_listener({ intent: "new messages", pageUrl?: "https://www.linkedin.com/messaging/" })`.
3. Extension opens/focuses messaging, status shows watching + endpoints.
4. Real or fixture DM → `wait_for_event` returns resolved semantic; demo pet wakes.

---

## Plan checklist

### Done
- [x] Delete WXT `extension/`
- [x] Tama MCP hub tools + organic catalog (`test:tama`)
- [x] Unbrowse-style noise filter / endpoint candidates
- [x] `propose_workflows` MCP path
- [x] Document listener context + RecorderControl in this file

### Next (us — backend + extension UX)
- [x] Finish `Subscription` fields (`pageUrl`, `endpoints`, `label`) end-to-end in perceive/MCP return
- [x] Bridge: track recorders; push `watch` / `unwatch` / `listeners` (`test:control`)
- [ ] Extension: handle control msgs; open/focus `pageUrl`; start watch scope
- [ ] Popup: Tama branding + “watching this tab” + listener list
- [ ] Live LinkedIn (or fixture) E2E with open-tab path

### Later
- [ ] Pet overlay on page (not just popup)
- [ ] Background-tab realtime stream tee (LinkedIn RSC) for away-from-tab notifies

### Do not build
- Per-site MCP connectors · second extension · continuous model on every event ·
  Firecracker indexing · DB/deploy · autonomous sends

---

## Key facts / gotchas

- **Port `8787` frozen** (CONTRACT §0).
- **Activity envelope** `{ id, type, ts, tabId, url, data }` — bodies at
  `data.content.text` or `data.payload`.
- **Semantic** `{ type, source, ts, from, text, evidence[] }`.
- **Redaction OFF (MVP)** — full bodies for perception.
- **MCP logs → stderr** only.
- **One extension:** `har-recorder/` only.

## Run
```bash
cd daemon && npm install && npm run dev
# Load unpacked → har-recorder/
open demo/tamagent.html   # LIVE, not SIM
cd daemon && npm run test:tama
```
