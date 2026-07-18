import { WebSocket } from "ws";
import type { ActivityEvent, ViewerEnvelope } from "../src/types.js";

// End-to-end harness: connect a viewer (like demo/tamagent.html) and a recorder
// (like the extension), push realistic activity events, and print what the
// viewer receives. Proves the daemon perceives + broadcasts semantic events.
const WS = "ws://localhost:8787";

function makeEvent(partial: Partial<ActivityEvent> & { id: string; type: string }): ActivityEvent {
  return { ts: 1784341685706, tabId: 101, url: null, data: {}, ...partial };
}

// A realistic LinkedIn realtime frame: text is buried below the id/sender.
const linkedinFrame = {
  "com.linkedin.realtimefrontend.DecoratedEvent": {
    topic: "urn:li-realtime:messagesTopic:urn:li-realtime:myself",
    payload: {
      event: {
        entityUrn: "urn:li:msg:2-abc123",
        conversationUrn: "urn:li:msg_conversation:2-xyz",
        from: {
          "com.linkedin.voyager.messaging.MessagingMember": {
            miniProfile: {
              firstName: "Raphael",
              lastName: "Husbands",
              entityUrn: "urn:li:fs_miniProfile:RAPH",
            },
          },
        },
        eventContent: {
          "com.linkedin.voyager.messaging.event.MessageEvent": {
            attributedBody: { text: "Okay sounds good, talk soon" },
          },
        },
      },
    },
  },
};

// A generic chat API on a totally different site (proves generality).
const genericChat = {
  messages: [
    {
      id: "m-778",
      conversationId: "c-2",
      sender: { name: "Dana Lopez", id: "user_88" },
      text: "Are we still on for 3pm?",
    },
  ],
};

// Noise that must NOT produce a semantic event.
const telemetry = { events: [{ metric: "page_view", value: 1 }], ts: 1 };

const events: ActivityEvent[] = [
  makeEvent({
    id: "e_li_1",
    type: "network.response",
    url: "https://www.linkedin.com/voyager/api/messaging/conversations",
    data: { status: 200, mimeType: "application/json", content: { text: JSON.stringify(linkedinFrame) } },
  }),
  makeEvent({
    id: "e_li_dup",
    type: "network.response",
    url: "https://www.linkedin.com/voyager/api/messaging/conversations",
    data: { status: 200, mimeType: "application/json", content: { text: JSON.stringify(linkedinFrame) } },
  }),
  makeEvent({
    id: "e_gc_1",
    type: "network.response",
    url: "https://chat.example.com/api/v2/inbox/messages",
    data: { status: 200, mimeType: "application/json", content: { text: JSON.stringify(genericChat) } },
  }),
  makeEvent({
    id: "e_noise",
    type: "network.response",
    url: "https://www.linkedin.com/li/track",
    data: { status: 200, mimeType: "application/json", content: { text: JSON.stringify(telemetry) } },
  }),
];

async function main(): Promise<void> {
  const semanticSeen: unknown[] = [];
  const viewer = new WebSocket(WS);
  await once(viewer, "open");
  viewer.send(JSON.stringify({ role: "viewer" }));
  viewer.on("message", (raw) => {
    const env = JSON.parse(raw.toString()) as ViewerEnvelope;
    if (env.kind === "semantic") {
      semanticSeen.push(env.payload);
      console.log("VIEWER semantic:", JSON.stringify(env.payload));
    }
  });

  const recorder = new WebSocket(WS);
  await once(recorder, "open");
  recorder.send(JSON.stringify({ role: "recorder" }));
  for (const ev of events) {
    recorder.send(JSON.stringify(ev));
    await delay(150);
  }

  await delay(1500);
  console.log(`\nRESULT: ${semanticSeen.length} semantic event(s) broadcast (expected 2: LinkedIn + generic; dup + telemetry suppressed).`);
  viewer.close();
  recorder.close();
  process.exit(semanticSeen.length === 2 ? 0 : 1);
}

function once(ws: WebSocket, event: string): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
