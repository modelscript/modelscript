// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSmiles, parseSmilesDocument, lowerSmilesToDae } from "../src/index.js";

test("SMILES DAE: compiles multi-species binary mixture to structurally square DAE arena", () => {
  const doc = parseSmilesDocument("c1ccccc1 Benzene\nCCO Ethanol");
  const dae = lowerSmilesToDae(doc, { temperature: 350.0, pressure: 1.01325 });

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 22);
  assert.equal(varCount, eqCount, "Expected structurally square DAE (N_vars == N_eqs)");

  assert.notEqual(dae.lookupVariable("T"), -1);
  assert.notEqual(dae.lookupVariable("P"), -1);
  assert.notEqual(dae.lookupVariable("MW_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Tc_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Pc_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Cp_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("Psat_Benzene"), -1);
  assert.notEqual(dae.lookupVariable("K_Ethanol"), -1);
});

test("SMILES DAE: compiles single complex pharmaceutical active ingredient (Aspirin)", () => {
  const aspirin = parseSmiles("CC(=O)Oc1ccccc1C(=O)O", "Aspirin");
  const dae = lowerSmilesToDae(aspirin, { temperature: 298.15, pressure: 1.0 });

  assert.equal(dae.varCount, 13);
  assert.equal(dae.eqCount, 13);
  assert.notEqual(dae.lookupVariable("MW_Aspirin"), -1);
  assert.notEqual(dae.lookupVariable("Tb_Aspirin"), -1);
  assert.notEqual(dae.lookupVariable("Psat_Aspirin"), -1);
});
