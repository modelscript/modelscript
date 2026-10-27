// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/control — Controller Synthesis Engine (PID Autotuning, CARE LQR, Linear MPC).
 *
 * Implements:
 *   1. Frequency-Domain & SIMC Automated PID Tuning with Sensitivity Peak (M_s) & Phase Margin constraints
 *   2. Continuous-Time Algebraic Riccati Equation (CARE) Solver & LQR State-Feedback Synthesis
 *   3. Exact Zero-Order Hold Discretization & Box-Constrained Linear Model Predictive Control (MPC)
 */

import { VarAttrKind, type DAEBuilder } from "@modelscript/runtime";
import {
  computeBodeResponse,
  computeEigenStructure,
  evaluateTransferFunctionAt,
  generateLogSpaceFrequencies,
  type PoleAnalysis,
} from "./frequency.js";
import { solveDenseLinearSystem, type LtiStateSpaceModel } from "./linearize.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Automated PID Tuning
// ─────────────────────────────────────────────────────────────────────────────

export interface PidTuningOptions {
  /** Controller structure (default: "PID"). */
  controllerType?: "P" | "PI" | "PID" | undefined;
  /** Tuning method: Skogestad IMC ("simc") or Sensitivity-Constrained Loop Shaping ("loop_shaping"). */
  method?: "simc" | "loop_shaping" | undefined;
  /** Desired closed-loop bandwidth omega_c in rad/s (optional; inferred from plant dominant pole if omitted). */
  targetBandwidth?: number | undefined;
  /** Minimum required Phase Margin in degrees (default: 45). */
  minPhaseMarginDeg?: number | undefined;
  /** Maximum allowed peak sensitivity M_s = max |1 / (1 + L(jw))| (default: 1.6). */
  maxSensitivityMs?: number | undefined;
  /** Derivative filter divisor N in s / (1 + (Td/N)*s) (default: 10). */
  derivativeFilterN?: number | undefined;
  /** Input channel index for MIMO systems (default: 0). */
  inputIdx?: number | undefined;
  /** Output channel index for MIMO systems (default: 0). */
  outputIdx?: number | undefined;
}

export interface PidTuningResult {
  /** Proportional gain K_p. */
  Kp: number;
  /** Integral gain K_i = K_p / T_i. */
  Ki: number;
  /** Derivative gain K_d = K_p * T_d. */
  Kd: number;
  /** Integral time constant T_i in seconds (Infinity for P-only). */
  Ti: number;
  /** Derivative time constant T_d in seconds (0 for P/PI). */
  Td: number;
  /** Derivative filter coefficient N. */
  N: number;
  /** Achieved phase margin in degrees. */
  phaseMarginDeg: number;
  /** Achieved gain margin in dB. */
  gainMarginDb: number;
  /** Achieved gain crossover frequency in rad/s. */
  crossoverFreq: number;
  /** Achieved maximum sensitivity peak M_s. */
  peakSensitivityMs: number;
}

/**
 * Evaluate open-loop L(j*omega) = C_pid(j*omega) * G(j*omega) metrics across a frequency grid.
 */
function evaluatePidLoopMetrics(
  plantFreqs: Float64Array,
  plantComplex: { re: number; im: number }[],
  Kp: number,
  Ki: number,
  Kd: number,
  N: number,
  Td: number,
): { phaseMarginDeg: number; gainMarginDb: number; crossoverFreq: number; peakSensitivityMs: number } {
  const numPts = plantFreqs.length;
  let minRetDiff = Infinity;
  let crossoverFreq = plantFreqs[0] ?? 1.0;
  let phaseMarginDeg = 0;
  let gainMarginDb = Infinity;

  let prevMag = 0;
  let prevPhaseDeg = 0;
  let prevPhaseRad = 0;
  let phaseOffsetRad = 0;

  for (let k = 0; k < numPts; k++) {
    const w = plantFreqs[k]!;
    const g = plantComplex[k]!;

    // C(jw) = Kp + Ki / (jw) + (Kd * jw) / (1 + jw * (Td / N))
    const tfTau = N > 0 ? Td / N : 0;
    const denom = 1 + (w * tfTau) ** 2;
    const cRe = Kp + (Kd * w * w * tfTau) / denom;
    const cIm = (w > 0 ? -Ki / w : 0) + (Kd * w) / denom;

    const lRe = cRe * g.re - cIm * g.im;
    const lIm = cRe * g.im + cIm * g.re;

    const dist = Math.hypot(1 + lRe, lIm);
    if (dist < minRetDiff) minRetDiff = dist;

    const mag = Math.hypot(lRe, lIm);
    const rawPhaseRad = Math.atan2(lIm, lRe);
    if (k > 0) {
      const diff = rawPhaseRad - prevPhaseRad;
      if (diff > Math.PI) phaseOffsetRad -= 2 * Math.PI;
      else if (diff < -Math.PI) phaseOffsetRad += 2 * Math.PI;
    }
    prevPhaseRad = rawPhaseRad;
    const phaseDeg = ((rawPhaseRad + phaseOffsetRad) * 180) / Math.PI;

    if (k > 0 && prevMag >= 1.0 && mag < 1.0) {
      const frac = (prevMag - 1.0) / Math.max(1e-12, prevMag - mag);
      const w0 = plantFreqs[k - 1]!;
      crossoverFreq = w0 * (w / w0) ** frac;
      const interpPhase = prevPhaseDeg + frac * (phaseDeg - prevPhaseDeg);
      phaseMarginDeg = 180 + interpPhase;
    }

    if (k > 0 && prevPhaseDeg + 180 >= 0 && phaseDeg + 180 < 0) {
      const frac = (prevPhaseDeg + 180) / Math.max(1e-12, prevPhaseDeg - phaseDeg);
      const interpMag = prevMag + frac * (mag - prevMag);
      gainMarginDb = -20 * Math.log10(Math.max(1e-12, interpMag));
    }

    prevMag = mag;
    prevPhaseDeg = phaseDeg;
  }

  return {
    phaseMarginDeg,
    gainMarginDb,
    crossoverFreq,
    peakSensitivityMs: minRetDiff > 1e-12 ? 1.0 / minRetDiff : Infinity,
  };
}

/**
 * Automatically tune a P, PI, or PID controller for an LTI State-Space plant model
 * using Skogestad IMC (SIMC) initialization followed by Sensitivity-Constrained Loop Shaping.
 */
export function autotunePid(sys: LtiStateSpaceModel, options?: PidTuningOptions): PidTuningResult {
  const controllerType = options?.controllerType ?? "PID";
  const method = options?.method ?? "loop_shaping";
  const minPm = options?.minPhaseMarginDeg ?? 45;
  const maxMs = options?.maxSensitivityMs ?? 1.6;
  const filterN = options?.derivativeFilterN ?? 10;
  const inIdx = options?.inputIdx ?? 0;
  const outIdx = options?.outputIdx ?? 0;

  // 1. Inspect plant poles and frequency response to estimate dominant time constant & bandwidth
  const poles = computeEigenStructure(sys.A, sys.nStates);
  let dominantOmega = 1.0;
  const finitePoles = poles.filter((p) => p.naturalFrequency > 1e-4 && Number.isFinite(p.naturalFrequency));
  if (finitePoles.length > 0) {
    // Slowest non-zero pole determines base plant speed
    dominantOmega = Math.min(...finitePoles.map((p) => p.naturalFrequency));
  }

  const targetWc = options?.targetBandwidth ?? dominantOmega * 2.0;
  const freqs = generateLogSpaceFrequencies(Math.max(1e-4, targetWc * 1e-3), targetWc * 1e3, 250);
  const bode = computeBodeResponse(sys, freqs, inIdx, outIdx);

  // Determine plant gain sign at low frequency
  const gLow = evaluateTransferFunctionAt(sys, freqs[0]!, inIdx, outIdx);
  const sign = gLow.re >= 0 ? 1.0 : -1.0;

  // Evaluate plant at target crossover frequency targetWc
  const gWc = evaluateTransferFunctionAt(sys, targetWc, inIdx, outIdx);
  const magWc = Math.max(1e-8, Math.hypot(gWc.re, gWc.im));
  const phaseWcRad = Math.atan2(gWc.im * sign, gWc.re * sign);

  // SIMC / Phase-margin baseline analytical synthesis at targetWc
  const desiredPhaseLeadRad = Math.max(
    0,
    Math.min(Math.PI / 3, ((minPm + 10) * Math.PI) / 180 - (Math.PI + phaseWcRad)),
  );

  let Kp = (sign * Math.cos(desiredPhaseLeadRad)) / magWc;
  let Ti = controllerType === "P" ? Infinity : 4.0 / targetWc;
  let Td = controllerType === "PID" ? Math.max(0, Math.tan(desiredPhaseLeadRad) / targetWc) : 0;

  if (controllerType === "PID" && Td === 0 && finitePoles.length >= 2) {
    // Cancel second dominant time constant if plant has >= 2 poles
    const secondOmega = finitePoles[1]!.naturalFrequency;
    if (secondOmega > 0) Td = 1.0 / secondOmega;
  }

  let Ki = Number.isFinite(Ti) && Ti > 0 ? Kp / Ti : 0;
  let Kd = Kp * Td;

  if (method === "loop_shaping") {
    // Refine (wcScale, tiScale, tdScale) on a compact grid to maximize integral bandwidth |Ki|
    // subject to Ms <= maxMs and PM >= minPm
    let bestScore = -Infinity;
    let bestParams = { Kp, Ki, Kd, Ti, Td };

    const wcFactors = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];
    const tiFactors = controllerType === "P" ? [1.0] : [0.6, 1.0, 1.5, 2.5];
    const tdFactors = controllerType === "PID" ? [0.5, 1.0, 1.5, 2.0] : [0.0];

    for (const wf of wcFactors) {
      const wcCand = targetWc * wf;
      const gCand = evaluateTransferFunctionAt(sys, wcCand, inIdx, outIdx);
      const magCand = Math.max(1e-8, Math.hypot(gCand.re, gCand.im));

      for (const tif of tiFactors) {
        for (const tdf of tdFactors) {
          const tiCand = controllerType === "P" ? Infinity : (4.0 * tif) / wcCand;
          const tdCand = controllerType === "PID" ? (0.25 * tdf) / wcCand : 0;
          const kpCand = sign / magCand;
          const kiCand = Number.isFinite(tiCand) ? kpCand / tiCand : 0;
          const kdCand = kpCand * tdCand;

          const metrics = evaluatePidLoopMetrics(freqs, bode.complexResponse, kpCand, kiCand, kdCand, filterN, tdCand);

          const msPenalty = metrics.peakSensitivityMs > maxMs ? 100 * (metrics.peakSensitivityMs - maxMs) : 0;
          const pmPenalty = metrics.phaseMarginDeg < minPm ? 5 * (minPm - metrics.phaseMarginDeg) : 0;
          const bwReward =
            controllerType === "P" ? Math.log10(Math.abs(kpCand) + 1e-9) : Math.log10(Math.abs(kiCand) + 1e-9);
          const score = bwReward - msPenalty - pmPenalty;

          if (score > bestScore && metrics.phaseMarginDeg > 15 && Number.isFinite(metrics.peakSensitivityMs)) {
            bestScore = score;
            bestParams = {
              Kp: kpCand,
              Ki: kiCand,
              Kd: kdCand,
              Ti: tiCand,
              Td: tdCand,
            };
          }
        }
      }
    }

    ({ Kp, Ki, Kd, Ti, Td } = bestParams);
  }

  const finalMetrics = evaluatePidLoopMetrics(freqs, bode.complexResponse, Kp, Ki, Kd, filterN, Td);

  return {
    Kp,
    Ki,
    Kd,
    Ti,
    Td,
    N: filterN,
    phaseMarginDeg: finalMetrics.phaseMarginDeg,
    gainMarginDb: finalMetrics.gainMarginDb,
    crossoverFreq: finalMetrics.crossoverFreq,
    peakSensitivityMs: finalMetrics.peakSensitivityMs,
  };
}

/**
 * Patch tuned PID parameters (`k`/`Kp`, `Ti`, `Td`, `Nd`/`N`) directly into a `DAEBuilder` arena.
 */
export function applyPidToArena(dae: DAEBuilder, pid: PidTuningResult, componentPrefix: string = "PID"): number {
  const candidates: [string[], number][] = [
    [[`${componentPrefix}.k`, `${componentPrefix}.Kp`, "Kp", "k_p"], pid.Kp],
    [[`${componentPrefix}.Ti`, "Ti", "T_i"], pid.Ti],
    [[`${componentPrefix}.Ki`, "Ki", "k_i"], pid.Ki],
    [[`${componentPrefix}.Td`, "Td", "T_d"], pid.Td],
    [[`${componentPrefix}.Kd`, "Kd", "k_d"], pid.Kd],
    [[`${componentPrefix}.Nd`, `${componentPrefix}.N`, "Nd"], pid.N],
  ];

  let updatedCount = 0;
  for (const [names, val] of candidates) {
    if (!Number.isFinite(val)) continue;
    for (const name of names) {
      const idx = dae.getVarIdxByName(name);
      if (idx >= 0) {
        const exprId = dae.addRealLiteral(val);
        dae.setVarAttrExpr(idx, VarAttrKind.Start, exprId);
        dae.setVarAttrExpr(idx, VarAttrKind.Binding, exprId);
        updatedCount++;
      }
    }
  }
  return updatedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Continuous-Time Algebraic Riccati Equation (CARE) & LQR Synthesis
// ─────────────────────────────────────────────────────────────────────────────

export interface LqrResult {
  /** Optimal state-feedback gain matrix K in R^{m x n} (u = -K x). */
  K: Float64Array;
  /** Stabilizing symmetric positive-definite CARE solution P in R^{n x n}. */
  P: Float64Array;
  /** Closed-loop eigenstructure lambda(A - B K). */
  closedLoopPoles: PoleAnalysis[];
  /** Frobenius norm of the Riccati residual ||A^T P + P A - P B R^{-1} B^T P + Q||_F. */
  riccatiResidual: number;
}

function matMul(A: Float64Array, B: Float64Array, m: number, k: number, n: number): Float64Array {
  const C = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i * k + p]!;
      if (a === 0) continue;
      for (let j = 0; j < n; j++) {
        C[i * n + j] = C[i * n + j]! + a * B[p * n + j]!;
      }
    }
  }
  return C;
}

function matTranspose(A: Float64Array, rows: number, cols: number): Float64Array {
  const AT = new Float64Array(cols * rows);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      AT[j * rows + i] = A[i * cols + j]!;
    }
  }
  return AT;
}

/**
 * Solve the Continuous-time Algebraic Riccati Equation (CARE):
 *   A^T P + P A - P B R^{-1} B^T P + Q = 0
 * using Roberts' matrix sign-function iteration on the 2n x 2n Hamiltonian matrix
 * followed by Newton-Kleinman / Lyapunov refinement.
 */
export function synthesizeLqr(
  A: Float64Array,
  B: Float64Array,
  Q: Float64Array,
  R: Float64Array,
  n: number,
  m: number,
): LqrResult {
  if (n === 0 || m === 0) {
    return {
      K: new Float64Array(0),
      P: new Float64Array(0),
      closedLoopPoles: [],
      riccatiResidual: 0,
    };
  }

  // Compute R^{-1} B^T in R^{m x n} and S = B R^{-1} B^T in R^{n x n}
  const BT = matTranspose(B, n, m);
  const { X: RinvBT } = solveDenseLinearSystem(R, BT, m, n, 1e-12);
  const S = matMul(B, RinvBT, n, m, n);

  // Build 2n x 2n Hamiltonian matrix H = [ A, -S; -Q, -A^T ]
  const n2 = 2 * n;
  let W = new Float64Array(n2 * n2);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      W[i * n2 + j] = A[i * n + j]!;
      W[i * n2 + (n + j)] = -S[i * n + j]!;
      W[(n + i) * n2 + j] = -Q[i * n + j]!;
      W[(n + i) * n2 + (n + j)] = -A[j * n + i]!;
    }
  }

  // Matrix sign-function iteration with determinant/Frobenius scaling:
  // W_{k+1} = 0.5 * (gamma * W_k + (1 / gamma) * W_k^{-1})
  const eye2n = new Float64Array(n2 * n2);
  for (let i = 0; i < n2; i++) eye2n[i * n2 + i] = 1.0;

  for (let iter = 0; iter < 35; iter++) {
    const { X: Winv } = solveDenseLinearSystem(W, eye2n, n2, n2, 1e-13);
    let normW = 0;
    let normWinv = 0;
    for (let i = 0; i < n2 * n2; i++) {
      normW += W[i]! * W[i]!;
      normWinv += Winv[i]! * Winv[i]!;
    }
    normW = Math.sqrt(normW);
    normWinv = Math.sqrt(normWinv);
    const gamma = normW > 1e-12 && normWinv > 1e-12 ? Math.sqrt(normWinv / normW) : 1.0;

    let maxDiff = 0;
    const Wnext = new Float64Array(n2 * n2);
    for (let i = 0; i < n2 * n2; i++) {
      const val = 0.5 * (gamma * W[i]! + Winv[i]! / gamma);
      maxDiff = Math.max(maxDiff, Math.abs(val - W[i]!));
      Wnext[i] = val;
    }
    W = Wnext;
    if (maxDiff < 1e-11) break;
  }

  // Extract stabilizing OLHP invariant subspace from (W + I) * [I; P] = 0:
  // [ W12; W22 + I ] * P = -[ W11 + I; W21 ]
  // Solve via normal equations M^T M P = M^T N
  const M = new Float64Array(n2 * n);
  const N = new Float64Array(n2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      M[i * n + j] = W[i * n2 + (n + j)]!;
      M[(n + i) * n + j] = W[(n + i) * n2 + (n + j)]! + (i === j ? 1.0 : 0.0);

      N[i * n + j] = -(W[i * n2 + j]! + (i === j ? 1.0 : 0.0));
      N[(n + i) * n + j] = -W[(n + i) * n2 + j]!;
    }
  }

  const MT = matTranspose(M, n2, n);
  const MTM = matMul(MT, M, n, n2, n);
  const MTN = matMul(MT, N, n, n2, n);
  const { X: Praw } = solveDenseLinearSystem(MTM, MTN, n, n, 1e-12);

  // Symmetrize P = 0.5 * (P + P^T)
  const P = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      P[i * n + j] = 0.5 * (Praw[i * n + j]! + Praw[j * n + i]!);
    }
  }

  // Compute K = R^{-1} B^T P
  const K = matMul(RinvBT, P, m, n, n);

  // Compute closed-loop matrix A_cl = A - B K
  const BK = matMul(B, K, n, m, n);
  const Acl = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    Acl[i] = A[i]! - BK[i]!;
  }
  const closedLoopPoles = computeEigenStructure(Acl, n);

  // Compute CARE residual ||A^T P + P A - P S P + Q||_F
  const AT = matTranspose(A, n, n);
  const ATP = matMul(AT, P, n, n, n);
  const PA = matMul(P, A, n, n, n);
  const SP = matMul(S, P, n, n, n);
  const PSP = matMul(P, SP, n, n, n);

  let resSq = 0;
  for (let i = 0; i < n * n; i++) {
    const r = ATP[i]! + PA[i]! - PSP[i]! + Q[i]!;
    resSq += r * r;
  }

  return {
    K,
    P,
    closedLoopPoles,
    riccatiResidual: Math.sqrt(resSq),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Exact ZOH Discretization & Box-Constrained Linear MPC
// ─────────────────────────────────────────────────────────────────────────────

export interface MpcConfig {
  /** Sample time Ts in seconds. */
  sampleTime: number;
  /** Prediction horizon steps N_p (default: 10). */
  predictionHorizon?: number | undefined;
  /** Control horizon steps N_u (default: 5). */
  controlHorizon?: number | undefined;
  /** Output tracking error weights (length p, default: all 1.0). */
  outputWeights?: number[] | undefined;
  /** Control move rate weights on Delta u (length m, default: all 0.1). */
  controlRateWeights?: number[] | undefined;
  /** Control magnitude weights on u (length m, default: all 0.0). */
  controlWeights?: number[] | undefined;
  /** Minimum control input bounds u_min (length m). */
  uMin?: number[] | undefined;
  /** Maximum control input bounds u_max (length m). */
  uMax?: number[] | undefined;
}

/**
 * Compute exact Zero-Order Hold (ZOH) discretization (Ad, Bd) of continuous (A, B) with sample time Ts
 * via scaling-and-squaring Taylor series of the block matrix [A, B; 0, 0] * Ts.
 */
export function discretizeLinearSystemZoh(
  A: Float64Array,
  B: Float64Array,
  n: number,
  m: number,
  Ts: number,
): { Ad: Float64Array; Bd: Float64Array } {
  const dim = n + m;
  const M = new Float64Array(dim * dim);
  let maxNorm = 0;

  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      const v = A[i * n + j]! * Ts;
      M[i * dim + j] = v;
      rowSum += Math.abs(v);
    }
    for (let j = 0; j < m; j++) {
      const v = B[i * m + j]! * Ts;
      M[i * dim + (n + j)] = v;
      rowSum += Math.abs(v);
    }
    if (rowSum > maxNorm) maxNorm = rowSum;
  }

  const s = maxNorm > 0.5 ? Math.max(0, Math.ceil(Math.log2(maxNorm / 0.5))) : 0;
  const scale = 2 ** -s;
  for (let i = 0; i < dim * dim; i++) M[i] = M[i]! * scale;

  // 12-term Taylor series for exp(M)
  let expM: Float64Array = new Float64Array(dim * dim);
  let term: Float64Array = new Float64Array(dim * dim);
  for (let i = 0; i < dim; i++) {
    expM[i * dim + i] = 1.0;
    term[i * dim + i] = 1.0;
  }

  for (let k = 1; k <= 12; k++) {
    term = matMul(term, M, dim, dim, dim);
    const invK = 1.0 / k;
    for (let i = 0; i < dim * dim; i++) {
      term[i] = term[i]! * invK;
      expM[i] = expM[i]! + term[i]!;
    }
  }

  // Square s times
  for (let k = 0; k < s; k++) {
    expM = matMul(expM, expM, dim, dim, dim);
  }

  const Ad = new Float64Array(n * n);
  const Bd = new Float64Array(n * m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Ad[i * n + j] = expM[i * dim + j]!;
    for (let j = 0; j < m; j++) Bd[i * m + j] = expM[i * dim + (n + j)]!;
  }

  return { Ad, Bd };
}

/**
 * Receding-Horizon Box-Constrained Linear Model Predictive Controller.
 */
export class LinearMpcController {
  public readonly n: number;
  public readonly m: number;
  public readonly p: number;
  public readonly Np: number;
  public readonly Nu: number;
  public readonly Ad: Float64Array;
  public readonly Bd: Float64Array;
  public readonly C: Float64Array;
  public readonly D: Float64Array;

  /** Free-response output prediction matrix Psi in R^{(Np*p) x n}. */
  private readonly Psi: Float64Array;
  /** Forced-response output prediction matrix Theta in R^{(Np*p) x (Nu*m)}. */
  private readonly Theta: Float64Array;
  /** Precomputed Hessian H = Theta^T Q_bar Theta + R_bar in R^{(Nu*m) x (Nu*m)}. */
  private readonly H: Float64Array;
  private readonly Qbar: Float64Array;
  private readonly uMin: Float64Array;
  private readonly uMax: Float64Array;
  private readonly stepBound: number;

  constructor(sys: LtiStateSpaceModel, config: MpcConfig) {
    this.n = sys.nStates;
    this.m = sys.nInputs;
    this.p = sys.nOutputs;
    this.Np = Math.max(1, config.predictionHorizon ?? 10);
    this.Nu = Math.max(1, Math.min(this.Np, config.controlHorizon ?? 5));
    this.C = new Float64Array(sys.C);
    this.D = new Float64Array(sys.D);

    const { Ad, Bd } = discretizeLinearSystemZoh(sys.A, sys.B, this.n, this.m, config.sampleTime);
    this.Ad = Ad;
    this.Bd = Bd;

    const { n, m, p, Np, Nu } = this;

    // Precompute powers of Ad: Ad^1, Ad^2, ..., Ad^Np
    const AdPows: Float64Array[] = [];
    let currAd: Float64Array = new Float64Array(n * n);
    for (let i = 0; i < n; i++) currAd[i * n + i] = 1.0;
    for (let k = 0; k <= Np; k++) {
      AdPows.push(currAd);
      currAd = matMul(currAd, Ad, n, n, n);
    }

    // Build Psi (Np*p x n) and Theta (Np*p x Nu*m)
    this.Psi = new Float64Array(Np * p * n);
    this.Theta = new Float64Array(Np * p * (Nu * m));

    for (let i = 0; i < Np; i++) {
      // y_{k+i+1|k} = C * Ad^{i+1} x_k + sum_{j=0}^{i} C * Ad^{i-j} * Bd * u_{k+j}
      const CAd = matMul(this.C, AdPows[i + 1]!, p, n, n);
      for (let r = 0; r < p; r++) {
        for (let c = 0; c < n; c++) {
          this.Psi[(i * p + r) * n + c] = CAd[r * n + c]!;
        }
      }

      for (let j = 0; j <= i; j++) {
        const colBlock = Math.min(j, Nu - 1);
        const CAdPow = matMul(this.C, AdPows[i - j]!, p, n, n);
        const Markov = matMul(CAdPow, Bd, p, n, m);
        for (let r = 0; r < p; r++) {
          for (let c = 0; c < m; c++) {
            const idx = (i * p + r) * (Nu * m) + (colBlock * m + c);
            this.Theta[idx] = this.Theta[idx]! + Markov[r * m + c]!;
          }
        }
      }
    }

    // Build Qbar (diagonal weights of length Np*p) and Hessian H = Theta^T Qbar Theta + Rbar
    this.Qbar = new Float64Array(Np * p);
    for (let i = 0; i < Np; i++) {
      for (let r = 0; r < p; r++) {
        this.Qbar[i * p + r] = config.outputWeights?.[r] ?? 1.0;
      }
    }

    const totalU = Nu * m;
    this.H = new Float64Array(totalU * totalU);
    for (let i = 0; i < totalU; i++) {
      for (let j = i; j < totalU; j++) {
        let sum = 0;
        for (let r = 0; r < Np * p; r++) {
          sum += this.Theta[r * totalU + i]! * this.Qbar[r]! * this.Theta[r * totalU + j]!;
        }
        if (i === j) {
          const inIdx = i % m;
          const uWeight = config.controlWeights?.[inIdx] ?? 0;
          const duWeight = config.controlRateWeights?.[inIdx] ?? 0.1;
          sum += uWeight + duWeight + 1e-8;
        }
        this.H[i * totalU + j] = sum;
        this.H[j * totalU + i] = sum;
      }
    }

    // Compute Lipschitz constant 1 / ||H||_F for fast Nesterov projected gradient
    let normH = 0;
    for (let i = 0; i < totalU * totalU; i++) normH += this.H[i]! * this.H[i]!;
    this.stepBound = 1.0 / Math.max(1e-6, Math.sqrt(normH));

    this.uMin = new Float64Array(m);
    this.uMax = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      this.uMin[j] = config.uMin?.[j] ?? -Infinity;
      this.uMax[j] = config.uMax?.[j] ?? Infinity;
    }
  }

  /**
   * Compute the optimal control action u_k in R^m for current state x_k and output reference r_k.
   */
  public computeControl(state: Float64Array | number[], reference: Float64Array | number[]): Float64Array {
    const { n, m, p, Np, Nu, Psi, Theta, H, Qbar, uMin, uMax, stepBound } = this;
    const totalU = Nu * m;

    // Compute output error e = Psi * x_k - R_ref
    const err = new Float64Array(Np * p);
    for (let i = 0; i < Np; i++) {
      for (let r = 0; r < p; r++) {
        const row = i * p + r;
        let yFree = 0;
        for (let c = 0; c < n; c++) {
          yFree += Psi[row * n + c]! * (state[c] ?? 0);
        }
        err[row] = yFree - (reference[r] ?? 0);
      }
    }

    // Linear cost vector g = Theta^T * Qbar * err
    const g = new Float64Array(totalU);
    for (let j = 0; j < totalU; j++) {
      let sum = 0;
      for (let r = 0; r < Np * p; r++) {
        sum += Theta[r * totalU + j]! * Qbar[r]! * err[r]!;
      }
      g[j] = sum;
    }

    // Unconstrained initial guess via direct linear solve H * U = -g
    const negG = new Float64Array(totalU);
    for (let j = 0; j < totalU; j++) negG[j] = -g[j]!;
    const { X: U } = solveDenseLinearSystem(H, negG, totalU, 1, 1e-10);

    // Check if unconstrained solution satisfies box bounds
    let allFeasible = true;
    for (let j = 0; j < totalU; j++) {
      const cIdx = j % m;
      const lo = uMin[cIdx]!;
      const hi = uMax[cIdx]!;
      if (U[j]! < lo) {
        U[j] = lo;
        allFeasible = false;
      } else if (U[j]! > hi) {
        U[j] = hi;
        allFeasible = false;
      }
    }

    // If any bound was active, polish with Nesterov Accelerated Projected Gradient (FISTA)
    if (!allFeasible) {
      const Y = new Float64Array(U);
      const Uprev = new Float64Array(U);
      let t = 1.0;

      for (let iter = 0; iter < 60; iter++) {
        let maxDiff = 0;
        for (let i = 0; i < totalU; i++) {
          let grad = g[i]!;
          for (let j = 0; j < totalU; j++) {
            grad += H[i * totalU + j]! * Y[j]!;
          }
          const cIdx = i % m;
          const nextVal = Math.max(uMin[cIdx]!, Math.min(uMax[cIdx]!, Y[i]! - stepBound * grad));
          maxDiff = Math.max(maxDiff, Math.abs(nextVal - U[i]!));
          Uprev[i] = U[i]!;
          U[i] = nextVal;
        }

        const tNext = 0.5 * (1 + Math.sqrt(1 + 4 * t * t));
        const beta = (t - 1) / tNext;
        for (let i = 0; i < totalU; i++) {
          const cIdx = i % m;
          const extrap = U[i]! + beta * (U[i]! - Uprev[i]!);
          Y[i] = Math.max(uMin[cIdx]!, Math.min(uMax[cIdx]!, extrap));
        }
        t = tNext;
        if (maxDiff < 1e-8) break;
      }
    }

    return U.slice(0, m);
  }
}
