// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canadian Standards Association (CSA) Overhead Structural Loading Engine.
 *
 * Implements:
 * - CSA C22.3 No. 1:20 (Overhead Systems) Climatic Loading Districts:
 *   - Severe Loading (19 mm ice, 400 Pa wind, Maritime / St. Lawrence)
 *   - Heavy Loading (12.5 mm ice, 400 Pa wind)
 *   - Medium Loading (6.5 mm ice, 400 Pa wind)
 *   - Light Loading (0 mm ice, 600 Pa wind)
 * - CSA 015 Wood Pole Specifications (Western Red Cedar, Douglas Fir, Lodgepole Pine, Jack Pine)
 * - CSA Material Resistance Factor (phi_w = 0.65 Grade 1, 0.80 Grade 2)
 * - CSA C22.3 No. 1 Table 1 (Road Clearances) & Table 3 (Power to Comms Vertical Separation)
 */

export type CsaLoadingDistrict = "severe" | "heavy" | "medium" | "light";
export type CsaConstructionGrade = "grade-1" | "grade-2";

export interface CsaDistrictParameters {
  district: CsaLoadingDistrict;
  name: string;
  radialIceThicknessMm: number;
  horizontalWindPressurePascals: number;
  temperatureCelsius: number;
  constantKFactorNewtonsPerMeter: number;
}

export const CSA_DISTRICT_STANDARDS: Record<CsaLoadingDistrict, CsaDistrictParameters> = {
  severe: {
    district: "severe",
    name: "CSA Severe Loading (Coastal Atlantic / St. Lawrence)",
    radialIceThicknessMm: 19.0, // 0.75 in
    horizontalWindPressurePascals: 400.0, // 8.35 psf
    temperatureCelsius: -20.0,
    constantKFactorNewtonsPerMeter: 5.84, // ~0.40 lb/ft
  },
  heavy: {
    district: "heavy",
    name: "CSA Heavy Loading (Central & Eastern Canada)",
    radialIceThicknessMm: 12.5, // ~0.5 in
    horizontalWindPressurePascals: 400.0,
    temperatureCelsius: -20.0,
    constantKFactorNewtonsPerMeter: 4.38, // ~0.30 lb/ft
  },
  medium: {
    district: "medium",
    name: "CSA Medium Loading (Southern Ontario & Prairies)",
    radialIceThicknessMm: 6.5, // ~0.25 in
    horizontalWindPressurePascals: 400.0,
    temperatureCelsius: -10.0,
    constantKFactorNewtonsPerMeter: 2.92, // ~0.20 lb/ft
  },
  light: {
    district: "light",
    name: "CSA Light Loading (BC Coastal Lowlands)",
    radialIceThicknessMm: 0.0,
    horizontalWindPressurePascals: 600.0, // 12.5 psf
    temperatureCelsius: 0.0,
    constantKFactorNewtonsPerMeter: 0.73, // ~0.05 lb/ft
  },
};

export type CsaPoleSpecies = "western-red-cedar" | "douglas-fir" | "lodgepole-pine" | "jack-pine" | "red-pine";

export interface CsaPoleSpeciesProperties {
  species: CsaPoleSpecies;
  commonName: string;
  fiberStressMpa: number;
  densityKgPerM3: number;
}

export const CSA_POLE_SPECIES_DATA: Record<CsaPoleSpecies, CsaPoleSpeciesProperties> = {
  "western-red-cedar": {
    species: "western-red-cedar",
    commonName: "Western Red Cedar (CSA 015)",
    fiberStressMpa: 39.0, // 39 MPa (~5,650 psi)
    densityKgPerM3: 400.0,
  },
  "douglas-fir": {
    species: "douglas-fir",
    commonName: "Douglas Fir (CSA 015)",
    fiberStressMpa: 55.0, // 55 MPa (~7,980 psi)
    densityKgPerM3: 530.0,
  },
  "lodgepole-pine": {
    species: "lodgepole-pine",
    commonName: "Lodgepole Pine (CSA 015)",
    fiberStressMpa: 45.0, // 45 MPa (~6,525 psi)
    densityKgPerM3: 460.0,
  },
  "jack-pine": {
    species: "jack-pine",
    commonName: "Jack Pine (CSA 015)",
    fiberStressMpa: 45.0,
    densityKgPerM3: 460.0,
  },
  "red-pine": {
    species: "red-pine",
    commonName: "Red Pine (CSA 015)",
    fiberStressMpa: 40.0,
    densityKgPerM3: 430.0,
  },
};

export interface CsaCableAttachmentConfig {
  id: string;
  name?: string | undefined;
  type: "telecom-fiber" | "telecom-coax" | "power-secondary" | "power-primary";
  attachmentHeightMeters: number;
  bareCableDiameterMm: number;
  bareCableWeightKgPerM: number;
  spanLengthMeters: number;
  rulingSpanMeters?: number | undefined;
  lineAngleDeg?: number | undefined;
}

export interface CsaPoleAnalysisConfig {
  poleId: string;
  species: CsaPoleSpecies;
  overallLengthMeters: number;
  circumferenceAtGroundLineMeters: number;
  circumferenceAtTopMeters: number;
  constructionGrade: CsaConstructionGrade;
  loadingDistrict: CsaLoadingDistrict;
  attachments: CsaCableAttachmentConfig[];
}

export interface CsaCableLoadingResult {
  attachmentId: string;
  bareDiameterMm: number;
  icedDiameterMm: number;
  verticalGravityLoadNewtonsPerMeter: number;
  transverseWindLoadNewtonsPerMeter: number;
  resultantLoadNewtonsPerMeter: number;
  totalTransverseLoadNewtons: number;
  totalVerticalLoadNewtons: number;
}

export interface CsaPoleStressReport {
  poleId: string;
  standard: "CSA_C22_3_NO1";
  district: CsaLoadingDistrict;
  constructionGrade: CsaConstructionGrade;
  resistanceFactorPhi: number;
  settingDepthMeters: number;
  aboveGroundHeightMeters: number;
  groundLineSectionModulusM3: number;
  resistingMomentCapacityNm: number;
  totalGroundLineMomentNm: number;
  transverseAttachmentMomentNm: number;
  poleWindMomentNm: number;
  poleCapacityUtilizationPercent: number;
  isCompliant: boolean;
  status: "Pass" | "Fail - Overloaded Pole Capacity";
  attachments: CsaCableLoadingResult[];
}

/**
 * Calculates unit loading on a conductor/cable under CSA C22.3 No. 1 weather loading.
 */
export function calculateCsaCableLoading(
  cable: CsaCableAttachmentConfig,
  district: CsaLoadingDistrict,
): CsaCableLoadingResult {
  const params = CSA_DISTRICT_STANDARDS[district];
  const g = 9.80665; // m/s^2

  const radialIceMm = params.radialIceThicknessMm;
  const bareDiameterMm = cable.bareCableDiameterMm;
  const icedDiameterMm = bareDiameterMm + 2.0 * radialIceMm;

  // Ice volume and weight (glaze ice density = 913 kg/m^3)
  const iceDensityKgM3 = 913.0;
  const bareRadiusM = (bareDiameterMm / 2.0) / 1000.0;
  const icedRadiusM = (icedDiameterMm / 2.0) / 1000.0;
  const iceAreaM2 = Math.PI * (icedRadiusM * icedRadiusM - bareRadiusM * bareRadiusM);
  const iceWeightKgPerM = iceAreaM2 * iceDensityKgM3;

  const totalVerticalKgPerM = cable.bareCableWeightKgPerM + iceWeightKgPerM;
  const verticalGravityForceNPerM = totalVerticalKgPerM * g;

  // Transverse wind force on projected iced conductor
  const windPressurePa = params.horizontalWindPressurePascals;
  const projectedAreaM2PerM = (icedDiameterMm / 1000.0) * 1.0;
  const transverseWindForceNPerM = windPressurePa * projectedAreaM2PerM;

  // Resultant load per meter (vector sum + CSA K constant)
  const vectorResultantNPerM =
    Math.sqrt(
      verticalGravityForceNPerM * verticalGravityForceNPerM +
      transverseWindForceNPerM * transverseWindForceNPerM,
    ) + params.constantKFactorNewtonsPerMeter;

  // Total forces on attachment at pole (half-span on each side = full spanLength)
  const span = cable.spanLengthMeters;
  const angleRad = ((cable.lineAngleDeg ?? 0.0) * Math.PI) / 180.0;
  const angleMultiplier = angleRad > 0 ? 2.0 * Math.sin(angleRad / 2.0) : 1.0;

  const totalTransverseN = transverseWindForceNPerM * span * angleMultiplier;
  const totalVerticalN = verticalGravityForceNPerM * span;

  return {
    attachmentId: cable.id,
    bareDiameterMm,
    icedDiameterMm: Math.round(icedDiameterMm * 10) / 10,
    verticalGravityLoadNewtonsPerMeter: Math.round(verticalGravityForceNPerM * 1000) / 1000,
    transverseWindLoadNewtonsPerMeter: Math.round(transverseWindForceNPerM * 1000) / 1000,
    resultantLoadNewtonsPerMeter: Math.round(vectorResultantNPerM * 1000) / 1000,
    totalTransverseLoadNewtons: Math.round(totalTransverseN * 10) / 10,
    totalVerticalLoadNewtons: Math.round(totalVerticalN * 10) / 10,
  };
}

/**
 * Evaluates utility pole bending capacity and % utilization under CSA C22.3 No. 1 and CSA 015.
 */
export function evaluateCsaPoleStress(config: CsaPoleAnalysisConfig): CsaPoleStressReport {
  const species = CSA_POLE_SPECIES_DATA[config.species];
  const params = CSA_DISTRICT_STANDARDS[config.loadingDistrict];

  // Setting depth: Standard rule = 10% of overall length + 0.6 m (2 ft)
  const settingDepthM = 0.1 * config.overallLengthMeters + 0.6;
  const aboveGroundHeightM = config.overallLengthMeters - settingDepthM;

  // Ground line section modulus: Z = C^3 / (32 * pi^2)
  const Cgl = config.circumferenceAtGroundLineMeters;
  const groundLineZ = (Cgl * Cgl * Cgl) / (32.0 * Math.PI * Math.PI); // m^3

  // Resistance factor: Grade 1 = 0.65; Grade 2 = 0.80
  const phi = config.constructionGrade === "grade-1" ? 0.65 : 0.80;

  // Resisting Moment Capacity: Mr = phi * fb * Z (Nm)
  const fiberStressPa = species.fiberStressMpa * 1e6;
  const resistingMomentCapacityNm = phi * fiberStressPa * groundLineZ;

  // 1. Transverse moment from attachments
  let transverseAttachmentMomentNm = 0.0;
  const attachmentResults: CsaCableLoadingResult[] = [];

  for (const att of config.attachments) {
    const loading = calculateCsaCableLoading(att, config.loadingDistrict);
    attachmentResults.push(loading);

    // Lever arm above ground line
    const leverArmM = Math.max(0.0, att.attachmentHeightMeters - settingDepthM);
    transverseAttachmentMomentNm += loading.totalTransverseLoadNewtons * leverArmM;
  }

  // 2. Transverse wind moment on tapered pole shaft
  const Ctop = config.circumferenceAtTopMeters;
  const dGround = Cgl / Math.PI;
  const dTop = Ctop / Math.PI;
  const avgDiamM = (dGround + dTop) / 2.0;
  const poleProjectedAreaM2 = avgDiamM * aboveGroundHeightM;
  const poleWindForceN = params.horizontalWindPressurePascals * poleProjectedAreaM2;
  const poleWindCenterOfPressureM = aboveGroundHeightM / 2.0;
  const poleWindMomentNm = poleWindForceN * poleWindCenterOfPressureM;

  const totalGroundLineMomentNm = transverseAttachmentMomentNm + poleWindMomentNm;
  const utilizationPercent = (totalGroundLineMomentNm / resistingMomentCapacityNm) * 100.0;

  const isCompliant = utilizationPercent <= 100.0;

  return {
    poleId: config.poleId,
    standard: "CSA_C22_3_NO1",
    district: config.loadingDistrict,
    constructionGrade: config.constructionGrade,
    resistanceFactorPhi: phi,
    settingDepthMeters: Math.round(settingDepthM * 100) / 100,
    aboveGroundHeightMeters: Math.round(aboveGroundHeightM * 100) / 100,
    groundLineSectionModulusM3: Math.round(groundLineZ * 1e6) / 1e6,
    resistingMomentCapacityNm: Math.round(resistingMomentCapacityNm),
    totalGroundLineMomentNm: Math.round(totalGroundLineMomentNm),
    transverseAttachmentMomentNm: Math.round(transverseAttachmentMomentNm),
    poleWindMomentNm: Math.round(poleWindMomentNm),
    poleCapacityUtilizationPercent: Math.round(utilizationPercent * 10) / 10,
    isCompliant,
    status: isCompliant ? "Pass" : "Fail - Overloaded Pole Capacity",
    attachments: attachmentResults,
  };
}

/**
 * Audits overhead clearances against CSA C22.3 No. 1 Table 1 (Roads) and Table 3 (Power vs Comms).
 */
export interface CsaClearanceAuditResult {
  powerAttachmentHeightMeters: number;
  commAttachmentHeightMeters: number;
  roadClearanceMidSpanMeters: number;
  roadType: "provincial-highway" | "railway" | "local-road" | "pedestrian-only";
  verticalSeparationAtPoleMeters: number;
  requiredSeparationAtPoleMeters: number;
  isSeparationCompliant: boolean;
  requiredRoadClearanceMeters: number;
  isRoadClearanceCompliant: boolean;
  violations: string[];
}

export function auditCsaClearances(params: {
  voltageLevel: "secondary-under-750V" | "primary-up-to-22kV" | "subtransmission-up-to-50kV";
  powerHeightMeters: number;
  commHeightMeters: number;
  roadType: "provincial-highway" | "railway" | "local-road" | "pedestrian-only";
  commMidSpanSagMeters: number;
}): CsaClearanceAuditResult {
  const sepAtPole = params.powerHeightMeters - params.commHeightMeters;

  // CSA C22.3 No. 1 Table 3 Vertical Separation at Support
  let reqSep = 1.0; // 1.0 m (39.4 in) for <= 750 V
  if (params.voltageLevel === "primary-up-to-22kV") {
    reqSep = 1.8; // 1.8 m (70.9 in)
  } else if (params.voltageLevel === "subtransmission-up-to-50kV") {
    reqSep = 2.4; // 2.4 m (94.5 in)
  }

  // CSA C22.3 No. 1 Table 1 Clearance above ground/rails
  let reqRoad = 4.6; // local road default
  switch (params.roadType) {
    case "provincial-highway":
      reqRoad = 5.3; // 5.3 m
      break;
    case "railway":
      reqRoad = 6.7; // 6.7 m
      break;
    case "local-road":
      reqRoad = 4.6; // 4.6 m
      break;
    case "pedestrian-only":
      reqRoad = 3.0; // 3.0 m
      break;
  }

  const midSpanHeight = params.commHeightMeters - params.commMidSpanSagMeters;
  const violations: string[] = [];

  const isSepOk = sepAtPole >= reqSep;
  if (!isSepOk) {
    violations.push(
      `Vertical separation at pole (${Math.round(sepAtPole * 100) / 100} m) violates CSA C22.3 Table 3 minimum (${reqSep} m for ${params.voltageLevel}).`,
    );
  }

  const isRoadOk = midSpanHeight >= reqRoad;
  if (!isRoadOk) {
    violations.push(
      `Mid-span communication clearance (${Math.round(midSpanHeight * 100) / 100} m) violates CSA C22.3 Table 1 requirement (${reqRoad} m over ${params.roadType}).`,
    );
  }

  return {
    powerAttachmentHeightMeters: params.powerHeightMeters,
    commAttachmentHeightMeters: params.commHeightMeters,
    roadClearanceMidSpanMeters: Math.round(midSpanHeight * 100) / 100,
    roadType: params.roadType,
    verticalSeparationAtPoleMeters: Math.round(sepAtPole * 100) / 100,
    requiredSeparationAtPoleMeters: reqSep,
    isSeparationCompliant: isSepOk,
    requiredRoadClearanceMeters: reqRoad,
    isRoadClearanceCompliant: isRoadOk,
    violations,
  };
}
