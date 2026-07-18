import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

// Load .env from the repo root regardless of cwd.
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../../.env") });

export const HTTP_PORT = Number(process.env.SERVER_HTTP_PORT ?? 8787);
export const WS_PORT = Number(process.env.SERVER_WS_PORT ?? 8788);

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const CLASSIFIER_MODEL = process.env.OPENAI_CLASSIFIER_MODEL ?? "gpt-4o-mini";

// Deterministic-engine constants.
export const DB_PATH = process.env.COMPANION_DB_PATH ?? resolve(process.cwd(), "data.db");
export const MAX_BODY_CHARS = 20_000; // captured bodies are truncated to this
export const WATCHING_RESET_MS = 4_000; // how long the pet stays "watching" after activity
export const SLEEP_AFTER_MS = 8_000; // idle time before the pet returns to "sleeping"

// Modeled polling baseline for the metrics proof point.
export const POLL_BASELINE_INTERVAL_SECONDS = 15;
export const POLL_BASELINE_PER_HOUR = Math.round(3600 / POLL_BASELINE_INTERVAL_SECONDS);
