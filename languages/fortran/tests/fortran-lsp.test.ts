// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FortranLspService,
  getFortranCompletions,
  getFortranDocumentSymbols,
  getFortranHover,
  LspSymbolKind,
  validateFortran,
} from "../src/lsp.js";

const VALID_FORTRAN_MODULE = `
module linear_algebra
  implicit none
  private
  public :: solve_system, dot

contains

  subroutine solve_system(a, b, x, n)
    integer, intent(in) :: n
    real(8), intent(in) :: a(n, n), b(n)
    real(8), intent(out) :: x(n)
    integer :: i
    do i = 1, n
      x(i) = b(i) / a(i, i)
    end do
  end subroutine solve_system

  function dot(v1, v2, n) result(res)
    integer, intent(in) :: n
    real(8), intent(in) :: v1(n), v2(n)
    real(8) :: res
    res = sum(v1 * v2)
  end function dot

end module linear_algebra
`;

const FORTRAN_WITH_ERRORS = `
subroutine bad_routine(x)
  implicit none
  real :: x, y
  x = 10.0 / 0.0
  z = x + 1.0
end subroutine bad_routine
`;

describe("Fortran Language Server Protocol (LSP) Services (@modelscript/fortran)", () => {
  it("validates compliant Fortran module without fatal errors", () => {
    const diags = validateFortran(VALID_FORTRAN_MODULE);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid Fortran module should produce 0 error diagnostics");
  });

  it("produces diagnostics for division by zero and undeclared variables under implicit none", () => {
    const diags = validateFortran(FORTRAN_WITH_ERRORS);
    assert.ok(diags.length >= 2, "Should detect division by zero and undeclared variable");

    const divZero = diags.find((d) => d.code === "M4072");
    assert.ok(divZero, "Should flag M4072 constant division by zero");
    assert.equal(divZero.severity, 1);

    const undeclared = diags.find((d) => d.code === "M4070");
    assert.ok(undeclared, "Should flag M4070 undeclared variable 'z'");
    assert.equal(undeclared.severity, 1);
  });

  it("extracts document symbols hierarchy (Module -> Subroutines & Functions)", () => {
    const symbols = getFortranDocumentSymbols(VALID_FORTRAN_MODULE);
    assert.ok(symbols.length >= 1, "Should find module symbol");

    const modSym = symbols.find((s) => s.kind === LspSymbolKind.Package && s.name.includes("linear_algebra"));
    assert.ok(modSym, "Should extract module linear_algebra");
    assert.ok(modSym.children && modSym.children.length === 2, "Module should contain 2 procedures");

    const subSym = modSym.children.find((s) => s.name.startsWith("solve_system"));
    assert.ok(subSym, "Should extract solve_system subroutine");
    assert.equal(subSym.kind, LspSymbolKind.Method);

    const fnSym = modSym.children.find((s) => s.name.startsWith("dot"));
    assert.ok(fnSym, "Should extract dot function");
    assert.equal(fnSym.kind, LspSymbolKind.Function);
  });

  it("provides contextual hover information for Fortran intrinsic procedures", () => {
    const lines = VALID_FORTRAN_MODULE.split("\n");
    const dotLine = lines.findIndex((l) => l.includes("res = sum("));
    assert.ok(dotLine >= 0);

    const hoverSum = getFortranHover(VALID_FORTRAN_MODULE, { line: dotLine, character: 12 });
    assert.ok(hoverSum, "Hover on sum should return intrinsic docs");
    assert.ok(hoverSum.contents.value.includes("sum(array"));

    const hoverImplicit = getFortranHover(VALID_FORTRAN_MODULE, { line: 2, character: 4 });
    assert.ok(hoverImplicit, "Hover on implicit should return implicit none docs");
    assert.ok(hoverImplicit.contents.value.includes("implicit none"));
  });

  it("provides intelligent completions for Fortran control blocks and intrinsics", () => {
    const completions = getFortranCompletions(VALID_FORTRAN_MODULE, { line: 5, character: 2 });
    assert.ok(completions.length >= 8);
    assert.ok(completions.some((c) => c.label === "subroutine"));
    assert.ok(completions.some((c) => c.label === "function"));
    assert.ok(completions.some((c) => c.label === "module"));
    assert.ok(completions.some((c) => c.label === "matmul"));
  });

  it("supports FortranLspService class wrapper methods", () => {
    const service = new FortranLspService();
    const diags = service.validate(VALID_FORTRAN_MODULE);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = service.getDocumentSymbols(VALID_FORTRAN_MODULE);
    assert.ok(symbols.length > 0);

    const hover = service.getHover(VALID_FORTRAN_MODULE, { line: 2, character: 4 });
    assert.ok(hover !== undefined);

    const comps = service.getCompletions(VALID_FORTRAN_MODULE, { line: 0, character: 0 });
    assert.ok(comps.length > 0);
  });
});
