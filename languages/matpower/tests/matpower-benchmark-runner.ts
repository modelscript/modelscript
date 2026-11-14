// SPDX-License-Identifier: AGPL-3.0-or-later

import { solvePowerFlow } from "@modelscript/psse";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { matpowerToPsseRaw, parseMatpowerCase } from "../src/index.js";

const CASE5_MPC = `function mpc = case5
mpc.version = '2';
mpc.baseMVA = 100.0;
mpc.bus = [
  1 3 0.0  0.0  0.0 0.0 1 1.06  0.0   132.0 1 1.1 0.9;
  2 2 21.7 12.7 0.0 0.0 1 1.045 -4.98 132.0 1 1.1 0.9;
  3 1 94.2 19.0 0.0 0.0 1 1.01  -12.7 132.0 1 1.1 0.9;
];
mpc.gen = [
  1 232.4 -16.9 10.0  0.0   1.06  100.0 1 332.4 0.0;
  2 40.0   42.4 50.0 -40.0  1.045 100.0 1 140.0 0.0;
];
mpc.branch = [
  1 2 0.01938 0.05917 0.0528 9900.0 0.0 0.0 0.0 0.0 1 -360.0 360.0;
  2 3 0.04699 0.19797 0.0438 9900.0 0.0 0.0 0.0 0.0 1 -360.0 360.0;
  1 3 0.05403 0.22304 0.0492 9900.0 0.0 0.0 0.0 0.0 1 -360.0 360.0;
];`;

export const matpowerBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "matpower",
  referenceTool: "MATPOWER 8.0 / PYPOWER Newton-Raphson AC Power Flow",
  defaultTolerance: 1e-4,
  metricKind: "residual",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const mpc = parseMatpowerCase(CASE5_MPC);
    const raw = matpowerToPsseRaw(mpc);
    const pf = solvePowerFlow(raw);
    const d1 = performance.now() - t0;

    return [
      {
        id: "matpower-ac-powerflow",
        name: "MATPOWER case.m to Newton-Raphson AC Power Flow",
        scale: "standard",
        referenceTool: "MATPOWER 8.0 / PYPOWER Newton-Raphson AC Power Flow",
        metricKind: "residual",
        threshold: 1e-4,
        measuredError: pf.maxMismatchPu,
        passed: pf.converged && pf.maxMismatchPu < 1e-4,
        durationMs: d1,
        details: `iters=${pf.iterations}, maxMismatch=${pf.maxMismatchPu.toExponential(2)} pu`,
      },
    ];
  },
};
