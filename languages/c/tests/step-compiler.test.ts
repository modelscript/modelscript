// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { compileCStep } from "../src/codegen/step-compiler.js";
import { verifyCRoutine } from "../src/formal/verifier.js";

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

  test("executes { ... } compound blocks exactly once instead of looping", () => {
    const src = `
double acc = 0.0;
{
  double step = 5.0;
  acc += step;
}
$Out = acc;
`;
    const compiled = compileCStep(src);
    assert.ok(
      compiled.ast.some((s) => s.kind === "block"),
      "Should parse { ... } as block statement",
    );
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

    assert.equal(outMap.get("Out"), 5.0);
  });

  test("handles break, continue, return, and intra-AST user function calls", () => {
    const src = `
double clamp(double val, double lo, double hi) {
  if (val < lo) return lo;
  if (val > hi) return hi;
  return val;
}

double sum = 0.0;
for (int i = 0; i < 10; i++) {
  if (i == 2) continue;
  if (i == 6) break;
  sum += clamp(i * 10.0, 10.0, 40.0);
}
$Out = sum;
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

    // i=0 -> clamp(0, 10, 40) = 10
    // i=1 -> clamp(10, 10, 40) = 10
    // i=2 -> continue (skipped)
    // i=3 -> clamp(30, 10, 40) = 30
    // i=4 -> clamp(40, 10, 40) = 40
    // i=5 -> clamp(50, 10, 40) = 40
    // i=6 -> break
    // Total = 10 + 10 + 30 + 40 + 40 = 130
    assert.equal(outMap.get("Out"), 130.0);
  });

  test("compiles and executes switch/case/default, ternary ?:, and (type)expr casts", () => {
    const src = `
int mode = (int)$Mode;
double u = $Input;
double gain = 1.0;

switch (mode) {
  case 0:
    gain = 0.5;
    break;
  case 1:
  case 2:
    gain = 2.0;
    break;
  default:
    gain = 4.0;
    break;
}

double scaled = (u > 0.0) ? (u * gain) : (-u * gain);
int truncated = (int)(scaled + 0.75);
$OutScaled = scaled;
$OutTrunc = truncated;
`;
    const compiled = compileCStep(src);
    assert.ok(
      compiled.ast.some((s) => s.kind === "switch"),
      "Should parse switch statement",
    );

    const runWith = (modeVal: number, uVal: number) => {
      const outMap = new Map<string, number>();
      compiled.step({
        dt: 0.001,
        time: 0.0,
        firstStep: true,
        inputs: (p) => (p === "Mode" ? modeVal : uVal),
        setOutput: (p, v) => outMap.set(p, v),
        statesReal: new Float64Array(1),
        statesInt: new Int32Array(1),
      });
      return outMap;
    };

    // mode = 0.9 -> (int)0.9 = 0 -> gain = 0.5 -> u = -6.0 -> scaled = 3.0 -> (int)(3.75) = 3
    const res0 = runWith(0.9, -6.0);
    assert.equal(res0.get("OutScaled"), 3.0);
    assert.equal(res0.get("OutTrunc"), 3);

    // mode = 2 -> matches grouped case 1/2 -> gain = 2.0 -> u = 3.5 -> scaled = 7.0 -> (int)(7.75) = 7
    const res2 = runWith(2.0, 3.5);
    assert.equal(res2.get("OutScaled"), 7.0);
    assert.equal(res2.get("OutTrunc"), 7);

    // mode = 99 -> default -> gain = 4.0 -> u = 1.25 -> scaled = 5.0
    const resDef = runWith(99.0, 1.25);
    assert.equal(resDef.get("OutScaled"), 5.0);
  });

  test("verifyCRoutine: detects division-by-zero, math domain violations, out-of-bounds array indexing, and null/uninit pointer dereferences", () => {
    const unsafeCode = [
      "double denom = $InDenom - 5.0;", // line 1: [0, 10] - 5 = [-5, 5] (contains 0!)
      "double ratio = 100.0 / denom;", // line 2: C_VERIFY_DIV_BY_ZERO
      "double badRoot = sqrt(-4.0);", // line 3: C_VERIFY_MATH_DOMAIN
      "double badLog = log(0.0);", // line 4: C_VERIFY_MATH_DOMAIN
      "double buf[4] = {1.0, 2.0, 3.0, 4.0};", // line 5
      "double oob = buf[4];", // line 6: C_VERIFY_ARRAY_OUT_OF_BOUNDS (valid: 0..3)
      "double *uninitPtr;", // line 7
      "double v1 = *uninitPtr;", // line 8: C_VERIFY_UNINIT_PTR_DEREF
      "double *nullPtr = NULL;", // line 9
      "*nullPtr = 42.0;", // line 10: C_VERIFY_NULL_DEREF
    ].join("\n");

    const unsafeRes = verifyCRoutine(unsafeCode, {
      inputIntervals: { InDenom: { min: 0, max: 10 } },
    });

    assert.equal(unsafeRes.verified, false);
    const codes = unsafeRes.diagnostics.map((d) => d.code);
    assert.ok(codes.includes("C_VERIFY_DIV_BY_ZERO"), "Should detect division by zero");
    assert.ok(codes.includes("C_VERIFY_MATH_DOMAIN"), "Should detect math domain violation");
    assert.ok(codes.includes("C_VERIFY_ARRAY_OUT_OF_BOUNDS"), "Should detect array out-of-bounds");
    assert.ok(codes.includes("C_VERIFY_UNINIT_PTR_DEREF"), "Should detect uninitialized pointer deref");
    assert.ok(codes.includes("C_VERIFY_NULL_DEREF"), "Should detect null pointer deref");

    const divDiag = unsafeRes.diagnostics.find((d) => d.code === "C_VERIFY_DIV_BY_ZERO")!;
    assert.equal(divDiag.line, 2);
    assert.ok(divDiag.col > 0);

    const oobDiag = unsafeRes.diagnostics.find((d) => d.code === "C_VERIFY_ARRAY_OUT_OF_BOUNDS")!;
    assert.equal(oobDiag.line, 6);

    // Verify that path-sensitive branch refinement proves guarded code SAFE (0 diagnostics)
    const safeGuardedCode = `
double x = $InX;
double buf[4] = {1.0, 2.0, 3.0, 4.0};
double *ptr = &x;
if (x > 1.0 && ptr != NULL) {
  double safeDiv = 10.0 / x;
  double safeRoot = sqrt(x);
  double safeLog = log(x);
  *ptr = safeDiv + safeRoot + safeLog;
}
for (int i = 0; i < 4; i++) {
  buf[i] = buf[i] * 2.0;
}
`;
    const safeRes = verifyCRoutine(safeGuardedCode, {
      inputIntervals: { InX: { min: -5, max: 20 } },
    });
    assert.equal(
      safeRes.verified,
      true,
      `Expected guarded routine to verify cleanly, got: ${JSON.stringify(safeRes.diagnostics)}`,
    );
  });
});
