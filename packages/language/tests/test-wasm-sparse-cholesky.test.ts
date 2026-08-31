// SPDX-License-Identifier: AGPL-3.0-or-later
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/dsl/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("In-WASM Sparse Cholesky (LDL^T) Linear Solver", () => {
  it("should analyze, factorize, and solve symmetric positive-definite sparse systems in WASM linear memory", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-sparse-cholesky-test");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    childProcess.execSync(
      `node "${ascBin}" parser.ts --debug --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
      { cwd: tmpDir, stdio: "inherit" },
    );

    const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
          function readString(ptr: number): string {
            if (!ptr) return "";
            try {
              const len = new Uint32Array(memory.buffer, ptr - 4, 1)[0] >> 1;
              const u16 = new Uint16Array(memory.buffer, ptr, len);
              return String.fromCharCode(...u16);
            } catch {
              return `ptr_${ptr}`;
            }
          }
          console.error(`WASM abort: "${readString(msg)}" at ${readString(file)}:${line}:${col}`);
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

    const n = 3;

    // Build 3x3 symmetric positive-definite matrix A:
    // [ 4.0  1.0  0.0 ]
    // [ 1.0  5.0  2.0 ]
    // [ 0.0  2.0  6.0 ]
    //
    // Non-zeros in CCS format (7 entries):
    // Col 0: row 0 (4.0), row 1 (1.0)
    // Col 1: row 0 (1.0), row 1 (5.0), row 2 (2.0)
    // Col 2: row 1 (2.0), row 2 (6.0)

    const ccs = exports.dae_ccsCreate(n, n);
    const valuesPtr = exports.atomicChunkAlloc(7 * 8);
    exports.dae_ccsSetValuesPtr(ccs, valuesPtr);
    exports.dae_ccsSetNNZ(ccs, 7);

    // Col 0 entries
    exports.dae_ccsPushColPtr(ccs, 0);
    exports.dae_ccsPushRowIndex(ccs, 0);
    exports.dae_ccsPushRowIndex(ccs, 1);

    // Col 1 entries
    exports.dae_ccsPushColPtr(ccs, 2);
    exports.dae_ccsPushRowIndex(ccs, 0);
    exports.dae_ccsPushRowIndex(ccs, 1);
    exports.dae_ccsPushRowIndex(ccs, 2);

    // Col 2 entries
    exports.dae_ccsPushColPtr(ccs, 5);
    exports.dae_ccsPushRowIndex(ccs, 1);
    exports.dae_ccsPushRowIndex(ccs, 2);
    exports.dae_ccsPushColPtr(ccs, 7);

    // Populate matrix values
    const aVals = new Float64Array(memory.buffer, valuesPtr, 7);
    aVals[0] = 4.0; // A[0, 0]
    aVals[1] = 1.0; // A[1, 0]
    aVals[2] = 1.0; // A[0, 1]
    aVals[3] = 5.0; // A[1, 1]
    aVals[4] = 2.0; // A[2, 1]
    aVals[5] = 2.0; // A[1, 2]
    aVals[6] = 6.0; // A[2, 2]

    // RHS vector b for target solution x = [1.0, 2.0, 3.0]:
    // b = A * x = [6.0, 17.0, 22.0]
    const bPtr = exports.atomicChunkAlloc(n * 8);
    const xPtr = exports.atomicChunkAlloc(n * 8);

    const bVals = new Float64Array(memory.buffer, bPtr, n);
    bVals[0] = 6.0;
    bVals[1] = 17.0;
    bVals[2] = 22.0;

    // 1. Create solver
    const solver = exports.dae_sparseCholeskyCreate(n);
    expect(solver).toBeGreaterThan(0);

    // 2. Symbolic Analysis
    exports.dae_sparseCholeskyAnalyze(solver, ccs);

    // 3. Numerical Factorization
    const factored = exports.dae_sparseCholeskyFactor(solver, ccs, 0.0);
    expect(factored).toBeTruthy();

    // 4. Solve A * x = b
    exports.dae_sparseCholeskySolve(solver, bPtr, xPtr);

    const xVals = new Float64Array(memory.buffer, xPtr, n);
    expect(xVals[0]).toBeCloseTo(1.0, 6);
    expect(xVals[1]).toBeCloseTo(2.0, 6);
    expect(xVals[2]).toBeCloseTo(3.0, 6);
  }, 180000);
});
