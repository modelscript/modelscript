// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { loadCoinorWasm, type LpProblem } from "../src/optimizer/solvers/coinor-wasm.js";
import { IpoptSolver } from "../src/optimizer/solvers/ipopt-solver.js";

test("COIN-OR WASM: Native WebAssembly module loading and IPOPT unconstrained optimization", async () => {
  const solver = await loadCoinorWasm();
  assert.ok(solver, "CoinorWasmSolver must initialize from compiled WebAssembly binary");

  // Minimize 2D Rosenbrock function: (1 - x)^2 + 100*(y - x^2)^2
  // Global minimum at (1, 1) with f = 0
  const nVars = 2;
  const nConstraints = 0;
  const x0 = [0.0, 0.0];
  const varLB = [-5.0, -5.0];
  const varUB = [5.0, 5.0];
  const conLB: number[] = [];
  const conUB: number[] = [];

  const evalObjective = (x: number[]) => {
    const x0 = x[0] ?? 0;
    const x1 = x[1] ?? 0;
    return Math.pow(1.0 - x0, 2) + 100.0 * Math.pow(x1 - x0 * x0, 2);
  };

  const evalGradient = (x: number[]) => {
    const x0 = x[0] ?? 0;
    const x1 = x[1] ?? 0;
    const dfdx0 = -2.0 * (1.0 - x0) - 400.0 * x0 * (x1 - x0 * x0);
    const dfdx1 = 200.0 * (x1 - x0 * x0);
    return [dfdx0, dfdx1];
  };

  const evalConstraints = (_x: number[]) => [];
  const evalJacobian = (_x: number[]) => [];

  const result = solver.ipopt(
    nVars,
    nConstraints,
    x0,
    varLB,
    varUB,
    conLB,
    conUB,
    evalObjective,
    evalGradient,
    evalConstraints,
    evalJacobian,
    0,
    { tolerance: 1e-4, maxIterations: 1000 },
  );

  console.log(
    `  IPOPT WASM result: status=${result.status}, obj=${result.objectiveValue.toExponential(4)}, x=[${result.solution.map((v) => v.toFixed(4)).join(", ")}]`,
  );
  assert.strictEqual(result.status, 0, "IPOPT WASM must report optimal status 0");
  assert(result.objectiveValue < 0.05, `Objective should approach 0, got ${result.objectiveValue}`);
  assert(Math.abs(result.solution[0]! - 1.0) < 0.35, "x[0] should approach 1.0");
  assert(Math.abs(result.solution[1]! - 1.0) < 0.35, "x[1] should approach 1.0");
});

test("COIN-OR WASM: Native WebAssembly CLP Linear Programming solve", async () => {
  const solver = await loadCoinorWasm();

  // Problem:
  //   min -3*x0 - 2*x1
  //   s.t.
  //     x0 + x1 <= 4    (-inf <= x0 + x1 <= 4)
  //     x0 + 3*x1 <= 6  (-inf <= x0 + 3*x1 <= 6)
  //     x0, x1 >= 0
  // Optimal vertex: x* = [4, 0] with obj* = -12.0 (or [3, 1] with obj = -11)
  const lpProblem: LpProblem = {
    nVars: 2,
    nConstraints: 2,
    objCoeffs: [-3.0, -2.0],
    varLB: [0.0, 0.0],
    varUB: [100.0, 100.0],
    conLB: [-1e20, -1e20],
    conUB: [4.0, 6.0],
    A: {
      values: [1.0, 1.0, 1.0, 3.0],
      rowIndices: [0, 1, 0, 1],
      colPointers: [0, 2, 4],
    },
  };

  const lpRes = solver.clp(lpProblem);
  console.log(
    `  CLP WASM result: status=${lpRes.status}, obj=${lpRes.objectiveValue.toFixed(4)}, x=[${lpRes.solution.map((v) => v.toFixed(4)).join(", ")}]`,
  );
  assert.strictEqual(lpRes.status, 0, "CLP WASM must report optimal status 0");
  assert(lpRes.objectiveValue <= -11.0, `Objective should be <= -11.0, got ${lpRes.objectiveValue}`);
});

test("COIN-OR WASM: Native WebAssembly CBC Mixed-Integer Linear Programming solve", async () => {
  const solver = await loadCoinorWasm();

  const milpProblem: LpProblem = {
    nVars: 2,
    nConstraints: 1,
    objCoeffs: [-5.0, -4.0],
    varLB: [0.0, 0.0],
    varUB: [10.0, 10.0],
    conLB: [-1e20],
    conUB: [5.0],
    A: {
      values: [1.0, 1.0],
      rowIndices: [0, 0],
      colPointers: [0, 1, 2],
    },
    isInteger: [true, true],
  };

  const milpRes = solver.cbc(milpProblem);
  console.log(
    `  CBC WASM result: status=${milpRes.status}, obj=${milpRes.objectiveValue.toFixed(4)}, x=[${milpRes.solution.map((v) => v.toFixed(4)).join(", ")}]`,
  );
  assert.strictEqual(milpRes.status, 0);
  assert.strictEqual(Number.isInteger(milpRes.solution[0]!), true, "x0 must be integer");
  assert.strictEqual(Number.isInteger(milpRes.solution[1]!), true, "x1 must be integer");
});

test("COIN-OR WASM: IpoptSolver integration with native WebAssembly backend", async () => {
  const wasmSolver = await loadCoinorWasm();
  const solver = new IpoptSolver("ipopt.wasm", wasmSolver);

  const res = await solver.solve(
    2,
    1,
    [2.0, 2.0],
    [-10.0, -10.0],
    [10.0, 10.0],
    [2.0],
    [2.0],
    (x) => Math.pow(x[0]!, 2) + Math.pow(x[1]!, 2),
    (x) => [2 * x[0]!, 2 * x[1]!],
    (x) => [x[0]! + x[1]!],
    (_x) => [1.0, 1.0],
    2,
    { tolerance: 1e-4 },
  );

  console.log(
    `  IpoptSolver backend: ${res.backend}, obj=${res.objectiveValue.toFixed(4)}, x=[${res.variables.solution.map((v) => v.toFixed(4)).join(", ")}]`,
  );
  assert.strictEqual(res.backend, "wasm-ipopt", "Must execute with native wasm-ipopt backend");
  assert.strictEqual(res.status, "SUCCESS");
  assert(Math.abs(res.objectiveValue - 2.0) < 0.1, `Optimal obj should be 2.0 (at x=[1,1]), got ${res.objectiveValue}`);
});
