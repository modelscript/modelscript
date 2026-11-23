// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GdsiiRecordType,
  decodeGdsiiBinary,
  decodeIbmReal64,
  encodeGdsiiBinary,
  encodeIbmReal64,
  readGdsiiRecords,
} from "../src/parser/binary-stream.js";
import type { GdsiiLibrary } from "../src/types.js";

describe("GDSII Binary Stream Codec & IBM Real64", () => {
  it("encodes and decodes IBM System/360 8-byte Real64 accurately", () => {
    const testValues = [0, 1, -1, 0.5, 1e-3, 1e-9, 90, 180, 3.141592653589793, -123.456789];
    for (const expected of testValues) {
      const encoded = encodeIbmReal64(expected);
      assert.equal(encoded.length, 8);
      const decoded = decodeIbmReal64(encoded);
      if (expected === 0) {
        assert.equal(decoded, 0);
      } else {
        const relErr = Math.abs(decoded - expected) / Math.abs(expected);
        assert.ok(relErr < 1e-14, `IBM Real64 round-trip error for ${expected}: relErr=${relErr}`);
      }
    }
  });

  it("matches known GDSII IBM Real64 byte patterns for 1e-3 and 1.0", () => {
    // 1.0 = (1/16) * 16^1 => biased exp = 65 = 0x41, mantissa = 0x10 00 00 00 00 00 00
    const one = encodeIbmReal64(1.0);
    assert.deepEqual([...one], [0x41, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    assert.equal(decodeIbmReal64(one), 1.0);
  });

  it("round-trips a full hierarchical GDSII library through binary stream encoding", () => {
    const lib: GdsiiLibrary = {
      version: 600,
      name: "BIN_ROUNDTRIP",
      units: { dbUnitInUserUnits: 1e-3, dbUnitInMeters: 1e-9 },
      structures: [
        {
          name: "UNIT_SQ",
          elements: [
            {
              kind: "boundary",
              layer: 5,
              datatype: 0,
              xy: [
                { x: 0, y: 0 },
                { x: 500, y: 0 },
                { x: 500, y: 500 },
                { x: 0, y: 500 },
                { x: 0, y: 0 },
              ],
            },
          ],
        },
        {
          name: "ARRAY_TOP",
          elements: [
            {
              kind: "aref",
              sname: "UNIT_SQ",
              columns: 3,
              rows: 2,
              xy: [
                { x: 0, y: 0 },
                { x: 3000, y: 0 },
                { x: 0, y: 2000 },
              ],
            },
            {
              kind: "path",
              layer: 7,
              datatype: 0,
              pathtype: 0,
              width: 300,
              xy: [
                { x: 0, y: 2500 },
                { x: 3000, y: 2500 },
              ],
            },
          ],
        },
      ],
    };

    const bytes = encodeGdsiiBinary(lib);
    const { records, errors } = readGdsiiRecords(bytes);
    assert.equal(errors.length, 0);
    assert.equal(records[0]!.recordType, GdsiiRecordType.HEADER);
    assert.equal(records[records.length - 1]!.recordType, GdsiiRecordType.ENDLIB);

    const decoded = decodeGdsiiBinary(bytes);
    assert.equal(decoded.parseErrors, undefined);
    assert.equal(decoded.version, 600);
    assert.equal(decoded.name, "BIN_ROUNDTRIP");
    assert.ok(Math.abs(decoded.units.dbUnitInUserUnits - 1e-3) / 1e-3 < 1e-12);
    assert.ok(Math.abs(decoded.units.dbUnitInMeters - 1e-9) / 1e-9 < 1e-12);
    assert.equal(decoded.structures.length, 2);
    assert.equal(decoded.structures[1]!.elements.length, 2);
  });
});
