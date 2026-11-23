// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeHdf4Binary, encodeHdf4Binary, isHdf4Binary, parseHdf4, parseHdf4Ddl } from "../src/parser/index.js";
import { HDF4_MAGIC, Hdf4DataType, Hdf4Tag } from "../src/types.js";

describe("HDF4 binary DDH/DD stream codec", () => {
  it("encodes 4-byte magic 0x0e031301, chained DDH/DD blocks, and standard DFTAG records", () => {
    const doc = parseHdf4Ddl(`
      HDF4 BinaryTest VERSION="4.2"
        SDS Temperature TYPE=FLOAT64 REF=10 UNIT="K"
          DIM x = 2
          DIM y = 3
          DATA [273.15, 280.0, 290.5, 300.25, 310.75, 320.0]
        END
        SDS Counts TYPE=INT16 REF=11 UNIT="counts"
          DIM n = 4
          DATA [-10, 0, 42, 1024]
        END
        VDATA Meta CLASS="Sensor" REF=20
          FIELD id : INT32
          FIELD label : CHAR8
          DATA [1, "A"]
        END
        VGROUP Root CLASS="EOS_GRID" REF=30
          MEMBER SDS Temperature
          MEMBER SDS Counts
          MEMBER VDATA Meta
        END
      END
    `);

    // Force multi-block DDH chaining with ddPerBlock=4
    const bytes = encodeHdf4Binary(doc, { ddPerBlock: 4 });
    assert.equal(isHdf4Binary(bytes), true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, false), HDF4_MAGIC);

    const decoded = parseHdf4(bytes);
    assert.equal(decoded.parseErrors.length, 0);
    assert.equal(decoded.name, "BinaryTest");
    assert.ok(decoded.ddhBlocks.length >= 2, "Expected chained DDH blocks");

    const tags = new Set(decoded.descriptors.map((d) => d.tag));
    assert.ok(tags.has(Hdf4Tag.DFTAG_NDG));
    assert.ok(tags.has(Hdf4Tag.DFTAG_SDD));
    assert.ok(tags.has(Hdf4Tag.DFTAG_SD));
    assert.ok(tags.has(Hdf4Tag.DFTAG_VG));
    assert.ok(tags.has(Hdf4Tag.DFTAG_VH));
    assert.ok(tags.has(Hdf4Tag.DFTAG_VS));

    assert.equal(decoded.sdsList.length, 2);
    const temp = decoded.sdsList.find((s) => s.name === "Temperature")!;
    assert.equal(temp.dataType, Hdf4DataType.DFNT_FLOAT64);
    assert.equal(temp.unit, "K");
    assert.deepEqual(temp.data, [273.15, 280.0, 290.5, 300.25, 310.75, 320.0]);

    const counts = decoded.sdsList.find((s) => s.name === "Counts")!;
    assert.deepEqual(counts.data, [-10, 0, 42, 1024]);

    assert.equal(decoded.vgroups.length, 1);
    assert.equal(decoded.vgroups[0]!.members.length, 3);
  });

  it("rejects invalid magic bytes with HDF1002 and truncated DDH with HDF1003", () => {
    const badMagic = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.equal(isHdf4Binary(badMagic), false);
    const d1 = decodeHdf4Binary(badMagic);
    assert.ok(d1.parseErrors.some((e) => e.code === "HDF1002"));

    // Valid magic, DDH claiming 100 entries in a 12-byte file
    const trunc = new Uint8Array(12);
    const tv = new DataView(trunc.buffer);
    tv.setUint32(0, HDF4_MAGIC, false);
    tv.setUint16(4, 100, false);
    tv.setUint32(6, 0, false);
    const d2 = decodeHdf4Binary(trunc);
    assert.ok(d2.parseErrors.some((e) => e.code === "HDF1003"));
  });
});
