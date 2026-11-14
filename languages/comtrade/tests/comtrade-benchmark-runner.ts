// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { extractPhasorAtTimestamp } from "../src/analysis/phasor-extractor.js";
import type { ComtradeRecord } from "../src/types.js";

export const comtradeBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "comtrade",
  referenceTool: "IEEE C37.111 / 1-Cycle Full-Cycle DFT Phasor",
  defaultTolerance: 1e-2,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const f0 = 60.0;
    const sampleRate = 4800;
    const dt = 1.0 / sampleRate;
    const numSamples = 400;
    const expectedRms = 120.0;
    const peak = expectedRms * Math.SQRT2;
    const timestamps: number[] = [];
    const wave: number[] = [];
    for (let i = 0; i < numSamples; i++) {
      const t = i * dt;
      timestamps.push(t);
      wave.push(peak * Math.cos(2 * Math.PI * f0 * t + Math.PI / 4));
    }

    const record: ComtradeRecord = {
      cfg: {
        stationName: "BENCHMARK_SUB",
        recDevId: "BENCH_PMU",
        revYear: 1999,
        totalChannels: 1,
        analogCount: 1,
        digitalCount: 0,
        analogs: [
          {
            index: 1,
            chId: "VA",
            phase: "A",
            ccbm: "",
            uu: "V",
            a: 1.0,
            b: 0.0,
            skew: 0,
            minVal: -32768,
            maxVal: 32767,
            primary: 1,
            secondary: 1,
            scaling: "P",
          },
        ],
        digitals: [],
        nominalFrequency: 60,
        sampleRateCount: 1,
        sampleRates: [{ rate: sampleRate, lastSampleNumber: numSamples }],
        startTime: "01/01/2026,00:00:00.000000",
        triggerTime: "01/01/2026,00:00:00.000000",
        fileType: "ASCII",
        timeMult: 1.0,
      },
      analogData: [wave],
      digitalData: [],
      timestamps,
    };

    const t0 = performance.now();
    const phasor = extractPhasorAtTimestamp(record, 0, 0.04, f0);
    const d1 = performance.now() - t0;
    const relErr = Math.abs(phasor.magnitudeRms - expectedRms) / expectedRms;

    return [
      {
        id: "comtrade-dft-phasor-rms",
        name: "60 Hz Full-Cycle DFT Synchrophasor RMS Extraction",
        scale: "micro",
        referenceTool: "IEEE C37.111 / 1-Cycle Full-Cycle DFT Phasor",
        metricKind: "max-relative-error",
        threshold: 1e-3,
        measuredError: relErr,
        passed: relErr < 1e-3,
        durationMs: d1,
        details: `V_rms=${phasor.magnitudeRms.toFixed(4)}V (exact 120.0V)`,
      },
    ];
  },
};
