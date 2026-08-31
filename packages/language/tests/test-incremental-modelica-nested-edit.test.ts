import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Incremental Nested Model Edit Test", () => {
  let activeFacade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const rel = ["..", "..", "..", "languages", "modelica", "dist", "src", "language.js"].join("/");
    const langMod = await import(rel);
    const modelicaLanguage = langMod.modelicaLanguage;
    const sourcePath = path.resolve(__dirname, "../../../languages/modelica/src/language.ts");
    const result = buildParser(modelicaLanguage as any, { sourcePath });

    tmpDir = path.join(__dirname, "scratch_build_nested_incremental_test");
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
  }, 240000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });

  it("should cleanly resolve syntax errors when inner model is closed with end;", () => {
    // 1. Initial valid document
    const initialCode = `model X\n\n\nend X;\n`;
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(initialCode, 0, 0, initialCode.length, "file:///test.mo");
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // 2. Insert unclosed inner model '  model Y\n'
    const insertOffset1 = initialCode.indexOf("\n\n") + 1;
    const insertText1 = "  model Y\n";
    const text2 = initialCode.slice(0, insertOffset1) + insertText1 + initialCode.slice(insertOffset1);
    const ast1 = activeFacade.parseIncremental(insertText1, insertOffset1, 0, text2.length, "file:///test.mo");
    expect(ast1).toBeGreaterThan(0);
    const diags1 = activeFacade.getDiagnostics(ast1);
    expect(diags1.length).toBeGreaterThan(0);

    // 3. Complete inner model by inserting '  end;\n'
    const insertOffset2 = insertOffset1 + insertText1.length;
    const insertText2 = "  end;\n";
    const text3 = text2.slice(0, insertOffset2) + insertText2 + text2.slice(insertOffset2);
    const ast2 = activeFacade.parseIncremental(insertText2, insertOffset2, 0, text3.length, "file:///test.mo");
    expect(ast2).toBeGreaterThan(0);
    const diags2 = activeFacade.getDiagnostics(ast2);
    expect(diags2).toHaveLength(0);
  });

  it("should handle parseIncrementalBatch with multiple edits in arbitrary order", () => {
    const baseCode = `model X\n  Real a;\n  Real b;\nend X;\n`;
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length, "file:///test.mo");
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Two edits: one near top, one near bottom
    const offsetA = baseCode.indexOf("Real a");
    const offsetB = baseCode.indexOf("Real b");

    // Edits passed in ascending order
    const editsAsc = [
      { text: "parameter Real a = 1.0", rangeOffset: offsetA, rangeLength: "Real a".length },
      { text: "parameter Real b = 2.0", rangeOffset: offsetB, rangeLength: "Real b".length },
    ];
    const newTotalLength =
      baseCode.length +
      (editsAsc[0].text.length - editsAsc[0].rangeLength) +
      (editsAsc[1].text.length - editsAsc[1].rangeLength);

    const astBatch = activeFacade.parseIncrementalBatch(editsAsc, newTotalLength, "file:///test.mo");
    expect(astBatch).toBeGreaterThan(0);
    const diags = activeFacade.getDiagnostics(astBatch);
    expect(diags).toHaveLength(0);
  });
});
