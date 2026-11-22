// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AutoSwitch,
  BDF,
  BVPProblem,
  Collocation,
  DDEProblem,
  EnsembleProblem,
  EnsembleSerial,
  EulerMaruyama,
  init,
  MethodOfSteps,
  ODEProblem,
  OutwardInterval,
  RadauIIA5,
  ReachabilityProblem,
  remake,
  Rodas4P,
  SDEProblem,
  solve,
  SRIW1,
  TMJets,
  TRBDF2,
  Tsit5,
  Vern7,
  ZonotopeReach,
  type TrajectorySolution,
  type VerificationCertificate,
} from "@modelscript/solve";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Side-effect imports register canonical @modelscript/runtime and @modelscript/simulate backends
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import { arenaToODEProblem, arenaToReachabilityProblem } from "../src/core/compile-arena-function.js";
import "../src/core/register-solve-backends.js";

describe("Unified @modelscript/solve end-to-end dispatch", () => {
  const decayProb = ODEProblem(
    (_t, u, p: { lambda: number } | undefined) => [-(p?.lambda ?? 1) * u[0]!],
    [1.0],
    [0, 1.0],
    { lambda: 2.0 },
  );

  const expected = Math.exp(-2.0);

  for (const [label, alg] of [
    ["default (Tsit5)", undefined],
    ["Tsit5", Tsit5()],
    ["Vern7", Vern7()],
    ["Rodas4P", Rodas4P()],
    ["TRBDF2", TRBDF2()],
    ["RadauIIA5", RadauIIA5()],
    ["BDF", BDF()],
  ] as const) {
    it(`solves exponential decay with ${label} and supports sol.eval(t)`, () => {
      const sol = solve<TrajectorySolution>(decayProb, alg, { reltol: 1e-6, abstol: 1e-8 });
      assert.equal(sol.retcode, "Success");
      const finalY = sol.states[sol.states.length - 1]![0]!;
      assert.ok(Math.abs(finalY - expected) < 1e-4, `${label}: got ${finalY}, expected ${expected}`);

      const midY = sol.eval(0.5)[0]!;
      const expectedMid = Math.exp(-1.0);
      assert.ok(
        Math.abs(midY - expectedMid) < 1e-4,
        `${label} cubic Hermite eval(0.5): got ${midY}, expected ${expectedMid}`,
      );
    });
  }

  it("supports remake(prob, { p }) for parameter sweeps across algorithms", () => {
    const fastDecay = remake(decayProb, { p: { lambda: 10.0 } });
    const sol = solve<TrajectorySolution>(fastDecay, TRBDF2(), { reltol: 1e-6, abstol: 1e-8 });
    assert.equal(sol.retcode, "Success");
    const finalY = sol.states[sol.states.length - 1]![0]!;
    assert.ok(Math.abs(finalY - Math.exp(-10.0)) < 1e-4);
  });

  it("dispatches ReachabilityProblem to TMJets and ZonotopeReach returning strict VerificationCertificates", () => {
    const reachProb = ReachabilityProblem({ f: (_t, u) => [-2.0 * u[0]!] }, [OutwardInterval.of(0.9, 1.1)], [0, 1.0], {
      properties: [{ stateIndex: 0, operator: "<=", limit: 1.5 }],
    });

    const tmCert = solve<VerificationCertificate>(reachProb, TMJets({ order: 3 }), { dt: 0.1 });
    assert.equal(tmCert.algorithm, "TMJets");
    // Strict rigor contract: unrounded floating-point TM must NOT report isCertifiedSafe: true
    assert.equal(tmCert.isCertifiedSafe, false);

    const zonoCert = solve<VerificationCertificate>(reachProb, ZonotopeReach({ maxGenerators: 20 }), { dt: 0.1 });
    assert.equal(zonoCert.algorithm, "ZonotopeReach");
    assert.equal(zonoCert.isCertifiedSafe, false);
  });

  it("switches from Tsit5 to Rodas4P on stiff dynamics via AutoSwitch()", () => {
    const stiffProb = ODEProblem((_t, u) => [-1000 * u[0]!], [1.0], [0, 1.0]);
    const sol = solve<TrajectorySolution>(stiffProb, AutoSwitch(Tsit5(), Rodas4P()), {
      reltol: 1e-5,
      abstol: 1e-8,
    });
    assert.equal(sol.retcode, "Success");
    const finalY = sol.states[sol.states.length - 1]![0]!;
    assert.ok(Math.abs(finalY) < 1e-4, `Expected stiff decay near 0, got ${finalY}`);
  });

  it("supports step-by-step init()/step()/interpolate() for Tsit5", () => {
    const integ = init(decayProb, Tsit5(), { dt: 0.25, reltol: 1e-6, abstol: 1e-8 });
    let steps = 0;
    while (integ.retcode !== "Success" && steps < 20) {
      integ.step();
      steps++;
    }
    assert.equal(integ.retcode, "Success");
    assert.ok(Math.abs(integ.u[0]! - expected) < 1e-4);
    integ.dispose();
  });

  it("unifies SDEProblem, DDEProblem, BVPProblem, and EnsembleProblem under solve()", () => {
    // SDE (Geometric Brownian Motion) with SRIW1 & EulerMaruyama
    const gbm = SDEProblem(
      (_t, u) => [0.5 * u[0]!],
      (_t, u) => [0.2 * u[0]!],
      [1.0],
      [0, 1.0],
      { seed: 42 },
    );
    const sdeSol1 = solve<TrajectorySolution>(gbm, SRIW1(), { reltol: 1e-3, abstol: 1e-4 });
    const sdeSol2 = solve<TrajectorySolution>(gbm, EulerMaruyama(), { dt: 0.01 });
    assert.equal(sdeSol1.retcode, "Success");
    assert.equal(sdeSol2.retcode, "Success");
    assert.ok(sdeSol1.states[sdeSol1.states.length - 1]![0]! > 0);

    // DDE (Delayed decay y'(t) = -y(t - 0.5))
    const dde = DDEProblem(
      (t, _u, hist) => [-hist(t - 0.5)[0]!],
      () => [1.0],
      [1.0],
      [0, 1.0],
      {
        constantDelays: [0.5],
      },
    );
    const ddeSol = solve<TrajectorySolution>(dde, MethodOfSteps(), { reltol: 1e-5, abstol: 1e-7 });
    assert.equal(ddeSol.retcode, "Success");

    // BVP (y'' = 0, y(0) = 0, y(1) = 1 => y(t) = t)
    const bvp = BVPProblem(
      (_t, u) => [u[1]!, 0],
      (ua, ub) => [ua[0]!, ub[0]! - 1],
      [0, 0.5],
      [0, 1.0],
    );
    const bvpSol = solve<TrajectorySolution>(bvp, Collocation({ numIntervals: 10 }), { abstol: 1e-6 });
    assert.equal(bvpSol.retcode, "Success");
    assert.ok(Math.abs(bvpSol.eval(0.5)[0]! - 0.5) < 1e-3);

    // Ensemble sweep via EnsembleProblem + remake
    const ens = EnsembleProblem(decayProb, 3, (p, i) => remake(p, { p: { lambda: i + 1 } }));
    const ensSols = solve<TrajectorySolution[]>(ens, EnsembleSerial(Tsit5()), { reltol: 1e-6, abstol: 1e-8 });
    assert.equal(ensSols.length, 3);
    assert.ok(Math.abs(ensSols[2]!.states[ensSols[2]!.states.length - 1]![0]! - Math.exp(-3.0)) < 1e-4);
  });

  it("compiles a DAEBuilder arena ONCE via compileArenaFunction() for both simulation and reachability", () => {
    const arena = new DAEBuilder();
    try {
      const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
      arena.setVarStartValue(xIdx, 1.0);
      const xName = arena.addNameExpr("x");
      const derX = arena.addDerExpr(xName);
      const rhs = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-2.0), xName);
      arena.addEquation(EqKind.Simple, derX, rhs);

      const odeProb = arenaToODEProblem(arena, { tSpan: [0, 1.0] });
      assert.equal(odeProb.fn.fInterval !== undefined, true, "compiled arena should expose outward-rounded fInterval");
      const simSol = solve<TrajectorySolution>(odeProb, Rodas4P(), { reltol: 1e-6, abstol: 1e-8 });
      assert.equal(simSol.retcode, "Success");
      assert.ok(Math.abs(simSol.states[simSol.states.length - 1]![0]! - Math.exp(-2.0)) < 1e-4);

      const reachProb = arenaToReachabilityProblem(arena, 0.1, {
        tSpan: [0, 1.0],
        properties: [{ stateIndex: 0, operator: "<=", limit: 1.5 }],
      });
      const cert = solve<VerificationCertificate>(reachProb, ZonotopeReach({ maxGenerators: 20 }), { dt: 0.1 });
      assert.equal(cert.algorithm, "ZonotopeReach");
      assert.equal(cert.isCertifiedSafe, false);
    } finally {
      arena.free();
    }
  });
});
