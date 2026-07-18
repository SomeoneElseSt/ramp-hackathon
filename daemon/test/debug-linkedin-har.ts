/**
 * Debug LinkedIn capture → ingest → extract on a real activity-trace / network dump.
 *
 *   npx tsx test/debug-linkedin-har.ts [path-to-activity-trace.json]
 *
 * Explains why live DM wake is hard and what the HAR actually contains.
 */
import fs from "node:fs";
import { decideIngest } from "../src/ingest.js";
import { extractFrom } from "../src/extract.js";
import type { ActivityEvent } from "../src/types.js";

const TRACE =
  process.argv[2] ||
  "/Users/knotintern/Downloads/activity-trace-2026-07-18T16-09-42-007Z.json";

const data = JSON.parse(fs.readFileSync(TRACE, "utf8"));
const events = (data.events || data) as ActivityEvent[];

console.log(`\n=== LinkedIn HAR/trace debug ===\nfile: ${TRACE}\nevents: ${events.length}\n`);

const dropReasons = new Map<string, number>();
const keepReasons = new Map<string, number>();
const texts: { text: string; from: string | null; deliveredAt: number; captureTs: number; url: string }[] = [];
let messengerBodies = 0;
let truncatedMessenger = 0;
let wsEvents = 0;
let extractMissWithType = 0;

for (const ev of events) {
  if (ev.type?.startsWith("websocket") || ev.type?.startsWith("sse")) wsEvents += 1;
  const d = (ev.data || {}) as Record<string, unknown>;
  const content = d.content as { text?: string; truncated?: boolean } | undefined;
  const body = (content?.text || (d.payload as string) || "") as string;
  const url = String((d.url as string) || ev.url || "");
  const hasMessenger = /com\.linkedin\.messenger\.Message|messengerMessagesBySyncToken/i.test(body);
  if (hasMessenger) {
    messengerBodies += 1;
    if (content?.truncated || body.length === 32768) truncatedMessenger += 1;
  }

  const dec = decideIngest(ev);
  if (!dec.keep) {
    dropReasons.set(dec.reason, (dropReasons.get(dec.reason) || 0) + 1);
    continue;
  }
  keepReasons.set(dec.reason, (keepReasons.get(dec.reason) || 0) + 1);

  if (
    ev.type !== "network.response" &&
    ev.type !== "websocket.received" &&
    ev.type !== "sse.message"
  ) {
    continue;
  }
  if (typeof body !== "string" || body.length < 20) continue;

  const out = await extractFrom(ev);
  if (out.length === 0 && hasMessenger && !/SeenReceipt|QuickReplies/i.test(body)) {
    extractMissWithType += 1;
  }
  for (const { event: s } of out) {
    texts.push({
      text: (s.text || "").slice(0, 100),
      from: s.from?.name ?? null,
      deliveredAt: s.ts,
      captureTs: ev.ts,
      url: url.slice(0, 100),
    });
  }
}

texts.sort((a, b) => b.deliveredAt - a.deliveredAt);

console.log("--- funnel ---");
console.log("websocket/sse events:", wsEvents, wsEvents === 0 ? "(NONE — live push may be invisible)" : "");
console.log("bodies with messenger.Message / syncToken:", messengerBodies);
console.log("truncated ~32KB messenger bodies:", truncatedMessenger);
console.log("kept:", [...keepReasons.entries()].map(([k, n]) => `${k}=${n}`).join(", "));
console.log("top drops:", [...dropReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
console.log("extract misses (Message type, not receipts):", extractMissWithType);
console.log("extracted message texts:", texts.length);

console.log("\n--- newest by deliveredAt (what watermark should allow) ---");
for (const t of texts.slice(0, 10)) {
  const skewMin = Math.round((t.captureTs - t.deliveredAt) / 60000);
  console.log(
    `  [${t.deliveredAt}] ${t.from}: "${t.text}"  (capture was ${skewMin}min later)`,
  );
}

const arm = Date.now();
const wakeable = texts.filter((t) => t.deliveredAt >= arm - 60_000);
console.log("\n--- if you armed NOW, only deliveredAt within last 60s would wake ---");
console.log("wakeable count:", wakeable.length, wakeable.length ? wakeable : "(history-only capture — send a NEW dm after arm)");

console.log(`
--- why live is hard ---
1. This capture is mostly messengerMessages GET *history sync*, not a send mutation.
2. deliveredAt << capture time — watermark correctly ignores old sync rows.
3. 0 websocket frames in activity-trace — LinkedIn realtime may not hit our page interceptor.
4. Old captures truncated bodies at 32KB (fixed to 256KB) and stamped page URL not voyager URL.
5. Cancelling wait_for_event used to drop the DM into an abandoned promise (fixed: pending-first).

Live recipe: Sit ambient ON messaging tab → create_listener → send NEW dm → watch
mcp-server-user-tama.log for "extract" / "notice" lines.
`);
