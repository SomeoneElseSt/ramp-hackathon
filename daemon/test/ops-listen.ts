/**
 * Live ops: act like Codex — MCP create_listener → wait_for_event on LinkedIn DMs.
 * Spawns daemon over stdio (bridge :8787 + Tama MCP). Extension must reconnect.
 *
 * Run: cd daemon && npx tsx test/ops-listen.ts
 * Status: daemon/test/LISTENING_ARMED.txt when armed.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TIMEOUT_MS = Number(process.env.OPS_LISTEN_TIMEOUT_MS ?? 8 * 60 * 1000);
const STATUS_PATH = resolve(process.cwd(), "test/LISTENING_ARMED.txt");

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  const armed = {
    at: new Date().toISOString(),
    subId: created.subId,
    pageUrl: created.pageUrl,
    label: created.label,
    timeoutMs: TIMEOUT_MS,
    note: "LISTENING_ARMED — send a LinkedIn message now; agent blocked on wait_for_event",
  };
  writeFileSync(STATUS_PATH, JSON.stringify(armed, null, 2) + "\n");
  console.log("LISTENING_ARMED");
  console.log("[ops] status →", STATUS_PATH);
  console.log(`[ops] wait_for_event(${created.subId}) timeout=${TIMEOUT_MS}ms — send a LinkedIn DM`);

  const waitPromise = client.callTool({
    name: "wait_for_event",
    arguments: { subId: created.subId },
  });

  const result = await Promise.race([
    waitPromise.then((r) => ({ kind: "event" as const, r })),
    sleep(TIMEOUT_MS).then(() => ({ kind: "timeout" as const })),
  ]);

  if (result.kind === "timeout") {
    console.error("[ops] TIMEOUT — no semantic event within", TIMEOUT_MS, "ms");
    console.error(
      "[ops] diagnosis: check daemon stderr for recorder connect + activity; popup Ambient on; messaging tab open; real network response on send/receive",
    );
    try {
      const drained = textOf(
        await client.callTool({ name: "get_listener_events", arguments: { subId: created.subId } }),
      );
      console.error("[ops] get_listener_events drain:", drained);
    } catch (e) {
      console.error("[ops] drain failed:", e);
    }
    await client.close();
    process.exit(2);
  }

  const payload = textOf(result.r);
  console.log("[ops] WAKE — wait_for_event returned:");
  console.log(payload);
  try {
    console.log("[ops] semantic:", JSON.stringify(JSON.parse(payload), null, 2));
  } catch {
    /* raw text */
  }

  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
