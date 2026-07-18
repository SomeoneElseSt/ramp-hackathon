// Minimal deterministic JSON path helpers. Dot notation only; a "*" segment
// iterates array elements. No models involved — this is the fast path.

export function getPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (part === "*") return cur; // handled by resolveCandidates; treat as identity here
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// Resolve the array/object of candidate events at framePath.
export function resolveCandidates(body: unknown, framePath?: string): unknown[] {
  if (!framePath) return Array.isArray(body) ? body : body == null ? [] : [body];
  const resolved = getPath(body, framePath);
  if (resolved == null) return [];
  return Array.isArray(resolved) ? resolved : [resolved];
}

// A stable dedup key: prefer the value at dedupKeyPath; otherwise hash the JSON.
export function dedupKeyFor(candidate: unknown, dedupKeyPath?: string): string {
  const value = getPath(candidate, dedupKeyPath);
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return "hash:" + hashString(safeStringify(candidate));
}

export function stringAt(candidate: unknown, path?: string): string | undefined {
  const value = getPath(candidate, path);
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return safeStringify(value);
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[circular]";
      seen.add(val);
    }
    return val;
  });
}

// djb2 — small, fast, deterministic. Not cryptographic; only used for dedup.
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
