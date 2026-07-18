import OpenAI from "openai";
import { OPENAI_API_KEY } from "./config.js";

// Single shared client. Returns null when no key is configured so callers can
// degrade gracefully (deterministic path still works) instead of throwing.
let client: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  if (!OPENAI_API_KEY) return null;
  if (client) return client;
  client = new OpenAI({ apiKey: OPENAI_API_KEY });
  return client;
}
