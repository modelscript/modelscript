// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core symbol table and Salsa query database types for DSL grammars.
 */

/** String identifier representing the semantic category of an indexed symbol (e.g., `"class"`, `"component"`, `"function"`). */
export type SymbolKind = string;

/** Numeric identifier uniquely addressing an entry within a `SymbolIndex` or `WorkspaceIndex`. */
export type SymbolId = number;

/**
 * A single entry in the symbol index.
 */
export interface SymbolEntry {
  /** Unique numeric identifier of this symbol in the symbol table. */
  id: SymbolId;
  /** Semantic category of the symbol (e.g., `"class"`, `"variable"`, `"extends"`). */
  kind: SymbolKind;
  /** Unqualified declared name of the symbol. */
  name: string;
  /** Name of the grammar production rule that produced this symbol. */
  ruleName: string;
  /** Fully-qualified dot-separated hierarchical path to this symbol. */
  namePath: string;
  /** Starting character offset of the symbol's CST node in the source document. */
  startOffset: number;
  /** Ending character offset (exclusive) of the symbol's CST node in the source document. */
  endOffset: number;
  /** Numeric `SymbolId` of the enclosing parent symbol, or `null` for top-level declarations. */
  parentId: SymbolId | null;
  /** List of child symbol names exported into the public namespace of this symbol. */
  exports: string[];
  /** List of base type or supertype names inherited by this symbol (e.g., via `extends` clauses). */
  inherits: string[];
  /** Arbitrary language-specific metadata extracted during symbol indexing. */
  metadata: Record<string, unknown>;
  /** Source character ranges for named AST fields belonging to this symbol's declaration node. */
  fieldRanges?: Record<string, { startOffset: number; endOffset: number }> | undefined;
  /** Name of the AST field on the parent rule that holds this symbol, or `null` if unfielded. */
  fieldName: string | null;
  /** Optional workspace resource identifier for multi-file resolution. */
  resourceId?: string | undefined;
  /** Optional URI of the source document containing this symbol. */
  documentUri?: string | undefined;
  /** Optional language identifier of the source grammar that produced this symbol. */
  language?: string | undefined;
  [key: string]: any;
}

/**
 * The database facade passed to user-defined query and lint lambdas.
 */
export interface QueryDB {
  /** Retrieves the `SymbolEntry` for the given `id`, or `undefined` if not found. */
  symbol(id: SymbolId): SymbolEntry | undefined;
  /** Returns all direct child symbols of `id` (or all top-level symbols when `id` is `null`). */
  childrenOf(id: SymbolId | null): SymbolEntry[];
  /** Returns all direct child symbols of `id` that were matched under the specified AST `fieldName`. */
  childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[];
  /** Returns the enclosing parent `SymbolEntry` of `id`, or `undefined` if `id` is a root symbol. */
  parentOf(id: SymbolId): SymbolEntry | undefined;
  /** Returns all symbols publicly exported by `id`. */
  exportsOf(id: SymbolId): SymbolEntry[];
  /** Evaluates and memoizes the named semantic query `queryName` for symbol `id`. */
  query<T = unknown>(queryName: string, id: SymbolId): T;
  /** Looks up all indexed symbols matching the unqualified `name`. */
  byName(name: string): SymbolEntry[];
  /** Returns an array of all `SymbolEntry` records in the index. */
  allEntries(): SymbolEntry[];
  /** Evaluates a parameterized semantic query `queryName` for symbol `id` with additional `args` and optional cache `hashOverride`. */
  queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T;
  /** Creates or retrieves a specialized clone of `baseSymbolId` parameterized by `options` (e.g., class modifications). */
  specialize?(baseSymbolId: SymbolId, options: any): SymbolId;
  [key: string]: any;
}
