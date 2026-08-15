import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toyGrammar = language({
  name: "SyntaxLintIsolationDSL",
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
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Expr))), ";"),
    Real: ($) => semanticToken("type", "Real"),
    Integer: ($) => semanticToken("type", "Integer"),
    Type: ($) => choice($.Real, $.Integer, "Number"),
    Equation: ($) => seq(field("lhs", $.Expr), "=", field("rhs", $.Expr), ";"),
    Expr: ($) => choice($.MulExpr, $.AddExpr, $.Identifier, $.Number),
    MulExpr: ($) => prec.left(2, seq(field("left", $.Expr), field("op", "*"), field("right", $.Expr))),
    AddExpr: ($) => prec.left(1, seq(field("left", $.Expr), field("op", choice("+", "-")), field("right", $.Expr))),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
  lints: {
    uninitializedComponent: {
      nodes: ["Decl"],
      severity: "warning",
      message: "Component declaration uninitialized",
      query: `(db, node, $) => {
        let valNode = db.ast.getChildByFieldId(node, 'value');
        if (valNode == 0) {
          let nameNode = db.ast.getChildByFieldId(node, 'name');
          if (nameNode != 0) {
            db.diagnostic(nameNode);
          }
        }
      }`,
    },
  },
});

describe("Syntax Error and Lint Isolation Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(toyGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_syntax_lint_isolation");
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

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: (v: number) => console.log("AS logInt:", v) },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should not emit uninitialized lint warning on broken syntax declarations (missing semicolon)", () => {
    const code = `model ElectricalCircuit
  Real power
  power = 10;
end ElectricalCircuit;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Line 1: '  Real power' is missing semicolon ';'
    // There should be a syntax error on line 1, but NO uninitializedComponent warning on line 1
    const line1Diags = diags.filter((d: any) => d.range.start.line === 1);
    const syntaxErrors = line1Diags.filter((d: any) => d.severity === 1);
    const lintWarnings = line1Diags.filter((d: any) => d.severity === 2);

    expect(syntaxErrors.length).toBeGreaterThan(0);
    expect(lintWarnings).toHaveLength(0);
  });

  it("should accurately position squiggles on valid declarations", () => {
    const code = `model ElectricalCircuit
  Real power;
end ElectricalCircuit;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    // Only 1 diagnostic: uninitializedComponent warning for power
    expect(diags).toHaveLength(1);
    const diag = diags[0];
    expect(diag.severity).toBe(2);
    expect(diag.range.start.line).toBe(1);
    // '  Real power;' -> '  Real ' is 7 chars (0..6), 'power' is chars 7..12
    expect(diag.range.start.character).toBe(7);
    expect(diag.range.end.character).toBe(12);
  });

  it("should accurately position squiggles on downstream model after error recovery", () => {
    const code = `model ElectricalCircuit error
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit; error error error

model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("LINE 6 AST SEXPR:\n", activeFacade.getAstSExpr(ast, true));
    console.log("LINE 6 DIAGS:\n", JSON.stringify(diags, null, 2));
    const line0Diags = diags.filter((d: any) => d.severity === 1 && d.range.start.line === 0);
    expect(line0Diags.length).toBe(1);
    expect(line0Diags[0].range.start.character).toBe(24);
    expect(line0Diags[0].range.end.character).toBe(29);

    // Line 3 lint warning: 'power' uninitialized (chars 7..12)
    const line3Diags = diags.filter((d: any) => d.severity === 2 && d.range.start.line === 3);
    expect(line3Diags.length).toBe(1);
    expect(line3Diags[0].range.start.character).toBe(7);
    expect(line3Diags[0].range.end.character).toBe(12);

    // Line 6 syntax error: 'error error error' (chars 23..40)
    const line6Diags = diags.filter((d: any) => d.severity === 1 && d.range.start.line === 6);
    expect(line6Diags.length).toBe(1);
    expect(line6Diags[0].range.start.character).toBe(23);
    expect(line6Diags[0].range.end.character).toBe(40);

    // Line 10 lint warning: 'heatFlow' uninitialized on downstream model (chars 7..15)
    const heatFlowDiags = diags.filter((d: any) => d.severity === 2 && d.range.start.line === 10);
    expect(heatFlowDiags.length).toBe(1);
    const heatDiag = heatFlowDiags[0];
    expect(heatDiag.range.start.character).toBe(7);
    expect(heatDiag.range.end.character).toBe(15);
  });

  it("should isolate stray token on its own line between models without cascading errors to preceding model", () => {
    const code = `model ElectricalCircuit
  Real voltage = 12.0;
  Real current = 2.5;
  Real power;

  power = voltage * current;
end ElectricalCircuit;
error
model ThermalSystem
  Real temp = 293.15;
  Real heatFlow;

  heatFlow = temp * 1 + 0;
end ThermalSystem;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    console.log("STANDALONE ERROR AST:\n", activeFacade.getAstSExpr(ast, true));
    console.log("STANDALONE ERROR DIAGS:\n", JSON.stringify(diags, null, 2));

    const syntaxErrors = diags.filter((d: any) => d.severity === 1);
    // Should ONLY have 1 syntax error on line 7 (0-indexed line 7 = editor line 8: 'error')
    expect(syntaxErrors).toHaveLength(1);
    expect(syntaxErrors[0].range.start.line).toBe(7);
    expect(syntaxErrors[0].range.start.character).toBe(0);
    expect(syntaxErrors[0].range.end.character).toBe(5);
  });
});
