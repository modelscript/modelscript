// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { lintFortran } from "../src/lints/index.js";

describe("@modelscript/fortran Static Linter Suite", () => {
  test("M4070: flags undeclared variable under IMPLICIT NONE", () => {
    const src = `
IMPLICIT NONE
REAL x
x = 10.0
y = x + 1.0
`;
    const diags = lintFortran(src);
    const m4070 = diags.find((d) => d.code === 4070);
    assert.ok(m4070, "Should report M4070 for undeclared 'y'");
    assert.ok(m4070.message.includes("'y'"));
  });

  test("M4071: flags uninitialized variable read", () => {
    const src = `
REAL a, b
b = a + 5.0
`;
    const diags = lintFortran(src);
    const m4071 = diags.find((d) => d.code === 4071);
    assert.ok(m4071, "Should report M4071 for reading uninitialized 'a'");
    assert.ok(m4071.message.includes("'a'"));
  });

  test("M4072: flags constant division by zero", () => {
    const src = `
REAL a
a = 10.0 / 0.0
`;
    const diags = lintFortran(src);
    const m4072 = diags.find((d) => d.code === 4072);
    assert.ok(m4072, "Should report M4072 for division by zero");
  });

  test("M4073: flags state array index exceeding allocated bounds", () => {
    const src = `
STORF(3) = 1.0
`;
    const diags = lintFortran(src, { numRealStates: 2, numIntStates: 1 });
    const m4073 = diags.find((d) => d.code === 4073);
    assert.ok(m4073, "Should report M4073 for STORF(3) >= 2");
    assert.ok(m4073.message.includes("STORF(3)"));
  });

  test("M4074: flags dead unreachable code after RETURN", () => {
    const src = `
SUBROUTINE TEST(X)
  REAL X
  X = 1.0
  RETURN
  X = 2.0
END SUBROUTINE
`;
    const diags = lintFortran(src);
    const m4074 = diags.find((d) => d.code === 4074);
    assert.ok(m4074, "Should report M4074 for dead code after RETURN");
  });

  test("M4075: flags mutation of active DO loop control variable", () => {
    const src = `
INTEGER I
DO I = 1, 10
  I = I + 1
END DO
`;
    const diags = lintFortran(src);
    const m4075 = diags.find((d) => d.code === 4075);
    assert.ok(m4075, "Should report M4075 for mutating DO loop index 'I'");
    assert.ok(m4075.message.includes("'I'"));
  });

  test("M4076: flags procedural algebraic dependency cycle", () => {
    const src = `
REAL x, y
x = y + 1.0
y = x * 2.0
`;
    const diags = lintFortran(src);
    const m4076 = diags.find((d) => d.code === 4076);
    assert.ok(m4076, "Should report M4076 for algebraic cycle between 'x' and 'y'");
  });

  test("M4078: flags zero or negative array dimension bounds", () => {
    const src = `
DIMENSION arr(0, 5)
`;
    const diags = lintFortran(src);
    const m4078 = diags.find((d) => d.code === 4078);
    assert.ok(m4078, "Should report M4078 for zero dimension bound");
  });

  test("M4079: flags obsolete arithmetic IF statement", () => {
    const src = `
IF (X - Y) 10, 20, 30
`;
    const diags = lintFortran(src);
    const m4079 = diags.find((d) => d.code === 4079);
    assert.ok(m4079, "Should report M4079 for obsolete arithmetic IF");
  });
});
