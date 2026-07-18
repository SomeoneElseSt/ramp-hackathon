// interceptor.content.ts — MAIN-world network capture. Patches fetch/XHR/
// WebSocket/EventSource to capture response bodies + realtime frames and relays
// them to the isolated-world relay via postMessage. No chrome.debugger, no
// banner. This is the sensor per CONTRACT §1 (feeds redacted events to the daemon).
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const w = window as any;
    if (w.__tamaIntercept) return;
    w.__tamaIntercept = true;
    const MAX = 64 * 1024;
    const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|css|woff2?|ttf|mp4|m4s|js|map)(\?|$)/i;
    const TEXTUAL = /json|text|graphql|event-stream|xml|x-www-form-urlencoded|protobuf/i;
    const post = (rec: unknown) => { try { window.postMessage({ __tama: 1, rec }, window.location.origin); } catch {} };

    const oFetch = window.fetch;
    if (oFetch) {
      window.fetch = function (this: unknown, ...args: any[]) {
        const req = args[0], opts = args[1] || {};
        const url = typeof req === 'string' ? req : req?.url;
        const method = (opts.method || req?.method || 'GET').toUpperCase();
        const ts = Date.now();
        return oFetch.apply(this as any, args as any).then((res: Response) => {
          try {
            const ct = res.headers.get('content-type') || '';
            if (!SKIP.test(url || '') && TEXTUAL.test(ct)) res.clone().text().then((b) => post({ kind: 'http', url, method, status: res.status, ct, body: String(b).slice(0, MAX), ts })).catch(() => {});
            else post({ kind: 'http', url, method, status: res.status, ct, body: '', ts });
          } catch {}
          return res;
        });
      } as any;
    }

    const XP = XMLHttpRequest.prototype as any, oOpen = XP.open, oSend = XP.send;
    XP.open = function (this: any, m: string, u: string) { this.__t = { method: m, url: u }; return oOpen.apply(this, arguments as any); };
    XP.send = function (this: any) {
      this.addEventListener('load', () => { try { const ct = this.getResponseHeader('content-type') || ''; post({ kind: 'http', url: this.__t?.url, method: this.__t?.method, status: this.status, ct, body: TEXTUAL.test(ct) ? String(this.responseText || '').slice(0, MAX) : '', ts: Date.now() }); } catch {} });
      return oSend.apply(this, arguments as any);
    };

    const OES = window.EventSource;
    if (OES) {
      const W: any = function (u: string, c?: any) { const es = c !== undefined ? new OES(u, c) : new OES(u); es.addEventListener('message', (e: any) => { try { post({ kind: 'sse', url: u, data: String(e.data || '').slice(0, MAX), ts: Date.now() }); } catch {} }); return es; };
      W.prototype = OES.prototype; W.CONNECTING = OES.CONNECTING; W.OPEN = OES.OPEN; W.CLOSED = OES.CLOSED;
      window.EventSource = W;
    }

    const OWS = window.WebSocket;
    if (OWS) {
      const W: any = function (u: string, p?: any) { const ws = p !== undefined ? new OWS(u, p) : new OWS(u); ws.addEventListener('message', (e: any) => { try { if (typeof e.data === 'string') post({ kind: 'ws', url: u, dir: 'received', data: e.data.slice(0, MAX), ts: Date.now() }); } catch {} }); return ws; };
      W.prototype = OWS.prototype; W.CONNECTING = OWS.CONNECTING; W.OPEN = OWS.OPEN; W.CLOSING = OWS.CLOSING; W.CLOSED = OWS.CLOSED;
      window.WebSocket = W;
    }
  },
});
