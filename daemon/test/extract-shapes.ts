import { extractFrom } from "../src/extract.js";
import type { ActivityEvent } from "../src/types.js";

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

const gql = {
  data: {
    messengerMessagesBySyncToken: {
      elements: [
        {
          _type: "com.linkedin.messenger.Message",
          entityUrn: "urn:li:msg_message:1",
          backendUrn: "urn:li:messagingMessage:1",
          body: { text: "thank you!" },
          sender: {
            hostIdentityUrn: "urn:li:fsd_profile:A",
            participantType: {
              member: {
                firstName: { text: "Aman" },
                lastName: { text: "Anwar" },
              },
            },
          },
          backendConversationUrn: "urn:li:messagingThread:T",
        },
      ],
    },
  },
};

async function run(label: string, body: unknown) {
  const ev = {
    id: "t1",
    type: "network.response",
    ts: 1,
    tabId: 1,
    url: "https://www.linkedin.com/messaging/",
    data: {
      url: "https://www.linkedin.com/voyager/api/graphql?query=msg",
      content: { text: JSON.stringify(body) },
    },
  } as ActivityEvent;
  const out = await extractFrom(ev);
  const slim = out.map((o) => ({
    text: o.event.text,
    from: o.event.from,
    id: o.dedupId,
  }));
  console.log(label, JSON.stringify(slim, null, 2));
  if (out.length === 0) {
    console.error(`FAIL: ${label} extracted 0 messages`);
    process.exitCode = 1;
  }
}

await run("decorated", linkedinFrame);
await run("generic", genericChat);
await run("graphql", gql);
