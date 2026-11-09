// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DssDeck, DssTccCurve } from "../types.js";

/**
 * Trip evaluation result for a single protection device.
 */
export interface DeviceTripResult {
  name: string;
  type: "relay" | "fuse";
  monitoredElement: string;
  currentAmps: number;
  tripped: boolean;
  tripTimeSeconds: number;
}

/**
 * Coordination evaluation between an upstream and downstream protective device.
 */
export interface ProtectionCoordinationPair {
  upstreamDevice: string;
  downstreamDevice: string;
  faultCurrentAmps: number;
  upstreamTripTimeSeconds: number;
  downstreamTripTimeSeconds: number;
  coordinationMarginSeconds: number;
  isCoordinated: boolean; // Margin >= minMarginSeconds (default 0.2s)
}

/**
 * Complete protection coordination study result.
 */
export interface ProtectionStudyResult {
  devices: Map<string, DeviceTripResult>;
  coordinations: ProtectionCoordinationPair[];
  allCoordinated: boolean;
}

/**
 * Evaluates a Time-Current Characteristic (TCC) curve using log-log interpolation.
 *
 * @param curve - TCC curve with c_array (current multipliers) and t_array (time in seconds).
 * @param multiplier - Operating current multiplier (e.g. I / I_pickup or I / I_rating).
 * @returns Clearing time in seconds, or Infinity if below minimum tripping multiplier.
 */
export function evaluateTccCurve(curve: DssTccCurve, multiplier: number): number {
  const { c_array, t_array } = curve;
  const n = Math.min(c_array.length, t_array.length);
  if (n === 0 || multiplier <= (c_array[0] ?? 1.0)) {
    return Infinity;
  }

  // Clamped extrapolation beyond curve limits
  if (multiplier <= (c_array[0] ?? 1.0)) {
    return t_array[0] ?? Infinity;
  }
  if (multiplier >= (c_array[n - 1] ?? 100.0)) {
    return t_array[n - 1] ?? 0.01;
  }

  // Find bounding interval
  for (let i = 0; i < n - 1; i++) {
    const c1 = c_array[i];
    const c2 = c_array[i + 1];
    const t1 = t_array[i];
    const t2 = t_array[i + 1];
    if (c1 === undefined || c2 === undefined || t1 === undefined || t2 === undefined) continue;

    if (multiplier >= c1 && multiplier <= c2) {
      // Log-log linear interpolation: log10(t) = log10(t1) + m * (log10(c) - log10(c1))
      const logC = Math.log10(multiplier);
      const logC1 = Math.log10(c1);
      const logC2 = Math.log10(c2);
      const logT1 = Math.log10(t1);
      const logT2 = Math.log10(t2);

      const slope = (logT2 - logT1) / Math.max(1e-9, logC2 - logC1);
      const logT = logT1 + slope * (logC - logC1);
      return Math.pow(10, logT);
    }
  }

  return t_array[n - 1] ?? 0.01;
}

/**
 * Evaluates overcurrent protection devices (relays and fuses) in an OpenDSS circuit deck
 * against branch currents or simulated fault currents.
 */
export function evaluateProtection(
  deck: DssDeck,
  currentsByElement: Map<string, number>,
  minCoordinationMarginSeconds = 0.2,
): ProtectionStudyResult {
  const devices = new Map<string, DeviceTripResult>();

  // 1. Evaluate Fuses
  if (deck.fuses) {
    for (const [name, fuse] of deck.fuses) {
      const current = currentsByElement.get(fuse.monitoredElement) ?? 0;
      const curve = deck.tccCurves?.get(fuse.fuseCurve);
      let tripTime = Infinity;
      let tripped = false;

      if (curve && fuse.ratedCurrent > 0) {
        const mult = current / fuse.ratedCurrent;
        if (mult > 1.0) {
          tripTime = evaluateTccCurve(curve, mult);
          tripped = isFinite(tripTime);
        }
      }

      devices.set(name, {
        name,
        type: "fuse",
        monitoredElement: fuse.monitoredElement,
        currentAmps: current,
        tripped,
        tripTimeSeconds: tripTime,
      });
    }
  }

  // 2. Evaluate Relays
  if (deck.relays) {
    for (const [name, relay] of deck.relays) {
      const current = currentsByElement.get(relay.monitoredElement) ?? 0;
      const curveName = relay.phaseCurve;
      const curve = curveName ? deck.tccCurves?.get(curveName) : undefined;
      const pickup = relay.phaseTrip ?? 100.0;
      const td = relay.tdPhase ?? 1.0;

      let tripTime = Infinity;
      let tripped = false;

      if (curve && pickup > 0) {
        const mult = current / pickup;
        if (mult > 1.0) {
          const rawTime = evaluateTccCurve(curve, mult);
          tripTime = rawTime * td;
          tripped = isFinite(tripTime);
        }
      }

      devices.set(name, {
        name,
        type: "relay",
        monitoredElement: relay.monitoredElement,
        currentAmps: current,
        tripped,
        tripTimeSeconds: tripTime,
      });
    }
  }

  // 3. Evaluate upstream / downstream coordination margins
  const coordinations: ProtectionCoordinationPair[] = [];
  let allCoordinated = true;

  if (deck.relays && deck.fuses) {
    for (const [relName, rel] of deck.relays) {
      for (const [fuseName, fuse] of deck.fuses) {
        const current =
          currentsByElement.get(fuse.monitoredElement) ?? currentsByElement.get(rel.monitoredElement) ?? 1000;
        const relRes = devices.get(relName);
        const fuseRes = devices.get(fuseName);
        if (!relRes || !fuseRes) continue;

        const tUp = relRes.tripTimeSeconds;
        const tDown = fuseRes.tripTimeSeconds;
        if (isFinite(tUp) && isFinite(tDown)) {
          const margin = tUp - tDown;
          const isCoordinated = margin >= minCoordinationMarginSeconds;
          if (!isCoordinated) allCoordinated = false;

          coordinations.push({
            upstreamDevice: relName,
            downstreamDevice: fuseName,
            faultCurrentAmps: current,
            upstreamTripTimeSeconds: tUp,
            downstreamTripTimeSeconds: tDown,
            coordinationMarginSeconds: margin,
            isCoordinated,
          });
        }
      }
    }
  }

  return {
    devices,
    coordinations,
    allCoordinated,
  };
}
