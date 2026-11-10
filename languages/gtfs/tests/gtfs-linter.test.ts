// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintGtfs, parseGtfs } from "../src/index.js";

test("GTFS Linter — clean timetable passes with zero diagnostics", () => {
  const cleanFeed = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Terminal,37.7,-122.4
S2,Center,37.8,-122.4

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,1,Express,3

# TRIPS
route_id,service_id,trip_id,shape_id
R1,WEEKDAY,T1,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
T1,08:00:00,08:00:30,S1,1,0.0
T1,08:15:00,08:15:30,S2,2,3000.0
`;
  const diags = lintGtfs(parseGtfs(cleanFeed));
  assert.strictEqual(diags.length, 0);
});

test("GTFS Linter — detects missing route reference", () => {
  const badFeed = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Terminal,37.7,-122.4

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,1,Express,3

# TRIPS
route_id,service_id,trip_id,shape_id
R_NON_EXISTENT,WEEKDAY,T1,SH1
`;
  const diags = lintGtfs(parseGtfs(badFeed));
  assert.ok(diags.some((d) => d.rule === "gtfs-route-not-found"));
});

test("GTFS Linter — detects missing stop in stop_times", () => {
  const badFeed = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Terminal,37.7,-122.4

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,1,Express,3

# TRIPS
route_id,service_id,trip_id,shape_id
R1,WEEKDAY,T1,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
T1,08:00:00,08:00:30,S1,1,0.0
T1,08:15:00,08:15:30,S_MISSING,2,3000.0
`;
  const diags = lintGtfs(parseGtfs(badFeed));
  assert.ok(diags.some((d) => d.rule === "gtfs-stop-not-found"));
});

test("GTFS Linter — detects chronological time reversal in stop sequence", () => {
  const badFeed = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Terminal,37.7,-122.4
S2,Center,37.8,-122.4

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,1,Express,3

# TRIPS
route_id,service_id,trip_id,shape_id
R1,WEEKDAY,T1,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
T1,08:30:00,08:30:30,S1,1,0.0
T1,08:10:00,08:10:30,S2,2,3000.0
`;
  const diags = lintGtfs(parseGtfs(badFeed));
  assert.ok(diags.some((d) => d.rule === "gtfs-time-reversal"));
});
