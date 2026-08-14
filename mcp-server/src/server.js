import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { auditedTool } from "./audit.js";
import {
  compareListings,
  getListing,
  getRoomProofReport,
  getTrustGraph,
  searchRooms
} from "./roombridge-api.js";

function result(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

export function createRoomBridgeMcpServer() {
  const server = new McpServer({
    name: "roombridge",
    version: "1.0.0"
  }, {
    capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }
  });

  server.registerTool("search_rooms", {
    title: "Search RoomBridge rooms",
    description: "Search current student-housing listings using grounded structured filters. Read-only.",
    inputSchema: {
      university: z.string().max(160).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(40).optional(),
      area: z.string().max(100).optional(),
      maxRent: z.number().nonnegative().max(100000).optional(),
      type: z.string().max(80).optional(),
      amenities: z.array(z.string().max(80)).max(20).optional(),
      limit: z.number().int().min(1).max(20).default(10)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, auditedTool("search_rooms", async ({ limit, ...filters }) => {
    const listings = await searchRooms(filters);
    return result({
      total: listings.length,
      listings: listings.slice(0, limit).map((listing) => ({
        id: listing.id,
        title: listing.title,
        rent: listing.rent,
        university: listing.university,
        city: listing.city,
        state: listing.state,
        area: listing.area,
        roomType: listing.roomType,
        furnished: listing.furnished,
        verified: listing.verified
      }))
    });
  }));

  server.registerTool("get_listing", {
    title: "Get a RoomBridge listing",
    description: "Retrieve one current listing by its RoomBridge ID. Read-only.",
    inputSchema: { listingId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, auditedTool("get_listing", async ({ listingId }) => {
    const listing = await getListing(listingId);
    if (!listing) throw new Error("Listing not found");
    return result(listing);
  }));

  server.registerTool("compare_listings", {
    title: "Compare RoomBridge listings",
    description: "Run deterministic comparison scoring for two or more listing IDs. Read-only.",
    inputSchema: {
      listingIds: z.array(z.string().min(1)).min(1).max(20),
      preferences: z.object({
        max_rent: z.number().nonnegative().optional(),
        max_commute_minutes: z.number().nonnegative().optional(),
        preferred_room_type: z.string().optional(),
        preferred_amenities: z.array(z.string()).optional(),
        pet_preference: z.string().optional()
      }).optional()
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, auditedTool("compare_listings", async ({ listingIds, preferences = {} }) => {
    return result(await compareListings(listingIds, preferences));
  }));

  server.registerTool("get_roomproof_report", {
    title: "Get RoomProof report",
    description: "Retrieve a persisted evidence-grounded RoomProof report by report ID. Read-only.",
    inputSchema: { reportId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, auditedTool("get_roomproof_report", async ({ reportId }) => {
    return result(await getRoomProofReport(reportId));
  }));

  server.registerTool("query_roomtrust_graph", {
    title: "Query RoomTrust Graph",
    description: "Retrieve the evidence and identity relationship subgraph for a listing. Read-only.",
    inputSchema: { listingId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  }, auditedTool("query_roomtrust_graph", async ({ listingId }) => {
    return result(await getTrustGraph(listingId));
  }));

  server.registerResource(
    "rental-safety-policy",
    "roombridge://policies/rental-safety",
    {
      title: "RoomBridge rental safety policy",
      description: "Safety and grounding requirements for housing assistance.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: [
          "# RoomBridge rental safety",
          "- Never describe a listing as guaranteed safe or legitimate.",
          "- Cite listing or RoomProof evidence for factual claims.",
          "- Ask the student to verify identity, address, lease, and availability before paying.",
          "- Never request SSNs, payment credentials, or identity documents in chat.",
          "- Require explicit approval before any future contact, calendar, or submission action."
        ].join("\n")
      }]
    })
  );

  server.registerResource(
    "listing",
    new ResourceTemplate("roombridge://listings/{listingId}", { list: undefined }),
    {
      title: "RoomBridge listing",
      description: "A current structured housing listing.",
      mimeType: "application/json"
    },
    async (uri, { listingId }) => {
      const listing = await getListing(String(listingId));
      if (!listing) throw new Error("Listing not found");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(listing, null, 2)
        }]
      };
    }
  );

  server.registerPrompt("compare_student_rooms", {
    title: "Compare student rooms",
    description: "Grounded workflow for comparing RoomBridge listings.",
    argsSchema: {
      listingIds: z.string().describe("Comma-separated RoomBridge listing IDs"),
      priorities: z.string().optional().describe("Student priorities such as budget, commute, or laundry")
    }
  }, async ({ listingIds, priorities = "budget, commute, evidence quality" }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Compare these RoomBridge listings: ${listingIds}. Prioritize ${priorities}. Use compare_listings and query_roomtrust_graph. Clearly distinguish listing facts, computed scores, unresolved evidence, and safety guidance.`
      }
    }]
  }));

  return server;
}
