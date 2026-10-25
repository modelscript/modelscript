// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerRocetsToDae, parseRocetsDeck, validateRocetsFortranRoutine } from "../src/index.js";

describe("@modelscript/rocets DAE Lowering Suite", () => {
  it("lowers propulsion states and equations directly into IDaeBuilder", () => {
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

    const source = `DECK: EngineCore
COMPONENTS:
  CHAMBER TYPE=CHAMBER TITLE="Combustion Chamber"
    PARAMS: PC=10.0E6, AT=0.02, CSTAR=1780.0, VC=0.015
    S0: PC=10.0E6

  PUMP01 TYPE=PUMP TITLE="LH2 Pump"
    PARAMS: DELTA_P=15.0E6, ETA=0.75, RHO=71.0

  SHAFT01 TYPE=SHAFT TITLE="Turbopump Shaft"
    PARAMS: INERTIA=0.05, SPEED_RPM=35000.0

CONNECTIONS:
  PUMP01.OUT_P -> CHAMBER.IN_FUEL
`;

    const model = parseRocetsDeck(source);
    const result = lowerRocetsToDae(mockBuilder, model);

    assert.ok(result.stateVarIndices.length >= 2, "Expected Pc and omega continuous states");
    assert.ok(result.equationCount >= 4, "Expected chamber and shaft ODE equations");

    // Verify chamber state variable
    const chamberVar = variables.find((v) => v.name.includes("CHAMBER_Pc"));
    assert.ok(chamberVar, "Expected CHAMBER_Pc variable in arena");
    assert.strictEqual(chamberVar.startVal, 10.0e6);

    // Verify shaft state variable
    const shaftVar = variables.find((v) => v.name.includes("SHAFT01_omega"));
    assert.ok(shaftVar, "Expected SHAFT01_omega variable in arena");
  });

  it("validates embedded Fortran user routines via @modelscript/fortran", () => {
    const validRoutine = `
      SUBROUTINE USERMOD(P, T, H, RHO)
        REAL*8 P, T, H, RHO
        RHO = P / (287.0 * T)
        H = 1005.0 * T
        RETURN
      END
    `;

    const diags = validateRocetsFortranRoutine(validRoutine);
    assert.strictEqual(diags.length, 0, "Expected valid Fortran routine to pass linter");
  });
});
