// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseWorkspaceIndex, type SymbolIndex } from "@modelscript/runtime";
import { parseSwmm } from "./parser/swmm-parser.js";
import type { SwmmDeck } from "./types.js";

/**
 * Multi-file workspace indexer for US EPA SWMM 5.x (.inp) network decks.
 */
export class SwmmWorkspaceIndex extends BaseWorkspaceIndex<SwmmDeck> {
  public readonly languageName = "swmm";

  public indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol } = this.createIndexContext(uri);

    try {
      const deck = parseSwmm(text);
      this.fileDecks.set(uri, deck);

      // Root Network symbol
      const rootId = addSymbol(
        deck.title ?? "SwmmNetwork",
        "package",
        null,
        deck.range?.startOffset ?? 0,
        deck.range?.endOffset ?? text.length,
      );

      // Index Junctions
      for (const [id, j] of deck.junctions) {
        addSymbol(id, "variable", rootId, j.range.startOffset, j.range.endOffset);
      }

      // Index Outfalls
      for (const [id, o] of deck.outfalls) {
        addSymbol(id, "variable", rootId, o.range.startOffset, o.range.endOffset);
      }

      // Index Conduits
      for (const [id, c] of deck.conduits) {
        addSymbol(id, "class", rootId, c.range.startOffset, c.range.endOffset);
      }

      // Index Pumps
      for (const [id, p] of deck.pumps) {
        addSymbol(id, "class", rootId, p.range.startOffset, p.range.endOffset);
      }

      // Index Subcatchments
      for (const [id, sc] of deck.subcatchments) {
        addSymbol(id, "field", rootId, sc.range.startOffset, sc.range.endOffset);
      }
    } catch {
      // If parsing fails, preserve empty symbol table
    }

    return this.getFileIndex(uri)!;
  }
}
