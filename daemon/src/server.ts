import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { perceiver } from "./perceive.js";
import { log } from "./logger.js";

// Tama MCP — single connection any agent taps into.
// CONTRACT §3 tools kept; pitch-language aliases added (create/list/get/remove).
export async function startMcpServer(): Promise<void> {
  const server = new McpServer({ name: "tama", version: "0.2.0" });

  // ---- CONTRACT §3 (kept) -------------------------------------------------

  server.tool(
    "subscribe",
    "Register interest in web events described in natural language (e.g. 'new messages'). Returns listener context including pageUrl + endpoints for the extension. Alias of create_listener.",
    {
      intent: z.string(),
      types: z.array(z.string()).optional(),
      pageUrl: z.string().url().optional(),
    },
    async ({ intent, types, pageUrl }) => {
      const subId = await perceiver.createListener(intent, types, pageUrl ?? null);
      return text(perceiver.getWatch(subId));
    },
  );

  server.tool(
    "wait_for_event",
    "Block until the next event matching the subscription arrives, then return the resolved semantic event. This is the reactive primitive — it does not poll. Completing one wait does not remove the listener or close MCP; re-call to wait again.",
    { subId: z.string() },
    async ({ subId }) => {
      // Listener catalog persists across wait cycles — only remove_listener drops it.
      const pending = perceiver.waitForEvent(subId);
      if (!pending) return errorText(`unknown subId: ${subId}`);
      const event = await pending;
      return text(event);
    },
  );

  server.tool(
    "get_recent_events",
    "Non-blocking drain of matched-but-undelivered events for a subscription. Alias of get_listener_events.",
    { subId: z.string() },
    async ({ subId }) => {
      const events = perceiver.getListenerEvents(subId);
      if (events === null) return errorText(`unknown subId: ${subId}`);
      return text(events);
    },
  );

  // ---- Tama listener hub aliases ------------------------------------------

  server.tool(
    "create_listener",
    "Create a persistent listener from a natural-language intent. Returns { subId, intent, pageUrl, endpoints, keywords, label } so the extension can open the site and watch the right surfaces.",
    {
      intent: z.string(),
      types: z.array(z.string()).optional(),
      pageUrl: z.string().url().optional(),
    },
    async ({ intent, types, pageUrl }) => {
      const subId = await perceiver.createListener(intent, types, pageUrl ?? null);
      return text(perceiver.getWatch(subId));
    },
  );

  server.tool(
    "list_listeners",
    "What Tama currently knows: active listeners agents created, plus organically discovered capabilities (listenable surfaces from browsing).",
    {},
    async () => {
      return text(perceiver.listListeners());
    },
  );

  server.tool(
    "get_listener_events",
    "Non-blocking drain of fired events for a listener (same as get_recent_events).",
    { subId: z.string() },
    async ({ subId }) => {
      const events = perceiver.getListenerEvents(subId);
      if (events === null) return errorText(`unknown subId: ${subId}`);
      return text(events);
    },
  );

  server.tool(
    "remove_listener",
    "Remove a listener by subId. Unblocks any waiting wait_for_event callers.",
    { subId: z.string() },
    async ({ subId }) => {
      const ok = perceiver.removeListener(subId);
      if (!ok) return errorText(`unknown subId: ${subId}`);
      return text({ removed: subId });
    },
  );

  server.tool(
    "propose_workflows",
    "Proactive recommendations from the same observation stream: suggested listeners and repeated workflows. Approve by calling create_listener with suggestedIntent.",
    { limit: z.number().int().min(1).max(20).optional() },
    async ({ limit }) => {
      return text(perceiver.proposeWorkflows(limit ?? 5));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(
    "Tama MCP connected (tools: subscribe, create_listener, list_listeners, wait_for_event, get_listener_events, get_recent_events, remove_listener, propose_workflows)",
  );
}

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
