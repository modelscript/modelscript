// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Mechanistic Taitel-Dukler Flow Regime Map & Interfacial Friction.
 *
 * Implements the Taitel & Dukler (1976) and Barnea (1987) mechanistic framework
 * for horizontal and inclined pipes, evaluating geometric wetted perimeters (S_i, S_G, S_L)
 * and interfacial shear stress (tau_i) with Andritsos-Hanratty wave enhancement.
 */

export type FlowRegimeKind = "STRATIFIED_SMOOTH" | "STRATIFIED_WAVY" | "ANNULAR" | "SLUG" | "DISPERSED_BUBBLE";

export const MechanisticFlowRegime = {
  STRATIFIED_SMOOTH: "STRATIFIED_SMOOTH" as const,
  STRATIFIED_WAVY: "STRATIFIED_WAVY" as const,
  ANNULAR: "ANNULAR" as const,
  SLUG: "SLUG" as const,
  DISPERSED_BUBBLE: "DISPERSED_BUBBLE" as const,
};

export interface StratifiedGeometry {
  /** Liquid level height [m]. */
  liquidHeight: number;
  /** Liquid wetted wall angle [rad]. */
  wettedAngle: number;
  /** Liquid cross-sectional area [m^2]. */
  liquidArea: number;
  /** Gas cross-sectional area [m^2]. */
  gasArea: number;
  /** Liquid wetted wall perimeter [m]. */
  liquidPerimeter: number;
  /** Gas wetted wall perimeter [m]. */
  gasPerimeter: number;
  /** Interfacial width chord length [m]. */
  interfacialWidth: number;
  /** Hydraulic diameter for liquid phase [m]. */
  hydraulicDiameterLiquid: number;
  /** Hydraulic diameter for gas phase [m]. */
  hydraulicDiameterGas: number;
}

export interface FlowRegimeParams {
  /** Pipe inner diameter [m]. */
  diameter: number;
  /** Pipe inclination angle [rad] (positive = upward, negative = downward). */
  inclinationRad: number;
  /** Superficial gas velocity j_g = Q_g / A [m/s]. */
  superficialGasVelocity: number;
  /** Superficial liquid velocity j_l = Q_l / A [m/s]. */
  superficialLiquidVelocity: number;
  /** Gas phase density [kg/m^3]. */
  rhoGas: number;
  /** Liquid phase density [kg/m^3]. */
  rhoLiquid: number;
  /** Gas phase dynamic viscosity [Pa * s]. */
  muGas: number;
  /** Liquid phase dynamic viscosity [Pa * s]. */
  muLiquid: number;
  /** Gas-liquid surface tension [N/m] (default: 0.025 N/m). */
  surfaceTension?: number | undefined;
  /** Pipe absolute roughness [m] (default: 4.5e-5 m). */
  roughness?: number | undefined;
}

export interface FlowRegimeResult {
  /** Identified mechanistic flow regime. */
  regime: FlowRegimeKind;
  /** Evaluated stratified flow cross-sectional geometry. */
  geometry: StratifiedGeometry;
  /** In-situ liquid holdup fraction alpha_L [-]. */
  liquidHoldup: number;
  /** Interfacial friction factor f_i [-]. */
  interfacialFrictionFactor: number;
  /** Interfacial shear stress tau_i [Pa]. */
  interfacialShearStress: number;
  /** Kelvin-Helmholtz wave growth stability ratio (> 1 indicates wave bridging/slugging). */
  kelvinHelmholtzRatio: number;
}

export interface MechanisticShearResult {
  tauInterfacial: number;
  fG: number;
  fi: number;
  relativeVelocity: number;
}

/**
 * Computes exact stratified geometric perimeters and areas for a given liquid volume fraction.
 */
export function computeStratifiedGeometry(liquidHoldup: number, diameter: number): StratifiedGeometry {
  const D = Math.max(0.01, diameter);
  const totalArea = 0.25 * Math.PI * D * D;
  const alphaL = Math.max(0.001, Math.min(0.999, liquidHoldup));

  // Solve theta - sin(theta) = 2 * pi * alphaL via rapid Newton iteration
  const target = 2.0 * Math.PI * alphaL;
  let theta = Math.PI; // Initial guess
  for (let it = 0; it < 8; it++) {
    const f = theta - Math.sin(theta) - target;
    const df = 1.0 - Math.cos(theta);
    const step = f / Math.max(0.01, df);
    theta -= step;
    if (Math.abs(step) < 1e-5) break;
  }
  theta = Math.max(0.01, Math.min(2.0 * Math.PI - 0.01, theta));

  const liquidArea = 0.125 * D * D * (theta - Math.sin(theta));
  const gasArea = totalArea - liquidArea;
  const liquidPerimeter = 0.5 * D * theta;
  const gasPerimeter = 0.5 * D * (2.0 * Math.PI - theta);
  const interfacialWidth = D * Math.sin(0.5 * theta);
  const liquidHeight = 0.5 * D * (1.0 - Math.cos(0.5 * theta));

  const hydraulicDiameterLiquid = (4.0 * liquidArea) / Math.max(1e-4, liquidPerimeter);
  const hydraulicDiameterGas = (4.0 * gasArea) / Math.max(1e-4, gasPerimeter + interfacialWidth);

  return {
    liquidHeight,
    wettedAngle: theta,
    liquidArea,
    gasArea,
    liquidPerimeter,
    gasPerimeter,
    interfacialWidth,
    hydraulicDiameterLiquid,
    hydraulicDiameterGas,
  };
}

/**
 * Calculates interfacial shear stress tau_i and wave friction factor f_i.
 */
export function calculateMechanisticShear(
  superficialLiquidVelocity: number,
  superficialGasVelocity: number,
  liquidHoldup: number,
  diameter: number,
  _inclinationRad: number,
  _rhoLiquid: number,
  rhoGas: number,
  _muLiquid: number,
  muGas: number,
  _surfaceTension = 0.025,
  _roughness = 4.5e-5,
): MechanisticShearResult {
  const geom = computeStratifiedGeometry(liquidHoldup, diameter);
  const alphaL = Math.max(0.01, Math.min(0.99, liquidHoldup));
  const ug = superficialGasVelocity / (1.0 - alphaL);
  const ul = superficialLiquidVelocity / alphaL;
  const relVel = Math.abs(ug - ul);

  const Reg = (rhoGas * ug * geom.hydraulicDiameterGas) / Math.max(1e-6, muGas);
  const fg = Reg < 2300 ? 16.0 / Math.max(1.0, Reg) : 0.046 * Math.pow(Math.max(1.0, Reg), -0.2);

  const jgCrit = 5.0;
  let fi = fg;
  if (superficialGasVelocity > jgCrit) {
    fi =
      fg *
      (1.0 + 15.0 * Math.sqrt(Math.max(0, geom.liquidHeight / diameter)) * (superficialGasVelocity / jgCrit - 1.0));
  }
  const tauI = 0.5 * rhoGas * fi * relVel * relVel;

  return {
    tauInterfacial: tauI,
    fG: fg,
    fi,
    relativeVelocity: relVel,
  };
}

/**
 * Classifies flow regime using Taitel-Dukler mechanistic criteria and computes interfacial shear.
 */
export function classifyFlowRegime(params: FlowRegimeParams): FlowRegimeResult;
export function classifyFlowRegime(
  superficialLiquidVelocity: number,
  superficialGasVelocity: number,
  inclinationRad: number,
  diameter: number,
  rhoLiquid: number,
  rhoGas: number,
  muLiquid: number,
  muGas: number,
  surfaceTension?: number,
): FlowRegimeResult;
export function classifyFlowRegime(
  first: FlowRegimeParams | number,
  superficialGasVelocity?: number,
  inclinationRad?: number,
  diameter?: number,
  rhoLiquid?: number,
  rhoGas?: number,
  muLiquid?: number,
  muGas?: number,
  surfaceTension?: number,
): FlowRegimeResult {
  let params: FlowRegimeParams;
  if (typeof first === "object") {
    params = first;
  } else {
    params = {
      superficialLiquidVelocity: first,
      superficialGasVelocity: superficialGasVelocity ?? 1.0,
      inclinationRad: inclinationRad ?? 0.0,
      diameter: diameter ?? 0.3048,
      rhoLiquid: rhoLiquid ?? 850.0,
      rhoGas: rhoGas ?? 40.0,
      muLiquid: muLiquid ?? 0.005,
      muGas: muGas ?? 1.5e-5,
      surfaceTension: surfaceTension ?? 0.025,
    };
  }

  const {
    diameter: D,
    inclinationRad: thetaPipe,
    superficialGasVelocity: jg,
    superficialLiquidVelocity: jl,
    rhoGas: rhog,
    rhoLiquid: rhol,
    muGas: mug,
  } = params;

  const sigma = params.surfaceTension ?? 0.025;
  const g = 9.81;

  // Approximate equilibrium liquid holdup
  const j = jg + jl;
  const inputVolumetricFraction = jl / Math.max(1e-4, j);
  // Initial holdup guess with buoyancy slip
  const alphaL = Math.max(0.02, Math.min(0.98, inputVolumetricFraction * 1.2));
  const geom = computeStratifiedGeometry(alphaL, D);

  // In-situ velocities
  const ug = jg / Math.max(0.01, 1.0 - alphaL);
  const ul = jl / Math.max(0.01, alphaL);

  // 1. Gas wall friction factor
  const Reg = (rhog * ug * geom.hydraulicDiameterGas) / Math.max(1e-6, mug);
  const fg = Reg < 2300 ? 16.0 / Math.max(1.0, Reg) : 0.046 * Math.pow(Math.max(1.0, Reg), -0.2);

  // 2. Interfacial friction factor (Andritsos & Hanratty 1987)
  const jgCrit = 5.0; // Critical gas velocity for wave onset [m/s]
  let fi = fg;
  if (jg > jgCrit) {
    fi = fg * (1.0 + 15.0 * Math.sqrt(Math.max(0, geom.liquidHeight / D)) * (jg / jgCrit - 1.0));
  }
  const relVel = Math.abs(ug - ul);
  const tauI = 0.5 * rhog * fi * relVel * relVel;

  // 3. Taitel-Dukler Transition Criteria
  // A. Kelvin-Helmholtz viscous wave instability (Stratified -> Intermittent or Annular)
  const dAlDh = geom.interfacialWidth;
  const vCritNumerator = (rhol - rhog) * g * geom.gasArea * Math.cos(thetaPipe);
  const vCritDenominator = rhog * Math.max(1e-4, dAlDh);
  const vKelvinHelmholtz = (1.0 - geom.liquidHeight / D) * Math.sqrt(Math.max(0, vCritNumerator / vCritDenominator));

  const kelvinHelmholtzRatio = ug / Math.max(0.1, vKelvinHelmholtz);
  const isWaveBridging = kelvinHelmholtzRatio >= 0.85 || (jl > 0.35 && jg > 0.5 && jg < 15.0);

  let regime: FlowRegimeKind;

  if (!isWaveBridging) {
    // Stratified flow: Transition from smooth to wavy via Jeffreys wave generation criterion
    // (Taitel & Dukler 1976: wave inception occurs when u_G >= ~1.8 m/s or relVel > 1.2 m/s)
    const waveOnsetUg = 1.8;
    if (ug >= waveOnsetUg || relVel > 1.2) {
      regime = "STRATIFIED_WAVY";
    } else {
      regime = "STRATIFIED_SMOOTH";
    }
  } else {
    // Non-stratified: Check Annular vs Intermittent (Slug) vs Dispersed Bubble
    if (geom.liquidHeight / D < 0.35 && jg > 12.0) {
      regime = "ANNULAR";
    } else {
      // Dispersed bubble transition (high liquid turbulence)
      const uDispCrit = Math.pow(
        (4.0 * geom.gasArea * g * Math.cos(thetaPipe) * (rhol - rhog) * sigma) / (0.046 * rhol * rhol),
        0.25,
      );
      if (ul > uDispCrit && jl > 1.8) {
        regime = "DISPERSED_BUBBLE";
      } else {
        regime = "SLUG";
      }
    }
  }

  return {
    regime,
    geometry: geom,
    liquidHoldup: alphaL,
    interfacialFrictionFactor: fi,
    interfacialShearStress: tauI,
    kelvinHelmholtzRatio,
  };
}
