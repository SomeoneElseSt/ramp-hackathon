import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import type { ActivityEvent } from "../src/types.js";

// Proves Tama MCP listener hub: organic discovery → list_listeners →
// create_listener → wait_for_event on a LinkedIn-shaped message payload.
async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "tama-hub-test", version: "0.1.0" });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  const required = [
    "create_listener",
    "list_listeners",
    "wait_for_event",
    "get_listener_events",
    "remove_listener",
    "propose_workflows",
    "subscribe",
  ];
  for (const name of required) {
    if (!tools.includes(name)) throw new Error(`missing tool: ${name}`);
  }
  console.log("tools ok:", tools.join(", "));

  const recorder = new WebSocket("ws://localhost:8787");
  await once(recorder, "open");
  recorder.send(JSON.stringify({ role: "recorder" }));

  // Feed enough voyager messaging traffic to trigger discovery (every 25 events).
  for (let i = 0; i < 30; i++) {
    const ev: ActivityEvent = {
      id: `e_disc_${i}`,
      type: "network.response",
      ts: Date.now() + i,
      tabId: 1,
      url: "https://www.linkedin.com/messaging/",
      data: {
        method: "GET",
        url: "https://www.linkedin.com/voyager/api/messaging/conversations",
        resourceType: "Fetch",
        mimeType: "application/json",
        status: 200,
        content: {
          text: JSON.stringify({
            elements: [],
          }),
        },
      },
    };
    recorder.send(JSON.stringify(ev));
  }
  await sleep(800);

  const listRes = await client.callTool({ name: "list_listeners", arguments: {} });
  const listed = JSON.parse(textOf(listRes)) as {
    capabilities: Array<{ label: string; eventType: string }>;
    active: unknown[];
  };
  console.log("capabilities:", listed.capabilities.map((c) => c.label).join(", ") || "(none)");
  const hasMessage = listed.capabilities.some((c) => c.label === "New message");
  if (!hasMessage) throw new Error("expected organic 'New message' capability from voyager traffic");

  const createRes = await client.callTool({
    name: "create_listener",
    arguments: { intent: "new LinkedIn messages" },
  });
  const { subId } = JSON.parse(textOf(createRes)) as { subId: string };
  console.log("created listener:", subId);

  const waitPromise = client.callTool({ name: "wait_for_event", arguments: { subId } });

  setTimeout(() => {
    const ev: ActivityEvent = {
      id: "e_li_msg_1",
      type: "network.response",
      ts: Date.now(),
      tabId: 1,
      url: "https://www.linkedin.com/voyager/api/messaging/conversations",
      data: {
        method: "GET",
        url: "https://www.linkedin.com/voyager/api/messaging/conversations",
        resourceType: "Fetch",
        mimeType: "application/json",
        content: {
          text: JSON.stringify({
            id: "msg-li-9",
            sender: { name: "Raphael Husbands", id: "urn:li:fsd_profile:abc" },
            text: "Okay",
          }),
        },
      },
    };
    recorder.send(JSON.stringify(ev));
    console.log("pushed LinkedIn-shaped DM while agent blocked");
  }, 500);

  const waited = textOf(await waitPromise);
  console.log("wait_for_event:", waited);
  if (!waited.includes("Raphael") && !waited.includes("Okay")) {
    throw new Error("wait_for_event did not return expected message");
  }

  const proposals = JSON.parse(
    textOf(await client.callTool({ name: "propose_workflows", arguments: { limit: 3 } })),
  ) as unknown[];
  console.log("proposals:", proposals.length);

  const removed = JSON.parse(
    textOf(await client.callTool({ name: "remove_listener", arguments: { subId } })),
  ) as { removed: string };
  if (removed.removed !== subId) throw new Error("remove_listener failed");

  recorder.close();
  await client.close();
  console.log("\nRESULT: PASS — Tama MCP hub + organic discovery + LinkedIn-shaped fire");
  process.exit(0);
}

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}
function once(ws: WebSocket, event: string): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
