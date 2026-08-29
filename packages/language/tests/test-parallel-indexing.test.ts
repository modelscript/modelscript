import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";
import { IndexFileTask, LspWorkerPool } from "../src/workers/worker-pool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "ParallelTestLang",
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

describe("Gap 3: Multi-Threaded Parallel Indexing & Bulk Registration Tests", () => {
  let facade: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(dsl as any);
    tmpDir = path.join(__dirname, "scratch_build_parallel");
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
    const getFacadeFn = new Function(wrapperSrc);

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
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should partition workspace tasks and bulk-register worker payload chunks into main stub store", async () => {
    facade.clearStubs();

    const tasks: IndexFileTask[] = [];
    for (let i = 1; i <= 200; i++) {
      tasks.push({
        uri: `file:///workspace/Model_${i}.mo`,
        fileId: i,
        content: `model Model_${i} Real speed; end;`,
      });
    }

    const pool = new LspWorkerPool(4);
    const batches = pool.partitionTasks(tasks, 25);
    expect(batches.length).toBe(8);

    // Simulate worker parsing by constructing binary stub payloads for each batch
    const results = await pool.processBatches(batches, async (batch, batchId) => {
      const payload = new Uint32Array(batch.length * 8);
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const offset = i * 8;
        payload[offset + 0] = item.fileId;
        payload[offset + 1] = 1;
        payload[offset + 2] = 0;
        payload[offset + 3] = 1; // kind: model
        payload[offset + 4] = facade.hashString(`Model_${item.fileId}`);
        payload[offset + 5] = 0;
        payload[offset + 6] = 0;
        payload[offset + 7] = 50;
      }
      return { batchId, stubs: [], rawPayload: payload };
    });

    expect(results.length).toBe(8);

    // Merge worker binary stub payloads directly into primary WASM facade
    for (const res of results) {
      if (res.rawPayload) {
        facade.bulkRegisterStubs(res.rawPayload);
      }
    }

    expect(facade.getStubCount()).toBe(200);

    const matches = facade.findStubsByName("Model_100");
    expect(matches.length).toBe(1);
    expect(matches[0].fileId).toBe(100);
  });
});
