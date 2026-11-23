// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_CIF_TEMPLATES } from "../src/catalog/iucr-cif-std-schemas.js";
import { cifToMolfile, cifToPdb, cifToXyz } from "../src/projections/index.js";

describe("IUCr CIF Structural Projections (PDB, XYZ, MDL Molfile)", () => {
  it("projects Silicon CIF to valid RCSB PDB with CRYST1, HETATM, CONECT, and END", () => {
    const pdb = cifToPdb(CANONICAL_CIF_TEMPLATES.silicon);
    assert.ok(pdb.includes("HEADER"));
    assert.ok(pdb.includes("CRYST1"));
    assert.ok(pdb.includes("5.431"));
    const hetatmLines = pdb.split("\n").filter((l) => l.startsWith("HETATM"));
    assert.equal(hetatmLines.length, 8);
    assert.ok(pdb.includes("CONECT"));
    assert.ok(pdb.trimEnd().endsWith("END"));
  });

  it("projects Silicon CIF to extended Cartesian XYZ format", () => {
    const xyz = cifToXyz(CANONICAL_CIF_TEMPLATES.silicon);
    const lines = xyz.trim().split("\n");
    assert.equal(lines[0], "8");
    assert.ok(lines[1]!.includes("Lattice="));
    assert.equal(lines.length, 10); // count + comment + 8 atoms
  });

  it("projects Silicon CIF to MDL Molfile V2000 format", () => {
    const mol = cifToMolfile(CANONICAL_CIF_TEMPLATES.silicon);
    assert.ok(mol.includes("V2000"));
    assert.ok(mol.includes("Si "));
    assert.ok(mol.trimEnd().endsWith("M  END"));
  });
});
