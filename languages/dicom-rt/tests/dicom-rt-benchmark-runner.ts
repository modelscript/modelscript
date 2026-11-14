// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import {
  computeBiologicallyEffectiveDose,
  computeConformityIndex,
  computeEqd2,
  computeHomogeneityIndex,
} from "../src/dosimetry/index.js";

export const dicomRtBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "dicom-rt",
  referenceTool: "ICRU 83 / Linear-Quadratic Radiobiology",
  defaultTolerance: 1e-9,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const bed60 = computeBiologicallyEffectiveDose(60.0, 30, 10.0);
    const eqd2 = computeEqd2(60.0, 30, 10.0);
    const bedSbrt = computeBiologicallyEffectiveDose(54.0, 3, 10.0);
    const hi = computeHomogeneityIndex(63.0, 57.0, 60.0);
    const ci = computeConformityIndex(95.0, 100.0, 100.0);
    const d1 = performance.now() - t0;

    const maxErr = Math.max(
      Math.abs(bed60 - 72.0),
      Math.abs(eqd2 - 60.0),
      Math.abs(bedSbrt - 151.2),
      Math.abs(hi - 0.1),
      Math.abs(ci.rtogCi - 1.0),
    );

    return [
      {
        id: "dicom-rt-lq-bed-icru83",
        name: "LQ BED/EQD2 & ICRU-83 Homogeneity/Conformity Indices",
        scale: "micro",
        referenceTool: "ICRU 83 / Linear-Quadratic Radiobiology",
        metricKind: "max-relative-error",
        threshold: 1e-9,
        measuredError: maxErr,
        passed: maxErr < 1e-9,
        durationMs: d1,
        details: `BED60=${bed60}Gy, EQD2=${eqd2}Gy, HI=${hi}, CI=${ci.rtogCi}`,
      },
    ];
  },
};
