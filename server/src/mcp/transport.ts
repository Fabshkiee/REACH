import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/**
 * Fresh transport per request (stateless mode: sessionIdGenerator undefined).
 * Stateless is fully spec-compliant for Inspector and Alexa+ and needs no
 * session store — every request is independent.
 *
 * enableJsonResponse: plain JSON instead of SSE streams. Simpler for curl,
 * Inspector, and the Alexa client; REACH has no server-initiated
 * notifications that would need a stream.
 */
export function createMcpTransport(): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
}
