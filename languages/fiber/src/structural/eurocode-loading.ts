// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Eurocode & CENELEC Structural Loading Engine for Overhead Aerial Lines & Support Structures.
 *
 * Implements:
 * - CENELEC EN 50341-1 (Overhead electrical lines exceeding AC 1 kV)
 * - Eurocode 1 (EN 1991-1-4: Wind actions) Terrain Categories 0 to IV
 * - ISO 12494 (Atmospheric icing on structures: Glaze Ice G1-G3, Rime Ice R1-R3)
 * - Eurocode 3 (EN 1993-3-1: Towers and Masts) Limit State Design (ULS)
 */

export type EurocodeTerrainCategory = "0" | "I" | "II" | "III" | "IV";

export interface EurocodeTerrainParameters {
  category: EurocodeTerrainCategory;
  name: string;
  roughnessLengthZ0Meters: number;
  minimumHeightZminMeters: number;
  terrainFactorKr: number;
}

export const EUROCODE_TERRAIN_DATA: Record<EurocodeTerrainCategory, EurocodeTerrainParameters> = {
  "0": {
    category: "0",
    name: "Category 0: Sea, coastal area exposed to open sea",
    roughnessLengthZ0Meters: 0.003,
    minimumHeightZminMeters: 1.0,
    terrainFactorKr: 0.16,
  },
  "I": {
    category: "I",
    name: "Category I: Lakes, flat area with negligible vegetation",
    roughnessLengthZ0Meters: 0.01,
    minimumHeightZminMeters: 1.0,
    terrainFactorKr: 0.17,
  },
  "II": {
    category: "II",
    name: "Category II: Low vegetation (grass) and isolated obstacles",
    roughnessLengthZ0Meters: 0.05,
    minimumHeightZminMeters: 2.0,
    terrainFactorKr: 0.19,
  },
  "III": {
    category: "III",
    name: "Category III: Regular cover of vegetation or suburban buildings",
    roughnessLengthZ0Meters: 0.3,
    minimumHeightZminMeters: 5.0,
    terrainFactorKr: 0.22,
  },
  "IV": {
    category: "IV",
    name: "Category IV: Urban areas with >= 15% buildings exceeding 15m",
    roughnessLengthZ0Meters: 1.0,
    minimumHeightZminMeters: 10.0,
    terrainFactorKr: 0.24,
  },
};

export type IsoIceClass = "G1" | "G2" | "G3" | "R1" | "R2" | "R3";

export interface IsoIceClassParameters {
  iceClass: IsoIceClass;
  type: "glaze" | "rime";
  radialIceThicknessMm: number;
  densityKgM3: number;
}

export const ISO_12494_ICE_DATA: Record<IsoIceClass, IsoIceClassParameters> = {
  G1: { iceClass: "G1", type: "glaze", radialIceThicknessMm: 10.0, densityKgM3: 900.0 },
  G2: { iceClass: "G2", type: "glaze", radialIceThicknessMm: 20.0, densityKgM3: 900.0 },
  G3: { iceClass: "G3", type: "glaze", radialIceThicknessMm: 30.0, densityKgM3: 900.0 },
  R1: { iceClass: "R1", type: "rime", radialIceThicknessMm: 10.0, densityKgM3: 300.0 },
  R2: { iceClass: "R2", type: "rime", radialIceThicknessMm: 20.0, densityKgM3: 400.0 },
  R3: { iceClass: "R3", type: "rime", radialIceThicknessMm: 30.0, densityKgM3: 500.0 },
};

export interface EurocodeCableConfig {
  id: string;
  name?: string | undefined;
  attachmentHeightMeters: number;
  bareDiameterMm: number;
  bareWeightKgPerM: number;
  spanLengthMeters: number;
  dragCoefficient?: number | undefined; // Cd default ~1.0-1.2
}

export interface EurocodeMastLoadingConfig {
  mastId: string;
  basicWindVelocityMPerS: number; // vb (e.g. 25 m/s)
  terrainCategory: EurocodeTerrainCategory;
  iceClass: IsoIceClass;
  overallHeightMeters: number;
  groundSectionModulusM3: number;
  characteristicYieldStrengthMpa: number; // f_yk
  partialFactorGammaM?: number | undefined; // default 1.10
  cables: EurocodeCableConfig[];
}

export interface EurocodeCableLoadingResult {
  cableId: string;
  peakVelocityPressurePa: number;
  bareDiameterMm: number;
  icedDiameterMm: number;
  characteristicVerticalForceN: number;
  characteristicTransverseForceN: number;
  designTransverseForceEdN: number;
}

export interface EurocodeMastLoadingReport {
  mastId: string;
  standard: "EN_50341_EUROCODE";
  terrainCategory: EurocodeTerrainCategory;
  iceClass: IsoIceClass;
  peakVelocityPressureAtTopPa: number;
  characteristicWindMomentNm: number;
  characteristicDeadLoadMomentNm: number;
  designBendingMomentEdNm: number;
  designResistanceMomentRdNm: number;
  utilizationRatioPercent: number;
  isCompliant: boolean;
  status: "Pass" | "Fail - ULS Resistance Exceeded";
  cableResults: EurocodeCableLoadingResult[];
}

/**
 * Computes peak velocity wind pressure qp(z) according to EN 1991-1-4.
 */
export function calculateEurocodePeakWindPressure(
  heightMeters: number,
  basicWindVelocityMPerS: number,
  terrainCategory: EurocodeTerrainCategory,
): number {
  const t = EUROCODE_TERRAIN_DATA[terrainCategory];
  const z = Math.max(t.minimumHeightZminMeters, heightMeters);

  // Mean wind velocity: vm(z) = cr(z) * co(z) * vb (assuming orography factor co = 1.0)
  const cr = t.terrainFactorKr * Math.log(z / t.roughnessLengthZ0Meters);
  const vm = cr * basicWindVelocityMPerS;

  // Turbulence intensity: Iv(z) = kI / (co * ln(z/z0)) with kI = 1.0
  const iv = 1.0 / Math.log(z / t.roughnessLengthZ0Meters);

  // Air density standard = 1.25 kg/m^3
  const rho = 1.25;

  // Peak velocity pressure: qp(z) = (1 + 7 * Iv(z)) * 0.5 * rho * vm^2
  const qp = (1.0 + 7.0 * iv) * 0.5 * rho * vm * vm;
  return qp;
}

/**
 * Evaluates Ultimate Limit State (ULS) mast & cable actions pursuant to EN 50341 & Eurocode 3.
 */
export function evaluateEurocodeMastLoading(config: EurocodeMastLoadingConfig): EurocodeMastLoadingReport {
  const ice = ISO_12494_ICE_DATA[config.iceClass];
  const g = 9.80665;
  const gammaQ = 1.50; // ULS variable wind action factor
  const gammaM = config.partialFactorGammaM ?? 1.10; // Material resistance factor

  const cableResults: EurocodeCableLoadingResult[] = [];
  let charTransverseMomentNm = 0.0;
  let charVerticalDeadLoadN = 0.0;

  for (const c of config.cables) {
    const qp = calculateEurocodePeakWindPressure(c.attachmentHeightMeters, config.basicWindVelocityMPerS, config.terrainCategory);
    const icedDiameterMm = c.bareDiameterMm + 2.0 * ice.radialIceThicknessMm;

    // Conductor ice weight
    const rBareM = (c.bareDiameterMm / 2.0) / 1000.0;
    const rIcedM = (icedDiameterMm / 2.0) / 1000.0;
    const iceAreaM2 = Math.PI * (rIcedM * rIcedM - rBareM * rBareM);
    const iceWeightKgPerM = iceAreaM2 * ice.densityKgM3;
    const unitVerticalN = (c.bareWeightKgPerM + iceWeightKgPerM) * g;
    const totalVerticalN = unitVerticalN * c.spanLengthMeters;

    // Transverse wind force on conductor: Fw = qp * Cd * A_proj
    const cd = c.dragCoefficient ?? 1.1;
    const projAreaM2 = (icedDiameterMm / 1000.0) * c.spanLengthMeters;
    const totalTransverseN = qp * cd * projAreaM2;

    // Design transverse load (ULS)
    const designTransverseN = totalTransverseN * gammaQ;

    cableResults.push({
      cableId: c.id,
      peakVelocityPressurePa: Math.round(qp * 10) / 10,
      bareDiameterMm: c.bareDiameterMm,
      icedDiameterMm: Math.round(icedDiameterMm * 10) / 10,
      characteristicVerticalForceN: Math.round(totalVerticalN * 10) / 10,
      characteristicTransverseForceN: Math.round(totalTransverseN * 10) / 10,
      designTransverseForceEdN: Math.round(designTransverseN * 10) / 10,
    });

    charTransverseMomentNm += totalTransverseN * c.attachmentHeightMeters;
    charVerticalDeadLoadN += totalVerticalN;
  }

  // Mast peak pressure at top
  const qpTop = calculateEurocodePeakWindPressure(config.overallHeightMeters, config.basicWindVelocityMPerS, config.terrainCategory);

  // ULS Design Bending Moment: Ed = gammaQ * M_transverse
  const designMomentEdNm = charTransverseMomentNm * gammaQ;

  // Design Bending Resistance: Rd = (W_el * f_yk) / gammaM
  const yieldStrengthPa = config.characteristicYieldStrengthMpa * 1e6;
  const designResistanceRdNm = (config.groundSectionModulusM3 * yieldStrengthPa) / gammaM;

  const utilizationPercent = (designMomentEdNm / designResistanceRdNm) * 100.0;
  const isCompliant = utilizationPercent <= 100.0;

  return {
    mastId: config.mastId,
    standard: "EN_50341_EUROCODE",
    terrainCategory: config.terrainCategory,
    iceClass: config.iceClass,
    peakVelocityPressureAtTopPa: Math.round(qpTop * 10) / 10,
    characteristicWindMomentNm: Math.round(charTransverseMomentNm),
    characteristicDeadLoadMomentNm: Math.round(charVerticalDeadLoadN * 0.1), // nominal eccentricity
    designBendingMomentEdNm: Math.round(designMomentEdNm),
    designResistanceMomentRdNm: Math.round(designResistanceRdNm),
    utilizationRatioPercent: Math.round(utilizationPercent * 10) / 10,
    isCompliant,
    status: isCompliant ? "Pass" : "Fail - ULS Resistance Exceeded",
    cableResults,
  };
}
