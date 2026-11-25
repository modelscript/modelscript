// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared types for Modelica Salsa query modules.
 */

import type { error, info, warning } from "@modelscript/dsl";
import type { CycleInfo, QueryDB, SymbolEntry, SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../src-gen/bindings.js";
import type { CstNodeLike } from "../flattener/expressions/cst-utils.js";
import type { ModelicaModArgs, ModificationArg, ModificationValue } from "../modifications.js";

/** Diagnostic payload produced by `@modelscript/dsl` error/warning/info helpers. */
export type QueryDiagnostic = ReturnType<typeof error> | ReturnType<typeof warning> | ReturnType<typeof info>;

/** Structural CST node accepted by query helpers (either a WASM `SyntaxNode` or structural `CstNodeLike`). */
export type QueryCstNode =
  | SyntaxNode
  | (CstNodeLike & {
      tree?:
        | {
            rootNode?: CstNodeLike | null | undefined;
            sourceCode?: string | undefined;
            uri?: string | undefined;
          }
        | null
        | undefined;
    });

/** Helper to pass a `QueryCstNode` to generated `Cst.*` typed field accessors. */
export function asSyntaxNode(node: QueryCstNode | null | undefined): SyntaxNode | null {
  return (node ?? null) as SyntaxNode | null;
}

/** SymbolEntry augmented with internal memoization caches used by query helpers. */
export interface CachedSymbolEntry extends SymbolEntry {
  _fqn?: string;
  _isEncapsulated?: boolean;
  _isScopeEncapsulated?: boolean;
}

/** QueryDB augmented with internal per-DB memoization caches. */
export interface CachedQueryDB extends QueryDB {
  _resolveQualifiedCache?: Map<string, SymbolEntry>;
}

/** Optional `cstText` helper shape on QueryDB implementations. */
export interface QueryDBWithCstText {
  cstText?: (start: number, end: number, sym?: unknown) => string | null;
}

/** Metadata record view for `SymbolEntry.metadata`. */
export type SymbolMeta = Record<string, unknown>;

/** Helper to safely read `SymbolEntry.metadata` as a typed record. */
export function getSymbolMeta(entry: SymbolEntry | null | undefined): SymbolMeta | undefined {
  return entry?.metadata as SymbolMeta | undefined;
}

/** Descriptor for a single raw array subscript extracted from CST. */
export type ArrayDimensionDescriptor =
  | { kind: "literal"; value: number }
  | { kind: "flexible" }
  | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined };

/** Result of evaluating a single array dimension or dimension-referenced parameter in Salsa. */
export interface DimEvalResult {
  value: number | null;
  cyclic?: boolean;
  exprText?: string;
  /** Origin token (`"dim:<symId>:<idx>"` or `"param:<symId>"`) propagated until the cycle loop closes. */
  cycleOrigin?: string;
}

/** Extended modification argument carrying parser-only fields like `isBreak` and legacy `bindingExpression`. */
export interface ParsedModificationArg extends Omit<ModificationArg, "nestedArgs" | "evaluationScopeId"> {
  readonly nestedArgs: readonly ParsedModificationArg[];
  readonly isBreak?: boolean | undefined;
  readonly bindingExpression?: string | undefined;
  readonly evaluationScopeId?: number | null | undefined;
}

/** Mutable/parsed modification args produced by `parseModArgsFromCst`. */
export interface ParsedModArgs extends Omit<ModelicaModArgs, "args" | "bindingExpression"> {
  args: ParsedModificationArg[];
  bindingExpression: ModificationValue | null;
}

/** Partial modification shape accepted by `checkModifierNotFound`. */
export interface CheckableModArgs {
  readonly args?: readonly ParsedModificationArg[] | undefined;
  readonly bindingExpression?: ModificationValue | null | undefined;
}

/**
 * Precomputed lexical scope summary for a Modelica class or package,
 * indexing direct members and all three forms of `import` clauses (`MLS §13.2.1`).
 */
export interface ScopeData {
  directByName: Record<string, SymbolId>;
  qualifiedImports: Record<string, string>;
  unqualifiedImportPkgs: string[];
  compoundImports: Array<{ pkg: string; names: string[] }>;
  isEncapsulated: boolean;
  parentId: SymbolId | null;
  id: SymbolId;
}

/**
 * Diagnostic payload returned when an `enumeration(...)` type definition fails validation.
 */
export interface EnumValidationResult {
  code: number;
  message: string;
  startOffset: number;
  endOffset: number;
}

/** Closure returned by the `resolveSimpleName` Salsa query. */
export type ResolveSimpleNameFn = (
  name: string,
  encapsulated?: boolean,
  skipInherited?: boolean,
  memberOnly?: boolean,
) => SymbolEntry | null;

/** Closure returned by the `resolveName` Salsa query. */
export type ResolveNameFn = (
  qualifiedName: string,
  skipInherited?: boolean,
  allowMemberImports?: boolean,
) => SymbolEntry | null;

/** Result object returned by the `componentInstance` aggregate Salsa query. */
export interface ComponentInstanceSummary {
  id: SymbolId;
  name: string;
  classInstance: SymbolId | null;
  variability: string | null;
  causality: string | null;
  flowPrefix: string | null;
  isFinal: boolean;
  isRedeclare: boolean;
  isInner: boolean;
  isOuter: boolean;
  isReplaceable: boolean;
  isProtected: boolean;
  arrayDimensions: number[] | null;
  isConnectorType: boolean;
  typeSpecifier: string | null;
  modification: unknown;
}

/** Signature of a Modelica Salsa query hook function. */
export type ModelicaQueryFn = (db: QueryDB, self: SymbolEntry, args?: Record<string, unknown>) => unknown;

/** Signature of a Modelica Salsa cycle-recovery hook (`WasmQueryEngine` passes `cycleDb` + `self` + `args`). */
export type ModelicaCycleRecoveryFn = (
  cycleDb: QueryDB & CycleInfo,
  self: SymbolEntry,
  args?: Record<string, unknown>,
) => unknown;

/** Full query hook definition pairing `execute` with cycle `recovery`. */
export interface ModelicaQueryDef {
  execute: ModelicaQueryFn;
  recovery: ModelicaCycleRecoveryFn;
}

/** Dispatch table mapping query names to Modelica Salsa hook functions or `ModelicaQueryDef`s. */
export type ModelicaQueryHooks = Record<string, ModelicaQueryFn | ModelicaQueryDef>;

/** Minimal structural shape of Node's `process.getBuiltinModule("node:fs")` used in `lint__withinMismatch`. */
export interface NodeFsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
}

/** Minimal structural shape of `globalThis.process` for optional `node:fs` access. */
export interface NodeProcessLike {
  getBuiltinModule?(name: string): NodeFsLike | undefined;
}
