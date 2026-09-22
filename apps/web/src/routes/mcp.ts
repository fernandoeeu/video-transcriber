import { createFileRoute } from "@tanstack/react-router";

import { handleMcpRequest } from "../server/mcp/http";
import { createProductionMcpServer } from "../server/mcp/production";

const handle = ({ request }: { request: Request }) =>
  handleMcpRequest(request, createProductionMcpServer);

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: handle,
      GET: handle,
      DELETE: handle,
    },
  },
});
