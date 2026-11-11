// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseMlxtran, solveMlxtranPk } from "../src/index.js";

const ONE_CMT_ORAL = `
[LONGITUDINAL]
input = {ka, V, Cl}
EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac
Cc = Ac / V
OUTPUT:
output = {Cc}
`;

test("MLXTRAN Solver: simulates 1-compartment oral absorption and verifies AUC linearity with dose", () => {
  const doc = parseMlxtran(ONE_CMT_ORAL);

  const res100 = solveMlxtranPk(doc, {
    tEnd: 24.0,
    dt: 0.05,
    dose: 100.0,
    params: { ka: 1.0, v: 10.0, cl: 2.0 },
  });

  const res200 = solveMlxtranPk(doc, {
    tEnd: 24.0,
    dt: 0.05,
    dose: 200.0,
    params: { ka: 1.0, v: 10.0, cl: 2.0 },
  });

  assert.ok(res100.cmax > 0);
  assert.ok(res200.cmax > 0);

  // Dose linearity: AUC for 200 mg should be roughly 2x AUC for 100 mg
  const ratio = res200.auc / res100.auc;
  assert.ok(Math.abs(ratio - 2.0) < 0.05, `Expected AUC ratio ~2.0, got ${ratio}`);

  // Cmax ratio should also be ~2.0
  const cmaxRatio = res200.cmax / res100.cmax;
  assert.ok(Math.abs(cmaxRatio - 2.0) < 0.05, `Expected Cmax ratio ~2.0, got ${cmaxRatio}`);

  // Tmax should be identical for first-order linear PK
  assert.ok(Math.abs(res100.tmax - res200.tmax) < 0.1);
});
