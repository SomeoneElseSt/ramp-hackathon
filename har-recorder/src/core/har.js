// har.js — build a standards-compatible HAR 1.2 log from network events, with
// custom (_-prefixed) tab/window/action metadata so the HTTP view stays linked
// to the workflow trace. Pages are derived from navigations.

import { EventType, SCHEMA_VERSION } from "./schema.js";

function isoFromMs(ms) {
  return new Date(ms || 0).toISOString();
}

function queryStringFrom(url) {
  try {
    const u = new URL(url);
    return [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function buildTimings(reqTs, resTs, timing) {
  // Prefer CDP timing when present; else approximate wait = res-req.
  if (timing && typeof timing.receiveHeadersEnd === "number") {
    const wait = Math.max(0, timing.receiveHeadersEnd);
    return { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait, receive: 0 };
  }
  const wait = resTs != null && reqTs != null ? Math.max(0, resTs - reqTs) : 0;
  return { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait, receive: 0 };
}

/**
 * @param {Array} events correlated activity events
 * @returns {{log: object}} HAR
 */
export function buildHar(events, { creatorVersion = "1.0.0" } = {}) {
  const sorted = [...events].sort((a, b) => a.ts - b.ts);

  // pages from navigations
  const pages = [];
  const navByTab = new Map(); // tabId -> [{ts, pageId}]
  for (const ev of sorted) {
    if (ev.type === EventType.PAGE_NAVIGATED) {
      const pageId = `page_${ev.tabId}_${pages.length}`;
      pages.push({
        id: pageId,
        startedDateTime: isoFromMs(ev.ts),
        title: ev.title || ev.url || pageId,
        pageTimings: { onContentLoad: -1, onLoad: -1 },
        _tabId: ev.tabId,
        _windowId: ev.windowId,
        _url: ev.url,
      });
      if (!navByTab.has(ev.tabId)) navByTab.set(ev.tabId, []);
      navByTab.get(ev.tabId).push({ ts: ev.ts, pageId });
    }
  }
  function pagerefFor(tabId, ts) {
    const list = navByTab.get(tabId);
    if (!list) return undefined;
    let ref;
    for (const n of list) {
      if (n.ts <= ts) ref = n.pageId;
      else break;
    }
    return ref;
  }

  // pair requests/responses by requestId
  const requests = new Map();
  const responses = new Map();
  for (const ev of sorted) {
    if (ev.type === EventType.NETWORK_REQUEST && ev.data?.requestId != null) {
      requests.set(ev.data.requestId, ev);
    } else if (ev.type === EventType.NETWORK_RESPONSE && ev.data?.requestId != null) {
      responses.set(ev.data.requestId, ev);
    }
  }

  const entries = [];
  for (const [reqId, reqEv] of requests) {
    const resEv = responses.get(reqId);
    const rq = reqEv.data;
    const rs = resEv ? resEv.data : null;
    const reqBodySize = 0;
    const content = rs?.content
      ? { size: rs.content.size ?? (rs.content.text ? rs.content.text.length : 0), mimeType: rs.content.mimeType || "", text: rs.content.text || "", ...(rs.content.truncated ? { comment: "truncated" } : {}) }
      : { size: 0, mimeType: rs?.mimeType || "", text: "" };
    const entry = {
      startedDateTime: isoFromMs(reqEv.ts),
      time: resEv ? Math.max(0, resEv.ts - reqEv.ts) : 0,
      request: {
        method: rq.method,
        url: rq.url,
        httpVersion: "HTTP/1.1",
        headers: rq.headers || [],
        queryString: queryStringFrom(rq.url),
        cookies: [],
        headersSize: -1,
        bodySize: reqBodySize,
      },
      response: {
        status: rs?.status ?? 0,
        statusText: rs?.statusText || "",
        httpVersion: "HTTP/1.1",
        headers: rs?.headers || [],
        cookies: [],
        content,
        redirectURL: "",
        headersSize: -1,
        bodySize: content.size || -1,
      },
      cache: {},
      timings: buildTimings(reqEv.ts, resEv?.ts, rs?.timing),
      // custom workflow metadata
      _tabId: reqEv.tabId,
      _windowId: reqEv.windowId,
      _actionId: reqEv.actionId || null,
      _resourceType: rq.resourceType || null,
      _pageTitle: reqEv.title || null,
    };
    const pref = pagerefFor(reqEv.tabId, reqEv.ts);
    if (pref) entry.pageref = pref;
    entries.push(entry);
  }

  entries.sort((a, b) => a.startedDateTime.localeCompare(b.startedDateTime));

  return {
    log: {
      version: "1.2",
      creator: { name: "workflow-recorder", version: creatorVersion },
      comment: `activity-schema ${SCHEMA_VERSION}`,
      pages,
      entries,
    },
  };
}
