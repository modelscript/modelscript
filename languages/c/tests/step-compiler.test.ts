// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { compileCStep } from "../src/codegen/step-compiler.js";

describe("@modelscript/c Simulation Step Compiler Suite", () => {
  test("compiles and steps direct algebraic calculations", () => {
    const src = `
double inA = $InA;
double inB = $InB;
$OutC = inA * 2.5 + inB;
`;
    const compiled = compileCStep(src);
    const inMap = new Map<string, number>([
      ["InA", 4.0],
      ["InB", 3.0],
    ]);
    const outMap = new Map<string, number>();
    const statesReal = new Float64Array(1);
    const statesInt = new Int32Array(1);

    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      statesReal,
      statesInt,
    });

    // 4.0 * 2.5 + 3.0 = 13.0
    assert.equal(outMap.get("OutC"), 13.0);
  });

  test("integrates 1st order low-pass filter over multiple simulation steps", () => {
    // Continuous filter: dy/dt = (u - y) / tau
    // Discrete Euler: y[k] = y[k-1] + dt * (u - y[k-1]) / tau
    const src = `
#pragma state real:1 int:0
double tau = 0.01;
double u = $In;
if (FIRST_STEP) {
  statesReal[0] = 0.0;
}
double y = statesReal[0] + DT * (u - statesReal[0]) / tau;
statesReal[0] = y;
$Out = y;
`;
    const compiled = compileCStep(src);
    assert.equal(compiled.numRealStates, 1);

    const statesReal = new Float64Array(compiled.numRealStates);
    const statesInt = new Int32Array(compiled.numIntStates);
    const inMap = new Map<string, number>([["In", 10.0]]);
    const outMap = new Map<string, number>();

    const dt = 0.001;
    let time = 0.0;

    // Step 1: y ≈ 0 + 0.001 * (10 - 0) / 0.01 = 1.0
    compiled.step({
      dt,
      time,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      statesReal,
      statesInt,
    });
    assert.ok(Math.abs((outMap.get("Out") ?? 0) - 1.0) < 1e-4);

    // Step 50 times (50 ms, 5 time constants, expect ~9.93)
    for (let i = 1; i < 50; i++) {
      time += dt;
      compiled.step({
        dt,
        time,
        firstStep: false,
        inputs: (port: string) => inMap.get(port) ?? 0,
        setOutput: (port: string, val: number) => outMap.set(port, val),
        statesReal,
        statesInt,
      });
    }

    const finalVal = outMap.get("Out") ?? 0;
    assert.ok(finalVal > 9.9 && finalVal < 10.0, `Expected ~9.93, got ${finalVal}`);
  });

  test("evaluates standard math intrinsics (sin, cos, sqrt, fmin, fmax)", () => {
    const src = `
double angle = 0.5;
$SinVal = sin(angle);
$CosVal = cos(angle);
$SqrtVal = sqrt(16.0);
$MaxVal = fmax(12.5, 3.2);
`;
    const compiled = compileCStep(src);
    const outMap = new Map<string, number>();
    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: () => 0,
      setOutput: (port, val) => outMap.set(port, val),
      statesReal: new Float64Array(1),
      statesInt: new Int32Array(1),
    });

    assert.ok(Math.abs((outMap.get("SinVal") ?? 0) - Math.sin(0.5)) < 1e-6);
    assert.ok(Math.abs((outMap.get("CosVal") ?? 0) - Math.cos(0.5)) < 1e-6);
    assert.equal(outMap.get("SqrtVal"), 4.0);
    assert.equal(outMap.get("MaxVal"), 12.5);
  });
});
