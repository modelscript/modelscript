// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cplex-lp — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes CPLEX LP and LINDO optimization files (.lp, .ltx, .lindo) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseCplexLp } from "./parser/lp-parser.js";

export const cplexLpIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".lp") || lower.endsWith(".ltx") || lower.endsWith(".lindo")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*(?:minimize|minimise|minimum|maximize|maximise|maximum|min|max)\b/im.test(text) &&
      /^\s*(?:subject\s+to|such\s+that|s\.t\.|st)\b/im.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseCplexLp(ctx.text);
    ctx.setParsedModel(model);

    // Root optimization model symbol
    const rootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        dialect: model.dialect,
        sense: model.objective?.sense ?? "minimize",
        variableCount: model.variables.size,
        constraintCount: model.constraints.length,
      },
      {
        ruleName: "Model",
        namePath: "name",
      },
    );

    // Objective symbol
    if (model.objective) {
      const objLabel = model.objective.name ?? model.objective.sense;
      ctx.addSymbol(
        objLabel,
        "Function",
        rootId,
        model.objective.location?.startOffset ?? 0,
        model.objective.location?.endOffset ?? 0,
        {
          sense: model.objective.sense,
          termCount: model.objective.linearTerms.length,
          hasQuadratic: Boolean(model.objective.quadratic),
        },
        {
          ruleName: "ObjectiveSection",
          namePath: "name",
        },
      );
    }

    // Constraint symbols
    for (const con of model.constraints) {
      ctx.addSymbol(
        con.name,
        "Property",
        rootId,
        con.location?.startOffset ?? 0,
        con.location?.endOffset ?? 0,
        {
          sense: con.sense,
          rhs: con.rhs,
        },
        {
          ruleName: "Constraint",
          namePath: "name",
        },
      );
    }

    // Decision variable symbols
    for (const [varName, info] of model.variables) {
      ctx.addSymbol(
        varName,
        "Variable",
        rootId,
        info.firstLocation?.startOffset ?? 0,
        info.firstLocation?.endOffset ?? 0,
        {
          domain: info.domain,
          lower: info.lower,
          upper: info.upper,
          isFree: info.isFree,
        },
        {
          ruleName: "Variable",
          namePath: "name",
        },
      );
    }
  },
};
