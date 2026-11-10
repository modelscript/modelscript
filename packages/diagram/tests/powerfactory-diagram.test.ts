// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  type PowerFactoryDiagramModel,
  renderPowerFactorySvg,
} from "../src/powerfactory-diagram-builder.js";

const sampleModel: PowerFactoryDiagramModel = {
  name: "Two_Substation_Grid",
  terminals: new Map([
    ["T1", { id: "T1", loc_name: "Bus_110kV_1", uknom: 110.0, x: 150, y: 200 }],
    ["T2", { id: "T2", loc_name: "Bus_110kV_2", uknom: 110.0, x: 450, y: 200 }],
    ["T3", { id: "T3", loc_name: "Bus_20kV", uknom: 20.0, x: 450, y: 400 }],
  ]),
  lines: new Map([
    ["L1", { id: "L1", loc_name: "Line_1_2", bus1Id: "T1", bus2Id: "T2", dline: 25.0, loadingPercent: 68.5 }],
  ]),
  transformers2w: new Map([
    ["TR1", { id: "TR1", loc_name: "Trafo_110_20", bushvId: "T2", buslvId: "T3", strn: 40.0 }],
  ]),
  generators: new Map([
    ["G1", { id: "G1", loc_name: "Gen_1", bus1Id: "T1", pgini: 80.0, qgini: 15.0 }],
  ]),
  loads: new Map([
    ["LD1", { id: "LD1", loc_name: "Load_1", bus1Id: "T3", plini: 30.0, qlini: 8.0 }],
  ]),
  switches: new Map([
    ["CB1", { id: "CB1", loc_name: "CB_Line", bus1Id: "T1", bus2Id: "T2", on_off: 1, isBreaker: true }],
  ]),
};

test("renderPowerFactorySvg: renders complete SLD with busbars, lines, trafos, and breakers", () => {
  const svg = renderPowerFactorySvg(sampleModel, {
    title: "Regional Transmission Grid",
    showTelemetry: true,
  });

  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("Bus_110kV_1"));
  assert.ok(svg.includes("Bus_110kV_2"));
  assert.ok(svg.includes("Bus_20kV"));
  assert.ok(svg.includes("Line_1_2"));
  assert.ok(svg.includes("69%")); // Loading badge
  assert.ok(svg.includes("Trafo_110_20"));
  assert.ok(svg.includes("Gen_1"));
  assert.ok(svg.includes("Load_1"));
  assert.ok(svg.includes("CB_Line"));
  assert.ok(svg.includes("breaker-toggle"));
  assert.ok(svg.includes("</svg>"));
});
