// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IBM MPS optimization decks (.mps, .qps) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseMps } from "./parser/mps-parser.js";

export const mpsIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".mps") || lower.endsWith(".qps")) {
      return true;
    }
    if (!text) return false;
    return /^\s*NAME\b/m.test(text) && /^\s*ROWS\b/m.test(text) && /^\s*ENDATA\b/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseMps(ctx.text);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        sense: model.sense,
        problemClass: model.problemClass,
        rowCount: model.rows.size,
        columnCount: model.columns.size,
      },
      {
        ruleName: "problem",
        namePath: "name",
      },
    );

    for (const row of model.rows.values()) {
      ctx.addSymbol(
        row.name,
        row.type === "N" ? "Function" : "Property",
        rootId,
        row.span?.startOffset ?? 0,
        row.span?.endOffset ?? 0,
        {
          rowType: row.type,
          rhs: row.rhs,
          range: row.range,
        },
        {
          ruleName: "row",
          namePath: "name",
        },
      );
    }

    for (const col of model.columns.values()) {
      ctx.addSymbol(
        col.name,
        "Variable",
        rootId,
        col.span?.startOffset ?? 0,
        col.span?.endOffset ?? 0,
        {
          varType: col.varType,
          lb: col.lb,
          ub: col.ub,
        },
        {
          ruleName: "column",
          namePath: "name",
        },
      );
    }
  },
};
