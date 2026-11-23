// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Declarative Multi-File Workspace Indexing.
 *
 * Indexes FITS headers and datasets (`.fits`, `.fit`, `.fts`, `.fits.hdr`) into `UnifiedWorkspace`.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseFitsHeaderText } from "./parser/header-parser.js";
import { extractWcsFromHeader } from "./solver/wcs.js";
import type { FitsDocument } from "./types.js";

/**
 * Predicate to identify FITS documents by file extension or leading `SIMPLE = T` header card.
 */
export function canIndexFits(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".fits") || lower.endsWith(".fit") || lower.endsWith(".fts") || lower.endsWith(".hdr")) {
    return true;
  }
  if (!text) return false;
  return /^\s*SIMPLE\s*=\s*T\b/m.test(text);
}

/**
 * Indexes all HDUs, WCS projections, and key metadata cards of a FITS document into `UnifiedWorkspace`.
 */
export function indexFitsDocument(ctx: DslIndexFileContext): void {
  const doc = parseFitsHeaderText(ctx.text, ctx.uri);
  ctx.setParsedModel<FitsDocument>(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: SymbolId | null = null,
    extra?: Record<string, unknown>,
  ): SymbolId =>
    ctx.addSymbol(name, kind, parentId, 0, ctx.text.length, extra ?? {}, {
      ruleName: `fits_${kind}`,
    });

  const primary = doc.hdus[0];
  const rootName =
    (typeof primary?.header.keywords["OBJECT"]?.value === "string"
      ? primary.header.keywords["OBJECT"]!.value
      : undefined) ??
    primary?.name ??
    "FITS_Document";

  const rootId = addSym(rootName, "fits_file", null, {
    hduCount: doc.hdus.length,
    isBinary: doc.isBinary,
  });

  for (const hdu of doc.hdus) {
    const hduId = addSym(hdu.name ?? `HDU_${hdu.index}`, "fits_hdu", rootId, {
      hduIndex: hdu.index,
      kind: hdu.kind,
      bitpix: hdu.header.keywords["BITPIX"]?.value ?? null,
      naxis: hdu.header.keywords["NAXIS"]?.value ?? null,
    });

    const wcs = extractWcsFromHeader(hdu.header);
    if (wcs) {
      addSym(`WCS_${wcs.projection}`, "fits_wcs", hduId, {
        projection: wcs.projection,
        crval1: wcs.crval1,
        crval2: wcs.crval2,
        crpix1: wcs.crpix1,
        crpix2: wcs.crpix2,
      });
    }

    for (const card of hdu.header.cards) {
      if (card.keyword === "" || card.keyword === "END" || card.keyword === "COMMENT" || card.keyword === "HISTORY") {
        continue;
      }
      if (
        card.keyword === "SIMPLE" ||
        card.keyword === "XTENSION" ||
        card.keyword === "BITPIX" ||
        card.keyword === "NAXIS" ||
        card.keyword === "BSCALE" ||
        card.keyword === "BZERO" ||
        card.keyword === "TFIELDS" ||
        card.keyword.startsWith("CTYPE") ||
        card.keyword.startsWith("CRVAL") ||
        card.keyword.startsWith("TTYPE")
      ) {
        addSym(card.keyword, "fits_keyword", hduId, {
          value: card.value,
          comment: card.comment,
          line: card.line,
        });
      }
    }
  }
}

export const fitsIndexing: LanguageIndexingConfig = {
  canIndex: canIndexFits,
  indexFile: indexFitsDocument,
};

/**
 * Retrieves the parsed `FitsDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getFitsDocument(workspace: UnifiedWorkspace, uri: string): FitsDocument | undefined {
  return workspace.getParsedModel<FitsDocument>(uri);
}

/**
 * Finds all indexed FITS symbols matching `kind` across `workspace`.
 */
export function findFitsSymbolsByType(workspace: UnifiedWorkspace, kind: string): SymbolEntry[] {
  return workspace.getSymbolsForUri().filter((sym) => sym.kind === kind || sym.ruleName === `fits_${kind}`);
}
