// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import {
  type BridgeContext,
  findScopeAtOffset,
  getBridgeLanguage,
  getExportedChildren,
  isDecl,
  isTopLevel,
} from "./bridge-context.js";
import { extractDotAccessVarBefore, extractModificationTargetType } from "./cst-helpers.js";
import { getInheritedMembers, getVisibleSymbols, resolveName, resolveTypeOf } from "./resolution.js";
import { getRootCstNode } from "./source-access.js";
import { type LSPCompletionItem, LSPSymbolKind, mapSymbolKind } from "./types.js";

/**
 * Computes context-sensitive completion candidates (`LSPCompletionItem[]`) at `byteOffset`,
 * supporting dot-access member completion, modification-argument completion, and lexical scope completion.
 */
export function computeCompletion(ctx: BridgeContext, byteOffset: number, sourceText?: string): LSPCompletionItem[] {
  // ------------------------------------------------------------------
  // Dot-access completion: "a." → resolve `a` to its type, show members
  // ------------------------------------------------------------------
  if (sourceText) {
    const before = sourceText.slice(0, byteOffset);
    const varName = extractDotAccessVarBefore(before, getRootCstNode(ctx));
    if (varName) {
      return completeDotAccess(ctx, varName, byteOffset);
    }

    // ----------------------------------------------------------------
    // Modification-context completion: "A a(|)" → show members of A
    // ----------------------------------------------------------------
    const modMembers = completeModificationContext(ctx, byteOffset, before);
    if (modMembers) return modMembers;
  }

  // ------------------------------------------------------------------
  // Normal scope-aware completion: show visible symbols in current scope
  // ------------------------------------------------------------------
  const scopeEntry = findScopeAtOffset(ctx, byteOffset);
  const scopeId = scopeEntry?.id ?? null;

  const visible = getVisibleSymbols(ctx, scopeId);
  const seen = new Set<string>();
  const results: LSPCompletionItem[] = [];
  for (const entry of visible) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      results.push({
        label: entry.name,
        kind: mapSymbolKind(entry.kind),
        detail: entry.kind,
      });
    }
  }
  return results;
}

/**
 * Resolve dot-access: given a variable name before ".", find its type
 * declaration and return its exported children as completions.
 *
 * Type resolution is fully language-agnostic using two generic strategies:
 *  1. Check metadata values — if the language stores a type name in any
 *     metadata field (e.g. Modelica's `typeSpecifier`), try resolving it.
 *  2. Check child Reference entries — if the language uses `ref()` to model
 *     type references (e.g. SysML2's `OwnedFeatureTyping`), those become
 *     child entries with kind "Reference" whose name is the type.
 */
function completeDotAccess(ctx: BridgeContext, varName: string, byteOffset: number): LSPCompletionItem[] {
  // 1. Find the enclosing scope
  const scopeEntry = findScopeAtOffset(ctx, byteOffset);
  const scopeId = scopeEntry?.id ?? null;

  // 2. Resolve `varName` lexically to find its declaration
  const varDecls = resolveName(ctx, varName, scopeId);

  // Fallback: global name search across the entire index.
  // This handles cases where tree-sitter parse errors (from incomplete text
  // during typing) corrupt the scope hierarchy, causing lexical resolution
  // to miss symbols that are actually in scope.
  if (varDecls.length === 0) {
    const globalIds = ctx.index.byName.get(varName);
    if (globalIds) {
      for (const id of globalIds) {
        const entry = ctx.index.symbols.get(id);
        if (
          entry &&
          isDecl(entry) &&
          (isTopLevel(ctx, entry) || !entry.resourceId || entry.resourceId === ctx.documentUri)
        ) {
          varDecls.push(entry);
        }
      }
    }
  }

  if (varDecls.length === 0) return [];

  const varDecl = varDecls[0]!;

  // 3. Resolve the type of the variable using generic strategies
  const typeDecl = resolveTypeOf(ctx, varDecl);
  if (typeDecl) {
    return membersOf(ctx, typeDecl);
  }

  // 4. If the variable itself is a scope (e.g. a class), show its members directly
  const children = getExportedChildren(ctx, varDecl.id);
  if (children.length > 0) {
    return children
      .filter((child) => isDecl(child))
      .map((child) => ({
        label: child.name,
        kind: mapSymbolKind(child.kind),
        detail: child.kind,
      }));
  }

  return [];
}

/**
 * Detect if the cursor is inside a class modification `(...)` and return
 * the members of the type being modified.
 *
 * Example: `A a(|)` → cursor is inside parens → show members of A.
 * Also handles nested: `A a(x(|))` → show members of x's type.
 */
function completeModificationContext(
  ctx: BridgeContext,
  byteOffset: number,
  before: string,
): LSPCompletionItem[] | null {
  // Count parentheses depth backwards from cursor to find if we're inside (...)
  let depth = 0;
  let parenPos = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ")") depth++;
    if (ch === "(") {
      if (depth === 0) {
        parenPos = i;
        break;
      }
      depth--;
    }
  }
  if (parenPos < 0) return null;

  // Text before the opening paren — look for `TypeName varName (`
  const beforeParen = before.slice(0, parenPos).trimEnd();
  const typeName = extractModificationTargetType(beforeParen, false, getRootCstNode(ctx), parenPos);
  if (!typeName) return null;

  // Resolve the type
  const scopeEntry = findScopeAtOffset(ctx, byteOffset);
  const scopeId = scopeEntry?.id ?? null;
  const typeDecls = resolveName(ctx, typeName, scopeId);
  if (typeDecls.length === 0) return null;

  return membersOf(ctx, typeDecls[0]!);
}

/**
 * Get completion items for all members (exported children + inherited) of a type.
 */
function membersOf(ctx: BridgeContext, typeEntry: SymbolEntry): LSPCompletionItem[] {
  const results: LSPCompletionItem[] = [];
  const seen = new Set<string>();

  // Direct children (exclude reference-site entries like extends clauses)
  for (const child of getExportedChildren(ctx, typeEntry.id)) {
    if (!isDecl(child)) continue;
    if (!seen.has(child.name)) {
      seen.add(child.name);
      results.push({
        label: child.name,
        kind: mapSymbolKind(child.kind),
        detail: child.kind,
      });
    }
  }

  // Inherited members via resolver
  const inherited = getInheritedMembers(ctx, typeEntry.id);
  for (const member of inherited) {
    if (!seen.has(member.name)) {
      seen.add(member.name);
      results.push({
        label: member.name,
        kind: mapSymbolKind(member.kind),
        detail: `${member.kind} (inherited)`,
      });
    }
  }

  // Foreign cross-language member projection via TggSymbolProjectionTable
  const bridgeLang = getBridgeLanguage(ctx);
  const projTable = (
    ctx.index as {
      tggProjectionTable?: {
        projectForeignSignature?: (
          cand: SymbolEntry,
          idx: SymbolIndex,
          tgtLang: string,
        ) => {
          members: Array<{
            name: string;
            projectedType: string;
            role: "port" | "parameter" | "attribute" | "component";
            direction?: string;
          }>;
        };
      };
    }
  ).tggProjectionTable;
  if (
    projTable?.projectForeignSignature &&
    typeEntry.language &&
    bridgeLang &&
    typeEntry.language.toLowerCase() !== bridgeLang.toLowerCase()
  ) {
    const projected = projTable.projectForeignSignature(typeEntry, ctx.index, bridgeLang);
    for (const m of projected.members) {
      if (!seen.has(m.name)) {
        seen.add(m.name);
        const dirPrefix = m.direction ? `${m.direction} ` : "";
        results.push({
          label: m.name,
          kind: m.role === "component" || m.role === "port" ? LSPSymbolKind.Property : LSPSymbolKind.Variable,
          detail: `${dirPrefix}${m.projectedType} (${m.role} · ${typeEntry.language})`,
        });
      }
    }
  }

  // Virtual completion members defined in metadata
  if (typeEntry.metadata?.["completionMembers"] && Array.isArray(typeEntry.metadata["completionMembers"])) {
    for (const name of typeEntry.metadata["completionMembers"]) {
      if (!seen.has(name) && typeof name === "string") {
        seen.add(name);
        results.push({
          label: name,
          kind: LSPSymbolKind.Property,
          detail: "Property (built-in)",
        });
      }
    }
  }

  return results;
}
