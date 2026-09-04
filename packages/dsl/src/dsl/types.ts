// SPDX-License-Identifier: AGPL-3.0-or-later

export type SymbolKind = string;
export type SymbolId = number;

/**
 * A single entry in the symbol index.
 */
export interface SymbolEntry {
  id: SymbolId;
  kind: SymbolKind;
  name: string;
  ruleName: string;
  namePath: string;
  startByte: number;
  endByte: number;
  parentId: SymbolId | null;
  exports: string[];
  inherits: string[];
  metadata: Record<string, unknown>;
  fieldRanges?: Record<string, { startByte: number; endByte: number }>;
  fieldName: string | null;
  resourceId?: string;
  language?: string;
  [key: string]: any;
}

/**
 * The database facade passed to user-defined query and lint lambdas.
 */
export interface QueryDB {
  symbol(id: SymbolId): SymbolEntry | undefined;
  childrenOf(id: SymbolId): SymbolEntry[];
  childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[];
  parentOf(id: SymbolId): SymbolEntry | undefined;
  exportsOf(id: SymbolId): SymbolEntry[];
  query<T = unknown>(queryName: string, id: SymbolId): T;
  byName(name: string): SymbolEntry[];
  allEntries(): SymbolEntry[];
  queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T;
  specialize?(baseSymbolId: SymbolId, options: any): SymbolId;
  [key: string]: any;
}
