// Seam test: drive the REAL har-recorder normalization (normalize.js + redact.js)
// exactly as the extension background does, push the resulting activity event to
// the daemon over WS as a recorder, and confirm the daemon perceives + broadcasts
// a resolved semantic event. Proves capture -> daemon end to end, no Chrome.
import { WebSocket } from "ws";
import { networkResponse } from "../../har-recorder/src/core/normalize.js";
import { createIdFactory } from "../../har-recorder/src/core/schema.js";

const WS = "ws://localhost:8787";
const idFn = createIdFactory("e");

// A realistic LinkedIn realtime frame (text buried below id/sender), plus an
// email in a bio field to confirm redaction runs without harming the message.
const frame = {
  "com.linkedin.realtimefrontend.DecoratedEvent": {
    topic: "urn:li-realtime:messagesTopic:urn:li-realtime:myself",
    payload: {
      event: {
        entityUrn: "urn:li:msg:2-seamtest",
        conversationUrn: "urn:li:msg_conversation:2-abc",
        from: {
          "com.linkedin.voyager.messaging.MessagingMember": {
            miniProfile: { firstName: "Dwight", lastName: "Schrute", entityUrn: "urn:li:fs_miniProfile:DWIGHT", bio: "reach me at dwight@schrutefarms.com" },
          },
        },
        eventContent: {
          "com.linkedin.voyager.messaging.event.MessageEvent": {
            attributedBody: { text: "Question. Are you free at 3pm?" },
          },
        },
      },
    },
  },
};

// Exactly what background.pageCaptureToEvents does for a network response.
const activityEvent = networkResponse(
  idFn,
  { ts: 1784341685706, requestId: idFn(), status: 200, mimeType: "application/json", headers: {} },
  { tabId: 101, windowId: 1, url: "https://www.linkedin.com/voyager/api/messaging/conversations", title: "Messaging" },
  { text: JSON.stringify(frame), base64Encoded: false, mimeType: "application/json" }
);

function once(ws, event) {
  return new Promise((resolve) => ws.once(event, resolve));
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("normalized activity event type:", activityEvent.type);
  console.log("redaction check — email scrubbed in body:",
    activityEvent.data.content.text.includes("[REDACTED:email]"));

  const semantic = [];
  const viewer = new WebSocket(WS);
  await once(viewer, "open");
  viewer.send(JSON.stringify({ role: "viewer" }));
  viewer.on("message", (raw) => {
    const env = JSON.parse(raw.toString());
    if (env.kind === "semantic") { semantic.push(env.payload); console.log("SEMANTIC:", JSON.stringify(env.payload)); }
  });

  const recorder = new WebSocket(WS);
  await once(recorder, "open");
  recorder.send(JSON.stringify({ role: "recorder" }));
  recorder.send(JSON.stringify(activityEvent));

  await delay(1500);
  const ok = semantic.length === 1 && semantic[0].text.includes("3pm") && semantic[0].from.name === "Dwight";
  console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"} — real normalize -> daemon -> semantic event.`);
  viewer.close();
  recorder.close();
  process.exit(ok ? 0 : 1);
}

main();
