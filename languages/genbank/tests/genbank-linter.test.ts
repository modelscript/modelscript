// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGenbank, lintGenbank, GenbankErrorCode } from "../src/index.js";
import { PGFP_MINI_GENBANK_BENCHMARK } from "./genbank-benchmark-runner.js";

test("GenBank Linter: valid expression plasmid produces zero diagnostics", () => {
  const diags = lintGenbank(parseGenbank(PGFP_MINI_GENBANK_BENCHMARK));
  assert.equal(diags.length, 0);
});

test("GenBank Linter: flags length mismatch and non-IUPAC sequence characters", () => {
  const mismatchGb = `LOCUS       pMismatch                250 bp    DNA     linear   SYN 04-NOV-2026
ORIGIN
        1 atggccattg taatgggccg ctgaaagggt gcccgatag
//`;
  const diags = lintGenbank(parseGenbank(mismatchGb));
  assert.ok(diags.some((d) => d.code === GenbankErrorCode.LOCUS_LENGTH_MISMATCH.code));

  const badCharGb = `LOCUS       pBadChar                  12 bp    DNA     linear   SYN 04-NOV-2026
ORIGIN
        1 atggcczttg ta
//`;
  const badCharDiags = lintGenbank(parseGenbank(badCharGb));
  assert.ok(badCharDiags.some((d) => d.code === GenbankErrorCode.INVALID_SEQUENCE_CHARACTER.code));
});
