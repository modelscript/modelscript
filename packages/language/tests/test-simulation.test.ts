import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DSL with Continuous Simulation Domain
const simulationDsl = language({
  name: "SimulationTestLang",
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
        warmStart: true,
        dualAD: true,
      }),
    }),
  },
});

describe("Continuous DAE Simulation Engine", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(simulationDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_simulation");
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

  it("should compile WASM module with simulation step functions", () => {
    expect(wasmExports.dae_createBuilder).toBeDefined();
    expect(wasmExports.stepEuler).toBeDefined();
    expect(wasmExports.stepRK4).toBeDefined();
    expect(wasmExports.stepDAE).toBeDefined();
    expect(wasmExports.runSimulationLoop).toBeDefined();
  });

  it("should execute time stepping simulation loop in WebAssembly linear memory", () => {
    const daePtr = wasmExports.dae_createBuilder();
    expect(daePtr).toBeGreaterThan(0);

    // Allocate array for variable state vector (e.g. 16 f64 vars = 128 bytes)
    const varValuesPtr = wasmExports.__new(128, 1);
    expect(varValuesPtr).toBeGreaterThan(0);

    // Execute simulation loop (10 steps from t=0.0 to t=1.0, dt=0.1)
    const totalSteps = wasmExports.runSimulationLoop(daePtr, varValuesPtr, 0.0, 1.0, 0.1);
    expect(totalSteps).toBe(10);
  });
});
