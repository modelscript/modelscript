// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runNmtranBenchmark } from "./nmtran-benchmark-runner.js";

test("NMTRAN Benchmark: two-compartment oral PK study simulation and DAE lowering", () => {
  const m = runNmtranBenchmark();

  assert.equal(m.problem, "Two-Compartment Oral PK Study");
  assert.equal(m.advan, "ADVAN4");
  assert.equal(m.trans, "TRANS4");
  assert.equal(m.compartmentCount, 3);
  assert.ok(m.cMax > 0.0);
  assert.ok(m.tMax > 0.0);
  assert.ok(m.auc0ToInf > 0.0);
  assert.ok(m.daeVarCount >= 14);
  assert.equal(m.daeVarCount, m.daeEqCount);
  assert.equal(m.isSquare, true);
});
