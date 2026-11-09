// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fresnel zone clearance and Earth curvature bulge solver for microwave links.
 */

export interface FresnelObstacleCheck {
  distanceFromTxKm: number;
  obstacleGroundElevationMeters: number;
  obstacleHeightMeters: number;
}

export interface FresnelClearanceReport {
  pathLengthKm: number;
  frequencyGhz: number;
  kFactor: number;
  midpointFresnelRadiusMeters: number;
  isObstructed: boolean;
  minClearanceRatio: number; // Clearance / r_1
  worstObstacleDistanceKm?: number | undefined;
  diffractionLossDb: number;
}

export function computeFresnelRadiusMeters(
  frequencyGhz: number,
  totalDistanceKm: number,
  distanceFromTxKm: number,
  zoneNumber = 1,
): number {
  if (frequencyGhz <= 0 || totalDistanceKm <= 0) return 0;
  const d1 = distanceFromTxKm;
  const d2 = totalDistanceKm - d1;
  if (d1 <= 0 || d2 <= 0) return 0;

  // r_n = 17.32 * sqrt( (n * d1 * d2) / (f * d) )
  return 17.32 * Math.sqrt((zoneNumber * d1 * d2) / (frequencyGhz * totalDistanceKm));
}

export function computeEarthCurvatureBulgeMeters(
  totalDistanceKm: number,
  distanceFromTxKm: number,
  kFactor = 1.333, // 4/3 standard atmosphere
): number {
  const d1 = distanceFromTxKm;
  const d2 = totalDistanceKm - d1;
  if (d1 <= 0 || d2 <= 0 || kFactor <= 0) return 0;

  // h_earth = (d1 * d2) / (12.74 * K)
  return (d1 * d2) / (12.74 * kFactor);
}

export function evaluateFresnelClearance(
  totalDistanceKm: number,
  frequencyGhz: number,
  txAntennaHeightMeters: number,
  rxAntennaHeightMeters: number,
  obstacles: FresnelObstacleCheck[],
  kFactor = 1.333,
): FresnelClearanceReport {
  const midpointRadius = computeFresnelRadiusMeters(frequencyGhz, totalDistanceKm, totalDistanceKm / 2);

  let minRatio = Infinity;
  let worstDist: number | undefined = undefined;
  let isObstructed = false;
  let diffractionLoss = 0.0;

  for (const obs of obstacles) {
    const d1 = obs.distanceFromTxKm;
    if (d1 <= 0 || d1 >= totalDistanceKm) continue;

    const r1 = computeFresnelRadiusMeters(frequencyGhz, totalDistanceKm, d1);
    const hEarth = computeEarthCurvatureBulgeMeters(totalDistanceKm, d1, kFactor);

    // Line of sight ray height at distance d1:
    const hLos = txAntennaHeightMeters + (d1 / totalDistanceKm) * (rxAntennaHeightMeters - txAntennaHeightMeters);

    // Effective obstacle top including Earth curvature:
    const totalObstacleTop = obs.obstacleGroundElevationMeters + obs.obstacleHeightMeters + hEarth;
    const clearanceMeters = hLos - totalObstacleTop;
    const ratio = r1 > 0 ? clearanceMeters / r1 : 1.0;

    if (ratio < minRatio) {
      minRatio = ratio;
      worstDist = d1;
    }

    if (ratio < 0) {
      isObstructed = true;
    }
  }

  if (minRatio === Infinity) {
    minRatio = 1.0;
  }

  // Knife-edge diffraction approximation (ITU-R P.526):
  // v = -sqrt(2) * (clearance / r_1)
  if (minRatio < 0.6) {
    const v = -Math.SQRT2 * minRatio;
    if (v > -0.7) {
      diffractionLoss = 6.9 + 20 * Math.log10(Math.sqrt(Math.pow(v - 0.1, 2) + 1) + v - 0.1);
    } else {
      diffractionLoss = 0.0;
    }
  }

  return {
    pathLengthKm: totalDistanceKm,
    frequencyGhz,
    kFactor,
    midpointFresnelRadiusMeters: midpointRadius,
    isObstructed,
    minClearanceRatio: minRatio,
    worstObstacleDistanceKm: worstDist,
    diffractionLossDb: Math.max(0, diffractionLoss),
  };
}
