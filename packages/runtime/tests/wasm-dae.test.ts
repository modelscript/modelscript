// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  BinOp,
  Causality,
  DAEBuilder,
  differentiateArenaExpression,
  eliminateArenaAliases,
  EqKind,
  inferArenaExprVarType,
  simplifyArenaExpression,
  Variability,
  VarType,
  WasmDaeBridge,
} from "../src/dae/wasm_dae.js";
import {
  Dual,
  evaluateArenaDualExpression,
  evaluateArenaDualFlat,
  evaluateArenaRuntime,
} from "../src/dae/wasm_evaluator.js";
import { StringInterner } from "../src/workspace/wasm_string_pool.js";

console.log("Testing WASM DAE Arena Architecture & Data Structures...");

// Test 1: Variable and Equation construction
{
  const interner = new StringInterner();
  const dae = new DAEBuilder(interner);

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
  const dae = new DAEBuilder(interner);
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
  const dae = new DAEBuilder(interner);
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
  const dae = new DAEBuilder(interner);
  const xNameId = interner.intern("x");
  const stateVars = new Set([xNameId]);

  // expr = 3.0 * x + 5.0
  const c3 = dae.addRealLiteral(3.0);
  const x = dae.addNameExpr("x");
  const c5 = dae.addRealLiteral(5.0);
  const mul = dae.addBinaryExpr(BinOp.Mul, c3, x);
  const expr = dae.addBinaryExpr(BinOp.Add, mul, c5);

  // Total time derivative d/dt(3.0 * x + 5.0) -> simplified to 3.0 * der(x)
  const dExpr = differentiateArenaExpression(dae, expr, stateVars);
  const simplified = simplifyArenaExpression(dae, dExpr);

  assert.ok(simplified >= 0);
  // simplified must be Binary(Mul, 3.0, der(x)) since + 0.0 and 0.0 * x were eliminated
  assert.strictEqual(dae.getExprLeft(simplified), c3);
  const rhsDer = dae.getExprRight(simplified);
  assert.strictEqual(dae.getExprData1(dae.getExprData1(rhsDer)), xNameId);

  // Verify x - x simplifies to 0.0
  const subSelf = dae.addBinaryExpr(BinOp.Sub, x, x);
  const zeroSimplified = simplifyArenaExpression(dae, subSelf);
  assert.strictEqual(dae.getExprRealValue(zeroSimplified), 0.0);

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

// Test 6: Alias Attribute Propagation, Homotopy Dual AD, and Discrete Built-ins
{
  const interner = new StringInterner();
  const dae = new DAEBuilder(interner);
  const vA = dae.addVariable("a.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const vB = dae.addVariable("b.v", VarType.Real, Variability.Continuous, Causality.Local, 12.5);
  dae.setVarFixed(vB, true);

  dae.addEquation(EqKind.Connect, dae.addNameExpr("a.v"), dae.addNameExpr("b.v"));
  eliminateArenaAliases(dae);
  assert.strictEqual(dae.getVarStartValue(vA), 12.5, "Start value should propagate to root alias");
  assert.strictEqual(dae.isVarFixed(vA), true, "Fixed attribute should propagate to root alias");

  // Homotopy Dual AD: homotopy(x^2, 2*x) at x = 3, lambda = 0.25 -> val = 0.25*9 + 0.75*6 = 6.75, dot = 0.25*6 + 0.75*2 = 3.0
  const xId = interner.intern("x");
  const xExpr = dae.addNameExpr("x");
  const actualExpr = dae.addBinaryExpr(BinOp.Mul, xExpr, xExpr);
  const simpExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), xExpr);
  const homExpr = dae.addCallExpr("homotopy", [actualExpr, simpExpr]);
  dae.homotopyLambda = 0.25;

  const dualEnv: Dual[] = [];
  dualEnv[xId] = new Dual(3.0, 1.0);
  const dRes = evaluateArenaDualExpression(dae, homExpr, dualEnv);
  assert.ok(dRes !== null);
  assert.ok(Math.abs(dRes.val - 6.75) < 1e-12);
  assert.ok(Math.abs(dRes.dot - 3.0) < 1e-12);

  const env = new Float64Array(interner.size + 16);
  env[xId] = 3.0;
  const stack = new Float64Array(16);
  const okFlat = evaluateArenaDualFlat(dae, homExpr, env, xId, stack, 0);
  assert.strictEqual(okFlat, true);
  assert.ok(Math.abs(stack[0]! - 6.75) < 1e-12);
  assert.ok(Math.abs(stack[1]! - 3.0) < 1e-12);

  // Discrete built-ins: initial(), sample(1.0, 0.5), edge(b), change(k), delay(x, 0.5)
  const timeId = interner.intern("time");
  const bId = interner.intern("b");
  const initCall = dae.addCallExpr("initial", []);
  const sampleCall = dae.addCallExpr("sample", [dae.addRealLiteral(1.0), dae.addRealLiteral(0.5)]);
  const edgeCall = dae.addCallExpr("edge", [dae.addNameExpr("b")]);
  const changeCall = dae.addCallExpr("change", [dae.addNameExpr("x")]);
  const delayCall = dae.addCallExpr("delay", [dae.addNameExpr("x"), dae.addRealLiteral(0.5)]);

  (dae as any)._isInitialPhase = true;
  assert.strictEqual(evaluateArenaRuntime(dae, initCall, env), 1);
  (dae as any)._isInitialPhase = false;

  env[timeId] = 1.5;
  assert.strictEqual(evaluateArenaRuntime(dae, sampleCall, env), 1);
  env[timeId] = 1.25;
  assert.strictEqual(evaluateArenaRuntime(dae, sampleCall, env), 0);

  const preEnv = new Float64Array(env.length);
  preEnv[bId] = 0;
  env[bId] = 1;
  assert.strictEqual(evaluateArenaRuntime(dae, edgeCall, env, preEnv), 1);
  preEnv[xId] = 2.0;
  env[xId] = 3.0;
  assert.strictEqual(evaluateArenaRuntime(dae, changeCall, env, preEnv), 1);

  // Delay interpolation: at t=0, x=10; at t=1, x=20; delay(x, 0.5) at t=1 -> 15
  env[timeId] = 0.0;
  env[xId] = 10.0;
  assert.strictEqual(evaluateArenaRuntime(dae, delayCall, env), 10.0);
  env[timeId] = 1.0;
  env[xId] = 20.0;
  assert.ok(Math.abs(evaluateArenaRuntime(dae, delayCall, env) - 15.0) < 1e-12);

  console.log("  ✔ Alias attribute propagation, homotopy Dual AD, and discrete built-ins passed");
}

console.log("=== All WASM DAE Tests Passed Cleanly ===");
