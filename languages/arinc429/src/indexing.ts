// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `@modelscript/arinc429` — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseArinc429 } from "./parser/schema-parser.js";

export const arinc429Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".a429") || lower.endsWith(".arinc429") || lower.endsWith(".429")) {
      return true;
    }
    if (!text) return false;
    return /^\s*BUS\s+\S+/im.test(text) && /^\s*(?:LABEL|RATE|FRAME|WORD)\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseArinc429(ctx.text);
    ctx.setParsedModel(doc);

    const busRootId = ctx.addSymbol(
      doc.busName,
      "Package",
      null,
      0,
      ctx.text.length,
      { rate: doc.rate },
      {
        ruleName: "BusDecl",
        namePath: "name",
      },
    );

    for (const label of doc.labels) {
      const symbolName = `${label.labelOctal} ${label.name}`;
      ctx.addSymbol(
        symbolName,
        "Class",
        busRootId,
        label.startOffset ?? 0,
        label.endOffset ?? 0,
        {
          labelOctal: label.labelOctal,
          encoding: label.encoding,
          units: label.units,
        },
        {
          ruleName: "LabelDecl",
          namePath: "name",
          aliases: [label.name, label.labelOctal],
        },
      );
    }
  },
};
