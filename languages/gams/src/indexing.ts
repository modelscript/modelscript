// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes GAMS (.gms, .gams, .inc) optimization models into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseGams } from "./parser/gams-parser.js";

export const gamsIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".gms") || lower.endsWith(".gams")) {
      return true;
    }
    if (!text) return false;
    return (
      /\b(?:Sets?|Parameters?|Scalars?|Tables?|Equations?|Variables?)\b/i.test(text) &&
      (/\bSolve\b.*\busing\b/i.test(text) || /=[elgn]=/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseGams(ctx.text);
    ctx.setParsedModel(model);

    const rootName = model.models[0]?.name ?? model.title ?? "GamsModel";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      { title: model.title },
      { ruleName: "model", namePath: "name" },
    );

    for (const s of model.sets) {
      ctx.addSymbol(
        s.name,
        "Type",
        rootId,
        s.span?.startOffset ?? 0,
        s.span?.endOffset ?? 0,
        { kind: "set", elements: s.elements },
        { ruleName: "set", namePath: "name" },
      );
    }

    for (const p of model.parameters) {
      ctx.addSymbol(
        p.name,
        "Parameter",
        rootId,
        p.span?.startOffset ?? 0,
        p.span?.endOffset ?? 0,
        { kind: p.kind, domain: p.domain },
        { ruleName: "parameter", namePath: "name" },
      );
    }

    for (const v of model.variables) {
      ctx.addSymbol(
        v.name,
        "Variable",
        rootId,
        v.span?.startOffset ?? 0,
        v.span?.endOffset ?? 0,
        { varKind: v.varKind, domain: v.domain },
        { ruleName: "variable", namePath: "name" },
      );
    }

    for (const eq of model.equationDecls) {
      ctx.addSymbol(
        eq.name,
        "Function",
        rootId,
        eq.span?.startOffset ?? 0,
        eq.span?.endOffset ?? 0,
        { kind: "equation", domain: eq.domain },
        { ruleName: "equation", namePath: "name" },
      );
    }

    for (const m of model.models) {
      ctx.addSymbol(
        m.name,
        "Class",
        rootId,
        m.span?.startOffset ?? 0,
        m.span?.endOffset ?? 0,
        { kind: "model", allEquations: m.allEquations, equations: m.equations },
        { ruleName: "model", namePath: "name" },
      );
    }
  },
};
