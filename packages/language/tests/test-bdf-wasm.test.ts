import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bdfTestDsl = language({
  name: "BdfTestLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
});

describe("Stiff DAE BDF Integrator (Orders 1, 2, 3)", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(bdfTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_bdf");
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

  it("should compile WASM module with stepBDF function export", () => {
    expect(wasmExports.stepBDF).toBeDefined();
  });

  it("should perform BDF-1 step for a decay state variable in linear memory", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const numVars = 2;
    for (let v = 0; v < numVars; v++) {
      wasmExports.dae_addVariable(daePtr, v + 1, 0, 0, 0, 1.0);
    }

    const varValuesPtr = wasmExports.atomicChunkAlloc(numVars * 8);
    const historyBufPtr = wasmExports.atomicChunkAlloc(numVars * 8 * 3);
    const scratchPtr = wasmExports.atomicChunkAlloc(1024);

    new Float64Array(wasmExports.memory.buffer, varValuesPtr, numVars).fill(1.0);
    new Float64Array(wasmExports.memory.buffer, historyBufPtr, numVars * 3).fill(1.0);

    // Perform BDF-1 step with dt = 0.05
    const success = wasmExports.stepBDF(daePtr, varValuesPtr, historyBufPtr, scratchPtr, 0.05, 1);
    expect(Boolean(success)).toBe(true);
  });

  it("should perform BDF-2 step for stiff differential equations", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const numVars = 2;
    for (let v = 0; v < numVars; v++) {
      wasmExports.dae_addVariable(daePtr, v + 1, 0, 0, 0, 1.0);
    }

    const varValuesPtr = wasmExports.atomicChunkAlloc(numVars * 8);
    const historyBufPtr = wasmExports.atomicChunkAlloc(numVars * 8 * 3);
    const scratchPtr = wasmExports.atomicChunkAlloc(1024);

    const histMem = new Float64Array(wasmExports.memory.buffer, historyBufPtr, numVars * 3);
    // History 1: y_{n-1} = 1.0
    histMem[0] = 1.0;
    histMem[1] = 1.0;
    // History 2: y_{n-2} = 1.05
    histMem[2] = 1.05;
    histMem[3] = 1.05;

    // Perform BDF-2 step with dt = 0.01
    const success = wasmExports.stepBDF(daePtr, varValuesPtr, historyBufPtr, scratchPtr, 0.01, 2);
    expect(Boolean(success)).toBe(true);
  });
});
