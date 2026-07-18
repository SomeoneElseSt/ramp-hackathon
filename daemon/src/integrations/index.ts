// Thin integration registry (daemon). Fills pageUrl / endpoint hints when
// organic discovery hasn't produced candidates yet — so create_listener still
// pushes a useful watch → extension opens a tab.

import { linkedinIntegration } from "./linkedin.js";

export interface ListenerDefaults {
  pageUrl: string | null;
  endpoints: string[];
  label: string | null;
  moduleId: string | null;
}

const MODULES = [linkedinIntegration];

/** Apply proof-module defaults when discovery left gaps. */
export function applyIntegrationDefaults(
  intent: string,
  current: { pageUrl: string | null; endpoints: string[]; label: string | null },
): ListenerDefaults {
  const hay = `${current.pageUrl ?? ""} ${current.endpoints.join(" ")} ${current.label ?? ""}`;
  const mod = MODULES.find((m) => m.matchIntent(intent, hay));
  if (!mod) {
    return {
      pageUrl: current.pageUrl,
      endpoints: current.endpoints,
      label: current.label,
      moduleId: null,
    };
  }

  return {
    pageUrl: current.pageUrl || mod.defaultPageUrl,
    endpoints: current.endpoints.length > 0 ? current.endpoints : [...mod.endpointHints],
    label: current.label || (mod.id === "linkedin" ? "New message" : null),
    moduleId: mod.id,
  };
}
