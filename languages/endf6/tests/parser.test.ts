// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import {
  formatEndfCard,
  formatEndfFloat,
  parseEndf6Card,
  parseEndf6Tape,
  parseEndfFloat,
  parseEndfInt,
  readContRecord,
  readHeadRecord,
  readListRecord,
  readTab1Record,
  zaToNuclideName,
} from "../src/parser/index.js";

describe("ENDF-6 11-char Float & Card Parser", () => {
  it("parses exponent-omitted ENDF-6 floats, Fortran E/D floats, and blanks", () => {
    assert.equal(parseEndfFloat(" 9.223500+4"), 92235);
    assert.equal(parseEndfFloat(" 2.330250+2"), 233.025);
    assert.equal(parseEndfFloat("-1.234567-5"), -1.234567e-5);
    assert.equal(parseEndfFloat(" 2.530000-2"), 0.0253);
    assert.equal(parseEndfFloat(" 1.0000E+05"), 1e5);
    assert.equal(parseEndfFloat(" 3.5000D-03"), 3.5e-3);
    assert.equal(parseEndfFloat("           "), 0);
    assert.ok(Number.isNaN(parseEndfFloat(" NOT_A_NUM ")));
  });

  it("formats canonical 11-character ENDF-6 floats and round-trips", () => {
    const samples = [0, 1.0, 92235, 0.0253, -1.5e-12, 2.0e7, 9.9999999e4];
    for (const val of samples) {
      const formatted = formatEndfFloat(val);
      assert.equal(formatted.length, 11, `Expected 11 chars for ${val}, got '${formatted}'`);
      const parsed = parseEndfFloat(formatted);
      if (val === 0) {
        assert.equal(parsed, 0);
      } else {
        assert.ok(Math.abs((parsed - val) / val) < 1e-5, `Round-trip mismatch for ${val}: ${parsed}`);
      }
    }
  });

  it("parses 80-column card control fields (MAT, MF, MT, NS) and terminators", () => {
    const sendCard = parseEndf6Card(
      formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 0 }, { int: 0 }], 9228, 3, 0, 99999),
      10,
    );
    assert.equal(sendCard.mat, 9228);
    assert.equal(sendCard.mf, 3);
    assert.equal(sendCard.mt, 0);
    assert.equal(sendCard.ns, 99999);
    assert.equal(sendCard.terminator, "SEND");

    const fendCard = parseEndf6Card(formatEndfCard([], 9228, 0, 0, 0), 11);
    assert.equal(fendCard.terminator, "FEND");

    const mendCard = parseEndf6Card(formatEndfCard([], 0, 0, 0, 0), 12);
    assert.equal(mendCard.terminator, "MEND");

    const tendCard = parseEndf6Card(formatEndfCard([], -1, 0, 0, 0), 13);
    assert.equal(tendCard.terminator, "TEND");
  });

  it("decodes HEAD, CONT, LIST, and TAB1 records accurately", () => {
    const head = readHeadRecord(
      parseEndf6Card(
        formatEndfCard([92235, 233.025, { int: 1 }, { int: 1 }, { int: 0 }, { int: 1 }], 9228, 1, 451, 1),
        1,
      ),
    );
    assert.equal(head.za, 92235);
    assert.ok(Math.abs(head.awr - 233.025) < 1e-3);
    assert.equal(zaToNuclideName(head.za), "U-235");

    const cont = readContRecord(
      parseEndf6Card(formatEndfCard([1e-5, 1e3, { int: 1 }, { int: 2 }, { int: 3 }, { int: 4 }], 9228, 2, 151, 2), 2),
    );
    assert.equal(cont.c1, 1e-5);
    assert.equal(cont.c2, 1e3);
    assert.equal(cont.l1, 1);
    assert.equal(cont.l2, 2);
    assert.equal(cont.n1, 3);
    assert.equal(cont.n2, 4);

    const listCards = [
      parseEndf6Card(formatEndfCard([233.025, 0, { int: 0 }, { int: 0 }, { int: 6 }, { int: 1 }], 9228, 2, 151, 3), 3),
      parseEndf6Card(formatEndfCard([0.273, 3.0, 0.143, 3.4e-6, 0.038, 0.105], 9228, 2, 151, 4), 4),
    ];
    const { record: listRec, nextCursor: listNext } = readListRecord(listCards, 0);
    assert.equal(listNext, 2);
    assert.equal(listRec.npl, 6);
    assert.equal(listRec.values.length, 6);
    assert.ok(Math.abs(listRec.values[0]! - 0.273) < 1e-5);

    const tab1Cards = [
      parseEndf6Card(formatEndfCard([0, 0, { int: 0 }, { int: 0 }, { int: 1 }, { int: 3 }], 9228, 3, 102, 1), 1),
      parseEndf6Card(formatEndfCard([{ int: 3 }, { int: 5 }], 9228, 3, 102, 2), 2),
      parseEndf6Card(formatEndfCard([1e-5, 5000, 0.0253, 98.7, 1.0, 15.7], 9228, 3, 102, 3), 3),
    ];
    const { record: tab1, nextCursor: tabNext } = readTab1Record(tab1Cards, 0);
    assert.equal(tabNext, 3);
    assert.equal(tab1.nr, 1);
    assert.equal(tab1.np, 3);
    assert.equal(tab1.regions[0]!.interp, 5);
    assert.equal(tab1.points.length, 3);
    assert.ok(Math.abs(tab1.points[1]!.y - 98.7) < 1e-3);
    assert.equal(parseEndfInt("   9228"), 9228);
  });

  it("parses a full U-235 ENDF-6 tape with MF=1, MF=2, MF=3, MF=8 and terminators", () => {
    const raw = generateReferenceEndf6Tape("U-235");
    const tape = parseEndf6Tape(raw);

    assert.equal(tape.parseErrors.length, 0);
    assert.equal(tape.hasTend, true);
    assert.ok(tape.tpid.includes("Uranium-235"));

    const mat = tape.materials.get(9228);
    assert.ok(mat, "Expected MAT=9228 (U-235)");
    assert.equal(mat.name, "U-235");
    assert.equal(mat.za, 92235);
    assert.equal(mat.hasMend, true);
    assert.ok(mat.description);
    assert.ok(mat.description.textLines.length >= 2);
    assert.ok(mat.description.directory.length >= 4);
    assert.equal(mat.resonances.length, 1);
    assert.equal(mat.resonances[0]!.resonances.length, 1);
    assert.ok(mat.crossSections.has(1));
    assert.ok(mat.crossSections.has(2));
    assert.ok(mat.crossSections.has(18));
    assert.ok(mat.crossSections.has(102));
    assert.ok(mat.decay);
    assert.equal(mat.decay.nst, 0);
    assert.ok(mat.decay.halfLife > 1e16);
  });
});
