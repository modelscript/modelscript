// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Takács 10-Layer Dynamic Secondary Clarifier Model.
 *
 * Takács, I., Patry, G.G., Nolasco, D. (1991).
 * A dynamic model of the thickening and clarification process.
 * Water Research, 25(10), 1263–1271.
 */

import type { TakacsClarifierConfig } from "../types.js";

export const DEFAULT_TAKACS_CONFIG: TakacsClarifierConfig = {
  name: "Secondary_Clarifier",
  surfaceAreaM2: 1500.0, // Area (m2), e.g. BSM1 benchmark 1500 m2
  heightM: 4.0, // Total depth (m)
  layers: 10, // 10 layers (0.4m depth each)
  feedLayer: 5, // 1-indexed layer 5 is feed inlet
  v0: 474.0, // Maximum settling velocity (m/day)
  v0Prime: 250.0, // Maximum Vesilind settling velocity (m/day)
  rh: 0.000576, // Hindered settling parameter (m3/g SS)
  rp: 0.00286, // Flocculant settling parameter (m3/g SS)
  fns: 0.00228, // Non-settleable fraction of influent TSS
};

/**
 * Double-exponential settling velocity v_s(X) in m/day.
 */
export function calculateTakacsSettlingVelocity(
  xTssGPerM3: number,
  xMinGPerM3: number,
  config = DEFAULT_TAKACS_CONFIG,
): number {
  if (xTssGPerM3 <= xMinGPerM3) return 0.0;
  const xDiff = xTssGPerM3 - xMinGPerM3;
  const vDoubleExp = config.v0 * (Math.exp(-config.rh * xDiff) - Math.exp(-config.rp * xDiff));
  return Math.max(0, Math.min(config.v0Prime, vDoubleExp));
}

export interface ClarifierLayerState {
  layerIndex: number; // 1 (top) to N (bottom)
  tssConcentration: number; // g SS / m3
  settlingVelocityMDay: number; // m / day
}

export interface ClarifierFluxResult {
  effluentTss: number; // g SS / m3 leaving layer 1
  underflowTss: number; // g SS / m3 in recycle RAS / WAS from bottom layer 10
  layerStates: ClarifierLayerState[];
  layerConcentrationDerivatives: number[]; // dX_m / dt (g / (m3 * day))
}

/**
 * Computes layer-by-layer dynamic mass fluxes and concentration derivatives dX/dt.
 */
export function evaluateTakacsClarifierDerivatives(
  layerTss: number[], // Array of length config.layers (g SS/m3)
  influentFlowM3Day: number,
  influentTss: number,
  underflowFlowM3Day: number,
  config = DEFAULT_TAKACS_CONFIG,
): ClarifierFluxResult {
  const N = config.layers;
  const A = config.surfaceAreaM2;
  const dz = config.heightM / N;

  const Q_f = influentFlowM3Day;
  const Q_u = underflowFlowM3Day;
  const Q_e = Math.max(0, Q_f - Q_u);

  const v_up = Q_e / A; // upward bulk velocity (m/day)
  const v_dn = Q_u / A; // downward bulk velocity (m/day)

  const feedIdx = config.feedLayer - 1; // 0-indexed feed layer
  const xMin = config.fns * influentTss;

  const v_s: number[] = new Array(N);
  const J_s: number[] = new Array(N + 1); // Gravity settling flux across interfaces
  J_s[0] = 0.0;
  J_s[N] = 0.0;

  for (let m = 0; m < N; m++) {
    v_s[m] = calculateTakacsSettlingVelocity(layerTss[m]!, xMin, config);
  }

  // Calculate settling flux J_s across boundaries m to m+1
  for (let m = 0; m < N - 1; m++) {
    const fluxCurrent = v_s[m]! * layerTss[m]!;
    const fluxNext = v_s[m + 1]! * layerTss[m + 1]!;
    // Limiting flux condition
    if (m >= feedIdx && layerTss[m + 1]! > 3000) {
      J_s[m + 1] = Math.min(fluxCurrent, fluxNext);
    } else {
      J_s[m + 1] = fluxCurrent;
    }
  }

  const dX_dt: number[] = new Array(N);

  for (let m = 0; m < N; m++) {
    const X_m = layerTss[m]!;

    if (m === 0) {
      // Top layer 1 (effluent)
      const bulkFlux = v_up * (layerTss[1]! - X_m);
      const settlingFlux = -J_s[1]!;
      dX_dt[m] = (bulkFlux + settlingFlux) / dz;
    } else if (m < feedIdx) {
      // Clarification zone above feed
      const bulkFlux = v_up * (layerTss[m + 1]! - X_m);
      const settlingFlux = J_s[m]! - J_s[m + 1]!;
      dX_dt[m] = (bulkFlux + settlingFlux) / dz;
    } else if (m === feedIdx) {
      // Feed layer
      const feedInflowFlux = (Q_f * influentTss) / A;
      const bulkOutflowFlux = -(v_up + v_dn) * X_m;
      const settlingFlux = -J_s[m + 1]!;
      dX_dt[m] = (feedInflowFlux + bulkOutflowFlux + settlingFlux) / dz;
    } else if (m < N - 1) {
      // Thickening zone below feed
      const bulkFlux = v_dn * (layerTss[m - 1]! - X_m);
      const settlingFlux = J_s[m]! - J_s[m + 1]!;
      dX_dt[m] = (bulkFlux + settlingFlux) / dz;
    } else {
      // Bottom layer N (underflow)
      const bulkFlux = v_dn * (layerTss[m - 1]! - X_m);
      const settlingFlux = J_s[m]!;
      dX_dt[m] = (bulkFlux + settlingFlux) / dz;
    }
  }

  const layerStates: ClarifierLayerState[] = layerTss.map((tss, idx) => ({
    layerIndex: idx + 1,
    tssConcentration: tss,
    settlingVelocityMDay: v_s[idx]!,
  }));

  return {
    effluentTss: layerTss[0]!,
    underflowTss: layerTss[N - 1]!,
    layerStates,
    layerConcentrationDerivatives: dX_dt,
  };
}
