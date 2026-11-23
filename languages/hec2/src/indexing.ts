// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseHec2Deck } from "./parser/hec2-parser.js";
import type { Hec2Deck } from "./types.js";

/**
 * Indexes a USACE HEC-2 card deck file into ModelScript's `UnifiedWorkspace`.
 */
export function indexHec2File(ctx: DslIndexFileContext): void {
  const deck = parseHec2Deck(ctx.text);
  ctx.setParsedModel(deck, "hec2-deck");
  ctx.setParsedModel(deck);

  const rootTitle = deck.titles[0] || "HEC2_Deck";
  const rootId = ctx.addSymbol(rootTitle, "Package", null, 0, ctx.text.length, {
    units: deck.units,
    crossSectionCount: deck.crossSections.length,
    discharge: deck.jobCard?.q,
  });

  if (deck.jobCard) {
    ctx.addSymbol("J1_JobControl", "Variable", rootId, 0, 0, {
      q: deck.jobCard.q,
      wsel: deck.jobCard.wsel,
      strt: deck.jobCard.strt,
      line: deck.jobCard.line,
    });
  }

  for (const xs of deck.crossSections) {
    ctx.addSymbol(`XS_${xs.secno}`, "Component", rootId, 0, 0, {
      secno: xs.secno,
      numst: xs.numst,
      stchl: xs.stchl,
      stchr: xs.stchr,
      xlch: xs.xlch,
      manningChannel: xs.manning.channel,
      line: xs.line,
    });
  }
}

export const hec2Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".hc2") || lower.endsWith(".hec2")) {
      return true;
    }
    if (!text) return false;
    return /^(?:T1|J1|NC|X1|GR)\b/m.test(text) && /^X1\b/m.test(text);
  },
  indexFile: indexHec2File,
};

export function getHec2WorkspaceDecks(workspace: UnifiedWorkspace): Map<string, Hec2Deck> {
  return workspace.getAllParsedModels<Hec2Deck>("hec2-deck");
}
