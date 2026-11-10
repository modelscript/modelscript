// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGenbank, analyzeGenbankSequence, findRestrictionCutSites, computeCodonAdaptationIndex } from "../src/index.js";
import { PGFP_MINI_GENBANK_BENCHMARK } from "./genbank-benchmark-runner.js";

test("GenBank Solver: discovers ORFs, restriction sites, and computes CAI", () => {
  const doc = parseGenbank(PGFP_MINI_GENBANK_BENCHMARK);
  const res = analyzeGenbankSequence(doc, { minOrfLengthNt: 30 });

  assert.equal(res.length, 90);
  assert.ok(res.orfs.length >= 1);
  const gfpOrf = res.orfs.find((o) => o.proteinSequence === "MSKGEELFTGVVPIL");
  assert.ok(gfpOrf);

  const polyLinker = "ACTAGTCTGCAGGCGGCCGCGGTCTCNNNNNGAGACC";
  const polySites = findRestrictionCutSites(polyLinker, "linear");
  const polyEnzymes = polySites.map((s) => s.enzyme);
  assert.ok(polyEnzymes.includes("SpeI"));
  assert.ok(polyEnzymes.includes("PstI"));
  assert.ok(polyEnzymes.includes("NotI"));

  const cai = computeCodonAdaptationIndex("ATGTCTAAAGGTGAAGAACTGTTCACCGGTGTTGTTCCGATCCTGTAA");
  assert.ok(cai > 0.85);
});
