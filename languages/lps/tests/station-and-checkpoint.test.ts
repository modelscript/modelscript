// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { CheckpointEngine, type LpsCheckpoint } from "../src/checkpoint/checkpoint-engine.js";
import {
  StationSupervisoryController,
  type StationControlSetpoints,
  type StationProcessVariables,
} from "../src/solver/controls/station-controller.js";
import { SteadyNetworkSolver } from "../src/solver/steady/steady-network-solver.js";
import type { LpsModel } from "../src/types.js";

test("StationSupervisoryController: Manages discharge pressure control loop under normal operating conditions", () => {
  const pv: StationProcessVariables = {
    suctionPressurePa: 50e5, // 50 bar (safe)
    dischargePressurePa: 72e5, // Below 80 bar setpoint
    massFlowKgS: 65.0,
    shaftPowerWatts: 8.5e6, // 8.5 MW (below 15 MW limit)
    currentSpeedRpm: 9200,
  };

  const setpoints: StationControlSetpoints = {
    dischargePressureSetpointPa: 80e5,
    minSuctionPressurePa: 25e5,
    maxPowerWatts: 15e6,
  };

  const out = StationSupervisoryController.step(pv, setpoints, 1.0);

  assert.equal(out.controllingVariable, "DISCHARGE_PRESSURE");
  assert.equal(out.overrideActive, false);
  assert.ok(out.commandedSpeedRpm >= 6000 && out.commandedSpeedRpm <= 11000);
});

test("StationSupervisoryController: Triggers low-suction override and anti-windup when suction drops", () => {
  const pv: StationProcessVariables = {
    suctionPressurePa: 21e5, // Critical low suction near 20 bar floor
    dischargePressurePa: 70e5,
    massFlowKgS: 50.0,
    shaftPowerWatts: 7.0e6,
    currentSpeedRpm: 9500,
  };

  const setpoints: StationControlSetpoints = {
    dischargePressureSetpointPa: 80e5,
    minSuctionPressurePa: 20e5,
    maxPowerWatts: 15e6,
  };

  const out = StationSupervisoryController.step(pv, setpoints, 1.0);

  assert.equal(out.controllingVariable, "SUCTION_OVERRIDE");
  assert.equal(out.overrideActive, true);
  assert.ok(out.commandedSpeedRpm < 8000, "Suction override must clamp commanded speed down");

  // Anti-windup tracking: discharge integral should be synchronized
  assert.equal(out.states.discharge.integral, out.commandedSpeedRpm);
});

test("StationSupervisoryController: Triggers driver power limit override when shaft power exceeds rating", () => {
  const pv: StationProcessVariables = {
    suctionPressurePa: 45e5,
    dischargePressurePa: 78e5,
    massFlowKgS: 90.0,
    shaftPowerWatts: 16.5e6, // Exceeds 15 MW rating
    currentSpeedRpm: 10500,
  };

  const setpoints: StationControlSetpoints = {
    dischargePressureSetpointPa: 85e5,
    minSuctionPressurePa: 20e5,
    maxPowerWatts: 15.0e6,
  };

  const out = StationSupervisoryController.step(pv, setpoints, 1.0);

  assert.equal(out.controllingVariable, "POWER_LIMIT");
  assert.equal(out.overrideActive, true);
  assert.ok(out.commandedSpeedRpm <= 10300, "Power override throttles speed");
});

test("CheckpointEngine: Captures snapshot, serializes to .sav, and validates integrity", () => {
  const model: LpsModel = {
    id: "checkpoint-test-network",
    title: "Permian Transmission System",
    type: "TGNET",
    nodes: [
      { name: "Waha_Hub", type: "SUPPLY", elevation: 800, pressure: 70e5 },
      { name: "Katy_Terminal", type: "DELIVERY", elevation: 50, flowRate: 50.0 },
    ],
    pipes: [
      {
        name: "Mainline_42in",
        fromNode: "Waha_Hub",
        toNode: "Katy_Terminal",
        length: 700000, // 700 km
        diameter: 1.067,
        roughness: 4.5e-5,
        maop: 100e5,
      },
    ],
    compressors: [],
    pumps: [],
    regulators: [],
    valves: [],
    simulationControls: {
      startTime: 0,
      endTime: 86400,
      timeStep: 10,
      steadyStateFirst: true,
      equationOfState: "AGA8",
    },
  };

  const steady = SteadyNetworkSolver.solve(model);
  const snapshot = CheckpointEngine.createSnapshot(model, 3600.0, steady.nodeStates, steady.pipeStates);

  assert.equal(snapshot.modelId, "checkpoint-test-network");
  assert.equal(snapshot.simulationTime, 3600.0);
  assert.ok(snapshot.checksumSha256.length === 64, "SHA-256 hash generated");
  assert.ok(snapshot.nodeStates["Waha_Hub"]!.pressure > 60e5);

  // Serialize to .sav JSON
  const serialized = CheckpointEngine.serialize(snapshot);
  const deserialized = CheckpointEngine.deserialize(serialized);

  assert.equal(deserialized.simulationTime, 3600.0);
  assert.equal(CheckpointEngine.verifyChecksum(deserialized), true);

  // Tamper detection
  const tampered = JSON.parse(serialized) as LpsCheckpoint;
  tampered.nodeStates["Waha_Hub"]!.pressure = 999e5;
  assert.equal(CheckpointEngine.verifyChecksum(tampered), false);
  assert.throws(() => CheckpointEngine.deserialize(JSON.stringify(tampered)), /integrity verification failed/);

  // Apply snapshot
  const restored = CheckpointEngine.applySnapshot(model, deserialized);
  assert.equal(restored.simulationStartTime, 3600.0);
  assert.ok(restored.initialP.get("Waha_Hub")! > 60e5);
  assert.ok(restored.initialW.get("Mainline_42in")! > 0);
});
