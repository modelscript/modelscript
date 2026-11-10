// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  emitSparseEmtSolverWGSL,
  WebGpuSparseEmtSolver,
  type GpuBranchDef,
  type GpuSourceDef,
  type GpuSparseMatrixCsr,
  type SparseEmtGpuConfig,
  type WebGpuSparseEmtOptions,
} from "../src/solvers/emt/index.js";

test("WebGPU Sparse EMT: WGSL compute shader kernel generation and syntax layout", () => {
  const config: SparseEmtGpuConfig = {
    numBuses: 9,
    numNodes: 27, // 9 buses * 3 phases
    numBranches: 36,
    numSources: 3,
    sparseNnz: 108,
    dtSec: 50e-6,
    nominalFrequencyHz: 60.0,
    workgroupSize: 64,
    batchStepsPerDispatch: 100,
  };

  const wgsl = emitSparseEmtSolverWGSL(config);

  assert(wgsl.includes("@compute @workgroup_size(64, 1, 1)"), "Shader must declare compute workgroup size");
  assert(wgsl.includes("struct EmtGridParams"), "Shader must declare EmtGridParams struct");
  assert(wgsl.includes("struct GpuSource"), "Shader must declare GpuSource struct");
  assert(wgsl.includes("struct GpuBranch"), "Shader must declare GpuBranch struct");
  assert(wgsl.includes("struct SparseMatrixData"), "Shader must declare SparseMatrixData struct");
  assert(wgsl.includes("fn execute_emt_single_step"), "Shader must declare single-step EMT kernel function");
  assert(wgsl.includes("fn step_sparse_emt"), "Shader must declare batched entry point");
  assert(wgsl.includes("trajectory_voltages"), "Shader must write voltage trajectories");
  assert(wgsl.includes("trajectory_currents"), "Shader must write branch current trajectories");
});

test("WebGPU Sparse EMT: 3-Phase Transmission Grid multi-step simulation with sparse LU solve", async () => {
  // Test Network: 2-bus 3-phase grid (6 scalar nodes: 0,1,2 = Bus 1; 3,4,5 = Bus 2)
  // - Bus 1: 230 kV AC voltage source (g_src = 10 S, R_src = 0.1 Ohm)
  // - Branch 1-2: 3-phase RL transmission line (R = 1.0 Ohm, L = 0.02 H, dt = 50 us -> g_eq = dt / (2*L + R*dt) ≈ 0.001235 S)
  // - Bus 2: 3-phase parallel resistive load (R = 500 Ohm -> g = 0.002 S)
  const dt = 50e-6;
  const numNodes = 6;
  const omega = 2.0 * Math.PI * 60.0;
  const vPeakLL = 230e3;
  const vPeakLN = (vPeakLL * Math.sqrt(2)) / Math.sqrt(3); // ~ 187,794 V

  const gSrc = 10.0; // 0.1 Ohm
  const rLine = 1.0;
  const lLine = 0.02;
  const denomLine = 2.0 * lLine + rLine * dt;
  const gLine = dt / denomLine;
  const alphaLine = (2.0 * lLine - rLine * dt) / denomLine;

  const gLoad = 1.0 / 500.0; // 0.002 S

  // Sources at Bus 1 (phases A, B, C)
  const sources: GpuSourceDef[] = [
    { nodeIdx: 0, vPeak: vPeakLN, freqRad: omega, phaseRad: 0.0, gSrc },
    { nodeIdx: 1, vPeak: vPeakLN, freqRad: omega, phaseRad: -(2.0 * Math.PI) / 3.0, gSrc },
    { nodeIdx: 2, vPeak: vPeakLN, freqRad: omega, phaseRad: (2.0 * Math.PI) / 3.0, gSrc },
  ];

  // Branches: 3 transmission line phases + 3 load resistors
  const branches: GpuBranchDef[] = [
    // Line A, B, C from Bus 1 to Bus 2
    { id: "LINE_A", fromNode: 0, toNode: 3, gEq: gLine, alphaHist: alphaLine, vCoeffHist: 1.0 },
    { id: "LINE_B", fromNode: 1, toNode: 4, gEq: gLine, alphaHist: alphaLine, vCoeffHist: 1.0 },
    { id: "LINE_C", fromNode: 2, toNode: 5, gEq: gLine, alphaHist: alphaLine, vCoeffHist: 1.0 },
    // Load at Bus 2 to ground (-1)
    { id: "LOAD_A", fromNode: 3, toNode: -1, gEq: gLoad, alphaHist: 0.0, vCoeffHist: 0.0 },
    { id: "LOAD_B", fromNode: 4, toNode: -1, gEq: gLoad, alphaHist: 0.0, vCoeffHist: 0.0 },
    { id: "LOAD_C", fromNode: 5, toNode: -1, gEq: gLoad, alphaHist: 0.0, vCoeffHist: 0.0 },
  ];

  // Assemble G matrix (6x6) and factorize as L * U:
  // Node 0,1,2 (Bus 1): diag = gSrc + gLine
  // Node 3,4,5 (Bus 2): diag = gLine + gLoad
  // Coupling: (0, 3), (1, 4), (2, 5) = -gLine
  const gDiag1 = gSrc + gLine;
  const gDiag2 = gLine + gLoad;

  // L: Unit lower triangular matrix in CSR
  // U: Upper triangular matrix in CSR
  // For each phase p in (0, 1, 2):
  //   r1 = p, r2 = p + 3
  //   L[r2, r1] = -gLine / gDiag1
  //   U[r1, r1] = gDiag1, U[r1, r2] = -gLine
  //   U[r2, r2] = gDiag2 - (-gLine / gDiag1) * (-gLine) = gDiag2 - (gLine^2 / gDiag1)
  const lFactor = -gLine / gDiag1;
  const uDiag2 = gDiag2 - lFactor * -gLine;

  // CSR arrays for 6 nodes
  const rowPtrL = new Uint32Array([0, 0, 0, 0, 1, 2, 3]);
  const colIdxL = new Uint32Array([0, 1, 2]); // row 3 depends on col 0, row 4 on 1, row 5 on 2
  const valL = new Float32Array([lFactor, lFactor, lFactor]);

  const rowPtrU = new Uint32Array([0, 1, 2, 3, 3, 3, 3]);
  const colIdxU = new Uint32Array([3, 4, 5]); // row 0 couples to col 3, row 1 to 4, row 2 to 5
  const valU = new Float32Array([-gLine, -gLine, -gLine]);
  const diagInvU = new Float32Array([
    1.0 / gDiag1,
    1.0 / gDiag1,
    1.0 / gDiag1,
    1.0 / uDiag2,
    1.0 / uDiag2,
    1.0 / uDiag2,
  ]);

  const sparseMatrix: GpuSparseMatrixCsr = {
    rowPtrL,
    colIdxL,
    valL,
    rowPtrU,
    colIdxU,
    valU,
    diagInvU,
  };

  const options: WebGpuSparseEmtOptions = {
    dtSec: dt,
    totalSteps: 2000, // 0.1 s = 6 full cycles of 60 Hz
    batchStepsPerDispatch: 100,
    nominalFrequencyHz: 60.0,
    preferCpu: true, // Guarantees execution in headless CI environments
  };

  const solver = await WebGpuSparseEmtSolver.create(numNodes, sources, branches, sparseMatrix, options);
  const result = await solver.solve();

  assert.strictEqual(result.metrics.totalSteps, 2000);
  assert.strictEqual(result.time.length, 2000);

  // Verify Bus 1 (Node 0) reaches steady-state peak voltage ~ 187 kV
  const vNode0 = result.nodeVoltages.get(0)!;
  assert(vNode0, "Node 0 voltage trajectory must be populated");
  const vPeak0 = Math.max(...Array.from(vNode0.subarray(1000)));
  assert(
    Math.abs(vPeak0 - vPeakLN) / vPeakLN < 0.05,
    `Bus 1 Phase A peak voltage (${vPeak0 / 1e3} kV) should be near nominal ${vPeakLN / 1e3} kV`,
  );

  // Verify Bus 2 (Node 3) receives voltage through the transmission line
  const vNode3 = result.nodeVoltages.get(3)!;
  assert(vNode3, "Node 3 voltage trajectory must be populated");
  const vPeak3 = Math.max(...Array.from(vNode3.subarray(1000)));
  assert(
    vPeak3 > 100e3 && vPeak3 < 200e3,
    `Bus 2 Phase A peak voltage (${vPeak3 / 1e3} kV) must reflect transmission line drop`,
  );

  // Verify 3-phase 120-degree phase separation at Bus 1:
  // At t = 0.05 s, check vA, vB, vC
  const midStep = 1000;
  const va = result.nodeVoltages.get(0)![midStep]!;
  const vb = result.nodeVoltages.get(1)![midStep]!;
  const vc = result.nodeVoltages.get(2)![midStep]!;
  const vSum = va + vb + vc;
  assert(Math.abs(vSum) / vPeakLN < 0.05, `Balanced 3-phase sum va + vb + vc (${vSum}) should be close to zero`);

  // Verify branch current measurement
  const lineCurA = result.branchCurrents.get("LINE_A")!;
  assert(lineCurA, "LINE_A current trajectory must be populated");
  const iPeakA = Math.max(...Array.from(lineCurA.subarray(1000)));
  assert(iPeakA > 10.0, `Line current peak (${iPeakA} A) must reflect load demand`);
});

test("WebGPU Sparse EMT: High-throughput 10,000-step batched performance test", async () => {
  const dt = 25e-6; // 25 microseconds
  const totalSteps = 10000; // 0.25 s
  const numNodes = 3;

  const sources: GpuSourceDef[] = [
    { nodeIdx: 0, vPeak: 1000.0, freqRad: 2.0 * Math.PI * 60.0, phaseRad: 0.0, gSrc: 1.0 },
  ];

  const branches: GpuBranchDef[] = [
    { id: "BR1", fromNode: 0, toNode: 1, gEq: 0.1, alphaHist: 0.95, vCoeffHist: 1.0 },
    { id: "BR2", fromNode: 1, toNode: -1, gEq: 0.01, alphaHist: 0.0, vCoeffHist: 0.0 },
  ];

  const sparseMatrix: GpuSparseMatrixCsr = {
    rowPtrL: new Uint32Array([0, 0, 1, 1]),
    colIdxL: new Uint32Array([0]),
    valL: new Float32Array([-0.1 / 1.1]),
    rowPtrU: new Uint32Array([0, 1, 1, 1]),
    colIdxU: new Uint32Array([1]),
    valU: new Float32Array([-0.1]),
    diagInvU: new Float32Array([1.0 / 1.1, 1.0 / 0.11, 1.0]),
  };

  const options: WebGpuSparseEmtOptions = {
    dtSec: dt,
    totalSteps,
    batchStepsPerDispatch: 250,
    preferCpu: true,
  };

  const solver = await WebGpuSparseEmtSolver.create(numNodes, sources, branches, sparseMatrix, options);
  const result = await solver.solve();

  assert.strictEqual(result.metrics.totalSteps, 10000);
  assert(
    result.metrics.executionTimeMs < 150.0,
    `10,000-step solve took ${result.metrics.executionTimeMs.toFixed(2)} ms, expected < 150 ms`,
  );

  // Check no NaN or infinite values throughout 10,000 steps
  const v1 = result.nodeVoltages.get(1)!;
  for (let k = 0; k < totalSteps; k += 500) {
    const val = v1[k]!;
    assert(!Number.isNaN(val) && Number.isFinite(val), `Step ${k} must be finite, got ${val}`);
  }
});

test("WebGPU Sparse EMT: Batched multi-contingency fault screening execution", async () => {
  const numNodes = 4;
  const dt = 50e-6;
  const totalSteps = 2000;

  const sources: GpuSourceDef[] = [
    { nodeIdx: 0, vPeak: 13800.0, freqRad: 2.0 * Math.PI * 60.0, phaseRad: 0.0, gSrc: 2.0 },
  ];

  const branches: GpuBranchDef[] = [
    { id: "LINE1", fromNode: 0, toNode: 1, gEq: 0.05, alphaHist: 0.98, vCoeffHist: 1.0 },
    { id: "LINE2", fromNode: 1, toNode: 2, gEq: 0.05, alphaHist: 0.98, vCoeffHist: 1.0 },
    { id: "LOAD1", fromNode: 2, toNode: -1, gEq: 0.01, alphaHist: 0.0, vCoeffHist: 0.0 },
  ];

  const sparseMatrix: GpuSparseMatrixCsr = {
    rowPtrL: new Uint32Array([0, 0, 1, 2, 2]),
    colIdxL: new Uint32Array([0, 1]),
    valL: new Float32Array([-0.05 / 2.05, -0.05 / 0.1]),
    rowPtrU: new Uint32Array([0, 1, 2, 2, 2]),
    colIdxU: new Uint32Array([1, 2]),
    valU: new Float32Array([-0.05, -0.05]),
    diagInvU: new Float32Array([1.0 / 2.05, 1.0 / 0.1, 1.0 / 0.06, 1.0]),
  };

  const solver = await WebGpuSparseEmtSolver.create(numNodes, sources, branches, sparseMatrix, {
    dtSec: dt,
    totalSteps,
    preferCpu: true,
  });

  const contingencies = [
    {
      id: "BASE_CASE",
      name: "Normal Operation Baseline",
    },
    {
      id: "TRIP_LINE2",
      name: "Line 2 Trip at t=0.03s",
      tripBranches: [{ branchId: "LINE2", timeSec: 0.03 }],
    },
    {
      id: "BUS1_FAULT",
      name: "Temporary 3-phase fault at Bus 1 with Rf=0.5 ohm",
      faults: [{ nodeIdx: 1, rFault: 0.5, startTimeSec: 0.02, clearTimeSec: 0.05 }],
    },
    {
      id: "VOLTAGE_SAG",
      name: "Source 50% voltage sag at t=0.01s",
      sourceModifiers: [{ sourceIdx: 0, vScale: 0.5, startTimeSec: 0.01 }],
    },
  ];

  const batchedRes = await solver.solveBatchedContingencies(contingencies, { recordWaveforms: true });

  assert.strictEqual(batchedRes.contingencies.length, 4);
  console.log(
    `Batched ${contingencies.length} contingencies across ${totalSteps} steps in ${batchedRes.totalWallClockMs.toFixed(2)} ms`,
  );

  // Verify baseline has stable peak voltages
  const baseCase = batchedRes.contingencies.find((c) => c.id === "BASE_CASE")!;
  assert(baseCase.peakOvervoltageKv > 5.0 && baseCase.peakOvervoltageKv < 15.0);

  // Verify fault produces significant current
  const faultCase = batchedRes.contingencies.find((c) => c.id === "BUS1_FAULT")!;
  assert(faultCase.maxBranchCurrentKa > 0.1, "Fault case must produce substantial current");

  // Verify voltage sag drops peak voltage
  const sagCase = batchedRes.contingencies.find((c) => c.id === "VOLTAGE_SAG")!;
  assert(sagCase.peakOvervoltageKv < baseCase.peakOvervoltageKv, "Sag case must have lower peak voltage");
});
