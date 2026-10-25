// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintLpsModel } from "../src/lints/index.js";
import type { LpsModel } from "../types.js";

function getBaseModel(): LpsModel {
  return {
    id: "test_model",
    title: "Test Pipeline Model",
    type: "TGNET",
    nodes: [
      { name: "Inlet", type: "SUPPLY", elevation: 0, pressure: 60e5, flowRate: 50 },
      { name: "Junction1", type: "JUNCTION", elevation: 0 },
      { name: "Outlet", type: "DELIVERY", elevation: 0, minDeliveryPressure: 30e5, flowRate: 50 },
    ],
    pipes: [
      {
        name: "P1",
        fromNode: "Inlet",
        toNode: "Junction1",
        length: 10000,
        diameter: 0.5,
        roughness: 0.000045,
        maop: 100e5,
      },
      {
        name: "P2",
        fromNode: "Junction1",
        toNode: "Outlet",
        length: 10000,
        diameter: 0.5,
        roughness: 0.000045,
        maop: 100e5,
      },
    ],
    compressors: [],
    pumps: [],
    regulators: [],
    valves: [],
    gasComposition: {
      methane: 0.95,
      ethane: 0.03,
      propane: 0.01,
      nButane: 0.005,
      iButane: 0.005,
      pentanes: 0,
      hexanePlus: 0,
      nitrogen: 0,
      carbonDioxide: 0,
      hydrogen: 0,
    },
    simulationControls: {
      startTime: 0,
      endTime: 3600,
      timeStep: 60,
      steadyStateFirst: true,
      equationOfState: "AGA8",
    },
  };
}

test("Linter passes on clean, valid model", () => {
  const model = getBaseModel();
  const diags = lintLpsModel(model);
  assert.equal(diags.length, 0);
});

test("M8004 triggers on isolated / unconnected node", () => {
  const model = getBaseModel();
  model.nodes.push({ name: "GhostNode", type: "JUNCTION", elevation: 10 });
  const diags = lintLpsModel(model);
  const m8004 = diags.find((d) => d.code === "M8004");
  assert.ok(m8004 != null);
  assert.equal(m8004.rule, "unconnected-pipeline-node");
  assert.equal(m8004.target, "GhostNode");
});

test("M8001 triggers on MAOP exceeded", () => {
  const model = getBaseModel();
  // Set node pressure higher than pipe MAOP
  model.nodes[0].pressure = 120e5; // 120 bar vs 100 bar MAOP
  const diags = lintLpsModel(model);
  const m8001 = diags.find((d) => d.code === "M8001");
  assert.ok(m8001 != null);
  assert.equal(m8001.rule, "maop-exceeded");
  assert.equal(m8001.severity, "error");
});

test("M8002 triggers on compressor surge hazard", () => {
  const model = getBaseModel();
  model.compressors.push({
    name: "Comp1",
    fromNode: "Junction1",
    toNode: "Outlet",
    type: "CENTRIFUGAL",
    maxPower: 10e6,
    maxPressureRatio: 1.5,
    surgeFlow: 40.0,
    polytropicEfficiency: 0.82,
    status: "RUNNING",
    controlMode: "MASS_FLOW",
    setpoint: 25.0, // below 40.0 surge flow!
  });
  const diags = lintLpsModel(model);
  const m8002 = diags.find((d) => d.code === "M8002");
  assert.ok(m8002 != null);
  assert.equal(m8002.rule, "compressor-surge-hazard");
  assert.equal(m8002.severity, "warning");
});

test("M8008 triggers on high hydrogen blend ratio (> 10%)", () => {
  const model = getBaseModel();
  model.gasComposition!.hydrogen = 0.18; // 18% H2
  const diags = lintLpsModel(model);
  const m8008 = diags.find((d) => d.code === "M8008");
  assert.ok(m8008 != null);
  assert.equal(m8008.rule, "hydrogen-embrittlement-risk");
  assert.equal(m8008.severity, "warning");
});

test("M8010 triggers on severe regulator throttling without preheater", () => {
  const model = getBaseModel();
  model.nodes[0].pressure = 80e5; // 80 bar
  model.regulators.push({
    name: "PRV_CityGate",
    fromNode: "Inlet",
    toNode: "Junction1",
    setpointPressure: 20e5, // 20 bar (deltaP = 60 bar drop!)
    maxCapacity: 50,
    preheaterInstalled: false,
  });
  const diags = lintLpsModel(model);
  const m8010 = diags.find((d) => d.code === "M8010");
  assert.ok(m8010 != null);
  assert.equal(m8010.rule, "joule-thomson-freezing");
  assert.equal(m8010.severity, "warning");
});
