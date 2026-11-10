// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseNmtran, solveNmtranPkPd } from "../src/index.js";
import { TWO_CMT_ORAL_CTL_BENCHMARK } from "./nmtran-benchmark-runner.js";

test("NMTRAN Solver: simulates 2-compartment oral absorption and verifies multi-dose boost", () => {
  const doc = parseNmtran(TWO_CMT_ORAL_CTL_BENCHMARK);
  const sim = solveNmtranPkPd(doc, { duration: 24.0, timeStep: 0.05 });

  assert.equal(sim.compartmentCount, 3);
  assert.ok(sim.metrics.cMax > 0.0);
  assert.ok(sim.metrics.tMax > 0.0);

  const cBeforeDose2 = sim.trajectory.find((p) => Math.abs(p.time - 11.5) < 1e-3)?.centralConcentration ?? 0;
  const cAfterDose2 = sim.trajectory.find((p) => Math.abs(p.time - 14.0) < 1e-3)?.centralConcentration ?? 0;
  assert.ok(cAfterDose2 > cBeforeDose2);
});
