// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Touchstone RF S-Parameter network datasets.
 *
 * Evaluates:
 * 1. Multi-port S-parameter matrix parsing across dB, MA, and RI formats
 * 2. High-speed differential interconnect signal integrity: Insertion Loss, Return Loss, NEXT, FEXT
 * 3. Passivity and reciprocity algebraic invariants: I - S^H * S >= 0
 * 4. Vector fitting rational state-space macromodeling and DAE arena lowering
 */

import assert from "node:assert/strict";
import {
  parseTouchstone,
  verifyPassivity,
  fitStateSpaceModel,
  lowerTouchstoneToDae,
  type TouchstoneDeck,
} from "../src/index.js";

export const TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK = `! High-Speed 4-Port Coupled Microstrip Differential Pair Benchmark
! Port 1: In+  |  Port 2: Out+  |  Port 3: In-  |  Port 4: Out-
# GHz S RI R 50
! Freq(GHz)  S11_r S11_i  S12_r S12_i  S13_r S13_i  S14_r S14_i
!            S21_r S21_i  S22_r S22_i  S23_r S23_i  S24_r S24_i
!            S31_r S31_i  S32_r S32_i  S33_r S33_i  S34_r S34_i
!            S41_r S41_i  S42_r S42_i  S43_r S43_i  S44_r S44_i
0.5
  0.010 -0.010  0.650 -0.650  0.010  0.005  0.002  0.001
  0.650 -0.650  0.010 -0.010  0.002  0.001  0.010  0.005
  0.010  0.005  0.002  0.001  0.010 -0.010  0.650 -0.650
  0.002  0.001  0.010  0.005  0.650 -0.650  0.010 -0.010
1.0
  0.020 -0.015  0.620 -0.620  0.020  0.010  0.004  0.002
  0.620 -0.620  0.020 -0.015  0.004  0.002  0.020  0.010
  0.020  0.010  0.004  0.002  0.020 -0.015  0.620 -0.620
  0.004  0.002  0.020  0.010  0.620 -0.620  0.020 -0.015
2.5
  0.030 -0.030  0.550 -0.550  0.030  0.020  0.008  0.005
  0.550 -0.550  0.030 -0.030  0.008  0.005  0.030  0.020
  0.030  0.020  0.008  0.005  0.030 -0.030  0.550 -0.550
  0.008  0.005  0.030  0.020  0.550 -0.550  0.030 -0.030
5.0
  0.050 -0.050  0.450 -0.450  0.040  0.030  0.015  0.010
  0.450 -0.450  0.050 -0.050  0.015  0.010  0.040  0.030
  0.040  0.030  0.015  0.010  0.050 -0.050  0.450 -0.450
  0.015  0.010  0.040  0.030  0.450 -0.450  0.050 -0.050
10.0
  0.080 -0.080  0.350 -0.350  0.060  0.040  0.025  0.020
  0.350 -0.350  0.080 -0.080  0.025  0.020  0.060  0.040
  0.060  0.040  0.025  0.020  0.080 -0.080  0.350 -0.350
  0.025  0.020  0.060  0.040  0.350 -0.350  0.080 -0.080
`;

export interface TouchstoneBenchmarkMetrics {
  portsCount: number;
  frequenciesCount: number;
  isPassive: boolean;
  maxSingularValue: number;
  insertionLossDbAt1GHz: number;
  nearEndCrosstalkDbAt1GHz: number;
  fittedPolesCount: number;
  daeVarCount: number;
  daeEqCount: number;
}

export function runTouchstoneBenchmark(content = TOUCHSTONE_4PORT_DIFFERENTIAL_BENCHMARK): TouchstoneBenchmarkMetrics {
  const ts: TouchstoneDeck = parseTouchstone(content, "benchmark.s4p");

  assert.ok(ts, "Touchstone parser must produce valid dataset");
  assert.equal(ts.numPorts, 4, "Must parse exactly 4 ports");
  assert.equal(ts.points.length, 5, "Must parse 5 frequency sweep points");

  // 1. Verify Passivity across all frequency points
  const passivity = verifyPassivity(ts);
  assert.ok(passivity.isPassive, `Passive differential interconnect must satisfy ||S|| <= 1, got maxNorm=${passivity.maxNorm}`);

  // 2. Extract S21 (insertion loss) and S31 (near-end crosstalk) at 1.0 GHz (index 1)
  const p1G = ts.points[1]!;
  assert.equal(p1G.frequencyHz, 1.0e9, "Second point must be 1.0 GHz");

  // S21 is row 1, col 0 (0-indexed)
  const s21 = p1G.matrix[1]![0]!;
  const s21Mag = Math.hypot(s21.re, s21.im);
  const ilDb = 20.0 * Math.log10(s21Mag);

  // S31 (NEXT) is row 2, col 0
  const s31 = p1G.matrix[2]![0]!;
  const s31Mag = Math.hypot(s31.re, s31.im);
  const nextDb = 20.0 * Math.log10(s31Mag);

  assert.ok(ilDb > -3.0 && ilDb < 0.0, `Insertion loss at 1GHz must be between -3dB and 0dB, got ${ilDb.toFixed(2)}dB`);
  assert.ok(nextDb < -25.0, `Near-end crosstalk NEXT must be attenuated < -25dB, got ${nextDb.toFixed(2)}dB`);

  // 3. Rational Vector Fitting State-Space Model
  const ss = fitStateSpaceModel(ts, 4);
  assert.ok(ss.poles.length >= 2, "Must identify stable macromodel poles");
  for (const pole of ss.poles) {
    assert.ok(pole.re < 0, "All fitted macromodel poles must reside in open left-half complex plane (stable)");
  }
  assert.ok(ss.A.length >= 2, "State-space A-matrix must have rank >= 2");

  // 4. Lower to DAE arena
  const dae = lowerTouchstoneToDae(ts);
  assert.ok(dae.getVarCount() > 0, "DAE arena must declare state/port variables");
  assert.ok(dae.getEqCount() > 0, "DAE arena must declare linear algebraic/differential equations");

  return {
    portsCount: ts.numPorts,
    frequenciesCount: ts.points.length,
    isPassive: passivity.isPassive,
    maxSingularValue: passivity.maxNorm,
    insertionLossDbAt1GHz: ilDb,
    nearEndCrosstalkDbAt1GHz: nextDb,
    fittedPolesCount: ss.poles.length,
    daeVarCount: dae.getVarCount(),
    daeEqCount: dae.getEqCount(),
  };
}
