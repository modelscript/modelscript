// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGproms, lowerGpromsToDae } from "../src/index.js";
import { AXIAL_DISPERSION_PFR_BENCHMARK } from "./gproms-benchmark-runner.js";

test("gPROMS DAE: lowers distributed 1D tubular reactor into structurally square DAEBuilder", () => {
  const doc = parseGproms(AXIAL_DISPERSION_PFR_BENCHMARK);
  const dae = lowerGpromsToDae(doc);

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 10);
  assert.equal(varCount, eqCount);
});
