/**
 * Live ops: prolonged LinkedIn DM listener.
 * MCP create_listener once, drain pending, watermark=now, then loop wait_for_event.
 * Only NEW events (ts >= sinceTs) wake — not history scrape.
 *
 * Run: cd daemon && npx tsx test/ops-listen.ts
 * Status: daemon/test/LISTENING_ARMED.txt when armed.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DAEMON_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_PATH = resolve(DAEMON_ROOT, "test/LISTENING_ARMED.txt");
/** MCP SDK defaults to 60s; wait_for_event must block indefinitely for prolonged listen. */
const WAIT_TIMEOUT_MS = Number(process.env.OPS_LISTEN_TIMEOUT_MS ?? 24 * 60 * 60 * 1000);

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
    cwd: DAEMON_ROOT,
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
    sinceTs?: number;
  };
  console.log("[ops] create_listener:", JSON.stringify(created, null, 2));
  if (!created.subId) throw new Error("create_listener missing subId");
  if (!created.pageUrl?.includes("linkedin.com/messaging")) {
    console.warn("[ops] WARN: pageUrl not messaging —", created.pageUrl);
  }

  // Drain pending so old buffer can't wake; watermark = arm time.
  try {
    await client.callTool({ name: "get_listener_events", arguments: { subId: created.subId } });
  } catch {
    /* ignore */
  }
  await sleep(800);
  try {
    await client.callTool({ name: "get_listener_events", arguments: { subId: created.subId } });
  } catch {
    /* ignore */
  }

  const watermark = created.sinceTs ?? Date.now();
  console.log(`WATERMARK=${watermark}`);
  console.log("LISTENING_NEW_ONLY");

  let wakeCount = 0;
  writeArmed({
    at: new Date().toISOString(),
    watermark,
    sinceTs: watermark,
    subId: created.subId,
    pageUrl: created.pageUrl,
    label: created.label,
    mode: "prolonged-new-only",
    status: "LISTENING",
    port: 8787,
    wakeCount,
    note: "LISTENING_NEW_ONLY — event-forward from watermark; old Hi/Sup never wake",
  });
  console.log("LISTENING_ARMED");
  console.log(
    `LOCKED_IN daemon=up recorder=check-lsof subId=${created.subId} WATERMARK=${watermark} LISTENING`,
  );
  console.log("[ops] status →", STATUS_PATH);
  console.log(
    `[ops] prolonged wait_for_event(${created.subId}) — NEW only (ts>=${watermark}); Ctrl-C to stop`,
  );

  for (;;) {
    console.log(`[ops] waiting… (wakes so far: ${wakeCount})`);
    try {
      const result = await client.callTool(
        { name: "wait_for_event", arguments: { subId: created.subId } },
        undefined,
        { timeout: WAIT_TIMEOUT_MS },
      );
      wakeCount += 1;
      const payload = textOf(result);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        parsed = { raw: payload };
      }
      console.log(`[ops] WAKE #${wakeCount} — wait_for_event returned:`);
      console.log(
        JSON.stringify({
          from: parsed.from ?? null,
          text: parsed.text ?? null,
          type: parsed.type ?? null,
          conversationId: parsed.conversationId ?? null,
          ts: parsed.ts ?? null,
          subId: created.subId,
        }),
      );
      console.log("[ops] semantic:", JSON.stringify(parsed, null, 2));
      writeArmed({
        at: new Date().toISOString(),
        watermark,
        subId: created.subId,
        pageUrl: created.pageUrl,
        label: created.label,
        mode: "prolonged-new-only",
        status: "LISTENING",
        port: 8787,
        wakeCount,
        lastWakeAt: new Date().toISOString(),
        lastWake: { from: parsed.from ?? null, text: parsed.text ?? null },
        note: "LISTENING_NEW_ONLY — re-armed after wake; send more DMs anytime",
      });
      console.log(`[ops] re-armed — listening again (total wakes: ${wakeCount})`);
    } catch (err) {
      console.error("[ops] wait_for_event failed — re-arming in 2s:", err);
      writeArmed({
        at: new Date().toISOString(),
        watermark,
        subId: created.subId,
        pageUrl: created.pageUrl,
        label: created.label,
        mode: "prolonged-new-only",
        status: "LISTENING",
        wakeCount,
        note: "LISTENING_NEW_ONLY — wait failed; re-arming; listener stays registered",
        lastError: String(err),
      });
      await sleep(2000);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
