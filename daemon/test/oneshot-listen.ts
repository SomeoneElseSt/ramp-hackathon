/**
 * One-shot LinkedIn DM wait — create_listener, drain, watermark=now, wait_for_event.
 * Exit 0 on first NEW message with from/text. Old Hi/Sup never wake.
 *
 * Spawns the daemon (stdio MCP + :8787 bridge) — do NOT also run `npm run dev`.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DAEMON_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_PATH = resolve(DAEMON_ROOT, "test/LISTENING_ARMED.txt");
const WAIT_TIMEOUT_MS = Number(process.env.OPS_LISTEN_TIMEOUT_MS ?? 10 * 60 * 1000);

function textOf(res: unknown): string {
  const content = (res as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickMessage(
  ev: Record<string, unknown>,
): { from: unknown; text: unknown; type: unknown; conversationId: unknown; ts: unknown } | null {
  if (!ev || typeof ev !== "object") return null;
  const type = ev.type;
  if (type !== "message.received") return null;
  return {
    from: ev.from ?? null,
    text: ev.text ?? null,
    type,
    conversationId: ev.conversationId ?? null,
    ts: ev.ts ?? null,
  };
}

function reportAndExit(subId: string, picked: NonNullable<ReturnType<typeof pickMessage>>, full: unknown): never {
  console.log("WAKE");
  console.log(JSON.stringify({ ...picked, subId }));
  console.log("[oneshot] full:", typeof full === "string" ? full : JSON.stringify(full));
  process.exit(0);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: DAEMON_ROOT,
    stderr: "inherit",
  });
  const client = new Client({ name: "tama-oneshot-listen", version: "0.1.0" });
  await client.connect(transport);
  console.log("[oneshot] MCP connected (stdio → daemon :8787)");
  await sleep(3500);

  const createRes = await client.callTool({
    name: "create_listener",
    arguments: { intent: "wake me on new LinkedIn DMs / messages" },
  });
  const created = JSON.parse(textOf(createRes)) as {
    subId: string;
    pageUrl: string | null;
    label: string | null;
    sinceTs?: number;
  };
  console.log("[oneshot] create_listener:", JSON.stringify(created, null, 2));
  const subId = created.subId;
  if (!subId) throw new Error("create_listener missing subId");

  // Drain any stale pending so we ONLY wake on a NEW message.received.
  try {
    await client.callTool({ name: "get_listener_events", arguments: { subId } });
  } catch {
    /* ignore */
  }
  await sleep(500);
  try {
    await client.callTool({ name: "get_listener_events", arguments: { subId } });
  } catch {
    /* ignore */
  }

  const watermark = created.sinceTs ?? Date.now();
  console.log(`WATERMARK=${watermark}`);
  console.log("LISTENING_NEW_ONLY");

  writeFileSync(
    STATUS_PATH,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        watermark,
        sinceTs: watermark,
        subId,
        pageUrl: created.pageUrl,
        label: created.label,
        mode: "oneshot-new-only",
        port: 8787,
        status: "LISTENING",
        note: "LISTENING_NEW_ONLY — waiting for NEXT LinkedIn message.received (ts >= watermark)",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("LISTENING_ARMED");
  console.log(
    `LOCKED_IN daemon=up subId=${subId} WATERMARK=${watermark} LISTENING status=${STATUS_PATH}`,
  );

  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1000, deadline - Date.now());
      const result = await client.callTool(
        { name: "wait_for_event", arguments: { subId } },
        undefined,
        { timeout: remaining },
      );
      const payload = textOf(result);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        parsed = { raw: payload };
      }
      const picked = pickMessage(parsed);
      if (!picked) {
        console.log("[oneshot] ignore non-message.received — re-arming");
        continue;
      }
      // Daemon already filters ts < sinceTs; client double-check for safety.
      const ts = typeof picked.ts === "number" ? picked.ts : null;
      if (ts != null && ts < watermark) {
        console.log("[oneshot] ignore pre-watermark:", JSON.stringify({ text: picked.text, ts, watermark }));
        continue;
      }
      writeFileSync(
        STATUS_PATH,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            status: "WAKE",
            subId,
            watermark,
            picked,
          },
          null,
          2,
        ) + "\n",
      );
      await client.close().catch(() => {});
      reportAndExit(subId, picked, payload);
    }
    console.error("TIMEOUT/FAIL");
    console.error("[oneshot] deadline reached with no NEW message.received");
    await client.close().catch(() => {});
    process.exit(1);
  } catch (err) {
    console.error("TIMEOUT/FAIL");
    console.error("[oneshot] wait_for_event failed/timed out");
    console.error(err);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
