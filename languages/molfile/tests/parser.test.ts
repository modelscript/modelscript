// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { parseMolfileDocument } from "../src/parser/molfile-parser.js";

describe("MDL Molfile V2000/V3000 & SDF Parser", () => {
  it("parses V2000 header, counts line, atom block, bond block, and M  END", () => {
    const doc = parseMolfileDocument(CANONICAL_MOLFILES.Water, "water.mol");
    assert.strictEqual(doc.format, "mol");
    assert.strictEqual(doc.records.length, 1);

    const rec = doc.records[0]!;
    assert.strictEqual(rec.name, "Water");
    assert.strictEqual(rec.header.dimensionCode, "3D");
    assert.strictEqual(rec.counts.version, "V2000");
    assert.strictEqual(rec.counts.atomCount, 3);
    assert.strictEqual(rec.counts.bondCount, 2);
    assert.strictEqual(rec.atoms.length, 3);
    assert.strictEqual(rec.bonds.length, 2);
    assert.strictEqual(rec.hasMEnd, true);
    assert.strictEqual(rec.atoms[0]!.element, "O");
    assert.strictEqual(rec.atoms[1]!.element, "H");
    assert.strictEqual(rec.bonds[0]!.atom1, 1);
    assert.strictEqual(rec.bonds[0]!.atom2, 2);
    assert.strictEqual(rec.bonds[0]!.order, 1);
  });

  it("applies V2000 M  CHG, M  ISO, and M  RAD property lines", () => {
    const mol = [
      "IsotopeRadicalIon",
      "  ModelScript         3D",
      "13C-methyl radical cation test",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  3  0  0  0  0  0  0  0  0  0  0",
      "    1.5200    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  1  0  0  0  0",
      "M  CHG  2   1   1   2  -1",
      "M  ISO  1   1  13",
      "M  RAD  1   2   2",
      "M  END",
    ].join("\n");

    const doc = parseMolfileDocument(mol);
    const rec = doc.records[0]!;
    assert.strictEqual(rec.atoms[0]!.charge, 1);
    assert.strictEqual(rec.atoms[1]!.charge, -1);
    assert.strictEqual(rec.atoms[0]!.isotope, 13);
    assert.strictEqual(rec.atoms[1]!.radical, 2);
    assert.strictEqual(rec.hasMEnd, true);
  });

  it("parses V3000 extended CTAB with BEGIN/END CTAB, ATOM, BOND, CHG, MASS, and CFG", () => {
    const v3000 = [
      "AmmoniumV3000",
      "  ModelScript         3D",
      "V3000 ammonium ion",
      "  0  0  0     0  0            999 V3000",
      "M  V30 BEGIN CTAB",
      "M  V30 COUNTS 5 4 0 0 0",
      "M  V30 BEGIN ATOM",
      "M  V30 1 N 0.0000 0.0000 0.0000 0 CHG=1 MASS=15",
      "M  V30 2 H 1.0100 0.0000 0.0000 0",
      "M  V30 3 H -0.3367 0.9522 0.0000 0",
      "M  V30 4 H -0.3367 -0.4761 0.8246 0",
      "M  V30 5 H -0.3367 -0.4761 -0.8246 0",
      "M  V30 END ATOM",
      "M  V30 BEGIN BOND",
      "M  V30 1 1 1 2 CFG=1",
      "M  V30 2 1 1 3",
      "M  V30 3 1 1 4 CFG=3",
      "M  V30 4 1 1 5",
      "M  V30 END BOND",
      "M  V30 END CTAB",
      "M  END",
    ].join("\n");

    const doc = parseMolfileDocument(v3000, "ammonium.mol");
    const rec = doc.records[0]!;
    assert.strictEqual(rec.counts.version, "V3000");
    assert.strictEqual(rec.counts.atomCount, 5);
    assert.strictEqual(rec.counts.bondCount, 4);
    assert.strictEqual(rec.atoms.length, 5);
    assert.strictEqual(rec.bonds.length, 4);
    assert.strictEqual(rec.atoms[0]!.element, "N");
    assert.strictEqual(rec.atoms[0]!.charge, 1);
    assert.strictEqual(rec.atoms[0]!.isotope, 15);
    assert.strictEqual(rec.bonds[0]!.stereo, 1);
    assert.strictEqual(rec.bonds[2]!.stereo, 6);
    assert.strictEqual(rec.hasMEnd, true);
  });

  it("parses multi-record SDF with > <TAG> data items and $$$$ delimiters", () => {
    const sdf = [
      CANONICAL_MOLFILES.Water,
      "> <CAS_RN>",
      "7732-18-5",
      "",
      "> <CATEGORY>",
      "Solvent",
      "",
      "$$$$",
      CANONICAL_MOLFILES.Ethanol,
      "> <CAS_RN>",
      "64-17-5",
      "",
      "> <NOTES>",
      "Primary alcohol",
      "Boiling point 78.37 C",
      "",
      "$$$$",
    ].join("\n");

    const doc = parseMolfileDocument(sdf, "solvents.sdf");
    assert.strictEqual(doc.format, "sdf");
    assert.strictEqual(doc.records.length, 2);
    assert.strictEqual(doc.records[0]!.name, "Water");
    assert.strictEqual(doc.records[0]!.dataItems["CAS_RN"], "7732-18-5");
    assert.strictEqual(doc.records[0]!.dataItems["CATEGORY"], "Solvent");
    assert.strictEqual(doc.records[1]!.name, "Ethanol");
    assert.strictEqual(doc.records[1]!.dataItems["CAS_RN"], "64-17-5");
    assert.strictEqual(doc.records[1]!.dataItems["NOTES"], "Primary alcohol\nBoiling point 78.37 C");
  });
});
