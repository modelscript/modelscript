import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { choice, field, optional, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dslGrammar = {
  name: "RapidTypingTestDsl",
  rules: {
    Program: ($: any) => repeat(choice($.Decl, $.Equation, $.ConnectorDef)),
    ConnectorDef: ($: any) => seq("connector", field("name", $.Identifier), repeat($.Decl), "end", $.Identifier, ";"),
    Decl: ($: any) =>
      seq(
        optional(choice("parameter", "flow")),
        $.TypeName,
        field("name", $.Identifier),
        optional(seq("=", $.Expr)),
        ";",
      ),
    TypeName: ($: any) => choice("Real", "Integer", $.Identifier),
    Equation: ($: any) => seq($.Expr, "=", $.Expr, ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: () => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: () => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  extras: () => [/\s/],
};

describe("Rapid Typing Incremental Buffer & Diagnostics Suite", () => {
  let tmpDir: string;
  let activeFacade: any;
  let wasmMemory: WebAssembly.Memory;

  beforeAll(async () => {
    tmpDir = path.join(__dirname, "scratch_build_rapid_typing");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dslGrammar as any);

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
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, Tree };`;
    const getFacade = new Function(wrapperSrc);
    const { LspFacade } = getFacade();

    wasmMemory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: wasmMemory, abort: () => {}, logNode: () => {}, debugLog: () => {} },
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

  const getWasmText = (lenChars: number): string => {
    const inputPtr = activeFacade.exports.getInputBuffer();
    const mem16 = new Uint16Array(activeFacade.wasmMemory.buffer, inputPtr, lenChars);
    let str = "";
    for (let i = 0; i < lenChars; i++) {
      str += String.fromCharCode(mem16[i]);
    }
    return str;
  };

  it("should maintain byte-for-byte fidelity across rapid single-character keystrokes", () => {
    const docUri = "file:///workspace/rapid.dsl";
    let text = "connector Pin\n  Real v;\n  flow Real i;\nend Pin;\n";
    let root = activeFacade.parse(text, 0, 0, 0, docUri);
    expect(root).toBeGreaterThan(0);
    expect(getWasmText(text.length)).toBe(text);

    // Simulate typing "parameter Real R = 100.0;\n" char by char at the end
    const appendText = "parameter Real R = 100.0;\n";
    for (const ch of appendText) {
      const offset = text.length;
      text += ch;
      root = activeFacade.parseIncremental(ch, offset, 0, text.length, docUri);
      expect(root).toBeGreaterThan(0);
      expect(getWasmText(text.length)).toBe(text);
    }

    const diags = activeFacade.getDiagnostics(root);
    expect(diags).toEqual([]);
  });

  it("should accurately reflect diagnostics across intermediate syntax errors and subsequent repairs", () => {
    const docUri = "file:///workspace/error_repair.dsl";
    let text = "Real x;\n";
    let root = activeFacade.parse(text, 0, 0, 0, docUri);
    expect(activeFacade.getDiagnostics(root)).toEqual([]);

    // Introduce syntax error: "Real x @#$%;\n"
    const errorInsertion = " @#$%";
    const editOffset = 6; // right before ';'
    text = "Real x @#$%;\n";
    root = activeFacade.parseIncremental(errorInsertion, editOffset, 0, text.length, docUri);
    expect(root).toBeGreaterThan(0);
    expect(getWasmText(text.length)).toBe(text);

    // Root must NOT be zeroed, and diagnostics should capture the syntax error
    const errorDiags = activeFacade.getDiagnostics(root);
    expect(errorDiags.length).toBeGreaterThan(0);

    // Repair the syntax error: delete " @#$%"
    text = "Real x;\n";
    root = activeFacade.parseIncremental("", editOffset, errorInsertion.length, text.length, docUri);
    expect(root).toBeGreaterThan(0);
    expect(getWasmText(text.length)).toBe(text);

    // Diagnostics should now be completely clean
    const repairedDiags = activeFacade.getDiagnostics(root);
    expect(repairedDiags).toEqual([]);
  });

  it("should apply parseIncrementalBatch sequentially and preserve exact text buffer", () => {
    const docUri = "file:///workspace/batch.dsl";
    const text = "Real a;\nReal b;\nReal c;\n";
    const initialRoot = activeFacade.parse(text, 0, 0, 0, docUri);
    expect(initialRoot).toBeGreaterThan(0);
    expect(getWasmText(text.length)).toBe(text);

    // Perform two sequential edits within a batch:
    // 1) Replace 'a' with 'alpha' at offset 5 (length 1) -> delta +4
    // 2) Replace 'b' with 'beta' at offset 13 + 4 (length 1)
    const edits = [
      { text: "alpha", rangeOffset: 5, rangeLength: 1 },
      { text: "beta", rangeOffset: 13 + 4, rangeLength: 1 },
    ];
    const expectedText = "Real alpha;\nReal beta;\nReal c;\n";
    const root = activeFacade.parseIncrementalBatch(edits, expectedText.length, docUri);
    expect(root).toBeGreaterThan(0);
    expect(getWasmText(expectedText.length)).toBe(expectedText);

    const diags = activeFacade.getDiagnostics(root);
    expect(diags).toEqual([]);
  });

  it("should withstand 50+ continuous edits without detached memory errors", () => {
    const docUri = "file:///workspace/continuous.dsl";
    let text = "Real x = 0;\n";
    const initialRoot = activeFacade.parse(text, 0, 0, 0, docUri);
    expect(initialRoot).toBeGreaterThan(0);

    for (let step = 1; step <= 50; step++) {
      const numStr = `${step}`;
      const prevStr = `${step - 1}`;
      const offset = 9; // offset of number in "Real x = "
      text = `Real x = ${numStr};\n`;
      const root = activeFacade.parseIncremental(numStr, offset, prevStr.length, text.length, docUri);
      expect(root).toBeGreaterThan(0);
      expect(getWasmText(text.length)).toBe(text);
      const diags = activeFacade.getDiagnostics(root);
      expect(diags).toEqual([]);
    }
  });
});
