// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ANSI O5.1 & NESC Rule 260 Wood Pole Bending Stress & Guying Engine.
 *
 * Implements:
 * - ANSI O5.1 wood pole dimensional standards, species fiber strengths, and classes (1-6)
 * - Ground-line section modulus Z = C_gl^3 / (32 * pi^2) and resisting bending moment capacity
 * - Tapered pole wind moment integration
 * - Conductor / messenger transverse wind and line-angle tension moments
 * - NESC Rule 260 Overload Capacity Factors (Grade B and Grade C construction)
 * - Percentage of pole loading (% pole capacity utilization)
 * - Guy wire tension and anchor lead angle resolution
 */

export type WoodSpecies = "southern-yellow-pine" | "douglas-fir" | "western-red-cedar" | "lodgepole-pine";

export interface WoodSpeciesProperties {
  species: WoodSpecies;
  displayName: string;
  designatedFiberStrengthPsi: number;
  densityLbsPerCuFt: number;
}

export const WOOD_SPECIES_DATA: Record<WoodSpecies, WoodSpeciesProperties> = {
  "southern-yellow-pine": {
    species: "southern-yellow-pine",
    displayName: "Southern Yellow Pine",
    designatedFiberStrengthPsi: 8000.0,
    densityLbsPerCuFt: 45.0,
  },
  "douglas-fir": {
    species: "douglas-fir",
    displayName: "Douglas Fir",
    designatedFiberStrengthPsi: 8000.0,
    densityLbsPerCuFt: 40.0,
  },
  "western-red-cedar": {
    species: "western-red-cedar",
    displayName: "Western Red Cedar",
    designatedFiberStrengthPsi: 6000.0,
    densityLbsPerCuFt: 28.0,
  },
  "lodgepole-pine": {
    species: "lodgepole-pine",
    displayName: "Lodgepole Pine",
    designatedFiberStrengthPsi: 6600.0,
    densityLbsPerCuFt: 38.0,
  },
};

export type PoleClass = "1" | "2" | "3" | "4" | "5" | "6";

export type NescConstructionGrade = "B" | "C-crossing" | "C-elsewhere";

export interface NescOverloadFactors {
  grade: NescConstructionGrade;
  windTransverseFactor: number;
  wireTensionFactor: number;
  verticalLoadFactor: number;
}

export const NESC_OVERLOAD_FACTORS: Record<NescConstructionGrade, NescOverloadFactors> = {
  B: {
    grade: "B",
    windTransverseFactor: 2.5,
    wireTensionFactor: 1.65,
    verticalLoadFactor: 1.5,
  },
  "C-crossing": {
    grade: "C-crossing",
    windTransverseFactor: 1.75,
    wireTensionFactor: 1.3,
    verticalLoadFactor: 1.5,
  },
  "C-elsewhere": {
    grade: "C-elsewhere",
    windTransverseFactor: 1.25,
    wireTensionFactor: 1.0,
    verticalLoadFactor: 1.2,
  },
};

export interface PoleAttachmentLoad {
  attachmentId: string;
  description: string;
  heightAboveGroundFeet: number;
  transverseWindForceLbs: number; // Force from wind on wire spans
  tensionForceLbs: number; // Transverse component from line angle turn (2 * T * sin(theta/2))
  verticalForceLbs?: number | undefined;
}

export interface GuyWireSpecification {
  guyId: string;
  attachmentHeightFeet: number;
  leadDistanceFeet: number; // Distance from pole base to ground anchor
  ratedBreakingStrengthLbs?: number | undefined;
}

export interface PoleSpecification {
  poleId: string;
  species: WoodSpecies;
  poleClass: PoleClass;
  lengthFeet: number; // e.g. 40 ft pole
  customGroundLineCircumferenceInches?: number | undefined;
  customTopCircumferenceInches?: number | undefined;
}

export interface PoleLoadingAnalysisResult {
  poleId: string;
  species: string;
  poleClass: string;
  lengthFeet: number;
  settingDepthFeet: number;
  heightAboveGroundFeet: number;
  groundLineCircumferenceInches: number;
  groundLineDiameterInches: number;
  sectionModulusCubicInches: number;
  nominalBendingCapacityFtLbs: number;
  poleWindMomentFtLbs: number;
  attachmentsFactoredMomentFtLbs: number;
  totalFactoredMomentFtLbs: number;
  percentPoleLoading: number; // % capacity utilized
  isCompliant: boolean;
  constructionGrade: NescConstructionGrade;
  guyAnalysis?: {
    requiredGuyTensionLbs: number;
    guyAngleDeg: number;
    anchorTensionLbs: number;
    isGuyed: boolean;
  } | undefined;
}

/**
 * Standard ANSI O5.1 Table 3 approximate ground-line circumference (inches)
 * for a 40 ft pole (standard distribution height) by Class.
 */
function getStandardGroundLineCircumference(lengthFeet: number, pClass: PoleClass): number {
  // Base reference circumferences for 40 ft pole
  const baseCircumference: Record<PoleClass, number> = {
    "1": 43.5,
    "2": 40.0,
    "3": 37.5,
    "4": 34.5,
    "5": 32.0,
    "6": 29.5,
  };
  const base = baseCircumference[pClass] ?? 35.0;
  // Taper factor: approx 0.25 inches circumference per foot of length difference from 40 ft
  const deltaLength = lengthFeet - 40.0;
  return Math.max(20.0, base + deltaLength * 0.25);
}

function getStandardTopCircumference(pClass: PoleClass): number {
  const topCircumference: Record<PoleClass, number> = {
    "1": 27.0,
    "2": 25.0,
    "3": 23.0,
    "4": 21.0,
    "5": 19.0,
    "6": 17.0,
  };
  return topCircumference[pClass] ?? 21.0;
}

/**
 * Computes pole bending stress, ground-line resisting moment capacity, and % pole loading under NESC standards.
 */
export function evaluatePoleLoading(
  pole: PoleSpecification,
  attachments: PoleAttachmentLoad[],
  options?: {
    grade?: NescConstructionGrade | undefined;
    windPressurePsf?: number | undefined; // default 4.0 psf for Heavy/Medium NESC
    guy?: GuyWireSpecification | undefined;
  },
): PoleLoadingAnalysisResult {
  const grade = options?.grade ?? "C-elsewhere";
  const olf = NESC_OVERLOAD_FACTORS[grade];
  const windPsf = options?.windPressurePsf ?? 4.0;
  const speciesData = WOOD_SPECIES_DATA[pole.species];

  // Setting depth per standard: 10% of length + 2 feet
  const settingDepth = 0.1 * pole.lengthFeet + 2.0;
  const heightAboveGround = pole.lengthFeet - settingDepth;

  const circGl =
    pole.customGroundLineCircumferenceInches ?? getStandardGroundLineCircumference(pole.lengthFeet, pole.poleClass);
  const circTop = pole.customTopCircumferenceInches ?? getStandardTopCircumference(pole.poleClass);

  const diamGl = circGl / Math.PI;
  const diamTop = circTop / Math.PI;

  // Section Modulus Z = C_gl^3 / (32 * pi^2) in cubic inches
  const sectionModulus = (circGl * circGl * circGl) / (32.0 * Math.PI * Math.PI);

  // Resisting Moment Capacity M_cap = f_b * Z (in inch-lbs) / 12 = ft-lbs
  const nominalCapacityFtLbs = (speciesData.designatedFiberStrengthPsi * sectionModulus) / 12.0;

  // Integrated wind moment on the pole itself:
  // For a tapered cylinder: M_pole = p_wind * H^2 * (2 * d_gl + d_top) / (6 * 12)
  const poleWindMomentFtLbs =
    olf.windTransverseFactor *
    ((windPsf * (heightAboveGround * heightAboveGround) * (2.0 * (diamGl / 12.0) + (diamTop / 12.0))) / 6.0);

  // Attachment transverse moments
  let attachmentsFactoredMoment = 0.0;
  for (const att of attachments) {
    const factoredWindForce = att.transverseWindForceLbs * olf.windTransverseFactor;
    const factoredTensionForce = att.tensionForceLbs * olf.wireTensionFactor;
    const totalTransForce = factoredWindForce + factoredTensionForce;
    const moment = totalTransForce * att.heightAboveGroundFeet;
    attachmentsFactoredMoment += moment;
  }

  const totalFactoredMoment = poleWindMomentFtLbs + attachmentsFactoredMoment;
  const percentLoading = (totalFactoredMoment / Math.max(1.0, nominalCapacityFtLbs)) * 100.0;

  let guyResult: PoleLoadingAnalysisResult["guyAnalysis"] = undefined;
  if (options?.guy) {
    const guy = options.guy;
    const hGuy = guy.attachmentHeightFeet;
    const dLead = guy.leadDistanceFeet;
    const angleRad = Math.atan2(dLead, hGuy);
    const angleDeg = (angleRad * 180.0) / Math.PI;

    // Guy wire resists the moment applied above the guy attachment:
    // T_guy * sin(alpha) * h_guy = M_unbalanced
    const tensionLbs = totalFactoredMoment / (Math.max(1.0, hGuy) * Math.sin(angleRad));
    const anchorTension = tensionLbs;

    guyResult = {
      requiredGuyTensionLbs: Math.round(tensionLbs * 10) / 10,
      guyAngleDeg: Math.round(angleDeg * 10) / 10,
      anchorTensionLbs: Math.round(anchorTension * 10) / 10,
      isGuyed: true,
    };
  }

  return {
    poleId: pole.poleId,
    species: speciesData.displayName,
    poleClass: `Class ${pole.poleClass}`,
    lengthFeet: pole.lengthFeet,
    settingDepthFeet: Math.round(settingDepth * 10) / 10,
    heightAboveGroundFeet: Math.round(heightAboveGround * 10) / 10,
    groundLineCircumferenceInches: Math.round(circGl * 10) / 10,
    groundLineDiameterInches: Math.round(diamGl * 10) / 10,
    sectionModulusCubicInches: Math.round(sectionModulus * 10) / 10,
    nominalBendingCapacityFtLbs: Math.round(nominalCapacityFtLbs),
    poleWindMomentFtLbs: Math.round(poleWindMomentFtLbs),
    attachmentsFactoredMomentFtLbs: Math.round(attachmentsFactoredMoment),
    totalFactoredMomentFtLbs: Math.round(totalFactoredMoment),
    percentPoleLoading: Math.round(percentLoading * 10) / 10,
    isCompliant: percentLoading <= 100.0,
    constructionGrade: grade,
    guyAnalysis: guyResult,
  };
}
