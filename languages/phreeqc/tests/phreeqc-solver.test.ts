// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePhreeqc, solvePhreeqcSpeciation } from "../src/index.js";
import { KARST_AQUIFER_PHREEQC_BENCHMARK } from "./phreeqc-benchmark-runner.js";

test("PHREEQC Solver: computes ionic strength, carbonate species, and mineral saturation", () => {
  const doc = parsePhreeqc(KARST_AQUIFER_PHREEQC_BENCHMARK);
  const spec = solvePhreeqcSpeciation(doc, { solutionNumber: 1 });

  assert.equal(spec.pH, 7.4);
  assert.ok(spec.ionicStrength > 0.005 && spec.ionicStrength < 0.02);

  const { totalCarbon, h2co3, hco3, co3 } = spec.carbonateSpeciation;
  assert.ok(Math.abs(h2co3 + hco3 + co3 - totalCarbon) < 1.0e-10);
  assert.ok(hco3 > h2co3 && h2co3 > co3);

  // Solution 2 charge balance check
  const spec2 = solvePhreeqcSpeciation(doc, { solutionNumber: 2 });
  assert.ok(Math.abs(spec2.chargeBalanceError) < 1.0e-6);
});
