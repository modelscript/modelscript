// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Gaussian Uncertainty Propagation Engine for the StaticTapeBuilder tape.
 *
 * Propagates (mean, variance) tuples through tape operations using first-order
 * (linearized) moment propagation, with Unscented Transform (UT) fallback for
 * highly nonlinear functions.
 *
 * This mirrors the architecture of interval.ts (Interval → evaluateTapeInterval)
 * and mccormick.ts (McCormickTuple → evaluateTapeMcCormick), providing a third
 * arithmetic for the same TapeOp representation.
 *
 * First-order rules:
 *   y = f(x)   ⟹   μ_y ≈ f(μ_x),   σ²_y ≈ (f'(μ_x))² · σ²_x
 *   y = g(a,b) ⟹   μ_y ≈ g(μ_a, μ_b),
 *                    σ²_y ≈ (∂g/∂a)²·σ²_a + (∂g/∂b)²·σ²_b + 2·(∂g/∂a)(∂g/∂b)·Cov(a,b)
 *
 * References:
 *   - Julier, S.J. & Uhlmann, J.K. (2004), "Unscented Filtering and Nonlinear Estimation", Proc. IEEE.
 *   - Smith, R.C. (2014), "Uncertainty Quantification", SIAM.
 */

import type { TapeOp } from "@modelscript/symbolics";

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
// First-Order (Linearized) Propagation Rules
// ─────────────────────────────────────────────────────────────────────

export function gaAdd(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  return new GaussianTuple(a.mean + b.mean, a.variance + b.variance + 2 * cov);
}

export function gaSub(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  return new GaussianTuple(a.mean - b.mean, a.variance + b.variance - 2 * cov);
}

export function gaMul(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  // y = a·b  ⟹  μ_y = μ_a·μ_b
  // σ²_y = μ_a²·σ²_b + μ_b²·σ²_a + σ²_a·σ²_b + 2·μ_a·μ_b·Cov(a,b)
  // (The σ²_a·σ²_b term is second-order but kept for improved accuracy.)
  const mean = a.mean * b.mean;
  const variance =
    a.mean * a.mean * b.variance + b.mean * b.mean * a.variance + a.variance * b.variance + 2 * a.mean * b.mean * cov;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaDiv(a: GaussianTuple, b: GaussianTuple, cov = 0): GaussianTuple {
  // y = a/b  ⟹  μ_y ≈ μ_a/μ_b
  // σ²_y ≈ (1/μ_b)²·σ²_a + (μ_a/μ_b²)²·σ²_b − 2·(μ_a/(μ_b³))·Cov(a,b)
  if (Math.abs(b.mean) < 1e-30) {
    // Division by near-zero mean: return high-uncertainty result
    return new GaussianTuple(a.mean / (b.mean || 1e-30), 1e10);
  }
  const mean = a.mean / b.mean;
  const dadb = -a.mean / (b.mean * b.mean);
  const dada = 1 / b.mean;
  const variance = dada * dada * a.variance + dadb * dadb * b.variance + 2 * dada * dadb * cov;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaPow(base: GaussianTuple, exp: GaussianTuple): GaussianTuple {
  // Handle constant exponent (most common case)
  if (exp.variance === 0) {
    return gaPowConst(base, exp.mean);
  }
  // General case: a^b = exp(b·ln(a))
  if (base.mean > 0) {
    const logBase = gaLog(base);
    const product = gaMul(exp, logBase);
    return gaExp(product);
  }
  // Fallback for negative base
  const mean = Math.pow(Math.abs(base.mean) || 1e-30, exp.mean);
  return new GaussianTuple(mean, mean * mean * (base.variance + exp.variance));
}

function gaPowConst(base: GaussianTuple, n: number): GaussianTuple {
  if (n === 0) return GaussianTuple.point(1);
  if (n === 1) return base;

  const mean = Math.pow(base.mean, n);
  // ∂(x^n)/∂x = n·x^(n-1)
  const deriv = n * Math.pow(base.mean, n - 1);
  const variance = deriv * deriv * base.variance;
  return new GaussianTuple(mean, Math.max(0, variance));
}

export function gaNeg(a: GaussianTuple): GaussianTuple {
  return new GaussianTuple(-a.mean, a.variance);
}

// ── Nonlinear unary functions ──
// y = f(x) ⟹ μ_y ≈ f(μ_x), σ²_y ≈ (f'(μ_x))² · σ²_x

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
  const deriv = 1 + t * t; // sec²(x)
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaExp(a: GaussianTuple): GaussianTuple {
  const e = Math.exp(a.mean);
  // For exp, second-order correction is significant:
  // E[exp(X)] = exp(μ + σ²/2) for Gaussian X
  const mean = Math.exp(a.mean + a.variance / 2);
  // Var[exp(X)] = (exp(σ²) - 1) · exp(2μ + σ²) for Gaussian X
  const variance = (Math.exp(a.variance) - 1) * Math.exp(2 * a.mean + a.variance);
  // Use exact formulas when variance is small, otherwise they may overflow
  if (a.variance < 10) {
    return new GaussianTuple(mean, Math.max(0, variance));
  }
  // Fallback to first-order for large variance
  return new GaussianTuple(e, e * e * a.variance);
}

export function gaLog(a: GaussianTuple): GaussianTuple {
  const safeMean = Math.max(1e-300, a.mean);
  const mean = Math.log(safeMean);
  const deriv = 1 / safeMean; // 1/x
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

export function gaSqrt(a: GaussianTuple): GaussianTuple {
  const safeMean = Math.max(1e-300, a.mean);
  const mean = Math.sqrt(safeMean);
  const deriv = 1 / (2 * mean); // 1/(2√x)
  return new GaussianTuple(mean, deriv * deriv * a.variance);
}

// ─────────────────────────────────────────────────────────────────────
// Unscented Transform (UT)
// ─────────────────────────────────────────────────────────────────────

/**
 * Apply the Unscented Transform to propagate Gaussian uncertainty through
 * an arbitrary nonlinear function.
 *
 * Generates 2n+1 sigma points from the input distributions, evaluates
 * the function at each sigma point, then reconstructs the output mean
 * and variance from the weighted sigma-point outputs.
 *
 * @param inputs     Array of GaussianTuples for each input variable
 * @param f          The nonlinear function mapping input values → output value
 * @param alpha      UT spread parameter (default: 1e-3, controls sigma point distance)
 * @param beta       UT distribution parameter (default: 2, optimal for Gaussian)
 * @param kappa      UT secondary scaling (default: 0)
 */
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

  // Generate 2n+1 sigma points
  const sigmaPoints: number[][] = [];
  const meanVec = inputs.map((g) => g.mean);

  // Sigma point 0: mean
  sigmaPoints.push([...meanVec]);

  // Sigma points 1..n: mean + γ·√σ²_i on dimension i
  for (let i = 0; i < n; i++) {
    const sp = [...meanVec];
    sp[i] = meanVec[i]! + gamma * inputs[i]!.stddev;
    sigmaPoints.push(sp);
  }

  // Sigma points n+1..2n: mean − γ·√σ²_i on dimension i
  for (let i = 0; i < n; i++) {
    const sp = [...meanVec];
    sp[i] = meanVec[i]! - gamma * inputs[i]!.stddev;
    sigmaPoints.push(sp);
  }

  // Weights
  const wm0 = lambda / (n + lambda);
  const wc0 = wm0 + (1 - alpha * alpha + beta);
  const wi = 1 / (2 * (n + lambda));

  // Evaluate function at each sigma point
  const yVals: number[] = [];
  for (const sp of sigmaPoints) {
    yVals.push(f(sp));
  }

  // Reconstruct output mean
  let yMean = wm0 * yVals[0]!;
  for (let i = 1; i <= 2 * n; i++) {
    yMean += wi * yVals[i]!;
  }

  // Reconstruct output variance
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

/**
 * Evaluate a tape forward pass with Gaussian uncertainty propagation.
 * Returns GaussianTuples (mean, variance) at each tape slot.
 *
 * @param ops           The tape operations from StaticTapeBuilder
 * @param distributions Map of variable name → GaussianTuple (mean, variance)
 * @param covariance    Optional pairwise covariances: Cov(name_i, name_j)
 */
export function evaluateTapeGaussian(
  ops: TapeOp[],
  distributions: Map<string, GaussianTuple>,
  covariance?: Map<string, Map<string, number>>,
): GaussianTuple[] {
  const t = new Array<GaussianTuple>(ops.length);

  /** Look up Cov(a, b) from the covariance map. */
  function getCov(nameA: string | undefined, nameB: string | undefined): number {
    if (!covariance || !nameA || !nameB || nameA === nameB) return 0;
    return covariance.get(nameA)?.get(nameB) ?? covariance.get(nameB)?.get(nameA) ?? 0;
  }

  // Track which tape slots correspond to which variable names (for covariance lookup)
  const slotNames = new Array<string | undefined>(ops.length);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    switch (op.type) {
      case "const":
        t[i] = GaussianTuple.point(op.val);
        break;
      case "var": {
        t[i] = distributions.get(op.name) ?? GaussianTuple.point(0);
        slotNames[i] = op.name;
        break;
      }
      case "add": {
        const cov = getCov(slotNames[op.a], slotNames[op.b]);
        t[i] = gaAdd(t[op.a]!, t[op.b]!, cov);
        break;
      }
      case "sub": {
        const cov = getCov(slotNames[op.a], slotNames[op.b]);
        t[i] = gaSub(t[op.a]!, t[op.b]!, cov);
        break;
      }
      case "mul": {
        const cov = getCov(slotNames[op.a], slotNames[op.b]);
        t[i] = gaMul(t[op.a]!, t[op.b]!, cov);
        break;
      }
      case "div": {
        const cov = getCov(slotNames[op.a], slotNames[op.b]);
        t[i] = gaDiv(t[op.a]!, t[op.b]!, cov);
        break;
      }
      case "pow":
        t[i] = gaPow(t[op.a]!, t[op.b]!);
        break;
      case "neg":
        t[i] = gaNeg(t[op.a]!);
        break;
      case "sin":
        t[i] = gaSin(t[op.a]!);
        break;
      case "cos":
        t[i] = gaCos(t[op.a]!);
        break;
      case "tan":
        t[i] = gaTan(t[op.a]!);
        break;
      case "exp":
        t[i] = gaExp(t[op.a]!);
        break;
      case "log":
        t[i] = gaLog(t[op.a]!);
        break;
      case "sqrt":
        t[i] = gaSqrt(t[op.a]!);
        break;
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          const name = `${op.baseName}[${k + 1}]`;
          t[i + k] = distributions.get(name) ?? GaussianTuple.point(0);
          slotNames[i + k] = name;
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = GaussianTuple.point(op.vals[k] ?? 0);
        }
        break;
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          const cov = getCov(slotNames[op.a + k], slotNames[op.b + k]);
          t[i + k] = gaAdd(t[op.a + k]!, t[op.b + k]!, cov);
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          const cov = getCov(slotNames[op.a + k], slotNames[op.b + k]);
          t[i + k] = gaSub(t[op.a + k]!, t[op.b + k]!, cov);
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          const cov = getCov(slotNames[op.a + k], slotNames[op.b + k]);
          t[i + k] = gaMul(t[op.a + k]!, t[op.b + k]!, cov);
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = gaNeg(t[op.a + k]!);
        }
        break;
      case "vec_subscript":
        t[i] = t[op.a + op.offset] ?? GaussianTuple.point(0);
        break;
      case "nop":
        break;
    }
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────
// C-Code Generation for Gaussian Forward Pass
// ─────────────────────────────────────────────────────────────────────

/**
 * Emit C-code for Gaussian uncertainty forward pass evaluation.
 * Each tape slot produces two values: t_mu[i] (mean) and t_var[i] (variance).
 *
 * @param ops         The tape operations
 * @param varResolver Maps variable name → { mean: C-expr, var: C-expr }
 * @returns Array of C-code lines
 */
export function emitGaussianForwardC(
  ops: TapeOp[],
  varResolver: (name: string) => { mean: string; var: string },
): string[] {
  const lines: string[] = [];
  const n = ops.length;
  lines.push(`double t_mu[${n}], t_var[${n}];`);

  for (let i = 0; i < n; i++) {
    const op = ops[i]!;
    switch (op.type) {
      case "const":
        lines.push(`t_mu[${i}] = ${formatNum(op.val)}; t_var[${i}] = 0.0;`);
        break;
      case "var": {
        const vr = varResolver(op.name);
        lines.push(`t_mu[${i}] = ${vr.mean}; t_var[${i}] = ${vr.var};`);
        break;
      }
      case "add":
        lines.push(`t_mu[${i}] = t_mu[${op.a}] + t_mu[${op.b}]; t_var[${i}] = t_var[${op.a}] + t_var[${op.b}];`);
        break;
      case "sub":
        lines.push(`t_mu[${i}] = t_mu[${op.a}] - t_mu[${op.b}]; t_var[${i}] = t_var[${op.a}] + t_var[${op.b}];`);
        break;
      case "mul":
        lines.push(`t_mu[${i}] = t_mu[${op.a}] * t_mu[${op.b}];`);
        lines.push(
          `t_var[${i}] = t_mu[${op.a}]*t_mu[${op.a}]*t_var[${op.b}] + t_mu[${op.b}]*t_mu[${op.b}]*t_var[${op.a}] + t_var[${op.a}]*t_var[${op.b}];`,
        );
        break;
      case "div":
        lines.push(`t_mu[${i}] = t_mu[${op.a}] / t_mu[${op.b}];`);
        lines.push(`{ double inv_b = 1.0 / t_mu[${op.b}]; double da_db = -t_mu[${op.a}] * inv_b * inv_b;`);
        lines.push(`  t_var[${i}] = inv_b*inv_b*t_var[${op.a}] + da_db*da_db*t_var[${op.b}]; }`);
        break;
      case "pow":
        lines.push(`t_mu[${i}] = pow(t_mu[${op.a}], t_mu[${op.b}]);`);
        lines.push(`{ double deriv = t_mu[${op.b}] * pow(t_mu[${op.a}], t_mu[${op.b}] - 1.0);`);
        lines.push(`  t_var[${i}] = deriv * deriv * t_var[${op.a}]; }`);
        break;
      case "neg":
        lines.push(`t_mu[${i}] = -t_mu[${op.a}]; t_var[${i}] = t_var[${op.a}];`);
        break;
      case "sin":
        lines.push(`t_mu[${i}] = sin(t_mu[${op.a}]);`);
        lines.push(`{ double d = cos(t_mu[${op.a}]); t_var[${i}] = d*d*t_var[${op.a}]; }`);
        break;
      case "cos":
        lines.push(`t_mu[${i}] = cos(t_mu[${op.a}]);`);
        lines.push(`{ double d = -sin(t_mu[${op.a}]); t_var[${i}] = d*d*t_var[${op.a}]; }`);
        break;
      case "tan":
        lines.push(`t_mu[${i}] = tan(t_mu[${op.a}]);`);
        lines.push(`{ double d = 1.0 + t_mu[${i}]*t_mu[${i}]; t_var[${i}] = d*d*t_var[${op.a}]; }`);
        break;
      case "exp":
        // Exact Gaussian: E[exp(X)] = exp(μ + σ²/2), Var = (exp(σ²)-1)·exp(2μ+σ²)
        lines.push(`t_mu[${i}] = exp(t_mu[${op.a}] + 0.5*t_var[${op.a}]);`);
        lines.push(`t_var[${i}] = (exp(t_var[${op.a}]) - 1.0) * exp(2.0*t_mu[${op.a}] + t_var[${op.a}]);`);
        break;
      case "log":
        lines.push(`t_mu[${i}] = log(fmax(1e-300, t_mu[${op.a}]));`);
        lines.push(`{ double inv = 1.0 / fmax(1e-300, t_mu[${op.a}]); t_var[${i}] = inv*inv*t_var[${op.a}]; }`);
        break;
      case "sqrt":
        lines.push(`t_mu[${i}] = sqrt(fmax(0.0, t_mu[${op.a}]));`);
        lines.push(`{ double d = 0.5 / fmax(1e-300, t_mu[${i}]); t_var[${i}] = d*d*t_var[${op.a}]; }`);
        break;
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          const vr = varResolver(`${op.baseName}[${k + 1}]`);
          lines.push(`t_mu[${i + k}] = ${vr.mean}; t_var[${i + k}] = ${vr.var};`);
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          lines.push(`t_mu[${i + k}] = ${formatNum(op.vals[k] ?? 0)}; t_var[${i + k}] = 0.0;`);
        }
        break;
      case "vec_add":
        lines.push(
          `for (int _k = 0; _k < ${op.size}; _k++) { t_mu[${i}+_k] = t_mu[${op.a}+_k] + t_mu[${op.b}+_k]; t_var[${i}+_k] = t_var[${op.a}+_k] + t_var[${op.b}+_k]; }`,
        );
        break;
      case "vec_sub":
        lines.push(
          `for (int _k = 0; _k < ${op.size}; _k++) { t_mu[${i}+_k] = t_mu[${op.a}+_k] - t_mu[${op.b}+_k]; t_var[${i}+_k] = t_var[${op.a}+_k] + t_var[${op.b}+_k]; }`,
        );
        break;
      case "vec_mul":
        lines.push(`for (int _k = 0; _k < ${op.size}; _k++) {`);
        lines.push(`  t_mu[${i}+_k] = t_mu[${op.a}+_k] * t_mu[${op.b}+_k];`);
        lines.push(
          `  t_var[${i}+_k] = t_mu[${op.a}+_k]*t_mu[${op.a}+_k]*t_var[${op.b}+_k] + t_mu[${op.b}+_k]*t_mu[${op.b}+_k]*t_var[${op.a}+_k] + t_var[${op.a}+_k]*t_var[${op.b}+_k];`,
        );
        lines.push(`}`);
        break;
      case "vec_neg":
        lines.push(
          `for (int _k = 0; _k < ${op.size}; _k++) { t_mu[${i}+_k] = -t_mu[${op.a}+_k]; t_var[${i}+_k] = t_var[${op.a}+_k]; }`,
        );
        break;
      case "vec_subscript":
        lines.push(`t_mu[${i}] = t_mu[${op.a + op.offset}]; t_var[${i}] = t_var[${op.a + op.offset}];`);
        break;
      case "nop":
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
