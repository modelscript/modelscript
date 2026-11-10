// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for GTFS Metropolitan Multimodal Transit Network & Electric Bus Depot Charging (Benchmark 43).
 *
 * Evaluates:
 * 1. Multimodal transit feed parsing across agencies, routes, stops, trips, stop_times, and vehicle parameters.
 * 2. Longitudinal bus kinematics, aerodynamic/rolling resistance, and battery SOC depletion.
 * 3. Depot overnight fleet charging power profiles and peak MW demand.
 * 4. DAE arena lowering into square linear memory DAEBuilder arena.
 */

import assert from "node:assert/strict";
import {
  parseGtfs,
  solveTractionProfiles,
  solveDepotCharging,
  lowerGtfsToDae,
  type GtfsFeed,
  type TripTractionProfile,
  type DepotChargingProfile,
} from "../src/index.js";

export const METRO_GTFS_BENCHMARK = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_101,Metro Central Station,37.7833,-122.4167
STOP_102,Tech Corridor Center,37.7890,-122.4010
STOP_103,Waterfront Terminal,37.7955,-122.3937
STOP_104,Marina Bay Plaza,37.8030,-122.4360

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_E1,E1,Downtown Rapid Electric Express,3
ROUTE_E2,E2,Marina Bay Crosstown Electric,3

# TRIPS
route_id,service_id,trip_id,shape_id
ROUTE_E1,WEEKDAY,TRIP_E1_AM,SHAPE_E1
ROUTE_E2,WEEKDAY,TRIP_E2_AM,SHAPE_E2

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_E1_AM,07:00:00,07:01:00,STOP_101,1,0.0
TRIP_E1_AM,07:12:00,07:13:00,STOP_102,2,2500.0
TRIP_E1_AM,07:25:00,07:26:00,STOP_103,3,5500.0
TRIP_E2_AM,07:30:00,07:31:00,STOP_101,1,0.0
TRIP_E2_AM,07:50:00,07:51:00,STOP_104,2,4200.0

# VEHICLE
mass 19500
battery 400
aux 10.0
`;

export interface GtfsBenchmarkMetrics {
  routesCount: number;
  stopsCount: number;
  tripsCount: number;
  totalDistanceM: number;
  totalEnergyKWh: number;
  peakTractionKW: number;
  depotPeakDemandKW: number;
  depot24hHoursCount: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runGtfsBenchmark(src = METRO_GTFS_BENCHMARK): GtfsBenchmarkMetrics {
  const feed: GtfsFeed = parseGtfs(src);
  assert.equal(feed.routes.length, 2);
  assert.equal(feed.stops.length, 4);
  assert.equal(feed.trips.length, 2);

  const profiles: TripTractionProfile[] = solveTractionProfiles(feed);
  assert.equal(profiles.length, 2);

  let totalDist = 0;
  let totalEnergy = 0;
  let peakTract = 0;

  for (const p of profiles) {
    totalDist += p.totalDistanceM;
    totalEnergy += p.totalEnergyKWh;
    if (p.peakTractionKW > peakTract) peakTract = p.peakTractionKW;
  }

  const depot: DepotChargingProfile = solveDepotCharging(feed);
  assert.equal(depot.hourlyDemandKW.length, 24);

  const arena = lowerGtfsToDae(feed);
  const daeVarCount = arena.variables().length;
  const daeEqCount = arena.equations().length;

  return {
    routesCount: feed.routes.length,
    stopsCount: feed.stops.length,
    tripsCount: feed.trips.length,
    totalDistanceM: totalDist,
    totalEnergyKWh: totalEnergy,
    peakTractionKW: peakTract,
    depotPeakDemandKW: depot.peakDemandKW,
    depot24hHoursCount: depot.hourlyDemandKW.length,
    daeVarCount,
    daeEqCount,
    isSquare: daeVarCount === daeEqCount,
  };
}
