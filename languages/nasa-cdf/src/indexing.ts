// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — Declarative Multi-File Workspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseCdfSkeleton } from "./parser/skt-parser.js";
import type { CdfDocument } from "./types.js";

/**
 * Predicate to identify NASA CDF documents by file extension (`.skt`, `.cdf`) or `#header` / `#variables` markers.
 */
export function canIndexNasaCdf(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".skt") || lower.endsWith(".cdf")) {
    return true;
  }
  if (!text) return false;
  return /^\s*#header\b/im.test(text) && /^\s*#(z?variables|GLOBALattributes)\b/im.test(text);
}

/**
 * Indexes global attributes and variables of a NASA CDF document into `UnifiedWorkspace`.
 */
export function indexNasaCdfDocument(ctx: DslIndexFileContext): void {
  const doc = parseCdfSkeleton(ctx.text, ctx.uri);
  ctx.setParsedModel<CdfDocument>(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: SymbolId | null = null,
    extra?: Record<string, unknown>,
  ): SymbolId =>
    ctx.addSymbol(name, kind, parentId, 0, ctx.text.length, extra ?? {}, {
      ruleName: `nasa_cdf_${kind}`,
    });

  const rootId = addSym(doc.header.fileName || "NASA_CDF_Dataset", "cdf_file", null, {
    formatVersion: doc.formatVersion,
    majority: doc.header.majority,
    encoding: doc.header.encoding,
    variableCount: doc.variables.length,
  });

  for (const attr of doc.globalAttributes) {
    addSym(attr.name, "cdf_global_attribute", rootId, {
      entries: attr.entries.length,
      line: attr.line,
    });
  }

  for (const v of doc.variables) {
    addSym(v.name, "cdf_variable", rootId, {
      dataType: v.dataType,
      numDims: v.numDims,
      dimSizes: v.dimSizes,
      units: v.attributes["UNITS"]?.values[0],
      depend0: v.attributes["DEPEND_0"]?.values[0],
      recordCount: v.values.length,
      line: v.line,
    });
  }
}

export const nasaCdfIndexing: LanguageIndexingConfig = {
  canIndex: canIndexNasaCdf,
  indexFile: indexNasaCdfDocument,
};

/**
 * Retrieves the parsed `CdfDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getNasaCdfDocument(workspace: UnifiedWorkspace, uri: string): CdfDocument | undefined {
  return workspace.getParsedModel<CdfDocument>(uri);
}

/**
 * Finds all indexed NASA CDF symbols matching `kind` across `workspace`.
 */
export function findNasaCdfSymbolsByType(workspace: UnifiedWorkspace, kind: string): SymbolEntry[] {
  return workspace.getSymbolsForUri().filter((sym) => sym.kind === kind || sym.ruleName === `nasa_cdf_${kind}`);
}
