# Install + use — LinkedIn DM wake (Tama)

Practical path: load **har-recorder v0.4.2**, run the daemon, point **Codex or Cursor** at Tama MCP, then block on `wait_for_event` until the next LinkedIn DM.

Prod = latest `master` (tag `v0.4.2` matches `har-recorder/manifest.json`). Fuller architecture: [`README.md`](./README.md), [`CONTEXT.md`](./CONTEXT.md). Daemon details: [`daemon/README.md`](./daemon/README.md).

---

## Prerequisites

| Need | Notes |
|---|---|
| **Node.js 18+** and npm | For the daemon / MCP process |
| **Chrome or Arc** | Developer mode for unpacked extensions |
| **LinkedIn logged in** | Same browser profile where you load the extension |
| **Repo on disk** | Absolute path required in MCP `cwd` |

Optional: repo-root `.env` with `OPENAI_API_KEY` (deterministic extract still works without it).

---

## 1. Install

```bash
git clone https://github.com/SomeoneElseSt/ramp-hackathon.git
cd ramp-hackathon
# or: git pull --rebase origin master

cd daemon
npm install
```

### Extension (unpacked **har-recorder** v0.4.2)

1. Open `chrome://extensions` (or `arc://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select the repo’s **`har-recorder/`** folder  
   (not the repo root, not any other recorder folder).
4. Confirm the card shows **Tama** version **0.4.2**. If already loaded: **Reload**.
5. Open the Tama popup → status should move toward **Daemon live** once the MCP/daemon process is up. Click **Sit on this window** on a LinkedIn tab (or let `create_listener` open messaging).

### Start the daemon (two valid modes)

**A — Agent drives it (usual):** Cursor/Codex starts `daemon/` via MCP config below. That process binds `ws://localhost:8787` *and* speaks MCP on stdio. Do **not** also run `npm run dev` in another terminal (port conflict).

**B — Manual / demo:** keep a bridge up without an agent:

```bash
cd daemon && npm run dev   # WS on :8787; MCP stdio idle until a client attaches
```

Popup should read **Daemon live**. Watched tabs show a soft “Tama is listening” overlay (v0.4.2+).

---

## 2. MCP config

Replace `/ABS/PATH/to/ramp-hackathon` with your real absolute path.

### Cursor

Cursor Settings → MCP, or project `.cursor/mcp.json`:

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

Restart Cursor (or reload MCP) after editing. Confirm tools: `create_listener`, `wait_for_event`, `list_listeners`, …

### Codex (CLI / IDE / ChatGPT desktop Codex host)

Edit `~/.codex/config.toml` (or trusted project `.codex/config.toml`):

```toml
[mcp_servers.tama]
command = "npx"
args = ["tsx", "src/index.ts"]
cwd = "/ABS/PATH/to/ramp-hackathon/daemon"
# wait_for_event blocks until a real DM — raise far above the 60s default
tool_timeout_sec = 3600
startup_timeout_sec = 20
enabled = true
```

Or:

```bash
codex mcp add tama -- npx tsx src/index.ts
# then edit config.toml to set cwd=…/daemon and tool_timeout_sec=3600
```

Restart Codex / run `/mcp` in the TUI and confirm **tama** is listed.

---

## 3. Use recipe — Codex listens for LinkedIn DMs

### Checklist before the prompt

1. LinkedIn logged in (same browser as the extension).
2. Daemon live (popup) — MCP started or `npm run dev`.
3. Prefer LinkedIn **Messaging** open; ambient **Sit** on, or let the listener open the tab.
4. You will send / receive a **new** DM *after* arming the listener (history does not wake).

### What the tools do

```
create_listener({ intent: "new LinkedIn messages" })
  → { subId, pageUrl, endpoints, keywords, label, … }
  → extension gets {kind:"watch"}, opens/attaches messaging, starts ambient

wait_for_event({ subId })
  → BLOCKS until the next matching semantic event (does not poll)
  → returns the payload below; listener stays armed — call again to wait again
```

### Semantic payload (what you get back)

```json
{
  "type": "message.received",
  "source": "linkedin",
  "ts": 1784341685706,
  "from": { "name": "Raphael Husbands", "profileId": "urn:li:…" },
  "to":   { "name": "You", "profileId": "urn:li:…" },
  "conversationId": "urn:li:msg_conversation:…",
  "text": "Okay",
  "evidence": ["e0kf3a1"]
}
```

### Latency expectations + tips

| Expectation | Detail |
|---|---|
| Wake latency | Usually **sub-second** after LinkedIn’s network response hits the extension → daemon extract → MCP unblock |
| Not history | Listeners watermark at `create_listener` (`sinceTs`). Old thread messages never wake `wait_for_event` |
| Ambient | Keep **Sit** / ambient on the messaging surface; watched tab can stay in the background |
| Don’t interrupt | Leave `wait_for_event` running — canceling the tool call drops the wait (listener may still exist) |
| Timeout | Codex default tool timeout is **60s** — set `tool_timeout_sec = 3600` (above) or the wait dies early |
| One bridge | Only one process should own `:8787` |

### Paste this into Codex

```
Use the tama MCP tools only (no screenshots, no polling LinkedIn).

1. Call create_listener with intent exactly: "new LinkedIn messages"
2. Read subId from the result. Confirm pageUrl looks like linkedin.com/messaging.
3. Immediately call wait_for_event with that subId.
4. Do not cancel, retry, or call other tools while waiting. Block until it returns.
5. When it returns, reply with the sender name and message text from the semantic event (type, from.name, text). Then call wait_for_event again on the same subId if I want continuous listening.

I will send a NEW LinkedIn DM after you start waiting. Old messages in the thread must be ignored.
```

After you paste: send a **new** LinkedIn DM (from another account or have someone message you). Codex should unblock ASAP with the semantic payload.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Popup **Daemon offline** / nothing on 8787 | Start MCP (open a Codex/Cursor session that loads tama) or `cd daemon && npm run dev`. Check nothing else binds `8787` (`lsof -i :8787`). |
| Extension not streaming | Reload unpacked extension; confirm version **0.4.2**; popup **Daemon live**; Sit on messaging or re-run `create_listener`. |
| Wrong unpacked path | Must be repo **`har-recorder/`**. Do not load an old `workflow-recorder` / other clone folder — wrong tree = no watch overlay / stale behavior. |
| `wait_for_event` errors / ends ~60s | Raise Codex `tool_timeout_sec` (see config). Cursor: ensure long-running MCP tools are allowed. |
| Wakes on old Hi/Sup / never on new DM | Re-`create_listener` *then* send a **new** message. Watermark ignores `ts` before arm. Stay on messaging with ambient on. |
| `create_listener` missing pageUrl | Pull latest master; LinkedIn defaults ship messaging URL + voyager hints cold. |
| Port conflict / flaky WS | Kill duplicate daemon (`npm run dev` + MCP both started). One process only. |
| MCP tools missing | Absolute `cwd` to `…/daemon`; `npx tsx src/index.ts`; restart client; Codex: `/mcp` or `codex mcp list`. |

---

## Quick verify (no LinkedIn needed)

```bash
cd daemon
npm run test:tama      # create_listener → wait_for_event on a fake DM
npm run test:control   # watch/unwatch pushed to a fake recorder
```
