// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpiceDiagram,
  formatSpiceValue,
  renderSpiceSvg,
  type SpiceCircuitLike,
} from "../src/spice-diagram-builder.js";

const sampleRlcCircuit: SpiceCircuitLike = {
  title: "RLC Low-Pass Filter with Diode Clamp",
  components: [
    { name: "Vin", kind: "V", nodes: ["in", "0"], value: 5.0 },
    { name: "R1", kind: "R", nodes: ["in", "node1"], value: 1000 },
    { name: "L1", kind: "L", nodes: ["node1", "out"], value: 0.001 },
    { name: "C1", kind: "C", nodes: ["out", "0"], value: 1e-6 },
    { name: "D1", kind: "D", nodes: ["out", "0"], model: "1N4148" },
  ],
};

test("formatSpiceValue: Formats electrical engineering notation with metric prefixes", () => {
  assert.equal(formatSpiceValue(1000, "R"), "1.00kΩ");
  assert.equal(formatSpiceValue(1e-6, "C"), "1.00µF");
  assert.equal(formatSpiceValue(0.001, "L"), "1.00mH");
  assert.equal(formatSpiceValue(5, "V"), "5.00V");
  assert.equal(formatSpiceValue(0.02, "I"), "20.0mA");
});

test("buildSpiceDiagram: Generates X6 diagram cells for components and interconnected nets", () => {
  const diag = buildSpiceDiagram(sampleRlcCircuit);
  assert.equal(diag.title, "RLC Low-Pass Filter with Diode Clamp");

  // 5 components + net edges
  const comps = diag.cells.filter((c) => c.id.startsWith("comp_"));
  assert.equal(comps.length, 5);

  const r1 = comps.find((c) => c.id === "comp_R1");
  assert.ok(r1);
  assert.equal(r1.data?.["badge"], "RES");

  const wires = diag.cells.filter((c) => c.id.startsWith("wire_"));
  assert.ok(wires.length >= 3);
});

test("renderSpiceSvg: Renders IEEE Std 315 vector glyphs and computes topological solder dots", () => {
  const svg = renderSpiceSvg(sampleRlcCircuit);
  assert.ok(svg.startsWith("<?xml"));
  assert.ok(svg.includes("RLC Low-Pass Filter with Diode Clamp — SPICE Circuit Schematic"));

  // Check IEEE 315 vector glyphs
  assert.ok(svg.includes('<g id="comp_R1"'));
  // Resistor zig-zag path from resistorGlyph
  assert.ok(svg.includes("M 0,15 L 0,22 L -8,26 L 8,32"));
  // Capacitor parallel plates from capacitorGlyph
  assert.ok(svg.includes("plateTop") || svg.includes('x1="-12" y1="33"'));
  // Inductor coils from inductorGlyph
  assert.ok(svg.includes("A 6,6 0 0,1 0,34"));

  // Solder dots layer
  assert.ok(svg.includes('id="spice-wires-layer"'));
  assert.ok(svg.includes('id="spice-components-layer"'));
});
