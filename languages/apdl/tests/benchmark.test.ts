// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandApdlMacros, solveApdlModal, solveApdlStatic } from "../src/solver/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(Math.abs(expected), 1e-15);
  return Math.abs(actual - expected) / denom;
}

function rmse(actual: number[], expected: number[]): number {
  assert.strictEqual(actual.length, expected.length);
  if (actual.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const diff = actual[i]! - expected[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / actual.length);
}

describe("APDL Analytical Parity & FEA Solver Benchmarks", () => {
  it("matches exact Euler-Bernoulli cantilever BEAM188 tip deflection delta = P*L^3/(3*E*I) and slope theta = P*L^2/(2*E*I)", () => {
    const E = 210e9;
    const b = 0.05;
    const h = 0.1;
    const I = (b * h ** 3) / 12;
    const L = 2.0;
    const P = 1000.0;
    const nElem = 8;

    const src = `
/TITLE, Cantilever BEAM188 Benchmark
/UNITS, SI
/PREP7
E_MOD = ${E}
B_WID = ${b}
H_DEP = ${h}
L_LEN = ${L}
P_LOAD = ${P}
ET, 1, BEAM188
MP, EX, 1, E_MOD
MP, PRXY, 1, 0.3
MP, DENS, 1, 7850
SECTYPE, 1, BEAM, RECT
SECDATA, B_WID, H_DEP
K, 1, 0, 0, 0
K, 2, L_LEN, 0, 0
L, 1, 2
ESIZE, , ${nElem}
LMESH, ALL
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, ${nElem + 1}, FY, -P_LOAD
SOLVE
FINISH
`;
    const model = expandApdlMacros(src);
    const sol = solveApdlStatic(model);
    assert.strictEqual(sol.converged, true);

    const tip = sol.displacements.get(nElem + 1);
    assert.ok(tip, "Tip node displacement must exist");

    const expectedTipDeflection = -(P * L ** 3) / (3 * E * I);
    const expectedTipSlope = -(P * L ** 2) / (2 * E * I);

    const deflRelErr = relErr(tip.uy, expectedTipDeflection);
    const slopeRelErr = relErr(tip.rotz, expectedTipSlope);

    assert.ok(deflRelErr < 1e-10, `Tip deflection relErr=${deflRelErr} exceeded 1e-10`);
    assert.ok(slopeRelErr < 1e-10, `Tip slope relErr=${slopeRelErr} exceeded 1e-10`);

    // Check full deflection curve w(x) = -P*x^2*(3L - x)/(6*E*I) across all nodes
    const actualCurve: number[] = [];
    const expectedCurve: number[] = [];
    for (const [nid, node] of model.nodes.entries()) {
      const disp = sol.displacements.get(nid)!;
      const x = node.x;
      actualCurve.push(disp.uy);
      expectedCurve.push(-(P * x * x * (3 * L - x)) / (6 * E * I));
    }
    const curveRmse = rmse(actualCurve, expectedCurve);
    assert.ok(curveRmse < 1e-12, `Deflection curve RMSE=${curveRmse} exceeded 1e-12`);

    // Check root reaction force Fy = +P and reaction moment Mz = +P*L
    const rootReact = sol.reactions.get(1)!;
    assert.ok(relErr(rootReact.fy, P) < 1e-10, `Root FY reaction relErr too large: ${rootReact.fy}`);
    assert.ok(relErr(rootReact.mz, P * L) < 1e-10, `Root MZ reaction relErr too large: ${rootReact.mz}`);
  });

  it("matches exact 2-bar LINK180 symmetric truss axial force and vertical displacement", () => {
    const E = 200e9;
    const A = 2e-4;
    const P = 10_000;
    const halfSpan = 1.0;
    const height = 1.0;
    const Lbar = Math.hypot(halfSpan, height);
    const sinAlpha = height / Lbar;

    const src = `
/TITLE, 2-Bar LINK180 Truss Benchmark
/PREP7
ET, 1, LINK180
MP, EX, 1, ${E}
MP, PRXY, 1, 0.3
R, 1, ${A}
N, 1, 0, 0, 0
N, 2, ${2 * halfSpan}, 0, 0
N, 3, ${halfSpan}, ${height}, 0
E, 1, 3
E, 2, 3
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
D, 2, ALL, 0
F, 3, FY, -${P}
SOLVE
FINISH
`;
    const sol = solveApdlStatic(src);
    const apex = sol.displacements.get(3)!;

    // Exact analytical vertical displacement: u_y = -P * L / (2 * E * A * sin^2(alpha))
    const expectedUy = -(P * Lbar) / (2 * E * A * sinAlpha * sinAlpha);
    const expectedAxialForce = -P / (2 * sinAlpha); // Compression in both bars

    assert.ok(Math.abs(apex.ux) < 1e-15, `Symmetric truss ux should be 0, got ${apex.ux}`);
    assert.ok(relErr(apex.uy, expectedUy) < 1e-12, `Truss uy relErr=${relErr(apex.uy, expectedUy)}`);

    const e1 = sol.elementResults.get(1)!;
    const e2 = sol.elementResults.get(2)!;
    assert.ok(relErr(e1.axialForce, expectedAxialForce) < 1e-12);
    assert.ok(relErr(e2.axialForce, expectedAxialForce) < 1e-12);
  });

  it("expands a *DO parametric mesh loop with *IF boundary conditions and matches analytical beam parity", () => {
    const E = 70e9;
    const b = 0.04;
    const h = 0.08;
    const I = (b * h ** 3) / 12;
    const L = 1.5;
    const P = 500;
    const nElem = 10;

    const src = `
/TITLE, Parametric *DO Loop Cantilever
/PREP7
NELEM = ${nElem}
L = ${L}
DX = L / NELEM
P = ${P}
ET, 1, BEAM188
MP, EX, 1, ${E}
MP, PRXY, 1, 0.33
SECTYPE, 1, BEAM, RECT
SECDATA, ${b}, ${h}
*DO, I, 1, NELEM + 1, 1
  N, I, (I - 1) * DX, 0, 0
*ENDDO
*DO, I, 1, NELEM, 1
  E, I, I + 1
*ENDDO
FINISH
/SOLU
ANTYPE, STATIC
*DO, I, 1, NELEM + 1, 1
  *IF, I, EQ, 1, THEN
    D, I, ALL, 0
  *ELSEIF, I, EQ, NELEM + 1, THEN
    F, I, FY, -P
  *ENDIF
*ENDDO
SOLVE
FINISH
`;
    const model = expandApdlMacros(src);
    assert.strictEqual(model.nodes.size, nElem + 1);
    assert.strictEqual(model.elements.size, nElem);

    const sol = solveApdlStatic(model);
    const actualU: number[] = [];
    const expectedU: number[] = [];
    for (let i = 1; i <= nElem + 1; i++) {
      const x = ((i - 1) * L) / nElem;
      actualU.push(sol.displacements.get(i)!.uy);
      expectedU.push(-(P * x * x * (3 * L - x)) / (6 * E * I));
    }

    const tipRelErr = relErr(actualU[nElem]!, expectedU[nElem]!);
    const loopRmse = rmse(actualU, expectedU);

    assert.ok(tipRelErr < 1e-10, `*DO cantilever tip relErr=${tipRelErr}`);
    assert.ok(loopRmse < 1e-12, `*DO cantilever RMSE=${loopRmse}`);
  });

  it("matches first cantilever BEAM188 bending natural frequency f1 = (1.8751^2 / (2*pi*L^2)) * sqrt(E*I/(rho*A))", () => {
    const E = 210e9;
    const rho = 7850;
    const b = 0.04;
    const h = 0.02; // h < b so bending in X-Y plane (Izz = b*h^3/12) is the lowest mode!
    const A = b * h;
    const Izz = (b * h ** 3) / 12;
    const L = 1.0;

    const src = `
/TITLE, Cantilever Modal Benchmark
/PREP7
ET, 1, BEAM188
MP, EX, 1, ${E}
MP, PRXY, 1, 0.3
MP, DENS, 1, ${rho}
SECTYPE, 1, BEAM, RECT
SECDATA, ${b}, ${h}
K, 1, 0, 0, 0
K, 2, ${L}, 0, 0
L, 1, 2
ESIZE, , 6
LMESH, ALL
FINISH
/SOLU
ANTYPE, MODAL
MODOPT, LANB, 4
D, 1, ALL, 0
SOLVE
FINISH
`;
    const modal = solveApdlModal(src, 4);
    assert.strictEqual(modal.converged, true);
    assert.ok(modal.modes.length >= 2);

    const beta1 = 1.875104068711961;
    const expectedF1 = ((beta1 * beta1) / (2 * Math.PI * L * L)) * Math.sqrt((E * Izz) / (rho * A));
    const f1Err = relErr(modal.modes[0]!.frequencyHz, expectedF1);
    assert.ok(
      f1Err < 1e-3,
      `First modal frequency relErr=${f1Err} (got ${modal.modes[0]!.frequencyHz} vs ${expectedF1})`,
    );
  });
});
