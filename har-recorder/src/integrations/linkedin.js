// LinkedIn proof module — defaults live HERE only, not in MCP / generic paths.
// First integration: messaging listen surface for Tama MCP create_listener → watch.

/** @type {import('./index.js').IntegrationModule} */
export const linkedin = {
  id: "linkedin",
  openTabOnListen: true,
  defaultPageUrl: "https://www.linkedin.com/messaging/",
  endpointHints: [
    "GET https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql",
    "GET https://www.linkedin.com/voyager/api/graphql",
    "GET https://www.linkedin.com/voyager/api/messaging",
    "GET https://www.linkedin.com/realtime/connect",
  ],
  /**
   * @param {{ intent?: string, pageUrl?: string|null, endpoints?: string[], label?: string|null }} listener
   */
  match(listener) {
    const intentHay = `${listener?.intent || ""} ${listener?.label || ""}`.toLowerCase();
    const siteHay = `${listener?.pageUrl || ""} ${(listener?.endpoints || []).join(" ")}`.toLowerCase();
    if (/linkedin\.com|voyager|licdn/.test(`${intentHay} ${siteHay}`)) return true;
    // Messaging intent/label with no other site → LinkedIn is the proof default.
    // (Do not scan endpoint paths for "inbox" — that false-positives generic APIs.)
    const messaging = /messag|inbox|conversation|\bdm\b|chat/.test(intentHay);
    const otherSite = /gmail|slack|discord|whatsapp|telegram|intercom/.test(`${intentHay} ${siteHay}`);
    return messaging && !otherSite;
  },
};
