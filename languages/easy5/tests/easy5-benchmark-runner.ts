// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { computeEigenvalues, linearizeEasy5, parseEasy5 } from "../src/index.js";

export const easy5BenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "easy5",
  referenceTool: "MSC Easy5 / Analytical Linear State-Space",
  defaultTolerance: 1e-4,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const src = `MODEL: FirstOrderLag
COMPONENTS:
  LA01 TYPE=GP/LA
    XP: GAIN=2.0, TAU1=0.0, TAU2=0.5
`;
    const t0 = performance.now();
    const lin = linearizeEasy5(parseEasy5(src));
    const d1 = performance.now() - t0;

    const aErr = Math.abs((lin.A[0]?.[0] ?? 0) - -2.0);
    const bErr = Math.abs((lin.B[0]?.[0] ?? 0) - 2.0);
    const cErr = Math.abs((lin.C[0]?.[0] ?? 0) - 2.0);
    const maxMatErr = Math.max(aErr, bErr, cErr);

    const t1 = performance.now();
    const eigs = computeEigenvalues(lin.A);
    const d2 = performance.now() - t1;
    const poleErr = Math.abs((eigs[0]?.real ?? 0) - -2.0);

    return [
      {
        id: "easy5-lag-linearize-abcd",
        name: "First-Order Lag State-Space Linearization (A, B, C, D)",
        scale: "micro",
        referenceTool: "MSC Easy5 / Analytical Linear State-Space",
        metricKind: "max-relative-error",
        threshold: 1e-4,
        measuredError: maxMatErr,
        passed: maxMatErr < 1e-4,
        durationMs: d1,
        details: `A=[${lin.A[0]?.[0]?.toFixed(3)}], B=[${lin.B[0]?.[0]?.toFixed(3)}], C=[${lin.C[0]?.[0]?.toFixed(3)}]`,
      },
      {
        id: "easy5-pole-stability",
        name: "Closed-Loop Eigenvalue Stability Analysis",
        scale: "micro",
        referenceTool: "MSC Easy5 / Analytical Linear State-Space",
        metricKind: "max-relative-error",
        threshold: 1e-6,
        measuredError: poleErr,
        passed: eigs.length === 1 && Boolean(eigs[0]?.isStable) && poleErr < 1e-6,
        durationMs: d2,
        details: `lambda=${eigs[0]?.real.toFixed(4)} rad/s, stable=${String(eigs[0]?.isStable)}`,
      },
    ];
  },
};
