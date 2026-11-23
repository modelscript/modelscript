// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/hec1 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes USACE HEC-1 Flood Hydrograph Package card decks (.hec1, .h1, .ihc, .dat, .inp)
 * into ModelScript's UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseHec1Deck } from "./parser/deck-parser.js";

export const hec1Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".hec1") || lower.endsWith(".h1") || lower.endsWith(".ihc")) {
      return true;
    }
    if (!text) return false;
    return /^\s*ID\b/im.test(text) && /^\s*IT\b/im.test(text) && /^\s*KK\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseHec1Deck(ctx.text);
    ctx.setParsedModel(deck);

    const deckName = deck.titleLines[0] ?? "HEC1_Watershed";
    const rootId = ctx.addSymbol(
      deckName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        unitSystem: deck.unitSystem,
        stationCount: deck.stationList.length,
      },
      {
        ruleName: "Deck",
        namePath: "name",
      },
    );

    for (const st of deck.stationList) {
      const label = `${st.id} [${st.kind}]`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        st.startOffset,
        st.endOffset,
        {
          stationId: st.id,
          kind: st.kind,
          area: st.area,
        },
        {
          ruleName: "StationCard",
          namePath: "id",
          aliases: [st.id],
        },
      );
    }
  },
};
