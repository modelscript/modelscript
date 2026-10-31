// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { lintC } from "../src/lints/index.js";

describe("@modelscript/c Static Linter Suite (M8401–M8410)", () => {
  test("M8401: flags uninitialized local variable read", () => {
    const src = `
double a;
double b = a + 5.0;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8401);
    assert.ok(m, "Should report M8401 for uninitialized variable read");
    assert.ok(m.message.includes("'a'"));
  });

  test("M8402: flags constant division or modulo by zero", () => {
    const src = `
double x = 10.0 / 0.0;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8402);
    assert.ok(m, "Should report M8402 for constant division by zero");
  });

  test("M8403: flags static array subscript out of bounds", () => {
    const src = `
double arr[4];
arr[4] = 12.0;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8403);
    assert.ok(m, "Should report M8403 for index 4 >= bound 4");
    assert.ok(m.message.includes("'arr[4]'"));
  });

  test("M8404: flags unreachable dead code after return or break", () => {
    const src = `
double compute(double x) {
  return x * 2.0;
  x = x + 1.0;
}
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8404);
    assert.ok(m, "Should report M8404 for unreachable dead code");
  });

  test("M8405: flags accidental assignment in conditional expression", () => {
    const src = `
if (x = 5.0) {
  y = 10.0;
}
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8405);
    assert.ok(m, "Should report M8405 for assignment in conditional");
  });

  test("M8406: flags procedural algebraic dependency cycle", () => {
    const src = `
x = y + 1.0;
y = x * 2.0;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8406);
    assert.ok(m, "Should report M8406 for algebraic dependency cycle");
  });

  test("M8407: flags null pointer dereference", () => {
    const src = `
double val = *NULL;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8407);
    assert.ok(m, "Should report M8407 for NULL pointer dereference");
  });

  test("M8408: flags function prototype signature mismatch", () => {
    const src = `
extern double filter(double u, double dt);

double filter(double u) {
  return u * 0.5;
}
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8408);
    assert.ok(m, "Should report M8408 for prototype mismatch");
    assert.ok(m.message.includes("'filter'"));
  });

  test("M8409: flags missing return value in non-void function", () => {
    const src = `
double calculate(double u) {
  double y = u * 2.0;
}
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8409);
    assert.ok(m, "Should report M8409 for missing return value");
    assert.ok(m.message.includes("'calculate'"));
  });

  test("M8410: flags implicit lossy conversion from float/double to int", () => {
    const src = `
int count = 12.34;
`;
    const diags = lintC(src);
    const m = diags.find((d) => d.code === 8410);
    assert.ok(m, "Should report M8410 for implicit lossy conversion");
  });

  test("ignores commented-out code inside multi-line /* ... */ comments while preserving line numbers", () => {
    const src = `/*
double x = 10.0 / 0.0;
if (a = 1) {
  double v = *NULL;
}
*/
double bad = 5.0 / 0.0;
`;
    const diags = lintC(src);
    assert.equal(diags.length, 1, `Expected only 1 diagnostic, got: ${JSON.stringify(diags)}`);
    assert.equal(diags[0]!.code, 8402);
    assert.equal(diags[0]!.line, 7);
  });
});
