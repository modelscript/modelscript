// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  buildPscadDiagram,
  diffPscadProjects,
  renderPscadSvg,
  type PscadProjectLike,
} from "../src/pscad-diagram-builder.js";

console.log("=== Testing PSCAD Schematic Builder, SVG Renderer & Semantic Diff ===");

const projA: PscadProjectLike = {
  name: "WindFarmSubstation",
  rootModule: {
    buses: [
      { id: "B1", name: "Bus1_33kV", voltageBaseKv: 33, position: { x: 100, y: 150 }, length: 120 },
      { id: "B2", name: "Bus2_230kV", voltageBaseKv: 230, position: { x: 400, y: 150 }, length: 120 },
    ],
    components: [
      {
        id: "WTG1",
        definitionName: "inverter_fmu",
        instanceName: "WindTurbine_1",
        position: { x: 50, y: 150 },
        parameters: { rated_mva: 10.0, rated_kv: 33.0 },
      },
      {
        id: "T1",
        definitionName: "xfmr-3p",
        instanceName: "MainSubstationTransformer",
        position: { x: 250, y: 150 },
        parameters: { MVA: 100.0, V1: 33.0, V2: 230.0, X: 0.08 },
      },
    ],
    wires: [
      {
        id: "w1",
        vertices: [
          { x: 100, y: 150 },
          { x: 250, y: 150 },
        ],
      },
      {
        id: "w2",
        vertices: [
          { x: 320, y: 150 },
          { x: 400, y: 150 },
        ],
      },
    ],
  },
};

// 1. Test X6 Diagram Builder
{
  console.log("Test 1: buildPscadDiagram");
  const diag = buildPscadDiagram(projA);
  assert.strictEqual(diag.metadata.projectName, "WindFarmSubstation");
  assert.strictEqual(diag.metadata.nodeCount, 4); // 2 buses + 2 components
  assert.strictEqual(diag.metadata.edgeCount, 2); // 2 wires

  // Verify busbar node
  const busCell = diag.cells.find((c) => c.id === "B2");
  assert.ok(busCell, "Bus2 cell must exist");
  assert.strictEqual(busCell.data?.vbase, 230);

  // Verify transformer node has transformer markup
  const xfmrCell = diag.cells.find((c) => c.id === "T1");
  assert.ok(xfmrCell, "T1 cell must exist");
  assert.ok(xfmrCell.markup && xfmrCell.markup.length > 0, "Transformer must have custom power glyph markup");
}

// 2. Test Headless SVG Renderer
{
  console.log("Test 2: renderPscadSvg");
  const svg = renderPscadSvg(projA);
  assert.ok(svg.includes("<svg"), "Must emit valid SVG root tag");
  assert.ok(svg.includes("Bus2_230kV"), "Must include Bus label in SVG");
  assert.ok(svg.includes("MainSubstationTransformer"), "Must include Transformer label in SVG");
  assert.ok(svg.includes('<path d="M 100 150 L 250 150"'), "Must include routed wire path in SVG");
  console.log(`   Generated standalone SVG: ${svg.length} bytes`);
}

// 3. Test Semantic Git Diff
{
  console.log("Test 3: diffPscadProjects");
  const projB: PscadProjectLike = {
    name: "WindFarmSubstation",
    rootModule: {
      buses: [...projA.rootModule.buses],
      components: [
        // Modified T1: rating increased from 100 to 120 MVA
        {
          id: "T1",
          definitionName: "xfmr-3p",
          instanceName: "MainSubstationTransformer",
          position: { x: 250, y: 150 },
          parameters: { MVA: 120.0, V1: 33.0, V2: 230.0, X: 0.08 },
        },
        // Added WTG2
        {
          id: "WTG2",
          definitionName: "inverter_fmu",
          instanceName: "WindTurbine_2",
          position: { x: 50, y: 250 },
          parameters: { rated_mva: 10.0, rated_kv: 33.0 },
        },
        // WTG1 removed
      ],
      wires: [...projA.rootModule.wires],
    },
  };

  const diff = diffPscadProjects(projA, projB);
  console.log(`   ${diff.diffSummary.replace(/\n/g, "\n   ")}`);

  assert.strictEqual(diff.addedComponents.length, 1, "Must detect 1 added component (WTG2)");
  assert.strictEqual(diff.addedComponents[0]?.id, "WTG2");

  assert.strictEqual(diff.removedComponents.length, 1, "Must detect 1 removed component (WTG1)");
  assert.strictEqual(diff.removedComponents[0]?.id, "WTG1");

  assert.strictEqual(diff.modifiedComponents.length, 1, "Must detect 1 modified component (T1)");
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.param, "MVA");
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.oldValue, 100.0);
  assert.strictEqual(diff.modifiedComponents[0]?.changedParams[0]?.newValue, 120.0);
}

console.log("ALL PSCAD DIAGRAM & DIFF TESTS PASSED SUCCESSFULLY! Milestone 2 verified.");
