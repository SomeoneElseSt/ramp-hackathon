# AGENTS.md — working context for TamaAgent

Read this first. It's the working context for any agent or teammate picking up
this repo. We build **one after the other on `master`** — sync, do a focused
piece, push.

For the living status map and **plan to build**, see [`CONTEXT.md`](./CONTEXT.md).

## Mission

Agents can *use* the web but the web can't *call them back*. **Tama MCP** is a
single local MCP connection: the agent describes what to watch, the
**har-recorder** extension discovers the signal organically, a deterministic
listener runs at zero model cost, and the agent wakes on a resolved semantic
event. Over time the same observation stream recommends workflows worth listening
for.

> First, agents subscribe to the web instead of polling it. Then, by learning how
> the user works, Tama suggests what to watch next.

No per-site “connectors.” LinkedIn is a proof site, not a product lane.
Everything is local. Secrets never reach the model on the idle path.

## The frozen contract — do not drift

[`CONTRACT.md`](./CONTRACT.md) is frozen. Essentials:

- **Extension → daemon** (WS `ws://localhost:8787`): activity event envelope (§1).
- **Daemon → agent** (MCP): resolved semantic events (§2).
- **MCP tools** (§3): `subscribe` / `wait_for_event` / `get_recent_events` —
  evolving into Tama hub aliases (`create_listener`, `list_listeners`, …) without
  breaking these shapes.

## Architecture

```
browser (authenticated tab)
  └─ har-recorder ── capture + organic discovery + workflow hints
       │  WS: activity events (CONTRACT §1)
       ▼
  daemon/  bridge → perceive → extract (site-agnostic)
       │      · listener catalog grows from discovered sources
       │      · broadcasts {semantic|raw|poll} to viewers
       ▼
  Tama MCP (server.ts) ── one connection for any agent
       ▼
  Codex / agents  ── sleep on wait_for_event, wake on the real event
```

## Repo layout

| Path | What it is | State |
|---|---|---|
| `har-recorder/` | **The only extension** — capture, stream to daemon, discovery helpers | **build here** |
| `daemon/` | Bridge · perceive · extract · intent · Tama MCP | built; evolving listener hub |
| `demo/` | `tamagent.html`, `pet-widget.html` | demo lane |
| `CONTEXT.md` | Status + **plan to build** | update when you land work |
| `CONTRACT.md` `PITCH.md` `README.md` | frozen interface · pitch · overview | — |

**WXT `extension/` is deleted.** Do not recreate it.

## Run it

**Install + Codex LinkedIn DM recipe:** [`INSTALL.md`](./INSTALL.md).

```bash
cd daemon && npm install && npm run dev
# Load unpacked: har-recorder/ (v0.4.3+)
open demo/tamagent.html
```

## Rules

- `git pull --rebase origin master` → focused change → `git push origin master`.
- Never clobber a teammate's lane (`CONTRACT.md` §4).
- Don't change `CONTRACT.md` shapes without telling the team.
- Models only at setup / ambiguous extract / workflow propose / dispatched work —
  never continuous over every browser event.
- Consequential actions require user approval.
