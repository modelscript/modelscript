// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerilogADiagram,
  extractVerilogABranches,
  renderVerilogASvg,
  type VerilogAModuleLike,
} from "../src/verilog-a-diagram-builder.js";

const sampleGaNHemtModule: VerilogAModuleLike = {
  name: "GaN_HEMT_ASM_Thermal",
  ports: [
    { name: "drain", direction: "inout", discipline: "electrical" },
    { name: "gate", direction: "inout", discipline: "electrical" },
    { name: "source", direction: "inout", discipline: "electrical" },
    { name: "tj", direction: "inout", discipline: "thermal" },
  ],
  disciplines: [
    { discipline: "electrical", nodes: ["drain", "gate", "source", "di"] },
    { discipline: "thermal", nodes: ["tj"] },
  ],
  internalNodes: ["di"],
  parameters: [
    {
      name: "Vth0",
      type: "real",
      defaultValue: 1.65,
      rangeSpec: { min: 0.5, max: 3.5, minInclusive: false, maxInclusive: false },
    },
    {
      name: "Cgs0",
      type: "real",
      defaultValue: 420e-12,
    },
  ],
  variables: [{ name: "Ids" }, { name: "Qgs" }, { name: "Qgd" }],
  analogBlock: {
    statements: [
      {
        kind: "contribution",
        lhs: { nature: "I", node1: "drain", node2: "source" },
        rhs: { kind: "identifier", name: "Ids" },
      },
      {
        kind: "contribution",
        lhs: { nature: "I", node1: "gate", node2: "source" },
        rhs: {
          kind: "call",
          func: "ddt",
          args: [{ kind: "identifier", name: "Qgs" }],
        },
      },
      {
        kind: "contribution",
        lhs: { nature: "Pwr", node1: "tj" },
        rhs: { kind: "identifier", name: "P_diss" },
      },
    ],
  },
};

test("extractVerilogABranches: Classifies current, ddt(Q) capacitive, and thermal branches", () => {
  const branches = extractVerilogABranches(sampleGaNHemtModule);
  assert.equal(branches.length, 3);
  assert.equal(branches[0]?.category, "current");
  assert.equal(branches[1]?.category, "capacitive");
  assert.equal(branches[1]?.hasDdt, true);
  assert.equal(branches[2]?.category, "thermal");
  assert.equal(branches[2]?.node2, "gnd");
});

test("buildVerilogADiagram: Builds AntV X6 cells for ports, internal nodes, branches, and ground", () => {
  const diag = buildVerilogADiagram(sampleGaNHemtModule);
  assert.equal(diag.title, "GaN_HEMT_ASM_Thermal");
  assert.equal(diag.metadata.portCount, 4);
  assert.equal(diag.metadata.internalNodeCount, 1);
  assert.equal(diag.metadata.branchCount, 3);
  assert.equal(diag.metadata.parameterCount, 2);

  // 4 external ports + 1 internal node + 3 branches + 1 ground reference = 9 nodes
  assert.equal(diag.nodes.length, 9);
  assert.ok(diag.edges.length >= 6);
});

test("renderVerilogASvg: Renders standalone compact device schematic with glyphs and parameter HUD", () => {
  const svg = renderVerilogASvg(sampleGaNHemtModule);
  assert.ok(svg.startsWith("<?xml"));
  assert.ok(svg.includes("GaN_HEMT_ASM_Thermal — IEEE 1857 Verilog-A Compact Device Schematic"));
  assert.ok(svg.includes("ddt(Q)"));
  assert.ok(svg.includes("THERMAL"));
  assert.ok(svg.includes("Vth0"));
  assert.ok(svg.includes('id="va-wires-layer"'));
  assert.ok(svg.includes('id="va-nodes-layer"'));
  assert.ok(svg.includes('id="va-parameters-hud"'));
});
