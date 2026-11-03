// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPsseDiagram,
  classifyGeneratorKind,
  getVoltageColor,
  renderPsseSvg,
  type PsseCaseLike,
} from "../src/psse-diagram-builder.js";

const sampleCase: PsseCaseLike = {
  title1: "Test Grid Case",
  buses: [
    { i: 101, name: "BUS101", baseKv: 500, ide: 3, vm: 1.035, nvhi: 1.05, nvlo: 0.95, evhi: 1.1, evlo: 0.9 },
    { i: 102, name: "BUS102", baseKv: 230, ide: 2 },
    { i: 103, name: "BUS103", baseKv: 138, ide: 1 },
  ],
  branches: [
    { i: 102, j: 103, ckt: "1", r: 0.01, x: 0.05, b: 0.02, st: 1 },
    { i: 102, j: 103, ckt: "2", r: 0.012, x: 0.055, b: 0.02, st: 1 },
  ],
  transformers: [{ i: 101, j: 102, ckt: "1", windv1: 1.02, stat: 1 }],
  generators: [
    { i: 101, id: "1", pg: 250.0, qg: 10.0, stat: 1 },
    { i: 102, id: "W1", pg: 120.0, qg: 5.0, stat: 1 },
    { i: 102, id: "SC", pg: 0.0, qg: 62.5, pt: 0.0, pb: 0.0, stat: 1 },
  ],
  loads: [{ i: 103, id: "1", pl: 80.0, ql: 25.0, status: 1 }],
  fixedShunts: [{ i: 103, id: "C1", status: 1, gl: 0.0, bl: 65.0 }],
  switchedShunts: [{ i: 102, stat: 1, binit: 50.0 }],
  twoTerminalDc: [{ i: 1, mdc: 1, ipr: 101, ipi: 103 }],
};

test("PSS/E Voltage Colors: Maps voltage levels to standardized colors", () => {
  assert.equal(getVoltageColor(500), "#E53935");
  assert.equal(getVoltageColor(230), "#FB8C00");
  assert.equal(getVoltageColor(138), "#1E88E5");
  assert.equal(getVoltageColor(69), "#43A047");
  assert.equal(getVoltageColor(13.8), "#38BDF8");
});

test("PSS/E Generator Classification: Distinguishes Sync, Wind, Solar, and Condenser", () => {
  assert.equal(classifyGeneratorKind({ i: 1, id: "G1", pg: 200, qg: 30, stat: 1 }, "MAIN_GEN"), "sync");
  assert.equal(classifyGeneratorKind({ i: 6, id: "W1", pg: 185, qg: 35, stat: 1 }, "WIND_GEN"), "wind");
  assert.equal(classifyGeneratorKind({ i: 3, id: "S1", pg: 160, qg: 25, stat: 1 }, "SOLAR_HUB"), "solar");
  assert.equal(
    classifyGeneratorKind({ i: 4, id: "SC", pg: 0, qg: 62.5, pt: 0, stat: 1 }, "RENEW_COLLECT"),
    "condenser",
  );
});

test("PSS/E Diagram: Builds X6 graph model with buses, branches, generators, loads, and shunts", () => {
  const diag = buildPsseDiagram(sampleCase);
  assert.equal(diag.title, "Test Grid Case");
  assert.ok(diag.cells.length >= 10);

  const bus101 = diag.cells.find((c) => c.id === "bus_101");
  assert.ok(bus101);
  assert.equal((bus101.data as any)?.busNumber, 101);
  assert.equal((bus101.data as any)?.baseKv, 500);
  // 1.035 pu is within nvhi=1.05, so 500 kV bus must retain its 500 kV red stroke color
  assert.equal((bus101.attrs as any)?.body?.stroke, "#E53935");

  const bus102 = diag.cells.find((c) => c.id === "bus_102");
  const bus103 = diag.cells.find((c) => c.id === "bus_103");
  assert.ok(bus102 && bus103);
  // Verify voltage-level tier vertical ordering (EHV above HV above Sub-transmission)
  assert.ok((bus101.y ?? 0) < (bus102.y ?? 0), "500kV bus must be in higher tier than 230kV");
  assert.ok((bus102.y ?? 0) < (bus103.y ?? 0), "230kV bus must be in higher tier than 138kV");

  const gen101 = diag.cells.find((c) => c.id === "gen_101_1");
  assert.ok(gen101);
  assert.equal(gen101.shape, "circle");

  const load103 = diag.cells.find((c) => c.id === "load_103_1");
  assert.ok(load103);
  assert.equal(load103.shape, "rect");

  const shunt103 = diag.cells.find((c) => c.id === "shunt_103_C1");
  assert.ok(shunt103);
  assert.equal(shunt103.shape, "rect");

  const swshunt102 = diag.cells.find((c) => c.id === "swshunt_102_SW");
  assert.ok(swshunt102);

  const branch1 = diag.cells.find((c) => c.id === "branch_102_103_1");
  const branch2 = diag.cells.find((c) => c.id === "branch_102_103_2");
  assert.ok(branch1 && branch2);
  assert.equal((branch1.data as any)?.parallelCount, 2);

  const xfmr = diag.cells.find((c) => c.id === "xfmr_101_102_1");
  assert.ok(xfmr);

  const hvdc = diag.cells.find((c) => c.id === "hvdc_101_103_1");
  assert.ok(hvdc);
  assert.equal(hvdc.label, "HVDC 1: 101⇒103");
});

test("PSS/E Diagram: Supports PowerFlowSolution schema (pgMw/pFromMw/loadingPercent) directly", () => {
  const diag = buildPsseDiagram(sampleCase, {
    converged: true,
    iterations: 4,
    maxMismatch: 1e-7,
    buses: [
      { busNumber: 101, vm: 1.035, va: 0.0, pgMw: 252.4, qgMvar: 14.2, plMw: 0, qlMvar: 0 },
      { busNumber: 102, vm: 1.015, va: -3.2, pgMw: 120.0, qgMvar: 48.0, plMw: 0, qlMvar: 0 },
      { busNumber: 103, vm: 0.985, va: -6.5, pgMw: 0, qgMvar: 0, plMw: 80.0, qlMvar: 25.0 },
    ],
    branches: [
      {
        fromBus: 102,
        toBus: 103,
        ckt: "1",
        pFromMw: 41.2,
        qFromMvar: 12.6,
        pToMw: -40.8,
        qToMvar: -11.9,
        lossMw: 0.4,
        lossMvar: 0.7,
        mvaFlow: 43.1,
        loadingPercent: 64.5,
      },
    ],
  });

  const br = diag.cells.find((c) => c.id === "branch_102_103_1");
  assert.ok(br);
  assert.ok(br.label?.includes("41.2 MW"));
  assert.ok(br.label?.includes("[65%]"));
});

test("PSS/E SVG: Renders valid standalone SVG markup with generator callouts and shunt symbols", () => {
  const svg = renderPsseSvg(sampleCase);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("BUS101"));
  assert.ok(svg.includes("BUS102"));
  assert.ok(svg.includes("BUS103"));
  assert.ok(svg.includes("shunt-node"));
  assert.ok(svg.includes("WTG W1"));
  assert.ok(svg.includes("SC · 0.0 MW"));
  assert.ok(svg.endsWith("</svg>\n"));
});
