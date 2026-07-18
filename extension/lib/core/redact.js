// redact.js — recursive secret redaction. Runs in the capture layer, before
// any event is written to storage, so secrets never reach IndexedDB or exports.
//
// Design: deny-list of header/param/key NAMES that are dropped or masked
// wholesale, plus a set of VALUE patterns (tokens, keys, emails) scrubbed from
// any string leaf. Defense in depth: even if a secret rides in an unexpected
// field, the value-pattern pass catches common shapes.

export const REDACTED = "[REDACTED]";

// Header names that must NEVER be exported. Dropped entirely (not even masked),
// per the requirement to never export cookies/auth/CSRF headers.
export const FORBIDDEN_HEADERS = new Set(
  [
    "cookie",
    "set-cookie",
    "authorization",
    "proxy-authorization",
    "x-csrf-token",
    "x-xsrf-token",
    "csrf-token",
    "xsrf-token",
    "x-api-key",
    "api-key",
    "apikey",
    "x-auth-token",
    "x-session-token",
    "x-access-token",
    "authentication",
  ].map((h) => h.toLowerCase())
);

// Object keys whose VALUES are masked wherever they appear (any depth).
const SENSITIVE_KEY_RE =
  /(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|auth|session[_-]?id|ssn|social.?security|card[_-]?number|cvv|otp|private[_-]?key|client[_-]?secret|refresh[_-]?token)/i;

// Query-string parameter names that get masked in normalized URLs.
const SENSITIVE_PARAM_RE =
  /^(token|access_token|refresh_token|id_token|api_?key|key|secret|password|passwd|pwd|sig|signature|auth|code|session|otp)$/i;

// Value shapes scrubbed from any string leaf.
const VALUE_PATTERNS = [
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  { name: "aws-akid", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github", re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  { name: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "stripe", re: /\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}\b/g },
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Long high-entropy hex/base64 blobs (>=40 chars): likely keys/hashes.
  { name: "highentropy", re: /\b[A-Fa-f0-9]{40,}\b/g },
];

/** Scrub secret-shaped substrings out of a single string. */
export function redactString(input) {
  if (typeof input !== "string" || !input) return input;
  let out = input;
  for (const { name, re } of VALUE_PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * Recursively redact a JSON-ish value. Masks values of sensitive keys, scrubs
 * secret patterns from string leaves, and caps recursion depth.
 */
export function redactValue(value, depth = 0) {
  if (depth > 12) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return REDACTED; // functions, symbols, etc.
}

/**
 * Redact a header collection. Accepts an object map or a CDP-style array of
 * {name,value}. Forbidden headers are DROPPED; remaining values are scrubbed.
 * Returns an array of {name,value}.
 */
export function redactHeaders(headers) {
  const pairs = Array.isArray(headers)
    ? headers.map((h) => [h.name, h.value])
    : Object.entries(headers || {});
  const out = [];
  for (const [name, value] of pairs) {
    const lname = String(name).toLowerCase();
    if (FORBIDDEN_HEADERS.has(lname)) continue; // never export
    out.push({ name, value: redactString(String(value)) });
  }
  return out;
}

/**
 * Normalize a URL for the trace: strip the fragment and mask sensitive query
 * params, keeping benign ones so routes stay recognizable.
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_PARAM_RE.test(key)) u.searchParams.set(key, REDACTED);
    }
    // scrub any secret-shaped values left in remaining params
    for (const [key, val] of [...u.searchParams.entries()]) {
      const scrubbed = redactString(val);
      if (scrubbed !== val) u.searchParams.set(key, scrubbed);
    }
    return u.toString();
  } catch {
    return redactString(rawUrl);
  }
}

/** True if a header collection still contains a forbidden header (guard). */
export function containsForbiddenHeader(headers) {
  const pairs = Array.isArray(headers)
    ? headers.map((h) => h.name)
    : Object.keys(headers || {});
  return pairs.some((n) => FORBIDDEN_HEADERS.has(String(n).toLowerCase()));
}
