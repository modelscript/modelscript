import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, tggDefaultVal, tggEq, tggRule } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const polyglotTestDsl = language({
  name: "PolyglotWasmTest",
  rules: {
    Model: ($: any) => $["Item"],
    Item: () => "item",
  },
  polyglot: {
    languages: ["modelica", "sysml2"],
    rules: [
      tggRule({
        name: "ItemToComponent",
        source: ($, v) => $.Item({ name: v("itemName") }),
        target: ($, v) => $.Component({ name: v("itemName") }),
        where: (v) => [tggEq(v("itemName"), v("itemName")), tggDefaultVal(v("kind"), "model")],
      }),
    ],
  },
});

describe("AssemblyScript Correspondence Index & Polyglot Arena WASM Tests", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(polyglotTestDsl as any);
    tmpDir = path.join(__dirname, "scratch_correspondence_build");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const filePath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "pipe" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: { memory: memory, abort: () => {} },
      JavaScript: { debugLog: () => {}, logNode: () => {} },
      engine: { debugLog: () => {} },
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should have correspondence index WASM exports", () => {
    expect(wasmExports.createCorrespondenceIndex).toBeDefined();
    expect(wasmExports.corr_addLink).toBeDefined();
    expect(wasmExports.corr_findBySource).toBeDefined();
    expect(wasmExports.corr_findByTarget).toBeDefined();
    expect(wasmExports.corr_markStale).toBeDefined();
    expect(wasmExports.corr_reset).toBeDefined();
  });

  it("should perform correspondence index link and lookup operations via WASM exports", () => {
    const corrPtr = wasmExports.createCorrespondenceIndex(64);
    expect(corrPtr).toBeGreaterThan(0);

    const slot1 = wasmExports.corr_addLink(corrPtr, 101, 201, 0, 1, 10);
    const slot2 = wasmExports.corr_addLink(corrPtr, 102, 202, 1, 1, 10);

    expect(wasmExports.corr_findBySource(corrPtr, 101)).toBe(201);
    expect(wasmExports.corr_findBySource(corrPtr, 102)).toBe(202);
    expect(wasmExports.corr_findByTarget(corrPtr, 201)).toBe(101);
    expect(wasmExports.corr_findByTarget(corrPtr, 202)).toBe(102);

    expect(wasmExports.corr_findBySource(corrPtr, 999)).toBe(0);
    expect(wasmExports.corr_findByTarget(corrPtr, 999)).toBe(0);

    wasmExports.corr_markStale(corrPtr, 101);
    wasmExports.corr_reset(corrPtr);
    expect(wasmExports.corr_findBySource(corrPtr, 101)).toBe(0);
  });

  it("should have polyglot arena WASM exports", () => {
    expect(wasmExports.createPolyglotArena).toBeDefined();
  });

  it("should have TGG dispatch functions exported in WASM", () => {
    expect(wasmExports.tgg_forward_dispatch).toBeDefined();
    expect(wasmExports.tgg_backward_dispatch).toBeDefined();
    expect(wasmExports.tgg_propagate_all_stale).toBeDefined();
  });
});
