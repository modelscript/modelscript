// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript thermal runtime for `@modelscript/sinda-std-lib`.
 *
 * Implements spacecraft thermal material property evaluation and Stefan-Boltzmann
 * radiative equilibrium helpers using a zero-GC linear-memory ABI.
 */

const SIGMA_SB: f64 = 5.670374419e-8;

// Archetype IDs matching `SindaArchetypeId` in src/catalog/sinda-std-schemas.ts
const ARCH_STDSTL: i32 = 1;
const ARCH_FWDBCK: i32 = 2;
const ARCH_CRANKN: i32 = 3;
const ARCH_SNFR: i32 = 4;

const ARCH_AL_6061: i32 = 10;
const ARCH_TI_6AL_4V: i32 = 11;
const ARCH_MLI: i32 = 12;
const ARCH_KAPTON: i32 = 13;
const ARCH_BLACK_ANODIZE: i32 = 14;
const ARCH_OSR: i32 = 15;

/**
 * Returns nominal thermal conductivity k [W/(m*K)] for a spacecraft material archetype.
 */
export function getMaterialConductivity(archetypeId: i32): f64 {
  if (archetypeId == ARCH_AL_6061 || archetypeId == ARCH_BLACK_ANODIZE) return 167.0;
  if (archetypeId == ARCH_TI_6AL_4V) return 6.7;
  if (archetypeId == ARCH_MLI) return 0.0002;
  if (archetypeId == ARCH_KAPTON) return 0.12;
  if (archetypeId == ARCH_OSR) return 1.38;
  return 0.0;
}

/**
 * Returns nominal IR hemispherical emittance epsilon_ir [-] for a spacecraft material archetype.
 */
export function getMaterialEmittance(archetypeId: i32): f64 {
  if (archetypeId == ARCH_AL_6061) return 0.08;
  if (archetypeId == ARCH_TI_6AL_4V) return 0.19;
  if (archetypeId == ARCH_MLI) return 0.02;
  if (archetypeId == ARCH_KAPTON) return 0.75;
  if (archetypeId == ARCH_BLACK_ANODIZE) return 0.86;
  if (archetypeId == ARCH_OSR) return 0.8;
  return 0.0;
}

/**
 * Returns nominal solar absorptance alpha_s [-] for a spacecraft material archetype.
 */
export function getMaterialAbsorptance(archetypeId: i32): f64 {
  if (archetypeId == ARCH_AL_6061) return 0.2;
  if (archetypeId == ARCH_TI_6AL_4V) return 0.52;
  if (archetypeId == ARCH_MLI) return 0.38;
  if (archetypeId == ARCH_KAPTON) return 0.41;
  if (archetypeId == ARCH_BLACK_ANODIZE) return 0.88;
  if (archetypeId == ARCH_OSR) return 0.08;
  return 0.0;
}

/**
 * Computes radiative heat transfer Q = sigma * G_ij * (T_i^4 - T_j^4) [W].
 */
export function computeRadiationFlux(gRad: f64, tiK: f64, tjK: f64): f64 {
  const ti2 = tiK * tiK;
  const tj2 = tjK * tjK;
  return SIGMA_SB * gRad * (ti2 * ti2 - tj2 * tj2);
}

/**
 * Computes spacecraft radiative equilibrium temperature T = (Q / (sigma * eps * A))^(1/4) [K].
 */
export function computeRadiativeEquilibriumTemp(heatLoadW: f64, emittance: f64, areaM2: f64): f64 {
  const denom = SIGMA_SB * emittance * areaM2;
  if (denom <= 0.0 || heatLoadW <= 0.0) return 0.0;
  return Math.pow(heatLoadW / denom, 0.25);
}

/**
 * Dispatches a lightweight element evaluation for solver/material archetypes.
 */
export function evalSindaThermalElement(archetypeId: i32, param1: f64, param2: f64): f64 {
  if (archetypeId == ARCH_STDSTL || archetypeId == ARCH_SNFR) {
    return computeRadiativeEquilibriumTemp(param1, param2, 1.0);
  }
  if (archetypeId == ARCH_FWDBCK || archetypeId == ARCH_CRANKN) {
    // Returns 1-step Crank-Nicolson decay factor (1 - 0.5*dt/tau) / (1 + 0.5*dt/tau)
    const ratio = param2 > 0.0 ? param1 / param2 : 0.0;
    return (1.0 - 0.5 * ratio) / (1.0 + 0.5 * ratio);
  }
  return getMaterialConductivity(archetypeId);
}
