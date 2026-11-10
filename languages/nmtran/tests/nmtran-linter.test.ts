// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseNmtran, lintNmtran, NmtranErrorCode } from "../src/index.js";
import { TWO_CMT_ORAL_CTL_BENCHMARK } from "./nmtran-benchmark-runner.js";

test("NMTRAN Linter: valid control stream produces zero diagnostics", () => {
  const diags = lintNmtran(parseNmtran(TWO_CMT_ORAL_CTL_BENCHMARK));
  assert.equal(diags.length, 0);
});

test("NMTRAN Linter: flags missing problem record and undefined THETA reference", () => {
  const noProblem = parseNmtran(`$SUBROUTINES ADVAN1\n$PK\nCL = 5.0\n$ERROR\nY = F`);
  const diags1 = lintNmtran(noProblem);
  assert.ok(diags1.some((d) => d.code === NmtranErrorCode.MISSING_PROBLEM_RECORD.code));

  const badTheta = parseNmtran(`$PROBLEM Bad\n$SUBROUTINES ADVAN1 TRANS2\n$PK\nCL = THETA(5)\nV = 10\n$ERROR\nY = F\n$THETA 5.0`);
  const diags2 = lintNmtran(badTheta);
  assert.ok(diags2.some((d) => d.code === NmtranErrorCode.UNDEFINED_THETA_REFERENCE.code));
});
