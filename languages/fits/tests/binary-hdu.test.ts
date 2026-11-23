// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FITS_BLOCK_BYTES, decodeFitsBinary, encodeFitsBinary, parseFits } from "../src/parser/index.js";
import type { FitsBitpix } from "../src/types.js";

describe("FITS 4.0 Binary 2880-Byte HDU Codec", () => {
  it("encodes and decodes Primary HDU across all valid BITPIX types (8, 16, 32, 64, -32, -64)", () => {
    const bitpixList: FitsBitpix[] = [8, 16, 32, 64, -32, -64];

    for (const bitpix of bitpixList) {
      const pixels =
        bitpix === 8
          ? [0, 12, 128, 255]
          : bitpix === 16
            ? [-1024, 0, 512, 12345]
            : bitpix === 32 || bitpix === 64
              ? [-100000, 0, 424242, 999999]
              : [-12.5, 0.0, 3.1415925, 1024.75];

      const binary = encodeFitsBinary([
        {
          kind: "PRIMARY",
          bitpix,
          axes: [2, 2],
          data: pixels,
          extraCards: [{ keyword: "OBJECT", value: `TEST_${bitpix}`, comment: "Test image" }],
        },
      ]);

      assert.strictEqual(binary.byteLength % FITS_BLOCK_BYTES, 0, `BITPIX=${bitpix} must be 2880-byte aligned`);
      const doc = parseFits(binary, `file:///test_${bitpix}.fits`);
      assert.strictEqual(doc.isBinary, true);
      assert.strictEqual(doc.hdus.length, 1);

      const img = doc.hdus[0]!.image!;
      assert.strictEqual(img.bitpix, bitpix);
      assert.deepStrictEqual(img.axes, [2, 2]);
      assert.strictEqual(img.data.length, 4);

      for (let i = 0; i < pixels.length; i++) {
        const tol = bitpix === -32 ? 1e-5 : 1e-12;
        assert.ok(
          Math.abs(img.data[i]! - pixels[i]!) <= tol,
          `BITPIX=${bitpix} pixel[${i}] mismatch: got ${img.data[i]}, expected ${pixels[i]}`,
        );
      }
    }
  });

  it("applies BSCALE and BZERO physical scaling for unsigned 16-bit integer convention", () => {
    const physical = [0, 1000, 32768, 65535];
    const binary = encodeFitsBinary([
      {
        kind: "PRIMARY",
        bitpix: 16,
        axes: [2, 2],
        bscale: 1.0,
        bzero: 32768.0,
        data: physical,
      },
    ]);

    const doc = decodeFitsBinary(binary);
    const img = doc.hdus[0]!.image!;
    assert.strictEqual(img.bscale, 1.0);
    assert.strictEqual(img.bzero, 32768.0);
    for (let i = 0; i < physical.length; i++) {
      assert.strictEqual(img.data[i], physical[i]);
    }
  });

  it("encodes and decodes multi-HDU FITS with PRIMARY + IMAGE + ASCII TABLE + BINTABLE extensions", () => {
    const binary = encodeFitsBinary([
      {
        kind: "PRIMARY",
        bitpix: -32,
        axes: [2, 2],
        data: [1.0, 2.0, 3.0, 4.0],
        extend: true,
      },
      {
        kind: "IMAGE",
        name: "VARIANCE",
        bitpix: -64,
        axes: [2, 2],
        data: [0.01, 0.04, 0.09, 0.16],
      },
      {
        kind: "TABLE",
        name: "ASCII_CAT",
        columns: [
          { name: "STAR", tform: "A10" },
          { name: "ID", tform: "I6" },
          { name: "MAG", tform: "F8.3", unit: "mag" },
        ],
        rows: [
          { STAR: "Vega", ID: 1, MAG: 0.03 },
          { STAR: "Sirius", ID: 2, MAG: -1.46 },
        ],
      },
      {
        kind: "BINTABLE",
        name: "BIN_PHOT",
        columns: [
          { name: "NAME", tform: "8A" },
          { name: "RA", tform: "1D", unit: "deg" },
          { name: "DEC", tform: "1D", unit: "deg" },
          { name: "FLAG", tform: "1L" },
          { name: "COUNT", tform: "1J" },
        ],
        rows: [
          { NAME: "SRC_01", RA: 279.2347, DEC: 38.7837, FLAG: true, COUNT: 42000 },
          { NAME: "SRC_02", RA: 101.2872, DEC: -16.7161, FLAG: false, COUNT: 98500 },
        ],
      },
    ]);

    assert.strictEqual(binary.byteLength % FITS_BLOCK_BYTES, 0);
    const doc = decodeFitsBinary(binary);
    assert.strictEqual(doc.hdus.length, 4);

    assert.strictEqual(doc.hdus[0]!.kind, "PRIMARY");
    assert.strictEqual(doc.hdus[1]!.kind, "IMAGE");
    assert.strictEqual(doc.hdus[1]!.name, "VARIANCE");
    assert.ok(Math.abs(doc.hdus[1]!.image!.data[3]! - 0.16) < 1e-12);

    const asciiTable = doc.hdus[2]!.table!;
    assert.strictEqual(asciiTable.kind, "TABLE");
    assert.strictEqual(asciiTable.rowCount, 2);
    assert.strictEqual(asciiTable.rows[0]!["STAR"], "Vega");
    assert.strictEqual(asciiTable.rows[1]!["ID"], 2);
    assert.ok(Math.abs((asciiTable.rows[1]!["MAG"] as number) - -1.46) < 1e-2);

    const binTable = doc.hdus[3]!.table!;
    assert.strictEqual(binTable.kind, "BINTABLE");
    assert.strictEqual(binTable.rowCount, 2);
    assert.strictEqual(binTable.rows[0]!["NAME"], "SRC_01");
    assert.ok(Math.abs((binTable.rows[0]!["RA"] as number) - 279.2347) < 1e-12);
    assert.strictEqual(binTable.rows[0]!["FLAG"], true);
    assert.strictEqual(binTable.rows[1]!["FLAG"], false);
    assert.strictEqual(binTable.rows[1]!["COUNT"], 98500);
  });
});
