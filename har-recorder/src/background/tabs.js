// tabs.js — tab lifecycle + navigation capture and recording-scope management.
// Owns the per-tab context registry (tabId -> {windowId,url,title}) that the
// CDP adapter and normalizer use. Auto-attaches new in-scope tabs and refuses
// restricted chrome:// / extension pages.

import { EventType } from "../core/schema.js";
import * as N from "../core/normalize.js";

const RESTRICTED = /^(chrome|edge|arc|brave|opera|vivaldi|about|chrome-extension|moz-extension|devtools|view-source|data|blob):/i;

export function isRestrictedUrl(url) {
  return !url || RESTRICTED.test(url);
}

export function createTabTracker({ onEvent, idFn, onAttach, onDetach }) {
  const ctxByTab = new Map(); // tabId -> {tabId, windowId, url, title}
  const lastActiveByWindow = new Map();
  let recording = false;
  let scope = { mode: "window", windowId: null, tabIds: new Set() };

  const getCtx = (tabId) => ctxByTab.get(tabId) || null;

  function inScope(tab) {
    if (!tab) return false;
    return scope.mode === "window"
      ? tab.windowId === scope.windowId
      : scope.tabIds.has(tab.id);
  }

  function upsertCtx(tab) {
    const c = ctxByTab.get(tab.id) || { tabId: tab.id };
    if (tab.windowId != null) c.windowId = tab.windowId;
    if (tab.url) c.url = tab.url;
    if (tab.title) c.title = tab.title;
    ctxByTab.set(tab.id, c);
    return c;
  }

  async function maybeAttach(tab) {
    if (!recording || !inScope(tab) || isRestrictedUrl(tab.url)) return;
    try {
      await onAttach(tab.id);
    } catch (_) {
      // DevTools open / not attachable — skip; tabs.js keeps context anyway.
    }
  }

  async function start({ mode = "window", windowId = null, tabIds = [] }) {
    recording = true;
    scope = { mode, windowId, tabIds: new Set(tabIds) };
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      upsertCtx(t);
      if (inScope(t)) await maybeAttach(t);
    }
  }

  function stop() {
    recording = false;
  }

  // ---- listeners (registered once; gated on `recording`) ----

  chrome.tabs.onCreated.addListener((tab) => {
    if (!recording) return;
    // For window scope, any new tab in the window is in scope. For tab scope,
    // a tab opened by an in-scope tab is auto-added.
    if (scope.mode === "tabs" && tab.openerTabId != null && scope.tabIds.has(tab.openerTabId)) {
      scope.tabIds.add(tab.id);
    }
    if (!inScope(tab)) return;
    upsertCtx(tab);
    onEvent(
      N.tabEvent(idFn, EventType.TAB_CREATED, {
        ts: Date.now(),
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url || tab.pendingUrl,
        title: tab.title,
        openerTabId: tab.openerTabId ?? null,
      })
    );
    maybeAttach(tab);
  });

  chrome.tabs.onRemoved.addListener((tabId, info) => {
    if (!recording) return;
    const ctx = ctxByTab.get(tabId);
    if (ctx && (scope.mode !== "tabs" || scope.tabIds.has(tabId))) {
      onEvent(
        N.tabEvent(idFn, EventType.TAB_CLOSED, {
          ts: Date.now(),
          tabId,
          windowId: info.windowId ?? ctx.windowId,
          url: ctx.url,
          title: ctx.title,
        })
      );
    }
    onDetach(tabId);
    ctxByTab.delete(tabId);
    scope.tabIds.delete(tabId);
  });

  chrome.tabs.onActivated.addListener((info) => {
    if (!recording) return;
    const prev = lastActiveByWindow.get(info.windowId) ?? null;
    lastActiveByWindow.set(info.windowId, info.tabId);
    const ctx = ctxByTab.get(info.tabId);
    if (scope.mode === "tabs" && !scope.tabIds.has(info.tabId)) return;
    if (scope.mode === "window" && ctx && ctx.windowId !== scope.windowId) return;
    onEvent(
      N.tabEvent(idFn, EventType.TAB_ACTIVATED, {
        ts: Date.now(),
        tabId: info.tabId,
        windowId: info.windowId,
        url: ctx?.url ?? null,
        title: ctx?.title ?? null,
        previousTabId: prev,
      })
    );
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!recording) return;
    upsertCtx(tab);
    // Navigations wipe content scripts — allow re-attach + listening overlay.
    if (changeInfo.url) onDetach(tabId);
    if (inScope(tab) && (changeInfo.status === "complete" || changeInfo.url)) {
      maybeAttach(tab);
    }
  });

  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (!recording || details.frameId !== 0) return; // main frame only
      const ctx = ctxByTab.get(details.tabId);
      if (scope.mode === "tabs" && !scope.tabIds.has(details.tabId)) return;
      if (scope.mode === "window" && ctx && ctx.windowId !== scope.windowId) return;
      if (isRestrictedUrl(details.url)) return;
      if (ctx) ctx.url = details.url;
      onEvent(
        N.pageNavigated(idFn, {
          ts: details.timeStamp || Date.now(),
          tabId: details.tabId,
          windowId: ctx?.windowId ?? null,
          url: details.url,
          title: ctx?.title ?? null,
          transitionType: details.transitionType,
        })
      );
      // Title often arrives after commit; refresh it shortly after.
      chrome.tabs.get(details.tabId, (t) => {
        if (!chrome.runtime.lastError && t) upsertCtx(t);
      });
    });
  }

  /** Ensure a tab is in recording scope and sensors are attached (watch harness). */
  async function includeTab(tabId) {
    if (!recording) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || isRestrictedUrl(tab.url)) return false;
    if (scope.mode === "tabs") {
      scope.tabIds.add(tabId);
    } else if (scope.mode === "window") {
      // Expand to tabs mode so a watch-opened tab is always covered.
      const existing = [...scope.tabIds];
      const inWindow = (await chrome.tabs.query({ windowId: scope.windowId })).map((t) => t.id);
      scope = {
        mode: "tabs",
        windowId: null,
        tabIds: new Set([...existing, ...inWindow, tabId].filter(Boolean)),
      };
    }
    upsertCtx(tab);
    await maybeAttach(tab);
    return true;
  }

  return {
    start,
    stop,
    getCtx,
    inScope,
    includeTab,
    isRecording: () => recording,
    scope: () => scope,
    upsertCtx,
  };
}
