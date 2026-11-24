// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/twentysim — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes 20-sim models (`.emx`, `.emxz`) and standalone SIDOPS files (`.sid`)
 * into UnifiedWorkspace.
 */

import {
  extractValidWasmCstRoot,
  indexSymbolsFromWasmCst,
  type DslIndexFileContext,
  type LanguageIndexingConfig,
  type WasmCstIndexedSymbol,
} from "@modelscript/dsl";
import { parseTwentySim } from "./parser/emx-parser.js";
import type { TwentySimSubmodel } from "./types.js";

const TWENTYSIM_CST_KIND_MAP: Record<string, string> = {
  Model: "Package",
  SubmodelDecl: "Component",
  ParamDecl: "Constant",
  VarDecl: "Variable",
  PortDecl: "Port",
};

function indexSubmodelRecursive(
  ctx: DslIndexFileContext,
  sub: TwentySimSubmodel,
  parentId: number | null,
  cstByName: Map<string, WasmCstIndexedSymbol>,
): void {
  const cst = cstByName.get(sub.name.toLowerCase());
  const symId = ctx.addSymbol(
    sub.name,
    parentId === null ? "Package" : "Component",
    parentId,
    cst?.startOffset ?? sub.startOffset ?? 0,
    cst?.endOffset ?? sub.endOffset ?? ctx.text.length,
    {
      elementKind: sub.elementKind,
      typeName: sub.typeName,
      portCount: sub.ports.length,
      equationCount: sub.equations.length,
    },
    cst
      ? {
          ruleName: parentId === null ? "Model" : "SubmodelDecl",
          namePath: "name",
          nameStartOffset: cst.nameStartOffset,
          nameEndOffset: cst.nameEndOffset,
        }
      : undefined,
  );

  for (const param of sub.parameters) {
    const pCst = cstByName.get(param.name.toLowerCase());
    ctx.addSymbol(
      param.name,
      "Constant",
      symId,
      pCst?.startOffset ?? param.startOffset ?? sub.startOffset ?? 0,
      pCst?.endOffset ?? param.endOffset ?? sub.endOffset ?? 0,
      {
        type: param.type,
        value: param.value,
        unit: param.unit,
      },
    );
  }

  for (const variable of sub.variables) {
    const vCst = cstByName.get(variable.name.toLowerCase());
    ctx.addSymbol(
      variable.name,
      "Variable",
      symId,
      vCst?.startOffset ?? variable.startOffset ?? sub.startOffset ?? 0,
      vCst?.endOffset ?? variable.endOffset ?? sub.endOffset ?? 0,
      {
        type: variable.type,
        qualifier: variable.qualifier,
        unit: variable.unit,
      },
    );
  }

  for (const port of sub.ports) {
    const portCst = cstByName.get(port.name.toLowerCase());
    ctx.addSymbol(
      port.name,
      "Port",
      symId,
      portCst?.startOffset ?? port.startOffset ?? sub.startOffset ?? 0,
      portCst?.endOffset ?? port.endOffset ?? sub.endOffset ?? 0,
      {
        portKind: port.kind,
        direction: port.direction,
        restriction: port.restriction,
      },
    );
  }

  for (const child of sub.submodels) {
    indexSubmodelRecursive(ctx, child, symId, cstByName);
  }
}

export const twentySimIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".emx") || lower.endsWith(".emxz") || lower.endsWith(".sid")) {
      return true;
    }
    if (!text) return false;
    return (
      /<Document\b[^>]*>[\s\S]*?<SpecificationCode>/i.test(text) ||
      (/\bparameters\b/i.test(text) && /\bequations\b/i.test(text) && /\bddt\s*\(|\bint\s*\(/i.test(text))
    );
  },

  indexFile(ctx: DslIndexFileContext): void {
    const cstRoot = extractValidWasmCstRoot(ctx.tree);
    const cstSymbols = cstRoot ? indexSymbolsFromWasmCst(cstRoot, ctx.text, { kindMap: TWENTYSIM_CST_KIND_MAP }) : null;
    const cstByName = new Map<string, WasmCstIndexedSymbol>();
    if (cstSymbols) {
      for (const sym of cstSymbols) {
        const lower = sym.name.toLowerCase();
        if (!cstByName.has(lower)) cstByName.set(lower, sym);
      }
    }

    const model = parseTwentySim(ctx.text);
    ctx.setParsedModel(model);
    indexSubmodelRecursive(ctx, model.root, null, cstByName);
  },
};
