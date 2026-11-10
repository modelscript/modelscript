// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PowerFactory Underground Cable Sizing & Ampacity Bridge.
 *
 * Couples PowerFactory cable lines (ElmLne) and cable types (TypLne) with the
 * IEC 60287 / IEC 60949 continuous ampacity and short-circuit thermal engine.
 */

import {
  calculateCableAmpacity,
  sizeCableCrossSection,
  type CableInstallationConditions,
  type CableSizingResult,
  type CableSpecification,
} from "@modelscript/simulate";
import type { PowerFactoryModel } from "../types.js";

export interface PowerFactoryCableAssessment {
  lineId: string;
  lineName: string;
  nominalVoltageKv: number;
  crossSectionMm2: number;
  conductorMaterial: "copper" | "aluminum";
  ratedContinuousAmpacityA: number;
  ratedPowerMva: number;
  rAcOhmPerKm: number;
  dielectricLossWPerM: number;
  shortCircuitWithstandCurrentKa: number;
  sizingResult: CableSizingResult;
}

/**
 * Assesses continuous ampacity and thermal ratings for all cable lines in a PowerFactory model.
 */
export function assessPowerFactoryCables(
  model: PowerFactoryModel,
  installationOverrides?: Partial<CableInstallationConditions>,
): PowerFactoryCableAssessment[] {
  const results: PowerFactoryCableAssessment[] = [];

  const defaultInstallation: CableInstallationConditions = {
    medium: "buried_direct",
    formation: "trefoil",
    burialDepthM: 1.0,
    soilThermalResistivityKmPerW: 1.0,
    ambientTemperatureC: 20.0,
    maxConductorTemperatureC: 90.0,
    ...installationOverrides,
  };

  for (const [id, line] of model.lines) {
    const term = model.terminals.get(line.bus1Id);
    const vKv = term?.uknom ?? 110.0;
    let crossSectionMm2 = 400;
    if (line.r1 && line.r1 > 0) {
      const rhoCu = 0.0175; // Ohm * mm2 / m
      const rPerKm = line.dline > 0 ? line.r1 / line.dline : line.r1;
      crossSectionMm2 = Math.min(1200, Math.max(50, Math.round(rhoCu / (rPerKm * 1e-3))));
    }

    const cableSpec: CableSpecification = {
      id,
      nominalVoltageKv: vKv,
      conductorMaterial: "copper",
      crossSectionMm2,
      insulationMaterial: "xlpe",
      insulationThicknessMm: vKv >= 110 ? 15.0 : 8.0,
      numberOfCores: 1,
      sheathBonding: "cross_bonded",
    };

    const sizing = calculateCableAmpacity(cableSpec, defaultInstallation);

    results.push({
      lineId: id,
      lineName: line.loc_name || id,
      nominalVoltageKv: vKv,
      crossSectionMm2,
      conductorMaterial: "copper",
      ratedContinuousAmpacityA: sizing.continuousAmpacityA,
      ratedPowerMva: sizing.ratedPowerMva,
      rAcOhmPerKm: sizing.rAcOhmPerKm,
      dielectricLossWPerM: sizing.dielectricLossWPerM,
      shortCircuitWithstandCurrentKa: sizing.shortCircuitWithstandCurrentKa,
      sizingResult: sizing,
    });
  }

  return results;
}

export { calculateCableAmpacity, sizeCableCrossSection };
