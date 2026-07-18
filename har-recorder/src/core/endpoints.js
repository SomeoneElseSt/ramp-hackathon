// endpoints.js — discover listenable network surfaces from a captured trace.
// Pipeline: drop Unbrowse-style noise → keep API-shaped / first-party / WS/SSE
// → optionally rank against a natural-language intent (deterministic BM25-ish).
// LLM ranking (OpenAI) lives in the daemon at listener-setup time, not here.

import { EventType } from "./schema.js";
import { isNoiseUrl } from "./noise-patterns.js";

/** Structural signal that a URL is an API / data surface (from Unbrowse looksLikeApiUrl). */
export function looksLikeApiUrl(url) {
  if (!url) return false;
  if (
    /\/api\/|graphql|\/rest\/|\/rpc\/|voyager|\/v\d+(?:\/|$)|\/\d+\.\d+\/|\.(?:json|geojson|ndjson|jsonl|xml|atom|rss)(?:\?|$)/i.test(
      url,
    )
  ) {
    return true;
  }
  try {
    const host = new URL(url).hostname;
    if (/^(api|gql|graphql|rest|registry|services?|backend|query\d*|edge|quote-api)\./i.test(host)) {
      return true;
    }
    if (/\.api\./i.test(host)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url || "";
  }
}

/** Collapse query variance into a stable endpoint key (method + origin + path template-ish). */
export function endpointKey(method, url) {
  try {
    const u = new URL(url);
    // Strip volatile query params; keep path as the identity.
    return `${(method || "GET").toUpperCase()} ${u.origin}${u.pathname}`;
  } catch {
    return `${(method || "GET").toUpperCase()} ${url}`;
  }
}

/**
 * Collect unique endpoint candidates from raw activity events.
 * Prefer first-party (same host as page url) API-shaped responses + WS/SSE.
 *
 * @returns {Array<{ key, method, url, host, path, sampleUrl, count, kinds: string[], firstParty: boolean }>}
 */
export function collectEndpointCandidates(events, { pageUrl = null } = {}) {
  const pageHost = pageUrl ? hostOf(pageUrl) : null;
  const byKey = new Map();

  for (const ev of events) {
    const url = ev.data?.url || ev.url || null;
    if (!url || isNoiseUrl(url)) continue;

    let method = ev.data?.method || "GET";
    let kind = null;

    if (ev.type === EventType.NETWORK_REQUEST || ev.type === EventType.NETWORK_RESPONSE) {
      kind = "http";
      // Prefer API-shaped; also keep XHR/fetch with JSON mime even without /api/.
      const mime = ev.data?.mimeType || "";
      const apiish =
        looksLikeApiUrl(url) ||
        /json|graphql|event-stream/i.test(mime) ||
        ev.data?.resourceType === "XHR" ||
        ev.data?.resourceType === "Fetch";
      if (!apiish) continue;
    } else if (
      ev.type === EventType.WEBSOCKET_RECEIVED ||
      ev.type === EventType.WEBSOCKET_SENT
    ) {
      kind = "websocket";
      method = "WS";
    } else if (ev.type === "sse.message" || ev.type === EventType.SSE_MESSAGE) {
      kind = "sse";
      method = "SSE";
    } else {
      continue;
    }

    const host = hostOf(url);
    const firstParty =
      !pageHost ||
      host === pageHost ||
      host.endsWith("." + pageHost) ||
      pageHost.endsWith("." + host);

    // Prefer first-party; still keep third-party API hosts that look like real APIs
    // (e.g. api.linkedin.com) when they aren't noise.
    if (!firstParty && !looksLikeApiUrl(url) && kind === "http") continue;

    const key = endpointKey(method, url);
    const row = byKey.get(key) || {
      key,
      method: method.toUpperCase(),
      url: `${new URL(url).origin}${pathOf(url)}`,
      host,
      path: pathOf(url),
      sampleUrl: url,
      count: 0,
      kinds: new Set(),
      firstParty,
    };
    row.count += 1;
    row.kinds.add(kind);
    row.sampleUrl = url;
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .map((r) => ({ ...r, kinds: [...r.kinds] }))
    .sort((a, b) => {
      // first-party + higher count first
      if (a.firstParty !== b.firstParty) return a.firstParty ? -1 : 1;
      return b.count - a.count;
    });
}

/**
 * Deterministic intent ranking: token overlap between intent and url/path.
 * Returns candidates with a `score` (higher = better). OpenAI refines this in the daemon.
 */
export function rankEndpointsByIntent(candidates, intent) {
  const tokens = tokenize(intent);
  if (tokens.length === 0) {
    return candidates.map((c) => ({ ...c, score: c.count }));
  }
  return candidates
    .map((c) => {
      const hay = `${c.url} ${c.path} ${c.host}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += 10;
      }
      if (c.firstParty) score += 3;
      if (looksLikeApiUrl(c.sampleUrl || c.url)) score += 2;
      if (c.kinds.includes("websocket") || c.kinds.includes("sse")) score += 4;
      score += Math.min(c.count, 5);
      return { ...c, score };
    })
    .filter((c) => c.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score);
}

function tokenize(intent) {
  if (!intent) return [];
  return intent
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "when",
  "tell",
  "notify",
  "watch",
  "about",
  "with",
  "from",
  "that",
  "this",
  "have",
  "gets",
  "new",
  "any",
  "please",
]);
