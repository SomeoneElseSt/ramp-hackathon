// relay.js — runs in the extension's ISOLATED world. Bridges the MAIN-world
// interceptor (which can't use chrome.*) to the background service worker.
// Only accepts same-origin messages tagged by our interceptor.
let active = true;
window.addEventListener("message", (e) => {
  if (!active || e.source !== window) return;
  const d = e.data;
  if (!d || d.__wf !== 1 || !d.rec) return;
  try { chrome.runtime.sendMessage({ type: "page-capture", rec: d.rec }); } catch (_) {}
});
// stop forwarding when recording stops
chrome.runtime.onMessage?.addListener?.((msg) => { if (msg?.type === "wf-stop") active = false; });
