// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePhreeqc, lowerPhreeqcToDae } from "../src/index.js";
import { KARST_AQUIFER_PHREEQC_BENCHMARK } from "./phreeqc-benchmark-runner.js";

test("PHREEQC DAE: compiles aqueous speciation and calcite kinetics to square DAEBuilder", () => {
  const doc = parsePhreeqc(KARST_AQUIFER_PHREEQC_BENCHMARK);
  const dae = lowerPhreeqcToDae(doc);

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 18);
  assert.equal(varCount, eqCount);

  assert.notEqual(dae.lookupVariable("I"), -1);
  assert.notEqual(dae.lookupVariable("m_HCO3"), -1);
  assert.notEqual(dae.lookupVariable("SI_Calcite"), -1);
  assert.notEqual(dae.lookupVariable("M_Calcite"), -1);
});
