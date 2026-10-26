// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { lowerCToDae } from "../src/dae/lowering.js";

describe("@modelscript/c DAE Arena Lowering Suite", () => {
  test("lowers ODE state derivatives and algebraic equations to IDaeBuilder arena", () => {
    const variables: any[] = [];
    const equations: any[] = [];
    let exprCounter = 1;

    const mockBuilder: any = {
      addVariable(name: string, type: any, variability: any, causality: any, startVal: number) {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      addEquation(kind: any, lhs: number, rhs: number) {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addDer(varId: number) {
        return exprCounter++;
      },
      addName(varId: number) {
        return exprCounter++;
      },
      addBinaryExpr(op: any, left: number, right: number) {
        return exprCounter++;
      },
      addRealLiteral(val: number) {
        return exprCounter++;
      },
    };

    const cLines = ["// Continuous state derivative", "dx[0] = 2.0 * x[0] + 5.0;", "y = x[0] * 3.0;"];

    const res = lowerCToDae(mockBuilder, cLines, "c_block");

    assert.equal(res.equationCount, 2);
    assert.equal(res.stateVarIndices.length, 1);
    assert.ok(variables.some((v) => v.name === "c_block_s_0"));
    assert.ok(variables.some((v) => v.name === "c_block_y"));
  });
});
