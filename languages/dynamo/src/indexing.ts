// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dynamo — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes MIT DYNAMO System Dynamics models (.dyn, .dynamo) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseDynamo } from "./parser/index.js";

export const dynamoIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dyn") || lower.endsWith(".dynamo")) {
      return true;
    }
    if (!text) return false;
    return /^\s*L\s+[A-Za-z_][A-Za-z0-9_]*\.K\s*=/im.test(text) || /^\s*SPEC\s+.*\bDT\s*=/im.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const model = parseDynamo(ctx.text);
    ctx.setParsedModel(model);

    const modelRootId = ctx.addSymbol(
      model.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        equationCount: model.equations.length,
        dt: model.spec.dt ?? 1.0,
        length: model.spec.length ?? 100.0,
      },
      {
        ruleName: "Model",
        namePath: "name",
      },
    );

    const seen = new Set<string>();
    for (const eq of model.equations) {
      const symKey = `${eq.kind}:${eq.name}`;
      if (seen.has(symKey)) continue;
      seen.add(symKey);

      const symbolKind =
        eq.kind === "C" || eq.kind === "T"
          ? "Constant"
          : eq.kind === "L"
            ? "State"
            : eq.kind === "R"
              ? "Flow"
              : "Variable";

      ctx.addSymbol(
        `${eq.name} [${eq.kind}]`,
        symbolKind,
        modelRootId,
        eq.span.startOffset,
        eq.span.endOffset,
        {
          equationKind: eq.kind,
          subscript: eq.subscript,
          rawRhs: eq.rawRhs,
        },
        {
          ruleName: "Equation",
          namePath: "name",
          aliases: [eq.name],
        },
      );
    }
  },
};
