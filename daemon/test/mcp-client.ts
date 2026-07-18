import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import type { ActivityEvent } from "../src/types.js";

// Verifies CONTRACT §3: an MCP client spawns the daemon over stdio, subscribes,
// blocks on wait_for_event, and unblocks when a recorder pushes a matching event.
async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "reflex-test-client", version: "0.1.0" });
  await client.connect(transport);
  console.log("connected to daemon over stdio");

  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));

  const subRes = await client.callTool({ name: "subscribe", arguments: { intent: "new messages" } });
  const sub = JSON.parse(textOf(subRes)) as { subId: string };
  const { subId } = sub;
  console.log("subscribed:", subId);

  // Give the daemon's WS bridge a moment, then push an event AFTER we start waiting.
  const recorder = new WebSocket("ws://localhost:8787");
  await once(recorder, "open");
  recorder.send(JSON.stringify({ role: "recorder" }));

  console.log("calling wait_for_event (blocks)...");
  const waitPromise = client.callTool({ name: "wait_for_event", arguments: { subId } });

  setTimeout(() => {
    const ev: ActivityEvent = {
      id: "e_mcp_1",
      type: "network.response",
      ts: 1784341685706,
      tabId: 1,
      url: "https://chat.example.com/api/messages",
      data: {
        content: {
          text: JSON.stringify({
            id: "m-501",
            sender: { name: "Priya Shah", id: "u_9" },
            text: "The contract is signed 🎉",
          }),
        },
      },
    };
    recorder.send(JSON.stringify(ev));
    console.log("pushed event while agent was blocked");
  }, 600);

  const result = await waitPromise;
  console.log("wait_for_event RETURNED:", textOf(result));

  recorder.close();
  await client.close();
  const ok = textOf(result).includes("Priya Shah");
  console.log(`\nRESULT: ${ok ? "PASS" : "FAIL"} — blocking reactive primitive works.`);
  process.exit(ok ? 0 : 1);
}

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}
function once(ws: WebSocket, event: string): Promise<void> {
  return new Promise((resolve) => ws.once(event, () => resolve()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
