// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  ArenaEGraphRewriter,
  BinOp,
  Causality,
  DAEBuilder,
  DAEPassManager,
  EGraphSimplificationPass,
  EqKind,
  ExprKind,
  VarType,
  Variability,
  matchPattern,
  parsePattern,
} from "../src/index.js";

async function main() {
  console.log("=== Testing Arena E-Graph Rewriting & Pattern Matching ===");

  // 1. Pattern parser tests
  console.log("1. Testing pattern parser...");
  const p1 = parsePattern("?x + 0");
  assert.strictEqual(p1.type, "bin");
  if (p1.type === "bin") {
    assert.strictEqual(p1.op, BinOp.Add);
    assert.strictEqual(p1.left.type, "var");
    assert.strictEqual(p1.right.type, "lit");
  }

  const p2 = parsePattern("sin(?theta) * 2.5");
  assert.strictEqual(p2.type, "bin");
  if (p2.type === "bin") {
    assert.strictEqual(p2.left.type, "call");
  }

  // 2. Pattern matching against arena expressions
  console.log("2. Testing pattern matching...");
  const dae = new DAEBuilder();
  const xName = dae.varExpr("x");
  const xPlusZero = xName.add(0.0);

  const bindings = new Map<string, number>();
  const isMatch = matchPattern(p1, dae, xPlusZero.id, bindings);
  assert.strictEqual(isMatch, true);
  assert.strictEqual(bindings.get("?x"), xName.id);

  // 3. ArenaEGraphRewriter with standard algebraic rules
  console.log("3. Testing standard algebraic rewriting...");
  const rewriter = new ArenaEGraphRewriter(dae);
  rewriter.addStandardAlgebraicRules();

  // (x + 0) => x
  const simpXPlusZero = rewriter.rewriteExpr(xPlusZero.id);
  assert.strictEqual(simpXPlusZero, xName.id, "(x + 0) should rewrite to x");

  // (y * 1) => y
  const yName = dae.varExpr("y");
  const yMulOne = yName.mul(1.0);
  const simpYMulOne = rewriter.rewriteExpr(yMulOne.id);
  assert.strictEqual(simpYMulOne, yName.id, "(y * 1) should rewrite to y");

  // -(-z) => z
  const zName = dae.varExpr("z");
  const negNegZ = zName.neg().neg();
  const simpNegNegZ = rewriter.rewriteExpr(negNegZ.id);
  assert.strictEqual(simpNegNegZ, zName.id, "-(-z) should rewrite to z");

  // 4. Custom declarative and procedural rewrite rules
  console.log("4. Testing custom rewrite rules...");
  // Declarative rule: ?a * 2 => ?a + ?a
  rewriter.addRule({
    name: "double-to-add",
    pattern: "?a * 2.0",
    replacement: "?a + ?a",
  });

  const xMulTwo = xName.mul(2.0);
  const doubled = rewriter.rewriteExpr(xMulTwo.id);
  assert.strictEqual(dae.getExprKind(doubled), ExprKind.Binary);
  assert.strictEqual(dae.getExprData1(doubled), BinOp.Add);
  assert.strictEqual(dae.getExprLeft(doubled), xName.id);
  assert.strictEqual(dae.getExprRight(doubled), xName.id);

  // Procedural rule
  rewriter.addRule({
    name: "sin-to-cos-shift",
    match: (arena, exprId) => {
      // If expr is sin(0), return 0.0
      if (arena.getExprKind(exprId) === ExprKind.Call) {
        const fnName = arena.interner.resolve(arena.getExprData1(exprId));
        if (fnName === "sin") {
          const arg = arena.getExprLeft(exprId);
          if (arena.getExprKind(arg) === ExprKind.RealLiteral && arena.getExprRealValue(arg) === 0.0) {
            return arena.addRealLiteral(0.0);
          }
        }
      }
      return null;
    },
  });

  const sinZero = dae.lit(0.0).sin();
  const simpSinZero = rewriter.rewriteExpr(sinZero.id);
  assert.strictEqual(dae.getExprRealValue(simpSinZero), 0.0);

  // 5. Equation rewriting
  console.log("5. Testing equation rewriting in arena...");
  // Eq: der(x) = (x + 0) * 1.0
  const derX = dae.varExpr("der(x)");
  const complexRhs = xPlusZero.mul(1.0);
  const eqId = dae.addEquation(EqKind.Simple, derX.id, complexRhs.id);

  const changed = rewriter.rewriteEquation(eqId);
  assert.strictEqual(changed, true);
  assert.strictEqual(dae.getEqRhs(eqId), xName.id, "RHS should be simplified directly to x");

  // 6. EGraphSimplificationPass in DAEPassManager
  console.log("6. Testing EGraphSimplificationPass in pipeline...");
  const dae2 = new DAEBuilder();
  const vId = dae2.interner.intern("v");
  dae2.addVariable(vId, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);

  const vExpr = dae2.varExpr("v");
  // Eq: v = v - v
  const vMinusV = vExpr.sub(vExpr);
  const testEq = dae2.addEquation(EqKind.Simple, vExpr.id, vMinusV.id);

  const pm = new DAEPassManager();
  pm.addPass(new EGraphSimplificationPass());
  const report = pm.run(dae2);

  assert.strictEqual(report.reports.length, 1);
  assert.strictEqual(report.reports[0]?.result?.changed, true);
  assert.strictEqual(dae2.getExprRealValue(dae2.getEqRhs(testEq)), 0.0, "v - v should fold to 0.0 in pass");

  console.log("=== All Arena E-Graph tests passed successfully! ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
