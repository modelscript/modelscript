// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes GAMS (.gms, .gams, .inc) optimization models into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseGams } from "./parser/gams-parser.js";

const GAMS_CST_KIND_MAP: Record<string, string> = {
  SetDeclaration: "Type",
  ParameterDeclaration: "Parameter",
  TableSection: "Parameter",
  VariableDeclaration: "Variable",
  EquationDeclaration: "Function",
  ModelStatement: "Class",
};

function findCstSpan(
  cstByKey: Map<string, WasmCstIndexedSymbol>,
  cstByName: Map<string, WasmCstIndexedSymbol>,
  kind: string,
  name: string,
): WasmCstIndexedSymbol | undefined {
  const lower = name.toLowerCase();
  return cstByKey.get(`${kind}:${lower}`) ?? cstByName.get(lower);
}

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
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: GAMS_CST_KIND_MAP }) : null;
    const cstByKey = new Map<string, WasmCstIndexedSymbol>();
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const lower = sym.name.toLowerCase();
        const key = `${sym.kind}:${lower}`;
        if (!cstByKey.has(key)) cstByKey.set(key, sym);
        if (!cstByName.has(lower)) cstByName.set(lower, sym);
      }
    }

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

    let emittedCount = 0;

    for (const s of model.sets) {
      const cst = findCstSpan(cstByKey, cstByName, "Type", s.name);
      emittedCount++;
      ctx.addSymbol(
        s.name,
        "Type",
        rootId,
        cst?.startOffset ?? s.span?.startOffset ?? 0,
        cst?.endOffset ?? s.span?.endOffset ?? 0,
        { kind: "set", elements: s.elements },
        {
          ruleName: "set",
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

    for (const p of model.parameters) {
      const cst = findCstSpan(cstByKey, cstByName, "Parameter", p.name);
      emittedCount++;
      ctx.addSymbol(
        p.name,
        "Parameter",
        rootId,
        cst?.startOffset ?? p.span?.startOffset ?? 0,
        cst?.endOffset ?? p.span?.endOffset ?? 0,
        { kind: p.kind, domain: p.domain },
        {
          ruleName: "parameter",
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

    for (const v of model.variables) {
      const cst = findCstSpan(cstByKey, cstByName, "Variable", v.name);
      emittedCount++;
      ctx.addSymbol(
        v.name,
        "Variable",
        rootId,
        cst?.startOffset ?? v.span?.startOffset ?? 0,
        cst?.endOffset ?? v.span?.endOffset ?? 0,
        { varKind: v.varKind, domain: v.domain },
        {
          ruleName: "variable",
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

    for (const eq of model.equationDecls) {
      const cst = findCstSpan(cstByKey, cstByName, "Function", eq.name);
      emittedCount++;
      ctx.addSymbol(
        eq.name,
        "Function",
        rootId,
        cst?.startOffset ?? eq.span?.startOffset ?? 0,
        cst?.endOffset ?? eq.span?.endOffset ?? 0,
        { kind: "equation", domain: eq.domain },
        {
          ruleName: "equation",
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

    for (const m of model.models) {
      const cst = findCstSpan(cstByKey, cstByName, "Class", m.name);
      emittedCount++;
      ctx.addSymbol(
        m.name,
        "Class",
        rootId,
        cst?.startOffset ?? m.span?.startOffset ?? 0,
        cst?.endOffset ?? m.span?.endOffset ?? 0,
        { kind: "model", allEquations: m.allEquations, equations: m.equations },
        {
          ruleName: "model",
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

    if (emittedCount === 0 && cstSymbols && cstSymbols.length > 0) {
      for (const sym of cstSymbols) {
        ctx.addSymbol(
          sym.name,
          sym.kind,
          rootId,
          sym.startOffset,
          sym.endOffset,
          {},
          {
            nameStartOffset: sym.nameStartOffset,
            nameEndOffset: sym.nameEndOffset,
            fieldRanges: { name: { startOffset: sym.nameStartOffset, endOffset: sym.nameEndOffset } },
          },
        );
      }
    }
  },
};
