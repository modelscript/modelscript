// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CsmpErrorCode, lintCsmp, parseCsmpDeck, topologicalSortEquations } from "../src/index.js";

describe("@modelscript/csmp — Static Analysis & Lints (CSMP1001–CSMP5006)", () => {
  it("passes a clean CSMP/360 model with zero errors or warnings", () => {
    const cleanDeck = `
TITLE CLEAN FIRST ORDER DECAY
PARAM K = 0.5
INCON Y0 = 1.0
DYNAMIC
SORT
  YD = -K * Y
  Y = INTGRL(Y0, YD)
TIMER FINTIM = 5.0, DELT = 0.01, PRDEL = 0.5
METHOD RKSFX
PRINT Y
END
STOP
`;
    const prog = parseCsmpDeck(cleanDeck);
    const diags = lintCsmp(prog);
    const errsAndWarns = diags.filter((d) => d.severity === "error" || d.severity === "warning");
    assert.equal(
      errsAndWarns.length,
      0,
      `Expected no errors/warnings, got: ${errsAndWarns.map((d) => d.message).join("; ")}`,
    );
  });

  it("detects syntax errors (CSMP1001) and mismatched MACRO/ENDMAC (CSMP1002)", () => {
    const deck = `
MACRO Y = BADMAC(X)
  Y = X +
END
`;
    const diags = lintCsmp(parseCsmpDeck(deck));
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.SYNTAX_ERROR.id),
      "Expected CSMP1001",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.MISMATCHED_MACRO.id),
      "Expected CSMP1002",
    );
  });

  it("detects duplicate declarations (CSMP2001) and undefined variables (CSMP2002)", () => {
    const deck = `
PARAM K = 1.0
CONST K = 2.0
DYNAMIC
  Y = INTGRL(0.0, -K * Y + GHOST)
TIMER FINTIM = 1.0, DELT = 0.01
END
`;
    const diags = lintCsmp(parseCsmpDeck(deck));
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.DUPLICATE_DECLARATION.id),
      "Expected CSMP2001",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.UNDEFINED_VARIABLE.id),
      "Expected CSMP2002",
    );
  });

  it("detects algebraic loops in SORT sections (CSMP3001) while allowing INTGRL feedback", () => {
    const loopDeck = `
DYNAMIC
SORT
  A = B + 1.0
  B = A * 0.5
TIMER FINTIM = 1.0, DELT = 0.01
END
`;
    const prog = parseCsmpDeck(loopDeck);
    const topo = topologicalSortEquations(prog.dynamicStatements);
    assert.equal(topo.cycles.length, 1);

    const diags = lintCsmp(prog);
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.ALGEBRAIC_LOOP.id),
      "Expected CSMP3001",
    );
  });

  it("detects invalid TIMER parameters (CSMP4001) and invalid METHOD name (CSMP4002)", () => {
    const deck = `
DYNAMIC
  Y = INTGRL(1.0, -Y)
TIMER FINTIM = -5.0, DELT = 0.0, PRDEL = -1.0
METHOD EULER_BOGUS
END
`;
    const diags = lintCsmp(parseCsmpDeck(deck));
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.INVALID_TIMER.id),
      "Expected CSMP4001",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.INVALID_METHOD.id),
      "Expected CSMP4002",
    );
  });

  it("detects INTGRL arity (CSMP5001), bad FUNCTION table (CSMP5002), missing END (CSMP5003), INTGRL in INITIAL (CSMP5004), and unknown function (CSMP5006)", () => {
    const deck = `
FUNCTION BADTBL = (0.0, 1.0), (2.0, 3.0), (1.0, 4.0)
INITIAL
  Z = INTGRL(0.0, 1.0)
DYNAMIC
  X = INTGRL(0.0)
  W = FOOBAR(X)
TIMER FINTIM = 1.0, DELT = 0.01
`;
    const diags = lintCsmp(parseCsmpDeck(deck));
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.INVALID_INTGRL_ARITY.id),
      "Expected CSMP5001",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.INVALID_FUNCTION_TABLE.id),
      "Expected CSMP5002",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.MISSING_END.id),
      "Expected CSMP5003",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.INTGRL_OUTSIDE_DYNAMIC.id),
      "Expected CSMP5004",
    );
    assert.ok(
      diags.some((d) => d.id === CsmpErrorCode.UNKNOWN_FUNCTION.id),
      "Expected CSMP5006",
    );
  });
});
