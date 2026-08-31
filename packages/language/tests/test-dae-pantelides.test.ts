import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { analysis, choice, domain, field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Define Language DSL with Pantelides Index Reduction Configuration
const pantelidesDsl = language({
  name: "PantelidesTestLang",
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
        tearing: "cellier",
      }),
      query: (db: any) => {},
    }),
  },
});

// Enums matching runtime definitions
const ExprKind = {
  Name: 0,
  IntLiteral: 1,
  RealLiteral: 2,
  BoolLiteral: 3,
  StringLiteral: 4,
  Binary: 5,
  Unary: 6,
  Call: 7,
  Subscript: 8,
  ArrayCtor: 9,
  Range: 10,
  IfElse: 11,
  Der: 12,
  Pre: 13,
  Negate: 14,
  Tuple: 15,
};

const BinOp = {
  Add: 0,
  Sub: 1,
  Mul: 2,
  Div: 3,
  Pow: 4,
};

const VarType = { Real: 0, Integer: 1, Boolean: 2 };
const Variability = { Continuous: 0, Discrete: 1, Parameter: 2, Constant: 3 };
const Causality = { Local: 0, Input: 1, Output: 2 };
const EqKind = { Simple: 0 };
const FLAG_VAR_STATE = 1 << 3;
const FLAG_VAR_STATE_DER = 1 << 4;
const FLAG_TEARING_VAR = 1 << 0;

describe("DAE Pantelides Index Reduction Engine", () => {
  let tmpDir: string;
  let wasmExports: any;

  beforeAll(async () => {
    const result = buildParser(pantelidesDsl as any);
    tmpDir = path.join(__dirname, "scratch_build_pantelides");
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

    const memory = new WebAssembly.Memory({ initial: 512, maximum: 1024, shared: true });
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
    if (typeof wasmExports.initCompiler === "function") {
      wasmExports.initCompiler();
    }
  }, 60000);

  it("should export Pantelides WASM routines", () => {
    expect(wasmExports.runPantelidesIndexReduction).toBeDefined();
    expect(typeof wasmExports.runPantelidesIndexReduction).toBe("function");
    expect(wasmExports.getPantelidesStructuralIndex).toBeDefined();
    expect(wasmExports.getPantelidesDummyDerivativeCount).toBeDefined();
    expect(wasmExports.testDifferentiateExpr).toBeDefined();
    expect(wasmExports.testContainsDerivative).toBeDefined();
  });

  describe("Symbolic Differentiator in WASM", () => {
    it("should correctly differentiate literals and parameters to zero", () => {
      const daePtr = wasmExports.dae_createBuilder();

      // Parameter variable R
      const paramVarId = wasmExports.dae_addVariable(
        daePtr,
        1,
        VarType.Real,
        Variability.Parameter,
        Causality.Local,
        10.0,
        0,
      );
      const paramExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, paramVarId, 0xffffffff, 0xffffffff);

      // State variable x
      const stateVarId = wasmExports.dae_addVariable(
        daePtr,
        2,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        0.0,
        FLAG_VAR_STATE,
      );
      const stateExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, stateVarId, 0xffffffff, 0xffffffff);

      // Constant literal
      const litExpr = wasmExports.dae_addRealLiteral(daePtr, 42.0);

      // Differentiate param -> 0.0
      const dParam = wasmExports.testDifferentiateExpr(daePtr, paramExpr);
      expect(Boolean(wasmExports.testContainsDerivative(daePtr, dParam))).toBe(false);

      // Differentiate lit -> 0.0
      const dLit = wasmExports.testDifferentiateExpr(daePtr, litExpr);
      expect(Boolean(wasmExports.testContainsDerivative(daePtr, dLit))).toBe(false);

      // Differentiate state -> der(x)
      const dState = wasmExports.testDifferentiateExpr(daePtr, stateExpr);
      expect(Boolean(wasmExports.testContainsDerivative(daePtr, dState))).toBe(true);
    });

    it("should differentiate arithmetic expressions using product and power rules", () => {
      const daePtr = wasmExports.dae_createBuilder();

      // State x
      const xId = wasmExports.dae_addVariable(
        daePtr,
        1,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        1.0,
        FLAG_VAR_STATE,
      );
      const xExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, xId, 0xffffffff, 0xffffffff);

      // x^2
      const twoExpr = wasmExports.dae_addIntLiteral(daePtr, 2);
      const xSquared = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Pow, xExpr, twoExpr);

      // d(x^2) contains derivative of x
      const dXSquared = wasmExports.testDifferentiateExpr(daePtr, xSquared);
      expect(Boolean(wasmExports.testContainsDerivative(daePtr, dXSquared))).toBe(true);

      // Parameter C
      const cId = wasmExports.dae_addVariable(daePtr, 2, VarType.Real, Variability.Parameter, Causality.Local, 5.0, 0);
      const cExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, cId, 0xffffffff, 0xffffffff);

      // C * x
      const cMulX = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Mul, cExpr, xExpr);
      const dCMulX = wasmExports.testDifferentiateExpr(daePtr, cMulX);
      expect(Boolean(wasmExports.testContainsDerivative(daePtr, dCMulX))).toBe(true);
    });
  });

  describe("Pantelides Index Reduction Scenarios", () => {
    it("should preserve Index-1 system without adding redundant equations", () => {
      const daePtr = wasmExports.dae_createBuilder();

      // State x: der(x) = -x
      const xId = wasmExports.dae_addVariable(
        daePtr,
        1,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        1.0,
        FLAG_VAR_STATE,
      );
      const xExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, xId, 0xffffffff, 0xffffffff);
      const derXExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Der, xExpr, 0xffffffff, 0xffffffff);
      const negXExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Negate, 0, xExpr, 0xffffffff);

      // Eq 1: der(x) = -x
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, derXExpr, negXExpr);

      // Algebraic y: y = 2 * x
      const yId = wasmExports.dae_addVariable(daePtr, 2, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
      const yExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, yId, 0xffffffff, 0xffffffff);
      const twoExpr = wasmExports.dae_addRealLiteral(daePtr, 2.0);
      const twoMulX = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Mul, twoExpr, xExpr);

      // Eq 2: y = 2 * x
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, yExpr, twoMulX);

      const initEqCount = wasmExports.dae_getEqCount(daePtr);
      expect(initEqCount).toBe(2);

      // Run Pantelides
      const newEqs = wasmExports.runPantelidesIndexReduction(daePtr, 0);
      expect(newEqs).toBe(0);
      expect(wasmExports.getPantelidesStructuralIndex()).toBe(1);
      expect(wasmExports.dae_getEqCount(daePtr)).toBe(2);
    });

    it("should reduce Index-2 constrained state system by differentiating the constraint", () => {
      const daePtr = wasmExports.dae_createBuilder();

      // States x1, x2
      const x1Id = wasmExports.dae_addVariable(
        daePtr,
        1,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        1.0,
        FLAG_VAR_STATE,
      );
      const x2Id = wasmExports.dae_addVariable(
        daePtr,
        2,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        -1.0,
        FLAG_VAR_STATE,
      );

      const x1Expr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, x1Id, 0xffffffff, 0xffffffff);
      const x2Expr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, x2Id, 0xffffffff, 0xffffffff);

      // High-index constraint: x1 + x2 = 0 (without derivatives)
      const sumExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Add, x1Expr, x2Expr);
      const zeroExpr = wasmExports.dae_addRealLiteral(daePtr, 0.0);
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, sumExpr, zeroExpr);

      // Dynamics: der(x1) = -x1
      const derX1Expr = wasmExports.dae_addExpression(daePtr, ExprKind.Der, x1Expr, 0xffffffff, 0xffffffff);
      const negX1Expr = wasmExports.dae_addExpression(daePtr, ExprKind.Negate, 0, x1Expr, 0xffffffff);
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, derX1Expr, negX1Expr);

      // Run Pantelides Index Reduction
      const newEqs = wasmExports.runPantelidesIndexReduction(daePtr, 0);
      expect(newEqs).toBeGreaterThanOrEqual(1);
      expect(wasmExports.getPantelidesStructuralIndex()).toBe(2);
      expect(wasmExports.dae_getEqCount(daePtr)).toBe(3);
    });

    it("should handle Index-3 mechanical pendulum constraint system", () => {
      const daePtr = wasmExports.dae_createBuilder();

      // States x, y
      const xId = wasmExports.dae_addVariable(
        daePtr,
        1,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        1.0,
        FLAG_VAR_STATE,
      );
      const yId = wasmExports.dae_addVariable(
        daePtr,
        2,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        0.0,
        FLAG_VAR_STATE,
      );
      const lId = wasmExports.dae_addVariable(daePtr, 3, VarType.Real, Variability.Parameter, Causality.Local, 1.0, 0); // L = constant

      const xExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, xId, 0xffffffff, 0xffffffff);
      const yExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, yId, 0xffffffff, 0xffffffff);
      const lExpr = wasmExports.dae_addExpression(daePtr, ExprKind.Name, lId, 0xffffffff, 0xffffffff);

      const twoExpr = wasmExports.dae_addIntLiteral(daePtr, 2);
      const x2 = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Pow, xExpr, twoExpr);
      const y2 = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Pow, yExpr, twoExpr);
      const l2 = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Pow, lExpr, twoExpr);

      // Constraint: x^2 + y^2 = L^2
      const x2PlusY2 = wasmExports.dae_addExpression(daePtr, ExprKind.Binary, BinOp.Add, x2, y2);
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, x2PlusY2, l2);

      // 1 dynamic equation der(x) = ...
      const derX = wasmExports.dae_addExpression(daePtr, ExprKind.Der, xExpr, 0xffffffff, 0xffffffff);
      const zero = wasmExports.dae_addRealLiteral(daePtr, 0.0);
      wasmExports.dae_addEquation(daePtr, EqKind.Simple, derX, zero);

      // Run Pantelides
      const newEqs = wasmExports.runPantelidesIndexReduction(daePtr, 0);
      expect(newEqs).toBeGreaterThanOrEqual(1);
      expect(wasmExports.getPantelidesStructuralIndex()).toBeGreaterThanOrEqual(2);
    });
  });
});
