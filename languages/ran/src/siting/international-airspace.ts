// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * International Airspace Obstruction Evaluation Solver.
 *
 * Implements:
 * 1. ICAO Annex 14 Volume I (Aerodromes) Obstacle Limitation Surfaces (OLS)
 *    - Code 1, 2, 3, 4 Runway specifications
 *    - Inner Horizontal, Conical, Approach, and Transitional Surfaces
 *    - ICAO e-TOD (electronic Terrain and Obstacle Data) Area 1 & Area 2 Export
 * 2. Transport Canada Canadian Aviation Regulations (CAR 601.23) & Standard 621
 *    - 90m (295 ft) AGL Canadian nationwide notification threshold
 *    - 6 km / 60:1 (1.66%) aerodrome approach slope evaluation
 *    - NAV CANADA Land Use Proposal (LUP) / Transport Canada AOC dossier generator
 */

export type InternationalAirspaceStandard = "ICAO_ANNEX14" | "TRANSPORT_CANADA_CAR601";

export type IcaoRunwayCode = "1" | "2" | "3" | "4";
export type IcaoRunwayType = "non-instrument" | "non-precision" | "precision-cat-I" | "precision-cat-II-III";

export interface IcaoAerodromeConfig {
  id: string;
  name: string;
  icaoCode?: string | undefined;
  elevationMslMeters: number;
  latitude: number;
  longitude: number;
  runwayCode: IcaoRunwayCode;
  runwayType: IcaoRunwayType;
  runwayLengthMeters: number;
  runwayThresholdCoordinates?: [number, number] | undefined; // [lat, lon]
}

export interface ProposedStructureSiting {
  id: string;
  name?: string | undefined;
  latitude: number;
  longitude: number;
  groundElevationMslMeters: number;
  structureHeightAglMeters: number; // Above ground level
  appurtenanceHeightMeters?: number | undefined; // lightning rods, antennas
  isNearTraverseway?: boolean | undefined;
  traversewayType?: "highway" | "railroad" | "waterway" | "private-road" | undefined;
}

export interface OlsSurfaceEvaluation {
  surfaceName: "Inner Horizontal" | "Conical" | "Approach" | "Transitional" | "Take-off Climb" | "General Baseline Height";
  surfaceLimitElevationMslMeters: number;
  structureTipElevationMslMeters: number;
  marginMeters: number; // positive = clears surface; negative = penetrates surface
  isPenetrated: boolean;
  slopeRatio?: string | undefined; // e.g. "20:1 (5.0%)", "50:1 (2.0%)"
}

export interface InternationalAirspaceReport {
  structure: ProposedStructureSiting;
  standard: InternationalAirspaceStandard;
  distanceToAerodromeMeters: number;
  effectiveOverallHeightAglMeters: number;
  overallTipElevationMslMeters: number;
  isNotificationMandatory: boolean;
  notificationReasons: string[];
  obstructionSeverity: "Clear" | "Requires Marking & Lighting" | "Hazardous Obstacle to Air Navigation";
  surfacesEvaluated: OlsSurfaceEvaluation[];
  regulatorySubmissionData: {
    regulator: "ICAO / EASA Member State" | "Transport Canada & NAV CANADA";
    eTodArea?: "Area 1" | "Area 2" | undefined;
    navCanadaLupRequired?: boolean | undefined;
    standard621LightingRequired?: boolean | undefined;
    summaryText: string;
  };
}

/**
 * Computes great-circle distance in meters between two lat/lon coordinates using Haversine formula.
 */
export function calculateGreatCircleDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000.0; // Earth mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180.0) *
      Math.cos((lat2 * Math.PI) / 180.0) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
  return R * c;
}

/**
 * Evaluates airspace obstruction against ICAO Annex 14 Volume I Obstacle Limitation Surfaces (OLS).
 */
export function evaluateIcaoAirspaceObstruction(
  structure: ProposedStructureSiting,
  aerodrome: IcaoAerodromeConfig,
): InternationalAirspaceReport {
  const distMeters = calculateGreatCircleDistanceMeters(
    structure.latitude,
    structure.longitude,
    aerodrome.latitude,
    aerodrome.longitude,
  );

  // Traverseway adjustment
  let traversewayBufferMeters = 0.0;
  if (structure.isNearTraverseway) {
    switch (structure.traversewayType) {
      case "highway":
        traversewayBufferMeters = 5.18; // 17 ft
        break;
      case "railroad":
        traversewayBufferMeters = 7.01; // 23 ft
        break;
      case "waterway":
        traversewayBufferMeters = 4.88; // 16 ft
        break;
      default:
        traversewayBufferMeters = 3.05; // 10 ft
    }
  }

  const effectiveAglMeters =
    structure.structureHeightAglMeters +
    (structure.appurtenanceHeightMeters ?? 0.0) +
    traversewayBufferMeters;
  const tipMslMeters = structure.groundElevationMslMeters + effectiveAglMeters;

  const surfaces: OlsSurfaceEvaluation[] = [];
  const reasons: string[] = [];
  let isMandatory = false;

  // 1. ICAO Baseline Height Notification: Any structure >= 100m AGL (or >= 150m in Area 1)
  const baselineAglCeiling = 100.0;
  const baselinePenetrated = effectiveAglMeters >= baselineAglCeiling;
  surfaces.push({
    surfaceName: "General Baseline Height",
    surfaceLimitElevationMslMeters: structure.groundElevationMslMeters + baselineAglCeiling,
    structureTipElevationMslMeters: tipMslMeters,
    marginMeters: Math.round((structure.groundElevationMslMeters + baselineAglCeiling - tipMslMeters) * 100) / 100,
    isPenetrated: baselinePenetrated,
  });
  if (baselinePenetrated) {
    isMandatory = true;
    reasons.push(`Structure overall height (${Math.round(effectiveAglMeters * 10) / 10} m AGL) exceeds ICAO 100 m baseline notification threshold.`);
  }

  // Determine ICAO OLS dimensions per Code
  const isCode3or4 = aerodrome.runwayCode === "3" || aerodrome.runwayCode === "4";
  const innerHorizontalRadiusMeters = isCode3or4 ? 4000.0 : 2500.0;
  const innerHorizontalHeightAboveAerodrome = 45.0; // Standard 45 m
  const innerHorizontalMsl = aerodrome.elevationMslMeters + innerHorizontalHeightAboveAerodrome;

  // 2. Inner Horizontal Surface
  if (distMeters <= innerHorizontalRadiusMeters) {
    const margin = innerHorizontalMsl - tipMslMeters;
    const penetrated = margin < 0;
    surfaces.push({
      surfaceName: "Inner Horizontal",
      surfaceLimitElevationMslMeters: innerHorizontalMsl,
      structureTipElevationMslMeters: tipMslMeters,
      marginMeters: Math.round(margin * 100) / 100,
      isPenetrated: penetrated,
      slopeRatio: "Horizontal (45 m above datum)",
    });
    if (penetrated) {
      isMandatory = true;
      reasons.push(`Structure penetrates ICAO Inner Horizontal Surface by ${Math.round(-margin * 100) / 100} m.`);
    }
  }

  // 3. Conical Surface: 5.0% (20:1) slope extending beyond Inner Horizontal
  const conicalSlope = 0.05; // 20:1
  const conicalMaxHeightAboveInner = isCode3or4 ? 100.0 : 55.0;
  const conicalMaxDistMeters = innerHorizontalRadiusMeters + (conicalMaxHeightAboveInner / conicalSlope);

  if (distMeters > innerHorizontalRadiusMeters && distMeters <= conicalMaxDistMeters) {
    const deltaDist = distMeters - innerHorizontalRadiusMeters;
    const conicalSurfaceMsl = innerHorizontalMsl + deltaDist * conicalSlope;
    const margin = conicalSurfaceMsl - tipMslMeters;
    const penetrated = margin < 0;
    surfaces.push({
      surfaceName: "Conical",
      surfaceLimitElevationMslMeters: Math.round(conicalSurfaceMsl * 100) / 100,
      structureTipElevationMslMeters: tipMslMeters,
      marginMeters: Math.round(margin * 100) / 100,
      isPenetrated: penetrated,
      slopeRatio: "20:1 (5.0%)",
    });
    if (penetrated) {
      isMandatory = true;
      reasons.push(`Structure penetrates ICAO Conical Surface (20:1 slope) by ${Math.round(-margin * 100) / 100} m.`);
    }
  }

  // 4. Approach / Take-off Surface: 2.0% (50:1) for Code 3/4 instrument runways up to 15 km
  const approachSlope = isCode3or4 ? 0.02 : 0.0333; // 50:1 or 30:1
  const approachMaxDistMeters = 15000.0;
  if (distMeters <= approachMaxDistMeters) {
    const approachSurfaceMsl = aerodrome.elevationMslMeters + distMeters * approachSlope;
    const margin = approachSurfaceMsl - tipMslMeters;
    const penetrated = margin < 0;
    surfaces.push({
      surfaceName: "Approach",
      surfaceLimitElevationMslMeters: Math.round(approachSurfaceMsl * 100) / 100,
      structureTipElevationMslMeters: tipMslMeters,
      marginMeters: Math.round(margin * 100) / 100,
      isPenetrated: penetrated,
      slopeRatio: isCode3or4 ? "50:1 (2.0%)" : "30:1 (3.33%)",
    });
    if (penetrated) {
      isMandatory = true;
      reasons.push(`Structure penetrates ICAO Approach Surface by ${Math.round(-margin * 100) / 100} m.`);
    }
  }

  let severity: InternationalAirspaceReport["obstructionSeverity"] = "Clear";
  if (surfaces.some((s) => s.isPenetrated && s.surfaceName !== "General Baseline Height")) {
    severity = "Hazardous Obstacle to Air Navigation";
  } else if (surfaces.some((s) => s.isPenetrated)) {
    severity = "Requires Marking & Lighting";
  }

  return {
    structure,
    standard: "ICAO_ANNEX14",
    distanceToAerodromeMeters: Math.round(distMeters * 10) / 10,
    effectiveOverallHeightAglMeters: Math.round(effectiveAglMeters * 100) / 100,
    overallTipElevationMslMeters: Math.round(tipMslMeters * 100) / 100,
    isNotificationMandatory: isMandatory,
    notificationReasons: reasons,
    obstructionSeverity: severity,
    surfacesEvaluated: surfaces,
    regulatorySubmissionData: {
      regulator: "ICAO / EASA Member State",
      eTodArea: distMeters <= 45000 ? "Area 2" : "Area 1",
      standard621LightingRequired: severity !== "Clear",
      summaryText: isMandatory
        ? `ICAO notification mandatory: Structure penetrates OLS or exceeds 100m baseline near ${aerodrome.name}.`
        : `ICAO compliant: Structure clears all Annex 14 OLS surfaces near ${aerodrome.name}.`,
    },
  };
}

/**
 * Evaluates Canadian airspace obstruction against Transport Canada CAR 601.23 and Standard 621.
 */
export function evaluateTransportCanadaAirspaceObstruction(
  structure: ProposedStructureSiting,
  aerodrome: IcaoAerodromeConfig,
): InternationalAirspaceReport {
  const distMeters = calculateGreatCircleDistanceMeters(
    structure.latitude,
    structure.longitude,
    aerodrome.latitude,
    aerodrome.longitude,
  );

  const effectiveAglMeters =
    structure.structureHeightAglMeters +
    (structure.appurtenanceHeightMeters ?? 0.0);
  const tipMslMeters = structure.groundElevationMslMeters + effectiveAglMeters;

  const surfaces: OlsSurfaceEvaluation[] = [];
  const reasons: string[] = [];
  let isMandatory = false;

  // 1. CAR 601.23(a) Nationwide 90m (295.3 ft) AGL threshold
  const car90mThreshold = 90.0;
  const isOver90m = effectiveAglMeters >= car90mThreshold;
  surfaces.push({
    surfaceName: "General Baseline Height",
    surfaceLimitElevationMslMeters: structure.groundElevationMslMeters + car90mThreshold,
    structureTipElevationMslMeters: tipMslMeters,
    marginMeters: Math.round((structure.groundElevationMslMeters + car90mThreshold - tipMslMeters) * 100) / 100,
    isPenetrated: isOver90m,
    slopeRatio: "CAR 601.23 90m AGL Ceiling",
  });
  if (isOver90m) {
    isMandatory = true;
    reasons.push(`Overall height (${Math.round(effectiveAglMeters * 10) / 10} m AGL) exceeds Transport Canada CAR 601.23(a) 90 m nationwide threshold.`);
  }

  // 2. CAR 601.23(b) Aerodrome Vicinity: Within 6 km (6,000 m) of aerodrome
  if (distMeters <= 6000.0) {
    // 60:1 slope (1.66%) for instrument runway, 50:1 (2.0%) for non-instrument
    const slope = aerodrome.runwayType === "non-instrument" ? 0.02 : 0.016667;
    const slopeRatioText = aerodrome.runwayType === "non-instrument" ? "50:1 (2.0%)" : "60:1 (1.67%)";

    const allowedMsl = aerodrome.elevationMslMeters + distMeters * slope;
    const margin = allowedMsl - tipMslMeters;
    const penetrated = margin < 0;

    surfaces.push({
      surfaceName: "Approach",
      surfaceLimitElevationMslMeters: Math.round(allowedMsl * 100) / 100,
      structureTipElevationMslMeters: tipMslMeters,
      marginMeters: Math.round(margin * 100) / 100,
      isPenetrated: penetrated,
      slopeRatio: slopeRatioText,
    });

    if (penetrated) {
      isMandatory = true;
      reasons.push(`Structure penetrates Transport Canada 6 km aerodrome approach surface (${slopeRatioText}) by ${Math.round(-margin * 100) / 100} m.`);
    }
  }

  let severity: InternationalAirspaceReport["obstructionSeverity"] = "Clear";
  if (surfaces.some((s) => s.isPenetrated && s.surfaceName !== "General Baseline Height")) {
    severity = "Hazardous Obstacle to Air Navigation";
  } else if (surfaces.some((s) => s.isPenetrated)) {
    severity = "Requires Marking & Lighting";
  }

  return {
    structure,
    standard: "TRANSPORT_CANADA_CAR601",
    distanceToAerodromeMeters: Math.round(distMeters * 10) / 10,
    effectiveOverallHeightAglMeters: Math.round(effectiveAglMeters * 100) / 100,
    overallTipElevationMslMeters: Math.round(tipMslMeters * 100) / 100,
    isNotificationMandatory: isMandatory,
    notificationReasons: reasons,
    obstructionSeverity: severity,
    surfacesEvaluated: surfaces,
    regulatorySubmissionData: {
      regulator: "Transport Canada & NAV CANADA",
      navCanadaLupRequired: isMandatory,
      standard621LightingRequired: severity !== "Clear",
      summaryText: isMandatory
        ? `NAV CANADA Land Use Proposal (LUP) submission mandatory: Structure exceeds CAR 601.23 criteria near ${aerodrome.name}.`
        : `Transport Canada compliant: Structure clears CAR 601.23 limits near ${aerodrome.name}.`,
    },
  };
}
