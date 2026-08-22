import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test language with algebraic simplification rules
const egraphTestDsl = language({
  name: "EGraphSaturationTest",
  rules: {
    Program: ($: any) => repeat($.Expr),
    Expr: ($: any) => choice($.Add, $.Sub, $.Mul, $.Identifier, $.Number),
    Add: ($: any) => seq(field("left", $.Expr), "+", field("right", $.Expr)),
    Sub: ($: any) => seq(field("left", $.Expr), "-", field("right", $.Expr)),
    Mul: ($: any) => seq(field("left", $.Expr), "*", field("right", $.Expr)),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+(\.[0-9]+)?/),
  },
  extras: ($: any) => [/\s+/],

  simplification: {
    rules: [
      { name: "add_zero", lhs: "x + 0", rhs: "x" },
      { name: "mul_one", lhs: "x * 1", rhs: "x" },
      { name: "mul_zero", lhs: "x * 0", rhs: "0" },
      { name: "sub_self", lhs: "x - x", rhs: "0" },
    ],
  },
});

describe("E-Graph Saturation & AST Simplification in WASM Linear Memory", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(egraphTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_egraph_saturation");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
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

  it("should export e-graph lifecycle and simplification functions", () => {
    expect(typeof wasmExports.initEGraph).toBe("function");
    expect(typeof wasmExports.initHashCons).toBe("function");
    expect(typeof wasmExports.saturateEGraph).toBe("function");
    expect(typeof wasmExports.initDPExtractor).toBe("function");
    expect(typeof wasmExports.simplifyAst).toBe("function");
    expect(typeof wasmExports.isConstant).toBe("function");
    expect(typeof wasmExports.dae_createBuilder).toBe("function");
  });

  it("should simplify `(x + 0) * 1` to `x` using e-graph saturation and DP extraction", () => {
    const daePtr = wasmExports.dae_createBuilder();

    // Variable x (Name id = 42)
    const varX = wasmExports.dae_addExpression(daePtr, 0 /* ExprKind.Name */, 42, 0xffffffff, 0xffffffff);
    // Constant 0
    const const0 = wasmExports.dae_addIntLiteral(daePtr, 0);
    // Constant 1
    const const1 = wasmExports.dae_addIntLiteral(daePtr, 1);

    // Expr 1: (x + 0)
    const addExpr = wasmExports.dae_addExpression(daePtr, 5 /* ExprKind.Binary */, 0 /* BinOp.Add */, varX, const0);
    // Expr 2: (x + 0) * 1
    const mulExpr = wasmExports.dae_addExpression(daePtr, 5 /* ExprKind.Binary */, 2 /* BinOp.Mul */, addExpr, const1);

    // Run simplifyAst
    const simplifiedId = wasmExports.simplifyAst(mulExpr, daePtr);

    // Simplified AST should extract directly to varX (ExprKind.Name with data1 = 42)
    const kind = wasmExports.dae_getExprKind(daePtr, simplifiedId);
    const data1 = wasmExports.dae_getExprData1(daePtr, simplifiedId);

    expect(kind).toBe(0); // ExprKind.Name
    expect(data1).toBe(42); // variable id = 42
  });

  it("should simplify `(x * 0) + 0` to constant `0`", () => {
    const daePtr = wasmExports.dae_createBuilder();

    const varX = wasmExports.dae_addExpression(daePtr, 0 /* ExprKind.Name */, 99, 0xffffffff, 0xffffffff);
    const const0 = wasmExports.dae_addIntLiteral(daePtr, 0);

    // (x * 0)
    const mulExpr = wasmExports.dae_addExpression(daePtr, 5 /* ExprKind.Binary */, 2 /* BinOp.Mul */, varX, const0);
    // (x * 0) + 0
    const addExpr = wasmExports.dae_addExpression(daePtr, 5 /* ExprKind.Binary */, 0 /* BinOp.Add */, mulExpr, const0);

    const simplifiedId = wasmExports.simplifyAst(addExpr, daePtr);

    const kind = wasmExports.dae_getExprKind(daePtr, simplifiedId);
    const data1 = wasmExports.dae_getExprData1(daePtr, simplifiedId);

    expect(kind).toBe(1); // ExprKind.IntLiteral
    expect(data1).toBe(0); // value = 0
  });
});
