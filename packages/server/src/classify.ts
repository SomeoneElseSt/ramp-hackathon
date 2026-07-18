import type { Classification, Listener } from "@companion/shared";
import { CLASSIFIER_MODEL, MAX_BODY_CHARS } from "./config.js";
import { getOpenAI } from "./openai.js";
import { recordClassifyCall } from "./metrics.js";
import { safeStringify } from "./jsonpath.js";

// The fast trigger classifier. Reached ONLY by a candidate that already
// survived URL match + dedup — never on idle traffic. Decides whether a
// genuinely-new signal is the relevant state change the user asked to watch.
export async function classifyCandidate(
  listener: Listener,
  summary: string,
  candidate: unknown
): Promise<Classification> {
  const client = getOpenAI();
  if (!client) {
    // No key configured: don't silently drop messages — fire and say so.
    return { relevant: true, reason: "no classifier configured; firing by default" };
  }

  recordClassifyCall();
  const raw = safeStringify(candidate).slice(0, MAX_BODY_CHARS);
  const hint = listener.matcher.relevanceHint ?? "";

  const system =
    "You are a fast trigger classifier for a browser listener. " +
    "Given a captured web event, decide if it is the specific state change the user asked to be notified about. " +
    "Reply ONLY with strict JSON: {\"relevant\": boolean, \"reason\": string}. Keep reason under 15 words.";

  const user =
    `User is watching: "${listener.prompt}"\n` +
    (hint ? `Relevance guidance: ${hint}\n` : "") +
    `Event summary: ${summary}\n` +
    `Raw event JSON:\n${raw}`;

  const completion = await client.chat.completions
    .create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 120,
    })
    .catch((err: unknown) => {
      console.error("[classify] OpenAI error:", err);
      return null;
    });

  if (!completion) {
    return { relevant: true, reason: "classifier error; firing by default" };
  }

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = safeParse(content);
  if (!parsed) return { relevant: true, reason: "unparseable classifier output; firing" };

  return {
    relevant: Boolean(parsed.relevant),
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function safeParse(text: string): { relevant?: unknown; reason?: unknown } | null {
  try {
    return JSON.parse(text) as { relevant?: unknown; reason?: unknown };
  } catch {
    return null;
  }
}
