// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { containsDerivative, pantelidesIndexReductionArena, WasmPantelides } from "../src/analysis/wasm_pantelides.js";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/dae/wasm_dae.js";

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

  // Check generated equation (new eq index should be 1): der(x) - der(y) = 0
  const newEqIdx = result.generatedEquations[0]!;
  assert.strictEqual(arena.getEqKind(newEqIdx), EqKind.Simple);
  const diffLhs = arena.getEqLhs(newEqIdx);
  assert.strictEqual(arena.getExprData1(diffLhs), BinOp.Sub);
  assert.strictEqual(containsDerivative(arena, arena.getExprLeft(diffLhs)), true);
  assert.strictEqual(containsDerivative(arena, arena.getExprRight(diffLhs)), true);
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

// Test 4: Mattsson-Söderlind Dynamic State Selection
{
  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const y = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derY = arena.addVariable("der(y)", VarType.Real, Variability.Continuous);

  const stateVars = new Set<number>([x, y]);
  const derivativeVars = new Set<number>([derX, derY]);
  const parameters = new Set<number>();

  const subExpr = arena.addBinaryExpr(BinOp.Sub, arena.addNameExpr("x"), arena.addNameExpr("y"));
  arena.addEquation(EqKind.Simple, subExpr, arena.addRealLiteral(0.0));

  // Case A: Prioritize y to be the dummy derivative (leaving x as independent state)
  const resultA = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameters, {
    statePriority: (varIdx) => (varIdx === y ? 10 : 1),
  });
  assert(resultA.dummyDerivatives.has(y), "Mattsson-Söderlind must pick prioritized state y as dummy derivative");
  assert.strictEqual(resultA.stateSelectionMap?.get(0), y, "Mapping must record eq 0 -> state y");

  // Case B: In a new arena, prioritize x to be the dummy derivative (leaving y as independent state)
  const arenaB = new DAEBuilder();
  const xB = arenaB.addVariable("x", VarType.Real, Variability.Continuous);
  const yB = arenaB.addVariable("y", VarType.Real, Variability.Continuous);
  const derXB = arenaB.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derYB = arenaB.addVariable("der(y)", VarType.Real, Variability.Continuous);
  const subExprB = arenaB.addBinaryExpr(BinOp.Sub, arenaB.addNameExpr("x"), arenaB.addNameExpr("y"));
  arenaB.addEquation(EqKind.Simple, subExprB, arenaB.addRealLiteral(0.0));

  const resultB = pantelidesIndexReductionArena(arenaB, new Set([xB, yB]), new Set([derXB, derYB]), new Set(), {
    statePriority: (varIdx) => (varIdx === xB ? 10 : 1),
  });
  assert(resultB.dummyDerivatives.has(xB), "Mattsson-Söderlind must pick prioritized state x as dummy derivative");
  assert.strictEqual(resultB.stateSelectionMap?.get(0), xB, "Mapping must record eq 0 -> state x");
  console.log("  ✔ Mattsson-Söderlind dynamic state selection passed");
}

// Test 5: Multi-step Index-3 holonomic constraint (der(x) = vx, der(y) = vy, x + y = 1)
{
  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const y = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const vx = arena.addVariable("vx", VarType.Real, Variability.Continuous);
  const vy = arena.addVariable("vy", VarType.Real, Variability.Continuous);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derY = arena.addVariable("der(y)", VarType.Real, Variability.Continuous);
  const derVx = arena.addVariable("der(vx)", VarType.Real, Variability.Continuous);
  const derVy = arena.addVariable("der(vy)", VarType.Real, Variability.Continuous);

  const stateVars = new Set<number>([x, y, vx, vy]);
  const derivativeVars = new Set<number>([derX, derY, derVx, derVy]);
  const parameters = new Set<number>();

  // der(x) = vx
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("x")), arena.addNameExpr("vx"));
  // der(y) = vy
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("y")), arena.addNameExpr("vy"));
  // Position constraint: x + y = 1.0 (Index-3 constraint because der(x)=vx, der(y)=vy)
  const posConstraint = arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x"), arena.addNameExpr("y"));
  arena.addEquation(EqKind.Simple, posConstraint, arena.addRealLiteral(1.0));

  const res = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameters);
  assert.strictEqual(res.structuralIndex, 3, "Expected structural index 3 for holonomic position constraint");
  assert.strictEqual(res.dummyDerivatives.size, 2, "Expected 2 dummy derivatives (1 position + 1 velocity)");
  assert.strictEqual(res.generatedEquations.length, 2, "Expected 2 differentiated equations (velocity + acceleration)");
  console.log("  ✔ Multi-step Index-3 holonomic constraint Pantelides reduction passed");
}

console.log("=== All Pantelides Index Reduction Tests Passed Cleanly ===");
