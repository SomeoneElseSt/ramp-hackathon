// The daemon also speaks MCP over stdio, so stdout is reserved for the protocol.
// ALL human-facing logging must go to stderr.
export function log(...args: unknown[]): void {
  console.error("[reflex]", ...args);
}
