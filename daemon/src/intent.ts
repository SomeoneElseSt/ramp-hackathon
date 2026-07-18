// Natural-language intent → endpoint/keyword hints.
// Deterministic plan first; OpenAI refines against captured candidates at
// listener *setup* only (never on the idle watch path).

import { getOpenAI, MODEL } from "./openai.js";
import type { EndpointCandidate } from "./endpoints.js";
import { log } from "./logger.js";

interface IntentDomain {
  triggers: string[]; // words in the intent that activate this domain
  keywords: string[]; // url/endpoint substrings to inspect
  type: string; // semantic event type produced
}

const DOMAINS: IntentDomain[] = [
  {
    triggers: ["message", "dm", "chat", "inbox", "conversation", "reply", "text"],
    // voyager/messenger/graphql help LinkedIn GraphQL + MessagingGraphQL URL match
    keywords: ["messag", "conversation", "thread", "inbox", "chat", "dm", "voyager", "messenger", "graphql"],
    type: "message.received",
  },
  {
    triggers: ["mail", "email"],
    keywords: ["mail", "message", "thread", "inbox"],
    type: "email.received",
  },
  {
    triggers: ["notification", "alert", "ping", "mention"],
    keywords: ["notif", "alert", "mention", "activity", "feed"],
    type: "notification.received",
  },
  {
    triggers: ["comment"],
    keywords: ["comment", "reply", "discussion"],
    type: "comment.received",
  },
];

export interface IntentPlan {
  keywords: string[];
  types: string[];
}

// Build endpoint keywords + likely event types from a free-text intent.
export function planForIntent(intent: string): IntentPlan {
  const lower = intent.toLowerCase();
  const keywords = new Set<string>();
  const types = new Set<string>();

  for (const domain of DOMAINS) {
    if (domain.triggers.some((t) => lower.includes(t))) {
      domain.keywords.forEach((k) => keywords.add(k));
      types.add(domain.type);
    }
  }

  // Always fold in salient words from the intent itself (proper nouns, verbs).
  for (const word of lower.split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && !STOPWORDS.has(word)) keywords.add(word);
  }

  return { keywords: [...keywords], types: [...types] };
}

/**
 * Listener-setup only: given captured endpoint candidates, ask a fast model
 * which URL path fragments best match the intent. Falls back to the
 * deterministic plan when no key / no candidates / parse failure.
 */
export async function refinePlanWithLLM(
  intent: string,
  base: IntentPlan,
  candidates: EndpointCandidate[],
): Promise<IntentPlan> {
  if (candidates.length === 0) return base;
  const openai = getOpenAI();
  if (!openai) return base;

  const shortlist = candidates.slice(0, 30).map((c) => ({
    method: c.method,
    path: c.path,
    url: c.url,
    kinds: c.kinds,
    count: c.count,
  }));

  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You pick which captured browser network endpoints are useful for a reactive listener. " +
            "Return JSON: { \"keywords\": string[], \"types\": string[], \"picked\": string[] }. " +
            "keywords = short URL path substrings to match (e.g. messag, voyager, inbox). " +
            "types = semantic event types like message.received. " +
            "picked = up to 5 candidate path strings that best match the intent. " +
            "Ignore telemetry, analytics, auth, config, static assets. Prefer first-party API / GraphQL / WS / SSE.",
        },
        {
          role: "user",
          content: JSON.stringify({ intent, base, candidates: shortlist }),
        },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as {
      keywords?: unknown;
      types?: unknown;
      picked?: unknown;
    };
    const keywords = mergeUnique(
      base.keywords,
      asStringArray(parsed.keywords),
      pathTokens(asStringArray(parsed.picked)),
    );
    const types = mergeUnique(base.types, asStringArray(parsed.types));
    log(
      `intent LLM refine intent="${intent}" keywords=[${keywords.join(",")}] picked=${asStringArray(parsed.picked).length}`,
    );
    return { keywords, types: types.length > 0 ? types : base.types };
  } catch (err) {
    log(`intent LLM refine failed: ${(err as Error).message}`);
    return base;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function pathTokens(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    for (const part of p.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 4 && !STOPWORDS.has(part)) out.push(part);
    }
  }
  return out;
}

function mergeUnique(...lists: string[][]): string[] {
  const set = new Set<string>();
  for (const list of lists) for (const x of list) if (x) set.add(x.toLowerCase());
  return [...set];
}

const STOPWORDS = new Set([
  "when",
  "tell",
  "notify",
  "watch",
  "about",
  "there",
  "with",
  "from",
  "that",
  "this",
  "have",
  "gets",
  "receive",
  "received",
  "something",
  "anything",
  "please",
  "whenever",
]);
