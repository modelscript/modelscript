// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/esl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes ESA ESL simulation studies, models, submodels, segments, and packages (.esl).
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseEsl } from "./parser/esl-parser.js";
import type { EslBlock } from "./types.js";

export const eslIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".esl")) {
      return true;
    }
    if (!text) return false;
    return /\b(?:STUDY|MODEL|SUBMODEL|SEGMENT)\b/i.test(text) && /\b(?:DYNAMIC|INITIAL|END_WHEN|END_IF)\b/i.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseEsl(ctx.text);
    ctx.setParsedModel(program);

    const indexBlock = (block: EslBlock, parentId: number | null): void => {
      const symbolKind =
        block.kind === "STUDY" || block.kind === "PACKAGE"
          ? "Package"
          : block.kind === "SUBMODEL"
            ? "Function"
            : "Class";

      const blockId = ctx.addSymbol(
        block.name,
        symbolKind,
        parentId,
        block.span.startOffset,
        block.span.endOffset,
        {
          kind: block.kind,
          parameterCount: block.parameters.length,
          declarationCount: block.declarations.length,
        },
        {
          ruleName: block.kind.toLowerCase(),
          namePath: "name",
        },
      );

      for (const decl of block.declarations) {
        ctx.addSymbol(
          decl.name,
          "Variable",
          blockId,
          decl.span.startOffset,
          decl.span.endOffset,
          {
            dataType: decl.dataType,
            isConstant: decl.isConstant,
          },
          {
            ruleName: "declaration",
            namePath: "name",
          },
        );
      }

      for (const child of block.children) {
        indexBlock(child, blockId);
      }
    };

    for (const block of program.blocks) {
      indexBlock(block, null);
    }
  },
};
