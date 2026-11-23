// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/trasys — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NASA TRASYS thermal radiation decks (.tra, .trs, .trasys, .inp) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseTrasysDeck } from "./parser/deck-parser.js";

export const trasysIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".tra") || lower.endsWith(".trs") || lower.endsWith(".trasys")) {
      return true;
    }
    if (!text) return false;
    return /\bHEADER\s+(?:OPTIONS|SURFACE|ORBIT|OPERATIONS)\s+DATA\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseTrasysDeck(ctx.text);
    ctx.setParsedModel(deck);

    // Root TRASYS model symbol (Kind "Package")
    const rootId = ctx.addSymbol(
      deck.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        surfaceCount: deck.surfaces.length,
        hasOrbit: Boolean(deck.orbit),
      },
      {
        ruleName: "deck",
        namePath: "name",
      },
    );

    // Surface symbols (Kind "Class")
    for (const surf of deck.surfaces) {
      const label = `${surf.id} [${surf.kind}]`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        surf.startOffset ?? 0,
        surf.endOffset ?? 0,
        {
          surfaceId: surf.id,
          kind: surf.kind,
          nodeId: surf.nodeId,
          alpha: surf.prop.alpha,
          epsilon: surf.prop.epsilon,
        },
        {
          ruleName: "surface",
          namePath: "id",
          aliases: [surf.id],
        },
      );
    }

    // Orbit symbol if present
    if (deck.orbit) {
      ctx.addSymbol(
        `ORBIT [${deck.orbit.planet} ${deck.orbit.altitudeKm}km]`,
        "Property",
        rootId,
        0,
        0,
        {
          planet: deck.orbit.planet,
          altitudeKm: deck.orbit.altitudeKm,
          betaDeg: deck.orbit.betaDeg,
        },
        {
          ruleName: "orbit",
          namePath: "planet",
          aliases: ["ORBIT"],
        },
      );
    }
  },
};
