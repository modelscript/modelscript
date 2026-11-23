// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexFits, findFitsSymbolsByType, getFitsDocument } from "../src/indexing.js";
import { fitsLanguage } from "../src/language.js";
import { getFitsCompletions, getFitsDocumentSymbols, getFitsHover, validateFits } from "../src/lsp.js";

const SAMPLE_FITS_HEADER = [
  "SIMPLE  =                    T / Conforms to FITS 4.0",
  "BITPIX  =                  -32 / IEEE 754 float32",
  "NAXIS   =                    2 / 2D image",
  "NAXIS1  =                  512 / X size",
  "NAXIS2  =                  512 / Y size",
  "OBJECT  = 'NGC 6302'           / Butterfly Nebula",
  "CTYPE1  = 'RA---TAN'           / Gnomonic RA",
  "CTYPE2  = 'DEC--TAN'           / Gnomonic Dec",
  "CRVAL1  =              258.435 / RA deg",
  "CRVAL2  =              -37.103 / Dec deg",
  "CRPIX1  =                256.5 / X ref",
  "CRPIX2  =                256.5 / Y ref",
  "CD1_1   =         -0.000277778",
  "CD2_2   =          0.000277778",
  "END",
].join("\n");

describe("FITS Workspace Indexing & LSP Services", () => {
  it("indexes FITS headers into UnifiedWorkspace and queries HDU/WCS symbols", () => {
    assert.strictEqual(canIndexFits("file:///ngc6302.fits"), true);
    assert.strictEqual(canIndexFits("file:///unknown.txt", SAMPLE_FITS_HEADER), true);
    assert.strictEqual(canIndexFits("file:///readme.md", "# Hello"), false);

    const workspace = new UnifiedWorkspace(fitsLanguage);
    const uri = "file:///ngc6302.fits";
    workspace.setDocument(uri, SAMPLE_FITS_HEADER);

    const doc = getFitsDocument(workspace, uri);
    assert.ok(doc);
    assert.strictEqual(doc.hdus.length, 1);

    const wcsSyms = findFitsSymbolsByType(workspace, "fits_wcs");
    assert.strictEqual(wcsSyms.length, 1);
    assert.strictEqual(wcsSyms[0]!.name, "WCS_TAN");
  });

  it("provides LSP diagnostics, document symbols, keyword hover, and completions", () => {
    const validDiags = validateFits(SAMPLE_FITS_HEADER, "file:///ngc6302.fits");
    assert.strictEqual(validDiags.length, 0);

    const invalidDiags = validateFits("BITPIX = 24\nNAXIS = 0", "file:///bad.fits");
    assert.ok(invalidDiags.length >= 3);
    assert.ok(invalidDiags.some((d) => d.code === "FITS3001"));

    const symbols = getFitsDocumentSymbols(SAMPLE_FITS_HEADER);
    assert.strictEqual(symbols.length, 1);
    assert.ok(symbols[0]!.children!.length >= 10);

    const hoverBitpix = getFitsHover(SAMPLE_FITS_HEADER, { line: 1, character: 2 });
    assert.ok(hoverBitpix);
    assert.ok(hoverBitpix.contents.value.includes("BITPIX"));

    const completions = getFitsCompletions("CR");
    const labels = completions.map((c) => c.label);
    assert.ok(labels.includes("CRVAL1"));
    assert.ok(labels.includes("CRPIX1"));
  });
});
