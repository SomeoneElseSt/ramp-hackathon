# har-recorder (Tama extension)

MV3 extension shipped as **Tama** (`manifest.json` version **0.4.2**). Captures
cross-tab activity, streams redacted events to the local daemon
(`ws://localhost:8787`), and obeys `{watch|unwatch|listeners}` from MCP-driven
`create_listener`. Also exports HAR / activity traces for offline inspection.

**Install + LinkedIn DM wake:** [`../INSTALL.md`](../INSTALL.md).

## What it captures (debugger-free)

Network **bodies** + realtime frames via **in-page interception** of
`fetch` / `XHR` / `WebSocket` / `EventSource` (MAIN-world content script) — **no
`chrome.debugger`, no "being debugged" banner** — plus DOM interactions (clicks,
submits, focus), tab lifecycle, and navigation. Secrets (cookies, auth, CSRF,
tokens, emails) are redacted before anything is stored.

## Exports

From the popup:
- `network.har` — standards HAR 1.2 (+ tab/action metadata)
- `activity-trace.json` — full chronological event stream
- `activity-summary.json` — compact, noise-filtered, evidence-linked timeline

## Load it

`chrome://extensions` (or `arc://extensions`) → **Developer mode** → **Load
unpacked** → this **`har-recorder/`** folder (not the repo root). Confirm
version **0.4.2**. Open the popup → **Sit on this window** with the daemon up
(Daemon live). Developer export (HAR / traces) is under the popup’s Developer
section.

## Layout

- `manifest.json` — MV3, permissions: `tabs, storage, downloads, scripting, webNavigation, alarms` (no `debugger`)
- `src/background/` — service worker, WS to daemon, watch/ambient control
- `src/content/` — `interceptor.js` (MAIN-world network capture), `relay.js`, `content-script.js`, listening overlay
- `src/core/` — pure pipeline: normalize · redact · correlate · filter · har · schema · storage
- `src/integrations/` — modular site harness (LinkedIn proof first)
- `src/popup/` — Tama ambient pet UI + Sit / daemon status

Streams to `ws://localhost:8787` when the daemon is up; drops quietly when it isn't.
