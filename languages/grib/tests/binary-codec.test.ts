// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeGrib1Binary,
  decodeIbmFloat32,
  encodeGrib1Binary,
  encodeIbmFloat32,
  packBitsMSB,
  readSignMag16,
  readSignMag24,
  unpackBitsMSB,
  writeSignMag16,
  writeSignMag24,
} from "../src/parser/binary-codec.js";
import { parseGribDescriptor } from "../src/parser/text-parser.js";

describe("GRIB1 Binary Stream Codec", () => {
  it("accurately encodes and decodes IBM System/360 32-bit floats", () => {
    const testValues = [0, 1, -1, 273.15, -40.5, 101325.0, 5500.25, 0.00125, 1e6, -0.00048828125];
    for (const v of testValues) {
      const word = encodeIbmFloat32(v);
      const decoded = decodeIbmFloat32(word);
      if (v === 0) {
        assert.equal(decoded, 0);
      } else {
        const relErr = Math.abs(decoded - v) / Math.abs(v);
        assert.ok(relErr < 1e-6, `IBM float round-trip for ${v}: got ${decoded} (relErr=${relErr})`);
      }
    }
  });

  it("handles 16-bit and 24-bit GRIB1 sign-magnitude integers", () => {
    const buf = new Uint8Array(10);
    writeSignMag16(buf, 0, -1234);
    writeSignMag16(buf, 2, 4567);
    writeSignMag24(buf, 4, -120500);
    writeSignMag24(buf, 7, 90000);

    assert.equal(readSignMag16(buf, 0), -1234);
    assert.equal(readSignMag16(buf, 2), 4567);
    assert.equal(readSignMag24(buf, 4), -120500);
    assert.equal(readSignMag24(buf, 7), 90000);
  });

  it("packs and unpacks arbitrary MSB-first bit widths (8, 12, 16, 20)", () => {
    for (const bits of [8, 12, 16, 20]) {
      const maxVal = (1 << bits) - 1;
      const sample = [0, 1, 7, Math.floor(maxVal / 3), Math.floor(maxVal / 2), maxVal];
      const { bytes } = packBitsMSB(sample, bits);
      const unpacked = unpackBitsMSB(bytes, bits, sample.length);
      assert.deepEqual(unpacked, sample, `MSB bit-packing mismatch for ${bits}-bit width`);
    }
  });

  it("round-trips a full GRIB1 binary stream including PDS, GDS, BMS, BDS, and 7777 trailer", () => {
    const src = `
GRIB edition=1
  PDS {
    center = 7
    parameter = TMP
    levelType = ISBL
    level = 850
    date = "2026-03-20T06:00"
    decimalScale = 1
  }
  GDS {
    gridType = 0
    ni = 3
    nj = 2
    la1 = 55.0
    lo1 = -125.0
    la2 = 35.0
    lo2 = -85.0
    di = 20.0
    dj = 20.0
  }
  BMS {
    bitmap = [1, 1, 0, 1, 1, 1]
  }
  BDS {
    bitsPerValue = 16
    values = [271.5, 274.2, 0, 279.8, 282.1, 285.0]
  }
7777
`;
    const doc = parseGribDescriptor(src);
    const bytes = encodeGrib1Binary(doc);

    // Check magic header & trailer
    assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!), "GRIB");
    assert.equal(bytes[7], 1);
    assert.equal(
      String.fromCharCode(
        bytes[bytes.length - 4]!,
        bytes[bytes.length - 3]!,
        bytes[bytes.length - 2]!,
        bytes[bytes.length - 1]!,
      ),
      "7777",
    );

    const decoded = decodeGrib1Binary(bytes, "roundtrip.grb");
    assert.equal(decoded.isBinary, true);
    assert.equal(decoded.syntaxErrors.length, 0);
    assert.equal(decoded.messages.length, 1);

    const m = decoded.messages[0]!;
    assert.equal(m.end.present, true);
    assert.equal(m.pds!.parameterCode, 11);
    assert.equal(m.pds!.levelType, 100);
    assert.equal(m.pds!.levelValue, 850);
    assert.equal(m.pds!.year, 2026);
    assert.equal(m.pds!.month, 3);
    assert.equal(m.pds!.day, 20);
    assert.equal(m.pds!.hour, 6);
    assert.equal(m.gds!.ni, 3);
    assert.equal(m.gds!.nj, 2);
    assert.ok(Math.abs(m.gds!.lo1 - -125.0) < 1e-3);
    assert.ok(m.bms);
    assert.deepEqual(m.bms.bitmap, [true, true, false, true, true, true]);
    assert.ok(Number.isNaN(m.bds!.values[2]!));
    assert.ok(Math.abs(m.bds!.values[0]! - 271.5) < 0.05);
    assert.ok(Math.abs(m.bds!.values[5]! - 285.0) < 0.05);
  });
});
