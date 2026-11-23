// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseMcnpDeck } from "./parser/deck-parser.js";

export const mcnpIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".mcnp") || lower.endsWith(".mcnp5") || lower.endsWith(".mcnp6")) {
      return true;
    }
    if (!text) return false;
    return /\bIMP:[NPE]/i.test(text) && (/\b(?:SDEF|KCODE|NPS)\b/i.test(text) || /\bM\d+\s+\d{4,6}/i.test(text));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseMcnpDeck(ctx.text);
    ctx.setParsedModel(deck);

    const rootId = ctx.addSymbol(
      deck.title || "MCNP Deck",
      "Package",
      null,
      0,
      ctx.text.length,
      { mode: deck.mode.join(" ") },
      { ruleName: "Deck", namePath: "title" },
    );

    for (const cell of deck.cells.values()) {
      ctx.addSymbol(
        `Cell ${cell.id} [M${cell.materialId}]`,
        "Class",
        rootId,
        cell.startOffset,
        cell.endOffset,
        { cellId: cell.id, materialId: cell.materialId, density: cell.density },
        { ruleName: "CellCard", namePath: "id", aliases: [`cell_${cell.id}`] },
      );
    }

    for (const surf of deck.surfaces.values()) {
      ctx.addSymbol(
        `Surface ${surf.id} [${surf.type}]`,
        "Interface",
        rootId,
        surf.startOffset,
        surf.endOffset,
        { surfaceId: surf.id, type: surf.type },
        { ruleName: "SurfaceCard", namePath: "id", aliases: [`surf_${surf.id}`] },
      );
    }

    for (const mat of deck.materials.values()) {
      ctx.addSymbol(
        `M${mat.id}`,
        "Constant",
        rootId,
        mat.startOffset,
        mat.endOffset,
        { materialId: mat.id, isotopeCount: mat.isotopes.length },
        { ruleName: "MaterialCard", namePath: "id", aliases: [`M${mat.id}`] },
      );
    }

    for (const tally of deck.tallies.values()) {
      ctx.addSymbol(
        `F${tally.id}:${tally.particle}`,
        "Function",
        rootId,
        tally.startOffset,
        tally.endOffset,
        { tallyId: tally.id, type: tally.type, particle: tally.particle },
        { ruleName: "TallyCard", namePath: "id", aliases: [`F${tally.id}`] },
      );
    }
  },
};
