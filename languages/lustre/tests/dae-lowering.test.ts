// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, ExprKind, VarType } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerLustreToDae, lustreToDae, parseLustre } from "../src/index.js";

describe("@modelscript/lustre — Clocked DAE Lowering Suite", () => {
  it("lowers pre, ->, and when streams directly into IDaeBuilder with Clock variables and Pre expressions", () => {
    const vars: Array<{ name: string; type: number; variability: number; causality: number; startVal: number }> = [];
    const eqs: Array<{ kind: number; lhs: number; rhs: number; aux?: number | undefined }> = [];
    const exprs: Array<{ kind: number; data1?: number | undefined }> = [];

    const mockBuilder: any = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal = 0) => {
        vars.push({ name, type, variability, causality, startVal });
        return vars.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number, aux?: number) => {
        eqs.push({ kind, lhs, rhs, aux });
        return eqs.length - 1;
      },
      addExpression: (kind: number, data1?: number) => {
        exprs.push({ kind, data1 });
        return exprs.length - 1;
      },
      addBinaryExpr: () => {
        exprs.push({ kind: ExprKind.Binary });
        return exprs.length - 1;
      },
      addUnaryExpr: () => {
        exprs.push({ kind: ExprKind.Unary });
        return exprs.length - 1;
      },
      addRealLiteral: () => {
        exprs.push({ kind: ExprKind.RealLiteral });
        return exprs.length - 1;
      },
      addIntLiteral: () => {
        exprs.push({ kind: ExprKind.IntLiteral });
        return exprs.length - 1;
      },
      addBoolLiteral: () => {
        exprs.push({ kind: ExprKind.BoolLiteral });
        return exprs.length - 1;
      },
      addName: () => {
        exprs.push({ kind: ExprKind.Name });
        return exprs.length - 1;
      },
      addIfElse: () => {
        exprs.push({ kind: ExprKind.IfElse });
        return exprs.length - 1;
      },
      addCall: () => {
        exprs.push({ kind: ExprKind.Call });
        return exprs.length - 1;
      },
      lookupVariable: () => -1,
    };

    const prog = parseLustre(`
node ClockedIntegrator(u, dt: real; tick: bool) returns (y: real; ys: real);
let
  y = 0.0 -> (pre(y) + dt * u);
  ys = y when tick;
tel
`);

    const res = lowerLustreToDae(mockBuilder, prog, { samplePeriod: 0.02 });
    assert.strictEqual(res.nodeName, "ClockedIntegrator");
    assert.strictEqual(res.samplePeriod, 0.02);
    assert.ok(res.clockVarIndices.length >= 2, "Expected base clock and sub-clock for `when tick`");
    assert.ok(res.stateVarIndices.length >= 1, "Expected `y` tracked as pre-state variable");
    assert.ok(res.initialEquationCount >= 2, "Expected initial equations for `_first_tick` and `y`");
    assert.strictEqual(res.equationCount, 2);

    assert.ok(vars.some((v) => v.name === "_clk_base" && v.type === VarType.Clock));
    assert.ok(vars.some((v) => v.name === "_clk_tick" && v.type === VarType.Clock));
    assert.ok(
      exprs.some((e) => e.kind === ExprKind.Pre),
      "Expected ExprKind.Pre in arena",
    );
    assert.ok(
      eqs.some((e) => e.kind === EqKind.When),
      "Expected EqKind.When for sub-sampled stream",
    );
    assert.ok(
      eqs.some((e) => e.kind === EqKind.InitialSimple),
      "Expected EqKind.InitialSimple for ->",
    );
  });

  it("lowers into a real linear-memory DAEBuilder instance via lustreToDae()", () => {
    const prog = parseLustre(`
node Counter(reset: bool) returns (n: int);
let
  n = if reset then 0 else (0 -> pre(n) + 1);
tel
`);
    const { builder, result } = lustreToDae(prog);
    assert.strictEqual(result.nodeName, "Counter");
    assert.ok(builder.getVarCount() >= 4);
    assert.ok(builder.getEqCount() >= 2);
    assert.ok(builder.getExprCount() > 0);
  });
});
