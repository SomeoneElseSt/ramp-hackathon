import fs from "node:fs";
import { decideIngest, shouldIngest } from "../src/ingest.js";
import { collectEndpointCandidates } from "../src/endpoints.js";
import type { ActivityEvent } from "../src/types.js";

// Stress-test always-on ingest against a real LinkedIn activity-trace from Downloads.
const TRACE =
  process.env.TAMA_TRACE ||
  "/Users/knotintern/Downloads/activity-trace-2026-07-18T16-09-42-007Z.json";

function main(): void {
  if (!fs.existsSync(TRACE)) {
    console.error("missing trace:", TRACE);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(TRACE, "utf8"));
  const events = (raw.events || raw) as ActivityEvent[];
  const reasons = new Map<string, number>();
  let keep = 0;
  let drop = 0;
  const keptUrls: string[] = [];

  for (const ev of events) {
    const d = decideIngest(ev);
    reasons.set(d.reason, (reasons.get(d.reason) || 0) + 1);
    if (d.keep) {
      keep += 1;
      const u = (ev.data as { url?: string } | undefined)?.url || ev.url || "";
      if (u) keptUrls.push(u.slice(0, 120));
    } else drop += 1;
  }

  const candidates = collectEndpointCandidates(events.filter(shouldIngest));
  console.log(`trace events: ${events.length}`);
  console.log(`kept: ${keep}  dropped: ${drop}  keepRate: ${((keep / events.length) * 100).toFixed(1)}%`);
  console.log("drop/keep reasons:");
  [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([r, c]) => console.log(`  ${c}\t${r}`));
  console.log(`endpoint candidates after ingest: ${candidates.length}`);
  candidates.slice(0, 15).forEach((c) => console.log("  ", c.key));

  // Sanity: must keep messenger message APIs if present in trace
  const hasMessengerApi = keptUrls.some((u) =>
    /messengerMessages|messengerConversations|voyagerMessagingGraphQL|voyager\/api\//i.test(u),
  );
  const leakedStatic = keptUrls.some((u) => /static\.licdn|media\.licdn|gstatic\.com/i.test(u));

  if (keep < 5) throw new Error(`kept too few (${keep}) — filter may be over-aggressive`);
  if (keep / events.length > 0.3) {
    throw new Error(`keep rate ${(keep / events.length).toFixed(2)} too high — filter not insane enough`);
  }
  if (leakedStatic) throw new Error("leaked CDN/static host into ingest");
  if (!hasMessengerApi) {
    throw new Error("expected voyager/messenger API requests in kept set");
  }
  // Candidates should come from real API paths, not SPA thread routes.
  if (candidates.some((c) => /\/messaging\/thread\//i.test(c.url) && !/voyager\/api/i.test(c.url))) {
    throw new Error("endpoint candidates include SPA thread routes");
  }

  console.log("\nRESULT: PASS — ingest gate is brutal on LinkedIn slop");
}

main();
