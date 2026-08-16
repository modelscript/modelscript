import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "StubCacheTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  extras: ($: any) => [/\s+/],
});

describe("Gap 1: Persistent On-Disk Binary Stub Cache Tests", () => {
  let facade1: any;
  let facade2: any;
  let wasmModule: any;
  let tmpDir: string;
  let getFacadeFn: any;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_stub_cache");
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
    wasmModule = await WebAssembly.compile(wasm);

    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + `\nreturn { LspFacade };`;
    getFacadeFn = new Function(wrapperSrc);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      const imports = {
        env: { memory, abort: () => {} },
        JavaScript: { debugLog: () => {}, logNode: () => {} },
        engine: { debugLog: () => {} },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      };
      const instance = await WebAssembly.instantiate(wasmModule, imports);
      const { LspFacade } = getFacadeFn();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade1 = await createInstance();
    facade2 = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should export stub store to binary snapshot and restore in a clean instance", () => {
    facade1.clearStubs();

    // Register 100 virtual files with stubs
    for (let f = 1; f <= 100; f++) {
      facade1.registerStub(f, 1, 0, 1, 0, `Engine_${f}`, 0, 50);
      facade1.registerStub(f, 2, 1, 2, 0, `rpm_${f}`, 10, 20);
    }

    expect(facade1.getStubCount()).toBe(200);

    // Export binary snapshot
    const snapshot = facade1.exportStubBinary();
    expect(snapshot.byteLength).toBeGreaterThan(32);

    // Verify initial clean state in instance 2
    facade2.clearStubs();
    expect(facade2.getStubCount()).toBe(0);

    // Import binary snapshot into instance 2
    const success = facade2.importStubBinary(snapshot);
    expect(success).toBe(true);
    expect(facade2.getStubCount()).toBe(200);

    // Fast O(1) definition lookups in instance 2
    const matches = facade2.findStubsByName("Engine_42");
    expect(matches.length).toBe(1);
    expect(matches[0].fileId).toBe(42);
  });
});
