# CONTEXT.md — shared orientation for agents

Living notes on what this repo is, how the pieces fit, and what's done vs. next.
**`CONTRACT.md` is the frozen source of truth for activity/semantic shapes and
port `8787`.** This file is the map + build plan. Update it when you land something.

Last updated: 2026-07-18 (branch `feat/ambient-ingest-filter`).

---

## What we're building — Tama

Give browser agents **reflexes instead of polling**. An agent (or the user)
describes what to watch; Tama finds the signal in the user's authenticated
browser, runs a **deterministic** listener at zero model cost, and wakes the
agent with entities already resolved.

**Product surface (locked):**

- **Tama MCP** — one local MCP connection any agent taps into.
- **Ambient ingestion** — extension enables listening; firehose is filtered hard
  into **candidate endpoints** before anything touches an LLM.
- **Listener catalog grows** from those candidates — not per-site MCP packs.
- **LinkedIn** = first proof site + filter stress-test, not “LinkedIn product code.”

Idle path = zero model. Models only at **setup** (short candidate list), ambiguous
extract, workflow propose, dispatched work. **Never** dump thousands of raw HAR
events into the LLM.

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

## Ambient ingestion pipeline (the real product seam)

LinkedIn “fixes” don’t matter if we can’t **pull** signal from ambient traffic.
The pipeline is site-agnostic; LinkedIn teaches us how extreme the filter must be.

### 1. Extension enables ambient listen (required)

Capture is **not** “export a HAR later.” User/agent turns Tama on → interceptor
patches fetch/XHR/WS/SSE on in-scope tabs → streams activity events to
`ws://localhost:8787` as `role: "recorder"`.

Two ways to open/watch a page (same capture path):

1. **MCP-driven:** `create_listener` → daemon `{kind:"watch"}` → extension
   open/focus `pageUrl` + start ambient on that tab.
2. **User-driven:** popup Start / “Watch this capability” → same ambient listen.

Until ambient is on, there are **no** candidate endpoints → LLM has nothing
useful to rank.

### 2. Brutal filter funnel (deterministic — Unbrowse-inspired)

**Do not send the firehose to an LLM.** Mirror Unbrowse’s approach
([`unbrowse-ai/unbrowse`](https://github.com/unbrowse-ai/unbrowse)):

| Stage | What | Source of truth in our repo |
|-------|------|-----------------------------|
| A. Negative space | Drop noise hosts/paths/static/i18n/auth/session plumbing | `har-recorder/.../noise-patterns.js`, `daemon/src/endpoints.ts`, Unbrowse `src/lib/ranking-core/filters/noise-patterns.ts` |
| B. API-shaped keep | `/api/`, `graphql`, `voyager`, `/vN/`, `api.*` hosts, JSON mime | Unbrowse `isReplayableApiUrl`; our `looksLikeApiUrl` + `ingest.ts` |
| C. Plumbing drop | Presence, badges, Lego shells, premium upsell, connectivity tracking… | Unbrowse `CAPTURE_RESPONSE_NOISE` / `SESSION_PLUMBING`; our LinkedIn-tuned extras in `ingest.ts` |
| D. Dedupe | Collapse to `METHOD origin+path` keys | `collectEndpointCandidates` |
| E. Rank (no LLM) | Intent token overlap / first-party / WS bonus | `rankEndpointsByIntent` (har-recorder); Unbrowse `rankEndpoints` BM25+signals |

**Measured on a real LinkedIn activity-trace (~820 events):** ~**10% keep** into
the daemon buffer; endpoint candidates collapse to **~4** API surfaces
(e.g. `voyagerMessagingGraphQL`, `voyager/api/graphql`, `realtime/connect`).
`npm run test:ingest`.

### 3. LLM only on the shortlist (setup-time)

`refinePlanWithLLM` / create_listener may see **≤30** candidate rows
(`method`, `path`, `count`, `kinds`) — never raw bodies, never 4k events.
If no API key → deterministic keywords only.

### 4. Compiled listener + idle

Stored: `{ pageUrl, endpoints[], keywords[], label }`. Idle matching is
deterministic. Extension shows “Tama is watching this tab.”

---

## What LinkedIn teaches us (extreme filtering checklist)

From `~/Downloads/activity-trace-*.json` — not “support LinkedIn,” but **how
loud a real SPA is**:

| Bucket | Examples | Action |
|--------|----------|--------|
| CDN / media | `static.licdn.com`, `media.licdn.com` | DROP always |
| Ads / trackers | `px.ads.linkedin`, `adtrafficquality`, gtag | DROP |
| SPA document routes | `/messaging/thread/…` as “URL” on JSON responses | DROP as candidate key; keep body only if messaging-shaped (capture bug) |
| Google chrome-in-session | `google.com/search`, `gen_204` | DROP |
| Voyager plumbing | Badge, SecondaryInbox, Nudges, presenceStatuses, AwayStatus, SeenReceipts, QuickReplies, MailboxCounts, DeliveryAcks, AffiliatedMailboxes | DROP |
| Shell / upsell | LegoDashPageContents, MySettings, PremiumDash*, Onboarding, GlobalAlerts | DROP |
| Realtime junk | ClientConnectivityTracking, FrontendSubscriptions, FrontendTimestamp | DROP |
| Keep for messages | `voyagerMessagingGraphQL` (`messengerMessages`, `messengerConversations`), `/voyager/api/messaging/…`, `realtime/connect` | KEEP → candidates |

**Capture bug (separate fix):** responses often stamp the **page** URL instead of
the voyager URL; **requests** still have the real API URL. Ambient pipeline must
prefer request URLs for candidate identity.

---

## Components & status

| Path | Role | Status |
|------|------|--------|
| `daemon/` | Bridge · ingest gate · catalog · Tama MCP · watch control | ✅ Hub + control + ingest (`test:tama`, `test:control`, `test:ingest`) |
| `har-recorder/` | Ambient capture + stream; must enable listen + Tama UI | 🚧 Capture→daemon works; ambient UX + watch handler next |
| `demo/` | Pet viewer | ✅ |
| ~~`extension/`~~ | WXT | ❌ Deleted |

### Daemon pieces

- `ingest.ts` — always-on gate (LinkedIn-stress-tested funnel).
- `endpoints.ts` / `noise-patterns` — Unbrowse-style negative space + API keep.
- `bridge.ts` — recorders get `{watch\|unwatch\|listeners}`; ingest before perceive.
- `perceive.ts` / `server.ts` — listener hub; LLM refine on shortlist only.

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

## Next build (this branch’s north star)

1. **Extension ambient ON** — Start = enable candidate listening (always streaming
   while on); popup: Tama branding + “watching” + candidate/listener list.
2. **Watch handler** — on daemon `watch`, open/focus `pageUrl`, scope capture.
3. **Funnel hardening** — keep collapsing firehose → ≤ dozens of candidates;
   never widen what the LLM sees.
4. **Interceptor URL fix** — responses must carry the request URL (unblocks
   LinkedIn pull quality).
5. **Proof** — ambient on LinkedIn messaging → candidates appear in
   `list_listeners` → `create_listener` → wait_for_event on real DM.

### Do not build

- Dumping HARs / raw buffers into the LLM  
- Per-site MCP “connectors”  
- Continuous model over every event  
- Second extension / WXT  
- Firecracker / off-machine indexing before ambient+filter works  

---

## Plan checklist

### Done
- [x] Delete WXT; Tama MCP hub; watch/unwatch control plane
- [x] Unbrowse-inspired noise + LinkedIn-stress ingest (~10% keep)
- [x] Document ambient funnel + “LLM only on shortlist” (this file)

### Next
- [ ] Extension: ambient listen ON + handle `watch` / open `pageUrl`
- [ ] Popup: Tama UI (“watching this tab”, candidates, listeners)
- [ ] Interceptor: fix response URL = request URL
- [ ] Live LinkedIn E2E with ambient → candidates → listener → wake

---

## Key facts

- Port **8787** frozen. MCP logs → **stderr**.
- Activity `{ id, type, ts, tabId, url, data }`; semantic `{ type, from, text, evidence[] }`.
- Redaction OFF (MVP) for bodies — filter **volume**, don’t strip signal yet.
- One extension: `har-recorder/`.

## Run
```bash
cd daemon && npm install && npm run dev
# Load unpacked → har-recorder/  (ambient Start)
open demo/tamagent.html
cd daemon && npm run test:ingest && npm run test:tama && npm run test:control
```
