// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractPhasorAtTimestamp, extractPhasorSeries } from "../src/analysis/phasor-extractor.js";
import type { ComtradeRecord } from "../src/types.js";

describe("COMTRADE Phasor Extraction Benchmark & Tolerance Verification", () => {
  const f0 = 60.0; // 60 Hz fundamental
  const sampleRate = 4800; // 80 samples per cycle
  const dt = 1.0 / sampleRate;
  const numCycles = 5;
  const numSamples = Math.floor(numCycles * (sampleRate / f0)); // 400 samples

  const expectedRms = 120.0;
  const peak = expectedRms * Math.SQRT2;
  const targetPhaseDeg = 45.0; // 45 degrees
  const targetPhaseRad = (targetPhaseDeg * Math.PI) / 180.0;

  // Synthesize pure sinusoidal voltage waveform: v(t) = sqrt(2) * 120 * cos(2*pi*60*t + phi)
  const timestamps: number[] = [];
  const wave: number[] = [];
  for (let i = 0; i < numSamples; i++) {
    const t = i * dt;
    timestamps.push(t);
    wave.push(peak * Math.cos(2 * Math.PI * f0 * t + targetPhaseRad));
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

  it("should extract phasor magnitude with high numerical precision meeting tolerance", () => {
    // Check single timestamp after window fills (e.g. at 2.5 cycles, t = 0.0416s)
    const tCheck = 0.04;
    const phasor = extractPhasorAtTimestamp(record, 0, tCheck, f0);

    const tolerance = 1e-2; // 0.01 V tolerance
    const residual = Math.abs(phasor.magnitudeRms - expectedRms);

    assert.ok(
      residual < tolerance,
      `Calculated RMS ${phasor.magnitudeRms} V should converge to ${expectedRms} V within tolerance ${tolerance}. Residual: ${residual}`,
    );
  });

  it("should evaluate dynamic phasor trajectory with low RMSE across steady-state cycles", () => {
    const series = extractPhasorSeries(record, 0, f0);

    // Skip the first cycle while sliding window fills
    const oneCycleTime = 1.0 / f0;
    const steadyStatePhasors = series.filter((p) => p.time >= oneCycleTime);

    assert.ok(steadyStatePhasors.length > 50, "Should have sufficient steady-state phasor points");

    let sumSqResidual = 0;
    for (const p of steadyStatePhasors) {
      const err = p.magnitudeRms - expectedRms;
      sumSqResidual += err * err;
    }
    const rmse = Math.sqrt(sumSqResidual / steadyStatePhasors.length);
    const tolerance = 0.05; // 0.05 V RMSE tolerance

    assert.ok(rmse < tolerance, `Phasor RMSE ${rmse} must satisfy convergence tolerance ${tolerance}`);
  });

  it("should extract phase angle within angular tolerance", () => {
    // Check phase angle at t = 0.05s
    const phasor = extractPhasorAtTimestamp(record, 0, 0.05, f0);
    // At t = 0.05s (3 cycles): 3 * 360 = 1080 deg => identical to 0 deg offset + 45 deg = 45 deg
    const angleTolerance = 5.0; // 5 degrees tolerance for discrete sliding window
    const angleDiff = Math.abs(phasor.phaseDeg - targetPhaseDeg);

    assert.ok(
      angleDiff < angleTolerance || Math.abs(angleDiff - 360) < angleTolerance,
      `Phase angle ${phasor.phaseDeg}° should match target ${targetPhaseDeg}° within tolerance ${angleTolerance}°`,
    );
  });
});
