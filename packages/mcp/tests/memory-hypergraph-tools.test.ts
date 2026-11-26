// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { registerMemoryHypergraphTools } from "../src/tools/memory-hypergraph-tools.js";
import type { ServerContext } from "../src/types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
}>;

function createMockMcpServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

describe("MCP DiskANN Memory & Relational Dynamic-m Hypergraph Tools", () => {
  test("registers all 3 memory/hypergraph tools and compiles + buckets examples cleanly", async () => {
    const { server, tools } = createMockMcpServer();
    registerMemoryHypergraphTools(server, {} as ServerContext);

    assert.ok(tools.has("modelscript_compile_hypergraph"));
    assert.ok(tools.has("modelscript_bucket_dynamic_m"));
    assert.ok(tools.has("modelscript_memory_query"));

    const compileRes = await tools.get("modelscript_compile_hypergraph")!({
      source: "wall_thickness = 3.0; cube([20, 20, wall_thickness]);",
      dialect: "scad",
      overrides: [{ symbolName: "wall_thickness", relSign: -1 }],
    });
    assert.ok(!compileRes.isError);
    const parsed = JSON.parse(compileRes.content[0]!.text);
    assert.equal(parsed.dialect, "scad");
    assert.equal(parsed.mInit, 1);
    assert.equal(parsed.tokenIds.length, parsed.groupIds.length);
    assert.ok(parsed.relSigns.includes(-1));

    const bucketRes = await tools.get("modelscript_bucket_dynamic_m")!({
      batchSize: 2,
      mCap: 32,
      examples: [
        { dialect: "modelica", source: "model A Real x; end A;" },
        { dialect: "modelica", source: "model B Real y; end B;" },
        { dialect: "modelica", source: "model C Real a; Real b; Real c; Real d; Real e; end C;" },
        { dialect: "modelica", source: "model D Real p; Real q; Real r; Real s; Real t; end D;" },
      ],
    });
    assert.ok(!bucketRes.isError);
    const bucketed = JSON.parse(bucketRes.content[0]!.text);
    assert.equal(bucketed.bucketCount, 2);
    assert.ok(bucketed.buckets[0].mBatchMax < bucketed.buckets[1].mBatchMax);
  });
});
