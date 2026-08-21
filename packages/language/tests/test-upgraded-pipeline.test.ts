import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Define Language DSL with 4-Stage Hybrid Pipeline Configuration
const upgradedPipelineDsl = language({
  name: "UpgradedPipelineTest",
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
        tearing: "minimum_degree",
        groebnerPreReduction: true,
        warmStart: true,
        homotopy: true,
        dualAD: true,
        isolationMethods: [
          "explicit",
          "linear",
          "quadratic",
          "harmonic",
          "lambertW",
          "treePeeling",
          "fixedPoint",
          "groebner",
        ],
      }),
    }),
  },
});

describe("Upgraded 4-Stage Zero-GC Hybrid Pipeline & Full Symbolic Isolation", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(upgradedPipelineDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_upgraded_pipeline");
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

  it("should compile AssemblyScript WASM module with isolation.ts and runtime routines", () => {
    expect(wasmExports.isolateExplicit).toBeDefined();
    expect(wasmExports.isolateLinear).toBeDefined();
    expect(wasmExports.isolateQuadratic).toBeDefined();
    expect(wasmExports.isolateQuadraticBranch).toBeDefined();
    expect(wasmExports.isolateHarmonic).toBeDefined();
    expect(wasmExports.isolateLambertW).toBeDefined();
    expect(wasmExports.isolateTreePeelTrig).toBeDefined();
    expect(wasmExports.isolateFixedPoint).toBeDefined();
    expect(wasmExports.isolateGroebnerTriangularized).toBeDefined();
  });

  it("should solve linear isolation (2x + 10 = 0 -> x = -5)", () => {
    const x = wasmExports.isolateLinear(2.0, 10.0);
    expect(x).toBe(-5.0);
  });

  it("should solve quadratic isolation with dual root branches and Citardauq stability", () => {
    // x^2 - 5x + 6 = 0 -> roots are 3 and 2
    const xDefault = wasmExports.isolateQuadratic(1.0, -5.0, 6.0);
    expect(xDefault).toBe(3.0);

    const xPrimary = wasmExports.isolateQuadraticBranch(1.0, -5.0, 6.0, 1.0);
    expect(xPrimary).toBe(3.0);

    const xSecondary = wasmExports.isolateQuadraticBranch(1.0, -5.0, 6.0, -1.0);
    expect(xSecondary).toBe(2.0);

    // Citardauq cancellation test: x^2 + 1e8 * x + 1 = 0 -> x1 ≈ -1e-8
    const xStable = wasmExports.isolateQuadratic(1.0, 1e8, 1.0);
    expect(xStable).toBeCloseTo(-1e-8, 12);
  });

  it("should solve harmonic isolation (sin(x) = 0 -> x = 0)", () => {
    const x = wasmExports.isolateHarmonic(1.0, 0.0, 0.0);
    expect(Math.abs(x)).toBeLessThan(1e-6);
  });

  it("should solve Lambert W isolation (x * e^x = 1 -> x ≈ 0.567143)", () => {
    const x = wasmExports.isolateLambertW(1.0, 1.0, -1.0);
    expect(x).toBeCloseTo(0.567143, 4);
  });

  it("should solve tree peeling function inverses with domain guards (sin, exp, sqrt, acosh, atanh)", () => {
    // asin(0.5) ≈ 0.523598
    const asinVal = wasmExports.isolateTreePeelTrig(1, 0.5);
    expect(asinVal).toBeCloseTo(Math.asin(0.5), 5);

    // log(e^2) = 2
    const logVal = wasmExports.isolateTreePeelTrig(7, Math.E);
    expect(logVal).toBeCloseTo(1.0, 5);

    // sqrt(4)^2 = 16
    const sqrtVal = wasmExports.isolateTreePeelTrig(9, 4.0);
    expect(sqrtVal).toBe(16.0);

    // Domain protection guards
    expect(wasmExports.isolateTreePeelTrig(1, 2.5)).toBe(0.0); // asin out of domain
    expect(wasmExports.isolateTreePeelTrig(2, -1.5)).toBe(0.0); // acos out of domain
    expect(wasmExports.isolateTreePeelTrig(5, 0.5)).toBe(0.0); // acosh out of domain (< 1)
    expect(wasmExports.isolateTreePeelTrig(6, 1.5)).toBe(0.0); // atanh out of domain (>= 1)
    expect(wasmExports.isolateTreePeelTrig(7, -5.0)).toBe(0.0); // log out of domain (<= 0)
  });
});
