// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { collectArenaExprDeps } from "../src/analysis/wasm_blt.js";
import { printArenaDAE } from "../src/dae/wasm_dae_printer.js";
import {
  DAEBuilder,
  EqKind,
  ExprKind,
  TensorReduceOp,
  VarType,
  Variability,
  differentiateArenaExpression,
} from "../src/index.js";

console.log("=== Testing DAEBuilder Symbolic Tensor & Array Primitives ===");

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Tensor Variables and Shapes
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 1: Tensor variable creation and multi-dimensional shape preservation...");
const arena = new DAEBuilder();

// 2D matrix state U with shape [10, 20]
const uIdx = arena.addVariable("U", VarType.Real, Variability.Continuous, 0, 0.0);
arena.setVarShape(uIdx, [10, 20]);
assert.deepStrictEqual(arena.getVarShape(uIdx), [10, 20]);
assert.strictEqual(arena.getVarShapeElementCount(uIdx), 200);

// 1D vector parameter V with shape [20]
const vIdx = arena.addVariable("V", VarType.Real, Variability.Parameter, 0, 1.0);
arena.setVarShape(vIdx, [20]);
assert.deepStrictEqual(arena.getVarShape(vIdx), [20]);
assert.strictEqual(arena.getVarShapeElementCount(vIdx), 20);

console.log("  ✔ Tensor variable shapes and element counts verified");

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Higher-Level Tensor Expression Construction
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 2: Higher-level tensor expression nodes (Slice, Broadcast, MatMul, Reduce)...");

const uExpr = arena.addName(arena.interner.intern("U"));
const vExpr = arena.addName(arena.interner.intern("V"));

// Slice: U[2:5, :] along axis 0
const sliceRange = arena.addRangeExpr(arena.addIntLiteral(2), arena.addIntLiteral(5));
const sliceExpr = arena.addTensorSlice(uExpr, sliceRange, 0);
assert.strictEqual(arena.getExprKind(sliceExpr), ExprKind.TensorSlice);
assert.strictEqual(arena.getExprData1(sliceExpr), uExpr);
assert.strictEqual(arena.getExprLeft(sliceExpr), sliceRange);
assert.strictEqual(arena.getExprRight(sliceExpr), 0);

// Broadcast: broadcast V to [10, 20]
const broadcastExpr = arena.addTensorBroadcast(vExpr, [10, 20], 0);
assert.strictEqual(arena.getExprKind(broadcastExpr), ExprKind.TensorBroadcast);
assert.deepStrictEqual(arena.getExprTensorShape(broadcastExpr), [10, 20]);

// Matrix Multiplication: U %*% V
const matmulExpr = arena.addTensorMatMul(uExpr, vExpr);
assert.strictEqual(arena.getExprKind(matmulExpr), ExprKind.TensorMatMul);
assert.strictEqual(arena.getExprLeft(matmulExpr), uExpr);
assert.strictEqual(arena.getExprRight(matmulExpr), vExpr);

// Tensor Reduction: sum(U, axis=1)
const reduceSumExpr = arena.addTensorReduce(uExpr, TensorReduceOp.Sum, 1);
assert.strictEqual(arena.getExprKind(reduceSumExpr), ExprKind.TensorReduce);
assert.strictEqual(arena.getExprData1(reduceSumExpr), TensorReduceOp.Sum);
assert.strictEqual(arena.getExprLeft(reduceSumExpr), uExpr);
assert.strictEqual(arena.getExprRight(reduceSumExpr), 1);

console.log("  ✔ Tensor expression nodes constructed and registered in DAE arena");

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Array Equation Preservation Without Scalarization
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 3: Preserving vector/tensor equations (EqKind.Array)...");

// Equation: der(U) = broadcast(V, [10, 20])
const derUExpr = arena.addDerExpr(uExpr);
const eqIdx = arena.addArrayEquation(derUExpr, broadcastExpr, [10, 20]);

assert.strictEqual(arena.getEqKind(eqIdx), EqKind.Array);
assert.strictEqual(arena.getEqLhs(eqIdx), derUExpr);
assert.strictEqual(arena.getEqRhs(eqIdx), broadcastExpr);
assert.deepStrictEqual(arena.getEquationShape(eqIdx), [10, 20]);
console.log("  ✔ Preserved array equation registered without scalarization blowup");

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: ArenaDAEPrinter Formatting
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 4: ArenaDAEPrinter pretty-printing for tensor expressions...");

const printedCode = printArenaDAE(arena);
assert.ok(
  printedCode.includes("der(U) = broadcast(V, shape=[10, 20]);"),
  `Expected array equation in output: ${printedCode}`,
);
console.log("  ✔ Pretty printer rendered preserved array equation correctly");

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Symbolic Differentiation of Tensor Expressions
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 5: Symbolic differentiation of tensor expressions...");

// d/dU (U %*% V) wrt U: should produce (1 * V + U * 0)
const dMatmul_dU = differentiateArenaExpression(arena, matmulExpr, "U");
assert.ok(dMatmul_dU >= 0);
assert.strictEqual(arena.getExprKind(dMatmul_dU), ExprKind.Binary);

// d/dU (sum(U, axis=1)) wrt U: should produce sum(1, axis=1)
const dReduce_dU = differentiateArenaExpression(arena, reduceSumExpr, "U");
assert.strictEqual(arena.getExprKind(dReduce_dU), ExprKind.TensorReduce);

console.log("  ✔ Symbolic differentiation through tensor operators verified");

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: BLT Dependency Collection
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTest 6: BLT dependency analysis on tensor operations...");

const deps = new Set<number>();
collectArenaExprDeps(arena, matmulExpr, deps);
assert.ok(deps.has(uIdx), "Deps must contain variable U");
assert.ok(deps.has(vIdx), "Deps must contain variable V");

const sliceDeps = new Set<number>();
collectArenaExprDeps(arena, sliceExpr, sliceDeps);
assert.ok(sliceDeps.has(uIdx), "Deps must contain variable U");

console.log("  ✔ BLT dependency tracking correctly resolved tensor operands");

console.log("\n=== All Symbolic Tensor Primitives Tests Passed Cleanly ===");
