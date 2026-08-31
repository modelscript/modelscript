import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { language, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeFoldDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("WASM DaeBuilder Constant Folding Engine", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_fold");
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

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should fold elementary arithmetic and math builtins", () => {
    const b = wasmExports.dae_createBuilder();

    // Expression 1: 10 + 20 * 3 -> 70.0
    const ten = wasmExports.dae_addRealLiteral(b, 10.0);
    const twenty = wasmExports.dae_addRealLiteral(b, 20.0);
    const three = wasmExports.dae_addRealLiteral(b, 3.0);
    const mul = wasmExports.dae_addExpression(b, 5, 2, twenty, three); // BinOp.Mul = 2
    const add = wasmExports.dae_addExpression(b, 5, 0, ten, mul); // BinOp.Add = 0

    const val1 = wasmExports.dae_evalExpressionAsReal(b, add);
    expect(val1).toBeCloseTo(70.0, 6);

    // Expression 2: sin(0.5)
    const half = wasmExports.dae_addRealLiteral(b, 0.5);
    const sinExpr = wasmExports.dae_addCall(b, 0, half, 1); // BuiltinMathFunc.Sin = 0
    const sinVal = wasmExports.dae_evalExpressionAsReal(b, sinExpr);
    expect(sinVal).toBeCloseTo(Math.sin(0.5), 6);

    // Expression 3: sqrt(144.0) -> 12.0
    const oneFourFour = wasmExports.dae_addRealLiteral(b, 144.0);
    const sqrtExpr = wasmExports.dae_addCall(b, 13, oneFourFour, 1); // BuiltinMathFunc.Sqrt = 13
    const sqrtVal = wasmExports.dae_evalExpressionAsReal(b, sqrtExpr);
    expect(sqrtVal).toBeCloseTo(12.0, 6);
  });

  it("should evaluate relational comparisons and conditional branches", () => {
    const b = wasmExports.dae_createBuilder();

    // 100 > 50 -> true
    const hundred = wasmExports.dae_addRealLiteral(b, 100.0);
    const fifty = wasmExports.dae_addRealLiteral(b, 50.0);
    const gtExpr = wasmExports.dae_addExpression(b, 5, 15, hundred, fifty); // BinOp.Gt = 15

    // If (100 > 50) then 42.0 else 99.0 -> 42.0
    const fortyTwo = wasmExports.dae_addRealLiteral(b, 42.0);
    const ninetyNine = wasmExports.dae_addRealLiteral(b, 99.0);
    const ifExpr = wasmExports.dae_addIfElse(b, gtExpr, fortyTwo, ninetyNine);

    const val = wasmExports.dae_evalExpressionAsReal(b, ifExpr);
    expect(val).toBeCloseTo(42.0, 6);
  });

  it("should perform multi-pass fixed-point constant folding across parameter dependency graphs", () => {
    const b = wasmExports.dae_createBuilder();

    // parameter Real R = 100.0 (var 0)
    const varR = wasmExports.dae_addVariable(b, 1, 0, 2, 0, 100.0, 0);
    const rLiteral = wasmExports.dae_addRealLiteral(b, 100.0);
    const varRExpr = wasmExports.dae_addExpression(b, 0, varR);
    wasmExports.dae_addEquation(b, 0, varRExpr, rLiteral, 0);

    // parameter Real G = 1.0 / R (var 1)
    const varG = wasmExports.dae_addVariable(b, 2, 0, 2, 0, 0.0, 0);
    const oneLit = wasmExports.dae_addRealLiteral(b, 1.0);
    const divExpr = wasmExports.dae_addExpression(b, 5, 3, oneLit, varRExpr); // BinOp.Div = 3
    const varGExpr = wasmExports.dae_addExpression(b, 0, varG);
    wasmExports.dae_addEquation(b, 0, varGExpr, divExpr, 0);

    // parameter Real Power = G * 144.0 (var 2)
    const varP = wasmExports.dae_addVariable(b, 3, 0, 2, 0, 0.0, 0);
    const voltageSq = wasmExports.dae_addRealLiteral(b, 144.0);
    const powerExpr = wasmExports.dae_addExpression(b, 5, 2, varGExpr, voltageSq); // BinOp.Mul = 2
    const varPExpr = wasmExports.dae_addExpression(b, 0, varP);
    wasmExports.dae_addEquation(b, 0, varPExpr, powerExpr, 0);

    // Execute multi-pass fixed point folding
    const iters = wasmExports.dae_foldConstants(b, 100);
    expect(iters).toBeGreaterThanOrEqual(2);

    // Verify resolved start values
    expect(wasmExports.dae_getVarStartValue(b, varR)).toBeCloseTo(100.0, 6);
    expect(wasmExports.dae_getVarStartValue(b, varG)).toBeCloseTo(0.01, 6);
    expect(wasmExports.dae_getVarStartValue(b, varP)).toBeCloseTo(1.44, 6);
  });
});
