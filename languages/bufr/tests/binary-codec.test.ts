// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BitReader, BitWriter, decodeBufrBinary, encodeBufrBinary, parseBufrText } from "../src/index.js";

describe("@modelscript/bufr Binary Bit-Stream Codec (Ed. 3 & Ed. 4)", () => {
  it("packs and unpacks arbitrary bit-widths and missing values via BitWriter/BitReader", () => {
    const writer = new BitWriter();
    writer.writeBits(72, 7);
    writer.writeBits(493, 10);
    writer.writeAllOnes(12); // missing
    writer.writeString("KOAK", 32);
    const bytes = writer.finish();

    const reader = new BitReader(bytes);
    const r1 = reader.readBits(7);
    const r2 = reader.readBits(10);
    const r3 = reader.readBits(12);
    const r4 = reader.readString(32);

    assert.equal(r1.value, 72);
    assert.equal(r1.isMissing, false);
    assert.equal(r2.value, 493);
    assert.equal(r3.isMissing, true);
    assert.equal(r4, "KOAK");
  });

  it("round-trips BUFR Edition 4 SYNOP message with Table D 3-07-080", () => {
    const src = `
BUFR EDITION 4
SECTION 1
  CENTRE = 7
  SUBCENTRE = 1
  CATEGORY = 0
  VERSION = 38
  YEAR = 2026
  MONTH = 6
  DAY = 15
  HOUR = 12
  MINUTE = 30
  SECOND = 0
SECTION 3
  SUBSETS = 1
  3-07-080
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-01-002 = 493
    0-04-001 = 2026
    0-04-002 = 6
    0-04-003 = 15
    0-04-004 = 12
    0-04-005 = 30
    0-05-001 = 37.75000
    0-06-001 = -122.22000
    0-07-001 = 3
    0-10-004 = 101320
    0-10-051 = 101350
    0-12-101 = 291.15
    0-12-103 = 285.15
    0-13-003 = 68
    0-11-001 = 270
    0-11-002 = 6.5
    0-13-011 = 1.2
7777
`;
    const orig = parseBufrText(src);
    const encoded = encodeBufrBinary(orig);

    // Check BUFR magic and 7777 trailer
    assert.equal(String.fromCharCode(...encoded.slice(0, 4)), "BUFR");
    assert.equal(encoded[7], 4);
    assert.equal(String.fromCharCode(...encoded.slice(encoded.length - 4)), "7777");

    const decoded = decodeBufrBinary(encoded);
    assert.equal(decoded.section0.edition, 4);
    assert.equal(decoded.hasEndMarker, true);
    assert.equal(decoded.section1.year, 2026);
    assert.equal(decoded.subsets.length, 1);
    assert.equal(decoded.subsets[0]?.values.length, 18);

    const lat = decoded.subsets[0]?.values.find((v) => v.descriptor === "0-05-001")?.value as number;
    const lon = decoded.subsets[0]?.values.find((v) => v.descriptor === "0-06-001")?.value as number;
    const temp = decoded.subsets[0]?.values.find((v) => v.descriptor === "0-12-101")?.value as number;
    assert.ok(Math.abs(lat - 37.75) < 1e-5);
    assert.ok(Math.abs(lon - -122.22) < 1e-5);
    assert.ok(Math.abs(temp - 291.15) < 1e-2);
  });

  it("round-trips BUFR Edition 3 radiosonde message with delayed replication (3-09-052)", () => {
    const src = `
BUFR EDITION 3
SECTION 1
  CENTRE = 98
  CATEGORY = 2
  VERSION = 14
  YEAR = 2025
  MONTH = 11
  DAY = 20
  HOUR = 0
  MINUTE = 0
SECTION 3
  SUBSETS = 1
  3-09-052
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-01-002 = 493
    0-04-001 = 2025
    0-04-002 = 11
    0-04-003 = 20
    0-04-004 = 0
    0-04-005 = 0
    0-05-001 = 37.75000
    0-06-001 = -122.22000
    0-07-001 = 3
    0-31-002 = 2
    0-07-004 = 100000
    0-10-009 = 110
    0-12-101 = 288.15
    0-12-103 = 282.15
    0-11-001 = 260
    0-11-002 = 5.0
    0-07-004 = 50000
    0-10-009 = 5570
    0-12-101 = 252.15
    0-12-103 = 240.15
    0-11-001 = 285
    0-11-002 = 24.5
7777
`;
    const orig = parseBufrText(src);
    const encoded = encodeBufrBinary(orig);
    assert.equal(encoded[7], 3);

    const decoded = decodeBufrBinary(encoded);
    assert.equal(decoded.section0.edition, 3);
    assert.equal(decoded.hasEndMarker, true);
    const repCount = decoded.subsets[0]?.values.find((v) => v.descriptor === "0-31-002")?.value;
    assert.equal(repCount, 2);
    const pressures = decoded.subsets[0]?.values.filter((v) => v.descriptor === "0-07-004").map((v) => v.value);
    assert.deepEqual(pressures, [100000, 50000]);
  });
});
