// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseApdl, parseApdlWithWasm, splitApdlFields } from "../src/parser/index.js";
import { evaluateApdlExpression, expandApdlMacros } from "../src/solver/index.js";

describe("APDL Parser & Macro Expander", () => {
  it("parses processors, commands, comments, and inline $ separators", () => {
    const src = `
! Cantilever beam model
/TITLE, Cantilever Beam Test
/UNITS, SI
/PREP7
ET, 1, BEAM188 ! 3D beam element
MP, EX, 1, 210e9 $ MP, PRXY, 1, 0.3
SECTYPE, 1, BEAM, RECT
SECDATA, 0.05, 0.10
K, 1, 0, 0, 0
K, 2, 2.0, 0, 0
L, 1, 2
ESIZE, , 4
LMESH, ALL
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 5, FY, -1000
SOLVE
FINISH
/POST1
PRNSOL, U, COMP
FINISH
`;
    const deck = parseApdl(src);
    assert.strictEqual(deck.title, "Cantilever Beam Test");
    assert.strictEqual(deck.units, "SI");
    assert.strictEqual(deck.syntaxErrors.length, 0);

    const procs = deck.statements.filter((s) => s.kind === "processor").map((s) => s.processor);
    assert.deepStrictEqual(procs, ["PREP7", "BEGIN", "SOLU", "BEGIN", "POST1", "BEGIN"]);

    const esize = deck.statements.find((s) => s.kind === "command" && s.command === "ESIZE");
    assert.ok(esize && esize.kind === "command");
    assert.deepStrictEqual(esize.args, ["", "4"]);
  });

  it("parses parametric macros (*SET, *DIM, *DO/*ENDDO, *IF/*ELSE/*ENDIF, *GET, param = expr)", () => {
    const src = `
*SET, NSEG, 5
L = 2.0
DX = L / NSEG
*DIM, XCOORD, ARRAY, NSEG
/PREP7
ET, 1, LINK180
MP, EX, 1, 200e9
R, 1, 1e-4
*DO, I, 1, NSEG + 1, 1
  N, I, (I - 1) * DX, 0, 0
  *IF, I, LE, NSEG, THEN
    XCOORD(I) = (I - 1) * DX
  *ELSE
    LAST_NODE = I
  *ENDIF
*ENDDO
*DO, I, 1, NSEG, 1
  E, I, I + 1
*ENDDO
*GET, NCNT, NODE, 0, COUNT
*GET, ECNT, ELEM, 0, COUNT
FINISH
`;
    const deck = parseApdl(src);
    assert.strictEqual(deck.syntaxErrors.length, 0);

    const model = expandApdlMacros(deck);
    assert.strictEqual(model.parameters.get("NSEG"), 5);
    assert.strictEqual(model.parameters.get("DX"), 0.4);
    assert.strictEqual(model.parameters.get("LAST_NODE"), 6);
    assert.strictEqual(model.parameters.get("NCNT"), 6);
    assert.strictEqual(model.parameters.get("ECNT"), 5);
    assert.strictEqual(model.nodes.size, 6);
    assert.strictEqual(model.elements.size, 5);
    assert.strictEqual(model.arrays.get("XCOORD")?.[4], 1.6);
  });

  it("evaluates arithmetic expressions with operator precedence and APDL math functions", () => {
    const params = new Map<string, number>([
      ["A", 3],
      ["B", 4],
    ]);
    assert.strictEqual(evaluateApdlExpression("A + B * 2", params), 11);
    assert.strictEqual(evaluateApdlExpression("(A + B) * 2", params), 14);
    assert.strictEqual(evaluateApdlExpression("SQRT(A**2 + B**2)", params), 5);
    assert.ok(Math.abs(evaluateApdlExpression("SIN(PI / 2)", params) - 1) < 1e-12);
    assert.strictEqual(evaluateApdlExpression("-A + 10", params), 7);
  });

  it("splits comma fields while preserving parenthesized expressions and quotes", () => {
    assert.deepStrictEqual(splitApdlFields("N, I, (I-1)*DX, SIN(PI/2), 0"), ["N", "I", "(I-1)*DX", "SIN(PI/2)", "0"]);
  });

  it("detects syntax errors and parses with native WASM GLR parser", () => {
    const valid = `/PREP7\nET, 1, BEAM188\nL = 2.5\nMP, EX, 1, 210e9\nFINISH\n`;
    const { deck, wasmSyntaxErrors } = parseApdlWithWasm(valid);
    assert.strictEqual(deck.syntaxErrors.length, 0);
    assert.strictEqual(wasmSyntaxErrors.length, 0);

    const broken = `L = (1 + 2\nX = \n`;
    const badDeck = parseApdl(broken);
    assert.ok(badDeck.syntaxErrors.length >= 2);
  });
});
