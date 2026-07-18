import type { Identity } from "./types.js";

// Identity resolution accumulated across all observed traffic. The whole point
// of CONTRACT §2: the daemon joins a sender id to a real name BEFORE the agent
// sees it, so the downstream model spends zero tokens re-deriving who sent what.
const idToName = new Map<string, string>();
const nameToId = new Map<string, string>();

export function learnIdentity(profileId: string | null, name: string | null): void {
  if (profileId && name) {
    idToName.set(profileId, name);
    nameToId.set(name.toLowerCase(), profileId);
  }
}

// Fill in whichever half of the identity we can from what we've learned.
export function resolveIdentity(identity: Identity): Identity {
  const resolved: Identity = { name: identity.name, profileId: identity.profileId };
  if (!resolved.name && resolved.profileId && idToName.has(resolved.profileId)) {
    resolved.name = idToName.get(resolved.profileId) ?? null;
  }
  if (!resolved.profileId && resolved.name && nameToId.has(resolved.name.toLowerCase())) {
    resolved.profileId = nameToId.get(resolved.name.toLowerCase()) ?? null;
  }
  return resolved;
}
