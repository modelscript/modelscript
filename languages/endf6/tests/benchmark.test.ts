// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEndfFloat } from "../src/parser/endf-float.js";
import {
  ENDF_K0_CONSTANT,
  collapseMultigroup,
  evaluateSlbwRange,
  evaluateTab1,
  interpolateEndfPair,
  slbwSpinFactor,
  slbwWaveNumber,
} from "../src/solver/index.js";
import type { Endf6ResonanceRange, Endf6Tab1Record } from "../src/types.js";

describe("ENDF-6 Physics & Numerical Parity Benchmarks", () => {
  it("achieves exact 11-char ENDF float parsing parity (relErr < 1e-10)", () => {
    const cases: Array<[string, number]> = [
      [" 9.223500+4", 9.2235e4],
      [" 2.330250+2", 2.33025e2],
      [" 2.530000-2", 2.53e-2],
      ["-1.493000-3", -1.493e-3],
      [" 1.00000-11", 1.0e-11],
      [" 2.000000+7", 2.0e7],
    ];
    for (const [raw, expected] of cases) {
      const actual = parseEndfFloat(raw);
      const relErr = Math.abs(actual - expected) / Math.abs(expected);
      assert.ok(relErr < 1e-10, `Expected relErr < 1e-10 for '${raw}', got ${relErr}`);
    }
  });

  it("achieves exact ENDF INT=1..5 interpolation parity against analytical laws (relErr < 1e-10)", () => {
    const x1 = 1.0;
    const y1 = 10.0;
    const x2 = 100.0;
    const y2 = 1000.0;
    const x = 10.0;

    // INT=1: Histogram -> y1
    const yHist = interpolateEndfPair(x, x1, y1, x2, y2, 1);
    assert.ok(Math.abs(yHist - y1) / y1 < 1e-10);

    // INT=2: Lin-Lin -> y1 + (y2 - y1)*(x - x1)/(x2 - x1)
    const expLinLin = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    const yLinLin = interpolateEndfPair(x, x1, y1, x2, y2, 2);
    assert.ok(Math.abs(yLinLin - expLinLin) / expLinLin < 1e-10);

    // INT=3: Lin-Log -> y1 + (y2 - y1)*ln(x/x1)/ln(x2/x1) = 10 + 990 * 0.5 = 505
    const expLinLog = y1 + ((y2 - y1) * Math.log(x / x1)) / Math.log(x2 / x1);
    const yLinLog = interpolateEndfPair(x, x1, y1, x2, y2, 3);
    assert.ok(Math.abs(yLinLog - expLinLog) / expLinLog < 1e-10);

    // INT=4: Log-Lin -> y1 * (y2/y1)^((x - x1)/(x2 - x1))
    const expLogLin = y1 * Math.pow(y2 / y1, (x - x1) / (x2 - x1));
    const yLogLin = interpolateEndfPair(x, x1, y1, x2, y2, 4);
    assert.ok(Math.abs(yLogLin - expLogLin) / expLogLin < 1e-10);

    // INT=5: Log-Log -> y1 * (x/x1)^(ln(y2/y1)/ln(x2/x1)) = 10 * 10^1 = 100
    const expLogLog = y1 * Math.pow(x / x1, Math.log(y2 / y1) / Math.log(x2 / x1));
    const yLogLog = interpolateEndfPair(x, x1, y1, x2, y2, 5);
    assert.ok(Math.abs(yLogLog - expLogLog) / expLogLog < 1e-10);
  });

  it("matches analytical 1/v thermal capture law sigma(E) = sigma_0 * sqrt(E_0 / E) via INT=5 (rmse < 1e-6)", () => {
    const e0 = 0.0253;
    const sig0 = 3837.0; // B-10 thermal capture (barns)
    const tab1: Endf6Tab1Record = {
      c1: 0,
      c2: 0,
      l1: 0,
      l2: 0,
      nr: 1,
      np: 2,
      regions: [{ nbt: 2, interp: 5 }],
      points: [
        { x: 1.0e-5, y: sig0 * Math.sqrt(e0 / 1.0e-5) },
        { x: 100.0, y: sig0 * Math.sqrt(e0 / 100.0) },
      ],
      mat: 525,
      mf: 3,
      mt: 102,
      line: 1,
    };

    const testEnergies = [1e-4, 1e-3, 0.01, 0.0253, 0.1, 1.0, 10.0, 50.0];
    let sumSqErr = 0;
    for (const e of testEnergies) {
      const actual = evaluateTab1(tab1, e);
      const exact = sig0 * Math.sqrt(e0 / e);
      sumSqErr += (actual - exact) * (actual - exact);
    }
    const rmse = Math.sqrt(sumSqErr / testEnergies.length);
    assert.ok(rmse < 1e-6, `Expected 1/v capture RMSE < 1e-6, got ${rmse}`);
  });

  it("matches analytical Single-Level Breit-Wigner peak cross-section for U-238 6.674 eV resonance (rmse < 1e-6)", () => {
    const awr = 236.006;
    const er = 6.674;
    const gn = 0.001493;
    const gg = 0.023;
    const gf = 0.0;
    const gt = gn + gg + gf;

    const u238Range: Endf6ResonanceRange = {
      za: 92238,
      awr,
      el: 1e-5,
      eh: 1000,
      lru: 1,
      lrf: 1,
      spi: 0.0,
      ap: 0.948,
      l: 0,
      resonances: [{ er, aj: 0.5, gt, gn, gg, gf, line: 1 }],
      line: 1,
    };

    // Exact analytical SLBW capture at resonance peak E = Er:
    // sigma_gamma(Er) = (4 * pi / k(Er)^2) * g_J * (Gamma_n * Gamma_gamma / Gamma^2)
    const kPeak = ENDF_K0_CONSTANT * (awr / (awr + 1)) * Math.sqrt(er);
    assert.ok(Math.abs(slbwWaveNumber(er, awr) - kPeak) < 1e-12);
    const gJ = slbwSpinFactor(0.5, 0.0);
    assert.equal(gJ, 1.0);

    const exactPeakCapture = ((4 * Math.PI) / (kPeak * kPeak)) * gJ * ((gn * gg) / (gt * gt));
    const evalPeak = evaluateSlbwRange(u238Range, er);

    // Check peak and wings against closed-form analytical SLBW capture formula
    const testEnergies = [er - 0.5, er - 0.05, er, er + 0.05, er + 0.5];
    let sumSq = 0;
    for (const e of testEnergies) {
      const k = ENDF_K0_CONSTANT * (awr / (awr + 1)) * Math.sqrt(e);
      const gnE = gn * Math.sqrt(e / er);
      const gammaE = gnE + gg;
      const dE = e - er;
      const exactCap = (Math.PI / (k * k)) * gJ * ((gnE * gg) / (dE * dE + 0.25 * gammaE * gammaE));
      const actualCap = evaluateSlbwRange(u238Range, e).capture;
      sumSq += (actualCap - exactCap) * (actualCap - exactCap);
    }
    const rmse = Math.sqrt(sumSq / testEnergies.length);
    assert.ok(rmse < 1e-6, `Expected SLBW capture RMSE < 1e-6, got ${rmse}`);
    assert.ok(Math.abs(evalPeak.capture - exactPeakCapture) / exactPeakCapture < 1e-10);
    assert.ok(evalPeak.capture > 20000, `U-238 6.674 eV peak capture should be ~22,500 b, got ${evalPeak.capture}`);
  });

  it("matches closed-form analytical 1/E-weighted multigroup collapse for a 1/v cross-section", () => {
    // For sigma(E) = C / sqrt(E) and phi(E) = 1 / E over [E1, E2]:
    //   int_{E1}^{E2} C E^(-3/2) dE = 2*C*(E1^(-1/2) - E2^(-1/2))
    //   int_{E1}^{E2} (1/E) dE      = ln(E2 / E1)
    //   sigma_g = 2*C*(1/sqrt(E1) - 1/sqrt(E2)) / ln(E2 / E1)
    const c = 100.0;
    const e1 = 1.0;
    const e2 = 100.0;
    const tab1: Endf6Tab1Record = {
      c1: 0,
      c2: 0,
      l1: 0,
      l2: 0,
      nr: 1,
      np: 2,
      regions: [{ nbt: 2, interp: 5 }],
      points: [
        { x: e1, y: c / Math.sqrt(e1) },
        { x: e2, y: c / Math.sqrt(e2) },
      ],
      mat: 525,
      mf: 3,
      mt: 102,
      line: 1,
    };

    const groups = collapseMultigroup(tab1, [e1, e2], { spectrum: "1/E", subdivisions: 128 });
    assert.equal(groups.length, 1);
    const exactSigmaG = (2 * c * (1 / Math.sqrt(e1) - 1 / Math.sqrt(e2))) / Math.log(e2 / e1);
    const relErr = Math.abs(groups[0]!.sigma - exactSigmaG) / exactSigmaG;
    assert.ok(relErr < 1e-6, `Expected multigroup collapse relErr < 1e-6, got ${relErr}`);
  });
});
