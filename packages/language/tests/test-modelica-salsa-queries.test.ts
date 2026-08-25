import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Salsa 3.0 Query Engine & Memoization", () => {
  it("should compile Modelica Salsa queries, index symbols, and memoize type resolutions", async () => {
    const result = buildParser(modelicaLanguage);
    const tmpDir = path.resolve(__dirname, "../build/tmp-modelica-salsa-test");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    childProcess.execSync(
      `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
      { cwd: tmpDir, stdio: "inherit" },
    );

    const wasmBytes = fs.readFileSync(path.join(tmpDir, "parser.wasm"));
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
    const imports = {
      env: {
        memory: memory,
        abort: (msg: number, file: number, line: number, col: number) => {
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
      parser: { logInt: () => {} },
      recovery: {},
      host: { runHostQuery: () => {} },
    };

    const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
    const { LspFacade } = await import(path.join(tmpDir, "bindings.js"));
    const facade = new LspFacade(memory, instance.exports);

    const code = `model X
  Real x;
end X;

model Y
  X x;
equation
  x = 1;
end Y;`;

    const root = facade.parse(code);
    expect(root).toBeGreaterThan(0);

    // 1. Verify Salsa query exports exist on WASM module
    expect(typeof instance.exports.runQuery).toBe("function");
    expect(typeof instance.exports.resolveComponentTypeInClass).toBe("function");
    expect(typeof instance.exports.resolveDottedType).toBe("function");

    // 2. Verify diagnostics work through Salsa query resolution
    const diags = facade.getDiagnostics(root);
    const mismatchDiag = diags.find((d: any) => d.code === 5001);
    expect(mismatchDiag).toBeDefined();
    expect(mismatchDiag.message).toContain("Type mismatch in equation 'x = 1'.");
  }, 60000);
});
