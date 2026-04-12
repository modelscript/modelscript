/* eslint-disable */
import type { SymbolKind } from "./index.js";

// ---------------------------------------------------------------------------
// Symbol Index Types
// ---------------------------------------------------------------------------

/** A unique, stable identifier for a symbol in the index. */
export type SymbolId = number;

/** A single entry in the symbol index. */
export interface SymbolEntry {
  id: SymbolId;
  /** What kind of symbol this is ("Class", "Function", etc.) */
  kind: SymbolKind;
  /** The text content of the name field (e.g. "Resistor") */
  name: string;
  /** Which grammar rule produced this entry (e.g. "class_definition") */
  ruleName: string;
  /** Dot-path to the name field within the CST node (e.g. "name") */
  namePath: string;
  /** CST node start byte offset */
  startByte: number;
  /** CST node end byte offset */
  endByte: number;
  /** Parent scope symbol, if any */
  parentId: SymbolId | null;
  /** Dot-paths of fields whose children are visible from this scope */
  exports: string[];
  /** Dot-paths of fields whose resolved targets contribute inherited members */
  inherits: string[];
  /**
   * Language-specific metadata extracted during indexing.
   * Opaque to the framework. Populated by metadata extractors in def().
   *
   * Modelica: { classKind, variability, causality, isFinal, isInner, ... }
   * SysML v2: { defKind, isAbstract, direction, ... }
   * TypeScript: { typeParamIndex, isExported, ... }
   */
  metadata: Record<string, unknown>;
  /**
   * Byte ranges of named CST fields, stored at index time.
   * Used by lint rules to narrow diagnostic ranges to specific fields.
   * Maps field name → { startByte, endByte }.
   */
  fieldRanges?: Record<string, { startByte: number; endByte: number }>;
  /**
   * The CST field name under which this entry was indexed in its parent.
   * E.g., "body" for a component inside a class_definition's body field.
   * Null for top-level entries or when the field name is unknown.
   */
  fieldName: string | null;
  /**
   * The URI of the document containing this symbol. Populated by WorkspaceIndex.
   */
  resourceId?: string;
}

/** The full symbol index for a single file. */
export interface SymbolIndex {
  /** All symbols keyed by their unique ID. */
  symbols: Map<SymbolId, SymbolEntry>;
  /** Name → symbol IDs mapping for fast name lookups (supports overloading). */
  byName: Map<string, SymbolId[]>;
  /** Parent ID → direct child IDs for O(1) subtree reuse. */
  childrenOf: Map<SymbolId | null, SymbolId[]>;
}

// ---------------------------------------------------------------------------
// Indexer Configuration (Generated from language.ts)
// ---------------------------------------------------------------------------

/**
 * Configuration for one indexable rule, extracted from a `def()` call.
 * Generated at build time by evaluating name/scope lambdas against
 * SelfAccessor proxies to capture dot-path strings.
 */
export interface IndexerHook {
  /** The grammar rule name (e.g. "class_definition") */
  ruleName: string;
  /** Symbol kind to assign (e.g. "Class") */
  kind: SymbolKind;
  /** Dot-path to the field that provides the symbol name */
  namePath: string;
  /** Dot-paths of exported scope fields */
  exportPaths: string[];
  /** Dot-paths of inherited scope references */
  inheritPaths: string[];
  /**
   * Metadata field paths: key → dot-path.
   * Each path is resolved to CST node text and stored in SymbolEntry.metadata.
   */
  metadataFieldPaths: Record<string, string>;
}

/**
 * Configuration for one reference rule, extracted from a `ref()` call.
 * Generated at build time. The resolver uses this to find and resolve references.
 */
export interface RefHook {
  /** The grammar rule name (e.g. "type_specifier") */
  ruleName: string;
  /** Dot-path to the field that provides the reference name */
  namePath: string;
  /** Which symbol kinds this reference can resolve to */
  targetKinds: string[];
  /** Resolution strategy */
  resolve: "lexical" | "qualified";
}

// ---------------------------------------------------------------------------
// Query Engine Types
// ---------------------------------------------------------------------------

/**
 * The database facade passed to user-defined query lambdas.
 * Provides helper methods to navigate the symbol index and
 * invoke other queries (enabling composition).
 */
export interface QueryDB {
  /** Get a symbol entry by ID (works for both real and virtual entries). */
  symbol(id: SymbolId): SymbolEntry | undefined;
  /** Get all direct children of a symbol (symbols whose parentId matches). */
  childrenOf(id: SymbolId): SymbolEntry[];
  /** Get direct children of a symbol that were indexed under a specific CST field. */
  childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[];
  /** Get the parent symbol, if any. */
  parentOf(id: SymbolId): SymbolEntry | undefined;
  /** Get all symbols exported by this symbol's scope. */
  exportsOf(id: SymbolId): SymbolEntry[];
  /** Invoke a named query on a symbol (enables query composition). */
  query<T = unknown>(queryName: string, id: SymbolId): T;
  /** Look up all symbols with a given name across the index. */
  byName(name: string): SymbolEntry[];

  /**
   * Invoke a query with additional arguments beyond symbolId.
   * Enables compound keys like (symbolId, otherSymbolId) for
   * e.g. type compatibility checks.
   */
  queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T;

  // -------------------------------------------------------------------------
  // Specialization — language-agnostic parameterized instances
  // -------------------------------------------------------------------------

  /**
   * Create or reuse a specialized instance of a base symbol.
   *
   * Memoized: specialize(X, {hash:"a",...}) === specialize(X, {hash:"a",...})
   * Virtual entries have negative IDs to distinguish from CST entries.
   *
   * This is THE instantiation primitive:
   *   Modelica:   db.specialize(classId, modelicaMod({R: 100}))
   *   SysML v2:   db.specialize(defId, sysmlRedef({mass: 5000}))
   *   TypeScript:  db.specialize(genericId, tsTypeArgs([numberTypeId]))
   */
  specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId;

  /**
   * Retrieve the specialization args for a (possibly specialized) symbol.
   * Returns null for CST-derived (non-specialized) symbols.
   */
  argsOf<T = unknown>(id: SymbolId): SpecializationArgs<T> | null;

  /**
   * Get the base symbol ID that a specialized instance was derived from.
   * Returns null for CST-derived symbols.
   */
  baseOf(id: SymbolId): SymbolId | null;

  // -------------------------------------------------------------------------
  // CST Access
  // -------------------------------------------------------------------------

  /**
   * Extract source text for a byte range from the parsed source.
   *
   * Used by queries that need to read expression text, e.g.:
   * ```typescript
   * const exprText = db.cstText(modValue.cstBytes[0], modValue.cstBytes[1]);
   * ```
   *
   * Returns null if the tree is not available or the range is invalid.
   */
  cstText(startByte: number, endByte: number): string | null;

  /**
   * Get the CST subtree node for a symbol (by its byte range).
   *
   * Returns an opaque tree-sitter SyntaxNode that can be walked
   * for expression evaluation, equation processing, etc.
   *
   * Returns null if the tree is not available.
   */
  cstNode(id: SymbolId): unknown | null;

  // -------------------------------------------------------------------------
  // Expression Evaluation
  // -------------------------------------------------------------------------

  /**
   * Evaluate an expression using the language's evaluator.
   * Dependency-tracked: any symbols accessed during evaluation
   * are recorded as dependencies of the calling query.
   *
   * Throws if no evaluator was configured on the QueryEngine.
   */
  evaluate(expression: unknown, scopeId?: SymbolId | null): unknown;
}

/**
 * A user-defined query function.
 * Receives the QueryDB facade and the symbol entry being queried.
 */
export type QueryFn = (db: QueryDB, self: SymbolEntry) => unknown;

/**
 * Information about a detected query cycle, passed to recovery functions.
 */
export interface CycleInfo {
  /** The query names and symbol IDs forming the cycle, in call order. */
  participants: Array<{ queryName: string; symbolId: SymbolId }>;
}

/**
 * A recovery function invoked when a query cycle is detected.
 * Returns a fallback value so execution can continue instead of throwing.
 */
export type CycleRecoveryFn = (cycle: CycleInfo, self: SymbolEntry) => unknown;

/**
 * Full query definition with optional cycle recovery.
 *
 * ```typescript
 * queries: {
 *   // Simple form — no recovery (throws on cycle)
 *   members: (db, self) => db.childrenOf(self.id),
 *
 *   // Full form — with cycle recovery
 *   allInherited: {
 *     execute: (db, self) => ...,
 *     recovery: (cycle, self) => [],  // fallback on cycle
 *   },
 * }
 * ```
 */
export interface QueryDef {
  execute: QueryFn;
  recovery: CycleRecoveryFn;
}

/**
 * The set of query definitions for a specific grammar rule.
 * Each entry is either a bare function (no cycle recovery) or
 * a full QueryDef with an execute + recovery pair.
 */
export type QueryHooks = Record<string, QueryFn | QueryDef>;

// ---------------------------------------------------------------------------
// Salsa-Style Incremental Computation Types
// ---------------------------------------------------------------------------

/**
 * A monotonic revision number.
 * Incremented every time an input (symbol entry) changes.
 */
export type Revision = number;

/**
 * Identifies a specific piece of tracked data in the dependency graph.
 * - `"input"` — a symbol entry from the indexer (ground truth)
 * - `"query"` — a derived query result (computed from inputs and other queries)
 */
export type DependencyKey =
  | { kind: "input"; symbolId: SymbolId }
  | { kind: "query"; queryName: string; symbolId: SymbolId; argsHash?: string };

/**
 * A memoized query result with Salsa-style revision metadata.
 *
 * The key insight: `changed_at` and `verified_at` serve different purposes.
 * - `verified_at` tracks when we last confirmed this memo is up-to-date.
 * - `changed_at` tracks when the VALUE last changed.
 * When backdating, `verified_at` advances but `changed_at` stays, preventing
 * unnecessary cascading re-execution of downstream queries.
 */
export interface Memo {
  /** The cached return value. */
  value: unknown;
  /** The revision in which this memo was last verified to be up-to-date. */
  verified_at: Revision;
  /** The revision in which this memo's value last actually changed. */
  changed_at: Revision;
  /** The set of dependencies read during the last execution. */
  dependencies: DependencyKey[];
}

// ---------------------------------------------------------------------------
// Specialization (language-agnostic parameterized instances)
// ---------------------------------------------------------------------------

/**
 * Opaque, hashable specialization arguments.
 *
 * The framework does NOT interpret these. It uses `hash` for memoization
 * (same base + same hash → same specialized instance) and stores `data`
 * for later retrieval by language-specific queries.
 *
 * Each language fills `data` with whatever structure it needs:
 *
 *   Modelica:   { args: Map<string, ModArg>, expression?, ... }
 *   SysML v2:   { redefinitions: Map<string, Redef>, bindings: ... }
 *   TypeScript:  [SymbolId, SymbolId]  (positional type args)
 *   C++:         [{ kind: "type", id: 42 }, { kind: "value", val: 16 }]
 */
export interface SpecializationArgs<T = unknown> {
  /** Deterministic hash for memoization. */
  readonly hash: string;
  /** Language-specific argument data. Opaque to the framework. */
  readonly data: T;
}

// ---------------------------------------------------------------------------
// Expression Evaluation
// ---------------------------------------------------------------------------

/**
 * A language-specific expression evaluator.
 * Invoked by queries via db.evaluate() when an expression needs evaluation.
 *
 * The framework doesn't interpret expressions — this hook allows
 * language queries to delegate to their own evaluator while
 * maintaining dependency tracking.
 */
export type ExpressionEvaluator = (expression: unknown, scope: SymbolEntry | null, db: QueryDB) => unknown;

// ---------------------------------------------------------------------------
// CST Tree Access
// ---------------------------------------------------------------------------

/**
 * Minimal abstraction over a parsed syntax tree for CST access.
 *
 * The query engine holds an optional `CSTTree` reference so that
 * queries can read source text and walk CST subtrees (e.g., for
 * expression evaluation or equation processing).
 *
 * Implementations wrap language-specific tree-sitter `Tree` objects.
 */
export interface CSTTree {
  /** Extract source text for a byte range. */
  getText(startByte: number, endByte: number): string | null;
  /** Get the CST node covering a byte range (smallest node that spans it). */
  getNode(startByte: number, endByte: number): unknown | null;
}
