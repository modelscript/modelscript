// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseTough } from "./parser/index.js";

/**
 * Content predicate for disambiguating LBNL TOUGH2/TOUGH3 decks across shared `.dat` extensions.
 */
export function canIndexToughFile(uri: string, text = ""): boolean {
  if (/\.(?:tough|tgh)$/i.test(uri)) return true;
  return /^\s*(?:ROCKS|ELEME|CONNE|GENER|INCON|PARAM|MULTI)\b/im.test(text);
}

/**
 * Declarative `UnifiedWorkspace` file indexer for LBNL TOUGH2/TOUGH3 reservoir decks (`.tough`, `.dat`, `.tgh`).
 */
export function indexToughFile(ctx: DslIndexFileContext): void {
  try {
    const deck = parseTough(ctx.text);
    ctx.setParsedModel(deck);

    const rootName = deck.title || "TOUGH_Reservoir";
    const rootId = ctx.addSymbol(rootName, "package", null, 0, ctx.text.length, {}, { ruleName: "tough_symbol" });

    for (const r of deck.rocks) {
      ctx.addSymbol(
        r.name,
        "class",
        rootId,
        0,
        50,
        { porosity: r.porosity, density: r.density },
        { ruleName: "tough_symbol" },
      );
    }
    for (const el of deck.elements) {
      ctx.addSymbol(
        el.name,
        "variable",
        rootId,
        0,
        50,
        { rock: el.rockName, volume: el.volume },
        { ruleName: "tough_symbol" },
      );
    }
    for (const g of deck.generators) {
      ctx.addSymbol(
        g.name || `GEN_${g.elem}`,
        "function",
        rootId,
        0,
        50,
        { type: g.type, rate: g.rate },
        { ruleName: "tough_symbol" },
      );
    }
  } catch {
    // Preserve empty symbol table on parse failure
  }
}
