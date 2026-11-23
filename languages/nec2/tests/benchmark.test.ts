// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNec2Deck, solveNec2Deck } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

describe("@modelscript/nec2 Method-of-Moments Electromagnetic Benchmarks", () => {
  it("thin half-wave dipole parity: Z_in ≈ 73 + j42.5 Ω and peak directivity D ≈ 2.15 dBi", () => {
    // At f = 299.792458 MHz, lambda = 1.000000 m, L = lambda/2 = 0.500000 m
    // Thin wire radius a = 1e-4 * lambda = 0.0001 m (classic Hallen/Balanis/NEC-2 benchmark)
    const deck = parseNec2Deck(`
CM Thin Half-Wave Dipole Benchmark (L = 0.5 lambda, a = 1e-4 lambda)
CE
GW 1 31 0 0 -0.25 0 0 0.25 0.0001
GE 0
FR 0 1 0 0 299.792458 0
EX 0 1 16 0 1.0 0.0
RP 0 37 1 1000 0 0 5 0
EN
`);

    const res = solveNec2Deck(deck, { z0: 50.0, computeFarField: true, thetaSamples: 73, phiSamples: 16 });
    assert.strictEqual(res.points.length, 1);
    const pt = res.points[0]!;

    const rExpected = 73.13;
    const xExpected = 42.54;
    const dbiExpected = 2.15;

    // Finite-radius (a = 1e-4 lambda) Hallen/NEC-2 MoM gives ~79.6 + j43 Ohm vs a->0 induced-EMF 73.13 + j42.54 Ohm
    const rTol = 0.1;
    const xTol = 0.12;
    const dbiTol = 0.05;

    const rErr = relErr(pt.feedpointImpedance.re, rExpected);
    const xErr = relErr(pt.feedpointImpedance.im, xExpected);
    const dbiErr = relErr(pt.peakDirectivityDbi, dbiExpected);

    assert.ok(
      rErr < rTol,
      `Dipole R_in=${pt.feedpointImpedance.re.toFixed(2)} Ω vs expected ${rExpected} Ω (relErr=${rErr.toFixed(4)}, tolerance=${rTol})`,
    );
    assert.ok(
      xErr < xTol,
      `Dipole X_in=${pt.feedpointImpedance.im.toFixed(2)} Ω vs expected ${xExpected} Ω (relErr=${xErr.toFixed(4)}, tolerance=${xTol})`,
    );
    assert.ok(
      dbiErr < dbiTol,
      `Dipole peak directivity=${pt.peakDirectivityDbi.toFixed(3)} dBi vs expected ${dbiExpected} dBi (relErr=${dbiErr.toFixed(4)}, tolerance=${dbiTol})`,
    );
    assert.ok(pt.vswr > 1.0 && pt.vswr < 3.0, `Expected reasonable 50-Ohm VSWR, got ${pt.vswr}`);
    assert.ok(pt.returnLossDb > 6.0, `Expected return loss > 6 dB, got ${pt.returnLossDb}`);
  });

  it("quarter-wave monopole over PEC ground parity: Z_in ≈ 36.5 + j21.2 Ω and D ≈ 5.16 dBi", () => {
    // By image theory, a quarter-wave monopole over an infinite PEC ground plane has
    // Z_in = 0.5 * Z_dipole ≈ 36.56 + j21.27 Ω and D = 2 * D_dipole ≈ 5.16 dBi.
    const deck = parseNec2Deck(`
CM Quarter-Wave Monopole over PEC Ground Benchmark (L = 0.25 lambda)
CE
GW 1 15 0 0 0 0 0 0.25 0.0001
GE 1
GN 1
FR 0 1 0 0 299.792458 0
EX 0 1 1 0 1.0 0.0
RP 0 19 1 1000 0 0 5 0
EN
`);

    const res = solveNec2Deck(deck, { z0: 50.0, computeFarField: true, thetaSamples: 37, phiSamples: 16 });
    assert.strictEqual(res.hasGroundPlane, true);
    assert.strictEqual(res.points.length, 1);
    const pt = res.points[0]!;

    const rExpected = 36.56;
    const xExpected = 21.27;
    const dbiExpected = 5.16;

    const rTol = 0.1;
    const xTol = 0.15;
    const dbiTol = 0.05;

    const rErr = relErr(pt.feedpointImpedance.re, rExpected);
    const xErr = relErr(pt.feedpointImpedance.im, xExpected);
    const dbiErr = relErr(pt.peakDirectivityDbi, dbiExpected);

    assert.ok(
      rErr < rTol,
      `Monopole R_in=${pt.feedpointImpedance.re.toFixed(2)} Ω vs expected ${rExpected} Ω (relErr=${rErr.toFixed(4)}, tolerance=${rTol})`,
    );
    assert.ok(
      xErr < xTol,
      `Monopole X_in=${pt.feedpointImpedance.im.toFixed(2)} Ω vs expected ${xExpected} Ω (relErr=${xErr.toFixed(4)}, tolerance=${xTol})`,
    );
    assert.ok(
      dbiErr < dbiTol,
      `Monopole peak directivity=${pt.peakDirectivityDbi.toFixed(3)} dBi vs expected ${dbiExpected} dBi (relErr=${dbiErr.toFixed(4)}, tolerance=${dbiTol})`,
    );
  });

  it("frequency sweep VSWR exhibits resonance dip near f_res ≈ 0.48 lambda and rises off-resonance", () => {
    const deck = parseNec2Deck(`
CM Half-Wave Dipole Frequency Sweep (240 to 340 MHz)
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
FR 0 11 0 0 240.0 10.0
EX 0 1 11 0 1.0 0.0
XQ
EN
`);

    const res = solveNec2Deck(deck, { z0: 73.0, computeFarField: false });
    assert.strictEqual(res.points.length, 11);

    // Find frequency with minimum VSWR
    let bestPt = res.points[0]!;
    for (const pt of res.points) {
      if (pt.vswr < bestPt.vswr) bestPt = pt;
    }

    // For a=0.001m, L=0.5m, resonance occurs around ~280-290 MHz (L ≈ 0.47-0.48 lambda)
    const fResExpected = 285.0;
    const fTolerance = 0.06;
    const fErr = relErr(bestPt.frequencyMhz, fResExpected);
    assert.ok(
      fErr < fTolerance,
      `Resonant frequency ${bestPt.frequencyMhz} MHz vs expected ${fResExpected} MHz (relErr=${fErr.toFixed(4)}, tolerance=${fTolerance})`,
    );
    assert.ok(bestPt.vswr < 1.35, `Expected low resonant VSWR (< 1.35) into 73 Ω, got ${bestPt.vswr.toFixed(3)}`);

    // VSWR at band edges (240 MHz and 340 MHz) must be significantly higher than at resonance
    const lowEdge = res.points[0]!;
    const highEdge = res.points[res.points.length - 1]!;
    assert.ok(lowEdge.vswr > bestPt.vswr * 2.0, `Expected off-resonance VSWR rise at 240 MHz`);
    assert.ok(highEdge.vswr > bestPt.vswr * 2.0, `Expected off-resonance VSWR rise at 340 MHz`);
    // Capacitive below resonance, inductive above resonance
    assert.ok(lowEdge.feedpointImpedance.im < 0, "Expected capacitive reactance (X < 0) below resonance");
    assert.ok(highEdge.feedpointImpedance.im > 0, "Expected inductive reactance (X > 0) above resonance");
  });

  it("LD resistive loading increases feedpoint resistance and reduces radiation efficiency", () => {
    const deck = parseNec2Deck(`
CM Resistively Loaded Half-Wave Dipole
CE
GW 1 21 0 0 -0.25 0 0 0.25 0.001
GE 0
LD 4 1 11 11 50.0 0.0
FR 0 1 0 0 300.0 0
EX 0 1 11 0 1.0 0.0
RP 0 37 1 1000 0 0 5 0
EN
`);

    const res = solveNec2Deck(deck, { z0: 50.0, computeFarField: true });
    const pt = res.points[0]!;
    assert.ok(
      pt.feedpointImpedance.re > 100.0,
      `Expected R_in > 100 Ω with 50 Ω load, got ${pt.feedpointImpedance.re}`,
    );
    assert.ok(pt.efficiency > 0.3 && pt.efficiency < 0.85, `Expected efficiency < 0.85, got ${pt.efficiency}`);
  });
});
