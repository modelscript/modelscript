// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jcamp-dx — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseJcampDx } from "./parser/jcamp-parser.js";

export const jcampDxIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".jdx") || lower.endsWith(".dx") || lower.endsWith(".jcamp")) {
      return true;
    }
    if (!text) return false;
    return /^##TITLE=/m.test(text) && /^##JCAMP-DX=/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseJcampDx(ctx.text);
    ctx.setParsedModel(doc);

    for (const block of doc.blocks) {
      const rootId = ctx.addSymbol(
        block.title || "Untitled Spectrum",
        "Package",
        null,
        0,
        ctx.text.length,
        {
          dataType: block.dataType,
          jcampDxVersion: block.jcampDxVersion,
        },
        {
          ruleName: "SpectrumBlock",
          namePath: "title",
        },
      );

      for (const ldr of block.ldrs) {
        ctx.addSymbol(
          `##${ldr.label}`,
          "Property",
          rootId,
          ldr.startOffset,
          ldr.endOffset,
          {
            label: ldr.label,
            value: ldr.value.slice(0, 80),
          },
          {
            ruleName: "LdrRecord",
            namePath: "label",
            aliases: [ldr.label],
          },
        );
      }
    }
  },
};
