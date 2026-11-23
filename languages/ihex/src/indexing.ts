// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ihex — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Intel HEX firmware images (`.hex`, `.ihx`, `.ihex`, `.h86`, `.mcs`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { hexDword, parseIhex } from "./parser/index.js";
import { coalesceIhexMemoryMap } from "./solver/index.js";

export const ihexIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (
      lower.endsWith(".hex") ||
      lower.endsWith(".ihx") ||
      lower.endsWith(".ihex") ||
      lower.endsWith(".h86") ||
      lower.endsWith(".mcs")
    ) {
      return true;
    }
    if (!text) return false;
    return /^:[0-9A-Fa-f]{10,}$/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseIhex(ctx.text, ctx.uri);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      `${model.name} [${model.format}]`,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        format: model.format,
        totalDataBytes: model.totalDataBytes,
        recordCount: model.records.length,
      },
      {
        ruleName: "Document",
        namePath: "name",
      },
    );

    const map = coalesceIhexMemoryMap(model);
    for (const seg of map.segments) {
      const label = `SEG_${seg.index} [0x${hexDword(seg.startAddress)}..0x${hexDword(seg.endAddress)}]`;
      const firstRec = model.records.find((r) => r.lineNumber === seg.startLine);
      const lastRec = model.records.find((r) => r.lineNumber === seg.endLine);
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        firstRec?.startOffset ?? 0,
        lastRec?.endOffset ?? ctx.text.length,
        {
          segmentIndex: seg.index,
          startAddress: seg.startAddress,
          endAddress: seg.endAddress,
          length: seg.length,
          crc32: seg.crc32,
        },
        {
          ruleName: "Record",
          namePath: "name",
          aliases: [`SEG_${seg.index}`],
        },
      );
    }
  },
};
