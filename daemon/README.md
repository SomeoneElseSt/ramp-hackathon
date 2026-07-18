# Tama daemon

The live layer: WebSocket bridge + organic endpoint discovery + general
perception + **Tama MCP** (single connection any agent taps). Built to
`../CONTRACT.md`. See `../CONTEXT.md` for the build plan.

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
  emits watch/unwatch for the bridge.
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

`OPENAI_API_KEY` (repo-root `.env`) enables the model-assisted extraction
fallback. Without it, the deterministic heuristic path still works.

## Test (no browser needed)

```bash
npm run test:recorder   # fake recorder + viewer: perception + dedup
npm run test:mcp        # CONTRACT subscribe + blocking wait_for_event
npm run test:tama       # Tama hub: discovery → list → create → wait → remove
npm run test:control    # daemon → recorder watch/unwatch/listeners push
```

## Use from an MCP client

```jsonc
{
  "mcpServers": {
    "tama": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/ramp-hackathon/daemon"
    }
  }
}
```

```
list_listeners()                              → { active, capabilities }
create_listener({ intent: "new messages" })   → { subId }
wait_for_event({ subId })                     // blocks until a real event
propose_workflows()                           → recommendations
remove_listener({ subId })
```
