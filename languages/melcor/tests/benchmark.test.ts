// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMelcor } from "../src/parser/melcor-parser.js";
import { analyticalIsothermalOxidation, solveMelcorTransient } from "../src/solver/melcor-solver.js";

function computeRmse(actual: number[], expected: number[]): number {
  assert.equal(actual.length, expected.length);
  let sumSq = 0.0;
  for (let i = 0; i < actual.length; i++) {
    const diff = (actual[i] ?? 0) - (expected[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("@modelscript/melcor — Physics Verification Benchmarks", () => {
  it("Benchmark 1: Two-volume adiabatic blowdown pressure equalization & exact mass/energy conservation", () => {
    const p1Init = 4.0e6; // 4 MPa
    const v1 = 10.0; // m^3
    const p2Init = 1.0e6; // 1 MPa
    const v2 = 30.0; // m^3
    const pEqAnalytical = (p1Init * v1 + p2Init * v2) / (v1 + v2); // 1.75 MPa

    const deck = parseMelcor(`MELGEN_INPUT
TITLE 'Two-Volume Blowdown Benchmark'
EXEC_INPUT
  EXEC_TSTART 0.0
  EXEC_TEND 15.0
  EXEC_DT 0.005 0.01 1.0e-5
CVH_INPUT
  CV_ID 'HighP' 100 NORMAL
  CV_THR ${p1Init} 550.0
  CV_PAS ${v1}
  CV_ID 'LowP' 200 NORMAL
  CV_THR ${p2Init} 350.0
  CV_PAS ${v2}
FL_INPUT
  FL_ID 'Orifice' 10
  FL_FT 100 200
  FL_GEO 0.04 1.0 1.0
  FL_USL 1.0 1.0
END
`);
    const res = solveMelcorTransient(deck, { dt: 0.005 });

    // Exact mass & internal energy conservation
    assert.ok(res.massConservationRelErr < 1e-12, `Mass conservation relErr too large: ${res.massConservationRelErr}`);
    assert.ok(
      res.energyConservationRelErr < 1e-12,
      `Energy conservation relErr too large: ${res.energyConservationRelErr}`,
    );

    const p1Final = res.finalState.cv[100]?.pressurePa ?? 0;
    const p2Final = res.finalState.cv[200]?.pressurePa ?? 0;
    const relErrP1 = Math.abs(p1Final - pEqAnalytical) / pEqAnalytical;
    const relErrP2 = Math.abs(p2Final - pEqAnalytical) / pEqAnalytical;
    const dpEqRel = Math.abs(p1Final - p2Final) / pEqAnalytical;

    assert.ok(relErrP1 < 1e-3, `CV 100 final pressure relErr=${relErrP1} (got ${p1Final}, expected ${pEqAnalytical})`);
    assert.ok(relErrP2 < 1e-3, `CV 200 final pressure relErr=${relErrP2} (got ${p2Final}, expected ${pEqAnalytical})`);
    assert.ok(dpEqRel < 1e-3, `Pressure equalization gap relErr=${dpEqRel}`);
  });

  it("Benchmark 2: Adiabatic core decay-heat heatup dT/dt = Q / (m * cp) analytical parity", () => {
    const massKg = 80000.0;
    const cp = 350.0;
    const t0 = 600.0;
    const qDecay = 2.8e7; // 28 MW => dT/dt = 1.0 K/s
    const tEnd = 200.0;

    const deck = parseMelcor(`MELCOR_INPUT
TITLE 'Adiabatic Core Heatup'
EXEC_INPUT
  EXEC_TSTART 0.0
  EXEC_TEND ${tEnd}
  EXEC_DT 0.1 1.0 1.0e-4
COR_INPUT
  COR_RP 1 1 3.0e9
  COR_ZDF ${massKg} ${cp} ${t0} 4500.0 20000.0
  COR_PWR ${qDecay} 3.0e9
  COR_OX OFF
END
`);
    const res = solveMelcorTransient(deck, { dt: 0.1 });

    const actualTemps = res.trajectory.map((pt) => pt.coreTempK);
    const expectedTemps = res.trajectory.map((pt) => t0 + (qDecay / (massKg * cp)) * pt.time);
    const rmse = computeRmse(actualTemps, expectedTemps);

    const expectedFinal = t0 + (qDecay / (massKg * cp)) * tEnd; // 800.0 K
    const relErr = Math.abs(res.finalState.coreTempK - expectedFinal) / expectedFinal;

    assert.ok(relErr < 1e-10, `Core heatup final relErr=${relErr}`);
    assert.ok(rmse < 1e-8, `Core heatup trajectory RMSE=${rmse} K`);
  });

  it("Benchmark 3: Zircaloy-steam parabolic oxidation H2 mass parity (Urbanic-Heidrick & Cathcart-Pawel)", () => {
    const tempK = 1600.0;
    const cladArea = 4500.0;
    const cladZrMass = 22000.0;
    const tEnd = 300.0;

    for (const model of ["URBANIC_HEIDRICK", "CATHCART_PAWEL"] as const) {
      const deck = parseMelcor(`MELCOR_INPUT
TITLE 'Isothermal Zircaloy Oxidation ${model}'
EXEC_INPUT
  EXEC_TSTART 0.0
  EXEC_TEND ${tEnd}
  EXEC_DT 0.5 1.0 1.0e-4
COR_INPUT
  COR_RP 1 1 3.0e9
  COR_ZDF 80000.0 350.0 ${tempK} ${cladArea} ${cladZrMass}
  COR_PWR 0.0 3.0e9
  COR_OX ON ${model} ${cladArea} ${cladZrMass}
END
`);
      const res = solveMelcorTransient(deck, {
        dt: 0.5,
        isothermalCore: true,
        oxidationHeating: false,
      });

      const actualH2 = res.trajectory.map((pt) => pt.h2GeneratedKg);
      const expectedH2 = res.trajectory.map(
        (pt) => analyticalIsothermalOxidation(tempK, cladArea, pt.time, model, cladZrMass).h2GeneratedKg,
      );
      const rmse = computeRmse(actualH2, expectedH2);

      const finalAnalytical = analyticalIsothermalOxidation(tempK, cladArea, tEnd, model, cladZrMass);
      assert.ok(finalAnalytical.h2GeneratedKg > 1.0, `Expected measurable H2 generation for ${model}`);
      const relErr =
        Math.abs(res.finalState.h2GeneratedKg - finalAnalytical.h2GeneratedKg) / finalAnalytical.h2GeneratedKg;

      assert.ok(relErr < 1e-10, `${model} H2 relErr=${relErr}`);
      assert.ok(rmse < 1e-9, `${model} H2 trajectory RMSE=${rmse} kg`);
    }
  });
});
