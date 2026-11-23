// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — FITS 4.0 Linter & Validation Rules (`FITS1001`–`FITS5006`).
 */

import { FitsErrorCode } from "../errors.js";
import {
  FITS_BLOCK_BYTES,
  FITS_CARD_LENGTH,
  VALID_BITPIX_VALUES,
  bitpixByteSize,
  decodeFitsBinary,
} from "../parser/index.js";
import type { FitsDiagnostic, FitsDocument, FitsHdu, FitsHeader } from "../types.js";

const MANDATORY_PRIMARY_KEYWORDS = new Set(["SIMPLE", "BITPIX", "NAXIS"]);
const MANDATORY_EXT_KEYWORDS = new Set(["XTENSION", "BITPIX", "NAXIS", "PCOUNT", "GCOUNT"]);
const SUPPORTED_WCS_PROJECTIONS = new Set([
  "TAN",
  "SIN",
  "ARC",
  "AZP",
  "SZP",
  "STG",
  "ZEA",
  "AIR",
  "CYP",
  "CEA",
  "CAR",
  "MER",
  "SFL",
  "PAR",
  "MOL",
  "AIT",
  "COP",
  "COE",
  "COD",
  "COO",
  "BON",
  "PCO",
  "TSC",
  "CSC",
  "QSC",
  "HPX",
  "XPH",
]);

function makeRange(
  line: number,
  startCol = 1,
  endCol = FITS_CARD_LENGTH,
): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
} {
  const safeLine = Math.max(1, line);
  return {
    startLine: safeLine,
    startColumn: startCol,
    endLine: safeLine,
    endColumn: Math.max(startCol + 1, endCol),
  };
}

function lintHeaderCards(hdu: FitsHdu, diagnostics: FitsDiagnostic[]): void {
  const { header, index: hduIndex } = hdu;

  for (const card of header.cards) {
    // FITS1001: card length > 80 characters
    if (card.raw.length > FITS_CARD_LENGTH) {
      diagnostics.push({
        code: FitsErrorCode.CARD_LENGTH_ERROR.code,
        rule: FitsErrorCode.CARD_LENGTH_ERROR.rule,
        severity: FitsErrorCode.CARD_LENGTH_ERROR.severity,
        message: FitsErrorCode.CARD_LENGTH_ERROR.message(String(card.line), String(card.raw.length)),
        range: makeRange(card.line, FITS_CARD_LENGTH + 1, card.raw.length),
        hduIndex,
      });
    }

    // FITS1002: non-ASCII or non-printable character (outside 0x20..0x7E)
    for (let i = 0; i < card.raw.length; i++) {
      const code = card.raw.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) {
        diagnostics.push({
          code: FitsErrorCode.NON_ASCII_CHARACTER.code,
          rule: FitsErrorCode.NON_ASCII_CHARACTER.rule,
          severity: FitsErrorCode.NON_ASCII_CHARACTER.severity,
          message: FitsErrorCode.NON_ASCII_CHARACTER.message(String(card.line), code.toString(16).toUpperCase()),
          range: makeRange(card.line, i + 1, i + 2),
          hduIndex,
        });
        break;
      }
    }

    // FITS1003: malformed keyword (illegal chars or > 8 chars)
    if (card.keyword.length > 0 && (card.keyword.length > 8 || !/^[A-Z0-9_-]+$/.test(card.keyword))) {
      diagnostics.push({
        code: FitsErrorCode.MALFORMED_CARD_SYNTAX.code,
        rule: FitsErrorCode.MALFORMED_CARD_SYNTAX.rule,
        severity: FitsErrorCode.MALFORMED_CARD_SYNTAX.severity,
        message: FitsErrorCode.MALFORMED_CARD_SYNTAX.message(
          card.keyword,
          "keyword must be 1-8 uppercase ASCII letters, digits, hyphen, or underscore",
        ),
        range: makeRange(card.line, 1, Math.min(80, Math.max(8, card.keyword.length))),
        hduIndex,
      });
    }
  }

  // FITS2002: Missing END card
  if (!header.hasEndCard) {
    const lastLine = header.cards[header.cards.length - 1]?.line ?? 1;
    diagnostics.push({
      code: FitsErrorCode.MISSING_END_CARD.code,
      rule: FitsErrorCode.MISSING_END_CARD.rule,
      severity: FitsErrorCode.MISSING_END_CARD.severity,
      message: FitsErrorCode.MISSING_END_CARD.message(String(hduIndex)),
      range: makeRange(lastLine),
      hduIndex,
    });
  }

  // FITS2003: Duplicate mandatory keywords
  const mandatorySet = hduIndex === 0 ? MANDATORY_PRIMARY_KEYWORDS : MANDATORY_EXT_KEYWORDS;
  for (const dup of header.duplicateKeywords) {
    if (mandatorySet.has(dup.keyword) || /^NAXIS\d+$/.test(dup.keyword)) {
      diagnostics.push({
        code: FitsErrorCode.DUPLICATE_MANDATORY_KEYWORD.code,
        rule: FitsErrorCode.DUPLICATE_MANDATORY_KEYWORD.rule,
        severity: FitsErrorCode.DUPLICATE_MANDATORY_KEYWORD.severity,
        message: FitsErrorCode.DUPLICATE_MANDATORY_KEYWORD.message(dup.keyword, String(hduIndex)),
        range: makeRange(dup.line),
        hduIndex,
      });
    }
  }
}

function lintWcsKeywords(header: FitsHeader, hduIndex: number, diagnostics: FitsDiagnostic[]): void {
  const hasAnyWcs =
    Boolean(header.keywords["CTYPE1"]) ||
    Boolean(header.keywords["CTYPE2"]) ||
    Boolean(header.keywords["CRVAL1"]) ||
    Boolean(header.keywords["CRPIX1"]);
  if (!hasAnyWcs) return;

  const missing: string[] = [];
  for (const key of ["CTYPE1", "CTYPE2", "CRVAL1", "CRVAL2", "CRPIX1", "CRPIX2"]) {
    if (!header.keywords[key]) {
      missing.push(`'${key}'`);
    }
  }

  const hasCd = Boolean(header.keywords["CD1_1"]) && Boolean(header.keywords["CD2_2"]);
  const hasCdelt = Boolean(header.keywords["CDELT1"]) && Boolean(header.keywords["CDELT2"]);

  if (!hasCd && !hasCdelt) {
    missing.push("'CD1_1'/'CD2_2' or 'CDELT1'/'CDELT2'");
  }

  if (missing.length > 0) {
    const refLine =
      header.keywords["CTYPE1"]?.line ?? header.keywords["CRVAL1"]?.line ?? header.keywords["CRPIX1"]?.line ?? 1;
    diagnostics.push({
      code: FitsErrorCode.INCOMPLETE_WCS_KEYWORDS.code,
      rule: FitsErrorCode.INCOMPLETE_WCS_KEYWORDS.rule,
      severity: FitsErrorCode.INCOMPLETE_WCS_KEYWORDS.severity,
      message: FitsErrorCode.INCOMPLETE_WCS_KEYWORDS.message(missing.join(", "), String(hduIndex)),
      range: makeRange(refLine),
      hduIndex,
    });
  }

  const ctype1 = header.keywords["CTYPE1"];
  const ctype2 = header.keywords["CTYPE2"];
  if (ctype1 && typeof ctype1.value === "string" && ctype1.value.includes("-")) {
    const proj1 = ctype1.value.slice(-3).toUpperCase();
    if (!SUPPORTED_WCS_PROJECTIONS.has(proj1)) {
      diagnostics.push({
        code: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.code,
        rule: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.rule,
        severity: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.severity,
        message: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.message(ctype1.value, String(hduIndex)),
        range: makeRange(ctype1.line),
        hduIndex,
      });
    } else if (ctype2 && typeof ctype2.value === "string" && ctype2.value.includes("-")) {
      const proj2 = ctype2.value.slice(-3).toUpperCase();
      if (proj1 !== proj2) {
        diagnostics.push({
          code: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.code,
          rule: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.rule,
          severity: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.severity,
          message: FitsErrorCode.UNSUPPORTED_WCS_PROJECTION.message(
            `${ctype1.value} / ${ctype2.value}`,
            String(hduIndex),
          ),
          range: makeRange(ctype2.line),
          hduIndex,
        });
      }
    }
  }
}

/**
 * Runs all FITS 4.0 structural, typing, framing, table, and WCS lint rules on a parsed `FitsDocument`.
 */
export function lintFitsDocument(doc: FitsDocument): FitsDiagnostic[] {
  const diagnostics: FitsDiagnostic[] = [];

  // FITS4001: 2880-byte binary block alignment
  if (doc.isBinary && doc.binaryByteLength !== undefined && doc.binaryByteLength % FITS_BLOCK_BYTES !== 0) {
    diagnostics.push({
      code: FitsErrorCode.NON_2880_BLOCK_ALIGNMENT.code,
      rule: FitsErrorCode.NON_2880_BLOCK_ALIGNMENT.rule,
      severity: FitsErrorCode.NON_2880_BLOCK_ALIGNMENT.severity,
      message: FitsErrorCode.NON_2880_BLOCK_ALIGNMENT.message(String(doc.binaryByteLength)),
      range: makeRange(1),
      hduIndex: 0,
    });
  }

  if (doc.hdus.length === 0) {
    diagnostics.push({
      code: FitsErrorCode.MISSING_SIMPLE_CARD.code,
      rule: FitsErrorCode.MISSING_SIMPLE_CARD.rule,
      severity: FitsErrorCode.MISSING_SIMPLE_CARD.severity,
      message: FitsErrorCode.MISSING_SIMPLE_CARD.message("empty FITS document"),
      range: makeRange(1),
      hduIndex: 0,
    });
    return diagnostics;
  }

  const primary = doc.hdus[0]!;
  const primaryExtend = primary.header.keywords["EXTEND"]?.value === true;

  for (const hdu of doc.hdus) {
    const { header, index: hduIndex } = hdu;
    lintHeaderCards(hdu, diagnostics);

    // FITS2001: Primary HDU must start with SIMPLE = T
    if (hduIndex === 0) {
      const simpleCard = header.keywords["SIMPLE"];
      if (!simpleCard) {
        diagnostics.push({
          code: FitsErrorCode.MISSING_SIMPLE_CARD.code,
          rule: FitsErrorCode.MISSING_SIMPLE_CARD.rule,
          severity: FitsErrorCode.MISSING_SIMPLE_CARD.severity,
          message: FitsErrorCode.MISSING_SIMPLE_CARD.message("keyword 'SIMPLE' not found"),
          range: makeRange(header.cards[0]?.line ?? 1),
          hduIndex,
        });
      } else if (simpleCard.value !== true) {
        diagnostics.push({
          code: FitsErrorCode.MISSING_SIMPLE_CARD.code,
          rule: FitsErrorCode.MISSING_SIMPLE_CARD.rule,
          severity: FitsErrorCode.MISSING_SIMPLE_CARD.severity,
          message: FitsErrorCode.MISSING_SIMPLE_CARD.message(`found SIMPLE = ${String(simpleCard.value)}`),
          range: makeRange(simpleCard.line),
          hduIndex,
        });
      }
    } else {
      // FITS4002: Extension HDU without EXTEND = T in Primary HDU
      const xtCard = header.keywords["XTENSION"];
      if (!primaryExtend) {
        diagnostics.push({
          code: FitsErrorCode.XTENSION_WITHOUT_EXTEND.code,
          rule: FitsErrorCode.XTENSION_WITHOUT_EXTEND.rule,
          severity: FitsErrorCode.XTENSION_WITHOUT_EXTEND.severity,
          message: FitsErrorCode.XTENSION_WITHOUT_EXTEND.message(
            String(hduIndex),
            typeof xtCard?.value === "string" ? xtCard.value : hdu.kind,
          ),
          range: makeRange(xtCard?.line ?? header.cards[0]?.line ?? 1),
          hduIndex,
        });
      }

      // FITS5005: PCOUNT / GCOUNT checks on extensions
      const gcountCard = header.keywords["GCOUNT"];
      if (gcountCard && typeof gcountCard.value === "number" && gcountCard.value !== 1) {
        diagnostics.push({
          code: FitsErrorCode.INVALID_PCOUNT_GCOUNT.code,
          rule: FitsErrorCode.INVALID_PCOUNT_GCOUNT.rule,
          severity: FitsErrorCode.INVALID_PCOUNT_GCOUNT.severity,
          message: FitsErrorCode.INVALID_PCOUNT_GCOUNT.message(
            `'GCOUNT' must equal 1 for ${hdu.kind} extension (found ${gcountCard.value})`,
            String(hduIndex),
          ),
          range: makeRange(gcountCard.line),
          hduIndex,
        });
      }
    }

    // FITS3001: BITPIX validation
    const bitpixCard = header.keywords["BITPIX"];
    if (!bitpixCard || typeof bitpixCard.value !== "number" || !VALID_BITPIX_VALUES.has(bitpixCard.value)) {
      diagnostics.push({
        code: FitsErrorCode.INVALID_BITPIX.code,
        rule: FitsErrorCode.INVALID_BITPIX.rule,
        severity: FitsErrorCode.INVALID_BITPIX.severity,
        message: FitsErrorCode.INVALID_BITPIX.message(String(bitpixCard?.value ?? "missing"), String(hduIndex)),
        range: makeRange(bitpixCard?.line ?? header.cards[0]?.line ?? 1),
        hduIndex,
      });
    }

    // FITS3002: NAXIS & NAXISn validation
    const naxisCard = header.keywords["NAXIS"];
    if (
      !naxisCard ||
      typeof naxisCard.value !== "number" ||
      !Number.isInteger(naxisCard.value) ||
      naxisCard.value < 0
    ) {
      diagnostics.push({
        code: FitsErrorCode.NAXIS_MISMATCH.code,
        rule: FitsErrorCode.NAXIS_MISMATCH.rule,
        severity: FitsErrorCode.NAXIS_MISMATCH.severity,
        message: FitsErrorCode.NAXIS_MISMATCH.message(
          `invalid or missing 'NAXIS' (${String(naxisCard?.value ?? "missing")})`,
          String(hduIndex),
        ),
        range: makeRange(naxisCard?.line ?? 1),
        hduIndex,
      });
    } else {
      const naxis = naxisCard.value;
      for (let a = 1; a <= naxis; a++) {
        const axisCard = header.keywords[`NAXIS${a}`];
        if (
          !axisCard ||
          typeof axisCard.value !== "number" ||
          !Number.isInteger(axisCard.value) ||
          axisCard.value < 0
        ) {
          diagnostics.push({
            code: FitsErrorCode.NAXIS_MISMATCH.code,
            rule: FitsErrorCode.NAXIS_MISMATCH.rule,
            severity: FitsErrorCode.NAXIS_MISMATCH.severity,
            message: FitsErrorCode.NAXIS_MISMATCH.message(
              `NAXIS = ${naxis} requires non-negative integer 'NAXIS${a}'`,
              String(hduIndex),
            ),
            range: makeRange(axisCard?.line ?? naxisCard.line),
            hduIndex,
          });
        }
      }
      // Check for stray NAXISk with k > naxis
      for (const kw of Object.keys(header.keywords)) {
        const m = /^NAXIS(\d+)$/.exec(kw);
        if (m) {
          const idx = Number.parseInt(m[1]!, 10);
          if (idx > naxis) {
            diagnostics.push({
              code: FitsErrorCode.NAXIS_MISMATCH.code,
              rule: FitsErrorCode.NAXIS_MISMATCH.rule,
              severity: FitsErrorCode.NAXIS_MISMATCH.severity,
              message: FitsErrorCode.NAXIS_MISMATCH.message(
                `found '${kw}' exceeding declared NAXIS = ${naxis}`,
                String(hduIndex),
              ),
              range: makeRange(header.keywords[kw]!.line),
              hduIndex,
            });
          }
        }
      }
    }

    // FITS5003: BSCALE = 0
    const bscaleCard = header.keywords["BSCALE"];
    if (bscaleCard && typeof bscaleCard.value === "number" && bscaleCard.value === 0) {
      diagnostics.push({
        code: FitsErrorCode.SINGULAR_BSCALE.code,
        rule: FitsErrorCode.SINGULAR_BSCALE.rule,
        severity: FitsErrorCode.SINGULAR_BSCALE.severity,
        message: FitsErrorCode.SINGULAR_BSCALE.message(String(hduIndex)),
        range: makeRange(bscaleCard.line),
        hduIndex,
      });
    }

    // FITS5004: TABLE / BINTABLE schema validation
    if (hdu.kind === "TABLE" || hdu.kind === "BINTABLE") {
      const tfieldsCard = header.keywords["TFIELDS"];
      if (!tfieldsCard || typeof tfieldsCard.value !== "number" || tfieldsCard.value < 0) {
        diagnostics.push({
          code: FitsErrorCode.INVALID_TABLE_SCHEMA.code,
          rule: FitsErrorCode.INVALID_TABLE_SCHEMA.rule,
          severity: FitsErrorCode.INVALID_TABLE_SCHEMA.severity,
          message: FitsErrorCode.INVALID_TABLE_SCHEMA.message("missing or negative 'TFIELDS'", String(hduIndex)),
          range: makeRange(tfieldsCard?.line ?? 1),
          hduIndex,
        });
      } else {
        for (let c = 1; c <= tfieldsCard.value; c++) {
          if (!header.keywords[`TFORM${c}`]) {
            diagnostics.push({
              code: FitsErrorCode.INVALID_TABLE_SCHEMA.code,
              rule: FitsErrorCode.INVALID_TABLE_SCHEMA.rule,
              severity: FitsErrorCode.INVALID_TABLE_SCHEMA.severity,
              message: FitsErrorCode.INVALID_TABLE_SCHEMA.message(`missing 'TFORM${c}'`, String(hduIndex)),
              range: makeRange(tfieldsCard.line),
              hduIndex,
            });
          }
        }
      }
    }

    // FITS5006: Binary data payload size consistency
    if (
      doc.isBinary &&
      bitpixCard &&
      typeof bitpixCard.value === "number" &&
      VALID_BITPIX_VALUES.has(bitpixCard.value)
    ) {
      const naxis = typeof naxisCard?.value === "number" ? naxisCard.value : 0;
      if (naxis > 0) {
        let product = 1;
        for (let a = 1; a <= naxis; a++) {
          const v = header.keywords[`NAXIS${a}`]?.value;
          product *= typeof v === "number" ? v : 0;
        }
        const pcount = typeof header.keywords["PCOUNT"]?.value === "number" ? header.keywords["PCOUNT"]!.value : 0;
        const gcount = typeof header.keywords["GCOUNT"]?.value === "number" ? header.keywords["GCOUNT"]!.value : 1;
        const expected = bitpixByteSize(bitpixCard.value) * gcount * (pcount + product);
        const actual = hdu.rawDataBytes ?? 0;
        if (expected > 0 && actual < expected) {
          diagnostics.push({
            code: FitsErrorCode.DATA_PAYLOAD_SIZE_MISMATCH.code,
            rule: FitsErrorCode.DATA_PAYLOAD_SIZE_MISMATCH.rule,
            severity: FitsErrorCode.DATA_PAYLOAD_SIZE_MISMATCH.severity,
            message: FitsErrorCode.DATA_PAYLOAD_SIZE_MISMATCH.message(
              String(expected),
              String(actual),
              String(hduIndex),
            ),
            range: makeRange(naxisCard?.line ?? 1),
            hduIndex,
          });
        }
      }
    }

    // FITS5001 / FITS5002: WCS astrometry validation
    lintWcsKeywords(header, hduIndex, diagnostics);
  }

  return diagnostics;
}

/**
 * Convenience helper to decode and lint a binary FITS buffer.
 */
export function lintFitsBinary(bytes: Uint8Array, uri?: string): FitsDiagnostic[] {
  const doc = decodeFitsBinary(bytes, uri);
  return lintFitsDocument(doc);
}
