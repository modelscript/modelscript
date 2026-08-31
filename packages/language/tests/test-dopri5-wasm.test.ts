import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dopri5TestDsl = language({
  name: "Dopri5TestLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
});

describe("WASM Hermite Interpolation & DOPRI5 Adaptive Step Integrator", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(dopri5TestDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_dopri5");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --debug --runtime stub`;
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

  it("should perform cubic Hermite interpolation between state step bounds", () => {
    // y(t=0) = 0.0, y(t=1) = 1.0, k1 = 1.0, k7 = 1.0
    // Midpoint theta = 0.5 -> y(0.5) should be 0.5
    const numVars = 1;
    const y0Ptr = wasmExports.atomicChunkAlloc(numVars * 8);
    const y1Ptr = wasmExports.atomicChunkAlloc(numVars * 8);
    const k1Ptr = wasmExports.atomicChunkAlloc(numVars * 8);
    const k7Ptr = wasmExports.atomicChunkAlloc(numVars * 8);
    const outPtr = wasmExports.atomicChunkAlloc(numVars * 8);

    const memY0 = new Float64Array(wasmExports.memory.buffer, y0Ptr, numVars);
    const memY1 = new Float64Array(wasmExports.memory.buffer, y1Ptr, numVars);
    const memK1 = new Float64Array(wasmExports.memory.buffer, k1Ptr, numVars);
    const memK7 = new Float64Array(wasmExports.memory.buffer, k7Ptr, numVars);

    memY0[0] = 0.0;
    memY1[0] = 1.0;
    memK1[0] = 1.0;
    memK7[0] = 1.0;

    wasmExports.hermiteInterpolate(y0Ptr, y1Ptr, k1Ptr, k7Ptr, 1.0, 0.5, numVars, outPtr);

    const memOut = new Float64Array(wasmExports.memory.buffer, outPtr, numVars);
    expect(memOut[0]).toBeCloseTo(0.5, 6);
  });

  it("should execute stepDopri5 integration and accept step within tolerances", () => {
    const daePtr = wasmExports.dae_createBuilder();
    expect(daePtr).toBeGreaterThan(0);

    const numVars = 4;
    for (let v = 0; v < numVars; v++) {
      wasmExports.dae_addVariable(daePtr, v + 1, 0, 0, 0, 1.0);
    }

    const varValuesPtr = wasmExports.atomicChunkAlloc(numVars * 8);
    const kStagesPtr = wasmExports.atomicChunkAlloc(numVars * 8 * 7);
    const tempValuesPtr = wasmExports.atomicChunkAlloc(numVars * 8);
    const yNewPtr = wasmExports.atomicChunkAlloc(numVars * 8);

    new Float64Array(wasmExports.memory.buffer, varValuesPtr, numVars).fill(0.0);
    new Float64Array(wasmExports.memory.buffer, kStagesPtr, numVars * 7).fill(0.0);
    new Float64Array(wasmExports.memory.buffer, tempValuesPtr, numVars).fill(0.0);
    new Float64Array(wasmExports.memory.buffer, yNewPtr, numVars).fill(0.0);

    const varMem = new Float64Array(wasmExports.memory.buffer, varValuesPtr, numVars);
    varMem[0] = 1.0;
    varMem[1] = 0.0;

    const success = wasmExports.stepDopri5(daePtr, varValuesPtr, kStagesPtr, tempValuesPtr, yNewPtr, 0.01, 1e-6, 1e-6);

    expect(success).toBeTruthy();
  });
});
