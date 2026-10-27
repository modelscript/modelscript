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

  test("handles unary minus, parentheses, math functions, and struct arrow accesses", () => {
    const variables: any[] = [];
    const equations: any[] = [];
    const binaryOps: any[] = [];
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
        binaryOps.push({ op, left, right });
        return exprCounter++;
      },
      addRealLiteral(val: number) {
        return exprCounter++;
      },
      addUnaryExpr(op: any, operand: number) {
        return exprCounter++;
      },
    };

    const cLines = [
      "dx[0] = -x[0] * 2.0 - 5.0;",
      "dx[1] = sqrt(x[0]) + pow(x[1], 2.0);",
      "der_theta = -(state->omega * 0.1);",
      "out_val = exp(-x[0]) * 100.0;",
    ];

    const res = lowerCToDae(mockBuilder, cLines, "test_c");
    assert.equal(res.equationCount, 4);
    assert.equal(res.stateVarIndices.length, 3); // s_0, s_1, theta
    assert.ok(variables.some((v) => v.name === "test_c_s_0"));
    assert.ok(variables.some((v) => v.name === "test_c_s_1"));
    assert.ok(variables.some((v) => v.name === "test_c_theta"));
    assert.ok(variables.some((v) => v.name === "test_c_state_omega"));
    assert.ok(variables.some((v) => v.name === "test_c_out_val"));
  });
});
