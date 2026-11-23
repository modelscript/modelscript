// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bufr — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes WMO BUFR messages (.bufr, .bfr, .bufr.txt) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseBufrText } from "./parser/text-parser.js";

export const bufrIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".bufr") || lower.endsWith(".bfr") || lower.endsWith(".bufr.txt")) {
      return true;
    }
    if (!text) return false;
    return /^\s*BUFR\b/im.test(text) && /\bSECTION\s+[01345]\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const msg = parseBufrText(ctx.text);
    ctx.setParsedModel(msg);

    const rootId = ctx.addSymbol(
      msg.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        edition: msg.section0.edition,
        originatingCentre: msg.section1.originatingCentre,
        subsetCount: msg.subsets.length,
      },
      {
        ruleName: "BufrMessage",
        namePath: "name",
      },
    );

    for (const desc of msg.section3.descriptors) {
      ctx.addSymbol(
        desc.code,
        "Variable",
        rootId,
        desc.startOffset ?? 0,
        desc.endOffset ?? 0,
        {
          f: desc.f,
          x: desc.x,
          y: desc.y,
        },
        {
          ruleName: "Descriptor",
          namePath: "code",
        },
      );
    }

    for (const subset of msg.subsets) {
      ctx.addSymbol(
        subset.label ?? `SUBSET_${subset.index}`,
        "Class",
        rootId,
        subset.startOffset ?? 0,
        subset.endOffset ?? 0,
        {
          subsetIndex: subset.index,
          observationCount: subset.values.length,
        },
        {
          ruleName: "SubsetBlock",
          namePath: "label",
        },
      );
    }
  },
};
