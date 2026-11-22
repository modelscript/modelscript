// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { certifyPsdInterval, SosBarrierSynthesizer } from "../src/analysis/wasm_sos_barrier.js";
import { Interval, TaylorModelFlowpipeSolver } from "../src/analysis/wasm_taylor_model.js";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/dae/wasm_dae.js";
import { NumericalInterval } from "../src/formal/abstract_interpretation/interval_domain.js";
import { DaeFlowpipeBridge } from "../src/formal/dae/dae_flowpipe_bridge.js";

describe("WS1: Rigorous Continuous Verification", () => {
  it("DaeFlowpipeBridge lowers DAEBuilder with validated interval hooks and proves safety", () => {
    // Semi-explicit index-1 DAE:
    //   der(x) = -z
    //   z - 2*x = 0   (so der(x) = -2*x, x(t) = x0 * exp(-2t))
    const dae = new DAEBuilder();
    const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous);
    const zIdx = dae.addVariable("z", VarType.Real, Variability.Continuous);

    const xRef = dae.addNameExpr("x");
    const zRef = dae.addNameExpr("z");
    const derX = dae.addDerExpr(xRef);
    const negZ = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), zRef);
    dae.addEquation(EqKind.Simple, derX, negZ);

    const twoX = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), xRef);
    dae.addEquation(EqKind.Simple, zRef, twoX);

    const initialBounds = new Map<number, NumericalInterval>([
      [xIdx, new NumericalInterval(0.95, 1.05)],
      [zIdx, new NumericalInterval(1.9, 2.1)],
    ]);

    const res = DaeFlowpipeBridge.solveFlowpipe(dae, {
      tSpan: [0, 0.5],
      dt: 0.05,
      initialBounds,
      requirements: [{ variable: "x", index: 0, operator: "<=", limitValue: 1.15 }],
    });

    assert.equal(res.verdict.kind, "proven", `Expected proven verdict, got: ${JSON.stringify(res.verdict)}`);
    assert.equal(res.isCertifiedSafe, true);
    assert.ok(res.steps.length >= 10);
    // True trajectory at t=0.5 for x0=1.0 is exp(-1) ≈ 0.36788
    const finalX = res.steps[res.steps.length - 1]!.xTubes[0]!;
    assert.ok(
      finalX.lo <= Math.exp(-1) && Math.exp(-1) <= finalX.hi,
      `Final tube [${finalX.lo}, ${finalX.hi}] must contain e^-1`,
    );
  });

  it("QR-preconditioned Taylor Model flowpipe rigorously encloses harmonic oscillator with tighter bounds", () => {
    // 2D harmonic oscillator: dx/dt = y, dy/dt = -x
    const dynamics = (_t: any, y: any[]) => [y[1], y[0].scale(-1)];
    const init = [new Interval(0.95, 1.05), new Interval(-0.05, 0.05)];

    const plain = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: init,
      nominalInitial: [1.0, 0.0],
      tSpan: [0, 2.0],
      dt: 0.1,
      order: 3,
      symbolicCarryOver: 4,
      useQrPreconditioning: false,
    });

    const qr = TaylorModelFlowpipeSolver.solve({
      dynamics,
      initialEnclosure: init,
      nominalInitial: [1.0, 0.0],
      tSpan: [0, 2.0],
      dt: 0.1,
      order: 3,
      symbolicCarryOver: 4,
      useQrPreconditioning: true,
    });

    assert.equal(qr.verdict.kind, "proven");
    const lastQr = qr.steps[qr.steps.length - 1]!.tubes;
    const lastPlain = plain.steps[plain.steps.length - 1]!.tubes;
    // Exact trajectory at t=2.0 from (1, 0) is (cos(2), -sin(2))
    assert.ok(lastQr[0]!.lo <= Math.cos(2) && Math.cos(2) <= lastQr[0]!.hi);
    assert.ok(lastQr[1]!.lo <= -Math.sin(2) && -Math.sin(2) <= lastQr[1]!.hi);
    // QR preconditioning should produce strictly tighter or equal enclosure width than plain re-boxing
    const qrArea = lastQr[0]!.width * lastQr[1]!.width;
    const plainArea = lastPlain[0]!.width * lastPlain[1]!.width;
    assert.ok(qrArea <= plainArea * 1.05, `Expected QR area (${qrArea}) <= plain area (${plainArea})`);
  });

  it("certifyPsdInterval and synthesizePolynomialCertified rigorously prove polynomial SOS barrier", () => {
    // Positive definite vs indefinite check
    assert.equal(
      certifyPsdInterval(
        [
          [2, 0.5],
          [0.5, 2],
        ],
        0.1,
      ).certified,
      true,
    );
    assert.equal(
      certifyPsdInterval(
        [
          [1, 2],
          [2, 1],
        ],
        0,
      ).certified,
      false,
    );

    // Nonlinear dissipative cubic system:
    //   dx1/dt = -2*x1 + 0.1*x2 - x1^3
    //   dx2/dt = -0.1*x1 - 2*x2 - x2^3
    const res = SosBarrierSynthesizer.synthesizePolynomialCertified(
      {
        numVars: 2,
        vectorField: [
          [
            { coeff: -2.0, exps: [1, 0] },
            { coeff: 0.1, exps: [0, 1] },
            { coeff: -1.0, exps: [3, 0] },
          ],
          [
            { coeff: -0.1, exps: [1, 0] },
            { coeff: -2.0, exps: [0, 1] },
            { coeff: -1.0, exps: [0, 3] },
          ],
        ],
      },
      { initialRadius: 0.5, unsafeRadius: 1.5 },
    );

    assert.equal(res.isCertifiedSafe, true, `Expected certified SOS barrier, got: ${res.summary}`);
    assert.equal(res.verdict.kind, "proven");
    if (res.verdict.kind === "proven") {
      assert.equal(res.verdict.rigor, "rigorous");
    }

    // Unstable system must NOT be certified
    const unstable = SosBarrierSynthesizer.synthesizePolynomialCertified(
      {
        numVars: 2,
        vectorField: [[{ coeff: 1.0, exps: [1, 0] }], [{ coeff: -1.0, exps: [0, 1] }]],
      },
      { initialRadius: 0.5, unsafeRadius: 1.5 },
    );
    assert.equal(unstable.isCertifiedSafe, false);
    assert.notEqual(unstable.verdict.kind, "proven");

    // Degree-4 Putinar SOS barrier certification
    const quartic = SosBarrierSynthesizer.synthesizePutinarQuarticCertified(
      {
        numVars: 2,
        vectorField: [
          [
            { coeff: -2.0, exps: [1, 0] },
            { coeff: -1.0, exps: [3, 0] },
          ],
          [
            { coeff: -2.0, exps: [0, 1] },
            { coeff: -1.0, exps: [0, 3] },
          ],
        ],
      },
      { initialRadius: 0.5, unsafeRadius: 1.5 },
    );
    assert.equal(quartic.isCertifiedSafe, true, quartic.summary);
    assert.equal(quartic.barrierDegree, 4);
    assert.equal(quartic.verdict.kind, "proven");
  });
});
