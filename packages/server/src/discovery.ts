import type { Listener, SignalMatcher } from "@companion/shared";
import { CLASSIFIER_MODEL } from "./config.js";
import { getOpenAI } from "./openai.js";
import { getSamplesForHost } from "./samples.js";
import { buildListener } from "./listeners.js";
import { safeStringify } from "./jsonpath.js";

export interface DiscoverInput {
  prompt: string;
  host: string;
  name?: string;
}

// Turn a natural-language intent + sampled traffic into a deterministic
// SignalMatcher. This is the ONLY setup-time model use for reactive mode.
export async function discoverListener(
  input: DiscoverInput
): Promise<{ listener: Listener; note: string } | { error: string }> {
  const client = getOpenAI();
  if (!client) return { error: "OPENAI_API_KEY not configured" };

  const samples = getSamplesForHost(input.host);
  if (samples.length === 0) {
    return {
      error: `No captured traffic yet for ${input.host}. Browse the site first so the pet can observe its signals.`,
    };
  }

  const system =
    "You compile a natural-language watch request into a deterministic signal matcher " +
    "for a browser listener. You are given real captured traffic shapes from the site. " +
    "Pick the single request that carries the realtime signal, and the JSON paths to detect + dedup it. " +
    'Reply ONLY strict JSON: {"urlPattern": string, "mode": "realtime"|"poll", "framePath": string, ' +
    '"eventTypeMatch": string, "dedupKeyPath": string, "summaryPaths": {"sender": string, "preview": string}, ' +
    '"relevanceHint": string, "requiresClassification": boolean}. ' +
    "Use dot notation for paths (empty string if not applicable). urlPattern is a substring of the request URL.";

  const user =
    `Watch request: "${input.prompt}"\nHost: ${input.host}\n\n` +
    `Observed traffic samples (url, keys, preview):\n${formatSamples(samples)}`;

  const completion = await client.chat.completions
    .create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 400,
    })
    .catch((err: unknown) => {
      console.error("[discovery] OpenAI error:", err);
      return null;
    });

  if (!completion) return { error: "discovery model call failed" };
  const content = completion.choices[0]?.message?.content ?? "{}";
  const spec = safeParse(content);
  if (!spec || !spec.urlPattern || !spec.dedupKeyPath) {
    return { error: "discovery produced an incomplete matcher" };
  }

  const matcher: SignalMatcher = {
    mode: spec.mode === "poll" ? "poll" : "realtime",
    urlPattern: String(spec.urlPattern),
    framePath: str(spec.framePath),
    eventTypeMatch: str(spec.eventTypeMatch),
    dedupKeyPath: String(spec.dedupKeyPath),
    summaryPaths: {
      sender: str(spec.summaryPaths?.sender),
      preview: str(spec.summaryPaths?.preview),
    },
    relevanceHint: str(spec.relevanceHint),
  };

  const listener = buildListener({
    name: input.name ?? `Watch: ${input.prompt}`.slice(0, 60),
    site: input.host,
    prompt: input.prompt,
    matcher,
    requiresClassification: Boolean(spec.requiresClassification),
    source: "discovery",
  });

  return { listener, note: `Compiled a ${matcher.mode} matcher on ${matcher.urlPattern}` };
}

function formatSamples(samples: ReturnType<typeof getSamplesForHost>): string {
  return samples
    .slice(-25)
    .map(
      (s, i) =>
        `#${i} ${s.method} ${s.url}\n  keys: ${s.keySkeleton.slice(0, 20).join(", ")}\n  preview: ${s.bodyPreview}`
    )
    .join("\n");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface RawSpec {
  urlPattern?: string;
  mode?: string;
  framePath?: string;
  eventTypeMatch?: string;
  dedupKeyPath?: string;
  summaryPaths?: { sender?: string; preview?: string };
  relevanceHint?: string;
  requiresClassification?: boolean;
}

function safeParse(text: string): RawSpec | null {
  try {
    return JSON.parse(text) as RawSpec;
  } catch {
    return null;
  }
}

export function describeListener(listener: Listener): string {
  return safeStringify({ id: listener.id, name: listener.name, matcher: listener.matcher });
}
