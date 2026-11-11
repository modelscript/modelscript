// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseSwmm } from "./parser/swmm-parser.js";

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
      ctx.addSymbol(id, "variable", rootId, j.range.startOffset, j.range.endOffset);
    }

    for (const [id, o] of deck.outfalls) {
      ctx.addSymbol(id, "variable", rootId, o.range.startOffset, o.range.endOffset);
    }

    for (const [id, c] of deck.conduits) {
      ctx.addSymbol(id, "class", rootId, c.range.startOffset, c.range.endOffset);
    }

    for (const [id, p] of deck.pumps) {
      ctx.addSymbol(id, "class", rootId, p.range.startOffset, p.range.endOffset);
    }

    for (const [id, sc] of deck.subcatchments) {
      ctx.addSymbol(id, "field", rootId, sc.range.startOffset, sc.range.endOffset);
    }
  } catch {
    // Preserve empty symbol table if parsing fails
  }
}
