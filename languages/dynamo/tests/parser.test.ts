// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDynamo, parseDynamoExpr } from "../src/index.js";

describe("@modelscript/dynamo Parser Suite", () => {
  it("parses all classic DYNAMO equation types (L, R, A, N, C, T, S) and directives", () => {
    const source = `
NOTE POPULATION GROWTH MODEL
* CLASSIC MIT DYNAMO DECK
L POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)
N POP=1000
R BIRTH.KL=POP.K*BR.K
R DEATH.KL=POP.K*DR
A BR.K=TABHL(BRTAB,CROWD.K,0,4,1)
A CROWD.K=POP.K/CAP
S NETGR.K=BIRTH.JK-DEATH.JK
C DR=0.02, CAP=5000
T BRTAB=0.05/0.04/0.03/0.02/0.01
SPEC DT=0.25/LENGTH=50/PRTPER=5/PLTPER=2
PRINT POP,BIRTH,DEATH
PLOT POP=P(0,6000)/BIRTH=B
RUN BASE
`;
    const model = parseDynamo(source);
    assert.strictEqual(model.errors.length, 0, `Unexpected parse errors: ${JSON.stringify(model.errors)}`);
    assert.strictEqual(model.name, "POPULATION_GROWTH_MODEL");
    assert.strictEqual(model.notes.length, 2);

    const kinds = model.equations.map((e) => `${e.kind}:${e.name}`);
    assert.deepStrictEqual(kinds, [
      "L:POP",
      "N:POP",
      "R:BIRTH",
      "R:DEATH",
      "A:BR",
      "A:CROWD",
      "S:NETGR",
      "C:DR",
      "C:CAP",
      "T:BRTAB",
    ]);

    // Check time subscripts
    assert.strictEqual(model.equations[0]!.subscript, "K");
    assert.strictEqual(model.equations[2]!.subscript, "KL");
    assert.strictEqual(model.equations[4]!.subscript, "K");
    assert.strictEqual(model.equations[1]!.subscript, undefined);

    // Check table values
    const tableEq = model.equations.find((e) => e.kind === "T");
    assert.deepStrictEqual(tableEq?.tableValues, [0.05, 0.04, 0.03, 0.02, 0.01]);

    // Check SPEC
    assert.strictEqual(model.spec.dt, 0.25);
    assert.strictEqual(model.spec.length, 50);
    assert.strictEqual(model.spec.prtper, 5);
    assert.strictEqual(model.spec.pltper, 2);

    // Check PRINT, PLOT, RUN
    assert.deepStrictEqual(model.prints[0]?.variables, ["POP", "BIRTH", "DEATH"]);
    assert.strictEqual(model.plots[0]?.entries.length, 2);
    assert.strictEqual(model.plots[0]?.entries[0]?.variable, "POP");
    assert.strictEqual(model.plots[0]?.entries[0]?.symbol, "P");
    assert.strictEqual(model.plots[0]?.entries[0]?.max, 6000);
    assert.strictEqual(model.runs[0]?.name, "BASE");
  });

  it("handles DYNAMO continuation lines (X / X1) and expression precedence", () => {
    const source = `
L INV.K=INV.J+(DT)*(
X PROD.JK-SHIP.JK)
N INV=100
R PROD.KL=10
R SHIP.KL=8
`;
    const model = parseDynamo(source);
    assert.strictEqual(model.errors.length, 0);
    const inv = model.equations.find((e) => e.kind === "L" && e.name === "INV");
    assert.ok(inv?.expr);
    assert.strictEqual(inv.expr.kind, "binary");
    assert.strictEqual(inv.expr.op, "+");

    const exprRes = parseDynamoExpr("2 + 3 * 4 ^ 2 - 1");
    assert.ok(exprRes.expr);
    assert.strictEqual(exprRes.error, undefined);
    assert.strictEqual(exprRes.expr.kind, "binary");
    assert.strictEqual(exprRes.expr.op, "-");
  });

  it("records syntax errors on malformed statements and invalid subscripts", () => {
    const source = `
L POP.Z=POP.J+DT*1
BADLINE WITHOUT EQUATION
T EMPTY=
`;
    const model = parseDynamo(source);
    assert.ok(model.errors.length >= 3, `Expected at least 3 parse errors, got ${model.errors.length}`);
  });
});
