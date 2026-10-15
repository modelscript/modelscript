// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Linear Metal-Oxide Varistor (MOV) Surge Arrester Element.
 *
 * Implements the IEEE Working Group 3.4.11 piecewise power-law V-I characteristic
 * for ZnO gapless station-class surge arresters used in switching (TOV/TRV) and
 * lightning insulation coordination studies:
 *
 *   i(v) = sign(v) * I_ref * (|v| / V_ref)^alpha_k
 *
 * Companion Linearization (Newton-Raphson / Tangential Secant):
 *   G_inc(v) = d i(v) / d v = (alpha_k * |i(v)|) / max(v_min, |v|)
 *   I_eq(v)  = i(v) - G_inc(v) * v
 *   Such that i(v_next) ≈ G_inc * v_next + I_eq.
 */

export interface SurgeArresterConfig {
  id: string;
  bus: string;
  ratedKv: number; // Arrester MCOV / duty-cycle rated RMS voltage (kV)
  protectionLevelKv?: number | undefined; // Switching impulse clamping voltage V_ref (kV peak), default: 1.85 * ratedKv * sqrt(2)
  referenceCurrentAmp?: number | undefined; // Reference current I_ref at V_ref (A), default: 500 A
  alphaLeakage?: number | undefined; // Exponent below knee (|v| < 0.85 * V_ref), default: 5
  alphaClamping?: number | undefined; // Exponent in clamping knee (0.85 <= |v|/V_ref <= 1.15), default: 26
  alphaUpturn?: number | undefined; // Exponent in high-current upturn (|v| > 1.15 * V_ref), default: 40
}

export interface SurgeArresterState {
  id: string;
  node: number;
  phaseIndex: number;
  vRefVolts: number;
  iRefAmp: number;
  alphaLeakage: number;
  alphaClamping: number;
  alphaUpturn: number;
  gLeakage: number; // Minimum continuous leakage conductance (S)
  gCurrent: number; // Currently stamped incremental conductance (S)
  iEqHist: number; // Tangential intercept current I_eq = i(v) - G_inc * v (A)
  current: number; // Instantaneous arrester discharge current (A)
  energyJoules: number; // Cumulative absorbed thermal energy integral(v * i dt) (J)
}

export function createSurgeArresterState(cfg: SurgeArresterConfig, node: number, phaseIndex = 0): SurgeArresterState {
  const vRefVolts = (cfg.protectionLevelKv ?? cfg.ratedKv * Math.SQRT2 * 1.85) * 1e3;
  const iRefAmp = cfg.referenceCurrentAmp ?? 500.0;
  const gLeakage = 1e-6;

  return {
    id: cfg.id,
    node,
    phaseIndex,
    vRefVolts: Math.max(100.0, vRefVolts),
    iRefAmp: Math.max(1.0, iRefAmp),
    alphaLeakage: cfg.alphaLeakage ?? 5.0,
    alphaClamping: cfg.alphaClamping ?? 26.0,
    alphaUpturn: cfg.alphaUpturn ?? 40.0,
    gLeakage,
    gCurrent: gLeakage,
    iEqHist: 0,
    current: 0,
    energyJoules: 0,
  };
}

/**
 * Evaluates the 3-segment continuous piecewise power-law MOV V-I curve and its tangential derivative.
 */
export function evaluateMovCurve(
  state: SurgeArresterState,
  vVolts: number,
): { iMov: number; gInc: number; iEq: number } {
  const absV = Math.abs(vVolts);
  const sign = vVolts >= 0 ? 1.0 : -1.0;
  const vRatio = absV / state.vRefVolts;

  if (vRatio < 0.5) {
    const iLin = state.gLeakage * vVolts;
    return { iMov: iLin, gInc: state.gLeakage, iEq: 0 };
  }

  let alpha = state.alphaClamping;
  let scale = state.iRefAmp;

  if (vRatio < 0.85) {
    alpha = state.alphaLeakage;
    // Match continuity at vRatio = 0.85: scale * 0.85^alpha1 = iRef * 0.85^alpha2
    scale = state.iRefAmp * Math.pow(0.85, state.alphaClamping - state.alphaLeakage);
  } else if (vRatio > 1.15) {
    alpha = state.alphaUpturn;
    // Match continuity at vRatio = 1.15: scale * 1.15^alpha3 = iRef * 1.15^alpha2
    scale = state.iRefAmp * Math.pow(1.15, state.alphaClamping - state.alphaUpturn);
  }

  // Cap vRatio at 1.6 to avoid IEEE-754 float overflow on extreme un-clamped voltage spikes
  const safeRatio = Math.min(1.6, vRatio);
  const absI = scale * Math.pow(safeRatio, alpha) + state.gLeakage * absV;
  const iMov = sign * absI;
  const gInc = Math.max(
    state.gLeakage,
    (alpha * scale * Math.pow(safeRatio, alpha - 1.0)) / state.vRefVolts + state.gLeakage,
  );
  const iEq = iMov - gInc * vVolts;

  return { iMov, gInc, iEq };
}

/**
 * Updates the MOV arrester state after solving for terminal voltage `vVolts` at step `dt`.
 * Returns `deltaG` if the tangential conductance changed significantly enough to warrant matrix update.
 */
export function updateSurgeArrester(
  state: SurgeArresterState,
  vVolts: number,
  dt: number,
): { deltaG: number; needsRefactor: boolean } {
  const { iMov, gInc, iEq } = evaluateMovCurve(state, vVolts);
  state.current = iMov;
  state.iEqHist = iEq;
  state.energyJoules += Math.max(0, vVolts * iMov * dt);

  const relChange = Math.abs(gInc - state.gCurrent) / Math.max(1e-9, state.gCurrent);
  if (relChange > 0.05 && Math.abs(gInc - state.gCurrent) > 1e-5) {
    const deltaG = gInc - state.gCurrent;
    state.gCurrent = gInc;
    return { deltaG, needsRefactor: true };
  }

  // Keep constant stamped conductance and fold small slope difference into iEqHist
  state.iEqHist = iMov - state.gCurrent * vVolts;
  return { deltaG: 0, needsRefactor: false };
}
