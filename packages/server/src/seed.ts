import type { Listener } from "@companion/shared";
import { getListener, upsertListener } from "./db.js";

// The hardcoded reference listener (build step 2). Watches LinkedIn's realtime
// message stream deterministically; the classifier only refines genuinely-new
// frames. Discovery can later produce better matchers from live traffic.
export const LINKEDIN_SEED_ID = "seed-linkedin-messages";

const seed: Listener = {
  id: LINKEDIN_SEED_ID,
  name: "LinkedIn — new messages",
  site: "www.linkedin.com",
  prompt: "Tell me when I get a new LinkedIn direct message",
  matcher: {
    mode: "realtime",
    // LinkedIn keeps a long-lived streaming GET open here; new events arrive as
    // JSON frames. The extension splits the stream into one frame per capture.
    urlPattern: "/realtime/connect",
    framePath: "",
    // Deterministic gate: only message-bearing frames pass (drops typing/presence).
    eventTypeMatch: "MessageEvent",
    // Best-effort dedup key; falls back to a hash of the frame if absent.
    dedupKeyPath:
      "com.linkedin.realtimefrontend.DecoratedEvent.payload.event.entityUrn",
    relevanceHint:
      "Fire only for a genuinely new INBOUND direct message from someone else. " +
      "Do NOT fire for typing indicators, read receipts, presence, or messages you sent yourself.",
  },
  requiresClassification: true,
  action: { type: "log", requiresApproval: false },
  source: "seed",
  active: true,
  createdAt: 0,
};

export function ensureSeed(): void {
  if (getListener(LINKEDIN_SEED_ID)) return;
  upsertListener(seed);
  console.log(`[seed] installed listener "${seed.name}" (${seed.id})`);
}
