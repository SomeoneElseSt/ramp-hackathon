// Generic fallback integration — no site-specific knowledge.
// Uses listener.pageUrl, or origin derived from the first endpoint.

/** @type {import('./index.js').IntegrationModule} */
export const generic = {
  id: "generic",
  openTabOnListen: true,
  match() {
    // Always matches as last-resort; resolve() only consults this after
    // site-specific modules decline.
    return true;
  },
  /**
   * @param {{ pageUrl?: string|null, endpoints?: string[] }} listener
   * @returns {string|null}
   */
  resolvePageUrl(listener) {
    const pageUrl = (listener?.pageUrl && String(listener.pageUrl).trim()) || null;
    if (pageUrl) return pageUrl;
    const endpoints = Array.isArray(listener?.endpoints) ? listener.endpoints : [];
    if (!endpoints[0]) return null;
    return originHome(endpoints[0]);
  },
};

function originHome(endpointKey) {
  const raw = String(endpointKey).replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, "").trim();
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return null;
  }
}
