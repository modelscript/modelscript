// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initBltWasm } from "../src/analysis/wasm_blt.js";
import { getDefaultWasmExports } from "../src/dae/wasm_dae.js";

describe("@modelscript/runtime new AssemblyScript WASM kernels (egraph, sbg, hc4, taylor_model)", () => {
  it("runs E-Graph union-find and congruence closure rebuild in WASM linear memory", async () => {
    await initBltWasm();
    const w = getDefaultWasmExports() as any;
    assert.ok(w && typeof w.egraph_create === "function", "egraph_* exports must exist in release.wasm");

    const eg = w.egraph_create(64);
    const a = w.egraph_addNode(eg, 1, -1, -1); // var a
    const b = w.egraph_addNode(eg, 2, -1, -1); // var b
    const fa = w.egraph_addNode(eg, 10, a, -1); // f(a)
    const fb = w.egraph_addNode(eg, 10, b, -1); // f(b)

    assert.notEqual(w.egraph_find(eg, fa), w.egraph_find(eg, fb));
    w.egraph_union(eg, a, b);
    const merges = w.egraph_rebuild(eg);
    assert.ok(merges >= 1, "Congruence closure must merge f(a) and f(b) after union(a, b)");
    assert.equal(w.egraph_find(eg, fa), w.egraph_find(eg, fb));
  });

  it("intersects strided 1D SBG intervals and multi-dimensional intervals via extended GCD", async () => {
    await initBltWasm();
    const w = getDefaultWasmExports() as any;
    assert.equal(typeof w.sbg_intervalIntersect, "function");

    const outPtr = w.alloc(12);
    try {
      // [1:2:20] ∩ [2:3:20] = {5, 11, 17} -> [5, 6, 17]
      const ok = w.sbg_intervalIntersect(1, 2, 20, 2, 3, 20, outPtr);
      assert.equal(ok, 1);
      const res = new Int32Array(w.memory.buffer, outPtr, 3);
      assert.equal(res[0], 5);
      assert.equal(res[1], 6);
      assert.equal(res[2], 17);

      // Disjoint parity: [0:2:10] ∩ [1:2:10] = empty
      const empty = w.sbg_intervalIntersect(0, 2, 10, 1, 2, 10, outPtr);
      assert.equal(empty, 0);
    } finally {
      w.free(outPtr);
    }
  });

  it("contracts nonlinear circle constraint x^2 + y^2 <= 1 via HC4 forward-backward revision", async () => {
    await initBltWasm();
    const w = getDefaultWasmExports() as any;
    assert.equal(typeof w.hc4_revise, "function");

    // DAG: n0 = Var(0) (x), n1 = Sqr(n0), n2 = Var(1) (y), n3 = Sqr(n2), n4 = Add(n1, n3)
    const nodes = new Int32Array([
      1,
      -1,
      -1,
      0, // n0: Var(0)
      7,
      0,
      -1,
      0, // n1: Sqr(n0)
      1,
      -1,
      -1,
      1, // n2: Var(1)
      7,
      2,
      -1,
      0, // n3: Sqr(n2)
      2,
      1,
      3,
      0, // n4: Add(n1, n3)
    ]);
    const nodesPtr = w.alloc(nodes.byteLength);
    const varLoPtr = w.alloc(16);
    const varHiPtr = w.alloc(16);

    try {
      new Int32Array(w.memory.buffer, nodesPtr, nodes.length).set(nodes);
      // Start with x in [-5, 5], y in [0.6, 5] -> x^2 <= 1 - 0.36 = 0.64 -> x in [-0.8, 0.8], y in [0.6, 1.0]
      new Float64Array(w.memory.buffer, varLoPtr, 2).set([-5.0, 0.6]);
      new Float64Array(w.memory.buffer, varHiPtr, 2).set([5.0, 5.0]);

      const ok = w.hc4_revise(nodesPtr, 5, 0, varLoPtr, varHiPtr, 0.0, 1.0);
      assert.equal(ok, 1);
      const lo = new Float64Array(w.memory.buffer, varLoPtr, 2);
      const hi = new Float64Array(w.memory.buffer, varHiPtr, 2);
      assert.ok(Math.abs(lo[0]! + 0.8) < 1e-10, `Expected x_lo = -0.8, got ${lo[0]}`);
      assert.ok(Math.abs(hi[0]! - 0.8) < 1e-10, `Expected x_hi = 0.8, got ${hi[0]}`);
      assert.ok(Math.abs(hi[1]! - 1.0) < 1e-10, `Expected y_hi = 1.0, got ${hi[1]}`);
    } finally {
      w.free(nodesPtr);
      w.free(varLoPtr);
      w.free(varHiPtr);
    }
  });

  it("multiplies and truncates multivariate Taylor Models with sound interval remainder", async () => {
    await initBltWasm();
    const w = getDefaultWasmExports() as any;
    assert.equal(typeof w.tm_mulTruncate, "function");

    // (1 + x) * (1 + x) truncated to order 1 over [-1, 1]:
    // P_out = 1 + 2x, truncated x^2 (|c|=1) goes into remainder [-1, 1]
    const expAPtr = w.alloc(2);
    const coefAPtr = w.alloc(16);
    const expBPtr = w.alloc(2);
    const coefBPtr = w.alloc(16);
    const outExpPtr = w.alloc(16);
    const outCoefPtr = w.alloc(16 * 8);
    const outRemPtr = w.alloc(16);

    try {
      new Uint8Array(w.memory.buffer, expAPtr, 2).set([0, 1]);
      new Float64Array(w.memory.buffer, coefAPtr, 2).set([1.0, 1.0]);
      new Uint8Array(w.memory.buffer, expBPtr, 2).set([0, 1]);
      new Float64Array(w.memory.buffer, coefBPtr, 2).set([1.0, 1.0]);

      const count = w.tm_mulTruncate(
        1,
        1,
        2,
        expAPtr,
        coefAPtr,
        0.0,
        0.0,
        2,
        expBPtr,
        coefBPtr,
        0.0,
        0.0,
        outExpPtr,
        outCoefPtr,
        16,
        outRemPtr,
      );
      assert.equal(count, 2);
      const outC = new Float64Array(w.memory.buffer, outCoefPtr, 2);
      const outR = new Float64Array(w.memory.buffer, outRemPtr, 2);
      assert.equal(outC[0], 1.0);
      assert.equal(outC[1], 2.0);
      assert.equal(outR[0], -1.0);
      assert.equal(outR[1], 1.0);
    } finally {
      w.free(expAPtr);
      w.free(coefAPtr);
      w.free(expBPtr);
      w.free(coefBPtr);
      w.free(outExpPtr);
      w.free(outCoefPtr);
      w.free(outRemPtr);
    }
  });

  it("solves Dutertre-de Moura LRA Simplex and Hc4Contractor.revise through WASM bridges", async () => {
    await initBltWasm();
    const { wasmSimplexSolveDutertreDeMoura } = await import("../src/analysis/wasm_kernels_bridge.js");
    const { Hc4Contractor } = await import("../src/formal/hc4_contractor.js");
    const { Interval } = await import("../src/analysis/wasm_interval.js");

    // 1. Dutertre-de Moura Simplex: s0 = x + y, x >= 1, y >= 2, s0 <= 5 -> SAT (e.g. x=1, y=2)
    const A = new Float64Array([1, 1]);
    const sat = wasmSimplexSolveDutertreDeMoura(A, 1, 2, [
      { varIdx: 0, isLower: true, r: 1 },
      { varIdx: 1, isLower: true, r: 2 },
      { varIdx: 2, isLower: false, r: 5 },
    ]);
    assert.ok(sat);
    assert.equal(sat.status, "SAT");
    assert.ok(sat.assignments![0]! + sat.assignments![1]! <= 5 + 1e-9);

    // Unsat: s0 = x + y, x >= 3, y >= 3, s0 <= 5 -> UNSAT
    const unsat = wasmSimplexSolveDutertreDeMoura(A, 1, 2, [
      { varIdx: 0, isLower: true, r: 3 },
      { varIdx: 1, isLower: true, r: 3 },
      { varIdx: 2, isLower: false, r: 5 },
    ]);
    assert.ok(unsat);
    assert.equal(unsat.status, "UNSAT");

    // 2. Hc4Contractor.revise uses compiled WASM fast-path for x^2 + y^2 <= 1
    const box = new Map<string, InstanceType<typeof Interval>>([
      ["x", new Interval(-5, 5)],
      ["y", new Interval(0.6, 5)],
    ]);
    const ok = Hc4Contractor.revise(
      {
        expr: {
          kind: "add",
          left: { kind: "sqr", child: { kind: "var", name: "x" } },
          right: { kind: "sqr", child: { kind: "var", name: "y" } },
        },
        rel: "<=",
        rhs: 1.0,
      },
      box,
    );
    assert.equal(ok, true);
    assert.ok(Math.abs(box.get("x")!.hi - 0.8) < 1e-9);
    assert.ok(Math.abs(box.get("x")!.lo + 0.8) < 1e-9);
  });

  it("computes expression purity bitset, Dual Jacobian column, and hybrid zero-crossings in WASM", async () => {
    await initBltWasm();
    const {
      BinOp,
      Causality,
      DAEBuilder,
      EqKind,
      StringInterner,
      VarType,
      Variability,
      computeArenaExprPurityBitset,
      evaluateArenaDualJacobianColumnWasm,
      WasmEventDetectorBridge,
    } = await import("../src/index.js");

    const interner = new StringInterner();
    const arena = new DAEBuilder(interner, "DualEventTest");
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
    const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 3.0);

    // eq 0: x * x + y = 0  => d(res)/dx = 2*x = 4.0 at x=2
    const xName = arena.addNameExpr("x");
    const yName = arena.addNameExpr("y");
    const xSq = arena.addBinaryExpr(BinOp.Mul, xName, xName);
    const lhs = arena.addBinaryExpr(BinOp.Add, xSq, yName);
    const rhs = arena.addRealLiteral(0.0);
    arena.addEquation(EqKind.Simple, lhs, rhs);

    const purity = computeArenaExprPurityBitset(arena);
    assert.equal(purity[lhs], 1);

    const vals = new Float64Array(arena.varCount);
    vals[xIdx] = 2.0;
    vals[yIdx] = 3.0;
    const col = evaluateArenaDualJacobianColumnWasm(arena, [0], vals, xIdx);
    assert.ok(col);
    assert.ok(Math.abs(col[0]! + 4.0) < 1e-12, `Expected d(rhs - lhs)/dx = -4.0, got ${col[0]}`);

    // ZCF: x - 1.0 (starts positive at x=2, crosses negative at x=0.5)
    const zcfExpr = arena.addBinaryExpr(BinOp.Sub, xName, arena.addRealLiteral(1.0));
    const detector = new WasmEventDetectorBridge(arena.ptr);
    detector.addZcf(zcfExpr, 1.0, 0);
    assert.equal(detector.checkZeroCrossings(vals), -1);
    vals[xIdx] = 0.5;
    assert.equal(detector.checkZeroCrossings(vals), 0, "Expected ZCF 0 crossing when x drops from 2.0 to 0.5");
  });
});
