// LinkedIn proof defaults — module-local only (not an MCP connector).

export const linkedinIntegration = {
  id: "linkedin" as const,
  defaultPageUrl: "https://www.linkedin.com/messaging/",
  endpointHints: [
    "GET https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql",
    "GET https://www.linkedin.com/voyager/api/graphql",
    "GET https://www.linkedin.com/voyager/api/messaging",
    "GET https://www.linkedin.com/realtime/connect",
  ],
  matchIntent(intent: string, haystack: string): boolean {
    const hay = `${intent} ${haystack}`.toLowerCase();
    if (/linkedin\.com|voyager|licdn/.test(hay)) return true;
    const messaging = /messag|inbox|conversation|\bdm\b|chat/.test(hay);
    const otherSite = /gmail|slack|discord|whatsapp|telegram|intercom/.test(hay);
    return messaging && !otherSite;
  },
};
