// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  VarType,
  Variability,
  compileFusedArenaKernel,
  createPackedBuffer,
  initBltWasm,
  performBltTransformationArena,
  planStaticArenaMemory,
} from "@modelscript/runtime";
import assert from "node:assert";

async function main() {
  console.log("=== Testing XLA-Style Fused Operator & Equation Codegen ===");
  await initBltWasm();

  const dae = new DAEBuilder();

  // Variables:
  // x: State
  // der(x): Derivative
  // a: Parameter
  // y1: Transient algebraic
  // y2: Transient algebraic
  const xIdx = dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
  const derXIdx = dae.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const aIdx = dae.addVariable("a", VarType.Real, Variability.Parameter, Causality.Local, 3.0);
  const y1Idx = dae.addVariable("y1", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const y2Idx = dae.addVariable("y2", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  // Common subexpression: a * x
  const aMulX = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addExpression(ExprKind.Name, dae.interner.intern("a")),
    dae.addExpression(ExprKind.Name, dae.interner.intern("x")),
  );

  // Eq 0: y1 = (a * x) + 1.0
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("y1")),
    dae.addBinaryExpr(BinOp.Add, aMulX, dae.addRealLiteral(1.0)),
  );

  // Eq 1: y2 = (y1 * 2.0) + (a * x)  <- Notice a * x is identical to Eq 0's subexpression!
  const aMulX2 = dae.addBinaryExpr(
    BinOp.Mul,
    dae.addExpression(ExprKind.Name, dae.interner.intern("a")),
    dae.addExpression(ExprKind.Name, dae.interner.intern("x")),
  );
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("y2")),
    dae.addBinaryExpr(
      BinOp.Add,
      dae.addBinaryExpr(
        BinOp.Mul,
        dae.addExpression(ExprKind.Name, dae.interner.intern("y1")),
        dae.addRealLiteral(2.0),
      ),
      aMulX2,
    ),
  );

  // Eq 2: der(x) = y2 + 5.0
  dae.addEquation(
    EqKind.Simple,
    dae.addExpression(ExprKind.Name, dae.interner.intern("der(x)")),
    dae.addBinaryExpr(BinOp.Add, dae.addExpression(ExprKind.Name, dae.interner.intern("y2")), dae.addRealLiteral(5.0)),
  );

  const stateVars = new Set<number>([xIdx]);
  const blt = performBltTransformationArena(dae, stateVars);
  const plan = planStaticArenaMemory(dae, blt, stateVars);

  const executionBlocks = [
    { type: "single" as const, varIdx: y1Idx, exprId: dae.getEqRhs(0) },
    { type: "single" as const, varIdx: y2Idx, exprId: dae.getEqRhs(1) },
    { type: "single" as const, varIdx: derXIdx, exprId: dae.getEqRhs(2) },
  ];

  const fused = compileFusedArenaKernel(dae, executionBlocks, { layout: plan, cse: true });

  console.log("  Compiled Fused Kernel Source:\n" + fused.source);
  console.log(`  Eliminated Memory Writes: ${fused.eliminatedWrites}`);
  console.log(`  Eliminated Common Subexpressions: ${fused.eliminatedSubexpressions}`);

  // Transient variables y1 and y2 should have their memory writes eliminated!
  assert.strictEqual(fused.eliminatedWrites, 2, "Both transient y1 and y2 writes must be eliminated");
  // a * x was repeated and should be CSE'd into a local temporary variable
  assert(fused.eliminatedSubexpressions >= 1, "At least 1 subexpression (a * x) must be CSE'd");

  // Verify numerical execution
  const packed = createPackedBuffer(plan);
  const xOffset = plan.varIdxToOffset[xIdx]!;
  const aOffset = plan.varIdxToOffset[aIdx]!;
  const derXOffset = plan.varIdxToOffset[derXIdx]!;

  packed[xOffset] = 2.0;
  packed[aOffset] = 3.0;

  fused.evaluate(packed);

  // Analytical check:
  // a * x = 3.0 * 2.0 = 6.0
  // y1 = 6.0 + 1.0 = 7.0
  // y2 = 7.0 * 2.0 + 6.0 = 20.0
  // der(x) = 20.0 + 5.0 = 25.0
  const expectedDerX = 25.0;
  assert.strictEqual(packed[derXOffset], expectedDerX, `der(x) must equal ${expectedDerX}, got ${packed[derXOffset]}`);

  console.log(`  ✔ Fused execution evaluated der(x) = ${packed[derXOffset]} matching analytical solution!`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
