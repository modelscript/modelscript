import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, CodeGraph, field, language, optional, repeat, semanticToken, seq, u32 } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const interpolationGrammar = language({
  name: "InterpolationGrammar",
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
      seq(field("type", $.Type), field("name", $.Identifier), optional(seq("=", field("value", $.Number))), ";"),
    Type: ($) => choice("Real", "Integer", "Boolean"),
    Equation: ($) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Identifier), ";"),
    Identifier: ($) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: ($) => [/\s/],
  lints: {
    uninitializedComponent: {
      nodes: ["Decl"],
      severity: "warning",
      code: 2001,
      message: (target) =>
        `Component '${target.name}' of type '${target.type}' is uninitialized (full node: '${target.text}').`,
      query: (db: CodeGraph, node: u32) => {
        const val = db.ast.getChildByFieldId(node, "value");
        if (val == 0) {
          db.diagnostic(node);
        }
      },
    },
    unbalancedCounts: {
      nodes: ["ModelDef"],
      severity: "error",
      code: 4004,
      message: (target, eqCount, varCount) =>
        `Model '${target.name}' is unbalanced: ${eqCount.asNumber()} equations for ${varCount} variables.`,
      query: (db: CodeGraph, node: u32) => {
        // Pass dummy counts 5 and 7 as raw numbers
        db.diagnostic(node, 5, 7);
      },
    },
    explicitFieldAccessor: {
      nodes: ["Equation"],
      severity: "info",
      code: 5001,
      message: (target) => `Equation lhs='${target.field("lhs")}' and rhs='${target.fields.rhs}'.`,
      query: (db: CodeGraph, node: u32) => {
        db.diagnostic(node);
      },
    },
  },
});

describe("Enriched DiagnosticContext Template String Interpolation (Option 3)", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(interpolationGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_interpolation");
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
    activeFacade = new LspFacade(instance.exports.memory, instance.exports);
    activeFacade.syntaxNames = result.syntaxNames;
  }, 120000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("interpolates AST node child fields and full text", () => {
    const code = `model TestModel
  Real x;
  Real y = 10;
  x = y;
end TestModel;`;

    const root = activeFacade.parseIncremental(code, 0, 0, code.length);
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    console.log("DIAGNOSTICS:\n", JSON.stringify(diags, null, 2));

    // 1. uninitializedComponent on 'Real x;'
    const uninitDiag = diags.find((d: any) => d.code === 2001);
    expect(uninitDiag).toBeDefined();
    expect(uninitDiag.message).toBe("Component 'x' of type 'Real' is uninitialized (full node: 'Real x;').");

    // 2. unbalancedCounts on 'model TestModel'
    const unbalancedDiag = diags.find((d: any) => d.code === 4004);
    expect(unbalancedDiag).toBeDefined();
    expect(unbalancedDiag.message).toBe("Model 'TestModel' is unbalanced: 5 equations for 7 variables.");

    // 3. explicitFieldAccessor on 'x = y;'
    const eqDiag = diags.find((d: any) => d.code === 5001);
    expect(eqDiag).toBeDefined();
    expect(eqDiag.message).toBe("Equation lhs='x' and rhs='y'.");
  });
});
