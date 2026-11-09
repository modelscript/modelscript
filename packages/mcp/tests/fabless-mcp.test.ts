// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import type { ServerContext } from "../src/types.js";

describe("Fabless OEM Electronics MCP Tools", () => {
  const context: ServerContext = {
    workspaceRoot: "/workspace",
    fs: {
      readFile: async () => "",
      writeFile: async () => {},
      exists: async () => true,
      mkdir: async () => {},
      readdir: async () => [],
      stat: async () => ({ isFile: () => true, isDirectory: () => false, size: 0, mtime: new Date() }),
    },
  };

  const server = createModelScriptMcpServer(context);
  const tools = (server as any)._registeredTools;

  it("ecad_dfm_audit runs DFM/DFA/DFT checks against CM capability presets", async () => {
    const tool = tools["ecad_dfm_audit"]!;
    assert(tool, "ecad_dfm_audit tool must be registered");

    const res = await tool.handler({
      traces: [
        {
          points: [
            { x: 5, y: 5 },
            { x: 10, y: 10 },
            { x: 5, y: 12 }, // Acute bend angle (acid trap)
          ],
          width: 0.25,
          layer: "TopCopper",
          netId: "VCC",
        },
      ],
      pads: [
        {
          center: { x: 10, y: 10 },
          width: 1.0,
          height: 1.0,
          shape: "rect",
          layer: "TopCopper",
          netId: "VCC",
          component: "U1",
          pinName: "1",
        },
      ],
      vias: [],
      boardOutline: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
        { x: 0, y: 30 },
      ],
      expectedNets: {
        VCC: ["U1.1"],
      },
      tier: "standard",
    });

    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.tier, "standard");
    assert(data.totalChecks > 0);
    assert(
      data.violations.some((v: any) => v.rule === "acid-trap"),
      "Should detect acid-trap via MCP tool",
    );
  });

  it("ecad_generate_manufacturing_bundle produces IPC-2581C, ODB++, and Centroid PnP files", async () => {
    const tool = tools["ecad_generate_manufacturing_bundle"]!;
    assert(tool, "ecad_generate_manufacturing_bundle tool must be registered");

    const res = await tool.handler({
      projectName: "TitanRoboticsCore",
      revision: "1.2.0",
      format: "all",
      layout: {
        traces: [{ start: [10, 10], end: [20, 20], width: 0.25, layer: "TopCopper", net: "VCC" }],
        pads: [
          {
            center: [10, 10],
            width: 1.2,
            height: 0.8,
            drill: 0,
            shape: "rect",
            layer: "TopCopper",
            net: "VCC",
            component: "U1",
          },
        ],
        vias: [],
        outline: {
          vertices: [
            [0, 0],
            [50, 0],
            [50, 50],
            [0, 50],
          ],
        },
        netlist: {
          totalPins: 1,
          totalConnections: 0,
          nets: [{ id: "VCC", pins: [{ name: "U1.1", component: "U1", localName: "1" }] }],
          components: [
            {
              name: "U1",
              pins: ["1"],
              placement: { footprint: "SOIC-8", layer: "TopCopper", x: 10, y: 10, angle: 0 },
            },
          ],
        },
      },
    });

    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.projectName, "TitanRoboticsCore");
    assert.strictEqual(data.revision, "1.2.0");
    assert(data.ipc2581_length_bytes > 0);
    assert(data.odb_files_count > 0);
    assert.strictEqual(data.centroid_components_count, 1);
    assert(data.centroid_standard_csv.includes("U1"));
    assert(data.gerber_layers_generated.includes("TopCopper.gbr"));
  });

  it("supply_chain_scrub_bom calculates pricing, alternates, and health score", async () => {
    const tool = tools["supply_chain_scrub_bom"]!;
    assert(tool, "supply_chain_scrub_bom tool must be registered");

    const res = await tool.handler({
      components: [
        { refDes: "U1", mpn: "STM32H743IIT6", approvedAlternates: ["STM32H753IIT6"] },
        { refDes: "C1,C2,C3", mpn: "GRM188R71C105KA12D" },
        { refDes: "U2", mpn: "LEGACY-CHIP-EOL" },
      ],
      targetQuantity: 2000,
    });

    const data = JSON.parse(res.content[0]?.text ?? "{}");
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.targetQuantity, 2000);
    assert(data.totalExtendedPrice > 0);
    assert.strictEqual(data.riskSummary.eolCount, 1);

    const u1Plan = data.componentPlans.find((p: any) => p.requestedMpn === "STM32H743IIT6");
    assert(u1Plan);
    assert.strictEqual(u1Plan.qualifiedAlternates.length, 1);
    assert.strictEqual(u1Plan.qualifiedAlternates[0].mpn, "STM32H753IIT6");
  });
});
