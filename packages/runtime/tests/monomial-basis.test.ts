// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { describe, it } from "node:test";
import { MonomialBasis } from "../src/analysis/monomial_basis.js";

describe("MonomialBasis (Graded-Lexicographical Monomial Indexing)", () => {
  it("should generate correct graded-lex ordering for 2 variables, order 2", () => {
    const basis = MonomialBasis.get(2, 2);
    assert.strictEqual(basis.totalMonomials, 6); // binom(2+2, 2) = 6

    // Invariants: index 0 is constant, indices 1..2 are coordinate variables
    assert.deepStrictEqual(basis.exponents[0], [0, 0]);
    assert.deepStrictEqual(basis.exponents[1], [1, 0]);
    assert.deepStrictEqual(basis.exponents[2], [0, 1]);
    assert.deepStrictEqual(basis.exponents[3], [2, 0]);
    assert.deepStrictEqual(basis.exponents[4], [1, 1]);
    assert.deepStrictEqual(basis.exponents[5], [0, 2]);

    assert.strictEqual(basis.variableIndex(0), 1);
    assert.strictEqual(basis.variableIndex(1), 2);

    assert.deepStrictEqual(Array.from(basis.degrees), [0, 1, 1, 2, 2, 2]);
    assert.strictEqual(basis.indexOf([0, 0]), 0);
    assert.strictEqual(basis.indexOf([1, 1]), 4);
    assert.strictEqual(basis.indexOf([3, 0]), -1); // Exceeds order 2
  });

  it("should precompute exact multiplication table for polynomial products", () => {
    const basis = MonomialBasis.get(2, 2);
    const table = basis.mulTable!;
    assert.ok(table !== null);

    const M = basis.totalMonomials;
    const mul = (i: number, j: number) => table[i * M + j]!;

    // 1 * x0 = x0 (0 * 1 = 1)
    assert.strictEqual(mul(0, 1), 1);
    // x0 * x1 = x0*x1 (1 * 2 = 4)
    assert.strictEqual(mul(1, 2), 4);
    // x0 * x0 = x0^2 (1 * 1 = 3)
    assert.strictEqual(mul(1, 1), 3);
    // x1 * x1 = x1^2 (2 * 2 = 5)
    assert.strictEqual(mul(2, 2), 5);
    // x0^2 * x0 = x0^3 (degree 3 > 2 => -1 truncated)
    assert.strictEqual(mul(3, 1), -1);
    // x0*x1 * x1 = x0*x1^2 (degree 3 > 2 => -1 truncated)
    assert.strictEqual(mul(4, 2), -1);
  });

  it("should precompute variable restriction maps correctly", () => {
    const basis = MonomialBasis.get(2, 2);

    // Restricting variable 0 (x0) to 0
    const target0 = basis.restrictTarget[0]!;
    const deg0 = basis.restrictDegree[0]!;

    // Constant [0, 0] (idx 0) -> [0, 0] (idx 0), deg 0
    assert.strictEqual(target0[0], 0);
    assert.strictEqual(deg0[0], 0);

    // x0 [1, 0] (idx 1) -> [0, 0] (idx 0), deg 1
    assert.strictEqual(target0[1], 0);
    assert.strictEqual(deg0[1], 1);

    // x1 [0, 1] (idx 2) -> [0, 1] (idx 2), deg 0
    assert.strictEqual(target0[2], 2);
    assert.strictEqual(deg0[2], 0);

    // x0*x1 [1, 1] (idx 4) -> [0, 1] (idx 2), deg 1
    assert.strictEqual(target0[4], 2);
    assert.strictEqual(deg0[4], 1);

    // x0^2 [2, 0] (idx 3) -> [0, 0] (idx 0), deg 2
    assert.strictEqual(target0[3], 0);
    assert.strictEqual(deg0[3], 2);
  });

  it("should precompute time integration maps correctly", () => {
    const basis = MonomialBasis.get(2, 2);

    // Integrating with respect to variable 0
    const target0 = basis.integrateTarget[0]!;
    const div0 = basis.integrateDivisor[0]!;

    // 1 [0, 0] (idx 0) -> x0 [1, 0] (idx 1), divisor 1
    assert.strictEqual(target0[0], 1);
    assert.strictEqual(div0[0], 1);

    // x0 [1, 0] (idx 1) -> x0^2 [2, 0] (idx 3), divisor 2
    assert.strictEqual(target0[1], 3);
    assert.strictEqual(div0[1], 2);

    // x1 [0, 1] (idx 2) -> x0*x1 [1, 1] (idx 4), divisor 1
    assert.strictEqual(target0[2], 4);
    assert.strictEqual(div0[2], 1);

    // x0^2 [2, 0] (idx 3) -> x0^3 (degree 3 > 2 => -1), divisor 3
    assert.strictEqual(target0[3], -1);
    assert.strictEqual(div0[3], 3);
  });

  it("should reuse cached MonomialBasis instances", () => {
    const b1 = MonomialBasis.get(3, 3);
    const b2 = MonomialBasis.get(3, 3);
    assert.strictEqual(b1, b2);
    // binom(3+3, 3) = 20
    assert.strictEqual(b1.totalMonomials, 20);
  });
});
