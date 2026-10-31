// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  collectArenaExprDeps,
  initBltWasm,
  performBltTransformationArena,
  tearBltBlock,
  tearBltBlocksArena,
} from "../src/analysis/wasm_blt.js";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/dae/wasm_dae.js";

console.log("Testing Kron's Algebraic Loop Tearing in BLT...");

await initBltWasm();

// Test 1: 4x4 coupled algebraic loop torn to 1 tearing variable + 3 causal equations
// System:
//   Eq 0: x2 - 2 * x1 = 1
//   Eq 1: x3 - x2 - x1 = 0
//   Eq 2: x4 - 3 * x3 + x2 = 5
//   Eq 3: x1 + x2 + x3 + sin(x4) = 10   (nonlinear feedback closing the 4x4 loop)
// Choosing x1 (or x4) tears the 4x4 block into 1 tearing variable, 3 strictly lower-triangular
// linear causal equations, and 1 nonlinear residual equation (Eq 3).
{
  const arena = new DAEBuilder();
  const x1 = arena.addVariable("x1", VarType.Real, Variability.Continuous);
  const x2 = arena.addVariable("x2", VarType.Real, Variability.Continuous);
  const x3 = arena.addVariable("x3", VarType.Real, Variability.Continuous);
  const x4 = arena.addVariable("x4", VarType.Real, Variability.Continuous);

  // Eq 0: x2 - 2 * x1 = 1
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Sub,
      arena.addNameExpr("x2"),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("x1")),
    ),
    arena.addRealLiteral(1.0),
  );

  // Eq 1: x3 - x2 - x1 = 0
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(BinOp.Sub, arena.addNameExpr("x3"), arena.addNameExpr("x2")),
      arena.addNameExpr("x1"),
    ),
    arena.addRealLiteral(0.0),
  );

  // Eq 2: x4 - 3 * x3 + x2 = 5
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(
        BinOp.Sub,
        arena.addNameExpr("x4"),
        arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), arena.addNameExpr("x3")),
      ),
      arena.addNameExpr("x2"),
    ),
    arena.addRealLiteral(5.0),
  );

  // Eq 3: x1 + x2 + x3 + sin(x4) = 10
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(
        BinOp.Add,
        arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x1"), arena.addNameExpr("x2")),
        arena.addNameExpr("x3"),
      ),
      arena.addCallExpr("sin", [arena.addNameExpr("x4")]),
    ),
    arena.addRealLiteral(10.0),
  );

  const blt = performBltTransformationArena(arena);
  assert.strictEqual(blt.blocks.length, 1, "Expected a single 4x4 strongly connected BLT block");

  const block = blt.blocks[0]!;
  assert.strictEqual(block.eqIdxs.length, 4);
  assert.strictEqual(block.vars.length, 4);
  assert.ok(block.tearing, "Expected Kron's tearing metadata on 4x4 algebraic loop block");

  const tearing = block.tearing!;
  assert.strictEqual(tearing.tearingVars.length, 1, "4x4 loop must be torn to 1 tearing variable");
  assert.strictEqual(tearing.residualEqs.length, 1, "4x4 loop must have 1 residual equation");
  assert.strictEqual(tearing.causalChain.length, 3, "4x4 loop must have 3 causal equations");

  // Prefer linear pivots: x4 appears inside sin(x4) in Eq 3, so tearing x1 (or solving linearly
  // and keeping Eq 3 as residual) avoids inverting sin(x4).
  assert.deepStrictEqual(tearing.tearingVars, [x1], "Should select x1 as tearing variable to keep causal chain linear");
  assert.deepStrictEqual(tearing.residualEqs, [3], "Nonlinear equation Eq 3 should be the residual equation");

  // Verify strict lower-triangular causality of causalChain
  const knownVars = new Set<number>(tearing.tearingVars);
  for (const step of tearing.causalChain) {
    assert.strictEqual(knownVars.has(step.solvedVar), false, "Causal variable must not already be known");
    const eqDeps = new Set<number>();
    collectArenaExprDeps(arena, arena.getEqLhs(step.eqIdx), eqDeps, true);
    collectArenaExprDeps(arena, arena.getEqRhs(step.eqIdx), eqDeps, true);
    assert.strictEqual(eqDeps.has(step.solvedVar), true, "Causal equation must depend on its solvedVar");
    for (const dep of eqDeps) {
      if (dep !== step.solvedVar) {
        assert.strictEqual(
          knownVars.has(dep),
          true,
          `Causal eq ${step.eqIdx} solving var ${step.solvedVar} depends on unknown var ${dep}`,
        );
      }
    }
    knownVars.add(step.solvedVar);
  }
  assert.strictEqual(knownVars.size, 4, "All 4 block variables must be covered by tearingVars + causalChain");
  console.log("  ✔ 4x4 algebraic loop torn to 1 tearing variable + 3 causal equations passed");
}

// Test 2: Coupled 5x5 algebraic block requiring 2 tearing variables
// Two coupled loops sharing variables:
//   Eq 0: y2 = 2 * y1 + y5
//   Eq 1: y3 = y2 + y1
//   Eq 2: y1 = y3 - y4
//   Eq 3: y5 = 3 * y4 + y2
//   Eq 4: y4 = y5 * y5 + y3
{
  const arena = new DAEBuilder();
  const y1 = arena.addVariable("y1", VarType.Real, Variability.Continuous);
  const y2 = arena.addVariable("y2", VarType.Real, Variability.Continuous);
  const y3 = arena.addVariable("y3", VarType.Real, Variability.Continuous);
  const y4 = arena.addVariable("y4", VarType.Real, Variability.Continuous);
  const y5 = arena.addVariable("y5", VarType.Real, Variability.Continuous);

  // Eq 0: y2 = 2 * y1 + y5
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y2"),
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("y1")),
      arena.addNameExpr("y5"),
    ),
  );
  // Eq 1: y3 = y2 + y1
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y3"),
    arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("y2"), arena.addNameExpr("y1")),
  );
  // Eq 2: y1 = y3 - y4
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y1"),
    arena.addBinaryExpr(BinOp.Sub, arena.addNameExpr("y3"), arena.addNameExpr("y4")),
  );
  // Eq 3: y5 = 3 * y4 + y2
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y5"),
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), arena.addNameExpr("y4")),
      arena.addNameExpr("y2"),
    ),
  );
  // Eq 4: y4 = y5 * y5 + y3
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y4"),
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addNameExpr("y5"), arena.addNameExpr("y5")),
      arena.addNameExpr("y3"),
    ),
  );

  const tearing = tearBltBlock(arena, [0, 1, 2, 3, 4], [y1, y2, y3, y4, y5]);
  assert.strictEqual(tearing.tearingVars.length, 2, "5x5 two-loop block must be torn to 2 tearing variables");
  assert.strictEqual(tearing.residualEqs.length, 2, "5x5 two-loop block must have 2 residual equations");
  assert.strictEqual(tearing.causalChain.length, 3, "5x5 two-loop block must have 3 causal equations");

  const blocks = tearBltBlocksArena(arena, [{ eqIdxs: [0, 1, 2, 3, 4], vars: [y1, y2, y3, y4, y5] }]);
  assert.ok(blocks[0]!.tearing);
  assert.strictEqual(blocks[0]!.tearing!.tearingVars.length, 2);

  // Verify strict lower-triangular causality
  const knownVars = new Set<number>(tearing.tearingVars);
  for (const step of tearing.causalChain) {
    const eqDeps = new Set<number>();
    collectArenaExprDeps(arena, arena.getEqLhs(step.eqIdx), eqDeps, true);
    collectArenaExprDeps(arena, arena.getEqRhs(step.eqIdx), eqDeps, true);
    for (const dep of eqDeps) {
      if (dep !== step.solvedVar) {
        assert.strictEqual(knownVars.has(dep), true, `Causal step depends on unsolved variable ${dep}`);
      }
    }
    knownVars.add(step.solvedVar);
  }
  assert.strictEqual(knownVars.size, 5);
  console.log("  ✔ 5x5 two-loop algebraic block Kron tearing passed");
}

console.log("=== All Kron's Algebraic Loop Tearing Tests Passed Cleanly ===");
