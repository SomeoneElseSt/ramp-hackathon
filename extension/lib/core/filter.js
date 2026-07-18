// filter.js — turn the raw correlated trace into a compact, human-readable
// timeline (activity-summary.json). Filters noise, groups activity around user
// actions, marks tab transitions, and keeps evidence links (raw event ids) so
// every summarized step is traceable back to the raw trace.

import { ACTION_TYPES, EventType } from "./schema.js";
import { SCHEMA_VERSION } from "./schema.js";
import { groupByAction } from "./correlate.js";

const STATIC_RESOURCE_TYPES = new Set([
  "Image",
  "Font",
  "Stylesheet",
  "Media",
  "Manifest",
  "TextTrack",
  "CSPViolationReport",
  "Ping",
  "Prefetch",
  "Preflight",
]);

const ANALYTICS_HOST_RE =
  /(google-analytics|googletagmanager|analytics\.google|doubleclick|g\.doubleclick|stats\.g|segment\.(io|com)|mixpanel|amplitude|fullstory|hotjar|heap(analytics)?|sentry\.io|browser\.sentry|datadoghq|nr-data|newrelic|bugsnag|intercom|facebook\.com\/tr|connect\.facebook|clarity\.ms|optimizely|braze|snowplow|matomo|piwik|cdn\.mxpnl)/i;

export function isStaticAsset(ev) {
  const rt = ev.data?.resourceType;
  return !!rt && STATIC_RESOURCE_TYPES.has(rt);
}
export function isAnalytics(ev) {
  return !!ev.data?.url && ANALYTICS_HOST_RE.test(ev.data.url);
}
export function isPreflight(ev) {
  return ev.data?.method === "OPTIONS";
}
export function isZeroByteIrrelevant(ev) {
  // 204/304 or empty non-API responses with no body are rarely meaningful.
  if (ev.type !== EventType.NETWORK_RESPONSE) return false;
  const s = ev.data?.status;
  const empty = !ev.data?.content && (ev.data?.encodedDataLength ?? 0) === 0;
  const apiish = /\/api\/|\/v\d+\/|\/graphql/i.test(ev.data?.url || "");
  return empty && !apiish && (s === 204 || s === 304 || s === 0);
}

/** True for network events that are noise and should be dropped from summary. */
export function isNetworkNoise(ev) {
  if (
    ev.type !== EventType.NETWORK_REQUEST &&
    ev.type !== EventType.NETWORK_RESPONSE
  )
    return false;
  return (
    isStaticAsset(ev) ||
    isAnalytics(ev) ||
    isPreflight(ev) ||
    isZeroByteIrrelevant(ev)
  );
}

function describeAction(ev) {
  if (ev.type === EventType.USER_CLICKED) {
    const el = ev.data?.element || {};
    const what =
      el.label || el.text || el.role || el.tag || "element";
    return { type: "click", label: `Clicked ${quote(what)}`, target: el };
  }
  if (ev.type === EventType.USER_SUBMITTED) {
    const f = ev.data?.form || {};
    const dest = f.action ? ` → ${f.action}` : "";
    return {
      type: "submit",
      label: `Submitted form${dest}`,
      fields: (f.fields || []).map((x) => ({ name: x.name, type: x.type, label: x.label })),
    };
  }
  return { type: ev.type, label: ev.type };
}
function quote(s) {
  s = String(s).trim();
  return s.length > 60 ? `"${s.slice(0, 60)}…"` : `"${s}"`;
}

/** Summarize the correlated group of one action into compact effects. */
function summarizeEffects(group) {
  const evidence = [];
  const requests = [];
  const responses = [];
  const domChanges = [];
  const consoleErrors = [];
  const websockets = [];
  // pair responses to request urls by requestId
  const urlByReqId = new Map();
  for (const ev of group) {
    if (ev.type === EventType.NETWORK_REQUEST && ev.data?.requestId) {
      urlByReqId.set(ev.data.requestId, ev.data.url);
    }
  }
  for (const ev of group) {
    if (ACTION_TYPES.has(ev.type)) continue; // the anchor action itself
    if (isNetworkNoise(ev)) continue;
    switch (ev.type) {
      case EventType.NETWORK_REQUEST:
        requests.push({ id: ev.id, method: ev.data.method, url: ev.data.url, resourceType: ev.data.resourceType });
        evidence.push(ev.id);
        break;
      case EventType.NETWORK_RESPONSE: {
        const url = urlByReqId.get(ev.data.requestId) || null;
        responses.push({
          id: ev.id,
          status: ev.data.status,
          mimeType: ev.data.mimeType,
          url,
          bodyPreview: ev.data.content?.text ? String(ev.data.content.text).slice(0, 240) : null,
        });
        evidence.push(ev.id);
        break;
      }
      case EventType.DOM_CHANGED:
        domChanges.push({ id: ev.id, change: ev.data.change, description: ev.data.description, textPreview: ev.data.textPreview });
        evidence.push(ev.id);
        break;
      case EventType.CONSOLE_ERROR:
        consoleErrors.push({ id: ev.id, text: ev.data.text });
        evidence.push(ev.id);
        break;
      case EventType.WEBSOCKET_RECEIVED:
      case EventType.WEBSOCKET_SENT:
        websockets.push({ id: ev.id, direction: ev.data.direction, payloadPreview: String(ev.data.payload || "").slice(0, 200) });
        evidence.push(ev.id);
        break;
    }
  }
  return { requests, responses, domChanges, consoleErrors, websockets, _evidence: evidence };
}

/**
 * Build the compact summary from correlated events.
 * @returns {{schemaVersion, generatedAt, tabs, timeline, stats}}
 */
export function buildSummary(events, { generatedAt = 0 } = {}) {
  const sorted = [...events].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : String(a.id).localeCompare(String(b.id))
  );
  const groups = groupByAction(sorted);

  // tab context (last known url/title per tab)
  const tabs = {};
  for (const ev of sorted) {
    if (ev.tabId == null) continue;
    const t = (tabs[ev.tabId] ||= { tabId: ev.tabId, windowId: ev.windowId, title: null, url: null, firstSeenTs: ev.ts });
    if (ev.title) t.title = ev.title;
    if (ev.url) t.url = ev.url;
  }

  const timeline = [];
  let activeTab = null;
  for (const ev of sorted) {
    if (ev.type === EventType.TAB_ACTIVATED) {
      if (activeTab !== ev.tabId) {
        timeline.push({
          kind: "transition",
          ts: ev.ts,
          from: activeTab == null ? null : { tabId: activeTab, url: tabs[activeTab]?.url || null, title: tabs[activeTab]?.title || null },
          to: { tabId: ev.tabId, url: ev.url || tabs[ev.tabId]?.url || null, title: ev.title || tabs[ev.tabId]?.title || null },
          evidence: [ev.id],
        });
        activeTab = ev.tabId;
      }
      continue;
    }
    if (ev.type === EventType.PAGE_NAVIGATED) {
      timeline.push({ kind: "navigation", ts: ev.ts, tabId: ev.tabId, url: ev.url, title: ev.title, evidence: [ev.id] });
      // Do NOT set activeTab here — transitions are driven purely by tab
      // activations, so the first activation still emits an "entered" marker.
      continue;
    }
    if (ACTION_TYPES.has(ev.type)) {
      const group = groups.get(ev.actionId) || [ev];
      const effects = summarizeEffects(group);
      const { _evidence, ...cleanEffects } = effects;
      timeline.push({
        kind: "action",
        actionId: ev.actionId,
        ts: ev.ts,
        tabId: ev.tabId,
        url: ev.url,
        tabTitle: ev.title,
        action: describeAction(ev),
        effects: cleanEffects,
        evidence: [ev.id, ..._evidence],
      });
      if (activeTab == null) activeTab = ev.tabId;
    }
  }

  const stats = {
    totalRawEvents: events.length,
    timelineSteps: timeline.length,
    actions: timeline.filter((s) => s.kind === "action").length,
    transitions: timeline.filter((s) => s.kind === "transition").length,
    droppedNetworkNoise: events.filter(isNetworkNoise).length,
  };
  return { schemaVersion: SCHEMA_VERSION, generatedAt, tabs, timeline, stats };
}
