// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lowerCToDae } from "../src/dae/lowering.js";

export const cBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "c",
  referenceTool: "FMI C-Code / DAEBuilder Linear Memory Lowering",
  defaultTolerance: 0,
  metricKind: "dae-parity",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    await initBltWasm();
    const builder = new DAEBuilder();
    const cLines = ["// Continuous state derivative", "dx[0] = 2.0 * x[0] + 5.0;", "y = x[0] * 3.0;"];

    const t0 = performance.now();
    const res = lowerCToDae(builder, cLines, "c_block");
    const d1 = performance.now() - t0;

    return [
      {
        id: "c-ode-dae-lowering",
        name: "Embedded C ODE & Algebraic Equations to DAEBuilder",
        scale: "micro",
        referenceTool: "FMI C-Code / DAEBuilder Linear Memory Lowering",
        metricKind: "dae-parity",
        threshold: 0,
        measuredError: res.equationCount === 2 ? 0 : 1,
        passed: res.equationCount === 2 && res.stateVarIndices.length === 1,
        durationMs: d1,
        details: `states=${res.stateVarIndices.length}, eqs=${res.equationCount}`,
      },
    ];
  },
};
