// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/esterel — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Esterel synchronous reactive modules (.strl, .esterel) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseEsterel } from "./parser/esterel-parser.js";

export const esterelIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".strl") || lower.endsWith(".esterel")) {
      return true;
    }
    if (!text) return false;
    return /\bmodule\s+[A-Za-z_][A-Za-z0-9_]*\s*:/m.test(text) && /\bend\s+module\b/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseEsterel(ctx.text);
    ctx.setParsedModel(program);

    for (const mod of program.modules) {
      const modId = ctx.addSymbol(
        mod.name,
        "Package",
        null,
        mod.span.startOffset,
        mod.span.endOffset,
        {
          signalCount: mod.signals.length,
          relationCount: mod.relations.length,
        },
        {
          ruleName: "ModuleDecl",
          namePath: "name",
        },
      );

      for (const sig of mod.signals) {
        ctx.addSymbol(
          sig.name,
          "Variable",
          modId,
          sig.span.startOffset,
          sig.span.endOffset,
          {
            direction: sig.direction,
            valueType: sig.valueType,
          },
          {
            ruleName: "SignalDecl",
            namePath: "name",
            aliases: [`${mod.name}.${sig.name}`],
          },
        );
      }
    }
  },
};
