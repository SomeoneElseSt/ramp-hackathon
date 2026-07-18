import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { perceiver } from "./perceive.js";
import { log } from "./logger.js";

// CONTRACT §3: the reactive MCP surface. subscribe (NL intent) → wait_for_event
// (blocks on a real event) → get_recent_events (non-blocking drain).
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "reflex", version: "0.1.0" });

  server.tool(
    "subscribe",
    "Register interest in web events described in natural language (e.g. 'new messages'). Returns a subId used to wait for or drain events. Narrows which endpoints are inspected.",
    { intent: z.string(), types: z.array(z.string()).optional() },
    async ({ intent, types }) => {
      const subId = await perceiver.subscribe(intent, types);
      return text({ subId });
    }
  );

  server.tool(
    "wait_for_event",
    "Block until the next event matching the subscription arrives, then return the resolved semantic event. This is the reactive primitive — it does not poll.",
    { subId: z.string() },
    async ({ subId }) => {
      const pending = perceiver.waitForEvent(subId);
      if (!pending) return errorText(`unknown subId: ${subId}`);
      const event = await pending;
      return text(event);
    }
  );

  server.tool(
    "get_recent_events",
    "Non-blocking drain of matched-but-undelivered events for a subscription.",
    { subId: z.string() },
    async ({ subId }) => {
      const events = perceiver.getRecentEvents(subId);
      if (events === null) return errorText(`unknown subId: ${subId}`);
      return text(events);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected over stdio (tools: subscribe, wait_for_event, get_recent_events)");
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
