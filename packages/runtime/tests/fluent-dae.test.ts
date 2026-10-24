// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { Causality, DAEBuilder, EqKind, ExprKind, VarType, Variability } from "../src/index.js";

async function main() {
  console.log("=== Testing Fluent Symbolic DAE Wrapper ===");

  const dae = new DAEBuilder();

  // 1. Variable inspection & fluent interaction
  console.log("1. Testing ArenaVariable wrapper...");
  const xNameId = dae.interner.intern("x");
  const yNameId = dae.interner.intern("y");
  const pNameId = dae.interner.intern("k");

  const xIdx = dae.addVariable(xNameId, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);
  const yIdx = dae.addVariable(yNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  const pIdx = dae.addVariable(pNameId, VarType.Real, Variability.Parameter, Causality.Local, 2.5, 0);

  const varX = dae.variable("x");
  assert.ok(varX !== null, "Variable 'x' should be resolved by name");
  assert.strictEqual(varX.id, xIdx);
  assert.strictEqual(varX.name, "x");
  assert.strictEqual(varX.type, VarType.Real);
  assert.strictEqual(varX.variability, Variability.Continuous);
  assert.strictEqual(varX.start, 1.0);

  varX.setStart(3.14);
  assert.strictEqual(dae.getVarStartValue(xIdx), 3.14, "Start value should be mutated in arena");

  const allVars = dae.variables();
  assert.strictEqual(allVars.length, 3, "Should return 3 active variables");
  assert.strictEqual(allVars[0]?.name, "x");
  assert.strictEqual(allVars[1]?.name, "y");
  assert.strictEqual(allVars[2]?.name, "k");

  // 2. Symbolic Expression Building
  console.log("2. Testing ArenaExpr operators...");
  const exprX = varX.asExpr();
  assert.strictEqual(exprX.kind, ExprKind.Name);
  assert.strictEqual(exprX.isVar("x"), true);
  assert.strictEqual(exprX.isVar("y"), false);

  const derX = varX.derExpr();
  assert.strictEqual(derX.isVar("der(x)"), true);

  // x * k + 1.0
  const varK = dae.variable("k")!;
  const exprK = varK.asExpr();
  const scaled = exprX.mul(exprK);
  assert.strictEqual(scaled.kind, ExprKind.Binary);
  assert.ok(scaled.left !== null && scaled.left.isVar("x"));
  assert.ok(scaled.right !== null && scaled.right.isVar("k"));

  const offsetExpr = scaled.add(1.0);
  assert.strictEqual(offsetExpr.kind, ExprKind.Binary);
  assert.ok(offsetExpr.right !== null && offsetExpr.right.isLiteral);
  assert.strictEqual(offsetExpr.right.realValue, 1.0);

  // Trig functions
  const trigExpr = exprX.sin().add(exprX.cos());
  assert.strictEqual(trigExpr.kind, ExprKind.Binary);
  assert.strictEqual(trigExpr.left?.kind, ExprKind.Call);
  assert.strictEqual(trigExpr.right?.kind, ExprKind.Call);

  // 3. Equation inspection & rewriting
  console.log("3. Testing ArenaEquation wrapper and equation rewriting...");
  // der(x) = -k * x
  const negK = exprK.neg();
  const rhsExpr = negK.mul(exprX);
  const eqId = dae.addEquation(EqKind.Simple, derX.id, rhsExpr.id);

  const eq = dae.equation(eqId);
  assert.strictEqual(eq.id, eqId);
  assert.strictEqual(eq.kind, EqKind.Simple);
  assert.strictEqual(eq.lhs.isVar("der(x)"), true);

  // Rewriting RHS: eq.setRhs(eq.rhs.mul(0.5))
  const halvedRhs = eq.rhs.mul(0.5);
  eq.setRhs(halvedRhs);
  assert.strictEqual(eq.rhs.id, halvedRhs.id);
  assert.strictEqual(dae.getEqRhs(eqId), halvedRhs.id);

  const allEqs = dae.equations();
  assert.strictEqual(allEqs.length, 1);
  assert.strictEqual(allEqs[0]?.id, eqId);

  // Lit and varExpr helpers
  const litExpr = dae.lit(42.0);
  assert.strictEqual(litExpr.realValue, 42.0);

  const boolLit = dae.lit(true);
  assert.strictEqual(boolLit.boolValue, true);

  console.log("=== All Fluent DAE tests passed successfully! ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
