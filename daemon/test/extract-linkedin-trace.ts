import fs from "node:fs";
import { shouldIngest } from "../src/ingest.js";
import { extractFrom } from "../src/extract.js";
import type { ActivityEvent } from "../src/types.js";

const TRACE =
  process.env.TAMA_TRACE ||
  "/Users/knotintern/Downloads/activity-trace-2026-07-18T16-09-42-007Z.json";

const events = JSON.parse(fs.readFileSync(TRACE, "utf8")).events as ActivityEvent[];

let kept = 0;
let withBody = 0;
let extracted = 0;
const samples: unknown[] = [];

for (const ev of events) {
  if (!shouldIngest(ev)) continue;
  kept += 1;
  const body =
    (ev.data as { content?: { text?: string }; payload?: string } | undefined)?.content?.text ||
    (ev.data as { payload?: string } | undefined)?.payload;
  if (typeof body === "string" && body.length > 20) withBody += 1;
  if (
    ev.type !== "network.response" &&
    ev.type !== "websocket.received" &&
    ev.type !== "sse.message"
  ) {
    continue;
  }
  const out = await extractFrom(ev);
  if (out.length) {
    extracted += out.length;
    for (const { event: s, dedupId } of out) {
      if (samples.length < 10) {
        samples.push({
          dedupId,
          type: s.type,
          from: s.from,
          text: (s.text || "").slice(0, 100),
          evidenceUrl: String(
            (ev.data as { url?: string } | undefined)?.url || ev.url || "",
          ).slice(0, 120),
        });
      }
    }
  }
}

console.log(
  JSON.stringify({ total: events.length, kept, withBody, extractedMsgs: extracted, samples }, null, 2),
);
