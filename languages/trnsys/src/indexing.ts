// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/trnsys — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes TRNSYS simulation decks (.dck) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseTrnsysDeck } from "./parser/deck-parser.js";

export const trnsysIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dck") || lower.endsWith(".trd")) {
      return true;
    }
    if (!text) return false;
    return /^\s*SIMULATION\b/im.test(text) && /^\s*UNIT\s+\d+\s+TYPE\s+\d+/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const deck = parseTrnsysDeck(ctx.text);
    ctx.setParsedModel(deck);

    const rootId = ctx.addSymbol(
      deck.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        version: deck.version,
        unitCount: deck.units.length,
      },
      {
        ruleName: "Deck",
        namePath: "name",
      },
    );

    for (const c of deck.constants) {
      ctx.addSymbol(
        c.name,
        "Constant",
        rootId,
        c.startOffset,
        c.endOffset,
        { expression: c.expression, value: c.value },
        { ruleName: "ConstantAssignment", namePath: "name" },
      );
    }

    for (const block of deck.equationBlocks) {
      for (const eq of block.equations) {
        ctx.addSymbol(
          eq.name,
          "Variable",
          rootId,
          eq.startOffset,
          eq.endOffset,
          { expression: eq.expression, value: eq.value },
          { ruleName: "EquationAssignment", namePath: "name" },
        );
      }
    }

    for (const unit of deck.units) {
      const label = unit.label
        ? `UNIT ${unit.unitNumber} TYPE ${unit.typeNumber} (${unit.label})`
        : `UNIT ${unit.unitNumber} TYPE ${unit.typeNumber}`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        unit.startOffset,
        unit.endOffset,
        {
          unitNumber: unit.unitNumber,
          typeNumber: unit.typeNumber,
          label: unit.label,
        },
        {
          ruleName: "UnitBlock",
          namePath: "name",
          aliases: [`UNIT_${unit.unitNumber}`, `TYPE_${unit.typeNumber}`],
        },
      );
    }
  },
};
