// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseGproms, lintGproms, GpromsErrorCode } from "../src/index.js";
import { AXIAL_DISPERSION_PFR_BENCHMARK } from "./gproms-benchmark-runner.js";

test("gPROMS Linter: valid PFR model produces zero diagnostics", () => {
  const diags = lintGproms(parseGproms(AXIAL_DISPERSION_PFR_BENCHMARK));
  assert.equal(diags.length, 0);
});

test("gPROMS Linter: flags empty model and undeclared variable type", () => {
  const emptyDoc = parseGproms("MODEL Empty\nEND\n");
  const diags1 = lintGproms(emptyDoc);
  assert.ok(diags1.some((d) => d.code === GpromsErrorCode.EMPTY_GPROMS_MODEL.code));

  const badTypeDoc = parseGproms("MODEL BadType\nVARIABLE x AS GhostType\nEQUATION $x = 1.0;\nEND\n");
  const diags2 = lintGproms(badTypeDoc);
  assert.ok(diags2.some((d) => d.code === GpromsErrorCode.UNDECLARED_VARIABLE_TYPE.code));
});
