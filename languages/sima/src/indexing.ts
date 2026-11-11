// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sima — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes SINTEF Ocean SIMO / RIFLEX and SIMA models (.inp, .sys, .sima, .hyd) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSimaFile } from "./parser/index.js";

export const simaIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".sima") || lower.endsWith(".sys") || lower.endsWith(".hyd") || lower.endsWith(".sima.inp")) {
      return true;
    }
    if (!text) return false;
    return /^\s*(?:SYS|SYSTEM|BODY|VESSEL|FAIRLEAD|MOORING)\b/im.test(text) || text.includes("<sima");
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseSimaFile(ctx.text, ctx.uri);
    ctx.setParsedModel(model);

    const rootName = model.title || "SIMA Model";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {},
      {
        ruleName: "sima",
        namePath: "name",
      },
    );

    // Index Vessels
    for (const v of model.vessels) {
      const vId = ctx.addSymbol(
        v.name,
        "Class",
        rootId,
        0,
        0,
        {},
        {
          ruleName: "sima",
          namePath: "name",
        },
      );
      for (const fl of v.fairleads) {
        ctx.addSymbol(
          `Fairlead: ${fl.name}`,
          "Port",
          vId,
          0,
          0,
          {},
          {
            ruleName: "sima",
            namePath: "name",
            aliases: [fl.name],
          },
        );
      }
    }

    // Index Mooring Lines
    for (const line of model.lines) {
      const lId = ctx.addSymbol(
        `Line: ${line.name} [${line.type}]`,
        "Variable",
        rootId,
        0,
        0,
        {},
        {
          ruleName: "sima",
          namePath: "name",
          aliases: [line.name],
        },
      );
      for (const seg of line.segments) {
        ctx.addSymbol(
          `Segment: ${seg.name} (${seg.length}m)`,
          "Field",
          lId,
          0,
          0,
          {},
          {
            ruleName: "sima",
            namePath: "name",
            aliases: [seg.name],
          },
        );
      }
    }
  },
};
