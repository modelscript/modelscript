import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelicaLikeGrammar = language({
  name: "ModelicaLikeGrammar",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.EquationSection)),
        semanticToken("keyword", "end"),
        optional(field("endName", $.Identifier)),
        ";",
      ),
    Decl: ($) =>
      seq(
        optional(semanticToken("keyword", "parameter")),
        field("type", $.Type),
        field("name", $.Identifier),
        repeat(seq(",", field("name", $.Identifier))),
        optional(seq("=", field("value", $.Expr))),
        ";",
      ),
    Type: ($) => choice($.Identifier, "Real", "Integer", "Pin"),
    EquationSection: ($) => seq("equation", repeat($.Equation)),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.DotExpr, $.Identifier, $.Number),
    DotExpr: ($) => prec.left(3, seq(field("left", $.Expr), ".", field("right", $.Identifier))),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s+/],
});

describe("Modelica Playground Model Parsing", () => {
  let facade;
  let tmpDir;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar);
    tmpDir = path.join(__dirname, "scratch_modelica_full_test");
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
    childProcess.execSync(ascCmd, { stdio: "pipe" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
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
    facade = new LspFacade(instance.exports.memory, instance.exports);
    facade.syntaxNames = result.syntaxNames;
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("should clear error when typing a.x = then completing to a.x = 1;", () => {
    const text1 = `model X\n  Real x;\nend X;\n\nmodel Y\n\n  X a;\nequation\n\n  a.x =\n\nend Y;`;
    const root1 = facade.parseIncremental(text1, 0, 0, text1.length, "file:///test.mo");
    console.log("Diags with 'a.x =':", facade.getDiagnostics(root1));

    // Insert " 1;" after "a.x ="
    const insertOffset = text1.indexOf("a.x =") + "a.x =".length;
    const text2 = text1.replace("a.x =", "a.x = 1;");
    const root2 = facade.parseIncremental(" 1;", insertOffset, 0, text2.length, "file:///test.mo");
    const diags2 = facade.getDiagnostics(root2);
    console.log("Diags after inserting ' 1;':", diags2);

    expect(diags2.length).toBe(0);
  }, 120000);

  it("should parse correctly after typing x. and then deleting equation x.", () => {
    const text1 = `model X\n  Real x;\nend X;\n\nmodel Y\n  X x;\nequation\n  x.\nend Y;`;
    const root1 = facade.parseIncremental(text1, 0, 0, text1.length, "file:///test.mo");
    console.log("Diags 1 (with x.):", facade.getDiagnostics(root1));

    // Delete "equation\n  x.\n"
    const delOffset = text1.indexOf("equation\n  x.\n");
    const delLen = "equation\n  x.\n".length;
    const text2 = `model X\n  Real x;\nend X;\n\nmodel Y\n  X x;\n\nend Y;`;
    const root2 = facade.parseIncremental("\n", delOffset, delLen, text2.length, "file:///test.mo");
    const diags2 = facade.getDiagnostics(root2);
    console.log("Diags 2 (after delete):", diags2);

    expect(diags2.length).toBe(0);
  }, 120000);
});
