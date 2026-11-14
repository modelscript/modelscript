// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { getAsm1PetersenMatrix } from "../src/models/asm1.js";

export const asmBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "asm",
  referenceTool: "IWA ASM1 / BSM1 Stoichiometric Petersen Matrix",
  defaultTolerance: 1e-6,
  metricKind: "residual",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const petersen = getAsm1PetersenMatrix();
    const proc1 = petersen.processes[0]!;
    const codSum1 = proc1.stoichiometry["S_S"]! + proc1.stoichiometry["X_BH"]! - proc1.stoichiometry["S_O"]!;
    const proc2 = petersen.processes[1]!;
    const codSum2 = proc2.stoichiometry["S_S"]! + proc2.stoichiometry["X_BH"]! - 2.86 * proc2.stoichiometry["S_NO"]!;
    const maxRes = Math.max(Math.abs(codSum1), Math.abs(codSum2));
    const d1 = performance.now() - t0;

    return [
      {
        id: "asm-asm1-cod-conservation",
        name: "IWA ASM1 Aerobic & Anoxic COD Stoichiometric Conservation",
        scale: "micro",
        referenceTool: "IWA ASM1 / BSM1 Stoichiometric Petersen Matrix",
        metricKind: "residual",
        threshold: 1e-6,
        measuredError: maxRes,
        passed: maxRes < 1e-6,
        durationMs: d1,
        details: `max|COD_residual|=${maxRes.toExponential(2)}`,
      },
    ];
  },
};
