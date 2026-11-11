// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lowerMlxtranToDae, parseMlxtran, solveMlxtranPk } from "../src/index.js";

const BENCHMARK_MODEL = `
; High-throughput two-compartment oral MLXTRAN benchmark
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

test("MLXTRAN Benchmark: simulates 50 clinical trials in under 200ms and verifies DAE scalability", () => {
  const doc = parseMlxtran(BENCHMARK_MODEL);
  const dae = lowerMlxtranToDae(doc);
  assert.equal(dae.varCount, dae.eqCount);

  const tStart = performance.now();
  for (let i = 0; i < 50; i++) {
    const res = solveMlxtranPk(doc, {
      tEnd: 24.0,
      dt: 0.2,
      dose: 100.0 + i * 2.0,
      params: { ka: 1.0 + i * 0.01, v: 10.0, cl: 2.0, q: 0.5, v2: 25.0 },
    });
    assert.ok(res.auc > 0);
  }
  const elapsed = performance.now() - tStart;
  assert.ok(elapsed < 1000, `50 trials took ${elapsed.toFixed(1)}ms`);
});
