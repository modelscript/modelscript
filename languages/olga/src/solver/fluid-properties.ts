// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Multiphase Fluid Property Evaluation Engine.
 *
 * Bridges tabular PVT models (Multiflash / PVTsim) and analytical Black Oil
 * models with the 1D Drift-Flux DAE solver, handling:
 * - Local cell pressure & temperature property lookups
 * - Three-phase oil/water blending and Pal & Rhodes emulsion inversion rheology
 * - Acoustic sound speed and partial derivatives (dRho/dP, dRho/dT)
 */

import {
  interpolatePvt,
  parsePvtTable,
  type PvtInterpolatedState,
  type PvtTableData,
} from "../parser/pvt-table-parser.js";
import { evaluateEmulsionViscosity, evaluateEmulsionViscosityFast } from "./emulsion-rheology.js";
import { evaluateBlackOilPvt } from "./zuber-findlay.js";

export interface EvaluatedCellFluid {
  rhoG: number; // Gas density [kg/m^3]
  rhoL: number; // Effective liquid density [kg/m^3]
  muG: number; // Gas dynamic viscosity [Pa*s]
  muL: number; // Effective liquid dynamic viscosity [Pa*s]
  sigma: number; // Gas-liquid interfacial tension [N/m]

  soundSpeedGas: number; // [m/s]
  soundSpeedLiquid: number; // [m/s]
  dRhoGdP: number; // (d rhoG / d P)_T [kg/(m^3 * Pa)]
  dRhoLdP: number; // (d rhoL / d P)_T [kg/(m^3 * Pa)]

  isExtrapolated: boolean;
  rawPvtState?: PvtInterpolatedState | undefined;
}

/**
 * Evaluates local fluid properties for a pipeline cell.
 *
 * @param pvtTable    Parsed PVT table (or null for analytical Black Oil model)
 * @param pressurePa  Local cell pressure in Pascal [Pa]
 * @param tempK       Local cell temperature in Kelvin [K]
 * @param waterCut    Water volume fraction in the liquid phase [0.0 - 1.0]
 */
export function evaluateCellFluidProperties(
  pvtTable: PvtTableData | null | undefined,
  pressurePa: number,
  tempK: number,
  waterCut = 0.0,
): EvaluatedCellFluid {
  const wc = Math.max(0.0, Math.min(1.0, waterCut));

  if (pvtTable) {
    const pvt = interpolatePvt(pvtTable, pressurePa, tempK);

    let rhoL = pvt.rhoL;
    let muL = pvt.muL;

    // Check if three-phase oil and water components are explicitly tabulated
    if (pvt.rhoO != null && pvt.rhoW != null && pvt.muO != null && pvt.muW != null) {
      // Linear volume blend for density
      rhoL = wc * pvt.rhoW + (1.0 - wc) * pvt.rhoO;

      // Pal & Rhodes emulsion rheology with inversion peak
      const emulsion = evaluateEmulsionViscosity(wc, pvt.muO, pvt.muW);
      muL = emulsion.effectiveViscosity;
    } else {
      // 2-phase table: blend liquid viscosity with water assuming default water viscosity 0.001 Pa*s
      const emulsion = evaluateEmulsionViscosity(wc, pvt.muL, 0.001);
      muL = emulsion.effectiveViscosity;
    }

    return {
      rhoG: pvt.rhoG,
      rhoL,
      muG: pvt.muG,
      muL,
      sigma: pvt.sigma,
      soundSpeedGas: pvt.soundSpeedGas,
      soundSpeedLiquid: pvt.soundSpeedLiquid,
      dRhoGdP: pvt.dRhoGdP,
      dRhoLdP: pvt.dRhoLdP,
      isExtrapolated: pvt.isExtrapolated,
      rawPvtState: pvt,
    };
  }

  // Analytical Black Oil Fallback
  const bo = evaluateBlackOilPvt(pressurePa, tempK);
  const emulsion = evaluateEmulsionViscosity(wc, bo.muL, 0.001);

  // Approximate analytical derivatives for Black Oil
  const dRhoGdP = bo.rhoG / Math.max(1.0e5, pressurePa);
  const dRhoLdP = 1.0e-9 * bo.rhoL; // from compressibility 1e-9 / Pa
  const soundSpeedGas = Math.sqrt(Math.max(100.0, 1.0 / Math.max(1e-9, dRhoGdP)));
  const soundSpeedLiquid = Math.sqrt(Math.max(1000.0, 1.0 / Math.max(1e-11, dRhoLdP)));

  return {
    rhoG: bo.rhoG,
    rhoL: bo.rhoL,
    muG: bo.muG,
    muL: emulsion.effectiveViscosity,
    sigma: 0.025,
    soundSpeedGas,
    soundSpeedLiquid,
    dRhoGdP,
    dRhoLdP,
    isExtrapolated: false,
  };
}

/**
 * High-performance zero-allocation evaluation of cell fluid properties directly into flat typed arrays.
 * Suitable for high-frequency inner loops of 1D spatial discretizations.
 */
export function evaluateCellFluidPropertiesFlat(
  pvtTable: PvtTableData | null | undefined,
  count: number,
  pressures: Float64Array,
  temps: Float64Array,
  waterCuts: Float64Array | null | undefined,
  outRhoG: Float64Array,
  outRhoL: Float64Array,
  outMuG: Float64Array,
  outMuL: Float64Array,
  outSigma?: Float64Array | undefined,
  outSoundSpeedG?: Float64Array | undefined,
  outSoundSpeedL?: Float64Array | undefined,
  outDRhoGdP?: Float64Array | undefined,
  outDRhoLdP?: Float64Array | undefined,
): void {
  for (let i = 0; i < count; i++) {
    const p = pressures[i]!;
    const t = temps[i]!;
    const wc = waterCuts ? Math.max(0.0, Math.min(1.0, waterCuts[i] ?? 0.0)) : 0.0;

    if (pvtTable) {
      const pvt = interpolatePvt(pvtTable, p, t);
      outRhoG[i] = pvt.rhoG;
      outMuG[i] = pvt.muG;

      if (pvt.rhoO != null && pvt.rhoW != null && pvt.muO != null && pvt.muW != null) {
        outRhoL[i] = wc * pvt.rhoW + (1.0 - wc) * pvt.rhoO;
        outMuL[i] = evaluateEmulsionViscosityFast(wc, pvt.muO, pvt.muW);
      } else {
        outRhoL[i] = pvt.rhoL;
        outMuL[i] = evaluateEmulsionViscosityFast(wc, pvt.muL, 0.001);
      }

      if (outSigma) outSigma[i] = pvt.sigma;
      if (outSoundSpeedG) outSoundSpeedG[i] = pvt.soundSpeedGas;
      if (outSoundSpeedL) outSoundSpeedL[i] = pvt.soundSpeedLiquid;
      if (outDRhoGdP) outDRhoGdP[i] = pvt.dRhoGdP;
      if (outDRhoLdP) outDRhoLdP[i] = pvt.dRhoLdP;
    } else {
      // Analytical Black Oil
      const bo = evaluateBlackOilPvt(p, t);
      outRhoG[i] = bo.rhoG;
      outRhoL[i] = bo.rhoL;
      outMuG[i] = bo.muG;
      outMuL[i] = evaluateEmulsionViscosityFast(wc, bo.muL, 0.001);

      const dRhoGdP = bo.rhoG / Math.max(1.0e5, p);
      const dRhoLdP = 1.0e-9 * bo.rhoL;

      if (outSigma) outSigma[i] = 0.025;
      if (outSoundSpeedG) outSoundSpeedG[i] = Math.sqrt(Math.max(100.0, 1.0 / Math.max(1e-9, dRhoGdP)));
      if (outSoundSpeedL) outSoundSpeedL[i] = Math.sqrt(Math.max(1000.0, 1.0 / Math.max(1e-11, dRhoLdP)));
      if (outDRhoGdP) outDRhoGdP[i] = dRhoGdP;
      if (outDRhoLdP) outDRhoLdP[i] = dRhoLdP;
    }
  }
}

/**
 * Resolves a PvtTableData object from string or object configuration.
 */
export function resolvePvtTable(source: PvtTableData | string | null | undefined): PvtTableData | null {
  if (!source) return null;
  if (typeof source === "string") {
    return parsePvtTable(source);
  }
  return source;
}
