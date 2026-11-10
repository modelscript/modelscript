// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NESC Rule 250 Structural Loading Engine for Aerial Telecom Infrastructure.
 *
 * Implements:
 * - NESC ANSI C2-2023 Rule 250B (Heavy, Medium, Light Loading Districts)
 * - NESC Rule 250C (Extreme Wind Loading up to 140 mph)
 * - NESC Rule 250D (Extreme Ice with Concurrent Wind)
 * - Transverse wind pressure on iced and bare cylindrical conductors
 * - Resultant vector loading and messenger cable horizontal tension calculation
 */

export type NescLoadingDistrict = "heavy" | "medium" | "light" | "extreme-wind" | "extreme-ice";

export interface NescDistrictParameters {
  district: NescLoadingDistrict;
  radialIceThicknessInches: number;
  radialIceThicknessMeters: number;
  horizontalWindPressurePsf: number;
  horizontalWindPressurePascals: number;
  temperatureFahrenheit: number;
  constantKFactorLbsPerFt: number;
  constantKFactorNewtonsPerMeter: number;
}

export const NESC_DISTRICT_STANDARDS: Record<NescLoadingDistrict, NescDistrictParameters> = {
  heavy: {
    district: "heavy",
    radialIceThicknessInches: 0.5,
    radialIceThicknessMeters: 0.0127,
    horizontalWindPressurePsf: 4.0, // 4 psf (~39.5 mph)
    horizontalWindPressurePascals: 191.52,
    temperatureFahrenheit: 0.0,
    constantKFactorLbsPerFt: 0.3,
    constantKFactorNewtonsPerMeter: 4.378,
  },
  medium: {
    district: "medium",
    radialIceThicknessInches: 0.25,
    radialIceThicknessMeters: 0.00635,
    horizontalWindPressurePsf: 4.0,
    horizontalWindPressurePascals: 191.52,
    temperatureFahrenheit: 15.0,
    constantKFactorLbsPerFt: 0.2,
    constantKFactorNewtonsPerMeter: 2.919,
  },
  light: {
    district: "light",
    radialIceThicknessInches: 0.0,
    radialIceThicknessMeters: 0.0,
    horizontalWindPressurePsf: 9.0, // 9 psf (~59.3 mph)
    horizontalWindPressurePascals: 430.92,
    temperatureFahrenheit: 30.0,
    constantKFactorLbsPerFt: 0.05,
    constantKFactorNewtonsPerMeter: 0.73,
  },
  "extreme-wind": {
    district: "extreme-wind",
    radialIceThicknessInches: 0.0,
    radialIceThicknessMeters: 0.0,
    horizontalWindPressurePsf: 25.6, // 100 mph 3-second gust
    horizontalWindPressurePascals: 1225.8,
    temperatureFahrenheit: 60.0,
    constantKFactorLbsPerFt: 0.0,
    constantKFactorNewtonsPerMeter: 0.0,
  },
  "extreme-ice": {
    district: "extreme-ice",
    radialIceThicknessInches: 1.0,
    radialIceThicknessMeters: 0.0254,
    horizontalWindPressurePsf: 2.3, // concurrent ~30 mph wind with 1" ice
    horizontalWindPressurePascals: 110.12,
    temperatureFahrenheit: 15.0,
    constantKFactorLbsPerFt: 0.0,
    constantKFactorNewtonsPerMeter: 0.0,
  },
};

export interface AerialCableSpecification {
  id: string;
  name: string;
  outerDiameterInches: number;
  weightLbsPerFt: number;
  ratedBreakingStrengthLbs?: number | undefined;
  messengerDiameterInches?: number | undefined;
  isSelfSupportingFigure8?: boolean | undefined;
}

export interface CableUnitLoadingResult {
  cableId: string;
  district: NescLoadingDistrict;
  bareDiameterInches: number;
  icedDiameterInches: number;
  verticalBareWeightLbsPerFt: number;
  verticalIceWeightLbsPerFt: number;
  totalVerticalLoadLbsPerFt: number;
  transverseWindLoadLbsPerFt: number;
  nescResultantLoadLbsPerFt: number;
  nescResultantLoadNewtonsPerMeter: number;
}

export interface SpanTensionResult {
  spanLengthFeet: number;
  sagFeet: number;
  sagRatioPercent: number;
  horizontalTensionLbs: number;
  catenaryMaxTensionLbs: number;
  safetyFactor: number;
  isWithinTensionLimit: boolean;
}

// Glaze ice density per NESC Rule 250: 57 lb/ft^3
const ICE_DENSITY_LBS_PER_CU_FT = 57.0;

/**
 * Calculates NESC Rule 250 vertical ice, horizontal wind, and vector resultant loading on an aerial cable.
 */
export function computeNescCableLoading(
  cable: AerialCableSpecification,
  district: NescLoadingDistrict = "heavy",
): CableUnitLoadingResult {
  const params = NESC_DISTRICT_STANDARDS[district];
  const dBareInches = cable.outerDiameterInches;
  const tIceInches = params.radialIceThicknessInches;
  const dIcedInches = dBareInches + 2.0 * tIceInches;

  // Cross-sectional area of ice ring in square inches
  const iceAreaSqInches = (Math.PI / 4.0) * (dIcedInches * dIcedInches - dBareInches * dBareInches);
  // Volume per linear foot in cu ft = Area (sq in) / 144 * 1 ft
  const iceWeightLbsPerFt = (iceAreaSqInches / 144.0) * ICE_DENSITY_LBS_PER_CU_FT;

  const totalVerticalLbsPerFt = cable.weightLbsPerFt + iceWeightLbsPerFt;

  // Transverse wind force = pressure (psf) * projected diameter (ft)
  const transverseWindLbsPerFt = params.horizontalWindPressurePsf * (dIcedInches / 12.0);

  // Resultant vector = sqrt(V^2 + H^2) + NESC K factor
  const vectorMagnitude = Math.sqrt(
    totalVerticalLbsPerFt * totalVerticalLbsPerFt + transverseWindLbsPerFt * transverseWindLbsPerFt,
  );
  const nescResultantLbsPerFt = vectorMagnitude + params.constantKFactorLbsPerFt;
  const nescResultantNm = nescResultantLbsPerFt * 14.5939;

  return {
    cableId: cable.id,
    district,
    bareDiameterInches: Math.round(dBareInches * 1000) / 1000,
    icedDiameterInches: Math.round(dIcedInches * 1000) / 1000,
    verticalBareWeightLbsPerFt: Math.round(cable.weightLbsPerFt * 1000) / 1000,
    verticalIceWeightLbsPerFt: Math.round(iceWeightLbsPerFt * 1000) / 1000,
    totalVerticalLoadLbsPerFt: Math.round(totalVerticalLbsPerFt * 1000) / 1000,
    transverseWindLoadLbsPerFt: Math.round(transverseWindLbsPerFt * 1000) / 1000,
    nescResultantLoadLbsPerFt: Math.round(nescResultantLbsPerFt * 1000) / 1000,
    nescResultantLoadNewtonsPerMeter: Math.round(nescResultantNm * 100) / 100,
  };
}

/**
 * Computes catenary/parabolic horizontal tension and mid-span sag under NESC environmental loading.
 */
export function computeSpanTension(
  cableLoading: CableUnitLoadingResult,
  spanLengthFeet: number,
  options?: {
    targetSagRatioPercent?: number | undefined; // default 2.0% of span length
    fixedHorizontalTensionLbs?: number | undefined;
    ratedBreakingStrengthLbs?: number | undefined;
  },
): SpanTensionResult {
  const w = cableLoading.nescResultantLoadLbsPerFt;
  const L = spanLengthFeet;
  const rbs = options?.ratedBreakingStrengthLbs ?? 6000.0; // default 6M strand (6,000 lbs RBS)

  let H: number;
  let sag: number;

  if (options?.fixedHorizontalTensionLbs && options.fixedHorizontalTensionLbs > 0) {
    H = options.fixedHorizontalTensionLbs;
    // Parabolic sag S = w * L^2 / (8 * H)
    sag = (w * L * L) / (8.0 * H);
  } else {
    const ratio = (options?.targetSagRatioPercent ?? 2.0) / 100.0;
    sag = L * ratio;
    // H = w * L^2 / (8 * sag)
    H = (w * L * L) / (8.0 * Math.max(0.1, sag));
  }

  // Maximum tension occurs at supports: T_max = H + w * S
  const tMax = H + w * sag;
  const safetyFactor = rbs / Math.max(1.0, tMax);
  // NESC Rule 261H specifies tension shall not exceed 60% of RBS at loaded conditions
  const maxAllowableTension = rbs * 0.6;
  const isWithinLimit = tMax <= maxAllowableTension;

  return {
    spanLengthFeet: Math.round(L * 10) / 10,
    sagFeet: Math.round(sag * 100) / 100,
    sagRatioPercent: Math.round((sag / L) * 1000) / 10,
    horizontalTensionLbs: Math.round(H * 10) / 10,
    catenaryMaxTensionLbs: Math.round(tMax * 10) / 10,
    safetyFactor: Math.round(safetyFactor * 100) / 100,
    isWithinTensionLimit: isWithinLimit,
  };
}
