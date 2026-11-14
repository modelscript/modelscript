// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { calculateOvercurrentTime, evaluateSELogicExpression } from "../src/analysis/selogic-evaluator.js";

export const selBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "sel",
  referenceTool: "IEEE C37.112 U3 Time-Overcurrent & SELogic",
  defaultTolerance: 1e-8,
  metricKind: "rmse",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const pickup = 5.0;
    const td = 2.0;
    const currents = [10.0, 15.0, 20.0, 25.0, 30.0];

    const t0 = performance.now();
    let sse = 0;
    for (const cur of currents) {
      const m = cur / pickup;
      const expected = td * (19.61 / (m * m - 1.0) + 0.491);
      const actual = calculateOvercurrentTime(cur, pickup, td, "U3");
      sse += (actual - expected) ** 2;
    }
    const logicOk = evaluateSELogicExpression("(50P1 OR (51P1 AND NOT SV01)) AND (IN101 OR !IN102)", {
      "50P1": true,
      "51P1": false,
      SV01: false,
      IN101: true,
      IN102: false,
    });
    const d1 = performance.now() - t0;
    const rmse = Math.sqrt(sse / currents.length);

    return [
      {
        id: "sel-c37-112-u3-selogic",
        name: "IEEE C37.112 U3 Very-Inverse Curve & SELogic Evaluation",
        scale: "micro",
        referenceTool: "IEEE C37.112 U3 Time-Overcurrent & SELogic",
        metricKind: "rmse",
        threshold: 1e-8,
        measuredError: rmse,
        passed: rmse < 1e-8 && logicOk === true,
        durationMs: d1,
        details: `curve RMSE=${rmse.toExponential(2)}, SELogic=true`,
      },
    ];
  },
};
