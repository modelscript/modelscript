// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("WebAssembly Arena-Native DAE Interval & Singularity Evaluator", () => {
  async function loadWasm() {
    const wasmPath = path.resolve(import.meta.dirname, "../build/release.wasm");
    const bytes = await fs.readFile(wasmPath);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
      env: {
        abort: () => {},
      },
    });
    return instance.exports as Record<string, any>;
  }

  it("should evaluate arithmetic expressions and detect division-by-zero singularities", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.dae_createBuilder === "function");
    assert.ok(typeof wasm.dae_evalExprInterval === "function");

    const memory = wasm.memory as WebAssembly.Memory;

    // Create DAE builder in WASM
    const daePtr = wasm.dae_createBuilder();

    // Add variables: x (id 0), y (id 1)
    const xVar = wasm.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0, 0);
    const yVar = wasm.dae_addVariable(daePtr, 2, 0, 0, 0, 0.0, 0);

    const xExpr = wasm.dae_addName(daePtr, xVar);
    const yExpr = wasm.dae_addName(daePtr, yVar);

    // Div expr: x / y (BinOp.Div = 3)
    const divExpr = wasm.dae_addBinaryExpr(daePtr, 3, xExpr, yExpr);

    // Set variable bounds: x in [10, 20]
    const varCount = 2;
    const loPtr = wasm.__new(varCount * 8, 0);
    const hiPtr = wasm.__new(varCount * 8, 0);
    const outLoPtr = wasm.__new(8, 0);
    const outHiPtr = wasm.__new(8, 0);

    const loView = new Float64Array(memory.buffer, loPtr, varCount);
    const hiView = new Float64Array(memory.buffer, hiPtr, varCount);
    const outLoView = new Float64Array(memory.buffer, outLoPtr, 1);
    const outHiView = new Float64Array(memory.buffer, outHiPtr, 1);

    loView[0] = 10.0;
    hiView[0] = 20.0;

    // Case A: y in [2, 5] -> safe division, result in [2, 10], no singularity
    loView[1] = 2.0;
    hiView[1] = 5.0;

    let mask = wasm.dae_evalExprInterval(daePtr, divExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    assert.strictEqual(mask, 0, "Safe division should not flag singularities");
    assert.ok(Math.abs(outLoView[0]! - 2.0) < 1e-6);
    assert.ok(Math.abs(outHiView[0]! - 10.0) < 1e-6);

    // Case B: y in [-2, 4] -> contains 0: possible div-by-zero
    loView[1] = -2.0;
    hiView[1] = 4.0;
    mask = wasm.dae_evalExprInterval(daePtr, divExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    const SINGULARITY_DIV_ZERO_POSSIBLE = 1 << 1;
    assert.ok((mask & SINGULARITY_DIV_ZERO_POSSIBLE) !== 0, "Possible div-by-zero must be flagged");

    // Case C: y in [0, 0] -> definite div-by-zero
    loView[1] = 0.0;
    hiView[1] = 0.0;
    mask = wasm.dae_evalExprInterval(daePtr, divExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    const SINGULARITY_DIV_ZERO_DEFINITE = 1 << 0;
    assert.ok((mask & SINGULARITY_DIV_ZERO_DEFINITE) !== 0, "Definite div-by-zero must be flagged");
  });

  it("should evaluate math function calls and catch domain violations (sqrt, log, tan)", async () => {
    const wasm = await loadWasm();
    const memory = wasm.memory as WebAssembly.Memory;

    const daePtr = wasm.dae_createBuilder();
    const xVar = wasm.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0, 0);
    const xExpr = wasm.dae_addName(daePtr, xVar);

    // sqrt(x): funcId = 2
    const sqrtExpr = wasm.dae_addCall(daePtr, 2, xExpr, 1);
    // log(x): funcId = 6
    const logExpr = wasm.dae_addCall(daePtr, 6, xExpr, 1);
    // tan(x): funcId = 11
    const tanExpr = wasm.dae_addCall(daePtr, 11, xExpr, 1);

    const loPtr = wasm.__new(8, 0);
    const hiPtr = wasm.__new(8, 0);
    const outLoPtr = wasm.__new(8, 0);
    const outHiPtr = wasm.__new(8, 0);

    const loView = new Float64Array(memory.buffer, loPtr, 1);
    const hiView = new Float64Array(memory.buffer, hiPtr, 1);
    const outLoView = new Float64Array(memory.buffer, outLoPtr, 1);
    const outHiView = new Float64Array(memory.buffer, outHiPtr, 1);

    // 1. Safe sqrt: x in [4, 9] -> result [2, 3]
    loView[0] = 4.0;
    hiView[0] = 9.0;
    let mask = wasm.dae_evalExprInterval(daePtr, sqrtExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    assert.strictEqual(mask, 0);
    assert.ok(Math.abs(outLoView[0]! - 2.0) < 1e-6);
    assert.ok(Math.abs(outHiView[0]! - 3.0) < 1e-6);

    // 2. Negative sqrt: x in [-10, -1] -> definite violation
    loView[0] = -10.0;
    hiView[0] = -1.0;
    mask = wasm.dae_evalExprInterval(daePtr, sqrtExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    const SINGULARITY_SQRT_NEGATIVE_DEFINITE = 1 << 2;
    assert.ok((mask & SINGULARITY_SQRT_NEGATIVE_DEFINITE) !== 0, "Definite negative sqrt must be flagged");

    // 3. Log with non-positive argument: x in [-5, 2] -> possible violation
    loView[0] = -5.0;
    hiView[0] = 2.0;
    mask = wasm.dae_evalExprInterval(daePtr, logExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    const SINGULARITY_LOG_NONPOS_POSSIBLE = 1 << 5;
    assert.ok((mask & SINGULARITY_LOG_NONPOS_POSSIBLE) !== 0, "Possible log nonpositive must be flagged");

    // 4. Tan singularity: x in [0.5, 2.0] covers pi/2 (~1.57079) -> tan singularity
    loView[0] = 0.5;
    hiView[0] = 2.0;
    mask = wasm.dae_evalExprInterval(daePtr, tanExpr, loPtr, hiPtr, outLoPtr, outHiPtr, 0, 0);
    const SINGULARITY_TAN_SINGULARITY = 1 << 6;
    assert.ok((mask & SINGULARITY_TAN_SINGULARITY) !== 0, "Tan asymptote crossing must be flagged");
  });

  it("should evaluate equation residuals and validate min/max bound attributes", async () => {
    const wasm = await loadWasm();
    const memory = wasm.memory as WebAssembly.Memory;

    const daePtr = wasm.dae_createBuilder();
    const xVar = wasm.dae_addVariable(daePtr, 1, 0, 0, 0, 0.0, 0);
    const xExpr = wasm.dae_addName(daePtr, xVar);

    // Equation: x = 100.0 (EqKind.Simple = 0)
    const const100 = wasm.dae_addRealLiteral(daePtr, 100.0);
    const eqIdx = wasm.dae_addEquation(daePtr, 0, xExpr, const100, 0);

    const loPtr = wasm.__new(8, 0);
    const hiPtr = wasm.__new(8, 0);
    const outResLoPtr = wasm.__new(8, 0);
    const outResHiPtr = wasm.__new(8, 0);

    const loView = new Float64Array(memory.buffer, loPtr, 1);
    const hiView = new Float64Array(memory.buffer, hiPtr, 1);
    const resLoView = new Float64Array(memory.buffer, outResLoPtr, 1);
    const resHiView = new Float64Array(memory.buffer, outResHiPtr, 1);

    // x in [95, 105] -> residual = RHS - LHS = [100 - 105, 100 - 95] = [-5, 5]
    loView[0] = 95.0;
    hiView[0] = 105.0;
    const mask = wasm.dae_evalEquationInterval(daePtr, eqIdx, loPtr, hiPtr, outResLoPtr, outResHiPtr, 0, 0);
    assert.strictEqual(mask, 0);
    assert.ok(Math.abs(resLoView[0]! - -5.0) < 1e-6);
    assert.ok(Math.abs(resHiView[0]! - 5.0) < 1e-6);

    // Check variable bound attribute violations
    // min = 0.0, max = 50.0. Variable x is [95, 105] -> exceeds max bound 50.0
    const attrMask = wasm.dae_checkVarBounds(xVar, 95.0, 105.0, 0.0, 50.0);
    const SINGULARITY_MAX_BOUND_VIOLATION = 1 << 9;
    assert.ok((attrMask & SINGULARITY_MAX_BOUND_VIOLATION) !== 0, "Max bound violation must be detected");
  });
});
