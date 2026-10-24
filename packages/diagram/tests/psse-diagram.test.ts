// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { buildPsseDiagram, getVoltageColor, renderPsseSvg, type PsseCaseLike } from "../src/psse-diagram-builder.js";

const sampleCase: PsseCaseLike = {
  title1: "Test Grid Case",
  buses: [
    { i: 101, name: "BUS101", baseKv: 500, ide: 3 },
    { i: 102, name: "BUS102", baseKv: 230, ide: 2 },
    { i: 103, name: "BUS103", baseKv: 138, ide: 1 },
  ],
  branches: [{ i: 102, j: 103, ckt: "1", r: 0.01, x: 0.05, b: 0.02, st: 1 }],
  transformers: [{ i: 101, j: 102, ckt: "1", windv1: 1.0, stat: 1 }],
  generators: [
    { i: 101, id: "1", pg: 250.0, qg: 10.0, stat: 1 },
    { i: 102, id: "1", pg: 120.0, qg: 5.0, stat: 1 },
  ],
  loads: [{ i: 103, id: "1", pl: 80.0, ql: 25.0, status: 1 }],
};

test("PSS/E Voltage Colors: Maps voltage levels to standardized colors", () => {
  assert.equal(getVoltageColor(500), "#E53935");
  assert.equal(getVoltageColor(230), "#FB8C00");
  assert.equal(getVoltageColor(138), "#1E88E5");
  assert.equal(getVoltageColor(69), "#43A047");
  assert.equal(getVoltageColor(13.8), "#8E24AA");
});

test("PSS/E Diagram: Builds X6 graph model with buses, branches, generators, and loads", () => {
  const diag = buildPsseDiagram(sampleCase);
  assert.equal(diag.title, "Test Grid Case");
  assert.ok(diag.cells.length >= 8);

  const bus101 = diag.cells.find((c) => c.id === "bus_101");
  assert.ok(bus101);
  assert.equal((bus101.data as any)?.busNumber, 101);
  assert.equal((bus101.data as any)?.baseKv, 500);

  const gen101 = diag.cells.find((c) => c.id === "gen_101_1");
  assert.ok(gen101);
  assert.equal(gen101.shape, "circle");

  const load103 = diag.cells.find((c) => c.id === "load_103_1");
  assert.ok(load103);
  assert.equal(load103.shape, "rect");

  const branch = diag.cells.find((c) => c.id === "branch_102_103_1");
  assert.ok(branch);

  const xfmr = diag.cells.find((c) => c.id === "xfmr_101_102_1");
  assert.ok(xfmr);
});

test("PSS/E SVG: Renders valid standalone SVG markup", () => {
  const svg = renderPsseSvg(sampleCase);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("BUS101"));
  assert.ok(svg.includes("BUS102"));
  assert.ok(svg.includes("BUS103"));
  assert.ok(svg.endsWith("</svg>\n"));
});
