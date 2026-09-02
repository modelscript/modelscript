// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  ArenaSimulator,
  generateNlpMainC,
  IpoptSolver,
  ModelicaCalibrator,
  ModelicaOptimizer,
  solveGlobalProblem,
} from "../src/compiler/optimizer/index.js";
import { initBltWasm } from "../src/runtime/wasm_blt.js";
import { BinOp, DAEBuilder, ExprKind, Variability, VarType } from "../src/runtime/wasm_dae.js";

await initBltWasm();

console.log("Testing Compiler Optimizer WASM Integration...");

// 1. Test Arena-Native NLP Codegen with ExprId handles
{
  const dae = new DAEBuilder();
  dae.addVariable("x", VarType.Real);
  dae.addVariable("y", VarType.Real);

  const xExpr = dae.addNameExpr("x");
  const yExpr = dae.addNameExpr("y");

  // obj: x^2 + y^2
  const twoExpr = dae.addRealLiteral(2.0);
  const x2 = dae.addExpression(ExprKind.Binary, BinOp.Pow, xExpr, twoExpr);
  const y2 = dae.addExpression(ExprKind.Binary, BinOp.Pow, yExpr, twoExpr);
  const objExpr = dae.addExpression(ExprKind.Binary, BinOp.Add, x2, y2);

  // constraint: x + y - 1 == 0
  const oneExpr = dae.addRealLiteral(1.0);
  const sumExpr = dae.addExpression(ExprKind.Binary, BinOp.Add, xExpr, yExpr);
  const conExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, sumExpr, oneExpr);

  const nlpDef = {
    variables: ["x", "y"],
    variableLB: [0.0, 0.0],
    variableUB: [10.0, 10.0],
    x0: [0.5, 0.5],
    dae,
    objectiveExpr: objExpr,
    constraintExprs: [conExpr],
    constraintLB: [0.0],
    constraintUB: [0.0],
  };

  const codegenResult = generateNlpMainC(nlpDef, {
    modelIdentifier: "TestModel",
    solver: "ipopt",
  });

  assert.ok(codegenResult.mainC.includes("model_eval_objective"), "Should generate model_eval_objective");
  assert.ok(codegenResult.mainC.includes("model_eval_gradient"), "Should generate model_eval_gradient");
  assert.ok(codegenResult.mainC.includes("model_eval_constraints"), "Should generate model_eval_constraints");
  assert.ok(codegenResult.mainC.includes("model_eval_jacobian"), "Should generate model_eval_jacobian");
  console.log("  ✔ generateNlpMainC generated C code from DAEBuilder ExprId handles");
}

// 2. Test Global Optimizer with MINLP Freeze-and-Solve
{
  const dae = new DAEBuilder();
  dae.addVariable("x", VarType.Real);
  dae.addVariable("mode", VarType.Integer);

  const xExpr = dae.addNameExpr("x");
  const modeExpr = dae.addNameExpr("mode");

  // objective/residual: x == 10.0 - 2.0 * mode
  const tenExpr = dae.addRealLiteral(10.0);
  const twoExpr = dae.addRealLiteral(2.0);
  const twoMode = dae.addExpression(ExprKind.Binary, BinOp.Mul, twoExpr, modeExpr);
  const rhs = dae.addExpression(ExprKind.Binary, BinOp.Sub, tenExpr, twoMode);
  const objExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, xExpr, rhs);

  const bounds = new Map<string, { min: number; max: number }>([
    ["x", { min: 0.0, max: 20.0 }],
    ["mode", { min: 1, max: 3 }],
  ]);

  const discreteVars = new Set<string>(["mode"]);

  const res = solveGlobalProblem({
    dae,
    objectiveExpr: objExpr,
    variables: ["x", "mode"],
    bounds,
    discreteVariables: discreteVars,
  });

  assert.strictEqual(res.method, "minlp-freeze-and-solve");
  assert.ok(res.converged, "MINLP solver should converge");
  console.log("  ✔ solveGlobalProblem solved mixed-integer problem via WASM MINLP engine");
}

// 3. Test Global Optimizer Spatial Branch-and-Bound Fallback/Bridge
{
  const dae = new DAEBuilder();
  dae.addVariable("x", VarType.Real);
  const xExpr = dae.addNameExpr("x");

  // min (x - 2)^2
  const twoExpr = dae.addRealLiteral(2.0);
  const subExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, xExpr, twoExpr);
  const objExpr = dae.addExpression(ExprKind.Binary, BinOp.Mul, subExpr, subExpr);

  const bounds = new Map<string, { min: number; max: number }>([["x", { min: 0.0, max: 5.0 }]]);

  const res = solveGlobalProblem({
    dae,
    objectiveExpr: objExpr,
    variables: ["x"],
    bounds,
  });

  assert.strictEqual(res.method, "spatial-branch-and-bound");
  assert.ok(res.converged, "BnB should converge");
  console.log("  ✔ solveGlobalProblem routed to spatial Branch-and-Bound");
}

// 4. Test IpoptSolver Wrapper
{
  const solver = new IpoptSolver("dummy.so");
  const result = await solver.solve();
  assert.strictEqual(result.status, "STUB_SOLVED_SUCCESS");
  console.log("  ✔ IpoptSolver class instantiated and executed solve()");
}

// 5. Test ModelicaOptimizer with ExprId objective & AD gradient
{
  const dae = new DAEBuilder();
  dae.addVariable("x", VarType.Real);
  dae.addVariable("der(x)", VarType.Real);
  dae.addVariable("u", VarType.Real);

  const uExpr = dae.addNameExpr("u");
  const twoExpr = dae.addRealLiteral(2.0);
  // Objective: u^2
  const objExpr = dae.addExpression(ExprKind.Binary, BinOp.Pow, uExpr, twoExpr);

  // dx/dt = -x + u
  const xExpr = dae.addNameExpr("x");
  const negOneExpr = dae.addRealLiteral(-1.0);
  const negX = dae.addExpression(ExprKind.Binary, BinOp.Mul, negOneExpr, xExpr);
  const rhsExpr = dae.addExpression(ExprKind.Binary, BinOp.Add, negX, uExpr);
  const derivX = dae.addNameExpr("der(x)");
  dae.addEquation(derivX, rhsExpr);

  const optProblem = {
    objective: objExpr,
    controls: ["u"],
    controlBounds: new Map([["u", { min: -1.0, max: 1.0 }]]),
    startTime: 0,
    stopTime: 1.0,
    numIntervals: 5,
    method: "trapezoidal" as const,
    maxIterations: 5,
  };

  const optimizer = new ModelicaOptimizer(dae, optProblem);
  const result = optimizer.solve();
  assert.ok(typeof result.cost === "number", "Optimization cost should be computed");
  assert.ok(result.controls.has("u"), "Controls should be extracted");
  console.log("  ✔ ModelicaOptimizer executed direct collocation with ExprId objective & AD gradient");
}

// 6. Test ModelicaCalibrator with ArenaSimulator
{
  const dae = new DAEBuilder();
  dae.addVariable("k", VarType.Real, Variability.Parameter);
  dae.setVarStartValue(0, 1.5);
  dae.addVariable("x", VarType.Real);
  dae.setVarStartValue(1, 1.0);
  dae.addVariable("der(x)", VarType.Real);

  // dx/dt = -k * x
  const xExpr = dae.addNameExpr("x");
  const kExpr = dae.addNameExpr("k");
  const negOne = dae.addRealLiteral(-1.0);
  const negK = dae.addExpression(ExprKind.Binary, BinOp.Mul, negOne, kExpr);
  const rhs = dae.addExpression(ExprKind.Binary, BinOp.Mul, negK, xExpr);
  const derivX = dae.addNameExpr("der(x)");
  dae.addEquation(derivX, rhs);

  const simulator = new ArenaSimulator(dae);
  const calProblem = {
    parameters: ["k"],
    parameterBounds: new Map([["k", { min: 0.1, max: 5.0 }]]),
    initialGuess: new Map([["k", 1.0]]),
    measurements: new Map([["x", { t: [0.0, 0.5, 1.0], y: [1.0, Math.exp(-1.0), Math.exp(-2.0)] }]]),
    maxIterations: 5,
  };

  const calibrator = new ModelicaCalibrator(dae, simulator, calProblem);
  const calResult = calibrator.calibrate();
  assert.ok(calResult.parameters.has("k"), "Calibrated parameters should contain k");
  console.log("  ✔ ModelicaCalibrator executed parameter estimation via ArenaSimulator");
}

console.log("=== All Compiler Optimizer WASM Tests Passed Cleanly ===");
