// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import type { QueryEngine } from "@modelscript/runtime/wasm_query_engine.js";
import type { PositionIndex } from "./position-index.js";
import type { BridgeEnvLike } from "./types.js";

/**
 * Shared runtime state and re-entrancy guards passed to bridge feature modules.
 */
export interface BridgeContext {
  index: SymbolIndex;
  readonly engine: QueryEngine;
  positions: PositionIndex;
  readonly documentUri: string;
  env: BridgeEnvLike | undefined;
  /** Re-entrancy guard for `resolveName` / `resolveSimpleName` (`name@scopeId`). */
  readonly activeResolveKeys: Set<string>;
  /** Current recursion depth inside `resolveName` / `resolveSimpleName`. */
  resolveDepth: number;
  /** Re-entrancy guard for `resolveViaImportClause` (`importEntry.id`). */
  readonly activeImportIds: Set<SymbolId>;
  /** Re-entrancy guard for `getInheritedMembers` (`typeId`). */
  readonly activeInheritedIds: Set<SymbolId>;
  /** Re-entrancy guard for `resolveTypeOf` (`entry.id`). */
  readonly activeTypeOfIds: Set<SymbolId>;
  /** Re-entrancy guard for `formatDeclaration` (`entry.id`). */
  readonly activeFormatIds: Set<SymbolId>;
  /** Re-entrancy guard for `hoverEntry` (`entry.id`). */
  readonly activeHoverIds: Set<SymbolId>;
}

/** Checks whether a symbol entry represents a declaration rather than a reference or equation usage. */
export function isDecl(entry: SymbolEntry): boolean {
  return (
    entry.kind !== "Reference" &&
    entry.kind !== "ConnectEquation" &&
    entry.kind !== "FunctionCall" &&
    entry.kind !== "Extends" &&
    entry.kind !== "Import"
  );
}

/** Normalizes a document URI for fallback matching across URI schemes and encodings. */
export function normalizeResourceUri(uri: string): string {
  try {
    return decodeURIComponent(uri).replace(/^[a-z0-9+-]+:\/\/?/, "/");
  } catch {
    return uri;
  }
}

/**
 * Get the SymbolId list for the current document.
 * Uses the symbolsByResource index when available (O(1) lookup),
 * falling back to a full scan for older indices that lack it.
 */
export function getDocumentSymbolIds(ctx: BridgeContext): Iterable<SymbolId> {
  const targetNorm = normalizeResourceUri(ctx.documentUri);

  if (ctx.index.symbolsByResource) {
    const ids = ctx.index.symbolsByResource.get(ctx.documentUri);
    if (ids && ids.length > 0) return ids;
    for (const [k, v] of ctx.index.symbolsByResource.entries()) {
      const kNorm = normalizeResourceUri(k);
      if (k === ctx.documentUri || kNorm === targetNorm || kNorm.endsWith(targetNorm) || targetNorm.endsWith(kNorm)) {
        return v;
      }
    }
  }
  // Fallback: filter from all symbols (legacy path)
  const ids: SymbolId[] = [];
  for (const entry of ctx.index.symbols.values()) {
    const resNorm = entry.resourceId ? normalizeResourceUri(entry.resourceId) : "";
    if (
      entry.resourceId === ctx.documentUri ||
      resNorm === targetNorm ||
      (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)))
    ) {
      ids.push(entry.id);
    }
  }
  return ids;
}

/** Infers the active language ID of the document bound to `ctx`. */
export function getBridgeLanguage(ctx: BridgeContext): string {
  const uriLower = ctx.documentUri.toLowerCase();
  if (uriLower.endsWith(".sysml") || uriLower.endsWith(".sysml2")) return "sysml2";
  if (uriLower.endsWith(".mo") || uriLower.endsWith(".mos")) return "modelica";
  if (uriLower.endsWith(".scad")) return "scad";
  if (uriLower.endsWith(".step") || uriLower.endsWith(".stp") || uriLower.endsWith(".p21")) return "step";
  if (uriLower.endsWith(".reqif") || uriLower.endsWith(".reqifz")) return "reqif";
  if (uriLower.endsWith(".mdzip") || uriLower.endsWith(".mdxml") || uriLower.endsWith(".xmi")) return "magicdraw";
  if (uriLower.endsWith(".qif") || uriLower.endsWith(".qif.xml") || uriLower.endsWith(".qif.json")) return "qif";
  if (/\.(pscx|pslx|pswx|psmx)$/.test(uriLower)) return "pscad";
  if (/\.(raw|dyr|seq)$/.test(uriLower)) return "psse";
  for (const id of getDocumentSymbolIds(ctx)) {
    const sym = ctx.index.symbols.get(id);
    if (sym?.language) return sym.language.toLowerCase();
  }
  return "";
}

/** Checks whether a symbol entry is declared at the top-level of a file/workspace (or a synthetic foreign file root). */
export function isTopLevel(ctx: BridgeContext, entry: SymbolEntry): boolean {
  if (entry.metadata?.["isPredefined"]) return true;
  if (entry.parentId === null || entry.parentId === undefined || entry.parentId === 0) return true;
  const parent = ctx.index.symbols.get(entry.parentId);
  if (!parent) return true;
  const pr = parent.ruleName ?? "";
  if (
    pr === "SourceFile" ||
    pr === "source_file" ||
    parent.kind === "SourceFile" ||
    pr === "scad_file" ||
    pr === "reqif_specification" ||
    pr === "magicdraw_model" ||
    pr === "step_product" ||
    pr === "pscad_library" ||
    pr === "pscad_project" ||
    pr === "qif_document" ||
    pr === "psse_case" ||
    pr === "psse_dyr_case"
  ) {
    return true;
  }
  return false;
}

/** Validates whether a global candidate `entry` is visible/compatible from the current bridge language. */
export function isCompatibleGlobalCandidate(ctx: BridgeContext, entry: SymbolEntry): boolean {
  const entryLang = entry.language?.toLowerCase() ?? "";
  const bridgeLang = getBridgeLanguage(ctx);
  if (!entryLang || !bridgeLang || entryLang === bridgeLang) return true;
  const projTable = (
    ctx.index as {
      tggProjectionTable?: {
        getAllRules?: () => unknown[];
        canResolveAs?: (fromLang: string, target: SymbolEntry) => boolean;
      };
    }
  ).tggProjectionTable;
  if (projTable && typeof projTable.canResolveAs === "function") {
    const ruleCount = typeof projTable.getAllRules === "function" ? projTable.getAllRules().length : 1;
    if (ruleCount > 0) {
      return projTable.canResolveAs(bridgeLang, entry);
    }
  }
  return true;
}

/** Computes the dot-separated or `::`-separated qualified name for `entry` by walking its parent chain. */
export function getQualifiedName(ctx: BridgeContext, entry: SymbolEntry, sep = "."): string {
  const parts: string[] = [];
  const seen = new Set<SymbolId>();
  let curr: SymbolEntry | undefined = entry;
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (curr.name && curr.name !== "<anonymous>" && curr.ruleName !== "SourceFile" && curr.ruleName !== "source_file") {
      parts.unshift(curr.name);
    }
    curr = curr.parentId !== null ? ctx.index.symbols.get(curr.parentId) : undefined;
  }
  return parts.join(sep);
}

/**
 * Get exported children of a symbol scope.
 * Uses the index's childrenOf map for O(1) lookup.
 */
export function getExportedChildren(ctx: BridgeContext, scopeId: SymbolId): SymbolEntry[] {
  const results: SymbolEntry[] = [];
  const childIds = ctx.index.childrenOf.get(scopeId);
  if (!childIds) return results;
  for (const childId of childIds) {
    const entry = ctx.index.symbols.get(childId);
    if (entry) results.push(entry);
  }
  return results;
}

/** Find the narrowest symbol entry containing a byte offset. */
export function findEntryAtOffset(ctx: BridgeContext, offset: number): SymbolEntry | null {
  let best: SymbolEntry | null = null;
  let bestSize = Infinity;

  for (const id of getDocumentSymbolIds(ctx)) {
    const entry = ctx.index.symbols.get(id);
    if (!entry) continue;
    const start = entry.startOffset;
    const end = entry.endOffset;
    if (start <= offset && offset < end) {
      const size = end - start;
      if (size < bestSize) {
        best = entry;
        bestSize = size;
      }
    }
  }

  return best;
}

/**
 * Find the innermost scope-creating symbol that contains the byte offset.
 * A scope-creating symbol is one that has children (i.e., a class/function def),
 * as opposed to leaf references or component declarations without children.
 */
export function findScopeAtOffset(ctx: BridgeContext, offset: number): SymbolEntry | null {
  let best: SymbolEntry | null = null;
  let bestSize = Infinity;

  for (const id of getDocumentSymbolIds(ctx)) {
    const entry = ctx.index.symbols.get(id);
    if (!entry) continue;
    const start = entry.startOffset;
    const end = entry.endOffset;
    if (start <= offset && offset <= end) {
      const size = end - start;
      if (size < bestSize) {
        // Check if this entry is a scope-creator (has children in the index)
        const childIds = ctx.index.childrenOf.get(entry.id);
        if (childIds && childIds.length > 0) {
          best = entry;
          bestSize = size;
        }
      }
    }
  }

  return best;
}
