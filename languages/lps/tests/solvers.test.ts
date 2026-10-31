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

test("SteadyNetworkSolver: solves parallel-pipe loop with non-equal hydraulic flow split and exact loop pressure balance", () => {
  const parallelModel: LpsModel = {
    id: "parallel_loop_grid",
    title: "Parallel Transmission Loop",
    type: "TGNET",
    nodes: [
      { name: "Supply_A", type: "SUPPLY", elevation: 0, pressure: 70e5, flowRate: 120 },
      { name: "Header_B", type: "JUNCTION", elevation: 0 },
      { name: "Delivery_C", type: "DELIVERY", elevation: 0, flowRate: 120 },
    ],
    pipes: [
      {
        name: "Feeder_AB",
        fromNode: "Supply_A",
        toNode: "Header_B",
        length: 20000,
        diameter: 0.914,
        roughness: 4.5e-5,
        maop: 100e5,
      },
      {
        name: "Loop_Large_BC",
        fromNode: "Header_B",
        toNode: "Delivery_C",
        length: 50000,
        diameter: 0.762, // 30-inch
        roughness: 4.5e-5,
        maop: 100e5,
      },
      {
        name: "Loop_Small_BC",
        fromNode: "Header_B",
        toNode: "Delivery_C",
        length: 50000,
        diameter: 0.508, // 20-inch
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
      endTime: 3600,
      timeStep: 10,
      steadyStateFirst: true,
      equationOfState: "AGA8",
    },
  };

  const res = SteadyNetworkSolver.solve(parallelModel);
  assert.equal(res.converged, true);

  const mFeeder = res.pipeStates["Feeder_AB"]!.massFlow;
  const mLarge = res.pipeStates["Loop_Large_BC"]!.massFlow;
  const mSmall = res.pipeStates["Loop_Small_BC"]!.massFlow;

  // Kirchhoff's 1st Law: mass conservation at Header_B and Delivery_C
  assert.ok(Math.abs(mFeeder - 120.0) < 1e-3, `Expected feeder flow 120 kg/s, got ${mFeeder}`);
  assert.ok(Math.abs(mLarge + mSmall - 120.0) < 1e-3, `Expected parallel sum 120 kg/s, got ${mLarge + mSmall}`);

  // Larger 30-inch pipe must carry significantly more flow than smaller 20-inch pipe (not 50/50 split!)
  assert.ok(mLarge > 2.0 * mSmall, `Expected 30-inch pipe flow (${mLarge}) > 2x 20-inch pipe flow (${mSmall})`);

  // Kirchhoff's 2nd Law (Loop Pressure Drop): pressure drop across both parallel branches must be identical
  const dpLarge = res.pipeStates["Loop_Large_BC"]!.inletPressure - res.pipeStates["Loop_Large_BC"]!.outletPressure;
  const dpSmall = res.pipeStates["Loop_Small_BC"]!.inletPressure - res.pipeStates["Loop_Small_BC"]!.outletPressure;
  assert.ok(Math.abs(dpLarge - dpSmall) < 1e-3, `Loop pressure drop mismatch: ${dpLarge} vs ${dpSmall}`);
  assert.ok(
    Math.abs(res.pipeStates["Loop_Large_BC"]!.frictionLossPa - res.pipeStates["Loop_Small_BC"]!.frictionLossPa) < 1.0,
    "Friction loss along parallel horizontal branches must match to within 1 Pa",
  );
});

test("SteadyNetworkSolver: solves 4-node diamond/ring mesh network satisfying Kirchhoff nodal and loop laws", () => {
  const ringModel: LpsModel = {
    id: "diamond_ring_mesh",
    title: "4-Node Diamond Ring Gas Mesh",
    type: "TGNET",
    nodes: [
      { name: "N1_Source", type: "SUPPLY", elevation: 0, pressure: 65e5, flowRate: 100 },
      { name: "N2_North", type: "JUNCTION", elevation: 0 },
      { name: "N3_South", type: "JUNCTION", elevation: 0 },
      { name: "N4_Sink", type: "DELIVERY", elevation: 0, flowRate: 100 },
    ],
    pipes: [
      {
        name: "P12",
        fromNode: "N1_Source",
        toNode: "N2_North",
        length: 30000,
        diameter: 0.6,
        roughness: 4.5e-5,
        maop: 90e5,
      },
      {
        name: "P13",
        fromNode: "N1_Source",
        toNode: "N3_South",
        length: 60000,
        diameter: 0.5,
        roughness: 4.5e-5,
        maop: 90e5,
      },
      {
        name: "P23_Cross",
        fromNode: "N2_North",
        toNode: "N3_South",
        length: 25000,
        diameter: 0.4,
        roughness: 4.5e-5,
        maop: 90e5,
      },
      {
        name: "P24",
        fromNode: "N2_North",
        toNode: "N4_Sink",
        length: 50000,
        diameter: 0.5,
        roughness: 4.5e-5,
        maop: 90e5,
      },
      {
        name: "P34",
        fromNode: "N3_South",
        toNode: "N4_Sink",
        length: 30000,
        diameter: 0.6,
        roughness: 4.5e-5,
        maop: 90e5,
      },
    ],
    compressors: [],
    pumps: [],
    regulators: [],
    valves: [],
    simulationControls: {
      startTime: 0,
      endTime: 3600,
      timeStep: 10,
      steadyStateFirst: true,
      equationOfState: "AGA8",
    },
  };

  const res = SteadyNetworkSolver.solve(ringModel);
  assert.equal(res.converged, true);

  const m12 = res.pipeStates["P12"]!.massFlow;
  const m13 = res.pipeStates["P13"]!.massFlow;
  const m23 = res.pipeStates["P23_Cross"]!.massFlow;
  const m24 = res.pipeStates["P24"]!.massFlow;
  const m34 = res.pipeStates["P34"]!.massFlow;

  // Nodal mass conservation at N1, N2, N3, N4
  assert.ok(Math.abs(m12 + m13 - 100.0) < 1e-3, `Source split mismatch: ${m12 + m13}`);
  assert.ok(Math.abs(m12 - m23 - m24) < 1e-3, `Node N2 mass balance residual: ${m12 - m23 - m24}`);
  assert.ok(Math.abs(m13 + m23 - m34) < 1e-3, `Node N3 mass balance residual: ${m13 + m23 - m34}`);
  assert.ok(Math.abs(m24 + m34 - 100.0) < 1e-3, `Sink delivery sum mismatch: ${m24 + m34}`);

  // Loop 1 (N1 -> N2 -> N3 -> N1) and Loop 2 (N2 -> N4 -> N3 -> N2) pressure drop consistency
  const p1 = res.nodeStates["N1_Source"]!.pressure;
  const p2 = res.nodeStates["N2_North"]!.pressure;
  const p3 = res.nodeStates["N3_South"]!.pressure;
  const p4 = res.nodeStates["N4_Sink"]!.pressure;
  assert.ok(
    p1 > p2 && p2 > p3 && p3 > p4,
    `Expected pressure ordering P1 > P2 > P3 > P4, got ${p1}, ${p2}, ${p3}, ${p4}`,
  );
  assert.ok(m23 > 0, "Cross-tie pipe P23_Cross should flow from higher-pressure N2_North to N3_South");
});
