// Integration harness — extension side.
// MCP stays site-agnostic: create_listener → daemon watch → harness opens a tab.
// Modules supply defaults (pageUrl / endpoint hints). LinkedIn is the first proof.

import { linkedin } from "./linkedin.js";
import { generic } from "./generic.js";

/**
 * @typedef {object} IntegrationModule
 * @property {string} id
 * @property {(listener: object) => boolean} match
 * @property {string} [defaultPageUrl]
 * @property {string[]} [endpointHints]
 * @property {boolean} [openTabOnListen]
 * @property {(listener: object) => string|null} [resolvePageUrl]
 */

/** Site-specific modules (ordered). Generic is the explicit fallback. */
/** @type {IntegrationModule[]} */
export const INTEGRATIONS = [linkedin];

/**
 * Resolve where to open a tab for a watch / ListenerWatch payload from the daemon.
 * @param {{ intent?: string, pageUrl?: string|null, endpoints?: string[], label?: string|null }} listener
 * @returns {{ pageUrl: string|null, endpoints: string[], moduleId: string, openTab: boolean }}
 */
export function resolveWatchTarget(listener) {
  const watch = listener || {};
  const mod = INTEGRATIONS.find((m) => m.match?.(watch)) || generic;

  let pageUrl =
    (watch.pageUrl && String(watch.pageUrl).trim()) ||
    (typeof mod.resolvePageUrl === "function" ? mod.resolvePageUrl(watch) : null) ||
    mod.defaultPageUrl ||
    null;
  let endpoints = Array.isArray(watch.endpoints) ? [...watch.endpoints] : [];

  if (endpoints.length === 0 && mod.endpointHints?.length) {
    endpoints = [...mod.endpointHints];
  }

  const openTab = mod.openTabOnListen !== false && !!pageUrl;
  return {
    pageUrl,
    endpoints,
    moduleId: mod.id,
    openTab,
  };
}
