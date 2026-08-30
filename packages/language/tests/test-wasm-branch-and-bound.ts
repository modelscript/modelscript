// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import { StaticTapeBuilder, TapeOpKind } from "../src/compiler/tape.js";
import {
  Interval,
  WasmIntervalEngine,
  evaluateTapeInterval,
  evaluateTapeMcCormick,
  solveSBB,
  type DomainBox,
} from "../src/runtime/wasm_interval.js";

console.log("Testing WASM Interval, McCormick & Spatial Branch-and-Bound...");

// Test 1: Interval arithmetic on Tape
{
  const tape = new StaticTapeBuilder();
  // z = x * y - 2
  const xNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("x"));
  const yNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("y"));
  const mulNode = tape.pushScalarOp(TapeOpKind.Mul, xNode, yNode);
  const twoNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 2.0);
  const zNode = tape.pushScalarOp(TapeOpKind.Sub, mulNode, twoNode);

  const box: DomainBox = new Map([
    ["x", new Interval(1.0, 3.0)],
    ["y", new Interval(2.0, 4.0)],
  ]);

  const intervals = evaluateTapeInterval(tape, box);
  const zInterval = intervals[zNode]!;

  // x*y is in [2, 12], z in [0, 10]
  assert.strictEqual(zInterval.lo, 0.0);
  assert.strictEqual(zInterval.hi, 10.0);
  console.log("  ✔ Forward Interval arithmetic on tape passed");
}

// Test 2: McCormick relaxations on Tape
{
  const tape = new StaticTapeBuilder();
  // f(x) = x^2 (x * x)
  const xNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("x"));
  const fNode = tape.pushScalarOp(TapeOpKind.Mul, xNode, xNode);

  const box: DomainBox = new Map([["x", new Interval(-2.0, 2.0)]]);
  const pt = new Map([["x", 0.0]]);

  const mc = evaluateTapeMcCormick(tape, box, pt);
  const fMc = mc[fNode]!;

  // McCormick bounds for x in [-2, 2] at x=0
  assert.ok(fMc.lo <= fMc.hi);
  assert.ok(fMc.cv <= fMc.cc);
  console.log("  ✔ McCormick relaxation evaluation passed");
}

// Test 3: Spatial Branch-and-Bound (sBB) minimization
{
  // Minimize f(x) = (x - 1.5)^2 = x^2 - 3x + 2.25 on x in [0, 3]
  // Global min at x = 1.5, f(1.5) = 0.0
  const tape = new StaticTapeBuilder();
  const xNode = tape.pushScalarOp(TapeOpKind.Var, tape.interner.intern("x"));
  const x2Node = tape.pushScalarOp(TapeOpKind.Mul, xNode, xNode);
  const threeNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 3.0);
  const threeXNode = tape.pushScalarOp(TapeOpKind.Mul, threeNode, xNode);
  const subNode = tape.pushScalarOp(TapeOpKind.Sub, x2Node, threeXNode);
  const constNode = tape.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 2.25);
  const objNode = tape.pushScalarOp(TapeOpKind.Add, subNode, constNode);

  const box: DomainBox = new Map([["x", new Interval(0.0, 3.0)]]);

  const result = solveSBB({ ops: tape, outputIndex: objNode }, [], ["x"], box, { absTol: 1e-3, maxNodes: 1000 });

  console.log("  sBB Result:", result);
  assert.ok(result.optimal, "Solver should converge to optimal solution");
  const solX = result.solution.get("x")!;
  assert.ok(Math.abs(solX - 1.5) < 1e-2, `Expected x ≈ 1.5, got ${solX}`);
  assert.ok(Math.abs(result.objectiveValue - 0.0) < 1e-2, `Expected f(x) ≈ 0, got ${result.objectiveValue}`);
  console.log("  ✔ Spatial Branch-and-Bound global optimization passed");
}

// Test 4: WasmIntervalEngine mock binding
{
  const mockWasm = {
    tape_evaluateInterval: () => {},
    tape_evaluateMcCormick: () => {},
    bnb_solveGlobalMin: () => 0,
    memory: new WebAssembly.Memory({ initial: 1 }),
  };

  const engine = new WasmIntervalEngine(mockWasm);
  const nodeCount = 5;
  const varLo = new Float64Array([0.0, -1.0]);
  const varHi = new Float64Array([1.0, 1.0]);

  const intervals = engine.evaluateTapeInterval(0, nodeCount, varLo, varHi);
  assert.strictEqual(intervals.lo.length, nodeCount);
  assert.strictEqual(intervals.hi.length, nodeCount);

  const bnbRes = engine.solveGlobalMin(0, 4, 2, varLo, varHi, 100, 1e-4);
  assert.strictEqual(bnbRes.solution.length, 2);
  console.log("  ✔ WasmIntervalEngine memory bridge passed");
}

console.log("=== All WASM Interval & Branch-and-Bound Tests Passed Cleanly ===");
