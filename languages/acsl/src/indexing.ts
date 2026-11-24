// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/acsl — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes ACSL simulation programs (.csl, .acsl) into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseAcsl } from "./parser/acsl-parser.js";

const ACSL_CST_KIND_MAP: Record<string, string> = {
  Program: "Package",
  DeclItem: "Variable",
  ArrayDecl: "Variable",
  DiscreteSection: "Function",
  TableDecl: "Constant",
  MacroSection: "Function",
};

function findCstSpan(cstByName: Map<string, WasmCstIndexedSymbol>, name: string): WasmCstIndexedSymbol | undefined {
  return cstByName.get(name.toLowerCase());
}

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
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: ACSL_CST_KIND_MAP }) : null;
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const lower = sym.name.toLowerCase();
        if (!cstByName.has(lower)) cstByName.set(lower, sym);
      }
    }

    const program = parseAcsl(ctx.text);
    ctx.setParsedModel(program);

    const progCst = findCstSpan(cstByName, program.name);
    const rootId = ctx.addSymbol(
      program.name,
      "Package",
      null,
      progCst?.startOffset ?? 0,
      progCst?.endOffset ?? ctx.text.length,
      {
        sections: program.sections.length,
        integrators: program.integrators.length,
      },
      {
        ruleName: "Program",
        namePath: "name",
        ...(progCst
          ? {
              nameStartOffset: progCst.nameStartOffset,
              nameEndOffset: progCst.nameEndOffset,
              fieldRanges: { name: { startOffset: progCst.nameStartOffset, endOffset: progCst.nameEndOffset } },
            }
          : {}),
      },
    );

    // Index declared constants / variables / arrays
    for (const decl of program.declarations) {
      const cst = findCstSpan(cstByName, decl.name);
      ctx.addSymbol(
        decl.name,
        decl.kind === "CONSTANT" ? "Constant" : "Variable",
        rootId,
        cst?.startOffset ?? decl.startOffset,
        cst?.endOffset ?? decl.endOffset,
        {
          varKind: decl.kind,
          section: decl.section,
        },
        {
          ruleName: "Declaration",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }

    // Index continuous states (INTEG / LIMINT)
    for (const integ of program.integrators) {
      const cst = findCstSpan(cstByName, integ.stateVar);
      ctx.addSymbol(
        integ.stateVar,
        "Variable",
        rootId,
        cst?.startOffset ?? integ.startOffset,
        cst?.endOffset ?? integ.endOffset,
        {
          role: "state",
          operator: integ.operator,
          section: integ.section,
        },
        {
          ruleName: "Integrator",
          namePath: "stateVar",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }

    // Index DISCRETE blocks
    for (const disc of program.discreteBlocks) {
      const cst = findCstSpan(cstByName, disc.name);
      ctx.addSymbol(
        disc.name,
        "Function",
        rootId,
        cst?.startOffset ?? disc.startOffset,
        cst?.endOffset ?? disc.endOffset,
        {
          role: "discrete",
          intervalVar: disc.intervalVar,
        },
        {
          ruleName: "DiscreteSection",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }

    // Index TABLE lookup tables
    for (const tbl of program.tables) {
      const cst = findCstSpan(cstByName, tbl.name);
      ctx.addSymbol(
        tbl.name,
        "Constant",
        rootId,
        cst?.startOffset ?? tbl.startOffset,
        cst?.endOffset ?? tbl.endOffset,
        {
          role: "table",
          dimensions: tbl.dimensions,
          points: tbl.breakpoints.length,
        },
        {
          ruleName: "TableDeclaration",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }

    // Index MACRO definitions
    for (const mac of program.macros) {
      const cst = findCstSpan(cstByName, mac.name);
      ctx.addSymbol(
        mac.name,
        "Function",
        rootId,
        cst?.startOffset ?? mac.startOffset,
        cst?.endOffset ?? mac.endOffset,
        {
          role: "macro",
          params: mac.params,
        },
        {
          ruleName: "MacroDeclaration",
          namePath: "name",
          ...(cst
            ? {
                nameStartOffset: cst.nameStartOffset,
                nameEndOffset: cst.nameEndOffset,
                fieldRanges: { name: { startOffset: cst.nameStartOffset, endOffset: cst.nameEndOffset } },
              }
            : {}),
        },
      );
    }
  },
};
