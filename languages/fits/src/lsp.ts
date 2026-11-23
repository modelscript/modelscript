// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostics (`validateFits`), outline symbols (`getFitsDocumentSymbols`),
 * keyword hover documentation (`getFitsHover`), and keyword completions (`getFitsCompletions`).
 */

import { getFitsSchemasFromLibraries, lookupFitsKeywordSchema } from "./catalog/library-package-adapter.js";
import { lintFitsDocument } from "./lints/index.js";
import { parseFitsHeaderText } from "./parser/header-parser.js";
import type { FitsDocument } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Property = 7,
  Field = 8,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Key = 20,
  Struct = 23,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: string | number;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

const KEYWORD_DOCS: Record<string, string> = {
  SIMPLE: "**SIMPLE** (`Boolean`): Mandatory first keyword of a Primary HDU (`T` = conforms to FITS 4.0).",
  BITPIX:
    "**BITPIX** (`Integer`): Bits per pixel: `8`, `16`, `32`, `64` (signed/unsigned integer) or `-32`, `-64` (IEEE 754 float).",
  NAXIS: "**NAXIS** (`Integer`): Number of axes in the data array (`0..999`). Followed by `NAXIS1`..`NAXISn`.",
  NAXIS1: "**NAXIS1** (`Integer`): Number of elements along axis 1 (image width or table row byte width).",
  NAXIS2: "**NAXIS2** (`Integer`): Number of elements along axis 2 (image height or table row count).",
  EXTEND: "**EXTEND** (`Boolean`): If `T`, the FITS file may contain extension HDUs following the Primary HDU.",
  XTENSION:
    "**XTENSION** (`String`): Mandatory first keyword of an extension HDU (`'IMAGE'`, `'TABLE'`, `'BINTABLE'`).",
  PCOUNT: "**PCOUNT** (`Integer`): Number of random group parameters or heap bytes following main data table.",
  GCOUNT:
    "**GCOUNT** (`Integer`): Number of data groups (`1` for standard `IMAGE`, `TABLE`, and `BINTABLE` extensions).",
  BSCALE: "**BSCALE** (`Float`): Linear physical scaling factor (`physical = BZERO + BSCALE * raw`). Must be non-zero.",
  BZERO: "**BZERO** (`Float`): Physical zero-point offset (`32768` for unsigned 16-bit integer convention).",
  TFIELDS: "**TFIELDS** (`Integer`): Number of columns (fields) per row in a `TABLE` or `BINTABLE` extension.",
  CTYPE1:
    "**CTYPE1** (`String`): Axis 1 WCS coordinate type and projection (e.g. `'RA---TAN'`, `'RA---SIN'`, `'RA---ARC'`).",
  CTYPE2:
    "**CTYPE2** (`String`): Axis 2 WCS coordinate type and projection (e.g. `'DEC--TAN'`, `'DEC--SIN'`, `'DEC--ARC'`).",
  CRVAL1: "**CRVAL1** (`Float`): Reference world coordinate (Right Ascension in degrees) at `CRPIX1`.",
  CRVAL2: "**CRVAL2** (`Float`): Reference world coordinate (Declination in degrees) at `CRPIX2`.",
  CRPIX1: "**CRPIX1** (`Float`): 1-based reference pixel coordinate along axis 1.",
  CRPIX2: "**CRPIX2** (`Float`): 1-based reference pixel coordinate along axis 2.",
  CDELT1: "**CDELT1** (`Float`): Coordinate increment per pixel along axis 1 (deg/pixel).",
  CDELT2: "**CDELT2** (`Float`): Coordinate increment per pixel along axis 2 (deg/pixel).",
  CD1_1: "**CD1_1** (`Float`): WCS linear transformation matrix element `(1,1)` in deg/pixel.",
  CD1_2: "**CD1_2** (`Float`): WCS linear transformation matrix element `(1,2)` in deg/pixel.",
  CD2_1: "**CD2_1** (`Float`): WCS linear transformation matrix element `(2,1)` in deg/pixel.",
  CD2_2: "**CD2_2** (`Float`): WCS linear transformation matrix element `(2,2)` in deg/pixel.",
  HISTORY: "**HISTORY** (`Commentary`): Processing history record (no `=` value indicator).",
  COMMENT: "**COMMENT** (`Commentary`): Free-form descriptive header comment (no `=` value indicator).",
  END: "**END**: Mandatory terminator card of every FITS HDU header.",
};

/**
 * Validates textual FITS header content and returns LSP diagnostics.
 */
export function validateFits(content: string, uri?: string): LspDiagnostic[] {
  let doc: FitsDocument;
  try {
    doc = parseFitsHeaderText(content, uri);
  } catch (err: unknown) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "FITS1001",
        source: "fits-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  return lintFitsDocument(doc).map((d) => ({
    range: {
      start: {
        line: Math.max(0, d.range.startLine - 1),
        character: Math.max(0, d.range.startColumn - 1),
      },
      end: {
        line: Math.max(0, d.range.endLine - 1),
        character: Math.max(0, d.range.endColumn - 1),
      },
    },
    severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
    code: d.code,
    source: "fits-linter",
    message: d.message,
  }));
}

/**
 * Returns hierarchical LSP document symbols (HDUs -> Header Cards).
 */
export function getFitsDocumentSymbols(content: string, uri?: string): LspDocumentSymbol[] {
  const doc = parseFitsHeaderText(content, uri);
  return doc.hdus.map((hdu) => {
    const firstLine = Math.max(0, (hdu.header.cards[0]?.line ?? 1) - 1);
    const lastLine = Math.max(firstLine, (hdu.header.cards[hdu.header.cards.length - 1]?.line ?? 1) - 1);
    const hduRange: LspRange = {
      start: { line: firstLine, character: 0 },
      end: { line: lastLine, character: 80 },
    };

    const children: LspDocumentSymbol[] = hdu.header.cards
      .filter((c) => c.keyword !== "" && c.keyword !== "END")
      .map((card) => {
        const line0 = Math.max(0, card.line - 1);
        const cardRange: LspRange = {
          start: { line: line0, character: 0 },
          end: { line: line0, character: Math.max(1, card.raw.length) },
        };
        return {
          name: card.keyword,
          detail: card.value !== null ? String(card.value) : card.comment,
          kind:
            card.valueType === "boolean"
              ? LspSymbolKind.Boolean
              : card.valueType === "integer" || card.valueType === "float"
                ? LspSymbolKind.Number
                : card.valueType === "string"
                  ? LspSymbolKind.String
                  : LspSymbolKind.Key,
          range: cardRange,
          selectionRange: {
            start: { line: line0, character: 0 },
            end: { line: line0, character: Math.min(8, card.keyword.length) },
          },
        };
      });

    return {
      name: `${hdu.name ?? `HDU_${hdu.index}`} (${hdu.kind})`,
      detail: `BITPIX=${String(hdu.header.keywords["BITPIX"]?.value ?? "?")} NAXIS=${String(hdu.header.keywords["NAXIS"]?.value ?? "?")}`,
      kind: LspSymbolKind.Struct,
      range: hduRange,
      selectionRange: {
        start: { line: firstLine, character: 0 },
        end: { line: firstLine, character: 8 },
      },
      children,
    };
  });
}

/**
 * Returns hover documentation for the FITS keyword at `position`.
 */
export function getFitsHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const lineText = lines[position.line];
  if (!lineText) return null;

  const eqIdx = lineText.indexOf("=");
  const rawKw = (eqIdx > 0 ? lineText.slice(0, eqIdx) : lineText.slice(0, 8)).trim().toUpperCase();
  if (!rawKw) return null;

  const docText = KEYWORD_DOCS[rawKw];
  if (docText) {
    return {
      contents: { kind: "markdown", value: docText },
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: Math.min(lineText.length, Math.max(8, rawKw.length)) },
      },
    };
  }

  const schema = lookupFitsKeywordSchema(rawKw);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}**\n\n${schema.description}\n\n*Provenance*: ${schema.provenance}`,
      },
      range: {
        start: { line: position.line, character: 0 },
        end: { line: position.line, character: Math.min(lineText.length, Math.max(8, rawKw.length)) },
      },
    };
  }

  return null;
}

/**
 * Returns FITS 4.0 and WCS keyword completion items filtered by optional prefix.
 */
export function getFitsCompletions(prefix = ""): LspCompletionItem[] {
  const upper = prefix.trim().toUpperCase();
  const seen = new Set<string>();
  const items: LspCompletionItem[] = [];

  for (const [kw, doc] of Object.entries(KEYWORD_DOCS)) {
    if (upper && !kw.startsWith(upper)) continue;
    seen.add(kw);
    items.push({
      label: kw,
      detail: "FITS 4.0 Keyword",
      documentation: doc,
      insertText: kw === "END" || kw === "HISTORY" || kw === "COMMENT" ? `${kw} ` : `${kw.padEnd(8, " ")}= `,
    });
  }

  for (const schema of getFitsSchemasFromLibraries()) {
    const kw = schema.name.toUpperCase();
    if (seen.has(kw)) continue;
    if (upper && !kw.startsWith(upper)) continue;
    seen.add(kw);
    items.push({
      label: kw,
      detail: schema.category,
      documentation: schema.description,
      insertText: kw,
    });
  }

  return items;
}
