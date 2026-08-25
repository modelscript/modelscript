import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeStiffDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("WASM Stiff & Adaptive DAE Integrators", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_stiff");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

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

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should integrate stiff decay system using Radau IIA L-stable implicit Runge-Kutta", () => {
    const b = wasmExports.dae_createBuilder();

    // Stiff Decay: der(y) = -100.0 * y, y(0) = 1.0
    // Analytical solution: y(t) = exp(-100.0 * t)
    const varY = wasmExports.dae_addVariable(b, 10, 0, 0, 0, 1.0, 0);
    const derYExpr = wasmExports.dae_addDer(b, varY);

    const minusHundred = wasmExports.dae_addRealLiteral(b, -100.0);
    const exprY = wasmExports.dae_addExpression(b, 0, varY);
    const rhs = wasmExports.dae_addExpression(b, 5, 2, minusHundred, exprY); // BinOp.Mul = 2

    wasmExports.dae_addEquation(b, 0, derYExpr, rhs, 0);

    const varValuesPtr = wasmExports.atomicChunkAlloc(8);
    const stageYPtr = wasmExports.atomicChunkAlloc(64);
    const scratchPtr = wasmExports.atomicChunkAlloc(512);

    const memF64 = new Float64Array(wasmExports.memory.buffer);
    memF64[varValuesPtr >> 3] = 1.0;

    // Take large step dt = 0.05 (explicit Euler would diverge wildly with dt*lambda = -5.0)
    const dt = 0.05;
    const success = wasmExports.sim_stepRadauIIA(b, varValuesPtr, stageYPtr, scratchPtr, dt);
    expect(success).toBeTruthy();

    const yVal = memF64[varValuesPtr >> 3];
    // Exact Radau IIA (Order 3) analytical solution: R(-5) = -4/51 ~= -0.07843137
    expect(Math.abs(yVal)).toBeLessThan(0.1);
    expect(yVal).toBeCloseTo(-4.0 / 51.0, 5);
  });

  it("should superlinearly localize zero-crossing events with Brent-Dekker hybrid solver", () => {
    const b = wasmExports.dae_createBuilder();

    // Variable t
    const varT = wasmExports.dae_addVariable(b, 20, 0, 0, 0, 0.0, 0);
    const exprT = wasmExports.dae_addName(b, varT);

    // ZCF: t - 2.7182818 = 0
    const targetVal = wasmExports.dae_addRealLiteral(b, 2.7182818);
    const zcfExpr = wasmExports.dae_addBinaryExpr(b, 1, exprT, targetVal); // BinOp.Sub = 1

    const detector = wasmExports.event_createDetector(b);
    const zcfIdx = wasmExports.event_addZcf(detector, zcfExpr, -2.7182818, 1);

    const startValues = wasmExports.atomicChunkAlloc(8);
    const endValues = wasmExports.atomicChunkAlloc(8);
    const interpValues = wasmExports.atomicChunkAlloc(8);

    wasmExports.dae_setMemF64(startValues, 1.0); // t = 1.0 (zcf = 1.0 - 2.71828 = -1.71828)
    wasmExports.dae_setMemF64(endValues, 4.0); // t = 4.0 (zcf = 4.0 - 2.71828 = +1.28172)

    const tEvent = wasmExports.event_localizeBrent(
      detector,
      zcfIdx,
      startValues,
      endValues,
      interpValues,
      1.0,
      4.0,
      1e-10,
    );

    expect(tEvent).toBeCloseTo(2.7182818, 6);
  });

  it("should evaluate expression directly", () => {
    const b = wasmExports.dae_createBuilder();
    const varT = wasmExports.dae_addVariable(b, 20, 0, 0, 0, 0.0, 0);
    const exprT = wasmExports.dae_addName(b, varT);
    const targetVal = wasmExports.dae_addRealLiteral(b, 2.7182818);
    const zcfExpr = wasmExports.dae_addBinaryExpr(b, 1, exprT, targetVal);

    const buf = wasmExports.atomicChunkAlloc(8);
    wasmExports.dae_setMemF64(buf, 1.0);

    const valT = wasmExports.dae_evalExpr(b, exprT, buf);
    const valConst = wasmExports.dae_evalExpr(b, targetVal, buf);
    const valZcf = wasmExports.dae_evalExpr(b, zcfExpr, buf);

    expect(valT).toBeCloseTo(1.0, 6);
    expect(valConst).toBeCloseTo(2.7182818, 6);
    expect(valZcf).toBeCloseTo(-1.7182818, 6);
  });

  it("should compute smooth dense output trajectory using cubic Hermite interpolation", () => {
    const y0Ptr = wasmExports.atomicChunkAlloc(8);
    const y1Ptr = wasmExports.atomicChunkAlloc(8);
    const k1Ptr = wasmExports.atomicChunkAlloc(8);
    const k7Ptr = wasmExports.atomicChunkAlloc(8);
    const outPtr = wasmExports.atomicChunkAlloc(8);

    const memF64 = new Float64Array(wasmExports.memory.buffer);
    memF64[y0Ptr >> 3] = 0.0;
    memF64[y1Ptr >> 3] = 1.0;
    memF64[k1Ptr >> 3] = 1.0; // dy/dt at t0
    memF64[k7Ptr >> 3] = 1.0; // dy/dt at t1

    // Midpoint theta = 0.5 with linear trajectory -> y(0.5) = 0.5
    wasmExports.sim_interpolateDenseOutput(y0Ptr, y1Ptr, k1Ptr, k7Ptr, 1.0, 0.5, 1, outPtr);
    const midVal = memF64[outPtr >> 3];
    expect(midVal).toBeCloseTo(0.5, 6);
  });
});
