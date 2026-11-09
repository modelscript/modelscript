// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRealMatrixEigenvalues, continueEquilibriumPALC } from "../src/analysis/bifurcation-palc.js";

describe("Bifurcation Analysis & Pseudo-Arclength Continuation (PALC) Engine (Track 4)", () => {
  it("traverses an S-shaped bistable curve with two Saddle-Node (Fold) bifurcations and classifies branch stability", () => {
    // Dynamical system: dx/dt = -x^3 + 3x - p = 0
    // Fold points occur where dF/dx = -3x^2 + 3 = 0 => x = -1 (p = -2) and x = +1 (p = +2)
    // Stable for |x| > 1 (where -3x^2 + 3 < 0), unstable on the middle branch |x| < 1 (-3x^2 + 3 > 0)
    const diagram = continueEquilibriumPALC(
      {
        f: (x, p) => [-(x[0]! ** 3) + 3.0 * x[0]! - p],
        x0: [-2.0],
        p0: 2.0, // (-(-8) + 3(-2) - 2 = 8 - 6 - 2 = 0)
        pSpan: [-3.0, 3.0],
        jacX: (x) => [[-3.0 * x[0]! * x[0]! + 3.0]],
        jacP: () => [-1.0],
      },
      {
        ds: 0.1,
        maxDs: 0.15,
        maxSteps: 120,
        initialDirection: -1, // Start decreasing p from +2 toward fold at p = -2
      },
    );

    assert.equal(diagram.converged, true, "PALC should complete smoothly across both folds");
    const folds = diagram.bifurcations.filter((b) => b.type === "fold");
    assert.equal(folds.length, 2, `Expected 2 fold bifurcations, found ${folds.length}`);

    // First fold at (x = -1, p = -2)
    assert.ok(Math.abs(folds[0]!.x[0]! - -1.0) < 1e-3, `Expected first fold x ~ -1, got ${folds[0]!.x[0]}`);
    assert.ok(Math.abs(folds[0]!.p - -2.0) < 1e-3, `Expected first fold p ~ -2, got ${folds[0]!.p}`);

    // Second fold at (x = +1, p = +2)
    assert.ok(Math.abs(folds[1]!.x[0]! - 1.0) < 1e-3, `Expected second fold x ~ +1, got ${folds[1]!.x[0]}`);
    assert.ok(Math.abs(folds[1]!.p - 2.0) < 1e-3, `Expected second fold p ~ +2, got ${folds[1]!.p}`);

    // Verify lower branch (x < -1) is stable, middle branch (-1 < x < 1) is unstable, upper branch (x > 1) is stable
    const lowerPts = diagram.branch.filter((pt) => pt.x[0]! < -1.1);
    const midPts = diagram.branch.filter((pt) => pt.x[0]! > -0.8 && pt.x[0]! < 0.8);
    const upperPts = diagram.branch.filter((pt) => pt.x[0]! > 1.1);

    assert.ok(lowerPts.length > 0 && lowerPts.every((pt) => pt.stable === true));
    assert.ok(midPts.length > 0 && midPts.every((pt) => pt.stable === false && pt.nUnstable === 1));
    assert.ok(upperPts.length > 0 && upperPts.every((pt) => pt.stable === true));
  });

  it("detects and localizes the supercritical Hopf bifurcation in the Brusselator chemical oscillator", () => {
    // Brusselator:
    //   dx/dt = A - (B + 1)*x + x^2 * y = 0
    //   dy/dt = B*x - x^2 * y = 0
    // For A = 1, equilibrium is (x*, y*) = (1, B).
    // Jacobian at (1, B) has trace = B - 2 and det = 1, so supercritical Hopf occurs at B_crit = 2.0 with frequency omega_0 = 1.0!
    const A = 1.0;
    const diagram = continueEquilibriumPALC(
      {
        f: (x, B) => [A - (B + 1.0) * x[0]! + x[0]! * x[0]! * x[1]!, B * x[0]! - x[0]! * x[0]! * x[1]!],
        x0: [1.0, 1.2],
        p0: 1.2,
        pSpan: [1.2, 2.8],
      },
      {
        ds: 0.08,
        maxDs: 0.12,
        initialDirection: 1,
      },
    );

    assert.equal(diagram.converged, true);
    const hopfs = diagram.bifurcations.filter((b) => b.type === "hopf");
    assert.equal(hopfs.length, 1, `Expected 1 Hopf bifurcation, found ${hopfs.length}`);

    const hb = hopfs[0]!;
    assert.ok(Math.abs(hb.p - 2.0) < 1e-4, `Expected Hopf parameter B_crit = 2.0, got ${hb.p}`);
    assert.ok(Math.abs(hb.x[0]! - 1.0) < 1e-4 && Math.abs(hb.x[1]! - 2.0) < 1e-4);
    assert.ok(
      hb.hopfFrequency !== undefined && Math.abs(hb.hopfFrequency - 1.0) < 1e-3,
      `Expected Hopf frequency omega_0 = 1.0, got ${hb.hopfFrequency}`,
    );
  });

  it("computes real and complex conjugate eigenvalues for general N x N matrices via Hessenberg QR", () => {
    // 3x3 block matrix with eigenvalues -2.0 and 0.5 +- 1.5i:
    // Upper block: [[0.5, -1.5], [1.5, 0.5]], bottom right: -2.0
    const J = new Float64Array([0.5, -1.5, 0.0, 1.5, 0.5, 0.0, 0.0, 0.0, -2.0]);
    const eigs = computeRealMatrixEigenvalues(J, 3);
    assert.equal(eigs.length, 3);
    assert.ok(Math.abs(eigs[0]!.re - 0.5) < 1e-10);
    assert.ok(Math.abs(Math.abs(eigs[0]!.im) - 1.5) < 1e-10);
    assert.ok(Math.abs(eigs[2]!.re - -2.0) < 1e-10);
    assert.ok(Math.abs(eigs[2]!.im) < 1e-10);
  });
});
