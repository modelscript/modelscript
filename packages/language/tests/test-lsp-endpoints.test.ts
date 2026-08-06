import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "LspTestLang",
  rules: {
    Program: ($: any) => repeat($.Block),
    Block: ($: any) => seq("scope", "{", repeat(choice($.Decl, $.Usage)), "}"),
    Decl: ($: any) => seq(semanticToken("keyword", "let"), field("name", $.Identifier), "=", $.Number, ";"),
    Usage: ($: any) => seq(semanticToken("keyword", "print"), field("target", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
  lsp: {},
  recovery: {
    sync: ["}", ";", "print", "let"],
  },
});

describe("LSP Endpoints Integration Tests", () => {
  let activeFacade: any;
  let exports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_lsp_test");
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
    exports = instance.exports;
    activeFacade = new LspFacade(exports.memory, exports);
  }, 60000);

  beforeEach(() => {
    if (typeof exports.lsp_clearDocuments === "function") {
      exports.lsp_clearDocuments();
    }
  });

  it("should handle null astRoot (0) safely for all LSP endpoints without crash or state leakage", () => {
    expect(activeFacade.getFoldingRanges(0)).toEqual([]);
    expect(activeFacade.getDocumentSymbols(0)).toEqual([]);
    expect(activeFacade.getDefinition(0, 5)).toBeNull();
    expect(activeFacade.getReferences(0, 5)).toEqual([]);
    expect(exports.lsp_getNodeAtByteOffset(0, 5)).toBe(0);
  });

  it("should extract folding ranges for block nodes", () => {
    const code = `scope {
  let velocity = 100;
  print velocity;
}`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const foldingRanges = activeFacade.getFoldingRanges(ast);
    expect(Array.isArray(foldingRanges)).toBe(true);
  });

  it("should extract document outline symbols for grammar definitions", () => {
    const code = `scope {
  let velocity = 100;
  let mass = 50;
  print velocity;
}`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    const symbols = activeFacade.getDocumentSymbols(ast);
    expect(Array.isArray(symbols)).toBe(true);
  });

  it("should locate node at byte offset using lsp_getNodeAtByteOffset", () => {
    const code = `scope {
  let velocity = 100;
  print velocity;
}`;
    activeFacade.lastAstRoot = 0;
    const ast = activeFacade.parse(code);
    expect(ast).toBeGreaterThan(0);

    // "velocity" starts at index 14
    const nodePtr = exports.lsp_getNodeAtByteOffset(ast, 15);
    expect(nodePtr).toBeGreaterThan(0);

    // Offset out of bounds should return 0
    const oobNodePtr = exports.lsp_getNodeAtByteOffset(ast, 99999);
    expect(oobNodePtr).toBe(0);
  });

  it("should manage multi-file document registry correctly", () => {
    const fileId1 = 101;
    const fileId2 = 102;

    const code1 = `scope { let a = 1; }`;
    const code2 = `scope { let b = 2; }`;

    const ast1 = activeFacade.parse(code1);
    const ast2 = activeFacade.parse(code2);

    expect(ast1).toBeGreaterThan(0);
    expect(ast2).toBeGreaterThan(0);

    exports.lsp_registerDocument(fileId1, ast1);
    exports.lsp_registerDocument(fileId2, ast2);

    expect(exports.lsp_getDocumentRoot(fileId1)).toBe(ast1);
    expect(exports.lsp_getDocumentRoot(fileId2)).toBe(ast2);

    exports.lsp_unregisterDocument(fileId1);
    const expectedFallback =
      typeof exports.globalAstRoot === "object" ? exports.globalAstRoot.value : exports.globalAstRoot;
    expect(exports.lsp_getDocumentRoot(fileId1)).toBe(expectedFallback);
  });
});
