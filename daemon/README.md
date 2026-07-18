# Tama daemon

The live layer: WebSocket bridge + organic endpoint discovery + general
perception + **Tama MCP** (single connection any agent taps). Built to
`../CONTRACT.md`. See `../CONTEXT.md` for the build plan.
**Install + LinkedIn DM recipe:** [`../INSTALL.md`](../INSTALL.md).

```
har-recorder  ──WS──▶  bridge.ts ──▶ perceive.ts ──▶ semantic events
     ▲                    │              │
     │  RecorderControl   │              ├─ catalog (discovered capabilities)
     │  watch/unwatch/    │              └─ workflows (recommendations)
     └────────────────────┤
   viewer (demo) ◀────────┘ {kind:semantic|raw|poll}
                                              ▼
                              server.ts — Tama MCP stdio
         create_listener / list_listeners / wait_for_event /
         get_listener_events / remove_listener / propose_workflows
         (+ CONTRACT aliases: subscribe, get_recent_events)
```

## What it does

- **bridge.ts** — `ws://localhost:8787`, `recorder`/`viewer` roles (CONTRACT §0/§1).
  Viewers get `{semantic|raw|poll}`. Recorders additionally get
  `{watch|unwatch|listeners}` so the extension can open `pageUrl` and watch endpoints.
- **endpoints.ts** + **catalog.ts** — Unbrowse-style noise filter; API-shaped
  candidates become listenable capabilities as the user browses.
- **perceive.ts** — incremental perception, listener hub, discovery every N events;
  emits watch/unwatch for the bridge. Listeners watermark at arm (`sinceTs`) —
  event-forward only, not a history scrape.
- **extract.ts** — site-agnostic message extraction (+ budgeted OpenAI fallback).
- **intent.ts** — NL → keywords; setup-time OpenAI refine against captured candidates.
- **workflows.ts** — heuristic workflow / listener recommendations.
- **server.ts** — Tama MCP tools (CONTRACT shapes preserved). `create_listener`
  returns `{ subId, pageUrl, endpoints, keywords, label, … }`.

## Run

```bash
cd daemon
npm install
npm run dev            # WS bridge on ws://localhost:8787 + MCP over stdio
```

When Cursor/Codex launches this via MCP config, **that same process** owns `:8787`.
**NEVER** run `npm run dev` / ops-listen in parallel while MCP tama is enabled — exclusive ownership.
Startup order is bridge-listen-first, then MCP connect (no half-state on EADDRINUSE).

`OPENAI_API_KEY` (repo-root `.env`) enables the model-assisted extraction
fallback. Without it, the deterministic heuristic path still works.

## Test (no browser needed)

```bash
npm run test:recorder   # fake recorder + viewer: perception + dedup
npm run test:mcp        # CONTRACT subscribe + blocking wait_for_event
npm run test:tama       # Tama hub: discovery → list → create → wait → remove
npm run test:control    # daemon → recorder watch/unwatch/listeners push
```

## MCP config (Cursor + Codex)

Replace `/ABS/PATH/to/ramp-hackathon` with your absolute clone path.

### Cursor (`.cursor/mcp.json` or Settings → MCP)

```json
{
  "mcpServers": {
    "tama": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/ABS/PATH/to/ramp-hackathon/daemon"
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.tama]
command = "npx"
args = ["tsx", "src/index.ts"]
cwd = "/ABS/PATH/to/ramp-hackathon/daemon"
tool_timeout_sec = 3600
startup_timeout_sec = 20
enabled = true
```

`tool_timeout_sec` must be high: `wait_for_event` blocks until a real DM.
Codex’s default (~60s) will abort the wait early.

## Use from an agent (LinkedIn DM)

```
list_listeners()
create_listener({ intent: "new LinkedIn messages" })  → { subId, pageUrl, … }
wait_for_event({ subId })   // blocks; returns semantic event; re-call to wait again
remove_listener({ subId })
```

Resolved semantic event shape (CONTRACT §2):

```json
{
  "type": "message.received",
  "source": "linkedin",
  "ts": 1784341685706,
  "from": { "name": "…", "profileId": "…" },
  "to":   { "name": "You", "profileId": "…" },
  "conversationId": "urn:li:msg_conversation:…",
  "text": "Okay",
  "evidence": ["e0kf3a1"]
}
```

**Latency:** usually sub-second after LinkedIn’s response reaches the extension.
Keep ambient **Sit** on messaging; send a **new** DM after arming (watermark
ignores history). Do not cancel `wait_for_event` while waiting.

Copy-paste Codex prompt + troubleshooting: [`../INSTALL.md`](../INSTALL.md).
