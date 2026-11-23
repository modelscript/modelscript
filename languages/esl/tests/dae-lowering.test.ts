// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { eslToDae, lowerEslToDae, parseEsl } from "../src/index.js";

describe("@modelscript/esl DAE Lowering Suite", () => {
  it("lowers MODEL, SUBMODEL, INITIAL, DYNAMIC, IF, and WHEN directly to DAEBuilder", () => {
    const src = `
STUDY HybridDemo
  SUBMODEL Scale(IN REAL: x; OUT REAL: y)
  DYNAMIC
    y = 2.0 * x;
  END SUBMODEL Scale

  MODEL Bouncer
    CONSTANT REAL: g = 9.81;
    CONSTANT REAL: e = 0.8;
    REAL: h, v, scaled_h, drag;
  INITIAL
    h = 10.0;
    v = 0.0;
  DYNAMIC
    Scale(h, scaled_h);
    IF v < 0.0 THEN
      drag = 0.1 * v * v;
    ELSE
      drag = -0.1 * v * v;
    END_IF
    h' = v;
    v' = -g + drag;
    WHEN h <= 0.0 AND v < 0.0 THEN
      v := -e * v;
      h := 0.0;
    END_WHEN
  END MODEL Bouncer
END STUDY HybridDemo
`;
    const dae = eslToDae(src);
    assert.ok(dae.varCount >= 6, `Expected >= 6 variables in DAE arena, got ${dae.varCount}`);
    assert.ok(dae.eqCount >= 6, `Expected >= 6 equations in DAE arena, got ${dae.eqCount}`);

    // Also inspect lowering metadata directly via lowerEslToDae
    const program = parseEsl(src);
    const vars: Array<{ name: string; startVal: number }> = [];
    const mockBuilder = {
      addVariable: (name: string, _t: number, _v: number, _c: number, startVal = 0) => {
        vars.push({ name, startVal });
        return vars.length - 1;
      },
      addEquation: () => 0,
      addExpression: () => 0,
      addStatement: () => 0,
      addBinaryExpr: () => 1,
      addUnaryExpr: () => 2,
      addRealLiteral: () => 3,
      addIntLiteral: () => 4,
      addBoolLiteral: () => 5,
      addStringLiteral: () => 6,
      addDer: () => 7,
      addName: () => 8,
      addIfElse: () => 9,
      addCall: () => 10,
      lookupVariable: () => -1,
      getVarCount: () => vars.length,
      getEqCount: () => 0,
      getExprCount: () => 0,
      getStmtCount: () => 0,
      snapshot: () => undefined,
      rollback: () => undefined,
    };

    const res = lowerEslToDae(mockBuilder, program);
    assert.strictEqual(res.stateVarIndices.length, 2, "Expected h and v as continuous states");
    assert.strictEqual(res.whenCount, 1, "Expected 1 WHEN discontinuity block");
    assert.ok(res.equationCount >= 7, "Expected initial + dynamic + submodel + IF + WHEN equations");
    const hVar = vars.find((v) => v.name === "h");
    assert.ok(hVar);
    assert.strictEqual(hVar.startVal, 10.0);
  });
});
