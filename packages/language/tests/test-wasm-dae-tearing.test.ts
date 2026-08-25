import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { language, semanticToken, seq } from "../src/dsl.js";

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
});
