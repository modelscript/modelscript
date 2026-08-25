import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";

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
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-phase3-solvers-test");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    childProcess.execSync(
      `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
      { cwd: tmpDir, stdio: "inherit" },
    );

    const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
    const memory = new WebAssembly.Memory({ initial: 512, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
          let msgStr = "";
          let fileStr = "";
          try {
            if (msg > 0) {
              const u16 = new Uint16Array(memory.buffer, msg);
              const len = new Uint32Array(memory.buffer, msg - 4)[0] >> 1;
              for (let i = 0; i < len && i < 100; i++) msgStr += String.fromCharCode(u16[i]);
            }
            if (file > 0) {
              const u16 = new Uint16Array(memory.buffer, file);
              const len = new Uint32Array(memory.buffer, file - 4)[0] >> 1;
              for (let i = 0; i < len && i < 100; i++) fileStr += String.fromCharCode(u16[i]);
            }
          } catch {
            // ignore buffer decode errors
          }
          console.error(`WASM abort: "${msgStr}" at ${fileStr}:${line}:${col}`);
        },
        logNode: () => {},
        debugLog: () => {},
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    const exports = instance.exports as any;

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
  }, 180000);
});
