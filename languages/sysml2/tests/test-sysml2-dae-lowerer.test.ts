// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { SysML2DaeLowerer } from "../src/sysml2-dae-lowerer.js";

describe("SysML v2 Direct DAE Arena Lowering & Execution", () => {
  it("lowers arithmetic and comparison expressions into DAE arena ExprIds", async () => {
    await initBltWasm();
    const arena = new DAEBuilder();

    const expr1 = SysML2DaeLowerer.lowerExpression("2.0 * x + 5.0", arena);
    assert(expr1 >= 0, "ExprId should be non-negative");

    const expr2 = SysML2DaeLowerer.lowerExpression("(a + b) * (c - d) / 2.0", arena);
    assert(expr2 >= 0);

    const expr3 = SysML2DaeLowerer.lowerExpression("x > 0.0 && y <= 10.0", arena);
    assert(expr3 >= 0);
  });

  it("lowers an action with assignments and executes with concrete inputs", async () => {
    const actionSysml = `
      action def ComputeTelemetry {
        in item voltage : Real;
        in item current : Real;
        out item power : Real;
        out item resistance : Real;

        assign power := voltage * current;
        assign resistance := voltage / current;
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "ComputeTelemetry");
    assert.deepStrictEqual(lowered.inputs, ["voltage", "current"]);
    assert.deepStrictEqual(lowered.outputs, ["power", "resistance"]);
    assert(lowered.stmtCount >= 2);

    const outputs = SysML2DaeLowerer.execute(lowered, {
      voltage: 12.0,
      current: 3.0,
    });

    assert.strictEqual(outputs["power"], 36.0);
    assert.strictEqual(outputs["resistance"], 4.0);
  });

  it("lowers conditional if/else logic and executes branches", async () => {
    const actionSysml = `
      action def ClampSpeed {
        in item speedIn : Real;
        out item speedOut : Real;

        if (speedIn > 100.0) {
          assign speedOut := 100.0;
        } else {
          assign speedOut := speedIn;
        }
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "ClampSpeed");

    // Branch 1: speed > 100
    const outHigh = SysML2DaeLowerer.execute(lowered, { speedIn: 150.0 });
    assert.strictEqual(outHigh["speedOut"], 100.0);

    // Branch 2: speed <= 100
    const outNormal = SysML2DaeLowerer.execute(lowered, { speedIn: 75.0 });
    assert.strictEqual(outNormal["speedOut"], 75.0);
  });

  it("lowers a while loop and executes iteration", async () => {
    const actionSysml = `
      action def Accumulate {
        in item count : Real;
        out item total : Real;

        assign total := 0.0;
        assign i := 0.0;

        while (i < count) {
          assign total := total + 2.0;
          assign i := i + 1.0;
        }
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.strictEqual(lowered.name, "Accumulate");

    const result = SysML2DaeLowerer.execute(lowered, { count: 5.0 });
    assert.strictEqual(result["total"], 10.0);
  });

  it("lowers a calculation definition with return statement", async () => {
    const calcSysml = `
      calc def SquareAndAdd {
        in item x : Real;
        in item y : Real;
        return result : Real;

        assign temp := x * x;
        return temp + y;
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(calcSysml);
    assert.strictEqual(lowered.name, "SquareAndAdd");
    assert(lowered.outputs.includes("result"));
  });

  it("lowers and executes elementary transcendental and math function calls", async () => {
    const actionSysml = `
      action def MathOps {
        in item val : Real;
        out item root : Real;
        out item sine : Real;

        assign root := sqrt(val);
        assign sine := sin(val);
      }
    `;

    const lowered = await SysML2DaeLowerer.lowerAction(actionSysml);
    assert.deepStrictEqual(lowered.inputs, ["val"]);
    assert.deepStrictEqual(lowered.outputs, ["root", "sine"]);

    const res = SysML2DaeLowerer.execute(lowered, { val: 4.0 });
    assert.strictEqual(res["root"], 2.0);
    assert(Math.abs(res["sine"]! - Math.sin(4.0)) < 1e-6);
  });
});
