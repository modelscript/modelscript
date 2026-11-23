// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nec2 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes LLNL NEC-2 wire antenna decks (.nec, .nec2, .ant) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseNec2Deck } from "./parser/deck-parser.js";

export const nec2Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".nec") || lower.endsWith(".nec2") || lower.endsWith(".ant")) {
      return true;
    }
    if (!text) return false;
    return /^\s*(?:CM|CE|GW|GE|FR|EX)\b/im.test(text) && /^\s*GE\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseNec2Deck(ctx.text);
    ctx.setParsedModel(deck);

    // Antenna deck root symbol (Kind "Package")
    const rootId = ctx.addSymbol(
      deck.title,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        wireCount: deck.wires.length,
        frequencyCount: deck.frequencies.length,
      },
      {
        ruleName: "deck",
        namePath: "title",
      },
    );

    // Symbolic variables (SY)
    for (const sym of deck.symbolDefs) {
      ctx.addSymbol(
        sym.name,
        "Variable",
        rootId,
        sym.startOffset,
        sym.endOffset,
        { expression: sym.expression, value: sym.value },
        { ruleName: "symbol", namePath: "name" },
      );
    }

    // Wire elements (GW)
    for (const w of deck.wires) {
      const label = `Wire_${w.tag} (${w.segments} segs)`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        w.startOffset,
        w.endOffset,
        { tag: w.tag, segments: w.segments, radius: w.radius },
        { ruleName: "wire", namePath: "tag", aliases: [`GW_${w.tag}`, `tag_${w.tag}`] },
      );
    }

    // Arc elements (GA)
    for (const arc of deck.arcs) {
      ctx.addSymbol(
        `Arc_${arc.tag} (${arc.segments} segs)`,
        "Class",
        rootId,
        arc.startOffset,
        arc.endOffset,
        { tag: arc.tag, segments: arc.segments, arcRadius: arc.arcRadius },
        { ruleName: "arc", namePath: "tag" },
      );
    }

    // Excitations (EX)
    for (const ex of deck.excitations) {
      ctx.addSymbol(
        `EX_tag${ex.tag}_seg${ex.segment}`,
        "Function",
        rootId,
        ex.startOffset,
        ex.endOffset,
        { type: ex.type, tag: ex.tag, segment: ex.segment, vReal: ex.vReal, vImag: ex.vImag },
        { ruleName: "excitation", namePath: "tag" },
      );
    }
  },
};
