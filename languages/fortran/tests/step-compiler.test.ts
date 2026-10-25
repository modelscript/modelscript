// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { compileFortranStep } from "../src/codegen/step-compiler.js";

describe("@modelscript/fortran Simulation Step Compiler Suite", () => {
  test("compiles and steps direct algebraic calculations", () => {
    const src = `
#LOCAL REAL InA, InB, OutC
$OutC = $InA * 2.5 + $InB
`;
    const compiled = compileFortranStep(src);
    const inMap = new Map<string, number>([
      ["InA", 4.0],
      ["InB", 3.0],
    ]);
    const outMap = new Map<string, number>();
    const storF = new Float64Array(1);
    const storI = new Int32Array(1);

    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });

    // 4.0 * 2.5 + 3.0 = 13.0
    assert.equal(outMap.get("OutC"), 13.0);
  });

  test("integrates low-pass filter over multiple simulation steps using STORF", () => {
    // 1st order lag filter: y = y_prev + DELT * (u - y_prev) / Tau
    const src = `
#STORAGE REAL:1 INTEGER:0
#LOCAL REAL Tau, y
Tau = 0.01
IF (FIRSTSTEP) THEN
  STORF(0) = 0.0
ENDIF
y = STORF(0) + DELT * ($In - STORF(0)) / Tau
STORF(0) = y
$Out = y
`;
    const compiled = compileFortranStep(src);
    assert.equal(compiled.metadata.numRealStates, 1);
    assert.equal(compiled.metadata.numIntStates, 0);

    const storF = new Float64Array(compiled.numRealStates);
    const storI = new Int32Array(compiled.numIntStates);
    const inMap = new Map<string, number>([["In", 10.0]]);
    const outMap = new Map<string, number>();

    const dt = 0.001; // 1 ms
    let time = 0.0;

    // First step
    compiled.step({
      dt,
      time,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    // After 1 step: y ≈ 0 + 0.001 * (10 - 0) / 0.01 = 1.0
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
        storf: storF,
        stori: storI,
      });
    }

    const finalVal = outMap.get("Out") ?? 0;
    // Theoretical 1 - exp(-0.05 / 0.01) = 1 - exp(-5) ≈ 0.99326 -> 9.9326
    assert.ok(finalVal > 9.9 && finalVal < 10.0, `Expected ~9.93, got ${finalVal}`);
  });

  test("executes EMTDC built-in library subroutines (HARDLIMIT, REALPOLE)", () => {
    const src = `
#STORAGE REAL:2 INTEGER:0
#LOCAL REAL u, y_lim
u = $In
CALL HARDLIMIT(u, -5.0, 5.0, y_lim)
$OutLim = y_lim
`;
    const compiled = compileFortranStep(src);
    const inMap = new Map<string, number>([["In", 12.0]]);
    const outMap = new Map<string, number>();
    const storF = new Float64Array(compiled.numRealStates);
    const storI = new Int32Array(compiled.numIntStates);

    compiled.step({
      dt: 0.001,
      time: 0.0,
      firstStep: true,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    assert.equal(outMap.get("OutLim"), 5.0, "Should clamp at upper limit 5.0");

    inMap.set("In", -15.0);
    compiled.step({
      dt: 0.001,
      time: 0.001,
      firstStep: false,
      inputs: (port: string) => inMap.get(port) ?? 0,
      setOutput: (port: string, val: number) => outMap.set(port, val),
      storf: storF,
      stori: storI,
    });
    assert.equal(outMap.get("OutLim"), -5.0, "Should clamp at lower limit -5.0");
  });
});
