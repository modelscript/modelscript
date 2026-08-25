import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeTier1DSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("Tier 1: WASM DAE Batch Scalarization, Symbolic Isolation & CSE", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_tier1");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

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

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should scalarize multi-dimensional array variables and vector equations in linear memory", () => {
    const b = wasmExports.dae_createBuilder();

    // Add 2D Array variable: Real T[2, 3] with start value 293.15
    const tVar = wasmExports.dae_addVariable(b, 0x1234, 0, 0, 0, 293.15, 0);
    wasmExports.dae_setVarShapeDim(b, tVar, 0, 2); // Dim 0 = 2
    wasmExports.dae_setVarShapeDim(b, tVar, 1, 3); // Dim 1 = 3

    // Add Scalar variable: Real P
    const pVar = wasmExports.dae_addVariable(b, 0x5678, 0, 2, 0, 100.0, 0);

    // Add vector equation: T = P (broadcast scalar to 2x3 tensor)
    const exprT = wasmExports.dae_addName(b, tVar);
    const exprP = wasmExports.dae_addName(b, pVar);
    wasmExports.dae_addEquation(b, 1, exprT, exprP, 0); // EqKind.Array = 1

    expect(wasmExports.dae_getVarCount(b)).toBe(2);
    expect(wasmExports.dae_getEqCount(b)).toBe(1);

    // Perform In-Memory Batch Scalarization
    const scalarDae = wasmExports.dae_scalarize(b);
    expect(scalarDae).toBeGreaterThan(0);

    // Assert: Array T[2, 3] expanded into 6 scalar variables + 1 scalar P = 7 variables
    expect(wasmExports.dae_getVarCount(scalarDae)).toBe(7);
    // Assert: Vector equation expanded into 6 scalar equations
    expect(wasmExports.dae_getEqCount(scalarDae)).toBe(6);

    // Verify all 6 scalar variables have initial start value 293.15
    for (let i = 0; i < 6; i++) {
      expect(wasmExports.dae_getVarStartValue(scalarDae, i)).toBeCloseTo(293.15, 4);
    }
  });

  it("should symbolically isolate variables in linear and transcendental equations", () => {
    const b = wasmExports.dae_createBuilder();

    // Variable x
    const varX = wasmExports.dae_addVariable(b, 0x1111, 0, 0, 0, 0.0, 0);
    const exprX = wasmExports.dae_addName(b, varX);

    // Equation 1: 3.0 * x - 12.0 = 0 -> x = 4.0
    const three = wasmExports.dae_addRealLiteral(b, 3.0);
    const twelve = wasmExports.dae_addRealLiteral(b, 12.0);
    const zero = daeAddReal(b, 0.0);
    const threeX = wasmExports.dae_addBinaryExpr(b, 2, three, exprX); // BinOp.Mul = 2
    const lhs1 = wasmExports.dae_addBinaryExpr(b, 1, threeX, twelve); // BinOp.Sub = 1
    const eq1 = wasmExports.dae_addEquation(b, 0, lhs1, zero, 0);

    const isolatedExpr1 = wasmExports.dae_isolateEquation(b, eq1, varX);
    expect(isolatedExpr1).toBeLessThan(0xffffffff);

    const evalBuf = wasmExports.atomicChunkAlloc(8);
    const res1 = wasmExports.dae_evalExpr(b, isolatedExpr1, evalBuf);
    expect(res1).toBeCloseTo(4.0, 5);

    // Equation 2: sqrt(x) = 5.0 -> x = 25.0
    const sqrtX = wasmExports.dae_addCall(b, 13, exprX, 1); // BuiltinMathFunc.Sqrt = 13
    const five = wasmExports.dae_addRealLiteral(b, 5.0);
    const eq2 = wasmExports.dae_addEquation(b, 0, sqrtX, five, 0);

    const isolatedExpr2 = wasmExports.dae_isolateEquation(b, eq2, varX);
    expect(isolatedExpr2).toBeLessThan(0xffffffff);

    const res2 = wasmExports.dae_evalExpr(b, isolatedExpr2, evalBuf);
    expect(res2).toBeCloseTo(25.0, 5);
  });

  it("should eliminate duplicate common subexpressions across expression DAGs", () => {
    const b = wasmExports.dae_createBuilder();

    const varA = wasmExports.dae_addVariable(b, 0x1, 0, 0, 0, 2.0, 0);
    const varB = wasmExports.dae_addVariable(b, 0x2, 0, 0, 0, 3.0, 0);
    const varC = wasmExports.dae_addVariable(b, 0x3, 0, 0, 0, 4.0, 0);

    const exprA = wasmExports.dae_addName(b, varA);
    const exprB = wasmExports.dae_addName(b, varB);
    const exprC = wasmExports.dae_addName(b, varC);

    // Build Subtree 1: (a * b) + c
    const mul1 = wasmExports.dae_addBinaryExpr(b, 2, exprA, exprB);
    const subTree1 = wasmExports.dae_addBinaryExpr(b, 0, mul1, exprC);

    // Build Subtree 2: Identical (a * b) + c
    const mul2 = wasmExports.dae_addBinaryExpr(b, 2, exprA, exprB);
    const subTree2 = wasmExports.dae_addBinaryExpr(b, 0, mul2, exprC);

    // Build Subtree 3: Identical (a * b) + c
    const mul3 = wasmExports.dae_addBinaryExpr(b, 2, exprA, exprB);
    const subTree3 = wasmExports.dae_addBinaryExpr(b, 0, mul3, exprC);

    const countBefore = wasmExports.dae_getExprCount(b);
    expect(countBefore).toBeGreaterThanOrEqual(9);

    // Add equation referencing subTree3
    const eq = wasmExports.dae_addEquation(b, 0, exprC, subTree3, 0);

    // Run CSE Pass
    const eliminated = wasmExports.dae_eliminateCommonSubexpressions(b);
    expect(eliminated).toBeGreaterThanOrEqual(4);

    // Verify evaluation of the canonicalized equation RHS is mathematically exact: 2*3 + 4 = 10
    const evalBuf = wasmExports.atomicChunkAlloc(32);
    wasmExports.dae_setMemF64(evalBuf + 0, 2.0);
    wasmExports.dae_setMemF64(evalBuf + 8, 3.0);
    wasmExports.dae_setMemF64(evalBuf + 16, 4.0);

    const canonRhs = wasmExports.dae_getEqRhs(b, eq);
    const val = wasmExports.dae_evalExpr(b, canonRhs, evalBuf);
    expect(val).toBeCloseTo(10.0, 6);
  });

  function daeAddReal(builder: any, val: number): number {
    return wasmExports.dae_addRealLiteral(builder, val);
  }
});
