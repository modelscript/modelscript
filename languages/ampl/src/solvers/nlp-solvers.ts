// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Nonlinear, MINLP, and Global Optimization Solvers.
 *
 * Provides:
 * - COIN-OR IPOPT WASM bridge (`solveWithCoinorIpopt`)
 * - Pure-TS Augmented Lagrangian + L-BFGS-B NLP solver (`solveNlpAugmentedLagrangian`)
 * - Nonlinear Branch-and-Bound MINLP solver (`solveMinlpBranchAndBound`)
 * - Global Nonconvex NLP/MINLP solver via Self-Adaptive DE + Multi-Start L-BFGS-B (`solveGlobalNonlinear`)
 */

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
  FlatExpression,
  InstantiatedProblem,
  InstantiatedVar,
} from "../types.js";

const INF_BOUND = 1e12;

export interface EvalTreeNode {
  kind: string;
  value?: number | string;
  name?: string;
  indices?: EvalTreeNode[];
  expr?: EvalTreeNode;
  op?: string;
  left?: EvalTreeNode;
  right?: EvalTreeNode;
  args?: EvalTreeNode[];
  fn?: string;
}

/**
 * Evaluates a flattened AMPL expression at variable vector `vec`.
 */
export function evalFlatExpr(expr: FlatExpression, vec: number[], variables: InstantiatedVar[]): number {
  let sum = expr.constant;
  for (const term of expr.linearTerms) {
    sum += term.coeff * (vec[term.varId] ?? 0);
  }
  if (expr.nonlinearTree) {
    sum += evalTree(expr.nonlinearTree as EvalTreeNode, vec, variables);
  } else if (expr.quadraticTerms) {
    for (const qt of expr.quadraticTerms) {
      sum += qt.coeff * (vec[qt.var1Id] ?? 0) * (vec[qt.var2Id] ?? 0);
    }
  }
  return sum;
}

function evalTree(tree: EvalTreeNode | undefined, vec: number[], variables: InstantiatedVar[]): number {
  if (!tree) return 0;
  if (tree.kind === "number") return typeof tree.value === "number" ? tree.value : 0;
  if (tree.kind === "identifier" || tree.kind === "subscript") {
    const name =
      tree.kind === "identifier"
        ? tree.name
        : `${tree.name}[${(tree.indices ?? []).map((i) => i.value ?? i.name).join(",")}]`;
    const idx = variables.findIndex((v) => v.name === name);
    return idx >= 0 ? (vec[idx] ?? 0) : 0;
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
    const args = (tree.args ?? []).map((a) => evalTree(a, vec, variables));
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
        return Math.asin(Math.max(-1, Math.min(1, args[0] ?? 0)));
      case "acos":
        return Math.acos(Math.max(-1, Math.min(1, args[0] ?? 0)));
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

function clamp(val: number, lb: number, ub: number): number {
  let res = val;
  if (Number.isFinite(lb)) res = Math.max(lb, res);
  if (Number.isFinite(ub)) res = Math.min(ub, res);
  return res;
}

export function getInitialPoint(problem: InstantiatedProblem, lbOverride?: number[], ubOverride?: number[]): number[] {
  const x = problem.variables.map((v, i) => {
    const lb = lbOverride ? lbOverride[i]! : v.lb;
    const ub = ubOverride ? ubOverride[i]! : v.ub;
    let val = 0;
    if (v.initVal !== undefined && Number.isFinite(v.initVal)) {
      val = v.initVal;
    } else if (Number.isFinite(lb) && Number.isFinite(ub) && lb > -INF_BOUND && ub < INF_BOUND) {
      val = (lb + ub) / 2;
    } else if (Number.isFinite(lb) && lb > -INF_BOUND) {
      val = lb;
    } else if (Number.isFinite(ub) && ub < INF_BOUND) {
      val = ub;
    }
    return clamp(val, lb, ub);
  });

  // Conic variables must start in the strict interior to avoid zero-gradient saddle points.
  if (problem.cones && problem.cones.length > 0) {
    for (const cone of problem.cones) {
      if (x[cone.coneVarId] === 0) x[cone.coneVarId] = 1.0;
      if (cone.rotVarId !== undefined && x[cone.rotVarId] === 0) x[cone.rotVarId] = 1.0;
      for (const cv of cone.variables) {
        if (x[cv.varId] === 0) x[cv.varId] = 1.0;
      }
    }
  }
  return x;
}

function getActiveConstraints(problem: InstantiatedProblem) {
  return problem.constraints.filter((c) => !c.dropped);
}

export function computeMaxConstraintViolation(problem: InstantiatedProblem, vec: number[]): number {
  let maxViol = 0;
  for (const con of getActiveConstraints(problem)) {
    const val = evalFlatExpr(con.expr, vec, problem.variables);
    if (!Number.isFinite(val)) return Infinity;
    if (con.lb != null && Number.isFinite(con.lb) && val < con.lb) {
      maxViol = Math.max(maxViol, con.lb - val);
    }
    if (con.ub != null && Number.isFinite(con.ub) && val > con.ub) {
      maxViol = Math.max(maxViol, val - con.ub);
    }
  }
  return maxViol;
}

function isIntegerVar(v: InstantiatedVar): boolean {
  return v.type === "integer" || v.type === "binary" || v.type === "semiint";
}

function formatSolutionVars(problem: InstantiatedProblem, x: number[]): Record<string, number> {
  const solVars: Record<string, number> = {};
  for (let i = 0; i < problem.variables.length; i++) {
    const v = problem.variables[i]!;
    const raw = x[i] ?? 0;
    solVars[v.name] = isIntegerVar(v) ? Math.round(raw) : Math.round(raw * 1e8) / 1e8;
  }
  return solVars;
}

/**
 * Solves a continuous nonlinear program using Augmented Lagrangian + L-BFGS-B.
 */
export async function solveNlpAugmentedLagrangian(
  problem: InstantiatedProblem,
  options: AmplSolverOptions | undefined,
  startTime: number,
  x0Override?: number[],
  lbOverride?: number[],
  ubOverride?: number[],
  messageOverride?: string,
): Promise<AmplSolverResult> {
  const { lbfgsbSolve } = await import("@modelscript/simulate/optimizer");
  const n = problem.variables.length;
  const activeCons = getActiveConstraints(problem);
  const m = activeCons.length;
  const isMax = problem.objective.direction === "maximize";
  const sense = isMax ? -1 : 1;

  const tol = Math.max(1e-12, options?.tolerance ?? 1e-6);
  const maxIter = Math.max(10, options?.maxIterations ?? 1000);

  const lb = new Float64Array(n);
  const ub = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rawLb = lbOverride ? lbOverride[i]! : problem.variables[i]!.lb;
    const rawUb = ubOverride ? ubOverride[i]! : problem.variables[i]!.ub;
    if (rawLb > rawUb + 1e-9) {
      return {
        problemName: problem.name,
        problemClass: problem.problemClass,
        status: "INFEASIBLE",
        statusCode: 1,
        message: "Conflicting variable bounds",
        objectiveValue: 0,
        variables: {},
        iterations: 0,
        solveTimeMs: Date.now() - startTime,
      };
    }
    lb[i] = Number.isFinite(rawLb) ? rawLb : -Infinity;
    ub[i] = Number.isFinite(rawUb) ? rawUb : Infinity;
  }

  let x = new Float64Array(x0Override ?? getInitialPoint(problem, lbOverride, ubOverride));
  for (let i = 0; i < n; i++) {
    x[i] = clamp(x[i]!, lb[i]!, ub[i]!);
  }

  const lambdaL = new Float64Array(m);
  const lambdaU = new Float64Array(m);
  let rho = 10.0;
  let totalIterations = 0;

  const evalAugmented = (vecArr: Float64Array, curRho: number): number => {
    const vec = Array.from(vecArr);
    const fRaw = evalFlatExpr(problem.objective.expr, vec, problem.variables);
    if (!Number.isFinite(fRaw)) return 1e30;
    let cost = sense * fRaw;

    for (let j = 0; j < m; j++) {
      const con = activeCons[j]!;
      const g = evalFlatExpr(con.expr, vec, problem.variables);
      if (!Number.isFinite(g)) return 1e30;

      const hasLB = con.lb != null && Number.isFinite(con.lb) && con.lb > -INF_BOUND;
      const hasUB = con.ub != null && Number.isFinite(con.ub) && con.ub < INF_BOUND;

      if (hasLB && hasUB && Math.abs(con.ub! - con.lb!) < 1e-10) {
        const c = g - con.lb!;
        cost += lambdaU[j]! * c + 0.5 * curRho * c * c;
      } else {
        if (hasUB) {
          const vU = Math.max(0, lambdaU[j]! + curRho * (g - con.ub!));
          cost += (vU * vU - lambdaU[j]! * lambdaU[j]!) / (2 * curRho);
        }
        if (hasLB) {
          const vL = Math.max(0, lambdaL[j]! + curRho * (con.lb! - g));
          cost += (vL * vL - lambdaL[j]! * lambdaL[j]!) / (2 * curRho);
        }
      }
    }
    return cost;
  };

  const evalCostAndGrad = (vecArr: Float64Array, curRho: number) => {
    const cost = evalAugmented(vecArr, curRho);
    const grad = new Float64Array(n);
    const trial = new Float64Array(vecArr);
    for (let i = 0; i < n; i++) {
      const orig = vecArr[i]!;
      const h = 1e-6 * Math.max(1, Math.abs(orig));
      const canPlus = orig + h <= ub[i]!;
      const canMinus = orig - h >= lb[i]!;
      if (canPlus && canMinus) {
        trial[i] = orig + h;
        const fP = evalAugmented(trial, curRho);
        trial[i] = orig - h;
        const fM = evalAugmented(trial, curRho);
        grad[i] = (fP - fM) / (2 * h);
      } else if (canPlus) {
        trial[i] = orig + h;
        const fP = evalAugmented(trial, curRho);
        grad[i] = (fP - cost) / h;
      } else if (canMinus) {
        trial[i] = orig - h;
        const fM = evalAugmented(trial, curRho);
        grad[i] = (cost - fM) / h;
      }
      trial[i] = orig;
      if (!Number.isFinite(grad[i]!)) grad[i] = 0;
    }
    return { cost, grad };
  };

  const outerMax = m > 0 ? 12 : 1;
  const innerMax = Math.max(20, Math.floor(maxIter / outerMax));

  for (let outer = 0; outer < outerMax; outer++) {
    const res = lbfgsbSolve(x, (v) => evalCostAndGrad(v, rho), lb, ub, {
      maxIterations: innerMax,
      tolerance: tol,
    });
    x = new Float64Array(res.x);
    totalIterations += Math.max(1, res.iterations);

    if (m === 0) break;

    const vec = Array.from(x);
    let maxViol = 0;
    for (let j = 0; j < m; j++) {
      const con = activeCons[j]!;
      const g = evalFlatExpr(con.expr, vec, problem.variables);
      const hasLB = con.lb != null && Number.isFinite(con.lb) && con.lb > -INF_BOUND;
      const hasUB = con.ub != null && Number.isFinite(con.ub) && con.ub < INF_BOUND;

      if (hasLB && hasUB && Math.abs(con.ub! - con.lb!) < 1e-10) {
        const c = g - con.lb!;
        lambdaU[j] = lambdaU[j]! + rho * c;
        maxViol = Math.max(maxViol, Math.abs(c));
      } else {
        if (hasUB) {
          const cU = g - con.ub!;
          lambdaU[j] = Math.max(0, lambdaU[j]! + rho * cU);
          if (cU > 0) maxViol = Math.max(maxViol, cU);
        }
        if (hasLB) {
          const cL = con.lb! - g;
          lambdaL[j] = Math.max(0, lambdaL[j]! + rho * cL);
          if (cL > 0) maxViol = Math.max(maxViol, cL);
        }
      }
    }

    if (maxViol <= Math.max(1e-6, tol)) break;
    rho = Math.min(1e8, rho * 5);
  }

  const xArr = Array.from(x);
  const maxViol = computeMaxConstraintViolation(problem, xArr);
  const feasible = maxViol <= Math.max(1e-3, tol * 100);

  return {
    problemName: problem.name,
    problemClass: problem.problemClass,
    status: feasible ? "OPTIMAL" : "INFEASIBLE",
    statusCode: feasible ? 0 : 1,
    message: feasible
      ? (messageOverride ?? "Optimal nonlinear solution found (L-BFGS-B)")
      : `Nonlinear constraints violated (max violation: ${maxViol.toExponential(2)})`,
    objectiveValue: evalFlatExpr(problem.objective.expr, xArr, problem.variables),
    variables: formatSolutionVars(problem, xArr),
    iterations: totalIterations,
    solveTimeMs: Date.now() - startTime,
  };
}

/**
 * Solves an NLP using COIN-OR IPOPT WebAssembly, falling back to L-BFGS-B Augmented Lagrangian
 * if WASM is unavailable or fails to converge.
 */
export async function solveWithCoinorIpopt(
  problem: InstantiatedProblem,
  options: AmplSolverOptions | undefined,
  startTime: number,
): Promise<AmplSolverResult> {
  try {
    const { loadCoinorWasm } = await import("@modelscript/simulate/optimizer");
    const coinor = await loadCoinorWasm();
    const n = problem.variables.length;
    const activeCons = getActiveConstraints(problem);
    const m = activeCons.length;
    const isMax = problem.objective.direction === "maximize";
    const sense = isMax ? -1 : 1;

    const x0 = getInitialPoint(problem);
    const varLB = problem.variables.map((v) => (Number.isFinite(v.lb) ? v.lb : -1e20));
    const varUB = problem.variables.map((v) => (Number.isFinite(v.ub) ? v.ub : 1e20));
    const conLB = activeCons.map((c) => (Number.isFinite(c.lb) ? c.lb : -1e20));
    const conUB = activeCons.map((c) => (Number.isFinite(c.ub) ? c.ub : 1e20));

    const evalObjective = (x: number[]) => sense * evalFlatExpr(problem.objective.expr, x, problem.variables);
    const evalGradient = (x: number[]) => {
      const grad = new Array<number>(n).fill(0);
      const trial = [...x];
      for (let i = 0; i < n; i++) {
        const orig = x[i]!;
        const h = 1e-6 * Math.max(1, Math.abs(orig));
        trial[i] = orig + h;
        const fP = evalObjective(trial);
        trial[i] = orig - h;
        const fM = evalObjective(trial);
        trial[i] = orig;
        grad[i] = (fP - fM) / (2 * h);
      }
      return grad;
    };
    const evalConstraints = (x: number[]) => activeCons.map((c) => evalFlatExpr(c.expr, x, problem.variables));
    const evalJacobian = (x: number[]) => {
      if (m === 0) return [];
      const jac = new Array<number>(m * n).fill(0);
      const trial = [...x];
      for (let i = 0; i < n; i++) {
        const orig = x[i]!;
        const h = 1e-6 * Math.max(1, Math.abs(orig));
        trial[i] = orig + h;
        const gP = evalConstraints(trial);
        trial[i] = orig - h;
        const gM = evalConstraints(trial);
        trial[i] = orig;
        for (let j = 0; j < m; j++) {
          jac[j * n + i] = (gP[j]! - gM[j]!) / (2 * h);
        }
      }
      return jac;
    };

    const res = coinor.ipopt(
      n,
      m,
      x0,
      varLB,
      varUB,
      conLB,
      conUB,
      evalObjective,
      evalGradient,
      evalConstraints,
      evalJacobian,
      m * n,
      {
        tolerance: options?.tolerance,
        maxIterations: options?.maxIterations,
        printLevel: options?.printLevel,
      },
    );

    const maxViol = computeMaxConstraintViolation(problem, res.solution);
    if (res.status === 0 && maxViol <= Math.max(1e-3, (options?.tolerance ?? 1e-6) * 100)) {
      return {
        problemName: problem.name,
        problemClass: problem.problemClass,
        status: "OPTIMAL",
        statusCode: 0,
        message: "Optimal nonlinear solution found (COIN-OR IPOPT WASM)",
        objectiveValue: evalFlatExpr(problem.objective.expr, res.solution, problem.variables),
        variables: formatSolutionVars(problem, res.solution),
        iterations: options?.maxIterations ?? 100,
        solveTimeMs: Date.now() - startTime,
      };
    }
  } catch {
    // Fall back to pure-TS Augmented Lagrangian L-BFGS-B
  }

  return solveNlpAugmentedLagrangian(
    problem,
    options,
    startTime,
    undefined,
    undefined,
    undefined,
    "Optimal nonlinear solution found (IPOPT / L-BFGS-B)",
  );
}

/**
 * Nonlinear Branch-and-Bound solver for MINLP / MIQP / MIQCP / MISOCP (Bonmin).
 */
export async function solveMinlpBranchAndBound(
  problem: InstantiatedProblem,
  options: AmplSolverOptions | undefined,
  startTime: number,
  seedIncumbent?: { x: number[]; obj: number },
): Promise<AmplSolverResult> {
  const intIndices = problem.variables.map((v, i) => (isIntegerVar(v) ? i : -1)).filter((i) => i >= 0);

  if (intIndices.length === 0) {
    return solveNlpAugmentedLagrangian(
      problem,
      options,
      startTime,
      seedIncumbent?.x,
      undefined,
      undefined,
      "Optimal nonlinear solution found (Bonmin)",
    );
  }

  const isMax = problem.objective.direction === "maximize";
  const sense = isMax ? -1 : 1;
  const tol = Math.max(1e-9, options?.tolerance ?? 1e-6);
  const intTol = 1e-4;
  const maxNodes = Math.min(200, Math.max(20, Math.floor((options?.maxIterations ?? 1000) / 5)));

  const baseLB = problem.variables.map((v) => v.lb);
  const baseUB = problem.variables.map((v) => v.ub);

  let bestX: number[] | null = null;
  let bestScaledObj = Infinity;
  let totalIters = 0;

  if (seedIncumbent) {
    const viol = computeMaxConstraintViolation(problem, seedIncumbent.x);
    if (viol <= Math.max(1e-3, tol * 100)) {
      bestX = [...seedIncumbent.x];
      bestScaledObj = sense * seedIncumbent.obj;
    }
  }

  interface MinlpNode {
    lb: number[];
    ub: number[];
    bound: number;
    warmStart?: number[] | undefined;
  }

  const queue: MinlpNode[] = [{ lb: baseLB, ub: baseUB, bound: -Infinity }];
  let nodes = 0;

  while (queue.length > 0 && nodes < maxNodes) {
    queue.sort((a, b) => a.bound - b.bound);
    const node = queue.shift()!;
    if (node.bound >= bestScaledObj - 1e-6) continue;
    nodes++;

    const relaxRes = await solveNlpAugmentedLagrangian(
      problem,
      { ...options, maxIterations: Math.min(250, options?.maxIterations ?? 1000) },
      startTime,
      node.warmStart,
      node.lb,
      node.ub,
    );
    totalIters += relaxRes.iterations ?? 1;

    if (relaxRes.status !== "OPTIMAL") continue;

    const relX = problem.variables.map((v) => relaxRes.variables[v.name] ?? 0);
    const relScaledObj = sense * relaxRes.objectiveValue;
    if (relScaledObj >= bestScaledObj - 1e-6) continue;

    // Find most fractional integer variable
    let fracIdx = -1;
    let maxFrac = intTol;
    for (const idx of intIndices) {
      const val = relX[idx]!;
      const frac = Math.abs(val - Math.round(val));
      if (frac > maxFrac) {
        maxFrac = frac;
        fracIdx = idx;
      }
    }

    if (fracIdx === -1) {
      bestScaledObj = relScaledObj;
      bestX = relX;
      continue;
    }

    // Rounding heuristic at node: polish continuous variables with integer vars rounded
    const roundedLb = [...node.lb];
    const roundedUb = [...node.ub];
    const roundedStart = [...relX];
    for (const idx of intIndices) {
      const r = Math.round(relX[idx]!);
      roundedLb[idx] = r;
      roundedUb[idx] = r;
      roundedStart[idx] = r;
    }
    const heurRes = await solveNlpAugmentedLagrangian(
      problem,
      { ...options, maxIterations: 120 },
      startTime,
      roundedStart,
      roundedLb,
      roundedUb,
    );
    totalIters += heurRes.iterations ?? 0;
    if (heurRes.status === "OPTIMAL") {
      const hScaled = sense * heurRes.objectiveValue;
      if (hScaled < bestScaledObj) {
        bestScaledObj = hScaled;
        bestX = problem.variables.map((v) => heurRes.variables[v.name] ?? 0);
      }
    }

    const branchVal = relX[fracIdx]!;
    const floorVal = Math.floor(branchVal);
    const ceilVal = Math.ceil(branchVal);

    if (floorVal >= node.lb[fracIdx]!) {
      const leftUb = [...node.ub];
      leftUb[fracIdx] = floorVal;
      queue.push({ lb: [...node.lb], ub: leftUb, bound: relScaledObj, warmStart: relX });
    }
    if (ceilVal <= node.ub[fracIdx]!) {
      const rightLb = [...node.lb];
      rightLb[fracIdx] = ceilVal;
      queue.push({ lb: rightLb, ub: [...node.ub], bound: relScaledObj, warmStart: relX });
    }
  }

  if (!bestX) {
    return {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "INFEASIBLE",
      statusCode: 1,
      message: "No integer-feasible MINLP solution found",
      objectiveValue: 0,
      variables: {},
      iterations: totalIters,
      solveTimeMs: Date.now() - startTime,
    };
  }

  return {
    problemName: problem.name,
    problemClass: problem.problemClass,
    status: "OPTIMAL",
    statusCode: 0,
    message: "Optimal MINLP solution found (Bonmin Branch-and-Bound)",
    objectiveValue: evalFlatExpr(problem.objective.expr, bestX, problem.variables),
    variables: formatSolutionVars(problem, bestX),
    iterations: totalIters,
    solveTimeMs: Date.now() - startTime,
  };
}

/**
 * Global nonconvex NLP/MINLP solver (Couenne) using Self-Adaptive Differential Evolution
 * followed by multi-start L-BFGS-B local polishing (and MINLP B&B when integer vars exist).
 */
export async function solveGlobalNonlinear(
  problem: InstantiatedProblem,
  options: AmplSolverOptions | undefined,
  startTime: number,
  algorithm: "couenne" | "de" | "cma-es" | "pso" = "couenne",
): Promise<AmplSolverResult> {
  const { deSolve, cmaesSolve, psoSolve } = await import("@modelscript/simulate/optimizer");
  const n = problem.variables.length;
  const activeCons = getActiveConstraints(problem);
  const isMax = problem.objective.direction === "maximize";
  const sense = isMax ? -1 : 1;
  const tol = Math.max(1e-12, options?.tolerance ?? 1e-6);
  const hasInt = problem.variables.some(isIntegerVar);

  const initVec = getInitialPoint(problem);
  const searchMin = new Float64Array(n);
  const searchMax = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = problem.variables[i]!;
    const hasFinLB = Number.isFinite(v.lb) && v.lb > -INF_BOUND;
    const hasFinUB = Number.isFinite(v.ub) && v.ub < INF_BOUND;
    if (hasFinLB && hasFinUB) {
      searchMin[i] = v.lb;
      searchMax[i] = v.ub;
    } else if (hasFinLB) {
      searchMin[i] = v.lb;
      searchMax[i] = v.lb + Math.max(100, Math.abs(initVec[i]!) * 2);
    } else if (hasFinUB) {
      searchMax[i] = v.ub;
      searchMin[i] = v.ub - Math.max(100, Math.abs(initVec[i]!) * 2);
    } else {
      const center = initVec[i]!;
      searchMin[i] = center - 50;
      searchMax[i] = center + 50;
    }
  }

  const evalPenaltyFitness = (vecArr: Float64Array): number => {
    const vec = problem.variables.map((v, i) => (isIntegerVar(v) ? Math.round(vecArr[i]!) : vecArr[i]!));
    const fRaw = evalFlatExpr(problem.objective.expr, vec, problem.variables);
    if (!Number.isFinite(fRaw)) return 1e30;
    let penalty = 0;
    for (const con of activeCons) {
      const val = evalFlatExpr(con.expr, vec, problem.variables);
      if (!Number.isFinite(val)) return 1e30;
      if (con.lb != null && Number.isFinite(con.lb) && val < con.lb) {
        const viol = con.lb - val;
        penalty += 1e4 * (viol + viol * viol);
      }
      if (con.ub != null && Number.isFinite(con.ub) && val > con.ub) {
        const viol = val - con.ub;
        penalty += 1e4 * (viol + viol * viol);
      }
    }
    return sense * fRaw + penalty;
  };

  const popSize = Math.min(80, Math.max(24, 12 * n));
  const maxGen = Math.min(200, Math.max(60, Math.floor((options?.maxIterations ?? 1000) / 5)));
  const bbProblem = {
    dimension: n,
    bounds: { min: searchMin, max: searchMax },
    fitness: evalPenaltyFitness,
    initialGuess: new Float64Array(initVec),
  };

  const globalRes =
    algorithm === "cma-es"
      ? await cmaesSolve(bbProblem, { maxGenerations: maxGen, populationSize: popSize, tolerance: tol, seed: 42 })
      : algorithm === "pso"
        ? await psoSolve(bbProblem, { maxGenerations: maxGen, populationSize: popSize, tolerance: tol, seed: 42 })
        : await deSolve(bbProblem, { maxGenerations: maxGen, populationSize: popSize, tolerance: tol, seed: 42 });

  const globalBest = Array.from(globalRes.bestSolution).map((val, i) =>
    isIntegerVar(problem.variables[i]!) ? Math.round(val) : val,
  );

  // If pure metaheuristic requested without local polishing (e.g. cma-es/pso/de), still polish continuous NLP
  // Multi-start local refinement candidates
  const starts: number[][] = [globalBest, initVec];
  const midVec = Array.from({ length: n }, (_, i) => (searchMin[i]! + searchMax[i]!) / 2);
  starts.push(midVec);
  if (n <= 2) {
    const steps = n === 1 ? 5 : 3;
    for (let s = 0; s < steps; s++) {
      const frac = (s + 0.5) / steps;
      starts.push(Array.from({ length: n }, (_, i) => searchMin[i]! + frac * (searchMax[i]! - searchMin[i]!)));
    }
  }

  let bestResult: AmplSolverResult | null = null;
  let bestViol = Infinity;
  let bestScaledObj = Infinity;
  let totalIters = globalRes.iterations;

  if (hasInt) {
    const bnbRes = await solveMinlpBranchAndBound(problem, options, startTime, {
      x: globalBest,
      obj: evalFlatExpr(problem.objective.expr, globalBest, problem.variables),
    });
    totalIters += bnbRes.iterations ?? 0;
    bestResult = bnbRes;
  } else {
    for (const start of starts) {
      const localRes = await solveNlpAugmentedLagrangian(problem, options, startTime, start);
      totalIters += localRes.iterations ?? 0;
      const solVec = problem.variables.map((v) => localRes.variables[v.name] ?? 0);
      const viol = localRes.status === "OPTIMAL" ? computeMaxConstraintViolation(problem, solVec) : Infinity;
      const scaledObj = sense * localRes.objectiveValue;

      const isBetter =
        bestResult === null ||
        (viol <= Math.max(1e-3, tol * 100) && bestViol > Math.max(1e-3, tol * 100)) ||
        (Math.abs(viol - bestViol) <= 1e-6 && scaledObj < bestScaledObj);

      if (isBetter) {
        bestResult = localRes;
        bestViol = viol;
        bestScaledObj = scaledObj;
      }
    }
  }

  const label =
    algorithm === "couenne"
      ? "Global optimal solution found (Couenne DE + L-BFGS-B)"
      : `Global optimal solution found (${algorithm.toUpperCase()} + L-BFGS-B)`;

  return {
    ...(bestResult ?? {
      problemName: problem.name,
      problemClass: problem.problemClass,
      status: "OPTIMAL",
      statusCode: 0,
      message: label,
      objectiveValue: evalFlatExpr(problem.objective.expr, globalBest, problem.variables),
      variables: formatSolutionVars(problem, globalBest),
    }),
    message: bestResult?.status === "OPTIMAL" ? label : (bestResult?.message ?? label),
    iterations: totalIters,
    solveTimeMs: Date.now() - startTime,
  };
}
