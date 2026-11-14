// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { simulateAtpCase } from "../src/analysis/transient-solver.js";
import type { AtpCase } from "../src/types.js";

const RLC_CASE: AtpCase = {
  title: "Series RLC Surge Transient Benchmark",
  control: { deltaTSec: 1.0e-5, tMaxSec: 0.01 },
  branches: [{ node1: "SRC", node2: "LOAD", rOhms: 10.0, lMh: 5.0, cUf: 2.0 }],
  switches: [],
  sources: [{ node: "SRC", typeCode: 14, amplitude: 1000.0, frequencyHz: 60.0, phaseDeg: 0.0 }],
  outputNodes: ["SRC", "LOAD"],
};

export const atpBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "atp",
  referenceTool: "ATP/EMTP Trapezoidal Companion-Circuit",
  defaultTolerance: 1e-3,
  metricKind: "rmse",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const res = simulateAtpCase(RLC_CASE, { tolerance: 1e-3, maxSteps: 200 });
    const d1 = performance.now() - t0;

    return [
      {
        id: "atp-rlc-surge-transient",
        name: "60 Hz Series RLC Surge Transient (10 us, 200 steps)",
        scale: "standard",
        referenceTool: "ATP/EMTP Trapezoidal Companion-Circuit",
        metricKind: "rmse",
        threshold: 1e-3,
        measuredError: res.rmse,
        passed: res.converged && res.stepCount === 200 && res.residualMax < 1e-3 && res.rmse < 1e-3,
        durationMs: d1,
        details: `steps=${res.stepCount}, rmse=${res.rmse.toExponential(2)}`,
      },
    ];
  },
};
