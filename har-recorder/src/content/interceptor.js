// interceptor.js — runs in the page's MAIN world (no chrome.debugger, no banner,
// no debugger permission). Patches fetch / XHR / WebSocket / EventSource to
// capture request+response bodies and realtime frames, and relays them to the
// isolated-world relay via window.postMessage. Injected at document_start so it
// wraps the primitives before page scripts use them.
(() => {
  if (window.__wfIntercept) return;
  window.__wfIntercept = true;
  const MAX = 256 * 1024; // GraphQL messaging payloads are large
  const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|css|woff2?|ttf|mp4|m4s|js|map)(\?|$)/i;
  const TEXTUAL = /json|text|graphql|event-stream|xml|x-www-form-urlencoded|protobuf|javascript/i;
  const post = (rec) => {
    try {
      window.postMessage({ __wf: 1, rec }, window.location.origin);
    } catch (_) {}
  };
  const abs = (u) => {
    try {
      return new URL(u, window.location.href).href;
    } catch {
      return u;
    }
  };

  // ---- fetch ----
  const oFetch = window.fetch;
  if (oFetch) {
    window.fetch = function (...args) {
      const req = args[0],
        opts = args[1] || {};
      let url = typeof req === "string" ? req : req && req.url;
      url = url ? abs(url) : url;
      const method = (opts.method || (req && req.method) || "GET").toUpperCase();
      const ts = Date.now();
      return oFetch.apply(this, args).then((res) => {
        try {
          const ct = res.headers.get("content-type") || "";
          // Always stamp the request URL on the record (not the page URL).
          if (!SKIP.test(url || "") && TEXTUAL.test(ct)) {
            res
              .clone()
              .text()
              .then((body) =>
                post({
                  kind: "http",
                  url,
                  method,
                  status: res.status,
                  ct,
                  body: String(body).slice(0, MAX),
                  ts,
                }),
              )
              .catch(() => {});
          } else if (!SKIP.test(url || "")) {
            post({ kind: "http", url, method, status: res.status, ct, body: "", ts });
          }
        } catch (_) {}
        return res;
      });
    };
  }

  // ---- XMLHttpRequest ----
  const XP = XMLHttpRequest.prototype,
    oOpen = XP.open,
    oSend = XP.send;
  XP.open = function (m, u) {
    this.__wf = { method: m, url: u ? abs(u) : u };
    return oOpen.apply(this, arguments);
  };
  XP.send = function () {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        const url = this.__wf && this.__wf.url;
        const method = this.__wf && this.__wf.method;
        if (SKIP.test(url || "")) return;
        post({
          kind: "http",
          url,
          method,
          status: this.status,
          ct,
          body: TEXTUAL.test(ct) ? String(this.responseText || "").slice(0, MAX) : "",
          ts: Date.now(),
        });
      } catch (_) {}
    });
    return oSend.apply(this, arguments);
  };

  // ---- WebSocket ----
  const OWS = window.WebSocket;
  if (OWS) {
    const Wrapped = function (url, protocols) {
      const absUrl = abs(url);
      const ws = protocols !== undefined ? new OWS(url, protocols) : new OWS(url);
      ws.addEventListener("message", (e) => {
        try {
          if (typeof e.data === "string")
            post({ kind: "ws", url: absUrl, dir: "received", data: e.data.slice(0, MAX), ts: Date.now() });
        } catch (_) {}
      });
      const oSendWs = ws.send;
      ws.send = function (d) {
        try {
          if (typeof d === "string")
            post({ kind: "ws", url: absUrl, dir: "sent", data: d.slice(0, MAX), ts: Date.now() });
        } catch (_) {}
        return oSendWs.apply(this, arguments);
      };
      return ws;
    };
    Wrapped.prototype = OWS.prototype;
    Wrapped.CONNECTING = OWS.CONNECTING;
    Wrapped.OPEN = OWS.OPEN;
    Wrapped.CLOSING = OWS.CLOSING;
    Wrapped.CLOSED = OWS.CLOSED;
    window.WebSocket = Wrapped;
  }

  // ---- EventSource (SSE) ----
  const OES = window.EventSource;
  if (OES) {
    const Wrapped = function (url, cfg) {
      const absUrl = abs(url);
      const es = cfg !== undefined ? new OES(url, cfg) : new OES(url);
      es.addEventListener("message", (e) => {
        try {
          post({ kind: "sse", url: absUrl, data: String(e.data || "").slice(0, MAX), ts: Date.now() });
        } catch (_) {}
      });
      return es;
    };
    Wrapped.prototype = OES.prototype;
    Wrapped.CONNECTING = OES.CONNECTING;
    Wrapped.OPEN = OES.OPEN;
    Wrapped.CLOSED = OES.CLOSED;
    window.EventSource = Wrapped;
  }
})();
