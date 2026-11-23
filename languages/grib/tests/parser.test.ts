// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGribDescriptor, parseGribDescriptor } from "../src/parser/text-parser.js";

const SAMPLE_GRIB_TEXT = `
# Synoptic 500 hPa Temperature & Geopotential Height
GRIB edition=1
  IS {
    edition = 1
  }
  PDS {
    tableVersion = 2
    center = 7
    parameter = TMP
    levelType = ISBL
    level = 500
    date = "2026-01-15T12:00"
    decimalScale = 1
  }
  GDS {
    gridType = 0
    ni = 3
    nj = 2
    la1 = 60.0
    lo1 = -100.0
    la2 = 40.0
    lo2 = -60.0
    di = 20.0
    dj = 20.0
  }
  BDS {
    bitsPerValue = 16
    binaryScale = 0
    referenceValue = 240.0
    values = [245.2, 246.8, 248.1, 252.0, 253.5, 255.4]
  }
7777
`;

describe("GRIB1 Textual Descriptor Parser", () => {
  it("parses a complete GRIB1 descriptor with IS, PDS, GDS, BDS, and 7777", () => {
    const doc = parseGribDescriptor(SAMPLE_GRIB_TEXT, "synoptic.grib");
    assert.equal(doc.isBinary, false);
    assert.equal(doc.syntaxErrors.length, 0);
    assert.equal(doc.messages.length, 1);

    const msg = doc.messages[0]!;
    assert.equal(msg.indicator.magic, "GRIB");
    assert.equal(msg.indicator.edition, 1);
    assert.equal(msg.end.present, true);
    assert.equal(msg.end.magic, "7777");

    assert.ok(msg.pds);
    assert.equal(msg.pds.parameterCode, 11);
    assert.equal(msg.pds.parameterName, "TMP");
    assert.equal(msg.pds.levelType, 100);
    assert.equal(msg.pds.levelValue, 500);
    assert.equal(msg.pds.year, 2026);
    assert.equal(msg.pds.month, 1);
    assert.equal(msg.pds.day, 15);
    assert.equal(msg.pds.hour, 12);
    assert.equal(msg.pds.decimalScaleFactor, 1);

    assert.ok(msg.gds);
    assert.equal(msg.gds.ni, 3);
    assert.equal(msg.gds.nj, 2);
    assert.equal(msg.gds.la1, 60);
    assert.equal(msg.gds.lo1, -100);
    assert.equal(msg.gds.la2, 40);
    assert.equal(msg.gds.lo2, -60);

    assert.ok(msg.bds);
    assert.equal(msg.bds.bitsPerValue, 16);
    assert.deepEqual(msg.bds.values, [245.2, 246.8, 248.1, 252.0, 253.5, 255.4]);
  });

  it("unpacks packedValues automatically via Y = (R + X * 2^E) * 10^(-D)", () => {
    const src = `
GRIB edition=1
  PDS { parameter = PRMSL, levelType = MSL, level = 0, date = "2026-02-01T00:00", decimalScale = 1 }
  GDS { ni = 2, nj = 2, la1 = 50, lo1 = -10, la2 = 40, lo2 = 0, di = 10, dj = 10 }
  BDS { bitsPerValue = 12, binaryScale = 2, referenceValue = 1000000, packedValues = [0, 100, 200, 300] }
7777
`;
    const doc = parseGribDescriptor(src);
    const vals = doc.messages[0]!.bds!.values;
    assert.equal(vals.length, 4);
    assert.ok(Math.abs(vals[0]! - 100000.0) < 1e-9);
    assert.ok(Math.abs(vals[1]! - 100040.0) < 1e-9);
    assert.ok(Math.abs(vals[2]! - 100080.0) < 1e-9);
    assert.ok(Math.abs(vals[3]! - 100120.0) < 1e-9);
  });

  it("round-trips through formatGribDescriptor and supports multi-message files", () => {
    const multi = SAMPLE_GRIB_TEXT + "\n" + SAMPLE_GRIB_TEXT.replace("parameter = TMP", "parameter = HGT");
    const doc1 = parseGribDescriptor(multi);
    assert.equal(doc1.messages.length, 2);
    assert.equal(doc1.messages[1]!.pds!.parameterCode, 7);

    const formatted = formatGribDescriptor(doc1);
    const doc2 = parseGribDescriptor(formatted);
    assert.equal(doc2.messages.length, 2);
    assert.equal(doc2.syntaxErrors.length, 0);
    assert.deepEqual(doc2.messages[0]!.bds!.values, doc1.messages[0]!.bds!.values);
  });
});
