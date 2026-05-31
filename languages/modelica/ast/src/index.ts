/* eslint-disable */
// grammar-hash: ecc54a3f
// ──────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED — do not edit manually.
// Generated from grammar.json by scripts/generate-ast.ts
//
// Architecture: Hybrid Fiber (Proposal 5) with dual-source constructors,
// I-prefixed JSON interfaces, content/structural hashing, and toJSON.
// ──────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Tree-sitter interop types ───────────────────────────────────────────────

export interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
  readonly childCount: number;
  readonly children: TSNode[];
  readonly namedChildCount: number;
  readonly namedChildren: TSNode[];
  readonly hasChanges: boolean;
  readonly id: number;
  parent: TSNode | null;
  childForFieldName(fieldName: string): TSNode | null;
  childrenForFieldName(fieldName: string): TSNode[];
  fieldNameForChild(childIndex: number): string | null;
}

export interface TSPoint {
  readonly row: number;
  readonly column: number;
}

// ─── Source location ─────────────────────────────────────────────────────────

export interface SourceRange {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: TSPoint;
  readonly endPosition: TSPoint;
}

function sourceRangeFrom(node: TSNode): SourceRange {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
  };
}

// ─── JSON types ─────────────────────────────────────────────────────────────

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

// ─── Hashing ────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash.  Fast, non-cryptographic, good distribution.
 * Used for both content hashes and structural hashes.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function hashToHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Node type constants ────────────────────────────────────────────────────

export const NodeType = {
  StoredDefinition: "StoredDefinition" as const,
  WithinDirective: "WithinDirective" as const,
  ClassDefinition: "ClassDefinition" as const,
  ClassPrefixes: "ClassPrefixes" as const,
  LongClassSpecifier: "LongClassSpecifier" as const,
  ShortClassSpecifier: "ShortClassSpecifier" as const,
  DerClassSpecifier: "DerClassSpecifier" as const,
  EnumerationLiteral: "EnumerationLiteral" as const,
  ExternalFunctionClause: "ExternalFunctionClause" as const,
  LanguageSpecification: "LanguageSpecification" as const,
  ExternalFunctionCall: "ExternalFunctionCall" as const,
  InitialElementSection: "InitialElementSection" as const,
  ElementSection: "ElementSection" as const,
  ElementAnnotation: "ElementAnnotation" as const,
  SimpleImportClause: "SimpleImportClause" as const,
  CompoundImportClause: "CompoundImportClause" as const,
  UnqualifiedImportClause: "UnqualifiedImportClause" as const,
  ExtendsClause: "ExtendsClause" as const,
  ConstrainingClause: "ConstrainingClause" as const,
  ClassOrInheritanceModification: "ClassOrInheritanceModification" as const,
  InheritanceModification: "InheritanceModification" as const,
  ComponentClause: "ComponentClause" as const,
  ComponentDeclaration: "ComponentDeclaration" as const,
  ConditionAttribute: "ConditionAttribute" as const,
  Declaration: "Declaration" as const,
  Modification: "Modification" as const,
  ModificationExpression: "ModificationExpression" as const,
  ClassModification: "ClassModification" as const,
  ElementModification: "ElementModification" as const,
  ElementRedeclaration: "ElementRedeclaration" as const,
  ComponentClause1: "ComponentClause1" as const,
  ComponentDeclaration1: "ComponentDeclaration1" as const,
  ShortClassDefinition: "ShortClassDefinition" as const,
  EquationSection: "EquationSection" as const,
  AlgorithmSection: "AlgorithmSection" as const,
  ConstraintSection: "ConstraintSection" as const,
  SimpleAssignmentStatement: "SimpleAssignmentStatement" as const,
  ProcedureCallStatement: "ProcedureCallStatement" as const,
  ComplexAssignmentStatement: "ComplexAssignmentStatement" as const,
  SimpleEquation: "SimpleEquation" as const,
  SpecialEquation: "SpecialEquation" as const,
  BreakStatement: "BreakStatement" as const,
  ReturnStatement: "ReturnStatement" as const,
  IfEquation: "IfEquation" as const,
  ElseIfEquationClause: "ElseIfEquationClause" as const,
  IfStatement: "IfStatement" as const,
  ElseIfStatementClause: "ElseIfStatementClause" as const,
  ForEquation: "ForEquation" as const,
  ForStatement: "ForStatement" as const,
  ForIndex: "ForIndex" as const,
  WhileStatement: "WhileStatement" as const,
  WhenEquation: "WhenEquation" as const,
  ElseWhenEquationClause: "ElseWhenEquationClause" as const,
  WhenStatement: "WhenStatement" as const,
  ElseWhenStatementClause: "ElseWhenStatementClause" as const,
  ConnectEquation: "ConnectEquation" as const,
  IfElseExpression: "IfElseExpression" as const,
  ElseIfExpressionClause: "ElseIfExpressionClause" as const,
  RangeExpression: "RangeExpression" as const,
  UnaryExpression: "UnaryExpression" as const,
  BinaryExpression: "BinaryExpression" as const,
  EndExpression: "EndExpression" as const,
  TypeSpecifier: "TypeSpecifier" as const,
  Name: "Name" as const,
  ComponentReference: "ComponentReference" as const,
  ComponentReferencePart: "ComponentReferencePart" as const,
  FunctionCall: "FunctionCall" as const,
  FunctionCallArguments: "FunctionCallArguments" as const,
  ArrayConcatenation: "ArrayConcatenation" as const,
  ArrayConstructor: "ArrayConstructor" as const,
  ComprehensionClause: "ComprehensionClause" as const,
  NamedArgument: "NamedArgument" as const,
  FunctionArgument: "FunctionArgument" as const,
  FunctionPartialApplication: "FunctionPartialApplication" as const,
  MemberAccessExpression: "MemberAccessExpression" as const,
  OutputExpressionList: "OutputExpressionList" as const,
  ExpressionList: "ExpressionList" as const,
  ArraySubscripts: "ArraySubscripts" as const,
  Subscript: "Subscript" as const,
  Description: "Description" as const,
  AnnotationClause: "AnnotationClause" as const,
  BOOLEAN: "BOOLEAN" as const,
  IDENT: "IDENT" as const,
  STRING: "STRING" as const,
  UNSIGNEDINTEGER: "UNSIGNED_INTEGER" as const,
  UNSIGNEDREAL: "UNSIGNED_REAL" as const,
  BLOCKCOMMENT: "BLOCK_COMMENT" as const,
  LINECOMMENT: "LINE_COMMENT" as const,
  BOM: "BOM" as const,
} as const;

export type NodeTypeValue = (typeof NodeType)[keyof typeof NodeType];

// ─── Base JSON interface ─────────────────────────────────────────────────────

/** Base JSON shape for all AST nodes.  Every I-prefixed interface extends this. */
export interface ISyntaxNode {
  readonly "@type": string;
  readonly nodeId?: number;
  readonly sourceRange?: SourceRange | null;
  readonly contentHash?: string;
  readonly structuralHash?: string;
}

// ─── Change Event System ─────────────────────────────────────────────────────

export type ChangeKind = "added" | "removed" | "modified" | "reused";

/**
 * Describes a single change that occurred during AST reconciliation.
 * Emitted by reconcileAST() so the semantic layer can perform targeted updates.
 */
export interface ASTChangeEvent {
  /** What happened to this node. */
  readonly kind: ChangeKind;
  /** The node affected (the new node for added/modified, the old node for removed). */
  readonly node: SyntaxNode;
  /** For "modified": the previous version of this node (node.alternate). */
  readonly oldNode?: SyntaxNode | undefined;
  /** The parent slot name this node belongs to. */
  readonly parentSlot?: string | undefined;
  /** The parent node. */
  readonly parent?: SyntaxNode | undefined;
}

/**
 * Mutable collector for change events during a single reconciliation pass.
 * Created at the start of reconcileAST() and threaded through all reconcile calls.
 */
export class ChangeCollector {
  readonly events: ASTChangeEvent[] = [];

  added(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "added", node, parentSlot, parent });
  }

  removed(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "removed", node, parentSlot, parent });
  }

  modified(node: SyntaxNode, oldNode: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "modified", node, oldNode, parentSlot, parent });
  }

  reused(node: SyntaxNode, parentSlot?: string, parent?: SyntaxNode): void {
    this.events.push({ kind: "reused", node, parentSlot, parent });
  }
}

/** Result of an incremental reconciliation. */
export interface ReconcileResult {
  readonly ast: StoredDefinition;
  readonly events: readonly ASTChangeEvent[];
}

// ─── Base SyntaxNode — Hybrid Fiber Architecture (Lazy + Incremental) ────────

let globalVersion = 0;
export function nextVersion(): number {
  return ++globalVersion;
}

let globalNodeId = 0;
export function nextNodeId(): number {
  return ++globalNodeId;
}
/** Set the next node ID counter (e.g. when restoring from JSON). */
export function setNextNodeId(id: number): void {
  globalNodeId = id;
}

export abstract class SyntaxNode implements ISyntaxNode {
  /** The tree-sitter rule name (e.g. "part_definition"). */
  abstract readonly "@type": string;

  /** Visitor pattern: dispatch to the appropriate visitor method. */
  abstract accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R;

  /** Stable identity that survives serialization round-trips. */
  readonly nodeId: number;

  sourceRange: SourceRange | null;

  // ── Fiber fields ────────────────────────────────────────────────────

  alternate: SyntaxNode | null = null;
  version: number = 0;
  dirty: boolean = false;

  // ── CST backing reference (for lazy child materialization) ──────────

  /** The underlying tree-sitter CST node. Held for lazy children.  */
  protected _cstNode: TSNode | null = null;

  /** Tracks which child slots have been materialized from the CST. */
  private _materializedSlots: Set<string> = new Set();

  /** Whether a given child slot has been materialized. */
  isMaterialized(fieldName: string): boolean {
    return this._materializedSlots.has(fieldName);
  }

  // ── Tree pointers ───────────────────────────────────────────────────

  private _parent: WeakRef<SyntaxNode> | null = null;
  /** Which field name this node occupies in its parent. */
  parentSlot: string | null = null;

  get parent(): SyntaxNode | null {
    return this._parent?.deref() ?? null;
  }

  setParent(parent: SyntaxNode | null): void {
    this._parent = parent ? new WeakRef(parent) : null;
  }

  // ── Child slot registry ─────────────────────────────────────────────

  protected childSlots: Map<string, SyntaxNode | SyntaxNode[] | null> = new Map();

  /** Set of all valid slot names for this node type (populated by subclass constructors). */
  protected _slotNames: Set<string> = new Set();

  protected setChild(fieldName: string, child: SyntaxNode | null): void {
    this.childSlots.set(fieldName, child);
    this._materializedSlots.add(fieldName);
    if (child) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
  }

  protected setChildren(fieldName: string, children: SyntaxNode[]): void {
    this.childSlots.set(fieldName, children);
    this._materializedSlots.add(fieldName);
    for (const child of children) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
  }

  getChild(fieldName: string): SyntaxNode | null {
    const slot = this.childSlots.get(fieldName);
    return slot instanceof SyntaxNode ? slot : null;
  }

  getChildren(fieldName: string): SyntaxNode[] {
    const slot = this.childSlots.get(fieldName);
    return Array.isArray(slot) ? slot : [];
  }

  // ── Lazy child materialization ──────────────────────────────────────

  /**
   * Lazy single-child accessor.  On first access, calls the factory to
   * materialize the child from the backing CST node.  Subsequent accesses
   * return the cached result.  If constructing from JSON, the slot is
   * pre-populated eagerly and this is essentially a no-op wrapper.
   */
  protected lazyChild<T extends SyntaxNode>(fieldName: string, factory: () => T | null): T | null {
    if (this._materializedSlots.has(fieldName)) {
      return this.getChild(fieldName) as T | null;
    }
    this._materializedSlots.add(fieldName);
    const child = factory();
    // Use setChild to wire up parent pointers
    this.childSlots.set(fieldName, child);
    if (child) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
    return child;
  }

  /**
   * Lazy array-child accessor.  Same lazy semantics as lazyChild but for
   * list slots (e.g. `classDefinitions`, `members`).
   */
  protected lazyChildren<T extends SyntaxNode>(fieldName: string, factory: () => T[]): T[] {
    if (this._materializedSlots.has(fieldName)) {
      return this.getChildren(fieldName) as T[];
    }
    this._materializedSlots.add(fieldName);
    const children = factory();
    this.childSlots.set(fieldName, children);
    for (const child of children) {
      child.setParent(this);
      child.parentSlot = fieldName;
    }
    return children;
  }

  // ── Hashing ─────────────────────────────────────────────────────────

  /**
   * Content hash: captures the full structural shape AND leaf text values.
   * Two subtrees with identical content hashes are semantically identical.
   *
   * For unmaterialized slots, falls back to CST-based proxy hashing
   * (using byte length + start index) to avoid forcing materialization.
   */
  private _contentHash: string | null = null;

  get contentHash(): string {
    if (this._contentHash === null) this._contentHash = hashToHex(this.computeContentHash());
    return this._contentHash;
  }

  /**
   * Structural hash: captures only the tree shape (node types, field names,
   * child counts) but NOT leaf text.  Useful for detecting structurally
   * equivalent subtrees that differ only in identifiers/values.
   */
  private _structuralHash: string | null = null;

  get structuralHash(): string {
    if (this._structuralHash === null) this._structuralHash = hashToHex(this.computeStructuralHash());
    return this._structuralHash;
  }

  /** Override in subclasses to include field-specific data. */
  protected computeContentHash(): number {
    let parts = this["@type"];
    for (const key of this._slotNames) {
      parts += ":" + key + "=";
      if (!this._materializedSlots.has(key)) {
        // Unmaterialized — use CST text as proxy without materializing
        const cstChild = this._cstNode?.childForFieldName(key);
        parts += cstChild ? "cst:" + cstChild.endIndex + ":" + cstChild.startIndex : "null";
        continue;
      }
      const slot = this.childSlots.get(key);
      if (Array.isArray(slot)) {
        parts += "[" + slot.map((c) => c.contentHash).join(",") + "]";
      } else if (slot) {
        parts += slot.contentHash;
      } else {
        parts += "null";
      }
    }
    return fnv1a(parts);
  }

  protected computeStructuralHash(): number {
    let parts = this["@type"];
    for (const key of this._slotNames) {
      parts += ":" + key + "=";
      if (!this._materializedSlots.has(key)) {
        // Unmaterialized — use CST type as proxy without materializing
        const cstChild = this._cstNode?.childForFieldName(key);
        parts += cstChild ? "cst:" + cstChild.type : "null";
        continue;
      }
      const slot = this.childSlots.get(key);
      if (Array.isArray(slot)) {
        parts += "[" + slot.map((c) => c.structuralHash).join(",") + "]";
      } else if (slot) {
        parts += slot.structuralHash;
      } else {
        parts += "null";
      }
    }
    return fnv1a(parts);
  }

  /** Invalidate cached hashes (call after reconciliation). */
  protected invalidateHash(): void {
    this._contentHash = null;
    this._structuralHash = null;
  }

  // ── Ancestry & Path ──────────────────────────────────────────────────

  /** Walk up the tree to find the nearest ancestor passing a predicate. */
  closestAncestor<T extends SyntaxNode>(predicate: (n: SyntaxNode) => n is T): T | null {
    let curr = this.parent;
    while (curr) {
      if (predicate(curr)) return curr;
      curr = curr.parent;
    }
    return null;
  }

  /** Get the full path from root to this node. */
  get path(): SyntaxNode[] {
    const res: SyntaxNode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let curr: SyntaxNode | null = this;
    while (curr) {
      res.unshift(curr);
      curr = curr.parent;
    }
    return res;
  }

  /** Distance from root (0-indexed). */
  get depth(): number {
    let d = 0;
    let curr = this.parent;
    while (curr) {
      d++;
      curr = curr.parent;
    }
    return d;
  }

  // ── Sibling Navigation ────────────────────────────────────────────────

  /**
   * Index within the parent's child array.
   * Returns -1 if the node has no parent or is in a singular slot.
   */
  get childIndex(): number {
    const p = this.parent;
    if (!p || !this.parentSlot) return -1;
    const slot = p.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot.indexOf(this);
    return -1;
  }

  /** Previous sibling in the same slot array. */
  get previousSibling(): SyntaxNode | null {
    const idx = this.childIndex;
    if (idx <= 0 || !this.parent || !this.parentSlot) return null;
    const slot = this.parent.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot[idx - 1] ?? null;
    return null;
  }

  /** Next sibling in the same slot array. */
  get nextSibling(): SyntaxNode | null {
    const idx = this.childIndex;
    if (idx < 0 || !this.parent || !this.parentSlot) return null;
    const slot = this.parent.childSlots.get(this.parentSlot);
    if (Array.isArray(slot)) return slot[idx + 1] ?? null;
    return null;
  }

  // ── Diffing ──────────────────────────────────────────────────────────

  /**
   * Compare this node to its alternate (previous version).
   * Returns an array of slot names whose content hashes changed.
   */
  diffFromAlternate(): string[] {
    if (!this.alternate) return Array.from(this._slotNames);
    const changed: string[] = [];
    for (const key of this._slotNames) {
      if (!this._materializedSlots.has(key)) continue;
      const slot = this.childSlots.get(key) ?? null;
      const oldSlot = this.alternate.childSlots.get(key) ?? null;
      const newHash = this.slotContentHash(slot);
      const oldHash = this.alternate.slotContentHash(oldSlot);
      if (newHash !== oldHash) changed.push(key);
    }
    return changed;
  }

  private slotContentHash(slot: SyntaxNode | SyntaxNode[] | null): string {
    if (Array.isArray(slot)) return "[" + slot.map((c) => c.contentHash).join(",") + "]";
    if (slot) return slot.contentHash;
    return "null";
  }

  // ── Tree Traversal ───────────────────────────────────────────────────

  /** Yields all direct children across all materialized slots. */
  *allChildren(): IterableIterator<SyntaxNode> {
    for (const slot of this.childSlots.values()) {
      if (Array.isArray(slot)) {
        for (const child of slot) yield child;
      } else if (slot) {
        yield slot;
      }
    }
  }

  /** Depth-first traversal of all descendants (only materialized). */
  *descendants(): IterableIterator<SyntaxNode> {
    for (const child of this.allChildren()) {
      yield child;
      yield* child.descendants();
    }
  }

  /** Depth-first traversal, filtering by a type guard. */
  *descendantsOfType<T extends SyntaxNode>(guard: (n: SyntaxNode) => n is T): IterableIterator<T> {
    for (const child of this.descendants()) {
      if (guard(child)) yield child;
    }
  }

  // ── Reconciliation ──────────────────────────────────────────────────

  get reconciliationKey(): string {
    return this["@type"];
  }

  markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.parent?.markDirty();
  }

  updateSourceRange(cstNode: TSNode): void {
    this.sourceRange = sourceRangeFrom(cstNode);
  }

  /**
   * Update the backing CST reference (used during lazy reconciliation
   * to swap the new CST in without materializing children).
   */
  updateCST(cstNode: TSNode): void {
    this._cstNode = cstNode;
    this.sourceRange = sourceRangeFrom(cstNode);
  }

  /**
   * Reconcile this node with a new CST.  Only recurses into
   * **materialized** child slots — unmaterialized "ghost" subtrees
   * simply get their CST reference updated and their lazy cache
   * invalidated, giving O(1) cost for unaccessed function bodies.
   */
  reconcileChildren(newCST: TSNode, collector?: ChangeCollector): void {
    this._cstNode = newCST;

    for (const fieldName of this._slotNames) {
      if (!this._materializedSlots.has(fieldName)) {
        // Unmaterialized ghost — just drop any stale cache.
        // The next lazy getter call will use the new _cstNode.
        continue;
      }

      const oldSlot = this.childSlots.get(fieldName) ?? null;

      if (Array.isArray(oldSlot)) {
        const newCSTChildren = newCST.childrenForFieldName(fieldName);
        const resolvedChildren =
          newCSTChildren.length > 0
            ? newCSTChildren
            : newCST.namedChildren.filter((c) => NODE_FACTORIES[c.type] !== undefined);
        this.childSlots.set(fieldName, reconcileArray(oldSlot, resolvedChildren, this, fieldName, collector));
      } else if (oldSlot instanceof SyntaxNode) {
        const newCSTChild = newCST.childForFieldName(fieldName);
        if (!newCSTChild) {
          this.childSlots.set(fieldName, null);
          collector?.removed(oldSlot, fieldName, this);
          continue;
        }
        if (!newCSTChild.hasChanges) {
          oldSlot.updateSourceRange(newCSTChild);
          oldSlot.updateCST(newCSTChild);
          collector?.reused(oldSlot, fieldName, this);
          continue;
        }
        const newChild = createNode(newCSTChild);
        if (newChild) {
          newChild.alternate = oldSlot;
          newChild.setParent(this);
          this.childSlots.set(fieldName, newChild);
          collector?.modified(newChild, oldSlot, fieldName, this);
        }
      } else {
        const newCSTChild = newCST.childForFieldName(fieldName);
        if (newCSTChild) {
          const newChild = createNode(newCSTChild);
          if (newChild) {
            newChild.setParent(this);
            this.childSlots.set(fieldName, newChild);
            collector?.added(newChild, fieldName, this);
          }
        }
      }
    }
    this.sourceRange = sourceRangeFrom(newCST);
    this.dirty = false;
    this.version = nextVersion();
    this.invalidateHash();
  }

  // ── Serialization ───────────────────────────────────────────────────

  /** Serialize this node to a plain JSON object matching its I-prefixed interface. */
  toJSON(): ISyntaxNode {
    const json: Record<string, any> = {
      "@type": this["@type"],
      nodeId: this.nodeId,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
    for (const [key, slot] of this.childSlots) {
      if (Array.isArray(slot)) {
        json[key] = slot.map((c) => c.toJSON());
      } else if (slot) {
        json[key] = slot.toJSON();
      } else {
        json[key] = null;
      }
    }
    return json as ISyntaxNode;
  }

  constructor(sourceRange: SourceRange | null, nodeId?: number, cstNode?: TSNode | null) {
    this.nodeId = nodeId ?? nextNodeId();
    this.sourceRange = sourceRange;
    this.version = nextVersion();
    this._cstNode = cstNode ?? null;
  }
}

// ─── Keyed Array Reconciliation ──────────────────────────────────────────────

function reconcileArray(
  oldChildren: SyntaxNode[],
  newCSTChildren: TSNode[],
  parent: SyntaxNode,
  slotName?: string,
  collector?: ChangeCollector,
): SyntaxNode[] {
  const oldByKey = new Map<string, SyntaxNode>();
  for (const old of oldChildren) oldByKey.set(old.reconciliationKey, old);

  // Track which old keys were matched, so we can emit "removed" for unmatched ones
  const matchedKeys = new Set<string>();

  const result = newCSTChildren.map((cstChild, index) => {
    const key = computeReconciliationKey(cstChild, index);
    const old = oldByKey.get(key);
    if (old && !cstChild.hasChanges) {
      matchedKeys.add(key);
      old.updateSourceRange(cstChild);
      old.setParent(parent);
      collector?.reused(old, slotName, parent);
      return old;
    }
    if (old && cstChild.hasChanges) {
      matchedKeys.add(key);
      old.markDirty();
      old.reconcileChildren(cstChild, collector);
      old.setParent(parent);
      collector?.modified(old, old.alternate ?? old, slotName, parent);
      return old;
    }
    const newNode = createNode(cstChild);
    if (newNode) {
      newNode.setParent(parent);
      collector?.added(newNode, slotName, parent);
      return newNode;
    }
    throw new Error(`Cannot create AST node for CST type: ${cstChild.type}`);
  });

  // Emit "removed" for old children whose keys were not matched
  for (const [key, old] of oldByKey) {
    if (!matchedKeys.has(key)) {
      collector?.removed(old, slotName, parent);
    }
  }

  return result;
}

function computeReconciliationKey(cstNode: TSNode, positionalIndex: number): string {
  const nameChild = cstNode.childForFieldName("name");
  if (nameChild) return `${cstNode.type}:${nameChild.text}`;
  return `${cstNode.type}#${positionalIndex}`;
}

// ─── Union Types (from hidden rules) ────────────────────────────────────────

/** Union type from hidden rule `_ClassSpecifier`. */
export type ClassSpecifier = LongClassSpecifier | ShortClassSpecifier | DerClassSpecifier;
export type IClassSpecifier = ILongClassSpecifier | IShortClassSpecifier | IDerClassSpecifier;

/** Union type from hidden rule `_Element`. */
export type Element = ClassDefinition | ComponentClause | ExtendsClause | ImportClause | ElementAnnotation;
export type IElement = IClassDefinition | IComponentClause | IExtendsClause | IImportClause | IElementAnnotation;

/** Union type from hidden rule `_ImportClause`. */
export type ImportClause = SimpleImportClause | CompoundImportClause | UnqualifiedImportClause;
export type IImportClause = ISimpleImportClause | ICompoundImportClause | IUnqualifiedImportClause;

/** Union type from hidden rule `_ModificationArgument`. */
export type ModificationArgument = ElementModification | ElementRedeclaration;
export type IModificationArgument = IElementModification | IElementRedeclaration;

/** Union type from hidden rule `_Equation`. */
export type Equation = SimpleEquation | SpecialEquation | IfEquation | ForEquation | ConnectEquation | WhenEquation;
export type IEquation =
  | ISimpleEquation
  | ISpecialEquation
  | IIfEquation
  | IForEquation
  | IConnectEquation
  | IWhenEquation;

/** Union type from hidden rule `_Statement`. */
export type Statement =
  | SimpleAssignmentStatement
  | ProcedureCallStatement
  | ComplexAssignmentStatement
  | BreakStatement
  | ReturnStatement
  | IfStatement
  | ForStatement
  | WhileStatement
  | WhenStatement;
export type IStatement =
  | ISimpleAssignmentStatement
  | IProcedureCallStatement
  | IComplexAssignmentStatement
  | IBreakStatement
  | IReturnStatement
  | IIfStatement
  | IForStatement
  | IWhileStatement
  | IWhenStatement;

/** Union type from hidden rule `_Expression`. */
export type Expression = IfElseExpression | RangeExpression | SimpleExpression;
export type IExpression = IIfElseExpression | IRangeExpression | ISimpleExpression;

/** Union type from hidden rule `_SimpleExpression`. */
export type SimpleExpression = UnaryExpression | BinaryExpression | PrimaryExpression;
export type ISimpleExpression = IUnaryExpression | IBinaryExpression | IPrimaryExpression;

/** Union type from hidden rule `_PrimaryExpression`. */
export type PrimaryExpression =
  | Literal
  | FunctionCall
  | ComponentReference
  | MemberAccessExpression
  | OutputExpressionList
  | ArrayConcatenation
  | ArrayConstructor
  | EndExpression;
export type IPrimaryExpression =
  | ILiteral
  | IFunctionCall
  | IComponentReference
  | IMemberAccessExpression
  | IOutputExpressionList
  | IArrayConcatenation
  | IArrayConstructor
  | IEndExpression;

/** Union type from hidden rule `_Literal`. */
export type Literal = UNSIGNEDINTEGER | UNSIGNEDREAL | BOOLEAN | STRING;
export type ILiteral = IUNSIGNEDINTEGER | IUNSIGNEDREAL | IBOOLEAN | ISTRING;

// ─── Concrete Node Interfaces & Classes ──────────────────────────────────────

export interface IStoredDefinition extends ISyntaxNode {
  readonly "@type": "StoredDefinition";
  readonly withinDirective: IWithinDirective | null;
  readonly classDefinitions: IClassDefinition[];
  readonly componentClauses: IComponentClause[];
  readonly statements: IStatement[];
  readonly bOM: IBOM | null;
}

export class StoredDefinition extends SyntaxNode implements IStoredDefinition {
  readonly "@type" = "StoredDefinition" as const;

  /** Field: `withinDirective` */
  get withinDirective(): WithinDirective | null {
    return this.lazyChild<WithinDirective>("withinDirective", () => {
      const c = this._cstNode?.childForFieldName("withinDirective") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("withinDirective")
        ? (this.alternate.getChild("withinDirective") as WithinDirective | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as WithinDirective | null;
    });
  }

  /** Field: `classDefinition` */
  get classDefinitions(): ClassDefinition[] {
    return this.lazyChildren<ClassDefinition>("classDefinition", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("classDefinition") ?? [];
      const oldChildren = this.alternate?.isMaterialized("classDefinition")
        ? (this.alternate.getChildren("classDefinition") as ClassDefinition[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "classDefinition") as ClassDefinition[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ClassDefinition[];
    });
  }

  /** Field: `componentClause` */
  get componentClauses(): ComponentClause[] {
    return this.lazyChildren<ComponentClause>("componentClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("componentClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("componentClause")
        ? (this.alternate.getChildren("componentClause") as ComponentClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "componentClause") as ComponentClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ComponentClause[];
    });
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Child: `BOM` */
  get bOM(): BOM | null {
    return this.lazyChild<BOM>("BOM", () => {
      const c = (this._cstNode?.namedChildren ?? []).find((c) => c.type === "BOM") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("BOM") ? (this.alternate.getChild("BOM") as BOM | null) : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as BOM | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IStoredDefinition | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("withinDirective");
    this._slotNames.add("classDefinition");
    this._slotNames.add("componentClause");
    this._slotNames.add("statement");
    this._slotNames.add("BOM");
    if (astNode) {
      this.setChild(
        "withinDirective",
        astNode.withinDirective ? createNodeFromJSON(astNode.withinDirective as any) : null,
      );
      this.setChildren(
        "classDefinition",
        (astNode.classDefinitions ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChildren(
        "componentClause",
        (astNode.componentClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("BOM", astNode.bOM ? createNodeFromJSON(astNode.bOM as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IStoredDefinition {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      withinDirective: (this.withinDirective?.toJSON() as any) ?? null,
      classDefinitions: this.classDefinitions.map((c) => c.toJSON()) as any,
      componentClauses: this.componentClauses.map((c) => c.toJSON()) as any,
      statements: this.statements.map((c) => c.toJSON()) as any,
      bOM: (this.bOM?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStoredDefinition(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IStoredDefinition | null): StoredDefinition | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "StoredDefinition") return new StoredDefinition(cstNode, astNode);
    return null;
  }
}

export interface IWithinDirective extends ISyntaxNode {
  readonly "@type": "WithinDirective";
  readonly packageName: IName | null;
}

export class WithinDirective extends SyntaxNode implements IWithinDirective {
  readonly "@type" = "WithinDirective" as const;

  /** Field: `packageName` */
  get packageName(): Name | null {
    return this.lazyChild<Name>("packageName", () => {
      const c = this._cstNode?.childForFieldName("packageName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("packageName")
        ? (this.alternate.getChild("packageName") as Name | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IWithinDirective | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("packageName");
    if (astNode) {
      this.setChild("packageName", astNode.packageName ? createNodeFromJSON(astNode.packageName as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IWithinDirective {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      packageName: (this.packageName?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWithinDirective(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IWithinDirective | null): WithinDirective | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "WithinDirective") return new WithinDirective(cstNode, astNode);
    return null;
  }
}

export interface IClassDefinition extends ISyntaxNode {
  readonly "@type": "ClassDefinition";
  readonly redeclare: ISyntaxNode | null;
  readonly final: ISyntaxNode | null;
  readonly inner: ISyntaxNode | null;
  readonly outer: ISyntaxNode | null;
  readonly replaceable: ISyntaxNode | null;
  readonly encapsulated: ISyntaxNode | null;
  readonly classPrefixes: IClassPrefixes;
  readonly classSpecifier: IClassSpecifier;
  readonly constrainingClause: IConstrainingClause | null;
}

export class ClassDefinition extends SyntaxNode implements IClassDefinition {
  readonly "@type" = "ClassDefinition" as const;

  /** Field: `redeclare` */
  get redeclare(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("redeclare", () => {
      const c = this._cstNode?.childForFieldName("redeclare") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("redeclare")
        ? (this.alternate.getChild("redeclare") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `final` */
  get final(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("final", () => {
      const c = this._cstNode?.childForFieldName("final") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("final")
        ? (this.alternate.getChild("final") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `inner` */
  get inner(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("inner", () => {
      const c = this._cstNode?.childForFieldName("inner") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("inner")
        ? (this.alternate.getChild("inner") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `outer` */
  get outer(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("outer", () => {
      const c = this._cstNode?.childForFieldName("outer") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("outer")
        ? (this.alternate.getChild("outer") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `replaceable` */
  get replaceable(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("replaceable", () => {
      const c = this._cstNode?.childForFieldName("replaceable") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("replaceable")
        ? (this.alternate.getChild("replaceable") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `encapsulated` */
  get encapsulated(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("encapsulated", () => {
      const c = this._cstNode?.childForFieldName("encapsulated") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("encapsulated")
        ? (this.alternate.getChild("encapsulated") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `classPrefixes` */
  get classPrefixes(): ClassPrefixes {
    return this.lazyChild<ClassPrefixes>("classPrefixes", () => {
      const c = this._cstNode?.childForFieldName("classPrefixes") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classPrefixes")
        ? (this.alternate.getChild("classPrefixes") as ClassPrefixes | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassPrefixes | null;
    })!;
  }

  /** Field: `classSpecifier` */
  get classSpecifier(): ClassSpecifier {
    return this.lazyChild<ClassSpecifier>("classSpecifier", () => {
      const c = this._cstNode?.childForFieldName("classSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classSpecifier")
        ? (this.alternate.getChild("classSpecifier") as ClassSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassSpecifier | null;
    })!;
  }

  /** Field: `constrainingClause` */
  get constrainingClause(): ConstrainingClause | null {
    return this.lazyChild<ConstrainingClause>("constrainingClause", () => {
      const c = this._cstNode?.childForFieldName("constrainingClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("constrainingClause")
        ? (this.alternate.getChild("constrainingClause") as ConstrainingClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConstrainingClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IClassDefinition | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("redeclare");
    this._slotNames.add("final");
    this._slotNames.add("inner");
    this._slotNames.add("outer");
    this._slotNames.add("replaceable");
    this._slotNames.add("encapsulated");
    this._slotNames.add("classPrefixes");
    this._slotNames.add("classSpecifier");
    this._slotNames.add("constrainingClause");
    if (astNode) {
      this.setChild("redeclare", astNode.redeclare ? createNodeFromJSON(astNode.redeclare as any) : null);
      this.setChild("final", astNode.final ? createNodeFromJSON(astNode.final as any) : null);
      this.setChild("inner", astNode.inner ? createNodeFromJSON(astNode.inner as any) : null);
      this.setChild("outer", astNode.outer ? createNodeFromJSON(astNode.outer as any) : null);
      this.setChild("replaceable", astNode.replaceable ? createNodeFromJSON(astNode.replaceable as any) : null);
      this.setChild("encapsulated", astNode.encapsulated ? createNodeFromJSON(astNode.encapsulated as any) : null);
      this.setChild("classPrefixes", astNode.classPrefixes ? createNodeFromJSON(astNode.classPrefixes as any) : null);
      this.setChild(
        "classSpecifier",
        astNode.classSpecifier ? createNodeFromJSON(astNode.classSpecifier as any) : null,
      );
      this.setChild(
        "constrainingClause",
        astNode.constrainingClause ? createNodeFromJSON(astNode.constrainingClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IClassDefinition {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      redeclare: (this.redeclare?.toJSON() as any) ?? null,
      final: (this.final?.toJSON() as any) ?? null,
      inner: (this.inner?.toJSON() as any) ?? null,
      outer: (this.outer?.toJSON() as any) ?? null,
      replaceable: (this.replaceable?.toJSON() as any) ?? null,
      encapsulated: (this.encapsulated?.toJSON() as any) ?? null,
      classPrefixes: (this.classPrefixes?.toJSON() as any) ?? null,
      classSpecifier: (this.classSpecifier?.toJSON() as any) ?? null,
      constrainingClause: (this.constrainingClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassDefinition(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IClassDefinition | null): ClassDefinition | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ClassDefinition") return new ClassDefinition(cstNode, astNode);
    return null;
  }
}

export interface IClassPrefixes extends ISyntaxNode {
  readonly "@type": "ClassPrefixes";
  readonly partial: ISyntaxNode | null;
  readonly class: ISyntaxNode;
  readonly model: ISyntaxNode;
  readonly operator: ISyntaxNode | null;
  readonly record: ISyntaxNode;
  readonly block: ISyntaxNode;
  readonly expandable: ISyntaxNode | null;
  readonly connector: ISyntaxNode;
  readonly type: ISyntaxNode;
  readonly package: ISyntaxNode;
  readonly purity: ISyntaxNode | null;
  readonly function: ISyntaxNode;
  readonly optimization: ISyntaxNode;
  readonly shape: ISyntaxNode;
}

export class ClassPrefixes extends SyntaxNode implements IClassPrefixes {
  readonly "@type" = "ClassPrefixes" as const;

  /** Field: `partial` */
  get partial(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("partial", () => {
      const c = this._cstNode?.childForFieldName("partial") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("partial")
        ? (this.alternate.getChild("partial") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `class` */
  get class(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("class", () => {
      const c = this._cstNode?.childForFieldName("class") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("class")
        ? (this.alternate.getChild("class") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `model` */
  get model(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("model", () => {
      const c = this._cstNode?.childForFieldName("model") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("model")
        ? (this.alternate.getChild("model") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `operator` */
  get operator(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("operator", () => {
      const c = this._cstNode?.childForFieldName("operator") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operator")
        ? (this.alternate.getChild("operator") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `record` */
  get record(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("record", () => {
      const c = this._cstNode?.childForFieldName("record") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("record")
        ? (this.alternate.getChild("record") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `block` */
  get block(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("block", () => {
      const c = this._cstNode?.childForFieldName("block") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("block")
        ? (this.alternate.getChild("block") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `expandable` */
  get expandable(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("expandable", () => {
      const c = this._cstNode?.childForFieldName("expandable") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expandable")
        ? (this.alternate.getChild("expandable") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `connector` */
  get connector(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("connector", () => {
      const c = this._cstNode?.childForFieldName("connector") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("connector")
        ? (this.alternate.getChild("connector") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `type` */
  get type(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("type", () => {
      const c = this._cstNode?.childForFieldName("type") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("type")
        ? (this.alternate.getChild("type") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `package` */
  get package(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("package", () => {
      const c = this._cstNode?.childForFieldName("package") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("package")
        ? (this.alternate.getChild("package") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `purity` */
  get purity(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("purity", () => {
      const c = this._cstNode?.childForFieldName("purity") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("purity")
        ? (this.alternate.getChild("purity") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `function` */
  get function(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("function", () => {
      const c = this._cstNode?.childForFieldName("function") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("function")
        ? (this.alternate.getChild("function") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `optimization` */
  get optimization(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("optimization", () => {
      const c = this._cstNode?.childForFieldName("optimization") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("optimization")
        ? (this.alternate.getChild("optimization") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `shape` */
  get shape(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("shape", () => {
      const c = this._cstNode?.childForFieldName("shape") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("shape")
        ? (this.alternate.getChild("shape") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IClassPrefixes | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("partial");
    this._slotNames.add("class");
    this._slotNames.add("model");
    this._slotNames.add("operator");
    this._slotNames.add("record");
    this._slotNames.add("block");
    this._slotNames.add("expandable");
    this._slotNames.add("connector");
    this._slotNames.add("type");
    this._slotNames.add("package");
    this._slotNames.add("purity");
    this._slotNames.add("function");
    this._slotNames.add("optimization");
    this._slotNames.add("shape");
    if (astNode) {
      this.setChild("partial", astNode.partial ? createNodeFromJSON(astNode.partial as any) : null);
      this.setChild("class", astNode.class ? createNodeFromJSON(astNode.class as any) : null);
      this.setChild("model", astNode.model ? createNodeFromJSON(astNode.model as any) : null);
      this.setChild("operator", astNode.operator ? createNodeFromJSON(astNode.operator as any) : null);
      this.setChild("record", astNode.record ? createNodeFromJSON(astNode.record as any) : null);
      this.setChild("block", astNode.block ? createNodeFromJSON(astNode.block as any) : null);
      this.setChild("expandable", astNode.expandable ? createNodeFromJSON(astNode.expandable as any) : null);
      this.setChild("connector", astNode.connector ? createNodeFromJSON(astNode.connector as any) : null);
      this.setChild("type", astNode.type ? createNodeFromJSON(astNode.type as any) : null);
      this.setChild("package", astNode.package ? createNodeFromJSON(astNode.package as any) : null);
      this.setChild("purity", astNode.purity ? createNodeFromJSON(astNode.purity as any) : null);
      this.setChild("function", astNode.function ? createNodeFromJSON(astNode.function as any) : null);
      this.setChild("optimization", astNode.optimization ? createNodeFromJSON(astNode.optimization as any) : null);
      this.setChild("shape", astNode.shape ? createNodeFromJSON(astNode.shape as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IClassPrefixes {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      partial: (this.partial?.toJSON() as any) ?? null,
      class: (this.class?.toJSON() as any) ?? null,
      model: (this.model?.toJSON() as any) ?? null,
      operator: (this.operator?.toJSON() as any) ?? null,
      record: (this.record?.toJSON() as any) ?? null,
      block: (this.block?.toJSON() as any) ?? null,
      expandable: (this.expandable?.toJSON() as any) ?? null,
      connector: (this.connector?.toJSON() as any) ?? null,
      type: (this.type?.toJSON() as any) ?? null,
      package: (this.package?.toJSON() as any) ?? null,
      purity: (this.purity?.toJSON() as any) ?? null,
      function: (this.function?.toJSON() as any) ?? null,
      optimization: (this.optimization?.toJSON() as any) ?? null,
      shape: (this.shape?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassPrefixes(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IClassPrefixes | null): ClassPrefixes | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ClassPrefixes") return new ClassPrefixes(cstNode, astNode);
    return null;
  }
}

export interface ILongClassSpecifier extends ISyntaxNode {
  readonly "@type": "LongClassSpecifier";
  readonly extends: ISyntaxNode | null;
  readonly identifier: IIDENT;
  readonly classModification: IClassModification | null;
  readonly description: IDescription | null;
  readonly sections: (
    | IInitialElementSection
    | IElementSection
    | IEquationSection
    | IAlgorithmSection
    | IConstraintSection
  )[];
  readonly externalFunctionClause: IExternalFunctionClause | null;
  readonly annotationClause: IAnnotationClause | null;
  readonly endIdentifier: IIDENT;
}

export class LongClassSpecifier extends SyntaxNode implements ILongClassSpecifier {
  readonly "@type" = "LongClassSpecifier" as const;

  /** Field: `extends` */
  get extends(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("extends", () => {
      const c = this._cstNode?.childForFieldName("extends") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("extends")
        ? (this.alternate.getChild("extends") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `classModification` */
  get classModification(): ClassModification | null {
    return this.lazyChild<ClassModification>("classModification", () => {
      const c = this._cstNode?.childForFieldName("classModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classModification")
        ? (this.alternate.getChild("classModification") as ClassModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassModification | null;
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `section` */
  get sections(): (InitialElementSection | ElementSection | EquationSection | AlgorithmSection | ConstraintSection)[] {
    return this.lazyChildren<
      InitialElementSection | ElementSection | EquationSection | AlgorithmSection | ConstraintSection
    >("section", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("section") ?? [];
      const oldChildren = this.alternate?.isMaterialized("section")
        ? (this.alternate.getChildren("section") as (
            | InitialElementSection
            | ElementSection
            | EquationSection
            | AlgorithmSection
            | ConstraintSection
          )[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "section") as (
          | InitialElementSection
          | ElementSection
          | EquationSection
          | AlgorithmSection
          | ConstraintSection
        )[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as (
        | InitialElementSection
        | ElementSection
        | EquationSection
        | AlgorithmSection
        | ConstraintSection
      )[];
    });
  }

  /** Field: `externalFunctionClause` */
  get externalFunctionClause(): ExternalFunctionClause | null {
    return this.lazyChild<ExternalFunctionClause>("externalFunctionClause", () => {
      const c = this._cstNode?.childForFieldName("externalFunctionClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("externalFunctionClause")
        ? (this.alternate.getChild("externalFunctionClause") as ExternalFunctionClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ExternalFunctionClause | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  /** Field: `endIdentifier` */
  get endIdentifier(): IDENT {
    return this.lazyChild<IDENT>("endIdentifier", () => {
      const c = this._cstNode?.childForFieldName("endIdentifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("endIdentifier")
        ? (this.alternate.getChild("endIdentifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: ILongClassSpecifier | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("extends");
    this._slotNames.add("identifier");
    this._slotNames.add("classModification");
    this._slotNames.add("description");
    this._slotNames.add("section");
    this._slotNames.add("externalFunctionClause");
    this._slotNames.add("annotationClause");
    this._slotNames.add("endIdentifier");
    if (astNode) {
      this.setChild("extends", astNode.extends ? createNodeFromJSON(astNode.extends as any) : null);
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild(
        "classModification",
        astNode.classModification ? createNodeFromJSON(astNode.classModification as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChildren("section", (astNode.sections ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild(
        "externalFunctionClause",
        astNode.externalFunctionClause ? createNodeFromJSON(astNode.externalFunctionClause as any) : null,
      );
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
      this.setChild("endIdentifier", astNode.endIdentifier ? createNodeFromJSON(astNode.endIdentifier as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ILongClassSpecifier {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      extends: (this.extends?.toJSON() as any) ?? null,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      classModification: (this.classModification?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      sections: this.sections.map((c) => c.toJSON()) as any,
      externalFunctionClause: (this.externalFunctionClause?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
      endIdentifier: (this.endIdentifier?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLongClassSpecifier(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ILongClassSpecifier | null): LongClassSpecifier | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "LongClassSpecifier") return new LongClassSpecifier(cstNode, astNode);
    return null;
  }
}

export interface IShortClassSpecifier extends ISyntaxNode {
  readonly "@type": "ShortClassSpecifier";
  readonly identifier: IIDENT;
  readonly causality: ISyntaxNode | null;
  readonly typeSpecifier: ITypeSpecifier;
  readonly arraySubscripts: IArraySubscripts | null;
  readonly classModification: IClassModification | null;
  readonly enumeration: ISyntaxNode;
  readonly enumerationLiterals: IEnumerationLiteral[];
  readonly unspecifiedEnumeration: ISyntaxNode | null;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ShortClassSpecifier extends SyntaxNode implements IShortClassSpecifier {
  readonly "@type" = "ShortClassSpecifier" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `causality` */
  get causality(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("causality", () => {
      const c = this._cstNode?.childForFieldName("causality") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("causality")
        ? (this.alternate.getChild("causality") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `arraySubscripts` */
  get arraySubscripts(): ArraySubscripts | null {
    return this.lazyChild<ArraySubscripts>("arraySubscripts", () => {
      const c = this._cstNode?.childForFieldName("arraySubscripts") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arraySubscripts")
        ? (this.alternate.getChild("arraySubscripts") as ArraySubscripts | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ArraySubscripts | null;
    });
  }

  /** Field: `classModification` */
  get classModification(): ClassModification | null {
    return this.lazyChild<ClassModification>("classModification", () => {
      const c = this._cstNode?.childForFieldName("classModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classModification")
        ? (this.alternate.getChild("classModification") as ClassModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassModification | null;
    });
  }

  /** Field: `enumeration` */
  get enumeration(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("enumeration", () => {
      const c = this._cstNode?.childForFieldName("enumeration") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("enumeration")
        ? (this.alternate.getChild("enumeration") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `enumerationLiteral` */
  get enumerationLiterals(): EnumerationLiteral[] {
    return this.lazyChildren<EnumerationLiteral>("enumerationLiteral", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("enumerationLiteral") ?? [];
      const oldChildren = this.alternate?.isMaterialized("enumerationLiteral")
        ? (this.alternate.getChildren("enumerationLiteral") as EnumerationLiteral[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "enumerationLiteral") as EnumerationLiteral[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as EnumerationLiteral[];
    });
  }

  /** Field: `unspecifiedEnumeration` */
  get unspecifiedEnumeration(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("unspecifiedEnumeration", () => {
      const c = this._cstNode?.childForFieldName("unspecifiedEnumeration") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("unspecifiedEnumeration")
        ? (this.alternate.getChild("unspecifiedEnumeration") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IShortClassSpecifier | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("causality");
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("arraySubscripts");
    this._slotNames.add("classModification");
    this._slotNames.add("enumeration");
    this._slotNames.add("enumerationLiteral");
    this._slotNames.add("unspecifiedEnumeration");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild("causality", astNode.causality ? createNodeFromJSON(astNode.causality as any) : null);
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChild(
        "arraySubscripts",
        astNode.arraySubscripts ? createNodeFromJSON(astNode.arraySubscripts as any) : null,
      );
      this.setChild(
        "classModification",
        astNode.classModification ? createNodeFromJSON(astNode.classModification as any) : null,
      );
      this.setChild("enumeration", astNode.enumeration ? createNodeFromJSON(astNode.enumeration as any) : null);
      this.setChildren(
        "enumerationLiteral",
        (astNode.enumerationLiterals ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild(
        "unspecifiedEnumeration",
        astNode.unspecifiedEnumeration ? createNodeFromJSON(astNode.unspecifiedEnumeration as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IShortClassSpecifier {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      causality: (this.causality?.toJSON() as any) ?? null,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      arraySubscripts: (this.arraySubscripts?.toJSON() as any) ?? null,
      classModification: (this.classModification?.toJSON() as any) ?? null,
      enumeration: (this.enumeration?.toJSON() as any) ?? null,
      enumerationLiterals: this.enumerationLiterals.map((c) => c.toJSON()) as any,
      unspecifiedEnumeration: (this.unspecifiedEnumeration?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassSpecifier(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IShortClassSpecifier | null): ShortClassSpecifier | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ShortClassSpecifier") return new ShortClassSpecifier(cstNode, astNode);
    return null;
  }
}

export interface IDerClassSpecifier extends ISyntaxNode {
  readonly "@type": "DerClassSpecifier";
  readonly identifier: IIDENT;
  readonly typeSpecifier: ITypeSpecifier;
  readonly inputs: IIDENT[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class DerClassSpecifier extends SyntaxNode implements IDerClassSpecifier {
  readonly "@type" = "DerClassSpecifier" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `input` */
  get inputs(): IDENT[] {
    return this.lazyChildren<IDENT>("input", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("input") ?? [];
      const oldChildren = this.alternate?.isMaterialized("input")
        ? (this.alternate.getChildren("input") as IDENT[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "input") as IDENT[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as IDENT[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IDerClassSpecifier | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("input");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChildren("input", (astNode.inputs ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IDerClassSpecifier {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      inputs: this.inputs.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDerClassSpecifier(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IDerClassSpecifier | null): DerClassSpecifier | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "DerClassSpecifier") return new DerClassSpecifier(cstNode, astNode);
    return null;
  }
}

export interface IEnumerationLiteral extends ISyntaxNode {
  readonly "@type": "EnumerationLiteral";
  readonly identifier: IIDENT;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class EnumerationLiteral extends SyntaxNode implements IEnumerationLiteral {
  readonly "@type" = "EnumerationLiteral" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IEnumerationLiteral | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IEnumerationLiteral {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationLiteral(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IEnumerationLiteral | null): EnumerationLiteral | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "EnumerationLiteral") return new EnumerationLiteral(cstNode, astNode);
    return null;
  }
}

export interface IExternalFunctionClause extends ISyntaxNode {
  readonly "@type": "ExternalFunctionClause";
  readonly languageSpecification: ILanguageSpecification | null;
  readonly externalFunctionCall: IExternalFunctionCall | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ExternalFunctionClause extends SyntaxNode implements IExternalFunctionClause {
  readonly "@type" = "ExternalFunctionClause" as const;

  /** Field: `languageSpecification` */
  get languageSpecification(): LanguageSpecification | null {
    return this.lazyChild<LanguageSpecification>("languageSpecification", () => {
      const c = this._cstNode?.childForFieldName("languageSpecification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("languageSpecification")
        ? (this.alternate.getChild("languageSpecification") as LanguageSpecification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as LanguageSpecification | null;
    });
  }

  /** Field: `externalFunctionCall` */
  get externalFunctionCall(): ExternalFunctionCall | null {
    return this.lazyChild<ExternalFunctionCall>("externalFunctionCall", () => {
      const c = this._cstNode?.childForFieldName("externalFunctionCall") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("externalFunctionCall")
        ? (this.alternate.getChild("externalFunctionCall") as ExternalFunctionCall | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ExternalFunctionCall | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IExternalFunctionClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("languageSpecification");
    this._slotNames.add("externalFunctionCall");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild(
        "languageSpecification",
        astNode.languageSpecification ? createNodeFromJSON(astNode.languageSpecification as any) : null,
      );
      this.setChild(
        "externalFunctionCall",
        astNode.externalFunctionCall ? createNodeFromJSON(astNode.externalFunctionCall as any) : null,
      );
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IExternalFunctionClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      languageSpecification: (this.languageSpecification?.toJSON() as any) ?? null,
      externalFunctionCall: (this.externalFunctionCall?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IExternalFunctionClause | null): ExternalFunctionClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ExternalFunctionClause") return new ExternalFunctionClause(cstNode, astNode);
    return null;
  }
}

export interface ILanguageSpecification extends ISyntaxNode {
  readonly "@type": "LanguageSpecification";
  readonly language: ISTRING;
}

export class LanguageSpecification extends SyntaxNode implements ILanguageSpecification {
  readonly "@type" = "LanguageSpecification" as const;

  /** Field: `language` */
  get language(): STRING {
    return this.lazyChild<STRING>("language", () => {
      const c = this._cstNode?.childForFieldName("language") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("language")
        ? (this.alternate.getChild("language") as STRING | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as STRING | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: ILanguageSpecification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("language");
    if (astNode) {
      this.setChild("language", astNode.language ? createNodeFromJSON(astNode.language as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ILanguageSpecification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      language: (this.language?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLanguageSpecification(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ILanguageSpecification | null): LanguageSpecification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "LanguageSpecification") return new LanguageSpecification(cstNode, astNode);
    return null;
  }
}

export interface IExternalFunctionCall extends ISyntaxNode {
  readonly "@type": "ExternalFunctionCall";
  readonly output: IComponentReference | null;
  readonly functionName: IIDENT;
  readonly arguments: IExpressionList | null;
}

export class ExternalFunctionCall extends SyntaxNode implements IExternalFunctionCall {
  readonly "@type" = "ExternalFunctionCall" as const;

  /** Field: `output` */
  get output(): ComponentReference | null {
    return this.lazyChild<ComponentReference>("output", () => {
      const c = this._cstNode?.childForFieldName("output") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("output")
        ? (this.alternate.getChild("output") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    });
  }

  /** Field: `functionName` */
  get functionName(): IDENT {
    return this.lazyChild<IDENT>("functionName", () => {
      const c = this._cstNode?.childForFieldName("functionName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionName")
        ? (this.alternate.getChild("functionName") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `arguments` */
  get arguments(): ExpressionList | null {
    return this.lazyChild<ExpressionList>("arguments", () => {
      const c = this._cstNode?.childForFieldName("arguments") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arguments")
        ? (this.alternate.getChild("arguments") as ExpressionList | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ExpressionList | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IExternalFunctionCall | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("output");
    this._slotNames.add("functionName");
    this._slotNames.add("arguments");
    if (astNode) {
      this.setChild("output", astNode.output ? createNodeFromJSON(astNode.output as any) : null);
      this.setChild("functionName", astNode.functionName ? createNodeFromJSON(astNode.functionName as any) : null);
      this.setChild("arguments", astNode.arguments ? createNodeFromJSON(astNode.arguments as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IExternalFunctionCall {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      output: (this.output?.toJSON() as any) ?? null,
      functionName: (this.functionName?.toJSON() as any) ?? null,
      arguments: (this.arguments?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionCall(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IExternalFunctionCall | null): ExternalFunctionCall | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ExternalFunctionCall") return new ExternalFunctionCall(cstNode, astNode);
    return null;
  }
}

export interface IInitialElementSection extends ISyntaxNode {
  readonly "@type": "InitialElementSection";
  readonly elements: IElement[];
}

export class InitialElementSection extends SyntaxNode implements IInitialElementSection {
  readonly "@type" = "InitialElementSection" as const;

  /** Field: `element` */
  get elements(): Element[] {
    return this.lazyChildren<Element>("element", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("element") ?? [];
      const oldChildren = this.alternate?.isMaterialized("element")
        ? (this.alternate.getChildren("element") as Element[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "element") as Element[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Element[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IInitialElementSection | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("element");
    if (astNode) {
      this.setChildren("element", (astNode.elements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IInitialElementSection {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      elements: this.elements.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitInitialElementSection(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IInitialElementSection | null): InitialElementSection | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "InitialElementSection") return new InitialElementSection(cstNode, astNode);
    return null;
  }
}

export interface IElementSection extends ISyntaxNode {
  readonly "@type": "ElementSection";
  readonly visibility: ISyntaxNode;
  readonly elements: IElement[];
}

export class ElementSection extends SyntaxNode implements IElementSection {
  readonly "@type" = "ElementSection" as const;

  /** Field: `visibility` */
  get visibility(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("visibility", () => {
      const c = this._cstNode?.childForFieldName("visibility") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("visibility")
        ? (this.alternate.getChild("visibility") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `element` */
  get elements(): Element[] {
    return this.lazyChildren<Element>("element", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("element") ?? [];
      const oldChildren = this.alternate?.isMaterialized("element")
        ? (this.alternate.getChildren("element") as Element[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "element") as Element[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Element[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElementSection | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("visibility");
    this._slotNames.add("element");
    if (astNode) {
      this.setChild("visibility", astNode.visibility ? createNodeFromJSON(astNode.visibility as any) : null);
      this.setChildren("element", (astNode.elements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElementSection {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      visibility: (this.visibility?.toJSON() as any) ?? null,
      elements: this.elements.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementSection(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElementSection | null): ElementSection | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElementSection") return new ElementSection(cstNode, astNode);
    return null;
  }
}

export interface IElementAnnotation extends ISyntaxNode {
  readonly "@type": "ElementAnnotation";
  readonly annotationClause: IAnnotationClause | null;
}

export class ElementAnnotation extends SyntaxNode implements IElementAnnotation {
  readonly "@type" = "ElementAnnotation" as const;

  /** Child: `AnnotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("AnnotationClause", () => {
      const c = (this._cstNode?.namedChildren ?? []).find((c) => c.type === "AnnotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("AnnotationClause")
        ? (this.alternate.getChild("AnnotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElementAnnotation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("AnnotationClause");
    if (astNode) {
      this.setChild(
        "AnnotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElementAnnotation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementAnnotation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElementAnnotation | null): ElementAnnotation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElementAnnotation") return new ElementAnnotation(cstNode, astNode);
    return null;
  }
}

export interface ISimpleImportClause extends ISyntaxNode {
  readonly "@type": "SimpleImportClause";
  readonly shortName: IIDENT | null;
  readonly packageName: IName;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class SimpleImportClause extends SyntaxNode implements ISimpleImportClause {
  readonly "@type" = "SimpleImportClause" as const;

  /** Field: `shortName` */
  get shortName(): IDENT | null {
    return this.lazyChild<IDENT>("shortName", () => {
      const c = this._cstNode?.childForFieldName("shortName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("shortName")
        ? (this.alternate.getChild("shortName") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    });
  }

  /** Field: `packageName` */
  get packageName(): Name {
    return this.lazyChild<Name>("packageName", () => {
      const c = this._cstNode?.childForFieldName("packageName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("packageName")
        ? (this.alternate.getChild("packageName") as Name | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: ISimpleImportClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("shortName");
    this._slotNames.add("packageName");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("shortName", astNode.shortName ? createNodeFromJSON(astNode.shortName as any) : null);
      this.setChild("packageName", astNode.packageName ? createNodeFromJSON(astNode.packageName as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISimpleImportClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      shortName: (this.shortName?.toJSON() as any) ?? null,
      packageName: (this.packageName?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleImportClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISimpleImportClause | null): SimpleImportClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "SimpleImportClause") return new SimpleImportClause(cstNode, astNode);
    return null;
  }
}

export interface ICompoundImportClause extends ISyntaxNode {
  readonly "@type": "CompoundImportClause";
  readonly packageName: IName;
  readonly importNames: IIDENT[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class CompoundImportClause extends SyntaxNode implements ICompoundImportClause {
  readonly "@type" = "CompoundImportClause" as const;

  /** Field: `packageName` */
  get packageName(): Name {
    return this.lazyChild<Name>("packageName", () => {
      const c = this._cstNode?.childForFieldName("packageName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("packageName")
        ? (this.alternate.getChild("packageName") as Name | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    })!;
  }

  /** Field: `importName` */
  get importNames(): IDENT[] {
    return this.lazyChildren<IDENT>("importName", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("importName") ?? [];
      const oldChildren = this.alternate?.isMaterialized("importName")
        ? (this.alternate.getChildren("importName") as IDENT[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "importName") as IDENT[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as IDENT[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: ICompoundImportClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("packageName");
    this._slotNames.add("importName");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("packageName", astNode.packageName ? createNodeFromJSON(astNode.packageName as any) : null);
      this.setChildren("importName", (astNode.importNames ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ICompoundImportClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      packageName: (this.packageName?.toJSON() as any) ?? null,
      importNames: this.importNames.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitCompoundImportClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ICompoundImportClause | null): CompoundImportClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "CompoundImportClause") return new CompoundImportClause(cstNode, astNode);
    return null;
  }
}

export interface IUnqualifiedImportClause extends ISyntaxNode {
  readonly "@type": "UnqualifiedImportClause";
  readonly packageName: IName;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class UnqualifiedImportClause extends SyntaxNode implements IUnqualifiedImportClause {
  readonly "@type" = "UnqualifiedImportClause" as const;

  /** Field: `packageName` */
  get packageName(): Name {
    return this.lazyChild<Name>("packageName", () => {
      const c = this._cstNode?.childForFieldName("packageName") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("packageName")
        ? (this.alternate.getChild("packageName") as Name | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IUnqualifiedImportClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("packageName");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("packageName", astNode.packageName ? createNodeFromJSON(astNode.packageName as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IUnqualifiedImportClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      packageName: (this.packageName?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnqualifiedImportClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IUnqualifiedImportClause | null): UnqualifiedImportClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "UnqualifiedImportClause") return new UnqualifiedImportClause(cstNode, astNode);
    return null;
  }
}

export interface IExtendsClause extends ISyntaxNode {
  readonly "@type": "ExtendsClause";
  readonly typeSpecifier: ITypeSpecifier;
  readonly classOrInheritanceModification: IClassOrInheritanceModification | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ExtendsClause extends SyntaxNode implements IExtendsClause {
  readonly "@type" = "ExtendsClause" as const;

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `classOrInheritanceModification` */
  get classOrInheritanceModification(): ClassOrInheritanceModification | null {
    return this.lazyChild<ClassOrInheritanceModification>("classOrInheritanceModification", () => {
      const c = this._cstNode?.childForFieldName("classOrInheritanceModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classOrInheritanceModification")
        ? (this.alternate.getChild("classOrInheritanceModification") as ClassOrInheritanceModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassOrInheritanceModification | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IExtendsClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("classOrInheritanceModification");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChild(
        "classOrInheritanceModification",
        astNode.classOrInheritanceModification
          ? createNodeFromJSON(astNode.classOrInheritanceModification as any)
          : null,
      );
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IExtendsClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      classOrInheritanceModification: (this.classOrInheritanceModification?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExtendsClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IExtendsClause | null): ExtendsClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ExtendsClause") return new ExtendsClause(cstNode, astNode);
    return null;
  }
}

export interface IConstrainingClause extends ISyntaxNode {
  readonly "@type": "ConstrainingClause";
  readonly typeSpecifier: ITypeSpecifier;
  readonly classModification: IClassModification | null;
  readonly description: IDescription | null;
}

export class ConstrainingClause extends SyntaxNode implements IConstrainingClause {
  readonly "@type" = "ConstrainingClause" as const;

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `classModification` */
  get classModification(): ClassModification | null {
    return this.lazyChild<ClassModification>("classModification", () => {
      const c = this._cstNode?.childForFieldName("classModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classModification")
        ? (this.alternate.getChild("classModification") as ClassModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassModification | null;
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IConstrainingClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("classModification");
    this._slotNames.add("description");
    if (astNode) {
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChild(
        "classModification",
        astNode.classModification ? createNodeFromJSON(astNode.classModification as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IConstrainingClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      classModification: (this.classModification?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConstrainingClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IConstrainingClause | null): ConstrainingClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ConstrainingClause") return new ConstrainingClause(cstNode, astNode);
    return null;
  }
}

export interface IClassOrInheritanceModification extends ISyntaxNode {
  readonly "@type": "ClassOrInheritanceModification";
  readonly modificationArgumentOrInheritanceModifications: (IModificationArgument | IInheritanceModification)[];
}

export class ClassOrInheritanceModification extends SyntaxNode implements IClassOrInheritanceModification {
  readonly "@type" = "ClassOrInheritanceModification" as const;

  /** Field: `modificationArgumentOrInheritanceModification` */
  get modificationArgumentOrInheritanceModifications(): (ModificationArgument | InheritanceModification)[] {
    return this.lazyChildren<ModificationArgument | InheritanceModification>(
      "modificationArgumentOrInheritanceModification",
      () => {
        const cstChildren = this._cstNode?.childrenForFieldName("modificationArgumentOrInheritanceModification") ?? [];
        const oldChildren = this.alternate?.isMaterialized("modificationArgumentOrInheritanceModification")
          ? (this.alternate.getChildren("modificationArgumentOrInheritanceModification") as (
              | ModificationArgument
              | InheritanceModification
            )[])
          : [];
        if (oldChildren.length > 0) {
          return reconcileArray(oldChildren, cstChildren, this, "modificationArgumentOrInheritanceModification") as (
            | ModificationArgument
            | InheritanceModification
          )[];
        }
        return cstChildren.map((c) => createNode(c)!).filter(Boolean) as (
          | ModificationArgument
          | InheritanceModification
        )[];
      },
    );
  }

  constructor(cstNode?: TSNode | null, astNode?: IClassOrInheritanceModification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("modificationArgumentOrInheritanceModification");
    if (astNode) {
      this.setChildren(
        "modificationArgumentOrInheritanceModification",
        (astNode.modificationArgumentOrInheritanceModifications ?? [])
          .map((a) => createNodeFromJSON(a)!)
          .filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IClassOrInheritanceModification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      modificationArgumentOrInheritanceModifications: this.modificationArgumentOrInheritanceModifications.map((c) =>
        c.toJSON(),
      ) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassOrInheritanceModification(this, argument);
  }

  static new(
    cstNode?: TSNode | null,
    astNode?: IClassOrInheritanceModification | null,
  ): ClassOrInheritanceModification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ClassOrInheritanceModification") return new ClassOrInheritanceModification(cstNode, astNode);
    return null;
  }
}

export interface IInheritanceModification extends ISyntaxNode {
  readonly "@type": "InheritanceModification";
  readonly connectEquation: IConnectEquation;
  readonly identifier: IIDENT;
}

export class InheritanceModification extends SyntaxNode implements IInheritanceModification {
  readonly "@type" = "InheritanceModification" as const;

  /** Field: `connectEquation` */
  get connectEquation(): ConnectEquation {
    return this.lazyChild<ConnectEquation>("connectEquation", () => {
      const c = this._cstNode?.childForFieldName("connectEquation") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("connectEquation")
        ? (this.alternate.getChild("connectEquation") as ConnectEquation | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConnectEquation | null;
    })!;
  }

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IInheritanceModification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("connectEquation");
    this._slotNames.add("identifier");
    if (astNode) {
      this.setChild(
        "connectEquation",
        astNode.connectEquation ? createNodeFromJSON(astNode.connectEquation as any) : null,
      );
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IInheritanceModification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      connectEquation: (this.connectEquation?.toJSON() as any) ?? null,
      identifier: (this.identifier?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitInheritanceModification(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IInheritanceModification | null): InheritanceModification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "InheritanceModification") return new InheritanceModification(cstNode, astNode);
    return null;
  }
}

export interface IComponentClause extends ISyntaxNode {
  readonly "@type": "ComponentClause";
  readonly redeclare: ISyntaxNode | null;
  readonly final: ISyntaxNode | null;
  readonly inner: ISyntaxNode | null;
  readonly outer: ISyntaxNode | null;
  readonly replaceable: ISyntaxNode | null;
  readonly flow: ISyntaxNode | null;
  readonly variability: ISyntaxNode | null;
  readonly causality: ISyntaxNode | null;
  readonly typeSpecifier: ITypeSpecifier;
  readonly arraySubscripts: IArraySubscripts | null;
  readonly componentDeclarations: IComponentDeclaration[];
  readonly constrainingClause: IConstrainingClause | null;
}

export class ComponentClause extends SyntaxNode implements IComponentClause {
  readonly "@type" = "ComponentClause" as const;

  /** Field: `redeclare` */
  get redeclare(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("redeclare", () => {
      const c = this._cstNode?.childForFieldName("redeclare") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("redeclare")
        ? (this.alternate.getChild("redeclare") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `final` */
  get final(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("final", () => {
      const c = this._cstNode?.childForFieldName("final") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("final")
        ? (this.alternate.getChild("final") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `inner` */
  get inner(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("inner", () => {
      const c = this._cstNode?.childForFieldName("inner") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("inner")
        ? (this.alternate.getChild("inner") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `outer` */
  get outer(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("outer", () => {
      const c = this._cstNode?.childForFieldName("outer") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("outer")
        ? (this.alternate.getChild("outer") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `replaceable` */
  get replaceable(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("replaceable", () => {
      const c = this._cstNode?.childForFieldName("replaceable") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("replaceable")
        ? (this.alternate.getChild("replaceable") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `flow` */
  get flow(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("flow", () => {
      const c = this._cstNode?.childForFieldName("flow") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("flow")
        ? (this.alternate.getChild("flow") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `variability` */
  get variability(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("variability", () => {
      const c = this._cstNode?.childForFieldName("variability") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("variability")
        ? (this.alternate.getChild("variability") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `causality` */
  get causality(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("causality", () => {
      const c = this._cstNode?.childForFieldName("causality") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("causality")
        ? (this.alternate.getChild("causality") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `arraySubscripts` */
  get arraySubscripts(): ArraySubscripts | null {
    return this.lazyChild<ArraySubscripts>("arraySubscripts", () => {
      const c = this._cstNode?.childForFieldName("arraySubscripts") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arraySubscripts")
        ? (this.alternate.getChild("arraySubscripts") as ArraySubscripts | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ArraySubscripts | null;
    });
  }

  /** Field: `componentDeclaration` */
  get componentDeclarations(): ComponentDeclaration[] {
    return this.lazyChildren<ComponentDeclaration>("componentDeclaration", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("componentDeclaration") ?? [];
      const oldChildren = this.alternate?.isMaterialized("componentDeclaration")
        ? (this.alternate.getChildren("componentDeclaration") as ComponentDeclaration[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "componentDeclaration") as ComponentDeclaration[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ComponentDeclaration[];
    });
  }

  /** Field: `constrainingClause` */
  get constrainingClause(): ConstrainingClause | null {
    return this.lazyChild<ConstrainingClause>("constrainingClause", () => {
      const c = this._cstNode?.childForFieldName("constrainingClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("constrainingClause")
        ? (this.alternate.getChild("constrainingClause") as ConstrainingClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConstrainingClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("redeclare");
    this._slotNames.add("final");
    this._slotNames.add("inner");
    this._slotNames.add("outer");
    this._slotNames.add("replaceable");
    this._slotNames.add("flow");
    this._slotNames.add("variability");
    this._slotNames.add("causality");
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("arraySubscripts");
    this._slotNames.add("componentDeclaration");
    this._slotNames.add("constrainingClause");
    if (astNode) {
      this.setChild("redeclare", astNode.redeclare ? createNodeFromJSON(astNode.redeclare as any) : null);
      this.setChild("final", astNode.final ? createNodeFromJSON(astNode.final as any) : null);
      this.setChild("inner", astNode.inner ? createNodeFromJSON(astNode.inner as any) : null);
      this.setChild("outer", astNode.outer ? createNodeFromJSON(astNode.outer as any) : null);
      this.setChild("replaceable", astNode.replaceable ? createNodeFromJSON(astNode.replaceable as any) : null);
      this.setChild("flow", astNode.flow ? createNodeFromJSON(astNode.flow as any) : null);
      this.setChild("variability", astNode.variability ? createNodeFromJSON(astNode.variability as any) : null);
      this.setChild("causality", astNode.causality ? createNodeFromJSON(astNode.causality as any) : null);
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChild(
        "arraySubscripts",
        astNode.arraySubscripts ? createNodeFromJSON(astNode.arraySubscripts as any) : null,
      );
      this.setChildren(
        "componentDeclaration",
        (astNode.componentDeclarations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild(
        "constrainingClause",
        astNode.constrainingClause ? createNodeFromJSON(astNode.constrainingClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      redeclare: (this.redeclare?.toJSON() as any) ?? null,
      final: (this.final?.toJSON() as any) ?? null,
      inner: (this.inner?.toJSON() as any) ?? null,
      outer: (this.outer?.toJSON() as any) ?? null,
      replaceable: (this.replaceable?.toJSON() as any) ?? null,
      flow: (this.flow?.toJSON() as any) ?? null,
      variability: (this.variability?.toJSON() as any) ?? null,
      causality: (this.causality?.toJSON() as any) ?? null,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      arraySubscripts: (this.arraySubscripts?.toJSON() as any) ?? null,
      componentDeclarations: this.componentDeclarations.map((c) => c.toJSON()) as any,
      constrainingClause: (this.constrainingClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentClause | null): ComponentClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentClause") return new ComponentClause(cstNode, astNode);
    return null;
  }
}

export interface IComponentDeclaration extends ISyntaxNode {
  readonly "@type": "ComponentDeclaration";
  readonly declaration: IDeclaration;
  readonly conditionAttribute: IConditionAttribute | null;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ComponentDeclaration extends SyntaxNode implements IComponentDeclaration {
  readonly "@type" = "ComponentDeclaration" as const;

  /** Field: `declaration` */
  get declaration(): Declaration {
    return this.lazyChild<Declaration>("declaration", () => {
      const c = this._cstNode?.childForFieldName("declaration") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("declaration")
        ? (this.alternate.getChild("declaration") as Declaration | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Declaration | null;
    })!;
  }

  /** Field: `conditionAttribute` */
  get conditionAttribute(): ConditionAttribute | null {
    return this.lazyChild<ConditionAttribute>("conditionAttribute", () => {
      const c = this._cstNode?.childForFieldName("conditionAttribute") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("conditionAttribute")
        ? (this.alternate.getChild("conditionAttribute") as ConditionAttribute | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConditionAttribute | null;
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentDeclaration | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("declaration");
    this._slotNames.add("conditionAttribute");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("declaration", astNode.declaration ? createNodeFromJSON(astNode.declaration as any) : null);
      this.setChild(
        "conditionAttribute",
        astNode.conditionAttribute ? createNodeFromJSON(astNode.conditionAttribute as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentDeclaration {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      declaration: (this.declaration?.toJSON() as any) ?? null,
      conditionAttribute: (this.conditionAttribute?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentDeclaration | null): ComponentDeclaration | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentDeclaration") return new ComponentDeclaration(cstNode, astNode);
    return null;
  }
}

export interface IConditionAttribute extends ISyntaxNode {
  readonly "@type": "ConditionAttribute";
  readonly condition: IExpression;
}

export class ConditionAttribute extends SyntaxNode implements IConditionAttribute {
  readonly "@type" = "ConditionAttribute" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IConditionAttribute | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IConditionAttribute {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConditionAttribute(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IConditionAttribute | null): ConditionAttribute | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ConditionAttribute") return new ConditionAttribute(cstNode, astNode);
    return null;
  }
}

export interface IDeclaration extends ISyntaxNode {
  readonly "@type": "Declaration";
  readonly identifier: IIDENT;
  readonly arraySubscripts: IArraySubscripts | null;
  readonly modification: IModification | null;
}

export class Declaration extends SyntaxNode implements IDeclaration {
  readonly "@type" = "Declaration" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `arraySubscripts` */
  get arraySubscripts(): ArraySubscripts | null {
    return this.lazyChild<ArraySubscripts>("arraySubscripts", () => {
      const c = this._cstNode?.childForFieldName("arraySubscripts") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arraySubscripts")
        ? (this.alternate.getChild("arraySubscripts") as ArraySubscripts | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ArraySubscripts | null;
    });
  }

  /** Field: `modification` */
  get modification(): Modification | null {
    return this.lazyChild<Modification>("modification", () => {
      const c = this._cstNode?.childForFieldName("modification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("modification")
        ? (this.alternate.getChild("modification") as Modification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Modification | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IDeclaration | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("arraySubscripts");
    this._slotNames.add("modification");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild(
        "arraySubscripts",
        astNode.arraySubscripts ? createNodeFromJSON(astNode.arraySubscripts as any) : null,
      );
      this.setChild("modification", astNode.modification ? createNodeFromJSON(astNode.modification as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IDeclaration {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      arraySubscripts: (this.arraySubscripts?.toJSON() as any) ?? null,
      modification: (this.modification?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDeclaration(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IDeclaration | null): Declaration | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "Declaration") return new Declaration(cstNode, astNode);
    return null;
  }
}

export interface IModification extends ISyntaxNode {
  readonly "@type": "Modification";
  readonly classModification: IClassModification;
  readonly modificationExpression: IModificationExpression | null;
}

export class Modification extends SyntaxNode implements IModification {
  readonly "@type" = "Modification" as const;

  /** Field: `classModification` */
  get classModification(): ClassModification {
    return this.lazyChild<ClassModification>("classModification", () => {
      const c = this._cstNode?.childForFieldName("classModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classModification")
        ? (this.alternate.getChild("classModification") as ClassModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassModification | null;
    })!;
  }

  /** Field: `modificationExpression` */
  get modificationExpression(): ModificationExpression | null {
    return this.lazyChild<ModificationExpression>("modificationExpression", () => {
      const c = this._cstNode?.childForFieldName("modificationExpression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("modificationExpression")
        ? (this.alternate.getChild("modificationExpression") as ModificationExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ModificationExpression | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IModification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("classModification");
    this._slotNames.add("modificationExpression");
    if (astNode) {
      this.setChild(
        "classModification",
        astNode.classModification ? createNodeFromJSON(astNode.classModification as any) : null,
      );
      this.setChild(
        "modificationExpression",
        astNode.modificationExpression ? createNodeFromJSON(astNode.modificationExpression as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IModification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      classModification: (this.classModification?.toJSON() as any) ?? null,
      modificationExpression: (this.modificationExpression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModification(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IModification | null): Modification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "Modification") return new Modification(cstNode, astNode);
    return null;
  }
}

export interface IModificationExpression extends ISyntaxNode {
  readonly "@type": "ModificationExpression";
  readonly expression: IExpression;
  readonly break: ISyntaxNode;
}

export class ModificationExpression extends SyntaxNode implements IModificationExpression {
  readonly "@type" = "ModificationExpression" as const;

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `break` */
  get break(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("break", () => {
      const c = this._cstNode?.childForFieldName("break") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("break")
        ? (this.alternate.getChild("break") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IModificationExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expression");
    this._slotNames.add("break");
    if (astNode) {
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
      this.setChild("break", astNode.break ? createNodeFromJSON(astNode.break as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IModificationExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expression: (this.expression?.toJSON() as any) ?? null,
      break: (this.break?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModificationExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IModificationExpression | null): ModificationExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ModificationExpression") return new ModificationExpression(cstNode, astNode);
    return null;
  }
}

export interface IClassModification extends ISyntaxNode {
  readonly "@type": "ClassModification";
  readonly modificationArguments: IModificationArgument[];
}

export class ClassModification extends SyntaxNode implements IClassModification {
  readonly "@type" = "ClassModification" as const;

  /** Field: `modificationArgument` */
  get modificationArguments(): ModificationArgument[] {
    return this.lazyChildren<ModificationArgument>("modificationArgument", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("modificationArgument") ?? [];
      const oldChildren = this.alternate?.isMaterialized("modificationArgument")
        ? (this.alternate.getChildren("modificationArgument") as ModificationArgument[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "modificationArgument") as ModificationArgument[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ModificationArgument[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IClassModification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("modificationArgument");
    if (astNode) {
      this.setChildren(
        "modificationArgument",
        (astNode.modificationArguments ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IClassModification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      modificationArguments: this.modificationArguments.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassModification(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IClassModification | null): ClassModification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ClassModification") return new ClassModification(cstNode, astNode);
    return null;
  }
}

export interface IElementModification extends ISyntaxNode {
  readonly "@type": "ElementModification";
  readonly each: ISyntaxNode | null;
  readonly final: ISyntaxNode | null;
  readonly name: IName;
  readonly modification: IModification | null;
  readonly description: IDescription | null;
}

export class ElementModification extends SyntaxNode implements IElementModification {
  readonly "@type" = "ElementModification" as const;

  /** Field: `each` */
  get each(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("each", () => {
      const c = this._cstNode?.childForFieldName("each") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("each")
        ? (this.alternate.getChild("each") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `final` */
  get final(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("final", () => {
      const c = this._cstNode?.childForFieldName("final") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("final")
        ? (this.alternate.getChild("final") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `name` */
  get name(): Name {
    return this.lazyChild<Name>("name", () => {
      const c = this._cstNode?.childForFieldName("name") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("name") ? (this.alternate.getChild("name") as Name | null) : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    })!;
  }

  /** Field: `modification` */
  get modification(): Modification | null {
    return this.lazyChild<Modification>("modification", () => {
      const c = this._cstNode?.childForFieldName("modification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("modification")
        ? (this.alternate.getChild("modification") as Modification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Modification | null;
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElementModification | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("each");
    this._slotNames.add("final");
    this._slotNames.add("name");
    this._slotNames.add("modification");
    this._slotNames.add("description");
    if (astNode) {
      this.setChild("each", astNode.each ? createNodeFromJSON(astNode.each as any) : null);
      this.setChild("final", astNode.final ? createNodeFromJSON(astNode.final as any) : null);
      this.setChild("name", astNode.name ? createNodeFromJSON(astNode.name as any) : null);
      this.setChild("modification", astNode.modification ? createNodeFromJSON(astNode.modification as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override get reconciliationKey(): string {
    const n = this.getChild("name");
    return n ? `ElementModification:${(n as any).text ?? ""}` : this["@type"];
  }

  override toJSON(): IElementModification {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      each: (this.each?.toJSON() as any) ?? null,
      final: (this.final?.toJSON() as any) ?? null,
      name: (this.name?.toJSON() as any) ?? null,
      modification: (this.modification?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementModification(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElementModification | null): ElementModification | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElementModification") return new ElementModification(cstNode, astNode);
    return null;
  }
}

export interface IElementRedeclaration extends ISyntaxNode {
  readonly "@type": "ElementRedeclaration";
  readonly redeclare: ISyntaxNode | null;
  readonly each: ISyntaxNode | null;
  readonly final: ISyntaxNode | null;
  readonly replaceable: ISyntaxNode | null;
  readonly classDefinition: IShortClassDefinition;
  readonly componentClause: IComponentClause1;
}

export class ElementRedeclaration extends SyntaxNode implements IElementRedeclaration {
  readonly "@type" = "ElementRedeclaration" as const;

  /** Field: `redeclare` */
  get redeclare(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("redeclare", () => {
      const c = this._cstNode?.childForFieldName("redeclare") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("redeclare")
        ? (this.alternate.getChild("redeclare") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `each` */
  get each(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("each", () => {
      const c = this._cstNode?.childForFieldName("each") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("each")
        ? (this.alternate.getChild("each") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `final` */
  get final(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("final", () => {
      const c = this._cstNode?.childForFieldName("final") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("final")
        ? (this.alternate.getChild("final") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `replaceable` */
  get replaceable(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("replaceable", () => {
      const c = this._cstNode?.childForFieldName("replaceable") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("replaceable")
        ? (this.alternate.getChild("replaceable") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `classDefinition` */
  get classDefinition(): ShortClassDefinition {
    return this.lazyChild<ShortClassDefinition>("classDefinition", () => {
      const c = this._cstNode?.childForFieldName("classDefinition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classDefinition")
        ? (this.alternate.getChild("classDefinition") as ShortClassDefinition | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ShortClassDefinition | null;
    })!;
  }

  /** Field: `componentClause` */
  get componentClause(): ComponentClause1 {
    return this.lazyChild<ComponentClause1>("componentClause", () => {
      const c = this._cstNode?.childForFieldName("componentClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("componentClause")
        ? (this.alternate.getChild("componentClause") as ComponentClause1 | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentClause1 | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IElementRedeclaration | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("redeclare");
    this._slotNames.add("each");
    this._slotNames.add("final");
    this._slotNames.add("replaceable");
    this._slotNames.add("classDefinition");
    this._slotNames.add("componentClause");
    if (astNode) {
      this.setChild("redeclare", astNode.redeclare ? createNodeFromJSON(astNode.redeclare as any) : null);
      this.setChild("each", astNode.each ? createNodeFromJSON(astNode.each as any) : null);
      this.setChild("final", astNode.final ? createNodeFromJSON(astNode.final as any) : null);
      this.setChild("replaceable", astNode.replaceable ? createNodeFromJSON(astNode.replaceable as any) : null);
      this.setChild(
        "classDefinition",
        astNode.classDefinition ? createNodeFromJSON(astNode.classDefinition as any) : null,
      );
      this.setChild(
        "componentClause",
        astNode.componentClause ? createNodeFromJSON(astNode.componentClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElementRedeclaration {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      redeclare: (this.redeclare?.toJSON() as any) ?? null,
      each: (this.each?.toJSON() as any) ?? null,
      final: (this.final?.toJSON() as any) ?? null,
      replaceable: (this.replaceable?.toJSON() as any) ?? null,
      classDefinition: (this.classDefinition?.toJSON() as any) ?? null,
      componentClause: (this.componentClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementRedeclaration(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElementRedeclaration | null): ElementRedeclaration | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElementRedeclaration") return new ElementRedeclaration(cstNode, astNode);
    return null;
  }
}

export interface IComponentClause1 extends ISyntaxNode {
  readonly "@type": "ComponentClause1";
  readonly flow: ISyntaxNode | null;
  readonly variability: ISyntaxNode | null;
  readonly causality: ISyntaxNode | null;
  readonly typeSpecifier: ITypeSpecifier;
  readonly componentDeclaration: IComponentDeclaration1;
  readonly constrainingClause: IConstrainingClause | null;
}

export class ComponentClause1 extends SyntaxNode implements IComponentClause1 {
  readonly "@type" = "ComponentClause1" as const;

  /** Field: `flow` */
  get flow(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("flow", () => {
      const c = this._cstNode?.childForFieldName("flow") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("flow")
        ? (this.alternate.getChild("flow") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `variability` */
  get variability(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("variability", () => {
      const c = this._cstNode?.childForFieldName("variability") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("variability")
        ? (this.alternate.getChild("variability") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `causality` */
  get causality(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("causality", () => {
      const c = this._cstNode?.childForFieldName("causality") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("causality")
        ? (this.alternate.getChild("causality") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `componentDeclaration` */
  get componentDeclaration(): ComponentDeclaration1 {
    return this.lazyChild<ComponentDeclaration1>("componentDeclaration", () => {
      const c = this._cstNode?.childForFieldName("componentDeclaration") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("componentDeclaration")
        ? (this.alternate.getChild("componentDeclaration") as ComponentDeclaration1 | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentDeclaration1 | null;
    })!;
  }

  /** Field: `constrainingClause` */
  get constrainingClause(): ConstrainingClause | null {
    return this.lazyChild<ConstrainingClause>("constrainingClause", () => {
      const c = this._cstNode?.childForFieldName("constrainingClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("constrainingClause")
        ? (this.alternate.getChild("constrainingClause") as ConstrainingClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConstrainingClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentClause1 | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("flow");
    this._slotNames.add("variability");
    this._slotNames.add("causality");
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("componentDeclaration");
    this._slotNames.add("constrainingClause");
    if (astNode) {
      this.setChild("flow", astNode.flow ? createNodeFromJSON(astNode.flow as any) : null);
      this.setChild("variability", astNode.variability ? createNodeFromJSON(astNode.variability as any) : null);
      this.setChild("causality", astNode.causality ? createNodeFromJSON(astNode.causality as any) : null);
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChild(
        "componentDeclaration",
        astNode.componentDeclaration ? createNodeFromJSON(astNode.componentDeclaration as any) : null,
      );
      this.setChild(
        "constrainingClause",
        astNode.constrainingClause ? createNodeFromJSON(astNode.constrainingClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentClause1 {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      flow: (this.flow?.toJSON() as any) ?? null,
      variability: (this.variability?.toJSON() as any) ?? null,
      causality: (this.causality?.toJSON() as any) ?? null,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      componentDeclaration: (this.componentDeclaration?.toJSON() as any) ?? null,
      constrainingClause: (this.constrainingClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause1(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentClause1 | null): ComponentClause1 | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentClause1") return new ComponentClause1(cstNode, astNode);
    return null;
  }
}

export interface IComponentDeclaration1 extends ISyntaxNode {
  readonly "@type": "ComponentDeclaration1";
  readonly declaration: IDeclaration;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ComponentDeclaration1 extends SyntaxNode implements IComponentDeclaration1 {
  readonly "@type" = "ComponentDeclaration1" as const;

  /** Field: `declaration` */
  get declaration(): Declaration {
    return this.lazyChild<Declaration>("declaration", () => {
      const c = this._cstNode?.childForFieldName("declaration") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("declaration")
        ? (this.alternate.getChild("declaration") as Declaration | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Declaration | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentDeclaration1 | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("declaration");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("declaration", astNode.declaration ? createNodeFromJSON(astNode.declaration as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentDeclaration1 {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      declaration: (this.declaration?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration1(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentDeclaration1 | null): ComponentDeclaration1 | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentDeclaration1") return new ComponentDeclaration1(cstNode, astNode);
    return null;
  }
}

export interface IShortClassDefinition extends ISyntaxNode {
  readonly "@type": "ShortClassDefinition";
  readonly classPrefixes: IClassPrefixes;
  readonly classSpecifier: IShortClassSpecifier;
  readonly constrainingClause: IConstrainingClause | null;
}

export class ShortClassDefinition extends SyntaxNode implements IShortClassDefinition {
  readonly "@type" = "ShortClassDefinition" as const;

  /** Field: `classPrefixes` */
  get classPrefixes(): ClassPrefixes {
    return this.lazyChild<ClassPrefixes>("classPrefixes", () => {
      const c = this._cstNode?.childForFieldName("classPrefixes") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classPrefixes")
        ? (this.alternate.getChild("classPrefixes") as ClassPrefixes | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassPrefixes | null;
    })!;
  }

  /** Field: `classSpecifier` */
  get classSpecifier(): ShortClassSpecifier {
    return this.lazyChild<ShortClassSpecifier>("classSpecifier", () => {
      const c = this._cstNode?.childForFieldName("classSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classSpecifier")
        ? (this.alternate.getChild("classSpecifier") as ShortClassSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ShortClassSpecifier | null;
    })!;
  }

  /** Field: `constrainingClause` */
  get constrainingClause(): ConstrainingClause | null {
    return this.lazyChild<ConstrainingClause>("constrainingClause", () => {
      const c = this._cstNode?.childForFieldName("constrainingClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("constrainingClause")
        ? (this.alternate.getChild("constrainingClause") as ConstrainingClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ConstrainingClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IShortClassDefinition | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("classPrefixes");
    this._slotNames.add("classSpecifier");
    this._slotNames.add("constrainingClause");
    if (astNode) {
      this.setChild("classPrefixes", astNode.classPrefixes ? createNodeFromJSON(astNode.classPrefixes as any) : null);
      this.setChild(
        "classSpecifier",
        astNode.classSpecifier ? createNodeFromJSON(astNode.classSpecifier as any) : null,
      );
      this.setChild(
        "constrainingClause",
        astNode.constrainingClause ? createNodeFromJSON(astNode.constrainingClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IShortClassDefinition {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      classPrefixes: (this.classPrefixes?.toJSON() as any) ?? null,
      classSpecifier: (this.classSpecifier?.toJSON() as any) ?? null,
      constrainingClause: (this.constrainingClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassDefinition(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IShortClassDefinition | null): ShortClassDefinition | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ShortClassDefinition") return new ShortClassDefinition(cstNode, astNode);
    return null;
  }
}

export interface IEquationSection extends ISyntaxNode {
  readonly "@type": "EquationSection";
  readonly initial: ISyntaxNode | null;
  readonly equations: IEquation[];
  readonly annotationClause: IAnnotationClause | null;
}

export class EquationSection extends SyntaxNode implements IEquationSection {
  readonly "@type" = "EquationSection" as const;

  /** Field: `initial` */
  get initial(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("initial", () => {
      const c = this._cstNode?.childForFieldName("initial") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("initial")
        ? (this.alternate.getChild("initial") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IEquationSection | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("initial");
    this._slotNames.add("equation");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("initial", astNode.initial ? createNodeFromJSON(astNode.initial as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IEquationSection {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      initial: (this.initial?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEquationSection(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IEquationSection | null): EquationSection | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "EquationSection") return new EquationSection(cstNode, astNode);
    return null;
  }
}

export interface IAlgorithmSection extends ISyntaxNode {
  readonly "@type": "AlgorithmSection";
  readonly initial: ISyntaxNode | null;
  readonly statements: IStatement[];
  readonly annotationClause: IAnnotationClause | null;
}

export class AlgorithmSection extends SyntaxNode implements IAlgorithmSection {
  readonly "@type" = "AlgorithmSection" as const;

  /** Field: `initial` */
  get initial(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("initial", () => {
      const c = this._cstNode?.childForFieldName("initial") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("initial")
        ? (this.alternate.getChild("initial") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IAlgorithmSection | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("initial");
    this._slotNames.add("statement");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("initial", astNode.initial ? createNodeFromJSON(astNode.initial as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IAlgorithmSection {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      initial: (this.initial?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAlgorithmSection(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IAlgorithmSection | null): AlgorithmSection | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "AlgorithmSection") return new AlgorithmSection(cstNode, astNode);
    return null;
  }
}

export interface IConstraintSection extends ISyntaxNode {
  readonly "@type": "ConstraintSection";
  readonly initial: ISyntaxNode | null;
  readonly equations: IEquation[];
  readonly annotationClause: IAnnotationClause | null;
}

export class ConstraintSection extends SyntaxNode implements IConstraintSection {
  readonly "@type" = "ConstraintSection" as const;

  /** Field: `initial` */
  get initial(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("initial", () => {
      const c = this._cstNode?.childForFieldName("initial") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("initial")
        ? (this.alternate.getChild("initial") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IConstraintSection | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("initial");
    this._slotNames.add("equation");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("initial", astNode.initial ? createNodeFromJSON(astNode.initial as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IConstraintSection {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      initial: (this.initial?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConstraintSection(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IConstraintSection | null): ConstraintSection | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ConstraintSection") return new ConstraintSection(cstNode, astNode);
    return null;
  }
}

export interface ISimpleAssignmentStatement extends ISyntaxNode {
  readonly "@type": "SimpleAssignmentStatement";
  readonly target: IComponentReference;
  readonly source: IExpression;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class SimpleAssignmentStatement extends SyntaxNode implements ISimpleAssignmentStatement {
  readonly "@type" = "SimpleAssignmentStatement" as const;

  /** Field: `target` */
  get target(): ComponentReference {
    return this.lazyChild<ComponentReference>("target", () => {
      const c = this._cstNode?.childForFieldName("target") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("target")
        ? (this.alternate.getChild("target") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `source` */
  get source(): Expression {
    return this.lazyChild<Expression>("source", () => {
      const c = this._cstNode?.childForFieldName("source") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("source")
        ? (this.alternate.getChild("source") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: ISimpleAssignmentStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("target");
    this._slotNames.add("source");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("target", astNode.target ? createNodeFromJSON(astNode.target as any) : null);
      this.setChild("source", astNode.source ? createNodeFromJSON(astNode.source as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISimpleAssignmentStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      target: (this.target?.toJSON() as any) ?? null,
      source: (this.source?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleAssignmentStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISimpleAssignmentStatement | null): SimpleAssignmentStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "SimpleAssignmentStatement") return new SimpleAssignmentStatement(cstNode, astNode);
    return null;
  }
}

export interface IProcedureCallStatement extends ISyntaxNode {
  readonly "@type": "ProcedureCallStatement";
  readonly functionReference: IComponentReference;
  readonly functionCallArguments: IFunctionCallArguments;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ProcedureCallStatement extends SyntaxNode implements IProcedureCallStatement {
  readonly "@type" = "ProcedureCallStatement" as const;

  /** Field: `functionReference` */
  get functionReference(): ComponentReference {
    return this.lazyChild<ComponentReference>("functionReference", () => {
      const c = this._cstNode?.childForFieldName("functionReference") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionReference")
        ? (this.alternate.getChild("functionReference") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `functionCallArguments` */
  get functionCallArguments(): FunctionCallArguments {
    return this.lazyChild<FunctionCallArguments>("functionCallArguments", () => {
      const c = this._cstNode?.childForFieldName("functionCallArguments") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionCallArguments")
        ? (this.alternate.getChild("functionCallArguments") as FunctionCallArguments | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionCallArguments | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IProcedureCallStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("functionReference");
    this._slotNames.add("functionCallArguments");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild(
        "functionReference",
        astNode.functionReference ? createNodeFromJSON(astNode.functionReference as any) : null,
      );
      this.setChild(
        "functionCallArguments",
        astNode.functionCallArguments ? createNodeFromJSON(astNode.functionCallArguments as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IProcedureCallStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      functionReference: (this.functionReference?.toJSON() as any) ?? null,
      functionCallArguments: (this.functionCallArguments?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitProcedureCallStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IProcedureCallStatement | null): ProcedureCallStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ProcedureCallStatement") return new ProcedureCallStatement(cstNode, astNode);
    return null;
  }
}

export interface IComplexAssignmentStatement extends ISyntaxNode {
  readonly "@type": "ComplexAssignmentStatement";
  readonly outputExpressionList: IOutputExpressionList;
  readonly functionReference: IComponentReference;
  readonly functionCallArguments: IFunctionCallArguments;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ComplexAssignmentStatement extends SyntaxNode implements IComplexAssignmentStatement {
  readonly "@type" = "ComplexAssignmentStatement" as const;

  /** Field: `outputExpressionList` */
  get outputExpressionList(): OutputExpressionList {
    return this.lazyChild<OutputExpressionList>("outputExpressionList", () => {
      const c = this._cstNode?.childForFieldName("outputExpressionList") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("outputExpressionList")
        ? (this.alternate.getChild("outputExpressionList") as OutputExpressionList | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as OutputExpressionList | null;
    })!;
  }

  /** Field: `functionReference` */
  get functionReference(): ComponentReference {
    return this.lazyChild<ComponentReference>("functionReference", () => {
      const c = this._cstNode?.childForFieldName("functionReference") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionReference")
        ? (this.alternate.getChild("functionReference") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `functionCallArguments` */
  get functionCallArguments(): FunctionCallArguments {
    return this.lazyChild<FunctionCallArguments>("functionCallArguments", () => {
      const c = this._cstNode?.childForFieldName("functionCallArguments") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionCallArguments")
        ? (this.alternate.getChild("functionCallArguments") as FunctionCallArguments | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionCallArguments | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComplexAssignmentStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("outputExpressionList");
    this._slotNames.add("functionReference");
    this._slotNames.add("functionCallArguments");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild(
        "outputExpressionList",
        astNode.outputExpressionList ? createNodeFromJSON(astNode.outputExpressionList as any) : null,
      );
      this.setChild(
        "functionReference",
        astNode.functionReference ? createNodeFromJSON(astNode.functionReference as any) : null,
      );
      this.setChild(
        "functionCallArguments",
        astNode.functionCallArguments ? createNodeFromJSON(astNode.functionCallArguments as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComplexAssignmentStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      outputExpressionList: (this.outputExpressionList?.toJSON() as any) ?? null,
      functionReference: (this.functionReference?.toJSON() as any) ?? null,
      functionCallArguments: (this.functionCallArguments?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComplexAssignmentStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComplexAssignmentStatement | null): ComplexAssignmentStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComplexAssignmentStatement") return new ComplexAssignmentStatement(cstNode, astNode);
    return null;
  }
}

export interface ISimpleEquation extends ISyntaxNode {
  readonly "@type": "SimpleEquation";
  readonly expression1: ISimpleExpression;
  readonly operator: ISyntaxNode;
  readonly expression2: IExpression;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class SimpleEquation extends SyntaxNode implements ISimpleEquation {
  readonly "@type" = "SimpleEquation" as const;

  /** Field: `expression1` */
  get expression1(): SimpleExpression {
    return this.lazyChild<SimpleExpression>("expression1", () => {
      const c = this._cstNode?.childForFieldName("expression1") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression1")
        ? (this.alternate.getChild("expression1") as SimpleExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | null;
    })!;
  }

  /** Field: `operator` */
  get operator(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("operator", () => {
      const c = this._cstNode?.childForFieldName("operator") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operator")
        ? (this.alternate.getChild("operator") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `expression2` */
  get expression2(): Expression {
    return this.lazyChild<Expression>("expression2", () => {
      const c = this._cstNode?.childForFieldName("expression2") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression2")
        ? (this.alternate.getChild("expression2") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: ISimpleEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expression1");
    this._slotNames.add("operator");
    this._slotNames.add("expression2");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("expression1", astNode.expression1 ? createNodeFromJSON(astNode.expression1 as any) : null);
      this.setChild("operator", astNode.operator ? createNodeFromJSON(astNode.operator as any) : null);
      this.setChild("expression2", astNode.expression2 ? createNodeFromJSON(astNode.expression2 as any) : null);
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISimpleEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expression1: (this.expression1?.toJSON() as any) ?? null,
      operator: (this.operator?.toJSON() as any) ?? null,
      expression2: (this.expression2?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISimpleEquation | null): SimpleEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "SimpleEquation") return new SimpleEquation(cstNode, astNode);
    return null;
  }
}

export interface ISpecialEquation extends ISyntaxNode {
  readonly "@type": "SpecialEquation";
  readonly functionReference: IComponentReference;
  readonly functionCallArguments: IFunctionCallArguments;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class SpecialEquation extends SyntaxNode implements ISpecialEquation {
  readonly "@type" = "SpecialEquation" as const;

  /** Field: `functionReference` */
  get functionReference(): ComponentReference {
    return this.lazyChild<ComponentReference>("functionReference", () => {
      const c = this._cstNode?.childForFieldName("functionReference") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionReference")
        ? (this.alternate.getChild("functionReference") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `functionCallArguments` */
  get functionCallArguments(): FunctionCallArguments {
    return this.lazyChild<FunctionCallArguments>("functionCallArguments", () => {
      const c = this._cstNode?.childForFieldName("functionCallArguments") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionCallArguments")
        ? (this.alternate.getChild("functionCallArguments") as FunctionCallArguments | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionCallArguments | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: ISpecialEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("functionReference");
    this._slotNames.add("functionCallArguments");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild(
        "functionReference",
        astNode.functionReference ? createNodeFromJSON(astNode.functionReference as any) : null,
      );
      this.setChild(
        "functionCallArguments",
        astNode.functionCallArguments ? createNodeFromJSON(astNode.functionCallArguments as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISpecialEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      functionReference: (this.functionReference?.toJSON() as any) ?? null,
      functionCallArguments: (this.functionCallArguments?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSpecialEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISpecialEquation | null): SpecialEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "SpecialEquation") return new SpecialEquation(cstNode, astNode);
    return null;
  }
}

export interface IBreakStatement extends ISyntaxNode {
  readonly "@type": "BreakStatement";
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class BreakStatement extends SyntaxNode implements IBreakStatement {
  readonly "@type" = "BreakStatement" as const;

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IBreakStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IBreakStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBreakStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IBreakStatement | null): BreakStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "BreakStatement") return new BreakStatement(cstNode, astNode);
    return null;
  }
}

export interface IReturnStatement extends ISyntaxNode {
  readonly "@type": "ReturnStatement";
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ReturnStatement extends SyntaxNode implements IReturnStatement {
  readonly "@type" = "ReturnStatement" as const;

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IReturnStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IReturnStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitReturnStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IReturnStatement | null): ReturnStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ReturnStatement") return new ReturnStatement(cstNode, astNode);
    return null;
  }
}

export interface IIfEquation extends ISyntaxNode {
  readonly "@type": "IfEquation";
  readonly condition: IExpression;
  readonly equations: IEquation[];
  readonly elseIfEquationClauses: IElseIfEquationClause[];
  readonly elseEquations: IEquation[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class IfEquation extends SyntaxNode implements IIfEquation {
  readonly "@type" = "IfEquation" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `elseIfEquationClause` */
  get elseIfEquationClauses(): ElseIfEquationClause[] {
    return this.lazyChildren<ElseIfEquationClause>("elseIfEquationClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseIfEquationClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseIfEquationClause")
        ? (this.alternate.getChildren("elseIfEquationClause") as ElseIfEquationClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseIfEquationClause") as ElseIfEquationClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ElseIfEquationClause[];
    });
  }

  /** Field: `elseEquation` */
  get elseEquations(): Equation[] {
    return this.lazyChildren<Equation>("elseEquation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseEquation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseEquation")
        ? (this.alternate.getChildren("elseEquation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseEquation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IIfEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("equation");
    this._slotNames.add("elseIfEquationClause");
    this._slotNames.add("elseEquation");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren(
        "elseIfEquationClause",
        (astNode.elseIfEquationClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChildren(
        "elseEquation",
        (astNode.elseEquations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IIfEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
      elseIfEquationClauses: this.elseIfEquationClauses.map((c) => c.toJSON()) as any,
      elseEquations: this.elseEquations.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IIfEquation | null): IfEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "IfEquation") return new IfEquation(cstNode, astNode);
    return null;
  }
}

export interface IElseIfEquationClause extends ISyntaxNode {
  readonly "@type": "ElseIfEquationClause";
  readonly condition: IExpression;
  readonly equations: IEquation[];
}

export class ElseIfEquationClause extends SyntaxNode implements IElseIfEquationClause {
  readonly "@type" = "ElseIfEquationClause" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElseIfEquationClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("equation");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElseIfEquationClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfEquationClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElseIfEquationClause | null): ElseIfEquationClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElseIfEquationClause") return new ElseIfEquationClause(cstNode, astNode);
    return null;
  }
}

export interface IIfStatement extends ISyntaxNode {
  readonly "@type": "IfStatement";
  readonly condition: IExpression;
  readonly statements: IStatement[];
  readonly elseIfStatementClauses: IElseIfStatementClause[];
  readonly elseStatements: IStatement[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class IfStatement extends SyntaxNode implements IIfStatement {
  readonly "@type" = "IfStatement" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `elseIfStatementClause` */
  get elseIfStatementClauses(): ElseIfStatementClause[] {
    return this.lazyChildren<ElseIfStatementClause>("elseIfStatementClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseIfStatementClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseIfStatementClause")
        ? (this.alternate.getChildren("elseIfStatementClause") as ElseIfStatementClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseIfStatementClause") as ElseIfStatementClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ElseIfStatementClause[];
    });
  }

  /** Field: `elseStatement` */
  get elseStatements(): Statement[] {
    return this.lazyChildren<Statement>("elseStatement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseStatement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseStatement")
        ? (this.alternate.getChildren("elseStatement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseStatement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IIfStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("statement");
    this._slotNames.add("elseIfStatementClause");
    this._slotNames.add("elseStatement");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren(
        "elseIfStatementClause",
        (astNode.elseIfStatementClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChildren(
        "elseStatement",
        (astNode.elseStatements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IIfStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
      elseIfStatementClauses: this.elseIfStatementClauses.map((c) => c.toJSON()) as any,
      elseStatements: this.elseStatements.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IIfStatement | null): IfStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "IfStatement") return new IfStatement(cstNode, astNode);
    return null;
  }
}

export interface IElseIfStatementClause extends ISyntaxNode {
  readonly "@type": "ElseIfStatementClause";
  readonly condition: IExpression;
  readonly statements: IStatement[];
}

export class ElseIfStatementClause extends SyntaxNode implements IElseIfStatementClause {
  readonly "@type" = "ElseIfStatementClause" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElseIfStatementClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("statement");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElseIfStatementClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfStatementClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElseIfStatementClause | null): ElseIfStatementClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElseIfStatementClause") return new ElseIfStatementClause(cstNode, astNode);
    return null;
  }
}

export interface IForEquation extends ISyntaxNode {
  readonly "@type": "ForEquation";
  readonly forIndexs: IForIndex[];
  readonly equations: IEquation[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ForEquation extends SyntaxNode implements IForEquation {
  readonly "@type" = "ForEquation" as const;

  /** Field: `forIndex` */
  get forIndexs(): ForIndex[] {
    return this.lazyChildren<ForIndex>("forIndex", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("forIndex") ?? [];
      const oldChildren = this.alternate?.isMaterialized("forIndex")
        ? (this.alternate.getChildren("forIndex") as ForIndex[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "forIndex") as ForIndex[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ForIndex[];
    });
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IForEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("forIndex");
    this._slotNames.add("equation");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChildren("forIndex", (astNode.forIndexs ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IForEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      forIndexs: this.forIndexs.map((c) => c.toJSON()) as any,
      equations: this.equations.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IForEquation | null): ForEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ForEquation") return new ForEquation(cstNode, astNode);
    return null;
  }
}

export interface IForStatement extends ISyntaxNode {
  readonly "@type": "ForStatement";
  readonly forIndexs: IForIndex[];
  readonly statements: IStatement[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ForStatement extends SyntaxNode implements IForStatement {
  readonly "@type" = "ForStatement" as const;

  /** Field: `forIndex` */
  get forIndexs(): ForIndex[] {
    return this.lazyChildren<ForIndex>("forIndex", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("forIndex") ?? [];
      const oldChildren = this.alternate?.isMaterialized("forIndex")
        ? (this.alternate.getChildren("forIndex") as ForIndex[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "forIndex") as ForIndex[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ForIndex[];
    });
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IForStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("forIndex");
    this._slotNames.add("statement");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChildren("forIndex", (astNode.forIndexs ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IForStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      forIndexs: this.forIndexs.map((c) => c.toJSON()) as any,
      statements: this.statements.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IForStatement | null): ForStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ForStatement") return new ForStatement(cstNode, astNode);
    return null;
  }
}

export interface IForIndex extends ISyntaxNode {
  readonly "@type": "ForIndex";
  readonly identifier: IIDENT;
  readonly expression: IExpression | null;
}

export class ForIndex extends SyntaxNode implements IForIndex {
  readonly "@type" = "ForIndex" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `expression` */
  get expression(): Expression | null {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IForIndex | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("expression");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IForIndex {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      expression: (this.expression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForIndex(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IForIndex | null): ForIndex | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ForIndex") return new ForIndex(cstNode, astNode);
    return null;
  }
}

export interface IWhileStatement extends ISyntaxNode {
  readonly "@type": "WhileStatement";
  readonly condition: IExpression;
  readonly statements: IStatement[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class WhileStatement extends SyntaxNode implements IWhileStatement {
  readonly "@type" = "WhileStatement" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IWhileStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("statement");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IWhileStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhileStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IWhileStatement | null): WhileStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "WhileStatement") return new WhileStatement(cstNode, astNode);
    return null;
  }
}

export interface IWhenEquation extends ISyntaxNode {
  readonly "@type": "WhenEquation";
  readonly condition: IExpression;
  readonly equations: IEquation[];
  readonly elseWhenEquationClauses: IElseWhenEquationClause[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class WhenEquation extends SyntaxNode implements IWhenEquation {
  readonly "@type" = "WhenEquation" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  /** Field: `elseWhenEquationClause` */
  get elseWhenEquationClauses(): ElseWhenEquationClause[] {
    return this.lazyChildren<ElseWhenEquationClause>("elseWhenEquationClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseWhenEquationClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseWhenEquationClause")
        ? (this.alternate.getChildren("elseWhenEquationClause") as ElseWhenEquationClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseWhenEquationClause") as ElseWhenEquationClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ElseWhenEquationClause[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IWhenEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("equation");
    this._slotNames.add("elseWhenEquationClause");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren(
        "elseWhenEquationClause",
        (astNode.elseWhenEquationClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IWhenEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
      elseWhenEquationClauses: this.elseWhenEquationClauses.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IWhenEquation | null): WhenEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "WhenEquation") return new WhenEquation(cstNode, astNode);
    return null;
  }
}

export interface IElseWhenEquationClause extends ISyntaxNode {
  readonly "@type": "ElseWhenEquationClause";
  readonly condition: IExpression;
  readonly equations: IEquation[];
}

export class ElseWhenEquationClause extends SyntaxNode implements IElseWhenEquationClause {
  readonly "@type" = "ElseWhenEquationClause" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `equation` */
  get equations(): Equation[] {
    return this.lazyChildren<Equation>("equation", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("equation") ?? [];
      const oldChildren = this.alternate?.isMaterialized("equation")
        ? (this.alternate.getChildren("equation") as Equation[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "equation") as Equation[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Equation[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElseWhenEquationClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("equation");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("equation", (astNode.equations ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElseWhenEquationClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      equations: this.equations.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenEquationClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElseWhenEquationClause | null): ElseWhenEquationClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElseWhenEquationClause") return new ElseWhenEquationClause(cstNode, astNode);
    return null;
  }
}

export interface IWhenStatement extends ISyntaxNode {
  readonly "@type": "WhenStatement";
  readonly condition: IExpression;
  readonly statements: IStatement[];
  readonly elseWhenStatementClauses: IElseWhenStatementClause[];
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class WhenStatement extends SyntaxNode implements IWhenStatement {
  readonly "@type" = "WhenStatement" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  /** Field: `elseWhenStatementClause` */
  get elseWhenStatementClauses(): ElseWhenStatementClause[] {
    return this.lazyChildren<ElseWhenStatementClause>("elseWhenStatementClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseWhenStatementClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseWhenStatementClause")
        ? (this.alternate.getChildren("elseWhenStatementClause") as ElseWhenStatementClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseWhenStatementClause") as ElseWhenStatementClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ElseWhenStatementClause[];
    });
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IWhenStatement | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("statement");
    this._slotNames.add("elseWhenStatementClause");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren(
        "elseWhenStatementClause",
        (astNode.elseWhenStatementClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IWhenStatement {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
      elseWhenStatementClauses: this.elseWhenStatementClauses.map((c) => c.toJSON()) as any,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenStatement(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IWhenStatement | null): WhenStatement | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "WhenStatement") return new WhenStatement(cstNode, astNode);
    return null;
  }
}

export interface IElseWhenStatementClause extends ISyntaxNode {
  readonly "@type": "ElseWhenStatementClause";
  readonly condition: IExpression;
  readonly statements: IStatement[];
}

export class ElseWhenStatementClause extends SyntaxNode implements IElseWhenStatementClause {
  readonly "@type" = "ElseWhenStatementClause" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `statement` */
  get statements(): Statement[] {
    return this.lazyChildren<Statement>("statement", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("statement") ?? [];
      const oldChildren = this.alternate?.isMaterialized("statement")
        ? (this.alternate.getChildren("statement") as Statement[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "statement") as Statement[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Statement[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IElseWhenStatementClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("statement");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChildren("statement", (astNode.statements ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElseWhenStatementClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      statements: this.statements.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenStatementClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElseWhenStatementClause | null): ElseWhenStatementClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElseWhenStatementClause") return new ElseWhenStatementClause(cstNode, astNode);
    return null;
  }
}

export interface IConnectEquation extends ISyntaxNode {
  readonly "@type": "ConnectEquation";
  readonly componentReference1: IComponentReference;
  readonly componentReference2: IComponentReference;
  readonly description: IDescription | null;
  readonly annotationClause: IAnnotationClause | null;
}

export class ConnectEquation extends SyntaxNode implements IConnectEquation {
  readonly "@type" = "ConnectEquation" as const;

  /** Field: `componentReference1` */
  get componentReference1(): ComponentReference {
    return this.lazyChild<ComponentReference>("componentReference1", () => {
      const c = this._cstNode?.childForFieldName("componentReference1") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("componentReference1")
        ? (this.alternate.getChild("componentReference1") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `componentReference2` */
  get componentReference2(): ComponentReference {
    return this.lazyChild<ComponentReference>("componentReference2", () => {
      const c = this._cstNode?.childForFieldName("componentReference2") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("componentReference2")
        ? (this.alternate.getChild("componentReference2") as ComponentReference | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | null;
    })!;
  }

  /** Field: `description` */
  get description(): Description | null {
    return this.lazyChild<Description>("description", () => {
      const c = this._cstNode?.childForFieldName("description") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("description")
        ? (this.alternate.getChild("description") as Description | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Description | null;
    });
  }

  /** Field: `annotationClause` */
  get annotationClause(): AnnotationClause | null {
    return this.lazyChild<AnnotationClause>("annotationClause", () => {
      const c = this._cstNode?.childForFieldName("annotationClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("annotationClause")
        ? (this.alternate.getChild("annotationClause") as AnnotationClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as AnnotationClause | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IConnectEquation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("componentReference1");
    this._slotNames.add("componentReference2");
    this._slotNames.add("description");
    this._slotNames.add("annotationClause");
    if (astNode) {
      this.setChild(
        "componentReference1",
        astNode.componentReference1 ? createNodeFromJSON(astNode.componentReference1 as any) : null,
      );
      this.setChild(
        "componentReference2",
        astNode.componentReference2 ? createNodeFromJSON(astNode.componentReference2 as any) : null,
      );
      this.setChild("description", astNode.description ? createNodeFromJSON(astNode.description as any) : null);
      this.setChild(
        "annotationClause",
        astNode.annotationClause ? createNodeFromJSON(astNode.annotationClause as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IConnectEquation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      componentReference1: (this.componentReference1?.toJSON() as any) ?? null,
      componentReference2: (this.componentReference2?.toJSON() as any) ?? null,
      description: (this.description?.toJSON() as any) ?? null,
      annotationClause: (this.annotationClause?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConnectEquation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IConnectEquation | null): ConnectEquation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ConnectEquation") return new ConnectEquation(cstNode, astNode);
    return null;
  }
}

export interface IIfElseExpression extends ISyntaxNode {
  readonly "@type": "IfElseExpression";
  readonly condition: IExpression;
  readonly expression: IExpression;
  readonly elseIfExpressionClauses: IElseIfExpressionClause[];
  readonly elseExpression: IExpression;
}

export class IfElseExpression extends SyntaxNode implements IIfElseExpression {
  readonly "@type" = "IfElseExpression" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `elseIfExpressionClause` */
  get elseIfExpressionClauses(): ElseIfExpressionClause[] {
    return this.lazyChildren<ElseIfExpressionClause>("elseIfExpressionClause", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("elseIfExpressionClause") ?? [];
      const oldChildren = this.alternate?.isMaterialized("elseIfExpressionClause")
        ? (this.alternate.getChildren("elseIfExpressionClause") as ElseIfExpressionClause[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "elseIfExpressionClause") as ElseIfExpressionClause[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ElseIfExpressionClause[];
    });
  }

  /** Field: `elseExpression` */
  get elseExpression(): Expression {
    return this.lazyChild<Expression>("elseExpression", () => {
      const c = this._cstNode?.childForFieldName("elseExpression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("elseExpression")
        ? (this.alternate.getChild("elseExpression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IIfElseExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("expression");
    this._slotNames.add("elseIfExpressionClause");
    this._slotNames.add("elseExpression");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
      this.setChildren(
        "elseIfExpressionClause",
        (astNode.elseIfExpressionClauses ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
      this.setChild(
        "elseExpression",
        astNode.elseExpression ? createNodeFromJSON(astNode.elseExpression as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IIfElseExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      expression: (this.expression?.toJSON() as any) ?? null,
      elseIfExpressionClauses: this.elseIfExpressionClauses.map((c) => c.toJSON()) as any,
      elseExpression: (this.elseExpression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfElseExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IIfElseExpression | null): IfElseExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "IfElseExpression") return new IfElseExpression(cstNode, astNode);
    return null;
  }
}

export interface IElseIfExpressionClause extends ISyntaxNode {
  readonly "@type": "ElseIfExpressionClause";
  readonly condition: IExpression;
  readonly expression: IExpression;
}

export class ElseIfExpressionClause extends SyntaxNode implements IElseIfExpressionClause {
  readonly "@type" = "ElseIfExpressionClause" as const;

  /** Field: `condition` */
  get condition(): Expression {
    return this.lazyChild<Expression>("condition", () => {
      const c = this._cstNode?.childForFieldName("condition") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("condition")
        ? (this.alternate.getChild("condition") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IElseIfExpressionClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("condition");
    this._slotNames.add("expression");
    if (astNode) {
      this.setChild("condition", astNode.condition ? createNodeFromJSON(astNode.condition as any) : null);
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IElseIfExpressionClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      condition: (this.condition?.toJSON() as any) ?? null,
      expression: (this.expression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfExpressionClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IElseIfExpressionClause | null): ElseIfExpressionClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ElseIfExpressionClause") return new ElseIfExpressionClause(cstNode, astNode);
    return null;
  }
}

export interface IRangeExpression extends ISyntaxNode {
  readonly "@type": "RangeExpression";
  readonly startExpression: ISimpleExpression;
  readonly stepExpression: ISimpleExpression;
  readonly stopExpression: ISimpleExpression;
}

export class RangeExpression extends SyntaxNode implements IRangeExpression {
  readonly "@type" = "RangeExpression" as const;

  /** Field: `startExpression` */
  get startExpression(): SimpleExpression {
    return this.lazyChild<SimpleExpression>("startExpression", () => {
      const c = this._cstNode?.childForFieldName("startExpression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("startExpression")
        ? (this.alternate.getChild("startExpression") as SimpleExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | null;
    })!;
  }

  /** Field: `stepExpression` */
  get stepExpression(): SimpleExpression {
    return this.lazyChild<SimpleExpression>("stepExpression", () => {
      const c = this._cstNode?.childForFieldName("stepExpression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("stepExpression")
        ? (this.alternate.getChild("stepExpression") as SimpleExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | null;
    })!;
  }

  /** Field: `stopExpression` */
  get stopExpression(): SimpleExpression {
    return this.lazyChild<SimpleExpression>("stopExpression", () => {
      const c = this._cstNode?.childForFieldName("stopExpression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("stopExpression")
        ? (this.alternate.getChild("stopExpression") as SimpleExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IRangeExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("startExpression");
    this._slotNames.add("stepExpression");
    this._slotNames.add("stopExpression");
    if (astNode) {
      this.setChild(
        "startExpression",
        astNode.startExpression ? createNodeFromJSON(astNode.startExpression as any) : null,
      );
      this.setChild(
        "stepExpression",
        astNode.stepExpression ? createNodeFromJSON(astNode.stepExpression as any) : null,
      );
      this.setChild(
        "stopExpression",
        astNode.stopExpression ? createNodeFromJSON(astNode.stopExpression as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IRangeExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      startExpression: (this.startExpression?.toJSON() as any) ?? null,
      stepExpression: (this.stepExpression?.toJSON() as any) ?? null,
      stopExpression: (this.stopExpression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitRangeExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IRangeExpression | null): RangeExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "RangeExpression") return new RangeExpression(cstNode, astNode);
    return null;
  }
}

export interface IUnaryExpression extends ISyntaxNode {
  readonly "@type": "UnaryExpression";
  readonly operator: ISyntaxNode;
  readonly operand: ISimpleExpression;
}

export class UnaryExpression extends SyntaxNode implements IUnaryExpression {
  readonly "@type" = "UnaryExpression" as const;

  /** Field: `operator` */
  get operator(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("operator", () => {
      const c = this._cstNode?.childForFieldName("operator") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operator")
        ? (this.alternate.getChild("operator") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `operand` */
  get operand(): SimpleExpression {
    return this.lazyChild<SimpleExpression>("operand", () => {
      const c = this._cstNode?.childForFieldName("operand") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operand")
        ? (this.alternate.getChild("operand") as SimpleExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IUnaryExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("operator");
    this._slotNames.add("operand");
    if (astNode) {
      this.setChild("operator", astNode.operator ? createNodeFromJSON(astNode.operator as any) : null);
      this.setChild("operand", astNode.operand ? createNodeFromJSON(astNode.operand as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IUnaryExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      operator: (this.operator?.toJSON() as any) ?? null,
      operand: (this.operand?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnaryExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IUnaryExpression | null): UnaryExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "UnaryExpression") return new UnaryExpression(cstNode, astNode);
    return null;
  }
}

export interface IBinaryExpression extends ISyntaxNode {
  readonly "@type": "BinaryExpression";
  readonly operand1: ISimpleExpression | IPrimaryExpression;
  readonly operator: ISyntaxNode;
  readonly operand2: ISimpleExpression | IPrimaryExpression;
}

export class BinaryExpression extends SyntaxNode implements IBinaryExpression {
  readonly "@type" = "BinaryExpression" as const;

  /** Field: `operand1` */
  get operand1(): SimpleExpression | PrimaryExpression {
    return this.lazyChild<SimpleExpression | PrimaryExpression>("operand1", () => {
      const c = this._cstNode?.childForFieldName("operand1") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operand1")
        ? (this.alternate.getChild("operand1") as SimpleExpression | PrimaryExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | PrimaryExpression | null;
    })!;
  }

  /** Field: `operator` */
  get operator(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("operator", () => {
      const c = this._cstNode?.childForFieldName("operator") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operator")
        ? (this.alternate.getChild("operator") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `operand2` */
  get operand2(): SimpleExpression | PrimaryExpression {
    return this.lazyChild<SimpleExpression | PrimaryExpression>("operand2", () => {
      const c = this._cstNode?.childForFieldName("operand2") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("operand2")
        ? (this.alternate.getChild("operand2") as SimpleExpression | PrimaryExpression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SimpleExpression | PrimaryExpression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IBinaryExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("operand1");
    this._slotNames.add("operator");
    this._slotNames.add("operand2");
    if (astNode) {
      this.setChild("operand1", astNode.operand1 ? createNodeFromJSON(astNode.operand1 as any) : null);
      this.setChild("operator", astNode.operator ? createNodeFromJSON(astNode.operator as any) : null);
      this.setChild("operand2", astNode.operand2 ? createNodeFromJSON(astNode.operand2 as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IBinaryExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      operand1: (this.operand1?.toJSON() as any) ?? null,
      operator: (this.operator?.toJSON() as any) ?? null,
      operand2: (this.operand2?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBinaryExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IBinaryExpression | null): BinaryExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "BinaryExpression") return new BinaryExpression(cstNode, astNode);
    return null;
  }
}

export interface IEndExpression extends ISyntaxNode {
  readonly "@type": "EndExpression";
  readonly text: string;
}

export class EndExpression extends SyntaxNode implements IEndExpression {
  readonly "@type" = "EndExpression" as const;
  readonly text: string;

  constructor(cstNode?: TSNode | null, astNode?: IEndExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId);
    this.text = cstNode?.text ?? astNode?.text ?? "";
  }

  override get reconciliationKey(): string {
    return `EndExpression:${this.text}`;
  }

  protected override computeContentHash(): number {
    return fnv1a(this["@type"] + ":" + this.text);
  }
  protected override computeStructuralHash(): number {
    return fnv1a(this["@type"]);
  }

  override toJSON(): IEndExpression {
    return {
      "@type": this["@type"],
      text: this.text,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEndExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IEndExpression | null): EndExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "EndExpression") return new EndExpression(cstNode, astNode);
    return null;
  }
}

export interface ITypeSpecifier extends ISyntaxNode {
  readonly "@type": "TypeSpecifier";
  readonly global: ISyntaxNode | null;
  readonly name: IName;
}

export class TypeSpecifier extends SyntaxNode implements ITypeSpecifier {
  readonly "@type" = "TypeSpecifier" as const;

  /** Field: `global` */
  get global(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("global", () => {
      const c = this._cstNode?.childForFieldName("global") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("global")
        ? (this.alternate.getChild("global") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `name` */
  get name(): Name {
    return this.lazyChild<Name>("name", () => {
      const c = this._cstNode?.childForFieldName("name") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("name") ? (this.alternate.getChild("name") as Name | null) : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Name | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: ITypeSpecifier | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("global");
    this._slotNames.add("name");
    if (astNode) {
      this.setChild("global", astNode.global ? createNodeFromJSON(astNode.global as any) : null);
      this.setChild("name", astNode.name ? createNodeFromJSON(astNode.name as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override get reconciliationKey(): string {
    const n = this.getChild("name");
    return n ? `TypeSpecifier:${(n as any).text ?? ""}` : this["@type"];
  }

  override toJSON(): ITypeSpecifier {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      global: (this.global?.toJSON() as any) ?? null,
      name: (this.name?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitTypeSpecifier(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ITypeSpecifier | null): TypeSpecifier | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "TypeSpecifier") return new TypeSpecifier(cstNode, astNode);
    return null;
  }
}

export interface IName extends ISyntaxNode {
  readonly "@type": "Name";
  readonly parts: IIDENT[];
}

export class Name extends SyntaxNode implements IName {
  readonly "@type" = "Name" as const;

  /** Field: `part` */
  get parts(): IDENT[] {
    return this.lazyChildren<IDENT>("part", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("part") ?? [];
      const oldChildren = this.alternate?.isMaterialized("part") ? (this.alternate.getChildren("part") as IDENT[]) : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "part") as IDENT[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as IDENT[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IName | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("part");
    if (astNode) {
      this.setChildren("part", (astNode.parts ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IName {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      parts: this.parts.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitName(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IName | null): Name | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "Name") return new Name(cstNode, astNode);
    return null;
  }
}

export interface IComponentReference extends ISyntaxNode {
  readonly "@type": "ComponentReference";
  readonly global: ISyntaxNode | null;
  readonly parts: IComponentReferencePart[];
}

export class ComponentReference extends SyntaxNode implements IComponentReference {
  readonly "@type" = "ComponentReference" as const;

  /** Field: `global` */
  get global(): SyntaxNode | null {
    return this.lazyChild<SyntaxNode>("global", () => {
      const c = this._cstNode?.childForFieldName("global") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("global")
        ? (this.alternate.getChild("global") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    });
  }

  /** Field: `part` */
  get parts(): ComponentReferencePart[] {
    return this.lazyChildren<ComponentReferencePart>("part", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("part") ?? [];
      const oldChildren = this.alternate?.isMaterialized("part")
        ? (this.alternate.getChildren("part") as ComponentReferencePart[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "part") as ComponentReferencePart[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ComponentReferencePart[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentReference | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("global");
    this._slotNames.add("part");
    if (astNode) {
      this.setChild("global", astNode.global ? createNodeFromJSON(astNode.global as any) : null);
      this.setChildren("part", (astNode.parts ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentReference {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      global: (this.global?.toJSON() as any) ?? null,
      parts: this.parts.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReference(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentReference | null): ComponentReference | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentReference") return new ComponentReference(cstNode, astNode);
    return null;
  }
}

export interface IComponentReferencePart extends ISyntaxNode {
  readonly "@type": "ComponentReferencePart";
  readonly identifier: IIDENT;
  readonly arraySubscripts: IArraySubscripts | null;
}

export class ComponentReferencePart extends SyntaxNode implements IComponentReferencePart {
  readonly "@type" = "ComponentReferencePart" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `arraySubscripts` */
  get arraySubscripts(): ArraySubscripts | null {
    return this.lazyChild<ArraySubscripts>("arraySubscripts", () => {
      const c = this._cstNode?.childForFieldName("arraySubscripts") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arraySubscripts")
        ? (this.alternate.getChild("arraySubscripts") as ArraySubscripts | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ArraySubscripts | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComponentReferencePart | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("arraySubscripts");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild(
        "arraySubscripts",
        astNode.arraySubscripts ? createNodeFromJSON(astNode.arraySubscripts as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComponentReferencePart {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      arraySubscripts: (this.arraySubscripts?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReferencePart(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComponentReferencePart | null): ComponentReferencePart | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComponentReferencePart") return new ComponentReferencePart(cstNode, astNode);
    return null;
  }
}

export interface IFunctionCall extends ISyntaxNode {
  readonly "@type": "FunctionCall";
  readonly functionReference: IComponentReference | ISyntaxNode;
  readonly functionCallArguments: IFunctionCallArguments;
}

export class FunctionCall extends SyntaxNode implements IFunctionCall {
  readonly "@type" = "FunctionCall" as const;

  /** Field: `functionReference` */
  get functionReference(): ComponentReference | SyntaxNode {
    return this.lazyChild<ComponentReference | SyntaxNode>("functionReference", () => {
      const c = this._cstNode?.childForFieldName("functionReference") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionReference")
        ? (this.alternate.getChild("functionReference") as ComponentReference | SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComponentReference | SyntaxNode | null;
    })!;
  }

  /** Field: `functionCallArguments` */
  get functionCallArguments(): FunctionCallArguments {
    return this.lazyChild<FunctionCallArguments>("functionCallArguments", () => {
      const c = this._cstNode?.childForFieldName("functionCallArguments") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionCallArguments")
        ? (this.alternate.getChild("functionCallArguments") as FunctionCallArguments | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionCallArguments | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IFunctionCall | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("functionReference");
    this._slotNames.add("functionCallArguments");
    if (astNode) {
      this.setChild(
        "functionReference",
        astNode.functionReference ? createNodeFromJSON(astNode.functionReference as any) : null,
      );
      this.setChild(
        "functionCallArguments",
        astNode.functionCallArguments ? createNodeFromJSON(astNode.functionCallArguments as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IFunctionCall {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      functionReference: (this.functionReference?.toJSON() as any) ?? null,
      functionCallArguments: (this.functionCallArguments?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCall(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IFunctionCall | null): FunctionCall | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "FunctionCall") return new FunctionCall(cstNode, astNode);
    return null;
  }
}

export interface IFunctionCallArguments extends ISyntaxNode {
  readonly "@type": "FunctionCallArguments";
  readonly comprehensionClause: IComprehensionClause | null;
  readonly arguments: IFunctionArgument[];
  readonly namedArguments: INamedArgument[];
}

export class FunctionCallArguments extends SyntaxNode implements IFunctionCallArguments {
  readonly "@type" = "FunctionCallArguments" as const;

  /** Field: `comprehensionClause` */
  get comprehensionClause(): ComprehensionClause | null {
    return this.lazyChild<ComprehensionClause>("comprehensionClause", () => {
      const c = this._cstNode?.childForFieldName("comprehensionClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("comprehensionClause")
        ? (this.alternate.getChild("comprehensionClause") as ComprehensionClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComprehensionClause | null;
    });
  }

  /** Field: `argument` */
  get arguments(): FunctionArgument[] {
    return this.lazyChildren<FunctionArgument>("argument", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("argument") ?? [];
      const oldChildren = this.alternate?.isMaterialized("argument")
        ? (this.alternate.getChildren("argument") as FunctionArgument[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "argument") as FunctionArgument[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as FunctionArgument[];
    });
  }

  /** Field: `namedArgument` */
  get namedArguments(): NamedArgument[] {
    return this.lazyChildren<NamedArgument>("namedArgument", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("namedArgument") ?? [];
      const oldChildren = this.alternate?.isMaterialized("namedArgument")
        ? (this.alternate.getChildren("namedArgument") as NamedArgument[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "namedArgument") as NamedArgument[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as NamedArgument[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IFunctionCallArguments | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("comprehensionClause");
    this._slotNames.add("argument");
    this._slotNames.add("namedArgument");
    if (astNode) {
      this.setChild(
        "comprehensionClause",
        astNode.comprehensionClause ? createNodeFromJSON(astNode.comprehensionClause as any) : null,
      );
      this.setChildren("argument", (astNode.arguments ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
      this.setChildren(
        "namedArgument",
        (astNode.namedArguments ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IFunctionCallArguments {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      comprehensionClause: (this.comprehensionClause?.toJSON() as any) ?? null,
      arguments: this.arguments.map((c) => c.toJSON()) as any,
      namedArguments: this.namedArguments.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCallArguments(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IFunctionCallArguments | null): FunctionCallArguments | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "FunctionCallArguments") return new FunctionCallArguments(cstNode, astNode);
    return null;
  }
}

export interface IArrayConcatenation extends ISyntaxNode {
  readonly "@type": "ArrayConcatenation";
  readonly expressionLists: IExpressionList[];
}

export class ArrayConcatenation extends SyntaxNode implements IArrayConcatenation {
  readonly "@type" = "ArrayConcatenation" as const;

  /** Field: `expressionList` */
  get expressionLists(): ExpressionList[] {
    return this.lazyChildren<ExpressionList>("expressionList", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("expressionList") ?? [];
      const oldChildren = this.alternate?.isMaterialized("expressionList")
        ? (this.alternate.getChildren("expressionList") as ExpressionList[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "expressionList") as ExpressionList[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ExpressionList[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IArrayConcatenation | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expressionList");
    if (astNode) {
      this.setChildren(
        "expressionList",
        (astNode.expressionLists ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IArrayConcatenation {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expressionLists: this.expressionLists.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConcatenation(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IArrayConcatenation | null): ArrayConcatenation | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ArrayConcatenation") return new ArrayConcatenation(cstNode, astNode);
    return null;
  }
}

export interface IArrayConstructor extends ISyntaxNode {
  readonly "@type": "ArrayConstructor";
  readonly comprehensionClause: IComprehensionClause | null;
  readonly expressionList: IExpressionList | null;
}

export class ArrayConstructor extends SyntaxNode implements IArrayConstructor {
  readonly "@type" = "ArrayConstructor" as const;

  /** Field: `comprehensionClause` */
  get comprehensionClause(): ComprehensionClause | null {
    return this.lazyChild<ComprehensionClause>("comprehensionClause", () => {
      const c = this._cstNode?.childForFieldName("comprehensionClause") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("comprehensionClause")
        ? (this.alternate.getChild("comprehensionClause") as ComprehensionClause | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ComprehensionClause | null;
    });
  }

  /** Field: `expressionList` */
  get expressionList(): ExpressionList | null {
    return this.lazyChild<ExpressionList>("expressionList", () => {
      const c = this._cstNode?.childForFieldName("expressionList") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expressionList")
        ? (this.alternate.getChild("expressionList") as ExpressionList | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ExpressionList | null;
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IArrayConstructor | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("comprehensionClause");
    this._slotNames.add("expressionList");
    if (astNode) {
      this.setChild(
        "comprehensionClause",
        astNode.comprehensionClause ? createNodeFromJSON(astNode.comprehensionClause as any) : null,
      );
      this.setChild(
        "expressionList",
        astNode.expressionList ? createNodeFromJSON(astNode.expressionList as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IArrayConstructor {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      comprehensionClause: (this.comprehensionClause?.toJSON() as any) ?? null,
      expressionList: (this.expressionList?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConstructor(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IArrayConstructor | null): ArrayConstructor | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ArrayConstructor") return new ArrayConstructor(cstNode, astNode);
    return null;
  }
}

export interface IComprehensionClause extends ISyntaxNode {
  readonly "@type": "ComprehensionClause";
  readonly expression: IExpression;
  readonly forIndexs: IForIndex[];
}

export class ComprehensionClause extends SyntaxNode implements IComprehensionClause {
  readonly "@type" = "ComprehensionClause" as const;

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `forIndex` */
  get forIndexs(): ForIndex[] {
    return this.lazyChildren<ForIndex>("forIndex", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("forIndex") ?? [];
      const oldChildren = this.alternate?.isMaterialized("forIndex")
        ? (this.alternate.getChildren("forIndex") as ForIndex[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "forIndex") as ForIndex[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as ForIndex[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IComprehensionClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expression");
    this._slotNames.add("forIndex");
    if (astNode) {
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
      this.setChildren("forIndex", (astNode.forIndexs ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IComprehensionClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expression: (this.expression?.toJSON() as any) ?? null,
      forIndexs: this.forIndexs.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComprehensionClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IComprehensionClause | null): ComprehensionClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ComprehensionClause") return new ComprehensionClause(cstNode, astNode);
    return null;
  }
}

export interface INamedArgument extends ISyntaxNode {
  readonly "@type": "NamedArgument";
  readonly identifier: IIDENT;
  readonly argument: IFunctionArgument;
}

export class NamedArgument extends SyntaxNode implements INamedArgument {
  readonly "@type" = "NamedArgument" as const;

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  /** Field: `argument` */
  get argument(): FunctionArgument {
    return this.lazyChild<FunctionArgument>("argument", () => {
      const c = this._cstNode?.childForFieldName("argument") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("argument")
        ? (this.alternate.getChild("argument") as FunctionArgument | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionArgument | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: INamedArgument | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("identifier");
    this._slotNames.add("argument");
    if (astNode) {
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
      this.setChild("argument", astNode.argument ? createNodeFromJSON(astNode.argument as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): INamedArgument {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      identifier: (this.identifier?.toJSON() as any) ?? null,
      argument: (this.argument?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitNamedArgument(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: INamedArgument | null): NamedArgument | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "NamedArgument") return new NamedArgument(cstNode, astNode);
    return null;
  }
}

export interface IFunctionArgument extends ISyntaxNode {
  readonly "@type": "FunctionArgument";
  readonly expression: IExpression;
  readonly functionPartialApplication: IFunctionPartialApplication;
}

export class FunctionArgument extends SyntaxNode implements IFunctionArgument {
  readonly "@type" = "FunctionArgument" as const;

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  /** Field: `functionPartialApplication` */
  get functionPartialApplication(): FunctionPartialApplication {
    return this.lazyChild<FunctionPartialApplication>("functionPartialApplication", () => {
      const c = this._cstNode?.childForFieldName("functionPartialApplication") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("functionPartialApplication")
        ? (this.alternate.getChild("functionPartialApplication") as FunctionPartialApplication | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as FunctionPartialApplication | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IFunctionArgument | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expression");
    this._slotNames.add("functionPartialApplication");
    if (astNode) {
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
      this.setChild(
        "functionPartialApplication",
        astNode.functionPartialApplication ? createNodeFromJSON(astNode.functionPartialApplication as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IFunctionArgument {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expression: (this.expression?.toJSON() as any) ?? null,
      functionPartialApplication: (this.functionPartialApplication?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionArgument(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IFunctionArgument | null): FunctionArgument | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "FunctionArgument") return new FunctionArgument(cstNode, astNode);
    return null;
  }
}

export interface IFunctionPartialApplication extends ISyntaxNode {
  readonly "@type": "FunctionPartialApplication";
  readonly typeSpecifier: ITypeSpecifier;
  readonly namedArguments: INamedArgument[];
}

export class FunctionPartialApplication extends SyntaxNode implements IFunctionPartialApplication {
  readonly "@type" = "FunctionPartialApplication" as const;

  /** Field: `typeSpecifier` */
  get typeSpecifier(): TypeSpecifier {
    return this.lazyChild<TypeSpecifier>("typeSpecifier", () => {
      const c = this._cstNode?.childForFieldName("typeSpecifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("typeSpecifier")
        ? (this.alternate.getChild("typeSpecifier") as TypeSpecifier | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as TypeSpecifier | null;
    })!;
  }

  /** Field: `namedArgument` */
  get namedArguments(): NamedArgument[] {
    return this.lazyChildren<NamedArgument>("namedArgument", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("namedArgument") ?? [];
      const oldChildren = this.alternate?.isMaterialized("namedArgument")
        ? (this.alternate.getChildren("namedArgument") as NamedArgument[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "namedArgument") as NamedArgument[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as NamedArgument[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IFunctionPartialApplication | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("typeSpecifier");
    this._slotNames.add("namedArgument");
    if (astNode) {
      this.setChild("typeSpecifier", astNode.typeSpecifier ? createNodeFromJSON(astNode.typeSpecifier as any) : null);
      this.setChildren(
        "namedArgument",
        (astNode.namedArguments ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IFunctionPartialApplication {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      typeSpecifier: (this.typeSpecifier?.toJSON() as any) ?? null,
      namedArguments: this.namedArguments.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionPartialApplication(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IFunctionPartialApplication | null): FunctionPartialApplication | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "FunctionPartialApplication") return new FunctionPartialApplication(cstNode, astNode);
    return null;
  }
}

export interface IMemberAccessExpression extends ISyntaxNode {
  readonly "@type": "MemberAccessExpression";
  readonly outputExpressionList: IOutputExpressionList;
  readonly arraySubscripts: IArraySubscripts;
  readonly identifier: IIDENT;
}

export class MemberAccessExpression extends SyntaxNode implements IMemberAccessExpression {
  readonly "@type" = "MemberAccessExpression" as const;

  /** Field: `outputExpressionList` */
  get outputExpressionList(): OutputExpressionList {
    return this.lazyChild<OutputExpressionList>("outputExpressionList", () => {
      const c = this._cstNode?.childForFieldName("outputExpressionList") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("outputExpressionList")
        ? (this.alternate.getChild("outputExpressionList") as OutputExpressionList | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as OutputExpressionList | null;
    })!;
  }

  /** Field: `arraySubscripts` */
  get arraySubscripts(): ArraySubscripts {
    return this.lazyChild<ArraySubscripts>("arraySubscripts", () => {
      const c = this._cstNode?.childForFieldName("arraySubscripts") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("arraySubscripts")
        ? (this.alternate.getChild("arraySubscripts") as ArraySubscripts | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ArraySubscripts | null;
    })!;
  }

  /** Field: `identifier` */
  get identifier(): IDENT {
    return this.lazyChild<IDENT>("identifier", () => {
      const c = this._cstNode?.childForFieldName("identifier") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("identifier")
        ? (this.alternate.getChild("identifier") as IDENT | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as IDENT | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IMemberAccessExpression | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("outputExpressionList");
    this._slotNames.add("arraySubscripts");
    this._slotNames.add("identifier");
    if (astNode) {
      this.setChild(
        "outputExpressionList",
        astNode.outputExpressionList ? createNodeFromJSON(astNode.outputExpressionList as any) : null,
      );
      this.setChild(
        "arraySubscripts",
        astNode.arraySubscripts ? createNodeFromJSON(astNode.arraySubscripts as any) : null,
      );
      this.setChild("identifier", astNode.identifier ? createNodeFromJSON(astNode.identifier as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IMemberAccessExpression {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      outputExpressionList: (this.outputExpressionList?.toJSON() as any) ?? null,
      arraySubscripts: (this.arraySubscripts?.toJSON() as any) ?? null,
      identifier: (this.identifier?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitMemberAccessExpression(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IMemberAccessExpression | null): MemberAccessExpression | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "MemberAccessExpression") return new MemberAccessExpression(cstNode, astNode);
    return null;
  }
}

export interface IOutputExpressionList extends ISyntaxNode {
  readonly "@type": "OutputExpressionList";
  readonly outputs: IExpression[];
}

export class OutputExpressionList extends SyntaxNode implements IOutputExpressionList {
  readonly "@type" = "OutputExpressionList" as const;

  /** Field: `output` */
  get outputs(): Expression[] {
    return this.lazyChildren<Expression>("output", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("output") ?? [];
      const oldChildren = this.alternate?.isMaterialized("output")
        ? (this.alternate.getChildren("output") as Expression[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "output") as Expression[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Expression[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IOutputExpressionList | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("output");
    if (astNode) {
      this.setChildren("output", (astNode.outputs ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IOutputExpressionList {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      outputs: this.outputs.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitOutputExpressionList(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IOutputExpressionList | null): OutputExpressionList | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "OutputExpressionList") return new OutputExpressionList(cstNode, astNode);
    return null;
  }
}

export interface IExpressionList extends ISyntaxNode {
  readonly "@type": "ExpressionList";
  readonly expressions: IExpression[];
}

export class ExpressionList extends SyntaxNode implements IExpressionList {
  readonly "@type" = "ExpressionList" as const;

  /** Field: `expression` */
  get expressions(): Expression[] {
    return this.lazyChildren<Expression>("expression", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("expression") ?? [];
      const oldChildren = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChildren("expression") as Expression[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "expression") as Expression[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Expression[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IExpressionList | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("expression");
    if (astNode) {
      this.setChildren("expression", (astNode.expressions ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IExpressionList {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      expressions: this.expressions.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionList(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IExpressionList | null): ExpressionList | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ExpressionList") return new ExpressionList(cstNode, astNode);
    return null;
  }
}

export interface IArraySubscripts extends ISyntaxNode {
  readonly "@type": "ArraySubscripts";
  readonly subscripts: ISubscript[];
}

export class ArraySubscripts extends SyntaxNode implements IArraySubscripts {
  readonly "@type" = "ArraySubscripts" as const;

  /** Field: `subscript` */
  get subscripts(): Subscript[] {
    return this.lazyChildren<Subscript>("subscript", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("subscript") ?? [];
      const oldChildren = this.alternate?.isMaterialized("subscript")
        ? (this.alternate.getChildren("subscript") as Subscript[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "subscript") as Subscript[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as Subscript[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IArraySubscripts | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("subscript");
    if (astNode) {
      this.setChildren("subscript", (astNode.subscripts ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean));
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IArraySubscripts {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      subscripts: this.subscripts.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArraySubscripts(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IArraySubscripts | null): ArraySubscripts | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "ArraySubscripts") return new ArraySubscripts(cstNode, astNode);
    return null;
  }
}

export interface ISubscript extends ISyntaxNode {
  readonly "@type": "Subscript";
  readonly flexible: ISyntaxNode;
  readonly expression: IExpression;
}

export class Subscript extends SyntaxNode implements ISubscript {
  readonly "@type" = "Subscript" as const;

  /** Field: `flexible` */
  get flexible(): SyntaxNode {
    return this.lazyChild<SyntaxNode>("flexible", () => {
      const c = this._cstNode?.childForFieldName("flexible") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("flexible")
        ? (this.alternate.getChild("flexible") as SyntaxNode | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as SyntaxNode | null;
    })!;
  }

  /** Field: `expression` */
  get expression(): Expression {
    return this.lazyChild<Expression>("expression", () => {
      const c = this._cstNode?.childForFieldName("expression") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("expression")
        ? (this.alternate.getChild("expression") as Expression | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as Expression | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: ISubscript | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("flexible");
    this._slotNames.add("expression");
    if (astNode) {
      this.setChild("flexible", astNode.flexible ? createNodeFromJSON(astNode.flexible as any) : null);
      this.setChild("expression", astNode.expression ? createNodeFromJSON(astNode.expression as any) : null);
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISubscript {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      flexible: (this.flexible?.toJSON() as any) ?? null,
      expression: (this.expression?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSubscript(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISubscript | null): Subscript | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "Subscript") return new Subscript(cstNode, astNode);
    return null;
  }
}

export interface IDescription extends ISyntaxNode {
  readonly "@type": "Description";
  readonly descriptionStrings: ISTRING[];
}

export class Description extends SyntaxNode implements IDescription {
  readonly "@type" = "Description" as const;

  /** Field: `descriptionString` */
  get descriptionStrings(): STRING[] {
    return this.lazyChildren<STRING>("descriptionString", () => {
      const cstChildren = this._cstNode?.childrenForFieldName("descriptionString") ?? [];
      const oldChildren = this.alternate?.isMaterialized("descriptionString")
        ? (this.alternate.getChildren("descriptionString") as STRING[])
        : [];
      if (oldChildren.length > 0) {
        return reconcileArray(oldChildren, cstChildren, this, "descriptionString") as STRING[];
      }
      return cstChildren.map((c) => createNode(c)!).filter(Boolean) as STRING[];
    });
  }

  constructor(cstNode?: TSNode | null, astNode?: IDescription | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("descriptionString");
    if (astNode) {
      this.setChildren(
        "descriptionString",
        (astNode.descriptionStrings ?? []).map((a) => createNodeFromJSON(a)!).filter(Boolean),
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IDescription {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      descriptionStrings: this.descriptionStrings.map((c) => c.toJSON()) as any,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDescription(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IDescription | null): Description | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "Description") return new Description(cstNode, astNode);
    return null;
  }
}

export interface IAnnotationClause extends ISyntaxNode {
  readonly "@type": "AnnotationClause";
  readonly classModification: IClassModification;
}

export class AnnotationClause extends SyntaxNode implements IAnnotationClause {
  readonly "@type" = "AnnotationClause" as const;

  /** Field: `classModification` */
  get classModification(): ClassModification {
    return this.lazyChild<ClassModification>("classModification", () => {
      const c = this._cstNode?.childForFieldName("classModification") ?? null;
      if (!c) return null;
      const old = this.alternate?.isMaterialized("classModification")
        ? (this.alternate.getChild("classModification") as ClassModification | null)
        : null;
      if (old && !c.hasChanges) {
        old.updateCST(c);
        return old;
      }
      return createNode(c) as ClassModification | null;
    })!;
  }

  constructor(cstNode?: TSNode | null, astNode?: IAnnotationClause | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    this._slotNames.add("classModification");
    if (astNode) {
      this.setChild(
        "classModification",
        astNode.classModification ? createNodeFromJSON(astNode.classModification as any) : null,
      );
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IAnnotationClause {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
      classModification: (this.classModification?.toJSON() as any) ?? null,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAnnotationClause(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IAnnotationClause | null): AnnotationClause | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "AnnotationClause") return new AnnotationClause(cstNode, astNode);
    return null;
  }
}

export interface IBOOLEAN extends ISyntaxNode {
  readonly "@type": "BOOLEAN";
  readonly text: string;
}

export class BOOLEAN extends SyntaxNode implements IBOOLEAN {
  readonly "@type" = "BOOLEAN" as const;
  readonly text: string;

  constructor(cstNode?: TSNode | null, astNode?: IBOOLEAN | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId);
    this.text = cstNode?.text ?? astNode?.text ?? "";
  }

  override get reconciliationKey(): string {
    return `BOOLEAN:${this.text}`;
  }

  protected override computeContentHash(): number {
    return fnv1a(this["@type"] + ":" + this.text);
  }
  protected override computeStructuralHash(): number {
    return fnv1a(this["@type"]);
  }

  override toJSON(): IBOOLEAN {
    return {
      "@type": this["@type"],
      text: this.text,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBOOLEAN(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IBOOLEAN | null): BOOLEAN | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "BOOLEAN") return new BOOLEAN(cstNode, astNode);
    return null;
  }
}

export interface IIDENT extends ISyntaxNode {
  readonly "@type": "IDENT";
}

export class IDENT extends SyntaxNode implements IIDENT {
  readonly "@type" = "IDENT" as const;

  constructor(cstNode?: TSNode | null, astNode?: IIDENT | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    if (astNode) {
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IIDENT {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIDENT(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IIDENT | null): IDENT | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "IDENT") return new IDENT(cstNode, astNode);
    return null;
  }
}

export interface ISTRING extends ISyntaxNode {
  readonly "@type": "STRING";
}

export class STRING extends SyntaxNode implements ISTRING {
  readonly "@type" = "STRING" as const;

  constructor(cstNode?: TSNode | null, astNode?: ISTRING | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    if (astNode) {
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ISTRING {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSTRING(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ISTRING | null): STRING | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "STRING") return new STRING(cstNode, astNode);
    return null;
  }
}

export interface IUNSIGNEDINTEGER extends ISyntaxNode {
  readonly "@type": "UNSIGNED_INTEGER";
  readonly text: string;
}

export class UNSIGNEDINTEGER extends SyntaxNode implements IUNSIGNEDINTEGER {
  readonly "@type" = "UNSIGNED_INTEGER" as const;
  readonly text: string;

  constructor(cstNode?: TSNode | null, astNode?: IUNSIGNEDINTEGER | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId);
    this.text = cstNode?.text ?? astNode?.text ?? "";
  }

  override get reconciliationKey(): string {
    return `UNSIGNED_INTEGER:${this.text}`;
  }

  protected override computeContentHash(): number {
    return fnv1a(this["@type"] + ":" + this.text);
  }
  protected override computeStructuralHash(): number {
    return fnv1a(this["@type"]);
  }

  override toJSON(): IUNSIGNEDINTEGER {
    return {
      "@type": this["@type"],
      text: this.text,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUNSIGNEDINTEGER(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IUNSIGNEDINTEGER | null): UNSIGNEDINTEGER | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "UNSIGNED_INTEGER") return new UNSIGNEDINTEGER(cstNode, astNode);
    return null;
  }
}

export interface IUNSIGNEDREAL extends ISyntaxNode {
  readonly "@type": "UNSIGNED_REAL";
}

export class UNSIGNEDREAL extends SyntaxNode implements IUNSIGNEDREAL {
  readonly "@type" = "UNSIGNED_REAL" as const;

  constructor(cstNode?: TSNode | null, astNode?: IUNSIGNEDREAL | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    if (astNode) {
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IUNSIGNEDREAL {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUNSIGNEDREAL(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IUNSIGNEDREAL | null): UNSIGNEDREAL | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "UNSIGNED_REAL") return new UNSIGNEDREAL(cstNode, astNode);
    return null;
  }
}

export interface IBLOCKCOMMENT extends ISyntaxNode {
  readonly "@type": "BLOCK_COMMENT";
}

export class BLOCKCOMMENT extends SyntaxNode implements IBLOCKCOMMENT {
  readonly "@type" = "BLOCK_COMMENT" as const;

  constructor(cstNode?: TSNode | null, astNode?: IBLOCKCOMMENT | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    if (astNode) {
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): IBLOCKCOMMENT {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBLOCKCOMMENT(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IBLOCKCOMMENT | null): BLOCKCOMMENT | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "BLOCK_COMMENT") return new BLOCKCOMMENT(cstNode, astNode);
    return null;
  }
}

export interface ILINECOMMENT extends ISyntaxNode {
  readonly "@type": "LINE_COMMENT";
}

export class LINECOMMENT extends SyntaxNode implements ILINECOMMENT {
  readonly "@type" = "LINE_COMMENT" as const;

  constructor(cstNode?: TSNode | null, astNode?: ILINECOMMENT | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId, cstNode);
    if (astNode) {
    }
    // CST path: children are NOT constructed here — lazy getters handle it
  }

  override toJSON(): ILINECOMMENT {
    return {
      "@type": this["@type"],
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLINECOMMENT(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: ILINECOMMENT | null): LINECOMMENT | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "LINE_COMMENT") return new LINECOMMENT(cstNode, astNode);
    return null;
  }
}

export interface IBOM extends ISyntaxNode {
  readonly "@type": "BOM";
  readonly text: string;
}

export class BOM extends SyntaxNode implements IBOM {
  readonly "@type" = "BOM" as const;
  readonly text: string;

  constructor(cstNode?: TSNode | null, astNode?: IBOM | null) {
    super(cstNode ? sourceRangeFrom(cstNode) : (astNode?.sourceRange ?? null), astNode?.nodeId);
    this.text = cstNode?.text ?? astNode?.text ?? "";
  }

  override get reconciliationKey(): string {
    return `BOM:${this.text}`;
  }

  protected override computeContentHash(): number {
    return fnv1a(this["@type"] + ":" + this.text);
  }
  protected override computeStructuralHash(): number {
    return fnv1a(this["@type"]);
  }

  override toJSON(): IBOM {
    return {
      "@type": this["@type"],
      text: this.text,
      sourceRange: this.sourceRange,
      contentHash: this.contentHash,
      structuralHash: this.structuralHash,
    };
  }

  accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBOM(this, argument);
  }

  static new(cstNode?: TSNode | null, astNode?: IBOM | null): BOM | null {
    const type = cstNode?.type ?? astNode?.["@type"];
    if (type === "BOM") return new BOM(cstNode, astNode);
    return null;
  }
}

// ─── Node Factories ─────────────────────────────────────────────────────────

const NODE_FACTORIES: Record<string, (cstNode: TSNode) => SyntaxNode> = {
  StoredDefinition: (c) => new StoredDefinition(c),
  WithinDirective: (c) => new WithinDirective(c),
  ClassDefinition: (c) => new ClassDefinition(c),
  ClassPrefixes: (c) => new ClassPrefixes(c),
  LongClassSpecifier: (c) => new LongClassSpecifier(c),
  ShortClassSpecifier: (c) => new ShortClassSpecifier(c),
  DerClassSpecifier: (c) => new DerClassSpecifier(c),
  EnumerationLiteral: (c) => new EnumerationLiteral(c),
  ExternalFunctionClause: (c) => new ExternalFunctionClause(c),
  LanguageSpecification: (c) => new LanguageSpecification(c),
  ExternalFunctionCall: (c) => new ExternalFunctionCall(c),
  InitialElementSection: (c) => new InitialElementSection(c),
  ElementSection: (c) => new ElementSection(c),
  ElementAnnotation: (c) => new ElementAnnotation(c),
  SimpleImportClause: (c) => new SimpleImportClause(c),
  CompoundImportClause: (c) => new CompoundImportClause(c),
  UnqualifiedImportClause: (c) => new UnqualifiedImportClause(c),
  ExtendsClause: (c) => new ExtendsClause(c),
  ConstrainingClause: (c) => new ConstrainingClause(c),
  ClassOrInheritanceModification: (c) => new ClassOrInheritanceModification(c),
  InheritanceModification: (c) => new InheritanceModification(c),
  ComponentClause: (c) => new ComponentClause(c),
  ComponentDeclaration: (c) => new ComponentDeclaration(c),
  ConditionAttribute: (c) => new ConditionAttribute(c),
  Declaration: (c) => new Declaration(c),
  Modification: (c) => new Modification(c),
  ModificationExpression: (c) => new ModificationExpression(c),
  ClassModification: (c) => new ClassModification(c),
  ElementModification: (c) => new ElementModification(c),
  ElementRedeclaration: (c) => new ElementRedeclaration(c),
  ComponentClause1: (c) => new ComponentClause1(c),
  ComponentDeclaration1: (c) => new ComponentDeclaration1(c),
  ShortClassDefinition: (c) => new ShortClassDefinition(c),
  EquationSection: (c) => new EquationSection(c),
  AlgorithmSection: (c) => new AlgorithmSection(c),
  ConstraintSection: (c) => new ConstraintSection(c),
  SimpleAssignmentStatement: (c) => new SimpleAssignmentStatement(c),
  ProcedureCallStatement: (c) => new ProcedureCallStatement(c),
  ComplexAssignmentStatement: (c) => new ComplexAssignmentStatement(c),
  SimpleEquation: (c) => new SimpleEquation(c),
  SpecialEquation: (c) => new SpecialEquation(c),
  BreakStatement: (c) => new BreakStatement(c),
  ReturnStatement: (c) => new ReturnStatement(c),
  IfEquation: (c) => new IfEquation(c),
  ElseIfEquationClause: (c) => new ElseIfEquationClause(c),
  IfStatement: (c) => new IfStatement(c),
  ElseIfStatementClause: (c) => new ElseIfStatementClause(c),
  ForEquation: (c) => new ForEquation(c),
  ForStatement: (c) => new ForStatement(c),
  ForIndex: (c) => new ForIndex(c),
  WhileStatement: (c) => new WhileStatement(c),
  WhenEquation: (c) => new WhenEquation(c),
  ElseWhenEquationClause: (c) => new ElseWhenEquationClause(c),
  WhenStatement: (c) => new WhenStatement(c),
  ElseWhenStatementClause: (c) => new ElseWhenStatementClause(c),
  ConnectEquation: (c) => new ConnectEquation(c),
  IfElseExpression: (c) => new IfElseExpression(c),
  ElseIfExpressionClause: (c) => new ElseIfExpressionClause(c),
  RangeExpression: (c) => new RangeExpression(c),
  UnaryExpression: (c) => new UnaryExpression(c),
  BinaryExpression: (c) => new BinaryExpression(c),
  EndExpression: (c) => new EndExpression(c),
  TypeSpecifier: (c) => new TypeSpecifier(c),
  Name: (c) => new Name(c),
  ComponentReference: (c) => new ComponentReference(c),
  ComponentReferencePart: (c) => new ComponentReferencePart(c),
  FunctionCall: (c) => new FunctionCall(c),
  FunctionCallArguments: (c) => new FunctionCallArguments(c),
  ArrayConcatenation: (c) => new ArrayConcatenation(c),
  ArrayConstructor: (c) => new ArrayConstructor(c),
  ComprehensionClause: (c) => new ComprehensionClause(c),
  NamedArgument: (c) => new NamedArgument(c),
  FunctionArgument: (c) => new FunctionArgument(c),
  FunctionPartialApplication: (c) => new FunctionPartialApplication(c),
  MemberAccessExpression: (c) => new MemberAccessExpression(c),
  OutputExpressionList: (c) => new OutputExpressionList(c),
  ExpressionList: (c) => new ExpressionList(c),
  ArraySubscripts: (c) => new ArraySubscripts(c),
  Subscript: (c) => new Subscript(c),
  Description: (c) => new Description(c),
  AnnotationClause: (c) => new AnnotationClause(c),
  BOOLEAN: (c) => new BOOLEAN(c),
  IDENT: (c) => new IDENT(c),
  STRING: (c) => new STRING(c),
  UNSIGNED_INTEGER: (c) => new UNSIGNEDINTEGER(c),
  UNSIGNED_REAL: (c) => new UNSIGNEDREAL(c),
  BLOCK_COMMENT: (c) => new BLOCKCOMMENT(c),
  LINE_COMMENT: (c) => new LINECOMMENT(c),
  BOM: (c) => new BOM(c),
};

const JSON_FACTORIES: Record<string, (a: ISyntaxNode) => SyntaxNode> = {
  StoredDefinition: (a) => new StoredDefinition(null, a as IStoredDefinition),
  WithinDirective: (a) => new WithinDirective(null, a as IWithinDirective),
  ClassDefinition: (a) => new ClassDefinition(null, a as IClassDefinition),
  ClassPrefixes: (a) => new ClassPrefixes(null, a as IClassPrefixes),
  LongClassSpecifier: (a) => new LongClassSpecifier(null, a as ILongClassSpecifier),
  ShortClassSpecifier: (a) => new ShortClassSpecifier(null, a as IShortClassSpecifier),
  DerClassSpecifier: (a) => new DerClassSpecifier(null, a as IDerClassSpecifier),
  EnumerationLiteral: (a) => new EnumerationLiteral(null, a as IEnumerationLiteral),
  ExternalFunctionClause: (a) => new ExternalFunctionClause(null, a as IExternalFunctionClause),
  LanguageSpecification: (a) => new LanguageSpecification(null, a as ILanguageSpecification),
  ExternalFunctionCall: (a) => new ExternalFunctionCall(null, a as IExternalFunctionCall),
  InitialElementSection: (a) => new InitialElementSection(null, a as IInitialElementSection),
  ElementSection: (a) => new ElementSection(null, a as IElementSection),
  ElementAnnotation: (a) => new ElementAnnotation(null, a as IElementAnnotation),
  SimpleImportClause: (a) => new SimpleImportClause(null, a as ISimpleImportClause),
  CompoundImportClause: (a) => new CompoundImportClause(null, a as ICompoundImportClause),
  UnqualifiedImportClause: (a) => new UnqualifiedImportClause(null, a as IUnqualifiedImportClause),
  ExtendsClause: (a) => new ExtendsClause(null, a as IExtendsClause),
  ConstrainingClause: (a) => new ConstrainingClause(null, a as IConstrainingClause),
  ClassOrInheritanceModification: (a) => new ClassOrInheritanceModification(null, a as IClassOrInheritanceModification),
  InheritanceModification: (a) => new InheritanceModification(null, a as IInheritanceModification),
  ComponentClause: (a) => new ComponentClause(null, a as IComponentClause),
  ComponentDeclaration: (a) => new ComponentDeclaration(null, a as IComponentDeclaration),
  ConditionAttribute: (a) => new ConditionAttribute(null, a as IConditionAttribute),
  Declaration: (a) => new Declaration(null, a as IDeclaration),
  Modification: (a) => new Modification(null, a as IModification),
  ModificationExpression: (a) => new ModificationExpression(null, a as IModificationExpression),
  ClassModification: (a) => new ClassModification(null, a as IClassModification),
  ElementModification: (a) => new ElementModification(null, a as IElementModification),
  ElementRedeclaration: (a) => new ElementRedeclaration(null, a as IElementRedeclaration),
  ComponentClause1: (a) => new ComponentClause1(null, a as IComponentClause1),
  ComponentDeclaration1: (a) => new ComponentDeclaration1(null, a as IComponentDeclaration1),
  ShortClassDefinition: (a) => new ShortClassDefinition(null, a as IShortClassDefinition),
  EquationSection: (a) => new EquationSection(null, a as IEquationSection),
  AlgorithmSection: (a) => new AlgorithmSection(null, a as IAlgorithmSection),
  ConstraintSection: (a) => new ConstraintSection(null, a as IConstraintSection),
  SimpleAssignmentStatement: (a) => new SimpleAssignmentStatement(null, a as ISimpleAssignmentStatement),
  ProcedureCallStatement: (a) => new ProcedureCallStatement(null, a as IProcedureCallStatement),
  ComplexAssignmentStatement: (a) => new ComplexAssignmentStatement(null, a as IComplexAssignmentStatement),
  SimpleEquation: (a) => new SimpleEquation(null, a as ISimpleEquation),
  SpecialEquation: (a) => new SpecialEquation(null, a as ISpecialEquation),
  BreakStatement: (a) => new BreakStatement(null, a as IBreakStatement),
  ReturnStatement: (a) => new ReturnStatement(null, a as IReturnStatement),
  IfEquation: (a) => new IfEquation(null, a as IIfEquation),
  ElseIfEquationClause: (a) => new ElseIfEquationClause(null, a as IElseIfEquationClause),
  IfStatement: (a) => new IfStatement(null, a as IIfStatement),
  ElseIfStatementClause: (a) => new ElseIfStatementClause(null, a as IElseIfStatementClause),
  ForEquation: (a) => new ForEquation(null, a as IForEquation),
  ForStatement: (a) => new ForStatement(null, a as IForStatement),
  ForIndex: (a) => new ForIndex(null, a as IForIndex),
  WhileStatement: (a) => new WhileStatement(null, a as IWhileStatement),
  WhenEquation: (a) => new WhenEquation(null, a as IWhenEquation),
  ElseWhenEquationClause: (a) => new ElseWhenEquationClause(null, a as IElseWhenEquationClause),
  WhenStatement: (a) => new WhenStatement(null, a as IWhenStatement),
  ElseWhenStatementClause: (a) => new ElseWhenStatementClause(null, a as IElseWhenStatementClause),
  ConnectEquation: (a) => new ConnectEquation(null, a as IConnectEquation),
  IfElseExpression: (a) => new IfElseExpression(null, a as IIfElseExpression),
  ElseIfExpressionClause: (a) => new ElseIfExpressionClause(null, a as IElseIfExpressionClause),
  RangeExpression: (a) => new RangeExpression(null, a as IRangeExpression),
  UnaryExpression: (a) => new UnaryExpression(null, a as IUnaryExpression),
  BinaryExpression: (a) => new BinaryExpression(null, a as IBinaryExpression),
  EndExpression: (a) => new EndExpression(null, a as IEndExpression),
  TypeSpecifier: (a) => new TypeSpecifier(null, a as ITypeSpecifier),
  Name: (a) => new Name(null, a as IName),
  ComponentReference: (a) => new ComponentReference(null, a as IComponentReference),
  ComponentReferencePart: (a) => new ComponentReferencePart(null, a as IComponentReferencePart),
  FunctionCall: (a) => new FunctionCall(null, a as IFunctionCall),
  FunctionCallArguments: (a) => new FunctionCallArguments(null, a as IFunctionCallArguments),
  ArrayConcatenation: (a) => new ArrayConcatenation(null, a as IArrayConcatenation),
  ArrayConstructor: (a) => new ArrayConstructor(null, a as IArrayConstructor),
  ComprehensionClause: (a) => new ComprehensionClause(null, a as IComprehensionClause),
  NamedArgument: (a) => new NamedArgument(null, a as INamedArgument),
  FunctionArgument: (a) => new FunctionArgument(null, a as IFunctionArgument),
  FunctionPartialApplication: (a) => new FunctionPartialApplication(null, a as IFunctionPartialApplication),
  MemberAccessExpression: (a) => new MemberAccessExpression(null, a as IMemberAccessExpression),
  OutputExpressionList: (a) => new OutputExpressionList(null, a as IOutputExpressionList),
  ExpressionList: (a) => new ExpressionList(null, a as IExpressionList),
  ArraySubscripts: (a) => new ArraySubscripts(null, a as IArraySubscripts),
  Subscript: (a) => new Subscript(null, a as ISubscript),
  Description: (a) => new Description(null, a as IDescription),
  AnnotationClause: (a) => new AnnotationClause(null, a as IAnnotationClause),
  BOOLEAN: (a) => new BOOLEAN(null, a as IBOOLEAN),
  IDENT: (a) => new IDENT(null, a as IIDENT),
  STRING: (a) => new STRING(null, a as ISTRING),
  UNSIGNED_INTEGER: (a) => new UNSIGNEDINTEGER(null, a as IUNSIGNEDINTEGER),
  UNSIGNED_REAL: (a) => new UNSIGNEDREAL(null, a as IUNSIGNEDREAL),
  BLOCK_COMMENT: (a) => new BLOCKCOMMENT(null, a as IBLOCKCOMMENT),
  LINE_COMMENT: (a) => new LINECOMMENT(null, a as ILINECOMMENT),
  BOM: (a) => new BOM(null, a as IBOM),
};

/**
 * Create an AST node from a tree-sitter CST node.
 * Returns null for unrecognized node types.
 */
export function createNode(cstNode: TSNode): SyntaxNode | null {
  const factory = NODE_FACTORIES[cstNode.type];
  return factory ? factory(cstNode) : null;
}

/**
 * Create an AST node from a serialized JSON object (ISyntaxNode).
 * Returns null for unrecognized `@type` values.
 */
export function createNodeFromJSON(astNode: ISyntaxNode): SyntaxNode | null {
  const factory = JSON_FACTORIES[astNode["@type"]];
  return factory ? factory(astNode) : null;
}

/**
 * Build a complete AST from a tree-sitter parse tree root.
 */
export function buildAST(rootCST: TSNode): StoredDefinition | null {
  if (rootCST.type !== "StoredDefinition") return null;
  return new StoredDefinition(rootCST);
}

/**
 * Build a complete AST from a serialized JSON root.
 */
export function buildASTFromJSON(json: IStoredDefinition): StoredDefinition | null {
  if (json["@type"] !== "StoredDefinition") return null;
  return new StoredDefinition(null, json);
}

/**
 * Incrementally reconcile an existing AST with a new CST.
 * Main entry point for the Hybrid Fiber Architecture.
 * Returns the reconciled AST and a list of change events.
 */
export function reconcileAST(oldAST: StoredDefinition, newCST: TSNode): ReconcileResult {
  if (newCST.type !== "StoredDefinition") {
    throw new Error(`Expected StoredDefinition CST root, got: ${newCST.type}`);
  }
  const collector = new ChangeCollector();
  if (!newCST.hasChanges) {
    oldAST.updateSourceRange(newCST);
    return { ast: oldAST, events: collector.events };
  }
  oldAST.markDirty();
  oldAST.reconcileChildren(newCST, collector);
  return { ast: oldAST, events: collector.events };
}

// ─── Visitor Pattern ────────────────────────────────────────────────────────

export interface IModelicaSyntaxVisitor<R, A> {
  visitStoredDefinition(node: StoredDefinition, argument?: A): R;
  visitWithinDirective(node: WithinDirective, argument?: A): R;
  visitClassDefinition(node: ClassDefinition, argument?: A): R;
  visitClassPrefixes(node: ClassPrefixes, argument?: A): R;
  visitLongClassSpecifier(node: LongClassSpecifier, argument?: A): R;
  visitShortClassSpecifier(node: ShortClassSpecifier, argument?: A): R;
  visitDerClassSpecifier(node: DerClassSpecifier, argument?: A): R;
  visitEnumerationLiteral(node: EnumerationLiteral, argument?: A): R;
  visitExternalFunctionClause(node: ExternalFunctionClause, argument?: A): R;
  visitLanguageSpecification(node: LanguageSpecification, argument?: A): R;
  visitExternalFunctionCall(node: ExternalFunctionCall, argument?: A): R;
  visitInitialElementSection(node: InitialElementSection, argument?: A): R;
  visitElementSection(node: ElementSection, argument?: A): R;
  visitElementAnnotation(node: ElementAnnotation, argument?: A): R;
  visitSimpleImportClause(node: SimpleImportClause, argument?: A): R;
  visitCompoundImportClause(node: CompoundImportClause, argument?: A): R;
  visitUnqualifiedImportClause(node: UnqualifiedImportClause, argument?: A): R;
  visitExtendsClause(node: ExtendsClause, argument?: A): R;
  visitConstrainingClause(node: ConstrainingClause, argument?: A): R;
  visitClassOrInheritanceModification(node: ClassOrInheritanceModification, argument?: A): R;
  visitInheritanceModification(node: InheritanceModification, argument?: A): R;
  visitComponentClause(node: ComponentClause, argument?: A): R;
  visitComponentDeclaration(node: ComponentDeclaration, argument?: A): R;
  visitConditionAttribute(node: ConditionAttribute, argument?: A): R;
  visitDeclaration(node: Declaration, argument?: A): R;
  visitModification(node: Modification, argument?: A): R;
  visitModificationExpression(node: ModificationExpression, argument?: A): R;
  visitClassModification(node: ClassModification, argument?: A): R;
  visitElementModification(node: ElementModification, argument?: A): R;
  visitElementRedeclaration(node: ElementRedeclaration, argument?: A): R;
  visitComponentClause1(node: ComponentClause1, argument?: A): R;
  visitComponentDeclaration1(node: ComponentDeclaration1, argument?: A): R;
  visitShortClassDefinition(node: ShortClassDefinition, argument?: A): R;
  visitEquationSection(node: EquationSection, argument?: A): R;
  visitAlgorithmSection(node: AlgorithmSection, argument?: A): R;
  visitConstraintSection(node: ConstraintSection, argument?: A): R;
  visitSimpleAssignmentStatement(node: SimpleAssignmentStatement, argument?: A): R;
  visitProcedureCallStatement(node: ProcedureCallStatement, argument?: A): R;
  visitComplexAssignmentStatement(node: ComplexAssignmentStatement, argument?: A): R;
  visitSimpleEquation(node: SimpleEquation, argument?: A): R;
  visitSpecialEquation(node: SpecialEquation, argument?: A): R;
  visitBreakStatement(node: BreakStatement, argument?: A): R;
  visitReturnStatement(node: ReturnStatement, argument?: A): R;
  visitIfEquation(node: IfEquation, argument?: A): R;
  visitElseIfEquationClause(node: ElseIfEquationClause, argument?: A): R;
  visitIfStatement(node: IfStatement, argument?: A): R;
  visitElseIfStatementClause(node: ElseIfStatementClause, argument?: A): R;
  visitForEquation(node: ForEquation, argument?: A): R;
  visitForStatement(node: ForStatement, argument?: A): R;
  visitForIndex(node: ForIndex, argument?: A): R;
  visitWhileStatement(node: WhileStatement, argument?: A): R;
  visitWhenEquation(node: WhenEquation, argument?: A): R;
  visitElseWhenEquationClause(node: ElseWhenEquationClause, argument?: A): R;
  visitWhenStatement(node: WhenStatement, argument?: A): R;
  visitElseWhenStatementClause(node: ElseWhenStatementClause, argument?: A): R;
  visitConnectEquation(node: ConnectEquation, argument?: A): R;
  visitIfElseExpression(node: IfElseExpression, argument?: A): R;
  visitElseIfExpressionClause(node: ElseIfExpressionClause, argument?: A): R;
  visitRangeExpression(node: RangeExpression, argument?: A): R;
  visitUnaryExpression(node: UnaryExpression, argument?: A): R;
  visitBinaryExpression(node: BinaryExpression, argument?: A): R;
  visitEndExpression(node: EndExpression, argument?: A): R;
  visitTypeSpecifier(node: TypeSpecifier, argument?: A): R;
  visitName(node: Name, argument?: A): R;
  visitComponentReference(node: ComponentReference, argument?: A): R;
  visitComponentReferencePart(node: ComponentReferencePart, argument?: A): R;
  visitFunctionCall(node: FunctionCall, argument?: A): R;
  visitFunctionCallArguments(node: FunctionCallArguments, argument?: A): R;
  visitArrayConcatenation(node: ArrayConcatenation, argument?: A): R;
  visitArrayConstructor(node: ArrayConstructor, argument?: A): R;
  visitComprehensionClause(node: ComprehensionClause, argument?: A): R;
  visitNamedArgument(node: NamedArgument, argument?: A): R;
  visitFunctionArgument(node: FunctionArgument, argument?: A): R;
  visitFunctionPartialApplication(node: FunctionPartialApplication, argument?: A): R;
  visitMemberAccessExpression(node: MemberAccessExpression, argument?: A): R;
  visitOutputExpressionList(node: OutputExpressionList, argument?: A): R;
  visitExpressionList(node: ExpressionList, argument?: A): R;
  visitArraySubscripts(node: ArraySubscripts, argument?: A): R;
  visitSubscript(node: Subscript, argument?: A): R;
  visitDescription(node: Description, argument?: A): R;
  visitAnnotationClause(node: AnnotationClause, argument?: A): R;
  visitBOOLEAN(node: BOOLEAN, argument?: A): R;
  visitIDENT(node: IDENT, argument?: A): R;
  visitSTRING(node: STRING, argument?: A): R;
  visitUNSIGNEDINTEGER(node: UNSIGNEDINTEGER, argument?: A): R;
  visitUNSIGNEDREAL(node: UNSIGNEDREAL, argument?: A): R;
  visitBLOCKCOMMENT(node: BLOCKCOMMENT, argument?: A): R;
  visitLINECOMMENT(node: LINECOMMENT, argument?: A): R;
  visitBOM(node: BOM, argument?: A): R;
}

/**
 * Default visitor that walks all children in source order.
 * Override individual visit methods to customize behavior.
 * Returns null by default for each node.
 */
export abstract class ModelicaSyntaxVisitor<R, A> implements IModelicaSyntaxVisitor<R | null, A> {
  visitStoredDefinition(node: StoredDefinition, argument?: A): R | null {
    node.withinDirective?.accept(this, argument);
    for (const child of node.classDefinitions) child.accept(this, argument);
    for (const child of node.componentClauses) child.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    node.bOM?.accept(this, argument);
    return null;
  }

  visitWithinDirective(node: WithinDirective, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    return null;
  }

  visitClassDefinition(node: ClassDefinition, argument?: A): R | null {
    node.redeclare?.accept(this, argument);
    node.final?.accept(this, argument);
    node.inner?.accept(this, argument);
    node.outer?.accept(this, argument);
    node.replaceable?.accept(this, argument);
    node.encapsulated?.accept(this, argument);
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitClassPrefixes(node: ClassPrefixes, argument?: A): R | null {
    node.partial?.accept(this, argument);
    node.class?.accept(this, argument);
    node.model?.accept(this, argument);
    node.operator?.accept(this, argument);
    node.record?.accept(this, argument);
    node.block?.accept(this, argument);
    node.expandable?.accept(this, argument);
    node.connector?.accept(this, argument);
    node.type?.accept(this, argument);
    node.package?.accept(this, argument);
    node.purity?.accept(this, argument);
    node.function?.accept(this, argument);
    node.optimization?.accept(this, argument);
    node.shape?.accept(this, argument);
    return null;
  }

  visitLongClassSpecifier(node: LongClassSpecifier, argument?: A): R | null {
    node.extends?.accept(this, argument);
    node.identifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    for (const child of node.sections) child.accept(this, argument);
    node.externalFunctionClause?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    node.endIdentifier?.accept(this, argument);
    return null;
  }

  visitShortClassSpecifier(node: ShortClassSpecifier, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.causality?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.enumeration?.accept(this, argument);
    for (const child of node.enumerationLiterals) child.accept(this, argument);
    node.unspecifiedEnumeration?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitDerClassSpecifier(node: DerClassSpecifier, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    for (const child of node.inputs) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitEnumerationLiteral(node: EnumerationLiteral, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExternalFunctionClause(node: ExternalFunctionClause, argument?: A): R | null {
    node.languageSpecification?.accept(this, argument);
    node.externalFunctionCall?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitLanguageSpecification(node: LanguageSpecification, argument?: A): R | null {
    node.language?.accept(this, argument);
    return null;
  }

  visitExternalFunctionCall(node: ExternalFunctionCall, argument?: A): R | null {
    node.output?.accept(this, argument);
    node.functionName?.accept(this, argument);
    node.arguments?.accept(this, argument);
    return null;
  }

  visitInitialElementSection(node: InitialElementSection, argument?: A): R | null {
    for (const child of node.elements) child.accept(this, argument);
    return null;
  }

  visitElementSection(node: ElementSection, argument?: A): R | null {
    node.visibility?.accept(this, argument);
    for (const child of node.elements) child.accept(this, argument);
    return null;
  }

  visitElementAnnotation(node: ElementAnnotation, argument?: A): R | null {
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleImportClause(node: SimpleImportClause, argument?: A): R | null {
    node.shortName?.accept(this, argument);
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitCompoundImportClause(node: CompoundImportClause, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    for (const child of node.importNames) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitUnqualifiedImportClause(node: UnqualifiedImportClause, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExtendsClause(node: ExtendsClause, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classOrInheritanceModification?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConstrainingClause(node: ConstrainingClause, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitClassOrInheritanceModification(node: ClassOrInheritanceModification, argument?: A): R | null {
    for (const child of node.modificationArgumentOrInheritanceModifications) child.accept(this, argument);
    return null;
  }

  visitInheritanceModification(node: InheritanceModification, argument?: A): R | null {
    node.connectEquation?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitComponentClause(node: ComponentClause, argument?: A): R | null {
    node.redeclare?.accept(this, argument);
    node.final?.accept(this, argument);
    node.inner?.accept(this, argument);
    node.outer?.accept(this, argument);
    node.replaceable?.accept(this, argument);
    node.flow?.accept(this, argument);
    node.variability?.accept(this, argument);
    node.causality?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    for (const child of node.componentDeclarations) child.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration(node: ComponentDeclaration, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.conditionAttribute?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConditionAttribute(node: ConditionAttribute, argument?: A): R | null {
    node.condition?.accept(this, argument);
    return null;
  }

  visitDeclaration(node: Declaration, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.modification?.accept(this, argument);
    return null;
  }

  visitModification(node: Modification, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    node.modificationExpression?.accept(this, argument);
    return null;
  }

  visitModificationExpression(node: ModificationExpression, argument?: A): R | null {
    node.expression?.accept(this, argument);
    node.break?.accept(this, argument);
    return null;
  }

  visitClassModification(node: ClassModification, argument?: A): R | null {
    for (const child of node.modificationArguments) child.accept(this, argument);
    return null;
  }

  visitElementModification(node: ElementModification, argument?: A): R | null {
    node.each?.accept(this, argument);
    node.final?.accept(this, argument);
    node.name?.accept(this, argument);
    node.modification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitElementRedeclaration(node: ElementRedeclaration, argument?: A): R | null {
    node.redeclare?.accept(this, argument);
    node.each?.accept(this, argument);
    node.final?.accept(this, argument);
    node.replaceable?.accept(this, argument);
    node.classDefinition?.accept(this, argument);
    node.componentClause?.accept(this, argument);
    return null;
  }

  visitComponentClause1(node: ComponentClause1, argument?: A): R | null {
    node.flow?.accept(this, argument);
    node.variability?.accept(this, argument);
    node.causality?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    node.componentDeclaration?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration1(node: ComponentDeclaration1, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitShortClassDefinition(node: ShortClassDefinition, argument?: A): R | null {
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitEquationSection(node: EquationSection, argument?: A): R | null {
    node.initial?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitAlgorithmSection(node: AlgorithmSection, argument?: A): R | null {
    node.initial?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConstraintSection(node: ConstraintSection, argument?: A): R | null {
    node.initial?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleAssignmentStatement(node: SimpleAssignmentStatement, argument?: A): R | null {
    node.target?.accept(this, argument);
    node.source?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitProcedureCallStatement(node: ProcedureCallStatement, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitComplexAssignmentStatement(node: ComplexAssignmentStatement, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleEquation(node: SimpleEquation, argument?: A): R | null {
    node.expression1?.accept(this, argument);
    node.operator?.accept(this, argument);
    node.expression2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSpecialEquation(node: SpecialEquation, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitBreakStatement(node: BreakStatement, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitReturnStatement(node: ReturnStatement, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfEquation(node: IfEquation, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    for (const child of node.elseIfEquationClauses) child.accept(this, argument);
    for (const child of node.elseEquations) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfEquationClause(node: ElseIfEquationClause, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    return null;
  }

  visitIfStatement(node: IfStatement, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    for (const child of node.elseIfStatementClauses) child.accept(this, argument);
    for (const child of node.elseStatements) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfStatementClause(node: ElseIfStatementClause, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    return null;
  }

  visitForEquation(node: ForEquation, argument?: A): R | null {
    for (const child of node.forIndexs) child.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForStatement(node: ForStatement, argument?: A): R | null {
    for (const child of node.forIndexs) child.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForIndex(node: ForIndex, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitWhileStatement(node: WhileStatement, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitWhenEquation(node: WhenEquation, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    for (const child of node.elseWhenEquationClauses) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenEquationClause(node: ElseWhenEquationClause, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.equations) child.accept(this, argument);
    return null;
  }

  visitWhenStatement(node: WhenStatement, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    for (const child of node.elseWhenStatementClauses) child.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenStatementClause(node: ElseWhenStatementClause, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const child of node.statements) child.accept(this, argument);
    return null;
  }

  visitConnectEquation(node: ConnectEquation, argument?: A): R | null {
    node.componentReference1?.accept(this, argument);
    node.componentReference2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfElseExpression(node: IfElseExpression, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    for (const child of node.elseIfExpressionClauses) child.accept(this, argument);
    node.elseExpression?.accept(this, argument);
    return null;
  }

  visitElseIfExpressionClause(node: ElseIfExpressionClause, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitRangeExpression(node: RangeExpression, argument?: A): R | null {
    node.startExpression?.accept(this, argument);
    node.stepExpression?.accept(this, argument);
    node.stopExpression?.accept(this, argument);
    return null;
  }

  visitUnaryExpression(node: UnaryExpression, argument?: A): R | null {
    node.operator?.accept(this, argument);
    node.operand?.accept(this, argument);
    return null;
  }

  visitBinaryExpression(node: BinaryExpression, argument?: A): R | null {
    node.operand1?.accept(this, argument);
    node.operator?.accept(this, argument);
    node.operand2?.accept(this, argument);
    return null;
  }

  visitEndExpression(node: EndExpression, argument?: A): R | null {
    return null;
  }

  visitTypeSpecifier(node: TypeSpecifier, argument?: A): R | null {
    node.global?.accept(this, argument);
    node.name?.accept(this, argument);
    return null;
  }

  visitName(node: Name, argument?: A): R | null {
    for (const child of node.parts) child.accept(this, argument);
    return null;
  }

  visitComponentReference(node: ComponentReference, argument?: A): R | null {
    node.global?.accept(this, argument);
    for (const child of node.parts) child.accept(this, argument);
    return null;
  }

  visitComponentReferencePart(node: ComponentReferencePart, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    return null;
  }

  visitFunctionCall(node: FunctionCall, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    return null;
  }

  visitFunctionCallArguments(node: FunctionCallArguments, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    for (const child of node.arguments) child.accept(this, argument);
    for (const child of node.namedArguments) child.accept(this, argument);
    return null;
  }

  visitArrayConcatenation(node: ArrayConcatenation, argument?: A): R | null {
    for (const child of node.expressionLists) child.accept(this, argument);
    return null;
  }

  visitArrayConstructor(node: ArrayConstructor, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    node.expressionList?.accept(this, argument);
    return null;
  }

  visitComprehensionClause(node: ComprehensionClause, argument?: A): R | null {
    node.expression?.accept(this, argument);
    for (const child of node.forIndexs) child.accept(this, argument);
    return null;
  }

  visitNamedArgument(node: NamedArgument, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.argument?.accept(this, argument);
    return null;
  }

  visitFunctionArgument(node: FunctionArgument, argument?: A): R | null {
    node.expression?.accept(this, argument);
    node.functionPartialApplication?.accept(this, argument);
    return null;
  }

  visitFunctionPartialApplication(node: FunctionPartialApplication, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    for (const child of node.namedArguments) child.accept(this, argument);
    return null;
  }

  visitMemberAccessExpression(node: MemberAccessExpression, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitOutputExpressionList(node: OutputExpressionList, argument?: A): R | null {
    for (const child of node.outputs) child.accept(this, argument);
    return null;
  }

  visitExpressionList(node: ExpressionList, argument?: A): R | null {
    for (const child of node.expressions) child.accept(this, argument);
    return null;
  }

  visitArraySubscripts(node: ArraySubscripts, argument?: A): R | null {
    for (const child of node.subscripts) child.accept(this, argument);
    return null;
  }

  visitSubscript(node: Subscript, argument?: A): R | null {
    node.flexible?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitDescription(node: Description, argument?: A): R | null {
    for (const child of node.descriptionStrings) child.accept(this, argument);
    return null;
  }

  visitAnnotationClause(node: AnnotationClause, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    return null;
  }

  visitBOOLEAN(node: BOOLEAN, argument?: A): R | null {
    return null;
  }

  visitIDENT(node: IDENT, argument?: A): R | null {
    return null;
  }

  visitSTRING(node: STRING, argument?: A): R | null {
    return null;
  }

  visitUNSIGNEDINTEGER(node: UNSIGNEDINTEGER, argument?: A): R | null {
    return null;
  }

  visitUNSIGNEDREAL(node: UNSIGNEDREAL, argument?: A): R | null {
    return null;
  }

  visitBLOCKCOMMENT(node: BLOCKCOMMENT, argument?: A): R | null {
    return null;
  }

  visitLINECOMMENT(node: LINECOMMENT, argument?: A): R | null {
    return null;
  }

  visitBOM(node: BOM, argument?: A): R | null {
    return null;
  }
}
