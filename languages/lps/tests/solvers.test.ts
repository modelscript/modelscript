// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lpsToSysml2 } from "../src/projections/lps-to-sysml2.js";
import { LinePackEngine } from "../src/solver/line-pack/line-pack-engine.js";
import { SteadyNetworkSolver } from "../src/solver/steady/steady-network-solver.js";
import { BatchTracker } from "../src/solver/transient/batch-tracker.js";
import { GasEulerDaeSolver } from "../src/solver/transient/gas-euler-dae.js";
import { LiquidSurgeSolver } from "../src/solver/transient/liquid-surge-dae.js";
import { PipelineVerifier } from "../src/verification/pipeline-verifier.js";
import type { LpsModel } from "../types.js";

function getGasNetwork(): LpsModel {
  return {
    id: "tx_gas_grid",
    title: "Texas Gas Transmission Grid",
    type: "TGNET",
    nodes: [
      { name: "Waha_Hub", type: "SUPPLY", elevation: 0, pressure: 70e5, flowRate: 80 },
      { name: "Midland_Compressor", type: "JUNCTION", elevation: 15 },
      { name: "Midland_Discharge", type: "JUNCTION", elevation: 15 },
      { name: "DFW_CityGate", type: "DELIVERY", elevation: 5, minDeliveryPressure: 35e5, flowRate: 80 },
    ],
    pipes: [
      {
        name: "Trunk_West",
        fromNode: "Waha_Hub",
        toNode: "Midland_Compressor",
        length: 120000,
        diameter: 0.762,
        roughness: 0.000045,
        maop: 90e5,
      },
      {
        name: "Trunk_East",
        fromNode: "Midland_Discharge",
        toNode: "DFW_CityGate",
        length: 180000,
        diameter: 0.762,
        roughness: 0.000045,
        maop: 90e5,
      },
    ],
    compressors: [
      {
        name: "Midland_Station",
        fromNode: "Midland_Compressor",
        toNode: "Midland_Discharge",
        type: "CENTRIFUGAL",
        maxPower: 25e6,
        maxPressureRatio: 1.8,
        polytropicEfficiency: 0.84,
        status: "RUNNING",
        controlMode: "DISCHARGE_PRESSURE",
        setpoint: 80e5,
      },
    ],
    pumps: [],
    regulators: [],
    valves: [],
    gasComposition: {
      methane: 0.92,
      ethane: 0.05,
      propane: 0.015,
      nButane: 0.005,
      iButane: 0.005,
      pentanes: 0.002,
      hexanePlus: 0.001,
      nitrogen: 0.002,
      carbonDioxide: 0.005,
      hydrogen: 0.02,
      grossHeatingValue: 39.0,
      standardDensity: 0.77,
    },
    simulationControls: {
      startTime: 0,
      endTime: 3600,
      timeStep: 10,
      steadyStateFirst: true,
      equationOfState: "AGA8",
    },
  };
}

test("SteadyNetworkSolver solves gas network pressures and line pack", () => {
  const model = getGasNetwork();
  const steady = SteadyNetworkSolver.solve(model);

  assert.equal(steady.converged, true);
  assert.ok(steady.totalLinePackKg > 0);
  assert.ok(steady.totalLinePackSm3 > 0);

  // Compressor discharge pressure should match setpoint (80 bar)
  const dischargeP = steady.nodeStates["Midland_Discharge"].pressure;
  assert.equal(dischargeP, 80e5);

  // Outlet pressure at city gate should experience friction drop from 80 bar
  const dfwP = steady.nodeStates["DFW_CityGate"].pressure;
  assert.ok(dfwP < 80e5 && dfwP > 35e5, `DFW pressure ${dfwP} out of expected range`);
});

test("LinePackEngine evaluates inventory and storage buffer", () => {
  const model = getGasNetwork();
  const steady = SteadyNetworkSolver.solve(model);
  const analysis = LinePackEngine.analyze(model, steady);

  assert.ok(analysis.totalEnergyStoredGWh > 10, "Network should store significant energy");
  assert.ok(analysis.deliverableLinePackSm3 > 0, "Deliverable buffer should be positive");
  assert.equal(analysis.hydrogenVolumePercent, 2.0);
});

test("GasEulerDaeSolver simulates transient pressure response", () => {
  const model = getGasNetwork();
  const trajectory = GasEulerDaeSolver.simulate(model, { durationSeconds: 60, timeStep: 10 });

  assert.ok(trajectory.times.length > 5);
  assert.ok(trajectory.linePackHistory.length === trajectory.times.length);
  assert.ok(trajectory.nodePressures["Waha_Hub"].length === trajectory.times.length);
});

test("LiquidSurgeSolver evaluates water hammer surge upon rapid valve closure", () => {
  const model = getGasNetwork();
  const pipe = model.pipes[0];
  const valve = {
    name: "ESD_Valve_1",
    fromNode: pipe.fromNode,
    toNode: pipe.toNode,
    opening: 1.0,
    closingTimeSeconds: 5.0,
  };

  const surge = LiquidSurgeSolver.evaluateValveClosureSurge(model, pipe, valve, 0.6);

  assert.ok(surge.waveSpeed > 900 && surge.waveSpeed < 1400, `Wave speed ${surge.waveSpeed} out of liquid range`);
  assert.ok(surge.peakSurgePressure > 30e5, "Peak pressure must exceed base pressure");
  assert.equal(surge.timeSeries.length > 20, true);
});

test("BatchTracker propagates liquid batches and computes transmix", () => {
  const model = getGasNetwork();
  const pipe = model.pipes[0];

  const result = BatchTracker.trackBatches(model, pipe, 7200, 600);
  assert.ok(result.snapshots.length > 0);
  const lastSnap = result.snapshots[result.snapshots.length - 1];
  assert.ok(lastSnap.totalTransmixVolumeM3 >= 0);
});

test("SysML v2 projection generates complete architectural specification", () => {
  const model = getGasNetwork();
  const sysml = lpsToSysml2(model);

  assert.ok(sysml.includes("package 'tx_gas_grid'"));
  assert.ok(sysml.includes("port def PipelineFluidPort"));
  assert.ok(sysml.includes("part def PipeSegment"));
  assert.ok(sysml.includes("requirement def PipelineMaopIntegrityRequirement"));
  assert.ok(sysml.includes("state def PipelineOperationalProcedure"));
});

test("PipelineVerifier confirms safety compliance on valid network", () => {
  const model = getGasNetwork();
  const steady = SteadyNetworkSolver.solve(model);
  const report = PipelineVerifier.verifySteady(model, steady);

  assert.equal(report.passed, true);
  assert.equal(report.violations.length, 0);
  assert.ok(report.summary.totalLinePackSm3 > 0);
});
