// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerMlxtranToDae, parseMlxtran } from "../src/index.js";

const MLXTRAN_MODEL = `
[LONGITUDINAL]
input = {ka, V, Cl, Q, V2}

EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac - (Q / V) * Ac + (Q / V2) * Ap
ddt_Ap = (Q / V) * Ac - (Q / V2) * Ap
Cc = Ac / V

OUTPUT:
output = {Cc}
`;

test("MLXTRAN DAE: compiles input parameters, states, and compartment ODEs to square DAEBuilder", () => {
  const doc = parseMlxtran(MLXTRAN_MODEL);
  const dae = lowerMlxtranToDae(doc);

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 9);
  assert.equal(varCount, eqCount, "DAE must be structurally square");

  assert.notEqual(dae.lookupVariable("ka"), -1);
  assert.notEqual(dae.lookupVariable("V"), -1);
  assert.notEqual(dae.lookupVariable("Cl"), -1);
  assert.notEqual(dae.lookupVariable("Ad"), -1);
  assert.notEqual(dae.lookupVariable("Ac"), -1);
  assert.notEqual(dae.lookupVariable("Ap"), -1);
  assert.notEqual(dae.lookupVariable("Cc"), -1);
});
