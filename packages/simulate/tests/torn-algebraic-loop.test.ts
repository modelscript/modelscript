// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, initBltWasm, Variability, VarType } from "@modelscript/runtime";
import assert from "node:assert";
import { ArenaSimulator } from "../src/core/simulate-arena.js";

console.log("=== Testing Simulation Runner Algebraic Loop Tearing Execution ===");

await initBltWasm();

// Test 1: 4x4 coupled nonlinear algebraic loop torn to 1 tearing variable
// System:
//   Eq 0: x2 = 1 + 2 * x1
//   Eq 1: x3 = x2 + x1
//   Eq 2: x4 = 5 + 3 * x3 - x2
//   Eq 3: x1 + x2 + x3 + sin(x4) = 10 (nonlinear feedback closing the 4x4 loop)
{
  console.log("\nTest 1: 4x4 Coupled Nonlinear Loop Torn to 1 Tearing Variable...");
  const arena = new DAEBuilder();
  const x1 = arena.addVariable("x1", VarType.Real, Variability.Continuous);
  const x2 = arena.addVariable("x2", VarType.Real, Variability.Continuous);
  const x3 = arena.addVariable("x3", VarType.Real, Variability.Continuous);
  const x4 = arena.addVariable("x4", VarType.Real, Variability.Continuous);

  // Eq 0: x2 = 1 + 2 * x1
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("x2"),
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addRealLiteral(1.0),
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("x1")),
    ),
  );

  // Eq 1: x3 = x2 + x1
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("x3"),
    arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x2"), arena.addNameExpr("x1")),
  );

  // Eq 2: x4 = 5 + 3 * x3 - x2
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("x4"),
    arena.addBinaryExpr(
      BinOp.Sub,
      arena.addBinaryExpr(
        BinOp.Add,
        arena.addRealLiteral(5.0),
        arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(3.0), arena.addNameExpr("x3")),
      ),
      arena.addNameExpr("x2"),
    ),
  );

  // Eq 3: x1 + x2 + x3 + sin(x4) = 10
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x1"), arena.addNameExpr("x2")),
      arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("x3"), arena.addCallExpr("sin", [arena.addNameExpr("x4")])),
    ),
    arena.addRealLiteral(10.0),
  );

  const sim = new ArenaSimulator(arena);
  sim.prepare();
  const env = new Float64Array(arena.interner.size + 10);
  sim.evaluateBlocks(env);

  const v1 = env[arena.getVarNameId(x1)]!;
  const v2 = env[arena.getVarNameId(x2)]!;
  const v3 = env[arena.getVarNameId(x3)]!;
  const v4 = env[arena.getVarNameId(x4)]!;

  console.log(`  Solved values: x1=${v1.toFixed(6)}, x2=${v2.toFixed(6)}, x3=${v3.toFixed(6)}, x4=${v4.toFixed(6)}`);

  // Verify all 4 equations are satisfied to high accuracy (< 1e-8)
  const res0 = Math.abs(v2 - (1.0 + 2.0 * v1));
  const res1 = Math.abs(v3 - (v2 + v1));
  const res2 = Math.abs(v4 - (5.0 + 3.0 * v3 - v2));
  const res3 = Math.abs(v1 + v2 + v3 + Math.sin(v4) - 10.0);

  assert.ok(res0 < 1e-8, `Eq 0 residual: ${res0}`);
  assert.ok(res1 < 1e-8, `Eq 1 residual: ${res1}`);
  assert.ok(res2 < 1e-8, `Eq 2 residual: ${res2}`);
  assert.ok(res3 < 1e-8, `Eq 3 residual: ${res3}`);

  // Confirm that block tearing plan was constructed and used
  assert.ok(sim.executionBlocks.length > 0);
  const sysBlock = sim.executionBlocks.find((b) => b.type === "system") as any;
  assert.ok(sysBlock, "Expected system block in executionBlocks");
  assert.ok(sysBlock.tearing, "Expected tearing metadata attached to system block");
  assert.strictEqual(sysBlock.tearing.tearingVars.length, 1, "Expected 1 tearing variable");
  assert.ok(sysBlock._tornPlan, "Expected _tornPlan cached on system block");
  assert.strictEqual(sysBlock._tornPlan.k, 1, "Expected k=1 in torn plan");

  console.log("  ✔ 4x4 nonlinear loop successfully solved via k=1 torn Newton iteration!");
}

// Test 2: Coupled 5x5 algebraic block requiring 2 tearing variables
{
  console.log("\nTest 2: Coupled 5x5 Block Requiring 2 Tearing Variables...");
  const arena = new DAEBuilder();
  const y1 = arena.addVariable("y1", VarType.Real, Variability.Continuous);
  const y2 = arena.addVariable("y2", VarType.Real, Variability.Continuous);
  const y3 = arena.addVariable("y3", VarType.Real, Variability.Continuous);
  const y4 = arena.addVariable("y4", VarType.Real, Variability.Continuous);
  const y5 = arena.addVariable("y5", VarType.Real, Variability.Continuous);

  // Eq 0: y3 = 2 * y1 + y2
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y3"),
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("y1")),
      arena.addNameExpr("y2"),
    ),
  );

  // Eq 1: y4 = y3 + 3.0
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y4"),
    arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("y3"), arena.addRealLiteral(3.0)),
  );

  // Eq 2: y5 = y4 - y2
  arena.addEquation(
    EqKind.Simple,
    arena.addNameExpr("y5"),
    arena.addBinaryExpr(BinOp.Sub, arena.addNameExpr("y4"), arena.addNameExpr("y2")),
  );

  // Eq 3: y1 + y5 = 15
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(BinOp.Add, arena.addNameExpr("y1"), arena.addNameExpr("y5")),
    arena.addRealLiteral(15.0),
  );

  // Eq 4: 2 * y2 + y3 = 20
  arena.addEquation(
    EqKind.Simple,
    arena.addBinaryExpr(
      BinOp.Add,
      arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addNameExpr("y2")),
      arena.addNameExpr("y3"),
    ),
    arena.addRealLiteral(20.0),
  );

  const sim = new ArenaSimulator(arena);
  sim.prepare();
  const env = new Float64Array(arena.interner.size + 10);
  sim.evaluateBlocks(env);

  const vy1 = env[arena.getVarNameId(y1)]!;
  const vy2 = env[arena.getVarNameId(y2)]!;
  const vy3 = env[arena.getVarNameId(y3)]!;
  const vy4 = env[arena.getVarNameId(y4)]!;
  const vy5 = env[arena.getVarNameId(y5)]!;

  console.log(
    `  Solved values: y1=${vy1.toFixed(6)}, y2=${vy2.toFixed(6)}, y3=${vy3.toFixed(6)}, y4=${vy4.toFixed(6)}, y5=${vy5.toFixed(6)}`,
  );

  const res0 = Math.abs(vy3 - (2.0 * vy1 + vy2));
  const res1 = Math.abs(vy4 - (vy3 + 3.0));
  const res2 = Math.abs(vy5 - (vy4 - vy2));
  const res3 = Math.abs(vy1 + vy5 - 15.0);
  const res4 = Math.abs(2.0 * vy2 + vy3 - 20.0);

  assert.ok(res0 < 1e-8, `Eq 0 residual: ${res0}`);
  assert.ok(res1 < 1e-8, `Eq 1 residual: ${res1}`);
  assert.ok(res2 < 1e-8, `Eq 2 residual: ${res2}`);
  assert.ok(res3 < 1e-8, `Eq 3 residual: ${res3}`);
  assert.ok(res4 < 1e-8, `Eq 4 residual: ${res4}`);

  const sysBlock = sim.executionBlocks.find((b) => b.type === "system") as any;
  assert.ok(sysBlock && sysBlock._tornPlan);
  assert.strictEqual(sysBlock._tornPlan.k, 1, "Expected k=1 in torn plan");

  console.log("  ✔ 5x5 block successfully solved via k=1 torn Newton iteration!");
}

console.log("\n=== All Algebraic Loop Tearing Tests Passed Cleanly ===");
