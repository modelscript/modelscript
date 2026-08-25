import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeAdvancedDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("Advanced WASM DaeBuilder Features", () => {
  let wasmExports: any;
  let tmpDir: string;
  let builderPtr: number;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_advanced");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (err: any) {
      if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
      if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
      throw err;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

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

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 120000);

  beforeEach(() => {
    builderPtr = wasmExports.dae_createBuilder();
  });

  afterAll(() => {
    // if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should initialize and maintain independent variable and clock counts", () => {
    const b = wasmExports.dae_createBuilder();
    expect(wasmExports.dae_getClockCount(b)).toBe(0);
    expect(wasmExports.dae_getVarCount(b)).toBe(0);
    expect(wasmExports.dae_getEqCount(b)).toBe(0);

    wasmExports.dae_addVariable(b, 10, 0, 0, 0, 0.0, 0);
    expect(wasmExports.dae_getClockCount(b)).toBe(0);
    expect(wasmExports.dae_getVarCount(b)).toBe(1);
    expect(wasmExports.dae_getEqCount(b)).toBe(0);

    wasmExports.dae_addEquation(b, 0, 1, 2, 0);
    expect(wasmExports.dae_getClockCount(b)).toBe(0);
    expect(wasmExports.dae_getVarCount(b)).toBe(1);
    expect(wasmExports.dae_getEqCount(b)).toBe(1);

    wasmExports.dae_addClock(b, 100, 0, 0);
    expect(wasmExports.dae_getClockCount(b)).toBe(1);
    expect(wasmExports.dae_getVarCount(b)).toBe(1);
    expect(wasmExports.dae_getEqCount(b)).toBe(1);
  });

  it("should support O(1) secondary name lookup and variable registration", () => {
    const var1NameId = 101;
    const var2NameId = 202;

    const idx1 = wasmExports.dae_addVariable(builderPtr, var1NameId, 0, 0, 0, 10.5, 0);
    const idx2 = wasmExports.dae_addVariable(builderPtr, var2NameId, 1, 2, 1, 42.0, 0);

    expect(idx1).toBe(0);
    expect(idx2).toBe(1);

    // O(1) lookup
    expect(wasmExports.dae_lookupVariable(builderPtr, var1NameId)).toBe(0);
    expect(wasmExports.dae_lookupVariable(builderPtr, var2NameId)).toBe(1);
    expect(wasmExports.dae_lookupVariable(builderPtr, 999)).toBe(-1);
  });

  it("should support alias tracking and union-find resolution", () => {
    const var1NameId = 100;
    const targetNameId = 500;

    const idx = wasmExports.dae_addVariable(builderPtr, var1NameId, 0, 0, 0, 0.0, 0);
    expect(wasmExports.dae_getAlias(builderPtr, idx)).toBe(var1NameId);

    wasmExports.dae_addAlias(builderPtr, idx, targetNameId);
    expect(wasmExports.dae_getAlias(builderPtr, idx)).toBe(targetNameId);
  });

  it("should support variable attributes and multi-dimensional shapes", () => {
    const idx = wasmExports.dae_addVariable(builderPtr, 10, 0, 0, 0, 0.0, 0);

    // VarAttrKind: Min = 0, Max = 1, Nominal = 4
    const minExpr = 55;
    const maxExpr = 99;
    wasmExports.dae_setVarAttrExpr(builderPtr, idx, 0, minExpr);
    wasmExports.dae_setVarAttrExpr(builderPtr, idx, 1, maxExpr);

    expect(wasmExports.dae_getVarAttrExpr(builderPtr, idx, 0)).toBe(minExpr);
    expect(wasmExports.dae_getVarAttrExpr(builderPtr, idx, 1)).toBe(maxExpr);
    expect(wasmExports.dae_getVarAttrExpr(builderPtr, idx, 2) >>> 0).toBe(0xffffffff);

    // Array Shapes: 3x4 matrix
    wasmExports.dae_setVarShapeDim(builderPtr, idx, 0, 3);
    wasmExports.dae_setVarShapeDim(builderPtr, idx, 1, 4);

    expect(wasmExports.dae_getVarShapeDim(builderPtr, idx, 0)).toBe(3);
    expect(wasmExports.dae_getVarShapeDim(builderPtr, idx, 1)).toBe(4);
    expect(wasmExports.dae_getVarShapeDim(builderPtr, idx, 2)).toBe(0);
  });

  it("should support synchronous clocks (§16)", () => {
    const intervalExpr = 10;
    const resolutionExpr = 11;
    const shiftExpr = 12;

    const clockId = wasmExports.dae_addClock(builderPtr, intervalExpr, resolutionExpr, shiftExpr);
    expect(clockId).toBe(1);
    expect(wasmExports.dae_getClockCount(builderPtr)).toBe(1);

    const varIdx = wasmExports.dae_addVariable(builderPtr, 1, 5, 0, 0, 0.0, 0);
    wasmExports.dae_setVarClock(builderPtr, varIdx, clockId);
    expect(wasmExports.dae_getVarClock(builderPtr, varIdx)).toBe(clockId);

    const eqIdx = wasmExports.dae_addEquation(builderPtr, 0, 1, 2, 0);
    wasmExports.dae_setEqClock(builderPtr, eqIdx, clockId);
    expect(wasmExports.dae_getEqClock(builderPtr, eqIdx)).toBe(clockId);
  });

  it("should support compound when, for, and if equation side-tables", () => {
    // When equation
    const condExpr = 10;
    const whenIdx = wasmExports.dae_addWhenEquation(builderPtr, condExpr);
    expect(whenIdx).toBe(0);

    const bEq1 = wasmExports.dae_addWhenBodyEquation(builderPtr, whenIdx, 0, 1, 2);
    expect(bEq1).toBe(0);

    // For equation
    const iteratorNameId = 5;
    const rangeExprId = 6;
    const forIdx = wasmExports.dae_addForEquation(builderPtr, iteratorNameId, rangeExprId);
    expect(forIdx).toBe(0);

    const forBEq = wasmExports.dae_addForBodyEquation(builderPtr, forIdx, 0, 3, 4);
    expect(forBEq).toBe(0);

    // If equation
    const ifCond = 20;
    const ifIdx = wasmExports.dae_addIfEquation(builderPtr, ifCond);
    expect(ifIdx).toBe(0);

    const ifBEq = wasmExports.dae_addIfThenEquation(builderPtr, ifIdx, 0, 5, 6);
    expect(ifBEq).toBe(0);
  });

  it("should support state machines (§17)", () => {
    const smNameId = 1000;
    const initStateId = 1;
    const smId = wasmExports.dae_addStateMachine(builderPtr, smNameId, initStateId);
    expect(smId).toBe(0);

    const s1 = wasmExports.dae_addState(builderPtr, smId, 1);
    const s2 = wasmExports.dae_addState(builderPtr, smId, 2);
    expect(s1).toBe(0);
    expect(s2).toBe(1);

    const eq1 = wasmExports.dae_addStateEquation(builderPtr, smId, s1, 50, 60, false);
    expect(eq1).toBe(0);

    const trans1 = wasmExports.dae_addTransition(builderPtr, smId, s1, s2, 70, 1, 0);
    expect(trans1).toBe(0);
  });

  it("should support event indicators and optimization objectives", () => {
    const e1 = wasmExports.dae_addEventIndicator(builderPtr, 101);
    const e2 = wasmExports.dae_addEventIndicator(builderPtr, 102);

    expect(e1).toBe(0);
    expect(e2).toBe(1);
    expect(wasmExports.dae_getEventIndicatorCount(builderPtr)).toBe(2);
    expect(wasmExports.dae_getEventIndicatorExprId(builderPtr, 0)).toBe(101);
    expect(wasmExports.dae_getEventIndicatorExprId(builderPtr, 1)).toBe(102);

    wasmExports.dae_setOptimizationObjective(builderPtr, 200, 201, 202, 203);
  });

  it("should support snapshot and rollback across all metadata tables", () => {
    wasmExports.dae_addVariable(builderPtr, 1, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addEquation(builderPtr, 0, 1, 2, 0);
    wasmExports.dae_addClock(builderPtr, 10, 0, 0);
    wasmExports.dae_addEventIndicator(builderPtr, 99);

    wasmExports.dae_snapshot(builderPtr);

    wasmExports.dae_addVariable(builderPtr, 2, 0, 0, 0, 0.0, 0);
    wasmExports.dae_addEquation(builderPtr, 0, 3, 4, 0);
    wasmExports.dae_addClock(builderPtr, 20, 0, 0);
    wasmExports.dae_addEventIndicator(builderPtr, 100);

    expect(wasmExports.dae_getVarCount(builderPtr)).toBe(2);
    expect(wasmExports.dae_getEqCount(builderPtr)).toBe(2);
    expect(wasmExports.dae_getClockCount(builderPtr)).toBe(2);
    expect(wasmExports.dae_getEventIndicatorCount(builderPtr)).toBe(2);

    wasmExports.dae_rollback(builderPtr);

    expect(wasmExports.dae_getVarCount(builderPtr)).toBe(1);
    expect(wasmExports.dae_getEqCount(builderPtr)).toBe(1);
    expect(wasmExports.dae_getClockCount(builderPtr)).toBe(1);
    expect(wasmExports.dae_getEventIndicatorCount(builderPtr)).toBe(1);
  });
});
