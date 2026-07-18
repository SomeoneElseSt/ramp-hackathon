import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { startBridge } from "./bridge.js";
import { startMcpServer } from "./server.js";
import { log } from "./logger.js";

// Load .env from the daemon dir and the repo root (one level up).
loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), "../.env") });

// The WS bridge is always up so the extension (recorder) and demo (viewer) can
// connect. The MCP server shares this process and talks over stdio.
startBridge();

startMcpServer().catch((err) => {
  log("MCP server failed to start:", err);
});
