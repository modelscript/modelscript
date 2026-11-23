// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerCsmpToDae, parseCsmpDeck } from "../src/index.js";

describe("@modelscript/csmp — Direct DAE Arena Lowering", () => {
  it("lowers topologically sorted DYNAMIC equations and INTGRL states into IDaeBuilder", () => {
    const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> =
      [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
    const derVarIds: number[] = [];

    const mockBuilder: any = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => 100 + equations.length,
      addUnaryExpr: () => 200,
      addRealLiteral: () => 300,
      addName: (varId: number) => 400 + varId,
      addDer: (varId: number) => {
        derVarIds.push(varId);
        return 500 + varId;
      },
      addIfElse: () => 600,
      lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
    };

    // Intentionally out-of-order SORT statements to verify topological sorting
    const deck = `
TITLE SPRING MASS DAE
PARAM M = 2.0, C = 0.5, K = 8.0
INCON X0 = 1.5, V0 = 0.0
DYNAMIC
SORT
  X = INTGRL(X0, XD)
  XD = INTGRL(V0, XDD)
  XDD = FORCE / M
  FORCE = -C * XD - K * X
TIMER FINTIM = 5.0, DELT = 0.01
END
`;
    const prog = parseCsmpDeck(deck);
    const res = lowerCsmpToDae(mockBuilder, prog);

    assert.equal(res.algebraicLoops.length, 0);
    assert.equal(res.stateVarIndices.length, 2, "Expected 2 continuous states (X and XD)");
    assert.equal(res.equationCount, 4, "Expected 4 lowered equations");
    assert.equal(derVarIds.length, 2, "Expected 2 der() differential equations");

    // Verify topological order: FORCE must precede XDD
    const idxForce = res.sortedTargets.indexOf("FORCE");
    const idxXdd = res.sortedTargets.indexOf("XDD");
    assert.ok(idxForce >= 0 && idxXdd >= 0 && idxForce < idxXdd, "Expected FORCE to be sorted before XDD");

    // Verify start value of X is evaluated from INCON X0 = 1.5
    const xVar = variables.find((v) => v.name === "X");
    assert.ok(xVar);
    assert.equal(xVar.startVal, 1.5);
  });

  it("lowers REALPL, CMPXPL, LIMIT, and DEADSP standard blocks into DAE equations", () => {
    const variables: Array<{ name: string; startVal: number }> = [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];

    const mockBuilder: any = {
      addVariable: (name: string, _t: number, _v: number, _c: number, startVal: number) => {
        variables.push({ name, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => 100,
      addUnaryExpr: () => 200,
      addRealLiteral: () => 300,
      addName: (varId: number) => 400 + varId,
      addDer: (varId: number) => 500 + varId,
      addIfElse: () => 600,
      lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
    };

    const deck = `
TITLE TRANSFER BLOCKS DAE
DYNAMIC
  U = LIMIT(-1.0, 1.0, 2.0)
  D = DEADSP(-0.1, 0.1, U)
  Y1 = REALPL(0.0, 0.5, D)
  Y2 = CMPXPL(0.0, 0.0, 0.7, 3.0, Y1)
TIMER FINTIM = 2.0, DELT = 0.01
END
`;
    const res = lowerCsmpToDae(mockBuilder, parseCsmpDeck(deck));
    // 1 state from REALPL + 2 states from CMPXPL = 3 continuous states
    assert.equal(res.stateVarIndices.length, 3);
    // U, D, der(Y1), der(Y2), der(Y2_DER) = 5 equations
    assert.equal(res.equationCount, 5);
  });
});
