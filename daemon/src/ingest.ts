// ingest.ts — always-on gate for daemon ingestion.
// LinkedIn HARs are mostly slop. Worse: the interceptor often stamps the *page*
// URL (e.g. /messaging/thread/…) onto JSON API responses. So we:
//   - keep API-path *requests* for discovery
//   - keep JSON / linkedin.normalized *responses* with real bodies for perception
//   - drop CDN, ads, documents, empty assets, and known plumbing queryIds

import type { ActivityEvent } from "./types.js";
import { isNoiseUrl, looksLikeApiUrl } from "./endpoints.js";

/** Hosts that are never product data (CDN / ads / trackers / fonts). */
const DROP_HOSTS =
  /(^|\.)(static\.licdn|media\.licdn|static-exp|s3-?\w*\.linkedin|px\.ads\.linkedin|px\d*\.ads|googleadservices|adtrafficquality|doubleclick|googlesyndication|gstatic|fonts\.gstatic|fonts\.googleapis|google-analytics|googletagmanager|snap\.licdn|platform\.linkedin|li\.protechts|cloudflareinsights|sentry\.io|datadoghq|fullstory|amplitude|mixpanel|hotjar|clarity\.ms)\b/i;

/** Plumbing that looks like /api/ but is not listenable product data. */
const DROP_PLUMBING =
  /(sensorCollect|litms\/|tscp-serving|\/dtag\b|ClientConnectivityTracking|realtimeFrontendSubscriptions|realtimeFrontendTimestamp|MessagingBadge|SecondaryInbox|ConversationNudges|MessageDeliveryAcknowledgements|presenceStatuses|AwayStatus|AffiliatedMailboxes|PageMailbox|QuickReplies|SeenReceipts|MailboxCounts|LegoDashPageContents|MySettings|PremiumDash|OnboardingDash|GlobalAlerts|NotificationCards|JobSeekerPreferences|FeatureAccess|UpsellSlot|MessagingSettings|allowlist|permissionsState|badge_count|DataSaverMode|user_flow|getAltText|fleetline|ComposeViewContexts)/i;

const DROP_RESOURCE =
  /^(Document|Image|Font|Stylesheet|Media|Script|Manifest|Ping|Prefetch|Preflight|Other)$/i;

const JSONISH_MIME =
  /json|graphql|event-stream|protobuf|linkedin\.normalized|javascript/i;

export interface IngestDecision {
  keep: boolean;
  reason: string;
}

export function decideIngest(ev: ActivityEvent): IngestDecision {
  if (!ev || typeof ev.type !== "string") return drop("invalid");

  if (
    ev.type.startsWith("console.") ||
    ev.type.startsWith("dom.") ||
    ev.type.startsWith("tab.") ||
    ev.type.startsWith("page.") ||
    ev.type.startsWith("user.")
  ) {
    return drop("non-network");
  }

  const data = dataOf(ev);
  const url = (typeof data.url === "string" && data.url) || ev.url || "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url === "invalid") {
    return drop("bad-url");
  }

  if (ev.type === "websocket.received" || ev.type === "websocket.sent" || ev.type === "sse.message") {
    if (!url) return keep("realtime-no-url");
    if (DROP_HOSTS.test(hostOf(url)) || isNoiseUrl(url) || DROP_PLUMBING.test(url)) {
      return drop("ws-plumbing");
    }
    return keep("realtime");
  }

  if (ev.type === "network.request") {
    return decideRequest(url, data);
  }

  if (ev.type === "network.response") {
    return decideResponse(url, data);
  }

  return drop("not-perceivable");
}

function decideRequest(url: string, data: Record<string, unknown>): IngestDecision {
  if (!url) return drop("bad-url");
  const method = String(data.method || "GET").toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") return drop("preflight");
  if (DROP_HOSTS.test(hostOf(url)) || isNoiseUrl(url)) return drop("noise-host");
  if (DROP_PLUMBING.test(url)) return drop("plumbing");
  if (!isApiPath(url)) return drop("not-api-path");
  // Requests carry the real voyager URL (responses often don't). Keep for discovery.
  return keep("api-request");
}

function decideResponse(url: string, data: Record<string, unknown>): IngestDecision {
  const method = String(data.method || "GET").toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") return drop("preflight");

  const rt = typeof data.resourceType === "string" ? data.resourceType : "";
  if (rt && DROP_RESOURCE.test(rt)) return drop("resource-type");

  const mime = typeof data.mimeType === "string" ? data.mimeType : "";
  const body = bodyText(data);
  const host = url ? hostOf(url) : "";

  if (url && DROP_HOSTS.test(host)) return drop("noise-host");
  if (url && isNoiseUrl(url) && !JSONISH_MIME.test(mime)) return drop("noise-url");

  // Empty image/svg responses are interceptor debris.
  if (/^(image\/|text\/css|font\/|audio\/|video\/)/i.test(mime) && body.length < 8) {
    return drop("empty-asset");
  }
  if (/^(text\/html|text\/css|image\/|font\/)/i.test(mime) && !JSONISH_MIME.test(mime)) {
    return drop("mime-asset");
  }

  // Strong path: real API URL on the response.
  if (url && isApiPath(url)) {
    if (DROP_PLUMBING.test(url)) return drop("plumbing");
    if (!JSONISH_MIME.test(mime) && body.length < 20) return drop("api-empty");
    return keep("api-response");
  }

  // Weak path: SPA page URL but JSON body (LinkedIn mis-attribution). Keep only
  // if body looks like messaging / feed structured payload — not empty shells.
  if (JSONISH_MIME.test(mime) && body.length >= 40) {
    if (url && DROP_PLUMBING.test(url)) return drop("plumbing");
    if (host && /\bgoogle\.com$/i.test(host.replace(/^www\./, ""))) {
      return drop("third-party-search");
    }
    if (!/(message|conversation|messaging|sender|miniProfile|attributedBody|"text"|elements|included)/i.test(body)) {
      return drop("json-unrelated");
    }
    return keep("json-body");
  }

  return drop("not-api");
}

function isApiPath(url: string): boolean {
  if (!url) return false;
  return (
    looksLikeApiUrl(url) ||
    /\/voyager\/api\//i.test(url) ||
    /\/realtime\//i.test(url) ||
    /\/graphql/i.test(url) ||
    /\/api\//i.test(url)
  );
}

export function shouldIngest(ev: ActivityEvent): boolean {
  return decideIngest(ev).keep;
}

function keep(reason: string): IngestDecision {
  return { keep: true, reason };
}
function drop(reason: string): IngestDecision {
  return { keep: false, reason };
}

function dataOf(ev: ActivityEvent): Record<string, unknown> {
  return ev.data && typeof ev.data === "object" ? (ev.data as Record<string, unknown>) : {};
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function bodyText(data: Record<string, unknown>): string {
  const content = data.content;
  if (content && typeof content === "object") {
    const t = (content as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  if (typeof data.payload === "string") return data.payload;
  return "";
}
