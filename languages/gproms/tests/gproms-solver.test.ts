// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGproms, solveGpromsProcess } from "../src/index.js";
import { AXIAL_DISPERSION_PFR_BENCHMARK } from "./gproms-benchmark-runner.js";

test("gPROMS Solver: evaluates Method-of-Lines spatial profile and boundary conditions", () => {
  const doc = parseGproms(AXIAL_DISPERSION_PFR_BENCHMARK);
  const sim = solveGpromsProcess(doc, { duration: 8.0, timeStep: 0.005 });

  const profile = sim.finalSpatialProfiles["C"];
  assert.ok(profile);
  assert.equal(profile.length, 11);
  assert.ok(Math.abs((profile[0] ?? 0) - 10.0) < 1e-6);

  const outletC = sim.finalStates["C"] ?? 0;
  assert.ok(outletC > 4.0 && outletC < 5.0);
});
