// SPDX-License-Identifier: AGPL-3.0-or-later
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { language, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeArrayOptDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("High-Impact WASM Array Optimizations", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_array_opt");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const wasmOut = path.join(tmpDir, "parser.wasm");

    try {
      childProcess.execSync(
        `${ascPath} ${parserTs} -o ${wasmOut} --exportRuntime --enable threads --optimize --runtime stub`,
        { stdio: "pipe" },
      );
    } catch (e: any) {
      console.error("ASC ERROR:", e.stderr?.toString());
      throw e;
    }

    const wasmBytes = fs.readFileSync(wasmOut);
    const mod = await WebAssembly.compile(wasmBytes);
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 512, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
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
    const wasmInstance = await WebAssembly.instantiate(mod, imports);
    wasmExports = wasmInstance.exports;
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should create and evaluate zero-copy strided array slice views", () => {
    const b = wasmExports.dae_createBuilder();
    // Allocate 10 contiguous variables with values 10, 20, ..., 100
    const varValuesPtr = wasmExports.__pin(wasmExports.__new(10 * 8, 0));
    for (let i = 0; i < 10; i++) {
      wasmExports.dae_addVariable(b, i + 1, 0, 0, 0, (i + 1) * 10, 0);
      wasmExports.dae_setMemF64(varValuesPtr + i * 8, (i + 1) * 10);
    }

    // Create strided slice view: baseVarId = 0, offset = 1, stride = 2, length = 4 (indices 1, 3, 5, 7 => values 20, 40, 60, 80)
    const sliceView = wasmExports.dae_createSliceView(0, 1, 2, 4);
    expect(sliceView).toBeGreaterThan(0);

    expect(wasmExports.dae_getSliceVarId(sliceView, 0)).toBe(1);
    expect(wasmExports.dae_getSliceVarId(sliceView, 1)).toBe(3);
    expect(wasmExports.dae_getSliceVarId(sliceView, 2)).toBe(5);
    expect(wasmExports.dae_getSliceVarId(sliceView, 3)).toBe(7);

    expect(wasmExports.dae_getSliceValue(sliceView, 0, varValuesPtr)).toBe(20.0);
    expect(wasmExports.dae_getSliceValue(sliceView, 1, varValuesPtr)).toBe(40.0);
    expect(wasmExports.dae_getSliceValue(sliceView, 2, varValuesPtr)).toBe(60.0);
    expect(wasmExports.dae_getSliceValue(sliceView, 3, varValuesPtr)).toBe(80.0);

    // Modify through slice view
    wasmExports.dae_setSliceValue(sliceView, 1, varValuesPtr, 444.0);
    expect(wasmExports.dae_getSliceValue(sliceView, 1, varValuesPtr)).toBe(444.0);
    expect(wasmExports.dae_getMemF64(varValuesPtr + 3 * 8)).toBe(444.0);
  });

  it("should evaluate uniform array equation stencil across range", () => {
    // 5-point 1D spatial grid
    // x = [0, 1, 4, 9, 16]
    // 2nd derivative stencil: (x[i-1] - 2*x[i] + x[i+1])
    // for i = 1: 0 - 2(1) + 4 = 2
    // for i = 2: 1 - 2(4) + 9 = 2
    // for i = 3: 4 - 2(9) + 16 = 2
    const varValuesPtr = wasmExports.__pin(wasmExports.__new(5 * 8, 0));
    const derValuesPtr = wasmExports.__pin(wasmExports.__new(5 * 8, 0));

    const xVals = [0.0, 1.0, 4.0, 9.0, 16.0];
    for (let i = 0; i < 5; i++) {
      wasmExports.dae_setMemF64(varValuesPtr + i * 8, xVals[i]);
      wasmExports.dae_setMemF64(derValuesPtr + i * 8, 0.0);
    }

    const block = wasmExports.dae_createUniformArrayBlock(0, 0, 1, 3, -2.0, 1.0, 1.0);
    expect(block).toBeGreaterThan(0);

    wasmExports.dae_evalUniformArrayBlock(block, varValuesPtr, derValuesPtr);

    expect(wasmExports.dae_getMemF64(derValuesPtr + 1 * 8)).toBeCloseTo(2.0, 6);
    expect(wasmExports.dae_getMemF64(derValuesPtr + 2 * 8)).toBeCloseTo(2.0, 6);
    expect(wasmExports.dae_getMemF64(derValuesPtr + 3 * 8)).toBeCloseTo(2.0, 6);
  });

  it("should evaluate batched equation residuals across multiple instances", () => {
    const b = wasmExports.dae_createBuilder();
    // Equation: x + y - 10 = 0
    const x = wasmExports.dae_addVariable(b, 0x10, 0, 0, 0, 0.0, 0);
    const y = wasmExports.dae_addVariable(b, 0x20, 0, 0, 0, 0.0, 0);

    const xExpr = wasmExports.dae_addExpression(b, 0, x);
    const yExpr = wasmExports.dae_addExpression(b, 0, y);
    const sumExpr = wasmExports.dae_addBinaryExpr(b, 0, xExpr, yExpr); // x + y
    const tenExpr = wasmExports.dae_addRealLiteral(b, 10.0);
    wasmExports.dae_addEquation(b, 0, sumExpr, tenExpr);

    // 3 instances:
    // inst 0: x=4, y=6 => res = 4+6-10 = 0
    // inst 1: x=2, y=3 => res = 2+3-10 = -5
    // inst 2: x=7, y=8 => res = 7+8-10 = 5
    const batchVarsPtr = wasmExports.__pin(wasmExports.__new(3 * 2 * 8, 0));
    const outResPtr = wasmExports.__pin(wasmExports.__new(3 * 1 * 8, 0));

    // inst 0
    wasmExports.dae_setMemF64(batchVarsPtr + 0 * 8, 4.0);
    wasmExports.dae_setMemF64(batchVarsPtr + 1 * 8, 6.0);
    // inst 1
    wasmExports.dae_setMemF64(batchVarsPtr + 2 * 8, 2.0);
    wasmExports.dae_setMemF64(batchVarsPtr + 3 * 8, 3.0);
    // inst 2
    wasmExports.dae_setMemF64(batchVarsPtr + 4 * 8, 7.0);
    wasmExports.dae_setMemF64(batchVarsPtr + 5 * 8, 8.0);

    wasmExports.dae_evalBatchResiduals(b, 3, 2, batchVarsPtr, outResPtr);

    expect(wasmExports.dae_getMemF64(outResPtr + 0 * 8)).toBeCloseTo(0.0, 6);
    expect(wasmExports.dae_getMemF64(outResPtr + 1 * 8)).toBeCloseTo(5.0, 6);
    expect(wasmExports.dae_getMemF64(outResPtr + 2 * 8)).toBeCloseTo(-5.0, 6);
  });
});
