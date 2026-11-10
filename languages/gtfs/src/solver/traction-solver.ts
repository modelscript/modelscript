// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  GtfsFeed,
  TripTractionProfile,
  DepotChargingProfile,
  GtfsStop,
} from "../types.js";

/**
 * Calculates Great Circle distance between two lat/lon points in meters.
 */
function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000.0; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180.0) *
      Math.cos((lat2 * Math.PI) / 180.0) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Parses "HH:MM:SS" time string into total seconds from midnight.
 */
export function timeStringToSeconds(tStr: string): number {
  const parts = tStr.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Evaluates electric bus traction power, energy consumption, and battery SOC trajectories.
 */
export function solveTractionProfiles(feed: GtfsFeed): TripTractionProfile[] {
  const { stops, trips, stopTimes, vehicle } = feed;

  const veh = vehicle ?? {
    massKg: 18500.0,
    frontalAreaM2: 7.5,
    dragCoeff: 0.65,
    rollingResist: 0.008,
    auxPowerKW: 10.0,
    batteryKWh: 350.0,
    regenEfficiency: 0.65,
  };

  const stopMap = new Map<string, GtfsStop>();
  for (const s of stops) {
    stopMap.set(s.stop_id, s);
  }

  // Group stop times by trip_id, sorted by stop_sequence
  const tripStopMap = new Map<string, typeof stopTimes>();
  for (const st of stopTimes) {
    const list = tripStopMap.get(st.trip_id) ?? [];
    list.push(st);
    tripStopMap.set(st.trip_id, list);
  }

  const profiles: TripTractionProfile[] = [];

  for (const trip of trips) {
    const stList = tripStopMap.get(trip.trip_id);
    if (!stList || stList.length < 2) continue;

    stList.sort((a, b) => a.stop_sequence - b.stop_sequence);

    let totalDistM = 0;
    let totalEnergyKWh = 0;
    let peakSpeedKmh = 0;
    let peakPowerKW = 0;
    let currentSoc = 100.0;

    const tStart = timeStringToSeconds(stList[0]!.departure_time);
    const tEnd = timeStringToSeconds(stList[stList.length - 1]!.arrival_time);
    const durationSeconds = Math.max(1, tEnd - tStart);

    for (let k = 0; k < stList.length - 1; k++) {
      const st1 = stList[k]!;
      const st2 = stList[k + 1]!;

      let distM: number;
      if (st1.shape_dist_traveled !== undefined && st2.shape_dist_traveled !== undefined) {
        distM = Math.max(0, st2.shape_dist_traveled - st1.shape_dist_traveled);
      } else {
        const s1 = stopMap.get(st1.stop_id);
        const s2 = stopMap.get(st2.stop_id);
        if (s1 && s2 && s1.stop_lat !== 0 && s2.stop_lat !== 0) {
          distM = haversineDistanceMeters(s1.stop_lat, s1.stop_lon, s2.stop_lat, s2.stop_lon);
        } else {
          distM = 1000.0; // 1 km fallback
        }
      }
      totalDistM += distM;

      const segT1 = timeStringToSeconds(st1.departure_time);
      const segT2 = timeStringToSeconds(st2.arrival_time);
      const dt = Math.max(1, segT2 - segT1);

      const vAvg = distM / dt; // m/s
      const vPeak = vAvg * 1.3; // Estimated peak speed
      const speedKmh = vPeak * 3.6;
      if (speedKmh > peakSpeedKmh) peakSpeedKmh = speedKmh;

      // Forces
      const fRoll = veh.rollingResist * veh.massKg * 9.81;
      const fAero = 0.5 * 1.225 * veh.dragCoeff * veh.frontalAreaM2 * Math.pow(vAvg, 2);
      const pWheelKW = ((fRoll + fAero) * vAvg) / 1000.0;

      // Electrical traction demand including auxiliary
      const pElecKW = pWheelKW / 0.90 + veh.auxPowerKW;
      if (pElecKW > peakPowerKW) peakPowerKW = pElecKW;

      const segEnergyKWh = (pElecKW * dt) / 3600.0;
      totalEnergyKWh += segEnergyKWh;

      const deltaSoc = (segEnergyKWh / Math.max(veh.batteryKWh, 1.0)) * 100.0;
      currentSoc = Math.max(0.0, currentSoc - deltaSoc);
    }

    const avgSpeedKmh = durationSeconds > 0 ? (totalDistM / durationSeconds) * 3.6 : 0;

    profiles.push({
      tripId: trip.trip_id,
      totalDistanceM: totalDistM,
      durationSeconds,
      averageSpeedKmh: avgSpeedKmh,
      peakSpeedKmh,
      peakTractionKW: peakPowerKW,
      totalEnergyKWh,
      finalSoc: currentSoc,
    });
  }

  return profiles;
}

/**
 * Synthesizes 24-hour fleet depot charging demand profile.
 */
export function solveDepotCharging(feed: GtfsFeed): DepotChargingProfile {
  const profiles = solveTractionProfiles(feed);
  const totalFleet = Math.max(1, feed.trips.length);

  let totalDailyEnergyKWh = 0;
  for (const p of profiles) {
    totalDailyEnergyKWh += p.totalEnergyKWh;
  }

  // 24-hour demand curve with overnight charging window (23:00 - 05:00)
  const hourlyDemandKW = new Array<number>(24).fill(0.0);
  const chargingHours = [23, 0, 1, 2, 3, 4]; // 6 hours
  const avgChargePowerKW = totalDailyEnergyKWh / (chargingHours.length * 0.92); // 92% charger efficiency

  for (const h of chargingHours) {
    hourlyDemandKW[h] = avgChargePowerKW;
  }

  // Opportunity charging during midday dwell (11:00 - 13:00)
  hourlyDemandKW[11] = avgChargePowerKW * 0.25;
  hourlyDemandKW[12] = avgChargePowerKW * 0.25;

  let peakDemandKW = 0;
  for (const kw of hourlyDemandKW) {
    if (kw > peakDemandKW) peakDemandKW = kw;
  }

  return {
    depotName: "CentralTransitDepot",
    totalFleetCount: totalFleet,
    peakDemandKW,
    totalDailyEnergyKWh,
    hourlyDemandKW,
  };
}
