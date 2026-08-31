import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/dsl/api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Array Shape Linting & Pipeline Preservation", () => {
  const tmpDir = path.resolve(__dirname, "../build/tmp-modelica-array-shape-test");
  let facade: any;
  let wasmExports: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(modelicaLanguage);
    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascBin = path.resolve(__dirname, "../../../node_modules/assemblyscript/bin/asc.js");
    try {
      childProcess.execSync(
        `node "${ascBin}" parser.ts -O0 --enable threads --sharedMemory --runtime stub --exportRuntime --importMemory --maximumMemory 16384 --outFile parser.wasm`,
        { cwd: tmpDir, stdio: "pipe" },
      );
    } catch (e: any) {
      console.error("ASC STDOUT:", e.stdout?.toString());
      console.error("ASC STDERR:", e.stderr?.toString());
      throw e;
    }

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
    wasmExports = instance.exports;
    const { LspFacade } = await import(path.join(tmpDir, "bindings.js"));
    facade = new LspFacade(memory, instance.exports);
  }, 180000);

  describe("Linter: Array Shape Mismatch (M4003)", () => {
    it("should flag array shape mismatch 4003 when initializing Real x[9] with {8}", () => {
      const code = `model X
  Real x[9] = {8};
end X;`;

      const root = facade.parse(code);
      const diags = facade.getDiagnostics(root);

      const shapeDiag = diags.find((d: any) => d.code === 4003);
      expect(shapeDiag).toBeDefined();
      expect(shapeDiag.message).toContain("Array shape mismatch");
    });

    it("should not flag 4003 when array initializer count matches declared dimension", () => {
      const code = `model X
  Real x[3] = {1.0, 2.0, 3.0};
end X;`;

      const root = facade.parse(code);
      const diags = facade.getDiagnostics(root);

      const shapeDiag = diags.find((d: any) => d.code === 4003);
      expect(shapeDiag).toBeUndefined();
    });
  });

  describe("Flattening Pipeline: Array Shape Preservation", () => {
    it("should preserve array dimensions in graph.dae without unrolling into separate scalar entries", () => {
      const code = `model X
  Real x[9] = {1, 2, 3, 4, 5, 6, 7, 8, 9};
end X;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      // Exactly 1 variable emitted (kept as structured array tensor)
      expect(daeData.varCount).toBe(1);
      expect(daeData.variables[0].dimensions).toEqual([9]);
      expect(daeData.flatText).toContain("Real x[9];");
    });

    it("should lower arithmetic equations preserving operators and literals (e.g. x = 1 + x)", () => {
      const code = `model X
  Real x;
equation
  x = 1+x;
end X;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      expect(daeData.equations.length).toBe(1);
      expect(daeData.equations[0].text).toBe("x = 1 + x");
      expect(daeData.flatText).toContain("x = 1 + x;");
    });

    it("should lower derivative and unary negative equations", () => {
      const code = `model Spring
  Real x;
  Real v;
equation
  der(x) = v;
  der(v) = -10 * x;
end Spring;`;

      const root = facade.parse(code);
      const daeData = facade.executePipeline(root, "flatten");

      expect(daeData.equations.length).toBe(2);
      expect(daeData.flatText).toContain("der(x) = v;");
      expect(daeData.flatText).toContain("der(v) = -10 * x;");
    });
  });
});
