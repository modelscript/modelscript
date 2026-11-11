// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Declarative Multi-File Workspace Indexing.
 *
 * Indexes CellML 1.0 / 1.1 / 2.0 files (.cellml, .xml): model root, custom units,
 * components, variables, and equations into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseCellml } from "./parser/index.js";
import type { CellmlDocument } from "./types.js";

/**
 * Predicate to disambiguate CellML XML documents from other XML formats.
 */
export function canIndexCellml(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".cellml")) return true;
  if (lower.endsWith(".xml")) {
    if (!text) return true;
    return text.includes("/cellml/") || (/<model\b/.test(text) && /<component\b/.test(text));
  }
  return false;
}

/**
 * Declarative file indexer for CellML 1.0 / 1.1 / 2.0 documents.
 */
export function indexCellmlDocument(ctx: DslIndexFileContext): void {
  try {
    const doc = parseCellml(ctx.text, ctx.uri);
    ctx.setParsedModel<CellmlDocument>(doc);

    const modelName = doc.name || "CellmlModel";
    const rootId = ctx.addSymbol(
      modelName,
      "Package",
      null,
      doc.range?.startOffset ?? 0,
      doc.range?.endOffset ?? ctx.text.length,
      {
        version: doc.version,
        unitCount: doc.units.size,
        componentCount: doc.components.size,
        connectionCount: doc.connections.length,
      },
      {
        ruleName: "cellml_model",
        namePath: modelName,
      },
    );

    // Index custom <units>
    for (const u of doc.units.values()) {
      const qualUnit = `${modelName}.${u.name}`;
      ctx.addSymbol(
        u.name,
        "Constant",
        rootId,
        u.range.startOffset,
        u.range.endOffset,
        {
          isBaseUnits: u.isBaseUnits,
          dimensions: u.dimensions,
        },
        {
          ruleName: "cellml_units",
          namePath: qualUnit,
          aliases: [qualUnit],
        },
      );
    }

    // Index <component> and child <variable> / <math> equations
    for (const comp of doc.components.values()) {
      const qualComp = `${modelName}.${comp.name}`;
      const compId = ctx.addSymbol(
        comp.name,
        "Component",
        rootId,
        comp.range.startOffset,
        comp.range.endOffset,
        {
          variableCount: comp.variables.size,
          equationCount: comp.equations.length,
        },
        {
          ruleName: "cellml_component",
          namePath: qualComp,
          aliases: [qualComp],
        },
      );

      for (const v of comp.variables.values()) {
        const qualName = `${comp.name}.${v.name}`;
        ctx.addSymbol(
          v.name,
          "Variable",
          compId,
          v.range.startOffset,
          v.range.endOffset,
          {
            units: v.units,
            initialValue: v.initialValue,
            publicInterface: v.publicInterface,
            privateInterface: v.privateInterface,
          },
          {
            ruleName: "cellml_variable",
            namePath: qualName,
            aliases: [qualName],
          },
        );
      }

      for (const eq of comp.equations) {
        const eqName = eq.isOde ? `der(${eq.targetVariable})` : eq.targetVariable;
        const qualEq = `${comp.name}.${eqName}`;
        ctx.addSymbol(
          eqName,
          "Function",
          compId,
          eq.range.startOffset,
          eq.range.endOffset,
          {
            targetVariable: eq.targetVariable,
            isOde: eq.isOde,
            independentVariable: eq.independentVariable,
            rhsExpression: eq.rhsExpression,
          },
          {
            ruleName: "cellml_equation",
            namePath: qualEq,
            aliases: [qualEq],
          },
        );
      }
    }
  } catch {
    // Partial index on malformed XML
  }
}

/**
 * Retrieves the parsed `CellmlDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getCellmlDocument(workspace: UnifiedWorkspace, uri: string): CellmlDocument | undefined {
  return workspace.getParsedModel<CellmlDocument>(uri);
}

/**
 * Resolves a CellML symbol name first within `scopeId` inside `uri`, then across `workspace`.
 */
export function resolveCellmlInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const idx = workspace.getFileIndex(uri);
  if (idx && scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name === name) {
          return sym;
        }
      }
    }
  }

  return workspace.findSymbolsByName(name)[0] ?? null;
}
