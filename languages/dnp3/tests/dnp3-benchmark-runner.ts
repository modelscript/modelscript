// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { processTelemetryStream } from "../src/analysis/telemetry-processor.js";
import type { Dnp3AnalogInput } from "../src/types.js";

export const dnp3BenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "dnp3",
  referenceTool: "IEEE 1815 DNP3 Deadband Compression Reference",
  defaultTolerance: 2.5,
  metricKind: "rmse",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const analogPt: Dnp3AnalogInput = {
      index: 0,
      name: "PIPE_PRESSURE_PSI",
      eventClass: 2,
      deadband: 2.0,
      scalingMultiplier: 0.05,
      scalingOffset: 14.7,
      units: "psi",
      minVal: 0,
      maxVal: 200,
    };
    const samples: number[] = [];
    for (let i = 0; i < 100; i++) {
      samples.push(1000 + Math.floor(i / 20) * 100 + (i % 5) * 5);
    }

    const t0 = performance.now();
    const res = processTelemetryStream(samples, analogPt, { tolerance: 2.5 });
    const d1 = performance.now() - t0;

    return [
      {
        id: "dnp3-deadband-telemetry",
        name: "DNP3 Class-2 Analog Deadband Event Compression",
        scale: "micro",
        referenceTool: "IEEE 1815 DNP3 Deadband Compression Reference",
        metricKind: "rmse",
        threshold: 2.5,
        measuredError: res.rmse,
        passed: res.converged && res.reportedEventCount < res.rawSampleCount && res.residualMax <= 2.0001,
        durationMs: d1,
        details: `events=${res.reportedEventCount}/${res.rawSampleCount}, rmse=${res.rmse.toFixed(3)}psi`,
      },
    ];
  },
};
