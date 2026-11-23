// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gaussianToMolfile, gaussianToPdb, gaussianToXyz, parseGaussianInput } from "../src/index.js";

describe("@modelscript/gaussian — Chemical Format Projections (XYZ, MDL Molfile, PDB)", () => {
  const waterWithDummyGjf = `# B3LYP/6-31G(d) opt

Water with Dummy Atom

0 1
O
X 1 1.0
H 1 0.9572 2 52.26
H 1 0.9572 2 52.26 3 180.0
`;

  it("projects Z-matrix geometry to XYZ format, omitting dummy atoms", () => {
    const job = parseGaussianInput(waterWithDummyGjf).jobs[0]!;
    const xyz = gaussianToXyz(job);
    const lines = xyz.trim().split("\n");

    assert.equal(lines[0], "3", "Dummy atom X must be excluded from XYZ atom count");
    assert.equal(lines[1], "Water with Dummy Atom");
    assert.equal(lines.length, 5);
    assert.ok(lines[2]!.startsWith("O"));
    assert.ok(lines[3]!.startsWith("H"));
    assert.ok(lines[4]!.startsWith("H"));
  });

  it("projects Z-matrix geometry to MDL Molfile V2000 with covalent bond perception", () => {
    const job = parseGaussianInput(waterWithDummyGjf).jobs[0]!;
    const mol = gaussianToMolfile(job);
    const lines = mol.trim().split("\n");

    assert.equal(lines[0], "Water with Dummy Atom");
    assert.ok(lines[3]!.includes("V2000"), "Expected V2000 counts line");
    assert.ok(lines[3]!.startsWith("  3  2"), `Expected 3 atoms and 2 O-H bonds, got: ${lines[3]}`);
    assert.equal(lines[lines.length - 1], "M  END");
  });

  it("projects Z-matrix geometry to PDB format with HETATM and CONECT records", () => {
    const job = parseGaussianInput(waterWithDummyGjf).jobs[0]!;
    const pdb = gaussianToPdb(job);
    const lines = pdb.trim().split("\n");

    assert.ok(lines[0]!.startsWith("TITLE     Water with Dummy Atom"));
    const hetatms = lines.filter((l) => l.startsWith("HETATM"));
    const conects = lines.filter((l) => l.startsWith("CONECT"));
    assert.equal(hetatms.length, 3);
    assert.ok(conects.length >= 3, "Expected CONECT records for bonded atoms");
    assert.equal(lines[lines.length - 1], "END");
  });
});
