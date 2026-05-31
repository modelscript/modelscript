/* eslint-disable */
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";
import { IdTrieMap, StringTrieMap } from "./utils/radix-trie.js";

interface IndexContext {
  symbols: IdTrieMap<SymbolEntry>;
  byName: StringTrieMap<SymbolId[]>;
  childrenOf: IdTrieMap<SymbolId[]>;
  processedOldIds: Set<SymbolId>;
}

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
  private idGenerator: () => SymbolId = () => this.nextId++;

  constructor(hooks: IndexerHook[]) {
    this.hooksByRule = new Map(hooks.map((h) => [h.ruleName, h]));
  }

  /**
   * Build a full index from a Tree-Sitter syntax tree.
   *
   * @param rootNode - The root node of a Tree-Sitter parse tree.
   *                   We use a minimal interface to avoid a hard dependency on tree-sitter.
   */
  index(rootNode: CSTNode, idGenerator?: () => SymbolId): SymbolIndex {
    const ctx: IndexContext = {
      symbols: new IdTrieMap(),
      byName: new StringTrieMap(),
      childrenOf: new IdTrieMap(),
      processedOldIds: new Set(),
    };

    this.nextId = 1;
    this.idGenerator = idGenerator || (() => this.nextId++);
    this.walkNode(rootNode, null, ctx, new Map());

    return ctx;
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
    idGenerator?: () => SymbolId,
  ): { index: SymbolIndex; changedIds: Set<SymbolId>; structuralChangedIds: Set<SymbolId> } {
    const oldByStableKey = new Map<string, SymbolEntry>();
    const ordinalCounters = new Map<string, number>();
    for (const parentId of oldIndex.childrenOf.keys()) {
      const childIds = oldIndex.childrenOf.get(parentId);
      if (!childIds) continue;
      ordinalCounters.clear();
      for (const childId of childIds) {
        const entry = oldIndex.symbols.get(childId);
        if (!entry) continue;
        const baseKey = `${parentId === 0 ? "root" : parentId}:${entry.ruleName}:${entry.name}`;
        const ordinal = ordinalCounters.get(baseKey) ?? 0;
        ordinalCounters.set(baseKey, ordinal + 1);
        const key = this.stableKey(entry.ruleName, entry.name, entry.parentId, ordinal);
        oldByStableKey.set(key, entry);
      }
    }

    const ctx: IndexContext = {
      symbols: Object.assign(new IdTrieMap<SymbolEntry>(), { trie: (oldIndex.symbols as any).trie }),
      byName: Object.assign(new StringTrieMap<SymbolId[]>(), { trie: (oldIndex.byName as any).trie }),
      childrenOf: Object.assign(new IdTrieMap<SymbolId[]>(), { trie: (oldIndex.childrenOf as any).trie }),
      processedOldIds: new Set(),
    };

    let maxOldId = 0;
    for (const id of oldIndex.symbols.keys()) {
      if (id > maxOldId) maxOldId = id;
    }
    this.nextId = maxOldId + 1;
    this.idGenerator = idGenerator || (() => this.nextId++);

    const rootOldChildIds = oldIndex.childrenOf.get(0) ?? [];
    for (const childId of rootOldChildIds) {
      if (ctx.processedOldIds.has(childId)) continue;
      const childEntry = oldIndex.symbols.get(childId);
      if (!childEntry) continue;

      let overlap = false;
      for (const r of editRanges) {
        if (childEntry.startByte < r.endByte && childEntry.endByte > r.startByte) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      let isBefore = true;
      for (const r of editRanges) {
        if (childEntry.startByte >= r.endByte) {
          isBefore = false;
          break;
        }
      }

      if (isBefore) {
        this.shiftSubtree(childId, oldIndex, ctx, 0);
      } else {
        this.shiftSubtree(childId, oldIndex, ctx, totalDelta);
      }
    }

    this.walkNodeIncremental(
      rootNode,
      null,
      ctx,
      oldByStableKey,
      oldIndex,
      editRanges,
      new Map(),
      null,
      null,
      totalDelta,
    );

    const changedIds = new Set<SymbolId>();
    const structuralChangedIds = new Set<SymbolId>();
    const invalidateParent = (parentId: SymbolId | null, structural: boolean) => {
      if (parentId !== null) {
        changedIds.add(parentId);
        if (structural) structuralChangedIds.add(parentId);
      }
    };

    for (const [id, entry] of ctx.symbols.entries()) {
      const oldEntry = oldIndex.symbols.get(id);
      if (!oldEntry || !this.entryEqual(oldEntry, entry)) {
        changedIds.add(id);
        structuralChangedIds.add(id);
        if (!oldEntry) {
          invalidateParent(entry.parentId, true);
        } else if (oldEntry.parentId !== entry.parentId) {
          invalidateParent(oldEntry.parentId, true);
          invalidateParent(entry.parentId, true);
        }
      } else if (oldEntry.startByte !== entry.startByte || oldEntry.endByte !== entry.endByte) {
        changedIds.add(id);
        invalidateParent(entry.parentId, false);
      }
    }

    for (const [id, oldEntry] of oldIndex.symbols.entries()) {
      if (!ctx.processedOldIds.has(id)) {
        changedIds.add(id);
        structuralChangedIds.add(id);
        invalidateParent(oldEntry.parentId, true);
        this.deleteSubtree(id, oldIndex, ctx);
      }
    }

    return { index: ctx, changedIds, structuralChangedIds };
  }

  // -------------------------------------------------------------------------
  // Internal tree walk (full)
  // -------------------------------------------------------------------------

  private walkNode(
    node: CSTNode,
    parentId: SymbolId | null,
    ctx: IndexContext,
    siblingCounts: Map<string, number>,
    fieldName: string | null = null,
  ): void {
    const hook = this.hooksByRule.get(node.type);
    let currentParentId = parentId;

    if (hook) {
      const id = this.idGenerator();
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

      ctx.symbols.set(id, entry);

      const existing = ctx.byName.get(name);
      ctx.byName.set(name, existing ? [...existing, id] : [id]);

      const pId = parentId ?? 0;
      const siblings = ctx.childrenOf.get(pId);
      ctx.childrenOf.set(pId, siblings ? [...siblings, id] : [id]);

      currentParentId = id;
    }

    const children = node.children || [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childFieldName = node.fieldNameForChild && children.length < 100 ? node.fieldNameForChild(i) : null;
      this.walkNode(child, currentParentId, ctx, siblingCounts, childFieldName);
    }
  }

  // -------------------------------------------------------------------------
  // Internal tree walk (incremental)
  // -------------------------------------------------------------------------

  private walkNodeIncremental(
    node: CSTNode,
    parentId: SymbolId | null,
    ctx: IndexContext,
    oldByStableKey: Map<string, SymbolEntry>,
    oldIndex: SymbolIndex,
    editRanges: Array<{ startByte: number; endByte: number }>,
    siblingCounts: Map<string, number>,
    fieldName: string | null = null,
    oldParentId: SymbolId | null = parentId,
    totalDelta: number = 0,
  ): void {
    const hasChanges = typeof node.hasChanges === "function" ? node.hasChanges() : node.hasChanges;
    const unchanged = hasChanges === false && !this.nodeOverlapsEdits(node, editRanges);
    const hook = this.hooksByRule.get(node.type);

    if (unchanged && !hook) {
      const childCount = node.childCount ?? node.children?.length ?? 0;
      if (childCount === 0) return;
    }

    let currentParentId = parentId;
    let currentOldParentId = oldParentId;

    if (hook) {
      const nameNode = this.resolveFieldPath(node, hook.namePath);
      const name = nameNode ? this.getNodeText(nameNode) : "<anonymous>";

      const siblingBaseKey = `${parentId ?? "root"}:${hook.ruleName}:${name}`;
      const siblingOrdinal = siblingCounts.get(siblingBaseKey) ?? 0;
      siblingCounts.set(siblingBaseKey, siblingOrdinal + 1);

      const sKey = this.stableKey(hook.ruleName, name, parentId, siblingOrdinal);
      let oldEntry = oldByStableKey.get(sKey);
      let matchedKey = sKey;

      if (!oldEntry && oldParentId !== parentId) {
        const altKey = this.stableKey(hook.ruleName, name, oldParentId, siblingOrdinal);
        oldEntry = oldByStableKey.get(altKey);
        matchedKey = altKey;
      }

      if (oldEntry) {
        oldByStableKey.delete(matchedKey);
        ctx.processedOldIds.add(oldEntry.id);
      }

      const overlaps = this.nodeOverlapsEdits(node, editRanges);
      const id = oldEntry ? oldEntry.id : this.idGenerator();

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

      if (!oldEntry || !this.entryEqual(oldEntry, entry)) {
        ctx.symbols.set(id, entry);
      } else if (oldEntry.startByte !== entry.startByte || oldEntry.endByte !== entry.endByte) {
        ctx.symbols.set(id, entry);
      } else {
        ctx.symbols.set(id, oldEntry); // Structural sharing
      }

      const existing = ctx.byName.get(name);
      if (!existing || !existing.includes(id)) {
        ctx.byName.set(name, existing ? [...existing, id] : [id]);
      }

      const pId = parentId ?? 0;
      const siblings = ctx.childrenOf.get(pId);
      if (!siblings || !siblings.includes(id)) {
        ctx.childrenOf.set(pId, siblings ? [...siblings, id] : [id]);
      }

      currentParentId = id;
      currentOldParentId = oldEntry?.id ?? id;

      if (oldEntry) {
        const oldChildIds = oldIndex.childrenOf.get(oldEntry.id) ?? [];
        for (const childId of oldChildIds) {
          if (ctx.processedOldIds.has(childId)) continue;
          const childEntry = oldIndex.symbols.get(childId);
          if (!childEntry) continue;

          let overlap = false;
          for (const r of editRanges) {
            if (childEntry.startByte < r.endByte && childEntry.endByte > r.startByte) {
              overlap = true;
              break;
            }
          }
          if (overlap) continue;

          let isBefore = true;
          for (const r of editRanges) {
            if (childEntry.startByte >= r.endByte) {
              isBefore = false;
              break;
            }
          }

          if (isBefore) {
            this.shiftSubtree(childId, oldIndex, ctx, 0);
          } else {
            this.shiftSubtree(childId, oldIndex, ctx, totalDelta);
          }
        }
      }

      if (unchanged) {
        const byteDelta = oldEntry ? nodeStartByte(node) - oldEntry.startByte : totalDelta;
        this.shiftSubtree(id, oldIndex, ctx, byteDelta);
        return;
      }
    }

    const children = node.children || [];
    const childCount = node.childCount ?? children.length;

    if (childCount > 0) {
      this.walkChildrenBinarySearch(
        node,
        currentParentId,
        childCount,
        ctx,
        oldByStableKey,
        oldIndex,
        editRanges,
        currentOldParentId,
        totalDelta,
      );
    }
  }

  private walkChildrenBinarySearch(
    parent: CSTNode,
    parentId: SymbolId | null,
    childCount: number,
    ctx: IndexContext,
    oldByStableKey: Map<string, SymbolEntry>,
    oldIndex: SymbolIndex,
    editRanges: Array<{ startByte: number; endByte: number }>,
    oldParentId: SymbolId | null,
    totalDelta: number = 0,
  ): void {
    let editStartByte = Infinity,
      editEndByte = 0;
    for (const r of editRanges) {
      editStartByte = Math.min(editStartByte, r.startByte);
      editEndByte = Math.max(editEndByte, r.endByte);
    }

    let lo = 0,
      hi = childCount;
    const children = parent.children || [];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = children[mid];
      if (c && nodeEndByte(c) < editStartByte) lo = mid + 1;
      else hi = mid;
    }
    const firstAffected = Math.max(0, lo - 1);

    lo = firstAffected;
    hi = childCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = children[mid];
      if (c && nodeStartByte(c) <= editEndByte) lo = mid + 1;
      else hi = mid;
    }
    const lastAffected = Math.min(childCount - 1, lo);

    const siblingCounts = new Map<string, number>();
    for (let i = firstAffected; i <= lastAffected && i < childCount; i++) {
      const child = children[i];
      if (!child) continue;
      const childFieldName = parent.fieldNameForChild && childCount < 100 ? parent.fieldNameForChild(i) : null;
      this.walkNodeIncremental(
        child,
        parentId,
        ctx,
        oldByStableKey,
        oldIndex,
        editRanges,
        siblingCounts,
        childFieldName,
        oldParentId,
        totalDelta,
      );
    }
  }

  private deleteSubtree(id: SymbolId, oldIndex: SymbolIndex, ctx: IndexContext) {
    if (ctx.processedOldIds.has(id)) return;
    ctx.processedOldIds.add(id);

    const entry = oldIndex.symbols.get(id);
    if (!entry) return;

    ctx.symbols.delete(id);

    const names = ctx.byName.get(entry.name);
    if (names) {
      const filtered = names.filter((x) => x !== id);
      if (filtered.length > 0) ctx.byName.set(entry.name, filtered);
      else ctx.byName.delete(entry.name);
    }

    const pId = entry.parentId ?? 0;
    const siblings = ctx.childrenOf.get(pId);
    if (siblings) {
      const filtered = siblings.filter((x) => x !== id);
      if (filtered.length > 0) ctx.childrenOf.set(pId, filtered);
      else ctx.childrenOf.delete(pId);
    }

    const children = oldIndex.childrenOf.get(id);
    if (children) {
      for (const childId of children) {
        this.deleteSubtree(childId, oldIndex, ctx);
      }
    }
  }

  private shiftSubtree(id: SymbolId, oldIndex: SymbolIndex, ctx: IndexContext, byteDelta: number) {
    if (ctx.processedOldIds.has(id)) return;
    ctx.processedOldIds.add(id);

    const oldEntry = oldIndex.symbols.get(id);
    if (!oldEntry) return;

    if (byteDelta === 0) {
      ctx.symbols.set(id, oldEntry); // Structural sharing for the whole subtree
    } else {
      const entry = { ...oldEntry };
      entry.startByte += byteDelta;
      entry.endByte += byteDelta;
      if (entry.fieldRanges) {
        entry.fieldRanges = { ...entry.fieldRanges };
        for (const [key, rangeVal] of Object.entries(entry.fieldRanges)) {
          const range = rangeVal as { startByte: number; endByte: number };
          entry.fieldRanges[key] = { startByte: range.startByte + byteDelta, endByte: range.endByte + byteDelta };
        }
      }
      ctx.symbols.set(id, entry);
    }
    const children = oldIndex.childrenOf.get(id);
    if (children) {
      for (const childId of children) {
        this.shiftSubtree(childId, oldIndex, ctx, byteDelta);
      }
    }
  }

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
      if (part === "parent") {
        current = current.parent ?? null;
      } else {
        current = current.childForFieldName(part);
      }
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
  parent?: CSTNode | null;
  childForFieldName(name: string): CSTNode | null;
  /** True if this node or any descendant has been modified since last parse. */
  hasChanges?: boolean | (() => boolean);
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
