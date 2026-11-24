// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lustre — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Lustre synchronous dataflow files (.lus, .ec) into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseLustre } from "./parser/lustre-parser.js";

const LUSTRE_CST_KIND_MAP: Record<string, string> = {
  ConstDecl: "Constant",
  TypeDecl: "Type",
  NodeDecl: "Class",
  VarDecl: "Variable",
};

function findCstSpan(
  cstByKey: Map<string, WasmCstIndexedSymbol>,
  cstByName: Map<string, WasmCstIndexedSymbol>,
  kind: string,
  name: string,
): WasmCstIndexedSymbol | undefined {
  return cstByKey.get(`${kind}:${name}`) ?? cstByName.get(name);
}

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
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: LUSTRE_CST_KIND_MAP }) : null;
    const cstByKey = new Map<string, WasmCstIndexedSymbol>();
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const key = `${sym.kind}:${sym.name}`;
        if (!cstByKey.has(key)) cstByKey.set(key, sym);
        if (!cstByName.has(sym.name)) cstByName.set(sym.name, sym);
      }
    }

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

    let emittedCount = 0;

    for (const c of program.consts) {
      const cst = findCstSpan(cstByKey, cstByName, "Constant", c.name);
      emittedCount++;
      ctx.addSymbol(
        c.name,
        "Constant",
        rootId,
        cst?.startOffset ?? c.span.startOffset,
        cst?.endOffset ?? c.span.endOffset,
        { kind: "const" },
        {
          ruleName: "ConstDecl",
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

    for (const t of program.types) {
      const cst = findCstSpan(cstByKey, cstByName, "Type", t.name);
      emittedCount++;
      ctx.addSymbol(
        t.name,
        "Type",
        rootId,
        cst?.startOffset ?? t.span.startOffset,
        cst?.endOffset ?? t.span.endOffset,
        { kind: "type" },
        {
          ruleName: "TypeDecl",
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

    for (const node of program.nodes) {
      const nodeCst = findCstSpan(cstByKey, cstByName, "Class", node.name);
      emittedCount++;
      const nodeId = ctx.addSymbol(
        node.name,
        node.kind === "function" ? "Function" : "Class",
        rootId,
        nodeCst?.startOffset ?? node.span.startOffset,
        nodeCst?.endOffset ?? node.span.endOffset,
        {
          kind: node.kind,
          inputs: node.inputs.map((v) => v.name),
          outputs: node.outputs.map((v) => v.name),
        },
        {
          ruleName: "NodeDecl",
          namePath: "name",
          ...(nodeCst
            ? {
                nameStartOffset: nodeCst.nameStartOffset,
                nameEndOffset: nodeCst.nameEndOffset,
                fieldRanges: { name: { startOffset: nodeCst.nameStartOffset, endOffset: nodeCst.nameEndOffset } },
              }
            : {}),
        },
      );

      for (const v of [...node.inputs, ...node.outputs, ...node.locals]) {
        const varCst = findCstSpan(cstByKey, cstByName, "Variable", v.name);
        ctx.addSymbol(
          v.name,
          "Variable",
          nodeId,
          varCst?.startOffset ?? v.span.startOffset,
          varCst?.endOffset ?? v.span.endOffset,
          { role: v.role },
          {
            ruleName: "VarDecl",
            namePath: "name",
            ...(varCst
              ? {
                  nameStartOffset: varCst.nameStartOffset,
                  nameEndOffset: varCst.nameEndOffset,
                  fieldRanges: { name: { startOffset: varCst.nameStartOffset, endOffset: varCst.nameEndOffset } },
                }
              : {}),
          },
        );
      }
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
