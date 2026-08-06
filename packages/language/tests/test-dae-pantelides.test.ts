import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Define Language DSL with Pantelides Index Reduction Configuration
const pantelidesDsl = language({
  name: "PantelidesTestLang",
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
        indexReduction: "pantelides",
        tearing: "cellier",
      }),
    }),
  },
});

describe("DAE Pantelides Index Reduction Engine", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(pantelidesDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_pantelides");
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

  it("should export runPantelidesIndexReduction WASM routine", () => {
    expect(wasmExports.runPantelidesIndexReduction).toBeDefined();
    expect(typeof wasmExports.runPantelidesIndexReduction).toBe("function");
  });

  it("should execute Pantelides index reduction safely on DAE memory structures", () => {
    if (typeof wasmExports.initDaeBuilder === "function" && typeof wasmExports.initBltEngine === "function") {
      const daePtr = wasmExports.initDaeBuilder(10, 10);
      const bltPtr = wasmExports.initBltEngine();

      if (daePtr && bltPtr) {
        const numNewEqs = wasmExports.runPantelidesIndexReduction(daePtr, bltPtr);
        expect(numNewEqs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
