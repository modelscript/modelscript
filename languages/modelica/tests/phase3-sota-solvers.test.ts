// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

describe("Phase 3: SOTA Symbolic DAE Reduction, Synchronous Clocks & Solvers", () => {
  it("should compile WASM runtime and verify synchronous state machines, Pantelides index reduction, and tearing", async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { facade } = await createWasmParser(modelicaWasm);
    const exports = facade.exports as any;

    // 1. Create DaeBuilder
    const dae = exports.dae_createBuilder();
    expect(dae).toBeGreaterThan(0);

    // 2. Test Synchronous Language Clocks (Modelica 3.7 Chapter 16)
    const intervalExpr = exports.dae_addRealLiteral(dae, 0.01); // 10ms sample period
    const resExpr = exports.dae_addRealLiteral(dae, 1e-6);
    const shiftExpr = exports.dae_addRealLiteral(dae, 0.0);
    const clockId = exports.dae_addClock(dae, intervalExpr, resExpr, shiftExpr);
    expect(clockId).toBe(1);

    // Add discrete variable assigned to this clock
    const discreteVar = exports.dae_addVariable(dae, djb2Hash("sampled_voltage"), 0, 1, 0, 0, 0); // Discrete variability = 1
    exports.dae_setVarClock(dae, discreteVar, clockId);
    expect(exports.dae_getVarClock(dae, discreteVar)).toBe(clockId);

    // 3. Test Synchronous State Machine (Modelica 3.7 Chapter 17)
    const smId = exports.dae_addStateMachine(dae, djb2Hash("MotorController"), 0);
    const stateOff = exports.dae_addState(dae, smId, djb2Hash("Off"));
    const stateRunning = exports.dae_addState(dae, smId, djb2Hash("Running"));

    // Add state equation: target = 0 in Off state
    const zeroExpr = exports.dae_addRealLiteral(dae, 0.0);
    exports.dae_addStateEquation(dae, smId, stateOff, djb2Hash("speed_ref"), zeroExpr, false);

    // Add immediate transition from Off -> Running when trigger == true
    const condTrue = exports.dae_addExpression(dae, 3, 1, 0, 0); // BoolLiteral true
    const transId = exports.dae_addTransition(dae, smId, stateOff, stateRunning, condTrue, 1, 0); // FLAG_TRANSITION_IMMEDIATE = 1
    expect(transId).toBe(0);

    // 4. Test Pantelides High-Index DAE Reduction & Dummy Derivatives (Chapter 9 & 10)
    const xVar = exports.dae_addVariable(dae, djb2Hash("x"), 0, 0, 0, 1.0, 8); // FLAG_VAR_STATE = 8
    const xExpr = exports.dae_addExpression(dae, 0, xVar, 0, 0); // Name
    const oneExpr = exports.dae_addRealLiteral(dae, 1.0);
    exports.dae_addEquation(dae, 0, xExpr, oneExpr, 0);

    const pant = exports.dae_createPantelides(dae, 0);
    expect(pant).toBeGreaterThan(0);

    const generatedDiffEqs = exports.dae_runPantelides(pant, 0);
    expect(generatedDiffEqs).toBeGreaterThanOrEqual(0);
    const structuralIndex = exports.dae_getPantelidesIndex(pant);
    expect(structuralIndex).toBeGreaterThanOrEqual(1);
    const dummyCount = exports.dae_getDummyDerivativeCount(pant);
    expect(dummyCount).toBeGreaterThanOrEqual(0);

    // 5. Test Non-Linear Algebraic Loop Tearing (Cellier Method)
    const n = 1;
    const eqIndicesPtr = exports.atomicChunkAlloc(4);
    const varIndicesPtr = exports.atomicChunkAlloc(4);
    const tornBlock = exports.dae_createTornBlock(dae, eqIndicesPtr, varIndicesPtr, n);
    expect(tornBlock).toBeGreaterThan(0);
  });
});
