// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/netcdf — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NetCDF CDL datasets (.cdl, .nc, .cdf) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseCdl } from "./parser/cdl-parser.js";

export const netcdfIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".cdl") || lower.endsWith(".nc") || lower.endsWith(".cdf")) {
      return true;
    }
    if (!text) return false;
    return /^\s*netcdf\s+[A-Za-z0-9_.-]+\s*\{/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const dataset = parseCdl(ctx.text);
    ctx.setParsedModel(dataset);

    const rootId = ctx.addSymbol(
      dataset.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        format: dataset.format,
        dimensionCount: dataset.dimensions.length,
        variableCount: dataset.variables.length,
      },
      {
        ruleName: "NetcdfDocument",
        namePath: "name",
      },
    );

    for (const dim of dataset.dimensions) {
      ctx.addSymbol(
        dim.name,
        "Constant",
        rootId,
        dim.startOffset ?? 0,
        dim.endOffset ?? 0,
        {
          size: dim.size,
          isUnlimited: dim.isUnlimited,
        },
        {
          ruleName: "DimensionDecl",
          namePath: "name",
        },
      );
    }

    for (const v of dataset.variables) {
      ctx.addSymbol(
        v.name,
        "Variable",
        rootId,
        v.startOffset ?? 0,
        v.endOffset ?? 0,
        {
          type: v.type,
          dimensions: v.dimensions,
        },
        {
          ruleName: "VariableDecl",
          namePath: "name",
        },
      );
    }
  },
};
