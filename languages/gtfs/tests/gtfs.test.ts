// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  lintGtfs,
  lowerGtfsToDae,
  parseGtfs,
  solveTractionProfiles,
  solveDepotCharging,
  GtfsWorkspaceIndex,
  validateGtfs,
  getGtfsDocumentSymbols,
} from "../src/index.js";

const SAMPLE_GTFS_FEED = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_1,Central Station,37.7749,-122.4194
STOP_2,Civic Center,37.7793,-122.4175
STOP_3,Mission District,37.7599,-122.4148

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_14,14,Mission Electric Rapid,3

# TRIPS
route_id,service_id,trip_id,shape_id
ROUTE_14,WEEKDAY,TRIP_101,SHAPE_14

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_101,08:00:00,08:00:30,STOP_1,1,0.0
TRIP_101,08:06:00,08:06:30,STOP_2,2,1200.0
TRIP_101,08:18:00,08:18:30,STOP_3,3,3800.0

# VEHICLE
mass 18500
battery 350
aux 8.0
`;

test("GTFS Parser — parses STOPS, ROUTES, TRIPS, STOP_TIMES, and VEHICLE", () => {
  const feed = parseGtfs(SAMPLE_GTFS_FEED);
  assert.strictEqual(feed.stops.length, 3);
  assert.strictEqual(feed.stops[0]?.stop_id, "STOP_1");
  assert.strictEqual(feed.stops[0]?.stop_name, "Central Station");

  assert.strictEqual(feed.routes.length, 1);
  assert.strictEqual(feed.routes[0]?.route_id, "ROUTE_14");
  assert.strictEqual(feed.routes[0]?.route_short_name, "14");

  assert.strictEqual(feed.trips.length, 1);
  assert.strictEqual(feed.trips[0]?.trip_id, "TRIP_101");

  assert.strictEqual(feed.stopTimes.length, 3);
  assert.strictEqual(feed.stopTimes[0]?.stop_sequence, 1);
  assert.strictEqual(feed.stopTimes[2]?.shape_dist_traveled, 3800.0);

  assert.ok(feed.vehicle);
  assert.strictEqual(feed.vehicle?.massKg, 18500);
  assert.strictEqual(feed.vehicle?.batteryKWh, 350);
});

test("GTFS Linter — passes valid schedule without diagnostics", () => {
  const feed = parseGtfs(SAMPLE_GTFS_FEED);
  const diags = lintGtfs(feed);
  assert.strictEqual(diags.length, 0);
});

test("GTFS Linter — detects missing route, missing stop, and time reversal", () => {
  const badFeed = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_A,Station A,37.7,-122.4

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_1,1,Main Line,3

# TRIPS
route_id,service_id,trip_id,shape_id
ROUTE_MISSING,WEEKDAY,TRIP_ERR,SHAPE_1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
TRIP_ERR,08:10:00,08:10:30,STOP_A,1,0.0
TRIP_ERR,08:05:00,08:05:30,STOP_UNDEFINED,2,1000.0
`;
  const feed = parseGtfs(badFeed);
  const diags = lintGtfs(feed);
  assert.ok(diags.length >= 3);

  const rules = diags.map((d) => d.rule);
  assert.ok(rules.includes("gtfs-route-not-found"));
  assert.ok(rules.includes("gtfs-stop-not-found"));
  assert.ok(rules.includes("gtfs-time-reversal"));
});

test("GTFS Traction Solver — evaluates kinematic speed, traction power, and battery SOC", () => {
  const feed = parseGtfs(SAMPLE_GTFS_FEED);
  const profiles = solveTractionProfiles(feed);

  assert.strictEqual(profiles.length, 1);
  const p = profiles[0]!;
  assert.strictEqual(p.tripId, "TRIP_101");
  assert.strictEqual(p.totalDistanceM, 3800.0);
  assert.ok(p.durationSeconds > 0);
  assert.ok(p.averageSpeedKmh > 0);
  assert.ok(p.peakTractionKW > 0);
  assert.ok(p.totalEnergyKWh > 0);
  assert.ok(p.finalSoc < 100.0 && p.finalSoc > 50.0);
});

test("GTFS Depot Charging Solver — synthesizes 24h demand curve", () => {
  const feed = parseGtfs(SAMPLE_GTFS_FEED);
  const depot = solveDepotCharging(feed);

  assert.strictEqual(depot.totalFleetCount, 1);
  assert.ok(depot.peakDemandKW > 0);
  assert.strictEqual(depot.hourlyDemandKW.length, 24);
  assert.ok(depot.hourlyDemandKW[1]! > 0); // Overnight charging active at 01:00
});

test("GTFS DAE Lowering — lowers transit vehicle velocity, SOC, and depot grid demand to arena", () => {
  const feed = parseGtfs(SAMPLE_GTFS_FEED);
  const arena = lowerGtfsToDae(feed);

  const vars = arena.variables();
  assert.ok(vars.length >= 5);
  const eqs = arena.equations();
  assert.ok(eqs.length >= 4);
});

test("GTFS Workspace Index — indexes feed routes, stops, and trips", () => {
  const indexer = new GtfsWorkspaceIndex();
  const idx = indexer.indexFile("file:///feed.gtfs", SAMPLE_GTFS_FEED);

  assert.ok(idx.symbols.size > 0);
  assert.ok(idx.byName.has("Central Station"));
  assert.ok(idx.byName.has("TRIP_101"));
});

test("GTFS LSP — produces diagnostics and symbols", () => {
  const diags = validateGtfs(SAMPLE_GTFS_FEED);
  assert.strictEqual(diags.length, 0);

  const symbols = getGtfsDocumentSymbols(SAMPLE_GTFS_FEED);
  assert.strictEqual(symbols.length, 4); // 1 route + 3 stops
});
