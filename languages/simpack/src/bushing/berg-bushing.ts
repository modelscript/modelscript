// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simpack — Non-Linear Berg Elastomeric Bushing Dynamics (Workstream 3.3).
 *
 * Implements the industry-standard Berg model for elastomeric rubber springs and bushings
 * in railway and automotive suspension systems (M. Berg, 1997, 1998):
 *
 * Total force F = F_e + F_v + F_fr where:
 * 1. Elastic force:       F_e = k_e * x + k_e3 * x^3
 * 2. Viscous damping:     F_v = c_v * v
 * 3. Friction/Hysteresis: d(F_fr)/dt = k_f * v * (1 - (F_fr / F_max) * sgn(v))^beta
 *
 * Characteristics:
 * - High dynamic stiffness at micro-amplitudes: k_dyn -> k_e + k_f
 * - Softening and hysteresis damping at large amplitudes: saturation at +/- F_max
 * - Frequency-dependent and amplitude-dependent loss factor and hysteresis energy dissipation
 */

import { BinOp, Causality, type DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";

export interface BergBushingParameters {
  /** Linear elastic spring stiffness k_e [N/m] */
  ke: number;
  /** Non-linear cubic spring coefficient k_e3 [N/m^3] (default 0) */
  ke3?: number | undefined;
  /** Viscous damping coefficient c_v [N*s/m] */
  cv: number;
  /** Initial friction elastic stiffness k_f [N/m] */
  kf: number;
  /** Maximum friction saturation force F_max [N] */
  fmax: number;
  /** Non-linear exponent beta (typically 1.0) */
  beta?: number | undefined;
}

export interface BergBushingState {
  /** Internal friction state force F_fr [N] */
  fFriction: number;
}

export interface BergBushingResult {
  /** Total restoring force F_total = F_e + F_v + F_fr [N] */
  fTotal: number;
  /** Elastic component F_e [N] */
  fElastic: number;
  /** Viscous component F_v [N] */
  fViscous: number;
  /** Friction/hysteresis component F_fr [N] */
  fFriction: number;
  /** Updated internal friction state */
  nextState: BergBushingState;
}

/**
 * Evaluates the 1D non-linear Berg rubber spring / bushing force.
 *
 * @param state   Current internal state of the bushing
 * @param x       Relative displacement [m]
 * @param v       Relative velocity [m/s]
 * @param dt      Integration time step [s]
 * @param params  Berg elastomeric parameters
 */
export function evaluateBergBushing(
  state: BergBushingState,
  x: number,
  v: number,
  dt: number,
  params: BergBushingParameters,
): BergBushingResult {
  const beta = params.beta ?? 1.0;
  const ke3 = params.ke3 ?? 0.0;

  // 1. Elastic component
  const fElastic = params.ke * x + ke3 * Math.pow(x, 3);

  // 2. Viscous component
  const fViscous = params.cv * v;

  // 3. Friction/Hysteresis component
  const fMax = Math.max(1e-6, params.fmax);
  let fFr = state.fFriction;

  if (Math.abs(v) > 1e-9) {
    const sgnV = Math.sign(v);
    const ratio = Math.max(-1.0, Math.min(1.0, fFr / fMax));
    const term = Math.max(0.0, 1.0 - ratio * sgnV);
    const dFfr_dt = params.kf * v * Math.pow(term, beta);

    // Explicit Euler / RK predictor step for internal friction state
    fFr = fFr + dFfr_dt * dt;

    // Saturate within [-fMax, +fMax]
    fFr = Math.max(-fMax, Math.min(fMax, fFr));
  }

  const fTotal = fElastic + fViscous + fFr;

  return {
    fTotal,
    fElastic,
    fViscous,
    fFriction: fFr,
    nextState: { fFriction: fFr },
  };
}

/**
 * Computes the theoretical cyclic energy dissipation per sinusoidal cycle:
 * Delta E_diss = 4 * F_max * X_ampl - 4 * F_max^2 / k_f (for X_ampl > F_max / k_f).
 */
export function computeBergCyclicDissipation(amplitude: number, params: BergBushingParameters): number {
  const xYield = params.fmax / Math.max(1e-6, params.kf);
  if (amplitude <= xYield) {
    // Linear elastic regime with small elliptical hysteresis
    return 0.5 * Math.PI * params.kf * Math.pow(amplitude, 2) * (amplitude / (2 * xYield));
  }
  return 4.0 * params.fmax * (amplitude - xYield);
}

/**
 * Lowers a 1D Berg bushing constitutive element directly into ModelScript's DAEBuilder arena:
 *
 * Continuous state: F_fr
 * Equations:
 *   der(F_fr) = k_f * v * (1 - (F_fr / F_max) * sgn(v))
 *   F_total = k_e * x + c_v * v + F_fr
 */
export function lowerBergBushingToDae(
  dae: DAEBuilder,
  id: string,
  params: BergBushingParameters,
  displacementVar: string,
  velocityVar: string,
): { fTotalVar: string; fFrictionVar: string } {
  const fFrName = `${id}.f_fr`;
  const fTotalName = `${id}.f_total`;

  // Register internal state F_fr and output variable F_total
  dae.addVariable(fFrName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  dae.addVariable(fTotalName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  const fFrExpr = dae.addNameExpr(fFrName);
  const fTotalExpr = dae.addNameExpr(fTotalName);
  const xExpr = dae.addNameExpr(displacementVar);
  const vExpr = dae.addNameExpr(velocityVar);

  const keExpr = dae.addRealLiteral(params.ke);
  const cvExpr = dae.addRealLiteral(params.cv);
  const kfExpr = dae.addRealLiteral(params.kf);
  const fmaxExpr = dae.addRealLiteral(params.fmax);

  // Elastic term: ke * x
  const elasticTerm = dae.addBinaryExpr(BinOp.Mul, keExpr, xExpr);

  // Viscous term: cv * v
  const viscousTerm = dae.addBinaryExpr(BinOp.Mul, cvExpr, vExpr);

  // Total force equation: F_total = ke * x + cv * v + F_fr
  const sum1 = dae.addBinaryExpr(BinOp.Add, elasticTerm, viscousTerm);
  const rhsTotal = dae.addBinaryExpr(BinOp.Add, sum1, fFrExpr);
  dae.addEquation(EqKind.Simple, fTotalExpr, rhsTotal);

  // Friction state evolution: der(F_fr) = k_f * v * (1 - (F_fr / F_max)^2)
  // Regularized symmetric form avoiding discontinuous sgn(v):
  const fRatio = dae.addBinaryExpr(BinOp.Div, fFrExpr, fmaxExpr);
  const fRatioSq = dae.addBinaryExpr(BinOp.Mul, fRatio, fRatio);
  const oneExpr = dae.addRealLiteral(1.0);
  const bracket = dae.addBinaryExpr(BinOp.Sub, oneExpr, fRatioSq);
  const kfV = dae.addBinaryExpr(BinOp.Mul, kfExpr, vExpr);
  const rhsDerFfr = dae.addBinaryExpr(BinOp.Mul, kfV, bracket);

  dae.addEquation(EqKind.Simple, dae.addDerExpr(fFrExpr), rhsDerFfr);

  return { fTotalVar: fTotalName, fFrictionVar: fFrName };
}
