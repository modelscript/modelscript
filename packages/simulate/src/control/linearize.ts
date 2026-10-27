// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — Index-1 DAE Steady-State Trim & State-Space Linearization.
 *
 * Extracts Linear Time-Invariant (LTI) State-Space representations:
 *   dx/dt = A x + B u
 *   y     = C x + D u
 * directly from a `DAEBuilder` linear-memory arena using exact forward-mode
 * dual-number automatic differentiation (`evaluateArenaDualExpression`) and
 * block Schur-complement / augmented descriptor pencil elimination:
 *
 *   [ J_{dx}   J_z ] [ dx_dot ] = [ -J_x   -J_u ] [ dx ]
 *                    [   dz   ]                   [ du ]
 */

import {
  Causality,
  DAEBuilder,
  Dual,
  EqKind,
  ExprKind,
  Variability,
  evaluateArenaDualExpression,
  hasArrayEquations,
  scalarizeArena,
} from "@modelscript/runtime";

// ─────────────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface OperatingPoint {
  /** Evaluation time t0 (default: 0.0). */
  time?: number | undefined;
  /** State values x0 by state variable name. */
  states?: Record<string, number> | undefined;
  /** Algebraic variable values z0 by variable name. */
  algebraics?: Record<string, number> | undefined;
  /** Input values u0 by input variable name. */
  inputs?: Record<string, number> | undefined;
  /** State derivative values dx0 by state variable name (default: 0 for equilibrium). */
  stateDerivatives?: Record<string, number> | undefined;
}

export interface TrimOptions {
  /** Initial guess for the operating point. */
  initialGuess?: OperatingPoint | undefined;
  /** State or algebraic variables to hold fixed at their initial/specified values during trim. */
  fixedVariables?: string[] | undefined;
  /** Maximum damped Newton-Raphson iterations (default: 50). */
  maxIterations?: number | undefined;
  /** Residual L-infinity convergence tolerance (default: 1e-9). */
  tolerance?: number | undefined;
  /** Levenberg-Marquardt regularization for singular/integrator states (default: 1e-10). */
  regularization?: number | undefined;
}

export type ResolvedOperatingPoint = {
  [K in keyof OperatingPoint]-?: NonNullable<OperatingPoint[K]>;
};

export interface TrimResult {
  /** Whether the steady-state trim converged within tolerance. */
  converged: boolean;
  /** Number of Newton iterations taken. */
  iterations: number;
  /** Final maximum absolute equation residual. */
  maxResidual: number;
  /** Converged operating point (states, algebraics, inputs, stateDerivatives=0). */
  operatingPoint: ResolvedOperatingPoint;
}

export interface LinearizeOptions {
  /** Operating point around which to linearize. If omitted, uses start values or runs steady-state solve if `findEquilibrium` is true. */
  operatingPoint?: OperatingPoint | undefined;
  /** Automatically solve for steady-state trim (dx/dt = 0, g(x,z,u) = 0) before linearizing (default: false). */
  findEquilibrium?: boolean | undefined;
  /** Explicit list of input variable names. Defaults to all Causality.Input variables in the arena. */
  inputNames?: string[] | undefined;
  /** Explicit list of output variable names. Defaults to all Causality.Output variables (or all states if none are marked Output). */
  outputNames?: string[] | undefined;
  /** Explicit list of state variable names. Defaults to all variables appearing inside `der(...)`. */
  stateNames?: string[] | undefined;
}

export interface LtiStateSpaceModel {
  /** Number of continuous states (n). */
  nStates: number;
  /** Number of control inputs (m). */
  nInputs: number;
  /** Number of measured outputs (p). */
  nOutputs: number;
  /** Number of eliminated algebraic variables (n_z). */
  nAlgebraics: number;
  /** Ordered state variable names (length n). */
  stateNames: string[];
  /** Ordered input variable names (length m). */
  inputNames: string[];
  /** Ordered output variable names (length p). */
  outputNames: string[];
  /** Ordered algebraic variable names (length n_z). */
  algebraicNames: string[];
  /** State matrix A in R^{n x n} (row-major). */
  A: Float64Array;
  /** Input matrix B in R^{n x m} (row-major). */
  B: Float64Array;
  /** Output matrix C in R^{p x n} (row-major). */
  C: Float64Array;
  /** Feedthrough matrix D in R^{p x m} (row-major). */
  D: Float64Array;
  /** Algebraic-to-state sensitivity matrix K_{zx} = dz/dx in R^{n_z x n} (row-major). */
  Kzx: Float64Array;
  /** Algebraic-to-input sensitivity matrix K_{zu} = dz/du in R^{n_z x m} (row-major). */
  Kzu: Float64Array;
  /** Operating point at which the model was linearized. */
  operatingPoint: ResolvedOperatingPoint;
  /** Estimated condition number / reciprocal pivot metric of the DAE pencil [J_dx, J_z]. */
  pencilConditionMetric: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal DAE Partitioning & Dense Linear Algebra Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface DaeStructurePartition {
  dae: DAEBuilder;
  stateNames: string[];
  algebraicNames: string[];
  inputNames: string[];
  outputNames: string[];
  parameterNames: string[];
  equations: { lhsExprId: number; rhsExprId: number }[];
}

function collectDerVariables(dae: DAEBuilder, exprId: number, out: Set<string>): void {
  if (exprId < 0 || exprId === 0xffffffff) return;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Der) {
    const argId = dae.getExprData1(exprId);
    if (argId >= 0 && dae.getExprKind(argId) === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(argId));
      if (name) out.add(name);
    }
    return;
  }
  const left = dae.getExprLeft(exprId);
  const right = dae.getExprRight(exprId);
  if (left >= 0 && left !== 0xffffffff && left !== exprId) collectDerVariables(dae, left, out);
  if (right >= 0 && right !== 0xffffffff && right !== exprId) collectDerVariables(dae, right, out);
  if (kind === ExprKind.Call) {
    const argCount = dae.getExprRight(exprId);
    for (let i = 1; i < argCount; i++) {
      const argNode = dae.getExprLeft(exprId + i);
      if (argNode >= 0 && argNode !== 0xffffffff) collectDerVariables(dae, argNode, out);
    }
  } else if (kind === ExprKind.IfElse) {
    const condId = dae.getExprData1(exprId);
    if (condId >= 0 && condId !== 0xffffffff) collectDerVariables(dae, condId, out);
  }
}

function partitionArenaDae(rawDae: DAEBuilder, options?: LinearizeOptions): DaeStructurePartition {
  let dae = rawDae;
  if (hasArrayEquations(dae)) {
    dae = scalarizeArena(dae, true);
  }

  const equations: { lhsExprId: number; rhsExprId: number }[] = [];
  const detectedStates = new Set<string>();

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind !== EqKind.Simple) continue;
    const lhsExprId = dae.getEqLhs(i);
    const rhsExprId = dae.getEqRhs(i);
    if (lhsExprId < 0 || rhsExprId < 0) continue;
    equations.push({ lhsExprId, rhsExprId });
    collectDerVariables(dae, lhsExprId, detectedStates);
    collectDerVariables(dae, rhsExprId, detectedStates);
  }

  const stateNames: string[] = options?.stateNames ? [...options.stateNames] : [];
  const stateSet = new Set<string>(stateNames);

  const inputNames: string[] = options?.inputNames ? [...options.inputNames] : [];
  const inputSet = new Set<string>(inputNames);

  const defaultOutputs: string[] = [];
  const parameterNames: string[] = [];
  const candidateAlgebraics: string[] = [];

  // Preserve declaration order from DAEBuilder
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const name = dae.getVarName(i);
    if (!name || name === "time" || name.startsWith("der(")) continue;

    const variability = dae.getVarVariability(i);
    const causality = dae.getVarCausality(i);

    if (variability === Variability.Parameter || variability === Variability.Constant) {
      parameterNames.push(name);
      continue;
    }

    if (causality === Causality.Output) {
      defaultOutputs.push(name);
    }

    if (!options?.inputNames && causality === Causality.Input) {
      if (!inputSet.has(name)) {
        inputNames.push(name);
        inputSet.add(name);
      }
      continue;
    }
    if (inputSet.has(name)) {
      continue;
    }

    if (!options?.stateNames && detectedStates.has(name)) {
      if (!stateSet.has(name)) {
        stateNames.push(name);
        stateSet.add(name);
      }
      continue;
    }
    if (stateSet.has(name)) {
      continue;
    }

    if (variability === Variability.Continuous) {
      candidateAlgebraics.push(name);
    }
  }

  // Include any detected states that weren't in the var table
  if (!options?.stateNames) {
    for (const s of detectedStates) {
      if (!stateSet.has(s) && !inputSet.has(s)) {
        stateNames.push(s);
        stateSet.add(s);
      }
    }
  }

  const outputNames =
    options?.outputNames && options.outputNames.length > 0
      ? [...options.outputNames]
      : defaultOutputs.length > 0
        ? defaultOutputs
        : [...stateNames];

  return {
    dae,
    stateNames,
    algebraicNames: candidateAlgebraics,
    inputNames,
    outputNames,
    parameterNames,
    equations,
  };
}

/**
 * Populate initial Dual environment from variable start/binding values and OperatingPoint overrides.
 */
function buildInitialOperatingPoint(
  partition: DaeStructurePartition,
  op?: OperatingPoint,
): {
  resolvedOp: ResolvedOperatingPoint;
  baseValues: Map<string, number>;
} {
  const { dae, stateNames, algebraicNames, inputNames, parameterNames } = partition;
  const baseValues = new Map<string, number>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const name = dae.getVarName(i);
    if (!name) continue;
    const startVal = dae.getVarStartValue(i) ?? 0;
    baseValues.set(name, Number.isFinite(startVal) ? startVal : 0);
  }

  // Evaluate constant/parameter bindings in declaration order
  const dualEnv = new Map<number, Dual>();
  for (const [k, v] of baseValues) {
    dualEnv.set(dae.interner.intern(k), Dual.constant(v));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const v = dae.getVarVariability(i);
      if (v === Variability.Parameter || v === Variability.Constant) {
        const exprId = dae.getVarExpression(i);
        const name = dae.getVarName(i);
        if (exprId !== undefined && exprId >= 0 && name) {
          const val = evaluateArenaDualExpression(dae, exprId, dualEnv);
          if (val && Number.isFinite(val.val)) {
            baseValues.set(name, val.val);
            dualEnv.set(dae.interner.intern(name), Dual.constant(val.val));
          }
        }
      }
    }
  }

  const states: Record<string, number> = {};
  for (const s of stateNames) {
    states[s] = op?.states?.[s] ?? baseValues.get(s) ?? 0;
    baseValues.set(s, states[s]!);
  }

  const algebraics: Record<string, number> = {};
  for (const z of algebraicNames) {
    algebraics[z] = op?.algebraics?.[z] ?? baseValues.get(z) ?? 0;
    baseValues.set(z, algebraics[z]!);
  }

  const inputs: Record<string, number> = {};
  for (const u of inputNames) {
    inputs[u] = op?.inputs?.[u] ?? baseValues.get(u) ?? 0;
    baseValues.set(u, inputs[u]!);
  }

  const stateDerivatives: Record<string, number> = {};
  for (const s of stateNames) {
    stateDerivatives[s] = op?.stateDerivatives?.[s] ?? 0;
    baseValues.set(`der(${s})`, stateDerivatives[s]!);
  }

  for (const p of parameterNames) {
    if (!baseValues.has(p)) baseValues.set(p, 0);
  }

  const time = op?.time ?? 0;
  baseValues.set("time", time);

  return {
    resolvedOp: { time, states, algebraics, inputs, stateDerivatives },
    baseValues,
  };
}

/**
 * Solve a dense linear system A * X = B with Tikhonov regularization fallback for near-singular pivots.
 * A is n x n (row-major), B is n x m (row-major). Returns X in R^{n x m} and minimum pivot ratio.
 */
export function solveDenseLinearSystem(
  A: Float64Array,
  B: Float64Array,
  n: number,
  m: number,
  regularization: number = 1e-12,
): { X: Float64Array; minPivotRatio: number } {
  if (n === 0) {
    return { X: new Float64Array(0), minPivotRatio: 1.0 };
  }

  const lu = new Float64Array(A);
  const rhs = new Float64Array(B);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  let maxPivot = 0;
  let minPivot = Infinity;

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(lu[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }

    if (maxRow !== k) {
      const tmpP = piv[k]!;
      piv[k] = piv[maxRow]!;
      piv[maxRow] = tmpP;
      for (let j = 0; j < n; j++) {
        const tmp = lu[k * n + j]!;
        lu[k * n + j] = lu[maxRow * n + j]!;
        lu[maxRow * n + j] = tmp;
      }
      for (let j = 0; j < m; j++) {
        const tmp = rhs[k * m + j]!;
        rhs[k * m + j] = rhs[maxRow * m + j]!;
        rhs[maxRow * m + j] = tmp;
      }
    }

    let pivot = lu[k * n + k]!;
    if (Math.abs(pivot) < regularization) {
      pivot = pivot >= 0 ? regularization : -regularization;
      lu[k * n + k] = pivot;
    }

    const absPiv = Math.abs(pivot);
    if (absPiv > maxPivot) maxPivot = absPiv;
    if (absPiv < minPivot) minPivot = absPiv;

    for (let i = k + 1; i < n; i++) {
      const factor = lu[i * n + k]! / pivot;
      lu[i * n + k] = factor;
      for (let j = k + 1; j < n; j++) {
        lu[i * n + j] = lu[i * n + j]! - factor * lu[k * n + j]!;
      }
      for (let j = 0; j < m; j++) {
        rhs[i * m + j] = rhs[i * m + j]! - factor * rhs[k * m + j]!;
      }
    }
  }

  const X = new Float64Array(n * m);
  for (let i = n - 1; i >= 0; i--) {
    const diag = lu[i * n + i]!;
    for (let j = 0; j < m; j++) {
      let sum = rhs[i * m + j]!;
      for (let k = i + 1; k < n; k++) {
        sum -= lu[i * n + k]! * X[k * m + j]!;
      }
      X[i * m + j] = sum / diag;
    }
  }

  const minPivotRatio = maxPivot > 0 ? minPivot / maxPivot : 0;
  return { X, minPivotRatio };
}

/**
 * Evaluate equation residuals r_i = lhs_i - rhs_i and their Jacobian wrt a list of target variable names.
 */
function evaluateResidualsAndJacobian(
  dae: DAEBuilder,
  equations: { lhsExprId: number; rhsExprId: number }[],
  baseValues: Map<string, number>,
  wrtNames: string[],
): { residuals: Float64Array; jacobian: Float64Array } {
  const nEq = equations.length;
  const nCols = wrtNames.length;
  const residuals = new Float64Array(nEq);
  const jacobian = new Float64Array(nEq * nCols);

  const dualEnv: (Dual | undefined)[] = new Array(dae.interner.size + 64);
  for (const [name, val] of baseValues) {
    const id = dae.interner.intern(name);
    dualEnv[id] = Dual.constant(val);
  }

  // Evaluate residuals
  for (let r = 0; r < nEq; r++) {
    const eq = equations[r]!;
    const lhs = evaluateArenaDualExpression(dae, eq.lhsExprId, dualEnv);
    const rhs = evaluateArenaDualExpression(dae, eq.rhsExprId, dualEnv);
    residuals[r] = (lhs?.val ?? 0) - (rhs?.val ?? 0);
  }

  // Evaluate exact forward-mode AD column by column
  for (let c = 0; c < nCols; c++) {
    const varName = wrtNames[c]!;
    const varId = dae.interner.intern(varName);
    const baseVal = baseValues.get(varName) ?? 0;
    dualEnv[varId] = Dual.variable(baseVal);

    for (let r = 0; r < nEq; r++) {
      const eq = equations[r]!;
      const lhs = evaluateArenaDualExpression(dae, eq.lhsExprId, dualEnv);
      const rhs = evaluateArenaDualExpression(dae, eq.rhsExprId, dualEnv);
      const dot = (lhs?.dot ?? 0) - (rhs?.dot ?? 0);
      jacobian[r * nCols + c] = dot;
    }

    dualEnv[varId] = Dual.constant(baseVal);
  }

  return { residuals, jacobian };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: Steady-State Trim & DAE Linearization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Solve for a steady-state operating point (equilibrium trim) where all state derivatives
 * are zero (`der(x) = 0`) and all continuous DAE equations are satisfied (`lhs - rhs = 0`).
 *
 * Uses damped Newton-Raphson with Levenberg-Marquardt regularization so models with
 * cyclic/integrator coordinates or algebraic loops converge reliably.
 */
export function findSteadyStateTrim(rawDae: DAEBuilder, options?: TrimOptions): TrimResult {
  const partition = partitionArenaDae(rawDae);
  const { dae, stateNames, algebraicNames, equations } = partition;
  const { resolvedOp, baseValues } = buildInitialOperatingPoint(partition, options?.initialGuess);

  // Force all state derivatives to 0 for steady-state equilibrium
  for (const s of stateNames) {
    resolvedOp.stateDerivatives[s] = 0;
    baseValues.set(`der(${s})`, 0);
  }

  const fixedSet = new Set(options?.fixedVariables ?? []);
  const freeVars: string[] = [];
  for (const s of stateNames) {
    if (!fixedSet.has(s)) freeVars.push(s);
  }
  for (const z of algebraicNames) {
    if (!fixedSet.has(z)) freeVars.push(z);
  }

  const maxIter = options?.maxIterations ?? 50;
  const tol = options?.tolerance ?? 1e-9;
  const reg = options?.regularization ?? 1e-10;
  const nEq = equations.length;
  const nFree = freeVars.length;

  let maxResidual = 0;
  let iter = 0;

  for (; iter < maxIter; iter++) {
    const { residuals, jacobian } = evaluateResidualsAndJacobian(dae, equations, baseValues, freeVars);

    maxResidual = 0;
    let normSq = 0;
    for (let i = 0; i < nEq; i++) {
      const absR = Math.abs(residuals[i]!);
      if (absR > maxResidual) maxResidual = absR;
      normSq += absR * absR;
    }

    if (maxResidual <= tol || nFree === 0 || nEq === 0) {
      break;
    }

    // Form normal equations (J^T J + reg * I) dx = -J^T r so rectangular or rank-deficient trims work cleanly
    const jtj = new Float64Array(nFree * nFree);
    const jtr = new Float64Array(nFree);
    for (let i = 0; i < nFree; i++) {
      let sumR = 0;
      for (let r = 0; r < nEq; r++) {
        sumR -= jacobian[r * nFree + i]! * residuals[r]!;
      }
      jtr[i] = sumR;

      for (let j = i; j < nFree; j++) {
        let sumJ = 0;
        for (let r = 0; r < nEq; r++) {
          sumJ += jacobian[r * nFree + i]! * jacobian[r * nFree + j]!;
        }
        if (i === j) sumJ += reg;
        jtj[i * nFree + j] = sumJ;
        jtj[j * nFree + i] = sumJ;
      }
    }

    const { X: step } = solveDenseLinearSystem(jtj, jtr, nFree, 1, reg);

    // Backtracking line search on residual L2 norm
    let alpha = 1.0;
    const prevVals = freeVars.map((v) => baseValues.get(v) ?? 0);
    let accepted = false;

    for (let ls = 0; ls < 8; ls++) {
      for (let i = 0; i < nFree; i++) {
        baseValues.set(freeVars[i]!, prevVals[i]! + alpha * step[i]!);
      }
      const { residuals: trialRes } = evaluateResidualsAndJacobian(dae, equations, baseValues, []);
      let trialNormSq = 0;
      for (let i = 0; i < nEq; i++) {
        trialNormSq += trialRes[i]! * trialRes[i]!;
      }
      if (trialNormSq < normSq || ls === 7) {
        accepted = true;
        break;
      }
      alpha *= 0.5;
    }

    if (!accepted) break;
  }

  // Write converged values back into resolvedOp
  for (const s of stateNames) {
    resolvedOp.states[s] = baseValues.get(s) ?? 0;
  }
  for (const z of algebraicNames) {
    resolvedOp.algebraics[z] = baseValues.get(z) ?? 0;
  }

  return {
    converged: maxResidual <= tol,
    iterations: iter,
    maxResidual,
    operatingPoint: resolvedOp,
  };
}

/**
 * Linearize an Index-1 DAE in `DAEBuilder` around an operating point into an explicit
 * LTI state-space model (A, B, C, D) via exact dual-number AD and Schur-complement reduction.
 */
export function linearizeArenaDae(rawDae: DAEBuilder, options?: LinearizeOptions): LtiStateSpaceModel {
  const partition = partitionArenaDae(rawDae, options);
  const { dae, stateNames, algebraicNames, inputNames, outputNames, equations } = partition;

  let opInit = options?.operatingPoint;
  if (options?.findEquilibrium) {
    const trim = findSteadyStateTrim(dae, { initialGuess: opInit });
    opInit = trim.operatingPoint;
  }

  const { resolvedOp, baseValues } = buildInitialOperatingPoint(partition, opInit);

  const n = stateNames.length;
  const nz = algebraicNames.length;
  const m = inputNames.length;
  const p = outputNames.length;
  const nEq = equations.length;
  const nTotalUnknowns = n + nz;

  // If the user didn't run full equilibrium trim, still solve algebraic variables z (and dx_0)
  // consistent with the chosen states x0 and inputs u0 so the Jacobian is evaluated on the constraint manifold.
  if (!options?.findEquilibrium && nTotalUnknowns > 0 && nEq === nTotalUnknowns) {
    const manifoldVars = [...stateNames.map((s) => `der(${s})`), ...algebraicNames];
    for (let iter = 0; iter < 15; iter++) {
      const { residuals, jacobian } = evaluateResidualsAndJacobian(dae, equations, baseValues, manifoldVars);
      let maxR = 0;
      for (let i = 0; i < nEq; i++) maxR = Math.max(maxR, Math.abs(residuals[i]!));
      if (maxR < 1e-10) break;
      const negR = new Float64Array(nEq);
      for (let i = 0; i < nEq; i++) negR[i] = -residuals[i]!;
      const { X: delta } = solveDenseLinearSystem(jacobian, negR, nEq, 1, 1e-12);
      for (let i = 0; i < manifoldVars.length; i++) {
        const vName = manifoldVars[i]!;
        baseValues.set(vName, (baseValues.get(vName) ?? 0) + delta[i]!);
      }
    }
    for (const s of stateNames) {
      resolvedOp.stateDerivatives[s] = baseValues.get(`der(${s})`) ?? 0;
    }
    for (const z of algebraicNames) {
      resolvedOp.algebraics[z] = baseValues.get(z) ?? 0;
    }
  }

  const derNames = stateNames.map((s) => `der(${s})`);
  const allWrt = [...derNames, ...algebraicNames, ...stateNames, ...inputNames];
  const { jacobian: fullJac } = evaluateResidualsAndJacobian(dae, equations, baseValues, allWrt);
  const totalCols = allWrt.length;

  // Construct pencil E = [J_{dx}, J_z] in R^{nEq x (n + nz)} and RHS M = [-J_x, -J_u] in R^{nEq x (n + m)}
  const nRhsCols = n + m;
  const E = new Float64Array(nTotalUnknowns * nTotalUnknowns);
  const M = new Float64Array(nTotalUnknowns * nRhsCols);

  const rowsToUse = Math.min(nEq, nTotalUnknowns);
  for (let r = 0; r < rowsToUse; r++) {
    for (let c = 0; c < n + nz; c++) {
      E[r * nTotalUnknowns + c] = fullJac[r * totalCols + c]!;
    }
    for (let c = 0; c < n; c++) {
      M[r * nRhsCols + c] = -fullJac[r * totalCols + (n + nz + c)]!;
    }
    for (let c = 0; c < m; c++) {
      M[r * nRhsCols + (n + c)] = -fullJac[r * totalCols + (n + nz + n + c)]!;
    }
  }

  // Solve E * [A, B; Kzx, Kzu] = M
  const { X: sol, minPivotRatio } = solveDenseLinearSystem(E, M, nTotalUnknowns, nRhsCols, 1e-12);

  const A = new Float64Array(n * n);
  const B = new Float64Array(n * m);
  const Kzx = new Float64Array(nz * n);
  const Kzu = new Float64Array(nz * m);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i * n + j] = sol[i * nRhsCols + j]!;
    }
    for (let j = 0; j < m; j++) {
      B[i * m + j] = sol[i * nRhsCols + (n + j)]!;
    }
  }

  for (let i = 0; i < nz; i++) {
    const rowIdx = n + i;
    for (let j = 0; j < n; j++) {
      Kzx[i * n + j] = sol[rowIdx * nRhsCols + j]!;
    }
    for (let j = 0; j < m; j++) {
      Kzu[i * m + j] = sol[rowIdx * nRhsCols + (n + j)]!;
    }
  }

  // Assemble C in R^{p x n} and D in R^{p x m} for the requested outputNames
  const C = new Float64Array(p * n);
  const D = new Float64Array(p * m);

  const stateIndexMap = new Map<string, number>();
  stateNames.forEach((s, idx) => stateIndexMap.set(s, idx));

  const algIndexMap = new Map<string, number>();
  algebraicNames.forEach((z, idx) => algIndexMap.set(z, idx));

  const inputIndexMap = new Map<string, number>();
  inputNames.forEach((u, idx) => inputIndexMap.set(u, idx));

  for (let outIdx = 0; outIdx < p; outIdx++) {
    const outName = outputNames[outIdx]!;
    if (stateIndexMap.has(outName)) {
      const sIdx = stateIndexMap.get(outName)!;
      C[outIdx * n + sIdx] = 1.0;
    } else if (algIndexMap.has(outName)) {
      const zIdx = algIndexMap.get(outName)!;
      for (let j = 0; j < n; j++) {
        C[outIdx * n + j] = Kzx[zIdx * n + j]!;
      }
      for (let j = 0; j < m; j++) {
        D[outIdx * m + j] = Kzu[zIdx * m + j]!;
      }
    } else if (inputIndexMap.has(outName)) {
      const uIdx = inputIndexMap.get(outName)!;
      D[outIdx * m + uIdx] = 1.0;
    } else if (outName.startsWith("der(") && outName.endsWith(")")) {
      const innerState = outName.slice(4, -1);
      if (stateIndexMap.has(innerState)) {
        const sIdx = stateIndexMap.get(innerState)!;
        for (let j = 0; j < n; j++) C[outIdx * n + j] = A[sIdx * n + j]!;
        for (let j = 0; j < m; j++) D[outIdx * m + j] = B[sIdx * m + j]!;
      }
    }
  }

  return {
    nStates: n,
    nInputs: m,
    nOutputs: p,
    nAlgebraics: nz,
    stateNames,
    inputNames,
    outputNames,
    algebraicNames,
    A,
    B,
    C,
    D,
    Kzx,
    Kzu,
    operatingPoint: resolvedOp,
    pencilConditionMetric: minPivotRatio,
  };
}
