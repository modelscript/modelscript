/* eslint-disable */
import type { QueryEngine } from "./query-engine.js";
import type { ScopeResolver } from "./resolver.js";
import type { SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";

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

export interface LSPRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface LSPLocation {
  uri: string;
  range: LSPRange;
}

export interface LSPDocumentSymbol {
  name: string;
  kind: LSPSymbolKind;
  range: LSPRange;
  selectionRange: LSPRange;
  children?: LSPDocumentSymbol[];
}

export interface LSPCompletionItem {
  label: string;
  kind: LSPSymbolKind;
  detail?: string;
}

export interface LSPHover {
  contents: string;
  range?: LSPRange;
}

// ---------------------------------------------------------------------------
// Offset ↔ Position converter
// ---------------------------------------------------------------------------

/**
 * Converts byte offsets to LSP line/character positions.
 * Must be initialized with the source text.
 */
export class PositionIndex {
  private lineStarts: number[];

  constructor(sourceText: string) {
    this.lineStarts = [0];
    for (let i = 0; i < sourceText.length; i++) {
      if (sourceText[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  offsetToPosition(offset: number): { line: number; character: number } {
    // Binary search for the line
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: offset - this.lineStarts[lo] };
  }

  rangeFromBytes(startByte: number, endByte: number): LSPRange {
    return {
      start: this.offsetToPosition(startByte),
      end: this.offsetToPosition(endByte),
    };
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
  constructor(
    private index: SymbolIndex,
    private engine: QueryEngine,
    private resolver: ScopeResolver,
    private positions: PositionIndex,
    private documentUri: string,
  ) {}

  // =========================================================================
  // textDocument/documentSymbol
  // =========================================================================

  documentSymbols(): LSPDocumentSymbol[] {
    // Collect only symbols belonging to this document
    const docSymbols = new Set<SymbolId>();
    for (const entry of this.index.symbols.values()) {
      if (entry.resourceId && entry.resourceId !== this.documentUri) continue;
      // Skip reference entries — they are internal resolution artifacts,
      // not user-visible declarations (e.g. OwnedFeatureTyping)
      if (entry.kind === "Reference") continue;
      docSymbols.add(entry.id);
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

    const buildLevel = (parentId: SymbolId | null): LSPDocumentSymbol[] => {
      const entries = childrenOf.get(parentId) || [];
      return entries.map((entry) => {
        const range = this.positions.rangeFromBytes(entry.startByte, entry.endByte);
        const symbol: LSPDocumentSymbol = {
          name: entry.name,
          kind: this.mapSymbolKind(entry.kind),
          range,
          selectionRange: range, // Could be narrowed to name range
          children: buildLevel(entry.id),
        };
        return symbol;
      });
    };

    return buildLevel(null);
  }

  // =========================================================================
  // textDocument/definition
  // =========================================================================

  definition(byteOffset: number): LSPLocation | null {
    const refEntry = this.findEntryAtOffset(byteOffset);
    if (!refEntry) return null;

    const targets = this.resolver.resolve(refEntry);
    if (targets.length === 0) return null;

    const target = targets[0]; // Return first match
    return {
      uri: this.documentUri,
      range: this.positions.rangeFromBytes(target.startByte, target.endByte),
    };
  }

  // =========================================================================
  // textDocument/completion
  // =========================================================================

  completion(byteOffset: number, sourceText?: string): LSPCompletionItem[] {
    // ------------------------------------------------------------------
    // Dot-access completion: "a." → resolve `a` to its type, show members
    // ------------------------------------------------------------------
    if (sourceText) {
      const before = sourceText.slice(0, byteOffset);
      const dotMatch = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*[a-zA-Z_]?[a-zA-Z0-9_]*$/);
      if (dotMatch) {
        const varName = dotMatch[1];
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

    const visible = this.resolver.visibleSymbols(scopeId);
    return visible.map((entry) => ({
      label: entry.name,
      kind: this.mapSymbolKind(entry.kind),
      detail: entry.kind,
    }));
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
    const varDecls = this.resolver.resolveName(varName, scopeId);
    if (varDecls.length === 0) return [];

    const varDecl = varDecls[0];

    // 3. Resolve the type of the variable using generic strategies
    const typeDecl = this.resolveTypeOf(varDecl);
    if (typeDecl) {
      return this.membersOf(typeDecl);
    }

    // 4. If the variable itself is a scope (e.g. a class), show its members directly
    const children = this.getExportedChildren(varDecl.id);
    if (children.length > 0) {
      return children.map((child) => ({
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
    // Strategy 1: Check metadata string values as potential type names
    if (entry.metadata) {
      for (const value of Object.values(entry.metadata)) {
        if (typeof value === "string" && value.length > 0) {
          const typeDecls = this.resolver.resolveName(value, entry.parentId);
          if (typeDecls.length > 0 && this.resolver.isDeclaration(typeDecls[0])) {
            return typeDecls[0];
          }
        }
      }
    }

    // Strategy 2: Check child Reference entries (from ref() hooks)
    const childRefs = this.getExportedChildren(entry.id).filter((c) => !this.resolver.isDeclaration(c)); // Reference entries
    for (const ref of childRefs) {
      if (ref.name && ref.name.length > 0) {
        const typeDecls = this.resolver.resolveName(ref.name, entry.parentId);
        if (typeDecls.length > 0 && this.resolver.isDeclaration(typeDecls[0])) {
          return typeDecls[0];
        }
      }
    }

    return null;
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
    const declMatch = beforeParen.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\s+[a-zA-Z_][a-zA-Z0-9_]*$/);
    if (!declMatch) return null;

    const typeName = declMatch[1];

    // Resolve the type
    const scopeEntry = this.findScopeAtOffset(byteOffset);
    const scopeId = scopeEntry?.id ?? null;
    const typeDecls = this.resolver.resolveName(typeName, scopeId);
    if (typeDecls.length === 0) return null;

    return this.membersOf(typeDecls[0]);
  }

  /**
   * Get completion items for all members (exported children + inherited) of a type.
   */
  private membersOf(typeEntry: SymbolEntry): LSPCompletionItem[] {
    const results: LSPCompletionItem[] = [];
    const seen = new Set<string>();

    // Direct children (exclude reference-site entries like extends clauses)
    for (const child of this.getExportedChildren(typeEntry.id)) {
      if (!this.resolver.isDeclaration(child)) continue;
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
    const inherited = this.resolver.inheritedMembersOf(typeEntry.id);
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

    return results;
  }

  /**
   * Get exported children of a symbol scope.
   */
  private getExportedChildren(scopeId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const entry of this.index.symbols.values()) {
      if (entry.parentId === scopeId) {
        results.push(entry);
      }
    }
    return results;
  }

  // =========================================================================
  // textDocument/hover
  // =========================================================================

  hover(byteOffset: number): LSPHover | null {
    const entry = this.findEntryAtOffset(byteOffset);
    if (!entry) return null;

    // Try to use a user-defined hover query
    try {
      const hoverResult = this.engine.query<string>("hover", entry.id);
      if (hoverResult) {
        return {
          contents: hoverResult,
          range: this.positions.rangeFromBytes(entry.startByte, entry.endByte),
        };
      }
    } catch {
      // No hover query defined — fall back to default
    }

    return {
      contents: `**${entry.kind}** \`${entry.name}\``,
      range: this.positions.rangeFromBytes(entry.startByte, entry.endByte),
    };
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
    const resolved = this.resolver.resolve(entry);
    if (resolved.length > 0) {
      targetDecl = resolved[0];
    }

    // Find all references mapping to the target declaration (workspace-wide)
    const references = this.resolver.findReferences(targetDecl.id);
    return { declaration: targetDecl, references };
  }

  references(byteOffset: number): LSPLocation[] {
    const { references } = this.findReferencesRaw(byteOffset);

    // Note: The legacy references() method only maps entries belonging to THIS document
    // because this `positions` index is only valid for the current document.
    return references
      .filter((ref) => ref.resourceId === this.documentUri)
      .map((ref) => ({
        uri: this.documentUri,
        range: this.positions.rangeFromBytes(ref.startByte, ref.endByte),
      }));
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Find the narrowest symbol entry containing a byte offset. */
  private findEntryAtOffset(offset: number): SymbolEntry | null {
    let best: SymbolEntry | null = null;
    let bestSize = Infinity;

    for (const entry of this.index.symbols.values()) {
      if (entry.startByte <= offset && offset < entry.endByte) {
        const size = entry.endByte - entry.startByte;
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

    for (const entry of this.index.symbols.values()) {
      if (entry.startByte <= offset && offset < entry.endByte) {
        const size = entry.endByte - entry.startByte;
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
