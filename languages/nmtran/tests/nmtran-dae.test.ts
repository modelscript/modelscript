// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseNmtran, lowerNmtranToDae } from "../src/index.js";
import { TWO_CMT_ORAL_CTL_BENCHMARK } from "./nmtran-benchmark-runner.js";

test("NMTRAN DAE: compiles $THETA, $PK, and compartment ODEs to square DAEBuilder", () => {
  const doc = parseNmtran(TWO_CMT_ORAL_CTL_BENCHMARK);
  const dae = lowerNmtranToDae(doc);

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 14);
  assert.equal(varCount, eqCount);

  assert.notEqual(dae.lookupVariable("THETA_1"), -1);
  assert.notEqual(dae.lookupVariable("CL"), -1);
  assert.notEqual(dae.lookupVariable("A_1"), -1);
  assert.notEqual(dae.lookupVariable("A_2"), -1);
});
