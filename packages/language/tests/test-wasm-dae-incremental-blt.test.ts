// SPDX-License-Identifier: AGPL-3.0-or-later
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testGrammar = language({
  name: "DaeIncBltDSL",
  rules: {
    Root: ($) => seq(semanticToken("keyword", "model"), "x", ";"),
  },
  extras: ($) => [/\s+/],
});

describe("WASM Incremental BLT & Tearing Cache", () => {
  let wasmExports: any;
  let memory: WebAssembly.Memory;
  let tmpDir: string;

  beforeAll(async () => {
    const result = buildParser(testGrammar as any);
    tmpDir = path.join(__dirname, "scratch_build_dae_inc_blt");
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const f of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, f.filename), f.content);
    }

    const ascPath =
      [
        path.resolve(__dirname, "../../node_modules/.bin/asc"),
        path.resolve(__dirname, "../../../node_modules/.bin/asc"),
        "npx asc",
      ].find((p) => p.startsWith("npx") || fs.existsSync(p)) || "npx asc";
    const parserTs = path.join(tmpDir, "parser.ts");
    const wasmOut = path.join(tmpDir, "parser.wasm");

    try {
      childProcess.execSync(
        `${ascPath} ${parserTs} -o ${wasmOut} --exportRuntime --enable threads --optimize --runtime stub`,
        { stdio: "pipe" },
      );
    } catch (e: any) {
      console.error("ASC ERROR:", e.stderr?.toString());
      throw e;
    }

    const wasmBytes = fs.readFileSync(wasmOut);
    const mod = await WebAssembly.compile(wasmBytes);
    memory = new WebAssembly.Memory({ initial: 64, maximum: 512, shared: true });
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
    const wasmInstance = await WebAssembly.instantiate(mod, imports);
    wasmExports = wasmInstance.exports;
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should compute BLT block decomposition and inspect SCC blocks", () => {
    const b = wasmExports.dae_createBuilder();
    // System of 3 equations:
    // eq 0: x = 1.0 (causal)
    // eq 1: y + z = 10.0 (coupled algebraic loop)
    // eq 2: 2*y - z = 5.0 (coupled algebraic loop)
    const x = wasmExports.dae_addVariable(b, 0x10, 0, 0, 0, 0.0, 0);
    const y = wasmExports.dae_addVariable(b, 0x20, 0, 0, 0, 0.0, 0);
    const z = wasmExports.dae_addVariable(b, 0x30, 0, 0, 0, 0.0, 0);

    const xExpr = wasmExports.dae_addName(b, x);
    const yExpr = wasmExports.dae_addName(b, y);
    const zExpr = wasmExports.dae_addName(b, z);
    const one = wasmExports.dae_addRealLiteral(b, 1.0);
    const ten = wasmExports.dae_addRealLiteral(b, 10.0);
    const five = wasmExports.dae_addRealLiteral(b, 5.0);

    // eq 0: x = 1.0
    wasmExports.dae_addEquation(b, 0, xExpr, one);
    // eq 1: y + z = 10.0
    const ypz = wasmExports.dae_addBinaryExpr(b, 0, yExpr, zExpr);
    wasmExports.dae_addEquation(b, 0, ypz, ten);
    // eq 2: y - z = 5.0
    const ymz = wasmExports.dae_addBinaryExpr(b, 1, yExpr, zExpr);
    wasmExports.dae_addEquation(b, 0, ymz, five);

    const engine = wasmExports.blt_createEngine(b);
    wasmExports.blt_compute(engine);

    const sccCount = wasmExports.blt_getSccCount(engine);
    expect(sccCount).toBeGreaterThanOrEqual(2); // Block 1: {x}, Block 2: {y, z}

    // Verify matchings
    expect(wasmExports.blt_getMatchVarToEq(engine, x)).toBe(0);
    expect(wasmExports.blt_getMatchEqToVar(engine, 0)).toBe(x);
  });

  it("should cache and reuse tearing plans for identical equation blocks", () => {
    const b = wasmExports.dae_createBuilder();
    // System: 2 coupled algebraic variables (x1, x2)
    // Eq 0: x1 = x2 + 3.0
    // Eq 1: x2 = 2.0 * x1 - 1.0  => x1 = -2.0, x2 = -5.0
    const varX1 = wasmExports.dae_addVariable(b, 101, 0, 0, 0, 0.0, 0);
    const varX2 = wasmExports.dae_addVariable(b, 102, 0, 0, 0, 0.0, 0);

    const exprX1 = wasmExports.dae_addName(b, varX1);
    const exprX2 = wasmExports.dae_addName(b, varX2);

    const three = wasmExports.dae_addRealLiteral(b, 3.0);
    const two = wasmExports.dae_addRealLiteral(b, 2.0);
    const one = wasmExports.dae_addRealLiteral(b, 1.0);

    // Eq 0: x1 = x2 + 3.0
    const rhs0 = wasmExports.dae_addBinaryExpr(b, 0, exprX2, three); // BinOp.Add = 0
    const eq0 = wasmExports.dae_addEquation(b, 0, exprX1, rhs0);

    // Eq 1: x2 = 2.0 * x1 - 1.0
    const mul2X1 = wasmExports.dae_addBinaryExpr(b, 2, two, exprX1); // BinOp.Mul = 2
    const rhs1 = wasmExports.dae_addBinaryExpr(b, 1, mul2X1, one); // BinOp.Sub = 1
    const eq1 = wasmExports.dae_addEquation(b, 0, exprX2, rhs1);

    const eqIdxPtr = wasmExports.atomicChunkAlloc(8);
    const varIdxPtr = wasmExports.atomicChunkAlloc(8);
    const mem32 = new Uint32Array(wasmExports.memory.buffer);
    mem32[eqIdxPtr >> 2] = eq0;
    mem32[(eqIdxPtr >> 2) + 1] = eq1;
    mem32[varIdxPtr >> 2] = varX1;
    mem32[(varIdxPtr >> 2) + 1] = varX2;

    const cache = wasmExports.dae_createTearingCache(64);
    expect(cache).toBeGreaterThan(0);

    // First lookup: misses cache, creates TornBlock
    const sccHashHi = 0x12345678;
    const sccHashLo = 0xabcdef01;
    const torn1 = wasmExports.dae_getOrCacheTornBlock(cache, sccHashHi, sccHashLo, b, eqIdxPtr, varIdxPtr, 2);
    expect(torn1).toBeGreaterThan(0);

    // Second lookup with same hash: hits cache, returns identical pointer
    const torn2 = wasmExports.dae_getOrCacheTornBlock(cache, sccHashHi, sccHashLo, b, eqIdxPtr, varIdxPtr, 2);
    expect(torn2).toBe(torn1);

    // Solve torn block
    const varValuesPtr = wasmExports.atomicChunkAlloc(16);
    const scratchPtr = wasmExports.atomicChunkAlloc(512);
    const memF64 = new Float64Array(wasmExports.memory.buffer);
    memF64[varValuesPtr >> 3] = 1.0; // Initial guess x1
    memF64[(varValuesPtr >> 3) + 1] = 1.0; // Initial guess x2

    const ok = wasmExports.dae_solveTornBlock(b, torn1, varValuesPtr, scratchPtr);
    expect(Boolean(ok)).toBe(true);
    expect(memF64[varValuesPtr >> 3]).toBeCloseTo(-2.0, 5);
    expect(memF64[(varValuesPtr >> 3) + 1]).toBeCloseTo(-5.0, 5);
  });
});
