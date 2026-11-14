// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { evaluateRatingCurve, evaluateRatingEquation } from "../src/analysis/rating-curve.js";
import type { RatingCurve, RatingCurveEquation } from "../src/types.js";

export const watermlBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "waterml",
  referenceTool: "OGC WaterML 2.0 / Stage-Discharge Rating Curve",
  defaultTolerance: 1e-6,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const eq: RatingCurveEquation = { a: 25.0, h0: 0.5, b: 2.1 };
    const curve: RatingCurve = {
      curveId: "RC_TABLE_01",
      stationId: "GAGE_RIVER",
      tablePoints: [
        { stageM: 1.0, dischargeM3S: 10.0 },
        { stageM: 2.0, dischargeM3S: 30.0 },
        { stageM: 3.0, dischargeM3S: 70.0 },
      ],
    };

    const t0 = performance.now();
    const qHigh = evaluateRatingEquation(eq, 2.5);
    const expected = 25.0 * Math.pow(2.0, 2.1);
    const qMid = evaluateRatingCurve(curve, 1.5);
    const d1 = performance.now() - t0;

    const maxErr = Math.max(Math.abs(qHigh - expected) / expected, Math.abs(qMid - 20.0) / 20.0);

    return [
      {
        id: "waterml-stage-discharge-rating",
        name: "Power-Law & Piecewise Stage-Discharge Rating Curve",
        scale: "micro",
        referenceTool: "OGC WaterML 2.0 / Stage-Discharge Rating Curve",
        metricKind: "max-relative-error",
        threshold: 1e-6,
        measuredError: maxErr,
        passed: maxErr < 1e-6,
        durationMs: d1,
        details: `Q(2.5m)=${qHigh.toFixed(3)}m3/s, Q_interp(1.5m)=${qMid.toFixed(1)}m3/s`,
      },
    ];
  },
};
