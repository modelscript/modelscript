// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/stl — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseAsciiStl } from "./parser/ascii-parser.js";

export const stlIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    if (uri.toLowerCase().endsWith(".stl")) {
      return true;
    }
    if (!text) return false;
    return /^\s*solid\b/im.test(text) && /\bfacet\s+normal\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseAsciiStl(ctx.text);
    ctx.setParsedModel(doc);

    const rootName = doc.solids[0]?.name || doc.header || "stl_document";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        format: doc.format,
        solidCount: doc.solids.length,
        facetCount: doc.facets.length,
      },
      {
        ruleName: "StlFile",
        namePath: rootName,
      },
    );

    for (let i = 0; i < doc.solids.length; i++) {
      const solid = doc.solids[i]!;
      const solidName = solid.name || `solid_${i}`;
      ctx.addSymbol(
        solidName,
        "Class",
        rootId,
        solid.startOffset ?? 0,
        solid.endOffset ?? ctx.text.length,
        {
          facetCount: solid.facets.length,
          closed: solid.closed,
        },
        {
          ruleName: "SolidBlock",
          namePath: solidName,
          aliases: [solidName],
        },
      );
    }
  },
};
