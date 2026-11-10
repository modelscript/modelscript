// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePdb, solveProteinBiophysics, computeDihedralAngle } from "../src/index.js";
import { ALPHA_HELIX_PDB_BENCHMARK } from "./pdb-benchmark-runner.js";

test("PDB Solver: computes 3D dihedral angles and GNM fluctuations", () => {
  const d90 = computeDihedralAngle(
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 1 },
  );
  assert.ok(Math.abs(d90 - 90.0) < 1e-6);

  const bio = solveProteinBiophysics(ALPHA_HELIX_PDB_BENCHMARK, {
    cutoffDistance: 7.0,
    springConstant: 1.0,
    temperature: 300.0,
  });

  assert.equal(bio.structureId, "1HLX");
  assert.equal(bio.atomCount, 22);
  assert.equal(bio.residueCount, 5);
  assert.ok(bio.molecularWeightDa > 250);
  assert.ok(bio.radiusOfGyration > 2.0);

  // Kirchhoff matrix properties: 5 x 5 symmetric, zero row sums
  assert.equal(bio.kirchhoffMatrix.length, 5);
  for (let i = 0; i < 5; i++) {
    const row = bio.kirchhoffMatrix[i]!;
    const rowSum = row.reduce((acc, v) => acc + v, 0.0);
    assert.ok(Math.abs(rowSum) < 1e-9);
  }
});
