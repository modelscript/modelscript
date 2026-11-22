// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { ivAdd, ivMul, ivNeg } from "../src/analysis/outward_rounding.js";
import type { Interval } from "../src/analysis/wasm_interval.js";
import { PBox, pboxAdd, propagatePBox, propagatePBoxFlowpipe } from "../src/analysis/wasm_pbox.js";
import { StochasticBarrierSynthesizer } from "../src/analysis/wasm_stochastic_barrier.js";
import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "../src/dae/wasm_dae.js";
import { propagatePBoxArena } from "../src/formal/dae/pbox_arena.js";
import { UqTheoryOracle } from "../src/formal/oracles/uq_oracle.js";
import { isProbabilisticallyProven, probabilisticVerdictFromBounds } from "../src/formal/verdict.js";

console.log("=== Testing Phase 3 Rigorous P-Box & Probabilistic Verification ===");

function exactNormalCDF(x: number, mu: number, sigma: number): number {
  const z = (x - mu) / (sigma * Math.SQRT2);
  // Abramowitz & Stegun erf
  const sign = z < 0 ? -1 : 1;
  const az = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * az);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-az * az);
  return 0.5 * (1 + sign * erf);
}

// 1. Sound CDF containment for Uniform, Normal, Imprecise Normal, and Chebyshev P-boxes
{
  const uBox = PBox.fromUniform(0, 10, 50);
  for (const x of [-1, 0, 2.5, 5.0, 7.3, 10, 12]) {
    const exact = x <= 0 ? 0 : x >= 10 ? 1 : x / 10;
    const [fLo, fHi] = uBox.cdfBounds(x);
    assert.ok(
      fLo <= exact + 1e-12 && exact <= fHi + 1e-12,
      `Uniform CDF containment failed at x=${x}: [${fLo}, ${fHi}] vs ${exact}`,
    );
    // Outward-rounded adjacent bins can overlap by 1 ulp at exact bin boundaries, so width <= 2/M
    assert.ok(fHi - fLo <= 2 / 50 + 1e-9, `Uniform P-box width too large at x=${x}: ${fHi - fLo}`);
  }

  const nBox = PBox.fromNormal(10, 2, 64, 1e-6);
  for (const x of [2, 6, 8, 10, 12, 14, 18]) {
    const exact = exactNormalCDF(x, 10, 2);
    const [fLo, fHi] = nBox.cdfBounds(x);
    assert.ok(
      fLo <= exact + 1e-6 && exact <= fHi + 1e-6,
      `Normal CDF containment failed at x=${x}: [${fLo}, ${fHi}] vs ${exact}`,
    );
  }

  // Imprecise Normal: mu in [9.5, 10.5], sigma in [1.5, 2.5] must enclose every (mu, sigma) in that box
  const impBox = PBox.fromNormalRange(9.5, 10.5, 1.5, 2.5, 64);
  for (const mu of [9.5, 10.0, 10.5]) {
    for (const sigma of [1.5, 2.0, 2.5]) {
      for (const x of [6, 10, 14]) {
        const exact = exactNormalCDF(x, mu, sigma);
        const [fLo, fHi] = impBox.cdfBounds(x);
        assert.ok(
          fLo <= exact + 1e-6 && exact <= fHi + 1e-6,
          `Imprecise Normal containment failed for (${mu},${sigma}) at x=${x}`,
        );
      }
    }
  }

  // Chebyshev/Cantelli distribution-free P-box encloses Normal(0, 1) and Uniform(-sqrt(3), sqrt(3))
  const cheb = PBox.fromChebyshev(0, 1, 64);
  for (const x of [-2, -1, 0, 1, 2]) {
    const exactN = exactNormalCDF(x, 0, 1);
    const [fLo, fHi] = cheb.cdfBounds(x);
    assert.ok(fLo <= exactN + 1e-6 && exactN <= fHi + 1e-6, `Chebyshev containment failed for Normal at x=${x}`);
  }

  console.log("✓ P-box CDF containment (Uniform, Normal, Imprecise Normal, Chebyshev) passed");
}

// 2. Independent vs Fréchet addition of two Uniform(0, 1) P-boxes
{
  const a = PBox.fromUniform(0, 1, 20);
  const b = PBox.fromUniform(0, 1, 20);

  const sumIndep = pboxAdd(a, b, "independent", 40);
  const sumFrechet = pboxAdd(a, b, "frechet", 40);

  // Exact CDF of independent U(0,1) + U(0,1) is triangular: x^2 / 2 on [0,1], 1 - (2-x)^2/2 on [1,2]
  for (const x of [0.25, 0.5, 1.0, 1.5, 1.75]) {
    const exactIndep = x <= 1 ? 0.5 * x * x : 1 - 0.5 * (2 - x) * (2 - x);
    const [iLo, iHi] = sumIndep.cdfBounds(x);
    assert.ok(
      iLo <= exactIndep + 1e-9 && exactIndep <= iHi + 1e-9,
      `Independent sum containment failed at x=${x}: [${iLo}, ${iHi}] vs ${exactIndep}`,
    );

    // Fréchet bounds must enclose independent sum, comonotonic sum (2*U -> U(0,2)), AND countermonotonic (const 1)
    const exactComonotonic = x / 2;
    const exactCountermonotonic = x < 1 ? 0 : 1;
    const [fLo, fHi] = sumFrechet.cdfBounds(x);
    assert.ok(fLo <= exactIndep + 1e-9 && exactIndep <= fHi + 1e-9);
    assert.ok(fLo <= exactComonotonic + 1e-9 && exactComonotonic <= fHi + 1e-9);
    assert.ok(fLo <= exactCountermonotonic + 1e-9 && exactCountermonotonic <= fHi + 1e-9);
  }

  console.log("✓ Independent & Fréchet P-box arithmetic containment passed");
}

// 3. Nonlinear outward-rounded propagation: y = x1^2 + x1 * x2
{
  const x1 = PBox.fromUniform(1, 2, 16);
  const x2 = PBox.fromUniform(0, 1, 16);

  const prop = propagatePBox(
    (boxes: Interval[]) => {
      const b1 = boxes[0]!;
      const b2 = boxes[1]!;
      return [ivAdd(ivMul(b1, b1), ivMul(b1, b2))];
    },
    [x1, x2],
    { maxBins: 64, rigor: "rigorous" },
  );

  assert.strictEqual(prop.rigor, "rigorous");
  assert.strictEqual(prop.numFocalEvaluations, 16 * 16);
  const yBox = prop.outputs[0]!;

  // True support of x1^2 + x1*x2 on [1,2] x [0,1] is [1, 6]
  const [supLo, supHi] = yBox.support();
  assert.ok(supLo <= 1.0 && supHi >= 6.0, `Support [${supLo}, ${supHi}] must enclose [1, 6]`);

  // True expectation: E[x1^2] + E[x1]*E[x2] = (7/3) + (1.5)*(0.5) = 3.08333...
  const exactMean = 7 / 3 + 0.75;
  const [mLo, mHi] = yBox.meanBounds();
  assert.ok(mLo <= exactMean && exactMean <= mHi, `Mean bounds [${mLo}, ${mHi}] must enclose ${exactMean}`);

  // Sound probabilistic verification verdicts
  const safeVerdict = yBox.verifyRequirement(">", 6.5, 0.001, "rigorous");
  assert.strictEqual(safeVerdict.kind, "proven");
  assert.ok(isProbabilisticallyProven(safeVerdict));

  const unsafeVerdict = yBox.verifyRequirement(">", 0.5, 0.5, "rigorous");
  assert.strictEqual(unsafeVerdict.kind, "violated");

  // Heuristic rigor must NEVER emit proven
  const heuristicVerdict = probabilisticVerdictFromBounds([0, 0], 0.01, "heuristic");
  assert.strictEqual(heuristicVerdict.kind, "unknown");
  assert.strictEqual(heuristicVerdict.reason, "not-rigorous");
  assert.ok(!isProbabilisticallyProven(heuristicVerdict));

  console.log("✓ Outward-rounded nonlinear P-box propagation & ProbabilisticVerdict contract passed");
}

// 4. UqTheoryOracle integration with P-box distributions & push/pop backtracking
{
  const oracle = new UqTheoryOracle();
  const stressBox = PBox.fromNormalRange(40, 42, 1.5, 2.0, 64, 1e-6);
  oracle.setPBox("stress", stressBox);

  // Safe requirement: P(stress > 60) <= 1e-3 (60 is > 9 sigma above 42)
  oracle.pushLevel();
  oracle.assertLiteral({
    id: 1,
    predicate: "probBound",
    args: ["stress", ">", 60.0, 1e-3],
    sign: true,
  });
  assert.strictEqual(oracle.checkSat().isSat, true);
  const safeVerdicts = oracle.checkRequirementsWithVerdicts();
  const vSafe = Array.from(safeVerdicts.values())[0]!;
  assert.strictEqual(vSafe.kind, "proven", `Expected proven for stress > 60, got ${JSON.stringify(vSafe)}`);
  assert.strictEqual(vSafe.rigor, "rigorous");
  oracle.popLevel();

  // Violated requirement: P(stress > 30) <= 0.1 (30 is > 5 sigma below 40, so pMin > 0.99)
  oracle.pushLevel();
  oracle.assertLiteral({
    id: 2,
    predicate: "probBound",
    args: ["stress", ">", 30.0, 0.1],
    sign: true,
  });
  const satRes = oracle.checkSat();
  assert.strictEqual(satRes.isSat, false, "Oracle must report UNSAT conflict when pMin > maxProbability");
  assert.ok(satRes.conflict?.explanation.includes("at least"));
  const badVerdicts = oracle.checkRequirementsWithVerdicts();
  const vBad = Array.from(badVerdicts.values())[0]!;
  assert.strictEqual(vBad.kind, "violated");
  oracle.popLevel();

  // Inconclusive P-box requirement: straddling threshold around mean [40, 42]
  oracle.assertLiteral({
    id: 3,
    predicate: "probBound",
    args: ["stress", ">", 41.0, 0.5],
    sign: true,
  });
  const incVerdicts = oracle.checkRequirementsWithVerdicts();
  const vInc = Array.from(incVerdicts.values())[0]!;
  assert.strictEqual(vInc.kind, "unknown");
  if (vInc.kind === "unknown") {
    assert.strictEqual(vInc.reason, "inconclusive-pbox");
  }

  console.log("✓ UqTheoryOracle P-box integration & ProbabilisticVerdict checks passed");
}

// 5. Validated P-Box ODE Flowpipe Propagation (all-time probabilistic safety)
{
  // dx/dt = -x with x(0) ~ Uniform(0.8, 1.2) -> exact x(t) = x(0) * exp(-t)
  // At t=1: x(1) ~ Uniform(0.8*e^-1, 1.2*e^-1) ≈ Uniform(0.2943, 0.4415)
  const initX = PBox.fromUniform(0.8, 1.2, 16);
  const fp = propagatePBoxFlowpipe({
    fInterval: (_t, x) => [ivNeg(x[0]!)],
    initialPBoxes: [initX],
    tSpan: [0, 1.0],
    dt: 0.05,
    requirements: [
      // Safe all-time: x(t) never exceeds 1.5 -> P = 0 <= 0.01 (proven!)
      { stateIndex: 0, operator: ">", threshold: 1.5, maxAllowedProbability: 0.01 },
      // Violated all-time: x(0) >= 0.8 > 0.5 -> P = 1 > 0.5 (violated!)
      { stateIndex: 0, operator: ">", threshold: 0.5, maxAllowedProbability: 0.5 },
    ],
  });

  assert.strictEqual(fp.allPicardValidated, true, "All Picard steps must validate");
  assert.strictEqual(fp.rigor, "rigorous");
  assert.strictEqual(fp.verdicts[0]!.kind, "proven");
  assert.strictEqual(fp.verdicts[1]!.kind, "violated");

  // Final P-box at t=1 must soundly enclose exact E[x(1)] = 1.0 * e^-1
  const finalBox = fp.statePBoxes[fp.statePBoxes.length - 1]![0]!;
  const [mLo, mHi] = finalBox.meanBounds();
  const exactFinalMean = Math.exp(-1);
  assert.ok(
    mLo <= exactFinalMean && exactFinalMean <= mHi,
    `Flowpipe final mean bounds [${mLo}, ${mHi}] must enclose e^-1=${exactFinalMean}`,
  );

  console.log("✓ Validated P-box Picard-Lindelöf ODE flowpipe certification passed");
}

// 6. Rigorous Finite-Horizon Kushner Supermartingale Stochastic Barrier Certification
{
  // Stable 2D Itô diffusion: dx = A x dt + sigma dW, A = diag(-2, -3), sigma = diag(0.05, 0.05)
  // With P = I: lambdaMinP = 1, Q = diag(4, 6), tr(Sigma*P) = 0.005, x0 = [0.1, 0.1] => B(x0) = 0.02
  // Over T = 2.0, unsafeRadius = 2.0 (ru^2 = 4):
  //   pMax = (0.02 + 0.005 * 2) / 4 = 0.0075 <= 0.05 => proven!
  const certified = StochasticBarrierSynthesizer.verifyFiniteHorizon({
    driftMatrixA: [
      [-2.0, 0.0],
      [0.0, -3.0],
    ],
    diffusionCovMax: [
      [0.0025, 0.0],
      [0.0, 0.0025],
    ],
    initialState: [0.1, 0.1],
    unsafeRadius: 2.0,
    horizon: 2.0,
    riskTolerance: 0.05,
    remainderLip: 0.5, // Nonlinear drift remainder ||r(x)|| <= 0.5 ||x|| still dominated by Q >= 4I
    candidateP: [
      [1.0, 0.0],
      [0.0, 1.0],
    ],
  });

  assert.strictEqual(certified.isCertifiedSafe, true);
  assert.strictEqual(certified.verdict.kind, "proven");
  assert.strictEqual(certified.verdict.rigor, "rigorous");
  assert.ok(certified.maxFailureProbability < 0.01, `Expected pMax < 0.01, got ${certified.maxFailureProbability}`);

  // When nonlinear remainder exceeds drift dissipation, must NOT emit proven
  const uncertified = StochasticBarrierSynthesizer.verifyFiniteHorizon({
    driftMatrixA: [
      [-2.0, 0.0],
      [0.0, -3.0],
    ],
    diffusionCovMax: [
      [0.0025, 0.0],
      [0.0, 0.0025],
    ],
    initialState: [0.1, 0.1],
    unsafeRadius: 2.0,
    horizon: 2.0,
    riskTolerance: 0.05,
    remainderLip: 5.0, // Exceeds drift dissipation!
    candidateP: [
      [1.0, 0.0],
      [0.0, 1.0],
    ],
  });
  assert.strictEqual(uncertified.isCertifiedSafe, false);
  assert.strictEqual(uncertified.verdict.kind, "unknown");

  console.log("✓ Rigorous finite-horizon Kushner supermartingale stochastic barrier passed");
}

// 7. End-to-end DAEBuilder Arena -> Rigorous P-Box Flowpipe (uncertain parameter + initial state)
{
  // der(x) = -k * x, k ~ Uniform(0.8, 1.2), x(0) ~ Uniform(0.9, 1.1)
  // Exact E[x(1)] = E[x(0)] * E[exp(-k)] = 1.0 * (exp(-0.8) - exp(-1.2)) / 0.4 ≈ 0.37033
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.addVariable("k", VarType.Real, Variability.Parameter, 0, 1.0);
  const xExpr = arena.addNameExpr("x");
  arena.addEquation(
    EqKind.Simple,
    arena.addDerExpr(xExpr),
    arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("k"), xExpr)),
  );

  const res = propagatePBoxArena(arena, {
    parameterPBoxes: new Map([["k", PBox.fromUniform(0.8, 1.2, 8)]]),
    initialStatePBoxes: new Map([["x", PBox.fromUniform(0.9, 1.1, 8)]]),
    tSpan: [0, 1.0],
    dt: 0.05,
    requirements: [
      // Safe all-time: x(t) never exceeds 1.5 -> P = 0 <= 0.01 (proven)
      { state: "x", operator: ">", threshold: 1.5, maxAllowedProbability: 0.01 },
      // Violated all-time: x(0) >= 0.9 > 0.5 -> P = 1 > 0.1 (violated)
      { state: "x", operator: ">", threshold: 0.5, maxAllowedProbability: 0.1 },
    ],
  });

  assert.strictEqual(res.ok, true, "propagatePBoxArena must succeed on ODE arena");
  if (res.ok) {
    assert.strictEqual(res.allPicardValidated, true);
    assert.strictEqual(res.rigor, "rigorous");
    assert.strictEqual(res.numFocalTrajectories, 64);

    const exactFinalMean = (Math.exp(-0.8) - Math.exp(-1.2)) / 0.4;
    const [mLo, mHi] = res.finalPBoxes.get("x")!.meanBounds();
    assert.ok(
      mLo <= exactFinalMean && exactFinalMean <= mHi,
      `Arena P-box mean bounds [${mLo}, ${mHi}] must enclose exact ${exactFinalMean}`,
    );

    const verdicts = Array.from(res.verdicts.values());
    assert.strictEqual(verdicts[0]!.kind, "proven");
    assert.strictEqual(verdicts[1]!.kind, "violated");
  }

  console.log("✓ End-to-end DAEBuilder Arena -> Rigorous P-Box Flowpipe passed");
}

// 8. Index-1 Algebraic DAE -> Rigorous P-Box Flowpipe (RigorousKrawczyk + Picard-Lindelöf)
{
  // Index-1 DAE: der(x) = -z, z - k * x = 0  (algebraic state z = k * x => exact x(t) = exp(-k * t))
  const daeArena = new DAEBuilder();
  daeArena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  daeArena.addVariable("der(x)", VarType.Real, Variability.Continuous, 0, 0.0);
  daeArena.addVariable("z", VarType.Real, Variability.Continuous, 0, 1.0);
  daeArena.addVariable("k", VarType.Real, Variability.Parameter, 0, 1.0);

  const xExpr = daeArena.addNameExpr("x");
  const zExpr = daeArena.addNameExpr("z");
  const kExpr = daeArena.addNameExpr("k");
  daeArena.addEquation(EqKind.Simple, daeArena.addDerExpr(xExpr), daeArena.addUnaryExpr(UnaryOp.Negate, zExpr));
  daeArena.addEquation(EqKind.Simple, zExpr, daeArena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));

  const res = propagatePBoxArena(daeArena, {
    parameterPBoxes: new Map([["k", PBox.fromUniform(0.8, 1.2, 8)]]),
    tSpan: [0, 1.0],
    dt: 0.05,
    requirements: [{ state: "x", operator: ">", threshold: 1.5, maxAllowedProbability: 0.01 }],
  });

  assert.strictEqual(res.ok, true, "propagatePBoxArena must succeed on index-1 algebraic DAE");
  if (res.ok) {
    assert.strictEqual(res.allPicardValidated, true);
    assert.strictEqual(res.rigor, "rigorous");
    const exactMean = (Math.exp(-0.8) - Math.exp(-1.2)) / 0.4;
    const [mLo, mHi] = res.finalPBoxes.get("x")!.meanBounds();
    assert.ok(
      mLo <= exactMean && exactMean <= mHi,
      `Index-1 DAE mean bounds [${mLo}, ${mHi}] must enclose ${exactMean}`,
    );
    assert.strictEqual(Array.from(res.verdicts.values())[0]!.kind, "proven");
  }

  console.log("✓ Index-1 algebraic DAE -> Rigorous P-Box Flowpipe (Krawczyk + Picard) passed");
}

console.log("=== All Phase 3 Rigorous P-Box Verification tests passed! ===");
