// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/datcom — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes USAF Stability and Control Digital DATCOM decks (.dcm, .dat, .inp) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseDatcomDeck } from "./parser/deck-parser.js";

export const datcomIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dcm") || lower.endsWith(".datcom")) {
      return true;
    }
    if (!text) return false;
    return (
      /\$(?:FLTCON|WGPLNF|SYNTHS|OPTINS|HTPLNF|VTPLNF|BODY)\b/i.test(text) || /^\s*NACA-[WHVF]-[456]-/im.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseDatcomDeck(ctx.text);
    ctx.setParsedModel(deck);

    for (const c of deck.cases) {
      const caseRootId = ctx.addSymbol(
        c.caseId,
        "Package",
        null,
        c.startOffset,
        c.endOffset,
        {
          dim: c.dim,
          deriv: c.deriv,
          namelistCount: c.namelists.length,
        },
        {
          ruleName: "case",
          namePath: "caseId",
        },
      );

      for (const nl of c.namelists) {
        ctx.addSymbol(
          `$${nl.group}`,
          "Class",
          caseRootId,
          nl.startOffset,
          nl.endOffset,
          {
            group: nl.group,
            keys: Object.keys(nl.values),
          },
          {
            ruleName: "namelist",
            namePath: "group",
            aliases: [nl.group],
          },
        );
      }

      for (const naca of c.nacaCards) {
        ctx.addSymbol(
          naca.raw,
          "Constant",
          caseRootId,
          c.startOffset,
          c.endOffset,
          {
            surface: naca.surface,
            series: naca.series,
            designation: naca.designation,
          },
          {
            ruleName: "naca",
            namePath: "designation",
          },
        );
      }
    }
  },
};
