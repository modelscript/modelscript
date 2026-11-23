// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintFitsBinary, lintFitsDocument } from "../src/lints/index.js";
import { encodeFitsBinary, parseFitsHeaderText } from "../src/parser/index.js";

describe("FITS 4.0 Lints & Diagnostics (FITS1001–FITS5006)", () => {
  it("reports zero diagnostics for a valid FITS header with complete TAN WCS", () => {
    const valid = [
      "SIMPLE  =                    T / Conforms to FITS 4.0",
      "BITPIX  =                  -32 / IEEE float",
      "NAXIS   =                    2 / 2D image",
      "NAXIS1  =                  256 / X",
      "NAXIS2  =                  256 / Y",
      "CTYPE1  = 'RA---TAN'           / Gnomonic RA",
      "CTYPE2  = 'DEC--TAN'           / Gnomonic Dec",
      "CRVAL1  =                180.0 / RA deg",
      "CRVAL2  =                 45.0 / Dec deg",
      "CRPIX1  =                128.5 / X ref",
      "CRPIX2  =                128.5 / Y ref",
      "CD1_1   =         -0.000277778",
      "CD2_2   =          0.000277778",
      "END",
    ].join("\n");

    const diags = lintFitsDocument(parseFitsHeaderText(valid));
    assert.strictEqual(diags.length, 0);
  });

  it("detects FITS1001 (card > 80 chars), FITS1002 (non-ASCII), FITS2001 (missing SIMPLE), FITS2002 (missing END)", () => {
    const bad = [
      "BITPIX  =                   16 / Missing SIMPLE and has non-ASCII: é and exceeds eighty characters by quite a lot here",
      "NAXIS   =                    0",
    ].join("\n");

    const diags = lintFitsDocument(parseFitsHeaderText(bad));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("FITS1001"), "Expected FITS1001 card-length-error");
    assert.ok(codes.has("FITS1002"), "Expected FITS1002 non-ascii-character");
    assert.ok(codes.has("FITS2001"), "Expected FITS2001 missing-simple-card");
    assert.ok(codes.has("FITS2002"), "Expected FITS2002 missing-end-card");
  });

  it("detects FITS2003 (duplicate mandatory), FITS3001 (invalid BITPIX), FITS3002 (NAXIS mismatch), FITS5003 (BSCALE=0)", () => {
    const bad = [
      "SIMPLE  =                    T",
      "BITPIX  =                   24 / Invalid BITPIX",
      "BITPIX  =                   16 / Duplicate mandatory",
      "NAXIS   =                    2",
      "NAXIS1  =                  100",
      "NAXIS3  =                   10 / Stray NAXIS3, missing NAXIS2",
      "BSCALE  =                  0.0 / Singular scale",
      "END",
    ].join("\n");

    const diags = lintFitsDocument(parseFitsHeaderText(bad));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("FITS2003"), "Expected FITS2003 duplicate-mandatory-keyword");
    assert.ok(codes.has("FITS3002"), "Expected FITS3002 naxis-mismatch");
    assert.ok(codes.has("FITS5003"), "Expected FITS5003 singular-bscale");

    const badBitpixOnly = ["SIMPLE  = T", "BITPIX  = 24", "NAXIS   = 0", "END"].join("\n");
    const bitpixDiags = lintFitsDocument(parseFitsHeaderText(badBitpixOnly));
    assert.ok(
      bitpixDiags.some((d) => d.code === "FITS3001"),
      "Expected FITS3001 invalid-bitpix",
    );
  });

  it("detects FITS4001 (non-2880 alignment) and FITS5006 (truncated payload) on binary streams", () => {
    const validBin = encodeFitsBinary([{ kind: "PRIMARY", bitpix: -32, axes: [32, 32], data: new Float64Array(1024) }]);
    // Truncate by 2000 bytes (past the 1664-byte trailing zero padding) so it violates both 2880-byte framing and payload size
    const truncated = validBin.subarray(0, validBin.byteLength - 2000);
    const diags = lintFitsBinary(truncated);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("FITS4001"), "Expected FITS4001 non-2880-block-alignment");
    assert.ok(codes.has("FITS5006"), "Expected FITS5006 data-payload-size-mismatch");
  });

  it("detects FITS4002 (XTENSION without EXTEND=T), FITS5001/FITS5002 (WCS), FITS5004 (table), FITS5005 (GCOUNT)", () => {
    const badExt = [
      "SIMPLE  =                    T",
      "BITPIX  =                    8",
      "NAXIS   =                    0",
      "CTYPE1  = 'RA---XYZ'",
      "END",
      "XTENSION= 'BINTABLE'",
      "BITPIX  =                    8",
      "NAXIS   =                    2",
      "NAXIS1  =                    8",
      "NAXIS2  =                    1",
      "PCOUNT  =                    0",
      "GCOUNT  =                    2",
      "TFIELDS =                    1",
      "END",
    ].join("\n");

    const diags = lintFitsDocument(parseFitsHeaderText(badExt));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("FITS4002"), "Expected FITS4002 xtension-without-extend");
    assert.ok(codes.has("FITS5001"), "Expected FITS5001 incomplete-wcs-keywords");
    assert.ok(codes.has("FITS5002"), "Expected FITS5002 unsupported-wcs-projection");
    assert.ok(codes.has("FITS5004"), "Expected FITS5004 invalid-table-schema");
    assert.ok(codes.has("FITS5005"), "Expected FITS5005 invalid-pcount-gcount");
  });
});
