# CONTEXT.md — shared orientation for agents

Living notes on what this repo is, how the pieces fit, and what's done vs. next.
**`CONTRACT.md` is the frozen source of truth for activity/semantic shapes and
port `8787`.** This file is the map + build plan. Update it when you land something.

Last updated: 2026-07-18 (branch `feat/ambient-ingest-filter`).

---

## Locked plan (read this)

**Extension = modular integration harness** — not per-site MCP connectors.
**MCP creates listeners**; minimum listen behavior is **open/focus a tab** + ambient capture.
**LinkedIn** = first permissible proof module — stress-tests the funnel, not a product lane.

```
create_listener(intent)
        │
        ▼
daemon: compile {pageUrl, endpoints, label} → WS {kind:"watch"}
        │
        ▼
extension harness: resolve IntegrationModule → open/focus tab
        │
        ▼
ambient capture (fetch/XHR/WS/SSE) → activity events → daemon
        │
        ▼
ingest (Unbrowse-style funnel) → candidates → extract → semantic event
        │
        ▼
wait_for_event(subId)  ← agent wakes
```

Idle path = zero model. Models only at setup / ambiguous extract / workflow propose /
dispatched work. **Never** dump the HAR firehose into an LLM.

---

## What we're building — Tama

Give browser agents **reflexes instead of polling**. An agent (or the user)
describes what to watch; Tama finds the signal in the user's authenticated
browser, runs a **deterministic** listener at zero model cost, and wakes the
agent with entities already resolved.

**Product surface (locked):**

- **Tama MCP** — one local MCP connection any agent taps into.
- **Ambient ingestion** — extension enables listening; firehose filtered hard
  into **candidate endpoints** before anything touches an LLM.
- **Listener catalog grows** from those candidates — not per-site MCP packs.
- **LinkedIn** = first proof module + filter stress-test, not “LinkedIn product.”

```
extension ON (ambient) ──capture──▶ filter funnel ──▶ candidate endpoints (dozens)
                                                          │
                         create_listener(intent) ─────────┤
                                                          ▼
                                              LLM sees ≤30 candidates (optional)
                                                          │
                                                          ▼
                                              compiled listener (pageUrl+endpoints)
                                                          │
                                              idle: deterministic match only
```

---

## Modular integration harness

MCP never opens LinkedIn itself. Daemon sends `watch`; the extension harness
resolves a module and opens/focuses the tab.

**Interface sketch** (`har-recorder/src/integrations/`, thin mirrors in
`daemon/src/integrations/`):

| Piece | Role |
|-------|------|
| `IntegrationModule` | `{ id, matchIntent?, defaultPageUrl, endpointHints[], openTabOnListen }` |
| `linkedin` | **First proof module** — messaging URL + voyager/graphql hints *in module* |
| Generic fallback | `listener.pageUrl` or first endpoint origin |

On `watch` / late `listeners` sync: ensure recording → open or focus `pageUrl` →
badge “listening: {label}”. Same ambient path as user-driven Start.

Two ways in (same capture path):

1. **MCP-driven:** `create_listener` → `{kind:"watch"}` → open/focus + ambient.
2. **User-driven:** popup Start → same ambient listen.

Until ambient is on → no candidates → nothing useful to rank.

---

## Ambient ingest funnel (Unbrowse-style — already in place)

**Do not send the firehose to an LLM.** Mirror Unbrowse
([`unbrowse-ai/unbrowse`](https://github.com/unbrowse-ai/unbrowse)):

| Stage | What | Where |
|-------|------|-------|
| A. Negative space | Drop noise hosts/paths/static/i18n/auth/session | `noise-patterns`, `endpoints.ts` |
| B. API-shaped keep | `/api/`, `graphql`, `voyager`, `/vN/`, JSON mime | `looksLikeApiUrl` + `ingest.ts` |
| C. Plumbing drop | Presence, badges, Lego shells, upsell, connectivity… | Unbrowse noise lists + LinkedIn extras in `ingest.ts` |
| D. Dedupe | `METHOD origin+path` keys | `collectEndpointCandidates` |
| E. Rank (no LLM) | Intent overlap / first-party / WS bonus | `rankEndpointsByIntent` |

**Measured (LinkedIn ~820-event trace):** ~**10% keep**; candidates collapse to
**~4** API surfaces. `npm run test:ingest`.

Setup-time only: `refinePlanWithLLM` may see **≤30** candidate rows — never raw
bodies. Idle: deterministic match on `{ pageUrl, endpoints[], keywords[], label }`.

---

## What LinkedIn teaches us (extreme filtering)

Not “support LinkedIn” — how loud a real SPA is. From `activity-trace-*.json`:

| Bucket | Action |
|--------|--------|
| CDN / media / ads / trackers | DROP |
| SPA document routes as response “URL” | DROP as candidate key |
| Voyager plumbing, shell/upsell, realtime junk | DROP |
| `voyagerMessagingGraphQL`, messaging APIs, `realtime/connect` | KEEP → candidates |

**Capture note:** responses often stamped page URL; prefer **request** URLs for
candidate identity (request-URL stamp fix landed).

---

## Components & status

| Path | Role | Status |
|------|------|--------|
| `daemon/` | Bridge · ingest · catalog · Tama MCP · watch | ✅ Hub + control + Unbrowse ingest |
| `har-recorder/` | Ambient capture + **integration harness** | 🚧 Capture→daemon; harness open-tab next |
| `demo/` | Pet viewer | ✅ |
| ~~`extension/`~~ | WXT | ❌ Deleted |

### Tama MCP tools

| Tool | Behavior |
|------|----------|
| `create_listener` / `subscribe` | NL → shortlist → `{ subId, pageUrl, endpoints, label, keywords }` |
| `list_listeners` | Active + discovered capabilities |
| `wait_for_event` | Blocks (reactive primitive) |
| `get_listener_events` / `get_recent_events` | Drain |
| `remove_listener` | Drop + `unwatch` to extension |
| `propose_workflows` | Heuristic recs → approve via `create_listener` |

---

## Done vs next (this branch)

### Done
- [x] Delete WXT; Tama MCP hub; watch/unwatch control plane
- [x] Unbrowse-inspired noise + LinkedIn-stress ingest (~10% keep)
- [x] Document ambient funnel + “LLM only on shortlist”
- [x] Extract LinkedIn GraphQL / DecoratedEvent DMs + response request-URL stamp
- [x] **Plan locked:** extension = modular harness; LinkedIn first proof module

### Next
- [ ] Harness: `IntegrationModule` + linkedin proof → open/focus tab on `watch`
- [ ] Popup: richer Tama UI (candidates, listeners list)
- [ ] Live E2E: `create_listener` → LinkedIn tab → ambient → `wait_for_event` on DM
- [ ] Second module only when needed (same harness interface)

### Do not build

- Dumping HARs / raw buffers into the LLM
- Per-site MCP “connectors”
- Continuous model over every event
- Second extension / WXT
- Firecracker / off-machine indexing before ambient+filter works

---

## Key facts

- Port **8787** frozen. MCP logs → **stderr**.
- Activity `{ id, type, ts, tabId, url, data }`; semantic `{ type, from, text, evidence[] }`.
- Redaction OFF (MVP) for bodies — filter **volume**, don’t strip signal yet.
- One extension: `har-recorder/`. Modules: `har-recorder/src/integrations/`.

## Run
```bash
cd daemon && npm install && npm run dev
# Load unpacked → har-recorder/  (ambient Start, or let MCP watch open a tab)
open demo/tamagent.html
cd daemon && npm run test:ingest && npm run test:tama && npm run test:control
```

### Manual: MCP → open LinkedIn tab (target proof)
1. Load unpacked `har-recorder/`, daemon `npm run dev`.
2. Agent: `create_listener({ intent: "new LinkedIn messages" })`.
3. Extension receives `{kind:"watch"}`, opens/focuses messaging URL, starts ambient.
4. Agent: `wait_for_event({ subId })` → wakes on extracted DM.
