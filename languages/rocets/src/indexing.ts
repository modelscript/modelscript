// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/rocets — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NASA ROCETS engine models (.roc, .rct, .inp, .dat, .deck) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseRocetsDeck } from "./parser/deck-parser.js";

export const rocetsIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".roc") || lower.endsWith(".rct") || lower.endsWith(".deck")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*(?:DECK|MODEL|ENGINE)\s*:/im.test(text) ||
      (/\bCOMPONENTS\s*:/i.test(text) && /\bCONNECTIONS\s*:/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseRocetsDeck(ctx.text);
    ctx.setParsedModel(model);

    // Engine Model root symbol (Kind "Package")
    const modelRootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {},
      {
        ruleName: "module",
        namePath: "name",
      },
    );

    // Module symbols (Kind "Class")
    for (const [compId, comp] of model.components) {
      const label = `${compId} [${comp.type}]`;
      ctx.addSymbol(
        label,
        "Class",
        modelRootId,
        comp.startOffset ?? 0,
        comp.endOffset ?? 0,
        {
          componentId: compId,
          type: comp.type,
        },
        {
          ruleName: "module",
          namePath: "name",
          aliases: [compId],
        },
      );
    }
  },
};
