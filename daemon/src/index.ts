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

process.stdin.on("end", () => {
  log("MCP stdin closed — WS bridge + listeners stay up until process exit");
});
