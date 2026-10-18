// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  BinOp,
  Causality,
  causalizeVectorArena,
  connectedComponents,
  convertArenaToMicroModelica,
  DAEBuilder,
  eliminateVectorArenaAliases,
  EqKind,
  expandSetBasedConnectionsArena,
  ExprKind,
  LMap,
  MultiInterval,
  PWLMap,
  SBGInterval,
  sbgMatching,
  SBGraph,
  SBGSet,
  Variability,
  VarType,
} from "../src/index.js";

console.log("=== Testing Set-Based Graphs (SBGraph), Multi-Dimensional Vector Causalization & μ-Modelica ===");

// 1. Test 1D Strided Intervals (`SBGInterval`)
{
  const i1 = new SBGInterval(1, 2, 19); // {1, 3, 5, 7, 9, 11, 13, 15, 17, 19}
  const i2 = new SBGInterval(3, 3, 18); // {3, 6, 9, 12, 15, 18}
  const inter = i1.cap(i2); // {3, 9, 15} -> [3, 6, 15]
  assert.strictEqual(inter.lo, 3);
  assert.strictEqual(inter.step, 6);
  assert.strictEqual(inter.hi, 15);
  assert.strictEqual(inter.size(), 3);

  const diffPieces = i1.diff(i2);
  let totalDiffSize = 0;
  for (const p of diffPieces) {
    totalDiffSize += p.size();
    for (let x = 1; x <= 20; x++) {
      if (p.isIn(x)) {
        assert.ok(i1.isIn(x) && !i2.isIn(x), `Diff element ${x} must be in i1 \\ i2`);
      }
    }
  }
  assert.strictEqual(totalDiffSize, i1.size() - inter.size());
  console.log("✓ 1D strided interval intersection and residue-class difference passed");
}

// 2. Test Multi-Dimensional Intervals (`MultiInterval` / `MDI`) and `SBGSet`
{
  const box1 = MultiInterval.fromBounds([
    [1, 10],
    [1, 10],
  ]);
  const box2 = MultiInterval.fromBounds([
    [4, 7],
    [4, 7],
  ]);
  const set1 = SBGSet.fromMDI(box1);
  const set2 = SBGSet.fromMDI(box2);
  const diffSet = set1.diff(set2);
  assert.strictEqual(diffSet.size(), 100 - 16, "2D box difference must have exact cardinality 84");
  assert.ok(!diffSet.isIn([5, 5]), "Interior point [5,5] must be excluded");
  assert.ok(diffSet.isIn([2, 5]) && diffSet.isIn([5, 2]) && diffSet.isIn([9, 9]), "Outer points must remain");

  const recombined = diffSet.cup(set2);
  assert.strictEqual(recombined.size(), 100);
  assert.strictEqual(recombined.atoms.length, 1, "Compaction should merge disjoint pieces back into a single 2D MDI");
  console.log("✓ MultiInterval (MDI) 2D box difference and SBGSet compaction passed");
}

// 3. Test `SBGraph` Connected Components (`connectedComponents`) on a 1000-node chain
{
  // Vertices V = [1:1000], Edges E = [1:999] connecting e -> e and e -> e + 1
  const V = SBGSet.fromInterval(1, 1, 1000);
  const E = SBGSet.fromInterval(1, 1, 999);
  const map1 = new PWLMap([{ dom: E, map: new LMap([1], [0]) }]);
  const map2 = new PWLMap([{ dom: E, map: new LMap([1], [1]) }]);
  const sbg = new SBGraph(V, E, map1, map2);

  const ccMap = connectedComponents(sbg);
  assert.deepStrictEqual(ccMap.apply([1]), [1]);
  assert.deepStrictEqual(ccMap.apply([500]), [1]);
  assert.deepStrictEqual(ccMap.apply([1000]), [1]);
  assert.strictEqual(ccMap.pieces.length, 1, "All 1000 vertices must collapse into a single constant PWLMap piece");
  console.log("✓ SBGraph connectedComponents collapsed 1000-node chain in O(1) pieces");
}

// 4. Test Set-Based Bipartite Matching (`sbgMatching`) with Augmenting Set Path
{
  // Equations F = [1:100], Unknowns U = [101:200]
  // Edge group 1 (E1 = [1:1]): F[1] -- U[101]
  // Edge group 2 (E2 = [2:100]): F[2:100] -- U[101:199] (shift +99)
  // Edge group 3 (E3 = [101:199]): F[2:100] -- U[102:200] (shift +1)
  const V = SBGSet.fromInterval(1, 1, 200);
  const E1 = SBGSet.fromInterval(1, 1, 1);
  const E2 = SBGSet.fromInterval(2, 1, 100);
  const E3 = SBGSet.fromInterval(101, 1, 199);
  const E = E1.cup(E2).cup(E3);

  const mapU = new PWLMap([
    { dom: E1, map: new LMap([1], [100]) }, // 1 -> 101
    { dom: E2, map: new LMap([1], [99]) }, // e in [2:100] -> u in [101:199]
    { dom: E3, map: new LMap([1], [1]) }, // e in [101:199] -> u in [102:200]
  ]);
  const mapF = new PWLMap([
    { dom: E1, map: new LMap([1], [0]) }, // 1 -> 1
    { dom: E2, map: new LMap([1], [0]) }, // e in [2:100] -> f in [2:100]
    { dom: E3, map: new LMap([1], [-99]) }, // e in [101:199] -> f in [2:100]
  ]);

  const bipGraph = new SBGraph(V, E, mapU, mapF);
  const matchRes = sbgMatching(bipGraph);
  assert.ok(matchRes.isFullEquationMatch, "SBGMatching must match all 100 equations");
  assert.strictEqual(matchRes.matchedEquations.size(), 100);
  assert.strictEqual(matchRes.matchedUnknowns.size(), 100);
  console.log("✓ Set-Based Bipartite Matching (sbgMatching) matched 100x100 system without unrolling");
}

// 5. Test Multi-Dimensional Intentional Vector Causalization + Loop Splitting (`causalizeVectorArena`)
{
  const arena = new DAEBuilder();
  const N = 50;
  const uIdx = arena.addVariable("u", VarType.Real, Variability.Continuous, Causality.Local, 0);
  arena.setVarShape(uIdx, [N]);

  // Boundary equation: u[1] = 10.0
  const uSub1 = arena.addSubscriptExpr(arena.addNameExpr("u"), [arena.addIntLiteral(1)]);
  arena.addEquation(EqKind.Simple, uSub1, arena.addRealLiteral(10.0));

  // Interior loop equation: for i in 1:49 loop u[i + 1] - u[i] = 1.0; end for;
  const iId = arena.interner.intern("i");
  const rangeExpr = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N - 1));
  const forIdx = arena.addForEquation(iId, rangeExpr);
  const iExpr1 = arena.addNameExpr("i");
  const iPlus1 = arena.addBinaryExpr(BinOp.Add, iExpr1, arena.addIntLiteral(1));
  const uNext = arena.addSubscriptExpr(arena.addNameExpr("u"), [iPlus1]);
  const uCurr = arena.addSubscriptExpr(arena.addNameExpr("u"), [arena.addNameExpr("i")]);
  const diffLhs = arena.addBinaryExpr(BinOp.Sub, uNext, uCurr);
  arena.addForBodyEquation(forIdx, EqKind.Simple, diffLhs, arena.addRealLiteral(1.0));

  const causalRes = causalizeVectorArena(arena);
  assert.ok(causalRes.isFullMatch, "Vector causalization must find a complete matching on boundary + ForEq");
  assert.strictEqual(causalRes.blocks.length, 2, "Must produce 2 vector blocks (boundary u[1] then loop u[2:50])");
  assert.ok(!causalRes.blocks[0]!.isAlgebraicLoop && !causalRes.blocks[1]!.isAlgebraicLoop);

  // Check that the ForEq was symbolically isolated for u[i + 1] in-place!
  const forMeta = arena.getForEquationMeta(forIdx)!;
  const isolatedLhs = forMeta.bodyEquations[0]!.lhsExprId;
  assert.strictEqual(arena.getExprKind(isolatedLhs), ExprKind.Subscript, "ForEq LHS must be isolated subscript u[i+1]");
  console.log("✓ VectorCausalizationGraph + VectorMatching + VectorTarjan + isolateSymbolicallyForArena passed");
}

// 6. Test Array-Preserving Loop Alias Elimination (`eliminateVectorArenaAliases`)
{
  const arena = new DAEBuilder();
  const N = 20;
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  arena.setVarShape(xIdx, [N]);
  arena.setVarShape(yIdx, [N]);

  const iId = arena.interner.intern("i");
  // Alias loop: for i in 1:20 loop y[i] = -x[i]; end for;
  const aliasRange = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N));
  const aliasForIdx = arena.addForEquation(iId, aliasRange);
  const ySub = arena.addSubscriptExpr(arena.addNameExpr("y"), [arena.addNameExpr("i")]);
  const negXSub = arena.addNegateExpr(arena.addSubscriptExpr(arena.addNameExpr("x"), [arena.addNameExpr("i")]));
  arena.addForBodyEquation(aliasForIdx, EqKind.Simple, ySub, negXSub);

  // ODE loop using y[i]: for i in 1:20 loop der(x[i]) = y[i]; end for;
  const odeRange = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N));
  const odeForIdx = arena.addForEquation(iId, odeRange);
  const derXSub = arena.addDerExpr(arena.addSubscriptExpr(arena.addNameExpr("x"), [arena.addNameExpr("i")]));
  const yRefSub = arena.addSubscriptExpr(arena.addNameExpr("y"), [arena.addNameExpr("i")]);
  arena.addForBodyEquation(odeForIdx, EqKind.Simple, derXSub, yRefSub);

  const eliminated = eliminateVectorArenaAliases(arena);
  assert.strictEqual(eliminated.length, 1, "Must eliminate 1 array alias variable");
  assert.strictEqual(eliminated[0]!.eliminatedVar, "y");
  assert.strictEqual(eliminated[0]!.targetVar, "x");
  assert.strictEqual(eliminated[0]!.sign, -1);
  assert.ok(arena.isVarRemoved(yIdx), "Aliased array variable y must be marked removed");
  assert.ok(arena.isEqRemoved(aliasForIdx), "Alias ForEq must be marked removed");

  // Verify ODE loop RHS was rewritten to -x[i]
  const odeMeta = arena.getForEquationMeta(odeForIdx)!;
  assert.strictEqual(arena.getExprKind(odeMeta.bodyEquations[0]!.rhsExprId), ExprKind.Negate);
  console.log("✓ Array-Preserving Loop Alias Elimination (eliminateVectorArenaAliases) passed");
}

// 7. Test Set-Based Connector Expansion (`expandSetBasedConnectionsArena`)
{
  const arena = new DAEBuilder();
  const N = 10;
  const pvIdx = arena.addVariable("p.v", VarType.Real, Variability.Continuous, Causality.Local, 0);
  const piIdx = arena.addVariable("p.i", VarType.Real, Variability.Continuous, Causality.Local, 0);
  arena.setVarFlow(piIdx, true);
  arena.setVarShape(pvIdx, [N]);
  arena.setVarShape(piIdx, [N]);

  const nvIdx = arena.addVariable("n.v", VarType.Real, Variability.Continuous, Causality.Local, 0);
  const niIdx = arena.addVariable("n.i", VarType.Real, Variability.Continuous, Causality.Local, 0);
  arena.setVarFlow(niIdx, true);
  arena.setVarShape(nvIdx, [N]);
  arena.setVarShape(niIdx, [N]);

  // for i in 1:9 loop connect(n[i], p[i + 1]); end for;
  const iId = arena.interner.intern("i");
  const rangeExpr = arena.addRange(arena.addIntLiteral(1), arena.addIntLiteral(N - 1));
  const connForIdx = arena.addForEquation(iId, rangeExpr);
  const nSub = arena.addSubscriptExpr(arena.addNameExpr("n"), [arena.addNameExpr("i")]);
  const pSub = arena.addSubscriptExpr(arena.addNameExpr("p"), [
    arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("i"), arena.addIntLiteral(1)),
  ]);
  arena.addForBodyEquation(connForIdx, EqKind.Connect, nSub, pSub);

  const connRes = expandSetBasedConnectionsArena(arena);
  assert.strictEqual(connRes.generatedForEquations.length, 1);
  const genMeta = arena.getForEquationMeta(connRes.generatedForEquations[0]!)!;
  assert.strictEqual(
    genMeta.bodyEquations.length,
    2,
    "Must synthesize 1 potential equality + 1 Kirchhoff flow equation inside ForEq",
  );
  console.log("✓ Set-Based Connector Expansion (expandSetBasedConnectionsArena) passed");
}

// 8. Test Micro-Modelica Discontinuity Lowering (`convertArenaToMicroModelica`)
{
  const arena = new DAEBuilder();
  arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  // y = abs(x) + sign(x)
  const absCall = arena.addCallExpr("abs", [arena.addNameExpr("x")]);
  const signCall = arena.addCallExpr("sign", [arena.addNameExpr("x")]);
  const rhs = arena.addBinaryExpr(BinOp.Add, absCall, signCall);
  arena.addEquation(EqKind.Simple, arena.addNameExpr("y"), rhs);

  const microRes = convertArenaToMicroModelica(arena);
  assert.strictEqual(microRes.discreteVars.length, 2, "Must synthesize _d1 and _d2 discrete variables");
  assert.strictEqual(microRes.whenEquationIndices.length, 2, "Must synthesize 2 complementary When equations");
  assert.strictEqual(microRes.eventIndicatorExprIds.length, 2, "Must register 2 zero-crossing event indicators");
  console.log("✓ Micro-Modelica Discontinuity Lowering (convertArenaToMicroModelica) passed");
}

console.log("All SBGraph, Vector Causalization, Loop Alias, Connector, and μ-Modelica tests passed!");
