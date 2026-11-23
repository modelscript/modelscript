// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { parseMolfileDocument } from "../src/parser/molfile-parser.js";
import { molfileToPdb, molfileToSmiles, molRecordToSmiles } from "../src/projections/index.js";

describe("Molfile Cross-Language Projections (SMILES & PDB)", () => {
  it("projects Ethanol, Benzene, and Aspirin Molfiles to valid SMILES", () => {
    const ethanolDoc = parseMolfileDocument(CANONICAL_MOLFILES.Ethanol);
    assert.strictEqual(molRecordToSmiles(ethanolDoc.records[0]!), "CCO");

    const benzeneDoc = parseMolfileDocument(CANONICAL_MOLFILES.Benzene);
    const benzeneSmi = molRecordToSmiles(benzeneDoc.records[0]!);
    assert.strictEqual(benzeneSmi, "c1ccccc1");

    const aspirinDoc = parseMolfileDocument(CANONICAL_MOLFILES.Aspirin);
    const aspirinLine = molfileToSmiles(aspirinDoc);
    assert.ok(aspirinLine.endsWith(" Aspirin"));
    assert.ok(aspirinLine.includes("=O"));
    assert.ok(aspirinLine.includes("1"));
  });

  it("projects single-record Molfile to fixed-width PDB with HEADER, TITLE, HETATM, CONECT, and END", () => {
    const doc = parseMolfileDocument(CANONICAL_MOLFILES.Benzene);
    const pdb = molfileToPdb(doc, { residueName: "BNZ", chainId: "B" });

    assert.ok(pdb.includes("HEADER"));
    assert.ok(pdb.includes("TITLE     BENZENE"));
    assert.ok(pdb.includes("HETATM    1  C1  BNZ B   1"));
    assert.ok(pdb.includes("CONECT    1    2    6"));
    assert.ok(pdb.trimEnd().endsWith("END"));
  });

  it("projects multi-record SDF to multi-MODEL PDB", () => {
    const sdf = `${CANONICAL_MOLFILES.Water}\n$$$$\n${CANONICAL_MOLFILES.Ethanol}\n$$$$`;
    const doc = parseMolfileDocument(sdf, "multi.sdf");
    const pdb = molfileToPdb(doc);

    assert.ok(pdb.includes("MODEL        1"));
    assert.ok(pdb.includes("MODEL        2"));
    assert.ok(pdb.includes("ENDMDL"));
    assert.ok(pdb.trimEnd().endsWith("END"));
  });
});
