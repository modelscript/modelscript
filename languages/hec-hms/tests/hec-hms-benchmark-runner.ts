// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { computeCumulativeRunoff, computePotentialRetention } from "../src/index.js";

export const hecHmsBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "hec-hms",
  referenceTool: "USACE HEC-HMS / Analytical SCS Curve Number",
  defaultTolerance: 1e-3,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const sEnglish = computePotentialRetention(75, "U.S. Customary");
    const expectedS = 1000.0 / 75.0 - 10.0;
    const qRunoff = computeCumulativeRunoff(100.0, 75.0, undefined, "Metric");
    const sMetric = 25400.0 / 75.0 - 254.0;
    const ia = 0.2 * sMetric;
    const expectedQ = (100.0 - ia) ** 2 / (100.0 - ia + sMetric);
    const d1 = performance.now() - t0;

    const maxErr = Math.max(Math.abs(sEnglish - expectedS) / expectedS, Math.abs(qRunoff - expectedQ) / expectedQ);

    return [
      {
        id: "hec-hms-scs-cn-runoff",
        name: "SCS Curve Number Retention & Cumulative Runoff Parity",
        scale: "micro",
        referenceTool: "USACE HEC-HMS / Analytical SCS Curve Number",
        metricKind: "max-relative-error",
        threshold: 1e-3,
        measuredError: maxErr,
        passed: maxErr < 1e-3,
        durationMs: d1,
        details: `Q=${qRunoff.toFixed(3)}mm (exact ${expectedQ.toFixed(3)}mm)`,
      },
    ];
  },
};
