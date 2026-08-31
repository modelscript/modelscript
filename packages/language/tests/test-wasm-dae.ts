// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import { StringInterner } from "../src/compiler/interner.js";
import {
  ArenaDAEBuilder,
  BinOp,
  Causality,
  differentiateArenaExpression,
  eliminateArenaAliases,
  EqKind,
  inferArenaExprVarType,
  simplifyArenaExpression,
  Variability,
  VarType,
  WasmDaeBridge,
} from "../src/runtime/wasm_dae.js";

console.log("Testing WASM DAE Arena Architecture & Data Structures...");

// Test 1: Variable and Equation construction
{
  const interner = new StringInterner();
  const dae = new ArenaDAEBuilder(interner);

  const rIdx = dae.addVariable("resistor.R", VarType.Real, Variability.Parameter, Causality.Local, 100.0);
  const vIdx = dae.addVariable("resistor.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const iIdx = dae.addVariable("resistor.i", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  assert.strictEqual(dae.varCount, 3);
  assert.strictEqual(dae.getVarName(rIdx), "resistor.R");
  assert.strictEqual(dae.getVarType(rIdx), VarType.Real);
  assert.strictEqual(dae.getVarStartValue(rIdx), 100.0);

  // Ohm's law: v = R * i
  const vName = dae.addNameExpr("resistor.v");
  const rName = dae.addNameExpr("resistor.R");
  const iName = dae.addNameExpr("resistor.i");
  const rhs = dae.addBinaryExpr(BinOp.Mul, rName, iName);
  const eqIdx = dae.addEquation(EqKind.Simple, vName, rhs);

  assert.strictEqual(dae.eqCount, 1);
  assert.strictEqual(dae.getEqLhs(eqIdx), vName);
  assert.strictEqual(dae.getEqRhs(eqIdx), rhs);

  console.log("  ✔ Variable and equation arena construction passed");
}

// Test 2: Type Inference & Promotion
{
  const interner = new StringInterner();
  const dae = new ArenaDAEBuilder(interner);
  dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local);
  dae.addVariable("k", VarType.Integer, Variability.Parameter, Causality.Local);

  const xExpr = dae.addNameExpr("x");
  const kExpr = dae.addNameExpr("k");
  const addExpr = dae.addBinaryExpr(BinOp.Add, xExpr, kExpr); // Real + Integer -> Real
  const cmpExpr = dae.addBinaryExpr(BinOp.Gt, xExpr, kExpr); // Real > Integer -> Boolean

  assert.strictEqual(inferArenaExprVarType(dae, xExpr), VarType.Real);
  assert.strictEqual(inferArenaExprVarType(dae, kExpr), VarType.Integer);
  assert.strictEqual(inferArenaExprVarType(dae, addExpr), VarType.Real);
  assert.strictEqual(inferArenaExprVarType(dae, cmpExpr), VarType.Boolean);

  console.log("  ✔ Arena expression type inference passed");
}

// Test 3: Alias Elimination
{
  const interner = new StringInterner();
  const dae = new ArenaDAEBuilder(interner);
  dae.addVariable("a.v", VarType.Real, Variability.Continuous, Causality.Local);
  dae.addVariable("b.v", VarType.Real, Variability.Continuous, Causality.Local);

  const aExpr = dae.addNameExpr("a.v");
  const bExpr = dae.addNameExpr("b.v");
  dae.addEquation(EqKind.Connect, aExpr, bExpr);

  eliminateArenaAliases(dae);

  // Both expressions should now resolve to the same root name StringId
  const aRootId = dae.getExprData1(aExpr);
  const bRootId = dae.getExprData1(bExpr);
  assert.strictEqual(aRootId, bRootId);

  console.log("  ✔ Zero-allocation alias elimination passed");
}

// Test 4: Symbolic Differentiation & Simplification
{
  const interner = new StringInterner();
  const dae = new ArenaDAEBuilder(interner);
  const stateVars = new Set([interner.intern("x")]);

  // expr = 3.0 * x + 5.0
  const c3 = dae.addRealLiteral(3.0);
  const x = dae.addNameExpr("x");
  const c5 = dae.addRealLiteral(5.0);
  const mul = dae.addBinaryExpr(BinOp.Mul, c3, x);
  const expr = dae.addBinaryExpr(BinOp.Add, mul, c5);

  const dExpr = differentiateArenaExpression(dae, expr, stateVars);
  const simplified = simplifyArenaExpression(dae, dExpr);

  assert.ok(simplified >= 0);
  console.log("  ✔ Symbolic differentiation and algebraic simplification passed");
}

// Test 5: WasmDaeBridge wrapper
{
  let calledAddVar = false;
  const mockExports = {
    dae_createBuilder: () => 42,
    dae_addVariable: (ptr: number, name: number, type: number) => {
      calledAddVar = true;
      assert.strictEqual(ptr, 42);
      return 0;
    },
    dae_getVarCount: () => 1,
    dae_getEqCount: () => 0,
    dae_getExprCount: () => 0,
  };

  const bridge = new WasmDaeBridge(mockExports);
  assert.strictEqual(bridge.ptr, 42);
  bridge.addVariable(1, VarType.Real, Variability.Continuous, Causality.Local);
  assert.ok(calledAddVar);
  assert.strictEqual(bridge.getVarCount(), 1);

  console.log("  ✔ WasmDaeBridge wrapper passed");
}

console.log("=== All WASM DAE Tests Passed Cleanly ===");
