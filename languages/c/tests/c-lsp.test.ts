// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLspService, getCCompletions, getCDocumentSymbols, getCHover, LspSymbolKind, validateC } from "../src/lsp.js";

const VALID_C_CODE = `
#include <stdio.h>

typedef struct State {
  double position;
  double velocity;
  int id;
} State;

void update_dynamics(State *s, double dt) {
  s->position += s->velocity * dt;
}

int main() {
  State sys = {0.0, 1.0, 42};
  update_dynamics(&sys, 0.01);
  return 0;
}
`;

const C_CODE_WITH_ERRORS = `
void bad_calc(int x) {
  int y = x / 0; // division by zero
  int z = x % 0;
}
`;

describe("C Language Server Protocol (LSP) Services (@modelscript/c)", () => {
  it("validates clean C code without diagnostic errors", () => {
    const diags = validateC(VALID_C_CODE);
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0, "Valid C code should not produce fatal errors");
  });

  it("produces diagnostics for division by zero and static analysis rules", () => {
    const diags = validateC(C_CODE_WITH_ERRORS);
    assert.ok(diags.length >= 2, "Should identify both division and modulo by zero");
    const divZero = diags.find((d) => d.code === "M8402");
    assert.ok(divZero, "Should find M8402 division by zero diagnostic");
    assert.equal(divZero.severity, 1);
  });

  it("extracts document symbols hierarchy (structs, fields, functions)", () => {
    const symbols = getCDocumentSymbols(VALID_C_CODE);
    assert.ok(symbols.length >= 2, "Should find struct and functions");

    const structSym = symbols.find((s) => s.kind === LspSymbolKind.Struct && s.name.includes("State"));
    assert.ok(structSym, "Should extract State struct symbol");
    assert.ok(structSym.children && structSym.children.length === 3, "State struct should have 3 fields");

    const fnSym = symbols.find((s) => s.kind === LspSymbolKind.Function && s.name.startsWith("update_dynamics"));
    assert.ok(fnSym, "Should extract update_dynamics function symbol");
  });

  it("provides contextual hover information for keywords and types", () => {
    const lines = VALID_C_CODE.split("\n");
    const structLine = lines.findIndex((l) => l.includes("typedef struct State"));
    assert.ok(structLine >= 0);

    const hoverDouble = getCHover(VALID_C_CODE, { line: structLine + 1, character: 4 });
    assert.ok(hoverDouble, "Hover on double should return type doc");
    assert.ok(hoverDouble.contents.value.includes("IEEE 754"));

    const hoverVoid = getCHover(VALID_C_CODE, { line: structLine + 6, character: 1 });
    assert.ok(hoverVoid, "Hover on void should return void doc");
    assert.ok(hoverVoid.contents.value.includes("Empty or incomplete type"));
  });

  it("provides intelligent completions for C primitives and standard library", () => {
    const completions = getCCompletions(VALID_C_CODE, { line: 10, character: 2 });
    assert.ok(completions.length >= 8);
    assert.ok(completions.some((c) => c.label === "int"));
    assert.ok(completions.some((c) => c.label === "struct"));
    assert.ok(completions.some((c) => c.label === "printf"));
    assert.ok(completions.some((c) => c.label === "malloc"));
  });

  it("supports CLspService class wrapper methods", () => {
    const service = new CLspService();
    const diags = service.validate(VALID_C_CODE);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = service.getDocumentSymbols(VALID_C_CODE);
    assert.ok(symbols.length > 0);

    const hover = service.getHover(VALID_C_CODE, { line: 3, character: 2 });
    assert.ok(hover !== undefined);

    const comps = service.getCompletions(VALID_C_CODE, { line: 0, character: 0 });
    assert.ok(comps.length > 0);
  });
});
