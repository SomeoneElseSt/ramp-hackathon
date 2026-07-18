// content.ts — placeholder for the capture lane.
//
// The capture lane will inject a MAIN-world interceptor here (patching
// fetch / XHR / WebSocket / EventSource) plus DOM-interaction capture, and relay
// redacted activity events to the background, which forwards them to the daemon
// (CONTRACT.md §1). Debugger-free: no chrome.debugger, no banner.
//
// WXT supports MAIN-world scripts via `world: 'MAIN'` and per-tab injection via
// the scripting API — wire that here.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    // no-op until the capture lane lands
  },
});
