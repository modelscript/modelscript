import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "GlrAmbiguityLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => choice($.IfStmt, $.ExprStmt),
    // Dangling-else ambiguity test
    IfStmt: ($: any) =>
      choice(
        prec(1, seq("if", "(", $.Expr, ")", $.Stmt)),
        prec(2, seq("if", "(", $.Expr, ")", $.Stmt, "else", $.Stmt)),
      ),
    ExprStmt: ($: any) => seq($.Expr, ";"),
    Expr: ($: any) => choice($.AddExpr, $.MulExpr, $.ParenExpr, $.Identifier, $.Number),
    AddExpr: ($: any) => prec.left(1, seq(field("left", $.Expr), "+", field("right", $.Expr))),
    MulExpr: ($: any) => prec.left(2, seq(field("left", $.Expr), "*", field("right", $.Expr))),
    ParenExpr: ($: any) => seq("(", $.Expr, ")"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
  recovery: {
    sync: [";", ")"],
  },
});

describe("GLR Ambiguity, GSS Splitting & Precedence Tests", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_glr_ambiguity_test");
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

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

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
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  it("should resolve operator precedence correctly (mul > add)", () => {
    const code = "x + y * z;";
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("AddExpr");
    expect(sexpr).toContain("MulExpr");
  });

  it("should handle dangling-else GLR shift/reduce choice resolution", () => {
    const code = "if (a) if (b) c; else d;";
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("IfStmt");
    expect(sexpr).not.toContain("ERROR");
  });

  it("should handle deep GSS nesting (100+ parentheses) without stack overflow", () => {
    const depth = 120;
    const openParens = "(".repeat(depth);
    const closeParens = ")".repeat(depth);
    const code = `${openParens} 42 ${closeParens} ;`;

    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("ParenExpr");
    expect(sexpr).not.toContain("ERROR");
  });

  it("should set error flags on recovered subtrees during syntax errors", () => {
    const code = "x + ;";
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const sexpr = activeFacade.getAstSExpr(ast, true);
    expect(sexpr).toContain("ERROR");
  });
});
