// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * @modelscript/simulate/twin — Dimensionally-Guided SINDy Symbolic Equation Discovery.
 *
 * Distills black-box Universal Differential Equation (UDE) neural blocks (`ArenaNeuralBlock`)
 * or raw operational telemetry residuals into sparse, interpretable, dimensionally verified
 * Modelica & `DAEBuilder` symbolic equations using:
 *   1. Multivariate polynomial bases (`MonomialBasis`) + physical nonlinearities (`x*|x|`, `sin`, `cos`, `tanh`, `exp`)
 *   2. ISO 80000 7-vector dimensional homogeneity filtering (`DimensionVector`, `STANDARD_UNITS`)
 *   3. Column-Normalized Sequential Thresholded Least-Squares (STLSQ) with Pareto BIC model selection
 *   4. Direct in-arena lowering into `DAEBuilder` expression trees (`ExprId`)
 */

import {
  ArenaNeuralBlock,
  BinOp,
  DAEBuilder,
  DIMENSION_DIMENSIONLESS,
  EqKind,
  ExprKind,
  MonomialBasis,
  STANDARD_UNITS,
  VarType,
  Variability,
  areDimensionsEqual,
  formatDimension,
  type DimensionVector,
} from "@modelscript/runtime";
import { solveDenseLinearSystem } from "../control/linearize.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface SindyVariableSpec {
  /** Variable identifier (e.g. "v", "theta", "omega"). */
  name: string;
  /** Optional SI unit string (e.g. "m/s", "rad", "N", "K") or explicit 7-element DimensionVector. */
  unit?: string | DimensionVector | undefined;
}

export interface CandidateBasisTerm {
  /** Human-readable symbolic expression (e.g. "v * abs(v)", "sin(theta)"). */
  label: string;
  /** Valid Modelica expression string. */
  modelicaExpr: string;
  /** Physical dimension vector [L, M, T, I, Theta, N, J] of the basis term theta_j(x). */
  dimension: DimensionVector;
  /** True if the basis term is valid under dimensional arguments (e.g., sin/exp only on dimensionless args). */
  dimensionallyValidArg: boolean;
  /** Evaluate this basis term at input vector x. */
  evaluate: (x: Float64Array | number[]) => number;
  /** Construct the corresponding expression node inside a `DAEBuilder` arena. */
  buildArenaExpr: (arena: DAEBuilder) => number;
}

export interface SindyLibraryOptions {
  /** Maximum polynomial total degree from `MonomialBasis` (default: 3). */
  maxPolynomialDegree?: number | undefined;
  /** Include constant bias term `1` (default: true). */
  includeConstant?: boolean | undefined;
  /** Include signed quadratic fluid drag terms `x_i * abs(x_i)` (default: true). */
  includeSignedQuadratic?: boolean | undefined;
  /** Include trigonometric terms `sin(x_i)`, `cos(x_i)` (default: true; restricted to dimensionless/angle variables). */
  includeTrigonometric?: boolean | undefined;
  /** Include smooth Coulomb friction / saturation terms `tanh(x_i)` (default: false). */
  includeHyperbolic?: boolean | undefined;
  /**
   * If true, only candidate terms whose dimension exactly matches the target output dimension
   * (allowing dimensionless coefficients) are retained (default: false — infers coefficient units).
   */
  requireDimensionlessCoefficients?: boolean | undefined;
}

export interface SindyConfig extends SindyLibraryOptions {
  /** Sparsity threshold tau on normalized feature columns (default: 0.05). */
  threshold?: number | undefined;
  /** Optional candidate thresholds to sweep for automatic Pareto BIC selection. */
  thresholdSweep?: number[] | undefined;
  /** Tikhonov / ridge regularization lambda (default: 1e-8). */
  ridgeLambda?: number | undefined;
  /** Maximum STLSQ thresholding iterations (default: 15). */
  maxIterations?: number | undefined;
  /** Minimum absolute coefficient magnitude to retain in final equation (default: 1e-5). */
  minAbsCoefficient?: number | undefined;
}

export interface DiscoveredSymbolicTerm {
  /** Basis term label. */
  termLabel: string;
  /** Learned scalar coefficient xi_j. */
  coefficient: number;
  /** Formatted Modelica product expression (e.g. "-0.45 * v * abs(v)"). */
  modelicaTerm: string;
  /** Physical dimension vector of the basis term. */
  basisDimension: DimensionVector;
  /** Inferred physical dimension vector required for the scalar coefficient xi_j: dim(y) - dim(theta_j). */
  coefficientDimension: DimensionVector;
  /** Formatted SI dimension string for the coefficient (e.g. "[L^-1 · M]"). */
  coefficientDimensionFormatted: string;
  /** Underlying basis term definition. */
  basisTerm: CandidateBasisTerm;
}

export interface DiscoveredChannelEquation {
  /** Target output / residual variable name. */
  outputName: string;
  /** Target output physical dimension. */
  outputDimension: DimensionVector;
  /** Non-zero symbolic terms discovered by STLSQ. */
  terms: DiscoveredSymbolicTerm[];
  /** Complete Modelica equation string (e.g. "F_drag = -1.2 * v - 0.45 * v * abs(v);"). */
  modelicaEquation: string;
  /** Coefficient of determination R^2 on the training samples. */
  r2: number;
  /** Mean Squared Error on the training samples. */
  mse: number;
  /** Bayesian Information Criterion score. */
  bic: number;
  /** Fraction of candidate library terms set to zero (1 - nnz / totalTerms). */
  sparsityRatio: number;
}

export interface SindyDiscoveryResult {
  /** Discovered symbolic equations per output channel. */
  equations: DiscoveredChannelEquation[];
  /** Candidate basis terms evaluated. */
  candidateTerms: CandidateBasisTerm[];
}

export interface NeuralDistillationResult extends SindyDiscoveryResult {
  /** Arena expression IDs synthesized for each output channel. */
  synthesizedExprIds: number[];
  /** Combined Modelica equation block representing the distilled neural block. */
  modelicaPatch: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimensional Algebra Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function resolveDimensionVector(unit?: string | DimensionVector): DimensionVector {
  if (!unit) return [...DIMENSION_DIMENSIONLESS] as DimensionVector;
  if (Array.isArray(unit)) return [...unit] as DimensionVector;
  const trimmed = unit.trim();
  if (STANDARD_UNITS[trimmed]) {
    return [...STANDARD_UNITS[trimmed]!] as DimensionVector;
  }
  // Support basic compound units like "N*s/m", "kg/m", "m^2"
  return [...DIMENSION_DIMENSIONLESS] as DimensionVector;
}

function scaleDimension(d: DimensionVector, power: number): DimensionVector {
  return [d[0] * power, d[1] * power, d[2] * power, d[3] * power, d[4] * power, d[5] * power, d[6] * power];
}

function addDimensions(a: DimensionVector, b: DimensionVector): DimensionVector {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5], a[6] + b[6]];
}

function subtractDimensions(a: DimensionVector, b: DimensionVector): DimensionVector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6]];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Physics-Informed & Dimensionally-Checked Candidate Library Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construct a physics-informed candidate basis library combining graded-lexicographical
 * multivariate monomials (`MonomialBasis`) with physical nonlinear terms (`x*|x|`, `sin`, `cos`, `tanh`).
 *
 * Enforces ISO 80000 dimensional rules: transcendental functions (`sin`, `cos`, `tanh`)
 * are only generated for variables with dimensionless (`[0,0,0,0,0,0,0]`, e.g. `rad`) units.
 */
export function buildPhysicsCandidateLibrary(
  variables: SindyVariableSpec[],
  options?: SindyLibraryOptions,
  targetOutputDimension?: DimensionVector,
): CandidateBasisTerm[] {
  const nVars = variables.length;
  const maxDeg = options?.maxPolynomialDegree ?? 3;
  const includeConstant = options?.includeConstant ?? true;
  const includeSignedQuad = options?.includeSignedQuadratic ?? true;
  const includeTrig = options?.includeTrigonometric ?? true;
  const includeHyp = options?.includeHyperbolic ?? false;
  const requireDimlessCoeff = options?.requireDimensionlessCoefficients ?? false;

  const varDims = variables.map((v) => resolveDimensionVector(v.unit));
  const rawTerms: CandidateBasisTerm[] = [];

  // 1. Multivariate polynomial terms via MonomialBasis
  const basis = MonomialBasis.get(nVars, maxDeg);
  for (let mIdx = 0; mIdx < basis.totalMonomials; mIdx++) {
    const exps = basis.exponents[mIdx]!;
    const deg = basis.degrees[mIdx]!;
    if (deg === 0 && !includeConstant) continue;

    if (deg === 0) {
      rawTerms.push({
        label: "1",
        modelicaExpr: "1.0",
        dimension: [...DIMENSION_DIMENSIONLESS] as DimensionVector,
        dimensionallyValidArg: true,
        evaluate: () => 1.0,
        buildArenaExpr: (arena) => arena.addRealLiteral(1.0),
      });
      continue;
    }

    let dim: DimensionVector = [...DIMENSION_DIMENSIONLESS] as DimensionVector;
    const factors: string[] = [];
    for (let v = 0; v < nVars; v++) {
      const p = exps[v]!;
      if (p > 0) {
        dim = addDimensions(dim, scaleDimension(varDims[v]!, p));
        const vName = variables[v]!.name;
        if (p === 1) factors.push(vName);
        else if (p === 2) factors.push(`${vName} * ${vName}`);
        else factors.push(`${vName} ^ ${p}`);
      }
    }

    const label = factors.join(" * ");
    const expsCopy = [...exps];

    rawTerms.push({
      label,
      modelicaExpr: label,
      dimension: dim,
      dimensionallyValidArg: true,
      evaluate: (x) => {
        let prod = 1.0;
        for (let v = 0; v < nVars; v++) {
          const p = expsCopy[v]!;
          if (p === 1) prod *= x[v] ?? 0;
          else if (p === 2) {
            const xv = x[v] ?? 0;
            prod *= xv * xv;
          } else if (p > 2) {
            prod *= (x[v] ?? 0) ** p;
          }
        }
        return prod;
      },
      buildArenaExpr: (arena) => {
        let exprId = -1;
        for (let v = 0; v < nVars; v++) {
          const p = expsCopy[v]!;
          if (p <= 0) continue;
          const vName = variables[v]!.name;
          let factorId = arena.addNameExpr(vName);
          if (p === 2) {
            factorId = arena.addBinaryExpr(BinOp.Mul, factorId, arena.addNameExpr(vName));
          } else if (p > 2) {
            factorId = arena.addBinaryExpr(BinOp.Pow, factorId, arena.addRealLiteral(p));
          }
          exprId = exprId < 0 ? factorId : arena.addBinaryExpr(BinOp.Mul, exprId, factorId);
        }
        return exprId < 0 ? arena.addRealLiteral(1.0) : exprId;
      },
    });
  }

  // 2. Signed quadratic drag terms: x_i * abs(x_i)
  if (includeSignedQuad) {
    for (let v = 0; v < nVars; v++) {
      const vName = variables[v]!.name;
      const dim = scaleDimension(varDims[v]!, 2);
      const label = `${vName} * abs(${vName})`;
      const vIdx = v;
      rawTerms.push({
        label,
        modelicaExpr: label,
        dimension: dim,
        dimensionallyValidArg: true,
        evaluate: (x) => {
          const val = x[vIdx] ?? 0;
          return val * Math.abs(val);
        },
        buildArenaExpr: (arena) =>
          arena.addBinaryExpr(
            BinOp.Mul,
            arena.addNameExpr(vName),
            arena.addCallExpr("abs", [arena.addNameExpr(vName)]),
          ),
      });
    }
  }

  // 3. Trigonometric terms: sin(x_i), cos(x_i) — only on dimensionless/angle variables
  if (includeTrig) {
    for (let v = 0; v < nVars; v++) {
      const isDimless = areDimensionsEqual(varDims[v]!, DIMENSION_DIMENSIONLESS);
      if (!isDimless) continue;
      const vName = variables[v]!.name;
      const vIdx = v;

      rawTerms.push({
        label: `sin(${vName})`,
        modelicaExpr: `sin(${vName})`,
        dimension: [...DIMENSION_DIMENSIONLESS] as DimensionVector,
        dimensionallyValidArg: true,
        evaluate: (x) => Math.sin(x[vIdx] ?? 0),
        buildArenaExpr: (arena) => arena.addCallExpr("sin", [arena.addNameExpr(vName)]),
      });

      rawTerms.push({
        label: `cos(${vName})`,
        modelicaExpr: `cos(${vName})`,
        dimension: [...DIMENSION_DIMENSIONLESS] as DimensionVector,
        dimensionallyValidArg: true,
        evaluate: (x) => Math.cos(x[vIdx] ?? 0),
        buildArenaExpr: (arena) => arena.addCallExpr("cos", [arena.addNameExpr(vName)]),
      });
    }
  }

  // 4. Hyperbolic saturation terms: tanh(x_i) — only on dimensionless variables
  if (includeHyp) {
    for (let v = 0; v < nVars; v++) {
      const isDimless = areDimensionsEqual(varDims[v]!, DIMENSION_DIMENSIONLESS);
      if (!isDimless) continue;
      const vName = variables[v]!.name;
      const vIdx = v;

      rawTerms.push({
        label: `tanh(${vName})`,
        modelicaExpr: `tanh(${vName})`,
        dimension: [...DIMENSION_DIMENSIONLESS] as DimensionVector,
        dimensionallyValidArg: true,
        evaluate: (x) => Math.tanh(x[vIdx] ?? 0),
        buildArenaExpr: (arena) => arena.addCallExpr("tanh", [arena.addNameExpr(vName)]),
      });
    }
  }

  if (requireDimlessCoeff && targetOutputDimension) {
    return rawTerms.filter((t) => areDimensionsEqual(t.dimension, targetOutputDimension));
  }

  return rawTerms;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Column-Normalized STLSQ Solver with Pareto BIC Selection
// ─────────────────────────────────────────────────────────────────────────────

function solveStlsqSingleThreshold(
  Theta: Float64Array,
  colNorms: Float64Array,
  yCol: Float64Array,
  nSamples: number,
  nTerms: number,
  threshold: number,
  ridgeLambda: number,
  maxIter: number,
): Float64Array {
  // Active support mask
  const active = new Uint8Array(nTerms);
  active.fill(1);

  const coeffs = new Float64Array(nTerms);

  for (let iter = 0; iter < maxIter; iter++) {
    const activeIndices: number[] = [];
    for (let j = 0; j < nTerms; j++) {
      if (active[j] === 1) activeIndices.push(j);
    }
    const nActive = activeIndices.length;
    if (nActive === 0) {
      coeffs.fill(0);
      break;
    }

    // Solve normalized ridge regression on active columns:
    // (Theta_norm^T Theta_norm + lambda I) c_norm = Theta_norm^T y
    const G = new Float64Array(nActive * nActive);
    const rhs = new Float64Array(nActive);

    for (let a = 0; a < nActive; a++) {
      const colA = activeIndices[a]!;
      const normA = colNorms[colA]!;
      let sumY = 0;
      for (let s = 0; s < nSamples; s++) {
        sumY += (Theta[s * nTerms + colA]! / normA) * yCol[s]!;
      }
      rhs[a] = sumY;

      for (let b = a; b < nActive; b++) {
        const colB = activeIndices[b]!;
        const normB = colNorms[colB]!;
        let sumG = 0;
        for (let s = 0; s < nSamples; s++) {
          sumG += (Theta[s * nTerms + colA]! / normA) * (Theta[s * nTerms + colB]! / normB);
        }
        if (a === b) sumG += ridgeLambda;
        G[a * nActive + b] = sumG;
        G[b * nActive + a] = sumG;
      }
    }

    const { X: cNorm } = solveDenseLinearSystem(G, rhs, nActive, 1, 1e-12);

    // Compute y norm for relative thresholding
    let yNorm = 0;
    for (let s = 0; s < nSamples; s++) yNorm += yCol[s]! * yCol[s]!;
    yNorm = Math.sqrt(yNorm) || 1.0;

    let supportChanged = false;
    coeffs.fill(0);
    for (let a = 0; a < nActive; a++) {
      const colIdx = activeIndices[a]!;
      const normalizedMag = Math.abs(cNorm[a]!) / yNorm;
      const unscaledVal = cNorm[a]! / colNorms[colIdx]!;
      if (normalizedMag < threshold) {
        active[colIdx] = 0;
        supportChanged = true;
      } else {
        coeffs[colIdx] = unscaledVal;
      }
    }

    if (!supportChanged) break;
  }

  return coeffs;
}

function formatCoefficient(val: number): string {
  // Snap near-integers or clean decimals (e.g. -0.450000000001 -> -0.45)
  const rounded6 = Math.round(val * 1e6) / 1e6;
  if (Math.abs(val - rounded6) < 1e-9) {
    return `${rounded6}`;
  }
  return Number(val.toPrecision(6)).toString();
}

/**
 * Discover sparse symbolic equations Y = Theta(X) * Xi from input-output sample trajectories.
 */
export function discoverSymbolicEquations(
  inputs: (Float64Array | number[])[],
  outputs: (Float64Array | number[])[],
  inputSpecs: SindyVariableSpec[],
  outputSpecs: SindyVariableSpec[],
  config?: SindyConfig,
): SindyDiscoveryResult {
  const nSamples = inputs.length;
  if (nSamples === 0 || outputs.length !== nSamples) {
    throw new Error("SINDy requires non-empty input and output sample arrays of matching length.");
  }

  const candidateTerms = buildPhysicsCandidateLibrary(inputSpecs, config);
  const nTerms = candidateTerms.length;
  const nOut = outputSpecs.length;

  // Evaluate feature matrix Theta in R^{nSamples x nTerms} and column L2 norms
  const Theta = new Float64Array(nSamples * nTerms);
  const colNorms = new Float64Array(nTerms);

  for (let s = 0; s < nSamples; s++) {
    const x = inputs[s]!;
    for (let j = 0; j < nTerms; j++) {
      const v = candidateTerms[j]!.evaluate(x);
      Theta[s * nTerms + j] = Number.isFinite(v) ? v : 0.0;
    }
  }

  for (let j = 0; j < nTerms; j++) {
    let normSq = 0;
    for (let s = 0; s < nSamples; s++) {
      const v = Theta[s * nTerms + j]!;
      normSq += v * v;
    }
    colNorms[j] = Math.sqrt(normSq) || 1.0;
  }

  const ridgeLambda = config?.ridgeLambda ?? 1e-8;
  const maxIter = config?.maxIterations ?? 15;
  const minAbsCoeff = config?.minAbsCoefficient ?? 1e-5;
  const thresholds =
    config?.thresholdSweep && config.thresholdSweep.length > 0 ? config.thresholdSweep : [config?.threshold ?? 0.02];

  const equations: DiscoveredChannelEquation[] = [];

  for (let outIdx = 0; outIdx < nOut; outIdx++) {
    const outSpec = outputSpecs[outIdx]!;
    const outDim = resolveDimensionVector(outSpec.unit);
    const yCol = new Float64Array(nSamples);
    let yMean = 0;
    for (let s = 0; s < nSamples; s++) {
      const val = outputs[s]![outIdx] ?? 0;
      yCol[s] = val;
      yMean += val;
    }
    yMean /= nSamples;

    let ssTot = 0;
    for (let s = 0; s < nSamples; s++) {
      ssTot += (yCol[s]! - yMean) ** 2;
    }

    let bestCoeffs: Float64Array = new Float64Array(nTerms);
    let bestBic = Infinity;
    let bestMse = Infinity;
    let bestR2 = 0;

    for (const tau of thresholds) {
      const candCoeffs = solveStlsqSingleThreshold(Theta, colNorms, yCol, nSamples, nTerms, tau, ridgeLambda, maxIter);

      let ssRes = 0;
      for (let s = 0; s < nSamples; s++) {
        let pred = 0;
        for (let j = 0; j < nTerms; j++) {
          const c = candCoeffs[j]!;
          if (Math.abs(c) >= minAbsCoeff) {
            pred += c * Theta[s * nTerms + j]!;
          }
        }
        ssRes += (yCol[s]! - pred) ** 2;
      }

      let kActive = 0;
      for (let j = 0; j < nTerms; j++) {
        if (Math.abs(candCoeffs[j]!) >= minAbsCoeff) kActive++;
      }

      const mse = ssRes / nSamples;
      const r2 = ssTot > 1e-15 ? Math.max(0, 1.0 - ssRes / ssTot) : mse < 1e-12 ? 1.0 : 0.0;
      const bic = nSamples * Math.log(Math.max(1e-16, mse)) + kActive * Math.log(Math.max(2, nSamples));

      if (bic < bestBic) {
        bestBic = bic;
        bestMse = mse;
        bestR2 = r2;
        bestCoeffs = candCoeffs;
      }
    }

    const activeTerms: DiscoveredSymbolicTerm[] = [];
    const rhsParts: string[] = [];

    for (let j = 0; j < nTerms; j++) {
      const c = bestCoeffs[j]!;
      if (Math.abs(c) < minAbsCoeff) continue;

      const basisTerm = candidateTerms[j]!;
      if (config?.requireDimensionlessCoefficients && !areDimensionsEqual(basisTerm.dimension, outDim)) {
        continue;
      }

      const coeffDim = subtractDimensions(outDim, basisTerm.dimension);
      const absStr = formatCoefficient(Math.abs(c));
      const signedStr = formatCoefficient(c);
      const isConst = basisTerm.label === "1";

      const modelicaTerm = isConst ? signedStr : `${signedStr} * ${basisTerm.modelicaExpr}`;
      if (rhsParts.length === 0) {
        rhsParts.push(modelicaTerm);
      } else {
        const signOp = c >= 0 ? "+" : "-";
        const body = isConst ? absStr : `${absStr} * ${basisTerm.modelicaExpr}`;
        rhsParts.push(`${signOp} ${body}`);
      }

      activeTerms.push({
        termLabel: basisTerm.label,
        coefficient: c,
        modelicaTerm,
        basisDimension: basisTerm.dimension,
        coefficientDimension: coeffDim,
        coefficientDimensionFormatted: formatDimension(coeffDim),
        basisTerm,
      });
    }

    const rhsString = rhsParts.length > 0 ? rhsParts.join(" ") : "0.0";
    const modelicaEquation = `${outSpec.name} = ${rhsString};`;
    const sparsityRatio = nTerms > 0 ? 1.0 - activeTerms.length / nTerms : 1.0;

    equations.push({
      outputName: outSpec.name,
      outputDimension: outDim,
      terms: activeTerms,
      modelicaEquation,
      r2: bestR2,
      mse: bestMse,
      bic: bestBic,
      sparsityRatio,
    });
  }

  return {
    equations,
    candidateTerms,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Direct ArenaNeuralBlock -> DAEBuilder Symbolic Distillation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construct a `DAEBuilder` expression node (`ExprId`) from a discovered symbolic equation.
 */
export function buildDiscoveredEquationInArena(arena: DAEBuilder, eq: DiscoveredChannelEquation): number {
  if (eq.terms.length === 0) {
    return arena.addRealLiteral(0.0);
  }

  let sumExprId = -1;
  for (const term of eq.terms) {
    let termExprId: number;
    if (term.termLabel === "1") {
      termExprId = arena.addRealLiteral(term.coefficient);
    } else {
      const coeffLit = arena.addRealLiteral(Math.abs(term.coefficient));
      const basisExpr = term.basisTerm.buildArenaExpr(arena);
      const prodExpr = arena.addBinaryExpr(BinOp.Mul, coeffLit, basisExpr);
      if (sumExprId < 0 && term.coefficient < 0) {
        termExprId = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(term.coefficient), basisExpr);
      } else {
        termExprId = prodExpr;
      }
    }

    if (sumExprId < 0) {
      sumExprId = termExprId;
    } else {
      const op = term.coefficient >= 0 ? BinOp.Add : BinOp.Sub;
      if (term.termLabel === "1") {
        sumExprId = arena.addBinaryExpr(op, sumExprId, arena.addRealLiteral(Math.abs(term.coefficient)));
      } else {
        sumExprId = arena.addBinaryExpr(op, sumExprId, termExprId);
      }
    }
  }

  return sumExprId;
}

function extractForwardWeightsFromArena(arena: DAEBuilder, block: ArenaNeuralBlock): Float64Array | undefined {
  const layers = block.config.layers;
  if (layers.length < 2) return block.config.initialWeights;
  const weights = new Float64Array(block.weightCount);
  if (block.config.initialWeights) {
    weights.set(block.config.initialWeights.subarray(0, block.weightCount));
  }
  let currentOffset = 0;
  for (let l = 0; l < layers.length - 1; l++) {
    const inDim = layers[l]!;
    const outDim = layers[l + 1]!;
    const wOffset = currentOffset;
    const bOffset = currentOffset + outDim * inDim;
    currentOffset += outDim * inDim + outDim;

    for (let j = 0; j < outDim; j++) {
      const bName = `nn_${block.name}_l${l}_b${j}`;
      const bIdx = arena.getVarIdxByName(bName);
      if (bIdx >= 0) {
        const exprId = arena.getVarExpression(bIdx);
        if (exprId !== undefined && exprId >= 0) {
          weights[bOffset + j] = arena.getExprRealValue(exprId);
        }
      }
      for (let i = 0; i < inDim; i++) {
        const wName = `nn_${block.name}_l${l}_W${j}_${i}`;
        const wIdx = arena.getVarIdxByName(wName);
        if (wIdx >= 0) {
          const exprId = arena.getVarExpression(wIdx);
          if (exprId !== undefined && exprId >= 0) {
            weights[wOffset + j * inDim + i] = arena.getExprRealValue(exprId);
          }
        }
      }
    }
  }
  return weights;
}

/**
 * Distill a trained `ArenaNeuralBlock` (Universal Differential Equation block) into
 * sparse symbolic equations via SINDy and lower the discovered symbolic expressions
 * directly into the target `DAEBuilder` arena.
 */
export function distillNeuralBlockToArena(
  arena: DAEBuilder,
  block: ArenaNeuralBlock,
  sampleInputs: (Float64Array | number[])[],
  inputSpecs: SindyVariableSpec[],
  outputSpecs: SindyVariableSpec[],
  config?: SindyConfig & { replaceInArena?: boolean | undefined },
): NeuralDistillationResult {
  const arenaWeights = extractForwardWeightsFromArena(arena, block);

  const sampleOutputs: Float64Array[] = sampleInputs.map((x) => {
    const xVec = x instanceof Float64Array ? x : new Float64Array(x);
    return block.forwardVectorized(xVec, arenaWeights);
  });

  const discovery = discoverSymbolicEquations(sampleInputs, sampleOutputs, inputSpecs, outputSpecs, config);
  const synthesizedExprIds: number[] = [];
  const replaceInArena = config?.replaceInArena ?? true;

  for (const eq of discovery.equations) {
    const rhsExprId = buildDiscoveredEquationInArena(arena, eq);
    synthesizedExprIds.push(rhsExprId);

    if (replaceInArena) {
      if (arena.getVarIdxByName(eq.outputName) < 0) {
        arena.addVariable(eq.outputName, VarType.Real, Variability.Continuous, 0, 0.0);
      }

      // Check if an existing equation assigns `eq.outputName = ...` from the neural block and update it
      let replacedExisting = false;
      for (let i = 0; i < arena.eqCount; i++) {
        if (arena.getEqKind(i) !== EqKind.Simple) continue;
        const lhsId = arena.getEqLhs(i);
        if (lhsId >= 0 && arena.getExprKind(lhsId) === ExprKind.Name) {
          const lhsName = arena.interner.resolve(arena.getExprData1(lhsId));
          if (lhsName === eq.outputName) {
            arena.setEqRhs(i, rhsExprId);
            replacedExisting = true;
            break;
          }
        }
      }

      if (!replacedExisting) {
        arena.addEquation(EqKind.Simple, arena.addNameExpr(eq.outputName), rhsExprId);
      }
    }
  }

  const modelicaPatch = discovery.equations.map((e) => e.modelicaEquation).join("\n");

  return {
    ...discovery,
    synthesizedExprIds,
    modelicaPatch,
  };
}
