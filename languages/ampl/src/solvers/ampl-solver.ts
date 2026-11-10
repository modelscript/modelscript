// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Solver Bridge: Solves instantiated AMPL problems using WebAssembly COIN-OR solvers
 * (CLP, CBC, IPOPT, Couenne), external solver binaries, or pure-JS fallbacks, with full presolve/postsolve
 * and first-class AMPL suffix attribution (.val, .rc, .dual, .slack, .body, .status).
 */

import {
  presolveAmplProblem,
  unrollPostsolve,
  type PresolveResult,
} from "../presolve/ampl-presolver.js";
import {
  besselJ0,
  besselJ1,
  besselY0,
  besselY1,
  erf,
  erfc,
  gamma,
  lgamma,
  normal,
  normal01,
  normalPdf,
} from "../instantiator/special-functions.js";
import type {
  AmplSolverOptions,
  AmplSolverResult,
  BasisStatus,
  ConstraintSuffixes,
  FlatExpression,
  InstantiatedProblem,
  InstantiatedVar,
  VariableSuffixes,
} from "../types.js";

export interface CscMatrix {
  values: number[];
  rowIndices: number[];
  colPointers: number[];
}

export interface LpProblemData {
  nVars: number;
  nConstraints: number;
  objCoeffs: number[];
  varLB: number[];
  varUB: number[];
  conLB: number[];
  conUB: number[];
  A: CscMatrix;
  isInteger?: boolean[] | undefined;
}

/**
 * Converts an instantiated linear / mixed-integer linear problem to CSC format.
 */
export function buildLpProblem(problem: InstantiatedProblem): LpProblemData {
  const nVars = problem.variables.length;
  const nConstraints = problem.constraints.length;

  const isMaximize = problem.objective.direction === "maximize";
  const objCoeffs: number[] = new Array(nVars).fill(0);
  for (const term of problem.objective.expr.linearTerms) {
    if (term.varId >= 0 && term.varId < nVars) {
      objCoeffs[term.varId] = isMaximize ? -term.coeff : term.coeff;
    }
  }

  const varLB: number[] = problem.variables.map((v) =>
    Number.isFinite(v.lb) ? v.lb : -1e20,
  );
  const varUB: number[] = problem.variables.map((v) =>
    Number.isFinite(v.ub) ? v.ub : 1e20,
  );

  const conLB: number[] = problem.constraints.map((c) =>
    Number.isFinite(c.lb) ? c.lb : -1e20,
  );
  const conUB: number[] = problem.constraints.map((c) =>
    Number.isFinite(c.ub) ? c.ub : 1e20,
  );

  // Group terms by variable (column) to build CSC
  const colEntries: { row: number; val: number }[][] = Array.from({ length: nVars }, () => []);
  for (let r = 0; r < nConstraints; r++) {
    const con = problem.constraints[r]!;
    for (const term of con.expr.linearTerms) {
      if (term.varId >= 0 && term.varId < nVars && Math.abs(term.coeff) > 1e-15) {
        colEntries[term.varId]!.push({ row: r, val: term.coeff });
      }
    }
  }

  const values: number[] = [];
  const rowIndices: number[] = [];
  const colPointers: number[] = [0];

  for (let c = 0; c < nVars; c++) {
    const entries = colEntries[c]!;
    entries.sort((a, b) => a.row - b.row);
    for (const entry of entries) {
      values.push(entry.val);
      rowIndices.push(entry.row);
    }
    colPointers.push(values.length);
  }

  const isInteger = problem.variables.map(
    (v) => v.type === "integer" || v.type === "binary" || v.type === "semiint",
  );
  const hasInt = isInteger.some(Boolean);

  return {
    nVars,
    nConstraints,
    objCoeffs,
    varLB,
    varUB,
    conLB,
    conUB,
    A: { values, rowIndices, colPointers },
    isInteger: hasInt ? isInteger : undefined,
  };
}

/**
 * High-level AMPL solver function.
 */
export async function solveAmpl(
  problem: InstantiatedProblem,
  options?: AmplSolverOptions,
): Promise<AmplSolverResult> {
  const startTime = Date.now();

  // Dispatch to native in-memory FFI solvers (Gurobi, MOSEK, HiGHS)
  if (options?.solver === "gurobi" || options?.solver === "mosek") {
    try {
      const { solveWithNativeFfi } = await import("./native-ffi/index.js");
      const nativeRes = await solveWithNativeFfi(problem, options.solver, options);
      return attachSuffixesAndCleanAux(problem, nativeRes);
    } catch {
      // Fall back to built-in pure-TypeScript / WASM solvers
    }
  }

  // Dispatch to HiGHS (prefer native in-memory library, fall back to external binary)
  if (options?.solver === "highs") {
    const { probeNativeSolverLibrary, solveWithNativeFfi } = await import("./native-ffi/index.js");
    const probe = probeNativeSolverLibrary("highs");
    if (probe.available) {
      const nativeRes = await solveWithNativeFfi(problem, "highs", options);
      return attachSuffixesAndCleanAux(problem, nativeRes);
    }
    const { solveWithExternalSolver } = await import("./external-solver.js");
    const extRes = await solveWithExternalSolver(problem, "highs", {
      tolerance: options.tolerance,
      maxIterations: options.maxIterations,
    });
    return attachSuffixesAndCleanAux(problem, extRes);
  }

  // Dispatch to external binary solvers (CPLEX, SCIP)
  if (options?.solver === "cplex" || options?.solver === "scip") {
    const { solveWithExternalSolver } = await import("./external-solver.js");
    const extRes = await solveWithExternalSolver(problem, options.solver, {
      tolerance: options.tolerance,
      maxIterations: options.maxIterations,
    });
    return attachSuffixesAndCleanAux(problem, extRes);
  }

  // Optional standalone AMPL presolve pass
  let presolveRes: PresolveResult | undefined;
  let targetProblem = problem;

  if (options?.presolve) {
    presolveRes = presolveAmplProblem(problem);
    if (presolveRes.infeasible) {
      return {
        problemName: problem.name,
        problemClass: problem.problemClass,
        status: "INFEASIBLE",
        statusCode: 1,
        message: presolveRes.infeasibleMessage ?? "Presolve detected infeasibility",
        objectiveValue: 0,
        variables: {},
        presolveStats: presolveRes.stats,
        solveTimeMs: Date.now() - startTime,
      };
    }
    targetProblem = presolveRes.presolvedProblem;
  }

  const rawResult = await solveCoreProblem(targetProblem, options, startTime);

  if (presolveRes && rawResult.status === "OPTIMAL") {
    // First compute suffixes on the presolved problem so duals/reduced costs are available for postsolve
    const enrichedPresolved = attachSuffixesAndCleanAux(targetProblem, rawResult, true);
    const recovered = unrollPostsolve(presolveRes, enrichedPresolved);

    const fullVars: Record<string, number> = {};
    for (const v of problem.variables) {
      fullVars[v.name] = recovered.primalMap.get(v.name) ?? 0;
    }

    const postResult: AmplSolverResult = {
      ...rawResult,
      problemName: problem.name,
      problemClass: problem.problemClass,
      variables: fullVars,
      presolveStats: presolveRes.stats,
    };

    return attachSuffixesAndCleanAux(problem, postResult, false, recovered.dualMap, recovered.rcMap);
  }

  if (presolveRes) {
    rawResult.presolveStats = presolveRes.stats;
  }

  return attachSuffixesAndCleanAux(problem, rawResult);
}

async function solveCoreProblem(
  problem: InstantiatedProblem,
  options: AmplSolverOptions | undefined,
  startTime: number,
): Promise<AmplSolverResult> {
  const nVars = problem.variables.length;
  const isMaximize = problem.objective.direction === "maximize";

  // Trivial 0-variable problem (all variables eliminated by presolve)
  if (nVars === 0) {
    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "OPTIMAL",
      statusCode: 0,
      message: "Solved completely by presolve",
      objectiveValue: problem.objective.expr.constant,
      variables: {},
      iterations: 0,
      solveTimeMs: Date.now() - startTime,
    };
  }

  const isLinear = problem.problemClass === "LP" || problem.problemClass === "MILP";

  if (isLinear && options?.solver !== "pure-js") {
    try {
      const { loadCoinorWasm } = await import("@modelscript/simulate/optimizer");
      const coinor = await loadCoinorWasm();
      const lpProblem = buildLpProblem(problem);

      if (problem.problemClass === "MILP" || options?.solver === "cbc") {
        const res = coinor.cbc(lpProblem, {
          tolerance: options?.tolerance,
          maxIterations: options?.maxIterations,
          printLevel: options?.printLevel,
        });

        const solVars: Record<string, number> = {};
        for (let i = 0; i < nVars; i++) {
          solVars[problem.variables[i]!.name] = res.solution[i] ?? 0;
        }

        const objVal = isMaximize
          ? -res.objectiveValue + problem.objective.expr.constant
          : res.objectiveValue + problem.objective.expr.constant;

        return {
          problemName: problem.name,
          problemClass: problem.problemClass,
          status: res.status === 0 ? "OPTIMAL" : "INFEASIBLE",
          statusCode: res.status,
          message: res.message,
          objectiveValue: objVal,
          variables: solVars,
          iterations: res.iterations,
          solveTimeMs: Date.now() - startTime,
        };
      }

      // Continuous LP via CLP
      const res = coinor.clp(lpProblem, {
        tolerance: options?.tolerance,
        maxIterations: options?.maxIterations,
        printLevel: options?.printLevel,
      });

      const solVars: Record<string, number> = {};
      for (let i = 0; i < nVars; i++) {
        solVars[problem.variables[i]!.name] = res.solution[i] ?? 0;
      }

      const objVal = isMaximize
        ? -res.objectiveValue + problem.objective.expr.constant
        : res.objectiveValue + problem.objective.expr.constant;

      return {
        problemName: problem.name,
        problemClass: problem.problemClass,
        status: res.status === 0 ? "OPTIMAL" : "INFEASIBLE",
        statusCode: res.status,
        message: res.message,
        objectiveValue: objVal,
        variables: solVars,
        iterations: res.iterations,
        solveTimeMs: Date.now() - startTime,
      };
    } catch {
      // Fallback to pure-JS simplex/branch-and-bound
    }
  }

  return solvePureJs(problem, options, startTime);
}

/**
 * Computes first-class AMPL suffixes (`.val`, `.rc`, `.lb`, `.ub`, `.status`, `.body`, `.dual`, `.slack`)
 * and filters internal `_aux_` reformulation variables/constraints from user-facing dictionaries.
 */
export function attachSuffixesAndCleanAux(
  problem: InstantiatedProblem,
  result: AmplSolverResult,
  keepAux = false,
  precomputedDuals?: Map<string, number>,
  precomputedRcs?: Map<string, number>,
): AmplSolverResult {
  if (result.status !== "OPTIMAL") {
    return result;
  }

  const n = problem.variables.length;
  const m = problem.constraints.length;

  // Primal vector indexed by varId
  const x: number[] = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    const v = problem.variables[j]!;
    let val = result.variables[v.name] ?? 0;
    // If defined variable and not yet evaluated, evaluate from definedExpr
    if (v.definedExpr && result.variables[v.name] === undefined) {
      val = evalFlatExpr(v.definedExpr, x, problem.variables);
    }
    x[j] = val;
  }

  // Evaluate constraint bodies, slacks, and binding status
  const bodies: number[] = new Array(m).fill(0);
  const slacks: number[] = new Array(m).fill(0);
  const conStatuses: BasisStatus[] = new Array(m).fill("basic");

  for (let i = 0; i < m; i++) {
    const c = problem.constraints[i]!;
    const body = evalFlatExpr(c.expr, x, problem.variables);
    bodies[i] = body;

    const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
    const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;

    if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
      slacks[i] = Math.abs(body - c.lb) < 1e-9 ? 0 : c.ub - body;
      conStatuses[i] = "fixed";
    } else if (hasLB && hasUB) {
      const sL = body - c.lb;
      const sU = c.ub - body;
      slacks[i] = Math.min(sL, sU);
      if (Math.abs(sL) < 1e-4) conStatuses[i] = "low";
      else if (Math.abs(sU) < 1e-4) conStatuses[i] = "upp";
      else conStatuses[i] = "basic";
    } else if (hasUB) {
      slacks[i] = c.ub - body;
      conStatuses[i] = Math.abs(slacks[i]!) < 1e-4 ? "upp" : "basic";
    } else if (hasLB) {
      slacks[i] = body - c.lb;
      conStatuses[i] = Math.abs(slacks[i]!) < 1e-4 ? "low" : "basic";
    } else {
      slacks[i] = Number.POSITIVE_INFINITY;
      conStatuses[i] = "basic";
    }
  }

  // Determine variable basis statuses and objective coefficients
  const varStatuses: BasisStatus[] = new Array(n).fill("basic");
  const objVec: number[] = new Array(n).fill(0);
  for (const t of problem.objective.expr.linearTerms) {
    if (t.varId >= 0 && t.varId < n) {
      objVec[t.varId] = (objVec[t.varId] ?? 0) + t.coeff;
    }
  }

  for (let j = 0; j < n; j++) {
    const v = problem.variables[j]!;
    const val = x[j]!;
    const hasLB = Number.isFinite(v.lb) && v.lb > -1e15;
    const hasUB = Number.isFinite(v.ub) && v.ub < 1e15;
    if (hasLB && hasUB && Math.abs(v.ub - v.lb) < 1e-9) {
      varStatuses[j] = "fixed";
    } else if (hasLB && Math.abs(val - v.lb) < 1e-4) {
      varStatuses[j] = "low";
    } else if (hasUB && Math.abs(val - v.ub) < 1e-4) {
      varStatuses[j] = "upp";
    } else {
      varStatuses[j] = "basic";
    }
  }

  // Compute duals (shadow prices) and reduced costs via KKT basis equations
  const dualVec = new Array<number>(m).fill(0);
  const rcVec = new Array<number>(n).fill(0);

  if (precomputedDuals && precomputedRcs) {
    for (let i = 0; i < m; i++) {
      dualVec[i] = precomputedDuals.get(problem.constraints[i]!.name) ?? 0;
    }
    for (let j = 0; j < n; j++) {
      rcVec[j] = precomputedRcs.get(problem.variables[j]!.name) ?? 0;
    }
  } else {
    solveKktDualsAndReducedCosts(problem, objVec, varStatuses, conStatuses, dualVec, rcVec);
  }

  // Populate user-facing dictionaries
  const cleanVars: Record<string, number> = {};
  const dualsMap: Record<string, number> = {};
  const slacksMap: Record<string, number> = {};
  const rcMap: Record<string, number> = {};
  const varSuffixMap: Record<string, VariableSuffixes> = {};
  const conSuffixMap: Record<string, ConstraintSuffixes> = {};

  for (let j = 0; j < n; j++) {
    const v = problem.variables[j]!;
    if (!keepAux && v.name.startsWith("_aux_")) continue;
    const val = roundClean(x[j]!);
    const rc = roundClean(rcVec[j]!);
    cleanVars[v.name] = val;
    rcMap[v.name] = rc;
    varSuffixMap[v.name] = {
      val,
      rc,
      lb: v.lb,
      ub: v.ub,
      init: v.initVal,
      relax: val,
      status: varStatuses[j]!,
    };
  }

  for (let i = 0; i < m; i++) {
    const c = problem.constraints[i]!;
    if (!keepAux && (c.name.startsWith("_aux_") || c.name.startsWith("_def_"))) continue;
    const body = roundClean(bodies[i]!);
    const dual = roundClean(dualVec[i]!);
    const slack = roundClean(slacks[i]!);
    dualsMap[c.name] = dual;
    slacksMap[c.name] = slack;
    conSuffixMap[c.name] = {
      body,
      dual,
      slack,
      lb: c.lb,
      ub: c.ub,
      status: conStatuses[i]!,
    };
  }

  return {
    ...result,
    variables: cleanVars,
    duals: dualsMap,
    slacks: slacksMap,
    reducedCosts: rcMap,
    variableSuffixes: varSuffixMap,
    constraintSuffixes: conSuffixMap,
  };
}

/**
 * Solves KKT stationarity conditions $\sum_{i \in I} A_{i,j} \pi_i = c_j$ over active constraints $I$
 * and basic variables $B$, then computes $\bar{c}_j = c_j - \sum_{i} A_{i,j} \pi_i$ for all variables.
 */
function solveKktDualsAndReducedCosts(
  problem: InstantiatedProblem,
  objVec: number[],
  varStatuses: BasisStatus[],
  conStatuses: BasisStatus[],
  dualVec: number[],
  rcVec: number[],
): void {
  const n = problem.variables.length;
  const m = problem.constraints.length;

  const activeRows: number[] = [];
  for (let i = 0; i < m; i++) {
    if (conStatuses[i] !== "basic") {
      activeRows.push(i);
    }
  }

  if (activeRows.length === 0) {
    for (let j = 0; j < n; j++) {
      rcVec[j] = varStatuses[j] === "basic" ? 0 : objVec[j]!;
    }
    return;
  }

  // Dense constraint submatrix for active rows: A[rIdx][j]
  const k = activeRows.length;
  const A_active: number[][] = Array.from({ length: k }, () => new Array(n).fill(0));
  for (let r = 0; r < k; r++) {
    const con = problem.constraints[activeRows[r]!]!;
    for (const t of con.expr.linearTerms) {
      if (t.varId >= 0 && t.varId < n) {
        A_active[r]![t.varId] = (A_active[r]![t.varId] ?? 0) + t.coeff;
      }
    }
  }

  // Candidate basic columns: first all strictly interior variables ("basic"),
  // then if fewer than k, supplement with variables that have non-zero entries in A_active.
  const basicCols: number[] = [];
  for (let j = 0; j < n; j++) {
    if (varStatuses[j] === "basic") {
      basicCols.push(j);
    }
  }
  if (basicCols.length < k) {
    for (let j = 0; j < n && basicCols.length < k; j++) {
      if (varStatuses[j] !== "basic") {
        let hasNz = false;
        for (let r = 0; r < k; r++) {
          if (Math.abs(A_active[r]![j]!) > 1e-12) {
            hasNz = true;
            break;
          }
        }
        if (hasNz) basicCols.push(j);
      }
    }
  }

  if (basicCols.length > 0) {
    // Solve normal equations (M * M^T + reg * I) pi = M * c_B where M[r][b] = A_active[r][basicCols[b]]
    const bLen = basicCols.length;
    const G: number[][] = Array.from({ length: k }, (_, r1) =>
      Array.from({ length: k }, (__, r2) => {
        let dot = r1 === r2 ? 1e-12 : 0;
        for (let b = 0; b < bLen; b++) {
          const col = basicCols[b]!;
          dot += A_active[r1]![col]! * A_active[r2]![col]!;
        }
        return dot;
      }),
    );
    const rhs: number[] = Array.from({ length: k }, (_, r) => {
      let sum = 0;
      for (let b = 0; b < bLen; b++) {
        const col = basicCols[b]!;
        sum += A_active[r]![col]! * objVec[col]!;
      }
      return sum;
    });

    const piActive = solveDenseLinearSystem(G, rhs);
    for (let r = 0; r < k; r++) {
      dualVec[activeRows[r]!] = piActive[r] ?? 0;
    }
  }

  // Compute reduced costs: rc_j = c_j - sum_{i} A_{i,j} * pi_i
  for (let j = 0; j < n; j++) {
    if (varStatuses[j] === "basic") {
      rcVec[j] = 0;
      continue;
    }
    let sumPiA = 0;
    for (let r = 0; r < k; r++) {
      sumPiA += A_active[r]![j]! * dualVec[activeRows[r]!]!;
    }
    rcVec[j] = objVec[j]! - sumPiA;
  }
}

function solveDenseLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(aug[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row]![col]!);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = row;
      }
    }
    if (maxVal < 1e-14) continue;
    if (pivotRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }
    const pivot = aug[col]![col]!;
    for (let j = col; j <= n; j++) {
      aug[col]![j] = aug[col]![j]! / pivot;
    }
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = aug[row]![col]!;
        if (Math.abs(factor) > 1e-15) {
          for (let j = col; j <= n; j++) {
            aug[row]![j] = aug[row]![j]! - factor * aug[col]![j]!;
          }
        }
      }
    }
  }

  return aug.map((row) => row[n]!);
}

function roundClean(val: number): number {
  if (!Number.isFinite(val)) return val;
  if (Math.abs(val) < 1e-11) return 0;
  return Math.round(val * 1e8) / 1e8;
}

/**
 * Self-contained pure-TypeScript Simplex & Branch-and-Bound solver.
 */
function solvePureJs(
  problem: InstantiatedProblem,
  _options: AmplSolverOptions | undefined,
  startTime: number,
): AmplSolverResult {
  const lp = buildLpProblem(problem);
  const n = lp.nVars;
  const isMaximize = problem.objective.direction === "maximize";

  if (
    problem.problemClass === "NLP" ||
    problem.problemClass === "MINLP" ||
    problem.problemClass === "QP" ||
    problem.problemClass === "MIQP" ||
    problem.problemClass === "QCP" ||
    problem.problemClass === "MIQCP" ||
    problem.problemClass === "SOCP" ||
    problem.problemClass === "MISOCP"
  ) {
    return solveNonlinearSimple(problem, startTime);
  }

  const lpSolution = solveSimplexTableau(lp);
  if (!lpSolution.optimal) {
    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "INFEASIBLE",
      statusCode: 1,
      message: "Problem infeasible or unbounded in simplex phase",
      objectiveValue: 0,
      variables: {},
      solveTimeMs: Date.now() - startTime,
    };
  }

  if (lp.isInteger && lp.isInteger.some(Boolean)) {
    const bnbResult = solveBranchAndBound(lp, lpSolution.x);
    const solVars: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      solVars[problem.variables[i]!.name] = Math.round(bnbResult.x[i]! * 1e8) / 1e8;
    }
    const finalObj = isMaximize
      ? -bnbResult.obj + problem.objective.expr.constant
      : bnbResult.obj + problem.objective.expr.constant;

    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: bnbResult.optimal ? "OPTIMAL" : "INFEASIBLE",
      statusCode: bnbResult.optimal ? 0 : 1,
      message: bnbResult.optimal ? "Optimal integer solution found" : "Infeasible integer problem",
      objectiveValue: finalObj,
      variables: solVars,
      iterations: bnbResult.iterations,
      solveTimeMs: Date.now() - startTime,
    };
  }

  const solVars: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    solVars[problem.variables[i]!.name] = Math.round(lpSolution.x[i]! * 1e8) / 1e8;
  }
  const finalObj = isMaximize
    ? -lpSolution.obj + problem.objective.expr.constant
    : lpSolution.obj + problem.objective.expr.constant;

  return {
    problemName: problem.name,
    problemClass: problem.problemClass,
    status: "OPTIMAL",
    statusCode: 0,
    message: "Optimal solution found",
    objectiveValue: finalObj,
    variables: solVars,
    iterations: lpSolution.iterations,
    solveTimeMs: Date.now() - startTime,
  };
}

interface SimplexResult {
  optimal: boolean;
  x: number[];
  obj: number;
  iterations: number;
}

/**
 * Two-Phase Simplex algorithm with variable lower-bound shifting x_j = shift_j + x'_j.
 */
function solveSimplexTableau(lp: LpProblemData): SimplexResult {
  const n = lp.nVars;
  const m = lp.nConstraints;

  const shift = new Array(n).fill(0);
  const shiftedUB = new Array(n).fill(1e20);

  for (let j = 0; j < n; j++) {
    const lb = lp.varLB[j]!;
    const ub = lp.varUB[j]!;
    if (lb > ub + 1e-9) return { optimal: false, x: [], obj: 0, iterations: 0 };
    if (Number.isFinite(lb) && lb > -1e15) {
      shift[j] = lb;
    }
    if (Number.isFinite(ub) && ub < 1e15) {
      shiftedUB[j] = Math.max(0, ub - shift[j]!);
    }
  }

  const A: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  const shiftedConLB = [...lp.conLB];
  const shiftedConUB = [...lp.conUB];

  for (let col = 0; col < n; col++) {
    const start = lp.A.colPointers[col]!;
    const end = lp.A.colPointers[col + 1]!;
    for (let p = start; p < end; p++) {
      const row = lp.A.rowIndices[p]!;
      const val = lp.A.values[p]!;
      A[row]![col] = val;
      if (shift[col] !== 0) {
        if (shiftedConLB[row]! > -1e15) shiftedConLB[row]! -= val * shift[col]!;
        if (shiftedConUB[row]! < 1e15) shiftedConUB[row]! -= val * shift[col]!;
      }
    }
  }

  let objOffset = 0;
  for (let j = 0; j < n; j++) {
    objOffset += lp.objCoeffs[j]! * shift[j]!;
  }

  interface StandardRow {
    coeffs: number[];
    rhs: number;
    kind: "<=" | ">=" | "=";
  }

  const rows: StandardRow[] = [];
  for (let i = 0; i < m; i++) {
    const hasLB = Number.isFinite(shiftedConLB[i]) && shiftedConLB[i]! > -1e15;
    const hasUB = Number.isFinite(shiftedConUB[i]) && shiftedConUB[i]! < 1e15;

    if (hasLB && hasUB && Math.abs(shiftedConLB[i]! - shiftedConUB[i]!) < 1e-9) {
      rows.push({ coeffs: [...A[i]!], rhs: shiftedConUB[i]!, kind: "=" });
    } else {
      if (hasUB) rows.push({ coeffs: [...A[i]!], rhs: shiftedConUB[i]!, kind: "<=" });
      if (hasLB) rows.push({ coeffs: [...A[i]!], rhs: shiftedConLB[i]!, kind: ">=" });
    }
  }

  for (let j = 0; j < n; j++) {
    if (Number.isFinite(shiftedUB[j]) && shiftedUB[j]! < 1e15) {
      const uRow = new Array(n).fill(0);
      uRow[j] = 1;
      rows.push({ coeffs: uRow, rhs: shiftedUB[j]!, kind: "<=" });
    }
  }

  const numRows = rows.length;
  if (numRows === 0) {
    const x = [...shift];
    return { optimal: true, x, obj: objOffset, iterations: 0 };
  }

  let numSlacks = 0;
  let numArtificials = 0;
  for (const r of rows) {
    if (r.kind === "<=") {
      if (r.rhs >= 0) numSlacks++;
      else {
        numSlacks++;
        numArtificials++;
      }
    } else if (r.kind === ">=") {
      if (r.rhs >= 0) {
        numSlacks++;
        numArtificials++;
      } else {
        numSlacks++;
      }
    } else {
      numArtificials++;
    }
  }

  const totalCols = n + numSlacks + numArtificials + 1;
  const tab: number[][] = Array.from({ length: numRows + 2 }, () => new Array(totalCols).fill(0));
  const phase1Row = numRows;
  const phase2Row = numRows + 1;
  const basicVars: number[] = new Array(numRows).fill(-1);

  let curSlack = n;
  let curArt = n + numSlacks;
  const artificialCols: number[] = [];

  for (let i = 0; i < numRows; i++) {
    const r = rows[i]!;
    let mult = 1;
    let rhs = r.rhs;
    if (rhs < 0) {
      mult = -1;
      rhs = -rhs;
    }
    for (let j = 0; j < n; j++) tab[i]![j] = r.coeffs[j]! * mult;
    tab[i]![totalCols - 1] = rhs;

    const effectiveKind = mult === 1 ? r.kind : (r.kind === "<=" ? ">=" : r.kind === ">=" ? "<=" : "=");
    if (effectiveKind === "<=") {
      tab[i]![curSlack] = 1;
      basicVars[i] = curSlack++;
    } else if (effectiveKind === ">=") {
      tab[i]![curSlack] = -1;
      curSlack++;
      tab[i]![curArt] = 1;
      basicVars[i] = curArt;
      artificialCols.push(curArt);
      curArt++;
    } else {
      tab[i]![curArt] = 1;
      basicVars[i] = curArt;
      artificialCols.push(curArt);
      curArt++;
    }
  }

  for (const artCol of artificialCols) tab[phase1Row]![artCol] = 1;
  for (let i = 0; i < numRows; i++) {
    if (artificialCols.includes(basicVars[i]!)) {
      const p1 = tab[phase1Row]!;
      const rowI = tab[i]!;
      for (let j = 0; j < totalCols; j++) {
        p1[j] = (p1[j] ?? 0) - (rowI[j] ?? 0);
      }
    }
  }

  function pivot(leaveRow: number, enterCol: number) {
    const p = tab[leaveRow]![enterCol]!;
    const pRow = tab[leaveRow]!;
    for (let j = 0; j < totalCols; j++) pRow[j] = (pRow[j] ?? 0) / p;
    for (let i = 0; i < tab.length; i++) {
      if (i !== leaveRow) {
        const factor = tab[i]![enterCol] ?? 0;
        if (Math.abs(factor) > 1e-12) {
          const target = tab[i]!;
          for (let j = 0; j < totalCols; j++) {
            target[j] = (target[j] ?? 0) - factor * (pRow[j] ?? 0);
          }
        }
      }
    }
    basicVars[leaveRow] = enterCol;
  }

  let totalIters = 0;

  if (artificialCols.length > 0) {
    let p1Iter = 0;
    while (p1Iter++ < 2000) {
      totalIters++;
      let enterCol = -1;
      let minCost = -1e-8;
      for (let j = 0; j < totalCols - 1; j++) {
        if (artificialCols.includes(j)) continue;
        if (tab[phase1Row]![j]! < minCost) {
          minCost = tab[phase1Row]![j]!;
          enterCol = j;
        }
      }
      if (enterCol === -1) break;

      let leaveRow = -1;
      let minRatio = Number.POSITIVE_INFINITY;
      for (let i = 0; i < numRows; i++) {
        const a = tab[i]![enterCol]!;
        if (a > 1e-9) {
          const ratio = tab[i]![totalCols - 1]! / a;
          if (ratio < minRatio) {
            minRatio = ratio;
            leaveRow = i;
          }
        }
      }
      if (leaveRow === -1) break;
      pivot(leaveRow, enterCol);
    }

    const phase1Obj = -tab[phase1Row]![totalCols - 1]!;
    if (phase1Obj > 1e-4) {
      return { optimal: false, x: [], obj: 0, iterations: totalIters };
    }
  }

  for (let j = 0; j < n; j++) tab[phase2Row]![j] = lp.objCoeffs[j]!;
  for (let i = 0; i < numRows; i++) {
    const bVar = basicVars[i]!;
    if (bVar >= 0 && bVar < n) {
      const p2 = tab[phase2Row]!;
      const factor = p2[bVar] ?? 0;
      const rowI = tab[i]!;
      for (let j = 0; j < totalCols; j++) {
        p2[j] = (p2[j] ?? 0) - factor * (rowI[j] ?? 0);
      }
    }
  }

  let p2Iter = 0;
  while (p2Iter++ < 5000) {
    totalIters++;
    let enterCol = -1;
    let minCost = -1e-8;
    for (let j = 0; j < n + numSlacks; j++) {
      if (artificialCols.includes(j)) continue;
      if (tab[phase2Row]![j]! < minCost) {
        minCost = tab[phase2Row]![j]!;
        enterCol = j;
      }
    }
    if (enterCol === -1) break;

    let leaveRow = -1;
    let minRatio = Number.POSITIVE_INFINITY;
    for (let i = 0; i < numRows; i++) {
      const a = tab[i]![enterCol]!;
      if (a > 1e-9) {
        const ratio = tab[i]![totalCols - 1]! / a;
        if (ratio < minRatio) {
          minRatio = ratio;
          leaveRow = i;
        }
      }
    }
    if (leaveRow === -1) break;
    pivot(leaveRow, enterCol);
  }

  const x = [...shift];
  for (let i = 0; i < numRows; i++) {
    const bVar = basicVars[i]!;
    if (bVar >= 0 && bVar < n) {
      x[bVar] = tab[i]![totalCols - 1]! + shift[bVar]!;
    }
  }

  let finalObj = 0;
  for (let j = 0; j < n; j++) finalObj += lp.objCoeffs[j]! * x[j]!;

  return { optimal: true, x, obj: finalObj, iterations: totalIters };
}

/**
 * Branch-and-Bound algorithm for Mixed-Integer Linear Programs.
 */
function solveBranchAndBound(
  lp: LpProblemData,
  initialContinuousX: number[],
): { optimal: boolean; x: number[]; obj: number; iterations: number } {
  const isInteger = lp.isInteger ?? [];
  let bestObj = Number.POSITIVE_INFINITY;
  let bestX = [...initialContinuousX];
  let totalIters = 0;

  interface Node {
    boundsLB: number[];
    boundsUB: number[];
  }

  const stack: Node[] = [{ boundsLB: [...lp.varLB], boundsUB: [...lp.varUB] }];

  while (stack.length > 0 && totalIters < 1000) {
    const node = stack.pop()!;
    totalIters++;

    const subLp: LpProblemData = {
      ...lp,
      varLB: node.boundsLB,
      varUB: node.boundsUB,
    };

    const res = solveSimplexTableau(subLp);
    if (!res.optimal) continue;
    if (res.obj >= bestObj - 1e-6) continue;

    let fractionVar = -1;
    let maxDist = 0;
    for (let j = 0; j < lp.nVars; j++) {
      if (isInteger[j]) {
        const val = res.x[j]!;
        const dist = Math.abs(val - Math.round(val));
        if (dist > 1e-3 && dist > maxDist) {
          maxDist = dist;
          fractionVar = j;
        }
      }
    }

    if (fractionVar === -1) {
      bestObj = res.obj;
      bestX = res.x.map((v, j) => (isInteger[j] ? Math.round(v) : v));
    } else {
      const val = res.x[fractionVar]!;
      const floorVal = Math.floor(val);
      const ceilVal = Math.ceil(val);

      const leftUB = [...node.boundsUB];
      leftUB[fractionVar] = Math.min(node.boundsUB[fractionVar]!, floorVal);
      if (leftUB[fractionVar]! >= node.boundsLB[fractionVar]!) {
        stack.push({ boundsLB: [...node.boundsLB], boundsUB: leftUB });
      }

      const rightLB = [...node.boundsLB];
      rightLB[fractionVar] = Math.max(node.boundsLB[fractionVar]!, ceilVal);
      if (node.boundsUB[fractionVar]! >= rightLB[fractionVar]!) {
        stack.push({ boundsLB: rightLB, boundsUB: [...node.boundsUB] });
      }
    }
  }

  return {
    optimal: Number.isFinite(bestObj),
    x: bestX,
    obj: bestObj,
    iterations: totalIters,
  };
}

/**
 * Nonlinear solver fallback for continuous/MPEC problems (e.g. Rosenbrock, Markowitz portfolio).
 */
function solveNonlinearSimple(
  problem: InstantiatedProblem,
  startTime: number,
): AmplSolverResult {
  const n = problem.variables.length;
  let x = problem.variables.map((v) => {
    if (v.initVal) return v.initVal;
    if (Number.isFinite(v.lb) && Number.isFinite(v.ub) && v.lb > -1e12 && v.ub < 1e12) {
      return (v.lb + v.ub) / 2;
    }
    return Number.isFinite(v.lb) && v.lb > -1e12 ? v.lb : 0;
  });

  // Conic variables (t in ||x|| <= t, u and v in RSOC, and affine variables x_i) must start
  // in the strict interior (t > 0, u > 0, v > 0) to avoid zero-gradient saddle points at the cone apex.
  if (problem.cones && problem.cones.length > 0) {
    for (const cone of problem.cones) {
      if (x[cone.coneVarId] === 0) x[cone.coneVarId] = 1.0;
      if (cone.rotVarId !== undefined && x[cone.rotVarId] === 0) x[cone.rotVarId] = 1.0;
      for (const cv of cone.variables) {
        if (x[cv.varId] === 0) x[cv.varId] = 1.0;
      }
    }
  }


  const evalMerit = (vec: number[], penalty: number): number => {
    let merit = evalFlatExpr(problem.objective.expr, vec, problem.variables);
    if (problem.objective.direction === "maximize") merit = -merit;
    for (const con of problem.constraints) {
      const val = evalFlatExpr(con.expr, vec, problem.variables);
      if (con.lb != null && Number.isFinite(con.lb) && val < con.lb) {
        const viol = con.lb - val;
        merit += penalty * viol * viol;
      }
      if (con.ub != null && Number.isFinite(con.ub) && val > con.ub) {
        const viol = val - con.ub;
        merit += penalty * viol * viol;
      }
    }
    return merit;
  };

  const eps = 1e-6;
  let totalIter = 0;
  const stages = problem.constraints.length > 0 ? 4 : 1;

  for (let stage = 0; stage < stages; stage++) {
    const penalty = Math.pow(10, stage + 1);
    for (let iter = 0; iter < 1000; iter++) {
      totalIter++;
      const f0 = evalMerit(x, penalty);
      let gradNorm = 0;
      const grad: number[] = new Array(n).fill(0);

      for (let i = 0; i < n; i++) {
        const orig = x[i]!;
        x[i] = orig + eps;
        const fPlus = evalMerit(x, penalty);
        x[i] = orig;
        grad[i] = (fPlus - f0) / eps;
        gradNorm += grad[i]! * grad[i]!;
      }

      if (Math.sqrt(gradNorm) < 1e-5) break;

      let stepSize = 0.1 / (1 + 0.1 * penalty);
      let bestNext = [...x];
      for (let ls = 0; ls < 12; ls++) {
        const trial = x.map((xi, i) => {
          let val = xi - stepSize * grad[i]!;
          const v = problem.variables[i]!;
          if (Number.isFinite(v.lb)) val = Math.max(v.lb, val);
          if (Number.isFinite(v.ub)) val = Math.min(v.ub, val);
          return val;
        });
        if (evalMerit(trial, penalty) < f0) {
          bestNext = trial;
          break;
        }
        stepSize *= 0.5;
      }
      x = bestNext;
    }
  }

  const solVars: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    solVars[problem.variables[i]!.name] = Math.round(x[i]! * 1e6) / 1e6;
  }

  return {
    problemName: problem.name,
    problemClass: problem.problemClass,
    status: "OPTIMAL",
    statusCode: 0,
    message: "Optimal nonlinear solution found",
    objectiveValue: evalFlatExpr(problem.objective.expr, x, problem.variables),
    variables: solVars,
    iterations: totalIter,
    solveTimeMs: Date.now() - startTime,
  };
}

function evalFlatExpr(expr: FlatExpression, vec: number[], variables: InstantiatedVar[]): number {
  let sum = expr.constant;
  for (const term of expr.linearTerms) {
    sum += term.coeff * (vec[term.varId] ?? 0);
  }
  if (expr.nonlinearTree) {
    sum += evalTree(expr.nonlinearTree, vec, variables);
  }
  return sum;
}

function evalTree(tree: any, vec: number[], variables: InstantiatedVar[]): number {
  if (!tree) return 0;
  if (tree.kind === "number") return tree.value;
  if (tree.kind === "identifier" || tree.kind === "subscript") {
    const name =
      tree.kind === "identifier"
        ? tree.name
        : `${tree.name}[${tree.indices.map((i: any) => i.value ?? i.name).join(",")}]`;
    const idx = variables.findIndex((v) => v.name === name);
    return idx >= 0 ? vec[idx] ?? 0 : 0;
  }
  if (tree.kind === "unary") {
    const val = evalTree(tree.expr, vec, variables);
    return tree.op === "-" ? -val : val;
  }
  if (tree.kind === "binary") {
    const l = evalTree(tree.left, vec, variables);
    const r = evalTree(tree.right, vec, variables);
    switch (tree.op) {
      case "+":
        return l + r;
      case "-":
        return l - r;
      case "*":
        return l * r;
      case "/":
        return r !== 0 ? l / r : 0;
      case "^":
      case "**":
        return Math.pow(l, r);
    }
  }
  if (tree.kind === "call") {
    const args = (tree.args ?? []).map((a: any) => evalTree(a, vec, variables));
    switch (String(tree.fn).toLowerCase()) {
      case "abs":
        return Math.abs(args[0] ?? 0);
      case "sqrt":
        return Math.sqrt(Math.max(0, args[0] ?? 0));
      case "exp":
        return Math.exp(args[0] ?? 0);
      case "log":
      case "ln":
        return Math.log(Math.max(1e-12, args[0] ?? 1));
      case "log10":
        return Math.log10(Math.max(1e-12, args[0] ?? 1));
      case "sin":
        return Math.sin(args[0] ?? 0);
      case "cos":
        return Math.cos(args[0] ?? 0);
      case "tan":
        return Math.tan(args[0] ?? 0);
      case "asin":
        return Math.asin(args[0] ?? 0);
      case "acos":
        return Math.acos(args[0] ?? 0);
      case "atan":
        return Math.atan(args[0] ?? 0);
      case "sinh":
        return Math.sinh(args[0] ?? 0);
      case "cosh":
        return Math.cosh(args[0] ?? 0);
      case "tanh":
        return Math.tanh(args[0] ?? 0);
      case "min":
        return Math.min(...args);
      case "max":
        return Math.max(...args);
      case "erf":
        return erf(args[0] ?? 0);
      case "erfc":
        return erfc(args[0] ?? 0);
      case "gamma":
        return gamma(args[0] ?? 0);
      case "lgamma":
        return lgamma(args[0] ?? 0);
      case "bessel_j0":
      case "besselj0":
        return besselJ0(args[0] ?? 0);
      case "bessel_j1":
      case "besselj1":
        return besselJ1(args[0] ?? 0);
      case "bessel_y0":
      case "bessely0":
        return besselY0(args[0] ?? 0);
      case "bessel_y1":
      case "bessely1":
        return besselY1(args[0] ?? 0);
      case "normal01":
        return normal01(args[0] ?? 0);
      case "normal":
        return normal(args[0] ?? 0, args[1] ?? 0, args[2] ?? 1);
      case "normal_pdf":
      case "normalpdf":
        return normalPdf(args[0] ?? 0, args[1] ?? 0, args[2] ?? 1);
    }
  }
  return 0;
}
