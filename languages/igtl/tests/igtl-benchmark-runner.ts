// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { computeFitzpatrickTre, solvePivotCalibration } from "../src/kinematics/index.js";
import type { Matrix4x4 } from "../src/types.js";

export const igtlBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "igtl",
  referenceTool: "OpenIGTLink / Fitzpatrick (1998) TRE & Pivot Calibration",
  defaultTolerance: 1e-4,
  metricKind: "rmse",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const pose1: Matrix4x4 = [1, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 150, 0, 0, 0, 1];
    const pose2: Matrix4x4 = [1, 0, 0, 100, 0, 0, -1, 350, 0, 1, 0, 300, 0, 0, 0, 1];
    const pose3: Matrix4x4 = [0, 0, 1, -50, 0, 1, 0, 200, -1, 0, 0, 300, 0, 0, 0, 1];
    const fiducials: Array<[number, number, number]> = [
      [-50, -50, 0],
      [50, -50, 0],
      [50, 50, 0],
      [-50, 50, 0],
    ];

    const t0 = performance.now();
    const pivot = solvePivotCalibration([pose1, pose2, pose3]);
    const tre = computeFitzpatrickTre(fiducials, [0, 0, 0], 1.0);
    const d1 = performance.now() - t0;

    const treErr = Math.abs(tre.treMm - 0.5);

    return [
      {
        id: "igtl-se3-pivot-tre",
        name: "SE(3) Stylus Pivot Calibration & Fitzpatrick TRE",
        scale: "micro",
        referenceTool: "OpenIGTLink / Fitzpatrick (1998) TRE & Pivot Calibration",
        metricKind: "rmse",
        threshold: 1e-4,
        measuredError: Math.max(pivot.rmsErrorMm, treErr),
        passed: pivot.rmsErrorMm < 1e-4 && treErr < 1e-4,
        durationMs: d1,
        details: `pivotRMS=${pivot.rmsErrorMm.toExponential(2)}mm, TRE=${tre.treMm.toFixed(4)}mm`,
      },
    ];
  },
};
