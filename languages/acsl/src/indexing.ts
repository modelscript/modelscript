// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/acsl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes ACSL simulation programs (.csl, .acsl) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseAcsl } from "./parser/acsl-parser.js";

export const acslIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".csl") || lower.endsWith(".acsl")) {
      return true;
    }
    if (!text) return false;
    return (
      /^\s*PROGRAM\b/im.test(text) &&
      (/\bDERIVATIVE\b/i.test(text) || /\bDYNAMIC\b/i.test(text) || /\bINTEG\s*\(/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const program = parseAcsl(ctx.text);
    ctx.setParsedModel(program);

    const rootId = ctx.addSymbol(
      program.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        sections: program.sections.length,
        integrators: program.integrators.length,
      },
      {
        ruleName: "Program",
        namePath: "name",
      },
    );

    // Index declared constants / variables / arrays
    for (const decl of program.declarations) {
      ctx.addSymbol(
        decl.name,
        decl.kind === "CONSTANT" ? "Constant" : "Variable",
        rootId,
        decl.startOffset,
        decl.endOffset,
        {
          varKind: decl.kind,
          section: decl.section,
        },
        {
          ruleName: "Declaration",
          namePath: "name",
        },
      );
    }

    // Index continuous states (INTEG / LIMINT)
    for (const integ of program.integrators) {
      ctx.addSymbol(
        integ.stateVar,
        "Variable",
        rootId,
        integ.startOffset,
        integ.endOffset,
        {
          role: "state",
          operator: integ.operator,
          section: integ.section,
        },
        {
          ruleName: "Integrator",
          namePath: "stateVar",
        },
      );
    }

    // Index DISCRETE blocks
    for (const disc of program.discreteBlocks) {
      ctx.addSymbol(
        disc.name,
        "Function",
        rootId,
        disc.startOffset,
        disc.endOffset,
        {
          role: "discrete",
          intervalVar: disc.intervalVar,
        },
        {
          ruleName: "DiscreteSection",
          namePath: "name",
        },
      );
    }

    // Index TABLE lookup tables
    for (const tbl of program.tables) {
      ctx.addSymbol(
        tbl.name,
        "Constant",
        rootId,
        tbl.startOffset,
        tbl.endOffset,
        {
          role: "table",
          dimensions: tbl.dimensions,
          points: tbl.breakpoints.length,
        },
        {
          ruleName: "TableDeclaration",
          namePath: "name",
        },
      );
    }

    // Index MACRO definitions
    for (const mac of program.macros) {
      ctx.addSymbol(
        mac.name,
        "Function",
        rootId,
        mac.startOffset,
        mac.endOffset,
        {
          role: "macro",
          params: mac.params,
        },
        {
          ruleName: "MacroDeclaration",
          namePath: "name",
        },
      );
    }
  },
};
