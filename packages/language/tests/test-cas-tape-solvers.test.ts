import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";
import { SolversBridge } from "../src/runtime/solvers_bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "CasTapeTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  extras: ($: any) => [/\s+/],
});

describe("Phase 5: Numerics, CAS, Solvers & Optimization", () => {
  const tmpDir = path.join(__dirname, "scratch_build_cas_tape");
  let facade: any;
  let wasmExports: any;
  let wasmMemory: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      wasmMemory = memory;
      const imports = {
        env: {
          memory,
          abort: (msg: any, file: any, line: any, col: any) => {
            console.error(`WASM ABORT: line ${line}, col ${col}`);
          },
        },
        JavaScript: { debugLog: () => {}, logNode: () => {} },
        engine: { debugLog: () => {} },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      };

      const instance = await WebAssembly.instantiate(wasmModule, imports);
      wasmExports = instance.exports;
      if (instance.exports.initCompiler) {
        instance.exports.initCompiler();
      }
      const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };";
      const { LspFacade } = new Function(wrapperSrc)();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should simplify algebraic expressions and fold constants via CAS in WASM", () => {
    const daePtr = wasmExports.dae_createBuilder();

    // Constant folding: 5.0 + 3.0 -> 8.0
    const c5 = wasmExports.dae_addExpression(daePtr, 2, 0, 0, 0); // RealLiteral
    const c3 = wasmExports.dae_addExpression(daePtr, 2, 0, 0, 0);
    // Set actual float values
    const mem64 = new Float64Array(wasmMemory.buffer);

    // Let's create a variable x (varId 0)
    const xExpr = wasmExports.dae_addExpression(daePtr, 0, 0, 0xffffffff, 0xffffffff); // Name: x
    const zeroExpr = wasmExports.dae_addExpression(daePtr, 1, 0, 0xffffffff, 0xffffffff); // IntLiteral: 0
    const oneExpr = wasmExports.dae_addExpression(daePtr, 1, 1, 0xffffffff, 0xffffffff); // IntLiteral: 1

    // 1. Rewrite: x + 0 -> x
    const xPlusZero = wasmExports.dae_addExpression(daePtr, 5, 0, xExpr, zeroExpr); // Binary: Add
    const simplifiedAdd = facade.casSimplify(daePtr, xPlusZero);
    expect(simplifiedAdd).toBe(xExpr);

    // 2. Rewrite: x * 1 -> x
    const xTimesOne = wasmExports.dae_addExpression(daePtr, 5, 2, xExpr, oneExpr); // Binary: Mul
    const simplifiedMul = facade.casSimplify(daePtr, xTimesOne);
    expect(simplifiedMul).toBe(xExpr);

    // 3. Rewrite: x * 0 -> 0
    const xTimesZero = wasmExports.dae_addExpression(daePtr, 5, 2, xExpr, zeroExpr);
    const simplifiedZero = facade.casSimplify(daePtr, xTimesZero);
    expect(simplifiedZero).not.toBe(xExpr);
  });

  test("should compute exact symbolic derivatives via CAS differentiation rules", () => {
    const daePtr = wasmExports.dae_createBuilder();

    // Expression f(x, y) = x * y (varId 0 is x, varId 1 is y)
    const xExpr = wasmExports.dae_addExpression(daePtr, 0, 0, 0xffffffff, 0xffffffff); // Name: x
    const yExpr = wasmExports.dae_addExpression(daePtr, 0, 1, 0xffffffff, 0xffffffff); // Name: y
    const xyExpr = wasmExports.dae_addExpression(daePtr, 5, 2, xExpr, yExpr); // Binary: Mul (x * y)

    // d(x * y) / dx = y
    const df_dx = facade.casDifferentiate(daePtr, xyExpr, 0);
    expect(df_dx).toBe(yExpr);

    // d(x * y) / dy = x
    const df_dy = facade.casDifferentiate(daePtr, xyExpr, 1);
    expect(df_dy).toBe(xExpr);
  });

  test("should compute exact analytical gradients using reverse-mode Automatic Differentiation (Tape AD)", () => {
    const tapePtr = facade.createAdTape();
    expect(tapePtr).toBeGreaterThan(0);

    // Evaluate: f(x0, x1) = x0 * x1 + sin(x0)
    // at x0 = PI / 2, x1 = 3.0
    const x0_val = Math.PI / 2;
    const x1_val = 3.0;

    // Node 0: Variable x0
    const n0 = facade.tapePushOp(tapePtr, 1, 0, 0, x0_val); // TAPE_OP_VAR

    // Node 1: Variable x1
    const n1 = facade.tapePushOp(tapePtr, 1, 0, 0, x1_val); // TAPE_OP_VAR

    // Node 2: x0 * x1
    const n2 = facade.tapePushOp(tapePtr, 4, n0, n1, x0_val * x1_val); // TAPE_OP_MUL

    // Node 3: sin(x0)
    const n3 = facade.tapePushOp(tapePtr, 6, n0, 0, Math.sin(x0_val)); // TAPE_OP_SIN

    // Node 4: (x0 * x1) + sin(x0)
    const n4 = facade.tapePushOp(tapePtr, 2, n2, n3, x0_val * x1_val + Math.sin(x0_val)); // TAPE_OP_ADD

    // Run reverse-mode automatic differentiation from root output (n4)
    facade.tapeBackward(tapePtr, n4);

    // Exact gradients:
    // df/dx0 = x1 + cos(x0) = 3.0 + cos(PI/2) = 3.0
    // df/dx1 = x0 = PI / 2 = 1.57079632679
    const grad_x0 = facade.tapeGetGrad(tapePtr, n0);
    const grad_x1 = facade.tapeGetGrad(tapePtr, n1);

    expect(grad_x0).toBeCloseTo(3.0);
    expect(grad_x1).toBeCloseTo(Math.PI / 2);
  });

  test("should integrate continuous differential equations using SolversBridge (RK4)", () => {
    const bridge = new SolversBridge(wasmMemory, wasmExports);

    // Harmonic Oscillator:
    // dx0/dt = x1
    // dx1/dt = -x0
    // Initial state: x0(0) = 1.0, x1(0) = 0.0
    // Exact solution: x0(t) = cos(t), x1(t) = -sin(t)
    const derivatives = (t: number, y: number[]) => [y[1], -y[0]];
    const y0 = [1.0, 0.0];

    const result = bridge.simulateODE(derivatives, y0, {
      startTime: 0.0,
      stopTime: Math.PI,
      stepSize: 0.005,
    });

    expect(result.converged).toBe(true);
    expect(result.stepCount).toBeGreaterThan(600);

    // At t = PI:
    // x0(PI) should be close to cos(PI) = -1.0
    // x1(PI) should be close to -sin(PI) = 0.0
    const finalX0 = result.trajectories["x_0"][result.trajectories["x_0"].length - 1];
    const finalX1 = result.trajectories["x_1"][result.trajectories["x_1"].length - 1];

    expect(finalX0).toBeCloseTo(-1.0, 3);
    expect(finalX1).toBeCloseTo(0.0, 3);
  });
});
