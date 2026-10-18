// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser, language, semanticToken, seq } from "@modelscript/dsl";
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeTearingDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("WASM DaeBuilder Algebraic Loop Tearing Engine", () => {
  let wasmExports: any;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_tearing");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const file of result.assemblyScriptFiles) {
      const destPath = path.join(tmpDir, file.filename);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, file.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const [ascBin, ...ascPrefixArgs] = ascPath.startsWith("npx") ? ["npx", "asc"] : [ascPath];
    try {
      childProcess.execFileSync(
        ascBin,
        [
          ...ascPrefixArgs,
          parserTs,
          "-o",
          outWasm,
          "--exportRuntime",
          "--enable",
          "threads",
          "-O0",
          "--runtime",
          "stub",
        ],
        { stdio: "pipe" },
      );
    } catch (err: any) {
      if (err.stdout) console.error("ASC STDOUT:", err.stdout.toString());
      if (err.stderr) console.error("ASC STDERR:", err.stderr.toString());
      throw err;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);
    const memory = new WebAssembly.Memory({ initial: 128, maximum: 1024, shared: true });

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

  it("should partition a coupled non-linear system and solve via reduced residual Newton-Raphson", () => {
    const b = wasmExports.dae_createBuilder();

    // System: 2 coupled algebraic variables (x1, x2)
    // Eq 0: x1 = x2 + 3.0
    // Eq 1: x2 = 2.0 * x1 - 1.0  => x1 = (2*x1 - 1) + 3 => x1 = 2*x1 + 2 => x1 = -2, x2 = -5
    const varX1 = wasmExports.dae_addVariable(b, 101, 0, 0, 0, 0.0, 0);
    const varX2 = wasmExports.dae_addVariable(b, 102, 0, 0, 0, 0.0, 0);

    const exprX1 = wasmExports.dae_addExpression(b, 0, varX1);
    const exprX2 = wasmExports.dae_addExpression(b, 0, varX2);

    const three = wasmExports.dae_addRealLiteral(b, 3.0);
    const two = wasmExports.dae_addRealLiteral(b, 2.0);
    const one = wasmExports.dae_addRealLiteral(b, 1.0);

    // Eq 0: x1 = x2 + 3.0
    const rhs0 = wasmExports.dae_addExpression(b, 5, 0, exprX2, three); // BinOp.Add = 0
    const eq0 = wasmExports.dae_addEquation(b, 0, exprX1, rhs0, 0);

    // Eq 1: x2 = 2.0 * x1 - 1.0
    const mul2X1 = wasmExports.dae_addExpression(b, 5, 2, two, exprX1); // BinOp.Mul = 2
    const rhs1 = wasmExports.dae_addExpression(b, 5, 1, mul2X1, one); // BinOp.Sub = 1
    const eq1 = wasmExports.dae_addEquation(b, 0, exprX2, rhs1, 0);

    // Prepare indices
    const eqIndicesPtr = wasmExports.atomicChunkAlloc(8);
    const varIndicesPtr = wasmExports.atomicChunkAlloc(8);
    const mem32 = new Uint32Array(wasmExports.memory.buffer);
    mem32[eqIndicesPtr >> 2] = eq0;
    mem32[(eqIndicesPtr >> 2) + 1] = eq1;
    mem32[varIndicesPtr >> 2] = varX1;
    mem32[(varIndicesPtr >> 2) + 1] = varX2;

    // Create Torn Block
    const tornBlock = wasmExports.dae_createTornBlock(b, eqIndicesPtr, varIndicesPtr, 2);

    // Allocate variable values buffer and scratch space
    const varValuesPtr = wasmExports.atomicChunkAlloc(16);
    const scratchPtr = wasmExports.atomicChunkAlloc(512);

    const memF64 = new Float64Array(wasmExports.memory.buffer);
    memF64[varValuesPtr >> 3] = 1.0; // Initial guess x1
    memF64[(varValuesPtr >> 3) + 1] = 1.0; // Initial guess x2

    // Solve via reduced residual Newton
    const converged = wasmExports.dae_solveTornBlock(b, tornBlock, varValuesPtr, scratchPtr);
    expect(converged).toBeTruthy();

    const solvedX1 = memF64[varValuesPtr >> 3];
    const solvedX2 = memF64[(varValuesPtr >> 3) + 1];

    expect(solvedX1).toBeCloseTo(-2.0, 5);
    expect(solvedX2).toBeCloseTo(-5.0, 5);
  });

  it("should causally order inner forward chain for 3x3 loop in reversed equation order and support warm-start cache", () => {
    const b = wasmExports.dae_createBuilder();

    // System: 3 coupled variables (x1, x2, x3) with equations in reversed order:
    // Eq 0: x1 = x3 + 1.0
    // Eq 1: x3 = 2.0 * x2
    // Eq 2: x2 = x1 - 3.0
    // Solution: x1 = 2*(x1 - 3) + 1 = 2*x1 - 5 => x1 = 5, x2 = 2, x3 = 4
    const varX1 = wasmExports.dae_addVariable(b, 201, 0, 0, 0, 0.0, 0);
    const varX2 = wasmExports.dae_addVariable(b, 202, 0, 0, 0, 0.0, 0);
    const varX3 = wasmExports.dae_addVariable(b, 203, 0, 0, 0, 0.0, 0);

    const exprX1 = wasmExports.dae_addExpression(b, 0, varX1);
    const exprX2 = wasmExports.dae_addExpression(b, 0, varX2);
    const exprX3 = wasmExports.dae_addExpression(b, 0, varX3);

    const one = wasmExports.dae_addRealLiteral(b, 1.0);
    const two = wasmExports.dae_addRealLiteral(b, 2.0);
    const three = wasmExports.dae_addRealLiteral(b, 3.0);

    // Eq 0: x1 = x3 + 1.0
    const rhs0 = wasmExports.dae_addExpression(b, 5, 0, exprX3, one);
    const eq0 = wasmExports.dae_addEquation(b, 0, exprX1, rhs0, 0);

    // Eq 1: x3 = 2.0 * x2
    const rhs1 = wasmExports.dae_addExpression(b, 5, 2, two, exprX2);
    const eq1 = wasmExports.dae_addEquation(b, 0, exprX3, rhs1, 0);

    // Eq 2: x2 = x1 - 3.0
    const rhs2 = wasmExports.dae_addExpression(b, 5, 1, exprX1, three);
    const eq2 = wasmExports.dae_addEquation(b, 0, exprX2, rhs2, 0);

    const eqIndicesPtr = wasmExports.atomicChunkAlloc(12);
    const varIndicesPtr = wasmExports.atomicChunkAlloc(12);
    const mem32 = new Uint32Array(wasmExports.memory.buffer);
    mem32[eqIndicesPtr >> 2] = eq0;
    mem32[(eqIndicesPtr >> 2) + 1] = eq1;
    mem32[(eqIndicesPtr >> 2) + 2] = eq2;
    mem32[varIndicesPtr >> 2] = varX1;
    mem32[(varIndicesPtr >> 2) + 1] = varX2;
    mem32[(varIndicesPtr >> 2) + 2] = varX3;

    const tornBlock = wasmExports.dae_createTornBlock(b, eqIndicesPtr, varIndicesPtr, 3);
    const varValuesPtr = wasmExports.atomicChunkAlloc(24);
    const scratchPtr = wasmExports.atomicChunkAlloc(1024);

    const memF64 = new Float64Array(wasmExports.memory.buffer);
    memF64[varValuesPtr >> 3] = 0.0;
    memF64[(varValuesPtr >> 3) + 1] = 0.0;
    memF64[(varValuesPtr >> 3) + 2] = 0.0;

    const converged = wasmExports.dae_solveTornBlock(b, tornBlock, varValuesPtr, scratchPtr);
    expect(converged).toBeTruthy();

    expect(memF64[varValuesPtr >> 3]).toBeCloseTo(5.0, 5);
    expect(memF64[(varValuesPtr >> 3) + 1]).toBeCloseTo(2.0, 5);
    expect(memF64[(varValuesPtr >> 3) + 2]).toBeCloseTo(4.0, 5);

    // Verify WarmStartCache and solve1x1Newton
    const cachePtr = wasmExports.initWarmStartCache(64);
    expect(cachePtr).toBeGreaterThan(0);
    expect(wasmExports.getWarmStartValue(cachePtr, 0, -1.0)).toBeCloseTo(-1.0, 6);
    wasmExports.setWarmStartValue(cachePtr, 0, 5.0);
    expect(wasmExports.getWarmStartValue(cachePtr, 0, -1.0)).toBeCloseTo(5.0, 6);
    expect(wasmExports.solve1x1Newton(3.0, 0.5)).toBeCloseTo(2.5, 6);
  });
});
