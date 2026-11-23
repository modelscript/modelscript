// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lustre — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Lustre synchronous dataflow files (.lus, .ec) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseLustre } from "./parser/lustre-parser.js";

export const lustreIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".lus") || lower.endsWith(".ec")) {
      return true;
    }
    if (!text) return false;
    return (
      /\b(?:node|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(text) &&
      /\breturns\s*\(/.test(text) &&
      /\btel\b/.test(text)
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseLustre(ctx.text);
    ctx.setParsedModel(program);

    const fileName = ctx.uri.split(/[\\/]/).pop() ?? "program.lus";
    const rootId = ctx.addSymbol(
      fileName,
      "Package",
      null,
      0,
      ctx.text.length,
      {},
      { ruleName: "Program", namePath: "name" },
    );

    for (const c of program.consts) {
      ctx.addSymbol(
        c.name,
        "Constant",
        rootId,
        c.span.startOffset,
        c.span.endOffset,
        { kind: "const" },
        { ruleName: "ConstDecl", namePath: "name" },
      );
    }

    for (const t of program.types) {
      ctx.addSymbol(
        t.name,
        "Type",
        rootId,
        t.span.startOffset,
        t.span.endOffset,
        { kind: "type" },
        { ruleName: "TypeDecl", namePath: "name" },
      );
    }

    for (const node of program.nodes) {
      const nodeId = ctx.addSymbol(
        node.name,
        node.kind === "function" ? "Function" : "Class",
        rootId,
        node.span.startOffset,
        node.span.endOffset,
        {
          kind: node.kind,
          inputs: node.inputs.map((v) => v.name),
          outputs: node.outputs.map((v) => v.name),
        },
        { ruleName: "NodeDecl", namePath: "name" },
      );

      for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
        ctx.addSymbol(
          v.name,
          "Variable",
          nodeId,
          v.span.startOffset,
          v.span.endOffset,
          { role: v.role },
          { ruleName: "VarDecl", namePath: "name" },
        );
      }
    }
  },
};
