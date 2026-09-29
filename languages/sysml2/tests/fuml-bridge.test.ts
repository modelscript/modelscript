// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import test from "node:test";
import { SysML2FumlBridge } from "../src/fuml-bridge.js";

test("SysML2FumlBridge - SysML v2 Action Execution Engine", async (t) => {
  await t.test("compiles and executes sequential action successions with assignments", () => {
    const sysmlSource = `
action def BatteryManager {
  action readVoltage {
    assign voltage := 4.2;
  }
  action calculateCharge {
    assign percentage := voltage * 20;
  }
  action logStatus {
    assign completed := true;
  }

  first readVoltage then calculateCharge;
  first calculateCharge then logStatus;
}
`;

    const engine = SysML2FumlBridge.compile(sysmlSource);
    engine.init();

    const summary = engine.run(20);
    assert.strictEqual(summary.status, "completed");

    const vars = engine.getVariables();
    assert.strictEqual(vars.voltage, 4.2);
    assert.strictEqual(vars.percentage, 84);
    assert.strictEqual(vars.completed, true);
  });

  await t.test("executes action flows with custom behavior injection", () => {
    const sysmlSource = `
action def OrderPipeline {
  action validateOrder;
  action chargePayment;
  action dispatchPackage;

  first validateOrder then chargePayment;
  first chargePayment then dispatchPackage;
}
`;

    const executionLog: string[] = [];

    const engine = SysML2FumlBridge.compile(sysmlSource, {
      validateOrder: (_in, ctx) => {
        executionLog.push("validated");
        ctx.isValid = true;
      },
      chargePayment: (_in, ctx) => {
        executionLog.push("charged");
        ctx.balance = (ctx.balance || 100) - 40;
      },
      dispatchPackage: (_in, ctx) => {
        executionLog.push("dispatched");
        ctx.trackingId = "TRK-9821";
      },
    });

    engine.init({ balance: 100 });
    const summary = engine.run(20);

    assert.strictEqual(summary.status, "completed");
    assert.deepStrictEqual(executionLog, ["validated", "charged", "dispatched"]);
    assert.strictEqual(engine.getVariables().balance, 60);
    assert.strictEqual(engine.getVariables().trackingId, "TRK-9821");
  });
});
