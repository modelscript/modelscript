// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseAspen } from "./parser/aspen-parser.js";
import type { AspenDeck } from "./types.js";

/**
 * Disambiguates Aspen Plus `.in` / `.inp` decks in polyglot `UnifiedWorkspace` instances.
 */
export function canIndexAspen(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".bkp") || lower.endsWith(".aspen.inp") || lower.endsWith(".in")) {
    return true;
  }
  if (!text) return lower.endsWith(".inp");
  return /\b(?:IN-UNITS|DEF-STREAMS|FLOWSHEET|COMPONENTS)\b/i.test(text);
}

/**
 * Declarative per-file indexer for Aspen Plus process flowsheets (`.in`, `.inp`, `.bkp`).
 */
export function indexAspenDocument(ctx: DslIndexFileContext): void {
  const { text } = ctx;
  try {
    const deck = parseAspen(text);
    ctx.setParsedModel<AspenDeck>(deck);

    const rootId = ctx.addSymbol(
      deck.title ?? "AspenProcess",
      "package",
      null,
      deck.loc?.startOffset ?? 0,
      deck.loc?.endOffset ?? text.length,
      {},
      { ruleName: "aspen_symbol" },
    );

    for (const [cId, comp] of deck.components) {
      ctx.addSymbol(
        cId,
        "variable",
        rootId,
        comp.loc.startOffset,
        comp.loc.endOffset,
        {},
        { ruleName: "aspen_symbol" },
      );
    }

    for (const [bId, block] of deck.blocks) {
      ctx.addSymbol(bId, "class", rootId, block.loc.startOffset, block.loc.endOffset, {}, { ruleName: "aspen_symbol" });
    }

    for (const [sId, stream] of deck.streams) {
      ctx.addSymbol(
        sId,
        "field",
        rootId,
        stream.loc.startOffset,
        stream.loc.endOffset,
        {},
        { ruleName: "aspen_symbol" },
      );
    }
  } catch {
    // If parsing fails during index, leave empty symbol table
  }
}

/**
 * Retrieves a parsed `AspenDeck` from `UnifiedWorkspace` for `uri`.
 */
export function getAspenDeck(workspace: UnifiedWorkspace, uri: string): AspenDeck | undefined {
  return workspace.getParsedModel<AspenDeck>(uri);
}
