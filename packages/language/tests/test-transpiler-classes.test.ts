import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser, language } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("First-Class DSL Custom Classes & Functions Transpilation", () => {
  const tmpDir = path.join(__dirname, "scratch_build_transpiler_classes");

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    // keep tmpDir for inspection
  });

  it("should transpile TypeScript class into @unmanaged AS class and compile to WASM", async () => {
    class CustomCalculator {
      factor: number;

      init(factor: number): void {
        this.factor = factor;
      }

      compute(a: number, b: number): number {
        return (a + b) * this.factor;
      }
    }

    function addThree(a: number, b: number, c: number): number {
      return a + b + c;
    }

    const testLang = language({
      name: "CalcLang",
      classes: [CustomCalculator],
      functions: [addThree],
      rules: {
        Program: ($) => $.Num,
        Num: ($) => /[0-9]+/,
      },
    });

    const build = buildParser(testLang as any);
    const customRuntimeFile = build.assemblyScriptFiles.find((f: any) => f.filename === "custom_runtime.ts");

    expect(customRuntimeFile).toBeDefined();
    expect(customRuntimeFile?.content).toContain("@unmanaged");
    expect(customRuntimeFile?.content).toContain("export class CustomCalculator");
    expect(customRuntimeFile?.content).toContain("export function addThree");

    // Write virtual files to scratch directory
    for (const f of build.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content, "utf-8");
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    expect(fs.existsSync(outWasm)).toBe(true);

    const wasmBuffer = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasmBuffer);

    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: any, file: any, line: any, col: any) => {
          console.error(`WASM abort: ${msg} at ${file}:${line}:${col}`);
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
      parser: {
        logInt: () => {},
      },
      recovery: {},
      host: {
        runHostQuery: () => {},
      },
    };

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    const wasmExports: any = instance.exports;
    expect(wasmExports.addThree(10, 20, 30)).toBe(60);
  }, 60000);
});
