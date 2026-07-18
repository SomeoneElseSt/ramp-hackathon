// dom.content.ts — isolated world. Compact DOM-interaction capture (clicks +
// form submits). Value-free: records element/label + field name/type, never
// typed values. Relayed to the background as dom-event messages.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    const send = (payload: unknown) => { try { chrome.runtime.sendMessage({ type: 'dom-event', payload }); } catch {} };
    const label = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

    document.addEventListener('click', (e) => {
      const t = (e.target as Element)?.closest?.('a,button,[role=button],input,summary,[onclick]') || (e.target as Element);
      if (!t || t.nodeType !== 1) return;
      send({ kind: 'click', ts: Date.now(), element: { tag: (t as Element).tagName?.toLowerCase(), role: t.getAttribute('role'), label: label(t) } });
    }, true);

    document.addEventListener('submit', (e) => {
      const f = e.target as HTMLFormElement;
      if (f?.tagName !== 'FORM') return;
      send({ kind: 'submit', ts: Date.now(), form: {
        action: f.getAttribute('action') || location.href,
        method: (f.getAttribute('method') || 'get').toUpperCase(),
        fields: Array.from(f.elements).filter((x: any) => x.name).map((x: any) => ({ name: x.name, type: (x.getAttribute('type') || x.tagName.toLowerCase()) })),
      } });
    }, true);
  },
});
