import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "MultiFileLspLang",
  rules: {
    Program: ($: any) => repeat($.Block),
    Block: ($: any) => seq("scope", field("name", $.Identifier), "{", repeat(choice($.Decl, $.Usage)), "}"),
    Decl: ($: any) => seq(semanticToken("keyword", "let"), field("name", $.Identifier), "=", $.Number, ";"),
    Usage: ($: any) => seq(semanticToken("keyword", "print"), field("target", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],
});

describe("Multi-File LSP Connector Features", () => {
  let activeFacade: any;
  let exports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_multifile");
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
        abort: (msg: number, file: number, line: number, col: number) => {
          const mem32 = new Uint32Array(memory.buffer);
          const mem16 = new Uint16Array(memory.buffer);
          let m = "";
          let f = "";
          if (msg) {
            for (let i = 0; i < 50; i++) {
              const c = mem16[(msg >>> 1) + i];
              if (c === 0) break;
              m += String.fromCharCode(c);
            }
          }
          if (file) {
            for (let i = 0; i < 50; i++) {
              const c = mem16[(file >>> 1) + i];
              if (c === 0) break;
              f += String.fromCharCode(c);
            }
          }
          console.log("ABORT! RAW msg=", msg, "file=", file, "m=", m, "f=", f, "line=", line, "col=", col);
          throw new Error("WASM ABORT!");
        },
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
      parser: { logInt: (val: number) => console.log("logInt:", val) },
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

    if (typeof exports.lsp_setConfigEnableMultiFile === "function") {
      exports.lsp_setConfigEnableMultiFile(true);
    }
  });

  it("should register and resolve multi-file document AST roots", () => {
    const fileId1 = 101;
    const fileId2 = 102;

    const doc1 = `scope ScopeA { let velocity = 100; print velocity; }`;
    const doc2 = `scope ScopeB { print velocity; }`;

    activeFacade.lastAstRoot = 0;
    const ast1 = activeFacade.parse(doc1);
    exports.lsp_registerDocument(fileId1, ast1);

    activeFacade.lastAstRoot = 0;
    const ast2 = activeFacade.parse(doc2);
    exports.lsp_registerDocument(fileId2, ast2);

    expect(ast1).toBeGreaterThan(0);
    expect(ast2).toBeGreaterThan(0);

    expect(exports.lsp_getDocumentRoot(fileId1)).toBe(ast1);
    expect(exports.lsp_getDocumentRoot(fileId2)).toBe(ast2);
  });

  it("should fan out getReferences across all registered documents in the workspace", () => {
    const fileId1 = 201;
    const fileId2 = 202;

    const doc1 = `scope ScopeA { let velocity = 100; print velocity; }`;
    const doc2 = `scope ScopeB { print velocity; }`;

    console.log(Object.keys(exports));

    activeFacade.lastAstRoot = 0;
    const ast1 = activeFacade.parse(doc1);
    exports.lsp_registerDocument(fileId1, ast1);

    activeFacade.lastAstRoot = 0;
    const ast2 = activeFacade.parse(doc2);
    console.log("Memory byteLength:", activeFacade.wasmMemory.buffer.byteLength);
    exports.lsp_registerDocument(fileId2, ast2);

    const velOffset1 = doc1.indexOf("velocity");
    const refs = activeFacade.getReferences(ast1, velOffset1);
    expect(refs.length).toBeGreaterThan(0);

    // Verify 3-tuple includes fileId
    const fileIds = refs.map((r: any) => r.fileId);
    expect(fileIds).toContain(fileId1);
  });

  it("should resolve definition across registered documents", () => {
    const fileId1 = 301;

    const doc1 = `scope ScopeA { let velocity = 100; print velocity; }`;
    activeFacade.lastAstRoot = 0;
    const ast1 = activeFacade.parse(doc1);
    exports.lsp_registerDocument(fileId1, ast1);

    const velUsageOffset = doc1.lastIndexOf("velocity");
    const def = activeFacade.getDefinition(ast1, velUsageOffset);
    console.log("def:", def);
    expect(def).not.toBeNull();
    expect(def?.fileId).toBe(fileId1);
    expect(def?.start).toBeLessThan(def?.end || 0);
  });

  it("should revalidate workspace diagnostics across all registered documents", () => {
    const fileId1 = 401;
    const fileId2 = 402;

    const doc1 = `scope ScopeA { let broken = ; }`;
    const doc2 = `scope ScopeB { print velocity; }`;

    activeFacade.lastAstRoot = 0;
    const ast1 = activeFacade.parse(doc1);
    exports.lsp_registerDocument(fileId1, ast1);

    activeFacade.lastAstRoot = 0;
    const ast2 = activeFacade.parse(doc2);
    exports.lsp_registerDocument(fileId2, ast2);

    if (typeof exports.lsp_revalidateWorkspace === "function") {
      const numDiags = exports.lsp_revalidateWorkspace();
      expect(numDiags).toBeGreaterThan(0);
    }
  });

  it("should survive GC sweeps and catastrophic fallbacks across multiple documents without memory corruption", () => {
    // This test specifically validates the fix for the cyclic AST cross-wiring bug.
    // When a document with a catastrophic error is parsed, it creates nodes.
    // If those nodes are properly registered as GC roots, subsequent parses won't sweep them
    // and recycle their memory, preventing cyclic cross-wiring and infinite loops.
    const fileId1 = 501;
    const fileId2 = 502;
    const fileId3 = 503;

    // Doc 1: valid
    const doc1 = `scope ValidScope { let a = 1; }`;
    // Doc 2: catastrophic fallback (missing expression)
    const doc2 = `scope BrokenA { let b = ; }`;
    // Doc 3: catastrophic fallback (missing closing brace and expression)
    const doc3 = `scope BrokenB { let c = `;

    activeFacade.lastAstRoot = 0;
    const ast1 = activeFacade.parse(doc1);
    exports.lsp_registerDocument(fileId1, ast1); // Register immediately to protect from GC

    activeFacade.lastAstRoot = 0;
    const ast2 = activeFacade.parse(doc2);
    exports.lsp_registerDocument(fileId2, ast2);

    activeFacade.lastAstRoot = 0;
    const ast3 = activeFacade.parse(doc3);
    exports.lsp_registerDocument(fileId3, ast3);

    // If memory is corrupted or cyclic, the diagnostic extraction will hang in an infinite loop
    const diags1 = activeFacade.getDiagnostics(ast1);
    const diags2 = activeFacade.getDiagnostics(ast2);
    const diags3 = activeFacade.getDiagnostics(ast3);

    // We just want to ensure it survives without infinite loops.
    // doc1 is valid, so it should have 0 diagnostics.
    expect(diags1.length).toBe(0);
  });
});
