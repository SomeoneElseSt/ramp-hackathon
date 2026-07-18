// noise-patterns.js — negative-space filter for network endpoints.
// Ported from Unbrowse (unbrowse-ai/unbrowse) src/lib/ranking-core/filters/noise-patterns.ts.
// These describe what is NOT data: tracking, auth scaffolding, static assets, session plumbing.
// Drop before scoring / listener discovery. Do not tune without real traffic evidence.

/** Hosts that are pure noise — tracking, telemetry, auth providers, CDN trackers, etc. */
export const NOISE_HOSTS =
  /(id5-sync\.com|btloader\.com|presage\.io|onetrust\.com|adsrvr\.org|googlesyndication\.com|adtrafficquality\.google|amazon-adsystem\.com|crazyegg\.com|challenges\.cloudflare\.com|google-analytics\.com|doubleclick\.net|gstatic\.com|accounts\.google\.com|login\.microsoftonline\.com|auth0\.com|cognito-idp\.|protechts\.net|demdex\.net|datadoghq\.com|fullstory\.com|launchdarkly\.com|intercom\.io|sentry\.io|segment\.io|amplitude\.com|mixpanel\.com|hotjar\.com|clarity\.ms|googletagmanager\.com|walletconnect\.com|cloudflareinsights\.com|fonts\.googleapis\.com|recaptcha|waa-pa\.|signaler-pa\.|ogads-pa\.|reddit\.com\/pixels?|pixel-config\.|dns-finder\.com|cookieconsentpub|firebase\.googleapis\.com|firebaseinstallations\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|apis\.google\.com|connect\.facebook\.net|bat\.bing\.com|static\.cloudflareinsights\.com|cdn\.mxpnl\.com|js\.hs-analytics\.net|snap\.licdn\.com|clc\.stackoverflow\.com|px\.ads|t\.co\/i|analytics\.|telemetry\.|stats\.)/i;

/** Noise URL path patterns — tracking, telemetry, logging. */
export const NOISE_PATHS =
  /\/(track|pixel|telemetry|beacon|csp-report|litms|demdex|analytics|protechts|collect|tr\/|gen_204|generate_204|log$|logging|heartbeat|metrics|consent|sodar|tag$|event$|events$|impression|pageview|click|__|adx\/|\/cm\/ttc|\/pfb$|_stm$|videoads\/|prerolls|phantom\/|controller-resources)/i;

/** i18n / locales / static config — translation files and navigation scaffolding. */
export const I18N_CONFIG_PATHS =
  /\/(i18n\/|locales\/|locale\/|translations?\/|l10n\/|lang\/[a-z]{2,5}\/|navigation\.json$|privacy[-_]compliance|privacy[-_]consent|consent[-_])/i;

/** Auth/session/config — on-domain but not data. */
export const AUTH_CONFIG_PATHS =
  /\/(csrf_meta|logged_in_user|analytics_user_data|onboarding|geolocation|auth|login|logout|register|signup|session|webConfig|config\.json|manifest\.json|robots\.txt|sitemap|favicon|opensearch|service-worker|sw\.js)\b/i;

/**
 * Session plumbing — infrastructure endpoints no user would want as a listener.
 * Keep real data surfaces (timelines, messages, notifications) out of this list.
 */
export const SESSION_PLUMBING =
  /(account\/settings|account\/multi|badge_count|DataSaverMode|permissionsState|email_phone_info|live_pipeline|user_flow|strato\/column|ces\/p2|IntercomStarter|getAltText|fleetline|FeatureHelper|VerifiedAvatar|ScheduledPromotion|DirectCall|DmSettings|PinnedTimeline)/i;

/** Static assets — fonts, scripts, images, media, wasm. */
export const STATIC_ASSET_PATTERNS =
  /\.(woff2?|ttf|eot|css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|avif|mp4|mp3|wav|riv|lottie|wasm)(\?|%3F|$)/i;

/** Animation / UI asset paths. */
export const UI_ASSET_PATHS = /\/(rive|lottie|animations?|sprites?|assets\/static)\//i;

/** True when a URL should never reach endpoint scoring / listener setup. */
export function isNoiseUrl(url) {
  if (!url || typeof url !== "string") return true;
  if (STATIC_ASSET_PATTERNS.test(url)) return true;
  if (UI_ASSET_PATHS.test(url)) return true;
  if (NOISE_PATHS.test(url)) return true;
  if (I18N_CONFIG_PATHS.test(url)) return true;
  if (AUTH_CONFIG_PATHS.test(url)) return true;
  if (SESSION_PLUMBING.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    if (NOISE_HOSTS.test(host)) return true;
  } catch {
    /* keep going */
  }
  return false;
}
