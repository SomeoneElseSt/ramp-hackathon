/**
 * Live ops: prolonged LinkedIn DM listener.
 * MCP create_listener once, then loop wait_for_event forever (Ctrl-C / kill to stop).
 * Listener stays registered; each wake is logged and wait is re-armed.
 *
 * Run: cd daemon && npx tsx test/ops-listen.ts
 * Status: daemon/test/LISTENING_ARMED.txt when armed.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const STATUS_PATH = resolve(process.cwd(), "test/LISTENING_ARMED.txt");

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function writeArmed(payload: Record<string, unknown>): void {
  writeFileSync(STATUS_PATH, JSON.stringify(payload, null, 2) + "\n");
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: process.cwd(),
    stderr: "inherit",
  });
  const client = new Client({ name: "ops-live-listen", version: "0.1.0" });
  await client.connect(transport);
  console.log("[ops] MCP connected (stdio → daemon bridge :8787)");

  // Give har-recorder time to reconnect as recorder after port free-up.
  console.log("[ops] waiting for extension recorder to reconnect…");
  await sleep(4000);

  const createRes = await client.callTool({
    name: "create_listener",
    arguments: { intent: "wake me on new LinkedIn DMs / messages" },
  });
  const created = JSON.parse(textOf(createRes)) as {
    subId: string;
    pageUrl: string | null;
    endpoints: string[];
    keywords: string[];
    label: string | null;
  };
  console.log("[ops] create_listener:", JSON.stringify(created, null, 2));
  if (!created.subId) throw new Error("create_listener missing subId");
  if (!created.pageUrl?.includes("linkedin.com/messaging")) {
    console.warn("[ops] WARN: pageUrl not messaging —", created.pageUrl);
  }

  let wakeCount = 0;
  writeArmed({
    at: new Date().toISOString(),
    subId: created.subId,
    pageUrl: created.pageUrl,
    label: created.label,
    mode: "prolonged",
    wakeCount,
    note: "LISTENING_ARMED — prolonged bg listen; send LinkedIn DMs anytime; Ctrl-C to stop",
  });
  console.log("LISTENING_ARMED");
  console.log("[ops] status →", STATUS_PATH);
  console.log(
    `[ops] prolonged wait_for_event(${created.subId}) — looping until killed; send LinkedIn DMs`,
  );

  // Stay up: re-arm wait_for_event after every wake. Listener remains registered.
  for (;;) {
    console.log(`[ops] waiting… (wakes so far: ${wakeCount})`);
    const result = await client.callTool({
      name: "wait_for_event",
      arguments: { subId: created.subId },
    });
    wakeCount += 1;
    const payload = textOf(result);
    console.log(`[ops] WAKE #${wakeCount} — wait_for_event returned:`);
    console.log(payload);
    try {
      console.log("[ops] semantic:", JSON.stringify(JSON.parse(payload), null, 2));
    } catch {
      /* raw text */
    }
    writeArmed({
      at: new Date().toISOString(),
      subId: created.subId,
      pageUrl: created.pageUrl,
      label: created.label,
      mode: "prolonged",
      wakeCount,
      lastWakeAt: new Date().toISOString(),
      note: "LISTENING_ARMED — prolonged bg listen; re-armed after wake; send more DMs anytime",
    });
    console.log(`[ops] re-armed — listening again (total wakes: ${wakeCount})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
