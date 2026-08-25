import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeTier3DSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("Tier 3: WASM DAE Homotopy Continuation, Delay Operators, Stream Connectors & FMI 3.0 WebGPU", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_tier3");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }
    fs.writeFileSync(path.join(tmpDir, "bindings.js"), result.javascriptWrapper.js);

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --optimize --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (err: any) {
      if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
      if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
      throw err;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);
    const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });

    const imports = {
      env: {
        memory: memory,
        abort: () => console.log("ABORT!"),
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

    const instance = await WebAssembly.instantiate(wasmModule, imports);
    wasmExports = instance.exports;
  }, 120000);

  // afterAll(() => {
  //   if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  // });

  it("should solve non-linear systems via Natural Parameter Homotopy Continuation", () => {
    const b = wasmExports.dae_createBuilder();

    // Variable x: 1 variable
    const xVar = wasmExports.dae_addVariable(b, 0x1, 0, 0, 0, 1.0, 0);
    const eX = wasmExports.dae_addName(b, xVar);

    // Non-linear equation: x^2 - 4.0 = 0 (Roots: +2, -2)
    const two = wasmExports.dae_addRealLiteral(b, 2.0);
    const four = wasmExports.dae_addRealLiteral(b, 4.0);
    const xSquared = wasmExports.dae_addBinaryExpr(b, 5, eX, two); // pow(x, 2)
    const eq0 = wasmExports.dae_addEquation(b, 0, xSquared, four, 0);

    const solver = wasmExports.dae_createHomotopySolver(b, 1, 1e-6);
    expect(solver).toBeGreaterThan(0);

    const varValues = wasmExports.atomicChunkAlloc(16);
    wasmExports.dae_setMemF64(varValues, 1.0); // Initial simplified starting point

    const converged = wasmExports.dae_solveHomotopy(solver, varValues, 50);
    expect(Boolean(converged)).toBe(true);

    const rootVal = wasmExports.dae_getMemF64(varValues);
    expect(Math.abs(rootVal - 2.0)).toBeLessThan(1e-3);
  });

  it("should interpolate historical delay(expr, tau) and 1D spatial distributions using ring-buffer", () => {
    const capacity = 32;
    const buf = wasmExports.dae_createDelayBuffer(capacity);
    expect(buf).toBeGreaterThan(0);

    // Push time series samples: y(t) = 2.0 * t
    for (let i = 0; i <= 10; i++) {
      const t = i * 0.1;
      const val = 2.0 * t;
      const der = 2.0;
      wasmExports.dae_pushDelaySample(buf, t, val, der);
    }

    // Evaluate delay at t = 1.0 with tau = 0.35 -> target t = 0.65 -> expected y = 1.30
    const delayedVal = wasmExports.dae_evalDelay(buf, 1.0, 0.35);
    expect(Math.abs(delayedVal - 1.3)).toBeLessThan(1e-4);

    // Evaluate spatialDistribution(in0=10.0, in1=20.0, x=0.5, isPositive=true)
    const spatialVal = wasmExports.dae_evalSpatialDistribution(buf, 10.0, 20.0, 0.5, true);
    expect(Number.isFinite(spatialVal)).toBe(true);
  });

  it("should execute FMI 3.0 Standardized C-API and dispatch zero-copy GPU buffers", () => {
    const b = wasmExports.dae_createBuilder();

    // 2 state variables: position and velocity
    const posVar = wasmExports.dae_addVariable(b, 0x10, 0, 0, 0, 5.0, 8); // FLAG_VAR_STATE = 1 << 3 = 8
    const velVar = wasmExports.dae_addVariable(b, 0x20, 0, 0, 0, 2.0, 8); // FLAG_VAR_STATE = 1 << 3 = 8

    const fmu = wasmExports.fmi3InstantiateCoSimulation(b);
    expect(fmu).toBeGreaterThan(0);

    // Initialization Mode
    const initStatus = wasmExports.fmi3EnterInitializationMode(fmu, 1e-6, 0.0, 10.0);
    expect(initStatus).toBe(0); // FMI3_OK

    const exitInitStatus = wasmExports.fmi3ExitInitializationMode(fmu);
    expect(exitInitStatus).toBe(0);

    // Continuous states inspection
    const statesOut = wasmExports.atomicChunkAlloc(16);
    wasmExports.fmi3GetContinuousStates(fmu, statesOut, 2);
    const pos0 = wasmExports.dae_getMemF64(statesOut + 0);
    const vel0 = wasmExports.dae_getMemF64(statesOut + 8);
    expect(pos0).toBe(5.0);
    expect(vel0).toBe(2.0);

    // Step FMU via Co-Simulation
    const stepStatus = wasmExports.fmi3DoStep(fmu, 0.0, 0.01, false);
    expect(stepStatus).toBe(0);

    // Zero-Copy WebGPU Buffer Dispatch
    const gpuPtr = wasmExports.fmi3GetGpuBufferPointer(fmu);
    const gpuByteLen = wasmExports.fmi3GetGpuBufferByteLength(fmu);
    expect(gpuPtr).toBeGreaterThan(0);
    expect(gpuByteLen).toBeGreaterThanOrEqual(16);

    // Direct WebGPU staging buffer view
    const gpuBufferView = new Float64Array(wasmExports.memory.buffer, gpuPtr, gpuByteLen / 8);
    expect(gpuBufferView.length).toBeGreaterThanOrEqual(2);
  });

  it("should flatten fluid stream connectors and generate upstream mixing equations", () => {
    const b = wasmExports.dae_createBuilder();
    const flattener = wasmExports.flattener_create(b);
    expect(flattener).toBeGreaterThan(0);

    // 2 fluid ports: port1 (h1, mdot1), port2 (h2, mdot2)
    const h1 = wasmExports.dae_addVariable(b, 0x101, 0, 0, 0, 300.0, 0);
    const mdot1 = wasmExports.dae_addVariable(b, 0x102, 0, 0, 0, 1.5, 0);
    const h2 = wasmExports.dae_addVariable(b, 0x201, 0, 0, 0, 350.0, 0);
    const mdot2 = wasmExports.dae_addVariable(b, 0x202, 0, 0, 0, -1.5, 0);

    const connIdx = wasmExports.flattener_addStreamConnection(flattener, h1, mdot1, h2, mdot2);
    expect(connIdx).toBeGreaterThanOrEqual(0);

    const busVar = wasmExports.dae_addVariable(b, 0x300, 0, 0, 0, 0.0, 0);
    const memberVar = wasmExports.flattener_expandConnector(flattener, busVar, 0xabc, 0);
    expect(memberVar).toBeGreaterThanOrEqual(0);
  });
});
