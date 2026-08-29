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
        field("endName", $.Identifier),
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
  extras: ($) => [/\s/],
});

describe("Incremental Repair Cleanliness Test", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_repair_cleanliness");
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
    activeFacade.syntaxNames = result.syntaxNames;
  }, 40000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });

  it("should completely clear diagnostics when an error on Line 2 is repaired incrementally", () => {
    const baseCode = `model ElectricalCircuit
  Pin p, n;
  parameter Real R = 100.0;
  parameter Real L = 0.001;
  Real v, i;
equation
  v = p - n;
  0 = p + n;
  i = p;
  v = R * i;
end ElectricalCircuit;
`;

    // 1. Initial clean parse
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length);
    expect(ast0).toBeGreaterThan(0);
    const diags0 = activeFacade.getDiagnostics(ast0);
    console.log("INITIAL DIAGS COUNT:", diags0.length);
    expect(diags0).toHaveLength(0);

    // 2. Introduce error on Line 2: replace 'Pin p, n;' with 'Pin p n;' (delete comma)
    const commaOffset = baseCode.indexOf(",");
    expect(commaOffset).toBeGreaterThan(0);

    // Delete the comma
    const brokenAst = activeFacade.parseIncremental("", commaOffset, 1, baseCode.length - 1);
    expect(brokenAst).toBeGreaterThan(0);
    const brokenDiags = activeFacade.getDiagnostics(brokenAst);
    console.log("BROKEN DIAGS:\n", JSON.stringify(brokenDiags, null, 2));
    expect(brokenDiags.length).toBeGreaterThan(0);
    expect(brokenDiags[0].range.start.line).toBe(1);

    // 3. Repair the error: insert ',' back at commaOffset
    const repairedAst = activeFacade.parseIncremental(",", commaOffset, 0, baseCode.length);
    expect(repairedAst).toBeGreaterThan(0);
    const repairedDiags = activeFacade.getDiagnostics(repairedAst);
    console.log("REPAIRED DIAGS:\n", JSON.stringify(repairedDiags, null, 2));
    expect(repairedDiags).toHaveLength(0);

    // 4. Introduce error by deleting semicolon at end of Line 2
    const semiOffset = baseCode.indexOf(";");
    expect(semiOffset).toBeGreaterThan(0);
    const brokenSemiAst = activeFacade.parseIncremental("", semiOffset, 1, baseCode.length - 1);
    const brokenSemiDiags = activeFacade.getDiagnostics(brokenSemiAst);
    console.log("BROKEN SEMI DIAGS:\n", JSON.stringify(brokenSemiDiags, null, 2));
    expect(brokenSemiDiags.length).toBeGreaterThan(0);

    // 5. Repair semicolon back
    const repairedSemiAst = activeFacade.parseIncremental(";", semiOffset, 0, baseCode.length);
    const repairedSemiDiags = activeFacade.getDiagnostics(repairedSemiAst);
    console.log("REPAIRED SEMI DIAGS:\n", JSON.stringify(repairedSemiDiags, null, 2));
    expect(repairedSemiDiags).toHaveLength(0);
  });
});
