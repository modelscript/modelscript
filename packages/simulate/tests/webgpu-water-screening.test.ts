// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  calculateWaterNetworkSensitivities,
  type WaterNodeDef,
  type WaterPipeDef,
} from "../src/solvers/water/hydraulic-sensitivity.js";
import { WebGpuWaterScreener, type WaterScreeningOptions } from "../src/solvers/water/webgpu-water-screening.js";

test("Water Hydraulic Sensitivity: 3-Node Meshed Network Analytical Verification", () => {
  // Node 0: Reservoir (Fixed head = 100m)
  // Node 1: Junction (Elevation = 20m, Demand = 25 L/s)
  // Node 2: Junction (Elevation = 20m, Demand = 35 L/s)
  const nodes: WaterNodeDef[] = [
    { id: "RES", elevationM: 100.0, baseHeadM: 100.0, baseDemandLps: 0.0, isFixedHead: true },
    { id: "J1", elevationM: 20.0, baseHeadM: 85.0, baseDemandLps: 25.0, isFixedHead: false },
    { id: "J2", elevationM: 20.0, baseHeadM: 82.0, baseDemandLps: 35.0, isFixedHead: false },
  ];

  // Pipe 0: RES -> J1 (L = 500m, D = 0.3m, Q = 40 L/s, hf = 15m)
  // Pipe 1: J1 -> J2 (L = 300m, D = 0.2m, Q = 15 L/s, hf = 3m)
  // Pipe 2: RES -> J2 (L = 600m, D = 0.25m, Q = 20 L/s, hf = 18m)
  const pipes: WaterPipeDef[] = [
    {
      id: "P0",
      fromNode: "RES",
      toNode: "J1",
      lengthM: 500,
      diameterM: 0.3,
      roughness: 120,
      baseFlowLps: 40.0,
      headLossM: 15.0,
    },
    {
      id: "P1",
      fromNode: "J1",
      toNode: "J2",
      lengthM: 300,
      diameterM: 0.2,
      roughness: 120,
      baseFlowLps: 15.0,
      headLossM: 3.0,
    },
    {
      id: "P2",
      fromNode: "RES",
      toNode: "J2",
      lengthM: 600,
      diameterM: 0.25,
      roughness: 120,
      baseFlowLps: 20.0,
      headLossM: 18.0,
    },
  ];

  const sens = calculateWaterNetworkSensitivities(nodes, pipes);

  assert.strictEqual(sens.nodeCount, 3);
  assert.strictEqual(sens.pipeCount, 3);
  assert.strictEqual(sens.headSensitivityMatrix.length, 9);

  // Reservoir is fixed head: S_H(0, j) = 0 and S_H(i, 0) = 0
  assert.strictEqual(sens.headSensitivityMatrix[0 * 3 + 0], 0.0);
  assert.strictEqual(sens.headSensitivityMatrix[0 * 3 + 1], 0.0);
  assert.strictEqual(sens.headSensitivityMatrix[1 * 3 + 0], 0.0);

  // Junctions have positive diagonal sensitivity (increasing demand reduces head)
  const s11 = sens.headSensitivityMatrix[1 * 3 + 1]!;
  const s22 = sens.headSensitivityMatrix[2 * 3 + 2]!;
  const s12 = sens.headSensitivityMatrix[1 * 3 + 2]!;
  const s21 = sens.headSensitivityMatrix[2 * 3 + 1]!;

  assert(s11 > 0, `s11 must be positive, got ${s11}`);
  assert(s22 > 0, `s22 must be positive, got ${s22}`);
  assert(s12 > 0, `s12 cross-sensitivity must be positive, got ${s12}`);
  // Admittance matrix is symmetric, so sensitivity must be symmetric
  assert(Math.abs(s12 - s21) < 1e-5, `Symmetry violation: s12=${s12} vs s21=${s21}`);

  // Dipole outage factors must be non-zero
  for (let p = 0; p < 3; p++) {
    assert(Math.abs(sens.pipeOutageFactors[p]!) > 1e-4);
  }
});

test("WebGPU Water Contingency Screener: All N-1 Pipe Outage Batch Screening", async () => {
  const nodes: WaterNodeDef[] = [
    { id: "R1", elevationM: 80.0, baseHeadM: 80.0, baseDemandLps: 0.0, isFixedHead: true },
    { id: "J1", elevationM: 30.0, baseHeadM: 70.0, baseDemandLps: 30.0 },
    { id: "J2", elevationM: 25.0, baseHeadM: 65.0, baseDemandLps: 40.0 },
    { id: "J3", elevationM: 20.0, baseHeadM: 60.0, baseDemandLps: 50.0 },
  ];

  const pipes: WaterPipeDef[] = [
    {
      id: "P1",
      fromNode: "R1",
      toNode: "J1",
      lengthM: 1000,
      diameterM: 0.4,
      roughness: 130,
      baseFlowLps: 120.0,
      headLossM: 10.0,
    },
    {
      id: "P2",
      fromNode: "J1",
      toNode: "J2",
      lengthM: 800,
      diameterM: 0.3,
      roughness: 120,
      baseFlowLps: 50.0,
      headLossM: 5.0,
    },
    {
      id: "P3",
      fromNode: "J2",
      toNode: "J3",
      lengthM: 600,
      diameterM: 0.25,
      roughness: 120,
      baseFlowLps: 20.0,
      headLossM: 5.0,
    },
    {
      id: "P4",
      fromNode: "J1",
      toNode: "J3",
      lengthM: 1200,
      diameterM: 0.25,
      roughness: 110,
      baseFlowLps: 40.0,
      headLossM: 10.0,
    },
  ];

  const sens = calculateWaterNetworkSensitivities(nodes, pipes);
  const screener = await WebGpuWaterScreener.create(null);

  const opts: WaterScreeningOptions = {
    minResidualPressureM: 14.06, // 20 psi
    maxVelocityMps: 2.0,
    pddMinPressureM: 0.0,
    pddReqPressureM: 20.0,
    preferCpu: true,
  };

  const result = await screener.screenAllPipeOutages(sens, opts);

  assert.strictEqual(result.backend, "cpu-simd");
  assert.strictEqual(result.scenarioType, "N1_OUTAGE");
  assert.strictEqual(result.scenariosEvaluated, 4, "Must screen all 4 pipes as N-1 contingencies");
  assert.strictEqual(result.nodesMonitored, 4);
  assert.strictEqual(result.pipesMonitored, 4);
  assert.strictEqual(result.totalEvaluations, 16);

  // Verify top critical pipes
  const top = result.topCriticalPipes!;
  assert(top.length > 0);
  assert(top.some((p) => p.pipeId === "P1" || p.pipeId === "P2"));
  assert(top[0]!.criticalityScore > 0, "Criticality score must be positive");

  for (const s of result.summaries) {
    assert(s.satisfactionRatio >= 0.0 && s.satisfactionRatio <= 1.0);
    assert(typeof s.hasPressureViolation === "boolean");
    assert(typeof s.hasNegativePressure === "boolean");
  }
});

test("WebGPU Water Screener: Fire Flow Capacity & NFPA 291 Rating", async () => {
  const nodes: WaterNodeDef[] = [
    { id: "RES", elevationM: 90.0, baseHeadM: 90.0, baseDemandLps: 0.0, isFixedHead: true },
    { id: "HYD_1", elevationM: 25.0, baseHeadM: 80.0, baseDemandLps: 15.0 }, // Pressure = 55m (~78 psi)
    { id: "HYD_2", elevationM: 30.0, baseHeadM: 75.0, baseDemandLps: 20.0 }, // Pressure = 45m (~64 psi)
  ];

  const pipes: WaterPipeDef[] = [
    {
      id: "MAIN_1",
      fromNode: "RES",
      toNode: "HYD_1",
      lengthM: 500,
      diameterM: 0.35,
      roughness: 130,
      baseFlowLps: 35.0,
      headLossM: 10.0,
    },
    {
      id: "LOOP_1",
      fromNode: "HYD_1",
      toNode: "HYD_2",
      lengthM: 400,
      diameterM: 0.25,
      roughness: 120,
      baseFlowLps: 20.0,
      headLossM: 5.0,
    },
  ];

  const sens = calculateWaterNetworkSensitivities(nodes, pipes);
  const screener = new WebGpuWaterScreener(null);

  const opts: WaterScreeningOptions = {
    minResidualPressureM: 14.06, // 20 psi minimum residual
    fireFlowDrawLps: 63.09, // 1,000 gpm standard test flow
    preferCpu: true,
  };

  const result = screener.screenScenariosCpu(sens, "FIRE_FLOW", new Uint32Array([1, 2]), opts);

  assert.strictEqual(result.scenarioType, "FIRE_FLOW");
  assert.strictEqual(result.scenariosEvaluated, 2);
  assert(result.fireFlowCapacities && result.fireFlowCapacities.length === 2);

  for (const f of result.fireFlowCapacities) {
    assert(f.availableFireFlowLps > 0, "Available fire flow must be positive");
    assert(["CLASS_AA", "CLASS_A", "CLASS_B", "CLASS_C"].includes(f.nfpaClass));
  }
});

test("WebGPU Water Screener: High-Volume 1,000 Contingency Scalability Stress Test", () => {
  const N = 80;
  const P = 120;
  const K = 1000;

  const nodes: WaterNodeDef[] = [];
  for (let i = 0; i < N; i++) {
    nodes.push({
      id: `Node_${i}`,
      elevationM: 20.0 + (i % 10) * 2.0,
      baseHeadM: 80.0 - (i % 15) * 1.5,
      baseDemandLps: i === 0 ? 0.0 : 5.0 + (i % 5) * 2.0,
      isFixedHead: i === 0,
    });
  }

  const pipes: WaterPipeDef[] = [];
  for (let p = 0; p < P; p++) {
    const u = p % N;
    const v = (p + 1 + (p % 3)) % N;
    pipes.push({
      id: `Pipe_${p}`,
      fromNode: nodes[u]!.id,
      toNode: nodes[v]!.id,
      lengthM: 300.0 + (p % 7) * 50.0,
      diameterM: 0.2 + (p % 4) * 0.05,
      roughness: 120,
      baseFlowLps: 10.0 + (p % 10) * 3.0,
      headLossM: 2.0 + (p % 5) * 0.8,
    });
  }

  const sens = calculateWaterNetworkSensitivities(nodes, pipes);

  // Generate 1,000 random/repeated pipe contingency targets
  const targetIndices = new Uint32Array(K);
  for (let c = 0; c < K; c++) {
    targetIndices[c] = c % P;
  }

  const screener = new WebGpuWaterScreener(null);
  const result = screener.screenScenariosCpu(sens, "N1_OUTAGE", targetIndices, {
    minResidualPressureM: 14.06,
    maxVelocityMps: 2.5,
  });

  assert.strictEqual(result.scenariosEvaluated, 1000);
  assert.strictEqual(result.nodesMonitored, N);
  assert.strictEqual(result.totalEvaluations, 1000 * N); // 80,000 evaluations
  assert(
    result.executionTimeMs < 100,
    `Expected 1,000 contingencies (80k evals) in < 100ms, took ${result.executionTimeMs.toFixed(2)}ms`,
  );
});
