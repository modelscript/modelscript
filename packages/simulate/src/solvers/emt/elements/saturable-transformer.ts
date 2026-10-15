// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Linear Saturable Transformer Core Model.
 *
 * Simulates magnetic core saturation, inrush currents, harmonic generation,
 * and ferroresonance during transformer energization and geomagnetic disturbances.
 *
 * Mathematical Formulation:
 * 1. Flux Linkage Tracking (Trapezoidal Integration):
 *    lambda(t) = lambda(t - Delta t) + 0.5 * Delta t * (v_p(t) + v_p(t - Delta t))
 *
 * 2. Two-Slope Piecewise Linear Magnetization Curve:
 *    - Unsaturated region (|lambda| <= lambda_knee):
 *      L_inc = L_unsat (high inductance, typically 100-1000 H)
 *      i_mag(t) = lambda(t) / L_unsat
 *
 *    - Saturated air-core region (|lambda| > lambda_knee):
 *      L_inc = L_sat (air-core inductance, typically 0.02 * L_unsat)
 *      i_mag(t) = sign(lambda) * [ lambda_knee / L_unsat + (|lambda| - lambda_knee) / L_sat ]
 *
 * 3. Dynamic Companion Current & Incremental Conductance:
 *    G_mag = Delta t / (2 * L_inc)
 *    I_hist,mag = i_mag(t - Delta t) + G_mag * v_p(t - Delta t)
 */

export interface SaturableTransformerConfig {
  id: string;
  primaryNode?: number | undefined;
  secondaryNode?: number | undefined;
  primaryBus?: string | undefined;
  secondaryBus?: string | undefined;
  ratedMva: number;
  primaryKv: number;
  secondaryKv: number;
  leakageReactancePu: number; // typically 0.05 - 0.15 pu
  lUnsatH: number; // Linear unsaturated magnetizing inductance (e.g. 500 H)
  lSatH: number; // Saturated air-core inductance (e.g. 10 H)
  kneeFluxWb: number; // Knee flux linkage (V*s)
  remanentFluxWb?: number | undefined; // Residual core flux before energization
}

export interface SaturableTransformerState {
  config: SaturableTransformerConfig & { primaryNode: number; secondaryNode: number };
  ratio: number; // Primary-to-secondary turns ratio N1 / N2
  rPrimary: number;
  lLeakageH: number;
  gLeakage: number;
  iHistLeakage: number;
  // Magnetizing branch state
  fluxWb: number; // Current magnetic flux linkage
  vPrimaryPrev: number;
  iMagPrev: number;
  isSaturated: boolean;
  gMag: number;
  iHistMag: number;
}

/**
 * Initializes the state of a Saturable Transformer.
 */
export function createSaturableTransformerState(
  config: SaturableTransformerConfig,
  dt: number,
): SaturableTransformerState {
  const ratio = config.primaryKv / config.secondaryKv;
  const zBase = Math.pow(config.primaryKv, 2) / config.ratedMva;
  const lLeakageH = (config.leakageReactancePu * zBase) / (2 * Math.PI * 60);
  const rPrimary = 0.005 * zBase; // 0.5% copper resistance

  const gLeakage = dt / (2 * lLeakageH);
  const gMag = dt / (2 * config.lUnsatH);

  return {
    config: {
      ...config,
      primaryNode: config.primaryNode ?? -1,
      secondaryNode: config.secondaryNode ?? -1,
    },
    ratio,
    rPrimary,
    lLeakageH,
    gLeakage,
    iHistLeakage: 0,
    fluxWb: config.remanentFluxWb ?? 0,
    vPrimaryPrev: 0,
    iMagPrev: 0,
    isSaturated: false,
    gMag,
    iHistMag: 0,
  };
}

/**
 * Evaluates instantaneous magnetizing current from core flux linkage lambda.
 */
export function evaluateMagnetizingCurrent(
  flux: number,
  lUnsat: number,
  lSat: number,
  kneeFlux: number,
): { iMag: number; lInc: number; isSaturated: boolean } {
  const absFlux = Math.abs(flux);
  const sign = Math.sign(flux);

  if (absFlux <= kneeFlux) {
    return {
      iMag: flux / lUnsat,
      lInc: lUnsat,
      isSaturated: false,
    };
  } else {
    const deltaFlux = absFlux - kneeFlux;
    const iKnee = kneeFlux / lUnsat;
    const iMag = sign * (iKnee + deltaFlux / lSat);
    return {
      iMag,
      lInc: lSat,
      isSaturated: true,
    };
  }
}

/**
 * Updates the flux linkage and companion history current of the saturable core.
 *
 * @param state Transformer state object
 * @param vPrimary Voltage solved at primary terminal
 * @param dt Time step in seconds
 */
export function updateSaturableCore(
  state: SaturableTransformerState,
  vPrimary: number,
  dt: number,
): { iMag: number; isSaturated: boolean } {
  // 1. Integrate voltage to update flux: lambda(t) = lambda(t-dt) + 0.5 * dt * (v(t) + v(t-dt))
  state.fluxWb += 0.5 * dt * (vPrimary + state.vPrimaryPrev);

  // 2. Evaluate non-linear magnetizing current
  const { iMag, lInc, isSaturated } = evaluateMagnetizingCurrent(
    state.fluxWb,
    state.config.lUnsatH,
    state.config.lSatH,
    state.config.kneeFluxWb,
  );

  state.isSaturated = isSaturated;
  state.gMag = dt / (2 * lInc);

  // 3. Companion history current for next step
  state.iHistMag = iMag + state.gMag * vPrimary;

  state.vPrimaryPrev = vPrimary;
  state.iMagPrev = iMag;

  return { iMag, isSaturated };
}
