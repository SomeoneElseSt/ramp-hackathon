import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { startBridge } from "./bridge.js";
import { startMcpServer } from "./server.js";
import { log } from "./logger.js";

// Load .env from the daemon dir and the repo root (one level up).
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../.env") });

// Exclusive ownership: this process binds :8787 AND speaks MCP on stdio.
// Order matters — bridge must listen successfully BEFORE MCP connects.
// Never log "Tama MCP connected" then die on EADDRINUSE.
async function main(): Promise<void> {
  await startBridge();
  await startMcpServer();
}

main().catch((err) => {
  console.error("[tama] failed to start:", err);
  process.exit(1);
});

// Cursor reloads MCP by closing stdin. Exit so :8787 is released for the
// next spawn — orphaned bridges cause EADDRINUSE on every reconnect.
function shutdownOnStdinClose(reason: string): void {
  log(`MCP stdin ${reason} — exiting so :8787 is free for reload`);
  process.exit(0);
}
process.stdin.on("end", () => shutdownOnStdinClose("closed"));
process.stdin.on("close", () => shutdownOnStdinClose("close"));
if (process.stdin.isTTY === false) {
  process.stdin.resume(); // keep readable so 'end' fires when Cursor disconnects
}
