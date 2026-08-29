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

describe("Error -> Repair -> Error Hang Reproduction", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_hang_test");
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

  it("should handle error -> repair -> error without hanging", () => {
    let currentCode = `model ElectricalCircuit
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

model ChuaCircuit
  Pin p, n;
  Real vC1, vC2, iL;
  parameter Real C1 = 10.0;
  parameter Real C2 = 100.0;
  parameter Real L = 18.0;
  parameter Real G = 0.7;
equation
  C1 = G * vC2;
  C2 = G * vC1 + iL;
  L = vC2;
end ChuaCircuit;
`;

    // 1. Initial parse
    activeFacade.lastAstRoot = 0;
    let ast = activeFacade.parseIncremental(currentCode, 0, 0, currentCode.length);
    console.log("Step 1 (Initial) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);

    // 2. Introduce error: "model" -> "mo del" (insert ' ' at offset 2)
    // insert space at offset 2: rangeOffset=2, rangeLength=0, text=" "
    currentCode = currentCode.slice(0, 2) + " " + currentCode.slice(2);
    ast = activeFacade.parseIncremental(" ", 2, 0, currentCode.length);
    console.log("Step 2 (mo del) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast).length).toBeGreaterThan(0);

    // 3. Repair error: "mo del" -> "model" (delete ' ' at offset 2)
    // delete space at offset 2: rangeOffset=2, rangeLength=1, text=""
    currentCode = currentCode.slice(0, 2) + currentCode.slice(3);
    ast = activeFacade.parseIncremental("", 2, 1, currentCode.length);
    console.log("Step 3 (Repaired) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    expect(ast).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast)).toHaveLength(0);

    // 4. Introduce new error: "model ElectricalCircuit ERROR" (insert " ERROR" after ElectricalCircuit at offset 23)
    const ecOffset = currentCode.indexOf("ElectricalCircuit") + "ElectricalCircuit".length;
    console.log("ecOffset:", ecOffset);
    currentCode = currentCode.slice(0, ecOffset) + " ERROR" + currentCode.slice(ecOffset);
    ast = activeFacade.parseIncremental(" ERROR", ecOffset, 0, currentCode.length);
    console.log("Step 4 (ERROR) astRoot:", ast, "diags:", activeFacade.getDiagnostics(ast).length);
    expect(ast).toBeGreaterThan(0);
  });
});
