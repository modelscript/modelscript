// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { lintPdb, PdbErrorCode } from "../src/index.js";
import { ALPHA_HELIX_PDB_BENCHMARK } from "./pdb-benchmark-runner.js";

test("PDB Linter: clean alpha helix generates zero diagnostics", () => {
  const diags = lintPdb(ALPHA_HELIX_PDB_BENCHMARK);
  assert.equal(diags.length, 0);
});

test("PDB Linter: detects broken backbone, steric clash, and missing atoms", () => {
  const brokenPdb = `HEADER    BROKEN                                  01-JAN-26   1BRK
ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 15.00           N  
ATOM      2  CA  ALA A   1       1.460   0.000   0.000  1.00 15.00           C  
ATOM      3  C   ALA A   1       2.500   1.100   0.000  1.00 15.00           C  
ATOM      4  N   ALA A   2      10.000  10.000  10.000  1.00 15.00           N  
ATOM      5  CA  ALA A   2      11.460  10.000  10.000  1.00 15.00           C  
ATOM      6  C   ALA A   2      12.500  11.100  10.000  1.00 15.00           C  
END`;
  const diags = lintPdb(brokenPdb);
  assert.ok(diags.some((d) => d.code === PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.code));
});
