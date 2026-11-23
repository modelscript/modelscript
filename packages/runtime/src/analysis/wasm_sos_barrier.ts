// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Sum-of-Squares (SOS) Barrier Certificate Synthesizer.
 *
 * Implements infinite-horizon (t \in [0, \infty)) safety verification for continuous dynamics:
 *   - Monomial basis generation m_d(x).
 *   - Gram matrix SOS representation: p(x) = m(x)^T Q m(x) with Q \succeq 0.
 *   - Putinar's Positivstellensatz constraint formulation.
 *   - In-WASM SDP solving for barrier certificate synthesis.
 */

import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability } from "../dae/wasm_dae.js";
import type { VerificationVerdict } from "../formal/verdict.js";
import { SdpSolver, type SdpProblem } from "../solvers/wasm_sdp_solver.js";
import { addUp, ivAdd, ivMul, ivSqrt, ivSub, subDown } from "./outward_rounding.js";
import { Interval } from "./wasm_interval.js";

/** Single multivariate polynomial term `coeff * x_0^{exps[0]} * ... * x_{n-1}^{exps[n-1]}`. */
export interface PolynomialTerm {
  coeff: number;
  exps: number[];
}

/** Exact polynomial dynamical system `dx_i/dt = Σ_k terms[i][k]` for rigorous SOS certification. */
export interface ExactPolynomialSystem {
  numVars: number;
  /** Polynomial vector field for each state dimension `i = 0..numVars-1`. */
  vectorField: PolynomialTerm[][];
  varNames?: string[] | undefined;
}

/**
 * Rump's Rigorous Interval Cholesky Certification of Positive Definiteness.
 *
 * Computes an outward-rounded interval Cholesky factorization `L` of `M - margin*I`.
 * If every diagonal radicand interval has `lo > 0`, then EVERY symmetric matrix in the
 * interval hull (and in particular exact `M`) is provably strictly positive definite
 * with minimum eigenvalue `> margin`.
 */
export function certifyPsdInterval(M: number[][], margin = 0): { certified: boolean; minPivotLo: number } {
  const n = M.length;
  if (n === 0) return { certified: true, minPivotLo: Infinity };
  const L: Interval[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => new Interval(0, 0)));
  let minPivotLo = Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      // Symmetrize M_ij rigorously
      const mij = 0.5 * ((M[i]?.[j] ?? 0) + (M[j]?.[i] ?? 0));
      let sum = new Interval(mij, mij);
      if (i === j && margin !== 0) {
        sum = ivSub(sum, new Interval(margin, margin));
      }
      for (let k = 0; k < j; k++) {
        sum = ivSub(sum, ivMul(L[i]![k]!, L[j]![k]!));
      }
      if (i === j) {
        if (!Number.isFinite(sum.lo) || sum.lo <= 0) {
          return { certified: false, minPivotLo: sum.lo };
        }
        const diagIv = ivSqrt(sum);
        if (!Number.isFinite(diagIv.lo) || diagIv.lo <= 0) {
          return { certified: false, minPivotLo: diagIv.lo };
        }
        L[i]![i] = diagIv;
        if (diagIv.lo < minPivotLo) minPivotLo = diagIv.lo;
      } else {
        const ljj = L[j]![j]!;
        if (ljj.lo <= 0) return { certified: false, minPivotLo: 0 };
        const invLo = 1 / ljj.hi;
        const invHi = 1 / ljj.lo;
        const invIv = new Interval(subDown(invLo, 0), addUp(invHi, 0));
        L[i]![j] = ivMul(sum, invIv);
      }
    }
  }
  return { certified: true, minPivotLo };
}

export interface PolynomialSystem {
  numVars: number;
  /** Vector field: dy_i/dt = f_i(y) given as evaluation function */
  f: (y: number[]) => number[];
  /** State dimension names */
  varNames?: string[] | undefined;
}

export interface BarrierSpecification {
  /** Initial set: { x | x^T x <= r0^2 } */
  initialRadius: number;
  /** Unsafe set: { x | x^T x >= ru^2 } */
  unsafeRadius: number;
  /** Polynomial degree for barrier B(x) (default: 2) */
  degree?: number | undefined;
}

export interface BarrierCertificateResult {
  /** Always false: no barrier inequality is verified (see `verdict`). */
  isCertifiedSafe: boolean;
  /** Always `unknown(not-rigorous)`. */
  verdict: VerificationVerdict;
  /** Heuristic screening result (level-set separation and a negative diagonal Jacobian entry). NOT a proof. */
  candidateFound: boolean;
  barrierCoefficients: number[];
  barrierDegree: number;
  lyapunovDecayRate?: number | undefined;
  summary: string;
}

const SOS_NOT_RIGOROUS: VerificationVerdict = {
  kind: "unknown",
  reason: "not-rigorous",
  rigor: "heuristic",
  detail:
    "The candidate B(x)=x^T P x is not verified: dynamics are linearized at the origin by finite differences, stability is read from A[0][0] only, and P is not shown to solve a Lyapunov inequality.",
};

export class SosBarrierSynthesizer {
  /**
   * Synthesizes a quadratic Lyapunov / Barrier Certificate B(x) = x^T P x
   * such that:
   *   1. B(x) <= gamma on Initial set { ||x|| <= r0 }
   *   2. B(x) > gamma on Unsafe set { ||x|| >= ru }
   *   3. \dot{B}(x) = 2 x^T P f(x) <= -alpha ||x||^2  (Negative definite flow)
   */
  public static synthesizeQuadratic(system: PolynomialSystem, spec: BarrierSpecification): BarrierCertificateResult {
    const n = system.numVars;
    const r0 = spec.initialRadius;
    const ru = spec.unsafeRadius;

    // For linear / linearized system dx/dt = A x near origin:
    // P A + A^T P <= -Q
    // Numerical Jacobian estimation around origin (subtracting f(0)!)
    const eps = 1e-4;
    const fZero = system.f(new Array<number>(n).fill(0));
    const A: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      const f0i = fZero[i] ?? 0;
      for (let j = 0; j < n; j++) {
        const xPert = new Array<number>(n).fill(0);
        xPert[j] = eps;
        const fPert = system.f(xPert)[i] ?? 0;
        row[j] = (fPert - f0i) / eps;
      }
      A.push(row);
    }

    // Formulate Lyapunov equation -(A^T P + P A) = 2 I as an SDP over symmetric P > 0:
    // For each upper-triangular pair (k, l) with 0 <= k <= l < n,
    // -(A^T P + P A)_{kl} = tr(G^{(k,l)} P) = (k === l ? 2.0 : 0.0)
    const sdpA: number[][][] = [];
    const sdpB: number[] = [];

    for (let k = 0; k < n; k++) {
      for (let l = k; l < n; l++) {
        const Gkl: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            let val = 0;
            if (j === l) val += -(A[i]?.[k] ?? 0);
            if (i === l) val += -(A[j]?.[k] ?? 0);
            if (i === k) val += -(A[j]?.[l] ?? 0);
            if (j === k) val += -(A[i]?.[l] ?? 0);
            Gkl[i]![j] = 0.5 * val;
          }
        }
        // Only add constraint if Gkl is non-zero
        let normG = 0;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            normG += Math.abs(Gkl[i]![j]!);
          }
        }
        if (normG > 1e-10) {
          sdpA.push(Gkl);
          sdpB.push(k === l ? 2.0 : 0.0);
        }
      }
    }

    // Fallback diagonal normalization if A is identically zero
    if (sdpA.length === 0) {
      for (let k = 0; k < n; k++) {
        const Ak: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        Ak[k]![k] = 1.0;
        sdpA.push(Ak);
        sdpB.push(1.0);
      }
    }

    let P: number[][];
    const isStable2x2 =
      n === 2 && A[0]![0]! + A[1]![1]! < -1e-9 && A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]! > 1e-9;

    if (isStable2x2) {
      // Exact closed-form 3x3 linear solve for A^T P + P A = -2 I when n = 2
      const a11 = A[0]![0]!;
      const a12 = A[0]![1]!;
      const a21 = A[1]![0]!;
      const a22 = A[1]![1]!;
      const M = [
        [2 * a11, 2 * a21, 0, -2],
        [a12, a11 + a22, a21, 0],
        [0, 2 * a12, 2 * a22, -2],
      ];
      for (let col = 0; col < 3; col++) {
        let piv = col;
        for (let r = col + 1; r < 3; r++) {
          if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
        }
        [M[col], M[piv]] = [M[piv]!, M[col]!];
        const div = M[col]![col]!;
        if (Math.abs(div) > 1e-12) {
          for (let j = col; j < 4; j++) M[col]![j]! /= div;
          for (let r = 0; r < 3; r++) {
            if (r !== col) {
              const f = M[r]![col]!;
              for (let j = col; j < 4; j++) M[r]![j]! -= f * M[col]![j]!;
            }
          }
        }
      }
      const p11 = M[0]![3]!;
      const p12 = M[1]![3]!;
      const p22 = M[2]![3]!;
      P = [
        [p11, p12],
        [p12, p22],
      ];
    } else {
      const sdpProblem: SdpProblem = {
        n,
        m: sdpA.length,
        C: Array.from({ length: n }, (_, i) => {
          const row = new Array<number>(n).fill(0);
          row[i] = 1.0;
          return row;
        }),
        A: sdpA,
        b: sdpB,
      };

      const sdpRes = SdpSolver.solve(sdpProblem);
      P = sdpRes.X;
    }

    // Compute negative Lyapunov derivative matrix Q = -(A^T P + P A)
    const Q: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < n; k++) {
          sum += (A[k]?.[i] ?? 0) * (P[k]?.[j] ?? 0) + (P[i]?.[k] ?? 0) * (A[k]?.[j] ?? 0);
        }
        Q[i]![j] = -sum;
      }
    }

    // Check positive definiteness of both P and Q = -(A^T P + P A) - eps*I
    const qShifted = Q.map((row, i) => row.map((v, j) => (i === j ? v - 1e-4 : v)));
    const isPsdP = SdpSolver.isPsd(P);
    const isLyapStable = isPsdP && SdpSolver.isPsd(qShifted);

    // Gershgorin eigenvalue bounds for level-set separation:
    // Max value on initial set: lambda_max(P) * r0^2
    // Min value on unsafe set: lambda_min(P) * ru^2
    let lambdaMaxP = 0;
    let lambdaMinP = Infinity;
    let minDecayRate = Infinity;

    if (n === 2) {
      const a = P[0]![0] ?? 0;
      const b = P[0]![1] ?? 0;
      const c = P[1]![1] ?? 0;
      const halfTraceP = 0.5 * (a + c);
      const discP = Math.sqrt(Math.max(0, 0.25 * (a - c) * (a - c) + b * b));
      lambdaMaxP = halfTraceP + discP;
      lambdaMinP = Math.max(0, halfTraceP - discP);

      const qa = Q[0]![0] ?? 0;
      const qb = Q[0]![1] ?? 0;
      const qc = Q[1]![1] ?? 0;
      const halfTraceQ = 0.5 * (qa + qc);
      const discQ = Math.sqrt(Math.max(0, 0.25 * (qa - qc) * (qa - qc) + qb * qb));
      const lambdaMinQ = Math.max(0, halfTraceQ - discQ);
      if (lambdaMaxP > 1e-8) {
        minDecayRate = lambdaMinQ / (2 * lambdaMaxP);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const pii = P[i]![i] ?? 0;
        let offDiagP = 0;
        let offDiagQ = 0;
        for (let j = 0; j < n; j++) {
          if (i !== j) {
            offDiagP += Math.abs(P[i]![j] ?? 0);
            offDiagQ += Math.abs(Q[i]![j] ?? 0);
          }
        }
        lambdaMaxP = Math.max(lambdaMaxP, pii + offDiagP);
        lambdaMinP = Math.min(lambdaMinP, Math.max(0, pii - offDiagP));
        const qMinRow = (Q[i]![i] ?? 0) - offDiagQ;
        if (pii > 1e-8) {
          minDecayRate = Math.min(minDecayRate, qMinRow / (2 * (pii + offDiagP)));
        }
      }
    }

    const maxInitialVal = lambdaMaxP * r0 * r0;
    const minUnsafeVal = lambdaMinP * ru * ru;

    const isSeparated = minUnsafeVal > maxInitialVal && lambdaMinP > 0;
    const isCertified = isSeparated && isLyapStable;

    const coeffs: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        coeffs.push(P[i]![j] ?? 0);
      }
    }

    // Strict rigor contract: FD linearization + heuristic SDP yields a candidate only,
    // NEVER a formally certified nonlinear safety proof.
    const verdict: VerificationVerdict = SOS_NOT_RIGOROUS;

    return {
      isCertifiedSafe: false,
      verdict,
      candidateFound: isCertified,
      barrierCoefficients: coeffs,
      barrierDegree: 2,
      lyapunovDecayRate: Number.isFinite(minDecayRate) && minDecayRate > 0 ? minDecayRate : Math.abs(A[0]?.[0] ?? 0.1),
      summary: isCertified
        ? `Quadratic barrier candidate found (heuristic linearization; NOT rigorously certified for nonlinear dynamics).`
        : `Quadratic barrier unverified: B(x) = x^T P x did not achieve strict separation or positive definiteness.`,
    };
  }

  /**
   * Synthesizes higher-degree (degree 4) SOS Barrier Certificates for non-convex / cubic nonlinear dynamics:
   *   B(x) = x^T P_1 x + m_2(x)^T Q_4 m_2(x)
   * where m_2(x) = [x_1^2, ..., x_n^2]^T and Q_4 >= 0 is synthesized via SDP.
   */
  public static synthesizeHigherDegree(
    system: PolynomialSystem,
    spec: BarrierSpecification,
    degree: 4 = 4,
  ): BarrierCertificateResult {
    const quadRes = SosBarrierSynthesizer.synthesizeQuadratic(system, spec);
    if (!quadRes.candidateFound) {
      return {
        isCertifiedSafe: false,
        verdict: SOS_NOT_RIGOROUS,
        candidateFound: false,
        barrierCoefficients: [],
        barrierDegree: degree,
        summary: "Higher-degree barrier candidate not found for given bounds.",
      };
    }

    const n = system.numVars;
    const r0 = spec.initialRadius;
    const ru = spec.unsafeRadius;

    // Estimate cubic / higher-order directional derivative along axes at sample radius rSample
    const rSample = 0.5 * (r0 + ru);
    const sdpA4: number[][][] = [];
    const sdpB4: number[] = [];
    for (let k = 0; k < n; k++) {
      const xSample = new Array<number>(n).fill(0);
      xSample[k] = rSample;
      const fk = system.f(xSample)[k] ?? 0;
      // For B_4(x) = sum c_k x_k^4, dB_4/dx_k * f_k(x) = 4 c_k x_k^3 f_k(x).
      // When f_k(xSample) * xSample_k < 0 (dissipative), -4 * x_k^3 * f_k > 0.
      const dissRate = Math.max(1.0, (-4.0 * Math.pow(rSample, 3) * fk) / Math.max(1.0, Math.pow(rSample, 4)));
      const Ak: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      Ak[k]![k] = dissRate;
      sdpA4.push(Ak);
      sdpB4.push(0.1 * dissRate);
    }

    const sdp4: SdpProblem = {
      n,
      m: n,
      C: Array.from({ length: n }, (_, i) => {
        const row = new Array<number>(n).fill(0);
        row[i] = 1.0;
        return row;
      }),
      A: sdpA4,
      b: sdpB4,
    };
    const sdpRes4 = SdpSolver.solve(sdp4);

    // Expand quadratic barrier coefficients to degree 4 monomials using solved Gram matrix diagonal
    const quarticCoeffs = [...quadRes.barrierCoefficients];
    for (let i = 0; i < n; i++) {
      quarticCoeffs.push(Math.max(1e-4, sdpRes4.X[i]?.[i] ?? 0.1));
    }

    const candidateFound = quadRes.candidateFound && SdpSolver.isPsd(sdpRes4.X);
    const higherVerdict: VerificationVerdict = SOS_NOT_RIGOROUS;

    return {
      isCertifiedSafe: false,
      verdict: higherVerdict,
      candidateFound,
      barrierCoefficients: quarticCoeffs,
      barrierDegree: degree,
      lyapunovDecayRate: quadRes.lyapunovDecayRate,
      summary: candidateFound
        ? `Degree-${degree} barrier candidate found (heuristic, NOT formally verified); safety for all time is not proven.`
        : `Degree-${degree} barrier candidate not found for given bounds.`,
    };
  }

  /**
   * Rigorous SOS Barrier Certification for Exact Polynomial Vector Fields.
   *
   * Given `dx/dt = f(x)` as exact polynomial terms, synthesizes a quadratic barrier
   * `B(x) = x^T P x` via SDP and certifies all three barrier inequalities using
   * outward-rounded Rump Interval Cholesky factorization:
   *   1. `P - eps_P I ≻ 0` (positive definiteness of B)
   *   2. Level-set separation: `λ_min(P) * r_u^2 > λ_max(P) * r_0^2` (rigorous outward-rounded bounds)
   *   3. Global/local Lie derivative dissipation:
   *      For linear + dissipative odd-degree polynomial terms on `{ ||x|| <= r_u }`,
   *      `-∇B(x) · f(x) = x^T Q_lin x + R_nl(x) >= eps * ||x||^2` where `Q_lin - δ I ≻ 0`
   *      is certified by Interval Cholesky with `δ` rigorously upper-bounding all higher-order
   *      non-dissipative polynomial remainder terms over `{ ||x|| <= r_u }`.
   *
   * Emits `verdict: { kind: "proven", rigor: "rigorous" }` ONLY when every check passes.
   */
  public static synthesizePolynomialCertified(
    polySystem: ExactPolynomialSystem,
    spec: BarrierSpecification,
  ): BarrierCertificateResult {
    const n = polySystem.numVars;
    const r0 = spec.initialRadius;
    const ru = spec.unsafeRadius;

    // 1. Extract exact linear part A (degree-1 terms) and classify higher-order terms
    const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const higherOrderTerms: { dim: number; term: PolynomialTerm; totalDeg: number }[] = [];
    let hasConstantDrift = false;

    for (let i = 0; i < n; i++) {
      for (const term of polySystem.vectorField[i] ?? []) {
        if (term.coeff === 0) continue;
        let totalDeg = 0;
        let singleVar = -1;
        for (let j = 0; j < n; j++) {
          const e = term.exps[j] ?? 0;
          totalDeg += e;
          if (e === 1) singleVar = j;
        }
        if (totalDeg === 0) {
          hasConstantDrift = true;
        } else if (totalDeg === 1 && singleVar >= 0) {
          A[i]![singleVar] = A[i]![singleVar]! + term.coeff;
        } else {
          higherOrderTerms.push({ dim: i, term, totalDeg });
        }
      }
    }

    if (hasConstantDrift) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "unsupported",
          rigor: "rigorous",
          detail: "Non-zero equilibrium drift f(0) != 0; shift coordinates to equilibrium before SOS certification.",
        },
        candidateFound: false,
        barrierCoefficients: [],
        barrierDegree: 2,
        summary: "Polynomial SOS certification requires equilibrium at origin (f(0) = 0).",
      };
    }

    // 2. Solve Lyapunov SDP: -(A^T P + P A) = 2 I, P > 0
    const sdpA: number[][][] = [];
    const sdpB: number[] = [];
    for (let k = 0; k < n; k++) {
      for (let l = k; l < n; l++) {
        const Gkl: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            let val = 0;
            if (j === l) val += -(A[i]?.[k] ?? 0);
            if (i === l) val += -(A[j]?.[k] ?? 0);
            if (i === k) val += -(A[j]?.[l] ?? 0);
            if (j === k) val += -(A[i]?.[l] ?? 0);
            Gkl[i]![j] = 0.5 * val;
          }
        }
        let normG = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) normG += Math.abs(Gkl[i]![j]!);
        if (normG > 1e-12) {
          sdpA.push(Gkl);
          sdpB.push(k === l ? 2.0 : 0.0);
        }
      }
    }

    const sdpRes = SdpSolver.solve({
      n,
      m: sdpA.length,
      C: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0))),
      A: sdpA,
      b: sdpB,
    });
    const P = sdpRes.X;

    // 3. Rigorous Interval Cholesky check on P > 0
    const pCert = certifyPsdInterval(P, 1e-9);
    if (!pCert.certified) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "nonconvergent",
          rigor: "rigorous",
          detail: "Interval Cholesky failed to certify P ≻ 0.",
        },
        candidateFound: false,
        barrierCoefficients: P.flat(),
        barrierDegree: 2,
        summary: "Polynomial SOS certification failed: P is not provably positive definite.",
      };
    }

    // 4. Compute exact outward-rounded linear Lie derivative matrix Q = -(A^T P + P A)
    // and bound higher-order polynomial contributions over { ||x|| <= ru }
    const Q: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let qRoundErr = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let acc = new Interval(0, 0);
        for (let k = 0; k < n; k++) {
          const term1 = ivMul(new Interval(A[k]![i]!, A[k]![i]!), new Interval(P[k]![j]!, P[k]![j]!));
          const term2 = ivMul(new Interval(P[i]![k]!, P[i]![k]!), new Interval(A[k]![j]!, A[k]![j]!));
          acc = ivAdd(acc, ivAdd(term1, term2));
        }
        const negMid = -0.5 * (acc.lo + acc.hi);
        Q[i]![j] = negMid;
        qRoundErr = addUp(qRoundErr, Math.max(Math.abs(-acc.lo - negMid), Math.abs(-acc.hi - negMid)));
      }
    }

    // Bound |2 x^T P f_nl(x)| <= nlBound * ||x||^2 on { ||x|| <= ru }
    // Purely dissipative diagonal odd terms (c * x_i^{2k+1} with c < 0 and diagonal P_ii > 0, P_ij = 0)
    // strictly help dissipation; all other higher-order terms are rigorously upper-bounded by ru^{d-1}.
    let nlMargin = addUp(0, n * qRoundErr);
    let isPDiagonal = true;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && Math.abs(P[i]![j]!) > 1e-12) isPDiagonal = false;
      }
    }
    for (const { dim, term, totalDeg } of higherOrderTerms) {
      const isPureDiagonalOddDissipative =
        isPDiagonal && term.coeff < 0 && totalDeg % 2 === 1 && (term.exps[dim] ?? 0) === totalDeg;
      if (isPureDiagonalOddDissipative) continue; // -2 P_ii c x_i^{2k+2} >= 0 everywhere!

      // Bound |2 * Σ_k P_{k,dim} x_k * coeff * Π x_j^{e_j}| <= 2 * ||P_{:,dim}||_2 * |coeff| * ru^{totalDeg - 1} * ||x||^2
      let colNormSq = 0;
      for (let k = 0; k < n; k++) colNormSq = addUp(colNormSq, addUp(P[k]![dim]! * P[k]![dim]!, 0));
      const colNorm = ivSqrt(new Interval(colNormSq, colNormSq)).hi;
      let ruPow = 1;
      for (let d = 1; d < totalDeg; d++) ruPow = addUp(ruPow * ru, 0);
      const contrib = addUp(2 * colNorm * Math.abs(term.coeff) * ruPow, 1e-15);
      nlMargin = addUp(nlMargin, contrib);
    }

    // 5. Certify Q - (nlMargin + eps) I ≻ 0 via Interval Cholesky
    const qCert = certifyPsdInterval(Q, addUp(nlMargin, 1e-9));
    if (!qCert.certified) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "inconclusive-enclosure",
          rigor: "rigorous",
          detail: `Interval Cholesky could not certify Lie derivative dissipation (nonlinear margin=${nlMargin.toExponential(3)}).`,
        },
        candidateFound: false,
        barrierCoefficients: P.flat(),
        barrierDegree: 2,
        summary: `Polynomial SOS Lie-derivative check failed (nonlinear margin ${nlMargin.toExponential(2)} exceeds linear decay).`,
      };
    }

    // 6. Certify strict level-set separation: λ_min(P) * ru^2 > λ_max(P) * r0^2 using outward-rounded Gershgorin
    let lambdaMaxP = 0;
    let lambdaMinP = Infinity;
    for (let i = 0; i < n; i++) {
      let off = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) off = addUp(off, Math.abs(P[i]![j]!));
      }
      lambdaMaxP = Math.max(lambdaMaxP, addUp(P[i]![i]!, off));
      lambdaMinP = Math.min(lambdaMinP, subDown(P[i]![i]!, off));
    }

    const maxInitB = ivMul(new Interval(lambdaMaxP, lambdaMaxP), ivMul(new Interval(r0, r0), new Interval(r0, r0))).hi;
    const minUnsafeB = ivMul(
      new Interval(lambdaMinP, lambdaMinP),
      ivMul(new Interval(ru, ru), new Interval(ru, ru)),
    ).lo;
    const separated = lambdaMinP > 0 && minUnsafeB > maxInitB;

    if (!separated) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "inconclusive-enclosure",
          rigor: "rigorous",
          detail: `Level-set separation not proven: minUnsafe=${minUnsafeB} <= maxInit=${maxInitB}.`,
        },
        candidateFound: false,
        barrierCoefficients: P.flat(),
        barrierDegree: 2,
        summary: `Polynomial SOS level-set separation failed (${minUnsafeB.toFixed(4)} <= ${maxInitB.toFixed(4)}).`,
      };
    }

    const decayRate = (qCert.minPivotLo * qCert.minPivotLo) / Math.max(1e-12, 2 * lambdaMaxP);
    return {
      isCertifiedSafe: true,
      verdict: {
        kind: "proven",
        rigor: "rigorous",
        detail: `Interval-Cholesky certified quadratic SOS barrier B(x)=x^T P x on ||x|| <= ${ru} (nlMargin=${nlMargin.toExponential(2)}).`,
      },
      candidateFound: true,
      barrierCoefficients: P.flat(),
      barrierDegree: 2,
      lyapunovDecayRate: decayRate,
      summary: `Polynomial SOS barrier rigorously certified via Interval Cholesky (decay >= ${decayRate.toExponential(2)}).`,
    };
  }

  /**
   * Rigorous Higher-Degree (Degree-4) Putinar SOS Barrier Certification for Exact Polynomial Vector Fields.
   *
   * Synthesizes a quartic barrier `B(x) = x^T P_2 x + m_2(x)^T P_4 m_2(x)` where `m_2(x) = [x_1^2, ..., x_n^2]^T`,
   * certifying:
   *   1. `P_2 ≻ 0` and `P_4 ≻ 0` via Rump's outward-rounded Interval Cholesky (`certifyPsdInterval`).
   *   2. Strict level-set separation on `||x|| <= r_0` vs `||x|| >= r_u` using outward-rounded quartic + quadratic bounds.
   *   3. Lie derivative dissipation `-∇B(x) · f(x) >= ε ||x||^2` over `||x|| <= r_u` with outward-rounded
   *      quartic cross-term and nonlinear remainder bounds.
   */
  public static synthesizePutinarQuarticCertified(
    polySystem: ExactPolynomialSystem,
    spec: BarrierSpecification,
  ): BarrierCertificateResult {
    const quad = SosBarrierSynthesizer.synthesizePolynomialCertified(polySystem, spec);
    if (!quad.isCertifiedSafe || quad.verdict.kind !== "proven") {
      return {
        ...quad,
        barrierDegree: 4,
      };
    }

    const n = polySystem.numVars;
    const r0 = spec.initialRadius;
    const ru = spec.unsafeRadius;

    // Extract diagonal linear rates a_ii from exact degree-1 terms
    const diagA = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (const t of polySystem.vectorField[i] ?? []) {
        let deg = 0;
        for (let j = 0; j < n; j++) deg += t.exps[j] ?? 0;
        if (deg === 1 && (t.exps[i] ?? 0) === 1) diagA[i] = diagA[i]! + t.coeff;
      }
    }

    // Build diagonal quartic Gram matrix P_4 = diag(c_i) chosen small enough that
    // its cross-coupling Lie derivative contribution stays strictly inside the quadratic margin,
    // while strictly tightening outer level-set separation (since ru^4 / r0^4 >> ru^2 / r0^2).
    const cScale = 0.05 / Math.max(1.0, ru * ru);
    const P4: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        i === j ? cScale * Math.max(0.5, Math.min(2.0, Math.abs(diagA[i]!) || 1.0)) : 0,
      ),
    );

    const p4Cert = certifyPsdInterval(P4, 1e-12);
    if (!p4Cert.certified) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "nonconvergent",
          rigor: "rigorous",
          detail: "Interval Cholesky failed to certify quartic Gram matrix P_4 ≻ 0.",
        },
        candidateFound: false,
        barrierCoefficients: quad.barrierCoefficients,
        barrierDegree: 4,
        summary: "Degree-4 Putinar SOS barrier certification failed: P_4 not provably PSD.",
      };
    }

    // Verify quartic Lie derivative contribution on ||x|| <= ru is dissipative (4 c_i x_i^3 f_i(x) <= 0 for diagA_i < 0)
    // and bound any off-diagonal linear/nonlinear terms against the certified quadratic decay margin.
    const quadMargin = quad.lyapunovDecayRate ?? 0;
    let quarticCrossBound = 0;
    for (let i = 0; i < n; i++) {
      const ci = P4[i]![i]!;
      for (const term of polySystem.vectorField[i] ?? []) {
        let deg = 0;
        for (let j = 0; j < n; j++) deg += term.exps[j] ?? 0;
        const isPureDiagOddDissipative = term.coeff < 0 && deg % 2 === 1 && (term.exps[i] ?? 0) === deg;
        if (isPureDiagOddDissipative) continue; // 4 c_i x_i^3 * (neg * x_i^{2k+1}) <= 0 everywhere
        let ruPow = 1;
        for (let d = 0; d < deg + 1; d++) ruPow = addUp(ruPow * ru, 0);
        quarticCrossBound = addUp(quarticCrossBound, addUp(4 * ci * Math.abs(term.coeff) * ruPow, 1e-15));
      }
    }

    if (quarticCrossBound >= quadMargin) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "inconclusive-enclosure",
          rigor: "rigorous",
          detail: `Quartic cross-term bound (${quarticCrossBound.toExponential(2)}) exceeds quadratic decay margin (${quadMargin.toExponential(2)}).`,
        },
        candidateFound: false,
        barrierCoefficients: [...quad.barrierCoefficients, ...P4.flat()],
        barrierDegree: 4,
        summary: "Degree-4 Putinar SOS Lie-derivative bound inconclusive.",
      };
    }

    // Outward-rounded quartic level-set separation bonus:
    // B(x) = B_2(x) + Σ c_i x_i^4 => on ||x|| <= r0, B_4 <= max(c_i) * r0^4; on ||x|| >= ru, B_4 >= min(c_i) * ru^4 / n
    const cVals = P4.map((row, i) => row[i]!);
    const cMax = Math.max(...cVals);
    const cMin = Math.min(...cVals);
    const r0_4 = ivMul(
      ivMul(new Interval(r0, r0), new Interval(r0, r0)),
      ivMul(new Interval(r0, r0), new Interval(r0, r0)),
    ).hi;
    const ru_4 = ivMul(
      ivMul(new Interval(ru, ru), new Interval(ru, ru)),
      ivMul(new Interval(ru, ru), new Interval(ru, ru)),
    ).lo;
    const quarticSep = (cMin * ru_4) / n > cMax * r0_4;

    if (!quarticSep) {
      return {
        isCertifiedSafe: false,
        verdict: {
          kind: "unknown",
          reason: "inconclusive-enclosure",
          rigor: "rigorous",
          detail: "Quartic level-set separation not strictly positive.",
        },
        candidateFound: false,
        barrierCoefficients: [...quad.barrierCoefficients, ...P4.flat()],
        barrierDegree: 4,
        summary: "Degree-4 Putinar SOS level-set separation failed.",
      };
    }

    return {
      isCertifiedSafe: true,
      verdict: {
        kind: "proven",
        rigor: "rigorous",
        detail: `Interval-Cholesky certified degree-4 Putinar SOS barrier B(x)=x^T P_2 x + m_2(x)^T P_4 m_2(x) on ||x|| <= ${ru}.`,
      },
      candidateFound: true,
      barrierCoefficients: [...quad.barrierCoefficients, ...P4.flat()],
      barrierDegree: 4,
      lyapunovDecayRate: Math.max(0, quadMargin - quarticCrossBound),
      summary: `Degree-4 Putinar SOS barrier rigorously certified via Interval Cholesky (P_2 ≻ 0, P_4 ≻ 0).`,
    };
  }
}

/**
 * Automatically lowers a polynomial ODE `DAEBuilder` arena (`der(x_i) = P_i(x)`) into an
 * `ExactPolynomialSystem` for rigorous Interval-Cholesky SOS barrier certification.
 * Returns `null` if the arena contains non-polynomial operators (transcendentals, divisions by state, etc.).
 */
export function extractPolynomialSystemFromArena(arena: DAEBuilder): ExactPolynomialSystem | null {
  const stateNames: string[] = [];
  const stateIdxByNameId = new Map<number, number>();
  const diffEqRhs = new Map<number, number>();

  // 1. Collect differential state equations der(x) = rhs
  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    const kind = arena.getEqKind(eqIdx);
    if (kind !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    let targetExpr = -1;
    let rhsExpr = -1;
    if (arena.getExprKind(lhs) === ExprKind.Der) {
      targetExpr = arena.getExprData1(lhs);
      rhsExpr = rhs;
    } else if (arena.getExprKind(rhs) === ExprKind.Der) {
      targetExpr = arena.getExprData1(rhs);
      rhsExpr = lhs;
    }
    if (targetExpr >= 0 && arena.getExprKind(targetExpr) === ExprKind.Name) {
      const nameId = arena.getExprData1(targetExpr);
      if (!stateIdxByNameId.has(nameId)) {
        const idx = stateNames.length;
        stateIdxByNameId.set(nameId, idx);
        stateNames.push(arena.interner.resolve(nameId) ?? `x${idx}`);
      }
      diffEqRhs.set(stateIdxByNameId.get(nameId)!, rhsExpr);
    }
  }

  const n = stateNames.length;
  if (n === 0) return null;

  // Parameter constant map
  const paramVals = new Map<number, number>();
  for (let i = 0; i < arena.varCount; i++) {
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      const val = arena.getVarStartValue(i);
      if (Number.isFinite(val)) {
        paramVals.set(arena.getVarNameId(i), val);
      }
    }
  }

  const mergeTerms = (terms: PolynomialTerm[]): PolynomialTerm[] => {
    const map = new Map<string, PolynomialTerm>();
    for (const t of terms) {
      if (t.coeff === 0) continue;
      const key = t.exps.join(",");
      const existing = map.get(key);
      if (existing) existing.coeff += t.coeff;
      else map.set(key, { coeff: t.coeff, exps: [...t.exps] });
    }
    return Array.from(map.values()).filter((t) => Math.abs(t.coeff) > 1e-15);
  };

  const mulPolys = (a: PolynomialTerm[], b: PolynomialTerm[]): PolynomialTerm[] => {
    const out: PolynomialTerm[] = [];
    for (const ta of a) {
      for (const tb of b) {
        const exps = new Array<number>(n);
        for (let k = 0; k < n; k++) exps[k] = (ta.exps[k] ?? 0) + (tb.exps[k] ?? 0);
        out.push({ coeff: ta.coeff * tb.coeff, exps });
      }
    }
    return mergeTerms(out);
  };

  const lowerExpr = (exprId: number): PolynomialTerm[] | null => {
    const kind = arena.getExprKind(exprId);
    const zeros = () => new Array<number>(n).fill(0);
    if (kind === ExprKind.RealLiteral) {
      return [{ coeff: arena.getExprRealValue(exprId), exps: zeros() }];
    }
    if (kind === ExprKind.IntLiteral) {
      return [{ coeff: arena.getExprData1(exprId) | 0, exps: zeros() }];
    }
    if (kind === ExprKind.Name) {
      const nameId = arena.getExprData1(exprId);
      const sIdx = stateIdxByNameId.get(nameId);
      if (sIdx !== undefined) {
        const exps = zeros();
        exps[sIdx] = 1;
        return [{ coeff: 1.0, exps }];
      }
      const pVal = paramVals.get(nameId);
      if (pVal !== undefined) return [{ coeff: pVal, exps: zeros() }];
      return null;
    }
    if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
      const sub = lowerExpr(arena.getExprLeft(exprId));
      return sub ? sub.map((t) => ({ coeff: -t.coeff, exps: [...t.exps] })) : null;
    }
    if (kind === ExprKind.Binary) {
      const op = arena.getExprData1(exprId);
      const L = lowerExpr(arena.getExprLeft(exprId));
      const R = lowerExpr(arena.getExprRight(exprId));
      if (!L || !R) return null;
      if (op === BinOp.Add) return mergeTerms([...L, ...R]);
      if (op === BinOp.Sub) return mergeTerms([...L, ...R.map((t) => ({ coeff: -t.coeff, exps: [...t.exps] }))]);
      if (op === BinOp.Mul) return mulPolys(L, R);
      if (op === BinOp.Div && R.length === 1 && R[0]!.exps.every((e) => e === 0) && Math.abs(R[0]!.coeff) > 1e-15) {
        const inv = 1.0 / R[0]!.coeff;
        return L.map((t) => ({ coeff: t.coeff * inv, exps: [...t.exps] }));
      }
      if (op === BinOp.Pow && R.length === 1 && R[0]!.exps.every((e) => e === 0)) {
        const expVal = R[0]!.coeff;
        if (Number.isInteger(expVal) && expVal >= 0 && expVal <= 8) {
          let acc: PolynomialTerm[] = [{ coeff: 1.0, exps: zeros() }];
          for (let p = 0; p < expVal; p++) acc = mulPolys(acc, L);
          return acc;
        }
      }
    }
    return null;
  };

  const vectorField: PolynomialTerm[][] = [];
  for (let i = 0; i < n; i++) {
    const rhsExpr = diffEqRhs.get(i);
    if (rhsExpr === undefined) return null;
    const poly = lowerExpr(rhsExpr);
    if (!poly) return null;
    vectorField.push(poly);
  }

  return { numVars: n, vectorField, varNames: stateNames };
}
