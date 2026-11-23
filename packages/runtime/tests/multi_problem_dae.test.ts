// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BinOp,
  BvpMethod,
  Causality,
  ConstraintKind,
  DAEBuilder,
  DaeObjectiveSense,
  FLAG_DELAY_CONSTANT,
  FLAG_VAR_BINARY,
  JumpAffectMode,
  JumpRateKind,
  PROBLEM_BVP,
  PROBLEM_DDE,
  PROBLEM_HYBRID,
  PROBLEM_JUMP,
  PROBLEM_OPTIMIZATION,
  PROBLEM_REACHABILITY,
  PROBLEM_SDE,
  PROBLEM_UNCERTAIN,
  SdeCalculus,
  SdeNoiseType,
  UncertaintyDistKind,
  Variability,
  VarType,
} from "../src/index.js";

describe("Multi-Problem DAEBuilder & WASM Kernels", () => {
  it("preserves zero problemFlags on pure ODE/DAE and supports snapshot/rollback + dae_clone", () => {
    const dae = new DAEBuilder(undefined, "PureODE");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    assert.equal(dae.problemFlags, 0);

    dae.snapshot();
    const objExpr = dae.addBinaryExpr(BinOp.Mul, dae.addName(x), dae.addName(x));
    dae.optimization.addObjective(objExpr, -1, DaeObjectiveSense.Minimize);
    assert.equal(dae.hasProblemFlag(PROBLEM_OPTIMIZATION), true);
    assert.equal(dae.optimization.objectiveCount, 1);

    // Rollback restores problemFlags and side-table counts
    dae.rollback();
    assert.equal(dae.problemFlags, 0);
    assert.equal(dae.optimization.objectiveCount, 0);

    // Re-add and verify WASM dae_clone preserves all side-tables
    const x2 = dae.addBinaryExpr(BinOp.Mul, dae.addName(x), dae.addName(x));
    dae.optimization.addObjective(x2, -1, DaeObjectiveSense.Maximize);
    dae.optimization.addConstraint(dae.addName(x), 0.0, 10.0, ConstraintKind.Algebraic);
    const copy = dae.clone();
    assert.equal(copy.hasProblemFlag(PROBLEM_OPTIMIZATION), true);
    assert.equal(copy.optimization.objectiveCount, 1);
    assert.equal(copy.optimization.constraintCount, 1);
    assert.equal(copy.optimization.getObjectives()[0]!.sense, DaeObjectiveSense.Maximize);
    assert.equal(copy.optimization.getConstraints()[0]!.ub, 10.0);
  });

  it("1. Optimization: evaluates objectives, constraints, max violation, and exact WASM AD gradients/Jacobians", () => {
    const dae = new DAEBuilder(undefined, "OptNLP");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
    const y = dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 3.0);
    const z = dae.addVariable("z", VarType.Integer, Variability.Discrete, Causality.Local, 1.0, FLAG_VAR_BINARY);
    assert.ok((dae.getVarFlags(z) & FLAG_VAR_BINARY) !== 0);

    // Objective: minimize f(x, y) = x^2 + 3*y
    const xSq = dae.addBinaryExpr(BinOp.Mul, dae.addName(x), dae.addName(x));
    const threeY = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(3.0), dae.addName(y));
    const objExpr = dae.addBinaryExpr(BinOp.Add, xSq, threeY);
    dae.optimization.addObjective(objExpr, -1, DaeObjectiveSense.Minimize);

    // Constraint 0: x + y <= 4.0 (lb = -inf, ub = 4.0)
    const g0 = dae.addBinaryExpr(BinOp.Add, dae.addName(x), dae.addName(y));
    dae.optimization.addInequalityConstraint(g0, 4.0);

    // Constraint 1: x * y == 6.0
    const g1 = dae.addBinaryExpr(BinOp.Mul, dae.addName(x), dae.addName(y));
    dae.optimization.addEqualityConstraint(g1, 6.0);

    // Cone constraint (SOC)
    dae.optimization.addConeConstraint(ConstraintKind.SOC, [dae.addName(x), dae.addName(y)], 2);
    assert.equal(dae.optimization.coneCount, 1);

    const vals = [2.0, 3.0, 1.0];
    // f(2, 3) = 4 + 9 = 13
    const objs = dae.optimization.evalObjectives(vals);
    assert.ok(Math.abs(objs[0]! - 13.0) < 1e-12);

    // g0(2, 3) = 5 (violates <= 4 by 1.0), g1(2, 3) = 6 (violates == 6 by 0.0)
    const cons = dae.optimization.evalConstraints(vals);
    assert.ok(Math.abs(cons[0]! - 5.0) < 1e-12);
    assert.ok(Math.abs(cons[1]! - 6.0) < 1e-12);
    assert.ok(Math.abs(dae.optimization.maxConstraintViolation(vals) - 1.0) < 1e-12);

    // Exact WASM AD gradient: df/dx = 2*x = 4, df/dy = 3
    const { value, gradient } = dae.optimization.evalObjectiveGradient(0, vals, [x, y]);
    assert.ok(Math.abs(value - 13.0) < 1e-12);
    assert.ok(Math.abs(gradient[0]! - 4.0) < 1e-12);
    assert.ok(Math.abs(gradient[1]! - 3.0) < 1e-12);

    // Exact WASM AD Jacobian: [[1, 1], [y, x]] = [[1, 1], [3, 2]]
    const jac = dae.optimization.evalConstraintJacobian(vals, [x, y]);
    assert.ok(Math.abs(jac[0]![0]! - 1.0) < 1e-12);
    assert.ok(Math.abs(jac[0]![1]! - 1.0) < 1e-12);
    assert.ok(Math.abs(jac[1]![0]! - 3.0) < 1e-12);
    assert.ok(Math.abs(jac[1]![1]! - 2.0) < 1e-12);
  });

  it("2. SDE: runs zero-GC WASM Euler-Maruyama and Milstein (with AD dg/dy) for GBM", () => {
    // Geometric Brownian Motion: dS = mu*S*dt + sigma*S*dW, S(0) = 1.0
    const dae = new DAEBuilder(undefined, "GBM");
    const S = dae.addVariable("S", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const mu = 0.05;
    const sigma = 0.2;
    const driftExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(mu), dae.addName(S));
    const diffExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(sigma), dae.addName(S));

    dae.stochastic.setConfig({
      noiseType: SdeNoiseType.Diagonal,
      calculus: SdeCalculus.Ito,
      brownianDim: 1,
      seed: 12345,
      ensemblePaths: 100,
    });
    dae.stochastic.addDiffusion(S, diffExpr, 0);
    assert.equal(dae.hasProblemFlag(PROBLEM_SDE), true);

    const em = dae.stochastic.runEulerMaruyama([S], [driftExpr], 0.0, 1.0, 200, 12345);
    assert.equal(em.times.length, 201);
    assert.equal(em.states[0]![0], 1.0);
    assert.ok(Number.isFinite(em.states[200]![0]!) && em.states[200]![0]! > 0);

    const mil = dae.stochastic.runMilstein([S], [driftExpr], 0.0, 1.0, 200, 12345);
    assert.equal(mil.times.length, 201);
    assert.ok(Number.isFinite(mil.states[200]![0]!) && mil.states[200]![0]! > 0);
    // Milstein and Euler-Maruyama on the same seed should be close but differ due to the 0.5*g*g'*(dW^2-dt) term
    assert.ok(Math.abs(mil.states[200]![0]! - em.states[200]![0]!) > 1e-6);
  });

  it("3. BVP: evaluates coupled two-point boundary residuals in WASM", () => {
    const dae = new DAEBuilder(undefined, "TwoPointBVP");
    const y0Var = dae.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const y1Var = dae.addVariable("dy", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    dae.bvp.setConfig({ method: BvpMethod.Collocation, intervals: 25 });
    dae.bvp.addBoundaryPoint(0.0);
    dae.bvp.addBoundaryPoint(1.0);

    // BC 0: y(t0) = 1.0
    dae.bvp.addBoundaryEquation(dae.bvp.atStart(y0Var), dae.addRealLiteral(1.0));
    // BC 1: y(t0) + y(tf) = 3.0
    const coupled = dae.addBinaryExpr(BinOp.Add, dae.bvp.atStart(y0Var), dae.bvp.atEnd(y0Var));
    dae.bvp.addBoundaryEquation(coupled, dae.addRealLiteral(3.0));

    assert.equal(dae.hasProblemFlag(PROBLEM_BVP), true);
    assert.deepEqual(dae.bvp.getBoundaryPoints(), [0.0, 1.0]);

    // At ya = [1.0, 0.0], yb = [2.5, 0.0]: res0 = 0.0, res1 = (1.0 + 2.5) - 3.0 = 0.5
    const res = dae.bvp.evalBoundaryResiduals([1.0, 0.0], [2.5, 0.0]);
    assert.equal(res.length, 2);
    assert.ok(Math.abs(res[0]!) < 1e-12);
    assert.ok(Math.abs(res[1]! - 0.5) < 1e-12);
  });

  it("4. DDE: registers delay channels and evaluates tau & history in WASM", () => {
    const dae = new DAEBuilder(undefined, "DelayModel");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.5);
    const tau = dae.addRealLiteral(0.5);
    const hist = dae.addRealLiteral(1.5);

    const { channelIdx } = dae.delays.addDelayExpr(dae.addName(x), tau, hist, -1, FLAG_DELAY_CONSTANT);
    assert.equal(dae.hasProblemFlag(PROBLEM_DDE), true);
    assert.equal(dae.delays.count, 1);
    assert.ok(Math.abs(dae.delays.evalTau(channelIdx, [2.0]) - 0.5) < 1e-12);
    assert.ok(Math.abs(dae.delays.evalHistory(channelIdx, [2.0]) - 1.5) < 1e-12);
  });

  it("5. Jump/SSA: runs zero-GC WASM Gillespie Direct Method for birth-death process", () => {
    const dae = new DAEBuilder(undefined, "BirthDeath");
    const X = dae.addVariable("X", VarType.Real, Variability.Discrete, Causality.Local, 10.0);

    // Birth: rate = 2.0, X -> X + 1
    dae.jumps.addJump(
      dae.addRealLiteral(2.0),
      [{ targetVarId: X, deltaExprId: dae.addRealLiteral(1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.ConstantRate,
    );
    // Death: rate = 0.2 * X, X -> X - 1
    const deathRate = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.2), dae.addName(X));
    dae.jumps.addJump(
      deathRate,
      [{ targetVarId: X, deltaExprId: dae.addRealLiteral(-1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.MassAction,
    );

    assert.equal(dae.hasProblemFlag(PROBLEM_JUMP), true);
    const { propensities, total } = dae.jumps.evalPropensities([10.0]);
    assert.ok(Math.abs(propensities[0]! - 2.0) < 1e-12);
    assert.ok(Math.abs(propensities[1]! - 2.0) < 1e-12);
    assert.ok(Math.abs(total - 4.0) < 1e-12);

    const traj = dae.jumps.runGillespie([X], 0.0, 5.0, 500, 99);
    assert.ok(traj.times.length > 1);
    assert.equal(traj.states[0]![0], 10.0);
    assert.equal(traj.jumpIds[0], -1);
    for (let k = 1; k < traj.times.length; k++) {
      assert.ok(traj.times[k]! >= traj.times[k - 1]!);
      assert.ok(traj.jumpIds[k] === 0 || traj.jumpIds[k] === 1);
    }
  });

  it("6. Uncertainty, STL & Hybrid State Invariants: evaluates robustness and invariant margins in WASM", () => {
    const dae = new DAEBuilder(undefined, "SafeSystem");
    const x = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    dae.uncertainty.setInterval(x, -0.5, 0.5);
    dae.uncertainty.setDistribution(x, UncertaintyDistKind.Normal, 0.0, 0.1);
    assert.equal(dae.hasProblemFlag(PROBLEM_UNCERTAIN), true);
    assert.equal(dae.uncertainty.uncertaintyCount, 2);

    // Safety spec: Always_[0, 2] (5.0 - x >= 0) => robustness = min_{t in [0,2]} (5 - x(t))
    const marginExpr = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(5.0), dae.addName(x));
    const atomic = dae.uncertainty.addStlAtomic(marginExpr);
    const alwaysSafe = dae.uncertainty.addStlAlways(atomic, 0.0, 2.0);
    assert.equal(dae.hasProblemFlag(PROBLEM_REACHABILITY), true);

    const times = [0.0, 0.5, 1.0, 1.5, 2.0];
    const safeTraj = [[1.0], [2.0], [3.5], [3.0], [2.5]];
    const robSafe = dae.uncertainty.evalTrajectoryRobustness(alwaysSafe, times, safeTraj);
    assert.ok(Math.abs(robSafe - 1.5) < 1e-12); // min(4, 3, 1.5, 2, 2.5) = 1.5

    const unsafeTraj = [[1.0], [2.0], [6.2], [3.0], [2.5]];
    const robUnsafe = dae.uncertainty.evalTrajectoryRobustness(alwaysSafe, times, unsafeTraj);
    assert.ok(Math.abs(robUnsafe - -1.2) < 1e-12);

    // State invariant: in state 0, x in [-2.0, 4.0]
    dae.uncertainty.addStateInvariant(0, x, -2.0, 4.0);
    assert.equal(dae.hasProblemFlag(PROBLEM_HYBRID), true);
    assert.ok(Math.abs(dae.uncertainty.checkStateInvariantMargin(0, [3.0]) - 1.0) < 1e-12);
    assert.ok(Math.abs(dae.uncertainty.checkStateInvariantMargin(0, [4.5]) - -0.5) < 1e-12);
  });

  it("7. Extended WASM kernels: SDE ensemble, Jump Tau-Leaping, uncertainty interval eval, and side-table fold", () => {
    // A. SDE Ensemble (GBM: E[S(1)] = exp(0.05) ≈ 1.0513)
    const sde = new DAEBuilder(undefined, "GbmEns");
    const S = sde.addVariable("S", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const drift = sde.addBinaryExpr(BinOp.Mul, sde.addRealLiteral(0.05), sde.addName(S));
    const diff = sde.addBinaryExpr(BinOp.Mul, sde.addRealLiteral(0.1), sde.addName(S));
    sde.stochastic.addDiffusion(S, diff, 0);
    const ens = sde.stochastic.runEnsemble([S], [drift], 0.0, 1.0, 50, 128, { seed: 42, useMilstein: true });
    assert.equal(ens.times.length, 51);
    const meanEnd = ens.mean[50]![0]!;
    const varEnd = ens.variance[50]![0]!;
    assert.ok(meanEnd > 0.95 && meanEnd < 1.15, `Unexpected GBM ensemble mean: ${meanEnd}`);
    assert.ok(varEnd > 0.001 && varEnd < 0.05, `Unexpected GBM ensemble variance: ${varEnd}`);

    // B. Jump Tau-Leaping
    const jmp = new DAEBuilder(undefined, "TauLeap");
    const X = jmp.addVariable("X", VarType.Real, Variability.Discrete, Causality.Local, 50.0);
    jmp.jumps.addJump(
      jmp.addRealLiteral(10.0),
      [{ targetVarId: X, deltaExprId: jmp.addRealLiteral(1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.ConstantRate,
    );
    const tl = jmp.jumps.runTauLeaping([X], 0.0, 2.0, 40, 77);
    assert.equal(tl.times.length, 41);
    assert.ok(tl.states[40]![0]! > 50.0);

    // C. Uncertainty interval evaluation: x in [1, 3] => x*x + 2 in [3, 11]
    const unc = new DAEBuilder(undefined, "UncInt");
    const u = unc.addVariable("u", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
    unc.uncertainty.setInterval(u, 1.0, 3.0);
    const expr = unc.addBinaryExpr(
      BinOp.Add,
      unc.addBinaryExpr(BinOp.Mul, unc.addName(u), unc.addName(u)),
      unc.addRealLiteral(2.0),
    );
    const iv = unc.uncertainty.evalExprInterval(expr);
    assert.ok(Math.abs(iv.lo - 3.0) < 1e-9);
    assert.ok(Math.abs(iv.hi - 11.0) < 1e-9);

    // D. Constant folding on optimization side-table: (2 + 3) * x => 5 * x
    const opt = new DAEBuilder(undefined, "FoldOpt");
    const v = opt.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 4.0);
    const c5 = opt.addBinaryExpr(BinOp.Add, opt.addRealLiteral(2.0), opt.addRealLiteral(3.0));
    const prod = opt.addBinaryExpr(BinOp.Mul, c5, opt.addName(v));
    opt.optimization.addObjective(prod, -1, DaeObjectiveSense.Minimize);
    opt.exports.dae_foldConstants(opt.ptr, 5);
    const foldedObj = opt.optimization.evalObjectives([4.0]);
    assert.ok(Math.abs(foldedObj[0]! - 20.0) < 1e-12);
  });

  it("8. Advanced WASM kernels: sparse AD Jacobian, SRIW1 SDE, and Hybrid ODE+SSA", () => {
    // A. Sparse AD Constraint Jacobian (2 constraints x 3 vars, only 3 nonzeros)
    const opt = new DAEBuilder(undefined, "SparseOpt");
    const x0 = opt.addVariable("x0", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
    const x1 = opt.addVariable("x1", VarType.Real, Variability.Continuous, Causality.Local, 3.0);
    const x2 = opt.addVariable("x2", VarType.Real, Variability.Continuous, Causality.Local, 5.0);
    // g0 = 2*x0, g1 = x1 * x2 (x0 absent from g1; x1, x2 absent from g0)
    opt.optimization.addInequalityConstraint(
      opt.addBinaryExpr(BinOp.Mul, opt.addRealLiteral(2.0), opt.addName(x0)),
      10.0,
    );
    opt.optimization.addEqualityConstraint(opt.addBinaryExpr(BinOp.Mul, opt.addName(x1), opt.addName(x2)), 15.0);
    const sp = opt.optimization.evalConstraintJacobianSparse([2.0, 3.0, 5.0], [x0, x1, x2], 1e-12);
    assert.equal(sp.nnz, 3);
    assert.deepEqual(sp.rows, [0, 1, 1]);
    assert.deepEqual(sp.cols, [0, 1, 2]);
    assert.ok(Math.abs(sp.values[0]! - 2.0) < 1e-12);
    assert.ok(Math.abs(sp.values[1]! - 5.0) < 1e-12);
    assert.ok(Math.abs(sp.values[2]! - 3.0) < 1e-12);

    // B. Rossler SRIW1 strong-order-1.5 SDE
    const sde = new DAEBuilder(undefined, "Sriw1Gbm");
    const S = sde.addVariable("S", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
    const drift = sde.addBinaryExpr(BinOp.Mul, sde.addRealLiteral(0.05), sde.addName(S));
    const diff = sde.addBinaryExpr(BinOp.Mul, sde.addRealLiteral(0.2), sde.addName(S));
    sde.stochastic.addDiffusion(S, diff, 0);
    const sriw = sde.stochastic.runSRIW1([S], [drift], 0.0, 1.0, 100, 321);
    assert.equal(sriw.times.length, 101);
    assert.ok(Number.isFinite(sriw.states[100]![0]!) && sriw.states[100]![0]! > 0);

    // C. Coupled Hybrid ODE + SSA
    const hyb = new DAEBuilder(undefined, "HybridGene");
    const protein = hyb.addVariable("P", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const mRNA = hyb.addVariable("M", VarType.Real, Variability.Discrete, Causality.Local, 2.0);
    // dP/dt = 2*M - 0.5*P; discrete transcription jump: M -> M + 1 at rate 3.0
    const dP = hyb.addBinaryExpr(
      BinOp.Sub,
      hyb.addBinaryExpr(BinOp.Mul, hyb.addRealLiteral(2.0), hyb.addName(mRNA)),
      hyb.addBinaryExpr(BinOp.Mul, hyb.addRealLiteral(0.5), hyb.addName(protein)),
    );
    hyb.jumps.addJump(
      hyb.addRealLiteral(3.0),
      [{ targetVarId: mRNA, deltaExprId: hyb.addRealLiteral(1.0), mode: JumpAffectMode.Additive }],
      JumpRateKind.ConstantRate,
    );
    const hRes = hyb.jumps.runHybridOdeSsa([protein], [dP], [protein, mRNA], 0.0, 2.0, 100, 55);
    assert.equal(hRes.times.length, 101);
    assert.ok(hRes.states[100]![0]! > 0, "Continuous protein should grow from mRNA");
    assert.ok(hRes.states[100]![1]! >= 2.0, "Discrete mRNA should be non-decreasing");
  });
});
