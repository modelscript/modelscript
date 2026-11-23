// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dynamoToDae, lowerDynamoToDae, parseDynamo } from "../src/index.js";

describe("@modelscript/dynamo DAE Lowering Suite", () => {
  const LOGISTIC_MODEL = `
NOTE LOGISTIC POPULATION
L POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)
N POP=100
R BIRTH.KL=POP.K*RMAX*(1-POP.K/CAP)
R DEATH.KL=POP.K*DR
A RATIO.K=POP.K/CAP
C RMAX=0.2, CAP=1000, DR=0.05
SPEC DT=0.1/LENGTH=50
`;

  it("lowers Levels, Rates, Auxiliaries, and Constants directly into IDaeBuilder", () => {
    const variables: Array<{ name: string; variability: number; startVal: number }> = [];
    const equations: Array<{ kind: number; lhs: number; rhs: number }> = [];

    const mockBuilder: any = {
      addVariable: (name: string, _type: number, variability: number, _causality: number, startVal: number) => {
        variables.push({ name, variability, startVal });
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
      addDer: (varId: number) => 500 + varId,
      addIfElse: () => 600,
      lookupVariable: (name: string) => variables.findIndex((v) => v.name === name),
    };

    const model = parseDynamo(LOGISTIC_MODEL);
    const res = lowerDynamoToDae(mockBuilder, model);

    assert.strictEqual(res.stateVarIndices.length, 1, "Expected 1 state variable (POP)");
    assert.ok(res.parameterVarIndices.length >= 4, "Expected DT, RMAX, CAP, DR parameters");
    assert.strictEqual(res.algebraicVarIndices.length, 3, "Expected BIRTH, DEATH, RATIO algebraic variables");
    assert.strictEqual(res.equationCount, 4, "Expected 1 ODE + 3 algebraic equations");

    const popVar = variables.find((v) => v.name === "POP");
    assert.ok(popVar);
    assert.strictEqual(popVar.startVal, 100);
  });

  it("lowers directly into @modelscript/runtime DAEBuilder linear memory arena", () => {
    const model = parseDynamo(LOGISTIC_MODEL);
    const dae = dynamoToDae(model);

    assert.ok(dae.varCount >= 8, `Expected >= 8 variables in DAE arena, got ${dae.varCount}`);
    assert.strictEqual(dae.eqCount, 4, `Expected 4 equations in DAE arena, got ${dae.eqCount}`);
    assert.notStrictEqual(dae.lookupVariable("POP"), -1);
    assert.notStrictEqual(dae.lookupVariable("BIRTH"), -1);
    assert.notStrictEqual(dae.lookupVariable("CAP"), -1);
  });
});
