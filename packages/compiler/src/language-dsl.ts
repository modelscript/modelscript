/* eslint-disable */
// ---------------------------------------------------------------------------
// Rule Nodes — Named generic interfaces for type-level field extraction
// ---------------------------------------------------------------------------

import type { GraphicsConfig } from "@modelscript/diagram/builder";
import type { GlobalAdapters, NodeAdapter } from "./adapter-registry.js";
import type { LintResult } from "./query-engine.js";
import type { CycleInfo, QueryDB, QueryFn, SymbolEntry, SymbolKind } from "./runtime.js";
export type {
  CycleInfo,
  GlobalAdapters,
  GraphicsConfig,
  LintResult,
  NodeAdapter,
  QueryDB,
  QueryFn,
  SymbolEntry,
  SymbolKind,
};

export interface SymbolNode {
  type: "sym";
  name: string;
}

export interface SeqNode<T extends Rule[] = Rule[]> {
  type: "seq";
  args: T;
}

export interface ChoiceNode<T extends Rule[] = Rule[]> {
  type: "choice";
  args: T;
}

export interface OptionalNode<T extends Rule = Rule> {
  type: "optional";
  arg: T;
}

export interface RepeatNode<T extends Rule = Rule> {
  type: "repeat";
  arg: T;
}

export interface Repeat1Node<T extends Rule = Rule> {
  type: "repeat1";
  arg: T;
}

export interface TokenNode<T extends Rule = Rule> {
  type: "token";
  arg: T;
}

export interface TokenImmediateNode<T extends Rule = Rule> {
  type: "token_immediate";
  arg: T;
}

export interface FieldNode<N extends string = string> {
  type: "field";
  name: N;
  arg: Rule;
}

export interface PrecNode {
  type: "prec";
  precedence: number;
  arg: Rule;
}

export interface PrecLeftNode {
  type: "prec_left";
  precedence: number;
  arg: Rule;
}

export interface PrecRightNode {
  type: "prec_right";
  precedence: number;
  arg: Rule;
}

export interface PrecDynamicNode {
  type: "prec_dynamic";
  precedence: number;
  arg: Rule;
}

export interface AliasNode {
  type: "alias";
  arg: Rule;
  value: string | SymbolNode;
}

export interface BlankNode {
  type: "blank";
}

export type RuleNode =
  | SeqNode
  | ChoiceNode
  | OptionalNode
  | RepeatNode
  | Repeat1Node
  | TokenNode
  | TokenImmediateNode
  | FieldNode
  | PrecNode
  | PrecLeftNode
  | PrecRightNode
  | PrecDynamicNode
  | AliasNode
  | BlankNode
  | DefNode
  | RefNode;

export type Rule = string | RegExp | RuleNode | SymbolNode;

// ---------------------------------------------------------------------------
// Type-level field name extraction
// ---------------------------------------------------------------------------

/**
 * Recursively extracts all `field()` name literals from a rule tree.
 *
 * e.g. `ExtractFieldNames<SeqNode<[FieldNode<"name">, FieldNode<"body">]>>`
 *      → `"name" | "body"`
 */
export type ExtractFieldNames<R, Depth extends unknown[] = []> =
  // Stop recursion at depth 5 to prevent infinite type instantiation
  Depth["length"] extends 5
    ? never
    : // Termination cases — non-structural types have no fields
      R extends string
      ? never
      : R extends RegExp
        ? never
        : R extends SymbolNode
          ? never
          : R extends DefNode
            ? never
            : R extends RefNode
              ? never
              : R extends BlankNode
                ? never
                : R extends PrecNode
                  ? never
                  : R extends PrecLeftNode
                    ? never
                    : R extends PrecRightNode
                      ? never
                      : R extends PrecDynamicNode
                        ? never
                        : R extends AliasNode
                          ? never
                          : // Extraction — pull the literal name from field nodes
                            R extends FieldNode<infer N>
                            ? N
                            : // Recursion — walk through structural combinators
                              R extends SeqNode<infer T>
                              ? ExtractFieldNames<T[number], [...Depth, unknown]>
                              : R extends ChoiceNode<infer T>
                                ? ExtractFieldNames<T[number], [...Depth, unknown]>
                                : R extends OptionalNode<infer T>
                                  ? ExtractFieldNames<T, [...Depth, unknown]>
                                  : R extends RepeatNode<infer T>
                                    ? ExtractFieldNames<T, [...Depth, unknown]>
                                    : R extends Repeat1Node<infer T>
                                      ? ExtractFieldNames<T, [...Depth, unknown]>
                                      : R extends TokenNode<infer T>
                                        ? ExtractFieldNames<T, [...Depth, unknown]>
                                        : R extends TokenImmediateNode<infer T>
                                          ? ExtractFieldNames<T, [...Depth, unknown]>
                                          : never;

/**
 * Produces a typed `self` accessor with known field names for autocomplete.
 * When `Fields` is `never` (inference failed), falls back to the open-ended
 * `SelfAccessor` that allows arbitrary property access.
 */
export type TypedSelf<Fields extends string> = [Fields] extends [never]
  ? SelfAccessor
  : { readonly [K in Fields]: SelfAccessor };

// ---------------------------------------------------------------------------
// Semantic Layer
// ---------------------------------------------------------------------------

/**
 * A deeply nestable Proxy that captures dot-paths at runtime.
 * Writing `self.body.elements` produces a proxy representing `"body.elements"`.
 * Works exactly like Tree-Sitter's `$` proxy, but for scope graph references.
 */
export type SelfAccessor = {
  readonly [key: string]: SelfAccessor;
};

/** Symbol used internally to extract the captured dot-path from a SelfAccessor proxy. */
export const SCOPE_PATH = Symbol("scopePath");

/** Creates a `self` proxy that records field access chains as dot-paths. */
export function createSelfProxy(path: string = ""): SelfAccessor {
  return new Proxy({} as SelfAccessor, {
    get(_, prop) {
      if (prop === SCOPE_PATH) return path;
      const newPath = path ? `${path}.${String(prop)}` : String(prop);
      return createSelfProxy(newPath) as any;
    },
  });
}

/** Extracts the captured dot-path string from a SelfAccessor proxy. */
export function extractScopePath(accessor: SelfAccessor): string {
  return (accessor as any)[SCOPE_PATH] as string;
}

/**
 * Configures the symbol index properties for a syntax node.
 * Evaluated eagerly during the indexing phase.
 */
export interface SymbolConfig {
  /** The kind of symbol this node introduces into the Symbol Index. */
  kind: SymbolKind;
  /** Which field provides the symbol's name. */
  name?: SelfAccessor;
  /** Fields whose children are visible from this scope. */
  exports?: SelfAccessor[];
  /** Fields whose resolved targets contribute inherited members. */
  inherits?: SelfAccessor[];
  /** Language-specific attributes extracted from CST fields. */
  attributes?: Record<string, SelfAccessor>;
  /**
   * Marks this symbol as also acting as a reference site.
   * When set, the referencing framework will include this symbol
   * in scope resolution (e.g., for extends clauses that are both
   * declarations and references to base classes).
   *
   * Example:
   *   symbol: (self) => ({
   *     kind: "Extends",
   *     name: self.typeSpecifier,
   *     ref: { resolve: "qualified", targetKinds: ["Class"] },
   *   })
   */
  ref?: {
    /** Which kinds of symbols this reference can resolve to. */
    targetKinds?: string[];
    /** Scope resolution strategy. */
    resolve?: "lexical" | "qualified";
  };
}

// ---------------------------------------------------------------------------
// Lint Result — Diagnostic output from lint rules
// ---------------------------------------------------------------------------

/** Options for diagnostic helpers — either a field name, explicit byte range, or both. */
type LintRangeOptions =
  | { field: string }
  | { startByte: number; endByte: number }
  | { field: string; startByte: number; endByte: number };

/**
 * A lint rule function. Receives the query database and the symbol entry,
 * and optionally the previous state of the symbol during evolutionary / CI validation.
 * Return `null` for no diagnostic, a single result, or an array of results.
 */
export type LintFn = (
  db: QueryDB,
  self: SymbolEntry,
  previous?: SymbolEntry | null,
) => LintResult | LintResult[] | null;

/** Create a warning diagnostic. Optionally narrow to a named field. */
export function warning(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "warning", ...options };
}

/** Create an error diagnostic. Optionally narrow to a named field. */
export function error(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "error", ...options };
}

/** Create an info diagnostic. Optionally narrow to a named field. */
export function info(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "info", ...options };
}

/** Create a hint diagnostic. Optionally narrow to a named field. */
export function hint(message: string, options?: LintRangeOptions): LintResult {
  return { message, severity: "hint", ...options };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// X6-Compatible Graphics Configuration
// ---------------------------------------------------------------------------

/** A query with cycle recovery — used for queries that may participate in cycles. */
export interface QueryObj {
  execute: (db: QueryDB, self: SymbolEntry) => unknown;
  recovery: (cycle: CycleInfo, self: SymbolEntry) => unknown;
}

/**
 * A query hook is either a bare function or an object with execute + recovery.
 * @deprecated Use `QueryFn` or `QueryObj` directly. Kept for backward compatibility.
 */
export type QueryHook = QueryFn | QueryObj;

export interface DiffConfig {
  /** Deterministic identity generator for unnamed or ordered nodes when mapping versions. */
  identity?: string | ((self: any) => string);
  /** Semantic fields to ignore in diff tracking (like documentation or formatting annotations). */
  ignore?: string[];
  /** Attributes where changes are flagged as non-breaking/minor. */
  minor?: string[];
  /** Attributes where changes trigger high-priority breaking diff alerts. */
  breaking?: string[];
}

export interface I18nTextConfig {
  field: string;
  context?: "self" | "scope";
}

export interface I18nConfig {
  /** Fields to extract directly as msgid. */
  texts?: (string | I18nTextConfig)[];
  /** Child fields to traverse recursively. */
  traverse?: string[];
  /** Function that resolves the scope name for this node (if it introduces a new namespace context). */
  scope?: (self: any) => string | null;
  /** Dynamic custom extraction callback. */
  extract?: (db: any, self: any) => any;
}

export interface DefOptions<Fields extends string = string, QKeys extends string = never> {
  /**
   * Defines the fast symbol graph representation of this syntax node.
   * Evaluated eagerly during the index phase.
   *
   * Example:
   *   symbol: (self) => ({
   *     kind: "Class",
   *     name: self.name,
   *     exports: [self.body],
   *     inherits: [self.specializes],
   *     attributes: { isAbstract: self.is_abstract }
   *   })
   */
  symbol?: (self: TypedSelf<Fields>) => SymbolConfig;
  /**
   * Lazily-evaluated semantic queries for this node type.
   * Each query is either a bare function (no cycle recovery) or
   * a `{ execute, recovery }` object for queries that may participate in cycles.
   */
  queries?: Record<QKeys, QueryFn | QueryObj>;
  /**
   * Semantic lint rules for this node type.
   * Each lint is a function that receives the query database and the symbol,
   * and returns diagnostic(s) or null.
   *
   * Lints are auto-registered as Salsa-memoized queries (prefixed `lint__`),
   * so they get incremental caching and dependency tracking for free.
   *
   * Example:
   *   lints: {
   *     namingConvention: (db, self) => {
   *       if (/^[a-z]/.test(self.name)) return warning(`Should start uppercase`);
   *       return null;
   *     },
   *   }
   */
  lints?: Record<string, LintFn>;
  /**
   * Configuration for semantic diffing out of the box in CI/CD pipelines.
   * Enables blast radius and compatibility reports.
   */
  diff?: DiffConfig;
  /**
   * Configuration for internationalization (I18n) extraction.
   */
  i18n?: I18nConfig;
  /**
   * Configuration for generating a typed pull-up AST class.
   * When present, `generate-ast-classes.ts` produces a TypeScript class
   * that wraps `SymbolEntry` + `QueryDB` and provides typed field access,
   * computed properties backed by queries, clone/specialize, and visitor support.
   */
  model?: ModelConfig<QKeys>;
  /**
   * Node-level cross-language adapters (Approaches A and B).
   *
   * Key = foreign / target language name (e.g. "sysml2", "modelica").
   *
   * Approach A — this node exports itself into the foreign language:
   *   adapters: {
   *     sysml2: { target: "BlockDefinition", transform: (db, self) => ({...}) }
   *   }
   *
   * Approach B — this node imports foreign nodes of given className(s):
   *   adapters: {
   *     modelica: { accepts: ["ClassDefinition"], transform: (db, foreign) => ({...}) }
   *   }
   */
  adapters?: Record<string, NodeAdapter>;
  /**
   * Declarative graphics configuration for layout and UI rendering.
   * Can map structural CST components to visualization primitives (nodes, ports, edges).
   */
  graphics?: (self: TypedSelf<Fields>) => GraphicsConfig;
}

/**
 * Configuration for generating a typed pull-up semantic model class
 * from a `def()` rule.
 */
export interface ModelConfig<QueryNames extends string = string> {
  /** Generated class name (defaults to PascalCase of ruleName). */
  name?: string;

  /** Abstract base class to extend (default: "SemanticNode"). */
  extends?: string | (($: any) => any);

  /** Additional interface names to implement. */
  implements?: string[];

  /**
   * Field type annotations for generated getters.
   * Maps field name → TypeScript type string.
   * Fields not listed default to `string` (from CST text).
   */
  fieldTypes?: Record<string, string>;

  /**
   * Computed properties backed by queries.
   * Defines AST accessors for query engine responses.
   * Maps property name -> Return Type.
   *
   * Example:
   *   queryTypes: {
   *     members: "SemanticNode[]",
   *     resolvedTarget: "ClassDefinition | null"
   *   }
   */
  queryTypes?: Partial<Record<QueryNames, string>>;

  /**
   * Whether this node supports clone/specialize.
   * Generates typed `clone(args)` method that returns the same class.
   * Default: false.
   */
  specializable?: boolean;

  /** Whether to generate a visitor `accept()` method. Default: true. */
  visitable?: boolean;

  /**
   * Mutable properties set during instantiation, not from CST.
   * Maps property name → TypeScript type string.
   * These have CST metadata defaults but can be overridden at runtime.
   *
   * Example:
   *   properties: { variability: "string | null", isFinal: "boolean" }
   */
  properties?: Record<string, string>;

  /**
   * Raw TypeScript source to inject into the generated class body.
   * Use for complex logic that can't be expressed declaratively.
   */
  customBody?: string;
}

// ---------------------------------------------------------------------------
// Adapter Types — Polyglot cross-language projection (Approaches A, B, C)
// ---------------------------------------------------------------------------

export interface DefNode {
  type: "def";
  /** The underlying syntax rule (Tree-Sitter compatible). */
  rule: Rule;
  /** Semantic options for the Symbol Indexer and Scope Graph. */
  options: DefOptions;
}

// ---------------------------------------------------------------------------
// ref() — Reference site annotation
// ---------------------------------------------------------------------------

export interface RefOptions<Fields extends string = string> {
  /** Which field contains the reference name. */
  name?: (self: TypedSelf<Fields>) => SelfAccessor;
  /** Which kinds of symbols this reference can resolve to. */
  targetKinds?: string[];
  /**
   * Scope resolution strategy:
   * - "lexical" (default): walk parent scopes
   * - "qualified": resolve as a dotted path (e.g. A.B.C)
   */
  resolve?: "lexical" | "qualified";
}

export interface RefNode {
  type: "ref";
  /** The underlying syntax rule (Tree-Sitter compatible). */
  rule: Rule;
  /** Reference resolution options. */
  options: RefOptions;
}

// ---------------------------------------------------------------------------
// Language definition
// ---------------------------------------------------------------------------

export interface LanguageOptions {
  name: string;
  rules: Record<string, ($: Record<string, SymbolNode>) => Rule>;
  /** Tokens that can appear anywhere (whitespace, comments). */
  extras?: ($: Record<string, SymbolNode>) => Rule[];
  /** Sets of rules allowed to conflict (shift/reduce). */
  conflicts?: ($: Record<string, SymbolNode>) => Rule[][];
  /** External scanner tokens (implemented in C). */
  externals?: ($: Record<string, SymbolNode>) => Rule[];
  /** Rules to inline (no CST nodes generated). */
  inline?: ($: Record<string, SymbolNode>) => Rule[];
  /** Abstract node types (like _expression). */
  supertypes?: ($: Record<string, SymbolNode>) => Rule[];
  /** The word token (for keyword extraction). */
  word?: ($: Record<string, SymbolNode>) => Rule;
  /**
   * Top-level cross-language adapter registry (Approach C).
   * Provides language-wide projection rules from a foreign language into this one.
   * Takes priority over node-level adapters (C > B > A).
   *
   * Example:
   *   adapters: {
   *     sysml2: {
   *       BlockDefinition: (db, node) => ({ target: "ClassDefinition", props: { name: node.name } })
   *     }
   *   }
   */
  adapters?: GlobalAdapters;
}

export function language(options: LanguageOptions) {
  return options;
}

export * from "./combinators.js";
