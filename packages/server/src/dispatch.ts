import { spawn } from "node:child_process";
import type { DispatchAction, FiredEvent, Listener } from "@companion/shared";
import { recordDispatch } from "./metrics.js";
import { safeStringify } from "./jsonpath.js";

export interface DispatchResult {
  dispatched: boolean;
  detail: string;
}

// Run the listener's configured action for a fired event. This is where "the
// web calls the agent back": a deterministic local fire hands off to real work.
export async function dispatchEvent(
  listener: Listener,
  event: FiredEvent
): Promise<DispatchResult> {
  const action = listener.action;
  if (!action) return { dispatched: false, detail: "no action configured" };
  if (action.requiresApproval) {
    return { dispatched: false, detail: "awaiting approval" };
  }

  if (action.type === "log") {
    console.log(`[dispatch:log] ${listener.name}: ${event.summary}`);
    recordDispatch();
    return { dispatched: true, detail: "logged" };
  }

  if (action.type === "webhook") return dispatchWebhook(action, event);
  if (action.type === "codex") return dispatchCodex(action, listener, event);
  return { dispatched: false, detail: `unknown action type ${action.type}` };
}

async function dispatchWebhook(
  action: DispatchAction,
  event: FiredEvent
): Promise<DispatchResult> {
  if (!action.url) return { dispatched: false, detail: "webhook missing url" };
  const res = await fetch(action.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: safeStringify({ prompt: action.prompt, event }),
  }).catch((err: unknown) => {
    console.error("[dispatch:webhook] error:", err);
    return null;
  });
  if (!res) return { dispatched: false, detail: "webhook failed" };
  recordDispatch();
  return { dispatched: true, detail: `webhook ${res.status}` };
}

function dispatchCodex(
  action: DispatchAction,
  listener: Listener,
  event: FiredEvent
): DispatchResult {
  if (!action.command) return { dispatched: false, detail: "codex missing command" };
  // Replace {event} / {prompt} placeholders and hand off to a detached shell.
  const eventJson = safeStringify({ listener: listener.name, event });
  const command = action.command
    .replaceAll("{event}", JSON.stringify(eventJson))
    .replaceAll("{prompt}", JSON.stringify(action.prompt ?? listener.prompt));

  const child = spawn(command, {
    shell: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  recordDispatch();
  return { dispatched: true, detail: `spawned: ${command.slice(0, 80)}` };
}
