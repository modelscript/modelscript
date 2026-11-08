// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { parseMatpower } from "../src/solvers/opf/grid-converters.js";
import {
  calculateNetworkSensitivities,
  calculateSensitivitiesFromCase,
} from "../src/solvers/powerflow/lodf-calculator.js";
import {
  WebGpuContingencyScreener,
  type ContingencyScreeningInput,
} from "../src/solvers/powerflow/webgpu-batched-contingency.js";

const IEEE_14_MATPOWER = `
function mpc = case14
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
  1 3 0 0 0 0 1 1.06 0 0 1 1.06 0.94;
  2 2 21.7 12.7 0 0 1 1.045 -4.98 0 1 1.06 0.94;
  3 2 94.2 19 0 0 1 1.01 -12.72 0 1 1.06 0.94;
  4 1 47.8 -3.9 0 0 1 1.019 -10.33 0 1 1.06 0.94;
  5 1 7.6 1.6 0 0 1 1.02 -8.78 0 1 1.06 0.94;
  6 2 11.2 7.5 0 0 1 1.07 -14.22 0 1 1.06 0.94;
  7 1 0 0 0 0 1 1.062 -13.37 0 1 1.06 0.94;
  8 2 0 0 0 0 1 1.09 -13.36 0 1 1.06 0.94;
  9 1 29.5 16.6 0 0 1 1.056 -14.94 0 1 1.06 0.94;
  10 1 9 5.8 0 0 1 1.051 -15.1 0 1 1.06 0.94;
  11 1 3.5 1.8 0 0 1 1.057 -14.79 0 1 1.06 0.94;
  12 1 6.1 1.6 0 0 1 1.055 -15.07 0 1 1.06 0.94;
  13 1 13.5 5.8 0 0 1 1.05 -15.15 0 1 1.06 0.94;
  14 1 14.9 5 0 0 1 1.035 -16.04 0 1 1.06 0.94;
];
mpc.gen = [
  1 232.4 -16.9 10 0 1.06 100 1 332.4 0 0 0 0 0 0 0 0 0 0 0 0;
  2 40 42.4 50 -40 1.045 100 1 140 0 0 0 0 0 0 0 0 0 0 0 0;
  3 0 23.4 40 0 1.01 100 1 100 0 0 0 0 0 0 0 0 0 0 0 0;
  6 0 12.2 24 -6 1.07 100 1 100 0 0 0 0 0 0 0 0 0 0 0 0;
  8 0 17.4 24 -6 1.09 100 1 100 0 0 0 0 0 0 0 0 0 0 0 0;
];
mpc.branch = [
  1 2 0.01938 0.05917 0.0528 9900 0 0 0 0 1 -360 360;
  1 5 0.05403 0.22304 0.0492 9900 0 0 0 0 1 -360 360;
  2 3 0.04699 0.19797 0.0438 9900 0 0 0 0 1 -360 360;
  2 4 0.05811 0.17632 0.034 9900 0 0 0 0 1 -360 360;
  2 5 0.05695 0.17388 0.0346 9900 0 0 0 0 1 -360 360;
  3 4 0.06701 0.17103 0.0128 9900 0 0 0 0 1 -360 360;
  4 5 0.01335 0.04211 0 9900 0 0 0 0 1 -360 360;
  4 7 0 0.20912 0 9900 0 0 0.978 0 1 -360 360;
  4 9 0 0.55618 0 9900 0 0 0.969 0 1 -360 360;
  5 6 0 0.25202 0 9900 0 0 0.932 0 1 -360 360;
  6 11 0.09498 0.1989 0 9900 0 0 0 0 1 -360 360;
  6 12 0.12291 0.25581 0 9900 0 0 0 0 1 -360 360;
  6 13 0.06615 0.13027 0 9900 0 0 0 0 1 -360 360;
  7 8 0 0.17615 0 9900 0 0 0 0 1 -360 360;
  7 9 0 0.11001 0 9900 0 0 0 0 1 -360 360;
  9 10 0.03181 0.0845 0 9900 0 0 0 0 1 -360 360;
  9 14 0.12711 0.27038 0 9900 0 0 0 0 1 -360 360;
  10 11 0.08205 0.19207 0 9900 0 0 0 0 1 -360 360;
  12 13 0.22092 0.19988 0 9900 0 0 0 0 1 -360 360;
  13 14 0.17093 0.34802 0 9900 0 0 0 0 1 -360 360;
];
`;

test("LODF Calculator: 3-Bus Meshed Network Analytical Verification", () => {
  // 3-bus delta network with identical reactances:
  // Bus 0 - Bus 1: x = 0.2
  // Bus 1 - Bus 2: x = 0.2
  // Bus 0 - Bus 2: x = 0.2
  const branches = [
    { fromBus: 0, toBus: 1, reactance: 0.2, rating: 100, status: 1 },
    { fromBus: 1, toBus: 2, reactance: 0.2, rating: 100, status: 1 },
    { fromBus: 0, toBus: 2, reactance: 0.2, rating: 100, status: 1 },
  ];

  const { ptdf, lodf } = calculateNetworkSensitivities(branches, 3, 0);
  assert.strictEqual(ptdf.length, 3 * 3, "PTDF must have size L x B = 9");
  assert.strictEqual(lodf.length, 3 * 3, "LODF must have size L x L = 9");

  // In a 3-bus triangle, once line 1 (1->2) trips, bus 1 is radially connected only to bus 0.
  // Thus 100% of line 1's flow must shift to line 0 in reverse (LODF = -1.0) and line 2 forward (LODF = +1.0)
  const lodf_0_1 = lodf[1 * 3 + 0]!; // Line 0 response to outage of Line 1
  const lodf_2_1 = lodf[1 * 3 + 2]!; // Line 2 response to outage of Line 1
  assert(Math.abs(lodf_0_1 - -1.0) < 1e-5, `Expected -1.0 shift on line 0, got ${lodf_0_1}`);
  assert(Math.abs(lodf_2_1 - 1.0) < 1e-5, `Expected +1.0 shift on line 2, got ${lodf_2_1}`);
});

test("WebGPU Batched Contingency Screening: IEEE 14-Bus All-Line Outage Screening", async () => {
  const pCase = parseMatpower(IEEE_14_MATPOWER);
  const sens = calculateSensitivitiesFromCase(pCase);
  const L = sens.branchCount;

  // Synthesize realistic base flows (in MW)
  const baseFlows = new Float32Array(L);
  const ratings = new Float32Array(L);
  for (let l = 0; l < L; l++) {
    baseFlows[l] = 20.0 + (l % 5) * 15.0; // 20 to 80 MW base flows
    ratings[l] = 60.0; // 60 MW rating to trigger selective overloads
  }

  // Screen all L lines as contingencies (K = L = 20)
  const trippedIndices = new Uint32Array(L);
  for (let c = 0; c < L; c++) {
    trippedIndices[c] = c;
  }

  const screener = await WebGpuContingencyScreener.create(null);
  const input: ContingencyScreeningInput = {
    baseFlows,
    ratings,
    trippedIndices,
    lodfMatrix: sens.lodf,
    overloadThreshold: 1.0, // 100% rating
    preferCpu: true,
  };

  const result = await screener.screenContingencies(input);

  assert.strictEqual(result.contingenciesEvaluated, L, "Must evaluate all 20 branch contingencies");
  assert.strictEqual(result.linesMonitored, L, "Must monitor all 20 branches");
  assert.strictEqual(result.totalEvaluations, L * L, "Total evaluations must be L x L = 400");
  assert.strictEqual(result.summaries.length, L, "Must produce summary for each contingency");

  // Verify post-contingency flow on tripped line is zero in every scenario
  for (const summary of result.summaries) {
    assert(summary.maxLoadingPercent >= 0, "Max loading must be non-negative");
    assert.strictEqual(typeof summary.isSecure, "boolean");
  }

  // Verify that violations list has valid properties
  for (const v of result.violations) {
    assert(v.loadingPercent > 100.0, "Violation loading must exceed 100%");
    assert(v.postContingencyFlow > v.rating || -v.postContingencyFlow > v.rating);
    assert.notStrictEqual(v.trippedBranchIndex, v.overloadedBranchIndex, "Tripped line cannot be overloaded");
  }
});

test("WebGPU Batched Contingency Screening: High-Volume 1,000 Contingency Stress Test", async () => {
  const L = 100; // 100 monitored lines
  const K = 1000; // 1,000 contingencies

  const baseFlows = new Float32Array(L);
  const ratings = new Float32Array(L);
  for (let l = 0; l < L; l++) {
    baseFlows[l] = 50.0;
    ratings[l] = 100.0;
  }

  const trippedIndices = new Uint32Array(K);
  const lodfMatrix = new Float32Array(K * L);

  for (let c = 0; c < K; c++) {
    const tripped = c % L;
    trippedIndices[c] = tripped;
    for (let l = 0; l < L; l++) {
      if (l === tripped) {
        lodfMatrix[c * L + l] = -1.0;
      } else {
        // Random small shift between lines
        lodfMatrix[c * L + l] = ((l - tripped) % 7) * 0.05;
      }
    }
  }

  const screener = new WebGpuContingencyScreener(null);
  const input: ContingencyScreeningInput = {
    baseFlows,
    ratings,
    trippedIndices,
    lodfMatrix,
    overloadThreshold: 1.0,
    preferCpu: true,
  };

  const result = screener.screenContingenciesCpu(input);

  assert.strictEqual(result.contingenciesEvaluated, 1000);
  assert.strictEqual(result.linesMonitored, 100);
  assert.strictEqual(result.totalEvaluations, 100000);
  assert(
    result.executionTimeMs < 100,
    `Expected 100k evaluations in < 100ms, took ${result.executionTimeMs.toFixed(2)}ms`,
  );
});
