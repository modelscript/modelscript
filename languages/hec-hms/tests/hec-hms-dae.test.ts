// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerHmsToDae, parseHmsBasin } from "../src/index.js";

const TEST_BASIN = `Basin: Test Basin
  Unit System: Metric
End:

Subbasin: Sub1
  Area: 25.0
  Downstream: Reach1
End:

Reach: Reach1
  Downstream: Jnc1
End:

Junction: Jnc1
  Downstream: Out1
End:

Sink: Out1
End:
`;

test("HEC-HMS DAE Lowering: compiles watershed continuity into linear memory DAEBuilder arena", () => {
  const basin = parseHmsBasin(TEST_BASIN);
  const arena = lowerHmsToDae(basin);

  assert.ok(arena.getVarCount() > 0, "DAE arena should contain storage and flow state variables");
  assert.ok(arena.getEqCount() > 0, "DAE arena should contain mass balance and continuity equations");

  // Verify variable registration
  assert.ok(arena.getVarCount() >= 5);
  assert.ok(arena.getEqCount() >= 3);
});
