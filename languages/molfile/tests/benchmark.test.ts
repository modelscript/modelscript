// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_MOLFILES } from "../src/catalog/molfile-std-schemas.js";
import { parseMolfileDocument } from "../src/parser/molfile-parser.js";
import { analyzeMolfileDocument, analyzeMolRecord, computeUffBondParams } from "../src/solver/analyzer.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

describe("Molfile Analytical Benchmarks (Aspirin, Benzene, Caffeine SDF)", () => {
  it("Aspirin (C9H8O4): exact Hill formula, IUPAC MW = 180.157, exact mass, and 1 SSSR ring", () => {
    const doc = parseMolfileDocument(CANONICAL_MOLFILES.Aspirin, "aspirin.mol");
    const analysis = analyzeMolRecord(doc.records[0]!);

    assert.strictEqual(analysis.formula, "C9H8O4");
    assert.strictEqual(analysis.heavyAtomCount, 13);
    assert.strictEqual(analysis.implicitHydrogenCount, 8);
    assert.strictEqual(analysis.ringCount, 1);
    assert.strictEqual(analysis.sssrRings[0]!.length, 6);

    const expectedMw = 180.157;
    const mwTolerance = 1e-4;
    const mwErr = relErr(analysis.molecularWeight, expectedMw);
    assert.ok(
      mwErr < mwTolerance,
      `Aspirin MW ${analysis.molecularWeight} deviated from ${expectedMw} (relErr=${mwErr} >= ${mwTolerance})`,
    );

    const expectedExactMass = 180.0422587;
    const exactTolerance = 1e-5;
    const exactErr = relErr(analysis.exactMass, expectedExactMass);
    assert.ok(
      exactErr < exactTolerance,
      `Aspirin exact mass ${analysis.exactMass} deviated from ${expectedExactMass} (relErr=${exactErr})`,
    );
  });

  it("Benzene (C6H6): 6-membered SSSR aromatic ring, 1.395 A C-C bond-length parity, 120 deg angles, and 0 deg dihedrals", () => {
    const doc = parseMolfileDocument(CANONICAL_MOLFILES.Benzene, "benzene.mol");
    const analysis = analyzeMolRecord(doc.records[0]!);

    assert.strictEqual(analysis.formula, "C6H6");
    assert.strictEqual(analysis.ringCount, 1);
    assert.strictEqual(analysis.sssrRings[0]!.length, 6);
    assert.strictEqual(analysis.aromaticAtomCount, 6);
    assert.strictEqual(analysis.bondGeometries.length, 6);

    const targetCC = 1.395;
    const lengthTolerance = 1e-3;
    for (const bg of analysis.bondGeometries) {
      const err = relErr(bg.length, targetCC);
      assert.ok(
        err < lengthTolerance,
        `Benzene C-C bond ${bg.bondIndex} length ${bg.length} != ${targetCC} (relErr=${err})`,
      );
    }

    const angleTolerance = 1e-3;
    assert.strictEqual(analysis.bondAngles.length, 6);
    for (const ang of analysis.bondAngles) {
      const err = relErr(ang.angleDeg, 120.0);
      assert.ok(err < angleTolerance, `Benzene angle ${ang.angleDeg} != 120 deg (relErr=${err})`);
    }

    assert.strictEqual(analysis.dihedrals.length, 6);
    for (const dih of analysis.dihedrals) {
      assert.ok(Math.abs(dih.dihedralDeg) < 1e-3, `Planar benzene dihedral should be ~0 deg, got ${dih.dihedralDeg}`);
    }
  });

  it("Caffeine SDF multi-record parsing, fused bicyclic SSSR (6+5 rings), and UFF harmonic bond-stretch energy parity", () => {
    const sdf = [
      CANONICAL_MOLFILES.Aspirin,
      "> <PUBCHEM_CID>",
      "2244",
      "",
      "$$$$",
      CANONICAL_MOLFILES.Benzene,
      "> <PUBCHEM_CID>",
      "241",
      "",
      "$$$$",
      CANONICAL_MOLFILES.Caffeine,
      "> <PUBCHEM_CID>",
      "2519",
      "",
      "> <COMMON_NAME>",
      "Caffeine",
      "",
      "$$$$",
    ].join("\n");

    const doc = parseMolfileDocument(sdf, "benchmark.sdf");
    assert.strictEqual(doc.format, "sdf");
    assert.strictEqual(doc.records.length, 3);

    const analyses = analyzeMolfileDocument(doc);
    const caffeine = analyses[2]!;

    assert.strictEqual(doc.records[2]!.dataItems["PUBCHEM_CID"], "2519");
    assert.strictEqual(caffeine.formula, "C8H10N4O2");
    assert.strictEqual(caffeine.ringCount, 2);

    const ringSizes = caffeine.sssrRings.map((r) => r.length).sort((a, b) => a - b);
    assert.deepStrictEqual(ringSizes, [5, 6]);

    const expectedCaffeineMw = 194.191;
    const mwTolerance = 1e-4;
    assert.ok(
      relErr(caffeine.molecularWeight, expectedCaffeineMw) < mwTolerance,
      `Caffeine MW ${caffeine.molecularWeight} != ${expectedCaffeineMw}`,
    );

    // Independent analytical verification of UFF harmonic bond-stretch energy sum
    let referenceEnergy = 0;
    for (const bg of caffeine.bondGeometries) {
      const { equilibriumLength, forceConstant } = computeUffBondParams(bg.element1, bg.element2, bg.order);
      const dr = bg.length - equilibriumLength;
      referenceEnergy += 0.5 * forceConstant * dr * dr;
    }

    const energyTolerance = 1e-9;
    assert.ok(caffeine.totalStretchEnergy > 0, "Expected positive harmonic stretch energy for Caffeine geometry");
    assert.ok(
      relErr(caffeine.totalStretchEnergy, referenceEnergy) < energyTolerance,
      `Caffeine stretch energy ${caffeine.totalStretchEnergy} != analytical reference ${referenceEnergy}`,
    );
  });
});
