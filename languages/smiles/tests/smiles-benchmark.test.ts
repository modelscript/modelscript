// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runSmilesBenchmark } from "./smiles-benchmark-runner.js";

test("SMILES Benchmark: Taxol polycyclic natural product cheminformatics & DAE lowering", () => {
  const m = runSmilesBenchmark();

  assert.equal(m.name, "Taxol");
  assert.equal(m.formula, "C47H51NO14");
  assert.ok(Math.abs(m.molecularWeight - 853.918) < 0.05);
  assert.equal(m.heavyAtomCount, 62);
  assert.equal(m.ringCount, 7);
  assert.equal(m.hBondDonors, 4);
  assert.equal(m.hBondAcceptors, 15);
  assert.ok(m.tpsa > 200.0 && m.tpsa < 250.0);
  assert.ok(m.Tb > 1500.0);
  assert.ok(m.Tc > m.Tb);
  assert.ok(m.Pc > 1.0 && m.Pc < 20.0);
  assert.equal(m.daeVarCount, 13);
  assert.equal(m.daeEqCount, 13);
  assert.equal(m.isSquare, true);
});
