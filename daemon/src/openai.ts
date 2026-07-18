import OpenAI from "openai";

// Shared client. Null when no key is set so callers degrade to the deterministic
// heuristic path instead of throwing.
let client: OpenAI | null = null;

export const MODEL = process.env.OPENAI_CLASSIFIER_MODEL ?? "gpt-4o-mini";

export function getOpenAI(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  if (client) return client;
  client = new OpenAI({ apiKey: key });
  return client;
}
