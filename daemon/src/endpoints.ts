// Endpoint discovery helpers for listener setup.
// Noise patterns adapted from Unbrowse (unbrowse-ai/unbrowse) ranking-core filters.
// Used to shortlist API-shaped first-party surfaces from the raw buffer before
// OpenAI picks which ones match a natural-language intent.

import type { ActivityEvent } from "./types.js";

const NOISE_HOSTS =
  /(id5-sync\.com|btloader\.com|presage\.io|onetrust\.com|adsrvr\.org|googlesyndication\.com|adtrafficquality\.google|amazon-adsystem\.com|crazyegg\.com|challenges\.cloudflare\.com|google-analytics\.com|doubleclick\.net|gstatic\.com|accounts\.google\.com|login\.microsoftonline\.com|auth0\.com|cognito-idp\.|protechts\.net|demdex\.net|datadoghq\.com|fullstory\.com|launchdarkly\.com|intercom\.io|sentry\.io|segment\.io|amplitude\.com|mixpanel\.com|hotjar\.com|clarity\.ms|googletagmanager\.com|walletconnect\.com|cloudflareinsights\.com|fonts\.googleapis\.com|recaptcha|waa-pa\.|signaler-pa\.|ogads-pa\.|reddit\.com\/pixels?|pixel-config\.|dns-finder\.com|cookieconsentpub|firebase\.googleapis\.com|firebaseinstallations\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|apis\.google\.com|connect\.facebook\.net|bat\.bing\.com|static\.cloudflareinsights\.com|cdn\.mxpnl\.com|js\.hs-analytics\.net|snap\.licdn\.com|clc\.stackoverflow\.com|px\.ads|t\.co\/i|analytics\.|telemetry\.|stats\.)/i;

const NOISE_PATHS =
  /\/(track|pixel|telemetry|beacon|csp-report|litms|demdex|analytics|protechts|collect|tr\/|gen_204|generate_204|log$|logging|heartbeat|metrics|consent|sodar|tag$|event$|events$|impression|pageview|click|__|adx\/|\/cm\/ttc|\/pfb$|_stm$|videoads\/|prerolls|phantom\/|controller-resources)/i;

const I18N_CONFIG_PATHS =
  /\/(i18n\/|locales\/|locale\/|translations?\/|l10n\/|lang\/[a-z]{2,5}\/|navigation\.json$|privacy[-_]compliance|privacy[-_]consent|consent[-_])/i;

const AUTH_CONFIG_PATHS =
  /\/(csrf_meta|logged_in_user|analytics_user_data|onboarding|geolocation|auth|login|logout|register|signup|session|webConfig|config\.json|manifest\.json|robots\.txt|sitemap|favicon|opensearch|service-worker|sw\.js)\b/i;

const SESSION_PLUMBING =
  /(account\/settings|account\/multi|badge_count|DataSaverMode|permissionsState|email_phone_info|live_pipeline|user_flow|strato\/column|ces\/p2|IntercomStarter|getAltText|fleetline|FeatureHelper|VerifiedAvatar|ScheduledPromotion|DirectCall|DmSettings|PinnedTimeline)/i;

const STATIC_ASSET_PATTERNS =
  /\.(woff2?|ttf|eot|css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|mp3|wav|riv|lottie|wasm)(\?|%3F|$)/i;

const UI_ASSET_PATHS = /\/(rive|lottie|animations?|sprites?|assets\/static)\//i;

export function isNoiseUrl(url: string): boolean {
  if (!url) return true;
  if (STATIC_ASSET_PATTERNS.test(url)) return true;
  if (UI_ASSET_PATHS.test(url)) return true;
  if (NOISE_PATHS.test(url)) return true;
  if (I18N_CONFIG_PATHS.test(url)) return true;
  if (AUTH_CONFIG_PATHS.test(url)) return true;
  if (SESSION_PLUMBING.test(url)) return true;
  try {
    if (NOISE_HOSTS.test(new URL(url).hostname)) return true;
  } catch {
    /* keep */
  }
  return false;
}

export function looksLikeApiUrl(url: string): boolean {
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

export interface EndpointCandidate {
  key: string;
  method: string;
  url: string;
  path: string;
  sampleUrl: string;
  count: number;
  kinds: string[];
}

function dataOf(ev: ActivityEvent): Record<string, unknown> {
  return ev.data && typeof ev.data === "object" ? (ev.data as Record<string, unknown>) : {};
}

/** Shortlist unique API-shaped / WS / SSE endpoints from recent activity. */
export function collectEndpointCandidates(
  events: ActivityEvent[],
  { limit = 40 } = {},
): EndpointCandidate[] {
  const byKey = new Map<string, EndpointCandidate>();

  for (const ev of events) {
    const data = dataOf(ev);
    const url = (typeof data.url === "string" ? data.url : null) || ev.url || null;
    if (!url || isNoiseUrl(url)) continue;

    let method = typeof data.method === "string" ? data.method : "GET";
    let kind: string | null = null;

    if (ev.type === "network.request" || ev.type === "network.response") {
      const mime = typeof data.mimeType === "string" ? data.mimeType : "";
      const rt = typeof data.resourceType === "string" ? data.resourceType : "";
      const apiish =
        looksLikeApiUrl(url) ||
        /json|graphql|event-stream/i.test(mime) ||
        rt === "XHR" ||
        rt === "Fetch";
      if (!apiish) continue;
      kind = "http";
    } else if (ev.type === "websocket.received" || ev.type === "websocket.sent") {
      kind = "websocket";
      method = "WS";
    } else if (ev.type === "sse.message") {
      kind = "sse";
      method = "SSE";
    } else {
      continue;
    }

    let originPath = url;
    let path = url;
    try {
      const u = new URL(url);
      originPath = `${u.origin}${u.pathname}`;
      path = u.pathname;
    } catch {
      /* keep */
    }

    const key = `${method.toUpperCase()} ${originPath}`;
    const row = byKey.get(key) || {
      key,
      method: method.toUpperCase(),
      url: originPath,
      path,
      sampleUrl: url,
      count: 0,
      kinds: [],
    };
    row.count += 1;
    row.sampleUrl = url;
    if (kind && !row.kinds.includes(kind)) row.kinds.push(kind);
    byKey.set(key, row);
  }

  return [...byKey.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
