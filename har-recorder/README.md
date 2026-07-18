# har-recorder

Standalone MV3 recorder extension — captures cross-tab activity and exports it.
Useful for **inspecting the firehose** a site emits (LinkedIn alone throws
~1000+ requests + hundreds of console errors per session) while we design what
the daemon should actually listen for. No daemon/MCP wiring here — it just
records and exports.

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
unpacked** → this `har-recorder/` folder. Open the popup, pick scope, Record,
work, Export.

## Layout

- `manifest.json` — MV3, permissions: `tabs, storage, downloads, scripting, webNavigation` (no `debugger`)
- `src/background/` — service worker + tab tracker
- `src/content/` — `interceptor.js` (MAIN-world network capture), `relay.js`, `content-script.js` (DOM)
- `src/core/` — pure pipeline: normalize · redact · correlate · filter · har · schema · storage
- `src/popup/` — record / scope / export UI

> Note: `src/background/index.js` also streams events to a local host if one is
> running; harmless (drops) when it isn't. That wiring belongs to the daemon
> lane, not this recorder.
