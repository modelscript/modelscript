// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import type { QueryEngine } from "@modelscript/runtime/wasm_query_engine.js";

// ---------------------------------------------------------------------------
// LSP Protocol Types (minimal subset, avoids vscode-languageserver dep)
// ---------------------------------------------------------------------------

/** LSP SymbolKind enum (subset). */
export const enum LSPSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

/** Zero-based start and end line/character range in an LSP text document. */
export interface LSPRange {
  /** Zero-based start line and UTF-16 character offset. */
  start: { line: number; character: number };
  /** Zero-based end line and UTF-16 character offset. */
  end: { line: number; character: number };
}

/** URI and range identifying a specific span in a workspace document. */
export interface LSPLocation {
  /** Target document URI. */
  uri: string;
  /** Span within the target document. */
  range: LSPRange;
}

/** Hierarchical document symbol node for the Outline tree and breadcrumbs. */
export interface LSPDocumentSymbol {
  /** Display name of the symbol. */
  name: string;
  /** LSP symbol kind classification. */
  kind: LSPSymbolKind;
  /** Full enclosing range of the declaration. */
  range: LSPRange;
  /** Narrow identifier range highlighted when selecting the symbol. */
  selectionRange: LSPRange;
  /** Optional nested child symbols declared inside this symbol's scope. */
  children?: LSPDocumentSymbol[] | undefined;
}

/** Completion candidate item returned for `textDocument/completion`. */
export interface LSPCompletionItem {
  /** Identifier text inserted or displayed on completion. */
  label: string;
  /** LSP symbol classification icon. */
  kind: LSPSymbolKind;
  /** Optional short type or category detail string. */
  detail?: string | undefined;
}

/** Markdown hover card payload and optional highlighted token range. */
export interface LSPHover {
  /** Markdown-formatted hover documentation. */
  contents: string;
  /** Optional document range of the hovered symbol. */
  range?: LSPRange | undefined;
}

// ---------------------------------------------------------------------------
// Offset ↔ Position converter
// ---------------------------------------------------------------------------

/**
 * Converts byte offsets to LSP line/character positions.
 * Must be initialized with the source text.
 */
export class PositionIndex {
  /** Character offset of the start of each 0-indexed line. */
  private lineStarts: number[];
  /** UTF-8 byte offset of the start of each 0-indexed line. */
  private byteLineStarts: number[];
  /** Raw document source text. */
  private sourceText: string;
  /** Fast-path flag indicating whether the source contains only 7-bit ASCII characters. */
  private isPureAscii: boolean;

  /**
   * Builds a line-start lookup table for both character and UTF-8 byte offsets.
   *
   * @param sourceText - Full source text of the document.
   */
  constructor(sourceText: string) {
    this.sourceText = sourceText;
    this.lineStarts = [0];
    this.byteLineStarts = [0];

    let pureAscii = true;
    let byteOffset = 0;

    for (let i = 0; i < sourceText.length; i++) {
      const code = sourceText.charCodeAt(i);
      if (code > 0x7f) {
        pureAscii = false;
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < sourceText.length) {
          byteOffset += 4;
          i++; // Skip low surrogate
          continue;
        } else if (code <= 0x7ff) {
          byteOffset += 2;
        } else {
          byteOffset += 3;
        }
      } else {
        byteOffset += 1;
        if (code === 0x0a) {
          this.lineStarts.push(i + 1);
          this.byteLineStarts.push(byteOffset);
        }
      }
    }
    this.isPureAscii = pureAscii;
  }

  // ── Canonical character-offset API ──────────────────────────────────────

  /**
   * Convert a character offset to an LSP line/character position.
   * This is the preferred API — character offsets are the canonical
   * representation used by SyntaxNode.startOffset, SymbolEntry, etc.
   */
  charOffsetToPosition(charOffset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= charOffset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: Math.max(0, charOffset - this.lineStarts[lo]!) };
  }

  /**
   * Get the underlying source text.
   */
  getSourceText(): string {
    return this.sourceText;
  }

  /**
   * Convert an LSP line/character position back to a character offset.
   */
  positionToCharOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    return Math.min(this.lineStarts[line]! + character, this.sourceText.length);
  }

  /**
   * Convert a character offset range to an LSP range.
   */
  rangeFromOffsets(startOffset: number, endOffset: number): LSPRange {
    return {
      start: this.charOffsetToPosition(startOffset),
      end: this.charOffsetToPosition(endOffset),
    };
  }

  // ── Deprecated byte-based API ───────────────────────────────────────────
  // These methods convert UTF-8 byte offsets to positions. Since the codebase
  // is migrating to character offsets everywhere, prefer the methods above.

  /** @deprecated Use {@link charOffsetToPosition} with character offsets instead. */
  offsetToPosition(offset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.byteLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.byteLineStarts[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const byteDelta = offset - this.byteLineStarts[lo]!;
    if (this.isPureAscii || byteDelta <= 0) {
      return { line: lo, character: Math.max(0, byteDelta) };
    }

    const lineStartChar = this.lineStarts[lo]!;
    const nextLineStartChar = lo + 1 < this.lineStarts.length ? this.lineStarts[lo + 1]! : this.sourceText.length;
    let currByte = 0;
    let charIdx = lineStartChar;

    while (charIdx < nextLineStartChar && currByte < byteDelta) {
      const code = this.sourceText.charCodeAt(charIdx);
      if (code <= 0x7f) {
        currByte += 1;
        charIdx += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && charIdx + 1 < nextLineStartChar) {
        currByte += 4;
        charIdx += 2;
      } else if (code <= 0x7ff) {
        currByte += 2;
        charIdx += 1;
      } else {
        currByte += 3;
        charIdx += 1;
      }
    }

    return { line: lo, character: charIdx - lineStartChar };
  }

  /** @deprecated Use {@link positionToCharOffset} instead. */
  positionToOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    if (this.isPureAscii) {
      return this.lineStarts[line]! + character;
    }

    const lineStartChar = this.lineStarts[line]!;
    const targetCharIdx = Math.min(lineStartChar + character, this.sourceText.length);
    let byteDelta = 0;

    for (let i = lineStartChar; i < targetCharIdx; i++) {
      const code = this.sourceText.charCodeAt(i);
      if (code <= 0x7f) {
        byteDelta += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < targetCharIdx) {
        byteDelta += 4;
        i++;
      } else if (code <= 0x7ff) {
        byteDelta += 2;
      } else {
        byteDelta += 3;
      }
    }

    return this.byteLineStarts[line]! + byteDelta;
  }

  /** Total number of lines in the source. */
  get lineCount(): number {
    return this.lineStarts.length;
  }
}

// ---------------------------------------------------------------------------
// LSP Bridge — Maps metascript internals to LSP protocol responses
// ---------------------------------------------------------------------------

/**
 * Maps the metascript runtime (SymbolIndex, QueryEngine, ScopeResolver)
 * to LSP protocol responses.
 *
 * This class translates between the internal representation
 * and the JSON-RPC protocol used by LSP clients.
 */
export class LSPBridge {
  /** Line/character position converter for the bound document. */
  private positions: PositionIndex;
  /** Canonical URI of the bound document. */
  private documentUri: string;

  /**
   * Creates a new `LSPBridge` for a document.
   * Supports both 4-argument `(index, engine, positions, documentUri)` and legacy
   * 5-argument `(index, engine, resolver, positions, documentUri)` signatures.
   */
  constructor(
    private index: SymbolIndex,
    private engine: QueryEngine,
    arg3?: any,
    arg4?: any,
    arg5?: any,
  ) {
    if (arg5 !== undefined) {
      // (index, engine, resolver, positions, documentUri)
      this.positions = arg4;
      this.documentUri = arg5;
    } else if (arg4 !== undefined) {
      // (index, engine, positions, documentUri)
      this.positions = arg3;
      this.documentUri = arg4;
    } else {
      this.positions = arg3 ?? ({} as any);
      this.documentUri = "";
    }
  }

  /** Returns the underlying Salsa `QueryEngine` instance. */
  public getQueryEngine(): QueryEngine {
    return this.engine;
  }

  /** Returns the underlying `SymbolIndex` instance. */
  public getIndex(): SymbolIndex {
    return this.index;
  }

  /** Returns the URI of the document bound to this bridge. */
  public getDocumentUri(): string {
    return this.documentUri;
  }

  /** Re-entrancy guard for `resolveName` / `resolveSimpleName` (`name@scopeId`). */
  private activeResolveKeys = new Set<string>();
  /** Current recursion depth inside `resolveName` / `resolveSimpleName`. */
  private resolveDepth = 0;
  /** Re-entrancy guard for `resolveViaImportClause` (`importEntry.id`). */
  private activeImportIds = new Set<SymbolId>();
  /** Re-entrancy guard for `getInheritedMembers` (`typeId`). */
  private activeInheritedIds = new Set<SymbolId>();
  /** Re-entrancy guard for `resolveTypeOf` (`entry.id`). */
  private activeTypeOfIds = new Set<SymbolId>();
  /** Re-entrancy guard for `formatDeclaration` (`entry.id`). */
  private activeFormatIds = new Set<SymbolId>();
  /** Re-entrancy guard for `hoverEntry` (`entry.id`). */
  private activeHoverIds = new Set<SymbolId>();

  /** Checks whether a symbol entry represents a declaration rather than a reference or equation usage. */
  private isDecl(entry: SymbolEntry): boolean {
    return (
      entry.kind !== "Reference" &&
      entry.kind !== "ConnectEquation" &&
      entry.kind !== "FunctionCall" &&
      entry.kind !== "Extends" &&
      entry.kind !== "Import"
    );
  }

  /** Computes the dot-separated or `::`-separated qualified name for `entry` by walking its parent chain. */
  private getQualifiedName(entry: SymbolEntry, sep = "."): string {
    const parts: string[] = [];
    const seen = new Set<SymbolId>();
    let curr: SymbolEntry | undefined = entry;
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      if (
        curr.name &&
        curr.name !== "<anonymous>" &&
        curr.ruleName !== "SourceFile" &&
        curr.ruleName !== "source_file"
      ) {
        parts.unshift(curr.name);
      }
      curr = curr.parentId !== null ? this.index.symbols.get(curr.parentId) : undefined;
    }
    return parts.join(sep);
  }

  /** Resolves a reference symbol entry to its target declaration(s). */
  private resolveRef(refEntry: SymbolEntry): SymbolEntry[] {
    if (this.isDecl(refEntry)) return [refEntry];
    const targetName =
      (typeof refEntry.metadata?.["typeSpecifier"] === "string" && refEntry.metadata["typeSpecifier"]) || refEntry.name;
    return this.resolveName(targetName, refEntry.parentId);
  }

  /**
   * Resolves a simple or qualified (`A.B.C` / `A::B::C`) identifier name starting from `scopeId`,
   * consulting Salsa `resolveSimpleName`, lexical scopes, import clauses, and global index lookup.
   */
  private resolveName(name: string, scopeId: SymbolId | null): SymbolEntry[] {
    const trimmed = name.trim();
    if (!trimmed || this.resolveDepth > 16) return [];

    const callKey = `qual:${trimmed}@${scopeId ?? "root"}`;
    if (this.activeResolveKeys.has(callKey)) return [];
    this.activeResolveKeys.add(callKey);
    this.resolveDepth++;

    try {
      if (typeof (this.engine as any)?.ensureFQNIndexed === "function") {
        try {
          (this.engine as any).ensureFQNIndexed(trimmed.replace(/::/g, "."));
        } catch {
          // ignore
        }
      }

      if (trimmed.includes(".") || trimmed.includes("::")) {
        const segments = trimmed.split(/\.|::/).filter(Boolean);
        if (segments.length > 1) {
          const resolved = this.resolveQualifiedSegments(segments, scopeId);
          if (resolved.length > 0) return resolved;
        }
      }

      return this.resolveSimpleName(trimmed, scopeId);
    } finally {
      this.resolveDepth--;
      this.activeResolveKeys.delete(callKey);
    }
  }

  /** Resolves a single (unqualified) identifier name starting from `scopeId`. */
  private resolveSimpleName(name: string, scopeId: SymbolId | null): SymbolEntry[] {
    if (!name || this.resolveDepth > 16) return [];

    const simpleKey = `simple:${name}@${scopeId ?? "root"}`;
    if (this.activeResolveKeys.has(simpleKey)) return [];
    this.activeResolveKeys.add(simpleKey);
    this.resolveDepth++;

    try {
      if (scopeId !== null && this.engine && typeof this.engine.query === "function") {
        try {
          const resolver = this.engine.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId);
          const resolved = typeof resolver === "function" ? resolver(name) : null;
          if (resolved && this.isDecl(resolved)) {
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
        const children = this.index.childrenOf.get(current) || [];
        for (const childId of children) {
          const entry = this.index.symbols.get(childId);
          if (entry && entry.name === name && this.isDecl(entry)) {
            return [entry];
          }
        }
        // Check Import clauses in this scope
        for (const childId of children) {
          const entry = this.index.symbols.get(childId);
          if (entry && entry.kind === "Import") {
            const imported = this.resolveViaImportClause(entry, name);
            if (imported.length > 0) return imported;
          }
        }
        const parent = this.index.symbols.get(current);
        current = parent?.parentId ?? null;
      }
      const globalIds = this.index.byName.get(name) || [];
      const results: SymbolEntry[] = [];
      for (const id of globalIds) {
        const entry = this.index.symbols.get(id);
        if (entry && this.isDecl(entry)) {
          results.push(entry);
        }
      }
      return results;
    } finally {
      this.resolveDepth--;
      this.activeResolveKeys.delete(simpleKey);
    }
  }

  /** Attempts to resolve `name` through an `Import` symbol entry (`import A.B.C`, `import X = A.B`, `import A.B.*`). */
  private resolveViaImportClause(importEntry: SymbolEntry, name: string): SymbolEntry[] {
    if (this.activeImportIds.has(importEntry.id) || this.resolveDepth > 16) return [];
    this.activeImportIds.add(importEntry.id);
    try {
      const meta = importEntry.metadata;
      const shortName = typeof meta?.["shortName"] === "string" ? meta["shortName"] : undefined;
      const pkgName = typeof meta?.["packageName"] === "string" ? meta["packageName"] : undefined;
      if (shortName && pkgName && shortName === name) {
        return this.resolveName(pkgName, null);
      }
      const rawText = this.getEntrySourceSlice(importEntry, importEntry.startOffset, importEntry.endOffset);
      const clause = (rawText || importEntry.name || "")
        .replace(/^import\s+/, "")
        .replace(/;\s*$/, "")
        .trim();
      if (!clause) return [];

      // Alias import: `import SI = Modelica.Units.SI`
      const aliasMatch = clause.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z_][a-zA-Z0-9_.:]*)/);
      if (aliasMatch) {
        if (aliasMatch[1] === name) {
          return this.resolveName(aliasMatch[2]!, null);
        }
        return [];
      }
      // Wildcard import: `import Modelica.Electrical.Analog.Sources.*`
      if (clause.endsWith(".*") || clause.endsWith("::*")) {
        const prefix = clause.replace(/(?:\.\*|::\*)$/, "");
        if (!prefix || prefix === name) return [];
        return this.resolveName(`${prefix}.${name}`, null);
      }
      // Qualified import: `import Modelica.Electrical.Analog.Sources.SineVoltage`
      const parts = clause.split(/\.|::/).filter(Boolean);
      if (parts.length > 1 && parts[parts.length - 1] === name) {
        return this.resolveName(clause, null);
      }
      return [];
    } finally {
      this.activeImportIds.delete(importEntry.id);
    }
  }

  /**
   * Resolves a multi-segment path `segments` (e.g. `["Modelica", "Electrical", "Analog", "Sources", "SineVoltage"]`
   * or `["Vb", "p"]`) starting from `scopeId`.
   */
  private resolveQualifiedSegments(segments: string[], scopeId: SymbolId | null): SymbolEntry[] {
    if (segments.length === 0 || this.resolveDepth > 16) return [];
    const firstSeg = segments[0]!;
    const roots = this.resolveSimpleName(firstSeg, scopeId);

    const stepIntoMember = (container: SymbolEntry, memberName: string): SymbolEntry[] => {
      const matches: SymbolEntry[] = [];
      const seenIds = new Set<SymbolId>();
      const addMatch = (e: SymbolEntry) => {
        if (!seenIds.has(e.id) && this.isDecl(e)) {
          seenIds.add(e.id);
          matches.push(e);
        }
      };

      // 1. Direct children of container
      for (const child of this.getExportedChildren(container.id)) {
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
        for (const inherited of this.getInheritedMembers(container.id)) {
          if (inherited.name === memberName) addMatch(inherited);
        }
        return matches;
      }

      // 3. If container is a Component / Variable / Usage (not a class/package/function), step into its type
      if (container.kind !== "Function") {
        const typeDecl = this.resolveTypeOf(container);
        if (typeDecl && typeDecl.id !== container.id) {
          for (const child of this.getExportedChildren(typeDecl.id)) {
            if (child.name === memberName) addMatch(child);
          }
          if (matches.length === 0) {
            for (const inherited of this.getInheritedMembers(typeDecl.id)) {
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
    const globalIds = this.index.byName.get(lastSeg) || [];
    const suffixMatches: SymbolEntry[] = [];
    for (const id of globalIds) {
      const entry = this.index.symbols.get(id);
      if (entry && this.isDecl(entry)) {
        const fqn = this.getQualifiedName(entry, ".");
        if (fqn === targetSuffix || fqn.endsWith(`.${targetSuffix}`)) {
          suffixMatches.push(entry);
        }
      }
    }
    return suffixMatches;
  }

  /** Collects all declaration symbols lexically visible from `scopeId` up to the root scope. */
  private getVisibleSymbols(scopeId: SymbolId | null): SymbolEntry[] {
    const visible: SymbolEntry[] = [];
    const seenNames = new Set<string>();
    const visitedScopes = new Set<SymbolId>();
    let current = scopeId;
    while (current !== null && !visitedScopes.has(current)) {
      visitedScopes.add(current);
      const children = this.index.childrenOf.get(current) || [];
      for (const childId of children) {
        const entry = this.index.symbols.get(childId);
        if (entry && this.isDecl(entry) && !seenNames.has(entry.name)) {
          visible.push(entry);
          seenNames.add(entry.name);
        }
      }
      const parent = this.index.symbols.get(current);
      current = parent?.parentId ?? null;
    }
    const topLevel = this.index.childrenOf.get(null) || this.index.childrenOf.get(0) || [];
    for (const childId of topLevel) {
      const entry = this.index.symbols.get(childId);
      if (entry && this.isDecl(entry) && !seenNames.has(entry.name)) {
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
  private getInheritedMembers(typeId: SymbolId): SymbolEntry[] {
    if (this.activeInheritedIds.has(typeId) || this.resolveDepth > 16) return [];
    const inherited: SymbolEntry[] = [];
    const seen = new Set<SymbolId>();
    const addedHere: SymbolId[] = [];
    const queue = [typeId];
    try {
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (seen.has(currentId) || this.activeInheritedIds.has(currentId)) continue;
        seen.add(currentId);
        this.activeInheritedIds.add(currentId);
        addedHere.push(currentId);

        const entry = this.index.symbols.get(currentId);
        if (!entry) continue;

        const baseNames = new Set<string>(entry.inherits || []);
        for (const child of this.getExportedChildren(currentId)) {
          if (child.kind === "Extends") {
            const extType =
              (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
            if (extType) baseNames.add(extType);
          }
        }

        for (const inheritPath of baseNames) {
          let targetDecls = this.resolveName(inheritPath, currentId);
          if (targetDecls.length === 0) {
            targetDecls = this.resolveName(inheritPath, entry.parentId);
          }
          for (const target of targetDecls) {
            if (target.id === currentId || seen.has(target.id) || this.activeInheritedIds.has(target.id)) continue;
            queue.push(target.id);
            const children = this.getExportedChildren(target.id);
            for (const child of children) {
              if (this.isDecl(child)) {
                inherited.push(child);
              }
            }
          }
        }
      }
    } finally {
      for (const id of addedHere) {
        this.activeInheritedIds.delete(id);
      }
    }
    return inherited;
  }

  /** Finds all reference symbol entries across the index that resolve to `declId`. */
  private findRefs(declId: SymbolId): SymbolEntry[] {
    const decl = this.index.symbols.get(declId);
    if (!decl) return [];
    const matchingIds = this.index.byName.get(decl.name) || [];
    const refs: SymbolEntry[] = [];
    for (const id of matchingIds) {
      const entry = this.index.symbols.get(id);
      if (entry && !this.isDecl(entry)) {
        const resolved = this.resolveRef(entry);
        if (resolved.some((d) => d.id === declId)) {
          refs.push(entry);
        }
      }
    }
    return refs;
  }

  // =========================================================================
  // textDocument/documentSymbol
  // =========================================================================

  /**
   * Builds the hierarchical `LSPDocumentSymbol` outline tree for the bound document.
   */
  documentSymbols(): LSPDocumentSymbol[] {
    // Collect only symbols belonging to this document
    const docSymbols = new Set<SymbolId>();

    const normalize = (u: string) => {
      try {
        return decodeURIComponent(u).replace(/^[a-z0-9+-]+:\/\/?/, "/");
      } catch {
        return u;
      }
    };
    const targetNorm = normalize(this.documentUri);

    let docSymbolIds: SymbolId[] | undefined;
    if (this.index.symbolsByResource) {
      docSymbolIds = this.index.symbolsByResource.get(this.documentUri);
      if (!docSymbolIds || docSymbolIds.length === 0) {
        for (const [k, v] of this.index.symbolsByResource.entries()) {
          const kNorm = normalize(k);
          if (
            k === this.documentUri ||
            kNorm === targetNorm ||
            kNorm.endsWith(targetNorm) ||
            targetNorm.endsWith(kNorm)
          ) {
            docSymbolIds = v;
            break;
          }
        }
      }
    }

    if (docSymbolIds && docSymbolIds.length > 0) {
      for (const id of docSymbolIds) {
        const entry = this.index.symbols.get(id);
        if (!entry || entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall")
          continue;
        docSymbols.add(entry.id);
      }
    } else {
      // Fallback for older index format or if symbolsByResource missed it
      for (const entry of this.index.symbols.values()) {
        const resNorm = entry.resourceId ? normalize(entry.resourceId) : "";
        const matches =
          entry.resourceId === this.documentUri ||
          resNorm === targetNorm ||
          (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)));
        if (!matches) continue;
        if (entry.kind === "Reference" || entry.kind === "ConnectEquation" || entry.kind === "FunctionCall") continue;
        docSymbols.add(entry.id);
      }
    }

    // Build hierarchy: group by parentId, reparenting orphans to null
    const childrenOf = new Map<SymbolId | null, SymbolEntry[]>();

    for (const id of docSymbols) {
      const entry = this.index.symbols.get(id)!;
      // If parent was filtered out (from a different file), treat as root
      const parentKey = entry.parentId !== null && docSymbols.has(entry.parentId) ? entry.parentId : null;
      const children = childrenOf.get(parentKey);
      if (children) {
        children.push(entry);
      } else {
        childrenOf.set(parentKey, [entry]);
      }
    }

    const visitedDocSymbolIds = new Set<SymbolId>();
    const buildLevel = (parentId: SymbolId | null): LSPDocumentSymbol[] => {
      if (parentId !== null) {
        if (visitedDocSymbolIds.has(parentId)) return [];
        visitedDocSymbolIds.add(parentId);
      }
      const entries = childrenOf.get(parentId) || [];
      return entries.map((entry) => {
        const range = this.positions.rangeFromOffsets(entry.startOffset, entry.endOffset);

        let name = entry.name;
        if (name === "<anonymous>") {
          try {
            const source = this.engine.cstText(entry.startOffset, entry.endOffset, entry);
            if (source) {
              const firstLine = source.trim().split("\n")[0]!.trim();
              name = firstLine.length > 40 ? firstLine.substring(0, 37) + "..." : firstLine;
            }
          } catch {
            // fallback if engine doesn't support cstText
          }
        }

        let selectionRange = range;
        const nameField =
          entry.fieldRanges?.["name"] ??
          (entry.fieldRanges ? entry.fieldRanges[entry.namePath] || entry.fieldRanges["identifier"] : undefined);
        if (nameField) {
          selectionRange = this.positions.rangeFromOffsets(nameField.startOffset, nameField.endOffset);
        } else {
          const text = this.positions.getSourceText();
          if (text && entry.name && entry.name !== "<anonymous>") {
            const startOff = entry.startOffset;
            const endOff = entry.endOffset;
            const slice = text.slice(startOff, Math.min(startOff + 300, endOff));
            const idx = slice.indexOf(entry.name);
            if (idx !== -1) {
              selectionRange = this.positions.rangeFromOffsets(startOff + idx, startOff + idx + entry.name.length);
            }
          }
        }

        const symbol: LSPDocumentSymbol = {
          name,
          kind: this.mapSymbolKind(entry.kind),
          range,
          selectionRange,
          children: buildLevel(entry.id),
        };
        return symbol;
      });
    };

    return buildLevel(null);
  }

  // =========================================================================
  // textDocument/definition
  /**
   * Resolves the declaration location (`LSPLocation`) for the symbol at `byteOffset`.
   */
  definition(byteOffset: number, sourceText?: string): LSPLocation | null {
    const target = this.definitionRaw(byteOffset, sourceText);
    if (!target) return null;

    const targetUri = target.resourceId || this.documentUri;
    let targetPositions = this.positions;
    let text: string | undefined = sourceText ?? this.positions.getSourceText();

    if (target.resourceId && target.resourceId !== this.documentUri) {
      const otherBridge = (globalThis as any).documentLSPBridges?.get(target.resourceId);
      if (otherBridge?.positions) {
        targetPositions = otherBridge.positions;
        text = targetPositions.getSourceText();
      } else {
        const otherDocText =
          (globalThis as any).documents?.get(target.resourceId)?.getText?.() ??
          (globalThis as any).sharedFs?.readFile?.(target.resourceId);
        if (typeof otherDocText === "string") {
          targetPositions = new PositionIndex(otherDocText);
          text = otherDocText;
        } else {
          text = undefined;
        }
      }
    }

    const nameField =
      target.fieldRanges?.["name"] ??
      (target.fieldRanges ? target.fieldRanges[target.namePath] || target.fieldRanges["identifier"] : undefined);
    let startOff = target.startOffset;
    let endOff = target.endOffset;
    if (nameField) {
      startOff = nameField.startOffset;
      endOff = nameField.endOffset;
    } else if (text && target.name && target.name !== "<anonymous>") {
      const baseStart = target.startOffset;
      const baseEnd = target.endOffset;
      const slice = text.slice(baseStart, Math.min(baseStart + 300, baseEnd));
      const idx = slice.indexOf(target.name);
      if (idx !== -1) {
        startOff = baseStart + idx;
        endOff = startOff + target.name.length;
      }
    }

    return {
      uri: targetUri,
      range: targetPositions.rangeFromOffsets(startOff, endOff),
    };
  }

  /** Extracts the qualified identifier prefix up to `wordEnd` (e.g. `Modelica.Electrical.Analog` or `Vb.p`). */
  private extractQualifiedPrefix(text: string, wordStart: number, wordEnd: number): string {
    let qStart = wordStart;
    while (qStart > 0) {
      if (text[qStart - 1] === "." && qStart >= 2 && /[a-zA-Z0-9_]/.test(text[qStart - 2]!)) {
        qStart--;
        while (qStart > 0 && /[a-zA-Z0-9_]/.test(text[qStart - 1]!)) qStart--;
      } else if (
        qStart >= 3 &&
        text[qStart - 1] === ":" &&
        text[qStart - 2] === ":" &&
        /[a-zA-Z0-9_]/.test(text[qStart - 3]!)
      ) {
        qStart -= 2;
        while (qStart > 0 && /[a-zA-Z0-9_]/.test(text[qStart - 1]!)) qStart--;
      } else {
        break;
      }
    }
    return text.slice(qStart, wordEnd);
  }

  /** Returns the raw resolved symbol entry, preserving cross-document resourceIds */
  definitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    const text = sourceText ?? this.positions.getSourceText();
    let word = "";
    let ws = byteOffset;
    let we = byteOffset;
    let qualifiedPrefix = "";
    if (text) {
      if (ws > 0 && !/[a-zA-Z0-9_]/.test(text[ws]!) && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
      while (ws > 0 && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
      we = ws;
      while (we < text.length && /[a-zA-Z0-9_]/.test(text[we]!)) we++;
      if (ws >= we || byteOffset < ws || byteOffset > we) {
        return null;
      }
      word = text.slice(ws, we);
      qualifiedPrefix = this.extractQualifiedPrefix(text, ws, we);
    }

    const refEntry = this.findEntryAtOffset(byteOffset);

    if (qualifiedPrefix && qualifiedPrefix !== word) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? refEntry?.parentId ?? null;
      const qTargets = this.resolveName(qualifiedPrefix, scopeId);
      if (qTargets.length > 0) return qTargets[0]!;
    }

    if (!refEntry) return null;

    if (
      word &&
      (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile" || refEntry.ruleName === "source_file")
    ) {
      const nameRange = refEntry.fieldRanges?.["name"];
      const isOverClassName = nameRange
        ? byteOffset >= nameRange.startOffset && byteOffset <= nameRange.endOffset
        : word === refEntry.name && byteOffset < refEntry.startOffset + 200;

      if (!isOverClassName) {
        // Cursor is inside the class body — resolve the word within this class scope
        const targets = this.resolveName(qualifiedPrefix || word, refEntry.id);
        if (targets.length > 0) return targets[0]!;
        return null;
      }
    } else if (word && refEntry.kind === "Component") {
      if (word !== refEntry.name) {
        // Cursor is on component type or modifier
        const targets = this.resolveName(qualifiedPrefix || word, refEntry.parentId);
        if (targets.length > 0) return targets[0]!;
        return null;
      }
    } else if (word && (refEntry.kind === "Extends" || refEntry.kind === "Import")) {
      const targets = this.resolveName(qualifiedPrefix || word, refEntry.parentId);
      if (targets.length > 0) return targets[0]!;
    }

    const targets = this.resolveRef(refEntry);
    if (targets.length === 0) return null;

    return targets[0]!;
  }

  // =========================================================================
  // textDocument/completion
  // =========================================================================

  /**
   * Computes context-sensitive completion candidates (`LSPCompletionItem[]`) at `byteOffset`,
   * supporting dot-access member completion, modification-argument completion, and lexical scope completion.
   */
  completion(byteOffset: number, sourceText?: string): LSPCompletionItem[] {
    // ------------------------------------------------------------------
    // Dot-access completion: "a." → resolve `a` to its type, show members
    // ------------------------------------------------------------------
    if (sourceText) {
      const before = sourceText.slice(0, byteOffset);
      const dotMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*[a-zA-Z_]?[a-zA-Z0-9_]*$/);
      if (dotMatch) {
        const varName = dotMatch[1]!;
        return this.completeDotAccess(varName, byteOffset);
      }

      // ----------------------------------------------------------------
      // Modification-context completion: "A a(|)" → show members of A
      // ----------------------------------------------------------------
      const modMembers = this.completeModificationContext(byteOffset, before);
      if (modMembers) return modMembers;
    }

    // ------------------------------------------------------------------
    // Normal scope-aware completion: show visible symbols in current scope
    // ------------------------------------------------------------------
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;

    const visible = this.getVisibleSymbols(scopeId);
    const seen = new Set<string>();
    const results: LSPCompletionItem[] = [];
    for (const entry of visible) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        results.push({
          label: entry.name,
          kind: this.mapSymbolKind(entry.kind),
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
  private completeDotAccess(varName: string, byteOffset: number): LSPCompletionItem[] {
    // 1. Find the enclosing scope
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;

    // 2. Resolve `varName` lexically to find its declaration
    let varDecls = this.resolveName(varName, scopeId);

    // Fallback: global name search across the entire index.
    // This handles cases where tree-sitter parse errors (from incomplete text
    // during typing) corrupt the scope hierarchy, causing lexical resolution
    // to miss symbols that are actually in scope.
    if (varDecls.length === 0) {
      const globalIds = this.index.byName.get(varName);
      if (globalIds) {
        for (const id of globalIds) {
          const entry = this.index.symbols.get(id);
          if (entry && this.isDecl(entry)) {
            varDecls.push(entry);
          }
        }
      }
    }

    if (varDecls.length === 0) return [];

    const varDecl = varDecls[0]!;

    // 3. Resolve the type of the variable using generic strategies
    const typeDecl = this.resolveTypeOf(varDecl);
    if (typeDecl) {
      return this.membersOf(typeDecl);
    }

    // 4. If the variable itself is a scope (e.g. a class), show its members directly
    const children = this.getExportedChildren(varDecl.id);
    if (children.length > 0) {
      return children
        .filter((child) => this.isDecl(child))
        .map((child) => ({
          label: child.name,
          kind: this.mapSymbolKind(child.kind),
          detail: child.kind,
        }));
    }

    return [];
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
  private resolveTypeOf(entry: SymbolEntry): SymbolEntry | null {
    if (
      this.activeTypeOfIds.has(entry.id) ||
      this.resolveDepth > 16 ||
      entry.kind === "Package" ||
      entry.kind === "Class" ||
      entry.kind === "Function"
    ) {
      return null;
    }
    this.activeTypeOfIds.add(entry.id);
    try {
      // Strategy 1: Prioritize explicit typeSpecifier / type metadata first
      if (entry.metadata) {
        const preferredKeys = ["typeSpecifier", "type", "className"];
        for (const key of preferredKeys) {
          const value = entry.metadata[key];
          if (typeof value === "string" && value.length > 0) {
            const typeDecls = this.resolveName(value, entry.parentId);
            if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
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
            const typeDecls = this.resolveName(value, entry.parentId);
            if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
              return typeDecls[0]!;
            }
          }
        }
      }

      // Strategy 2: Check child Reference entries (from ref() hooks)
      // Explicitly filter for `c.kind === "Reference"` so Extends/Import/ConnectEquation are never treated as type refs
      const childRefs = this.getExportedChildren(entry.id).filter((c) => c.kind === "Reference");
      for (const ref of childRefs) {
        if (ref.name && ref.name.length > 0) {
          // Try lexical resolution first, then global byName fallback
          const typeDecls = this.resolveName(ref.name, entry.parentId);
          if (typeDecls.length === 0) {
            const globalIds = this.index.byName.get(ref.name);
            if (globalIds) {
              for (const id of globalIds) {
                const globalEntry = this.index.symbols.get(id);
                if (globalEntry && this.isDecl(globalEntry)) {
                  typeDecls.push(globalEntry);
                }
              }
            }
          }
          if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }

      // Strategy 3: For Modelica components lacking metadata.typeSpecifier, inspect the clause prefix in source text
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const clausePrefix = this.extractComponentClausePrefix(entry);
        if (clausePrefix?.typeSpecifier) {
          const typeDecls = this.resolveName(clausePrefix.typeSpecifier, entry.parentId);
          if (typeDecls.length > 0 && this.isDecl(typeDecls[0]!)) {
            return typeDecls[0]!;
          }
        }
      }

      return null;
    } finally {
      this.activeTypeOfIds.delete(entry.id);
    }
  }

  /**
   * Detect if the cursor is inside a class modification `(...)` and return
   * the members of the type being modified.
   *
   * Example: `A a(|)` → cursor is inside parens → show members of A.
   * Also handles nested: `A a(x(|))` → show members of x's type.
   */
  private completeModificationContext(byteOffset: number, before: string): LSPCompletionItem[] | null {
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
    // Match: [TypeName] [varName] at end (with optional whitespace)
    const declMatch = beforeParen.match(/([a-zA-Z_][a-zA-Z0-9_.:]*)\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\[[^\]]*\])?$/);
    if (!declMatch) return null;

    const typeName = declMatch[1]!;

    // Resolve the type
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const typeDecls = this.resolveName(typeName, scopeId);
    if (typeDecls.length === 0) return null;

    return this.membersOf(typeDecls[0]!);
  }

  /**
   * Get completion items for all members (exported children + inherited) of a type.
   */
  private membersOf(typeEntry: SymbolEntry): LSPCompletionItem[] {
    const results: LSPCompletionItem[] = [];
    const seen = new Set<string>();

    // Direct children (exclude reference-site entries like extends clauses)
    for (const child of this.getExportedChildren(typeEntry.id)) {
      if (!this.isDecl(child)) continue;
      if (!seen.has(child.name)) {
        seen.add(child.name);
        results.push({
          label: child.name,
          kind: this.mapSymbolKind(child.kind),
          detail: child.kind,
        });
      }
    }

    // Inherited members via resolver
    const inherited = this.getInheritedMembers(typeEntry.id);
    for (const member of inherited) {
      if (!seen.has(member.name)) {
        seen.add(member.name);
        results.push({
          label: member.name,
          kind: this.mapSymbolKind(member.kind),
          detail: `${member.kind} (inherited)`,
        });
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

  /**
   * Get exported children of a symbol scope.
   * Uses the index's childrenOf map for O(1) lookup.
   */
  private getExportedChildren(scopeId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const childIds = this.index.childrenOf.get(scopeId);
    if (!childIds) return results;
    for (const childId of childIds) {
      const entry = this.index.symbols.get(childId);
      if (entry) results.push(entry);
    }
    return results;
  }

  // =========================================================================
  // textDocument/hover
  // =========================================================================

  /**
   * Computes Markdown hover documentation (`LSPHover`) for the symbol at `byteOffset`,
   * supporting modification-context attribute hover, qualified paths, class/component declarations,
   * doc comments, and predefined types.
   */
  hover(byteOffset: number, sourceText?: string): LSPHover | null {
    const text = sourceText ?? this.positions.getSourceText();
    if (text) {
      const modHover = this.hoverModificationContext(byteOffset, text);
      if (modHover) return modHover;
    }

    if (!text) return null;

    let wordStart = byteOffset;
    if (wordStart > 0 && !/[a-zA-Z0-9_]/.test(text[wordStart]!) && /[a-zA-Z0-9_]/.test(text[wordStart - 1]!)) {
      wordStart--;
    }
    while (wordStart > 0 && /[a-zA-Z0-9_]/.test(text[wordStart - 1]!)) wordStart--;
    let wordEnd = wordStart;
    while (wordEnd < text.length && /[a-zA-Z0-9_]/.test(text[wordEnd]!)) wordEnd++;

    if (wordStart >= wordEnd || byteOffset < wordStart || byteOffset > wordEnd) {
      return null;
    }

    const word = text.slice(wordStart, wordEnd);
    const qualifiedPrefix = this.extractQualifiedPrefix(text, wordStart, wordEnd);
    const hoverRange = this.positions.rangeFromOffsets(wordStart, wordEnd);

    const entry = this.findEntryAtOffset(byteOffset);
    let targetDecl: SymbolEntry | null = null;

    // 1. If the hovered identifier is part of a dotted or `::`-qualified reference (e.g.
    //    `Modelica.Electrical.Analog.Sources.SineVoltage` or `Vb.p`), resolve the full prefix up to `wordEnd`.
    if (qualifiedPrefix && qualifiedPrefix !== word) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? entry?.parentId ?? null;
      const qResolved = this.resolveName(qualifiedPrefix, scopeId);
      if (qResolved.length > 0) {
        targetDecl = qResolved[0]!;
      }
    }

    if (!targetDecl && entry) {
      if (entry.kind === "Class" || entry.ruleName === "SourceFile" || entry.ruleName === "source_file") {
        const nameRange = entry.fieldRanges?.["name"];
        const isOverClassName = nameRange
          ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
          : word === entry.name && wordStart < entry.startOffset + 200;

        if (isOverClassName) {
          targetDecl = entry;
        } else {
          // Inside class body — resolve the word within this class scope
          const resolved = this.resolveName(qualifiedPrefix || word, entry.id);
          if (resolved.length > 0) {
            targetDecl = resolved[0]!;
          }
        }
      } else if (entry.kind === "Component" || entry.kind === "Variable") {
        const nameRange = entry.fieldRanges?.["name"] ?? entry.fieldRanges?.[entry.namePath];
        const isOverCompName = nameRange
          ? wordStart >= nameRange.startOffset && wordEnd <= nameRange.endOffset
          : word === entry.name && qualifiedPrefix === word;
        if (isOverCompName) {
          targetDecl = entry;
        } else {
          const resolved = this.resolveName(qualifiedPrefix || word, entry.parentId);
          if (resolved.length > 0) {
            targetDecl = resolved[0]!;
          }
        }
      } else if (
        entry.kind === "Reference" ||
        entry.kind === "Extends" ||
        entry.kind === "Import" ||
        entry.kind === "ConnectEquation" ||
        entry.kind === "FunctionCall"
      ) {
        const resolved = this.resolveName(qualifiedPrefix || word, entry.parentId);
        if (resolved.length > 0) {
          targetDecl = resolved[0]!;
        } else {
          const refResolved = this.resolveRef(entry);
          if (refResolved.length > 0) {
            targetDecl = refResolved[0]!;
          }
        }
      } else {
        targetDecl = entry;
      }
    }

    if (!targetDecl) {
      const scopeEntry = this.findScopeAtOffset(byteOffset);
      const scopeId = scopeEntry?.id ?? null;
      const resolved = this.resolveName(qualifiedPrefix || word, scopeId);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      }
    }

    if (!targetDecl) {
      // Check if word is a predefined type in the index
      const predefinedIds = this.index.byName.get(word);
      if (predefinedIds && predefinedIds.length > 0) {
        const candidate = this.index.symbols.get(predefinedIds[0]!);
        if (candidate?.metadata?.["isPredefined"]) {
          targetDecl = candidate;
        }
      }
    }

    if (!targetDecl) return null;

    const md = this.hoverEntry(targetDecl);
    if (!md) return null;

    return {
      contents: md,
      range: hoverRange,
    };
  }

  /**
   * Retrieves the source slice `[start, end]` for `entry` using the bound document, `QueryEngine.cstText`,
   * open workspace documents, or VFS fallback.
   */
  private getEntrySourceSlice(entry: SymbolEntry, start: number, end: number): string | null {
    if (start < 0 || end < start) return null;
    try {
      if (this.engine && typeof this.engine.cstText === "function") {
        const res = this.engine.cstText(start, end, entry);
        if (typeof res === "string" && res.length > 0) return res;
      }
    } catch {
      // ignore
    }

    const fullText = this.getEntryFullSourceText(entry);
    if (fullText && start <= fullText.length) {
      return fullText.slice(start, Math.min(end, fullText.length));
    }
    return null;
  }

  /**
   * Retrieves the full source file text for `entry` (or at least `[0, entryEnd]`).
   */
  private getEntryFullSourceText(entry: SymbolEntry): string | null {
    const uri = entry.resourceId || this.documentUri;
    if (!uri || uri === this.documentUri) {
      const localText = this.positions?.getSourceText?.();
      if (typeof localText === "string" && localText.length > 0) {
        return localText;
      }
    }

    if (uri) {
      const otherBridge = (globalThis as any).documentLSPBridges?.get(uri);
      const otherBridgeText = otherBridge?.positions?.getSourceText?.();
      if (typeof otherBridgeText === "string" && otherBridgeText.length > 0) {
        return otherBridgeText;
      }
      const openDocText = (globalThis as any).documents?.get(uri)?.getText?.();
      if (typeof openDocText === "string" && openDocText.length > 0) {
        return openDocText;
      }
      const fsPath = uri.startsWith("file://") ? uri.substring(7) : uri;
      const sharedFs = (globalThis as any).sharedFs;
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
      if (this.engine && typeof this.engine.cstText === "function") {
        const full = this.engine.cstText(0, 10_000_000, entry);
        if (typeof full === "string" && full.length > 0) return full;
        const entryEnd = entry.endOffset ?? 0;
        if (entryEnd > 0) {
          const prefix = this.engine.cstText(0, entryEnd, entry);
          if (typeof prefix === "string" && prefix.length > 0) return prefix;
        }
      }
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * Extracts the `type_prefix` and `type_specifier` from the enclosing Modelica `component_clause`
   * preceding `entry` when `entry` only spans `component_declaration` (e.g. `V(start=1) "..."`).
   */
  private extractComponentClausePrefix(
    entry: SymbolEntry,
  ): { fullPrefix: string; typePrefix: string; typeSpecifier: string; clauseStartOffset: number } | null {
    const entryStart = entry.startOffset ?? 0;
    const fullText = this.getEntryFullSourceText(entry);
    if (!fullText || entryStart <= 0 || entryStart > fullText.length) return null;

    // Scan backwards from entryStart to find the start of the component_clause
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
    const leadingMatch = rawClauseBefore.match(
      /^(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(?:(?:public|protected)\b(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*)*/,
    );
    if (leadingMatch && leadingMatch[0]) {
      rawClauseBefore = rawClauseBefore.slice(leadingMatch[0].length);
      clauseStartOffset += leadingMatch[0].length;
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

    // If comma-separated (`Pin p, n`), strip everything after the first component's identifier
    // so we keep only the shared `[type_prefix] type_specifier`.
    const prefixRegex =
      /^((?:(?:final|inner|outer|replaceable|redeclare|flow|stream|discrete|parameter|constant|input|output)\s+)*)([a-zA-Z_][a-zA-Z0-9_.:]*)/;
    const m = trimmedClause.match(prefixRegex);
    if (!m) return null;

    const typePrefix = (m[1] ?? "").replace(/\s+/g, " ").trim();
    const typeSpecifier = (m[2] ?? "").trim();
    // Avoid matching class header keywords (`model Foo`) if there was no `;` after class header
    if (
      !typePrefix &&
      /^(?:model|class|block|connector|record|package|function|type|operator|within|extends|equation|algorithm)$/.test(
        typeSpecifier,
      )
    ) {
      // Look after the last newline in `rawClauseBefore` instead
      const lastNl = rawClauseBefore.lastIndexOf("\n");
      if (lastNl !== -1) {
        const lineBefore = rawClauseBefore.slice(lastNl + 1).trim();
        const mLine = lineBefore.match(prefixRegex);
        if (mLine) {
          const tp = (mLine[1] ?? "").replace(/\s+/g, " ").trim();
          const ts = (mLine[2] ?? "").trim();
          const full = tp ? `${tp} ${ts}` : ts;
          return {
            fullPrefix: full,
            typePrefix: tp,
            typeSpecifier: ts,
            clauseStartOffset: clauseStartOffset + lastNl + 1,
          };
        }
      }
      return null;
    }

    const fullPrefix = typePrefix ? `${typePrefix} ${typeSpecifier}` : typeSpecifier;
    return {
      fullPrefix,
      typePrefix,
      typeSpecifier,
      clauseStartOffset,
    };
  }

  /**
   * Strips Modelica `annotation(...)` clauses from a declaration or statement string while
   * preserving strings and other parenthesized modifications.
   */
  private stripModelicaAnnotations(input: string): string {
    let result = "";
    let i = 0;
    const len = input.length;
    while (i < len) {
      const ch = input[i]!;
      // String literal
      if (ch === '"') {
        const start = i;
        i++;
        while (i < len) {
          if (input[i] === "\\") i += 2;
          else if (input[i] === '"') {
            i++;
            break;
          } else i++;
        }
        result += input.slice(start, i);
        continue;
      }
      // Line comment
      if (ch === "/" && input[i + 1] === "/") {
        const start = i;
        i += 2;
        while (i < len && input[i] !== "\n") i++;
        result += input.slice(start, i);
        continue;
      }
      // Block comment
      if (ch === "/" && input[i + 1] === "*") {
        const start = i;
        i += 2;
        while (i < len && !(input[i] === "*" && input[i + 1] === "/")) i++;
        if (i < len) i += 2;
        result += input.slice(start, i);
        continue;
      }
      // Check for `\bannotation\s*\(`
      if (
        ch === "a" &&
        input.startsWith("annotation", i) &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(input[i - 1]!)) &&
        !/[a-zA-Z0-9_]/.test(input[i + 10] ?? "")
      ) {
        let j = i + 10;
        while (j < len && /\s/.test(input[j]!)) j++;
        if (input[j] === "(") {
          // Advance to matching `)`
          let depth = 1;
          j++;
          while (j < len && depth > 0) {
            if (input[j] === '"') {
              j++;
              while (j < len) {
                if (input[j] === "\\") j += 2;
                else if (input[j] === '"') {
                  j++;
                  break;
                } else j++;
              }
            } else if (input[j] === "(") {
              depth++;
              j++;
            } else if (input[j] === ")") {
              depth--;
              j++;
            } else {
              j++;
            }
          }
          // Trim trailing horizontal whitespace before `annotation`
          result = result.replace(/[ \t]+$/, "");
          i = j;
          continue;
        }
      }
      result += ch;
      i++;
    }
    return result;
  }

  /**
   * Formats a clean, IDE-grade Modelica class/model/block/connector/record/function/type/package
   * declaration signature from its raw CST source span, keeping the class header, public
   * `extends` clauses, and public parameter/port/component declarations while stripping
   * `annotation(...)` blocks and `protected`/`equation`/`algorithm` implementation sections.
   */
  private formatModelicaClassSignature(rawClassText: string, entry: SymbolEntry): string {
    const trimmed = rawClassText.trim().replace(/\r\n/g, "\n");
    const escapedName = entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const endRegex = new RegExp(`\\bend\\s+${escapedName}\\s*;?\\s*$`);

    // 1. Short class definition (e.g. `type Voltage = ElectricPotential;` or `type V = Real(...) "...";`)
    if (!endRegex.test(trimmed)) {
      const cleaned = this.stripModelicaAnnotations(trimmed)
        .replace(/\s+/g, " ")
        .replace(/\s*;\s*$/, ";")
        .trim();
      return cleaned;
    }

    // 2. Long class definition (`model Name "..." ... end Name;`)
    const withoutEnd = trimmed.replace(endRegex, "").trimEnd();

    // Locate the end of the class header (`[prefixes] classKind Name ["description"]`)
    const nameMatch = new RegExp(`\\b${escapedName}\\b`).exec(withoutEnd);
    if (!nameMatch) {
      return `${entry.metadata?.["classPrefixes"] || entry.metadata?.["classKind"] || "class"} ${entry.name}`;
    }

    let pos = nameMatch.index + entry.name.length;
    const len = withoutEnd.length;
    const skipWs = (p: number): number => {
      while (p < len && /\s/.test(withoutEnd[p]!)) p++;
      return p;
    };
    const scanStringLiteral = (p: number): number => {
      if (withoutEnd[p] !== '"') return p;
      p++;
      while (p < len) {
        if (withoutEnd[p] === "\\") p += 2;
        else if (withoutEnd[p] === '"') {
          p++;
          break;
        } else p++;
      }
      while (true) {
        const nextP = skipWs(p);
        if (withoutEnd[nextP] === "+") {
          const afterPlus = skipWs(nextP + 1);
          if (withoutEnd[afterPlus] === '"') {
            p = afterPlus + 1;
            while (p < len) {
              if (withoutEnd[p] === "\\") p += 2;
              else if (withoutEnd[p] === '"') {
                p++;
                break;
              } else p++;
            }
            continue;
          }
        }
        break;
      }
      return p;
    };

    const afterName = skipWs(pos);
    if (withoutEnd[afterName] === '"') {
      pos = scanStringLiteral(afterName);
    }

    const header = withoutEnd
      .slice(0, pos)
      .replace(/\s*\n\s*/g, " ")
      .trim();
    const body = withoutEnd.slice(pos);

    // Scan top-level statements inside `body`
    const memberLines: string[] = [];
    let i = 0;
    const bLen = body.length;
    let inPublic = true;
    let stmtStart = 0;
    let parenDepth = 0;
    let nestedClassDepth = 0;
    let nestedClassTargetEnd: string | null = null;

    const isWordAt = (idx: number, word: string): boolean => {
      if (!body.startsWith(word, idx)) return false;
      const prev = idx > 0 ? body[idx - 1]! : " ";
      const next = idx + word.length < bLen ? body[idx + word.length]! : " ";
      return !/[a-zA-Z0-9_]/.test(prev) && !/[a-zA-Z0-9_]/.test(next);
    };

    while (i < bLen) {
      const ch = body[i]!;
      // Strings
      if (ch === '"') {
        i++;
        while (i < bLen) {
          if (body[i] === "\\") i += 2;
          else if (body[i] === '"') {
            i++;
            break;
          } else i++;
        }
        continue;
      }
      // Line comment
      if (ch === "/" && body[i + 1] === "/") {
        i += 2;
        while (i < bLen && body[i] !== "\n") i++;
        continue;
      }
      // Block comment
      if (ch === "/" && body[i + 1] === "*") {
        i += 2;
        while (i < bLen && !(body[i] === "*" && body[i + 1] === "/")) i++;
        if (i < bLen) i += 2;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        parenDepth++;
        i++;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        parenDepth = Math.max(0, parenDepth - 1);
        i++;
        continue;
      }

      if (parenDepth === 0) {
        // Track nested long classes inside packages/models
        if (nestedClassDepth > 0) {
          if (isWordAt(i, "end")) {
            let j = i + 3;
            while (j < bLen && /\s/.test(body[j]!)) j++;
            const idMatch = body.slice(j).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (idMatch && (!nestedClassTargetEnd || idMatch[1] === nestedClassTargetEnd)) {
              j += idMatch[1]!.length;
              while (j < bLen && /\s/.test(body[j]!)) j++;
              if (body[j] === ";") j++;
              nestedClassDepth = 0;
              nestedClassTargetEnd = null;
              i = j;
              stmtStart = i;
              continue;
            }
          }
          i++;
          continue;
        }

        // Check for top-level section keywords at statement start
        const leadingSlice = body.slice(stmtStart, i).trim();
        if (leadingSlice === "") {
          if (isWordAt(i, "public")) {
            inPublic = true;
            i += 6;
            stmtStart = i;
            continue;
          }
          if (isWordAt(i, "protected")) {
            inPublic = false;
            i += 9;
            stmtStart = i;
            continue;
          }
          if (isWordAt(i, "equation") || isWordAt(i, "algorithm") || isWordAt(i, "external")) {
            break;
          }
          if (isWordAt(i, "initial")) {
            const afterInit = body.slice(i + 7).match(/^\s+(?:equation|algorithm)\b/);
            if (afterInit) {
              break;
            }
          }
          // Check if a nested long class starts here
          const nestedMatch = body
            .slice(i)
            .match(
              /^(?:(?:encapsulated|partial|expandable)\s+)*(?:class|model|record|block|connector|package|function|type|operator)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/,
            );
          if (nestedMatch && !body.slice(i).startsWith("replaceable ")) {
            const nestedName = nestedMatch[1]!;
            const afterNestedName = body.slice(i + nestedMatch[0].length).trimStart();
            // If not followed by `=` or `(`, it's a nested long class definition
            if (!afterNestedName.startsWith("=")) {
              nestedClassDepth = 1;
              nestedClassTargetEnd = nestedName;
              i += nestedMatch[0].length;
              continue;
            }
          }
        }

        if (ch === ";") {
          const rawStmt = body.slice(stmtStart, i + 1);
          stmtStart = i + 1;
          if (inPublic) {
            // Strip leading comments from statement
            const withoutLeadingComments = rawStmt.replace(/^(?:\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "").trim();
            const cleanedStmt = this.stripModelicaAnnotations(withoutLeadingComments)
              .replace(/\s*;\s*$/, ";")
              .trim();
            if (cleanedStmt && cleanedStmt !== ";" && !/^import\b/.test(cleanedStmt)) {
              // Collapse single-component multiline wrapping into clean indentation
              const stmtLines = cleanedStmt
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
              if (stmtLines.length === 2 && stmtLines[1]!.startsWith('"')) {
                memberLines.push(`  ${stmtLines[0]} ${stmtLines[1]}`);
              } else if (stmtLines.length > 1) {
                memberLines.push(stmtLines.map((l, idx) => (idx === 0 ? `  ${l}` : `      ${l}`)).join("\n"));
              } else if (stmtLines.length === 1) {
                memberLines.push(`  ${stmtLines[0]}`);
              }
            }
          }
        }
      }
      i++;
    }

    const MAX_MEMBERS = 15;
    let bodyLines = memberLines;
    if (memberLines.length > MAX_MEMBERS) {
      bodyLines = [
        ...memberLines.slice(0, MAX_MEMBERS),
        `  // ... (${memberLines.length - MAX_MEMBERS} more declarations)`,
      ];
    }

    if (bodyLines.length > 0) {
      return `${header}\n${bodyLines.join("\n")}\nend ${entry.name};`;
    }
    return `${header}\nend ${entry.name};`;
  }

  /**
   * Formats a human-readable code signature for a `SymbolEntry` suitable for fenced code blocks in hover cards.
   */
  private formatDeclaration(entry: SymbolEntry): string {
    if (this.activeFormatIds.has(entry.id)) {
      return `${entry.kind.toLowerCase()} ${entry.name}`;
    }
    this.activeFormatIds.add(entry.id);
    try {
      const meta = entry.metadata;
      const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
      let declStr = "";

      if (meta?.["isPredefined"]) {
        const cKind = typeof meta["classKind"] === "string" ? meta["classKind"] : "type";
        declStr = `${cKind} ${entry.name}`;
        const attrs = meta["completionMembers"];
        if (Array.isArray(attrs) && attrs.length > 0) {
          declStr += `(\n`;
          const lines: string[] = [];
          for (const attr of attrs) {
            if (typeof attr === "string") {
              const val = meta[attr];
              if (val === "") {
                lines.push(`  ${attr}`);
              } else {
                const valStr = typeof val === "string" ? `"${val}"` : String(val);
                lines.push(`  ${attr} = ${valStr}`);
              }
            }
          }
          declStr += lines.join(",\n");
          declStr += `\n)`;
        }
        return declStr;
      }

      const entryStart = entry.startOffset ?? 0;
      const entryEnd = entry.endOffset ?? 0;
      const source = entryEnd > entryStart ? this.getEntrySourceSlice(entry, entryStart, entryEnd) : null;

      if (
        entry.kind === "Class" ||
        entry.kind === "Function" ||
        entry.kind === "Package" ||
        entry.kind === "Type" ||
        entry.kind === "Struct" ||
        entry.kind === "Interface"
      ) {
        if (source) {
          if (lang === "modelica") {
            return this.formatModelicaClassSignature(source, entry);
          }
          // For ModelScript / SysML v2 / OpenSCAD functions: extract signature up to `{`
          if (entry.kind === "Function") {
            const braceIdx = source.indexOf("{");
            if (braceIdx !== -1) {
              return source.slice(0, braceIdx).trim();
            }
          }
          // For SysML v2 / ModelScript definitions/structs: strip `doc /* ... */` blocks and cap lines
          const withoutDoc = source.replace(/\bdoc\s*\/\*[\s\S]*?\*\/\s*;?/g, "").trim();
          const lines = withoutDoc
            .split("\n")
            .map((l) => l.replace(/\s+$/, ""))
            .filter((l, idx, arr) => !(l.trim() === "" && idx > 0 && arr[idx - 1]!.trim() === ""));
          if (lines.length > 18) {
            return [...lines.slice(0, 16), "  // ...", lines[lines.length - 1]!].join("\n");
          }
          return lines.join("\n");
        }

        // Fallback when source text is unavailable: synthesize from metadata and indexed children
        const classPrefix =
          (meta && typeof meta["classPrefixes"] === "string" && meta["classPrefixes"]) ||
          (meta && typeof meta["classKind"] === "string" && meta["classKind"]) ||
          entry.kind.toLowerCase();
        const rawDesc =
          meta && typeof meta["description"] === "string" ? meta["description"].replace(/^"|"$/g, "") : "";
        declStr = `${classPrefix} ${entry.name}${rawDesc ? ` "${rawDesc}"` : ""}`;

        const childLines: string[] = [];
        for (const child of this.getExportedChildren(entry.id)) {
          if (child.kind === "Extends") {
            const extType =
              (typeof child.metadata?.["typeSpecifier"] === "string" && child.metadata["typeSpecifier"]) || child.name;
            if (extType) childLines.push(`  extends ${extType};`);
          } else if (child.kind === "Component" || child.kind === "Variable") {
            childLines.push(`  ${this.formatDeclaration(child)};`);
          }
        }
        if (childLines.length > 0 && lang === "modelica") {
          const capped =
            childLines.length > 15
              ? [...childLines.slice(0, 15), `  // ... (${childLines.length - 15} more declarations)`]
              : childLines;
          return `${declStr}\n${capped.join("\n")}\nend ${entry.name};`;
        }
        return declStr;
      }

      // Component / Variable / Property / Field declaration
      if (source) {
        let cleaned = this.stripModelicaAnnotations(source)
          .replace(/\bdoc\s*\/\*[\s\S]*?\*\/\s*;?/g, "")
          .replace(/\s*"[^"]*"\s*;?\s*$/, "")
          .replace(/\s*;\s*$/, "")
          .trim();

        // In Modelica CST, `component_declaration` starts at the component name (`V(start=1)`)
        // while `parameter SI.Voltage` is on the parent `component_clause`.
        if (
          (entry.kind === "Component" || entry.kind === "Variable") &&
          (cleaned === entry.name ||
            cleaned.startsWith(`${entry.name}(`) ||
            cleaned.startsWith(`${entry.name}[`) ||
            cleaned.startsWith(`${entry.name} `) ||
            cleaned.startsWith(`${entry.name}=`))
        ) {
          const clausePrefix = this.extractComponentClausePrefix(entry);
          if (clausePrefix?.fullPrefix) {
            cleaned = `${clausePrefix.fullPrefix} ${cleaned}`;
          } else {
            let prefix = "";
            if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
              prefix += `${meta["typePrefix"].trim()} `;
            } else {
              if (meta && typeof meta["causality"] === "string" && meta["causality"]) prefix += `${meta["causality"]} `;
              if (meta && typeof meta["variability"] === "string" && meta["variability"])
                prefix += `${meta["variability"]} `;
            }
            if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"]) {
              prefix += `${meta["typeSpecifier"].trim()} `;
            }
            if (prefix) {
              cleaned = `${prefix}${cleaned}`;
            }
          }
        }
        return cleaned;
      }

      if (meta && typeof meta["typePrefix"] === "string" && meta["typePrefix"]) {
        declStr += `${meta["typePrefix"].trim()} `;
      } else {
        if (meta && typeof meta["causality"] === "string" && meta["causality"]) declStr += `${meta["causality"]} `;
        if (meta && typeof meta["variability"] === "string" && meta["variability"])
          declStr += `${meta["variability"]} `;
      }
      if (meta && typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"])
        declStr += `${meta["typeSpecifier"]} `;
      declStr += entry.name;

      return declStr;
    } finally {
      this.activeFormatIds.delete(entry.id);
    }
  }

  /**
   * Unescapes a Modelica string literal (or `"..." + "..."` concatenation) and strips outer quotes.
   */
  private unescapeModelicaString(raw: string): string {
    const trimmed = raw.trim();
    const parts: string[] = [];
    let i = 0;
    const len = trimmed.length;
    while (i < len) {
      while (i < len && (/\s/.test(trimmed[i]!) || trimmed[i] === "+")) i++;
      if (trimmed[i] !== '"') break;
      i++;
      let buf = "";
      while (i < len) {
        if (trimmed[i] === "\\" && i + 1 < len) {
          const next = trimmed[i + 1]!;
          if (next === '"') buf += '"';
          else if (next === "\\") buf += "\\";
          else if (next === "n") buf += "\n";
          else if (next === "t") buf += "\t";
          else if (next === "r") buf += "\r";
          else buf += next;
          i += 2;
        } else if (trimmed[i] === '"') {
          i++;
          break;
        } else {
          buf += trimmed[i]!;
          i++;
        }
      }
      parts.push(buf);
    }
    if (parts.length > 0) return parts.join("");
    return trimmed.replace(/^"|"$/g, "");
  }

  /**
   * Converts Modelica `Documentation(info="<html>...</html>")` HTML into clean Markdown.
   */
  private modelicaHtmlToMarkdown(rawHtml: string): string {
    if (!rawHtml) return "";
    let html = rawHtml
      .replace(/<!DOCTYPE[^>]*>/gi, "")
      .replace(/<head(?:\s[^>]*)?>[\s\S]*?<\/head>/gi, "")
      .replace(/<\/?(?:html|body)(?:\s[^>]*)?>/gi, "")
      .trim();
    if (!html) return "";

    const decodeEntities = (s: string): string =>
      s
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&Omega;/g, "Ω")
        .replace(/&omega;/g, "ω")
        .replace(/&Delta;/g, "Δ")
        .replace(/&delta;/g, "δ")
        .replace(/&alpha;/gi, "α")
        .replace(/&beta;/gi, "β")
        .replace(/&gamma;/gi, "γ")
        .replace(/&epsilon;/gi, "ε")
        .replace(/&mu;/gi, "μ")
        .replace(/&pi;/gi, "π")
        .replace(/&phi;/g, "φ")
        .replace(/&Phi;/g, "Φ")
        .replace(/&tau;/gi, "τ")
        .replace(/&theta;/gi, "θ")
        .replace(/&lambda;/gi, "λ")
        .replace(/&sigma;/gi, "σ")
        .replace(/&rho;/gi, "ρ")
        .replace(/&eta;/gi, "η")
        .replace(/&deg;/gi, "°")
        .replace(/&plusmn;/gi, "±")
        .replace(/&times;/gi, "×")
        .replace(/&middot;/gi, "·")
        .replace(/&ndash;/gi, "–")
        .replace(/&mdash;/gi, "—")
        .replace(/&le;/gi, "≤")
        .replace(/&ge;/gi, "≥")
        .replace(/&ne;/gi, "≠")
        .replace(/&infin;/gi, "∞")
        .replace(/&rarr;/gi, "→")
        .replace(/&larr;/gi, "←")
        .replace(/&harr;/gi, "↔")
        .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&amp;/gi, "&");

    const stripHtmlTags = (s: string): string => {
      let prev: string;
      do {
        prev = s;
        s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
      } while (s !== prev);
      return s;
    };

    // 0. Strip script and style blocks completely
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

    // 1. Preserve <pre>...</pre> blocks as fenced code blocks
    const preBlocks: string[] = [];
    html = html.replace(/<pre(?:\s[^>]*)?>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
      const cleanCode = decodeEntities(stripHtmlTags(inner)).trim();
      const idx = preBlocks.length;
      preBlocks.push(`\n\n\`\`\`modelica\n${cleanCode}\n\`\`\`\n\n`);
      return `\x00PRE_${idx}\x00`;
    });

    // 2. Strip <img> tags (e.g. modelica://.../image.png)
    html = html.replace(/<img\b[^>]*>/gi, "");

    // 3. Convert <a href="...">text</a>
    html = html.replace(/<a\s+[^>]*href=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href, text) => {
      const cleanText = stripHtmlTags(text).trim();
      if (href.startsWith("http://") || href.startsWith("https://")) {
        return `[${cleanText || href}](${href})`;
      }
      return cleanText ? `\`${cleanText}\`` : `\`${href.replace(/^modelica:\/\//i, "")}\``;
    });

    // 4. Convert <table>...</table> to Markdown tables or bullet rows
    html = html.replace(/<table(?:\s[^>]*)?>([\s\S]*?)<\/table>/gi, (_m, tableInner) => {
      const rows: string[][] = [];
      const rowRegex = /<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/gi;
      let rMatch: RegExpExecArray | null;
      while ((rMatch = rowRegex.exec(tableInner)) !== null) {
        const cells: string[] = [];
        const cellRegex = /<t[hd](?:\s[^>]*)?>([\s\S]*?)<\/t[hd]>/gi;
        let cMatch: RegExpExecArray | null;
        while ((cMatch = cellRegex.exec(rMatch[1]!)) !== null) {
          const cellText = decodeEntities(
            stripHtmlTags(
              cMatch[1]!
                .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
                .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
                .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`"),
            )
              .replace(/\s+/g, " ")
              .trim(),
          );
          cells.push(cellText.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"));
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length === 0) return "";
      const colCount = Math.max(...rows.map((r) => r.length));
      if (colCount >= 2 && rows.length >= 2) {
        const padRow = (r: string[]) => {
          const padded = [...r];
          while (padded.length < colCount) padded.push("");
          return `| ${padded.join(" | ")} |`;
        };
        const sep = `| ${Array(colCount).fill("---").join(" | ")} |`;
        return `\n\n${padRow(rows[0]!)}\n${sep}\n${rows.slice(1).map(padRow).join("\n")}\n\n`;
      }
      return `\n\n${rows.map((r) => `- ${r.join(" — ")}`).join("\n")}\n\n`;
    });

    // 5. Headings, inline styles, lists, paragraphs, and breaks
    html = html
      .replace(/<h[1-6](?:\s[^>]*)?>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner) => {
        const hText = stripHtmlTags(inner).replace(/\s+/g, " ").trim();
        return hText ? `\n\n**${hText}**\n\n` : "";
      })
      .replace(/<(?:b|strong)(?:\s[^>]*)?>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
      .replace(/<(?:i|em|var)(?:\s[^>]*)?>([\s\S]*?)<\/(?:i|em|var)>/gi, "*$1*")
      .replace(/<(?:code|tt)(?:\s[^>]*)?>([\s\S]*?)<\/(?:code|tt)>/gi, "`$1`")
      .replace(/<sub(?:\s[^>]*)?>([\s\S]*?)<\/sub>/gi, "_$1")
      .replace(/<sup(?:\s[^>]*)?>([\s\S]*?)<\/sup>/gi, "^$1")
      .replace(/<dt(?:\s[^>]*)?>([\s\S]*?)<\/dt>/gi, (_m, inner) => `\n- **${inner.trim()}**: `)
      .replace(/<dd(?:\s[^>]*)?>([\s\S]*?)<\/dd>/gi, (_m, inner) => `${inner.trim()}\n`)
      .replace(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi, (_m, inner) => {
        const liText = inner.replace(/\s+/g, " ").trim();
        return liText ? `\n- ${liText}` : "";
      })
      .replace(/<\/?(?:ul|ol|dl)(?:\s[^>]*)?>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
      .replace(/<\/?(?:p|div|blockquote)(?:\s[^>]*)?>/gi, "\n\n");
    html = stripHtmlTags(html);

    html = decodeEntities(html);

    // Normalize line whitespace
    const lines = html.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
    let md = lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Restore <pre> code blocks
    for (let idx = 0; idx < preBlocks.length; idx++) {
      md = md.replace(`\x00PRE_${idx}\x00`, preBlocks[idx]!);
    }

    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Extracts the `Documentation(info="...")` HTML string from a Modelica class source span.
   */
  private extractModelicaDocumentationInfo(rawClassText: string): string | null {
    const docMatch = /\bDocumentation\s*\(/i.exec(rawClassText);
    if (!docMatch) return null;

    let i = docMatch.index + docMatch[0].length;
    const len = rawClassText.length;
    let depth = 1;

    while (i < len && depth > 0) {
      const ch = rawClassText[i]!;
      if (ch === '"') {
        i++;
        while (i < len) {
          if (rawClassText[i] === "\\") i += 2;
          else if (rawClassText[i] === '"') {
            i++;
            break;
          } else i++;
        }
        continue;
      }
      if (ch === "(") {
        depth++;
        i++;
        continue;
      }
      if (ch === ")") {
        depth--;
        i++;
        continue;
      }
      if (
        depth === 1 &&
        (ch === "i" || ch === "I") &&
        /^info\s*=\s*"/i.test(rawClassText.slice(i)) &&
        (i === 0 || !/[a-zA-Z0-9_]/.test(rawClassText[i - 1]!))
      ) {
        const eqQuoteMatch = /^info\s*=\s*/i.exec(rawClassText.slice(i));
        if (eqQuoteMatch) {
          const strStart = i + eqQuoteMatch[0].length;
          let j = strStart;
          while (j < len) {
            if (rawClassText[j] !== '"') break;
            j++;
            while (j < len) {
              if (rawClassText[j] === "\\") j += 2;
              else if (rawClassText[j] === '"') {
                j++;
                break;
              } else j++;
            }
            let k = j;
            while (k < len && /\s/.test(rawClassText[k]!)) k++;
            if (rawClassText[k] === "+") {
              k++;
              while (k < len && /\s/.test(rawClassText[k]!)) k++;
              if (rawClassText[k] === '"') {
                j = k;
                continue;
              }
            }
            break;
          }
          const rawStringLiteral = rawClassText.slice(strStart, j);
          return this.unescapeModelicaString(rawStringLiteral);
        }
      }
      i++;
    }
    return null;
  }

  /**
   * Extracts the short description string (`"..."`) for a Modelica class or component.
   */
  private extractShortDescription(entry: SymbolEntry, rawSpan?: string | null): string | null {
    const metaDesc = entry.metadata?.["description"];
    if (typeof metaDesc === "string" && metaDesc.trim()) {
      const cleaned = this.unescapeModelicaString(metaDesc);
      if (cleaned) return cleaned;
    }

    const span = rawSpan !== undefined ? rawSpan : this.getEntrySourceSlice(entry, entry.startOffset, entry.endOffset);
    if (!span) return null;

    if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
      const escapedName = entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const headerSlice = span.slice(0, 600);
      // 1. Long class header: `model SineVoltage "Sine voltage source"`
      const headerDescMatch = new RegExp(
        `\\b${escapedName}\\s+("(?:[^"\\r\\n\\\\]|\\\\.)*"(?:\\s*\\+\\s*"(?:[^"\\r\\n\\\\]|\\\\.)*")*)`,
      ).exec(headerSlice);
      if (headerDescMatch && headerDescMatch.index < 200) {
        return this.unescapeModelicaString(headerDescMatch[1]!);
      }
      // 2. Short class definition: `type Voltage = Real(...) "Electric potential";`
      if (span.length < 2000 && !new RegExp(`\\bend\\s+${escapedName}\\b`).test(span)) {
        const strippedAnn = this.stripModelicaAnnotations(span)
          .replace(/\s*;\s*$/, "")
          .trim();
        const trailMatch = strippedAnn.match(/("(?:[^"\\\r\n]|\\.)*")\s*$/);
        if (trailMatch) {
          return this.unescapeModelicaString(trailMatch[1]!);
        }
      }
      return null;
    }

    if (entry.kind === "Component" || entry.kind === "Variable") {
      const strippedAnn = this.stripModelicaAnnotations(span)
        .replace(/\s*;\s*$/, "")
        .trim();
      const trailMatch = strippedAnn.match(/("(?:[^"\\\r\n]|\\.)*"(?:\s*\+\s*"(?:[^"\\\r\n]|\\.)*")*)\s*$/);
      if (trailMatch) {
        return this.unescapeModelicaString(trailMatch[1]!);
      }
    }

    return null;
  }

  /**
   * Extracts leading `/** ... * /`, `/* ... * /`, or contiguous `//` doc comments immediately
   * preceding `entry` in its source file, as well as SysML v2 `doc /* ... * /` comments inside `rawSpan`.
   */
  private extractDocComments(entry: SymbolEntry, rawSpan?: string | null): string | null {
    const comments: string[] = [];

    // 1. Leading comments immediately preceding the declaration (or its component_clause)
    const fullText = this.getEntryFullSourceText(entry);
    if (fullText) {
      let declStart = entry.startOffset ?? 0;
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const clausePrefix = this.extractComponentClausePrefix(entry);
        if (clausePrefix && clausePrefix.clauseStartOffset < declStart) {
          declStart = clausePrefix.clauseStartOffset;
        }
      }
      // Move back to the start of the line if only horizontal whitespace precedes `declStart`
      let lineStart = declStart;
      while (lineStart > 0 && (fullText[lineStart - 1] === " " || fullText[lineStart - 1] === "\t")) {
        lineStart--;
      }

      const beforeDecl = fullText.slice(Math.max(0, lineStart - 4000), lineStart);
      const closeIdx = beforeDecl.lastIndexOf("*/");
      if (closeIdx !== -1 && /^[ \t\r]*\n?[ \t]*$/.test(beforeDecl.slice(closeIdx + 2))) {
        const openIdx = beforeDecl.lastIndexOf("/*", closeIdx);
        if (openIdx !== -1) {
          const rawComment = beforeDecl
            .slice(openIdx + 2, closeIdx)
            .replace(/^\*+/, "")
            .split("\n")
            .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
            .join("\n")
            .trim();
          if (rawComment && !rawComment.includes("SPDX-License-Identifier")) {
            comments.push(rawComment);
          }
        }
      } else {
        // Check contiguous `//` lines immediately above `lineStart`
        const linesBefore = beforeDecl.replace(/\r\n/g, "\n").split("\n");
        if (linesBefore.length > 0 && linesBefore[linesBefore.length - 1]!.trim() === "") {
          linesBefore.pop();
        }
        const docLines: string[] = [];
        for (let i = linesBefore.length - 1; i >= 0; i--) {
          const line = linesBefore[i]!.trim();
          if (line.startsWith("//")) {
            const content = line.replace(/^\/+\s?/, "");
            if (content.includes("SPDX-License-Identifier")) break;
            docLines.unshift(content);
          } else {
            break;
          }
        }
        if (docLines.length > 0) {
          comments.push(docLines.join("\n").trim());
        }
      }
    }

    // 2. SysML v2 `doc /* ... */` inside the element body
    if (rawSpan) {
      const docBlockMatch = rawSpan.match(/\bdoc\s*\/\*([\s\S]*?)\*\//);
      if (docBlockMatch && docBlockMatch[1]) {
        const cleanedDoc = docBlockMatch[1]
          .split("\n")
          .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
          .join("\n")
          .trim();
        if (cleanedDoc && !comments.includes(cleanedDoc)) {
          comments.push(cleanedDoc);
        }
      }
    }

    return comments.length > 0 ? comments.join("\n\n") : null;
  }

  /**
   * Determines the enclosing package/class qualified name for `entry` (from `parentId` or `within ...;`).
   */
  private getEnclosingScopeName(entry: SymbolEntry): string | null {
    if (entry.parentId !== null) {
      const parent = this.index.symbols.get(entry.parentId);
      if (parent && parent.name && parent.name !== "<anonymous>" && parent.ruleName !== "SourceFile") {
        const sep = entry.language === "sysml" || entry.resourceId?.endsWith(".sysml") ? "::" : ".";
        return this.getQualifiedName(parent, sep);
      }
    }
    const fullText = this.getEntryFullSourceText(entry);
    if (fullText) {
      const withinMatch = fullText.slice(0, 300).match(/^\s*within\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*;/m);
      if (withinMatch && withinMatch[1]) {
        return withinMatch[1];
      }
    }
    return null;
  }

  /**
   * Renders Markdown hover text for a resolved `SymbolEntry`, including its full declaration
   * signature, description string, leading/inline doc comments, and Modelica `Documentation(info=...)`.
   */
  private hoverEntry(entry: SymbolEntry): string {
    if (this.activeHoverIds.has(entry.id)) {
      return `\`\`\`modelica\n${entry.kind.toLowerCase()} ${entry.name}\n\`\`\``;
    }
    this.activeHoverIds.add(entry.id);
    try {
      try {
        const hoverResult = this.engine.query<string>("hover", entry.id);
        if (hoverResult) return hoverResult;
      } catch {
        // No hover query defined — fall back to default
      }

      const lang = entry.language ?? (entry.resourceId?.endsWith(".sysml") ? "sysml" : "modelica");
      const declStr = this.formatDeclaration(entry);

      let md = `\`\`\`${lang}\n${declStr}\n\`\`\``;

      const entryStart = entry.startOffset ?? 0;
      const entryEnd = entry.endOffset ?? 0;
      const rawSpan = entryEnd > entryStart ? this.getEntrySourceSlice(entry, entryStart, entryEnd) : null;

      const docSections: string[] = [];

      // 1. Short description string (e.g. `"Sine voltage source"` or `"Amplitude of sine wave"`)
      const shortDesc = this.extractShortDescription(entry, rawSpan);
      if (shortDesc) {
        if (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type") {
          docSections.push(`**${shortDesc}**`);
        } else {
          docSections.push(shortDesc);
        }
      }

      // 2. Leading `/** ... */`, `/* ... */`, `//` doc comments, or SysML v2 `doc /* ... */`
      const docComments = this.extractDocComments(entry, rawSpan);
      if (docComments && docComments !== shortDesc) {
        docSections.push(docComments);
      }

      // 3. Modelica `annotation(Documentation(info="<html>...</html>"))`
      if (
        rawSpan &&
        (entry.kind === "Class" || entry.kind === "Function" || entry.kind === "Package" || entry.kind === "Type")
      ) {
        const docInfoHtml = this.extractModelicaDocumentationInfo(rawSpan);
        if (docInfoHtml) {
          const docInfoMd = this.modelicaHtmlToMarkdown(docInfoHtml);
          if (docInfoMd && docInfoMd !== shortDesc) {
            docSections.push(docInfoMd);
          }
        }
      }

      // 4. For components/variables, include resolved type description & FQN when informative
      if (entry.kind === "Component" || entry.kind === "Variable") {
        const typeDecl = this.resolveTypeOf(entry);
        if (typeDecl && !typeDecl.metadata?.["isPredefined"]) {
          const sep = lang === "sysml" ? "::" : ".";
          const typeFqn = this.getQualifiedName(typeDecl, sep) || typeDecl.name;
          const typeDesc = this.extractShortDescription(typeDecl);
          if (typeDesc || typeFqn.includes(".") || typeFqn.includes("::")) {
            docSections.push(`*Type:* \`${typeFqn}\`${typeDesc ? ` — ${typeDesc}` : ""}`);
          }
        }
      }

      // 5. Enclosing package / class scope footer
      const enclosingScope = this.getEnclosingScopeName(entry);
      if (enclosingScope) {
        docSections.push(`*Defined in \`${enclosingScope}\`*`);
      }

      if (docSections.length > 0) {
        md += `\n\n---\n\n${docSections.join("\n\n")}`;
      }
      return md;
    } finally {
      this.activeHoverIds.delete(entry.id);
    }
  }

  /**
   * Resolves hover documentation when the cursor is over a modifier name inside a component modification `(...)`.
   */
  private hoverModificationContext(byteOffset: number, sourceText: string): LSPHover | null {
    let start = byteOffset;
    if (start > 0 && !/[a-zA-Z0-9_]/.test(sourceText[start]!) && /[a-zA-Z0-9_]/.test(sourceText[start - 1]!)) {
      start--;
    }
    while (start > 0 && /[a-zA-Z0-9_]/.test(sourceText[start - 1]!)) start--;
    let end = start;
    while (end < sourceText.length && /[a-zA-Z0-9_]/.test(sourceText[end]!)) end++;

    if (start >= end) return null;
    const word = sourceText.slice(start, end);

    const before = sourceText.slice(0, start);
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

    // Ensure the hovered identifier is on the left-hand side of a modification (not after `=`)
    const sinceOpenParen = before.slice(parenPos + 1);
    let innerDepth = 0;
    let lastCommaOrStart = 0;
    for (let i = 0; i < sinceOpenParen.length; i++) {
      const ch = sinceOpenParen[i];
      if (ch === "(" || ch === "[" || ch === "{") innerDepth++;
      else if (ch === ")" || ch === "]" || ch === "}") innerDepth = Math.max(0, innerDepth - 1);
      else if (innerDepth === 0 && ch === ",") lastCommaOrStart = i + 1;
    }
    const currentArgPrefix = sinceOpenParen.slice(lastCommaOrStart);
    if (currentArgPrefix.includes("=")) {
      return null;
    }

    const beforeParen = before.slice(0, parenPos).trimEnd();
    const extendsMatch = beforeParen.match(/\bextends\s+([a-zA-Z_][a-zA-Z0-9_.:]*)$/);
    const declMatch = beforeParen.match(/([a-zA-Z_][a-zA-Z0-9_.:]*)\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\[[^\]]*\])?$/);
    const typeName = extendsMatch?.[1] ?? declMatch?.[1];
    if (!typeName) return null;

    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const typeDecls = this.resolveName(typeName, scopeId);
    if (typeDecls.length === 0) return null;

    const typeEntry = typeDecls[0]!;
    const hoverRange = this.positions.rangeFromOffsets(start, end);

    const children = this.getExportedChildren(typeEntry.id);
    for (const child of children) {
      if (child.name === word && this.isDecl(child)) {
        return { contents: this.hoverEntry(child), range: hoverRange };
      }
    }

    const inherited = this.getInheritedMembers(typeEntry.id);
    for (const member of inherited) {
      if (member.name === word) {
        return { contents: this.hoverEntry(member), range: hoverRange };
      }
    }

    if (typeEntry.metadata?.["completionMembers"] && Array.isArray(typeEntry.metadata["completionMembers"])) {
      if (typeEntry.metadata["completionMembers"].includes(word)) {
        const lang = typeEntry.language ?? "modelica";
        return {
          contents: `\`\`\`${lang}\n${word}\n\`\`\`\n---\nBuilt-in attribute of ${typeEntry.name}`,
          range: hoverRange,
        };
      }
    }

    return null;
  }

  // =========================================================================
  // textDocument/typeDefinition
  // =========================================================================

  /** Returns the raw symbol entry for the type of the element at the offset, preserving cross-document resourceIds */
  typeDefinitionRaw(byteOffset: number, sourceText?: string): SymbolEntry | null {
    const text = sourceText ?? this.positions.getSourceText();
    let word = "";
    if (text) {
      let ws = byteOffset;
      if (ws > 0 && !/[a-zA-Z0-9_]/.test(text[ws]!) && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
      while (ws > 0 && /[a-zA-Z0-9_]/.test(text[ws - 1]!)) ws--;
      let we = ws;
      while (we < text.length && /[a-zA-Z0-9_]/.test(text[we]!)) we++;
      if (ws >= we || byteOffset < ws || byteOffset > we) {
        return null;
      }
      word = text.slice(ws, we);
    }

    const refEntry = this.findEntryAtOffset(byteOffset);
    if (!refEntry) return null;

    let targetDecl = refEntry;
    if (word && (refEntry.kind === "Class" || refEntry.ruleName === "SourceFile")) {
      const resolved = this.resolveName(word, refEntry.id);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      } else {
        return null;
      }
    } else {
      const resolved = this.resolveRef(refEntry);
      if (resolved.length > 0) {
        targetDecl = resolved[0]!;
      }
    }

    try {
      const typeResult = this.engine.query<SymbolEntry | null>("resolvedType", targetDecl.id);
      if (typeResult) return typeResult;
    } catch {
      // ignore
    }

    const children = this.getExportedChildren(targetDecl.id);
    const typeRef = children.find((c) => c.kind === "Reference");
    if (typeRef) {
      const typeResolved = this.resolveRef(typeRef);
      if (typeResolved.length > 0) return typeResolved[0]!;
    }
    return null;
  }

  // =========================================================================
  // textDocument/references & textDocument/rename (Workspace-wide access)
  // =========================================================================

  /** Returns raw symbol entries for references, preserving cross-document resourceIds */
  findReferencesRaw(byteOffset: number): { declaration: SymbolEntry | null; references: SymbolEntry[] } {
    const entry = this.findEntryAtOffset(byteOffset);
    if (!entry) return { declaration: null, references: [] };

    let targetDecl = entry;

    // Is the user hovering over a usage/reference instead of the definition?
    // In SysML2, usage rule names end with "Usage" (e.g. "PartUsage"), but more generally
    // we can check if it resolves to something.
    const resolved = this.resolveRef(entry);
    if (resolved.length > 0) {
      targetDecl = resolved[0]!;
    }

    // Find all references mapping to the target declaration (workspace-wide)
    const references = this.findRefs(targetDecl.id);
    return { declaration: targetDecl, references };
  }

  /**
   * Returns `LSPLocation[]` for all references within the bound document to the symbol at `byteOffset`.
   */
  references(byteOffset: number): LSPLocation[] {
    const { references } = this.findReferencesRaw(byteOffset);

    // Note: The legacy references() method only maps entries belonging to THIS document
    // because this `positions` index is only valid for the current document.
    return references
      .filter((ref) => ref.resourceId === this.documentUri)
      .map((ref) => ({
        uri: this.documentUri,
        range: this.positions.rangeFromOffsets(ref.startOffset, ref.endOffset),
      }));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Get the SymbolId list for the current document.
   * Uses the symbolsByResource index when available (O(1) lookup),
   * falling back to a full scan for older indices that lack it.
   */
  private getDocumentSymbolIds(): Iterable<SymbolId> {
    const normalize = (u: string) => {
      try {
        return decodeURIComponent(u).replace(/^[a-z0-9+-]+:\/\/?/, "/");
      } catch {
        return u;
      }
    };
    const targetNorm = normalize(this.documentUri);

    if (this.index.symbolsByResource) {
      let ids = this.index.symbolsByResource.get(this.documentUri);
      if (ids && ids.length > 0) return ids;
      for (const [k, v] of this.index.symbolsByResource.entries()) {
        const kNorm = normalize(k);
        if (
          k === this.documentUri ||
          kNorm === targetNorm ||
          kNorm.endsWith(targetNorm) ||
          targetNorm.endsWith(kNorm)
        ) {
          return v;
        }
      }
    }
    // Fallback: filter from all symbols (legacy path)
    const ids: SymbolId[] = [];
    for (const entry of this.index.symbols.values()) {
      const resNorm = entry.resourceId ? normalize(entry.resourceId) : "";
      if (
        entry.resourceId === this.documentUri ||
        resNorm === targetNorm ||
        (resNorm && (resNorm.endsWith(targetNorm) || targetNorm.endsWith(resNorm)))
      ) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  /** Find the narrowest symbol entry containing a byte offset. */
  private findEntryAtOffset(offset: number): SymbolEntry | null {
    let best: SymbolEntry | null = null;
    let bestSize = Infinity;

    for (const id of this.getDocumentSymbolIds()) {
      const entry = this.index.symbols.get(id);
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
  private findScopeAtOffset(offset: number): SymbolEntry | null {
    let best: SymbolEntry | null = null;
    let bestSize = Infinity;

    for (const id of this.getDocumentSymbolIds()) {
      const entry = this.index.symbols.get(id);
      if (!entry) continue;
      const start = entry.startOffset;
      const end = entry.endOffset;
      if (start <= offset && offset <= end) {
        const size = end - start;
        if (size < bestSize) {
          // Check if this entry is a scope-creator (has children in the index)
          const childIds = this.index.childrenOf.get(entry.id);
          if (childIds && childIds.length > 0) {
            best = entry;
            bestSize = size;
          }
        }
      }
    }

    return best;
  }

  /** Map a user-defined symbol kind string to an LSP SymbolKind number. */
  private mapSymbolKind(kind: string): LSPSymbolKind {
    const mapping: Record<string, LSPSymbolKind> = {
      Class: LSPSymbolKind.Class,
      Function: LSPSymbolKind.Function,
      Variable: LSPSymbolKind.Variable,
      Package: LSPSymbolKind.Package,
      Module: LSPSymbolKind.Module,
      Interface: LSPSymbolKind.Interface,
      Enum: LSPSymbolKind.Enum,
      Struct: LSPSymbolKind.Struct,
      Property: LSPSymbolKind.Property,
      Field: LSPSymbolKind.Field,
      Constant: LSPSymbolKind.Constant,
      Method: LSPSymbolKind.Method,
      Constructor: LSPSymbolKind.Constructor,
      Namespace: LSPSymbolKind.Namespace,
      Type: LSPSymbolKind.Interface,
    };
    return mapping[kind] ?? LSPSymbolKind.Variable;
  }

  /**
   * Update all internal references after an incremental update.
   */
  updateState(index: SymbolIndex, positions: PositionIndex): void {
    this.index = index;
    this.positions = positions;
  }
}
