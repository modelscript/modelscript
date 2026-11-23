// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bondAngleDeg,
  bondDistance,
  cartesianToZMatrix,
  computeMomentsOfInertia,
  dihedralAngleDeg,
  jobToCartesian,
  parseGaussianInput,
} from "../src/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function rmse(actual: number[], expected: number[]): number {
  assert.equal(actual.length, expected.length);
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i]! - expected[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("@modelscript/gaussian — NeRF Kinematics & Molecular Physics Benchmark Suite", () => {
  it("Benchmark 1: Water (H2O) Z-matrix -> Cartesian exact NeRF parity (r=0.9572 Å, θ=104.52°)", () => {
    const gjf = `#p B3LYP/6-31G(d) opt

Water Experimental Equilibrium Geometry (Herzberg / NIST)

0 1
O
H 1 rOH
H 1 rOH 2 aHOH
Variables:
rOH = 0.9572
aHOH = 104.52
`;
    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    const atoms = jobToCartesian(doc.jobs[0]!);
    assert.equal(atoms.length, 3);

    const [o, h1, h2] = atoms;
    const r1 = bondDistance(o!, h1!);
    const r2 = bondDistance(o!, h2!);
    const theta = bondAngleDeg(h1!, o!, h2!);
    const rHH = bondDistance(h1!, h2!);
    const expectedHH = 2.0 * 0.9572 * Math.sin((104.52 * Math.PI) / 180.0 / 2.0);

    assert.ok(relErr(r1, 0.9572) < 1e-12, `r(O-H1) relErr=${relErr(r1, 0.9572)}`);
    assert.ok(relErr(r2, 0.9572) < 1e-12, `r(O-H2) relErr=${relErr(r2, 0.9572)}`);
    assert.ok(relErr(theta, 104.52) < 1e-12, `angle(H-O-H) relErr=${relErr(theta, 104.52)}`);
    assert.ok(relErr(rHH, expectedHH) < 1e-12, `r(H-H) relErr=${relErr(rHH, expectedHH)}`);

    const geomRmse = rmse([r1, r2, theta, rHH], [0.9572, 0.9572, 104.52, expectedHH]);
    assert.ok(geomRmse < 1e-12, `Water NeRF RMSE=${geomRmse}`);

    // Planar asymmetric top: I_A + I_B = I_C (exact planar inertia theorem)
    const inertia = computeMomentsOfInertia(atoms);
    assert.equal(inertia.rotorType, "asymmetric_top");
    const [ia, ib, ic] = inertia.principalMoments;
    assert.ok(relErr(ia + ib, ic) < 1e-12, `Planar inertia theorem I_A + I_B = I_C violated: ${ia}+${ib} != ${ic}`);
  });

  it("Benchmark 2: Methane (CH4) tetrahedral 109.4712° symmetry & equal principal moments I_A = I_B = I_C", () => {
    const tetAngle = Math.acos(-1.0 / 3.0) * (180.0 / Math.PI); // 109.47122063449069°
    const rCH = 1.089;
    const gjf = `#p CCSD(T)/cc-pVTZ sp

Methane Td Symmetry

0 1
C
H 1 rCH
H 1 rCH 2 aHCH
H 1 rCH 2 aHCH 3 120.0
H 1 rCH 2 aHCH 3 -120.0
Variables:
rCH = ${rCH}
aHCH = ${tetAngle.toFixed(12)}
`;
    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    const atoms = jobToCartesian(doc.jobs[0]!);
    assert.equal(atoms.length, 5);

    const [c, h1, h2, h3, h4] = atoms;
    const hydrogens = [h1!, h2!, h3!, h4!];

    // All 4 C-H bond lengths must equal rCH
    const bondLengths = hydrogens.map((h) => bondDistance(c!, h));
    const bondRmse = rmse(bondLengths, [rCH, rCH, rCH, rCH]);
    assert.ok(bondRmse < 1e-11, `Methane C-H bond RMSE=${bondRmse}`);

    // All 6 H-C-H angles must equal tetrahedral 109.471220634°
    const angles: number[] = [];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        angles.push(bondAngleDeg(hydrogens[i]!, c!, hydrogens[j]!));
      }
    }
    const angleRmse = rmse(angles, Array<number>(6).fill(tetAngle));
    assert.ok(angleRmse < 1e-9, `Methane tetrahedral angle RMSE=${angleRmse}`);
    for (const a of angles) {
      assert.ok(relErr(a, 109.4712) < 1e-5, `Expected ~109.4712°, got ${a}`);
    }

    // Spherical top: I_A = I_B = I_C = (8/3) * m_H * r_CH^2
    const inertia = computeMomentsOfInertia(atoms);
    assert.equal(inertia.rotorType, "spherical_top");
    const [ia, ib, ic] = inertia.principalMoments;
    const analyticalI = (8.0 / 3.0) * h1!.mass * rCH * rCH;

    assert.ok(relErr(ia, analyticalI) < 1e-10, `I_A relErr=${relErr(ia, analyticalI)}`);
    assert.ok(relErr(ib, analyticalI) < 1e-10, `I_B relErr=${relErr(ib, analyticalI)}`);
    assert.ok(relErr(ic, analyticalI) < 1e-10, `I_C relErr=${relErr(ic, analyticalI)}`);
    assert.ok(relErr(ia, ic) < 1e-10, `Expected I_A == I_B == I_C, got [${ia}, ${ib}, ${ic}]`);
  });

  it("Benchmark 3: Hydrogen Peroxide (H2O2) dihedral parity & Cartesian <-> Z-matrix round-trip", () => {
    const rOO = 1.452;
    const rOH = 0.965;
    const aHOO = 100.0;
    const dHOOH = 111.5;

    const gjf = `#p MP2/cc-pVTZ opt

Hydrogen Peroxide Skew Conformation

0 1
H
O 1 rOH
O 2 rOO 1 aHOO
H 3 rOH 2 aHOO 1 dHOOH
Variables:
rOH = ${rOH}
rOO = ${rOO}
aHOO = ${aHOO}
dHOOH = ${dHOOH}
`;
    const doc = parseGaussianInput(gjf);
    assert.equal(doc.parseErrors.length, 0);
    const atoms = jobToCartesian(doc.jobs[0]!);
    assert.equal(atoms.length, 4);

    const [h1, o2, o3, h4] = atoms;
    const actualR1 = bondDistance(h1!, o2!);
    const actualROO = bondDistance(o2!, o3!);
    const actualR4 = bondDistance(o3!, h4!);
    const actualA1 = bondAngleDeg(h1!, o2!, o3!);
    const actualA2 = bondAngleDeg(o2!, o3!, h4!);
    const actualDihedral = dihedralAngleDeg(h1!, o2!, o3!, h4!);

    assert.ok(relErr(actualR1, rOH) < 1e-12);
    assert.ok(relErr(actualROO, rOO) < 1e-12);
    assert.ok(relErr(actualR4, rOH) < 1e-12);
    assert.ok(relErr(actualA1, aHOO) < 1e-12);
    assert.ok(relErr(actualA2, aHOO) < 1e-12);
    assert.ok(relErr(actualDihedral, dHOOH) < 1e-12, `Expected dihedral ${dHOOH}°, got ${actualDihedral}°`);

    const h2o2Rmse = rmse(
      [actualR1, actualROO, actualR4, actualA1, actualA2, actualDihedral],
      [rOH, rOO, rOH, aHOO, aHOO, dHOOH],
    );
    assert.ok(h2o2Rmse < 1e-11, `H2O2 NeRF RMSE=${h2o2Rmse}`);

    // Inverse Cartesian -> Z-Matrix round-trip
    const zmat = cartesianToZMatrix(atoms);
    assert.equal(zmat.length, 4);
    assert.ok(relErr(zmat[1]!.bondLength!, rOH) < 1e-12);
    assert.ok(relErr(zmat[2]!.bondLength!, rOO) < 1e-12);
    assert.ok(relErr(zmat[2]!.bondAngle!, aHOO) < 1e-12);
    assert.ok(relErr(zmat[3]!.bondLength!, rOH) < 1e-12);
    assert.ok(relErr(zmat[3]!.bondAngle!, aHOO) < 1e-12);
    assert.ok(relErr(zmat[3]!.dihedralAngle!, dHOOH) < 1e-12);
  });
});
