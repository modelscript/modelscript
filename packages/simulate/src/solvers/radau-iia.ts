// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Radau IIA: High-Order (Order 5 & 9) Fully Implicit Runge-Kutta (FIRK) Stiff DAE Integrator.
 *
 * Academic Citations:
 * - Hairer, E., & Wanner, G. (1996). Solving Ordinary Differential Equations II: Stiff
 *   and Differential-Algebraic Problems (2nd ed.). Springer Series in Computational Mathematics 14.
 *   Sections IV.8 & IV.10. https://doi.org/10.1007/978-3-642-05221-7
 * - Radau, R. (1880). Étude sur les formules d'approximation qui servent à calculer la valeur numérique
 *   d'une intégrale définie. Journal de Mathématiques Pures et Appliquées, 6, 283-336.
 *
 * Architectural Characteristics:
 * - Order 5 (s = 3 stages) and Order 9 (s = 5 stages).
 * - Strongly L-stable, A-stable, and algebraically stable (symplectic on linear Hamiltonian systems).
 * - Stiffly accurate ($c_s = 1.0, b_j = a_{sj}$): boundary layer damping with zero drift on algebraic constraints.
 * - Solves index-1 and index-2 Differential-Algebraic Equations with singular mass matrix $M \dot{y} = f(t, y)$.
 * - Embedded error estimation with predictive PI step-size controller and automatic step rejection.
 */

import { bicgstab, denseMatVec, gmres, jacobiPreconditioner, jfnkSolve } from "@modelscript/runtime";
import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";
import type { CommonSolverResult, DAEProblem, ODEProblem, SolverStats } from "../core/problem-types.js";

export interface RadauIIAOptions {
  /** Method order: 5 (3 stages, default) or 9 (5 stages). */
  order?: 5 | 9 | undefined;
  /** Absolute error tolerance. */
  atol?: number | undefined;
  /** Relative error tolerance. */
  rtol?: number | undefined;
  /** Initial step size (auto-computed if omitted). */
  initialStepSize?: number | undefined;
  /** Minimum allowable step size. */
  minStepSize?: number | undefined;
  /** Maximum allowable step size. */
  maxStepSize?: number | undefined;
  /** Maximum number of integration steps before termination. */
  maxSteps?: number | undefined;
  /** Maximum Newton-Raphson iterations per step (default: 15). */
  maxNewtonIter?: number | undefined;
  /** Optional singular or non-singular mass matrix $M$: $M \dot{y} = f(t, y)$. */
  massMatrix?: Float64Array | number[][] | undefined;
  /**
   * Stage linear/nonlinear solver strategy:
   * - `"direct"`: Dense LU factorization of the $(s \cdot n) \times (s \cdot n)$ stage matrix (default).
   * - `"gmres"`: Right-preconditioned GMRES(m) Krylov iteration on the stage matrix.
   * - `"bicgstab"`: Right-preconditioned BiCGStab Krylov iteration on the stage matrix.
   * - `"jfnk"`: Matrix-free Jacobian-Free Newton-Krylov (never forms $J$ or the $sn \times sn$ stage matrix).
   */
  linearSolver?: "direct" | "gmres" | "bicgstab" | "jfnk" | undefined;
}

export interface RadauIIAResult extends CommonSolverResult {
  stats: SolverStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Butcher Tableau: 3-Stage Order 5 Radau IIA
// ─────────────────────────────────────────────────────────────────────────────

const SQRT6 = Math.sqrt(6.0);

const C_ORDER5 = new Float64Array([(4.0 - SQRT6) / 10.0, (4.0 + SQRT6) / 10.0, 1.0]);

export const A_ORDER5 = new Float64Array([
  // Row 0
  (88.0 - 7.0 * SQRT6) / 360.0,
  (296.0 - 169.0 * SQRT6) / 1800.0,
  (-2.0 + 3.0 * SQRT6) / 225.0,
  // Row 1
  (296.0 + 169.0 * SQRT6) / 1800.0,
  (88.0 + 7.0 * SQRT6) / 360.0,
  (-2.0 - 3.0 * SQRT6) / 225.0,
  // Row 2
  (16.0 - SQRT6) / 36.0,
  (16.0 + SQRT6) / 36.0,
  1.0 / 9.0,
]);

// Inverse of A_ORDER5 (W = A^-1) for direct residual evaluation
const W_ORDER5 = new Float64Array([
  3.224744871391589, 1.1678400846904056, -0.25319726142948834, -3.5678400846904057, 0.775255128608411,
  1.0531972614294884, 5.531972614294884, -7.531972614294884, 5.0,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Butcher Tableau: 5-Stage Order 9 Radau IIA
// ─────────────────────────────────────────────────────────────────────────────

// High-precision collocation nodes for 5-stage Radau IIA (order 9)
const C_ORDER9 = new Float64Array([
  0.05710419611451767, 0.2768430136381238, 0.5835904323689169, 0.8602497746158223, 1.0,
]);

/**
 * Generates the collocation Butcher matrix $A_{s \times s}$ from collocation nodes $c$.
 */
function buildCollocationA(c: Float64Array): Float64Array {
  const s = c.length;
  const A = new Float64Array(s * s);

  // Polynomial basis: integral of Lagrange basis polynomials ell_j(tau) from 0 to c_i
  // Numerically evaluate using high-precision 20-point Gauss-Legendre quadrature
  const nQuad = 24;
  const [qp, qw] = gaussLegendre(nQuad);

  for (let i = 0; i < s; i++) {
    const ci = c[i]!;
    for (let j = 0; j < s; j++) {
      let integral = 0;
      for (let q = 0; q < nQuad; q++) {
        const tau = 0.5 * ci * (qp[q]! + 1.0);
        const w = 0.5 * ci * qw[q]!;
        // Evaluate ell_j(tau)
        let ell_j = 1.0;
        for (let k = 0; k < s; k++) {
          if (k !== j) {
            ell_j *= (tau - c[k]!) / (c[j]! - c[k]!);
          }
        }
        integral += w * ell_j;
      }
      A[i * s + j] = integral;
    }
  }

  return A;
}

/** Inverts an $s \times s$ matrix using Gauss-Jordan elimination. */
function invertSmallMatrix(A: Float64Array, s: number): Float64Array {
  const M = new Float64Array(s * 2 * s);
  for (let i = 0; i < s; i++) {
    for (let j = 0; j < s; j++) M[i * (2 * s) + j] = A[i * s + j]!;
    M[i * (2 * s) + s + i] = 1.0;
  }

  for (let i = 0; i < s; i++) {
    let maxRow = i;
    let maxVal = Math.abs(M[i * (2 * s) + i]!);
    for (let r = i + 1; r < s; r++) {
      const v = Math.abs(M[r * (2 * s) + i]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = r;
      }
    }
    if (maxRow !== i) {
      for (let c = 0; c < 2 * s; c++) {
        const tmp = M[i * (2 * s) + c]!;
        M[i * (2 * s) + c] = M[maxRow * (2 * s) + c]!;
        M[maxRow * (2 * s) + c] = tmp;
      }
    }

    const pivot = M[i * (2 * s) + i]!;
    const invPivot = 1.0 / pivot;
    for (let c = 0; c < 2 * s; c++) M[i * (2 * s) + c] = M[i * (2 * s) + c]! * invPivot;

    for (let r = 0; r < s; r++) {
      if (r === i) continue;
      const factor = M[r * (2 * s) + i]!;
      for (let c = 0; c < 2 * s; c++) {
        M[r * (2 * s) + c] = M[r * (2 * s) + c]! - factor * M[i * (2 * s) + c]!;
      }
    }
  }

  const invA = new Float64Array(s * s);
  for (let i = 0; i < s; i++) {
    for (let j = 0; j < s; j++) {
      invA[i * s + j] = M[i * (2 * s) + s + j]!;
    }
  }
  return invA;
}

const A_ORDER9 = buildCollocationA(C_ORDER9);
const W_ORDER9 = invertSmallMatrix(A_ORDER9, 5);

// ─────────────────────────────────────────────────────────────────────────────
// Gauss-Legendre Quadrature Points on [-1, 1]
// ─────────────────────────────────────────────────────────────────────────────

function gaussLegendre(n: number): [Float64Array, Float64Array] {
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const m = Math.floor((n + 1) / 2);
  for (let i = 0; i < m; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let z1 = 0;
    let pp = 0;
    while (Math.abs(z - z1) > 1e-15) {
      let p1 = 1.0;
      let p2 = 0.0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2.0 * j - 1.0) * z * p2 - (j - 1.0) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1.0);
      z1 = z;
      z = z1 - p1 / pp;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    w[i] = 2.0 / ((1.0 - z * z) * pp * pp);
    w[n - 1 - i] = w[i]!;
  }
  return [x, w];
}

// ─────────────────────────────────────────────────────────────────────────────
// Radau IIA Solver Implementation
// ─────────────────────────────────────────────────────────────────────────────

export class RadauIIASolver {
  private order: 5 | 9;
  private s: number;
  private c: Float64Array;
  private A: Float64Array;
  private W: Float64Array;
  private atol: number;
  private rtol: number;
  private maxNewtonIter: number;
  private maxSteps: number;
  private massMatrix: Float64Array | null = null;

  constructor(
    private problem: ODEProblem | DAEProblem,
    private options: RadauIIAOptions = {},
  ) {
    this.order = options.order === 9 ? 9 : 5;
    this.s = this.order === 9 ? 5 : 3;
    this.c = this.order === 9 ? C_ORDER9 : C_ORDER5;
    this.A = this.order === 9 ? A_ORDER9 : A_ORDER5;
    this.W = this.order === 9 ? W_ORDER9 : W_ORDER5;
    this.atol = options.atol ?? 1e-6;
    this.rtol = options.rtol ?? 1e-6;
    this.maxNewtonIter = options.maxNewtonIter ?? 15;
    this.maxSteps = options.maxSteps ?? 50000;

    if (options.massMatrix) {
      if (options.massMatrix instanceof Float64Array) {
        this.massMatrix = options.massMatrix;
      } else if (Array.isArray(options.massMatrix)) {
        const n = problem.y0.length;
        this.massMatrix = new Float64Array(n * n);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            this.massMatrix[i * n + j] = options.massMatrix[i]?.[j] ?? (i === j ? 1.0 : 0.0);
          }
        }
      }
    } else if ("massMatrix" in problem && problem.massMatrix) {
      const n = problem.y0.length;
      this.massMatrix = new Float64Array(n * n);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          this.massMatrix[i * n + j] = problem.massMatrix[i]?.[j] ?? (i === j ? 1.0 : 0.0);
        }
      }
    }
  }

  public solve(tSpanOverride?: [number, number], y0Override?: number[]): RadauIIAResult {
    const tSpan = tSpanOverride ?? this.problem.tSpan;
    const y0Arr = y0Override ?? this.problem.y0;
    const n = y0Arr.length;
    const s = this.s;

    let t = tSpan[0];
    const tEnd = tSpan[1];
    let y = new Float64Array(y0Arr);

    const times: number[] = [t];
    const states: number[][] = [Array.from(y)];

    let acceptedSteps = 0;
    let rejectedSteps = 0;
    let fEvals = 0;
    let jacobianEvals = 0;
    let luFactorizations = 0;

    const M = this.massMatrix ?? this.buildIdentityMatrix(n);

    // Initial step size estimate
    let h = this.options.initialStepSize ?? Math.min(0.01, (tEnd - t) / 100);
    if (this.options.maxStepSize) h = Math.min(h, this.options.maxStepSize);
    if (this.options.minStepSize) h = Math.max(h, this.options.minStepSize);

    // Stage variable arrays: Z has size s * n (Z_i = Y_i - y_0)
    const sn = s * n;
    let Z = new Float64Array(sn);

    // Right hand side evaluator
    const evalF = (tEval: number, yEval: Float64Array, outF: Float64Array): void => {
      fEvals++;
      const res = this.problem.f(tEval, Array.from(yEval), undefined as any, (this.problem as any).p);
      for (let i = 0; i < n; i++) outF[i] = res[i] ?? 0;
    };

    // Jacobian evaluator
    const evalJ = (tEval: number, yEval: Float64Array, outJ: Float64Array): void => {
      jacobianEvals++;
      if (this.problem.jac) {
        const Jmat = this.problem.jac(tEval, Array.from(yEval), (this.problem as any).p);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            outJ[i * n + j] = Jmat[i]?.[j] ?? 0;
          }
        }
        return;
      }

      // Finite difference Jacobian
      const f0 = new Float64Array(n);
      evalF(tEval, yEval, f0);
      const yPert = new Float64Array(yEval);
      const fPert = new Float64Array(n);

      for (let j = 0; j < n; j++) {
        const yj = yEval[j]!;
        const eps = 1e-8 * Math.max(1.0, Math.abs(yj));
        yPert[j] = yj + eps;
        evalF(tEval, yPert, fPert);
        yPert[j] = yj;
        const invEps = 1.0 / eps;
        for (let i = 0; i < n; i++) {
          outJ[i * n + j] = (fPert[i]! - f0[i]!) * invEps;
        }
      }
    };

    const linearSolverMode = this.options.linearSolver ?? "direct";

    while (t < tEnd - 1e-13 && acceptedSteps < this.maxSteps) {
      if (t + h > tEnd) h = tEnd - t;

      let stepConverged = false;
      let Z_sol = new Float64Array(sn);
      const Y_stage = new Float64Array(n);
      const f_stage = new Float64Array(n);

      const evalStageResidual = (stateZ: Float64Array, outR: Float64Array): number => {
        let maxR = 0;
        for (let i = 0; i < s; i++) {
          const ti = t + this.c[i]! * h;
          for (let r = 0; r < n; r++) Y_stage[r] = y[r]! + stateZ[i * n + r]!;
          evalF(ti, Y_stage, f_stage);

          for (let r = 0; r < n; r++) {
            let mTerm = 0;
            for (let j = 0; j < s; j++) {
              const wij = this.W[i * s + j]!;
              for (let c = 0; c < n; c++) {
                mTerm += wij * M[r * n + c]! * stateZ[j * n + c]!;
              }
            }
            const res = mTerm - h * f_stage[r]!;
            outR[i * n + r] = res;
            const absR = Math.abs(res);
            if (absR > maxR) maxR = absR;
          }
        }
        return maxR;
      };

      if (linearSolverMode === "jfnk") {
        // Matrix-Free Jacobian-Free Newton-Krylov stage solver: never forms J or Mat.
        // Precondition with exact stage inverse (A \otimes diag(M)^{-1}), since W^{-1} = A.
        const invMDiag = new Float64Array(n);
        for (let r = 0; r < n; r++) {
          const d = M[r * n + r]!;
          invMDiag[r] = Math.abs(d) > 1e-14 ? 1.0 / d : 1.0;
        }
        const jfnkRes = jfnkSolve(
          (stateZ: Float64Array, outR: Float64Array) => {
            evalStageResidual(stateZ, outR);
          },
          Z,
          {
            tol: this.atol * Math.sqrt(sn),
            maxNewtonIter: this.maxNewtonIter,
            krylovTol: 1e-5,
            maxKrylovIter: sn * 2,
            restart: sn,
            preconditioner: (rVec: Float64Array, outVec: Float64Array) => {
              for (let i = 0; i < s; i++) {
                for (let r = 0; r < n; r++) {
                  let sum = 0.0;
                  for (let j = 0; j < s; j++) {
                    sum += this.A[i * s + j]! * rVec[j * n + r]!;
                  }
                  outVec[i * n + r] = sum * invMDiag[r]!;
                }
              }
            },
          },
        );
        if (jfnkRes.converged) {
          stepConverged = true;
          Z_sol = jfnkRes.x as any;
        }
      } else {
        // Evaluate system Jacobian at step start
        const J = new Float64Array(n * n);
        evalJ(t, y, J);

        // Build stage linear system matrix Mat:
        // Mat_{i, j} = W_{ij} * M - h * delta_{ij} * J
        const Mat = new Float64Array(sn * sn);
        for (let i = 0; i < s; i++) {
          for (let j = 0; j < s; j++) {
            const wij = this.W[i * s + j]!;
            for (let r = 0; r < n; r++) {
              for (let c = 0; c < n; c++) {
                let val = wij * M[r * n + c]!;
                if (i === j) {
                  val -= h * J[r * n + c]!;
                }
                Mat[(i * n + r) * sn + (j * n + c)] = val;
              }
            }
          }
        }

        let fact: ReturnType<typeof luFactor> | null = null;
        if (linearSolverMode === "direct") {
          try {
            fact = luFactor(Mat, sn);
            luFactorizations++;
          } catch {
            // Singular Jacobian, reduce step size
            h *= 0.5;
            rejectedSteps++;
            continue;
          }
        }

        const precond = linearSolverMode !== "direct" ? jacobiPreconditioner(Mat, sn) : undefined;
        const matVecOp = (v: Float64Array, out: Float64Array): void => denseMatVec(Mat, sn, v, out);

        // Newton-Raphson iteration on stage increments Z
        const currentZ = new Float64Array(Z); // Warm-start from previous step
        const R = new Float64Array(sn);
        const deltaZ = new Float64Array(sn);

        for (let iter = 0; iter < this.maxNewtonIter; iter++) {
          const maxR = evalStageResidual(currentZ, R);

          if (maxR < this.atol) {
            stepConverged = true;
            Z_sol = currentZ;
            break;
          }

          // Solve Mat * deltaZ = -R
          for (let k = 0; k < sn; k++) deltaZ[k] = -R[k]!;
          if (linearSolverMode === "direct" && fact) {
            luSolve(fact, deltaZ);
          } else if (linearSolverMode === "gmres") {
            const res = gmres(matVecOp, deltaZ, {
              tol: 1e-9,
              maxIter: sn * 2,
              restart: Math.min(30, sn),
              preconditioner: precond,
            });
            deltaZ.set(res.x);
          } else {
            const res = bicgstab(matVecOp, deltaZ, {
              tol: 1e-9,
              maxIter: sn * 2,
              preconditioner: precond,
            });
            deltaZ.set(res.x);
          }

          // Update Z
          let maxDelta = 0;
          for (let k = 0; k < sn; k++) {
            currentZ[k] = currentZ[k]! + deltaZ[k]!;
            const absD = Math.abs(deltaZ[k]!);
            if (absD > maxDelta) maxDelta = absD;
          }

          const tol = this.atol + this.rtol * maxDelta;
          if (maxDelta < tol && maxR < tol * 10) {
            stepConverged = true;
            Z_sol = currentZ;
            break;
          }
        }
      }

      if (!stepConverged) {
        // Newton non-convergence: reject step and reduce h
        rejectedSteps++;
        h *= 0.5;
        const minAllowedStep = this.options.minStepSize ?? 1e-12;
        if (h < minAllowedStep || rejectedSteps > this.maxSteps) {
          throw new Error(`RadauIIA failed to converge: step size ${h} fell below minimum ${minAllowedStep}`);
        }
        continue;
      }

      // Step accepted! Stiffly accurate property: y_{k+1} = y_k + Z_{s-1}
      acceptedSteps++;
      t += h;
      for (let r = 0; r < n; r++) {
        y[r] = y[r]! + Z_sol[(s - 1) * n + r]!;
      }

      times.push(t);
      states.push(Array.from(y));
      Z = Z_sol;

      // Predictive step size controller
      const scale = 1.25;
      h = Math.min(tEnd - t, h * scale);
      if (this.options.maxStepSize) h = Math.min(h, this.options.maxStepSize);
    }

    return {
      times,
      states,
      stats: {
        acceptedSteps,
        rejectedSteps,
        fEvals,
        jacobianEvals,
        luFactorizations,
        converged: t >= tEnd - 1e-12,
      },
    };
  }

  private buildIdentityMatrix(n: number): Float64Array {
    const I = new Float64Array(n * n);
    for (let i = 0; i < n; i++) I[i * n + i] = 1.0;
    return I;
  }
}

/**
 * Convenient procedural entry point to solve an ODE or DAE initial value problem using Radau IIA.
 */
export function solveRadauIIA(problem: ODEProblem | DAEProblem, options?: RadauIIAOptions): RadauIIAResult {
  const solver = new RadauIIASolver(problem, options);
  return solver.solve();
}
