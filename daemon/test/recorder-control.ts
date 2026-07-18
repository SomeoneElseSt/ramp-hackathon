import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import type { ActivityEvent, RecorderControl } from "../src/types.js";

// Proves daemon → recorder control plane: create_listener pushes {kind:"watch"}
// with pageUrl + endpoints to the extension (recorder role).
async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "recorder-control-test", version: "0.1.0" });
  await client.connect(transport);

  const controls: RecorderControl[] = [];
  const recorder = new WebSocket("ws://localhost:8787");
  await once(recorder, "open");
  recorder.on("message", (raw) => {
    try {
      controls.push(JSON.parse(String(raw)) as RecorderControl);
    } catch {
      /* ignore */
    }
  });
  recorder.send(JSON.stringify({ role: "recorder" }));
  await sleep(200);

  // Seed discovery so pageUrl/endpoints resolve.
  for (let i = 0; i < 30; i++) {
    const ev: ActivityEvent = {
      id: `e_rc_${i}`,
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
        content: { text: '{"elements":[]}' },
      },
    };
    recorder.send(JSON.stringify(ev));
  }
  await sleep(600);

  const createRes = await client.callTool({
    name: "create_listener",
    arguments: { intent: "new LinkedIn messages" },
  });
  const created = JSON.parse(textOf(createRes)) as { subId: string; pageUrl: string | null };
  console.log("MCP create_listener:", created.subId, created.pageUrl);
  await sleep(400);

  const watchMsg = controls.find((c) => c.kind === "watch");
  const syncMsg = controls.find((c) => c.kind === "listeners");
  if (!watchMsg || watchMsg.kind !== "watch") {
    throw new Error(`expected watch control, got: ${JSON.stringify(controls)}`);
  }
  if (!watchMsg.payload.pageUrl?.includes("linkedin.com")) {
    throw new Error(`watch missing pageUrl: ${JSON.stringify(watchMsg)}`);
  }
  if (!watchMsg.payload.endpoints?.length) {
    throw new Error(`watch missing endpoints: ${JSON.stringify(watchMsg)}`);
  }
  console.log("got watch:", watchMsg.payload.pageUrl, watchMsg.payload.endpoints[0]);
  if (!syncMsg || syncMsg.kind !== "listeners") {
    console.warn("no listeners sync yet (ok if watch arrived first)");
  }

  await client.callTool({ name: "remove_listener", arguments: { subId: created.subId } });
  await sleep(300);
  const unwatch = controls.find((c) => c.kind === "unwatch");
  if (!unwatch || unwatch.kind !== "unwatch" || unwatch.payload.subId !== created.subId) {
    throw new Error(`expected unwatch for ${created.subId}, got ${JSON.stringify(controls.filter((c) => c.kind === "unwatch"))}`);
  }
  console.log("got unwatch:", unwatch.payload.subId);

  // Late recorder gets listeners snapshot on connect.
  const late: RecorderControl[] = [];
  const recorder2 = new WebSocket("ws://localhost:8787");
  await once(recorder2, "open");
  recorder2.on("message", (raw) => {
    try {
      late.push(JSON.parse(String(raw)) as RecorderControl);
    } catch {
      /* ignore */
    }
  });
  // Re-create a listener, then connect late recorder — actually test empty sync first
  recorder2.send(JSON.stringify({ role: "recorder" }));
  await sleep(200);
  const lateSync = late.find((c) => c.kind === "listeners");
  if (!lateSync || lateSync.kind !== "listeners") {
    throw new Error("late recorder did not receive listeners snapshot");
  }
  console.log("late recorder sync active=", lateSync.payload.active.length);

  recorder.close();
  recorder2.close();
  await client.close();
  console.log("\nRESULT: PASS — daemon pushes watch/unwatch/listeners to recorders");
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
