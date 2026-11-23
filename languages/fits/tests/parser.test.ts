// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FITS_BLOCK_BYTES,
  FITS_CARD_LENGTH,
  formatFitsCard,
  parseFits,
  parseFitsCard,
  parseFitsHeaderText,
  serializeFitsHeaderBlocks,
} from "../src/parser/index.js";

const SAMPLE_MULTI_HDU_HEADER = [
  "SIMPLE  =                    T / Conforms to FITS 4.0 standard",
  "BITPIX  =                  -32 / IEEE single-precision floating point",
  "NAXIS   =                    2 / 2D celestial image",
  "NAXIS1  =                  512 / Width in pixels",
  "NAXIS2  =                  512 / Height in pixels",
  "EXTEND  =                    T / Extensions may be present",
  "OBJECT  = 'M31 Andromeda'      / Target galaxy",
  "BSCALE  =         1.000000D+00 / Fortran D-exponent float",
  "BZERO   =                  0.0 / Zero offset",
  "CTYPE1  = 'RA---TAN'           / Gnomonic RA projection",
  "CTYPE2  = 'DEC--TAN'           / Gnomonic Dec projection",
  "CRVAL1  =            10.684708 / Reference RA (deg)",
  "CRVAL2  =            41.268750 / Reference Dec (deg)",
  "CRPIX1  =                256.5 / Reference X pixel",
  "CRPIX2  =                256.5 / Reference Y pixel",
  "CD1_1   =         -0.000277778 / deg/pixel",
  "CD1_2   =                  0.0",
  "CD2_1   =                  0.0",
  "CD2_2   =          0.000277778 / deg/pixel",
  "HISTORY Calibrated with flat-field frame FF_2026.fits",
  "COMMENT Deep exposure stack from ModelScript FITS",
  "END",
  "XTENSION= 'BINTABLE'           / Binary table extension",
  "BITPIX  =                    8 / 8-bit bytes",
  "NAXIS   =                    2 / 2-dimensional binary table",
  "NAXIS1  =                   16 / Width of table in bytes",
  "NAXIS2  =                   10 / Number of rows",
  "PCOUNT  =                    0 / Heap size",
  "GCOUNT  =                    1 / One group",
  "TFIELDS =                    2 / Two columns",
  "EXTNAME = 'CATALOG'            / Source catalog",
  "TTYPE1  = 'RA'                 / Right Ascension",
  "TFORM1  = '1D'                 / 64-bit float",
  "TTYPE2  = 'FLUX'               / Integrated flux",
  "TFORM2  = '1D'                 / 64-bit float",
  "END",
].join("\n");

describe("FITS 4.0 Header Card & Textual Parser", () => {
  it("parses multi-HDU textual FITS headers with typed values, HISTORY, and COMMENT", () => {
    const doc = parseFits(SAMPLE_MULTI_HDU_HEADER, "file:///m31.fits.hdr");
    assert.strictEqual(doc.isBinary, false);
    assert.strictEqual(doc.hdus.length, 2);

    const primary = doc.hdus[0]!;
    assert.strictEqual(primary.kind, "PRIMARY");
    assert.strictEqual(primary.header.hasEndCard, true);
    assert.strictEqual(primary.header.keywords["SIMPLE"]?.value, true);
    assert.strictEqual(primary.header.keywords["BITPIX"]?.value, -32);
    assert.strictEqual(primary.header.keywords["NAXIS"]?.value, 2);
    assert.strictEqual(primary.header.keywords["OBJECT"]?.value, "M31 Andromeda");
    assert.strictEqual(primary.header.keywords["BSCALE"]?.value, 1.0);
    assert.strictEqual(primary.header.history.length, 1);
    assert.ok(primary.header.history[0]!.includes("flat-field"));
    assert.strictEqual(primary.header.comments.length, 1);

    const ext = doc.hdus[1]!;
    assert.strictEqual(ext.kind, "BINTABLE");
    assert.strictEqual(ext.name, "CATALOG");
    assert.strictEqual(ext.header.keywords["TFIELDS"]?.value, 2);
  });

  it("handles escaped single quotes in strings and complex number literals", () => {
    const strCard = parseFitsCard("OBSERVER= 'O''Connor   '       / Quoted surname", 1, 0);
    assert.strictEqual(strCard.valueType, "string");
    assert.strictEqual(strCard.value, "O'Connor");
    assert.strictEqual(strCard.comment, "Quoted surname");

    const cplxCard = parseFitsCard("VISIB   = (1.25, -3.50)        / Complex visibility", 2, 1);
    assert.strictEqual(cplxCard.valueType, "complex");
    assert.deepStrictEqual(cplxCard.value, [1.25, -3.5]);
  });

  it("formats exact 80-character FITS cards and 2880-byte-aligned header blocks", () => {
    const cards = [
      formatFitsCard("SIMPLE", true, "Conforms to FITS"),
      formatFitsCard("BITPIX", 16, "16-bit integer"),
      formatFitsCard("NAXIS", 0, "No data"),
      formatFitsCard("OBJECT", "NGC 7000", "North America Nebula"),
      formatFitsCard("HISTORY", null, "Processed by ModelScript"),
    ];

    for (const c of cards) {
      assert.strictEqual(c.length, FITS_CARD_LENGTH);
    }

    const block = serializeFitsHeaderBlocks(cards);
    assert.strictEqual(block.byteLength, FITS_BLOCK_BYTES);

    // Re-parse concatenated 80-character stream without newlines
    const text = new TextDecoder("ascii").decode(block);
    const parsed = parseFitsHeaderText(text);
    assert.strictEqual(parsed.hdus.length, 1);
    assert.strictEqual(parsed.hdus[0]!.header.hasEndCard, true);
    assert.strictEqual(parsed.hdus[0]!.header.keywords["OBJECT"]?.value, "NGC 7000");
  });
});
