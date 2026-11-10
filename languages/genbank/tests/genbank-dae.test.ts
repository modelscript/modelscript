// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGenbank, lowerGenbankToDae } from "../src/index.js";
import { PGFP_MINI_GENBANK_BENCHMARK } from "./genbank-benchmark-runner.js";

test("GenBank DAE: compiles expressed coding sequences to structurally square DAEBuilder", () => {
  const doc = parseGenbank(PGFP_MINI_GENBANK_BENCHMARK);
  const dae = lowerGenbankToDae(doc, { modelName: "pGFP_Mini_DAE" });

  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 1 shared copy_number + 6 variables per expressed CDS (mRNA, Protein, k_tx, k_tl, gamma_m, gamma_p) = 7 variables & 7 equations
  assert.equal(varCount, 7);
  assert.equal(eqCount, 7);
  assert.equal(varCount, eqCount);

  assert.notEqual(dae.lookupVariable("copy_number"), -1);
  assert.notEqual(dae.lookupVariable("mRNA_gfp_mini"), -1);
  assert.notEqual(dae.lookupVariable("Protein_gfp_mini"), -1);
});
