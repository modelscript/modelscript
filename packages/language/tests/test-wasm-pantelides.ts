// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/runtime/wasm_dae.js";
import { containsDerivative, pantelidesIndexReductionArena, WasmPantelides } from "../src/runtime/wasm_pantelides.js";

console.log("Testing Pantelides Index Reduction & WASM Runtime...");

// Test 1: Contains derivative checks
{
  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);

  const nameExpr = arena.addNameExpr(arena.getVarNameId(x));
  const derExpr = arena.addDerExpr(nameExpr);
  const sumExpr = arena.addBinaryExpr(BinOp.Add, nameExpr, derExpr);
  const constExpr = arena.addRealLiteral(10.0);

  assert.strictEqual(containsDerivative(arena, nameExpr), false);
  assert.strictEqual(containsDerivative(arena, constExpr), false);
  assert.strictEqual(containsDerivative(arena, derExpr), true);
  assert.strictEqual(containsDerivative(arena, sumExpr), true);
  console.log("  ✔ containsDerivative passed");
}

// Test 2: Index Reduction on Parallel Capacitors (x - y = 0)
{
  const arena = new DAEBuilder();

  // Variables: x, y (states), der(x), der(y) (derivatives)
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const y = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derY = arena.addVariable("der(y)", VarType.Real, Variability.Continuous);

  const stateVars = new Set<number>([x, y]);
  const derivativeVars = new Set<number>([derX, derY]);
  const parameters = new Set<number>();

  // Equation 0: x - y = 0 (algebraic constraint between 2 states)
  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");
  const subExpr = arena.addBinaryExpr(BinOp.Sub, xExpr, yExpr);
  const zeroExpr = arena.addRealLiteral(0.0);
  arena.addEquation(EqKind.Simple, subExpr, zeroExpr);

  // Run Pantelides
  const result = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameters);

  assert.strictEqual(result.dummyDerivatives.size, 1, "Expected 1 dummy derivative");
  assert.strictEqual(result.generatedEquations.length, 1, "Expected 1 differentiated constraint equation");
  assert.strictEqual(result.structuralIndex, 2, "Expected structural index 2");

  // Check generated equation (new eq index should be 1)
  const newEqIdx = result.generatedEquations[0]!;
  assert.strictEqual(arena.getEqKind(newEqIdx), EqKind.Simple);
  console.log("  ✔ Pantelides index reduction on constrained states passed");
}

// Test 3: WasmPantelides wrapper fallback
{
  const mockWasm = {
    exports: {
      runPantelidesIndexReduction: (_daePtr: number, _bltPtr: number) => 0,
      getPantelidesStructuralIndex: () => 2,
      getPantelidesDummyDerivativeCount: () => 1,
    },
  };
  const wasmPantelides = new WasmPantelides(mockWasm);
  const res = wasmPantelides.reduceIndex(100, 200);
  assert.strictEqual(res.structuralIndex, 2);
  assert.strictEqual(res.dummyDerivativeCount, 1);
  console.log("  ✔ WasmPantelides wrapper passed");
}

console.log("=== All Pantelides Index Reduction Tests Passed Cleanly ===");
