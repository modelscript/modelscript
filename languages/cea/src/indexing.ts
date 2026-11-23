// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NASA CEA problem decks (.cea, .inp) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseCeaDeck } from "./parser/cea-parser.js";

export const ceaIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".cea")) return true;
    if (!text) return false;
    return /\b(?:problem|prob)\b/i.test(text) && /\b(?:reactants|reac)\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseCeaDeck(ctx.text);
    ctx.setParsedModel(deck);

    const rootId = ctx.addSymbol(
      deck.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        problemType: deck.problem.problemType ?? "hp",
        equilibrium: deck.problem.equilibrium,
        frozen: deck.problem.frozen,
      },
      {
        ruleName: "cea_deck",
        namePath: "name",
      },
    );

    for (const r of deck.reactants) {
      const label = `${r.role}:${r.name}`;
      ctx.addSymbol(
        label,
        "Component",
        rootId,
        r.startOffset,
        r.endOffset,
        {
          role: r.role,
          species: r.name,
          wtPercent: r.wtPercent,
          moles: r.moles,
          temperatureK: r.temperatureK,
        },
        {
          ruleName: "reactant",
          namePath: "name",
          aliases: [r.name],
        },
      );
    }
  },
};
