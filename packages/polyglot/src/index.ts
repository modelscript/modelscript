/* eslint-disable */
// ---------------------------------------------------------------------------
// Rule Nodes — Named generic interfaces for type-level field extraction
// ---------------------------------------------------------------------------

import type {
  CSTTree,
  CycleInfo,
  ExpressionEvaluator,
  QueryDB,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
} from "./runtime.js";
export type {
  CSTTree,
  CycleInfo,
  ExpressionEvaluator,
  QueryDB,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
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

export interface OptNode<T extends Rule = Rule> {
  type: "opt";
  arg: T;
}

export interface RepNode<T extends Rule = Rule> {
  type: "rep";
  arg: T;
}

export interface Rep1Node<T extends Rule = Rule> {
  type: "rep1";
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
  | OptNode
  | RepNode
  | Rep1Node
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
                                : R extends OptNode<infer T>
                                  ? ExtractFieldNames<T, [...Depth, unknown]>
                                  : R extends RepNode<infer T>
                                    ? ExtractFieldNames<T, [...Depth, unknown]>
                                    : R extends Rep1Node<infer T>
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
 * The kind of symbol a `def()` node introduces.
 * This is a plain string — each language defines its own kinds
 * (e.g. Modelica: "Model", "Connector"; SysML: "Part", "Port").
 * Mapping to LSP SymbolKind numbers happens at the protocol boundary.
 */
export type SymbolKind = string;

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
      return createSelfProxy(newPath);
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

/**
 * A diagnostic result from a lint rule.
 * Use the `warning()`, `error()`, `info()`, or `hint()` helpers to create these.
 */
export interface LintResult {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  /** Override start byte (defaults to the symbol's range). */
  startByte?: number;
  /** Override end byte (defaults to the symbol's range). */
  endByte?: number;
  /**
   * Named field to narrow the diagnostic range to.
   * Must match a field name from the rule's `field()` declarations.
   * When set, the diagnostic highlights only that field instead of the entire symbol.
   *
   * Example: `warning("Bad name", { field: "name" })`
   */
  field?: string;
}

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

/** X6 SVG Markup element — defines the DOM structure of a node/port. */
export interface X6Markup {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number>;
  style?: Record<string, string | number>;
  className?: string;
  textContent?: string;
  children?: X6Markup[];
}

/**
 * X6 attribute styles keyed by selector.
 * Values may contain template placeholders like "{{name}}" that are resolved
 * at render time from symbol entry properties.
 */
export type X6Attrs = Record<string, Record<string, string | number | Record<string, unknown>>>;

/** X6 port group definition — appearance template for a group of ports. */
export interface X6PortGroup {
  position?: string | { name: string; args?: Record<string, unknown> };
  markup?: X6Markup | X6Markup[];
  attrs?: X6Attrs;
  zIndex?: number | "auto";
  label?: {
    markup?: X6Markup | X6Markup[];
    position?: { name: string; args?: Record<string, unknown> };
  };
}

/** X6 port item — a single port instance. */
export interface X6PortItem {
  id?: string;
  group?: string;
  args?: Record<string, unknown>;
  markup?: X6Markup | X6Markup[];
  attrs?: X6Attrs;
  zIndex?: number | "auto";
}

/** X6 port configuration — groups define templates, items define instances. */
export interface X6Ports {
  groups?: Record<string, X6PortGroup>;
  items?: X6PortItem[];
}

/** Full GraphicsConfig — node, edge, and port configuration for X6 rendering. */
export interface GraphicsConfig {
  /** The graphic role this node plays in diagram rendering. */
  role: "node" | "edge" | "group" | "port-owner";

  /** Node/Group visual configuration (X6 addNode format). */
  node?: {
    /** X6 shape name (default: "rect"). */
    shape?: string;
    /** SVG markup elements defining the DOM structure. */
    markup?: X6Markup[];
    /** Attribute styles keyed by selector (body, label, icon, etc). */
    attrs?: X6Attrs;
    /** Default node size. */
    size?: { width: number; height: number };
    /** Port group templates and optional static items. */
    ports?: X6Ports;
    /**
     * Query name to call for dynamic port items at render time.
     * The renderer calls `db.query(portQuery, symbolId)` to get port entries.
     */
    portQuery?: string;
  };

  /** Edge visual configuration (X6 addEdge format). */
  edge?: {
    /** X6 edge shape name (default: "edge"). */
    shape?: string;
    /** Field path pointing to the source node symbol. */
    source?: SelfAccessor;
    /** Field path pointing to the target node symbol. */
    target?: SelfAccessor;
    /** Field path to resolve source port name. */
    sourcePort?: SelfAccessor;
    /** Field path to resolve target port name. */
    targetPort?: SelfAccessor;
    /** Edge attrs (line styles, markers). */
    attrs?: X6Attrs;
    /** Edge labels (stereotype text, etc). */
    labels?: Array<{
      attrs?: X6Attrs;
      position?: { distance?: number; offset?: number };
    }>;
    /** Router config (e.g. "manhattan", "orth"). */
    router?: string | { name: string; args?: Record<string, unknown> };
    /** Connector config (e.g. "rounded", "smooth"). */
    connector?: string | { name: string; args?: Record<string, unknown> };
  };
}

/** A bare query function — receives the query database and the symbol entry. */
export type QueryFn = (db: QueryDB, self: SymbolEntry) => unknown;

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
  adapters?: Record<string, NodeAdapter<Fields>>;
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

/**
 * The database facade passed to adapter `transform` functions.
 * Provides cross-language projection utilities alongside the
 * standard symbol-index navigation helpers.
 */
export interface AdapterDB {
  /** Get a symbol entry by ID (real or virtual). */
  symbol(id: SymbolId): SymbolEntry | undefined;
  /** Get all direct children of a symbol. */
  childrenOf(id: SymbolId): SymbolEntry[];
  /**
   * Recursively project a foreign SymbolEntry into the given target language.
   * Walks registered adapters (C → B → A priority) to find a matching transform.
   * Returns a property bag ready to pass into the target's AST class constructors,
   * or `null` if no adapter matched.
   *
   * This is the main primitive for recursive cross-language AST walking:
   *   modelica → sysml2:  db.project(foreignModelicaClass, "sysml2")
   *   sysml2  → modelica: db.project(foreignSysmlBlock, "modelica")
   */
  project(foreignEntry: SymbolEntry, targetLang: string): Record<string, unknown> | null;
}

/**
 * Node-level cross-language adapter (Approaches A and B).
 * Placed inside a `def()` call under `adapters[languageName]`.
 *
 * **Approach A (source-side export):**
 * This node declares how it should appear when viewed by another language.
 *   adapters: {
 *     sysml2: {
 *       target: "BlockDefinition",
 *       transform: (db, self) => ({ name: self.name, parts: [...] })
 *     }
 *   }
 *
 * **Approach B (target-side import):**
 * This node declares which foreign nodes it can absorb and how.
 *   adapters: {
 *     sysml2: {
 *       accepts: ["BlockDefinition"],
 *       transform: (db, foreign) => ({ name: foreign.name, ... })
 *     }
 *   }
 */
export interface NodeAdapter<Fields extends string = string> {
  /**
   * Approach A — the className this node projects INTO in the target language.
   * Must match the `ast.className` of a rule in the target language.
   */
  target?: string;

  /**
   * Approach B — which foreign node classNames this node can accept.
   * Each string must match the `ast.className` of a rule from the foreign language.
   */
  accepts?: string[];

  /**
   * The projection function.
   * - Approach A: `self` is a SelfAccessor proxy over this node's own fields.
   * - Approach B: `self` is the raw foreign SymbolEntry being imported.
   * Returns a plain property bag consumed by the adapter registry.
   */
  transform?: (db: AdapterDB, self: TypedSelf<Fields> | SymbolEntry) => Record<string, unknown>;
}

/**
 * Top-level language-wide adapter registry (Approach C).
 * Lives at the root of `language({})` under the `adapters` key.
 *
 * Shape:
 *   adapters: {
 *     sysml2: {
 *       BlockDefinition: (db, foreignNode) => ({ target: "ClassDefinition", props: {...} })
 *     }
 *   }
 *
 * Priority: C > B > A (global registry is the most intentional override).
 */
export type GlobalAdapters = Record<
  string, // foreign language name (e.g. "sysml2", "modelica")
  Record<
    string, // foreign node className matching ast.className
    (
      db: AdapterDB,
      foreignNode: SymbolEntry,
    ) => {
      /** Local className to project into (must match a local ast.className). */
      target: string;
      /** Property bag for the projected synthetic node. */
      props: Record<string, unknown>;
    }
  >
>;

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

// ---------------------------------------------------------------------------
// Generic combinators — preserve literal types for field name inference
// ---------------------------------------------------------------------------

export function seq<T extends Rule[]>(...args: T): SeqNode<T> {
  return { type: "seq", args };
}

export function opt<T extends Rule>(arg: T): OptNode<T> {
  return { type: "opt", arg };
}

export function rep<T extends Rule>(arg: T): RepNode<T> {
  return { type: "rep", arg };
}

export function rep1<T extends Rule>(arg: T): Rep1Node<T> {
  return { type: "rep1", arg };
}

export function choice<T extends Rule[]>(...args: T): ChoiceNode<T> {
  return { type: "choice", args };
}

export function token<T extends Rule>(arg: T): TokenNode<T> {
  return { type: "token", arg };
}

/**
 * Marks a token as immediate (no whitespace allowed before it).
 * Attached as `token.immediate()` for Tree-Sitter compatibility.
 */
token.immediate = function <T extends Rule>(arg: T): TokenImmediateNode<T> {
  return { type: "token_immediate", arg };
};

export function field<N extends string>(name: N, arg: Rule): FieldNode<N> {
  return { type: "field", name, arg };
}

export function blank(): BlankNode {
  return { type: "blank" };
}

/**
 * Assigns a precedence level to a rule.
 * Higher values bind tighter.
 */
export function prec(precedence: number, arg: Rule): PrecNode {
  return { type: "prec", precedence, arg };
}

/** Left-associative precedence. */
prec.left = function (precedence: number, arg: Rule): PrecLeftNode {
  return { type: "prec_left", precedence, arg };
};

/** Right-associative precedence. */
prec.right = function (precedence: number, arg: Rule): PrecRightNode {
  return { type: "prec_right", precedence, arg };
};

/** Dynamic precedence (resolved at parse time). */
prec.dynamic = function (precedence: number, arg: Rule): PrecDynamicNode {
  return { type: "prec_dynamic", precedence, arg };
};

/**
 * Renames a node in the generated CST.
 */
export function alias(arg: Rule, value: string | SymbolNode): AliasNode {
  return { type: "alias", arg, value };
}

// ---------------------------------------------------------------------------
// def() — Unified syntax + semantics binding
// ---------------------------------------------------------------------------

/**
 * Wraps a syntax rule with semantic metadata for symbol declarations.
 *
 * **Option B (default):** Field names are inferred from the rule structure.
 *   `def({ syntax: seq(field("name", ...), field("body", ...)), symbol: (self) => ... })`
 *   → `self` has autocomplete for `.name` and `.body`
 *
 * **Option A (explicit):** Provide field names as a type parameter.
 *   `def<"name" | "body">({ syntax: seq(...), symbol: (self) => ... })`
 *   → `self` has autocomplete for `.name` and `.body`
 */
export type DefConfig<R extends Rule, Fields extends string = string, QKeys extends string = never> = {
  syntax: R;
} & DefOptions<Fields, QKeys>;

export function def<Fields extends string = never, QKeys extends string = never, R extends Rule = Rule>(
  config: DefConfig<R, [Fields] extends [never] ? ExtractFieldNames<R> : Fields, QKeys>,
): DefNode {
  const { syntax, ...options } = config;
  return { type: "def", rule: syntax, options: options as unknown as DefOptions<any> };
}

// ---------------------------------------------------------------------------
// ref() — Reference site annotation
// ---------------------------------------------------------------------------

export type RefConfig<R extends Rule, Fields extends string = string> = { syntax: R } & RefOptions<Fields>;

/**
 * Wraps a syntax rule with semantic metadata for reference sites.
 * The counterpart to `def()` — marks where symbols are *used*, not *defined*.
 *
 * ```typescript
 * type_specifier: ($) => ref({
 *   syntax: $.name,
 *   name: (self) => self.name,
 *   targetKinds: ["Class", "Type"],
 *   resolve: "qualified",
 * })
 * ```
 */
export function ref<Fields extends string = never, R extends Rule = Rule>(
  config: RefConfig<R, [Fields] extends [never] ? ExtractFieldNames<R> : Fields>,
): RefNode {
  const { syntax, ...options } = config;
  return { type: "ref", rule: syntax, options: options as RefOptions<any> };
}
