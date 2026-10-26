// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { buildSpiceDiagram, renderSpiceSvg } from "../src/index.js";
import type { SpiceCircuit } from "../src/types.js";

describe("@modelscript/spice Diagram & SVG Generator", () => {
  const mockCircuit: SpiceCircuit = {
    title: "RC Low-Pass Filter with Op-Amp Buffer",
    components: [
      {
        name: "VIN",
        kind: "V",
        nodes: ["in", "0"],
        value: 5.0,
        params: new Map(),
      },
      {
        name: "R1",
        kind: "R",
        nodes: ["in", "n1"],
        value: 10000,
        params: new Map(),
      },
      {
        name: "C1",
        kind: "C",
        nodes: ["n1", "0"],
        value: 1e-7,
        params: new Map(),
      },
      {
        name: "X_AMP",
        kind: "X",
        nodes: ["n1", "0", "vcc", "vee", "out"],
        subcktName: "OPAMP",
        params: new Map(),
      },
      {
        name: "RLOAD",
        kind: "R",
        nodes: ["out", "0"],
        value: 1000,
        params: new Map(),
      },
    ],
    subcircuits: [],
    models: [],
    analyses: [],
    parameters: new Map(),
    variables: new Set(),
  };

  test("generates AntV X6 graph structure with electrical components and net wires", () => {
    const diag = buildSpiceDiagram(mockCircuit);
    assert.equal(diag.title, "RC Low-Pass Filter with Op-Amp Buffer");

    const compCells = diag.cells.filter((c) => c.id.startsWith("comp_"));
    assert.equal(compCells.length, 5, "Should create 5 component nodes");

    const r1Cell = compCells.find((c) => c.id === "comp_R1");
    assert.ok(r1Cell, "Should find R1 component");
    assert.equal(r1Cell?.shape, "rect");

    const wireCells = diag.cells.filter((c) => c.id.startsWith("wire_"));
    assert.ok(wireCells.length >= 4, "Should create shared net connections between components");

    const gndWires = wireCells.filter((w) => w.data?.["isGround"] === true);
    assert.ok(gndWires.length >= 1, "Should identify ground (0) nets");
  });

  test("renders valid, well-formed dark-mode SVG schematic", () => {
    const svg = renderSpiceSvg(mockCircuit);
    assert.ok(svg.startsWith("<?xml version="), "Should produce valid XML declaration");
    assert.ok(svg.includes("<svg"), "Should contain svg root element");
    assert.ok(svg.includes("RC Low-Pass Filter with Op-Amp Buffer"), "Should contain circuit title");
    assert.ok(svg.includes("R1"), "Should contain resistor R1");
    assert.ok(svg.includes("10.0kΩ"), "Should format resistor engineering value with metric prefix");
    assert.ok(svg.includes("100nF"), "Should format capacitor engineering value with metric prefix");
    assert.ok(svg.includes("spice-glow"), "Should define schematic glow filter");
    assert.ok(svg.endsWith("</svg>\n"), "Should properly close svg tag");
  });
});
