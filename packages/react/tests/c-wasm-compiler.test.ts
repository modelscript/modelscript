// SPDX-License-Identifier: AGPL-3.0-or-later

import { CWasmCompilerClient, createWasmFmuRunner, parseCSourceModel } from "@modelscript/exchange";
import assert from "node:assert";
import { test } from "node:test";

test("CWasmCompilerClient background C-to-Wasm compilation and runner execution", async () => {
  const cSource = `
    double v_speed = 0.0;
    double der_speed = 0.0;
    double in_throttle = 1.0;
    double out_speed = 0.0;

    void wasm_do_step(double dt) {
      der_speed = -0.5 * v_speed + 2.0 * in_throttle;
      out_speed = 1.0 * v_speed;
    }
  `;

  // 1. Test compilation client
  const client = new CWasmCompilerClient();
  const stages: string[] = [];

  const res = await client.compile(
    {
      modelIdentifier: "VehicleDynamics",
      sources: cSource,
    },
    (st) => stages.push(st.stage),
  );

  assert.strictEqual(res.type, "SUCCESS");
  assert.ok(res.wasmByteLength > 0);
  assert.ok(stages.includes("ready"));

  // 2. Test runner stepping
  const spec = parseCSourceModel(cSource, "VehicleDynamics");
  const runner = await createWasmFmuRunner(res.wasmBinary, spec);
  runner.init(0.0);

  const initialSpeed = runner.getVar("out_speed");
  assert.strictEqual(initialSpeed, 0.0);

  // Step 10 times with throttle = 1.0
  let t = 0.0;
  for (let i = 0; i < 10; i++) {
    runner.step(t, 0.1, { in_throttle: 1.0 });
    t += 0.1;
  }

  const finalSpeed = runner.getVar("out_speed");
  assert.ok(finalSpeed > 0.0, "Speed must increase after positive throttle steps");

  client.terminate();
});
