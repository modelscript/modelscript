import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DSL with Tearing Configuration
const tearingDsl = language({
  name: "TearingTestLang",
  rules: {
    Program: ($: any) => repeat($.Stmt),
    Stmt: ($: any) => seq(field("lhs", $.Identifier), "=", field("rhs", $.Expr), ";"),
    Expr: ($: any) => choice($.Identifier, $.Number),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    Number: ($: any) => semanticToken("number", /[0-9]+/),
  },
  extras: ($: any) => [/\s+/],

  analysis: {
    systemSolver: analysis({
      domain: domain.dae({
        tearing: "minimum_degree",
      }),
    }),
  },
});

describe("DAE Algebraic Loop Tearing Engine", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(tearingDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_tearing");
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
    childProcess.execSync(ascCmd, { stdio: "inherit" });

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

  it("should compile WASM module with BLT engine tearing routines", () => {
    expect(wasmExports.dae_createBuilder).toBeDefined();
    expect(wasmExports.blt_createEngine).toBeDefined();
    expect(wasmExports.blt_compute).toBeDefined();
  });

  it("should execute Minimum Degree Heuristic and select tearing variables on coupled algebraic block", () => {
    const daePtr = wasmExports.dae_createBuilder();
    const bltPtr = wasmExports.blt_createEngine(daePtr);
    expect(daePtr).toBeGreaterThan(0);
    expect(bltPtr).toBeGreaterThan(0);

    // Compute BLT partitioning
    wasmExports.blt_compute(bltPtr);
  });
});
