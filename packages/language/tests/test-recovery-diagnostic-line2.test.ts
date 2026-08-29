import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const customTypeGrammar = language({
  name: "CustomTypeRecoveryDSL",
  word: ($) => $.Identifier,
  rules: {
    Program: ($) => repeat($.ModelDef),
    ModelDef: ($) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end"),
        field("endName", $.Identifier),
        ";",
      ),
    Decl: ($) =>
      seq(
        field("type", $.Type),
        field("name", $.Identifier),
        repeat(seq(",", field("name", $.Identifier))),
        optional(seq("=", field("value", $.Expr))),
        ";",
      ),
    Type: ($) => choice($.Identifier, "Real", "Integer"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
});

describe("Syntax Diagnostic Emission on Recovered Invalid Token Sequences", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(customTypeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_line2_diag");
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
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should emit a syntax error diagnostic on line 1 or line 2 when 'ERROR' is followed by 'Pin p, n;'", () => {
    const code = `model ElectricalCircuit ERROR
  Pin p, n;
  Real v, i;
end ElectricalCircuit;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("LINE2 RECOVERY DIAGS:", JSON.stringify(diags, null, 2));

    expect(diags.length).toBeGreaterThan(0);
    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Diagnostic should be located on line 1 (editor line 2), columns 2..5 targeting 'Pin'
    const syntaxDiag = syntaxErrors[0];
    expect(syntaxDiag).toBeDefined();
    expect(syntaxDiag.range.start.line).toBe(1);
    expect(syntaxDiag.range.start.character).toBe(2);
    expect(syntaxDiag.range.end.line).toBe(1);
    expect(syntaxDiag.range.end.character).toBe(5);
  });

  it("should emit a syntax error diagnostic during parseIncremental when typing ' ERROR' keystroke by keystroke with exact range", () => {
    const baseCode = `model ElectricalCircuit
  Pin p, n;
  Real v, i;
end ElectricalCircuit;
`;
    activeFacade.lastAstRoot = 0;
    let curLen = baseCode.length;
    let ast = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length);
    let diags = activeFacade.getDiagnostics(ast);
    expect(diags).toHaveLength(0);

    const keystrokes = [" ", "E", "R", "R", "O", "R"];
    const insertPos = 23; // after 'model ElectricalCircuit'

    for (let i = 0; i < keystrokes.length; i++) {
      ast = activeFacade.parseIncremental(keystrokes[i], insertPos + i, 0, ++curLen);
      diags = activeFacade.getDiagnostics(ast);
      console.log(`AFTER TYPING '${keystrokes.slice(0, i + 1).join("")}':`, JSON.stringify(diags, null, 2));
    }

    expect(diags.length).toBeGreaterThan(0);
    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    expect(syntaxErrors.length).toBeGreaterThan(0);

    // Assert exact line/column range on line 1 (editor line 2), columns 2..5 targeting 'Pin'
    const syntaxDiag = syntaxErrors[0];
    expect(syntaxDiag).toBeDefined();
    expect(syntaxDiag.range.start.line).toBe(1);
    expect(syntaxDiag.range.start.character).toBe(2);
    expect(syntaxDiag.range.end.line).toBe(1);
    expect(syntaxDiag.range.end.character).toBe(5);
  });
});
