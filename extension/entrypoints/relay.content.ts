// relay.content.ts — isolated world. Bridges the MAIN-world interceptor (which
// can't use chrome.*) to the background. Same-origin, tagged messages only.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = (e as MessageEvent).data as any;
      if (!d || d.__tama !== 1 || !d.rec) return;
      try { chrome.runtime.sendMessage({ type: 'page-capture', rec: d.rec }); } catch {}
    });
  },
});
