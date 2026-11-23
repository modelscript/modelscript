// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/usgs-dem — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes USGS Digital Elevation Model (.dem, .usgs-dem) files into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseUsgsDem } from "./parser/index.js";

export const usgsDemIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dem") || lower.endsWith(".usgs-dem")) {
      return true;
    }
    if (!text) return false;
    return /^\s*TYPE_A\b/im.test(text) && /^\s*TYPE_B\b/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseUsgsDem(ctx.text);
    ctx.setParsedModel(model);

    const rootId = ctx.addSymbol(
      model.header.quadrangleName || "USGS_DEM",
      "Package",
      null,
      0,
      ctx.text.length,
      {
        groundRefSystem: model.header.groundRefSystem,
        groundRefZone: model.header.groundRefZone,
        numCols: model.grid.numCols,
        numRows: model.grid.numRows,
      },
      {
        ruleName: "TypeARecord",
        namePath: "name",
      },
    );

    for (const prof of model.profiles) {
      ctx.addSymbol(
        `Profile_${prof.colIndex}`,
        "Class",
        rootId,
        prof.startOffset,
        prof.endOffset,
        {
          colIndex: prof.colIndex,
          numRows: prof.numRows,
          xOrigin: prof.xOrigin,
          yOrigin: prof.yOrigin,
        },
        {
          ruleName: "TypeBRecord",
          namePath: "colIndex",
        },
      );
    }

    if (model.accuracy) {
      ctx.addSymbol(
        "TypeC_RMSE",
        "Constant",
        rootId,
        model.accuracy.startOffset,
        model.accuracy.endOffset,
        {
          rmseDem: model.accuracy.rmseDem,
        },
        {
          ruleName: "TypeCRecord",
          namePath: "accuracy",
        },
      );
    }
  },
};
