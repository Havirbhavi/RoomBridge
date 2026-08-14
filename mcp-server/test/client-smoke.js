import "../src/polyfill.js";

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_SERVER_URL || "http://127.0.0.1:8002/mcp");
const client = new Client({ name: "roombridge-mcp-smoke", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(url);

await client.connect(transport);
const tools = await client.listTools();
assert.deepEqual(
  tools.tools.map((tool) => tool.name).sort(),
  ["compare_listings", "get_listing", "get_roomproof_report", "query_roomtrust_graph", "search_rooms"]
);
const result = await client.callTool({
  name: "search_rooms",
  arguments: { university: "Penn State University", maxRent: 1200, limit: 3 }
});
const payload = JSON.parse(result.content.find((item) => item.type === "text").text);
assert.ok(payload.total >= 1);
assert.equal(payload.listings[0].university, "Penn State University");
const listingId = payload.listings[0].id;
const listingResult = await client.callTool({
  name: "get_listing",
  arguments: { listingId }
});
const listing = JSON.parse(listingResult.content.find((item) => item.type === "text").text);
assert.equal(listing.id, listingId);
const comparisonResult = await client.callTool({
  name: "compare_listings",
  arguments: { listingIds: [listingId], preferences: { max_rent: 1200 } }
});
const comparison = JSON.parse(comparisonResult.content.find((item) => item.type === "text").text);
assert.equal(comparison.recommended_id, listingId);
const graphResult = await client.callTool({
  name: "query_roomtrust_graph",
  arguments: { listingId }
});
const graph = JSON.parse(graphResult.content.find((item) => item.type === "text").text);
assert.equal(graph.listing_id, listingId);
const resources = await client.listResources();
assert.ok(resources.resources.some((resource) => resource.uri === "roombridge://policies/rental-safety"));
console.log(JSON.stringify({
  tools: tools.tools.length,
  search_results: payload.total,
  compared: comparison.comparisons.length,
  graph_nodes: graph.nodes.length,
  resources: resources.resources.length
}));
await client.close();
