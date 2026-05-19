export type SymbolKind = string;

/** A unique, stable identifier for a symbol in the index. */
export type SymbolId = number;

/** A single entry in the symbol index. */
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
}

/** The full symbol index for a single file. */
export interface SymbolIndex {
  symbols: Map<SymbolId, SymbolEntry>;
  byName: Map<string, SymbolId[]>;
  childrenOf: Map<SymbolId | null, SymbolId[]>;
  symbolsByResource?: Map<string, SymbolId[]>;
}

export interface QueryDB {
  symbol(id: SymbolId): SymbolEntry | undefined;
  childrenOf(id: SymbolId): SymbolEntry[];
  childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[];
  parentOf(id: SymbolId): SymbolEntry | undefined;
  exportsOf(id: SymbolId): SymbolEntry[];
  query<T = unknown>(queryName: string, id: SymbolId): T;
  byName(name: string): SymbolEntry[];
  allEntries(): SymbolEntry[];
  queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T;
  specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId;
  argsOf<T = unknown>(id: SymbolId): SpecializationArgs<T> | null;
  baseOf(id: SymbolId): SymbolId | null;
  cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null;
  cstNode(id: SymbolId): unknown | null;
  cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null;
  evaluate(expression: unknown, scopeId?: SymbolId | null): unknown;
}

export type QueryFn = (db: QueryDB, self: SymbolEntry) => unknown;

export interface CycleInfo {
  participants: { queryName: string; symbolId: SymbolId }[];
}

export type CycleRecoveryFn = (cycle: CycleInfo, self: SymbolEntry) => unknown;

export interface QueryDef {
  execute: QueryFn;
  recovery: CycleRecoveryFn;
}

export type QueryHooks = Record<string, QueryFn | QueryDef>;

export type Revision = number;

export type DependencyKey =
  | { kind: "input"; symbolId: SymbolId }
  | { kind: "query"; queryName: string; symbolId: SymbolId; argsHash?: string }
  | { kind: "byName"; name: string };

export interface Memo {
  value: unknown;
  verified_at: Revision;
  changed_at: Revision;
  dependencies: DependencyKey[];
  byNameLookups?: Set<string>;
}

export interface QueryCacheStore {
  getMemo(key: string): Promise<Memo | undefined>;
  getMemos(keys: string[]): Promise<Map<string, Memo>>;
  setMemo(key: string, memo: Memo): Promise<void>;
  setMemos(memos: Map<string, Memo>): Promise<void>;
  deleteMemo(key: string): Promise<void>;
  clearMemos(): Promise<void>;
}

export interface SpecializationArgs<T = unknown> {
  readonly hash: string;
  readonly data: T;
}

export type ExpressionEvaluator = (expression: unknown, scope: SymbolEntry | null, db: QueryDB) => unknown;

export interface CSTTree {
  getText(startByte: number, endByte: number, entry?: SymbolEntry): string | null;
  getNode(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null;
}

export interface LintResult {
  startByte?: number;
  endByte?: number;
  field?: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
}
