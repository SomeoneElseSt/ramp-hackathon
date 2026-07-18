// catalog.ts — Tama's growing set of listenable capabilities + active listeners.
// Capabilities come from organic discovery (captured endpoints → functionality
// labels). Active listeners are what agents created via Tama MCP.

import { describeSource, type Functionality } from "./functionality.js";
import type { EndpointCandidate } from "./endpoints.js";
import type { Subscription } from "./types.js";

export interface CatalogCapability extends Functionality {
  sampleUrl: string;
  path: string;
  method: string;
  kinds: string[];
  count: number;
  discoveredAt: number;
}

export interface ListenerSummary {
  subId: string;
  intent: string;
  types: string[];
  keywords: string[];
  pageUrl: string | null;
  endpoints: string[];
  label: string | null;
  pendingCount: number;
  waiting: boolean;
}

/** In-memory catalog of organically discovered listenable surfaces. */
export class CapabilityCatalog {
  private byLabel = new Map<string, CatalogCapability>();

  /** Merge endpoint candidates into the catalog; returns newly added labels. */
  ingestCandidates(candidates: EndpointCandidate[], now = Date.now()): CatalogCapability[] {
    const fresh: CatalogCapability[] = [];
    for (const c of candidates) {
      const labeled = describeSource({ key: c.key, sampleUrl: c.sampleUrl || c.url });
      if (!labeled) continue;
      const existing = this.byLabel.get(labeled.label);
      if (existing) {
        existing.count = Math.max(existing.count, c.count);
        existing.sampleUrl = c.sampleUrl;
        existing.kinds = [...new Set([...existing.kinds, ...c.kinds])];
        continue;
      }
      const cap: CatalogCapability = {
        ...labeled,
        sampleUrl: c.sampleUrl,
        path: c.path,
        method: c.method,
        kinds: [...c.kinds],
        count: c.count,
        discoveredAt: now,
      };
      this.byLabel.set(cap.label, cap);
      fresh.push(cap);
    }
    return fresh;
  }

  list(): CatalogCapability[] {
    return [...this.byLabel.values()].sort((a, b) => b.count - a.count);
  }

  get(label: string): CatalogCapability | undefined {
    return this.byLabel.get(label);
  }
}

export function summarizeListeners(subs: Iterable<Subscription>): ListenerSummary[] {
  return [...subs].map((s) => ({
    subId: s.subId,
    intent: s.intent,
    types: s.types,
    keywords: s.keywords,
    pageUrl: s.pageUrl,
    endpoints: s.endpoints,
    label: s.label,
    pendingCount: s.pending.length,
    waiting: s.waiters.length > 0,
  }));
}

export const catalog = new CapabilityCatalog();
