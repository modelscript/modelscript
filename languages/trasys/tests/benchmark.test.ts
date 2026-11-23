// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TRASYS Verification & Physics Benchmarks:
 *   1. Coaxial parallel disks exact Hottel analytical view factor F_12 parity (analytical + Monte Carlo)
 *   2. Aligned parallel rectangles exact Hottel analytical view factor F_12 parity (analytical + Monte Carlo)
 *   3. Reciprocity (A_1 * F_12 = A_2 * F_21) and enclosure closure (sum_j F_ij + F_{i->space} = 1)
 *   4. Gebhart absorption reciprocity (A_i * eps_i * B_ij = A_j * eps_j * B_ji)
 *   5. LEO sphere orbital solar + albedo + planet-IR radiative equilibrium temperature benchmark
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrasysDeck } from "../src/parser/index.js";
import {
  computeGebhartExchange,
  computeViewFactors,
  solveTrasysThermal,
  viewFactorCoaxialDisks,
  viewFactorParallelRectangles,
} from "../src/solver/index.js";
import { STEFAN_BOLTZMANN } from "../src/types.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function rmse(actual: number[], expected: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = (actual[i] ?? 0) - (expected[i] ?? 0);
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("TRASYS Radiative Heat Transfer Benchmarks", () => {
  it("matches exact Hottel analytical view factor for coaxial parallel disks (analytical + Monte Carlo)", () => {
    // Disk 1: r1 = 1.0 m at z = 0 (facing +Z)
    // Disk 2: r2 = 1.5 m at z = 1.0 (facing -Z)
    const r1 = 1.0;
    const r2 = 1.5;
    const h = 1.0;
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S D1 DISK R=${r1} NODE=1 PROP=0.5, 0.8 ACTIVE=TOP TZ=0.0
  S D2 DISK R=${r2} NODE=2 PROP=0.5, 0.6 ACTIVE=BOTTOM TZ=${h}
END OF DATA
`);

    // Reference Hottel formula:
    // R1 = 1.0, R2 = 1.5, S = 1 + (1 + 2.25)/1 = 4.25
    // F12 = 0.5 * (4.25 - sqrt(4.25^2 - 4 * 2.25)) = 0.5 * (4.25 - sqrt(9.0625)) = 0.619795...
    const f12Ref = viewFactorCoaxialDisks(r1, r2, h);
    const f21Ref = viewFactorCoaxialDisks(r2, r1, h);

    // 1. Auto/Analytical solver
    const vfAuto = computeViewFactors(deck.surfaces, { method: "auto" });
    assert.ok(relErr(vfAuto.matrix[0]![1]!, f12Ref) < 1e-12, `Analytical F12 relErr too large`);
    assert.ok(relErr(vfAuto.matrix[1]![0]!, f21Ref) < 1e-12, `Analytical F21 relErr too large`);

    // Reciprocity: A1 * F12 = A2 * F21
    const a1 = vfAuto.areas[0]!;
    const a2 = vfAuto.areas[1]!;
    assert.ok(relErr(a1 * vfAuto.matrix[0]![1]!, a2 * vfAuto.matrix[1]![0]!) < 1e-12);
    assert.ok(vfAuto.maxReciprocityError < 1e-12);

    // Enclosure closure: sum_j F_ij + F_{i->space} = 1
    assert.ok(vfAuto.maxClosureError < 1e-12);
    assert.ok(Math.abs(vfAuto.matrix[0]![1]! + vfAuto.spaceViewFactors[0]! - 1) < 1e-12);
    assert.ok(Math.abs(vfAuto.matrix[1]![0]! + vfAuto.spaceViewFactors[1]! - 1) < 1e-12);

    // 2. Pure Monte Carlo ray-tracing parity against exact Hottel F12 & F21
    const vfMc = computeViewFactors(deck.surfaces, {
      method: "monte-carlo",
      raysPerSurface: 40000,
      seed: 12345,
      enforceReciprocity: true,
    });
    const mcRelErr12 = relErr(vfMc.matrix[0]![1]!, f12Ref);
    const mcRelErr21 = relErr(vfMc.matrix[1]![0]!, f21Ref);
    assert.ok(mcRelErr12 < 0.015, `MC Disk F12 relErr=${mcRelErr12} exceeded 1.5%`);
    assert.ok(mcRelErr21 < 0.015, `MC Disk F21 relErr=${mcRelErr21} exceeded 1.5%`);
    assert.ok(vfMc.maxReciprocityError < 1e-12);
    assert.ok(vfMc.maxClosureError < 1e-12);

    // 3. Gebhart absorption reciprocity: A1 * eps1 * B12 = A2 * eps2 * B21
    const geb = computeGebhartExchange(deck.surfaces, vfAuto);
    const lhs = a1 * 0.8 * geb.B[0]![1]!;
    const rhs = a2 * 0.6 * geb.B[1]![0]!;
    assert.ok(relErr(lhs, rhs) < 1e-12, `Gebhart reciprocity failed: ${lhs} vs ${rhs}`);
  });

  it("matches exact Hottel analytical view factor for aligned parallel rectangles", () => {
    // Two identical 2m x 1m rectangles separated by c = 1m
    const a = 2.0;
    const b = 1.0;
    const c = 1.0;
    const deck = parseTrasysDeck(`
HEADER SURFACE DATA
  S R1 RECTANGLE W=${a} H=${b} NODE=1 PROP=0.5, 0.9 ACTIVE=TOP TZ=0.0
  S R2 RECTANGLE W=${a} H=${b} NODE=2 PROP=0.5, 0.9 ACTIVE=BOTTOM TZ=${c}
END OF DATA
`);

    const fRef = viewFactorParallelRectangles(a, b, c);
    // Known Hottel reference for X=2, Y=1 is ~0.28588
    assert.ok(relErr(fRef, 0.28588) < 1e-3);

    const vfAuto = computeViewFactors(deck.surfaces, { method: "auto" });
    assert.ok(relErr(vfAuto.matrix[0]![1]!, fRef) < 1e-12);
    assert.ok(vfAuto.maxReciprocityError < 1e-12);
    assert.ok(vfAuto.maxClosureError < 1e-12);

    // Monte Carlo parity + RMSE check
    const vfMc = computeViewFactors(deck.surfaces, {
      method: "monte-carlo",
      raysPerSurface: 40000,
      seed: 99,
      enforceReciprocity: true,
    });
    const err = rmse([vfMc.matrix[0]![1]!, vfMc.matrix[1]![0]!], [fRef, fRef]);
    assert.ok(err < 0.008, `MC parallel rectangles RMSE=${err} exceeded 0.008`);
    assert.ok(relErr(vfMc.matrix[0]![1]!, fRef) < 0.025);
  });

  it("computes LEO sphere orbital solar + albedo + planet-IR equilibrium temperature within tight tolerance", () => {
    // Classic spacecraft thermal benchmark:
    // Isothermal sphere (R = 0.5 m) in 400 km Earth circular orbit at beta = 90 deg (full sun, zero albedo)
    // and beta = 0 deg (noon-midnight orbit with eclipse + albedo + Earth IR).
    const rSphere = 0.5;
    const alpha = 0.25;
    const eps = 0.85;
    const S = 1361.0;
    const qIr = 237.0;
    const altKm = 400.0;
    const Re = 6371.0;
    const fSp = 0.5 * (1 - Math.sqrt(1 - Math.pow(Re / (Re + altKm), 2)));

    // Case A: Full sun (beta = 90 deg -> eclipse = 0, cos(beta) = 0 -> albedo = 0)
    // Analytical: eps * sigma * (4 pi R^2) * T^4 = alpha * S * (pi R^2) + eps * qIr * F_sp * (4 pi R^2)
    // => T_eq = [ (alpha * S / 4 + eps * qIr * F_sp) / (eps * sigma) + T_space^4 ]^(1/4)
    const tEqFullSunRef = Math.pow(
      (alpha * S * 0.25 + eps * qIr * fSp) / (eps * STEFAN_BOLTZMANN) + Math.pow(2.725, 4),
      0.25,
    );

    const deckFullSun = parseTrasysDeck(`
HEADER OPTIONS DATA
  MODEL = LEO_SPHERE_FULLSUN
HEADER SURFACE DATA
  S SAT SPHERE R=${rSphere} NODE=100 PROP=${alpha}, ${eps} ACTIVE=TOP
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = ${altKm}
  BETA = 90.0
  SOLAR = ${S}
  ALBEDO = 0.30
  PLANETIR = ${qIr}
HEADER OPERATIONS DATA
  FFCAL
  RKCAL
  QCAL
END OF DATA
`);

    const solFullSun = solveTrasysThermal(deckFullSun);
    const tFullSun = solFullSun.temperaturesK["SAT"]!;
    assert.strictEqual(solFullSun.orbital.eclipseFraction, 0);
    assert.ok(relErr(tFullSun, tEqFullSunRef) < 1e-6, `Full-sun T_eq relErr=${relErr(tFullSun, tEqFullSunRef)}`);
    assert.ok(
      tFullSun > 220 && tFullSun < 260,
      `Expected physically realistic LEO cold-bias sphere temp (~235K), got ${tFullSun}`,
    );

    // Case B: Beta = 0 deg (noon-midnight LEO with ~36% eclipse, solar + albedo + Earth IR)
    const deckBeta0 = parseTrasysDeck(`
HEADER OPTIONS DATA
  MODEL = LEO_SPHERE_BETA0
HEADER SURFACE DATA
  S SAT SPHERE R=${rSphere} NODE=100 PROP=${alpha}, ${eps} ACTIVE=TOP
HEADER ORBIT DATA
  PLANET = EARTH
  ALTITUDE = ${altKm}
  BETA = 0.0
  SOLAR = ${S}
  ALBEDO = 0.30
  PLANETIR = ${qIr}
END OF DATA
`);
    const solBeta0 = solveTrasysThermal(deckBeta0);
    const tBeta0 = solBeta0.temperaturesK["SAT"]!;
    const feExpected = Math.acos(Math.sqrt(altKm * altKm + 2 * Re * altKm) / (Re + altKm)) / Math.PI;
    assert.ok(relErr(solBeta0.orbital.eclipseFraction, feExpected) < 1e-9);
    // Physically, orbit-averaged temperature with eclipse should be lower than full-sun
    assert.ok(tBeta0 < tFullSun && tBeta0 > 200, `Expected 200K < T_beta0 (${tBeta0}K) < T_fullSun (${tFullSun}K)`);

    // Verify energy balance RMSE across both cases
    const qEmitFullSun =
      eps * STEFAN_BOLTZMANN * 4 * Math.PI * rSphere * rSphere * (Math.pow(tFullSun, 4) - Math.pow(2.725, 4));
    const qEmitBeta0 =
      eps * STEFAN_BOLTZMANN * 4 * Math.PI * rSphere * rSphere * (Math.pow(tBeta0, 4) - Math.pow(2.725, 4));
    const balanceRmse = rmse(
      [qEmitFullSun, qEmitBeta0],
      [solFullSun.orbital.surfaces["SAT"]!.qTotalW, solBeta0.orbital.surfaces["SAT"]!.qTotalW],
    );
    assert.ok(balanceRmse < 1e-6, `Radiative balance RMSE=${balanceRmse} exceeded 1e-6 W`);
  });
});
