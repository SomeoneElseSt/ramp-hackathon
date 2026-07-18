// functionality.js — turn a discovered network source into a human-readable
// "functionality" Tama can listen for. Keyword heuristics over the endpoint;
// discovery produces the sources, this labels them for the overlay / catalog.

/**
 * @typedef {{ iconKey: string, label: string, source: string, eventType: string, key: string }} Functionality
 * @typedef {{ key: string, sampleUrl?: string }} DiscoveredSource
 */

const RULES = [
  { re: /messag|\/inbox|\/dm|conversation/i, iconKey: "message", label: "New message", eventType: "message.received" },
  { re: /notif|\/alerts?\b/i, iconKey: "bell", label: "New notification", eventType: "notification.received" },
  { re: /invit|connection|\/network\b|\/mynetwork/i, iconKey: "user", label: "Connection request", eventType: "connection.received" },
  { re: /feed|timeline|\/updates\b/i, iconKey: "news", label: "New post in feed", eventType: "feed.updated" },
  { re: /search|\/results\b/i, iconKey: "search", label: "New search result", eventType: "search.updated" },
  { re: /comment|repl(y|ies)/i, iconKey: "message", label: "New comment", eventType: "comment.received" },
  { re: /order|checkout|\/cart\b/i, iconKey: "activity", label: "Order update", eventType: "order.changed" },
];

/** @param {DiscoveredSource} src @returns {Functionality | null} */
export function describeSource(src) {
  const url = src.sampleUrl || src.key || "";
  const rule = RULES.find((r) => r.re.test(url));
  if (!rule) return null;
  return {
    iconKey: rule.iconKey,
    label: rule.label,
    source: sourceHint(url),
    eventType: rule.eventType,
    key: src.key,
  };
}

/** Dedup by label — one row per functionality, best source wins. */
export function toFunctionalities(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const f = describeSource(s);
    if (f && !seen.has(f.label)) {
      seen.add(f.label);
      out.push(f);
    }
  }
  return out;
}

function sourceHint(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const seg = p.split("/").find((s) => /messag|notif|feed|invit|search|comment|order/.test(s));
    const ns = /voyager/.test(p)
      ? "voyager"
      : new URL(url).host.replace(/^www\./, "").split(".")[0];
    return seg
      ? `${ns} · ${seg.replace(/voyagermessagingdash|voyager/i, "")}`.replace(/ · $/, "")
      : ns;
  } catch {
    return "network";
  }
}
