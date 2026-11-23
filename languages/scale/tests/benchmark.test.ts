// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKenoCadAssembly } from "../src/cad/keno-geometry.js";
import { SCALE_NUCLIDE_DATA } from "../src/catalog/scale-std-schemas.js";
import { parseScale } from "../src/parser/scale-parser.js";
import {
  analyticalBateman2Step,
  analyticalBateman3Step,
  analyticalSingleDepletion,
  solveBatemanDepletion,
} from "../src/solver/bateman-solver.js";

function computeRelErr(actual: number, expected: number): number {
  const denom = Math.max(1e-30, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

function computeNormalizedRmse(actuals: number[], expecteds: number[]): number {
  assert.equal(actuals.length, expecteds.length);
  let sumSq = 0;
  let maxRef = 1e-30;
  for (let i = 0; i < actuals.length; i++) {
    const diff = actuals[i]! - expecteds[i]!;
    sumSq += diff * diff;
    if (Math.abs(expecteds[i]!) > maxRef) maxRef = Math.abs(expecteds[i]!);
  }
  return Math.sqrt(sumSq / actuals.length) / maxRef;
}

describe("SCALE / ORIGEN / KENO Quantitative Analytical Benchmarks", () => {
  it("matches analytical 2-step & 3-step Bateman decay chain I-135 -> Xe-135 -> Cs-135 (expm & rk4)", () => {
    const n0 = 1.0e16;
    const k1 = SCALE_NUCLIDE_DATA["I-135"]!.decayConstant;
    const k2 = SCALE_NUCLIDE_DATA["Xe-135"]!.decayConstant;
    const k3 = SCALE_NUCLIDE_DATA["Cs-135"]!.decayConstant;

    // Sample from 1 hour to 48 hours (spans Xe-135 peak at ~11.1 hours)
    const timesSec = [3600, 7200, 14400, 28800, 39600, 57600, 86400, 172800];

    for (const method of ["expm", "rk4"] as const) {
      const sol = solveBatemanDepletion({
        initialAtoms: { "I-135": n0 },
        timesSec,
        flux: 0,
        method,
      });

      const iActual: number[] = [];
      const iExact: number[] = [];
      const xeActual: number[] = [];
      const xeExact: number[] = [];
      const csActual: number[] = [];
      const csExact: number[] = [];

      for (let idx = 0; idx < timesSec.length; idx++) {
        const t = timesSec[idx]!;
        const step = sol.steps[idx]!;

        // 2-step analytical parity
        const ref2 = analyticalBateman2Step(n0, k1, k2, t);
        // 3-step analytical parity
        const ref3 = analyticalBateman3Step(n0, k1, k2, k3, t);

        const nI = step.atoms["I-135"]!;
        const nXe = step.atoms["Xe-135"]!;
        const nCs = step.atoms["Cs-135"]!;

        const relErrI = computeRelErr(nI, ref2.n1);
        const relErrXe = computeRelErr(nXe, ref2.n2);
        const relErrCs = computeRelErr(nCs, ref3.n3);

        const tol = method === "expm" ? 1e-10 : 1e-6;
        assert.ok(relErrI < tol, `[${method}] I-135 relErr=${relErrI} at t=${t}s`);
        assert.ok(relErrXe < tol, `[${method}] Xe-135 relErr=${relErrXe} at t=${t}s`);
        assert.ok(relErrCs < tol, `[${method}] Cs-135 relErr=${relErrCs} at t=${t}s`);

        // Conservation of total atoms vs exact 3-step analytical sum
        const total = nI + nXe + nCs;
        const exactTotal = ref3.n1 + ref3.n2 + ref3.n3;
        assert.ok(computeRelErr(total, exactTotal) < 1e-10, `[${method}] atom conservation violated at t=${t}s`);

        iActual.push(nI);
        iExact.push(ref3.n1);
        xeActual.push(nXe);
        xeExact.push(ref3.n2);
        csActual.push(nCs);
        csExact.push(ref3.n3);
      }

      const rmseI = computeNormalizedRmse(iActual, iExact);
      const rmseXe = computeNormalizedRmse(xeActual, xeExact);
      const rmseCs = computeNormalizedRmse(csActual, csExact);
      const rmseTol = method === "expm" ? 1e-10 : 1e-6;
      assert.ok(rmseI < rmseTol, `[${method}] I-135 normalized RMSE=${rmseI}`);
      assert.ok(rmseXe < rmseTol, `[${method}] Xe-135 normalized RMSE=${rmseXe}`);
      assert.ok(rmseCs < rmseTol, `[${method}] Cs-135 normalized RMSE=${rmseCs}`);
      assert.ok(sol.finalDecayHeatWatts > 0, "Decay heat should be strictly positive");
    }
  });

  it("matches analytical U-235 burnup/depletion under constant thermal flux", () => {
    const n0 = 1.0e21;
    const flux = 3.0e13; // n / (cm^2 * s)
    const u235 = SCALE_NUCLIDE_DATA["U-235"]!;
    const timesSec = [10, 30, 90, 180, 365].map((d) => d * 86400);

    const sol = solveBatemanDepletion({
      initialAtoms: { "U-235": n0 },
      timesSec,
      flux,
      method: "expm",
    });

    const actuals: number[] = [];
    const exacts: number[] = [];
    for (let i = 0; i < timesSec.length; i++) {
      const t = timesSec[i]!;
      const actual = sol.steps[i]!.atoms["U-235"]!;
      const expected = analyticalSingleDepletion(n0, u235.decayConstant, u235.sigmaAbsorptionBarns, flux, t);
      const relErr = computeRelErr(actual, expected);
      assert.ok(relErr < 1e-11, `U-235 burnup relErr=${relErr} at t=${t}s`);
      actuals.push(actual);
      exacts.push(expected);
    }

    const rmse = computeNormalizedRmse(actuals, exacts);
    assert.ok(rmse < 1e-11, `U-235 burnup RMSE=${rmse}`);

    // Verify fission product buildup (Cs-137 and Sr-90) after 365 days
    assert.ok((sol.finalAtoms["Cs-137"] ?? 0) > 1.0e19, "Cs-137 fission product should accumulate");
    assert.ok((sol.finalAtoms["Sr-90"] ?? 0) > 1.0e19, "Sr-90 fission product should accumulate");
  });

  it("matches exact analytical KENO PWR pin-cell and 3x3 array geometry volumes", () => {
    const rFuel = 0.4096;
    const rClad = 0.475;
    const halfPitch = 0.63;
    const halfHeight = 182.88;
    const height = 2 * halfHeight;
    const pitch = 2 * halfPitch;

    const src = `=csas6
PWR 3x3 Fuel Pin Array Benchmark
v7.1-252
read comp
  uo2 1 den=10.41 1.0 900.0 92235 4.0 92238 96.0 end
  h2o 2 den=0.72 1.0 580.0 end
  zirc4 3 den=6.56 1.0 600.0 end
end comp
read geom
  unit 1
  cylinder 1 ${rFuel} ${halfHeight} -${halfHeight}
  cylinder 2 ${rClad} ${halfHeight} -${halfHeight}
  cuboid 3 ${halfPitch} -${halfPitch} ${halfPitch} -${halfPitch} ${halfHeight} -${halfHeight}
  media 1 1 1
  media 3 1 2 -1
  media 2 1 3 -2
  boundary 3
  global unit 10
  cuboid 1 1.89 -1.89 1.89 -1.89 ${halfHeight} -${halfHeight}
  array 1 1
  boundary 1
end geom
read array
  ara=1 nux=3 nuy=3 nuz=1
  fill 9*1 end fill
end array
read bounds
  all=mirror
end bounds
end
`;
    const deck = parseScale(src);
    const geom = buildKenoCadAssembly(deck);

    // Exact analytical volumes for a single pin cell
    const exactFuelPin = Math.PI * rFuel * rFuel * height;
    const exactCladPin = Math.PI * (rClad * rClad - rFuel * rFuel) * height;
    const exactModPin = (pitch * pitch - Math.PI * rClad * rClad) * height;
    const exactTotalPin = pitch * pitch * height;

    const u1 = geom.units.get(1)!;
    assert.ok(computeRelErr(u1.volumeByMixtureCm3[1]!, exactFuelPin) < 1e-12);
    assert.ok(computeRelErr(u1.volumeByMixtureCm3[3]!, exactCladPin) < 1e-12);
    assert.ok(computeRelErr(u1.volumeByMixtureCm3[2]!, exactModPin) < 1e-12);

    // 3x3 array (9 pins) exact volume parity
    assert.equal(geom.arrayCellCount, 9);
    assert.ok(computeRelErr(geom.volumeByMixtureCm3[1]!, 9 * exactFuelPin) < 1e-12);
    assert.ok(computeRelErr(geom.volumeByMixtureCm3[3]!, 9 * exactCladPin) < 1e-12);
    assert.ok(computeRelErr(geom.volumeByMixtureCm3[2]!, 9 * exactModPin) < 1e-12);
    assert.ok(computeRelErr(geom.totalVolumeCm3, 9 * exactTotalPin) < 1e-12);
    assert.equal(geom.assembly.parts.length, 27); // 9 pins * 3 regions each
  });
});
