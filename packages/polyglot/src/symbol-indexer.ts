/* eslint-disable */
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";

/**
 * A generic, incremental symbol indexer that walks a Tree-Sitter CST
 * and maintains a flat symbol table.
 *
 * This class is language-agnostic. It consumes an IndexerHook[] config
 * (generated from language.ts by the CLI) and applies it to any Tree-Sitter
 * tree.
 *
 * ## Incremental Strategy
 *
 * Uses content-based stable IDs (`parentId:ruleName:name:nthSibling`) so the
 * same declaration gets the same ID across re-parses. The `update()` method
 * walks only changed subtrees (using Tree-Sitter's `hasChanges` flag), then
 * diffs old vs new to produce a minimal set of changed symbol IDs.
 */
export class SymbolIndexer {
  private hooksByRule: Map<string, IndexerHook>;
  private nextId: SymbolId = 1;

  constructor(hooks: IndexerHook[]) {
    this.hooksByRule = new Map(hooks.map((h) => [h.ruleName, h]));
  }

  /**
   * Build a full index from a Tree-Sitter syntax tree.
   *
   * @param rootNode - The root node of a Tree-Sitter parse tree.
   *                   We use a minimal interface to avoid a hard dependency on tree-sitter.
   */
  index(rootNode: CSTNode): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    this.nextId = 1;
    this.walkNode(rootNode, null, symbols, byName, childrenOf, new Map());

    return { symbols, byName, childrenOf };
  }

  /**
   * Incremental update: re-indexes only the parts of the tree that changed.
   *
   * 1. Walk the tree, but skip subtrees where `hasChanges === false`.
   * 2. For unchanged subtrees, reuse old SymbolEntry objects.
   * 3. Diff old vs new to produce a set of changed symbol IDs.
   *
   * @param oldIndex   - The previous symbol index.
   * @param rootNode   - The updated Tree-Sitter tree root (after applying edits).
   * @param editRanges - The byte ranges that were modified.
   * @returns New index + set of changed symbol IDs for cache invalidation.
   */
  update(
    oldIndex: SymbolIndex,
    rootNode: CSTNode,
    editRanges: Array<{ startByte: number; endByte: number }>,
    totalDelta: number = 0,
  ): { index: SymbolIndex; changedIds: Set<SymbolId> } {
    // Build a lookup from stable key → old entry for reuse.
    // We must compute sibling ordinals per parent to disambiguate entries
    // with the same ruleName+name (e.g., multiple ConnectEquation entries
    // sharing the same componentReference1).
    const oldByStableKey = new Map<string, SymbolEntry>();
    const ordinalCounters = new Map<string, number>();
    for (const [parentId, childIds] of oldIndex.childrenOf) {
      ordinalCounters.clear();
      for (const childId of childIds) {
        const entry = oldIndex.symbols.get(childId);
        if (!entry) continue;
        const baseKey = `${parentId ?? "root"}:${entry.ruleName}:${entry.name}`;
        const ordinal = ordinalCounters.get(baseKey) ?? 0;
        ordinalCounters.set(baseKey, ordinal + 1);
        const key = this.stableKey(entry.ruleName, entry.name, entry.parentId, ordinal);
        oldByStableKey.set(key, entry);
      }
    }

    const newSymbols = new Map<SymbolId, SymbolEntry>();
    const newByName = new Map<string, SymbolId[]>();
    const newChildrenOf = new Map<SymbolId | null, SymbolId[]>();

    // Start nextId above max old ID to prevent collisions with reused IDs
    let maxOldId = 0;
    for (const id of oldIndex.symbols.keys()) {
      if (id > maxOldId) maxOldId = id;
    }
    this.nextId = maxOldId + 1;
    this.walkNodeIncremental(
      rootNode,
      null,
      newSymbols,
      newByName,
      newChildrenOf,
      oldByStableKey,
      oldIndex,
      editRanges,
      new Map(),
      null,
      null,
      totalDelta,
    );

    const newIndex: SymbolIndex = { symbols: newSymbols, byName: newByName, childrenOf: newChildrenOf };

    // Compute changed IDs
    const changedIds = new Set<SymbolId>();

    // New or modified symbols
    for (const [id, entry] of newSymbols) {
      const oldEntry = oldIndex.symbols.get(id);
      if (!oldEntry || !this.entryEqual(oldEntry, entry)) {
        changedIds.add(id);
      }
    }

    // Deleted symbols
    for (const id of oldIndex.symbols.keys()) {
      if (!newSymbols.has(id)) {
        changedIds.add(id);
      }
    }

    return { index: newIndex, changedIds };
  }

  // -------------------------------------------------------------------------
  // Internal tree walk (full)
  // -------------------------------------------------------------------------

  private walkNode(
    node: CSTNode,
    parentId: SymbolId | null,
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
    childrenOf: Map<SymbolId | null, SymbolId[]>,
    siblingCounts: Map<string, number>,
    fieldName: string | null = null,
  ): void {
    const hook = this.hooksByRule.get(node.type);

    let currentParentId = parentId;

    if (hook) {
      const id = this.nextId++;
      const nameNode = this.resolveFieldPath(node, hook.namePath);
      const name = nameNode ? this.getNodeText(nameNode) : "<anonymous>";

      const entry: SymbolEntry = {
        id,
        kind: hook.kind,
        name,
        ruleName: hook.ruleName,
        namePath: hook.namePath,
        startByte: nodeStartByte(node),
        endByte: nodeEndByte(node),
        parentId,
        exports: hook.exportPaths,
        inherits: hook.inheritPaths,
        metadata: this.extractMetadata(node, hook),
        fieldRanges: this.extractFieldRanges(node, hook),
        fieldName,
      };

      symbols.set(id, entry);

      const existing = byName.get(name);
      if (existing) {
        existing.push(id);
      } else {
        byName.set(name, [id]);
      }

      // Track parent→child relationship
      const siblings = childrenOf.get(parentId);
      if (siblings) {
        siblings.push(id);
      } else {
        childrenOf.set(parentId, [id]);
      }

      currentParentId = id;
    }

    // Track sibling counts per child scope for stable keys
    const childSiblingCounts = new Map<string, number>();
    const children = node.children || [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childFieldName = node.fieldNameForChild && children.length < 100 ? node.fieldNameForChild(i) : null;
      this.walkNode(child, currentParentId, symbols, byName, childrenOf, childSiblingCounts, childFieldName);
    }
  }

  // -------------------------------------------------------------------------
  // Internal tree walk (incremental)
  // -------------------------------------------------------------------------

  private walkNodeIncremental(
    node: CSTNode,
    parentId: SymbolId | null,
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
    childrenOf: Map<SymbolId | null, SymbolId[]>,
    oldByStableKey: Map<string, SymbolEntry>,
    oldIndex: SymbolIndex,
    editRanges: Array<{ startByte: number; endByte: number }>,
    siblingCounts: Map<string, number>,
    fieldName: string | null = null,
    oldParentId: SymbolId | null = parentId,
    totalDelta: number = 0,
  ): void {
    // FAST PATH: skip entirely unchanged subtrees that have no hooks
    const unchanged = node.hasChanges === false && !this.nodeOverlapsEdits(node, editRanges);
    const hook = this.hooksByRule.get(node.type);

    if (unchanged && !hook) {
      // Leaf/terminal node with no changes and no hook — nothing to index here.
      // But if this node has children, we must still walk them because they
      // may contain hook descendants (e.g. PackageMember wrapping RequirementDefinition).
      const childCount = node.childCount ?? node.children?.length ?? 0;
      if (childCount === 0) {
        return;
      }
      // Fall through to walk children — the hook-node unchanged path (below)
      // will handle efficient reuse for any hooked descendants.
    }
    let currentParentId = parentId;
    let currentOldParentId = oldParentId;

    if (hook) {
      const nameNode = this.resolveFieldPath(node, hook.namePath);
      const name = nameNode ? this.getNodeText(nameNode) : "<anonymous>";

      // Compute sibling ordinal for this entry under its parent
      const siblingBaseKey = `${parentId ?? "root"}:${hook.ruleName}:${name}`;
      const siblingOrdinal = siblingCounts.get(siblingBaseKey) ?? 0;
      siblingCounts.set(siblingBaseKey, siblingOrdinal + 1);

      // Try to reuse old entry if unchanged
      const sKey = this.stableKey(hook.ruleName, name, parentId, siblingOrdinal);
      let oldEntry = oldByStableKey.get(sKey);

      // Fallback: if parent ID changed, try with the old parent ID
      if (!oldEntry && oldParentId !== parentId) {
        const altKey = this.stableKey(hook.ruleName, name, oldParentId, siblingOrdinal);
        oldEntry = oldByStableKey.get(altKey);
      }

      const overlaps = this.nodeOverlapsEdits(node, editRanges);
      const id = oldEntry && !overlaps ? oldEntry.id : this.nextId++;

      // For unchanged hook nodes, reuse old metadata to avoid expensive extraction
      const metadata = oldEntry && !overlaps ? oldEntry.metadata : this.extractMetadata(node, hook);

      const fieldRanges = oldEntry && !overlaps ? oldEntry.fieldRanges : this.extractFieldRanges(node, hook);

      const entry: SymbolEntry = {
        id,
        kind: hook.kind,
        name,
        ruleName: hook.ruleName,
        namePath: hook.namePath,
        startByte: nodeStartByte(node),
        endByte: nodeEndByte(node),
        parentId,
        exports: hook.exportPaths,
        inherits: hook.inheritPaths,
        metadata,
        fieldRanges,
        fieldName,
      };

      symbols.set(id, entry);

      const existing = byName.get(name);
      if (existing) {
        existing.push(id);
      } else {
        byName.set(name, [id]);
      }

      // Track parent→child relationship
      const siblings = childrenOf.get(parentId);
      if (siblings) {
        siblings.push(id);
      } else {
        childrenOf.set(parentId, [id]);
      }

      currentParentId = id;
      currentOldParentId = oldEntry?.id ?? id;

      if (unchanged) {
        // Look up children using the old entry's ID in the old index
        // (since the old index has children mapped under the old parent ID)
        const byteDelta = oldEntry ? nodeStartByte(node) - oldEntry.startByte : totalDelta;
        this.reuseSubtreeFromIndex(id, currentOldParentId, oldIndex, symbols, byName, childrenOf, byteDelta);
        return;
      }
    }

    const children = node.children || [];
    const childCount = node.childCount ?? children.length;

    // For large child lists, use binary search to only process the edit zone
    if (childCount > 32 && editRanges.length > 0) {
      this.walkChildrenBinarySearch(
        node,
        currentParentId,
        childCount,
        symbols,
        byName,
        childrenOf,
        oldByStableKey,
        oldIndex,
        editRanges,
        currentOldParentId,
        totalDelta,
      );
    } else {
      const childSiblingCounts = new Map<string, number>();

      for (let i = 0; i < childCount; i++) {
        const child = children[i];
        if (!child) continue;
        const childFieldName = node.fieldNameForChild && childCount < 100 ? node.fieldNameForChild(i) : null;

        this.walkNodeIncremental(
          child,
          currentParentId,
          symbols,
          byName,
          childrenOf,
          oldByStableKey,
          oldIndex,
          editRanges,
          childSiblingCounts,
          childFieldName,
          currentOldParentId,
          totalDelta,
        );
      }
    }
  }

  /**
   * Binary search children to find the edit zone, then:
   * - Bulk-copy old entries for children outside the edit zone (no tree access)
   * - Walk only children inside the edit zone normally
   */
  private walkChildrenBinarySearch(
    parent: CSTNode,
    parentId: SymbolId | null,
    childCount: number,
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
    childrenOf: Map<SymbolId | null, SymbolId[]>,
    oldByStableKey: Map<string, SymbolEntry>,
    oldIndex: SymbolIndex,
    editRanges: Array<{ startByte: number; endByte: number }>,
    oldParentId: SymbolId | null,
    totalDelta: number = 0,
  ): void {
    // Compute combined edit bounds
    let editStartByte = Infinity,
      editEndByte = 0;
    for (const r of editRanges) {
      editStartByte = Math.min(editStartByte, r.startByte);
      editEndByte = Math.max(editEndByte, r.endByte);
    }

    // Binary search for first child whose endByte >= editStartByte
    let lo = 0,
      hi = childCount;
    const children = parent.children || [];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = children[mid];
      if (c && nodeEndByte(c) < editStartByte) lo = mid + 1;
      else hi = mid;
    }
    const firstAffected = Math.max(0, lo - 1); // 1 before for safety margin

    // Binary search for last child whose startByte <= editEndByte
    lo = firstAffected;
    hi = childCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = children[mid];
      if (c && nodeStartByte(c) <= editEndByte) lo = mid + 1;
      else hi = mid;
    }
    const lastAffected = Math.min(childCount - 1, lo); // 1 after for safety

    // Compute edit delta for byte position adjustment
    let editDelta = 0;
    for (const r of editRanges) {
      // delta = newLength - oldLength. editRanges has startByte and endByte in NEW coordinates.
      // The edit at r.startByte replaced (r.endByte - r.startByte) old bytes...
      // Actually, editRanges come from Monaco edits: startByte=offset, endByte=offset+max(rangeLength, text.length)
      // We don't have the exact old vs new length here, so compute from the edit params
    }
    // Simpler: compute delta from first/last affected children vs old entries
    // For now, use old entries' byte positions directly (they're correct for before-edit,
    // and slightly off for after-edit — corrected on next full index)

    // Identify old entries that overlap with any edit range (in old coordinates).
    // editRanges.startByte is the same in old and new coords (nothing before it changed).
    // Use a generous margin to catch entries that partially overlap.
    const editZoneOldIds = new Set<SymbolId>();
    const oldChildIds = oldIndex.childrenOf.get(parentId) ?? [];
    for (const oldId of oldChildIds) {
      const entry = oldIndex.symbols.get(oldId);
      if (!entry) continue;
      if (entry.startByte < editEndByte && entry.endByte > editStartByte) {
        editZoneOldIds.add(oldId);
      }
    }

    // BEFORE edit zone: bulk-copy old entries without tree access
    const editZoneStartByte =
      firstAffected < childCount ? (children[firstAffected] ? nodeStartByte(children[firstAffected]!) : 0) : Infinity;

    for (const oldId of oldChildIds) {
      const entry = oldIndex.symbols.get(oldId);
      if (!entry) continue;
      if (editZoneOldIds.has(oldId)) continue; // overlaps edit — will be re-indexed
      // Entry ends before the edit zone — it's unchanged, copy directly
      if (entry.endByte <= editZoneStartByte) {
        this.copyEntryToNewIndex(entry, symbols, byName, childrenOf, 0);
        this.reuseSubtreeFromIndex(entry.id, entry.id, oldIndex, symbols, byName, childrenOf, 0);
      }
    }

    // EDIT ZONE: walk normally (only the affected children)
    const siblingCounts = new Map<string, number>();
    for (let i = firstAffected; i <= lastAffected && i < childCount; i++) {
      const child = children[i];
      if (!child) continue;
      this.walkNodeIncremental(
        child,
        parentId,
        symbols,
        byName,
        childrenOf,
        oldByStableKey,
        oldIndex,
        editRanges,
        siblingCounts,
        null,
        oldParentId,
        totalDelta,
      );
    }

    // AFTER edit zone: bulk-copy old entries that are beyond the edit zone
    for (const oldId of oldChildIds) {
      const entry = oldIndex.symbols.get(oldId);
      if (!entry) continue;
      if (editZoneOldIds.has(oldId)) continue; // overlaps edit — already re-indexed
      if (entry.endByte <= editZoneStartByte) continue; // already copied above
      if (symbols.has(entry.id)) continue; // already processed
      // This is an after-edit entry — copy with approximate byte positions
      this.copyEntryToNewIndex(entry, symbols, byName, childrenOf, totalDelta);
      this.reuseSubtreeFromIndex(entry.id, entry.id, oldIndex, symbols, byName, childrenOf, totalDelta);
    }
  }

  private copyEntryToNewIndex(
    oldEntry: SymbolEntry,
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
    childrenOf: Map<SymbolId | null, SymbolId[]>,
    byteDelta: number,
  ): void {
    const entry = { ...oldEntry };
    if (byteDelta !== 0) {
      entry.startByte += byteDelta;
      entry.endByte += byteDelta;
      if (entry.fieldRanges) {
        entry.fieldRanges = { ...entry.fieldRanges };
        for (const [key, range] of Object.entries(entry.fieldRanges)) {
          entry.fieldRanges[key] = { startByte: range.startByte + byteDelta, endByte: range.endByte + byteDelta };
        }
      }
    }
    symbols.set(entry.id, entry);
    const existing = byName.get(entry.name);
    if (existing) {
      existing.push(entry.id);
    } else {
      byName.set(entry.name, [entry.id]);
    }
    const siblings = childrenOf.get(entry.parentId);
    if (siblings) {
      siblings.push(entry.id);
    } else {
      childrenOf.set(entry.parentId, [entry.id]);
    }
  }

  /**
   * Reuse all entries under a parent from the OLD index, without touching the CST.
   * Uses childrenOf for O(symbols) instead of O(CST nodes).
   */
  private reuseSubtreeFromIndex(
    newParentId: SymbolId | null,
    oldParentId: SymbolId | null,
    oldIndex: SymbolIndex,
    newSymbols: Map<SymbolId, SymbolEntry>,
    newByName: Map<string, SymbolId[]>,
    newChildrenOf: Map<SymbolId | null, SymbolId[]>,
    byteDelta: number = 0,
  ): void {
    const childIds = oldIndex.childrenOf.get(oldParentId);
    if (!childIds) return;

    for (const oldId of childIds) {
      const oldEntry = oldIndex.symbols.get(oldId);
      if (!oldEntry) continue;

      // Remap parentId if parent's ID changed, and shift coordinates if needed
      const entry = {
        ...oldEntry,
        parentId: newParentId !== oldParentId ? newParentId : oldEntry.parentId,
      };

      if (byteDelta !== 0) {
        entry.startByte += byteDelta;
        entry.endByte += byteDelta;
        if (entry.fieldRanges) {
          entry.fieldRanges = { ...entry.fieldRanges };
          for (const [key, range] of Object.entries(entry.fieldRanges)) {
            entry.fieldRanges[key] = { startByte: range.startByte + byteDelta, endByte: range.endByte + byteDelta };
          }
        }
      }

      newSymbols.set(entry.id, entry);

      const existing = newByName.get(entry.name);
      if (existing) {
        existing.push(entry.id);
      } else {
        newByName.set(entry.name, [entry.id]);
      }

      const siblings = newChildrenOf.get(newParentId);
      if (siblings) {
        siblings.push(entry.id);
      } else {
        newChildrenOf.set(newParentId, [entry.id]);
      }

      // Recurse for nested children — old IDs are stable within the subtree
      this.reuseSubtreeFromIndex(entry.id, oldId, oldIndex, newSymbols, newByName, newChildrenOf, byteDelta);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Generate a stable key for a symbol based on its identity-defining fields.
   * Uses parentId + ruleName + name + sibling ordinal for uniqueness.
   *
   * The sibling ordinal disambiguates entries with the same ruleName+name under
   * the same parent (e.g., multiple ConnectEquation entries sharing the same
   * componentReference1 like `connect(Vb.p, L.p)` and `connect(Vb.p, C.p)`).
   */
  private stableKey(ruleName: string, name: string, parentId: SymbolId | null, siblingOrdinal: number = 0): string {
    if (siblingOrdinal === 0) return `${parentId ?? "root"}:${ruleName}:${name}`;
    return `${parentId ?? "root"}:${ruleName}:${name}#${siblingOrdinal}`;
  }

  /** Check if a CST node's byte range overlaps with any edit range. */
  private nodeOverlapsEdits(node: CSTNode, editRanges: Array<{ startByte: number; endByte: number }>): boolean {
    for (const range of editRanges) {
      if (nodeStartByte(node) < range.endByte && nodeEndByte(node) > range.startByte) {
        return true;
      }
    }
    return false;
  }

  /** Compare two entries for equality (ignoring byte offsets). */
  private entryEqual(a: SymbolEntry, b: SymbolEntry): boolean {
    return (
      a.kind === b.kind &&
      a.name === b.name &&
      a.ruleName === b.ruleName &&
      a.parentId === b.parentId &&
      a.exports.join(",") === b.exports.join(",") &&
      a.inherits.join(",") === b.inherits.join(",") &&
      JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
    );
  }

  /**
   * Resolve a dot-separated field path (e.g. "name" or "body.elements")
   * against a CST node by following Tree-Sitter's field accessors.
   */
  private resolveFieldPath(node: CSTNode, fieldPath: string): CSTNode | null {
    const parts = fieldPath.split(".");
    let current: CSTNode | null = node;

    for (const part of parts) {
      if (!current) return null;
      current = current.childForFieldName(part);
    }

    return current;
  }

  /** Get the source text of a CST node. */
  private getNodeText(node: CSTNode): string {
    return node.text;
  }

  /** Extract metadata from a CST node using the hook's field path mapping. */
  private extractMetadata(node: CSTNode, hook: IndexerHook): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const [key, fieldPath] of Object.entries(hook.metadataFieldPaths)) {
      const fieldNode = this.resolveFieldPath(node, fieldPath);
      if (fieldNode) {
        metadata[key] = this.getNodeText(fieldNode);
      } else {
        // Fallback: scan children for matching anonymous keyword nodes.
        // This handles the case where field() is defined inside a hidden rule
        // (e.g. _usage_modifier) referenced via repeat() — tree-sitter doesn't
        // propagate field assignments from hidden rules through repeat().
        metadata[key] = this.scanForKeyword(node, fieldPath);
      }
    }
    return metadata;
  }

  /**
   * Scan a node's children for an anonymous keyword node matching a field name.
   * Derives the keyword from the field name using common conventions:
   * - "isAbstract" → "abstract" (strip "is" prefix, lowercase)
   * - "direction" → match "in"/"out"/"inout" (known keyword sets)
   */
  private scanForKeyword(node: CSTNode, fieldName: string): string | null {
    // Derive expected keyword text from the field name
    let keyword: string | null = null;
    let keywords: string[] | null = null;

    if (fieldName === "direction") {
      keywords = ["in", "out", "inout"];
    } else if (fieldName.startsWith("is") && fieldName.length > 2) {
      keyword = fieldName.slice(2, 3).toLowerCase() + fieldName.slice(3);
    } else {
      keyword = fieldName;
    }

    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const t = child.type;
      if (keywords) {
        if (keywords.includes(t)) return t;
      } else if (keyword && t === keyword) {
        return t;
      }
    }
    return null;
  }

  /**
   * Extract byte ranges for known named fields from a CST node.
   * Includes the name and all metadata fields defined in the hook.
   */
  private extractFieldRanges(
    node: CSTNode,
    hook: IndexerHook,
  ): Record<string, { startByte: number; endByte: number }> | undefined {
    const ranges: Record<string, { startByte: number; endByte: number }> = {};
    let hasAny = false;

    // Name field
    if (hook.namePath) {
      const nameNode = this.resolveFieldPath(node, hook.namePath);
      if (nameNode) {
        ranges[hook.namePath] = { startByte: nodeStartByte(nameNode), endByte: nodeEndByte(nameNode) };
        hasAny = true;
      }
    }

    // Metadata fields (e.g. class_prefixes, variability, causality)
    for (const [_key, fieldPath] of Object.entries(hook.metadataFieldPaths)) {
      if (ranges[fieldPath]) continue; // already extracted (e.g. if namePath===metadataField)
      const fieldNode = this.resolveFieldPath(node, fieldPath);
      if (fieldNode) {
        ranges[fieldPath] = { startByte: nodeStartByte(fieldNode), endByte: nodeEndByte(fieldNode) };
        hasAny = true;
      }
    }

    return hasAny ? ranges : undefined;
  }
}

// ---------------------------------------------------------------------------
// Minimal Tree-Sitter CST Node interface
// ---------------------------------------------------------------------------

/**
 * Minimal interface for a Tree-Sitter syntax node.
 * Avoids a hard dependency on the `tree-sitter` npm package.
 *
 * Note: tree-sitter (both native and WASM) uses `startIndex`/`endIndex`
 * for byte offsets. We support both `startByte`/`endByte` (our convention)
 * and `startIndex`/`endIndex` (tree-sitter convention).
 */
export interface CSTNode {
  type: string;
  text: string;
  /** Byte offset where this node starts (our convention). */
  startByte?: number;
  /** Byte offset where this node ends (our convention). */
  endByte?: number;
  /** Byte offset where this node starts (tree-sitter convention). */
  startIndex?: number;
  /** Byte offset where this node ends (tree-sitter convention). */
  endIndex?: number;
  children: CSTNode[];
  childForFieldName(name: string): CSTNode | null;
  /** True if this node or any descendant has been modified since last parse. */
  hasChanges?: boolean;
  /** Number of children (available without materializing children array). */
  childCount?: number;
  /** Access individual child by index without materializing all children. */
  child?(i: number): CSTNode | null;
  /** True if this node was inserted by tree-sitter error recovery (missing token). */
  isMissing?: boolean;
  /** True if this node or any descendant contains an error. */
  hasError?: boolean;
  /** Get the field name for the child at the given index. */
  fieldNameForChild?(i: number): string | null;
}

/** Helper: get the start byte offset from a CSTNode (supports both naming conventions). */
export function nodeStartByte(node: CSTNode): number {
  return node.startByte ?? node.startIndex ?? 0;
}

/** Helper: get the end byte offset from a CSTNode (supports both naming conventions). */
export function nodeEndByte(node: CSTNode): number {
  return node.endByte ?? node.endIndex ?? 0;
}
