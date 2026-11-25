// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId } from "@modelscript/runtime";
import { type BridgeContext, getGlobalLspBridgeEnv } from "./bridge-context.js";
import { findAncestorOrSelfByType, getNodeStartOffset } from "./cst-helpers.js";
import {
  collapseWs,
  MODELICA_CLAUSE_STOP_KEYWORDS,
  MODELICA_ELEMENT_PREFIXES,
  parseModelicaClausePrefixTokens,
  skipModelicaTrivia,
  startsWithWordAt,
} from "./lexical-helpers.js";

/**
 * Retrieves the source slice `[start, end]` for `entry` using the bound document, `QueryEngine.cstText`,
 * open workspace documents, or VFS fallback.
 */
export function getEntrySourceSlice(ctx: BridgeContext, entry: SymbolEntry, start: number, end: number): string | null {
  if (start < 0 || end < start) return null;
  try {
    if (ctx.engine && typeof ctx.engine.cstText === "function") {
      const res = ctx.engine.cstText(start, end, entry);
      if (typeof res === "string" && res.length > 0) return res;
    }
  } catch {
    // ignore cstText error and fall back to full source text
  }

  const fullText = getEntryFullSourceText(ctx, entry);
  if (fullText && start <= fullText.length) {
    return fullText.slice(start, Math.min(end, fullText.length));
  }
  return null;
}

/**
 * Retrieves the full source file text for `entry` (or at least `[0, entryEnd]`).
 */
export function getEntryFullSourceText(ctx: BridgeContext, entry: SymbolEntry): string | null {
  const uri = entry.resourceId || ctx.documentUri;
  if (!uri || uri === ctx.documentUri) {
    const localText = ctx.positions?.getSourceText?.();
    if (typeof localText === "string" && localText.length > 0) {
      return localText;
    }
  }

  if (uri) {
    const globalEnv = getGlobalLspBridgeEnv();
    const otherBridge = ctx.env?.documentLSPBridges?.get(uri) ?? globalEnv.documentLSPBridges?.get(uri);
    const otherBridgeText = otherBridge?.positions?.getSourceText?.();
    if (typeof otherBridgeText === "string" && otherBridgeText.length > 0) {
      return otherBridgeText;
    }
    const openDocText = ctx.env?.documents?.get(uri)?.getText?.() ?? globalEnv.documents?.get(uri)?.getText?.();
    if (typeof openDocText === "string" && openDocText.length > 0) {
      return openDocText;
    }
    const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
    const sharedFs = ctx.env?.sharedFs ?? globalEnv.sharedFs;
    const sharedText =
      sharedFs?.readFile?.(uri) ??
      sharedFs?.read?.(fsPath) ??
      (uri.startsWith("sources/")
        ? sharedFs?.read?.(`/modelscript_registry/Modelica/4.1.0/${uri.substring("sources/".length)}`)
        : undefined);
    if (typeof sharedText === "string" && sharedText.length > 0) {
      return sharedText;
    }
  }

  try {
    if (ctx.engine && typeof ctx.engine.cstText === "function") {
      const full = ctx.engine.cstText(0, 10_000_000, entry);
      if (typeof full === "string" && full.length > 0) return full;
      const entryEnd = entry.endOffset ?? 0;
      if (entryEnd > 0) {
        const prefix = ctx.engine.cstText(0, entryEnd, entry);
        if (typeof prefix === "string" && prefix.length > 0) return prefix;
      }
    }
  } catch {
    // ignore cstText error
  }

  return null;
}

/**
 * Resolves the backing WASM CST `SyntaxNode` for `entry` when a parser tree is available
 * on the active `QueryEngine`, another open workspace bridge, or `env.documents`.
 */
export function getEntryCstNode(ctx: BridgeContext, entry?: SymbolEntry | null): SyntaxNode | null {
  if (!entry) return null;
  type EngineCstAccess = {
    cstNode?(id: SymbolId): SyntaxNode | null | undefined;
    toQueryDB?(): { cstNode?(id: SymbolId): SyntaxNode | null | undefined } | null;
  };
  type BridgeGlobals = {
    documentLSPBridges?: Map<string, { engine?: unknown }>;
    documents?: Map<string, { tree?: { rootNode?: SyntaxNode } }>;
  };
  const globals = globalThis as unknown as BridgeGlobals;
  try {
    const eng = ctx.engine as unknown as EngineCstAccess | undefined;
    if (eng && typeof eng.cstNode === "function") {
      const node = eng.cstNode(entry.id);
      if (node && typeof node.type === "string") return node;
    }
    const db = eng && typeof eng.toQueryDB === "function" ? eng.toQueryDB() : null;
    if (db && typeof db.cstNode === "function") {
      const node = db.cstNode(entry.id);
      if (node && typeof node.type === "string") return node;
    }
    const uri = entry.resourceId || ctx.documentUri;
    if (uri) {
      const otherBridge = ctx.env?.documentLSPBridges?.get(uri) ?? globals.documentLSPBridges?.get(uri);
      const otherEng = (otherBridge as unknown as { engine?: unknown } | undefined)?.engine as
        EngineCstAccess | undefined;
      if (otherEng && typeof otherEng.cstNode === "function") {
        const node = otherEng.cstNode(entry.id);
        if (node && typeof node.type === "string") return node;
      }
      const doc = ctx.env?.documents?.get(uri) ?? globals.documents?.get(uri);
      const root = (doc as { tree?: { rootNode?: SyntaxNode } } | undefined)?.tree?.rootNode;
      if (root && typeof root.descendantForIndex === "function" && entry.startOffset !== undefined) {
        const node = root.descendantForIndex(entry.startOffset, entry.endOffset ?? entry.startOffset);
        if (node && typeof node.type === "string") return node;
      }
    }
  } catch {
    // ignore CST access error
  }
  return null;
}

/**
 * Resolves the root WASM CST `SyntaxNode` for `resourceUri` (or the bridge's bound document).
 */
export function getRootCstNode(ctx: BridgeContext, resourceUri?: string): SyntaxNode | null {
  type EngineRootAccess = {
    tree?: { rootNode?: SyntaxNode };
    toQueryDB?(): { tree?: { rootNode?: SyntaxNode } } | null;
  };
  type BridgeGlobals = {
    documentLSPBridges?: Map<string, { engine?: unknown }>;
    documents?: Map<string, { tree?: { rootNode?: SyntaxNode } }>;
  };
  const globals = globalThis as unknown as BridgeGlobals;
  try {
    const eng = ctx.engine as unknown as EngineRootAccess | undefined;
    if (!resourceUri || resourceUri === ctx.documentUri) {
      const directRoot = eng?.tree?.rootNode ?? eng?.toQueryDB?.()?.tree?.rootNode;
      if (directRoot && typeof directRoot.descendantForIndex === "function") {
        return directRoot;
      }
    }
    const uri = resourceUri || ctx.documentUri;
    if (uri) {
      const otherBridge = ctx.env?.documentLSPBridges?.get(uri) ?? globals.documentLSPBridges?.get(uri);
      const otherEng = (otherBridge as unknown as { engine?: unknown } | undefined)?.engine as
        EngineRootAccess | undefined;
      const otherRoot = otherEng?.tree?.rootNode ?? otherEng?.toQueryDB?.()?.tree?.rootNode;
      if (otherRoot && typeof otherRoot.descendantForIndex === "function") {
        return otherRoot;
      }
      const doc = ctx.env?.documents?.get(uri) ?? globals.documents?.get(uri);
      const docRoot = (doc as { tree?: { rootNode?: SyntaxNode } } | undefined)?.tree?.rootNode;
      if (docRoot && typeof docRoot.descendantForIndex === "function") {
        return docRoot;
      }
    }
  } catch {
    // ignore root CST access error
  }
  return null;
}

/**
 * Extracts the `type_prefix` and `type_specifier` from the enclosing Modelica `component_clause`
 * preceding `entry` when `entry` only spans `component_declaration` (e.g. `V(start=1) "..."`).
 */
export function extractComponentClausePrefix(
  ctx: BridgeContext,
  entry: SymbolEntry,
): { fullPrefix: string; typePrefix: string; typeSpecifier: string; clauseStartOffset: number } | null {
  const rawNode = getEntryCstNode(ctx, entry);
  const clauseNode = findAncestorOrSelfByType(
    rawNode,
    ["component_clause", "component_clause1"],
    ["element_list", "composition", "class_definition", "stored_definition", "program"],
  );
  if (clauseNode && !clauseNode.hasError) {
    const elementNode = clauseNode.parent?.type === "element" ? clauseNode.parent : null;
    const prefixes: string[] = [];
    if (elementNode) {
      const clauseStart = getNodeStartOffset(clauseNode);
      for (const child of elementNode.children) {
        if (getNodeStartOffset(child) >= clauseStart) break;
        const kw = child.text.trim();
        if (MODELICA_ELEMENT_PREFIXES.has(kw)) {
          prefixes.push(kw);
        }
      }
    }
    const tpNode = clauseNode.childForFieldName("type_prefix");
    if (tpNode) {
      const tp = collapseWs(tpNode.text);
      if (tp) prefixes.push(tp);
    }
    const tsNode = clauseNode.childForFieldName("type_specifier");
    const typeSpecifier = tsNode ? collapseWs(tsNode.text) : "";
    if (typeSpecifier) {
      const typePrefix = collapseWs(prefixes.join(" "));
      const fullPrefix = typePrefix ? `${typePrefix} ${typeSpecifier}` : typeSpecifier;
      const outerNode = elementNode ?? clauseNode;
      return {
        fullPrefix,
        typePrefix,
        typeSpecifier,
        clauseStartOffset: getNodeStartOffset(outerNode),
      };
    }
  }

  const entryStart = entry.startOffset ?? 0;
  const fullText = getEntryFullSourceText(ctx, entry);
  if (!fullText || entryStart <= 0 || entryStart > fullText.length) return null;

  // Fallback: scan backwards from entryStart to find the start of the component_clause
  // (after the previous `;`, `{`, or class header string/name).
  const lookbackStart = Math.max(0, entryStart - 500);
  const before = fullText.slice(lookbackStart, entryStart);

  // Find the last statement boundary (`;`, `{`, or section keyword `public`/`protected`) at paren depth 0
  let depth = 0;
  let inString = false;
  let clauseRelStart = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]!;
    if (ch === '"' && (i === 0 || before[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) {
        clauseRelStart = i + 1;
        break;
      }
      depth--;
    } else if (depth === 0 && ch === ";") {
      clauseRelStart = i + 1;
      break;
    }
  }

  let rawClauseBefore = before.slice(clauseRelStart);
  let clauseStartOffset = lookbackStart + clauseRelStart;

  // Strip leading comments and section keywords (`public`, `protected`)
  let leadingIdx = 0;
  while (leadingIdx < rawClauseBefore.length) {
    leadingIdx = skipModelicaTrivia(rawClauseBefore, leadingIdx);
    if (startsWithWordAt(rawClauseBefore, leadingIdx, "public")) {
      leadingIdx += "public".length;
      continue;
    }
    if (startsWithWordAt(rawClauseBefore, leadingIdx, "protected")) {
      leadingIdx += "protected".length;
      continue;
    }
    break;
  }
  if (leadingIdx > 0) {
    rawClauseBefore = rawClauseBefore.slice(leadingIdx);
    clauseStartOffset += leadingIdx;
  }

  const trimmedClause = rawClauseBefore.trim();
  if (!trimmedClause) {
    return {
      fullPrefix: "",
      typePrefix: "",
      typeSpecifier: "",
      clauseStartOffset: entryStart,
    };
  }

  const parsed = parseModelicaClausePrefixTokens(trimmedClause);
  if (!parsed) return null;

  // Avoid matching class header keywords (`model Foo`) if there was no `;` after class header
  if (!parsed.typePrefix && MODELICA_CLAUSE_STOP_KEYWORDS.has(parsed.typeSpecifier)) {
    // Look after the last newline in `rawClauseBefore` instead
    const lastNl = rawClauseBefore.lastIndexOf("\n");
    if (lastNl !== -1) {
      const lineBefore = rawClauseBefore.slice(lastNl + 1).trim();
      const lineParsed = parseModelicaClausePrefixTokens(lineBefore);
      if (lineParsed) {
        return {
          fullPrefix: lineParsed.fullPrefix,
          typePrefix: lineParsed.typePrefix,
          typeSpecifier: lineParsed.typeSpecifier,
          clauseStartOffset: clauseStartOffset + lastNl + 1,
        };
      }
    }
    return null;
  }

  return {
    fullPrefix: parsed.fullPrefix,
    typePrefix: parsed.typePrefix,
    typeSpecifier: parsed.typeSpecifier,
    clauseStartOffset,
  };
}
