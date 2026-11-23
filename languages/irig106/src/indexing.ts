// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/irig106 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IRIG 106 Chapter 9 TMATS files (.tmats, .tmt, .tma) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseIrig106 } from "./parser/tmats-parser.js";

export const irig106Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".tmats") || lower.endsWith(".tmt") || lower.endsWith(".tma")) {
      return true;
    }
    if (!text) return false;
    return /^\s*(?:G\\|P-\d+\\|D-\d+\\|C-\d+\\)/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseIrig106(ctx.text);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        irigVersion: model.general.irigVersion,
      },
      {
        ruleName: "tmats",
        namePath: "name",
      },
    );

    for (const pcm of model.pcmFormats.values()) {
      const label = pcm.dataLinkName ?? `P-${pcm.index}`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        pcm.startOffset ?? 0,
        pcm.endOffset ?? 0,
        {
          group: "P",
          bitRateBps: pcm.bitRateBps,
          wordLengthBits: pcm.commonWordLengthBits,
        },
        {
          ruleName: "pcm_format",
          namePath: "name",
          aliases: [`P-${pcm.index}`],
        },
      );
    }

    for (const dg of model.measurementGroups.values()) {
      for (const meas of dg.measurements) {
        ctx.addSymbol(
          meas.name,
          "Variable",
          rootId,
          meas.startOffset,
          meas.endOffset,
          {
            group: "D",
            wordPosition: meas.wordPosition,
            wordInterval: meas.wordInterval,
            framePosition: meas.framePosition,
          },
          {
            ruleName: "measurement",
            namePath: "name",
          },
        );
      }
    }

    for (const conv of model.conversions.values()) {
      ctx.addSymbol(
        `${conv.measurementName} [${conv.conversionType}]`,
        "Function",
        rootId,
        conv.startOffset,
        conv.endOffset,
        {
          group: "C",
          conversionType: conv.conversionType,
          engineeringUnits: conv.engineeringUnits,
        },
        {
          ruleName: "conversion",
          namePath: "name",
          aliases: [conv.measurementName],
        },
      );
    }
  },
};
