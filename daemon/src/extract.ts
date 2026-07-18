import type { ActivityEvent, Identity, SemanticEvent } from "./types.js";
import { learnIdentity, resolveIdentity } from "./identities.js";
import { getOpenAI, MODEL } from "./openai.js";
import { log } from "./logger.js";

// General, site-agnostic message extraction. No per-site code: we walk any JSON
// body for message-shaped objects, learn identities as we go, and resolve them.
// A model-assisted fallback handles un-indexed shapes the heuristic misses.

const TEXT_KEYS = [
  "body",
  "attributedBody",
  "message",
  "messageText",
  "text",
  "content",
  "snippet",
  "preview",
  "subject",
  "comment",
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
  "backendConversationUrn",
  "threadId",
  "chatId",
  "roomId",
  "channel",
];
const SENT_FLAGS = ["isMine", "fromSelf", "outgoing", "sentByViewer", "isSender"];

/** Keys that mean "this object is the message body," not a profile headline. */
const MESSAGE_BODY_KEYS = ["body", "attributedBody", "message", "messageText"];

const MAX_DEPTH = 9;

export interface Extracted {
  event: SemanticEvent;
  dedupId: string | null;
}

export async function extractFrom(ev: ActivityEvent): Promise<Extracted[]> {
  const body = bodyOf(ev);
  if (!body) return [];
  const host = hostOf(eventUrl(ev));

  const parsed = tryParse(body);
  if (parsed != null) {
    learnPass(parsed, 0);
    const found: Extracted[] = [];
    collect(parsed, host, ev, found, 0);
    if (found.length > 0) return found;
    const modelled = await extractWithModel(parsed, host, ev);
    if (modelled.length > 0) return modelled;
  }

  // Truncated GraphQL / partial JSON: salvage LinkedIn messenger.Message shapes.
  const salvaged = salvageMessengerMessages(body, host, ev);
  if (salvaged.length > 0) return salvaged;

  return [];
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
    // Skip wrappers (conversation containing messages) BUT never skip an object
    // that itself carries an explicit message body — LinkedIn Message embeds sender.
    const ownBody =
      messageBodyText(container) || ownChatText(container);
    if (!ownBody && hasContainerDescendant(container, containers, container, 0)) continue;
    const text = ownBody || deepMessageBody(container, 0) || deepText(container, 0);
    if (!text) continue;
    // Reject profile-headline false positives (name-only "messages").
    if (text.length < 2) continue;
    if (isLikelyProfileNoise(text, container)) continue;
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
  if (isContainer(obj)) containers.add(obj);
  for (const key of Object.keys(obj)) gather(obj[key], depth + 1, containers);
}

function isContainer(obj: Record<string, unknown>): boolean {
  const hasId = ID_KEYS.some((k) => typeof obj[k] === "string");
  const hasSender = SENDER_KEYS.some(
    (k) =>
      (obj[k] != null && typeof obj[k] === "object") ||
      (typeof obj[k] === "string" && (obj[k] as string).trim().length > 0),
  );
  const typeHint =
    typeof obj._type === "string" && /message/i.test(obj._type as string);

  // GraphQL messenger.Message: body on the same object as id/sender.
  if (messageBodyText(obj) && (hasId || hasSender || typeHint)) return true;

  // Classic chat APIs: { id, sender, text: "..." } — string text on the object.
  if ((hasId || hasSender) && ownChatText(obj)) return true;

  // DecoratedEvent-style: id/sender on parent, attributedBody nested below.
  // Require an explicit message-body key in the subtree — never generic "text"
  // (that matches LinkedIn firstName.text / headlines).
  if ((hasId || hasSender) && deepMessageBody(obj, 0)) return true;

  return false;
}

/** Prefer body / attributedBody over generic nested "text" (headlines, names). */
function messageBodyText(obj: Record<string, unknown>): string | null {
  for (const key of MESSAGE_BODY_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>).text;
      if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
    }
  }
  return null;
}

/** Same-object string body used by generic chat APIs (not nested AttributedText). */
function ownChatText(obj: Record<string, unknown>): string | null {
  for (const key of ["text", "content", "snippet", "preview", "subject", "comment"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Walk subtree for MESSAGE_BODY_KEYS only (not profile headline "text"). */
function deepMessageBody(node: unknown, depth: number): string | null {
  if (depth > 5 || node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepMessageBody(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const own = messageBodyText(obj);
  if (own) return own;
  for (const key of Object.keys(obj)) {
    // Don't dive into sender/from — those carry names, not message bodies.
    if (SENDER_KEYS.includes(key)) continue;
    const found = deepMessageBody(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function isLikelyProfileNoise(text: string, container: Record<string, unknown>): boolean {
  if (messageBodyText(container) || deepMessageBody(container, 0)) return false;
  if (/Intern @|Analyst \| |honoree|Ecosystem Builder|Hackathon Winner/i.test(text)) {
    return true;
  }
  return false;
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
        profileId: firstProfileId(senderObj),
      };
    }
  }
  return { name: null, profileId: null };
}

function deepName(obj: Record<string, unknown>, depth: number): string | null {
  if (depth > 4) return null;

  // LinkedIn: firstName/lastName are AttributedText objects { text: "Raphael" }.
  const first = attributedOrString(obj.firstName);
  const last = attributedOrString(obj.lastName);
  if (first && last) return `${first} ${last}`;
  if (first) return first;

  for (const key of NAME_KEYS) {
    const v = attributedOrString(obj[key]);
    if (v) return v;
  }
  // Unwrap participantType.member / miniProfile
  for (const key of ["participantType", "member", "miniProfile", "messagingMember"]) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = deepName(value as Record<string, unknown>, depth + 1);
      if (found) return found;
    }
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

function attributedOrString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const t = (value as Record<string, unknown>).text;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof obj[key] === "string" && (obj[key] as string).length > 0) return obj[key] as string;
  }
  return null;
}

const PROFILE_ID_KEYS = [
  "hostIdentityUrn",
  "dashEntityUrn",
  "profileId",
  "userId",
  "memberId",
  "entityUrn",
  "backendUrn",
  "urn",
  "guid",
  "id",
];

function firstProfileId(obj: Record<string, unknown>): string | null {
  const direct = firstString(obj, PROFILE_ID_KEYS);
  if (direct && isPersonId(direct)) return direct;
  // Walk one level for nested member / miniProfile ids.
  for (const key of ["participantType", "member", "miniProfile", "messagingMember"]) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstProfileId(value as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const id = firstString(value as Record<string, unknown>, PROFILE_ID_KEYS);
      if (id && isPersonId(id)) return id;
    }
  }
  return direct && isPersonId(direct) ? direct : null;
}

function isPersonId(id: string): boolean {
  if (/messagingMessage|msg_message|msg_conversation|messagingThread|conversation|messageEvent/i.test(id)) {
    return false;
  }
  return /profile|member|user|actor|person|fsd_profile|miniProfile/i.test(id) || !id.includes("urn:li:msg");
}

// Record identities from any object carrying both a name and an id.
function learnPass(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) learnPass(item, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  // Only learn from person-shaped nodes (own name fields), not message containers
  // whose deepName() walks into sender and would bind a message URN to a person.
  const ownFirst = attributedOrString(obj.firstName);
  const ownLast = attributedOrString(obj.lastName);
  const ownName =
    (ownFirst && ownLast ? `${ownFirst} ${ownLast}` : ownFirst) ||
    attributedOrString(obj.fullName) ||
    attributedOrString(obj.displayName) ||
    attributedOrString(obj.name);
  const id = firstProfileId(obj);
  if (ownName && id) learnIdentity(id, ownName);
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

function eventUrl(ev: ActivityEvent): string {
  const data = ev.data as Record<string, unknown> | undefined;
  if (data && typeof data.url === "string" && data.url) return data.url;
  return ev.url ?? "";
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

/**
 * When LinkedIn GraphQL bodies are truncated mid-JSON, still pull
 * com.linkedin.messenger.Message { body.text, sender, entityUrn } via regex.
 */
function salvageMessengerMessages(
  raw: string,
  host: string,
  ev: ActivityEvent,
): Extracted[] {
  if (!/com\.linkedin\.messenger\.Message|messengerMessages/i.test(raw)) return [];
  const out: Extracted[] = [];
  const seen = new Set<string>();
  // Split on message type markers; parse each chunk loosely.
  const chunks = raw.split(/"_type"\s*:\s*"com\.linkedin\.messenger\.Message"/);
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i].slice(0, 8000);
    const textM = chunk.match(/"body"\s*:\s*\{[^}]{0,400}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!textM) continue;
    const text = unescapeJsonString(textM[1]).trim();
    if (!text || text.length < 1) continue;

    const idM =
      chunk.match(/"backendUrn"\s*:\s*"(urn:li:messagingMessage:[^"]+)"/) ||
      chunk.match(/"entityUrn"\s*:\s*"(urn:li:msg_message:[^"]+)"/);
    const dedupId = idM ? idM[1] : null;
    if (dedupId && seen.has(dedupId)) continue;
    if (dedupId) seen.add(dedupId);
    else if (seen.has(text)) continue;
    else seen.add(text);

    const firstM = chunk.match(/"firstName"\s*:\s*\{[^}]{0,200}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const lastM = chunk.match(/"lastName"\s*:\s*\{[^}]{0,200}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
    // Prefer sender block: take firstName after "sender"
    const senderIdx = chunk.indexOf('"sender"');
    let first = firstM ? unescapeJsonString(firstM[1]) : null;
    let last = lastM ? unescapeJsonString(lastM[1]) : null;
    if (senderIdx >= 0) {
      const after = chunk.slice(senderIdx, senderIdx + 2500);
      const sf = after.match(/"firstName"\s*:\s*\{[^}]{0,200}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
      const sl = after.match(/"lastName"\s*:\s*\{[^}]{0,200}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (sf) first = unescapeJsonString(sf[1]);
      if (sl) last = unescapeJsonString(sl[1]);
    }
    const name = [first, last].filter(Boolean).join(" ") || null;
    const profileM = chunk.match(/"hostIdentityUrn"\s*:\s*"(urn:li:fsd_profile:[^"]+)"/);
    const convM = chunk.match(/"backendConversationUrn"\s*:\s*"(urn:li:messagingThread:[^"]+)"/);

    out.push({
      dedupId,
      event: {
        type: "message.received",
        source: host || "www.linkedin.com",
        ts: ev.ts,
        from: resolveIdentity({ name, profileId: profileM ? profileM[1] : null }),
        conversationId: convM ? convM[1] : null,
        text: text.slice(0, 2000),
        evidence: [ev.id],
      },
    });
  }
  return out;
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
