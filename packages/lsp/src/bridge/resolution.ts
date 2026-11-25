// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolId } from "@modelscript/runtime";
import {
  type BridgeContext,
  getBridgeLanguage,
  getExportedChildren,
  getQualifiedName,
  isCompatibleGlobalCandidate,
  isDecl,
  isTopLevel,
} from "./bridge-context.js";
import { findAncestorOrSelfByType, getNodeEndOffset, getNodeStartOffset } from "./cst-helpers.js";
import {
  readIdentAt,
  readQualifiedNameAt,
  skipWs,
  splitQualifiedPath,
  startsWithWordAt,
  stripWs,
} from "./lexical-helpers.js";
import { extractComponentClausePrefix, getEntryCstNode, getEntrySourceSlice } from "./source-access.js";

/** Resolves a reference symbol entry to its target declaration(s). */
export function resolveRef(ctx: BridgeContext, refEntry: SymbolEntry): SymbolEntry[] {
  if (isDecl(refEntry)) return [refEntry];
  const targetName =
    (typeof refEntry.metadata?.["typeSpecifier"] === "string" && refEntry.metadata["typeSpecifier"]) || refEntry.name;
  return resolveName(ctx, targetName, refEntry.parentId);
}

/**
 * Resolves a simple or qualified (`A.B.C` / `A::B::C`) identifier name starting from `scopeId`,
 * consulting Salsa `resolveSimpleName`, lexical scopes, import clauses, and global index lookup.
 */
export function resolveName(ctx: BridgeContext, name: string, scopeId: SymbolId | null): SymbolEntry[] {
  const trimmed = name.trim();
  if (!trimmed || ctx.resolveDepth > 16) return [];

  const callKey = `qual:${trimmed}@${scopeId ?? "root"}`;
  if (ctx.activeResolveKeys.has(callKey)) return [];
  ctx.activeResolveKeys.add(callKey);
  ctx.resolveDepth++;

  try {
    const engFqn = ctx.engine as unknown as { ensureFQNIndexed?(fqn: string): void } | undefined;
    if (typeof engFqn?.ensureFQNIndexed === "function") {
      try {
        engFqn.ensureFQNIndexed(trimmed.replaceAll("::", "."));
      } catch {
        // ignore lazy indexing failure
      }
    }

    if (trimmed.includes(".") || trimmed.includes("::")) {
      const segments = splitQualifiedPath(trimmed);
      if (segments.length > 1) {
        const resolved = resolveQualifiedSegments(ctx, segments, scopeId);
        if (resolved.length > 0) return resolved;
      }
    }

    return resolveSimpleName(ctx, trimmed, scopeId);
  } finally {
    ctx.resolveDepth--;
    ctx.activeResolveKeys.delete(callKey);
  }
}

/** Resolves a single (unqualified) identifier name starting from `scopeId`. */
export function resolveSimpleName(ctx: BridgeContext, name: string, scopeId: SymbolId | null): SymbolEntry[] {
  if (!name || ctx.resolveDepth > 16) return [];

  const simpleKey = `simple:${name}@${scopeId ?? "root"}`;
  if (ctx.activeResolveKeys.has(simpleKey)) return [];
  ctx.activeResolveKeys.add(simpleKey);
  ctx.resolveDepth++;

  try {
    if (scopeId !== null && ctx.engine && typeof ctx.engine.query === "function") {
      try {
        const resolver = ctx.engine.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId);
        const resolved = typeof resolver === "function" ? resolver(name) : null;
        if (resolved && isDecl(resolved)) {
          return [resolved];
        }
      } catch {
        // fallback to lexical walk
      }
    }
    let current = scopeId;
    const visitedScopes = new Set<SymbolId>();
    while (current !== null && !visitedScopes.has(current)) {
      visitedScopes.add(current);
      const children = ctx.index.childrenOf.get(current) || [];
      for (const childId of children) {
        const entry = ctx.index.symbols.get(childId);
        if (entry && entry.name === name && isDecl(entry)) {
          return [entry];
        }
      }
      // Check Import clauses in this scope
      for (const childId of children) {
        const entry = ctx.index.symbols.get(childId);
        if (entry && entry.kind === "Import") {
          const imported = resolveViaImportClause(ctx, entry, name);
          if (imported.length > 0) return imported;
        }
      }
      const parent = ctx.index.symbols.get(current);
      current = parent?.parentId ?? null;
    }
    const globalIds = ctx.index.byName.get(name) || [];
    const sameLangResults: SymbolEntry[] = [];
    const foreignResults: SymbolEntry[] = [];
    const bridgeLang = getBridgeLanguage(ctx);
    for (const id of globalIds) {
      const entry = ctx.index.symbols.get(id);
      if (entry && isDecl(entry) && isTopLevel(ctx, entry) && isCompatibleGlobalCandidate(ctx, entry)) {
        if (!bridgeLang || !entry.language || entry.language.toLowerCase() === bridgeLang) {
          sameLangResults.push(entry);
        } else {
          foreignResults.push(entry);
        }
      }
    }
    return sameLangResults.length > 0 ? sameLangResults : foreignResults;
  } finally {
    ctx.resolveDepth--;
    ctx.activeResolveKeys.delete(simpleKey);
  }
}

/** Attempts to resolve `name` through an `Import` symbol entry (`import A.B.C`, `import X = A.B`, `import A.B.*`). */
export function resolveViaImportClause(ctx: BridgeContext, importEntry: SymbolEntry, name: string): SymbolEntry[] {
  if (ctx.activeImportIds.has(importEntry.id) || ctx.resolveDepth > 16) return [];
  ctx.activeImportIds.add(importEntry.id);
  try {
    const meta = importEntry.metadata;
    const shortName = typeof meta?.["shortName"] === "string" ? meta["shortName"] : undefined;
    const pkgName = typeof meta?.["packageName"] === "string" ? meta["packageName"] : undefined;
    if (shortName && pkgName && shortName === name) {
      return resolveName(ctx, pkgName, null);
    }

    const rawNode = getEntryCstNode(ctx, importEntry);
    const importNode = findAncestorOrSelfByType(
      rawNode,
      ["import_clause"],
      ["element_list", "stored_definition", "program"],
    );
    if (importNode && !importNode.hasError) {
      const aliasNode = importNode.childForFieldName("alias");
      const nameNode = importNode.childForFieldName("name");
      const importListNode = importNode.childForFieldName("import_list");
      if (aliasNode && nameNode) {
        if (aliasNode.text.trim() === name) {
          return resolveName(ctx, stripWs(nameNode.text), null);
        }
        return [];
      }
      if (nameNode && importListNode) {
        const pkgPrefix = stripWs(nameNode.text);
        for (const item of importListNode.namedChildren) {
          if (item.text.trim() === name) {
            return resolveName(ctx, `${pkgPrefix}.${name}`, null);
          }
        }
        return [];
      }
      if (nameNode) {
        const targetName = stripWs(nameNode.text);
        const descNode = importNode.childForFieldName("description");
        const limitStart = descNode ? getNodeStartOffset(descNode) : getNodeEndOffset(importNode);
        const nameEnd = getNodeEndOffset(nameNode);
        const isWildcard = importNode.children.some((child) => {
          const cStart = getNodeStartOffset(child);
          const t = child.text.trim();
          return cStart >= nameEnd && cStart < limitStart && (t === ".*" || t === "*" || t === "::*");
        });
        if (isWildcard) {
          if (!targetName || targetName === name) return [];
          return resolveName(ctx, `${targetName}.${name}`, null);
        }
        const parts = splitQualifiedPath(targetName);
        if (parts.length > 1 && parts[parts.length - 1] === name) {
          return resolveName(ctx, targetName, null);
        }
        return [];
      }
    }

    // Fallback when CST is unavailable (e.g. unit test mocks) or has syntax errors
    const rawText = getEntrySourceSlice(ctx, importEntry, importEntry.startOffset, importEntry.endOffset);
    const src = (rawText || importEntry.name || "").trim();
    if (!src) return [];

    let idx = 0;
    if (startsWithWordAt(src, idx, "import")) {
      idx = skipWs(src, idx + "import".length);
    }

    const firstIdent = readIdentAt(src, idx);
    if (firstIdent) {
      const eqIdx = skipWs(src, firstIdent.end);
      if (src[eqIdx] === "=") {
        if (firstIdent.ident !== name) return [];
        const rhsStart = skipWs(src, eqIdx + 1);
        const rhs = readQualifiedNameAt(src, rhsStart);
        return rhs ? resolveName(ctx, rhs.name, null) : [];
      }
    }

    const pkgPath = readQualifiedNameAt(src, idx);
    if (!pkgPath) return [];
    const afterPkg = skipWs(src, pkgPath.end);

    // Selective import: `import Modelica.Units.SI.{Voltage, Current}`
    if (src[afterPkg] === "." && src[skipWs(src, afterPkg + 1)] === "{") {
      const braceStart = skipWs(src, afterPkg + 1) + 1;
      const braceEnd = src.indexOf("}", braceStart);
      const listSlice = braceEnd === -1 ? src.slice(braceStart) : src.slice(braceStart, braceEnd);
      for (const item of listSlice.split(",")) {
        if (item.trim() === name) {
          return resolveName(ctx, `${pkgPath.name}.${name}`, null);
        }
      }
      return [];
    }

    // Wildcard import: `import Modelica.Electrical.Analog.Sources.*` or `Pkg::*`
    if (
      src.startsWith(".*", afterPkg) ||
      src.startsWith("::*", afterPkg) ||
      (src[afterPkg] === "." && src[skipWs(src, afterPkg + 1)] === "*")
    ) {
      if (!pkgPath.name || pkgPath.name === name) return [];
      return resolveName(ctx, `${pkgPath.name}.${name}`, null);
    }

    // Qualified import: `import Modelica.Electrical.Analog.Sources.SineVoltage`
    const parts = splitQualifiedPath(pkgPath.name);
    if (parts.length > 1 && parts[parts.length - 1] === name) {
      return resolveName(ctx, pkgPath.name, null);
    }
    return [];
  } finally {
    ctx.activeImportIds.delete(importEntry.id);
  }
}

/**
 * Resolves a multi-segment path `segments` (e.g. `["Modelica", "Electrical", "Analog", "Sources", "SineVoltage"]`
 * or `["Vb", "p"]`) starting from `scopeId`.
 */
export function resolveQualifiedSegments(
  ctx: BridgeContext,
  segments: string[],
  scopeId: SymbolId | null,
): SymbolEntry[] {
  if (segments.length === 0 || ctx.resolveDepth > 16) return [];
  const firstSeg = segments[0]!;
  const roots = resolveSimpleName(ctx, firstSeg, scopeId);

  const stepIntoMember = (container: SymbolEntry, memberName: string): SymbolEntry[] => {
    const matches: SymbolEntry[] = [];
    const seenIds = new Set<SymbolId>();
    const addMatch = (e: SymbolEntry) => {
      if (!seenIds.has(e.id) && isDecl(e)) {
        seenIds.add(e.id);
        matches.push(e);
      }
    };

    // 1. Direct children of container
    for (const child of getExportedChildren(ctx, container.id)) {
      if (child.name === memberName) addMatch(child);
    }
    if (matches.length > 0) return matches;

    // 2. Inherited members if container is a class/type and direct lookup did not match
    const isClassOrPackage =
      container.kind === "Class" ||
      container.kind === "Type" ||
      container.kind === "Interface" ||
      container.kind === "Struct" ||
      container.kind === "Package";

    if (isClassOrPackage) {
      for (const inherited of getInheritedMembers(ctx, container.id)) {
        if (inherited.name === memberName) addMatch(inherited);
      }
      return matches;
    }

    // 3. If container is a Component / Variable / Usage (not a class/package/function), step into its type
    if (container.kind !== "Function") {
      const typeDecl = resolveTypeOf(ctx, container);
      if (typeDecl && typeDecl.id !== container.id) {
        for (const child of getExportedChildren(ctx, typeDecl.id)) {
          if (child.name === memberName) addMatch(child);
        }
        if (matches.length === 0) {
          for (const inherited of getInheritedMembers(ctx, typeDecl.id)) {
            if (inherited.name === memberName) addMatch(inherited);
          }
        }
      }
    }

    return matches;
  };

  let currentCandidates = roots;
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]!;
    const nextCandidates: SymbolEntry[] = [];
    for (const cand of currentCandidates) {
      nextCandidates.push(...stepIntoMember(cand, seg));
    }
    currentCandidates = nextCandidates;
    if (currentCandidates.length === 0) break;
  }

  if (currentCandidates.length > 0) {
    return currentCandidates;
  }

  // Fallback: match suffix against qualified names of global symbols matching the last segment
  const lastSeg = segments[segments.length - 1]!;
  const targetSuffix = segments.join(".");
  const globalIds = ctx.index.byName.get(lastSeg) || [];
  const suffixMatches: SymbolEntry[] = [];
  for (const id of globalIds) {
    const entry = ctx.index.symbols.get(id);
    if (entry && isDecl(entry)) {
      const fqn = getQualifiedName(ctx, entry, ".");
      if (fqn === targetSuffix || fqn.endsWith(`.${targetSuffix}`)) {
        suffixMatches.push(entry);
      }
    }
  }
  return suffixMatches;
}

/** Collects all declaration symbols lexically visible from `scopeId` up to the root scope. */
export function getVisibleSymbols(ctx: BridgeContext, scopeId: SymbolId | null): SymbolEntry[] {
  const visible: SymbolEntry[] = [];
  const seenNames = new Set<string>();
  const visitedScopes = new Set<SymbolId>();
  let current = scopeId;
  while (current !== null && !visitedScopes.has(current)) {
    visitedScopes.add(current);
    const children = ctx.index.childrenOf.get(current) || [];
    for (const childId of children) {
      const entry = ctx.index.symbols.get(childId);
      if (entry && isDecl(entry) && !seenNames.has(entry.name)) {
        visible.push(entry);
        seenNames.add(entry.name);
      }
    }
    const parent = ctx.index.symbols.get(current);
    current = parent?.parentId ?? null;
  }
  const topLevel = ctx.index.childrenOf.get(null) || ctx.index.childrenOf.get(0) || [];
  for (const childId of topLevel) {
    const entry = ctx.index.symbols.get(childId);
    if (entry && isDecl(entry) && !seenNames.has(entry.name)) {
      visible.push(entry);
      seenNames.add(entry.name);
    }
  }
  return visible;
}

/**
 * Collects all inherited member declarations via BFS traversal of both `entry.inherits`
 * and child `Extends` clauses on `typeId`.
 */
export function getInheritedMembers(ctx: BridgeContext, typeId: SymbolId): SymbolEntry[] {
  if (ctx.activeInheritedIds.has(typeId) || ctx.resolveDepth > 16) return [];
  const inherited: SymbolEntry[] = [];
  const seen = new Set<SymbolId>();
  const addedHere: SymbolId[] = [];
  const queue = [typeId];
  try {
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (seen.has(currentId) || ctx.activeInheritedIds.has(currentId)) continue;
      seen.add(currentId);
      ctx.activeInheritedIds.add(currentId);
      addedHere.push(currentId);

      const entry = ctx.index.symbols.get(currentId);
      if (!entry) continue;

      const baseNames = new Set<string>(entry.inherits || []);
      for (const child of getExportedChildren(ctx, currentId)) {
        if (child.kind === "Extends") {
          const extType =
            (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
          if (extType) baseNames.add(extType);
        }
      }

      for (const inheritPath of baseNames) {
        let targetDecls = resolveName(ctx, inheritPath, currentId);
        if (targetDecls.length === 0) {
          targetDecls = resolveName(ctx, inheritPath, entry.parentId);
        }
        for (const target of targetDecls) {
          if (target.id === currentId || seen.has(target.id) || ctx.activeInheritedIds.has(target.id)) continue;
          queue.push(target.id);
          const children = getExportedChildren(ctx, target.id);
          for (const child of children) {
            if (isDecl(child)) {
              inherited.push(child);
            }
          }
        }
      }
    }
  } finally {
    for (const id of addedHere) {
      ctx.activeInheritedIds.delete(id);
    }
  }
  return inherited;
}

/**
 * Resolve the type of a symbol entry, language-agnostically.
 *
 * Strategy 1: Scan metadata values for strings that resolve to a known
 *   definition/class/type in the index. This covers Modelica-style metadata
 *   (e.g. `attributes: { typeSpecifier: self.typeSpecifier }`).
 *
 * Strategy 2: Look at child Reference entries. Languages using `ref()` for
 *   type annotations (e.g. SysML2's `OwnedFeatureTyping`) automatically get
 *   indexed Reference children whose name is the referenced type.
 */
export function resolveTypeOf(ctx: BridgeContext, entry: SymbolEntry): SymbolEntry | null {
  if (
    ctx.activeTypeOfIds.has(entry.id) ||
    ctx.resolveDepth > 16 ||
    entry.kind === "Package" ||
    entry.kind === "Class" ||
    entry.kind === "Function"
  ) {
    return null;
  }
  ctx.activeTypeOfIds.add(entry.id);
  try {
    // Strategy 1: Prioritize explicit typeSpecifier / type metadata first
    if (entry.metadata) {
      const preferredKeys = ["typeSpecifier", "type", "className"];
      for (const key of preferredKeys) {
        const value = entry.metadata[key];
        if (typeof value === "string" && value.length > 0) {
          const typeDecls = resolveName(ctx, value, entry.parentId);
          if (typeDecls.length > 0 && isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }
      for (const [key, value] of Object.entries(entry.metadata)) {
        if (
          key === "description" ||
          key === "typePrefix" ||
          key === "classPrefixes" ||
          key === "classKind" ||
          key === "isPredefined"
        ) {
          continue;
        }
        if (typeof value === "string" && value.length > 0) {
          const typeDecls = resolveName(ctx, value, entry.parentId);
          if (typeDecls.length > 0 && isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }
    }

    // Strategy 2: Check child Reference entries (from ref() hooks)
    // Explicitly filter for `c.kind === "Reference"` so Extends/Import/ConnectEquation are never treated as type refs
    const childRefs = getExportedChildren(ctx, entry.id).filter((c) => c.kind === "Reference");
    for (const ref of childRefs) {
      if (ref.name && ref.name.length > 0) {
        // Try lexical resolution first, then global byName fallback
        const typeDecls = resolveName(ctx, ref.name, entry.parentId);
        if (typeDecls.length === 0) {
          const globalIds = ctx.index.byName.get(ref.name);
          if (globalIds) {
            for (const id of globalIds) {
              const globalEntry = ctx.index.symbols.get(id);
              if (
                globalEntry &&
                isDecl(globalEntry) &&
                (globalEntry.kind === "Class" ||
                  globalEntry.kind === "Type" ||
                  globalEntry.kind === "Package" ||
                  globalEntry.kind === "Interface" ||
                  globalEntry.kind === "Struct" ||
                  globalEntry.kind === "Definition" ||
                  Boolean(globalEntry.metadata?.["isPredefined"]))
              ) {
                typeDecls.push(globalEntry);
              }
            }
          }
        }
        if (typeDecls.length > 0 && isDecl(typeDecls[0]!)) {
          return typeDecls[0]!;
        }
      }
    }

    // Strategy 3: For Modelica components lacking metadata.typeSpecifier, inspect the clause prefix in source text
    if (entry.kind === "Component" || entry.kind === "Variable") {
      const clausePrefix = extractComponentClausePrefix(ctx, entry);
      if (clausePrefix?.typeSpecifier) {
        const typeDecls = resolveName(ctx, clausePrefix.typeSpecifier, entry.parentId);
        if (typeDecls.length > 0 && isDecl(typeDecls[0]!)) {
          return typeDecls[0]!;
        }
      }
    }

    return null;
  } finally {
    ctx.activeTypeOfIds.delete(entry.id);
  }
}

/** Finds all reference symbol entries across the index that resolve to `declId`. */
export function findRefs(ctx: BridgeContext, declId: SymbolId): SymbolEntry[] {
  const decl = ctx.index.symbols.get(declId);
  if (!decl) return [];
  const matchingIds = ctx.index.byName.get(decl.name) || [];
  const refs: SymbolEntry[] = [];
  for (const id of matchingIds) {
    const entry = ctx.index.symbols.get(id);
    if (entry && !isDecl(entry)) {
      const resolved = resolveRef(ctx, entry);
      if (resolved.some((d) => d.id === declId)) {
        refs.push(entry);
      }
    }
  }
  return refs;
}

/** Collects cross-language counterpart symbol IDs bound to `symbolId` via `WasmQueryEngine` or `TggCorrespondenceIndexer`. */
export function collectCrossDomainCounterpartIds(ctx: BridgeContext, symbolId: SymbolId): Set<SymbolId> {
  const peers = new Set<SymbolId>();
  const engCross = ctx.engine as unknown as { crossDomainBinding?(id: SymbolId): Set<SymbolId> } | undefined;
  if (typeof engCross?.crossDomainBinding === "function") {
    try {
      for (const bid of engCross.crossDomainBinding(symbolId)) {
        if (bid !== symbolId) peers.add(bid);
      }
    } catch {
      // ignore cross-domain binding query error
    }
  }
  const corrIndexer = (
    ctx.index as {
      tggCorrespondenceIndexer?: {
        getSlotsForSymbol?: (id: SymbolId) => ReadonlySet<number>;
        hypergraph?: {
          getRecord?: (slot: number) => { isRemoved?: boolean; domainNodes?: Record<number, number> } | null;
        };
      };
    }
  ).tggCorrespondenceIndexer;
  if (corrIndexer && typeof corrIndexer.getSlotsForSymbol === "function") {
    for (const slot of corrIndexer.getSlotsForSymbol(symbolId)) {
      const rec = corrIndexer.hypergraph?.getRecord?.(slot);
      if (!rec || rec.isRemoved || !rec.domainNodes) continue;
      for (const memberId of Object.values(rec.domainNodes)) {
        if (typeof memberId === "number" && memberId !== symbolId) {
          peers.add(memberId);
        }
      }
    }
  }
  return peers;
}
