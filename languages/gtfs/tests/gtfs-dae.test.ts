// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerGtfsToDae, parseGtfs } from "../src/index.js";

const SINGLE_LINE_FEED = `
# STOPS
stop_id,stop_name,stop_lat,stop_lon
S1,Terminal West,34.05,-118.25
S2,Terminal East,34.07,-118.20

# ROUTES
route_id,route_short_name,route_long_name,route_type
R1,10,Crosstown,3

# TRIPS
route_id,service_id,trip_id,shape_id
R1,ALL,T1,SH1

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
T1,10:00:00,10:01:00,S1,1,0.0
T1,10:30:00,10:31:00,S2,2,8000.0

# VEHICLE
mass 20000
battery 450
aux 12.0
`;

test("GTFS DAE Lowering — lowers transit kinematics and depot energy balance to square DAE arena", () => {
  const feed = parseGtfs(SINGLE_LINE_FEED);
  const arena = lowerGtfsToDae(feed, "TransitArena_Line10");

  const vars = arena.variables();
  const eqs = arena.equations();

  // 1 trip * 3 vars + 3 depot vars = 6 vars, 6 eqs
  assert.strictEqual(vars.length, 6);
  assert.strictEqual(eqs.length, 6);

  const varNames = vars.map((v) => v.name);
  assert.ok(varNames.includes("v_T1"));
  assert.ok(varNames.includes("SOC_T1"));
  assert.ok(varNames.includes("P_tract_kW_T1"));
  assert.ok(varNames.includes("P_grid_depot_kW"));
  assert.ok(varNames.includes("E_depot_daily_kWh"));
  assert.ok(varNames.includes("P_grid_depot_avg_kW"));

  // Check state variable initializations
  const vT1 = vars.find((v) => v.name === "v_T1");
  assert.ok((vT1?.start as number) > 0);

  const socT1 = vars.find((v) => v.name === "SOC_T1");
  assert.ok((socT1?.start as number) <= 100.0 && (socT1?.start as number) > 50.0);
});

test("GTFS DAE Lowering — handles feeds without trips gracefully", () => {
  const emptyFeed = parseGtfs("# only comments\n");
  const arena = lowerGtfsToDae(emptyFeed, "EmptyFeedArena");

  // Only the 3 depot variables and equations (with 0 energy/power)
  const vars = arena.variables();
  const eqs = arena.equations();
  assert.strictEqual(vars.length, 3);
  assert.strictEqual(eqs.length, 3);
});
