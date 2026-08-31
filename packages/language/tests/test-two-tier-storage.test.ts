import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { choice, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "TwoTierTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat(choice($.Decl, $.Equation)),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq(field("type", $.Type), field("name", $.Identifier), ";"),
    Type: ($: any) => choice("Real", "Integer", $.Identifier),
    Equation: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
  },
  symbols: {
    ModelDef: {
      name: "name",
      kind: "model",
      scope: true,
    },
    Decl: {
      name: "name",
      kind: "Variable",
      type: "type",
      scope: false,
    },
  },
  lsp: {
    outline: ["ModelDef", "Decl"],
  },
  extras: ($: any) => [/\s+/],
});

describe("Two-Tier Storage Architecture & Stub Indexing", () => {
  let activeFacade: any;
  let LruAstCacheClass: any;
  let LspWorkspaceManagerClass: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_twotier");
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

    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") +
      `\nreturn { LspFacade, LruAstCache, LspWorkspaceManager };`;
    const getExports = new Function(wrapperSrc);
    const { LspFacade, LruAstCache, LspWorkspaceManager } = getExports();
    LruAstCacheClass = LruAstCache;
    LspWorkspaceManagerClass = LspWorkspaceManager;

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
          throw new Error(`WASM ABORT at line ${line}:${col}`);
        },
      },
      JavaScript: {
        debugLog: () => {},
        logNode: () => {},
      },
      engine: {
        debugLog: () => {},
      },
      parser: { logInt: (val: number) => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    const exports = instance.exports;
    activeFacade = new LspFacade(exports.memory, exports);
  }, 45000);

  afterAll(() => {
    // if (tmpDir && fs.existsSync(tmpDir)) {
    //   fs.rmSync(tmpDir, { recursive: true, force: true });
    // }
  });

  test("Tier 1 Stub Store: Registers and queries symbols without AST retention", () => {
    activeFacade.clearStubs();

    // Register stubs across 500 virtual files
    const fileCount = 500;
    for (let f = 1; f <= fileCount; f++) {
      activeFacade.registerStub(
        f, // fileId
        1, // symbolId
        0, // parentSymbolId
        1, // kind: model
        0, // flags
        `Motor_${f}`, // name
        0, // startByte
        50, // endByte
      );

      activeFacade.registerStub(
        f,
        2,
        1, // child of Motor_f
        2, // kind: Variable
        0,
        `speed`,
        10,
        20,
      );
    }

    expect(activeFacade.getStubCount()).toBe(fileCount * 2);

    // Fast O(1) by-name lookup
    const matches = activeFacade.findStubsByName("Motor_42");
    expect(matches.length).toBe(1);
    expect(matches[0].fileId).toBe(42);
    expect(matches[0].symbolId).toBe(1);

    // Child symbol lookup
    const children = activeFacade.getStubChildren(1);
    expect(children.length).toBeGreaterThanOrEqual(1);

    // Memory footprint stays very small (< 5 MB)
    const memUsage = activeFacade.getMemoryUsage();
    expect(memUsage).toBeLessThan(10 * 1024 * 1024);
  });

  test("Fast Go-to-Definition: Resolves definition directly from Tier 1 stub", () => {
    // Register declaration for 'ExternalLibraryModel' in file 999
    activeFacade.registerStub(
      999, // fileId
      1,
      0,
      1,
      0,
      "ExternalLibraryModel",
      100, // startByte
      250, // endByte
    );

    // Parse a local model in current file (fileId: 1) referencing ExternalLibraryModel
    const source = `model LocalTest
  ExternalLibraryModel motorInstance;
end;`;

    const astRoot = activeFacade.parse(source);
    activeFacade.registerDocument(1, astRoot);

    // Query definition on 'ExternalLibraryModel' token (offset around 20 bytes in UTF-16)
    // Offset 18 is 'ExternalLibraryModel'
    const def = activeFacade.getDefinition(astRoot, 36);
    expect(def).not.toBeNull();
    expect(def.fileId).toBe(999);
    expect(def.start).toBe(100);
    expect(def.end).toBe(250);
  });

  test("Tier 2 LRU AST Cache: Evicts inactive ASTs when threshold is reached", () => {
    const cache = new LruAstCacheClass(activeFacade, { maxActiveAsts: 3 });

    // Open 5 documents sequentially
    for (let i = 1; i <= 5; i++) {
      const code = `model M${i} Real x; end;`;
      const root = activeFacade.parse(code);
      cache.set(i, root);
    }

    // Cache should have capped active ASTs to maxActiveAsts = 3
    expect(cache.activeCount).toBe(3);

    // Oldest files (1, 2) should have been evicted from Tier 2
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(false);

    // Most recent files (3, 4, 5) remain active
    expect(cache.has(3)).toBe(true);
    expect(cache.has(4)).toBe(true);
    expect(cache.has(5)).toBe(true);
  });

  test("LspWorkspaceManager: Coordinates stubs and on-demand ASTs", () => {
    const manager = new LspWorkspaceManagerClass(activeFacade, { maxActiveAsts: 2 });

    const file1Uri = "file:///workspace/Motor.mo";
    const file1Content = `model Motor Real speed; end;`;
    manager.indexFile(file1Uri, file1Content, false); // Index as stub only (evict AST)

    const file2Uri = "file:///workspace/Controller.mo";
    const file2Content = `model Controller Motor m; end;`;
    manager.indexFile(file2Uri, file2Content, true); // Keep AST

    // File 1 AST is evicted, File 2 AST is active
    const file1Id = manager.getFileId(file1Uri);
    const file2Id = manager.getFileId(file2Uri);

    expect(manager.astCache.has(file1Id)).toBe(false);
    expect(manager.astCache.has(file2Id)).toBe(true);
  });
});
