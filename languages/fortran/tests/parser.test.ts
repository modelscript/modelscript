// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { lowerFortranToDae } from "../src/dae/lowering.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "../dist/parser.wasm");

describe("@modelscript/fortran WASM GLR Parser & DAE Lowering Suite", () => {
  test("WASM parser parses subroutines, loops, conditionals, and expressions", async () => {
    assert.ok(fs.existsSync(wasmPath), "parser.wasm should exist");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);

    const fortranSample = `
SUBROUTINE CONTROL(IN_VAL, OUT_VAL)
  IMPLICIT NONE
  REAL IN_VAL, OUT_VAL
  REAL GAIN, LIMIT
  INTEGER I
  PARAMETER (GAIN = 2.5)

  OUT_VAL = IN_VAL * GAIN

  IF (OUT_VAL > 100.0) THEN
    OUT_VAL = 100.0
  ELSE IF (OUT_VAL < -100.0) THEN
    OUT_VAL = -100.0
  ELSE
    OUT_VAL = OUT_VAL
  END IF

  DO I = 1, 10
    OUT_VAL = OUT_VAL + 0.1
  END DO

  RETURN
END SUBROUTINE
`;

    const tree = parser.parse(fortranSample);
    assert.ok(tree, "Parser should return syntax tree");
    const root = tree.rootNode;
    assert.equal(root.type, "SourceFile");
    assert.ok(root.childCount > 0);

    const errors: string[] = [];
    function checkErrors(node: any) {
      if (node.hasError && node.hasError()) {
        errors.push(`Error at [${node.startPosition.row}:${node.startPosition.column}]: ${node.text}`);
      }
      for (let i = 0; i < node.childCount; i++) {
        checkErrors(node.child(i));
      }
    }
    checkErrors(root);
    assert.deepEqual(errors, [], `Parser found errors:\n${errors.join("\n")}`);
  });

  test("lowerFortranToDae: lowers state derivatives and algebraic equations to DAE arena", () => {
    // Mock minimal IDaeBuilder
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

    const lines = ["! EASY5 state derivative formulation", "SD(1) = 2.0 * S(1) + 5.0", "Y = S(1) * 3.0"];

    const res = lowerFortranToDae(mockBuilder, lines, "easy5_blk");

    assert.equal(res.equationCount, 2);
    assert.equal(res.stateVarIndices.length, 1);
    assert.ok(variables.some((v) => v.name === "easy5_blk_s_1"));
    assert.ok(variables.some((v) => v.name === "easy5_blk_Y"));
  });

  test("lowerFortranToDae: handles unary minus, power operator (**), and intrinsic math functions", () => {
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
      addUnaryExpr(op: any, operand: number) {
        return exprCounter++;
      },
    };

    const lines = [
      "! Advanced EASY5 state equations",
      "SD(1) = -S(1) * 2.5 - 10.0",
      "SD(2) = SQRT(S(1)) + S(2)**2.0",
      "der_omega = -(M_TORQUE * 0.05)",
      "OUT_VAL = EXP(-S(1)) * 50.0",
    ];

    const res = lowerFortranToDae(mockBuilder, lines, "f_block");
    assert.equal(res.equationCount, 4);
    assert.equal(res.stateVarIndices.length, 3); // s_1, s_2, omega
    assert.ok(variables.some((v) => v.name === "f_block_s_1"));
    assert.ok(variables.some((v) => v.name === "f_block_s_2"));
    assert.ok(variables.some((v) => v.name === "f_block_omega"));
    assert.ok(variables.some((v) => v.name === "f_block_M_TORQUE"));
    assert.ok(variables.some((v) => v.name === "f_block_OUT_VAL"));
  });
});
