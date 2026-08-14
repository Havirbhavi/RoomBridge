import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8002/mcp";

export async function callRoomBridgeTool(name, args = {}) {
  const client = new Client({ name: "roombridge-api", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL));
  try {
    await client.connect(transport);
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) {
      throw new Error(response.content?.find((item) => item.type === "text")?.text || `MCP tool ${name} failed`);
    }
    const text = response.content?.find((item) => item.type === "text")?.text;
    return text ? JSON.parse(text) : response.structuredContent;
  } finally {
    await client.close().catch(() => {});
  }
}
