// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerSlamToDae } from "../src/dae/index.js";
import { parseSlamDeck } from "../src/parser/index.js";

describe("@modelscript/slam — Direct DAE Arena Lowering", () => {
  it("lowers continuous DD/SS equations, INTLC start values, RESOURCE balances, QUEUE balances, and DETECT residuals", () => {
    const variables: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> =
      [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];
    let exprSeq = 100;

    const builder: any = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: () => ++exprSeq,
      addRealLiteral: () => ++exprSeq,
      addName: (varId: number) => 1000 + varId,
      addDer: (varId: number) => 2000 + varId,
    };

    const deck = `
GEN, PRITSKER, DAE_TANK, 1/1/1979, 1;
CONTINUOUS, 2, 1, 0.01, 0.1, 0.1;
INTLC, SS(1)=10.0, SS(2)=50.0, XX(1)=2.0;
DD(1) = 100.0 * XX(1) - 25.0;
DD(2) = 25.0 - 0.1 * SS(2);
SS(3) = SS(1) + SS(2);
NETWORK;
  RESOURCE/DOCK(2), 1;
  QUEUE(1), 0, 20;
  DETECT, SS(1), XP, 150.0, 0.01;
ENDNETWORK;
FIN;
`;
    const model = parseSlamDeck(deck);
    const res = lowerSlamToDae(builder, model);

    // 2 differential states (SS_1, SS_2)
    assert.equal(res.stateVarIndices.length, 2);
    assert.ok(res.variableMap.has("SS_1"));
    assert.ok(res.variableMap.has("SS_2"));
    assert.ok(res.variableMap.has("SS_3"));
    assert.ok(res.variableMap.has("XX_1"));

    // Verify INTLC start values preserved
    const ss1 = variables.find((v) => v.name === "SS_1");
    const ss2 = variables.find((v) => v.name === "SS_2");
    const xx1 = variables.find((v) => v.name === "XX_1");
    assert.equal(ss1?.startVal, 10.0);
    assert.equal(ss2?.startVal, 50.0);
    assert.equal(xx1?.startVal, 2.0);

    // Resource balance variables (avail, util)
    assert.ok(res.resourceVars.includes("RES_DOCK_avail"));
    assert.ok(res.resourceVars.includes("RES_DOCK_util"));

    // Detect residual variable
    assert.equal(res.detectVars.length, 1);

    // Equations: 2 DD + 1 SS + 2 RESOURCE + 1 QUEUE + 1 DETECT = 7
    assert.equal(res.equationCount, 7);
    assert.equal(equations.length, 7);
    assert.ok(variables.length >= 10);
  });
});
