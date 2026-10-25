// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("WebAssembly Zero-GC Formal Verification Kernels", () => {
  async function loadWasm() {
    const wasmPath = path.resolve(import.meta.dirname, "../build/release.wasm");
    const bytes = await fs.readFile(wasmPath);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
      env: {
        abort: () => {},
      },
    });
    return instance.exports as Record<string, any>;
  }

  it("should evaluate Always and Eventually via in-WASM STL sliding window kernel", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.stl_eval_always === "function", "stl_eval_always must be exported");
    assert.ok(typeof wasm.stl_eval_eventually === "function", "stl_eval_eventually must be exported");
    assert.ok(typeof wasm.stl_eval_until === "function", "stl_eval_until must be exported");

    const N = 100;
    const memory = wasm.memory as WebAssembly.Memory;

    // Allocate memory in WASM heap
    const bytesF64 = N * 8;
    const timePtr = wasm.__new(bytesF64, 0);
    const valPtr = wasm.__new(bytesF64, 0);
    const outPtr = wasm.__new(bytesF64, 0);

    const timeView = new Float64Array(memory.buffer, timePtr, N);
    const valView = new Float64Array(memory.buffer, valPtr, N);
    const outView = new Float64Array(memory.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = i * 0.1;
      valView[i] = Math.sin(timeView[i]!) * 10;
    }

    // Always on [0, 1.0]
    wasm.stl_eval_always(timePtr, valPtr, N, 0.0, 1.0, outPtr);

    // Verify first 10 points
    for (let i = 0; i < 10; i++) {
      let expectedMin = Infinity;
      const t = timeView[i]!;
      for (let j = 0; j < N; j++) {
        if (timeView[j]! >= t && timeView[j]! <= t + 1.0) {
          if (valView[j]! < expectedMin) expectedMin = valView[j]!;
        }
      }
      assert.ok(Math.abs(outView[i]! - expectedMin) < 1e-6);
    }

    // Eventually on [0, 2.0]
    wasm.stl_eval_eventually(timePtr, valPtr, N, 0.0, 2.0, outPtr);
    for (let i = 0; i < 10; i++) {
      let expectedMax = -Infinity;
      const t = timeView[i]!;
      for (let j = 0; j < N; j++) {
        if (timeView[j]! >= t && timeView[j]! <= t + 2.0) {
          if (valView[j]! > expectedMax) expectedMax = valView[j]!;
        }
      }
      assert.ok(Math.abs(outView[i]! - expectedMax) < 1e-6);
    }
  });

  it("should compute transitive closure via in-WASM Octagon Floyd-Warshall kernel", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.octagon_close_i32 === "function", "octagon_close_i32 must be exported");

    const dim = 6;
    const INF = 1000000000;
    const size = dim * dim;
    const bytesI32 = size * 4;
    const matrixPtr = wasm.__new(bytesI32, 0);
    const memory = wasm.memory as WebAssembly.Memory;
    const matrixView = new Int32Array(memory.buffer, matrixPtr, size);

    // Initialize all to INF and diagonal to 0
    matrixView.fill(INF);
    for (let i = 0; i < dim; i++) {
      matrixView[i * dim + i] = 0;
    }

    // Add path: 0 -> 1 (weight 5), 1 -> 2 (weight 3)
    matrixView[0 * dim + 1] = 5;
    matrixView[1 * dim + 2] = 3;

    wasm.octagon_close_i32(matrixPtr, dim);

    // Derived bound: 0 -> 2 should be 8
    assert.strictEqual(matrixView[0 * dim + 2], 8);
  });

  it("should accelerate OctagonDBM.closeWithWasm via WASM bridge integration", async () => {
    const wasm = await loadWasm();
    const { OctagonDBM } = await import("../src/analysis/octagon_dbm.js");

    const dbm = new OctagonDBM(3); // 3 variables => dim = 6
    dbm.setBound(0, 1, 10);
    dbm.setBound(1, 2, 20);

    dbm.closeWithWasm(wasm);

    // Derived bound: 0 -> 2 should be 30
    assert.strictEqual(dbm.getBound(0, 2), 30);
  });

  it("should evaluate STL via StlMonitor.evaluateAlwaysWasm bridge", async () => {
    const wasm = await loadWasm();
    const { StlMonitor } = await import("../src/formal/stl_monitor.js");

    const N = 50;
    const bytesF64 = N * 8;
    const timePtr = wasm.__new(bytesF64, 0);
    const valPtr = wasm.__new(bytesF64, 0);
    const outPtr = wasm.__new(bytesF64, 0);

    const mem = wasm.memory as WebAssembly.Memory;
    const timeView = new Float64Array(mem.buffer, timePtr, N);
    const valView = new Float64Array(mem.buffer, valPtr, N);
    const outView = new Float64Array(mem.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = i * 0.1;
      valView[i] = i; // linearly increasing
    }

    StlMonitor.evaluateAlwaysWasm(wasm, timePtr, valPtr, N, 0.0, 0.5, outPtr);

    // On linearly increasing signal with [0, 0.5], min is always the current value val[i] = i
    for (let i = 0; i < N - 5; i++) {
      assert.strictEqual(outView[i], i);
    }
  });

  it("should incrementally solve SAT and extract UNSAT cores via CdclSatSolver with WASM acceleration", async () => {
    const { CdclSatSolver } = await import("../src/formal/cdcl_sat.js");

    const solver = new CdclSatSolver();
    // (x1 | x2) & (~x1 | x3)
    solver.addClause([1, 2]);
    solver.addClause([-1, 3]);

    // Under assumptions [1, -3], x1 forces x3, conflicting with -3 => UNSAT with core
    const resUnsat = solver.solve([1, -3]);
    assert.strictEqual(resUnsat.status, "UNSAT");
    assert.ok(resUnsat.unsatCore, "Must provide unsatCore");
    assert.ok(
      resUnsat.unsatCore.includes(1) || resUnsat.unsatCore.includes(-3),
      "UNSAT core must cite assumption literals",
    );

    // Re-solve incrementally under [-1]: forces x2, should be SAT
    const resSat = solver.solve([-1]);
    assert.strictEqual(resSat.status, "SAT");
    assert.strictEqual(resSat.model?.get(2), true, "x2 must be true");

    solver.destroy();
  });

  it("should solve Two-Phase Farkas Simplex directly in WASM linear memory", async () => {
    const wasm = await loadWasm();
    assert.strictEqual(typeof wasm.simplex_create, "function");

    // 2 constraints in 1 variable:
    // C0: x <= 1  (d0 = 1)
    // C1: -x <= -2 => x >= 2 (d1 = -2)
    // Inconsistent! Farkas dual: lambda0 * 1 + lambda1 * (-1) = 0 => lambda0 = lambda1 = 0.5
    // Z* = 0.5 * 1 + 0.5 * (-2) = -0.5 < 0
    const m = 2;
    const n = 1;
    const sPtr = wasm.simplex_create(n + 3, m + n + 3);
    assert.ok(sPtr > 0);

    wasm.simplex_initFarkas(sPtr, m, n);
    // Row 0 (var x): C0 coeff = 1, C1 coeff = -1
    wasm.simplex_setEntry(sPtr, 0, 0, 1.0);
    wasm.simplex_setEntry(sPtr, 0, 1, -1.0);

    const mem = wasm.memory as WebAssembly.Memory;
    const dPtr = wasm.__new(m * 8, 0);
    const dView = new Float64Array(mem.buffer, dPtr, m);
    dView[0] = 1.0;
    dView[1] = -2.0;

    const res = wasm.simplex_solveTwoPhaseFarkas(sPtr, m, n, dPtr);
    assert.strictEqual(res, 1 /* SIMPLEX_RESULT_OPTIMAL */);

    const optVal = wasm.simplex_getOptimalValue(sPtr);
    assert.ok(optVal < -0.4, `Optimal value must be negative: got ${optVal}`);

    const multPtr = wasm.__new(m * 8, 0);
    wasm.simplex_getMultipliers(sPtr, multPtr, m);
    const multView = new Float64Array(mem.buffer, multPtr, m);
    assert.ok(Math.abs(multView[0] - 0.5) < 1e-4, `lambda0 should be ~0.5, got ${multView[0]}`);
    assert.ok(Math.abs(multView[1] - 0.5) < 1e-4, `lambda1 should be ~0.5, got ${multView[1]}`);

    wasm.simplex_destroy(sPtr);
  });

  it("should solve Dutertre-de Moura Simplex with infinitesimal bounds in WASM", async () => {
    const wasm = await loadWasm();
    assert.strictEqual(typeof wasm.simplex_initDutertreDeMoura, "function");

    // 2 constraints, 1 non-basic variable x (col 0):
    // s0 = x <= 5
    // s1 = x >= 2
    // Basic vars: s0 (var 1), s1 (var 2)
    const m = 2;
    const n = 1;
    const sPtr = wasm.simplex_create(m + 2, n + 2);
    wasm.simplex_initDutertreDeMoura(sPtr, m, n);

    // Matrix A: row 0: [1.0], row 1: [1.0]
    wasm.simplex_setEntry(sPtr, 0, 0, 1.0);
    wasm.simplex_setEntry(sPtr, 1, 0, 1.0);

    // Set bounds:
    // var 1 (s0): upper = 5.0 (k=0)
    // var 2 (s1): lower = 2.0 (k=0)
    wasm.simplex_setBound(sPtr, 1, false, 5.0, 0);
    wasm.simplex_setBound(sPtr, 2, true, 2.0, 0);

    const res = wasm.simplex_solveDutertreDeMoura(sPtr, 100);
    assert.strictEqual(res, 1 /* SIMPLEX_RESULT_OPTIMAL (feasible) */);

    const xVal = wasm.simplex_getAssignment(sPtr, 0);
    assert.ok(xVal >= 2.0 - 1e-6 && xVal <= 5.0 + 1e-6, `x must be within [2, 5], got ${xVal}`);

    wasm.simplex_destroy(sPtr);
  });

  it("should compute continuous transitive closure via in-WASM Float64 Octagon Floyd-Warshall kernel", async () => {
    const wasm = await loadWasm();
    assert.strictEqual(typeof wasm.octagon_close_f64, "function");

    const { OctagonDBMF64 } = await import("../src/analysis/octagon_dbm.js");

    // 2 continuous variables: x0, x1
    const dbm = new OctagonDBMF64(2);
    // x0 in [0.25, 2.75]
    dbm.assumeInterval(0, 0.25, 2.75);
    // x1 in [1.5, 4.0]
    dbm.assumeInterval(1, 1.5, 4.0);
    // x0 - x1 <= -0.5 => x0 <= x1 - 0.5
    dbm.assumeDiff(0, 1, -0.5);

    // Run WASM closure
    dbm.closeWithWasm(wasm);

    // Derived bound: x0.upper should contract because x0 <= x1 - 0.5 and x1.upper = 4.0 => x0 <= 3.5
    const [x0Lo, x0Hi] = dbm.getInterval(0);
    assert.ok(Math.abs(x0Lo - 0.25) < 1e-6, `x0 lower bound should be 0.25, got ${x0Lo}`);
    assert.ok(x0Hi <= 2.75 + 1e-6, `x0 upper bound should be <= 2.75, got ${x0Hi}`);

    // Negative cycle detection: assume contradictory diff x1 - x0 <= -3.0
    // But x1 >= 1.5 and x0 <= 2.75, so min diff is 1.5 - 2.75 = -1.25. Setting <= -3.0 is contradictory!
    dbm.assumeDiff(1, 0, -3.0);
    dbm.closeWithWasm(wasm);
    assert.strictEqual(dbm.hasNegativeCycle(), true, "Should detect negative cycle for contradictory constraints");
  });

  it("should contract variable bounds over DAE linear memory expressions via dae_hc4_revise", async () => {
    const wasm = await loadWasm();
    assert.strictEqual(typeof wasm.dae_hc4_revise, "function");

    const dae = wasm.dae_createBuilder();
    assert.ok(dae > 0);

    // Add 2 variables: x (id 0) and y (id 1)
    const var0 = wasm.dae_addVariable(dae, 100, 0, 0, 0, 0.0, 0);
    const var1 = wasm.dae_addVariable(dae, 101, 0, 0, 0, 0.0, 0);

    const expr0 = wasm.dae_addName(dae, var0);
    const expr1 = wasm.dae_addName(dae, var1);
    // sumExpr = x + y (BinOp.Add = 0)
    const sumExpr = wasm.dae_addBinaryExpr(dae, 0, expr0, expr1);

    const mem = wasm.memory as WebAssembly.Memory;
    const loPtr = wasm.__new(2 * 8, 0);
    const hiPtr = wasm.__new(2 * 8, 0);
    const loView = new Float64Array(mem.buffer, loPtr, 2);
    const hiView = new Float64Array(mem.buffer, hiPtr, 2);

    // Initial domain: x in [0.0, 10.0], y in [0.0, 2.0]
    loView[0] = 0.0;
    hiView[0] = 10.0;
    loView[1] = 0.0;
    hiView[1] = 2.0;

    // Contract: target x + y in [5.0, 8.0]
    // x = sum - y => x >= 5 - 2 = 3.0, x <= 8 - 0 = 8.0
    const ok = wasm.dae_hc4_revise(dae, sumExpr, 5.0, 8.0, loPtr, hiPtr);
    assert.strictEqual(Boolean(ok), true, "Contracting feasible interval must succeed");
    assert.ok(Math.abs(loView[0] - 3.0) < 1e-5, `x.lo must contract to 3.0, got ${loView[0]}`);
    assert.ok(Math.abs(hiView[0] - 8.0) < 1e-5, `x.hi must contract to 8.0, got ${hiView[0]}`);

    // Infeasible contraction: require x + y in [25.0, 30.0]
    // Current max is 8.0 + 2.0 = 10.0 < 25.0 => contradiction
    const infeasible = wasm.dae_hc4_revise(dae, sumExpr, 25.0, 30.0, loPtr, hiPtr);
    assert.strictEqual(Boolean(infeasible), false, "Contradictory interval must return false");

    wasm.dae_free(dae);
  });

  it("should isolate all real algebraic roots via in-WASM Sturm sequence and bisection kernel", async () => {
    const wasm = await loadWasm();
    assert.strictEqual(typeof wasm.sturm_isolate_roots, "function");
    assert.strictEqual(typeof wasm.sturm_build_sequence, "function");

    const { UnivariatePoly, isolateRealRoots, setSturmWasmExports } = await import("../src/formal/nlsat_solver.js");
    setSturmWasmExports(wasm);

    // p(x) = (x - 1)(x - 2)(x - 3) = x^3 - 6x^2 + 11x - 6
    const p3 = new UnivariatePoly([-6, 11, -6, 1]);
    const roots3 = isolateRealRoots(p3, 1e-8, wasm);

    assert.strictEqual(roots3.length, 3, "Must find exactly 3 real roots");
    assert.ok(Math.abs(roots3[0]! - 1.0) < 1e-6, `Root 0 should be 1.0, got ${roots3[0]}`);
    assert.ok(Math.abs(roots3[1]! - 2.0) < 1e-6, `Root 1 should be 2.0, got ${roots3[1]}`);
    assert.ok(Math.abs(roots3[2]! - 3.0) < 1e-6, `Root 2 should be 3.0, got ${roots3[2]}`);

    // p(x) = x^4 - 10x^2 + 9 = (x^2 - 1)(x^2 - 9) => roots: -3, -1, 1, 3
    const p4 = new UnivariatePoly([9, 0, -10, 0, 1]);
    const roots4 = isolateRealRoots(p4, 1e-8, wasm);

    assert.strictEqual(roots4.length, 4, "Must find exactly 4 real roots");
    assert.ok(Math.abs(roots4[0]! - -3.0) < 1e-6);
    assert.ok(Math.abs(roots4[1]! - -1.0) < 1e-6);
    assert.ok(Math.abs(roots4[2]! - 1.0) < 1e-6);
    assert.ok(Math.abs(roots4[3]! - 3.0) < 1e-6);

    // p(x) = x^2 + 4 = 0 (no real roots)
    const pNoRoots = new UnivariatePoly([4, 0, 1]);
    const roots0 = isolateRealRoots(pNoRoots, 1e-8, wasm);
    assert.strictEqual(roots0.length, 0, "Must return 0 roots for x^2 + 4");

    setSturmWasmExports(null);
  });
});
