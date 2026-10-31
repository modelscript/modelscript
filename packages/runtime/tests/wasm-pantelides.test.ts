// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  analyzeStructuralDaeIndex,
  computePryceSignatureMatrix,
  containsDerivative,
  pantelidesIndexReductionArena,
  WasmPantelides,
} from "../src/analysis/wasm_pantelides.js";
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

// Test 6: Pryce Sigma-Method & Pantelides on Index-3 Cartesian Pendulum
//   der(x) = vx
//   der(y) = vy
//   m * der(vx) = -x * T
//   m * der(vy) = -y * T - m * g
//   x^2 + y^2 = L^2
{
  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const y = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const vx = arena.addVariable("vx", VarType.Real, Variability.Continuous);
  const vy = arena.addVariable("vy", VarType.Real, Variability.Continuous);
  const T = arena.addVariable("T", VarType.Real, Variability.Continuous);
  const m = arena.addVariable("m", VarType.Real, Variability.Parameter);
  const g = arena.addVariable("g", VarType.Real, Variability.Parameter);
  const L = arena.addVariable("L", VarType.Real, Variability.Parameter);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derY = arena.addVariable("der(y)", VarType.Real, Variability.Continuous);
  const derVx = arena.addVariable("der(vx)", VarType.Real, Variability.Continuous);
  const derVy = arena.addVariable("der(vy)", VarType.Real, Variability.Continuous);

  const stateVars = new Set<number>([x, y, vx, vy]);
  const derivativeVars = new Set<number>([derX, derY, derVx, derVy]);
  const parameters = new Set<number>([m, g, L]);

  // Eq 0: der(x) = vx
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("x")), arena.addNameExpr("vx"));
  // Eq 1: der(y) = vy
  arena.addEquation(EqKind.Simple, arena.addDerExpr(arena.addNameExpr("y")), arena.addNameExpr("vy"));
  // Eq 2: m * der(vx) = -x * T
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("m"), arena.addDerExpr(arena.addNameExpr("vx"))),
    arena.addBinaryExpr(BinOp.Mul, arena.addNegateExpr(arena.addNameExpr("x")), arena.addNameExpr("T")),
  );
  // Eq 3: m * der(vy) = -y * T - m * g
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("m"), arena.addDerExpr(arena.addNameExpr("vy"))),
    arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(BinOp.Mul, arena.addNegateExpr(arena.addNameExpr("y")), arena.addNameExpr("T")),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("m"), arena.addNameExpr("g")),
    ),
  );
  // Eq 4: x * x + y * y = L * L
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("x"), arena.addNameExpr("x")),
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("y"), arena.addNameExpr("y")),
    ),
    arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("L"), arena.addNameExpr("L")),
  );

  // Verify Pryce Sigma-method signature matrix and dual offsets (c_i, d_j)
  const sig = computePryceSignatureMatrix(arena, stateVars, derivativeVars, parameters);
  assert.strictEqual(sig.structuralIndex, 3, "Pryce Sigma-method must detect Index-3 for Cartesian pendulum");
  assert.deepStrictEqual(sig.c, [1, 1, 0, 0, 2], "Pryce equation differentiation offsets c_i must be [1, 1, 0, 0, 2]");
  assert.deepStrictEqual(sig.d, [2, 2, 1, 1, 0], "Pryce variable derivative orders d_j must be [2, 2, 1, 1, 0]");

  const analysis = analyzeStructuralDaeIndex(arena, stateVars, derivativeVars, parameters);
  assert.strictEqual(analysis.structuralIndex, 3);
  assert.strictEqual(analysis.equationDiffOrders.get(4), 2, "Holonomic constraint eq 4 must have diff order 2");
  assert.strictEqual(analysis.variableOrders.get(T), 0, "Algebraic tension T must have derivative order 0");

  // Run Pantelides index reduction on the Cartesian pendulum
  const red = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameters);
  assert.strictEqual(red.structuralIndex, 3, "Pantelides reduction must report structural index 3");
  assert.strictEqual(red.dummyDerivatives.size, 2, "Expected 2 dummy derivatives (1 position, 1 velocity)");
  assert.strictEqual(red.generatedEquations.length, 2, "Expected 2 generated constraint equations");
  const accelEqIdx = red.generatedEquations[1]!;
  assert.strictEqual(
    containsDerivative(arena, arena.getEqLhs(accelEqIdx)),
    true,
    "Second differentiated constraint must contain acceleration derivatives der(vx), der(vy)",
  );
  console.log("  ✔ Index-3 Cartesian Pendulum Pryce Sigma-method & Pantelides reduction passed");
}

// Test 7: Coupled Multi-Equation Structural Singularity via Bipartite Augmenting-Path MSS
//   Eq 0: der(x) - (x + y) = 0
//   Eq 1: der(x) + 2 * y = 0
// Both equations contain der(x) and neither contains der(y) -> Hall MSS subset {Eq 0, Eq 1}!
{
  const arena = new DAEBuilder();
  const x = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const y = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const derX = arena.addVariable("der(x)", VarType.Real, Variability.Continuous);
  const derY = arena.addVariable("der(y)", VarType.Real, Variability.Continuous);

  const stateVars = new Set<number>([x, y]);
  const derivativeVars = new Set<number>([derX, derY]);
  const parameters = new Set<number>();

  // Eq 0: der(x) - (x + y) = 0
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Sub,
      arena.addDerExpr(arena.addNameExpr("x")),
      arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x"), arena.addNameExpr("y")),
    ),
    arena.addRealLiteral(0.0),
  );
  // Eq 1: der(x) + 2 * y = 0
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addDerExpr(arena.addNameExpr("x")),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("y")),
    ),
    arena.addRealLiteral(0.0),
  );

  const analysis = analyzeStructuralDaeIndex(arena, stateVars, derivativeVars, parameters);
  assert(analysis.singularSubsets.length >= 1, "Must detect coupled singular subset {0, 1}");

  const res = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameters);
  assert.strictEqual(res.structuralIndex, 2, "Coupled derivative-sharing singularity must reduce as Index-2");
  assert.strictEqual(res.dummyDerivatives.size, 1, "Must select 1 dummy derivative state");
  assert.strictEqual(res.generatedEquations.length, 1, "Must generate 1 differentiated equation");
  console.log("  ✔ Coupled multi-equation MSS bipartite augmenting-path reduction passed");
}

console.log("=== All Pantelides Index Reduction Tests Passed Cleanly ===");
