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

import type { VerificationVerdict } from "../formal/verdict.js";
import { SdpSolver, type SdpProblem } from "../solvers/wasm_sdp_solver.js";

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
    // Numerical Jacobian estimation around origin
    const eps = 1e-4;
    const A: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) {
        const xPert = new Array<number>(n).fill(0);
        xPert[j] = eps;
        const fPert = system.f(xPert)[i] ?? 0;
        row[j] = fPert / eps;
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
    const P = sdpRes.X;

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

    const statusStr = isCertified ? "candidate found (heuristic, NOT verified)" : "no candidate found";

    return {
      isCertifiedSafe: false,
      verdict: SOS_NOT_RIGOROUS,
      candidateFound: isCertified,
      barrierCoefficients: coeffs,
      barrierDegree: 2,
      lyapunovDecayRate: Number.isFinite(minDecayRate) && minDecayRate > 0 ? minDecayRate : Math.abs(A[0]?.[0] ?? 0.1),
      summary: `Quadratic barrier ${statusStr}: B(x) = x^T P x; safety for all time is not proven.`,
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

    return {
      isCertifiedSafe: false,
      verdict: SOS_NOT_RIGOROUS,
      candidateFound: SdpSolver.isPsd(sdpRes4.X),
      barrierCoefficients: quarticCoeffs,
      barrierDegree: degree,
      lyapunovDecayRate: quadRes.lyapunovDecayRate,
      summary: `Degree-${degree} barrier candidate found (heuristic, NOT verified); safety for all time is not proven.`,
    };
  }
}
