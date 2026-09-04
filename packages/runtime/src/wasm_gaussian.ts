// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { StaticTapeBuilder, TapeOpKind } from "./wasm_tape.js";

/**
 * WebAssembly-backed Gaussian Uncertainty Propagation & Dense Linear Algebra.
 *
 * Provides:
 *  - Native WASM linear memory LU factorization and linear system solving (Ax = b)
 *  - First-order (linearized) moment propagation for StaticTapeBuilder tapes
 *  - Unscented Transform (UT) sigma-point propagation for highly nonlinear models
 *  - Dense LUFactorization and luSolve with row equilibration and partial pivoting
 *
 * References:
 *   - Julier, S.J. & Uhlmann, J.K. (2004), "Unscented Filtering and Nonlinear Estimation", Proc. IEEE.
 *   - Smith, R.C. (2014), "Uncertainty Quantification", SIAM.
 */

// ─────────────────────────────────────────────────────────────────────
// Gaussian Tuple
// ─────────────────────────────────────────────────────────────────────

/** A Gaussian uncertainty tuple: (mean, variance). */
export class GaussianTuple {
  constructor(
    public mean: number,
    public variance: number,
  ) {
    if (variance < 0) this.variance = 0;
  }

  /** Standard deviation σ = √variance. */
  get stddev(): number {
    return Math.sqrt(this.variance);
  }

  /** Create a deterministic (zero-variance) tuple. */
  static point(v: number): GaussianTuple {
    return new GaussianTuple(v, 0);
  }

  /** Create a tuple from mean and standard deviation. */
  static fromMeanStddev(mean: number, stddev: number): GaussianTuple {
    return new GaussianTuple(mean, stddev * stddev);
  }

  /** 95% confidence interval [μ − 1.96σ, μ + 1.96σ]. */
  confidenceInterval(z = 1.96): [number, number] {
    const hw = z * this.stddev;
    return [this.mean - hw, this.mean + hw];
  }

  toString(): string {
    return `N(${this.mean.toFixed(4)}, ${this.variance.toFixed(6)})`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// WebAssembly Linear Algebra Bridge
// ─────────────────────────────────────────────────────────────────────

export interface WasmMatrixExports {
  luFactor(matrixPtr: number, pivPtr: number, scalePtr: number, n: number): boolean;
  luSolve(luPtr: number, pivPtr: number, scalePtr: number, bPtr: number, scratchPtr: number, n: number): void;
  vectorNorm2(vPtr: number, n: number): number;
  vectorNormInf(vPtr: number, n: number): number;
  memory: WebAssembly.Memory;
}

/**
 * WebAssembly-backed Gaussian & Dense Linear Algebra Bridge.
 */
export class WasmGaussian {
  constructor(private wasmInstance: WasmMatrixExports | any) {}

  /**
   * Solves Ax = b in WASM linear memory using row-equilibrated LU factorization.
   *
   * @param A Dense n×n matrix (row-major flat array or array of rows)
   * @param b Right-hand side vector of length n (overwritten with solution)
   * @returns Solved vector x
   */
  solveLinearSystem(A: Float64Array[] | Float64Array, b: Float64Array): Float64Array {
    const n = b.length;
    if (this.wasmInstance?.exports?.luFactor && this.wasmInstance?.exports?.luSolve && this.wasmInstance?.memory) {
      const memF64 = new Float64Array(this.wasmInstance.memory.buffer);
      const memI32 = new Int32Array(this.wasmInstance.memory.buffer);

      const matrixBytes = n * n * 8;
      const matrixPtr = 1024;
      const pivPtr = matrixPtr + matrixBytes;
      const scalePtr = pivPtr + n * 4;
      const bPtr = scalePtr + n * 8;
      const scratchPtr = bPtr + n * 8;

      const matrixOffset = matrixPtr >> 3;
      if (Array.isArray(A)) {
        for (let i = 0; i < n; i++) {
          memF64.set(A[i]!, matrixOffset + i * n);
        }
      } else {
        memF64.set(A, matrixOffset);
      }

      memF64.set(b, bPtr >> 3);

      const ok = this.wasmInstance.exports.luFactor(matrixPtr, pivPtr, scalePtr, n);
      if (ok) {
        this.wasmInstance.exports.luSolve(matrixPtr, pivPtr, scalePtr, bPtr, scratchPtr, n);
        const sol = new Float64Array(n);
        sol.set(memF64.subarray(bPtr >> 3, (bPtr >> 3) + n));
        return sol;
      }
    }

    // High-precision fallback
    const rows = Array.isArray(A) ? A : Array.from({ length: n }, (_, i) => A.subarray(i * n, (i + 1) * n));
    const fact = luFactor(rows, n);
    const x = new Float64Array(b);
    luSolve(fact, x);
    return x;
  }
}

// ─────────────────────────────────────────────────────────────────────
// First-Order (Linearized) Propagation Rules
// ─────────────────────────────────────────────────────────────────────

export function gaAdd(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  return new GaussianTuple(a.mean + b.mean, a.variance + b.variance + 2 * cov);
}

export function gaSub(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  return new GaussianTuple(a.mean - b.mean, a.variance + b.variance - 2 * cov);
}

export function gaMul(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  const mean = a.mean * b.mean;
  const variance =
    a.mean * a.mean * b.variance + b.mean * b.mean * a.variance + a.variance * b.variance + 2 * a.mean * b.mean * cov;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaDiv(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  if (Math.abs(b.mean) < 1e-30) {
    return new GaussianTuple(a.mean / (b.mean || 1e-30), 1e10);
  }
  const mean = a.mean / b.mean;
  const dadb = -a.mean / (b.mean * b.mean);
  const dada = 1 / b.mean;
  const variance = dada * dada * a.variance + dadb * dadb * b.variance + 2 * dada * dadb * cov;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaPow(base: GaussianTuple, exp: GaussianTuple): GaussianTuple {
  if (exp.variance === 0) {
    return gaPowConst(base, exp.mean);
  }
  if (base.mean > 0) {
    const logBase = gaLog(base);
    const product = gaMul(exp, logBase);
    return gaExp(product);
  }
  const mean = Math.pow(Math.abs(base.mean) || 1e-30, exp.mean);
  return new GaussianTuple(mean, mean * mean * (base.variance + exp.variance));
}

function gaPowConst(base: GaussianTuple, n: number): GaussianTuple {
  if (n === 0) return GaussianTuple.point(1);
  if (n === 1) return base;

  const mean = Math.pow(base.mean, n);
  const deriv = n * Math.pow(base.mean, n - 1);
  const variance = deriv * deriv * base.variance;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaNeg(a: GaussianTuple): GaussianTuple {
  return new GaussianTuple(-a.mean, a.variance);
}

export function gaSin(a: GaussianTuple): GaussianTuple {
  const mean = Math.sin(a.mean);
  const deriv = Math.cos(a.mean);
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaCos(a: GaussianTuple): GaussianTuple {
  const mean = Math.cos(a.mean);
  const deriv = -Math.sin(a.mean);
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaTan(a: GaussianTuple): GaussianTuple {
  const t = Math.tan(a.mean);
  const mean = t;
  const deriv = 1 + t * t;
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaExp(a: GaussianTuple): GaussianTuple {
  const e = Math.exp(a.mean);
  const mean = Math.exp(a.mean + a.variance / 2);
  const variance = (Math.exp(a.variance) - 1) * Math.exp(2 * a.mean + a.variance);
  if (a.variance < 10) {
    return new GaussianTuple(mean, Math.max(0, variance));
  }
  return new GaussianTuple(e, e * e * a.variance);
}

export function gaLog(a: GaussianTuple): GaussianTuple {
  const safeMean = Math.max(1e-300, a.mean);
  const mean = Math.log(safeMean);
  const deriv = 1 / safeMean;
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaSqrt(a: GaussianTuple): GaussianTuple {
  const safeMean = Math.max(1e-300, a.mean);
  const mean = Math.sqrt(safeMean);
  const deriv = 1 / (2 * mean);
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

// ─────────────────────────────────────────────────────────────────────
// Unscented Transform (UT)
// ─────────────────────────────────────────────────────────────────────

export function unscentedTransform(
  inputs: GaussianTuple[],
  f: (values: number[]) => number,
  alpha = 1e-3,
  beta = 2,
  kappa = 0,
): GaussianTuple {
  const n = inputs.length;
  if (n === 0) return GaussianTuple.point(f([]));

  const lambda = alpha * alpha * (n + kappa) - n;
  const gamma = Math.sqrt(n + lambda);

  const sigmaPoints: number[][] = [];
  const meanVec = inputs.map((g) => g.mean);

  sigmaPoints.push([...meanVec]);

  for (let i = 0; i < n; i++) {
    const sp = [...meanVec];
    sp[i] = meanVec[i]! + gamma * inputs[i]!.stddev;
    sigmaPoints.push(sp);
  }

  for (let i = 0; i < n; i++) {
    const sp = [...meanVec];
    sp[i] = meanVec[i]! - gamma * inputs[i]!.stddev;
    sigmaPoints.push(sp);
  }

  const wm0 = lambda / (n + lambda);
  const wc0 = wm0 + (1 - alpha * alpha + beta);
  const wi = 1 / (2 * (n + lambda));

  const yVals: number[] = [];
  for (const sp of sigmaPoints) {
    yVals.push(f(sp));
  }

  let yMean = wm0 * yVals[0]!;
  for (let i = 1; i <= 2 * n; i++) {
    yMean += wi * yVals[i]!;
  }

  let yVar = wc0 * (yVals[0]! - yMean) * (yVals[0]! - yMean);
  for (let i = 1; i <= 2 * n; i++) {
    const diff = yVals[i]! - yMean;
    yVar += wi * diff * diff;
  }

  return new GaussianTuple(yMean, Math.max(0, yVar));
}

// ─────────────────────────────────────────────────────────────────────
// Tape Evaluator
// ─────────────────────────────────────────────────────────────────────

export function evaluateTapeGaussian(
  builder: StaticTapeBuilder,
  distributions: Map<string, GaussianTuple>,
  covariance?: Map<string, Map<string, number>>,
): GaussianTuple[] {
  const n = builder.length;
  const t = new Array<GaussianTuple>(n);
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  function getCov(nameA: string | undefined, nameB: string | undefined): number {
    if (!covariance || !nameA || !nameB || nameA === nameB) return 0;
    return covariance.get(nameA)?.get(nameB) ?? covariance.get(nameB)?.get(nameA) ?? 0;
  }

  const slotNames = new Array<string | undefined>(n);

  for (let i = 0; i < n; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case TapeOpKind.Const:
        t[i] = GaussianTuple.point(valData[i]!);
        break;
      case TapeOpKind.Var: {
        const name = interner.resolve(a) || "";
        t[i] = distributions.get(name) ?? GaussianTuple.point(0);
        slotNames[i] = name;
        break;
      }
      case TapeOpKind.Add: {
        const cov = getCov(slotNames[a], slotNames[b]);
        t[i] = gaAdd(t[a]!, t[b]!, cov);
        break;
      }
      case TapeOpKind.Sub: {
        const cov = getCov(slotNames[a], slotNames[b]);
        t[i] = gaSub(t[a]!, t[b]!, cov);
        break;
      }
      case TapeOpKind.Mul: {
        const cov = getCov(slotNames[a], slotNames[b]);
        t[i] = gaMul(t[a]!, t[b]!, cov);
        break;
      }
      case TapeOpKind.Div: {
        const cov = getCov(slotNames[a], slotNames[b]);
        t[i] = gaDiv(t[a]!, t[b]!, cov);
        break;
      }
      case TapeOpKind.Pow:
        t[i] = gaPow(t[a]!, t[b]!);
        break;
      case TapeOpKind.Neg:
        t[i] = gaNeg(t[a]!);
        break;
      case TapeOpKind.Sin:
        t[i] = gaSin(t[a]!);
        break;
      case TapeOpKind.Cos:
        t[i] = gaCos(t[a]!);
        break;
      case TapeOpKind.Tan:
        t[i] = gaTan(t[a]!);
        break;
      case TapeOpKind.Exp:
        t[i] = gaExp(t[a]!);
        break;
      case TapeOpKind.Log:
        t[i] = gaLog(t[a]!);
        break;
      case TapeOpKind.Sqrt:
        t[i] = gaSqrt(t[a]!);
        break;
      case TapeOpKind.VecVar: {
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          const name = `${baseName}[${k + 1}]`;
          t[i + k] = distributions.get(name) ?? GaussianTuple.point(0);
          slotNames[i + k] = name;
        }
        break;
      }
      case TapeOpKind.VecConst:
        for (let k = 0; k < b; k++) {
          t[i + k] = GaussianTuple.point(valData[i + k] ?? 0);
        }
        break;
      case TapeOpKind.VecAdd:
        for (let k = 0; k < b; k++) {
          const cov = getCov(slotNames[a + k], slotNames[c + k]);
          t[i + k] = gaAdd(t[a + k]!, t[c + k]!, cov);
        }
        break;
      case TapeOpKind.VecSub:
        for (let k = 0; k < b; k++) {
          const cov = getCov(slotNames[a + k], slotNames[c + k]);
          t[i + k] = gaSub(t[a + k]!, t[c + k]!, cov);
        }
        break;
      case TapeOpKind.VecMul:
        for (let k = 0; k < b; k++) {
          const cov = getCov(slotNames[a + k], slotNames[c + k]);
          t[i + k] = gaMul(t[a + k]!, t[c + k]!, cov);
        }
        break;
      case TapeOpKind.VecNeg:
        for (let k = 0; k < b; k++) {
          t[i + k] = gaNeg(t[a + k]!);
        }
        break;
      case TapeOpKind.VecSubscript:
        t[i] = t[a + c] ?? GaussianTuple.point(0);
        break;
      case TapeOpKind.Nop:
      default:
        break;
    }
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────
// C-Code Generation for Gaussian Forward Pass
// ─────────────────────────────────────────────────────────────────────

export function emitGaussianForwardC(
  builder: StaticTapeBuilder,
  varResolver: (name: string) => { mean: string; var: string },
): string[] {
  const lines: string[] = [];
  const n = builder.length;
  lines.push(`double t_mu[${n}], t_var[${n}];`);
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = 0; i < n; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case TapeOpKind.Const:
        lines.push(`t_mu[${i}] = ${formatNum(valData[i]!)}; t_var[${i}] = 0.0;`);
        break;
      case TapeOpKind.Var: {
        const name = interner.resolve(a) || "";
        const vr = varResolver(name);
        lines.push(`t_mu[${i}] = ${vr.mean}; t_var[${i}] = ${vr.var};`);
        break;
      }
      case TapeOpKind.Add:
        lines.push(`t_mu[${i}] = t_mu[${a}] + t_mu[${b}]; t_var[${i}] = t_var[${a}] + t_var[${b}];`);
        break;
      case TapeOpKind.Sub:
        lines.push(`t_mu[${i}] = t_mu[${a}] - t_mu[${b}]; t_var[${i}] = t_var[${a}] + t_var[${b}];`);
        break;
      case TapeOpKind.Mul:
        lines.push(`t_mu[${i}] = t_mu[${a}] * t_mu[${b}];`);
        lines.push(
          `t_var[${i}] = t_mu[${a}]*t_mu[${a}]*t_var[${b}] + t_mu[${b}]*t_mu[${b}]*t_var[${a}] + t_var[${a}]*t_var[${b}];`,
        );
        break;
      case TapeOpKind.Div:
        lines.push(`t_mu[${i}] = t_mu[${a}] / t_mu[${b}];`);
        lines.push(`{ double inv_b = 1.0 / t_mu[${b}]; double da_db = -t_mu[${a}] * inv_b * inv_b;`);
        lines.push(`  t_var[${i}] = inv_b*inv_b*t_var[${a}] + da_db*da_db*t_var[${b}]; }`);
        break;
      case TapeOpKind.Pow:
        lines.push(`t_mu[${i}] = pow(t_mu[${a}], t_mu[${b}]);`);
        lines.push(`{ double deriv = t_mu[${b}] * pow(t_mu[${a}], t_mu[${b}] - 1.0);`);
        lines.push(`  t_var[${i}] = deriv * deriv * t_var[${a}]; }`);
        break;
      case TapeOpKind.Neg:
        lines.push(`t_mu[${i}] = -t_mu[${a}]; t_var[${i}] = t_var[${a}];`);
        break;
      case TapeOpKind.Sin:
        lines.push(`t_mu[${i}] = sin(t_mu[${a}]);`);
        lines.push(`{ double d = cos(t_mu[${a}]); t_var[${i}] = d*d*t_var[${a}]; }`);
        break;
      case TapeOpKind.Cos:
        lines.push(`t_mu[${i}] = cos(t_mu[${a}]);`);
        lines.push(`{ double d = -sin(t_mu[${a}]); t_var[${i}] = d*d*t_var[${a}]; }`);
        break;
      case TapeOpKind.Tan:
        lines.push(`t_mu[${i}] = tan(t_mu[${a}]);`);
        lines.push(`{ double d = 1.0 + t_mu[${i}]*t_mu[${i}]; t_var[${i}] = d*d*t_var[${a}]; }`);
        break;
      case TapeOpKind.Exp:
        lines.push(`t_mu[${i}] = exp(t_mu[${a}] + 0.5*t_var[${a}]);`);
        lines.push(`t_var[${i}] = (exp(t_var[${a}]) - 1.0) * exp(2.0*t_mu[${a}] + t_var[${a}]);`);
        break;
      case TapeOpKind.Log:
        lines.push(`t_mu[${i}] = log(fmax(1e-300, t_mu[${a}]));`);
        lines.push(`{ double inv = 1.0 / fmax(1e-300, t_mu[${a}]); t_var[${i}] = inv*inv*t_var[${a}]; }`);
        break;
      case TapeOpKind.Sqrt:
        lines.push(`t_mu[${i}] = sqrt(fmax(0.0, t_mu[${a}]));`);
        lines.push(`{ double d = 0.5 / fmax(1e-300, t_mu[${i}]); t_var[${i}] = d*d*t_var[${a}]; }`);
        break;
      case TapeOpKind.VecVar: {
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          const vr = varResolver(`${baseName}[${k + 1}]`);
          lines.push(`t_mu[${i + k}] = ${vr.mean}; t_var[${i + k}] = ${vr.var};`);
        }
        break;
      }
      case TapeOpKind.VecConst:
        for (let k = 0; k < b; k++) {
          lines.push(`t_mu[${i + k}] = ${formatNum(valData[i + k] ?? 0)}; t_var[${i + k}] = 0.0;`);
        }
        break;
      case TapeOpKind.VecAdd:
        lines.push(
          `for (int _k = 0; _k < ${b}; _k++) { t_mu[${i}+_k] = t_mu[${a}+_k] + t_mu[${c}+_k]; t_var[${i}+_k] = t_var[${a}+_k] + t_var[${c}+_k]; }`,
        );
        break;
      case TapeOpKind.VecSub:
        lines.push(
          `for (int _k = 0; _k < ${b}; _k++) { t_mu[${i}+_k] = t_mu[${a}+_k] - t_mu[${c}+_k]; t_var[${i}+_k] = t_var[${a}+_k] + t_var[${c}+_k]; }`,
        );
        break;
      case TapeOpKind.VecMul:
        lines.push(`for (int _k = 0; _k < ${b}; _k++) {`);
        lines.push(`  t_mu[${i}+_k] = t_mu[${a}+_k] * t_mu[${c}+_k];`);
        lines.push(
          `  t_var[${i}+_k] = t_mu[${a}+_k]*t_mu[${a}+_k]*t_var[${c}+_k] + t_mu[${c}+_k]*t_mu[${c}+_k]*t_var[${a}+_k] + t_var[${a}+_k]*t_var[${c}+_k];`,
        );
        lines.push(`}`);
        break;
      case TapeOpKind.VecNeg:
        lines.push(
          `for (int _k = 0; _k < ${b}; _k++) { t_mu[${i}+_k] = -t_mu[${a}+_k]; t_var[${i}+_k] = t_var[${a}+_k]; }`,
        );
        break;
      case TapeOpKind.VecSubscript:
        lines.push(`t_mu[${i}] = t_mu[${a + c}]; t_var[${i}] = t_var[${a + c}];`);
        break;
      case TapeOpKind.Nop:
      default:
        break;
    }
  }
  return lines;
}

function formatNum(v: number): string {
  if (!isFinite(v)) return v === Infinity ? "INFINITY" : v === -Infinity ? "(-INFINITY)" : "NAN";
  const s = v.toString();
  return !s.includes(".") && !s.includes("e") && !s.includes("E") ? s + ".0" : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dense LU Factorization & Solve
// ─────────────────────────────────────────────────────────────────────────────

/** Factorization result for dense LU solver. */
export interface LUFactorization {
  /** LU factorization matrix. */
  lu: Float64Array[];
  /** Pivot permutation vector. */
  piv: Int32Array;
  /** Row scaling factors for equilibration. */
  rowScale: Float64Array;
  /** Matrix dimension. */
  n: number;
}

/**
 * Factor a dense n×n matrix (given as array of Float64Array rows) into PA = LU
 * with row equilibration for numerical stability.
 */
export function luFactor(A: Float64Array[], n: number): LUFactorization {
  const lu = A.map((row) => new Float64Array(row));
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  const rowScale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = lu[i];
    if (!row) continue;
    let maxVal = 0;
    for (let j = 0; j < n; j++) {
      maxVal = Math.max(maxVal, Math.abs(row[j] ?? 0));
    }
    const s = maxVal > 1e-30 ? 1.0 / maxVal : 1.0;
    rowScale[i] = s;
    for (let j = 0; j < n; j++) {
      row[j] = (row[j] ?? 0) * s;
    }
  }

  for (let k = 0; k < n; k++) {
    const luK = lu[k];
    if (!luK) continue;
    let maxVal = Math.abs(luK[k] ?? 0);
    let maxIdx = k;
    for (let i = k + 1; i < n; i++) {
      const luI = lu[i];
      if (!luI) continue;
      const val = Math.abs(luI[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }
    if (maxIdx !== k) {
      const rowK = lu[k];
      const rowMax = lu[maxIdx];
      if (rowK && rowMax) {
        lu[k] = rowMax;
        lu[maxIdx] = rowK;
      }
      const tmpP = piv[k] ?? k;
      piv[k] = piv[maxIdx] ?? maxIdx;
      piv[maxIdx] = tmpP;
      const tmpS = rowScale[k] ?? 1;
      rowScale[k] = rowScale[maxIdx] ?? 1;
      rowScale[maxIdx] = tmpS;
    }
    const luKSwapped = lu[k];
    if (!luKSwapped) continue;
    const diagVal = luKSwapped[k] ?? 0;
    if (Math.abs(diagVal) < 1e-30) continue;

    for (let i = k + 1; i < n; i++) {
      const luI = lu[i];
      if (!luI) continue;
      const factor = (luI[k] ?? 0) / diagVal;
      luI[k] = factor;
      for (let j = k + 1; j < n; j++) {
        luI[j] = (luI[j] ?? 0) - factor * (luKSwapped[j] ?? 0);
      }
    }
  }
  return { lu, piv, rowScale, n };
}

/**
 * Solve LU·x = b (in-place, overwrites b with x).
 * Accounts for row equilibration applied during factorization.
 */
export function luSolve(fact: LUFactorization, b: Float64Array): void {
  const { lu, piv, rowScale, n } = fact;
  const pb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pi = piv[i] ?? i;
    pb[i] = (b[pi] ?? 0) * (rowScale[i] ?? 1);
  }
  for (let i = 1; i < n; i++) {
    const luI = lu[i];
    if (!luI) continue;
    for (let j = 0; j < i; j++) {
      pb[i] = (pb[i] ?? 0) - (luI[j] ?? 0) * (pb[j] ?? 0);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const luI = lu[i];
    if (!luI) continue;
    for (let j = i + 1; j < n; j++) {
      pb[i] = (pb[i] ?? 0) - (luI[j] ?? 0) * (pb[j] ?? 0);
    }
    const diag = luI[i] ?? 0;
    pb[i] = Math.abs(diag) > 1e-30 ? (pb[i] ?? 0) / diag : 0;
  }
  for (let i = 0; i < n; i++) b[i] = pb[i] ?? 0;
}
