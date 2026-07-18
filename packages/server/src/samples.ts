import type { CapturedEvent } from "@companion/shared";

// A small ring buffer of recently observed traffic shapes per host. Used only
// by NL discovery to show the model what signals the site actually emits.
const MAX_SAMPLES_PER_HOST = 40;
const samplesByHost = new Map<string, TrafficSample[]>();

export interface TrafficSample {
  url: string;
  method: string;
  kind: string;
  keySkeleton: string[]; // top-level-ish keys of the payload
  bodyPreview: string;
}

export function recordSamples(events: CapturedEvent[]): void {
  for (const event of events) {
    const host = hostOf(event.tabUrl) || hostOf(event.url);
    if (!host) continue;
    const list = samplesByHost.get(host) ?? [];
    list.push(toSample(event));
    if (list.length > MAX_SAMPLES_PER_HOST) list.shift();
    samplesByHost.set(host, list);
  }
}

export function getSamplesForHost(host: string): TrafficSample[] {
  return samplesByHost.get(host) ?? [];
}

function toSample(event: CapturedEvent): TrafficSample {
  const parsed = tryParse(event.body);
  return {
    url: event.url,
    method: event.method,
    kind: event.kind,
    keySkeleton: skeleton(parsed),
    bodyPreview: event.body.slice(0, 400),
  };
}

// Collect a de-duplicated set of dotted key paths up to a shallow depth.
function skeleton(value: unknown, prefix = "", depth = 0, acc = new Set<string>()): string[] {
  if (depth > 3 || value == null || typeof value !== "object") return [...acc];
  if (Array.isArray(value)) {
    if (value.length > 0) skeleton(value[0], `${prefix}[*]`, depth + 1, acc);
    return [...acc];
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    acc.add(path);
    skeleton((value as Record<string, unknown>)[key], path, depth + 1, acc);
  }
  return [...acc];
}

function hostOf(url: string): string {
  const match = /^https?:\/\/([^/]+)/.exec(url);
  return match ? match[1] : "";
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
