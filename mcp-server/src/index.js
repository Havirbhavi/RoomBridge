import "./polyfill.js";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";

import { audit } from "./audit.js";
import { createRoomBridgeMcpServer } from "./server.js";

const PORT = Number(process.env.MCP_PORT || 8002);
const HOST = process.env.MCP_HOST || "127.0.0.1";
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS || "localhost,127.0.0.1")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);
const app = createMcpExpressApp({ host: HOST, allowedHosts });

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "roombridge-mcp",
    transport: "streamable-http",
    mode: "read-only",
    tools: 5
  });
});

app.post("/mcp", async (req, res) => {
  const server = createRoomBridgeMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    await audit({ type: "protocol_error", error: error.message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP server error" },
        id: null
      });
    }
  } finally {
    res.on("close", async () => {
      await transport.close();
      await server.close();
    });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});
app.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`RoomBridge MCP listening on http://${HOST}:${PORT}/mcp`);
});

process.on("SIGINT", () => {
  httpServer.close(() => process.exit(0));
});
