// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Non-Linear Saturable Transformer Core Model with Dynamic Jiles-Atherton Hysteresis.
 *
 * Simulates magnetic core saturation, dynamic hysteresis loops, coercive force,
 * remanent core magnetization (residual flux), inrush current waveform asymmetry,
 * harmonic generation, and ferroresonance during transformer energization.
 *
 * Supported Models:
 * 1. Two-Slope Piecewise Linear Magnetization Curve ("PIECEWISE_LINEAR"):
 *    - Unsaturated region (|lambda| <= lambda_knee): L_inc = L_unsat
 *    - Saturated air-core region (|lambda| > lambda_knee): L_inc = L_sat
 *
 * 2. Full Dynamic Jiles-Atherton Hysteresis ("JILES_ATHERTON"):
 *    - Anhysteretic magnetization via Langevin function:
 *        M_an = M_s * [ coth(H_e / a) - a / H_e ]
 *    - Effective magnetic field:
 *        H_e = H + alpha * M
 *    - Irreversible domain wall pinning / energy dissipation:
 *        dM_irr / dH = (M_an - M_irr) / [ delta * k - alpha * (M_an - M_irr) ]
 *    - Reversible domain wall bowing:
 *        M = M_irr + c * (M_an - M_irr)
 *    - Total dynamic differential permeability:
 *        mu_diff = mu_0 * (1 + dM / dH)
 *    - Incremental inductance & Norton companion conductance:
 *        L_inc = (N1^2 * Ac / le) * mu_diff
 *        G_mag = Delta t / (2 * L_inc)
 *        I_hist,mag = i_mag(t - Delta t) + G_mag * v_p(t - Delta t)
 */

export type TransformerCoreModel = "PIECEWISE_LINEAR" | "JILES_ATHERTON";

export interface JilesAthertonParams {
  /** Saturation magnetization Ms in A/m (default: 1.5e6 A/m for grain-oriented silicon steel). */
  ms?: number;
  /** Domain parameter 'a' in A/m (default: 120 A/m). */
  a?: number;
  /** Inter-domain coupling parameter alpha (default: 2.5e-4). */
  alpha?: number;
  /** Pinning coefficient / loss parameter 'k' in A/m (default: 150 A/m). */
  k?: number;
  /** Reversible domain wall bending coefficient 'c' (default: 0.15). */
  c?: number;
  /** Core cross-sectional area in square meters (default scaled from rated MVA & voltage). */
  coreAreaM2?: number;
  /** Effective magnetic path length in meters (default: 3.0 m). */
  magneticLengthM?: number;
  /** Primary winding turns count N1 (default: 500). */
  primaryTurns?: number;
}

export type CompleteJilesAthertonParams = {
  [K in keyof JilesAthertonParams]-?: number;
};

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
  coreModel?: TransformerCoreModel | undefined; // default: "PIECEWISE_LINEAR"
  // Piecewise linear parameters
  lUnsatH?: number | undefined; // Linear unsaturated magnetizing inductance (default: 500 H)
  lSatH?: number | undefined; // Saturated air-core inductance (default: 10 H)
  kneeFluxWb?: number | undefined; // Knee flux linkage (default: 800 Wb)
  remanentFluxWb?: number | undefined; // Residual core flux before energization
  // Jiles-Atherton dynamic hysteresis parameters
  jaParams?: JilesAthertonParams | undefined;
}

export interface SaturableTransformerState {
  config: SaturableTransformerConfig & {
    primaryNode: number;
    secondaryNode: number;
    lUnsatH: number;
    lSatH: number;
    kneeFluxWb: number;
  };
  coreModel: TransformerCoreModel;
  ratio: number; // Primary-to-secondary turns ratio N1 / N2
  rPrimary: number;
  lLeakageH: number;
  gLeakage: number;
  iHistLeakage: number;
  // Magnetizing branch state
  fluxWb: number; // Current magnetic flux linkage [Wb]
  vPrimaryPrev: number;
  iMagPrev: number;
  isSaturated: boolean;
  gMag: number;
  iHistMag: number;
  // Jiles-Atherton state variables
  hField: number; // Magnetic field strength H [A/m]
  mTotal: number; // Total magnetization M [A/m]
  mIrr: number; // Irreversible magnetization M_irr [A/m]
  bFluxDensity: number; // Magnetic flux density B [T]
  coreAreaM2: number;
  magneticLengthM: number;
  primaryTurns: number;
  jaParams: CompleteJilesAthertonParams;
  hysteresisEnergyJoulesPerM3: number; // Cumulative hysteresis core energy loss
}

/**
 * Evaluates the Langevin function L(x) = coth(x) - 1/x and its first derivative.
 */
export function langevin(x: number): { lVal: number; dLdx: number } {
  const absX = Math.abs(x);
  if (absX < 1e-4) {
    const lVal = x / 3 - Math.pow(x, 3) / 45 + (2 * Math.pow(x, 5)) / 945;
    const dLdx = 1 / 3 - Math.pow(x, 2) / 15;
    return { lVal, dLdx: Math.max(0, dLdx) };
  }
  const coth = 1 / Math.tanh(x);
  const lVal = coth - 1 / x;
  const dLdx = 1 - coth * coth + 1 / (x * x);
  return { lVal, dLdx: Math.max(0, dLdx) };
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

  const lUnsat = config.lUnsatH ?? 500.0;
  const gLeakage = dt / (2 * lLeakageH);
  const gMag = dt / (2 * lUnsat);

  const coreModel: TransformerCoreModel = config.coreModel ?? "PIECEWISE_LINEAR";

  // Geometric and physical scaling for core
  const vPeakPrimary = (config.primaryKv * 1e3 * Math.sqrt(2)) / Math.sqrt(3);
  const omega = 2 * Math.PI * 60;
  const nominalPeakFluxWb = vPeakPrimary / omega;
  const primaryTurns = config.jaParams?.primaryTurns ?? 500;
  const coreAreaM2 = config.jaParams?.coreAreaM2 ?? Math.max(0.05, nominalPeakFluxWb / (primaryTurns * 1.5));
  const magneticLengthM = config.jaParams?.magneticLengthM ?? 3.2;

  const jaParams: CompleteJilesAthertonParams = {
    ms: config.jaParams?.ms ?? 1.55e6, // ~1.95 T saturation
    a: config.jaParams?.a ?? 130.0,
    alpha: config.jaParams?.alpha ?? 2.8e-4,
    k: config.jaParams?.k ?? 160.0,
    c: config.jaParams?.c ?? 0.18,
    coreAreaM2,
    magneticLengthM,
    primaryTurns,
  };

  const mu0 = 4.0 * Math.PI * 1e-7;
  const initialFluxWb = config.remanentFluxWb ?? 0;
  const initialB = initialFluxWb / (primaryTurns * coreAreaM2);
  const initialM = initialB / mu0;

  return {
    config: {
      ...config,
      primaryNode: config.primaryNode ?? -1,
      secondaryNode: config.secondaryNode ?? -1,
      lUnsatH: lUnsat,
      lSatH: config.lSatH ?? 10.0,
      kneeFluxWb: config.kneeFluxWb ?? 800.0,
    },
    coreModel,
    ratio,
    rPrimary,
    lLeakageH,
    gLeakage,
    iHistLeakage: 0,
    fluxWb: initialFluxWb,
    vPrimaryPrev: 0,
    iMagPrev: 0,
    isSaturated: false,
    gMag,
    iHistMag: 0,
    hField: 0,
    mTotal: initialM,
    mIrr: initialM,
    bFluxDensity: initialB,
    coreAreaM2,
    magneticLengthM,
    primaryTurns,
    jaParams,
    hysteresisEnergyJoulesPerM3: 0,
  };
}

/**
 * Evaluates instantaneous magnetizing current from core flux linkage lambda (piecewise linear).
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
 * Updates Jiles-Atherton core dynamic magnetization, hysteresis loop, and companion conductance.
 */
export function updateJilesAthertonCore(
  state: SaturableTransformerState,
  vPrimary: number,
  dt: number,
): { iMag: number; isSaturated: boolean; bFluxDensity: number; hField: number } {
  const deltaFluxWb = 0.5 * dt * (vPrimary + state.vPrimaryPrev);
  state.fluxWb += deltaFluxWb;

  const N1 = state.primaryTurns;
  const Ac = state.coreAreaM2;
  const le = state.magneticLengthM;
  const ja = state.jaParams;
  const mu0 = 4.0 * Math.PI * 1e-7;

  // Flux density delta: Delta B = Delta lambda / (N1 * Ac)
  const deltaB = deltaFluxWb / (N1 * Ac);
  state.bFluxDensity += deltaB;

  // Direction of magnetic field variation: delta = sign(dH/dt) ~ sign(dB/dt)
  const delta = deltaB >= 0 ? 1.0 : -1.0;

  // Effective magnetic field: He = H + alpha * M
  const He = state.hField + ja.alpha * state.mTotal;
  const { lVal: ManVal, dLdx } = langevin(He / ja.a);
  const Man = ja.ms * ManVal;
  const dMan_dHe = (ja.ms / ja.a) * dLdx;

  // Irreversible magnetization differential: dM_irr / dH
  const manDiff = Man - state.mIrr;
  let dMirr_dH = 0.0;
  if (delta * manDiff > 0) {
    const denom = delta * ja.k - ja.alpha * manDiff;
    if (Math.abs(denom) > 1e-6) {
      dMirr_dH = Math.max(0, manDiff / denom);
    }
  }

  // Total differential susceptibility: dM / dH
  const denomM = Math.max(1e-4, 1.0 - ja.alpha * ja.c * dMan_dHe);
  const dM_dH = Math.max(0, ((1.0 - ja.c) * dMirr_dH + ja.c * dMan_dHe) / denomM);

  // Differential permeability: mu_diff = dB / dH = mu0 * (1 + dM/dH)
  const muDiff = Math.max(mu0 * 1.5, mu0 * (1.0 + dM_dH));

  // Magnetic field update
  const deltaH = deltaB / muDiff;
  const prevH = state.hField;
  state.hField += deltaH;

  // Accumulate core hysteresis energy density: W = integral(H dB)
  state.hysteresisEnergyJoulesPerM3 += 0.5 * (prevH + state.hField) * deltaB;

  // Advance irreversible and total magnetization
  state.mIrr += dMirr_dH * deltaH;
  const HeNew = state.hField + ja.alpha * state.mTotal;
  const ManNew = ja.ms * langevin(HeNew / ja.a).lVal;
  state.mTotal = state.mIrr + ja.c * (ManNew - state.mIrr);

  // Instantaneous magnetizing current: i_mag = H * le / N1
  const iMag = (state.hField * le) / N1;

  // Incremental core inductance
  const lInc = Math.max(0.005, (N1 * N1 * Ac * muDiff) / le);
  state.gMag = dt / (2.0 * lInc);

  // Core is saturated when B exceeds 85% of saturation flux density Bs = mu0 * Ms
  const bs = mu0 * ja.ms;
  state.isSaturated = Math.abs(state.bFluxDensity) >= 0.82 * bs;

  // Companion history current for next step
  state.iHistMag = iMag + state.gMag * vPrimary;

  state.vPrimaryPrev = vPrimary;
  state.iMagPrev = iMag;

  return { iMag, isSaturated: state.isSaturated, bFluxDensity: state.bFluxDensity, hField: state.hField };
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
): { iMag: number; isSaturated: boolean; bFluxDensity?: number | undefined; hField?: number | undefined } {
  if (state.coreModel === "JILES_ATHERTON") {
    return updateJilesAthertonCore(state, vPrimary, dt);
  }

  // 1. Integrate voltage to update flux: lambda(t) = lambda(t-dt) + 0.5 * dt * (v(t) + v(t-dt))
  state.fluxWb += 0.5 * dt * (vPrimary + state.vPrimaryPrev);

  // 2. Evaluate non-linear magnetizing current
  const { iMag, lInc, isSaturated } = evaluateMagnetizingCurrent(
    state.fluxWb,
    state.config.lUnsatH ?? 500.0,
    state.config.lSatH ?? 10.0,
    state.config.kneeFluxWb ?? 800.0,
  );

  state.isSaturated = isSaturated;
  state.gMag = dt / (2 * lInc);

  // 3. Companion history current for next step
  state.iHistMag = iMag + state.gMag * vPrimary;

  state.vPrimaryPrev = vPrimary;
  state.iMagPrev = iMag;

  return { iMag, isSaturated };
}
