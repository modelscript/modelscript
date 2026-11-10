// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSmiles, lintSmiles, SmilesErrorCode } from "../src/index.js";

test("SMILES Linter: validates clean structures produce 0 diagnostics", () => {
  for (const s of ["c1ccccc1", "CCO", "CC(=O)O", "CC(C)C"]) {
    const diags = lintSmiles(parseSmiles(s));
    assert.equal(diags.length, 0);
  }
});

test("SMILES Linter: flags invalid valence, unclosed rings, and syntax anomalies", () => {
  const unclosed = lintSmiles(parseSmiles("C1CCCCC"));
  assert.ok(unclosed.some((d) => d.code === SmilesErrorCode.UNCLOSED_RING_DIGIT.code));

  const pentavalent = lintSmiles(parseSmiles("CC(C)(C)(C)C"));
  assert.ok(pentavalent.some((d) => d.code === SmilesErrorCode.VALENCE_EXCEEDED.code));

  const selfLoop = lintSmiles(parseSmiles("C11"));
  assert.ok(selfLoop.some((d) => d.code === SmilesErrorCode.SELF_LOOP_BOND.code));
});
