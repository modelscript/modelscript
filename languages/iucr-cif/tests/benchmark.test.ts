// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import {
  cartesianToFractional,
  computeMetricTensor,
  CU_K_ALPHA_WAVELENGTH,
  fractionalToCartesian,
  solveCrystalStructure,
} from "../src/solver/index.js";

describe("Crystallography & Powder XRD Analytical Benchmarks", () => {
  it("matches Silicon (a = 5.431 Å, Fd-3m) volume, Si-Si bond length, density, and (111) Cu-Kα Bragg 2θ within relErr < 1e-4 / rmse < 1e-6", () => {
    const sol = solveCrystalStructure(CANONICAL_CIF_TEMPLATES.silicon);
    const a = 5.431;

    // 1. Unit-cell volume V = a^3
    const expectedVol = a * a * a;
    const volRelErr = Math.abs(sol.metric.volume - expectedVol) / expectedVol;
    assert.ok(volRelErr < 1e-12, `Volume relErr=${volRelErr} (got ${sol.metric.volume}, expected ${expectedVol})`);

    // 2. Diamond cubic expanded atom count = 8
    assert.equal(sol.expandedAtoms.length, 8);

    // 3. Nearest-neighbor Si-Si bond length = a * sqrt(3) / 4 = 2.3516919... Å
    const expectedBond = (a * Math.sqrt(3)) / 4;
    const bondRelErr = Math.abs(sol.nearestNeighborDistance - expectedBond) / expectedBond;
    assert.ok(
      bondRelErr < 1e-6,
      `Si-Si bond relErr=${bondRelErr} (got ${sol.nearestNeighborDistance}, expected ${expectedBond})`,
    );

    // 4. (111) Cu-Kα Bragg reflection 2θ = 2 * arcsin(λ / (2 * a / sqrt(3))) ≈ 28.4428°
    const expectedD111 = a / Math.sqrt(3);
    const expectedTwoTheta111 = (2 * Math.asin(CU_K_ALPHA_WAVELENGTH / (2 * expectedD111)) * 180) / Math.PI;
    const peak111 = sol.xrd.peaks.find((p) => p.hkl[0] === 1 && p.hkl[1] === 1 && p.hkl[2] === 1);
    assert.ok(peak111, "Expected Silicon (111) reflection in simulated powder XRD");

    const ttRelErr = Math.abs(peak111.twoTheta - expectedTwoTheta111) / expectedTwoTheta111;
    assert.ok(
      ttRelErr < 1e-4,
      `Si (111) 2θ relErr=${ttRelErr} (got ${peak111.twoTheta}°, expected ${expectedTwoTheta111}°)`,
    );
    assert.ok(Math.abs(peak111.twoTheta - 28.44) < 0.01);
    assert.equal(peak111.relativeIntensity, 100, "(111) should be the strongest Silicon reflection");

    // 5. Combined RMSE across [volume/100, bond, d111, twoTheta111/100]
    const errs = [
      (sol.metric.volume - expectedVol) / expectedVol,
      (sol.nearestNeighborDistance - expectedBond) / expectedBond,
      (peak111.dSpacing - expectedD111) / expectedD111,
      (peak111.twoTheta - expectedTwoTheta111) / expectedTwoTheta111,
    ];
    const rmse = Math.sqrt(errs.reduce((acc, e) => acc + e * e, 0) / errs.length);
    assert.ok(rmse < 1e-6, `Benchmark normalized RMSE=${rmse} exceeded 1e-6`);

    // 6. Theoretical Silicon density ≈ 2.329 g/cm³
    assert.ok(Math.abs(sol.densityGCm3 - 2.329) < 0.01, `Si density=${sol.densityGCm3}`);
  });

  it("matches analytical triclinic unit-cell volume and fractional <-> Cartesian round-trip", () => {
    const cell = { a: 7.12, b: 8.45, c: 9.31, alpha: 78.5, beta: 84.2, gamma: 68.9 };
    const metric = computeMetricTensor(cell);

    const deg = Math.PI / 180;
    const ca = Math.cos(cell.alpha * deg);
    const cb = Math.cos(cell.beta * deg);
    const cg = Math.cos(cell.gamma * deg);
    const expectedVol = cell.a * cell.b * cell.c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);

    const relErr = Math.abs(metric.volume - expectedVol) / expectedVol;
    assert.ok(relErr < 1e-12, `Triclinic volume relErr=${relErr}`);
    assert.equal(metric.crystalSystem, "triclinic");

    const fract: [number, number, number] = [0.23, 0.67, 0.41];
    const cart = fractionalToCartesian(metric, fract);
    const back = cartesianToFractional(metric, cart);
    const rtErr = Math.hypot(back[0] - fract[0], back[1] - fract[1], back[2] - fract[2]);
    assert.ok(rtErr < 1e-12, `Round-trip error=${rtErr}`);
  });

  it("matches canonical NaCl, alpha-Quartz, and FCC Copper densities and volumes", () => {
    const nacl = solveCrystalStructure(CANONICAL_CIF_TEMPLATES.nacl);
    assert.equal(nacl.expandedAtoms.length, 8); // 4 Na + 4 Cl
    assert.ok(Math.abs(nacl.densityGCm3 - 2.164) < 0.02, `NaCl density=${nacl.densityGCm3}`);

    const quartz = solveCrystalStructure(CANONICAL_CIF_TEMPLATES.quartz);
    assert.equal(quartz.expandedAtoms.length, 9); // 3 Si + 6 O
    assert.ok(Math.abs(quartz.densityGCm3 - 2.648) < 0.02, `Quartz density=${quartz.densityGCm3}`);

    const cu = solveCrystalStructure(CANONICAL_CIF_TEMPLATES.copper);
    assert.equal(cu.expandedAtoms.length, 4); // 4 Cu
    assert.ok(Math.abs(cu.densityGCm3 - 8.93) < 0.05, `Cu density=${cu.densityGCm3}`);
  });
});
