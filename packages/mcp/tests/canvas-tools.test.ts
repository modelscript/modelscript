// SPDX-License-Identifier: AGPL-3.0-or-later

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { registerCanvasTools } from "../src/canvas-tools.js";
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

describe("MCP Spatial Canvas Copilot Tools", () => {
  test("creates a 6-artifact demo board, drops a KiCad/SPICE artifact, wires FMI, computes Blast Radius, and exports SSP", async () => {
    const { server, tools } = createMockMcpServer();
    registerCanvasTools(server, {} as ServerContext);

    assert.ok(tools.has("canvas_create_board"));
    assert.ok(tools.has("canvas_drop_artifact"));
    assert.ok(tools.has("canvas_wire_fmi"));
    assert.ok(tools.has("canvas_blast_radius"));
    assert.ok(tools.has("canvas_export_ssp"));

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-canvas-mcp-"));
    const boardPath = path.join(tmpDir, "actuator.mscanvas");
    const sspPath = path.join(tmpDir, "actuator.ssd");

    try {
      // 1. Create canonical 6-artifact board
      const createRes = await tools.get("canvas_create_board")!({
        filePath: boardPath,
        name: "Actuator System",
        template: "demo",
      });
      const created = JSON.parse(createRes.content[0]!.text) as { tileCount: number; wireCount: number };
      assert.equal(created.tileCount, 6);
      assert.equal(created.wireCount, 7);

      // 2. Drop a SPICE power stage artifact onto the board
      const dropRes = await tools.get("canvas_drop_artifact")!({
        boardPath,
        artifactUri: "circuits/inverter.cir",
        x: 300,
        y: 800,
      });
      const dropped = JSON.parse(dropRes.content[0]!.text) as {
        tile: { id: string; languageId: string; archetype: string };
      };
      assert.equal(dropped.tile.languageId, "spice");
      assert.equal(dropped.tile.archetype, "schematic");

      // 3. Wire an FMI signal from the dropped SPICE tile to the Modelica plant
      const wireRes = await tools.get("canvas_wire_fmi")!({
        boardPath,
        sourceTileId: dropped.tile.id,
        sourceAnchorPath: "v_out",
        targetTileId: "tile_modelica",
        targetAnchorPath: "motor.u",
        kind: "fmi-signal",
      });
      assert.ok(!wireRes.isError);

      // 4. Compute Blast Radius from STEP housing mass
      const blastRes = await tools.get("canvas_blast_radius")!({
        boardPath,
        rootTileId: "tile_step",
        rootAnchorPath: "body.mass",
      });
      const blast = JSON.parse(blastRes.content[0]!.text) as { tileDistances: Record<string, number> };
      assert.equal(blast.tileDistances["tile_modelica"], 1);
      assert.equal(blast.tileDistances["tile_reqif"], 1);
      assert.equal(blast.tileDistances["tile_montecarlo"], 1);

      // 5. Export SSP 1.0 XML
      const sspRes = await tools.get("canvas_export_ssp")!({
        boardPath,
        outPath: sspPath,
      });
      assert.ok(sspRes.content[0]!.text.includes("<ssd:SystemStructureDescription"));
      assert.ok(fs.existsSync(sspPath));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
