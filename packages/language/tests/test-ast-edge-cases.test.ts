import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const edgeCaseGrammar = {
  name: "AstEdgeCaseDSL",
  rules: {
    Program: ($: any) => repeat($.Decl),
    Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($: any) => "Real",
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\u0080-\uFFFF]*/),
  },
  extras: ($: any) => [/\s/],
  lints: {
    uninit: {
      nodes: ["Decl"],
      severity: "warning",
      message: "Uninitialized component",
      query: `(db, node, $) => {
        let nameNode = db.ast.getChildByFieldId(node, 'name');
        if (nameNode != 0) {
          db.diagnostic(nameNode);
        }
      }`,
    },
  },
};

describe("AST Traversal & Edge Cases Verification Suite", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(edgeCaseGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_ast_edge_cases");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
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
      env: { memory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
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

  it("should calculate exact range for UTF-16 non-ASCII identifier 'β_power'", () => {
    const code = `Real β_power;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    const diag = diags.find((d: any) => d.message.includes("Uninitialized")) || diags[0];

    expect(diag).toBeDefined();
    expect(diag.range.start.line).toBe(0);
    expect(diag.range.start.character).toBe(5);
    expect(diag.range.end.character).toBe(12);
  });

  it("should handle CRLF (\\r\\n) line endings without range offset drift", () => {
    const code = "Real voltage;\r\n  Real power;";
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    const diag = diags.find((d: any) => d.range.start.line === 1);

    expect(diag).toBeDefined();
    expect(diag.range.start.line).toBe(1);
    expect(diag.range.start.character).toBe(7);
    expect(diag.range.end.character).toBe(12);
  });

  it("should resolve field 'name' when token is preceded by terminal keywords 'parameter Real'", () => {
    const code = `parameter Real power;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);
    const diag = diags.find((d: any) => d.message && d.message.includes("Uninitialized")) || diags[0];

    expect(diag).toBeDefined();
    expect(diag.range.start.character).toBeGreaterThanOrEqual(0);
  });

  it("should gracefully fall back to nodeStart when field 'name' is missing without WASM crash", () => {
    const code = `Real ;`;
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(ast).toBeGreaterThan(0);
    expect(diags).toBeDefined();
  });

  it("should handle severe document shrinking in parseIncremental without WASM heap buffer overshoot or RangeError", () => {
    const initialCode = "Real var_0;\n" + Array.from({ length: 500 }, (_, i) => `Real var_${i + 1};`).join("\n");
    const initialAst = activeFacade.parse(initialCode);
    expect(initialAst).toBeGreaterThan(0);

    const initialLen = initialCode.length;
    const shrinkCode = "Real x;";
    const editLen = initialLen - shrinkCode.length;

    // Perform massive deletion edit (oldTotalLength >> newTotalLength)
    const shrunkAst = activeFacade.parseIncremental(shrinkCode, 0, editLen, shrinkCode.length);
    expect(shrunkAst).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(shrunkAst);
    expect(diags).toBeDefined();
  });

  it("should handle parseIncrementalBatch with multi-edit deletions without buffer overshoot", () => {
    const initialCode = "Real a;\nReal b;\nReal c;\nReal d;\nReal e;";
    activeFacade.parse(initialCode);

    const batchEdits = [
      { rangeOffset: 5, rangeLength: 10, text: "" },
      { rangeOffset: 15, rangeLength: 10, text: "Real z;" },
    ];

    const newLen = 15;
    const batchAst = activeFacade.parseIncrementalBatch(batchEdits, newLen);
    expect(batchAst).toBeGreaterThan(0);

    const diags = activeFacade.getDiagnostics(batchAst);
    expect(diags).toBeDefined();
  });

  it("should handle rapid grow and shrink cycles in parseIncremental without memory leaks or crashes", () => {
    let code = "Real x;";
    activeFacade.parse(code);

    for (let cycle = 0; cycle < 10; cycle++) {
      const growText = "Real x;\n" + "Real y;\n".repeat(50);
      activeFacade.parseIncremental(growText, 0, code.length, growText.length);
      code = growText;

      const shrinkText = "Real z;";
      activeFacade.parseIncremental(shrinkText, 0, code.length, shrinkText.length);
      code = shrinkText;
    }

    const finalAst = activeFacade.parse(code);
    expect(finalAst).toBeGreaterThan(0);
  });

  it("should extract clean linter diagnostic string parameters without embedded null bytes", () => {
    const code = "Real power_alpha;";
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(diags.length).toBeGreaterThan(0);
    for (const diag of diags) {
      expect(diag.message.includes("\0")).toBe(false);
    }
  });

  it("should maintain accurate diagnostic offsets for declarations following auto-inserted virtual tokens", () => {
    const code = "Real current\nReal voltage;"; // missing semicolon after current causes inserted virtual token
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(ast).toBeGreaterThan(0);
    expect(diags).toBeDefined();

    const currentDiag = diags.find((d: any) => d.range.start.line === 0);
    expect(currentDiag).toBeDefined();
    expect(currentDiag.range.start.line).toBe(0);
    expect(currentDiag.range.end.character).toBeGreaterThanOrEqual(4);
  });

  it("should handle WASM memory buffer growth during diagnostic extraction without detachment error", () => {
    // Generate large input with 1,000 declarations to exercise memory growth during traversal
    const code = Array.from({ length: 1000 }, (_, i) => `Real comp_${i};`).join("\n");
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(ast).toBeGreaterThan(0);
    expect(diags).toBeDefined();
    expect(diags.length).toBeGreaterThan(0);
  });

  it("should emit syntax error diagnostic (severity 1) when invalid ERROR token is present", () => {
    const code = "parameter Real ERROR\nReal voltage = 12.0;";
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(ast).toBeGreaterThan(0);
    expect(diags).toBeDefined();
    const syntaxErr = diags.find((d: any) => d.severity === 1 || d.message === "Syntax Error");
    expect(syntaxErr).toBeDefined();
  });

  it("should isolate linter warning start line to its own line and not bleed into previous line syntax errors", () => {
    const code = "parameter Real = ;\nReal voltage;";
    const ast = activeFacade.parse(code);
    const diags = activeFacade.getDiagnostics(ast);

    expect(ast).toBeGreaterThan(0);
    expect(diags).toBeDefined();
    const line0Err = diags.find((d: any) => d.range.start.line === 0);
    expect(line0Err).toBeDefined();
  });

  it("should expose extrasRegex derived from grammar extras pattern", () => {
    expect(activeFacade.extrasRegex).toBeDefined();
    expect(activeFacade.isExtraChar(" ")).toBe(true);
    expect(activeFacade.isExtraChar("\n")).toBe(false);
  });
});
