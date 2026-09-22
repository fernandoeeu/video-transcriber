import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0" as const,
  error: { code: -32000, message: "Method not allowed." },
  id: null,
};

const INTERNAL_ERROR = {
  jsonrpc: "2.0" as const,
  error: { code: -32603, message: "Internal server error" },
  id: null,
};

/**
 * Handle one Streamable HTTP MCP request in stateless mode: no session id,
 * a fresh server and transport per request. GET and DELETE are rejected.
 */
export async function handleMcpRequest(
  request: Request,
  createServer: () => McpServer,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(METHOD_NOT_ALLOWED, { status: 405 });
  }

  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    const response = await transport.handleRequest(request);
    return attachTransportCleanup(response, () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    void transport.close();
    void server.close();
    console.error("Error handling MCP request:", error);
    return Response.json(INTERNAL_ERROR, { status: 500 });
  }
}

function attachTransportCleanup(response: Response, cleanup: () => void): Response {
  if (!response.body) {
    cleanup();
    return response;
  }

  const { readable, writable } = new TransformStream();
  void response.body.pipeTo(writable).finally(cleanup);
  return new Response(readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
