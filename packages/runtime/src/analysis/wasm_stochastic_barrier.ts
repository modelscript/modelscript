// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Stochastic Martingale Barrier Certificate Synthesizer.
 *
 * Implements formal probabilistic reachability verification for continuous Itô diffusions:
 *   dx = f(x) dt + \sigma(x) dW_t
 *
 * Characteristics:
 *   - Evaluates infinitesimal generator:
 *       \mathcal{L} B(x) = \nabla B(x) \cdot f(x) + (1/2) tr(\sigma(x) \sigma(x)^T \nabla^2 B(x))
 *   - Applies Doob's maximal martingale inequality to certify guaranteed upper bounds
 *     on failure probability: P(exists t >= 0 : x(t) \in X_u) <= B(x0) / \lambda.
 */

import type { VerificationVerdict } from "../formal/verdict.js";
import { SdpSolver, type SdpProblem } from "../solvers/wasm_sdp_solver.js";

export interface StochasticSystem {
  numVars: number;
  /** Drift vector field f(x) */
  f: (x: number[]) => number[];
  /** Diffusion matrix \sigma(x) (n x d) */
  sigma: (x: number[]) => number[][];
}

export interface StochasticBarrierSpec {
  initialState: number[];
  unsafeRadius: number;
  /** Maximum acceptable failure probability (e.g. 0.05) */
  riskTolerance?: number | undefined;
}

export interface StochasticBarrierResult {
  /** Always false: the bound below is a heuristic estimate, not a verified certificate (see `verdict`). */
  isCertifiedSafe: boolean;
  /** Always `unknown(not-rigorous)`. */
  verdict: VerificationVerdict;
  /** Whether the heuristic failure-probability estimate is within `riskTolerance`. NOT a proof. */
  estimateWithinTolerance: boolean;
  maxFailureProbability: number;
  riskTolerance: number;
  barrierCoefficients: number[];
  driftDecayRate: number;
  diffusionNoiseBound: number;
  summary: string;
}

export class StochasticBarrierSynthesizer {
  /**
   * Synthesizes a quadratic stochastic barrier B(x) = x^T P x via SDP and computes
   * the Doob supermartingale bound on probability of entering the unsafe set.
   */
  public static synthesize(system: StochasticSystem, spec: StochasticBarrierSpec): StochasticBarrierResult {
    const n = system.numVars;
    const x0 = spec.initialState;
    const ru = spec.unsafeRadius;
    const riskTolerance = spec.riskTolerance ?? 0.05;

    // Linearized drift Jacobian A around origin
    const eps = 1e-4;
    const A: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) {
        const xPert = new Array<number>(n).fill(0);
        xPert[j] = eps;
        row[j] = (system.f(xPert)[i] ?? 0) / eps;
      }
      A.push(row);
    }

    // Diffusion noise intensity at origin: \Sigma = \sigma \sigma^T
    const sigma0 = system.sigma(new Array<number>(n).fill(0));
    const Sigma: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let k = 0; k < (sigma0[0]?.length ?? 0); k++) {
          sum += (sigma0[i]?.[k] ?? 0) * (sigma0[j]?.[k] ?? 0);
        }
        row[j] = sum;
      }
      Sigma.push(row);
    }

    // Formulate generator drift SDP: find P > 0 solving -(A^T P + P A) = 2 * diag(|A_kk|)
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
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            normG += Math.abs(Gkl[i]![j]!);
          }
        }
        if (normG > 1e-10) {
          sdpA.push(Gkl);
          const diagTarget = Math.max(1e-3, 2.0 * Math.abs(A[k]?.[k] ?? 1.0));
          sdpB.push(k === l ? diagTarget : 0.0);
        }
      }
    }

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
      C: Sigma.map((row, i) => row.map((v, j) => (i === j ? Math.max(v, 1e-3) : v))),
      A: sdpA,
      b: sdpB,
    };

    const sdpRes = SdpSolver.solve(sdpProblem);
    const P = sdpRes.X;

    // Evaluate drift dissipation matrix Q = -(A^T P + P A)
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

    const isPsdP = SdpSolver.isPsd(P);
    const isStableQ = isPsdP && SdpSolver.isPsd(Q.map((row, i) => row.map((v, j) => (i === j ? v - 1e-5 : v))));

    // Infinitesimal generator:
    // L B(x) = x^T (A^T P + P A) x + tr(\Sigma P) = -x^T Q x + tr(\Sigma P)
    let trSigmaP = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        trSigmaP += (Sigma[i]?.[j] ?? 0) * (P[i]?.[j] ?? 0);
      }
    }

    // Initial barrier value: B(x0) = x0^T P x0
    let B_x0 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        B_x0 += (x0[i] ?? 0) * (P[i]?.[j] ?? 0) * (x0[j] ?? 0);
      }
    }

    // Minimum eigenvalue bound of P and decay rate alpha where Q >= 2 * alpha * P
    let lambdaMinP = Infinity;
    let minDecay = Infinity;
    for (let i = 0; i < n; i++) {
      const pii = P[i]?.[i] ?? 0;
      let offP = 0;
      let offQ = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          offP += Math.abs(P[i]?.[j] ?? 0);
          offQ += Math.abs(Q[i]?.[j] ?? 0);
        }
      }
      const pRowMin = Math.max(0, pii - offP);
      const pRowMax = Math.max(1e-8, pii + offP);
      const qRowMin = Math.max(0, (Q[i]?.[i] ?? 0) - offQ);
      lambdaMinP = Math.min(lambdaMinP, pRowMin);
      minDecay = Math.min(minDecay, qRowMin / (2.0 * pRowMax));
    }

    // Minimum barrier value on unsafe boundary { ||x|| >= ru }: lambda_min(P) * ru^2
    const minUnsafeBarrier = Math.max(1e-8, lambdaMinP * ru * ru);

    // Doob / Kushner supermartingale bound:
    // P(sup_{t >= 0} ||x(t)|| >= ru) <= (B(x0) + tr(\Sigma P) / (2 * decay)) / (lambda_min(P) * ru^2)
    const decay = Number.isFinite(minDecay) && minDecay > 1e-6 ? minDecay : Math.abs(A[0]?.[0] ?? 1.0);
    const steadyStateNoiseVariance = trSigmaP / Math.max(1e-8, 2 * decay);

    const maxProb = isStableQ ? Math.min(1.0, (B_x0 + steadyStateNoiseVariance) / minUnsafeBarrier) : 1.0;
    const isSafe = isStableQ && maxProb <= riskTolerance;

    const coeffs: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        coeffs.push(P[i]![j] ?? 0);
      }
    }

    const statusStr = isSafe ? "estimate within risk tolerance" : "RISK TOLERANCE EXCEEDED";

    return {
      isCertifiedSafe: false,
      estimateWithinTolerance: isSafe,
      verdict: {
        kind: "unknown",
        reason: "not-rigorous",
        rigor: "heuristic",
        detail:
          "Barrier B(x)=x^T P x is synthesized on the origin linearization without global nonlinear generator remainder bounds.",
      },
      maxFailureProbability: maxProb,
      riskTolerance,
      barrierCoefficients: coeffs,
      driftDecayRate: decay,
      diffusionNoiseBound: trSigmaP,
      summary: `Stochastic martingale barrier heuristic (non-rigorous), ${statusStr}: estimated probability of unsafe set entry ${(maxProb * 100).toFixed(2)}% (risk threshold ${(riskTolerance * 100).toFixed(1)}%).`,
    };
  }
}
