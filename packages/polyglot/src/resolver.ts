/* eslint-disable */
import type { IndexerHook, RefHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";

/**
 * The scope resolution engine.
 *
 * Uses the scope graph (exports/inherits on SymbolEntry) and reference hooks
 * (RefHook) to resolve name references to their target declarations.
 *
 * Supports two strategies:
 * - **lexical**: Walk parent scopes until a matching name is found.
 * - **qualified**: Resolve a dotted name path (e.g. `A.B.C`) by chaining
 *   lexical lookup for the root with member lookups for each segment.
 */
export class ScopeResolver {
  private refHooksByRule: Map<string, RefHook>;
  private indexerHooksByRule: Map<string, IndexerHook>;
  private implicitNames: Set<string> = new Set();

  constructor(
    private index: SymbolIndex,
    refHooks: RefHook[],
    indexerHooks: IndexerHook[],
  ) {
    this.refHooksByRule = new Map(refHooks.map((h) => [h.ruleName, h]));
    this.indexerHooksByRule = new Map(indexerHooks.map((h) => [h.ruleName, h]));
  }

  /**
   * Set names that are implicitly in scope (e.g. KerML types in SysML2).
   * These names will be suppressed from unresolved-reference diagnostics.
   */
  setImplicitNames(names: Set<string> | string[]): void {
    this.implicitNames = names instanceof Set ? names : new Set(names);
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Resolve a reference symbol to its target declaration(s).
   *
   * @param refEntry - The SymbolEntry for a reference node (one whose ruleName
   *                   matches a RefHook).
   * @returns Array of matching declaration entries, or empty if unresolved.
   */
  resolve(refEntry: SymbolEntry): SymbolEntry[] {
    const hook = this.refHooksByRule.get(refEntry.ruleName);
    if (!hook) return [];

    const name = refEntry.name;
    if (!name) return [];

    switch (hook.resolve) {
      case "lexical":
        return this.resolveLexical(name, refEntry.parentId, hook.targetKinds);
      case "qualified":
        return this.resolveQualified(name, refEntry.parentId, hook.targetKinds);
      default:
        return [];
    }
  }

  /**
   * Find all symbols visible at a given scope.
   * Used for completion suggestions.
   *
   * @param scopeId - The symbol whose scope to query (null for file-level).
   * @returns All symbols reachable by walking parent scopes + exports + inherits.
   */
  visibleSymbols(scopeId: SymbolId | null): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const seenIds = new Set<SymbolId>();
    const seenNames = new Set<string>();

    let currentScopeId = scopeId;
    while (currentScopeId !== null) {
      const scopeEntry = this.index.symbols.get(currentScopeId);
      if (!scopeEntry) break;

      // Add exported children (declarations only — skip reference entries)
      for (const child of this.exportedChildren(currentScopeId)) {
        if (!this.isDeclaration(child)) continue;
        if (!seenIds.has(child.id) && !seenNames.has(child.name)) {
          seenIds.add(child.id);
          seenNames.add(child.name);
          results.push(child);
        }
      }

      // Add inherited members
      for (const member of this.inheritedMembers(currentScopeId, new Set())) {
        if (!seenIds.has(member.id) && !seenNames.has(member.name)) {
          seenIds.add(member.id);
          seenNames.add(member.name);
          results.push(member);
        }
      }

      currentScopeId = scopeEntry.parentId;
    }

    // Also include file-level symbols (parentId === null)
    // Only include declarations, deduplicate by name (keeps the most local match)
    for (const entry of this.index.symbols.values()) {
      if (entry.parentId === null && !seenIds.has(entry.id) && !seenNames.has(entry.name)) {
        if (!this.isDeclaration(entry)) continue;
        seenIds.add(entry.id);
        seenNames.add(entry.name);
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Find all references to a given declaration.
   *
   * @param declarationId - ID of the declaration symbol.
   * @returns All reference entries that resolve to this declaration.
   */
  findReferences(declarationId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const targetEntry = this.index.symbols.get(declarationId);
    if (!targetEntry) return results;

    for (const entry of this.index.symbols.values()) {
      if (!this.refHooksByRule.has(entry.ruleName)) continue;

      const resolved = this.resolve(entry);
      if (resolved.some((r) => r.id === declarationId)) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Resolve a name lexically from a given scope.
   * Returns matching declaration entries (used by completion for dot-access).
   *
   * @param name - The name to look up.
   * @param fromScopeId - The scope to start the lexical lookup from.
   * @returns Matching declaration entries.
   */
  resolveName(name: string, fromScopeId: SymbolId | null): SymbolEntry[] {
    return this.resolveLexical(name, fromScopeId, []);
  }

  /**
   * Get inherited members for a given scope / type declaration.
   * Used by LSPBridge for dot-access completions to include inherited members.
   *
   * @param scopeId - The symbol ID of the type/class declaration.
   * @returns All inherited member entries.
   */
  inheritedMembersOf(scopeId: SymbolId): SymbolEntry[] {
    return this.inheritedMembers(scopeId, new Set());
  }

  /**
   * Update the index reference (e.g. after an incremental update).
   */
  updateIndex(newIndex: SymbolIndex): void {
    this.index = newIndex;
  }

  /**
   * Resolve all reference entries in the index and return diagnostics
   * for any that cannot be resolved.
   *
   * @returns Array of unresolved reference diagnostics with byte positions.
   */
  resolveAllReferences(resourceId?: string): Array<{
    symbolId: SymbolId;
    startByte: number;
    endByte: number;
    name: string;
    ruleName: string;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
  }> {
    const diagnostics: Array<{
      symbolId: SymbolId;
      startByte: number;
      endByte: number;
      name: string;
      ruleName: string;
      message: string;
      severity: "error" | "warning" | "info" | "hint";
    }> = [];

    // When filtering by resource, use the symbolsByResource index for O(1) lookup
    // instead of scanning all symbols.
    let entriesToCheck: Iterable<SymbolEntry>;
    if (resourceId && this.index.symbolsByResource) {
      const resourceIds = this.index.symbolsByResource.get(resourceId);
      if (!resourceIds) return diagnostics;
      entriesToCheck = resourceIds.map((id) => this.index.symbols.get(id)).filter(Boolean) as SymbolEntry[];
    } else {
      entriesToCheck = this.index.symbols.values();
    }

    for (const entry of entriesToCheck) {
      const hook = this.refHooksByRule.get(entry.ruleName);
      if (!hook) continue; // Not a reference entry

      // Skip entries from other documents when resourceId filter is provided
      if (resourceId && entry.resourceId !== resourceId) continue;

      const name = entry.name;
      if (!name || name === "<anonymous>") continue;

      // Use lenient resolution (no kind filtering) for diagnostics.
      // Kind filtering is a semantic constraint — for error reporting
      // we just want to know if the name resolves to ANYTHING.
      const lenientResolved =
        hook.resolve === "qualified"
          ? this.resolveQualified(name, entry.parentId, [])
          : this.resolveLexical(name, entry.parentId, []);

      if (lenientResolved.length > 0) continue; // Resolved — no diagnostic

      // Fallback 1: type-aware resolution.
      // If the parent entry has a type (via sibling Reference entries),
      // check if the unresolved name is a member of that type.
      // This handles patterns like SysML2's `:>> mass` which redefines
      // a member of the parent usage's type.
      if (this.resolveViaMemberType(name, entry.parentId)) continue;

      // Fallback 2: feature chain resolution.
      // For dot-access patterns like `engine.mass`, resolve the base
      // reference (`engine`) to its declaration, follow its type, and
      // check if the type has a member matching the unresolved name.
      if (this.resolveViaFeatureChain(name, entry)) continue;

      // Fallback 3: global name lookup.
      // Languages like SysML2 have implicit imports (e.g. `import ScalarValues::*`)
      // that make standard library types (Real, Integer, Boolean, String) available
      // in all scopes. Rather than hard-coding these, check if the name exists
      // ANYWHERE in the index as a non-reference declaration. If so, assume it's
      // reachable via an implicit import and suppress the diagnostic.
      const globalIds = this.index.byName.get(name);
      if (globalIds && globalIds.length > 0) {
        const hasDeclaration = globalIds.some((id) => {
          const sym = this.index.symbols.get(id);
          return sym && !this.refHooksByRule.has(sym.ruleName);
        });
        if (hasDeclaration) continue;
      }

      // Fallback 4: implicit names.
      // Some types come from libraries that use a different grammar (e.g. KerML
      // types like Real, Integer, Boolean, String in SysML2). These can't be
      // indexed by the current parser but are always implicitly in scope.
      if (this.implicitNames.has(name)) continue;

      const severity: "error" | "warning" | "info" | "hint" = "error";

      diagnostics.push({
        symbolId: entry.id,
        startByte: entry.startByte,
        endByte: entry.endByte,
        name,
        ruleName: entry.ruleName,
        message: `Unresolved reference '${name}'`,
        severity,
      });
    }

    return diagnostics;
  }

  /**
   * Try to resolve a name by looking at the enclosing entry's type.
   *
   * When a reference like `:>> mass` can't be resolved lexically, we check
   * if the parent entry (e.g. `part engine : Engine`) has a type reference
   * (e.g. `Engine`), and if so, whether that type has a member named `mass`.
   *
   * This is language-agnostic: it uses sibling Reference entries to find the
   * type and then checks the type's exported children.
   */
  private resolveViaMemberType(name: string, parentId: SymbolId | null): boolean {
    if (parentId === null) return false;

    const parent = this.index.symbols.get(parentId);
    if (!parent) return false;

    // Find sibling reference entries (type references of the parent)
    const siblingRefs = this.findRefChildren(parentId);
    for (const ref of siblingRefs) {
      if (!ref.name || ref.name.length === 0) continue;

      // Resolve the type name to a declaration
      const typeDecls = this.resolveLexical(ref.name, parent.parentId, []);
      for (const typeDecl of typeDecls) {
        if (this.refHooksByRule.has(typeDecl.ruleName)) continue; // skip ref entries

        // Check direct children of the type for the name
        for (const child of this.exportedChildren(typeDecl.id)) {
          if (child.name === name) return true;
        }

        // Also check inherited members
        for (const member of this.inheritedMembers(typeDecl.id, new Set())) {
          if (member.name === name) return true;
        }
      }
    }

    // Also check metadata string values as potential type refs (Modelica-style)
    if (parent.metadata) {
      for (const value of Object.values(parent.metadata)) {
        if (typeof value !== "string" || value.length === 0) continue;
        const typeDecls = this.resolveLexical(value, parent.parentId, []);
        for (const typeDecl of typeDecls) {
          if (this.refHooksByRule.has(typeDecl.ruleName)) continue;
          for (const child of this.exportedChildren(typeDecl.id)) {
            if (child.name === name) return true;
          }
          for (const member of this.inheritedMembers(typeDecl.id, new Set())) {
            if (member.name === name) return true;
          }
        }
      }
    }

    // Recurse: check grandparent's type (for nested structure)
    return this.resolveViaMemberType(name, parent.parentId);
  }

  /**
   * Resolve a name via feature chain (dot-access) pattern.
   *
   * For `engine.mass`, `mass` is a FeatureChainMember that's a sibling of
   * `engine` (FeatureReferenceMember) under the same parent scope. We find
   * the sibling reference that appears just before this entry (by byte
   * position), resolve it to its declaration, follow the declaration's type,
   * and check if the type has a member with the target name.
   */
  private resolveViaFeatureChain(name: string, entry: SymbolEntry): boolean {
    if (entry.parentId === null) return false;

    // Find sibling reference entries under the same parent,
    // that appear BEFORE this entry in the source text
    const siblings = this.findRefChildren(entry.parentId)
      .filter((s) => s.id !== entry.id && s.endByte <= entry.startByte)
      .sort((a, b) => b.startByte - a.startByte); // closest first

    for (const baseRef of siblings) {
      if (!baseRef.name || baseRef.name === "<anonymous>") continue;

      // Resolve the base reference (e.g., `engine`) to its declaration(s)
      const baseDecls = this.resolveLexical(baseRef.name, entry.parentId, []);
      for (const baseDecl of baseDecls) {
        if (this.refHooksByRule.has(baseDecl.ruleName)) continue; // skip ref entries

        // Direct children of the base declaration itself
        for (const child of this.exportedChildren(baseDecl.id)) {
          if (child.name === name && this.isDeclaration(child)) return true;
        }

        // Follow the declaration's type to find members
        if (this.resolveInTypeOf(name, baseDecl.id)) return true;
      }
    }

    return false;
  }

  /**
   * Check if a declaration's type has a member with the given name.
   * Finds child reference entries of the declaration (type annotations),
   * resolves them, and checks exported + inherited members.
   */
  private resolveInTypeOf(name: string, declId: SymbolId): boolean {
    const typeRefs = this.findRefChildren(declId);
    for (const typeRef of typeRefs) {
      if (!typeRef.name || typeRef.name.length === 0) continue;
      const entry = this.index.symbols.get(declId);
      const typeDecls = this.resolveLexical(typeRef.name, entry?.parentId ?? null, []);
      for (const typeDecl of typeDecls) {
        if (this.refHooksByRule.has(typeDecl.ruleName)) continue;
        for (const child of this.exportedChildren(typeDecl.id)) {
          if (child.name === name && this.isDeclaration(child)) return true;
        }
        for (const member of this.inheritedMembers(typeDecl.id, new Set())) {
          if (member.name === name) return true;
        }
      }
    }
    return false;
  }

  // =========================================================================
  // Resolution Strategies
  // =========================================================================

  /**
   * Lexical resolution: walk up parent scopes looking for a matching name.
   */
  private resolveLexical(name: string, fromScopeId: SymbolId | null, targetKinds: string[]): SymbolEntry[] {
    let currentScopeId = fromScopeId;

    while (true) {
      // Search in current scope
      const matches = this.lookupInScope(name, currentScopeId, targetKinds);
      if (matches.length > 0) return matches;

      // Move to parent scope
      if (currentScopeId === null) break;
      const scopeEntry = this.index.symbols.get(currentScopeId);
      if (!scopeEntry) break;
      currentScopeId = scopeEntry.parentId;
    }

    return [];
  }

  /**
   * Qualified resolution: resolve a dotted path like `A.B.C`.
   * - Lexically resolve the first segment (`A`)
   * - Then look up each subsequent segment in the resolved symbol's exports
   */
  private resolveQualified(dottedName: string, fromScopeId: SymbolId | null, targetKinds: string[]): SymbolEntry[] {
    // Split on both '.' (Modelica) and '::' (SysML2) separators
    const parts = dottedName.split(/\.|::/).filter((p) => p.length > 0);
    if (parts.length === 0) return [];

    // Resolve the root segment lexically (no kind filter for intermediate segments)
    const rootMatches = this.resolveLexical(parts[0], fromScopeId, []);
    if (rootMatches.length === 0) return [];

    let current = rootMatches;

    // Walk remaining segments
    for (let i = 1; i < parts.length; i++) {
      const segment = parts[i];
      const isLast = i === parts.length - 1;
      const kindsFilter = isLast ? targetKinds : [];

      const nextMatches: SymbolEntry[] = [];
      for (const entry of current) {
        const children = this.exportedChildren(entry.id);
        for (const child of children) {
          if (child.name === segment) {
            nextMatches.push(child);
          }
        }
      }

      if (nextMatches.length === 0) return [];
      current = nextMatches;
    }

    return current;
  }

  // =========================================================================
  // Scope Graph Helpers
  // =========================================================================

  /**
   * Look up a name in a specific scope: searches exported children
   * and inherited members.
   */
  private lookupInScope(name: string, scopeId: SymbolId | null, targetKinds: string[]): SymbolEntry[] {
    const candidates: SymbolEntry[] = [];

    if (scopeId === null) {
      // File-level scope: search all top-level symbols
      for (const entry of this.index.symbols.values()) {
        if (entry.parentId === null && entry.name === name && this.isDeclaration(entry)) {
          candidates.push(entry);
        }
      }
    } else {
      // Named scope: search exported children (declarations only)
      for (const child of this.exportedChildren(scopeId)) {
        if (child.name === name && this.isDeclaration(child)) {
          candidates.push(child);
        }
      }

      // Also search inherited members
      for (const member of this.inheritedMembers(scopeId, new Set())) {
        if (member.name === name) {
          candidates.push(member);
        }
      }
    }

    return candidates;
  }

  /**
   * Check if an entry is a declaration (not a reference site).
   * Entries whose ruleName matches a RefHook are reference usages,
   * not declarations — they should not appear in scope lookup results.
   */
  isDeclaration(entry: SymbolEntry): boolean {
    if (entry.kind === "Import") return false;
    return !this.refHooksByRule.has(entry.ruleName);
  }

  /**
   * Get all direct children symbols of a scope that are within exported field paths.
   */
  private exportedChildren(scopeId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const childIds = this.index.childrenOf.get(scopeId);
    if (!childIds) return results;
    for (const childId of childIds) {
      const entry = this.index.symbols.get(childId);
      if (entry) results.push(entry);
    }
    return results;
  }

  /**
   * Recursively collect members from inherited scopes.
   * Uses a visited set to prevent infinite loops from circular inheritance.
   *
   * For each `inherits` path on the entry, we find the child entry
   * at that path (the extends/inherits reference node), resolve its name
   * to a target declaration, then collect that target's exported children
   * and recurse into the target's own inherited members.
   */
  private inheritedMembers(scopeId: SymbolId, visited: Set<SymbolId>): SymbolEntry[] {
    if (visited.has(scopeId)) return [];
    visited.add(scopeId);

    const entry = this.index.symbols.get(scopeId);
    if (!entry || entry.inherits.length === 0) return [];

    const results: SymbolEntry[] = [];

    // Find child entries that are reference sites (extends clauses)
    const refChildren = this.findRefChildren(scopeId);
    for (const refChild of refChildren) {
      // Resolve the base class reference directly via the index
      // (NOT through resolve() which would re-enter lookupInScope → inheritedMembers)
      const baseIds = this.index.byName.get(refChild.name);
      if (!baseIds) continue;

      for (const baseId of baseIds) {
        if (baseId === refChild.id) continue; // skip self
        const base = this.index.symbols.get(baseId);
        if (!base) continue;
        // Only consider definition entries (not ref entries)
        if (this.refHooksByRule.has(base.ruleName)) continue;

        // Collect the base's exported children
        for (const child of this.exportedChildren(base.id)) {
          results.push(child);
        }
        // Recurse into the base's own inherited members
        results.push(...this.inheritedMembers(base.id, visited));
      }
    }

    return results;
  }

  /**
   * Find children of a scope that are reference nodes (have RefHooks).
   * These are the extends/inherits clauses that can be resolved.
   */
  private findRefChildren(scopeId: SymbolId): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    const childIds = this.index.childrenOf.get(scopeId);
    if (!childIds) return results;
    for (const childId of childIds) {
      const entry = this.index.symbols.get(childId);
      if (entry && this.refHooksByRule.has(entry.ruleName)) {
        results.push(entry);
      }
    }
    return results;
  }
}
