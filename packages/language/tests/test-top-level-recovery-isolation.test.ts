import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, optional, prec, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const multiModelGrammar = language({
  name: "MultiModelIsolationDSL",
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

describe("Top-Level Recovery & Multi-Model Isolation", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(multiModelGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_isolation");
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

  it("should isolate errors in the first model and cleanly parse the second model", () => {
    const code = `mo del ElectricalCircuit
  Pin p, n;
  Real v, i;
end ElectricalCircuit;

model ChuaCircuit
  Pin p, n;
  Real v, i;
end ChuaCircuit;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const flatChildren = activeFacade.getFlattenedChildren ? activeFacade.getFlattenedChildren(ast) : [];
    console.log("ROOT CHILDREN COUNT:", flatChildren.length);
    for (const c of flatChildren) {
      console.log("CHILD:", c.field, c.ptr);
    }

    const diags = activeFacade.getDiagnostics(ast);
    console.log("ISOLATION DIAGS:", JSON.stringify(diags, null, 2));

    // The second model (ChuaCircuit) starts at line 6 (index 6, offset ~65)
    // Verify that ChuaCircuit is not swallowed by an all-encompassing error spanning line 1 to EOF
    const chuaDiags = diags.filter((d: any) => d.range && d.range.start.line >= 6);
    expect(chuaDiags.length).toBe(0);
  });

  it("should emit syntax error diagnostic for trailing invalid tokens on line 1", () => {
    const code = `model ElectricalCircuit ERROR ERROR ERROR ERROR ERROR ERROR
  Pin p, n;
  Real v, i;
end ElectricalCircuit;

model ChuaCircuit
  Pin p, n;
  Real v, i;
end ChuaCircuit;
`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(ast);
    console.log("LINE 1 ERROR TOKENS DIAGS:", JSON.stringify(diags, null, 2));

    expect(diags.length).toBeGreaterThan(0);
    const line0Diags = diags.filter((d: any) => d.range && d.range.start.line === 0);
    expect(line0Diags.length).toBeGreaterThan(0);

    // ChuaCircuit should remain clean
    const chuaDiags = diags.filter((d: any) => d.range && d.range.start.line >= 6);
    expect(chuaDiags.length).toBe(0);
  });
});
