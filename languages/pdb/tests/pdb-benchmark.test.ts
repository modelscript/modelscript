// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runPdbBenchmark } from "./pdb-benchmark-runner.js";

test("PDB Benchmark: alpha-helical polypeptide biophysics, GNM, and DAE lowering", () => {
  const m = runPdbBenchmark();

  assert.equal(m.structureId, "1HLX");
  assert.equal(m.format, "pdb");
  assert.equal(m.atomCount, 22);
  assert.equal(m.residueCount, 5);
  assert.equal(m.chainCount, 1);
  assert.ok(m.molecularWeightDa > 250.0 && m.molecularWeightDa < 600.0);
  assert.ok(m.radiusOfGyration > 2.0 && m.radiusOfGyration < 8.0);
  assert.equal(m.disulfideBondsCount, 1);
  assert.equal(m.kirchhoffDim, 5);
  assert.equal(m.daeVarCount, 65);
  assert.equal(m.daeEqCount, 65);
  assert.equal(m.isSquare, true);
});
