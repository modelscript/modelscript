// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenDssDiagram,
  getPhaseColor,
  renderOpenDssSvg,
  type DssDeckLike,
} from "../src/opendss-diagram-builder.js";

const sampleDeck: DssDeckLike = {
  circuit: { name: "MicrogridFeed", baseKv: 12.47, bus1: "SourceBus", phases: 3 },
  lines: [
    { name: "Line1", bus1: "SourceBus", bus2: "BusA", phases: 3, length: 1.2 },
    { name: "Line2", bus1: "BusA", bus2: "BusB", phases: 2, length: 0.8 },
    { name: "Line3", bus1: "BusB", bus2: "BusC", phases: 1, length: 0.5 },
  ],
  transformers: [{ name: "SubXfmr", buses: ["SourceBus", "BusA"], kvs: [115.0, 12.47] }],
  loads: [
    { name: "CommercialLoad", bus: "BusA", kw: 450, kvar: 120, phases: 3 },
    { name: "ResidentialLoad", bus: "BusC", kw: 45, kvar: 15, phases: 1 },
  ],
  pvSystems: [{ name: "RooftopSolar", bus: "BusB", kw: 150 }],
  storages: [{ name: "FeederBess", bus: "BusA", kw: 250, kwh: 1000 }],
};

test("OpenDSS Phase Colors: Maps conductor counts to line colors", () => {
  assert.equal(getPhaseColor(3), "#38bdf8"); // 3-Phase Backbone Cyan
  assert.equal(getPhaseColor(2), "#fb923c"); // 2-Phase V-Phase Orange
  assert.equal(getPhaseColor(1), "#c084fc"); // 1-Phase Lateral Tap Purple
});

test("OpenDSS Diagram: Builds X6 graph cells for buses, lines, transformers, PV, and BESS", () => {
  const diag = buildOpenDssDiagram(sampleDeck);
  assert.equal(diag.title, "Circuit.MicrogridFeed");
  assert.ok(diag.cells.length >= 10);

  const busA = diag.cells.find((c) => c.id === "bus_BusA");
  assert.ok(busA);
  assert.equal(busA.shape, "rect");

  const line1 = diag.cells.find((c) => c.id === "line_Line1");
  assert.ok(line1);
  assert.equal(line1.shape, "edge");
  assert.equal((line1.attrs?.["line"] as any)?.stroke, "#38bdf8"); // 3-phase

  const pv = diag.cells.find((c) => c.id === "pv_RooftopSolar");
  assert.ok(pv);
  assert.equal(pv.shape, "circle");

  const bess = diag.cells.find((c) => c.id === "bess_FeederBess");
  assert.ok(bess);
  assert.equal(bess.shape, "rect");
});

test("OpenDSS SVG: Renders standalone single-line diagram with phase legend", () => {
  const svg = renderOpenDssSvg(sampleDeck);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("Circuit.MicrogridFeed"));
  assert.ok(svg.includes("SourceBus"));
  assert.ok(svg.includes("BusA"));
  assert.ok(svg.includes("BusB"));
  assert.ok(svg.includes("3-Phase (3Φ)"));
  assert.ok(svg.includes("1-Phase Lateral (1Φ)"));
  assert.ok(svg.endsWith("</svg>\n"));
});
