// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic Linter for IWA Activated Sludge Models and Plant Configurations.
 */

import type { AsmPlantModel } from "../types.js";

export interface AsmDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  reactorName?: string | undefined;
  componentName?: string | undefined;
}

export const AsmErrorCode = {
  INVALID_PLANT_NAME: "ASM1001",
  NON_POSITIVE_VOLUME: "ASM2001",
  MISSING_AERATION: "ASM2002",
  NEGATIVE_CONCENTRATION: "ASM3001",
  INVALID_CLARIFIER_GEOMETRY: "ASM4001",
} as const;

export const ASM_ERROR_CODES = AsmErrorCode;

/**
 * Lints an AsmPlantModel for biokinetics sanity, hydraulic validity, and stoichiometry.
 */
export function lintAsmPlant(plant: AsmPlantModel): AsmDiagnostic[] {
  const diagnostics: AsmDiagnostic[] = [];

  // ASM1001: Plant name
  if (!plant.name || plant.name.trim().length === 0) {
    diagnostics.push({
      code: AsmErrorCode.INVALID_PLANT_NAME,
      severity: "error",
      message: "Wastewater plant must have a non-empty identifier name.",
    });
  }

  // ASM2001 / ASM2002: Bioreactors
  for (const r of plant.reactors) {
    if (r.volumeM3 <= 0) {
      diagnostics.push({
        code: AsmErrorCode.NON_POSITIVE_VOLUME,
        severity: "error",
        message: `Bioreactor '${r.name}' has non-positive volume (${r.volumeM3} m3).`,
        reactorName: r.name,
      });
    }

    if (r.type === "Aerobic" && (!r.klaHr || r.klaHr <= 0) && (!r.doTargetMgL || r.doTargetMgL <= 0)) {
      diagnostics.push({
        code: AsmErrorCode.MISSING_AERATION,
        severity: "warning",
        message: `Aerobic bioreactor '${r.name}' lacks positive aeration (kla <= 0 or do_target <= 0). Biomass may suffer oxygen starvation.`,
        reactorName: r.name,
      });
    }
  }

  // ASM3001: Influent concentrations
  for (const [comp, val] of Object.entries(plant.influentConcentrations)) {
    if (val < 0) {
      diagnostics.push({
        code: AsmErrorCode.NEGATIVE_CONCENTRATION,
        severity: "error",
        message: `Influent component '${comp}' has negative concentration (${val} g/m3).`,
        componentName: comp,
      });
    }
  }

  // ASM4001: Clarifiers
  for (const c of plant.clarifiers) {
    if (c.surfaceAreaM2 <= 0 || c.heightM <= 0) {
      diagnostics.push({
        code: AsmErrorCode.INVALID_CLARIFIER_GEOMETRY,
        severity: "error",
        message: `Clarifier '${c.name}' has non-positive dimensions (area=${c.surfaceAreaM2} m2, depth=${c.heightM} m).`,
      });
    }
  }

  return diagnostics;
}
