// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runPhreeqcBenchmark } from "./phreeqc-benchmark-runner.js";

test("PHREEQC Benchmark: karst aquifer speciation, calcite kinetics, and DAE lowering", () => {
  const m = runPhreeqcBenchmark();

  assert.equal(m.title, "Limestone Aquifer Speciation & Calcite Kinetics");
  assert.equal(m.solutionsCount, 2);
  assert.equal(m.equilibriumPhasesCount, 2);
  assert.equal(m.reactionsCount, 1);
  assert.equal(m.kineticsCount, 1);
  assert.ok(m.ionicStrength > 0.005 && m.ionicStrength < 0.02);
  assert.ok(m.gammaHco3 > 0.8 && m.gammaHco3 < 0.98);
  assert.ok(m.gammaCo3 > 0.5 && m.gammaCo3 < 0.85);
  assert.ok(m.siGypsum < 0.0);
  assert.ok(m.daeVarCount >= 18);
  assert.equal(m.daeVarCount, m.daeEqCount);
  assert.equal(m.isSquare, true);
});
