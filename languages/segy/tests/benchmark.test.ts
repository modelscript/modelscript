// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SegySampleFormat,
  applyAgcGain,
  applyNmoCorrection,
  applyRmsGain,
  computeAmplitudePhaseSpectrum,
  createDefaultBinaryHeader,
  createDefaultTextualHeader,
  createDefaultTraceHeader,
  ibmFloatToIeee,
  ieeeToIbmFloat,
  klauderWavelet,
  nmoTraveltime,
  ormsbyWavelet,
  rickerWavelet,
  segyToAsciiDump,
  segyToCsv,
  segyToLasWellTie,
  zeroPhaseBandpassFilter,
  type SegyFile,
} from "../src/index.js";

describe("@modelscript/segy — Quantitative Geophysical Benchmarks & Projections", () => {
  it("achieves IBM 32-bit float <-> IEEE-754 float32 round-trip precision relErr < 1e-6", () => {
    const testValues = [
      1.0,
      -1.0,
      0.5,
      -0.25,
      Math.PI,
      -Math.E,
      1e-12,
      -3.1415926e-6,
      12345.678,
      -9.876543e10,
      4.2e20,
      -7.5e-20,
      0.0001234567,
      999999.5,
    ];

    assert.equal(ibmFloatToIeee(ieeeToIbmFloat(0)), 0);

    for (const v of testValues) {
      const ibmBits = ieeeToIbmFloat(v);
      const recovered = ibmFloatToIeee(ibmBits);
      const relErr = Math.abs(recovered - v) / Math.abs(v);
      assert.ok(relErr < 1e-6, `IBM float round-trip relErr ${relErr} >= 1e-6 for value ${v}`);
    }
  });

  it("matches Ricker wavelet dominant-frequency FFT peak parity", () => {
    const f0 = 35.0; // Hz
    const dtSec = 0.002; // 500 Hz sample rate (Nyquist 250 Hz)
    const nSamples = 512;
    const wavelet = rickerWavelet(f0, dtSec, nSamples);

    // Zero-phase peak at center
    const centerIdx = Math.floor((nSamples - 1) / 2);
    assert.ok(wavelet[centerIdx]! > 0.9, `Expected Ricker peak near 1.0, got ${wavelet[centerIdx]}`);

    // Zero-padded 4096-point FFT for fine frequency resolution (~0.122 Hz/bin)
    const spec = computeAmplitudePhaseSpectrum(wavelet, dtSec, 4096);
    const freqErr = Math.abs(spec.peakFrequencyHz - f0);
    assert.ok(freqErr < 0.5, `Expected FFT peak near ${f0} Hz, got ${spec.peakFrequencyHz.toFixed(3)} Hz`);

    // Verify Ormsby and Klauder wavelets synthesize cleanly with unit peak
    const ormsby = ormsbyWavelet(5, 10, 40, 55, dtSec, 256);
    const klauder = klauderWavelet(10, 60, 4.0, dtSec, 256);
    assert.equal(ormsby.length, 256);
    assert.equal(klauder.length, 256);
    assert.ok(Math.max(...Array.from(ormsby, Math.abs)) <= 1.0001);
    assert.ok(Math.max(...Array.from(klauder, Math.abs)) <= 1.0001);
  });

  it("flattens hyperbolic NMO traveltime gather to rmse < 1e-4", () => {
    const dtSec = 0.001; // 1 ms sampling
    const nSamples = 1024;
    const t0True = 0.4; // 400 ms zero-offset reflector
    const velocityMps = 2500.0;
    const f0 = 25.0;
    const offsets = [0, 200, 400, 600, 800, 1000];

    const flattenedTimes: number[] = [];
    for (const x of offsets) {
      const tx = nmoTraveltime(t0True, x, velocityMps);
      const rawTrace = rickerWavelet(f0, dtSec, nSamples, tx);
      const nmoTrace = applyNmoCorrection(rawTrace, dtSec, x, velocityMps);

      // Find peak index and parabolic sub-sample peak time
      let peakIdx = 0;
      let peakVal = -Infinity;
      for (let i = 1; i < nSamples - 1; i++) {
        if (nmoTrace[i]! > peakVal) {
          peakVal = nmoTrace[i]!;
          peakIdx = i;
        }
      }
      const y0 = nmoTrace[peakIdx - 1]!;
      const y1 = nmoTrace[peakIdx]!;
      const y2 = nmoTrace[peakIdx + 1]!;
      const denom = y0 - 2 * y1 + y2;
      const delta = Math.abs(denom) > 1e-12 ? (0.5 * (y0 - y2)) / denom : 0;
      const peakTimeSec = (peakIdx + delta) * dtSec;
      flattenedTimes.push(peakTimeSec);
    }

    let sumSqErr = 0;
    for (const t of flattenedTimes) {
      const err = t - t0True;
      sumSqErr += err * err;
    }
    const rmse = Math.sqrt(sumSqErr / flattenedTimes.length);
    assert.ok(rmse < 1e-4, `Expected NMO flattened arrival time RMSE < 1e-4 s, got ${rmse.toExponential(3)} s`);
  });

  it("applies zero-phase bandpass filter, RMS/AGC gain, and projections (CSV, ASCII, LAS well-tie)", () => {
    const dtSec = 0.002;
    const n = 256;
    // Composite signal: 15 Hz (passband) + 120 Hz (stopband)
    const composite = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i * dtSec;
      composite[i] = Math.sin(2 * Math.PI * 15 * t) + Math.sin(2 * Math.PI * 120 * t);
    }

    const filtered = zeroPhaseBandpassFilter(composite, dtSec, 5, 45, 5);
    const spec = computeAmplitudePhaseSpectrum(filtered, dtSec, 1024);
    assert.ok(Math.abs(spec.peakFrequencyHz - 15) < 1.0, `Expected filtered peak ~15 Hz, got ${spec.peakFrequencyHz}`);

    const rmsNorm = applyRmsGain(filtered, 2.0);
    let rms = 0;
    for (let i = 0; i < rmsNorm.length; i++) rms += rmsNorm[i]! * rmsNorm[i]!;
    rms = Math.sqrt(rms / rmsNorm.length);
    assert.ok(Math.abs(rms - 2.0) < 1e-4, `Expected RMS ~2.0, got ${rms}`);

    const agc = applyAgcGain(filtered, 31);
    assert.equal(agc.length, n);

    const file: SegyFile = {
      textualHeader: createDefaultTextualHeader({ client: "ACME", line: "WELL-TIE-1" }),
      binaryHeader: createDefaultBinaryHeader({
        sampleIntervalUs: 2000,
        samplesPerTrace: 16,
        sampleFormatCode: SegySampleFormat.IEEE_FLOAT32,
      }),
      extendedTextualHeaders: [],
      traces: [
        {
          header: createDefaultTraceHeader({ traceSeqLine: 1, cdp: 100, sampleCount: 16, sampleIntervalUs: 2000 }),
          samples: rickerWavelet(30, 0.002, 16),
        },
      ],
      streamIssues: [],
    };

    const csv = segyToCsv(file);
    assert.ok(csv.startsWith("time_ms,trace_1\n"));
    assert.equal(csv.trim().split("\n").length, 17);

    const dump = segyToAsciiDump(file);
    assert.ok(dump.includes("=== SEG-Y REEL HEADER ==="));
    assert.ok(dump.includes("CDP=100"));

    const las = segyToLasWellTie(file, { wellName: "WELL-A", velocityMps: 2500 });
    assert.ok(las.includes("~Version Information"));
    assert.ok(las.includes("VERS.                  2.0"));
    assert.ok(las.includes("~Curve Information"));
    assert.ok(las.includes("SEIS.AMP"));
    assert.ok(las.includes("~A  DEPT"));
  });
});
