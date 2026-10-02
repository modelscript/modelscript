// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("WebAssembly Flat-Buffer CDCL SAT Solver Core", () => {
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

  function addClause(wasm: any, satPtr: number, lits: number[]): boolean {
    const memory = wasm.memory as WebAssembly.Memory;
    const ptr = wasm.__new(lits.length * 4, 0);
    const view = new Int32Array(memory.buffer, ptr, lits.length);
    for (let i = 0; i < lits.length; i++) {
      view[i] = lits[i]!;
    }
    return wasm.sat_addClause(satPtr, ptr, lits.length);
  }

  function solve(wasm: any, satPtr: number, assumptions: number[] = []): number {
    const memory = wasm.memory as WebAssembly.Memory;
    let ptr = 0;
    if (assumptions.length > 0) {
      ptr = wasm.__new(assumptions.length * 4, 0);
      const view = new Int32Array(memory.buffer, ptr, assumptions.length);
      for (let i = 0; i < assumptions.length; i++) {
        view[i] = assumptions[i]!;
      }
    }
    return wasm.sat_solve(satPtr, ptr, assumptions.length);
  }

  function getUnsatCore(wasm: any, satPtr: number, maxLits = 16): number[] {
    const memory = wasm.memory as WebAssembly.Memory;
    const outPtr = wasm.__new(maxLits * 4, 0);
    const count = wasm.sat_getUnsatCore(satPtr, outPtr);
    const view = new Int32Array(memory.buffer, outPtr, count);
    return Array.from(view);
  }

  it("should solve satisfiable propositional formulas and provide valid models", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.sat_create === "function", "sat_create must be exported");
    assert.ok(typeof wasm.sat_addClause === "function", "sat_addClause must be exported");
    assert.ok(typeof wasm.sat_solve === "function", "sat_solve must be exported");

    // 3 variables: (x1 or x2) and (~x1 or x2) -> forces x2 = true
    const sat = wasm.sat_create(3);
    addClause(wasm, sat, [1, 2]);
    addClause(wasm, sat, [-1, 2]);

    const res = solve(wasm, sat);
    assert.strictEqual(res, 1, "Formula should be SAT");

    const x2Val = wasm.sat_getValue(sat, 2);
    assert.strictEqual(x2Val, 1, "x2 must be assigned true (1)");
  });

  it("should prove unsatisfiability for contradictory clauses and pigeonhole principle", async () => {
    const wasm = await loadWasm();

    // Contradiction: (x1) and (~x1)
    const sat1 = wasm.sat_create(2);
    addClause(wasm, sat1, [1]);
    addClause(wasm, sat1, [-1]);
    assert.strictEqual(solve(wasm, sat1), 2, "Trivial contradiction should be UNSAT");

    // Pigeonhole Principle: 3 pigeons into 2 holes (6 propositional variables)
    // p_ij: pigeon i in hole j
    // P1: x1, x2; P2: x3, x4; P3: x5, x6
    const satPhp = wasm.sat_create(6);

    // Each pigeon is in at least one hole:
    addClause(wasm, satPhp, [1, 2]); // P1
    addClause(wasm, satPhp, [3, 4]); // P2
    addClause(wasm, satPhp, [5, 6]); // P3

    // No two pigeons in hole 1:
    addClause(wasm, satPhp, [-1, -3]); // not(P1,H1 and P2,H1)
    addClause(wasm, satPhp, [-1, -5]); // not(P1,H1 and P3,H1)
    addClause(wasm, satPhp, [-3, -5]); // not(P2,H1 and P3,H1)

    // No two pigeons in hole 2:
    addClause(wasm, satPhp, [-2, -4]); // not(P1,H2 and P2,H2)
    addClause(wasm, satPhp, [-2, -6]); // not(P1,H2 and P3,H2)
    addClause(wasm, satPhp, [-4, -6]); // not(P2,H2 and P3,H2)

    const phpRes = solve(wasm, satPhp);
    assert.strictEqual(phpRes, 2, "PHP(3, 2) must be proven UNSAT via CDCL in WASM");
  });

  it("should support incremental solving with assumptions and extract minimal UNSAT cores", async () => {
    const wasm = await loadWasm();

    // Variables: 1, 2, 3, 4
    // Clauses:
    //   x1 => x2        (~x1 or x2)
    //   x2 => ~x3       (~x2 or ~x3)
    // Assumptions: [x1, x3, x4] -> x1 and x3 conflict, x4 is completely independent!
    const sat = wasm.sat_create(4);
    addClause(wasm, sat, [-1, 2]);
    addClause(wasm, sat, [-2, -3]);

    const res = solve(wasm, sat, [1, 3, 4]);
    assert.strictEqual(res, 2, "Formula must be UNSAT under conflicting assumptions [1, 3, 4]");

    const core = getUnsatCore(wasm, sat);
    assert.ok(core.includes(1), "UNSAT core must include assumption x1");
    assert.ok(core.includes(3), "UNSAT core must include assumption x3");
    assert.ok(!core.includes(4), "Independent assumption x4 must NOT be in the minimal UNSAT core");

    // Clean solve without conflicting assumption: [1, 4] -> SAT
    const sat2 = solve(wasm, sat, [1, 4]);
    assert.strictEqual(sat2, 1, "Under non-conflicting assumptions [1, 4], formula is SAT");
  });
});
