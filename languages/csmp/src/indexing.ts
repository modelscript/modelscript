// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/csmp — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IBM CSMP/360 and SCi CSSL-67 continuous simulation decks (.csmp, .cssl, .csm)
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseCsmpDeck } from "./parser/deck-parser.js";

export const csmpIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".csmp") || lower.endsWith(".cssl") || lower.endsWith(".csm")) {
      return true;
    }
    if (!text) return false;
    return (
      /\bINTGRL\s*\(/i.test(text) &&
      (/\bTIMER\b/i.test(text) || /\bDYNAMIC\b/i.test(text) || /\bPARAM(?:ETER)?\b/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseCsmpDeck(ctx.text);
    ctx.setParsedModel(program);

    const rootId = ctx.addSymbol(
      program.title,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        method: program.method ?? "RKS",
        fintim: program.timer.fintim ?? 10,
      },
      {
        ruleName: "Program",
        namePath: "title",
      },
    );

    for (const [name, decl] of program.parameters) {
      ctx.addSymbol(
        name,
        "Variable",
        rootId,
        decl.span.startOffset,
        decl.span.endOffset,
        { kind: "PARAM", value: decl.value },
        { ruleName: "ParamDecl", namePath: "name" },
      );
    }

    for (const [name, decl] of program.constants) {
      ctx.addSymbol(
        name,
        "Constant",
        rootId,
        decl.span.startOffset,
        decl.span.endOffset,
        { kind: "CONST", value: decl.value },
        { ruleName: "ConstDecl", namePath: "name" },
      );
    }

    for (const [name, decl] of program.incons) {
      ctx.addSymbol(
        name,
        "Variable",
        rootId,
        decl.span.startOffset,
        decl.span.endOffset,
        { kind: "INCON", value: decl.value },
        { ruleName: "InconDecl", namePath: "name" },
      );
    }

    for (const [name, tbl] of program.functionTables) {
      ctx.addSymbol(
        name,
        "Function",
        rootId,
        tbl.span.startOffset,
        tbl.span.endOffset,
        { kind: "FUNCTION", points: tbl.points.length },
        { ruleName: "FunctionDecl", namePath: "name" },
      );
    }

    for (const [name, macro] of program.macros) {
      ctx.addSymbol(
        name,
        "Class",
        rootId,
        macro.span.startOffset,
        macro.span.endOffset,
        { kind: "MACRO", inputs: macro.inputs, outputs: macro.outputs },
        { ruleName: "MacroBlock", namePath: "name" },
      );
    }

    for (const stmt of program.dynamicStatements) {
      const isState = stmt.expr.kind === "call" && stmt.expr.callee === "INTGRL";
      ctx.addSymbol(
        stmt.target,
        isState ? "Property" : "Variable",
        rootId,
        stmt.span.startOffset,
        stmt.span.endOffset,
        { kind: isState ? "STATE" : "DYNAMIC", section: stmt.section },
        { ruleName: "AssignmentStmt", namePath: "target" },
      );
    }
  },
};
