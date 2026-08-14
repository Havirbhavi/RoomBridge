import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const AUDIT_FILE = resolve(process.env.MCP_AUDIT_FILE || "./data/audit.jsonl");

export async function audit(event) {
  const record = {
    timestamp: new Date().toISOString(),
    service: "roombridge-mcp",
    ...event
  };
  await mkdir(dirname(AUDIT_FILE), { recursive: true });
  await appendFile(AUDIT_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

export function auditedTool(name, handler) {
  return async (input, extra) => {
    const started = performance.now();
    try {
      const result = await handler(input, extra);
      await audit({
        type: "tool_call",
        tool: name,
        status: "success",
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        session_id: extra?.sessionId || null
      });
      return result;
    } catch (error) {
      await audit({
        type: "tool_call",
        tool: name,
        status: "error",
        error: error.message,
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
        session_id: extra?.sessionId || null
      });
      return {
        isError: true,
        content: [{ type: "text", text: error.message || "Tool execution failed" }]
      };
    }
  };
}
