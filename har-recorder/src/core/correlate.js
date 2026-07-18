// correlate.js — attach a shared actionId to events that plausibly stem from
// the same user action. This is EVIDENCE, not a causal guarantee: we link by
// "happened on the same tab shortly after a click/submit", plus opener linking
// so a click that spawns a new tab ties that tab's first activity back.

import { ACTION_TYPES, EventType, createIdFactory } from "./schema.js";

/**
 * @param {Array} events  activity events (any order)
 * @param {{windowMs?: number}} opts  correlation window after an action
 * @returns {Array} same events, sorted by ts, with .actionId populated where linked
 */
export function correlate(events, { windowMs = 6000 } = {}) {
  const sorted = [...events].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : String(a.id).localeCompare(String(b.id))
  );
  const nextActionId = createIdFactory("a");
  // tabId -> { actionId, ts } : the action currently "owning" a tab's activity
  const activeByTab = new Map();

  for (const ev of sorted) {
    // A user action opens a new correlation scope on its tab.
    if (ACTION_TYPES.has(ev.type)) {
      const actionId = nextActionId();
      ev.actionId = actionId;
      if (ev.tabId != null) activeByTab.set(ev.tabId, { actionId, ts: ev.ts });
      continue;
    }

    // Opener linking: a tab created by a tab that has an active action inherits
    // that action, so the new tab's first navigation/requests stay linked.
    if (ev.type === EventType.TAB_CREATED && ev.data?.openerTabId != null) {
      const opener = activeByTab.get(ev.data.openerTabId);
      if (opener && ev.ts - opener.ts <= windowMs) {
        ev.actionId = opener.actionId;
        if (ev.tabId != null)
          activeByTab.set(ev.tabId, { actionId: opener.actionId, ts: ev.ts });
        continue;
      }
    }

    // Same-tab linking within the window.
    if (ev.tabId != null) {
      const active = activeByTab.get(ev.tabId);
      if (active && ev.ts - active.ts <= windowMs) {
        ev.actionId = active.actionId;
      }
    }
  }
  return sorted;
}

/** Group correlated events by actionId. Returns Map<actionId, events[]>. */
export function groupByAction(events) {
  const groups = new Map();
  for (const ev of events) {
    if (!ev.actionId) continue;
    if (!groups.has(ev.actionId)) groups.set(ev.actionId, []);
    groups.get(ev.actionId).push(ev);
  }
  return groups;
}
