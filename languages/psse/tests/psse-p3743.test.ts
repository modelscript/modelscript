// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { parseRaw, parseSeq, psseToP3743Boundaries } from "../src/index.js";

test("PSS/E .raw + .seq exports IEEE P3743 boundary equivalents", () => {
  const raw = [
    "0, 100.00, 33, 0, 1, 60.00",
    "TEST 2-BUS CASE",
    "ERCOT",
    "1,'GEN_BUS     ', 138.0000,3,   1,   1,   1,1.02000,   0.0000",
    "2,'POI_BUS     ', 138.0000,1,   1,   1,   1,1.00000,  -2.0000",
    "0 / END OF BUS DATA",
    "0 / END OF LOAD DATA",
    "0 / END OF FIXED SHUNT DATA",
    "1,'1 ', 100.0,   0.0,  50.0, -50.0,1.0200,   0,  100.0, 0.0, 0.15, 0.0, 0.0, 1.0,1,100.0, 120.0, 0.0",
    "0 / END OF GENERATOR DATA",
    "1,   2,'1 ', 0.01000, 0.08000, 0.02000,  200.00,  200.00,  200.00, 0,0,0,0,1,1,100.0",
    "0 / END OF BRANCH DATA",
    "0 / END OF TRANSFORMER DATA",
    "Q",
  ].join("\n");

  const seq = [
    "1,'1 ', 0.005, 0.120, 0.005, 0.120, 0.005, 0.080",
    "0 / END OF GENERATOR SEQUENCE DATA",
    "1, 2,'1 ', 0.025, 0.220, 0.010",
    "0 / END OF BRANCH SEQUENCE DATA",
    "Q",
  ].join("\n");

  const psseCase = parseRaw(raw);
  psseCase.seq = parseSeq(seq);

  const boundaries = psseToP3743Boundaries(psseCase, [2]);
  assert.strictEqual(boundaries.length, 1);
  const b = boundaries[0]!;
  assert.strictEqual(b.busId, "BUS_2");
  assert.strictEqual(b.sourceTool, "psse-seq");
  assert.ok(b.shortCircuitMva > 0);
  assert.ok(b.z1Ohm.x > 0);
  assert.ok(b.z0Ohm.x > 0);
});
