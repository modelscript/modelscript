import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, CodeGraph, field, language, optional, repeat, semanticToken, seq, u32 } from "../src/dsl.js";

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
    identifierMismatch: {
      nodes: ["ModelDef"],
      severity: "error",
      code: 2005,
      message: (target) => `The identifier at start ('${target.name}') and end ('${target.endName}') are different.`,
      query: (db: CodeGraph, node: u32) => {
        const startId = db.ast.getChildByFieldId(node, "name");
        const endId = db.ast.getChildByFieldId(node, "endName");
        if (startId != 0 && endId != 0) {
          if (!db.ast.textEqualsNode(startId, endId)) {
            db.diagnostic(endId, node);
          }
        }
      },
    },
  },
});

describe("Incremental Repair & Lint Root Synchronization", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(modelicaLikeGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_incremental_repair");
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

  test("properly synchronizes globalAstRoot after incremental edits and repairs", () => {
    // 1. Initial valid model: "model X1\n  \nend X1;"
    let code = "model X1\n  \nend X1;";
    let root = activeFacade.parseIncremental(code, 0, 0, code.length, "file:///test.mo");
    expect(root).toBeGreaterThan(0);

    let diags = activeFacade.getDiagnostics(root);
    expect(diags).toEqual([]);

    // 2. Corrupt model with typo on line 2: "model X1\n  mo del\nend X1;"
    // Edit line 2 (offset 11, replace 0 chars with "mo del")
    const corruptText = "mo del";
    code = "model X1\n  mo del\nend X1;";
    root = activeFacade.parseIncremental(corruptText, 11, 0, code.length, "file:///test.mo");
    expect(root).toBeGreaterThan(0);

    diags = activeFacade.getDiagnostics(root);
    expect(diags.length).toBeGreaterThan(0);

    // 3. Repair model back by deleting "mo del" from line 2
    code = "model X1\n  \nend X1;";
    root = activeFacade.parseIncremental("", 11, 6, code.length, "file:///test.mo");
    expect(root).toBeGreaterThan(0);

    diags = activeFacade.getDiagnostics(root);
    console.log("REPAIRED DIAGNOSTICS:", JSON.stringify(diags, null, 2));

    // After repair, there should be ZERO diagnostics:
    // - No M2005 (The identifier at start and end are different)
    // - No phantom syntax errors
    expect(diags).toEqual([]);
  });

  test("correctly flags genuine identifier mismatch when start and end identifiers differ", () => {
    const mismatchCode = "model X1\n  \nend X2;";
    const root = activeFacade.parseIncremental(mismatchCode, 0, 0, mismatchCode.length, "file:///test2.mo");
    expect(root).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(root);
    expect(diags.length).toBe(1);
    expect(diags[0].code).toBe(2005);
    expect(diags[0].message).toBe("The identifier at start ('X1') and end ('X2') are different.");
  });
});
