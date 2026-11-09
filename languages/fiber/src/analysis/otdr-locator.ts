// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OTDR Optical Distance to Physical GIS GPS Fault Locator.
 *
 * Maps optical distance (d_opt) measured by Telcordia .sor OTDR traces to exact
 * WGS-84 latitude/longitude coordinates along GeoJSON outside plant (OSP) cable routes.
 * Accounts for:
 *   1. Cable helix factor (H = 1.01 - 1.05) due to fiber helical twisting in buffer tubes
 *   2. Enclosure slack coils stored in manholes, handholes, vaults, and aerial snowshoes
 *   3. Identifies nearest upstream and downstream physical access points for field crew dispatch
 */

import type { FiberCableSpan, FiberStructureNode } from "../types.js";

export interface OtdrFaultLocationRequest {
  cable: FiberCableSpan;
  opticalDistanceMeters: number;
  /** Cable helix factor. Defaults to cable.helixFactor or 1.03 if not specified. */
  helixFactor?: number | undefined;
  /** List of structure nodes along this cable with slack storage. */
  enclosures?: FiberStructureNode[] | undefined;
}

export interface NearestAccessPoint {
  id: string;
  name: string;
  type: string;
  distanceToFaultMeters: number;
  direction: "upstream" | "downstream";
  gpsCoordinate: [number, number];
}

export interface OtdrFaultLocationResult {
  cableId: string;
  opticalDistanceMeters: number;
  physicalSheathDistanceMeters: number;
  gpsCoordinate: [number, number]; // [longitude, latitude]
  elevationMeters?: number | undefined;
  nearestEnclosure?: NearestAccessPoint | undefined;
  totalCableLengthMeters: number;
}

/** Haversine formula to compute great-circle distance between two [lng, lat] points in meters. */
export function computeGpsDistanceMeters(p1: [number, number], p2: [number, number]): number {
  const EARTH_RADIUS_METERS = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;

  const lon1 = toRad(p1[0]);
  const lat1 = toRad(p1[1]);
  const lon2 = toRad(p2[0]);
  const lat2 = toRad(p2[1]);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a =
    Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Locates the physical GPS coordinate and closest access point for an OTDR event.
 */
export function locateOtdrFault(request: OtdrFaultLocationRequest): OtdrFaultLocationResult {
  const helix = request.helixFactor ?? request.cable.helixFactor ?? 1.03;
  // Convert optical fiber distance to raw physical sheath distance
  let sheathTargetMeters = request.opticalDistanceMeters / helix;

  const coords = request.cable.pathCoordinates;
  if (coords.length < 2) {
    const fallbackCoord = coords[0] ?? [0, 0];
    return {
      cableId: request.cable.id,
      opticalDistanceMeters: request.opticalDistanceMeters,
      physicalSheathDistanceMeters: sheathTargetMeters,
      gpsCoordinate: [fallbackCoord[0], fallbackCoord[1]],
      totalCableLengthMeters: 0,
    };
  }

  // Pre-calculate cumulative geometry distances
  const cumulativeDistances: number[] = [0];
  let totalLength = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const pA = coords[i] as [number, number];
    const pB = coords[i + 1] as [number, number];
    const d = computeGpsDistanceMeters(pA, pB);
    totalLength += d;
    cumulativeDistances.push(totalLength);
  }

  // Account for enclosure slack coils encountered along the way
  if (request.enclosures && request.enclosures.length > 0) {
    // Sort enclosures along the cable route by proximity to start
    const sortedEnclosures = [...request.enclosures].map((enc) => {
      let minDist = Infinity;
      let closestSegDist = 0;
      for (let i = 0; i < coords.length; i++) {
        const p = coords[i] as [number, number];
        const distToCoord = computeGpsDistanceMeters(enc.coordinates, p);
        if (distToCoord < minDist) {
          minDist = distToCoord;
          closestSegDist = cumulativeDistances[i] ?? 0;
        }
      }
      return { enclosure: enc, routeOffsetMeters: closestSegDist };
    });

    sortedEnclosures.sort((a, b) => a.routeOffsetMeters - b.routeOffsetMeters);

    let accumulatedSlack = 0;
    for (const item of sortedEnclosures) {
      const slack = item.enclosure.slackStorageMeters ?? 0;
      if (sheathTargetMeters >= item.routeOffsetMeters + accumulatedSlack) {
        accumulatedSlack += slack;
      }
    }
    sheathTargetMeters = Math.max(0, sheathTargetMeters - accumulatedSlack);
  }

  // Clamp target distance to cable geometry length
  const clampedSheathDist = Math.max(0, Math.min(sheathTargetMeters, totalLength));

  // Find line segment containing clampedSheathDist
  let targetCoord: [number, number] = [coords[0]![0], coords[0]![1]];
  for (let i = 0; i < cumulativeDistances.length - 1; i++) {
    const dStart = cumulativeDistances[i]!;
    const dEnd = cumulativeDistances[i + 1]!;

    if (clampedSheathDist >= dStart && clampedSheathDist <= dEnd) {
      const segLength = dEnd - dStart;
      const fraction = segLength > 0 ? (clampedSheathDist - dStart) / segLength : 0;

      const pA = coords[i] as [number, number];
      const pB = coords[i + 1] as [number, number];

      const lng = pA[0] + fraction * (pB[0] - pA[0]);
      const lat = pA[1] + fraction * (pB[1] - pA[1]);
      targetCoord = [lng, lat];
      break;
    }
  }

  // Find closest access point (enclosure, vault, manhole)
  let nearestEncInfo: NearestAccessPoint | undefined = undefined;
  if (request.enclosures && request.enclosures.length > 0) {
    let bestDist = Infinity;
    for (const enc of request.enclosures) {
      const dist = computeGpsDistanceMeters(targetCoord, enc.coordinates);
      if (dist < bestDist) {
        bestDist = dist;
        // Check if enclosure is upstream or downstream
        const encCoordDist = computeGpsDistanceMeters(coords[0] as [number, number], enc.coordinates);
        const direction = encCoordDist < clampedSheathDist ? "upstream" : "downstream";

        nearestEncInfo = {
          id: enc.id,
          name: enc.name,
          type: enc.nodeType,
          distanceToFaultMeters: dist,
          direction,
          gpsCoordinate: enc.coordinates,
        };
      }
    }
  }

  return {
    cableId: request.cable.id,
    opticalDistanceMeters: request.opticalDistanceMeters,
    physicalSheathDistanceMeters: clampedSheathDist,
    gpsCoordinate: targetCoord,
    nearestEnclosure: nearestEncInfo,
    totalCableLengthMeters: totalLength,
  };
}
