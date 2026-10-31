// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerEasy5ToDae, parseEasy5 } from "../src/index.js";

describe("@modelscript/easy5 DAE Lowering Suite", () => {
  it("lowers continuous states and differential equations directly into IDaeBuilder", () => {
    const variables: any[] = [];
    const equations: any[] = [];

    const mockBuilder: any = {
      addVariable: (name: string, type: number, variability: number, causality: number, startVal: number) => {
        variables.push({ name, type, variability, causality, startVal });
        return variables.length - 1;
      },
      addEquation: (kind: number, lhs: number, rhs: number) => {
        equations.push({ kind, lhs, rhs });
        return equations.length - 1;
      },
      addBinaryExpr: (op: number, left: number, right: number) => 100 + equations.length,
      addUnaryExpr: (op: number, operand: number) => 200,
      addRealLiteral: (val: number) => 300,
      addName: (varId: number) => 400 + varId,
      addDer: (varId: number) => 500 + varId,
      addIfElse: (cond: number, trueE: number, falseE: number) => 600,
      lookupVariable: () => -1,
    };

    const source = `MODEL: FirstOrderLag
COMPONENTS:
  IN01 TYPE=GP/IN TITLE="Integrator"
    XP: GAIN=5.0, S0=1.0

  GA01 TYPE=GP/GA TITLE="Feedback Gain"
    XP: K=2.0

CONNECTIONS:
  IN01.OUT -> GA01.IN
  GA01.OUT -> IN01.IN
`;

    const model = parseEasy5(source);
    const result = lowerEasy5ToDae(mockBuilder, model);

    assert.ok(result.stateVarIndices.length >= 1, "Expected continuous state variable");
    assert.ok(result.equationCount >= 3, "Expected state derivative and output equations");

    // Verify state variable was added with S0 = 1.0
    const stateVar = variables.find((v) => v.name.includes("IN01_s"));
    assert.ok(stateVar, "Expected IN01_s variable in arena");
    assert.strictEqual(stateVar.startVal, 1.0);
  });

  it("lowers DZ, SW, FN, and TD components with conditional expressions and delay states", () => {
    const variables: any[] = [];
    const equations: any[] = [];
    let ifElseCalls = 0;

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
      addDer: (varId: number) => 500 + varId,
      addIfElse: () => {
        ifElseCalls++;
        return 600 + ifElseCalls;
      },
      lookupVariable: () => -1,
    };

    const source = `MODEL: NonlinearAndDelayBlocks
TABLES:
  TABLE: LUT1
    X = [0.0, 1.0, 2.0]
    DATA = [0.0, 2.0, 5.0]
  ENDTABLE
COMPONENTS:
  DZ01 TYPE=GP/DZ
    XP: DB=0.2, SLOPE=1.5
  SW01 TYPE=GP/SW
    XP: THRESHOLD=0.5
  FN01 TYPE=GP/FN
    XP: TABLE=LUT1
  TD01 TYPE=GP/TD
    XP: DELAY=0.05, S0=0.0
`;
    const model = parseEasy5(source);
    const result = lowerEasy5ToDae(mockBuilder, model);
    assert.strictEqual(result.stateVarIndices.length, 1, "Expected 1 state variable from TD01");
    assert.ok(ifElseCalls >= 5, "Expected if/else expressions for DZ, SW, and FN table lookup");
  });
});
