// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { HmsErrorCode, lintHmsBasin, parseHmsBasin } from "../src/index.js";

test("HEC-HMS Linter: detects invalid non-positive drainage area (HMS1001)", () => {
  const code = `Basin: Test
  Unit System: Metric
End:

Subbasin: BadArea
  Area: -5.0
End:
`;
  const basin = parseHmsBasin(code);
  const diags = lintHmsBasin(basin);
  assert.ok(diags.some((d) => d.code === HmsErrorCode.INVALID_AREA));
});

test("HEC-HMS Linter: detects unknown downstream element reference (HMS2001)", () => {
  const code = `Basin: Test
  Unit System: Metric
End:

Subbasin: DisconnectedSub
  Area: 10.0
  Downstream: NonexistentReach
End:
`;
  const basin = parseHmsBasin(code);
  const diags = lintHmsBasin(basin);
  assert.ok(diags.some((d) => d.code === HmsErrorCode.UNKNOWN_DOWNSTREAM));
});

test("HEC-HMS Linter: detects topological drainage cycle (HMS2002)", () => {
  const code = `Basin: LoopBasin
  Unit System: Metric
End:

Reach: R1
  Downstream: R2
End:

Reach: R2
  Downstream: R1
End:
`;
  const basin = parseHmsBasin(code);
  const diags = lintHmsBasin(basin);
  assert.ok(diags.some((d) => d.code === HmsErrorCode.TOPOLOGICAL_CYCLE));
});

test("HEC-HMS Linter: detects invalid Curve Number (HMS3001)", () => {
  const code = `Basin: Test
  Unit System: Metric
End:

Subbasin: HighCN
  Area: 10.0
  Loss: SCS
End:

Subbasin-Loss: HighCN
  Curve Number: 105.0
End:
`;
  const basin = parseHmsBasin(code);
  const diags = lintHmsBasin(basin);
  assert.ok(diags.some((d) => d.code === HmsErrorCode.INVALID_CURVE_NUMBER));
});

test("HEC-HMS Linter: detects invalid Muskingum K and X parameters (HMS3002, HMS3003)", () => {
  const code = `Basin: Test
  Unit System: Metric
End:

Reach: BadReach
  Route: Muskingum
End:

Reach-Route: BadReach
  Muskingum K: -1.5
  Muskingum X: 0.8
End:
`;
  const basin = parseHmsBasin(code);
  const diags = lintHmsBasin(basin);
  assert.ok(diags.some((d) => d.code === HmsErrorCode.INVALID_MUSKINGUM_K));
  assert.ok(diags.some((d) => d.code === HmsErrorCode.INVALID_MUSKINGUM_X));
});
