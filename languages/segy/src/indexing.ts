// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/segy — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes SEG-Y textual reel headers (.sgy, .segy, .sgyhdr) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSegyTextualHeader } from "./parser/textual-header.js";

export const segyIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sgy") || lower.endsWith(".segy") || lower.endsWith(".sgyhdr")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*C\s*1\b/im.test(text) && /\b(?:CLIENT|LINE|AREA|SAMPLE\s+INTERVAL|END\s+TEXTUAL\s+HEADER)\b/i.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const header = parseSegyTextualHeader(ctx.text);
    ctx.setParsedModel(header);

    const rootName = header.line ?? header.client ?? "SEGY_HEADER";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        client: header.client,
        line: header.line,
        area: header.area,
        revision: header.revision,
      },
      {
        ruleName: "TextualHeader",
        namePath: "name",
      },
    );

    let offset = 0;
    const lines = ctx.text.split(/\r?\n/);
    for (const card of header.cards) {
      const rawLine = lines[card.line - 1] ?? card.raw;
      const start = offset;
      const end = start + rawLine.length;
      offset = end + 1;

      if (card.key) {
        ctx.addSymbol(
          `${card.key}: ${card.value ?? ""}`.trim(),
          "Field",
          rootId,
          start,
          end,
          {
            cardNumber: card.cardNumber,
            key: card.key,
            value: card.value,
          },
          {
            ruleName: "Card",
            namePath: "key",
            aliases: [card.key, `C${card.cardNumber}`],
          },
        );
      }
    }
  },
};
