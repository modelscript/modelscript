import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const matrixTestDsl = language({
  name: "MatrixTestLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
});

describe("WASM Linear Algebra & Multi-Variable Newton Solver Engine", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(matrixTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_matrix");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: memory, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 60000);

  it("should factor and solve a 2x2 linear system using WASM LU decomposition", () => {
    // Solve system:
    // 2x + y = 5
    // x + 3y = 10
    // Solution: x = 1, y = 3
    const n = 2;
    const matrixPtr = wasmExports.atomicChunkAlloc(n * n * 8);
    const pivPtr = wasmExports.atomicChunkAlloc(n * 4);
    const scalePtr = wasmExports.atomicChunkAlloc(n * 8);
    const bPtr = wasmExports.atomicChunkAlloc(n * 8);
    const scratchPtr = wasmExports.atomicChunkAlloc(n * 8);

    const matrixMem = new Float64Array(wasmExports.memory.buffer, matrixPtr, n * n);
    // Row 0: [2.0, 1.0]
    matrixMem[0] = 2.0;
    matrixMem[1] = 1.0;
    // Row 1: [1.0, 3.0]
    matrixMem[2] = 1.0;
    matrixMem[3] = 3.0;

    const bMem = new Float64Array(wasmExports.memory.buffer, bPtr, n);
    bMem[0] = 5.0;
    bMem[1] = 10.0;

    // LU Factorization
    const success = wasmExports.luFactor(matrixPtr, pivPtr, scalePtr, n);
    expect(success).toBeTruthy();

    // LU Solve
    wasmExports.luSolve(matrixPtr, pivPtr, scalePtr, bPtr, scratchPtr, n);

    const solMem = new Float64Array(wasmExports.memory.buffer, bPtr, n);
    expect(solMem[0]).toBeCloseTo(1.0, 6);
    expect(solMem[1]).toBeCloseTo(3.0, 6);
  });

  it("should factor and solve a 3x3 linear system accurately", () => {
    // System:
    //  3x + 2y - z = 1
    //  2x - 2y + 4z = -2
    // -x + 0.5y - z = 0
    const n = 3;
    const matrixPtr = wasmExports.atomicChunkAlloc(n * n * 8);
    const pivPtr = wasmExports.atomicChunkAlloc(n * 4);
    const scalePtr = wasmExports.atomicChunkAlloc(n * 8);
    const bPtr = wasmExports.atomicChunkAlloc(n * 8);
    const scratchPtr = wasmExports.atomicChunkAlloc(n * 8);

    const matrixMem = new Float64Array(wasmExports.memory.buffer, matrixPtr, n * n);
    matrixMem[0] = 3.0;
    matrixMem[1] = 2.0;
    matrixMem[2] = -1.0;
    matrixMem[3] = 2.0;
    matrixMem[4] = -2.0;
    matrixMem[5] = 4.0;
    matrixMem[6] = -1.0;
    matrixMem[7] = 0.5;
    matrixMem[8] = -1.0;

    const bMem = new Float64Array(wasmExports.memory.buffer, bPtr, n);
    bMem[0] = 1.0;
    bMem[1] = -2.0;
    bMem[2] = 0.0;

    const success = wasmExports.luFactor(matrixPtr, pivPtr, scalePtr, n);
    expect(success).toBeTruthy();

    wasmExports.luSolve(matrixPtr, pivPtr, scalePtr, bPtr, scratchPtr, n);

    const sol = new Float64Array(wasmExports.memory.buffer, bPtr, n);
    // Verify residual A * x - b ~ 0
    const x = sol[0];
    const y = sol[1];
    const z = sol[2];

    expect(3 * x + 2 * y - z).toBeCloseTo(1.0, 6);
    expect(2 * x - 2 * y + 4 * z).toBeCloseTo(-2.0, 6);
    expect(-x + 0.5 * y - z).toBeCloseTo(0.0, 6);
  });
});
