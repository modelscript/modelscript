// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import {
  computeGroebnerBasis,
  Polynomial,
  reduceGroebnerBasis,
  sPolynomial,
  Term,
  TermOrder,
  WasmGroebner,
} from "../src/runtime/wasm_groebner.js";

console.log("Testing WASM Gröbner Basis & Multivariate Polynomial Algebra...");

// Test 1: Monomial term operations & orderings
{
  const t1 = new Term(
    2.0,
    new Map([
      ["x", 2],
      ["y", 1],
    ]),
  ); // 2 * x^2 * y
  const t2 = new Term(
    3.0,
    new Map([
      ["x", 1],
      ["y", 2],
    ]),
  ); // 3 * x * y^2

  assert.strictEqual(t1.totalDegree(), 3);
  assert.strictEqual(t2.totalDegree(), 3);

  const tMul = t1.multiply(t2); // 6 * x^3 * y^3
  assert.strictEqual(tMul.coefficient, 6.0);
  assert.strictEqual(tMul.getDegree("x"), 3);
  assert.strictEqual(tMul.getDegree("y"), 3);

  const tDiv = new Term(
    1.0,
    new Map([
      ["x", 1],
      ["y", 1],
    ]),
  ); // x * y
  assert.ok(tDiv.divides(t1)); // x*y divides 2*x^2*y
  const quotient = tDiv.divideInto(t1); // 2*x
  assert.strictEqual(quotient.coefficient, 2.0);
  assert.strictEqual(quotient.getDegree("x"), 1);
  assert.strictEqual(quotient.getDegree("y"), 0);

  const lexCmp = TermOrder.LEX(["x", "y"]);
  // x^2 * y is larger than x * y^2 in LEX(x, y)
  assert.ok(lexCmp(t1, t2) < 0);

  console.log("  ✔ Monomial term arithmetic, division, and monomial orderings passed");
}

// Test 2: Polynomial division & S-polynomial
{
  // f = x^2 - y, g = x^3 - x
  const vars = ["x", "y"];
  const f = new Polynomial([new Term(1.0, new Map([["x", 2]])), new Term(-1.0, new Map([["y", 1]]))], vars);

  const g = new Polynomial([new Term(1.0, new Map([["x", 3]])), new Term(-1.0, new Map([["x", 1]]))], vars);

  // S(f, g) = x*(x^2 - y) - 1*(x^3 - x) = x^3 - x*y - x^3 + x = -x*y + x
  const spol = sPolynomial(f, g, vars);
  assert.strictEqual(spol.terms.length, 2);

  // Multivariate division of g by [f]
  const { quotients, remainder } = g.divide([f]);
  // x^3 - x = x*(x^2 - y) + (x*y - x)
  assert.strictEqual(quotients.length, 1);
  assert.strictEqual(quotients[0]!.terms[0]!.getDegree("x"), 1);
  assert.strictEqual(remainder.terms.length, 2);

  console.log("  ✔ Polynomial division and S-polynomial computation passed");
}

// Test 3: Buchberger's Algorithm & Basis Reduction
{
  // System:
  //   f1 = x^2 + y - 1
  //   f2 = x + y^2 - 1
  const vars = ["x", "y"];
  const f1 = new Polynomial(
    [new Term(1.0, new Map([["x", 2]])), new Term(1.0, new Map([["y", 1]])), new Term(-1.0, new Map())],
    vars,
  );

  const f2 = new Polynomial(
    [new Term(1.0, new Map([["x", 1]])), new Term(1.0, new Map([["y", 2]])), new Term(-1.0, new Map())],
    vars,
  );

  const basis = computeGroebnerBasis([f1, f2], vars);
  assert.ok(basis.length >= 2, "Gröbner basis should contain at least 2 polynomials");

  const reduced = reduceGroebnerBasis(basis, vars);
  assert.ok(reduced.length >= 1, "Reduced basis should not be empty");

  console.log("  ✔ Buchberger's algorithm and reduced Gröbner basis computation passed");
}

// Test 4: WasmGroebner bridge wrapper
{
  let called = false;
  const mockExports = {
    groebner_triangularize: (daePtr: number, eqPtr: number, nEq: number, varPtr: number, nVar: number) => {
      called = true;
      assert.strictEqual(daePtr, 100);
      assert.strictEqual(nEq, 2);
      assert.strictEqual(nVar, 2);
      return 1;
    },
  };

  const bridge = new WasmGroebner(mockExports);
  const success = bridge.triangularize(100, 200, 2, 300, 2);
  assert.ok(success);
  assert.ok(called);
  console.log("  ✔ WasmGroebner bridge wrapper passed");
}

console.log("=== All WASM Gröbner Tests Passed Cleanly ===");
