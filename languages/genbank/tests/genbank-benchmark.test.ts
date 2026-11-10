// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runGenbankBenchmark } from "./genbank-benchmark-runner.js";

test("GenBank Benchmark: synthetic expression plasmid analysis and DAE lowering", () => {
  const m = runGenbankBenchmark();

  assert.equal(m.locus, "pGFP_Mini");
  assert.equal(m.lengthNt, 90);
  assert.equal(m.topology, "circular");
  assert.equal(m.moleculeType, "ds-DNA");
  assert.equal(m.featuresCount, 5);
  assert.ok(m.gcContent > 0.35 && m.gcContent < 0.55);
  assert.ok(m.meltingTemperatureC > 65.0 && m.meltingTemperatureC < 85.0);
  assert.ok(m.orfsCount >= 1);
  assert.ok(m.caiGfp > 0.85);
  assert.equal(m.restrictionCutsCount, 4);
  assert.equal(m.daeVarCount, 7);
  assert.equal(m.daeEqCount, 7);
  assert.equal(m.isSquare, true);
});
