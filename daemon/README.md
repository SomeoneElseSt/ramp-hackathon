# reflex daemon

The live layer: a WebSocket bridge + general perception + the reactive MCP
surface. Built to the frozen `../CONTRACT.md`.

```
recorder (extension)  ──WS──▶  bridge.ts ──▶ perceive.ts ──▶ semantic events
                                  │                              │
   viewer (demo/tamagent.html) ◀──┘ {kind:semantic|raw|poll}     │
                                                                 ▼
                                              server.ts (MCP stdio)
                                     subscribe / wait_for_event / get_recent_events
```

## What it does

- **bridge.ts** — `ws://localhost:8787`, `recorder`/`viewer` roles (CONTRACT §0/§1).
  Recorders push redacted activity events in; the daemon broadcasts
  `{kind:"semantic"|"raw"|"poll"}` to viewers. Emits a baseline `poll` tick for
  the side-by-side demo.
- **perceive.ts** — incremental perception over the growing buffer (CONTRACT §5).
  Dedups semantic events by a stable key; drives both the viewer broadcast and
  the MCP blocking primitive.
- **extract.ts** — **general, site-agnostic** message extraction. Walks any JSON
  body for message-shaped containers (id/sender + text in the subtree), learns
  and resolves identities, and falls back to a budgeted model pass to index
  unfamiliar shapes. No per-site code.
- **intent.ts** — natural-language intent → endpoint keywords + event types, so
  `"new messages"` narrows to messaging endpoints on any site.
- **server.ts** — MCP stdio tools (CONTRACT §3): `subscribe`, `wait_for_event`
  (blocks on a real event — the reactive primitive), `get_recent_events`.

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
npm run test:recorder            # fake recorder + viewer: proves general perception + dedup
npx tsx test/mcp-client.ts       # spawns daemon over MCP, proves blocking wait_for_event
```

## Use from an MCP client

Add to your MCP client config (e.g. Codex / Claude), then `subscribe` +
`wait_for_event`:

```jsonc
{
  "mcpServers": {
    "reflex": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/ramp-hackathon/daemon"
    }
  }
}
```

```
subscribe({ intent: "new messages" })      → { subId }
wait_for_event({ subId })                   // blocks until a DM actually arrives
```
