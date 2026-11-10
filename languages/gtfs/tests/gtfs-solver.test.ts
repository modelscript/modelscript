// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGtfs, solveDepotCharging, solveTractionProfiles, timeStringToSeconds } from "../src/index.js";

test("GTFS Solver — timeStringToSeconds converts correctly", () => {
  assert.strictEqual(timeStringToSeconds("00:00:00"), 0);
  assert.strictEqual(timeStringToSeconds("01:00:00"), 3600);
  assert.strictEqual(timeStringToSeconds("08:30:15"), 8 * 3600 + 30 * 60 + 15);
  assert.strictEqual(timeStringToSeconds("23:59:59"), 24 * 3600 - 1);
});

test("GTFS Traction Solver — computes battery SOC depletion and vehicle speed", () => {
  const feedStr = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
A,Stop A,37.000,-122.000
B,Stop B,37.010,-122.000

# ROUTES
route_id,route_short_name,route_long_name,route_type
R_TEST,1,Test Route,3

# TRIPS
route_id,service_id,trip_id,shape_id
R_TEST,DAILY,TRIP_A,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_A,09:00:00,09:00:00,A,1,0.0
TRIP_A,09:10:00,09:10:00,B,2,5000.0

# VEHICLE
mass 18000
battery 300
aux 8.0
`;
  const feed = parseGtfs(feedStr);
  const profiles = solveTractionProfiles(feed);

  assert.strictEqual(profiles.length, 1);
  const p = profiles[0]!;
  assert.strictEqual(p.tripId, "TRIP_A");
  assert.strictEqual(p.totalDistanceM, 5000.0);
  assert.strictEqual(p.durationSeconds, 600); // 10 minutes

  // Average speed = 5000 m / 600 s = 8.33 m/s = 30 km/h
  assert.ok(Math.abs(p.averageSpeedKmh - 30.0) < 0.1);

  // Final SOC should have depleted from 100%
  assert.ok(p.finalSoc < 100.0);
  assert.ok(p.finalSoc > 90.0);
});

test("GTFS Depot Solver — allocates overnight charging and midday dwell", () => {
  const feedStr = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Depot,37.5,-122.2
S2,Point B,37.6,-122.2

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,R1,Main Route,3

# TRIPS
route_id,service_id,trip_id,shape_id
R1,WEEKDAY,T101,SH1
R1,WEEKDAY,T102,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
T101,06:00:00,06:00:00,S1,1,0.0
T101,06:30:00,06:30:00,S2,2,10000.0
T102,07:00:00,07:00:00,S1,1,0.0
T102,07:30:00,07:30:00,S2,2,10000.0

# VEHICLE
mass 20000
battery 400
aux 10.0
`;
  const feed = parseGtfs(feedStr);
  const depot = solveDepotCharging(feed);

  assert.strictEqual(depot.totalFleetCount, 2);
  assert.strictEqual(depot.hourlyDemandKW.length, 24);

  // Overnight charging active at 23:00, 00:00, 01:00, 02:00, 03:00, 04:00
  for (const h of [23, 0, 1, 2, 3, 4]) {
    assert.ok(depot.hourlyDemandKW[h]! > 0, `Hour ${h} should have active charging`);
  }

  // Morning peak rush hour (08:00) should be zero depot demand
  assert.strictEqual(depot.hourlyDemandKW[8], 0.0);
});
