// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmea0183 — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseNmea0183 } from "./parser/index.js";

export const nmea0183Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".nmea") || lower.endsWith(".nme") || lower.endsWith(".gps")) {
      return true;
    }
    if (!text) return false;
    return /^\s*[$!][A-Z]{2}(?:GGA|RMC|GSA|GSV|VTG|HDG|DBT|MWV),/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseNmea0183(ctx.text);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      "NMEA0183Stream",
      "Package",
      null,
      0,
      ctx.text.length,
      {
        sentenceCount: doc.sentences.length,
        talkers: doc.talkers,
        formatters: doc.formatters,
      },
      {
        ruleName: "Sentence",
        namePath: "address",
      },
    );

    for (const s of doc.sentences) {
      ctx.addSymbol(
        `${s.delimiter}${s.address} (L${s.line})`,
        "Class",
        rootId,
        s.startOffset,
        s.endOffset,
        {
          talker: s.talker,
          formatter: s.formatter,
          address: s.address,
          checksumValid: s.checksumValid,
        },
        {
          ruleName: "Sentence",
          namePath: "address",
          aliases: [s.address, s.formatter],
        },
      );
    }
  },
};
