// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runBnglBenchmark } from "./bngl-benchmark-runner.js";

test("BNGL Benchmark: simulates EGFR signaling cascade with rule network expansion and DAE lowering", () => {
  const metrics = runBnglBenchmark();

  assert.equal(metrics.parametersCount, 14);
  assert.equal(metrics.moleculeTypesCount, 4);
  assert.equal(metrics.seedSpeciesCount, 4);
  assert.equal(metrics.reactionRulesCount, 6);
  assert.ok(metrics.expandedSpeciesCount >= 8);
  assert.ok(metrics.expandedReactionsCount >= 10);
  assert.ok(metrics.egfrConservationError < 1e-4);
  assert.ok(metrics.finalPhosphoEgfr > 5.0);
  assert.ok(metrics.finalGrb2Recruited > 1.0);
  assert.ok(metrics.daeVarCount >= 20);
  assert.equal(metrics.isSquare, true);
  assert.ok(metrics.modelicaLines > 20);
  assert.ok(metrics.sbmlXmlBytes > 500);
});
