// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FAA 14 CFR Part 77 Airspace Obstruction Evaluator & Notice Determination.
 *
 * Implements:
 * - 14 CFR § 77.9 (Notice requirements for proposed construction)
 * - 14 CFR § 77.17 (Airspace obstruction standards & imaginary surfaces)
 * - Runway slope clearance rules (100:1, 50:1, 25:1)
 * - Traverseway clearance additions (roads, highways, railroads)
 * - FAA Form 7460-1 ("Notice of Proposed Construction or Alteration") data modeling
 */

export interface RunwaySpecification {
  airportCode: string;
  runwayId: string;
  runwayLengthFeet: number;
  runwayElevationAmslFeet: number;
  latitude: number;
  longitude: number;
  isInstrumentRunway: boolean;
}

export interface ProposedTowerStructure {
  siteId: string;
  structureName?: string | undefined;
  latitude: number;
  longitude: number;
  groundElevationAmslFeet: number;
  structureHeightAglFeet: number; // Above Ground Level (AGL) including antennas & lightning rods
  traversewayType?: "none" | "interstate" | "public-road" | "railroad" | "waterway" | undefined;
}

export interface FaaNoticeResult {
  requiresFaaNotice: boolean;
  exceedsNoticeCriteriaReasons: string[];
  totalOverallHeightAmslFeet: number;
  effectiveHeightAglWithTraversewayFeet: number;
  nearestRunwayCheck?: {
    airportCode: string;
    runwayId: string;
    distanceFeet: number;
    distanceNauticalMiles: number;
    slopeRatioUsed: number;
    allowableHeightAmslFeet: number;
    slopePenetrationFeet: number;
    isSlopePenetrated: boolean;
  } | undefined;
  obstructionStandardFindings: {
    exceeds200FtAglThreshold: boolean;
    exceeds499FtAglGeneralCeiling: boolean;
    exceedsAirportSurfaceStandard: boolean;
  };
  form74601Data: {
    applicantType: string;
    latitudeFormatted: string;
    longitudeFormatted: string;
    siteElevationAmslFeet: number;
    structureHeightAglFeet: number;
    totalHeightAmslFeet: number;
    noticeFilingDetermination: "NOTICE_REQUIRED" | "NOTICE_NOT_REQUIRED";
    recommendedMarkingAndLighting: "None" | "Red Obstruction Lighting" | "Dual Red/White Medium Intensity" | "High Intensity White";
  };
}

/**
 * Converts decimal degrees to DMS string for FAA Form 7460-1.
 */
function toDms(deg: number, isLatitude: boolean): string {
  const absolute = Math.abs(deg);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = Math.round((minutesNotTruncated - minutes) * 6000) / 100;
  const direction = isLatitude ? (deg >= 0 ? "N" : "S") : (deg >= 0 ? "E" : "W");
  return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${direction}`;
}

/**
 * Great-circle distance between two [lat, lon] coordinates in feet.
 */
function computeDistanceFeet(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 20902231; // Mean Earth radius in feet
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Evaluates whether a proposed telecom tower or antenna structure requires FAA Form 7460-1 notification.
 */
export function evaluateFaaPart77Notice(
  structure: ProposedTowerStructure,
  nearbyRunways: RunwaySpecification[] = [],
): FaaNoticeResult {
  // 1. Add Traverseway Clearance Buffers under 14 CFR § 77.9(c)
  let traversewayBufferFeet = 0;
  if (structure.traversewayType === "interstate") traversewayBufferFeet = 17;
  else if (structure.traversewayType === "public-road") traversewayBufferFeet = 15;
  else if (structure.traversewayType === "railroad") traversewayBufferFeet = 23;
  else if (structure.traversewayType === "waterway") traversewayBufferFeet = 16;

  const effectiveAglFeet = structure.structureHeightAglFeet + traversewayBufferFeet;
  const totalAmslFeet = structure.groundElevationAmslFeet + effectiveAglFeet;

  const reasons: string[] = [];
  let requiresNotice = false;

  // 2. Rule 1: Exceeds 200 feet AGL anywhere (14 CFR § 77.9(a))
  const exceeds200Ft = effectiveAglFeet > 200.0;
  if (exceeds200Ft) {
    requiresNotice = true;
    reasons.push(`Effective structure height (${effectiveAglFeet.toFixed(1)} ft AGL) exceeds the 200 ft AGL baseline threshold under 14 CFR § 77.9(a).`);
  }

  // 3. Rule 2: Exceeds 499 feet AGL general ceiling (14 CFR § 77.17(a)(1))
  const exceeds499Ft = effectiveAglFeet > 499.0;
  if (exceeds499Ft) {
    requiresNotice = true;
    reasons.push(`Effective structure height (${effectiveAglFeet.toFixed(1)} ft AGL) exceeds the 499 ft AGL general obstruction ceiling under 14 CFR § 77.17(a)(1).`);
  }

  // 4. Rule 3: Airport Runway Slope Proximity (14 CFR § 77.9(b))
  let nearestCheck: FaaNoticeResult["nearestRunwayCheck"] = undefined;
  let exceedsAirportStandard = false;

  for (const rwy of nearbyRunways) {
    const distFeet = computeDistanceFeet(structure.latitude, structure.longitude, rwy.latitude, rwy.longitude);

    // Determine applicable slope ratio and distance radius
    const isLongRunway = rwy.runwayLengthFeet > 3200;
    const maxDistanceFeet = isLongRunway ? 20000 : 10000;
    const slopeRatio = isLongRunway ? 100 : 50;

    if (distFeet <= maxDistanceFeet) {
      // Slope allowable height above runway elevation:
      const allowableHeightAboveRwy = distFeet / slopeRatio;
      const allowableAmsl = rwy.runwayElevationAmslFeet + allowableHeightAboveRwy;
      const penetration = totalAmslFeet - allowableAmsl;

      if (!nearestCheck || distFeet < nearestCheck.distanceFeet) {
        nearestCheck = {
          airportCode: rwy.airportCode,
          runwayId: rwy.runwayId,
          distanceFeet: Math.round(distFeet),
          distanceNauticalMiles: Math.round((distFeet / 6076.12) * 100) / 100,
          slopeRatioUsed: slopeRatio,
          allowableHeightAmslFeet: Math.round(allowableAmsl * 10) / 10,
          slopePenetrationFeet: Math.round(penetration * 10) / 10,
          isSlopePenetrated: penetration > 0,
        };
      }

      if (penetration > 0) {
        requiresNotice = true;
        exceedsAirportStandard = true;
        reasons.push(
          `Penetrates 14 CFR § 77.9(b) ${slopeRatio}:1 slope surface of Airport ${rwy.airportCode} Runway ${rwy.runwayId} by ${penetration.toFixed(1)} ft (Distance: ${(distFeet / 5280).toFixed(2)} miles).`,
        );
      }
    }
  }

  // 5. Recommended Marking and Lighting (FAA Advisory Circular AC 70/7460-1M)
  let lightingRecommendation: FaaNoticeResult["form74601Data"]["recommendedMarkingAndLighting"] = "None";
  if (effectiveAglFeet > 499.0) {
    lightingRecommendation = "High Intensity White";
  } else if (effectiveAglFeet > 200.0 || (nearestCheck && nearestCheck.isSlopePenetrated)) {
    lightingRecommendation = "Dual Red/White Medium Intensity";
  } else if (effectiveAglFeet > 150.0) {
    lightingRecommendation = "Red Obstruction Lighting";
  }

  return {
    requiresFaaNotice: requiresNotice,
    exceedsNoticeCriteriaReasons: reasons,
    totalOverallHeightAmslFeet: Math.round(totalAmslFeet * 10) / 10,
    effectiveHeightAglWithTraversewayFeet: Math.round(effectiveAglFeet * 10) / 10,
    nearestRunwayCheck: nearestCheck,
    obstructionStandardFindings: {
      exceeds200FtAglThreshold: exceeds200Ft,
      exceeds499FtAglGeneralCeiling: exceeds499Ft,
      exceedsAirportSurfaceStandard: exceedsAirportStandard,
    },
    form74601Data: {
      applicantType: "Telecommunications Carrier",
      latitudeFormatted: toDms(structure.latitude, true),
      longitudeFormatted: toDms(structure.longitude, false),
      siteElevationAmslFeet: Math.round(structure.groundElevationAmslFeet * 10) / 10,
      structureHeightAglFeet: Math.round(structure.structureHeightAglFeet * 10) / 10,
      totalHeightAmslFeet: Math.round(totalAmslFeet * 10) / 10,
      noticeFilingDetermination: requiresNotice ? "NOTICE_REQUIRED" : "NOTICE_NOT_REQUIRED",
      recommendedMarkingAndLighting: lightingRecommendation,
    },
  };
}
