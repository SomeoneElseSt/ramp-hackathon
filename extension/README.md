# reflex — extension

The browser **sensor**, built with [WXT](https://wxt.dev). It captures redacted
activity events and streams them to the local daemon over `ws://localhost:8787`
(see [../CONTRACT.md](../CONTRACT.md) §1). Debugger-free: in-page
fetch/XHR/WS/SSE interception, no `chrome.debugger`, no "being debugged" banner.

## Dev

```bash
npm install
npm run dev        # loads an unpacked dev build with HMR (Chrome)
npm run build      # production build → .output/chrome-mv3
npm run compile    # typecheck
```

## Layout

- `entrypoints/background.ts` — service worker; reconnecting WS client to the daemon (§1).
- `entrypoints/content.ts` — placeholder for the capture lane (MAIN-world interceptor + DOM).
- `entrypoints/popup/` — minimal status popup (shows daemon connectivity).
- `wxt.config.ts` — manifest (permissions, no `debugger`).

Capture wiring and the daemon live in sibling lanes — see the repo CONTRACT.
