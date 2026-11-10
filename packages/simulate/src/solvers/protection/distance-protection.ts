// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Distance Relay & R-X Plane Protection Selectivity Engine.
 *
 * Implements Mho Circle and Quadrilateral impedance characteristics on the complex
 * R-X plane, evaluating multi-zone reach (Zone 1, Zone 2, Zone 3), directional
 * supervision, and time-delayed fault clearing along dynamic apparent impedance trajectories.
 */

export type DistanceCharacteristic = "mho" | "quadrilateral";
export type DirectionalSupervision = "forward" | "reverse" | "non_directional";

export interface DistanceZoneSetting {
  zoneNumber: 1 | 2 | 3;
  characteristic: DistanceCharacteristic;
  /** Positive-sequence reach impedance magnitude in Ohms. */
  reachOhm: number;
  /** Characteristic line angle in degrees (typically 65° to 85°). */
  lineAngleDeg: number;
  /** Resistive fault reach / blinder width in Ohms (for quadrilateral). */
  resistanceReachOhm?: number | undefined;
  /** Operating time delay in seconds (Zone 1 = 0s, Zone 2 = 0.2-0.4s, Zone 3 = 0.6-1.0s). */
  delaySec: number;
  /** Directional supervision mode. */
  directional: DirectionalSupervision;
}

export interface ZoneEvaluationResult {
  zoneNumber: 1 | 2 | 3;
  inside: boolean;
  distanceToBoundaryOhm: number;
  delaySec: number;
}

export interface TrajectoryPoint {
  tSec: number;
  rOhm: number;
  xOhm: number;
}

export interface TrajectoryTripResult {
  tripped: boolean;
  tripZone?: 1 | 2 | 3 | undefined;
  tripTimeSec?: number | undefined;
  clearingTimeSec?: number | undefined;
  timeInZones: Map<1 | 2 | 3, number>;
  apparentImpedanceAtTrip?: { r: number; x: number } | undefined;
}

/**
 * Tests whether an apparent impedance point (R, X) lies inside a distance relay zone.
 */
export function isInsideZone(zone: DistanceZoneSetting, rOhm: number, xOhm: number): boolean {
  const thetaRad = (zone.lineAngleDeg * Math.PI) / 180.0;
  const zReach = zone.reachOhm;

  if (zone.characteristic === "mho") {
    // Mho Circle passing through the origin (0, 0) with diameter along line angle theta
    // Center at (Rr / 2, Xr / 2), Radius = Zr / 2
    const centerR = (zReach * Math.cos(thetaRad)) / 2.0;
    const centerX = (zReach * Math.sin(thetaRad)) / 2.0;
    const radius = zReach / 2.0;

    const distSq = (rOhm - centerR) * (rOhm - centerR) + (xOhm - centerX) * (xOhm - centerX);
    const inCircle = distSq <= radius * radius;

    if (zone.directional === "forward") {
      // Forward directional supervision: X >= -0.05 * zReach
      return inCircle && xOhm >= -0.05 * zReach;
    } else if (zone.directional === "reverse") {
      return inCircle && xOhm <= 0.05 * zReach;
    }
    return inCircle;
  } else {
    // Quadrilateral Characteristic
    // Bounded by X_reach in reactance and R_reach in resistance
    const rReach = zone.resistanceReachOhm ?? zReach * Math.cos(thetaRad) * 1.5;
    const xReach = zReach * Math.sin(thetaRad);

    const xOk =
      zone.directional === "forward"
        ? xOhm >= 0 && xOhm <= xReach
        : zone.directional === "reverse"
          ? xOhm <= 0 && xOhm >= -xReach
          : Math.abs(xOhm) <= xReach;

    const rOk = Math.abs(rOhm) <= rReach;
    return xOk && rOk;
  }
}

/**
 * Evaluates an apparent impedance point across all defined distance zones.
 */
export function evaluatePointAcrossZones(
  zones: DistanceZoneSetting[],
  rOhm: number,
  xOhm: number,
): ZoneEvaluationResult[] {
  return zones.map((zone) => {
    const inside = isInsideZone(zone, rOhm, xOhm);
    return {
      zoneNumber: zone.zoneNumber,
      inside,
      distanceToBoundaryOhm: inside ? 0.0 : Math.hypot(rOhm, xOhm) - zone.reachOhm,
      delaySec: zone.delaySec,
    };
  });
}

/**
 * Evaluates a time-series apparent impedance trajectory Z_app(t) = V(t) / I(t)
 * against distance relay zone delays to declare trip times.
 */
export function evaluateDistanceRelayTrajectory(
  zones: DistanceZoneSetting[],
  trajectory: TrajectoryPoint[],
  breakerOpeningTimeSec = 0.04, // 2-cycle breaker: 40 ms
): TrajectoryTripResult {
  const timeInZones = new Map<1 | 2 | 3, number>([
    [1, 0],
    [2, 0],
    [3, 0],
  ]);

  if (trajectory.length < 2) {
    return { tripped: false, timeInZones };
  }

  // Sort zones by delay ascending (Zone 1 first, then Zone 2, then Zone 3)
  const sortedZones = [...zones].sort((a, b) => a.delaySec - b.delaySec);

  for (let idx = 1; idx < trajectory.length; idx++) {
    const prev = trajectory[idx - 1]!;
    const curr = trajectory[idx]!;
    const dt = Math.max(0, curr.tSec - prev.tSec);

    for (const zone of sortedZones) {
      if (isInsideZone(zone, curr.rOhm, curr.xOhm)) {
        const currentDwell = (timeInZones.get(zone.zoneNumber) ?? 0) + dt;
        timeInZones.set(zone.zoneNumber, currentDwell);

        if (currentDwell >= zone.delaySec) {
          // Trip threshold reached!
          const tripTime = curr.tSec;
          const clearingTime = tripTime + breakerOpeningTimeSec;
          return {
            tripped: true,
            tripZone: zone.zoneNumber,
            tripTimeSec: tripTime,
            clearingTimeSec: clearingTime,
            timeInZones,
            apparentImpedanceAtTrip: { r: curr.rOhm, x: curr.xOhm },
          };
        }
      } else {
        // Reset dwell time when exiting zone (dropout)
        timeInZones.set(zone.zoneNumber, 0);
      }
    }
  }

  return {
    tripped: false,
    timeInZones,
  };
}
