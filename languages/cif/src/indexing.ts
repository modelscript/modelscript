// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cif — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Caltech Intermediate Form 2.0 (.cif) IC layout files into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseCif } from "./parser/cif-parser.js";

export const cifIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".cif")) {
      return true;
    }
    if (!text) return false;
    return /^\s*DS\s+\d+/im.test(text) && /\bDF\s*;/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseCif(ctx.text);
    ctx.setParsedModel(doc);

    const rootName =
      ctx.uri
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.cif$/i, "") || "CifLayout";

    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        symbolCount: doc.symbols.size,
        commandCount: doc.allCommands.length,
      },
      {
        ruleName: "Document",
        namePath: "name",
      },
    );

    for (const symId of doc.symbolOrder) {
      const sym = doc.symbols.get(symId);
      if (!sym) continue;
      const displayName = sym.name ? `${sym.name} (DS ${sym.id})` : `DS_${sym.id}`;
      ctx.addSymbol(
        displayName,
        "Class",
        rootId,
        sym.startOffset,
        sym.endOffset,
        {
          symbolId: sym.id,
          scaleA: sym.scaleA,
          scaleB: sym.scaleB,
          commandCount: sym.commands.length,
        },
        {
          ruleName: "DefStartCommand",
          namePath: "symbolId",
          aliases: sym.name ? [sym.name, String(sym.id)] : [String(sym.id)],
        },
      );
    }
  },
};
