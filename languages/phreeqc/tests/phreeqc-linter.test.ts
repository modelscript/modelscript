// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePhreeqc, lintPhreeqc, PhreeqcErrorCode } from "../src/index.js";
import { KARST_AQUIFER_PHREEQC_BENCHMARK } from "./phreeqc-benchmark-runner.js";

test("PHREEQC Linter: clean geochemical deck produces zero diagnostics", () => {
  const diags = lintPhreeqc(parsePhreeqc(KARST_AQUIFER_PHREEQC_BENCHMARK));
  assert.equal(diags.length, 0);
});

test("PHREEQC Linter: flags non-physical pH and empty deck", () => {
  const badPhDeck = `SOLUTION 1 Bad
    temp 25.0
    pH 18.0
    Ca 2.0
END`;
  const diags = lintPhreeqc(parsePhreeqc(badPhDeck));
  assert.ok(diags.some((d) => d.code === PhreeqcErrorCode.PH_OUT_OF_PHYSICAL_BOUNDS.code));

  const emptyDiags = lintPhreeqc(parsePhreeqc("# comment only\nEND"));
  assert.ok(emptyDiags.some((d) => d.code === PhreeqcErrorCode.EMPTY_PHREEQC_DECK.code));
});
