// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseSwmm } from "./parser/swmm-parser.js";

const SWMM_CST_KIND_MAP: Record<string, string> = {
  IniSectionHeader: "section",
  IniRecord: "record",
};

const SWMM_CST_NAME_FIELDS = ["head", "sectionName", "name", "id"];

/**
 * Content predicate for disambiguating US EPA SWMM 5.x (`.inp`) decks from other `.inp` formats.
 */
export function canIndexSwmmFile(uri: string, text = ""): boolean {
  if (/\.swmm(?:\.inp)?$/i.test(uri)) return true;
  return /^\s*\[(?:SUBCATCHMENTS|CONDUITS|OUTFALLS|XSECTIONS|RAINGAGES|POLLUTANTS|LANDUSES|INFILTRATION)\]/im.test(
    text,
  );
}

/**
 * Declarative `UnifiedWorkspace` file indexer for US EPA SWMM 5.x (`.inp`, `.swmm`) network decks.
 */
export function indexSwmmFile(ctx: DslIndexFileContext): void {
  const cstRoot = extractValidWasmCstRoot(ctx.tree);
  const cstSymbols = cstRoot
    ? indexSymbolsFromWasmCst(cstRoot, ctx.text, {
        kindMap: SWMM_CST_KIND_MAP,
        nameFields: SWMM_CST_NAME_FIELDS,
      })
    : null;
  const cstByName = new Map<string, WasmCstIndexedSymbol>();
  if (cstSymbols) {
    for (const sym of cstSymbols) {
      const lower = sym.name.toLowerCase();
      if (!cstByName.has(lower)) cstByName.set(lower, sym);
    }
  }

  const addWithCst = (
    name: string,
    kind: string,
    parentId: number | null,
    fallbackStart: number,
    fallbackEnd: number,
  ): number => {
    const cst = cstByName.get(name.toLowerCase());
    return ctx.addSymbol(
      name,
      kind,
      parentId,
      cst?.startOffset ?? fallbackStart,
      cst?.endOffset ?? fallbackEnd,
      undefined,
      cst
        ? {
            nameStartOffset: cst.nameStartOffset,
            nameEndOffset: cst.nameEndOffset,
            fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
          }
        : undefined,
    );
  };

  try {
    const deck = parseSwmm(ctx.text);
    ctx.setParsedModel(deck);

    const rootId = ctx.addSymbol(
      deck.title ?? "SwmmNetwork",
      "package",
      null,
      deck.range?.startOffset ?? 0,
      deck.range?.endOffset ?? ctx.text.length,
    );

    for (const [id, j] of deck.junctions) {
      addWithCst(id, "variable", rootId, j.range.startOffset, j.range.endOffset);
    }

    for (const [id, o] of deck.outfalls) {
      addWithCst(id, "variable", rootId, o.range.startOffset, o.range.endOffset);
    }

    for (const [id, c] of deck.conduits) {
      addWithCst(id, "class", rootId, c.range.startOffset, c.range.endOffset);
    }

    for (const [id, p] of deck.pumps) {
      addWithCst(id, "class", rootId, p.range.startOffset, p.range.endOffset);
    }

    for (const [id, sc] of deck.subcatchments) {
      addWithCst(id, "field", rootId, sc.range.startOffset, sc.range.endOffset);
    }
  } catch {
    if (cstSymbols && cstSymbols.length > 0) {
      const rootId = ctx.addSymbol("SwmmNetwork", "package", null, 0, ctx.text.length);
      for (const sym of cstSymbols) {
        ctx.addSymbol(sym.name, sym.kind, rootId, sym.startOffset, sym.endOffset, undefined, {
          nameStartOffset: sym.nameStartOffset,
          nameEndOffset: sym.nameEndOffset,
          fieldRanges: { name: { startOffset: sym.nameStartOffset, endOffset: sym.nameEndOffset } },
        });
      }
    }
  }
}
