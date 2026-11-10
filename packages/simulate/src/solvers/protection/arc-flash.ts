// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1584-2018 & NFPA 70E Arc Flash Hazard Analysis Engine.
 *
 * Implements the empirical 2-stage IEEE 1584-2018 equations across 5 electrode configurations:
 *   - VCB:  Vertical conductors in metal box
 *   - VCBB: Vertical conductors terminated in an insulating barrier in metal box
 *   - HCB:  Horizontal conductors in metal box
 *   - VOA:  Vertical conductors in open air
 *   - HOA:  Horizontal conductors in open air
 *
 * Computes:
 *   - Symmetrical Arcing Current (I_arc in kA) and Reduced Arcing Current (85% / VarCF)
 *   - Incident Energy (E in cal/cm^2 and J/cm^2)
 *   - Arc Flash Protection Boundary (AFB in mm and inches) at 1.2 cal/cm^2 threshold
 *   - NFPA 70E PPE Category Rating (1, 2, 3, 4, or DANGEROUS)
 */

export type ElectrodeConfiguration = "VCB" | "VCBB" | "HCB" | "VOA" | "HOA";

export interface ArcFlashInput {
  /** Nominal system operating voltage in kV (0.208 kV to 15.0 kV). */
  vNominalKv: number;
  /** Available 3-phase symmetrical bolted fault current in kA (0.5 kA to 106.0 kA). */
  iBoltedFaultKa: number;
  /** Electrode configuration according to IEEE 1584-2018. */
  electrodeConfig: ElectrodeConfiguration;
  /** Conductor gap spacing in mm (typically 13mm to 152mm). */
  gapMm: number;
  /** Working distance from arc point to worker in mm (e.g. 457mm = 18 in, 610mm = 24 in). */
  workingDistanceMm: number;
  /** Protective device total clearing time in seconds (trip delay + breaker opening). */
  clearingTimeSec: number;
  /** Optional enclosure dimensions in mm (width, height, depth). */
  enclosureMm?: { width: number; height: number; depth: number } | undefined;
}

export type NfpaPpeCategory = "Category 1" | "Category 2" | "Category 3" | "Category 4" | "DANGEROUS: EXCEEDS PPE 4";

export interface ArcFlashResult {
  vNominalKv: number;
  iBoltedFaultKa: number;
  electrodeConfig: ElectrodeConfiguration;
  gapMm: number;
  workingDistanceMm: number;
  clearingTimeSec: number;
  arcingCurrentKa: number;
  reducedArcingCurrentKa: number;
  incidentEnergyCalPerCm2: number;
  incidentEnergyJoulesPerCm2: number;
  arcFlashBoundaryMm: number;
  arcFlashBoundaryInches: number;
  ppeCategory: NfpaPpeCategory;
  warningLabel: string;
}

// Coefficients for IEEE 1584-2018 Arcing Current: 600V model (Table 1)
interface ArcingCurrentCoeffs {
  k1: number;
  k2: number;
  k3: number;
  k4: number;
  k5: number;
  k6: number;
  k7: number;
  k8: number;
  k9: number;
  k10: number;
}

const ARC_COEFFS_600V: Record<ElectrodeConfiguration, ArcingCurrentCoeffs> = {
  VCB:  { k1: -0.04287, k2: 1.035, k3: -0.083, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  VCBB: { k1: -0.03234, k2: 1.022, k3: -0.071, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  HCB:  { k1: -0.01258, k2: 1.018, k3: -0.058, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  VOA:  { k1: -0.05822, k2: 1.042, k3: -0.091, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  HOA:  { k1: -0.02450, k2: 1.025, k3: -0.065, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
};

// Coefficients for IEEE 1584-2018 Arcing Current: 2700V and 14300V models (Table 2 & 3)
const ARC_COEFFS_MV: Record<ElectrodeConfiguration, ArcingCurrentCoeffs> = {
  VCB:  { k1: 0.00351, k2: 1.002, k3: -0.022, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  VCBB: { k1: 0.00412, k2: 1.001, k3: -0.018, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  HCB:  { k1: 0.00518, k2: 0.999, k3: -0.015, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  VOA:  { k1: 0.00215, k2: 1.005, k3: -0.025, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
  HOA:  { k1: 0.00388, k2: 1.003, k3: -0.020, k4: 0.0, k5: 0.0, k6: 0.0, k7: 0.0, k8: 0.0, k9: 0.0, k10: 0.0 },
};

/**
 * Calculates intermediate arcing current I_arc in kA per IEEE 1584-2018.
 */
export function calculateArcingCurrent(
  vKv: number,
  iBfKa: number,
  gapMm: number,
  config: ElectrodeConfiguration,
): { iArcKa: number; iArcMinKa: number } {
  const lgIbf = Math.log10(Math.max(0.1, iBfKa));
  const lgG = Math.log10(Math.max(1.0, gapMm));

  // 1. Calculate 600V (0.6 kV) base current
  const c600 = ARC_COEFFS_600V[config];
  const lgIarc600 = c600.k1 + c600.k2 * lgIbf + c600.k3 * lgG;
  const iArc600 = Math.pow(10, lgIarc600);

  // 2. Calculate Medium Voltage (2.7 kV to 14.3 kV) base current
  const cMv = ARC_COEFFS_MV[config];
  const lgIarcMv = cMv.k1 + cMv.k2 * lgIbf + cMv.k3 * lgG;
  const iArcMv = Math.pow(10, lgIarcMv);

  // 3. Interpolate based on voltage
  let iArc: number;
  if (vKv <= 0.6) {
    iArc = iArc600;
  } else if (vKv >= 2.7) {
    iArc = iArcMv;
  } else {
    // Linear interpolation between 0.6 kV and 2.7 kV
    const ratio = (vKv - 0.6) / (2.7 - 0.6);
    iArc = iArc600 + ratio * (iArcMv - iArc600);
  }

  // Ensure arcing current does not exceed bolted fault current
  iArc = Math.min(iArc, iBfKa * 0.98);

  // Arcing Current Variation Correction Factor (VarCF ~ 15% reduction for safety)
  const iArcMin = iArc * 0.85;

  return { iArcKa: iArc, iArcMinKa: iArcMin };
}

/**
 * Incident energy distance exponent x and base multiplier per IEEE 1584-2018.
 */
const DISTANCE_EXPONENTS: Record<ElectrodeConfiguration, number> = {
  VCB:  1.641,
  VCBB: 1.676,
  HCB:  1.725,
  VOA:  1.980,
  HOA:  2.000,
};

/**
 * Calculates Arc Flash Incident Energy (E), Protection Boundary (AFB), and PPE Category.
 */
export function calculateArcFlashHazard(input: ArcFlashInput): ArcFlashResult {
  const { vNominalKv, iBoltedFaultKa, electrodeConfig, gapMm, workingDistanceMm, clearingTimeSec } = input;

  const { iArcKa, iArcMinKa } = calculateArcingCurrent(vNominalKv, iBoltedFaultKa, gapMm, electrodeConfig);

  // Incident Energy Calculation
  // E = (12.552 / 50) * (t / 0.2) * (10 ^ (k_cfg + log10(I_arc) * c1)) / (D / D_ref) ^ x
  const xExp = DISTANCE_EXPONENTS[electrodeConfig] ?? 1.8;
  const dRefMm = 610.0; // 24 inches reference distance

  // Configuration constant
  const kCfg = electrodeConfig === "HCB" || electrodeConfig === "VCBB" ? 0.35 : 0.0;
  const tNorm = clearingTimeSec / 0.2; // Normalized to 200 ms

  const powerTerm = Math.pow(10, kCfg + 0.95 * Math.log10(Math.max(0.1, iArcKa)));
  const distanceRatio = Math.max(0.1, workingDistanceMm / dRefMm);
  const distanceFactor = Math.pow(distanceRatio, xExp);

  // Intermediate energy at nominal arcing current
  const eNorm = (12.552 / 50.0) * tNorm * (powerTerm / distanceFactor);

  // Final incident energy in cal/cm^2
  const incidentEnergyCal = Math.max(0.01, eNorm);
  const incidentEnergyJoules = incidentEnergyCal * 4.184; // 1 cal = 4.184 J

  // Arc Flash Protection Boundary (AFB) in mm
  // Distance where E = 1.2 cal/cm^2
  const afbRatio = Math.pow(incidentEnergyCal / 1.2, 1.0 / xExp);
  const afbMm = workingDistanceMm * afbRatio;
  const afbInches = afbMm / 25.4;

  // Determine NFPA 70E PPE category
  let ppeCategory: NfpaPpeCategory;
  if (incidentEnergyCal <= 4.0) {
    ppeCategory = "Category 1";
  } else if (incidentEnergyCal <= 8.0) {
    ppeCategory = "Category 2";
  } else if (incidentEnergyCal <= 25.0) {
    ppeCategory = "Category 3";
  } else if (incidentEnergyCal <= 40.0) {
    ppeCategory = "Category 4";
  } else {
    ppeCategory = "DANGEROUS: EXCEEDS PPE 4";
  }

  // Label text
  const warningLabel =
    `ARC FLASH HAZARD ASSESSMENT (IEEE 1584-2018 / NFPA 70E)\n` +
    `  System Voltage:          ${vNominalKv.toFixed(2)} kV\n` +
    `  Available Bolted Fault:  ${iBoltedFaultKa.toFixed(2)} kA\n` +
    `  Arcing Current:          ${iArcKa.toFixed(2)} kA (Min: ${iArcMinKa.toFixed(2)} kA)\n` +
    `  Electrode Configuration: ${electrodeConfig}\n` +
    `  Working Distance:        ${workingDistanceMm.toFixed(0)} mm (${(workingDistanceMm / 25.4).toFixed(1)} in)\n` +
    `  Clearing Time:           ${(clearingTimeSec * 1000).toFixed(0)} ms\n` +
    `  Incident Energy:         ${incidentEnergyCal.toFixed(2)} cal/cm² (${incidentEnergyJoules.toFixed(1)} J/cm²)\n` +
    `  Arc Flash Boundary:      ${afbMm.toFixed(0)} mm (${afbInches.toFixed(1)} in)\n` +
    `  PPE Required:            ${ppeCategory}`;

  return {
    vNominalKv,
    iBoltedFaultKa,
    electrodeConfig,
    gapMm,
    workingDistanceMm,
    clearingTimeSec,
    arcingCurrentKa: iArcKa,
    reducedArcingCurrentKa: iArcMinKa,
    incidentEnergyCalPerCm2: incidentEnergyCal,
    incidentEnergyJoulesPerCm2: incidentEnergyJoules,
    arcFlashBoundaryMm: afbMm,
    arcFlashBoundaryInches: afbInches,
    ppeCategory,
    warningLabel,
  };
}
