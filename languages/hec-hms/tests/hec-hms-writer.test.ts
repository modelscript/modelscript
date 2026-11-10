// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseHmsBasin, writeHmsBasin } from "../src/index.js";

const SIMPLE_BASIN = `Basin: Castro Valley
  Unit System: Metric
End:

Subbasin: Upper Basin
  Area: 10.5000
  Downstream: Reach 1
  Loss: SCS
  Transform: SCS
End:

Subbasin-Loss: Upper Basin
  Curve Number: 75.00
  Initial Abstraction: 16.93
End:

Subbasin-Transform: Upper Basin
  Lag: 45.00
End:

Reach: Reach 1
  Downstream: Outlet
  Route: Muskingum
End:

Reach-Route: Reach 1
  Muskingum K: 1.20
  Muskingum X: 0.20
  Subreaches: 2
End:

Sink: Outlet
End:
`;

test("HEC-HMS Writer: serializes and roundtrips basin deck cleanly", () => {
  const basin1 = parseHmsBasin(SIMPLE_BASIN);
  const serialized = writeHmsBasin(basin1);

  assert.ok(serialized.includes("Basin: Castro Valley"));
  assert.ok(serialized.includes("Subbasin: Upper Basin"));
  assert.ok(serialized.includes("Subbasin-Loss: Upper Basin"));
  assert.ok(serialized.includes("Reach: Reach 1"));
  assert.ok(serialized.includes("Sink: Outlet"));

  const basin2 = parseHmsBasin(serialized);
  assert.equal(basin2.name, "Castro Valley");
  assert.equal(basin2.subbasins.size, 1);
  assert.equal(basin2.reaches.size, 1);
  assert.equal(basin2.sinks.size, 1);

  const sb = basin2.subbasins.get("Upper Basin")!;
  assert.equal(sb.area, 10.5);
  assert.equal(sb.curveNumber, 75.0);
  assert.equal(sb.lagMinutes, 45.0);
});
