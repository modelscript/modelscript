// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsmpDeck, parseCsmpExpression } from "../src/index.js";

describe("@modelscript/csmp — CSMP/360 & CSSL-67 Deck Parser", () => {
  it("parses a complete IBM CSMP/360 deck with all structural sections and directives", () => {
    const deck = `
* IBM System/360 CSMP Damped Spring-Mass Example
TITLE DAMPED SPRING-MASS SYSTEM
INITIAL
  CONST PI2 = 6.2831853
  PARAM M = 1.0, C = 0.4, K = 4.0
  INCON X0 = 1.0, V0 = 0.0
  FIXED NSTEP
  WN = SQRT(K / M)
DYNAMIC
SORT
  XDD = (-C * XD - K * X) / M
  XD = INTGRL(V0, XDD)
  X = INTGRL(X0, XD)
NOSORT
  ENERGY = 0.5 * M * XD**2 + ...
           0.5 * K * X**2
TERMINAL
  FINAL_E = ENERGY
TIMER FINTIM = 10.0, DELT = 0.01, PRDEL = 0.5, OUTDEL = 0.5
METHOD RKSFX
PRINT X, XD, ENERGY
PRTPLT X(XD)
END
STOP
`;
    const prog = parseCsmpDeck(deck);
    assert.equal(prog.errors.length, 0, `Unexpected parse errors: ${prog.errors.map((e) => e.message).join("; ")}`);
    assert.equal(prog.title, "DAMPED SPRING-MASS SYSTEM");
    assert.equal(prog.parameters.get("M")?.value, 1.0);
    assert.equal(prog.parameters.get("C")?.value, 0.4);
    assert.equal(prog.parameters.get("K")?.value, 4.0);
    assert.equal(prog.constants.get("PI2")?.value, 6.2831853);
    assert.equal(prog.incons.get("X0")?.value, 1.0);
    assert.equal(prog.incons.get("V0")?.value, 0.0);
    assert.ok(prog.fixedVars.has("NSTEP"));

    assert.equal(prog.initialStatements.length, 1);
    assert.equal(prog.initialStatements[0]?.target, "WN");

    assert.equal(prog.dynamicStatements.length, 4);
    assert.equal(prog.dynamicStatements[0]?.sortMode, "SORT");
    assert.equal(prog.dynamicStatements[3]?.target, "ENERGY");
    assert.equal(prog.dynamicStatements[3]?.sortMode, "NOSORT");

    assert.equal(prog.terminalStatements.length, 1);
    assert.equal(prog.terminalStatements[0]?.target, "FINAL_E");

    assert.equal(prog.timer.fintim, 10.0);
    assert.equal(prog.timer.delt, 0.01);
    assert.equal(prog.timer.prdel, 0.5);
    assert.equal(prog.timer.outdel, 0.5);
    assert.equal(prog.method, "RKSFX");
    assert.deepEqual(prog.printVars, ["X", "XD", "ENERGY"]);
    assert.deepEqual(prog.prtpltVars, ["X", "XD"]);
    assert.equal(prog.hasEnd, true);
    assert.equal(prog.hasStop, true);
  });

  it("parses FUNCTION tables, MACRO/ENDMAC, and PROCEDURE/ENDPRO blocks", () => {
    const deck = `
TITLE NONLINEAR SERVO WITH MACRO AND TABLE
FUNCTION CURVE = (0.0, 0.0), (1.0, 2.0), (2.0, 5.0)
MACRO OUT = GAINBLK(IN, K)
  OUT = K * IN
ENDMAC
DYNAMIC
PROCEDURE Y = SATPROC(U)
  Y = LIMIT(-1.0, 1.0, U)
ENDPRO
  U = AFGEN(CURVE, TIME)
  Z = GAINBLK(U, 2.5)
TIMER FINTIM = 2.0, DELT = 0.05
END
`;
    const prog = parseCsmpDeck(deck);
    assert.equal(prog.errors.length, 0);

    const tbl = prog.functionTables.get("CURVE");
    assert.ok(tbl);
    assert.equal(tbl.points.length, 3);
    assert.deepEqual(tbl.points[2], { x: 2.0, y: 5.0 });

    const macro = prog.macros.get("GAINBLK");
    assert.ok(macro);
    assert.equal(macro.closed, true);
    assert.deepEqual(macro.outputs, ["OUT"]);
    assert.deepEqual(macro.inputs, ["IN", "K"]);
    assert.equal(macro.body.length, 1);

    assert.equal(prog.procedures.length, 1);
    assert.equal(prog.procedures[0]?.closed, true);
    assert.deepEqual(prog.procedures[0]?.outputs, ["Y"]);
    assert.deepEqual(prog.procedures[0]?.inputs, ["U"]);
  });

  it("parses arithmetic expression precedence and Fortran D-exponents", () => {
    const expr = parseCsmpExpression("-A + B * C ** 2 - 1.5D-3");
    assert.equal(expr.kind, "binary");
    assert.equal(expr.op, "-");
    assert.equal(expr.right.kind, "number");
    assert.equal(expr.right.value, 0.0015);
  });
});
