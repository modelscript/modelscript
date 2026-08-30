import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { modelicaLanguage } from "../../../languages/modelica/src/language.js";
import { buildParser } from "../src/api.js";
import { SolversBridge } from "../src/runtime/solvers_bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("In-WASM Forward-Mode Dual Number Automatic Differentiation", () => {
  let tmpDir: string;
  let exports: any;
  let memory: WebAssembly.Memory;
  let bridge: SolversBridge;

  beforeAll(async () => {
    const result = buildParser(modelicaLanguage);
    tmpDir = path.resolve(__dirname, "../build/tmp-wasm-dual-ad-test");
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
    memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
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
    exports = instance.exports as any;
    bridge = new SolversBridge(memory, exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("should evaluate polynomial expressions with exact derivatives via Dual AD", () => {
    const dae = exports.dae_createBuilder();

    // Variable x (id 0)
    const xVar = exports.dae_addVariable(dae, 100, 0, 0, 0, 2.0); // Real, Continuous, Local, start=2.0
    const xExpr = exports.dae_addExpression(dae, 0, xVar, 0, 0); // ExprKind.Name

    // f(x) = x^2 + 3*x + 5
    // at x = 2.0: f(2) = 4 + 6 + 5 = 15, f'(2) = 2*x + 3 = 7
    const xSq = exports.dae_addExpression(dae, 5, 2, xExpr, xExpr); // Mul(x, x)
    const c3 = exports.dae_addRealLiteral(dae, 3.0);
    const threeX = exports.dae_addExpression(dae, 5, 2, c3, xExpr); // Mul(3, x)
    const xSqPlus3X = exports.dae_addExpression(dae, 5, 0, xSq, threeX); // Add
    const c5 = exports.dae_addRealLiteral(dae, 5.0);
    const polyExpr = exports.dae_addExpression(dae, 5, 0, xSqPlus3X, c5); // Add 5

    // Seed: x.val = 2.0, x.dot = 1.0 (16 bytes per Dual)
    const dualVars = new Float64Array([2.0, 1.0]);
    const res = bridge.evalDualExpr(dae, polyExpr, dualVars);

    expect(res.val).toBeCloseTo(15.0);
    expect(res.dot).toBeCloseTo(7.0);
  });

  test("should evaluate transcendental and trigonometric functions via Dual AD", () => {
    const dae = exports.dae_createBuilder();

    // Variable x (id 0)
    const xVar = exports.dae_addVariable(dae, 100, 0, 0, 0, 0.0);
    const xExpr = exports.dae_addExpression(dae, 0, xVar, 0, 0);

    // f(x) = sin(x) * exp(x)
    // BuiltinMathFunc.Sin = 0, BuiltinMathFunc.Exp = 10
    const sinExpr = exports.dae_addExpression(dae, 7, 0, xExpr, 0); // Call sin(x)
    const expExpr = exports.dae_addExpression(dae, 7, 10, xExpr, 0); // Call exp(x)
    const mulExpr = exports.dae_addExpression(dae, 5, 2, sinExpr, expExpr); // Mul(sin, exp)

    // at x = 0: f(0) = sin(0)*exp(0) = 0, f'(0) = cos(0)*exp(0) + sin(0)*exp(0) = 1.0
    const dualVars0 = new Float64Array([0.0, 1.0]);
    const res0 = bridge.evalDualExpr(dae, mulExpr, dualVars0);

    expect(res0.val).toBeCloseTo(0.0);
    expect(res0.dot).toBeCloseTo(1.0);

    // at x = PI / 4:
    // f(PI/4) = sin(PI/4) * exp(PI/4) = (sqrt(2)/2) * exp(PI/4)
    // f'(PI/4) = (cos(PI/4) + sin(PI/4)) * exp(PI/4) = sqrt(2) * exp(PI/4)
    const xVal = Math.PI / 4;
    const dualVarsPi4 = new Float64Array([xVal, 1.0]);
    const resPi4 = bridge.evalDualExpr(dae, mulExpr, dualVarsPi4);

    const expectedVal = Math.sin(xVal) * Math.exp(xVal);
    const expectedDot = (Math.cos(xVal) + Math.sin(xVal)) * Math.exp(xVal);

    expect(resPi4.val).toBeCloseTo(expectedVal);
    expect(resPi4.dot).toBeCloseTo(expectedDot);
  });

  test("should evaluate quotients, roots, and powers via Dual AD", () => {
    const dae = exports.dae_createBuilder();

    // Variable x (id 0), Variable y (id 1)
    const xVar = exports.dae_addVariable(dae, 100, 0, 0, 0, 4.0);
    const yVar = exports.dae_addVariable(dae, 101, 0, 0, 0, 2.0);
    const xExpr = exports.dae_addExpression(dae, 0, xVar, 0, 0);
    const yExpr = exports.dae_addExpression(dae, 0, yVar, 0, 0);

    // f(x, y) = x / y + sqrt(x)
    // at x = 4.0, y = 2.0:
    // df/dx = 1/y + 1/(2*sqrt(x)) = 1/2 + 1/4 = 0.75
    // df/dy = -x / y^2 = -4 / 4 = -1.0
    const divExpr = exports.dae_addExpression(dae, 5, 3, xExpr, yExpr); // Div(x, y)
    const sqrtExpr = exports.dae_addExpression(dae, 7, 13, xExpr, 0); // Sqrt(x) (BuiltinMathFunc.Sqrt = 13)
    const fExpr = exports.dae_addExpression(dae, 5, 0, divExpr, sqrtExpr);

    // Differentiate w.r.t x (seed dx = 1, dy = 0)
    const dualVarsWrtX = new Float64Array([4.0, 1.0, 2.0, 0.0]);
    const resX = bridge.evalDualExpr(dae, fExpr, dualVarsWrtX);
    expect(resX.val).toBeCloseTo(4.0);
    expect(resX.dot).toBeCloseTo(0.75);

    // Differentiate w.r.t y (seed dx = 0, dy = 1)
    const dualVarsWrtY = new Float64Array([4.0, 0.0, 2.0, 1.0]);
    const resY = bridge.evalDualExpr(dae, fExpr, dualVarsWrtY);
    expect(resY.val).toBeCloseTo(4.0);
    expect(resY.dot).toBeCloseTo(-1.0);
  });

  test("should evaluate conditional IfElse expressions with Dual AD", () => {
    const dae = exports.dae_createBuilder();

    const xVar = exports.dae_addVariable(dae, 100, 0, 0, 0, 2.0);
    const xExpr = exports.dae_addExpression(dae, 0, xVar, 0, 0);
    const zero = exports.dae_addRealLiteral(dae, 0.0);

    // Condition: x > 0 (BinOp.Gt = 15)
    const condExpr = exports.dae_addExpression(dae, 5, 15, xExpr, zero);

    // Then: x^2 (Mul(x, x)), Else: -x (Negate)
    const thenExpr = exports.dae_addExpression(dae, 5, 2, xExpr, xExpr);
    const elseExpr = exports.dae_addExpression(dae, 14, 0, xExpr, 0); // Negate

    const ifElseExpr = exports.dae_addExpression(dae, 11, condExpr, thenExpr, elseExpr); // ExprKind.IfElse = 11

    // For x = 3 > 0: f(3) = 9, f'(3) = 2*x = 6
    const resPos = bridge.evalDualExpr(dae, ifElseExpr, new Float64Array([3.0, 1.0]));
    expect(resPos.val).toBeCloseTo(9.0);
    expect(resPos.dot).toBeCloseTo(6.0);

    // For x = -3 < 0: f(-3) = -(-3) = 3, f'(-3) = -1
    const resNeg = bridge.evalDualExpr(dae, ifElseExpr, new Float64Array([-3.0, 1.0]));
    expect(resNeg.val).toBeCloseTo(3.0);
    expect(resNeg.dot).toBeCloseTo(-1.0);
  });

  test("should compute non-linear equation residuals and full Jacobian columns in WASM", () => {
    const dae = exports.dae_createBuilder();

    // 2-variable non-linear system:
    // x0 (id 0), x1 (id 1)
    const x0 = exports.dae_addVariable(dae, 100, 0, 0, 0, 2.0);
    const x1 = exports.dae_addVariable(dae, 101, 0, 0, 0, 3.0);
    const x0Expr = exports.dae_addExpression(dae, 0, x0, 0, 0);
    const x1Expr = exports.dae_addExpression(dae, 0, x1, 0, 0);

    // Eq 0: x0^2 + x1 = 7.0  => Residual R0 = 7.0 - (x0^2 + x1)
    // dR0/dx0 = -2*x0 = -4.0
    // dR0/dx1 = -1.0
    const x0Sq = exports.dae_addExpression(dae, 5, 2, x0Expr, x0Expr);
    const lhs0 = exports.dae_addExpression(dae, 5, 0, x0Sq, x1Expr);
    const rhs0 = exports.dae_addRealLiteral(dae, 7.0);
    const eq0 = exports.dae_addEquation(dae, 0, lhs0, rhs0);

    // Eq 1: x0 * x1 = 6.0  => Residual R1 = 6.0 - (x0 * x1)
    // dR1/dx0 = -x1 = -3.0
    // dR1/dx1 = -x0 = -2.0
    const lhs1 = exports.dae_addExpression(dae, 5, 2, x0Expr, x1Expr);
    const rhs1 = exports.dae_addRealLiteral(dae, 6.0);
    const eq1 = exports.dae_addEquation(dae, 0, lhs1, rhs1);

    // At x0 = 2.0, x1 = 3.0:
    // R0 = 7.0 - (4.0 + 3.0) = 0.0
    // R1 = 6.0 - (2.0 * 3.0) = 0.0
    const dualVars = new Float64Array([2.0, 0.0, 3.0, 0.0]);

    // 1. Evaluate Residual for Eq0
    const r0 = bridge.evalDualEquationResidual(dae, eq0, dualVars);
    expect(r0.val).toBeCloseTo(0.0);

    // 2. Evaluate Residual for Eq1
    const r1 = bridge.evalDualEquationResidual(dae, eq1, dualVars);
    expect(r1.val).toBeCloseTo(0.0);

    // 3. Evaluate Jacobian column for x0 (seedVarId = 0)
    // J[:, 0] = [dR0/dx0, dR1/dx0] = [-4.0, -3.0]
    const col0 = bridge.evalDualJacobianColumn(dae, [eq0, eq1], dualVars, 0);
    expect(col0.length).toBe(2);
    expect(col0[0]).toBeCloseTo(-4.0);
    expect(col0[1]).toBeCloseTo(-3.0);

    // 4. Evaluate Jacobian column for x1 (seedVarId = 1)
    // J[:, 1] = [dR0/dx1, dR1/dx1] = [-1.0, -2.0]
    const col1 = bridge.evalDualJacobianColumn(dae, [eq0, eq1], dualVars, 1);
    expect(col1.length).toBe(2);
    expect(col1[0]).toBeCloseTo(-1.0);
    expect(col1[1]).toBeCloseTo(-2.0);
  });
});
