// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerPdbToDae } from "../src/index.js";
import { ALPHA_HELIX_PDB_BENCHMARK } from "./pdb-benchmark-runner.js";

test("PDB DAE: compiles C_alpha elastic network into structurally square DAEBuilder", () => {
  const dae = lowerPdbToDae(ALPHA_HELIX_PDB_BENCHMARK, {
    cutoffDistance: 7.0,
    springConstant: 1.5,
    damping: 0.4,
    temperature: 310.0,
  });

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 5 global parameters + 5 residues * 12 variables (3 x0 + 3 u + 3 v + 3 F) = 65 variables & 65 equations
  assert.equal(varCount, 65);
  assert.equal(eqCount, 65);
  assert.equal(varCount, eqCount);

  assert.notEqual(dae.lookupVariable("T"), -1);
  assert.notEqual(dae.lookupVariable("gamma"), -1);
  assert.notEqual(dae.lookupVariable("Rg"), -1);
  assert.notEqual(dae.lookupVariable("MW"), -1);
  assert.notEqual(dae.lookupVariable("ux_A_CYS1_1"), -1);
  assert.notEqual(dae.lookupVariable("Fx_A_CYS1_1"), -1);
});
