// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseHmsBasin } from "../src/index.js";

const TENKILLER_BASIN = `Basin: Tenkiller Dam Basin
  Last Modified Date: 12 January 2026
  Unit System: Metric
End:

Subbasin: Illinois River Headwaters
  Area: 145.2
  Downstream: Reach 101
  Loss: SCS
  Transform: SCS
End:

Subbasin-Loss: Illinois River Headwaters
  Curve Number: 76.5
  Initial Abstraction: 15.6
  Impervious: 5.2
End:

Subbasin-Transform: Illinois River Headwaters
  Lag: 120.0
End:

Subbasin: Barren Fork
  Area: 89.4
  Downstream: Junction 1
  Loss: SCS
  Transform: SCS
End:

Subbasin-Loss: Barren Fork
  Curve Number: 80.0
  Initial Abstraction: 12.0
  Impervious: 8.0
End:

Reach: Reach 101
  Downstream: Junction 1
  Route: Muskingum
End:

Reach-Route: Reach 101
  Muskingum K: 2.5
  Muskingum X: 0.25
  Subreaches: 3
End:

Junction: Junction 1
  Downstream: Tenkiller Reservoir
End:

Reservoir: Tenkiller Reservoir
  Downstream: Basin Outlet
End:

Sink: Basin Outlet
End:
`;

test("HEC-HMS Parser: parses watershed basin topology correctly", () => {
  const basin = parseHmsBasin(TENKILLER_BASIN);

  assert.equal(basin.name, "Tenkiller Dam Basin");
  assert.equal(basin.unitSystem, "Metric");
  assert.equal(basin.subbasins.size, 2, "Should parse 2 subbasins");
  assert.equal(basin.reaches.size, 1, "Should parse 1 reach");
  assert.equal(basin.junctions.size, 1, "Should parse 1 junction");
  assert.equal(basin.reservoirs.size, 1, "Should parse 1 reservoir");
  assert.equal(basin.sinks.size, 1, "Should parse 1 sink");

  const sb1 = basin.subbasins.get("Illinois River Headwaters");
  assert.ok(sb1);
  assert.equal(sb1.area, 145.2);
  assert.equal(sb1.curveNumber, 76.5);
  assert.equal(sb1.initialAbstraction, 15.6);
  assert.equal(sb1.lagMinutes, 120.0);
  assert.equal(sb1.downstream, "Reach 101");

  const reach1 = basin.reaches.get("Reach 101");
  assert.ok(reach1);
  assert.equal(reach1.muskingumK, 2.5);
  assert.equal(reach1.muskingumX, 0.25);
  assert.equal(reach1.subreaches, 3);
});
