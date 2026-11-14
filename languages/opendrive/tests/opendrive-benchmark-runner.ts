// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { evaluateGeometry } from "../src/geometry/clothoid.js";
import type { OpenDriveArcGeometry } from "../src/types.js";

export const opendriveBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "opendrive",
  referenceTool: "ASAM OpenDRIVE 1.7 / Analytical Fresnel Clothoid",
  defaultTolerance: 1e-6,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const dummyRange = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startOffset: 0, endOffset: 0 };
    const arc: OpenDriveArcGeometry = {
      type: "arc",
      s: 0.0,
      x: 0.0,
      y: 0.0,
      hdg: 0.0,
      length: 50.0,
      curvature: 0.01,
      range: dummyRange,
    };

    const t0 = performance.now();
    const p = evaluateGeometry(arc, 50.0);
    const d1 = performance.now() - t0;

    const hdgErr = Math.abs(p.hdg - 0.5);
    const kErr = Math.abs(p.curvature - 0.01);
    const maxErr = Math.max(hdgErr, kErr);

    return [
      {
        id: "opendrive-arc-curvature-hdg",
        name: "Constant-Curvature Arc Reference Line Heading & Curvature",
        scale: "micro",
        referenceTool: "ASAM OpenDRIVE 1.7 / Analytical Fresnel Clothoid",
        metricKind: "max-relative-error",
        threshold: 1e-6,
        measuredError: maxErr,
        passed: maxErr < 1e-6,
        durationMs: d1,
        details: `hdg=${p.hdg.toFixed(6)}rad, kappa=${p.curvature}`,
      },
    ];
  },
};
