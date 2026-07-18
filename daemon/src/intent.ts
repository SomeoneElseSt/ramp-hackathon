// Natural-language intent → endpoint/keyword hints. Deterministic and general:
// this is what makes "new messages" narrow to messaging endpoints on ANY site,
// so telemetry/presence/analytics noise is skipped before extraction.

interface IntentDomain {
  triggers: string[]; // words in the intent that activate this domain
  keywords: string[]; // url/endpoint substrings to inspect
  type: string; // semantic event type produced
}

const DOMAINS: IntentDomain[] = [
  {
    triggers: ["message", "dm", "chat", "inbox", "conversation", "reply", "text"],
    keywords: ["messag", "conversation", "thread", "inbox", "chat", "dm"],
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
