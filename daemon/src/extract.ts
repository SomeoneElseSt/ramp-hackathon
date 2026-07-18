import type { ActivityEvent, Identity, SemanticEvent } from "./types.js";
import { learnIdentity, resolveIdentity } from "./identities.js";
import { getOpenAI, MODEL } from "./openai.js";
import { log } from "./logger.js";

// General, site-agnostic message extraction. No per-site code: we walk any JSON
// body for message-shaped objects, learn identities as we go, and resolve them.
// A model-assisted fallback handles un-indexed shapes the heuristic misses.

const TEXT_KEYS = [
  "text",
  "body",
  "message",
  "messageText",
  "content",
  "snippet",
  "preview",
  "subject",
  "comment",
  "attributedBody",
];
const ID_KEYS = [
  "entityUrn",
  "backendUrn",
  "dashEntityUrn",
  "messageId",
  "eventId",
  "urn",
  "guid",
  "id",
];
const NAME_KEYS = [
  "firstName",
  "fullName",
  "displayName",
  "name",
  "authorName",
  "senderName",
  "title",
];
const SENDER_KEYS = [
  "from",
  "sender",
  "author",
  "actor",
  "creator",
  "originator",
  "fromParticipant",
  "miniProfile",
  "member",
  "messagingMember",
];
const CONV_KEYS = [
  "conversationId",
  "conversationUrn",
  "threadId",
  "chatId",
  "roomId",
  "channel",
];
const SENT_FLAGS = ["isMine", "fromSelf", "outgoing", "sentByViewer", "isSender"];

const MAX_DEPTH = 9;

export interface Extracted {
  event: SemanticEvent;
  dedupId: string | null;
}

export async function extractFrom(ev: ActivityEvent): Promise<Extracted[]> {
  const body = bodyOf(ev);
  if (!body) return [];
  const host = hostOf(ev.url ?? "");
  const parsed = tryParse(body);
  if (parsed == null) return [];

  // First pass: learn any name<->id pairs anywhere in the payload.
  learnPass(parsed, 0);

  // Second pass: collect message-shaped objects.
  const found: Extracted[] = [];
  collect(parsed, host, ev, found, 0);
  if (found.length > 0) return found;

  // Fallback: let the model index an unfamiliar shape (budgeted).
  return extractWithModel(parsed, host, ev);
}

// ---------------------------------------------------------------------------
// Heuristic walker
// ---------------------------------------------------------------------------

function collect(
  node: unknown,
  host: string,
  ev: ActivityEvent,
  acc: Extracted[],
  _depth: number
): void {
  // A "message container" is an object carrying an id or a sender at its own
  // level and some text within its subtree. Message text often sits several
  // levels below the id/sender (e.g. LinkedIn's DecoratedEvent), so we search
  // the subtree for text rather than requiring it on the same object.
  const containers = new Set<Record<string, unknown>>();
  gather(node, 0, containers);

  for (const container of containers) {
    // Prefer leaf-most containers: skip one that wraps another container
    // (e.g. a conversation wrapping its messages).
    if (hasContainerDescendant(container, containers, container, 0)) continue;
    const text = deepText(container, 0);
    if (!text) continue;
    acc.push(buildSemantic(container, text, host, ev));
  }
}

function gather(
  node: unknown,
  depth: number,
  containers: Set<Record<string, unknown>>
): void {
  if (depth > MAX_DEPTH || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) gather(item, depth + 1, containers);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (isContainer(obj) && deepText(obj, 0)) containers.add(obj);
  for (const key of Object.keys(obj)) gather(obj[key], depth + 1, containers);
}

function isContainer(obj: Record<string, unknown>): boolean {
  const hasId = ID_KEYS.some((k) => typeof obj[k] === "string");
  const hasSender = SENDER_KEYS.some((k) => obj[k] != null && typeof obj[k] === "object");
  return hasId || hasSender;
}

function hasContainerDescendant(
  node: unknown,
  containers: Set<Record<string, unknown>>,
  self: Record<string, unknown>,
  depth: number
): boolean {
  if (depth > MAX_DEPTH || node == null || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    return node.some((item) => hasContainerDescendant(item, containers, self, depth + 1));
  }
  const obj = node as Record<string, unknown>;
  if (obj !== self && containers.has(obj)) return true;
  return Object.keys(obj).some((key) =>
    hasContainerDescendant(obj[key], containers, self, depth + 1)
  );
}

// Find the first message text within an object's subtree (bounded depth).
function deepText(node: unknown, depth: number): string | null {
  if (depth > 5 || node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepText(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const own = extractText(obj);
  if (own) return own;
  for (const key of Object.keys(obj)) {
    const found = deepText(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function buildSemantic(
  obj: Record<string, unknown>,
  text: string,
  host: string,
  ev: ActivityEvent
): Extracted {
  const dedupId = firstString(obj, ID_KEYS);
  const sender = firstSender(obj);
  const from: Identity = resolveIdentity({
    name: sender.name,
    profileId: sender.profileId,
  });
  const conversationId = firstString(obj, CONV_KEYS);
  const sent = SENT_FLAGS.some((f) => obj[f] === true);

  return {
    dedupId,
    event: {
      type: sent ? "message.sent" : "message.received",
      source: host,
      ts: ev.ts,
      from,
      conversationId: conversationId ?? null,
      text: text.slice(0, 2000),
      evidence: [ev.id],
    },
  };
}

function extractText(obj: Record<string, unknown>): string | null {
  for (const key of TEXT_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>).text;
      if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
    }
  }
  return null;
}

function firstSender(obj: Record<string, unknown>): Identity {
  for (const key of SENDER_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return { name: value.trim(), profileId: null };
    if (value && typeof value === "object") {
      const senderObj = value as Record<string, unknown>;
      return {
        name: deepName(senderObj, 0),
        profileId: firstString(senderObj, ID_KEYS),
      };
    }
  }
  return { name: null, profileId: null };
}

function deepName(obj: Record<string, unknown>, depth: number): string | null {
  if (depth > 3) return null;
  for (const key of NAME_KEYS) {
    if (typeof obj[key] === "string" && (obj[key] as string).trim()) return (obj[key] as string).trim();
  }
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = deepName(value as Record<string, unknown>, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof obj[key] === "string" && (obj[key] as string).length > 0) return obj[key] as string;
  }
  return null;
}

// Record identities from any object carrying both a name and an id.
function learnPass(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) learnPass(item, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const name = deepName(obj, 0);
  const id = firstString(obj, ID_KEYS);
  if (name && id) learnIdentity(id, name);
  for (const key of Object.keys(obj)) learnPass(obj[key], depth + 1);
}

// ---------------------------------------------------------------------------
// Model-assisted fallback ("indexing" an unfamiliar site)
// ---------------------------------------------------------------------------

let modelCallsRemaining = Number(process.env.REFLEX_EXTRACT_BUDGET ?? 40);

async function extractWithModel(
  parsed: unknown,
  host: string,
  ev: ActivityEvent
): Promise<Extracted[]> {
  const client = getOpenAI();
  if (!client || modelCallsRemaining <= 0) return [];
  const raw = JSON.stringify(parsed).slice(0, 12_000);
  if (raw.length < 40) return [];
  modelCallsRemaining -= 1;

  const system =
    "Extract human messages from this API payload. Return strict JSON " +
    '{"messages":[{"from":string,"profileId":string,"text":string,"id":string,"conversationId":string}]}. ' +
    "Empty array if it carries no human message content (telemetry, presence, config, acks).";

  const completion = await client.chat.completions
    .create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Host: ${host}\nPayload:\n${raw}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    })
    .catch((err: unknown) => {
      log("extract model error:", err);
      return null;
    });

  if (!completion) return [];
  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsedOut = tryParse(content) as { messages?: unknown[] } | null;
  if (!parsedOut?.messages || !Array.isArray(parsedOut.messages)) return [];

  return parsedOut.messages
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .filter((m) => typeof m.text === "string" && (m.text as string).trim().length > 0)
    .map((m) => {
      const name = strOrNull(m.from);
      const profileId = strOrNull(m.profileId);
      if (name && profileId) learnIdentity(profileId, name);
      return {
        dedupId: strOrNull(m.id),
        event: {
          type: "message.received",
          source: host,
          ts: ev.ts,
          from: resolveIdentity({ name, profileId }),
          conversationId: strOrNull(m.conversationId),
          text: (m.text as string).slice(0, 2000),
          evidence: [ev.id],
        },
      };
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bodyOf(ev: ActivityEvent): string | null {
  const data = ev.data as Record<string, unknown> | undefined;
  if (!data) return null;
  // network.response
  const content = data.content as Record<string, unknown> | undefined;
  if (content && typeof content.text === "string") return content.text;
  // websocket.* / sse.message
  if (typeof data.payload === "string") return data.payload;
  return null;
}

function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return match ? match[1] : url || "unknown";
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
