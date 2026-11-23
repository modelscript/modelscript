// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Physics & Aerodynamic Verification Benchmark Suite for `@modelscript/datcom`.
 *
 * Verifies:
 * 1. High-aspect-ratio unswept NACA 0012 wing CL_alpha vs Prandtl lifting-line 2*pi / (1 + 2/AR)
 * 2. Prandtl-Glauert subsonic Mach scaling CL_alpha(M) / CL_alpha(0)
 * 3. Induced drag polar CD_i = CL^2 / (pi * e * AR)
 * 4. Phugoid & short-period linearized longitudinal modal parity
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";
import { parseDatcomDeck } from "../src/parser/deck-parser.js";
import { solveDatcomCase } from "../src/solver/aero-solver.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

describe("DATCOM Semi-Empirical Aerodynamic Benchmarks", () => {
  it("matches Prandtl lifting-line CL_alpha = 2*pi/(1 + 2/AR) for high-AR unswept NACA 0012 wing", () => {
    const deck = parseDatcomDeck(
      [
        "CASEID HIGH AR NACA 0012 WING",
        "DIM M",
        "DERIV DEG",
        " $FLTCON NMACH=1.0, MACH(1)=0.05, NALPHA=5.0, ALSCHD(1)=-2.0,0.0,2.0,4.0,6.0, NALT=1.0, ALT(1)=0.0$",
        " $WGPLNF CHRDR=1.0, CHRDTP=1.0, SSPN=6.0, SAVSI=0.0, CHSTAT=0.25, TYPE=1.0$",
        "NACA-W-4-0012",
      ].join("\n"),
    );

    const res = solveDatcomCase(deck.cases[0]!);
    const AR = 12.0; // b = 12 m, c = 1 m -> AR = 12
    assert.ok(relErr(res.aspectRatio, AR) < 1e-6);

    const liftingLineCLalpha = (2 * Math.PI) / (1 + 2 / AR);
    const err = relErr(res.CLalphaPerRad, liftingLineCLalpha);
    const tolerance = 0.025; // Helmbold/Polhamus vs Prandtl lifting-line within 2.5% at AR=12
    assert.ok(
      err < tolerance,
      `CL_alpha=${res.CLalphaPerRad.toFixed(4)} vs lifting-line=${liftingLineCLalpha.toFixed(4)} (relErr=${err.toFixed(4)})`,
    );
  });

  it("follows Prandtl-Glauert subsonic Mach scaling for high-AR unswept wing", () => {
    const deck = parseDatcomDeck(
      [
        "CASEID PRANDTL GLAUERT SCALING",
        "DIM M",
        " $FLTCON NMACH=2.0, MACH(1)=0.1,0.6, NALPHA=3.0, ALSCHD(1)=0.0,2.0,4.0, NALT=1.0, ALT(1)=0.0$",
        " $WGPLNF CHRDR=1.0, CHRDTP=1.0, SSPN=10.0, SAVSI=0.0, CHSTAT=0.25, TYPE=1.0$",
        "NACA-W-4-0012",
      ].join("\n"),
    );

    const c = deck.cases[0]!;
    const lowM = solveDatcomCase(c, { machIndex: 0 });
    const highM = solveDatcomCase(c, { machIndex: 1 });

    // For finite AR=20, compressibility increases CL_alpha substantially toward 1/sqrt(1-M^2)
    const betaLow = Math.sqrt(1 - 0.1 * 0.1);
    const betaHigh = Math.sqrt(1 - 0.6 * 0.6);
    const pgRatio2D = betaLow / betaHigh; // 1.2437
    const actualRatio = highM.CLalphaPerRad / lowM.CLalphaPerRad;

    assert.ok(actualRatio > 1.15, `Expected compressibility rise > 1.15, got ${actualRatio.toFixed(4)}`);
    const tolerance = 0.06; // 3D finite-wing AR=20 vs 2D Prandtl-Glauert within 6%
    const err = relErr(actualRatio, pgRatio2D);
    assert.ok(
      err < tolerance,
      `Mach scaling ratio=${actualRatio.toFixed(4)} vs 2D PG=${pgRatio2D.toFixed(4)} (relErr=${err.toFixed(4)})`,
    );
  });

  it("satisfies exact parabolic induced drag polar CDi = CL^2 / (pi * e * AR)", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    const res = solveDatcomCase(deck.cases[0]!);

    const tolerance = 1e-9;
    for (const pt of res.polar) {
      const expectedCDi = (pt.CL * pt.CL) / (Math.PI * res.oswaldEfficiency * res.aspectRatio);
      const err = relErr(pt.CDi, expectedCDi);
      assert.ok(err < tolerance, `CDi mismatch at alpha=${pt.alphaDeg}: relErr=${err}`);
      assert.ok(relErr(pt.CD, pt.CD0 + pt.CDi) < tolerance);
    }
  });

  it("matches Lanchester phugoid frequency sqrt(2)*g/V0 and physically realistic short-period modes", () => {
    const deck = parseDatcomDeck(DATCOM_AIRCRAFT_TEMPLATES.CESSNA_172);
    const res = solveDatcomCase(deck.cases[0]!);
    const g = 9.80665;

    // Lanchester phugoid natural frequency: omega_ph = sqrt(2) * g / V0
    const expectedPhugoidOmega = (Math.SQRT2 * g) / res.airspeedMS;
    const phErr = relErr(res.longitudinalModes.phugoidOmegaN, expectedPhugoidOmega);
    const tolerance = 0.02;
    assert.ok(
      phErr < tolerance,
      `Phugoid omega_n=${res.longitudinalModes.phugoidOmegaN.toFixed(4)} vs Lanchester=${expectedPhugoidOmega.toFixed(4)} (relErr=${phErr.toFixed(4)})`,
    );

    // Short-period mode must be faster and better damped than phugoid
    assert.ok(res.longitudinalModes.shortPeriodOmegaN > res.longitudinalModes.phugoidOmegaN * 3);
    assert.ok(res.longitudinalModes.shortPeriodZeta > 0.2 && res.longitudinalModes.shortPeriodZeta < 2.0);
    assert.ok(res.longitudinalModes.phugoidZeta > 0.01 && res.longitudinalModes.phugoidZeta < 0.3);
  });
});
