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

  test("M4080 & M4082: flags subroutine begin/end identifier mismatch and trailing tokens after IMPLICIT NONE", () => {
    const src = `! Nozzle Thrust & Specific Impulse Calculation (Fortran 90)
subroutine nozzle_thrust1(p_c, a_t, c_f, f_thrust)
  implicit none sd
  real(8), intent(in)  :: p_c, a_t, c_f
  real(8), intent(out) :: f_thrust
  real(8) :: g0 = 9.80665, r_gas = 287.05
  real(8) :: i_sp

  f_thrust = p_c * a_t * c_f
  i_sp = c_f * sqrt(r_gas * 3500.0) / g0
end subroutine nozzle_thrust
`;
    const diags = lintFortran(src);
    const m4082 = diags.find((d) => d.code === 4082);
    assert.ok(m4082, "Should report M4082 for 'implicit none sd'");
    assert.equal(m4082.line, 3);

    const m4080 = diags.find((d) => d.code === 4080);
    assert.ok(m4080, "Should report M4080 for 'nozzle_thrust1' vs 'nozzle_thrust'");
    assert.ok(m4080.message.includes("'nozzle_thrust1'"));
    assert.ok(m4080.message.includes("'nozzle_thrust'"));

    // Should NOT produce false-positive M4070 or M4071 for intent(in) / intent(out) variables
    assert.equal(diags.filter((d) => d.code === 4070 || d.code === 4071).length, 0);
  });

  test("M4081, M4083, M4084: flags intent(in) mutation, unclosed block, and math domain violation", () => {
    const src = `
subroutine bad_math(u_in, y_out)
  implicit none
  real(8), intent(in) :: u_in
  real(8), intent(out) :: y_out
  u_in = 5.0
  y_out = sqrt(-4.0)
`;
    const diags = lintFortran(src);
    assert.ok(
      diags.some((d) => d.code === 4081),
      "Should report M4081 for mutating intent(in) 'u_in'",
    );
    assert.ok(
      diags.some((d) => d.code === 4084),
      "Should report M4084 for sqrt(-4.0)",
    );
    assert.ok(
      diags.some((d) => d.code === 4083),
      "Should report M4083 for unclosed subroutine",
    );
  });

  test("Multi-unit scoping & inter-procedural INTENT(IN) violation across CALLs", () => {
    const src = `module test_mod
  implicit none
contains
  subroutine caller(x_in, y_out)
    implicit none
    real(8), intent(in) :: x_in
    real(8), intent(out) :: y_out
    real(8), allocatable :: buf(:)
    allocate(buf(4))
    buf(1) = x_in
    call mutator(x_in)
    y_out = sum(buf)
    deallocate(buf)
  end subroutine caller

  subroutine mutator(target_out)
    implicit none
    real(8), intent(out) :: target_out
    target_out = 42.0
  end subroutine mutator
end module test_mod
`;
    const diags = lintFortran(src);
    // Passing caller's INTENT(IN) 'x_in' to mutator's INTENT(OUT) 'target_out' must trigger M4081
    const m4081 = diags.find((d) => d.code === 4081);
    assert.ok(m4081, "Should report M4081 when passing INTENT(IN) variable to INTENT(OUT) dummy argument");
    assert.ok(m4081.message.includes("'x_in'"));
    // No false M4082 on MODULE, CONTAINS, ALLOCATE, DEALLOCATE, or array element assignment
    assert.equal(diags.filter((d) => d.code === 4082).length, 0);
  });
});
