/**
 * Represents a single rule in the grammar's AST representation.
 */
export interface Rule<F extends string = never> {
  __fields?: F;
  /** The type of the rule (e.g., 'SEQ', 'CHOICE', 'TOKEN', 'FIELD', etc.) */
  type: string;
  /** Optional metadata or literal value for the rule (e.g., field name, regex string, precedence level) */
  value?: any;
  /** Child rules that this rule composes */
  children?: Rule<any>[];
}

/**
 * Built-in scanner primitives that can automatically handle complex, context-sensitive lexing
 * without requiring the user to write manual external C/WASM scanners.
 */
export interface ScannerPrimitives {
  /** Nested block comments: { open: '/*', close: '*\/' } */
  nestedComment?: { open: string; close: string };
  /** Line comments: '//' or '#' */
  lineComment?: string;
  /** Escaped/quoted identifiers: { quote: "'", escape?: '\\' } */
  escapedIdent?: { quote: string; escape?: string };
  /** String literals with escape sequences: { delim: '"', escapes: { '\\n': 10, ... } } */
  stringLiteral?: { delim: string; escapes?: Record<string, number> };
  /** Multi-word keywords that should be lexed as single tokens: ['end if', 'end for'] */
  multiWordKeywords?: string[];
  /** Python-style indentation layout parsing */
  layout?: {
    indent: string;
    dedent: string;
  };
}

/**
 * A type that accepts either a strict `Rule` object, a string literal, or a regular expression.
 */
export type RuleLike<F extends string = never> = Rule<F> | string | RegExp;

/**
 * A function that takes a map of all grammar rules and returns a grammar definition rule.
 */
type RuleBuilder<RuleName extends string, FieldName extends string = never> = (
  $: Record<RuleName, Rule<any>>,
) => RuleLike<FieldName>;

/**
 * AssemblyScript type polyfills for TypeScript IDE compatibility
 */
export type u32 = number;
export type u16 = number;
export type u8 = number;
export type i32 = number;
export type i16 = number;
export type i8 = number;
export type f32 = number;
export type f64 = number;
export type i64 = bigint;
export type u64 = bigint;
export type FieldId = u16;
export type SyntaxId = u16;
export type TensorHandle = u32;

export enum TensorType {
  Float64 = 0,
  Int32 = 1,
  Boolean = 2,
  Float32 = 3,
  Float16 = 4,
  Int64 = 5,
  Int16 = 6,
}

export interface FieldCursor {
  hasNext(): boolean;
  next(): u32;
  release(): void;
}

export interface CodeGraph<
  RuleName extends string = never,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  getNodeType(nodeId: u32): u16;
  getNodeFirstChild(nodeId: u32): u32;
  getNodeNextSibling(nodeId: u32): u32;
  runQuery(queryType: QueryName | (string & {}) | u32, queryArg: u32): u32;
  getChildByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): u32;
  getChildrenByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): FieldCursor;
  modelAttribute<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    attrName: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): u32;
  diagnostic(targetNode: u32, contextNode?: u32): void;

  // --- Mutator API ---
  createNode(type: RuleName | Extract<keyof ModelAttrs, string> | (string & {}) | u16): u32;
  cloneNode(nodeId: u32, deep: boolean): u32;
  appendChild(parentId: u32, childId: u32): void;
  insertSibling(targetId: u32, siblingId: u32): void;
  setFirstChild(parentId: u32, childId: u32): void;
  setNextSibling(nodeId: u32, siblingId: u32): void;
  replaceNode(parentId: u32, oldChildId: u32, newChildId: u32): void;
  setLiteralString(nodeId: u32, value: string): void;
  setLiteralFloat(nodeId: u32, value: f64): void;
  setLiteralInt(nodeId: u32, value: i32): void;
  getLiteralString(nodeId: u32, absoluteStart?: u32): string;
  getLiteralFloat(nodeId: u32, absoluteStart?: u32): f64;
  getLiteralInt(nodeId: u32, absoluteStart?: u32): i32;

  setLiteralNodeRef(nodeId: u32, targetId: u32): void;
  getLiteralNodeRef(nodeId: u32): u32;

  setNodeFlag<FlagName extends string = never>(
    nodeId: u32,
    flag: FlagName | Extract<keyof ModelAttrs, string> | (string & {}),
  ): void;
  clearNodeFlag<FlagName extends string = never>(
    nodeId: u32,
    flag: FlagName | Extract<keyof ModelAttrs, string> | (string & {}),
  ): void;
  hasNodeFlag<FlagName extends string = never>(
    nodeId: u32,
    flag: FlagName | Extract<keyof ModelAttrs, string> | (string & {}),
  ): boolean;

  getProvenance(nodeId: u32): u32;

  // --- Zero-GC Tensor API ---
  createTensor1D(type: TensorType, size: u32): TensorHandle;
  createTensor2D(type: TensorType, rows: u32, cols: u32): TensorHandle;
  createTensor3D(type: TensorType, d0: u32, d1: u32, d2: u32): TensorHandle;

  setTensorFloat(handle: TensorHandle, flatIndex: u32, val: f64): void;
  getTensorFloat(handle: TensorHandle, flatIndex: u32): f64;
  setTensorFloat32(handle: TensorHandle, flatIndex: u32, val: f32): void;
  getTensorFloat32(handle: TensorHandle, flatIndex: u32): f32;
  setTensorFloat16Raw(handle: TensorHandle, flatIndex: u32, val: u16): void;
  getTensorFloat16Raw(handle: TensorHandle, flatIndex: u32): u16;

  setTensorInt(handle: TensorHandle, flatIndex: u32, val: i32): void;
  getTensorInt(handle: TensorHandle, flatIndex: u32): i32;
  setTensorInt64(handle: TensorHandle, flatIndex: u32, val: i64): void;
  getTensorInt64(handle: TensorHandle, flatIndex: u32): i64;
  setTensorInt16(handle: TensorHandle, flatIndex: u32, val: i16): void;
  getTensorInt16(handle: TensorHandle, flatIndex: u32): i16;

  setTensorBool(handle: TensorHandle, flatIndex: u32, val: boolean): void;
  getTensorBool(handle: TensorHandle, flatIndex: u32): boolean;

  setLiteralTensor(nodeId: u32, handle: TensorHandle): void;
  getLiteralTensor(nodeId: u32): TensorHandle;
}

export type ASTQueryFunction<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (
  graph: CodeGraph<RuleName, FieldName, QueryName, ModelAttrs>,
  queryArg: u32,
  $: Record<RuleName, u16>,
) => u32 | boolean;

export type ASTLintFunction<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (graph: CodeGraph<RuleName, FieldName, QueryName, ModelAttrs>, queryArg: u32, $: Record<RuleName, u16>) => void;

export interface CompilerLint<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  nodes?: NoInfer<RuleName>[];
  query: string | ASTLintFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  code?: string | number;
  message: string | ((fields: Record<FieldName | (string & {}), string> & { text: string }) => string);
  severity: "error" | "warning" | "info";
}

export interface ModelAttribute<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  type: "u8" | "u16" | "u32" | "i32" | "f32" | "f64" | "bool" | "flag";
  default?: number;
  compute?: string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>;
}

/**
 * Configuration options for defining a ModelScript language grammar.
 * Modeled after Tree-sitter's Grammar API.
 */
export interface LanguageOptions<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** The name of the language (e.g., 'modelica', 'javascript'). */
  name: string;

  /**
   * A rule name or token representing the language's typical keyword structure.
   * Tree-sitter uses this for keyword extraction optimization.
   */
  word?: string;

  /**
   * A dictionary of grammar rules defining the language's syntax.
   * Keys are rule names, values are functions that compose rules.
   */
  rules: Record<RuleName, RuleBuilder<RuleName, FieldName>>;

  /**
   * Tokens to skip automatically (e.g., whitespace, comments) everywhere in the grammar.
   */
  extras?: ($: Record<RuleName, Rule<any>>) => RuleLike<any>[];

  /** Composable Scanner Primitives (Phase 1) */
  primitives?: ScannerPrimitives;

  /** External Scanner (Context-Sensitive Lexing) */
  externals?: ($: Record<RuleName, Rule<any>>) => Rule<any>[];

  /** External scanner logic (WASM fallback). Not typically used directly in DSL. */
  scanner?: (currentPos: number, scannerState: number) => number;

  /**
   * Tree-sitter Parity: Rules that serve as supertypes (interfaces/abstract classes)
   * in the generated AST. Useful for aliases and unifying node queries.
   */
  supertypes?: ($: Record<RuleName, Rule<any>>) => Rule<any>[];

  /** Rules that should be inlined directly into their parents during codegen to reduce AST depth. */
  inline?: RuleName[];

  /** Expected GLR conflicts. Specifies arrays of rule names that can legitimately conflict. */
  conflicts?: (($: Record<RuleName, Rule<any>>) => RuleLike<any>[][]) | RuleName[][];

  /** Default precedence/associativity matrices for conflict resolution. */
  precedences?: string[][];

  /** Reserved keywords to omit from generic identifier matching. */
  reserved?: Record<string, ($: Record<RuleName, Rule<any>>) => Rule<any>[]>;

  model?: ModelAttrs &
    Partial<Record<NoInfer<RuleName>, Record<string, ModelAttribute<RuleName, FieldName, QueryName, ModelAttrs>>>>;

  /** Queries (imperative AssemblyScript methods) */
  queries?: Record<QueryName, string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>>;

  /** Diagnostic Rules (imperative AssemblyScript methods) */
  lints?: Record<string, CompilerLint<RuleName, FieldName, QueryName, ModelAttrs>>;
}

/**
 * Main entry point for defining a new language grammar.
 *
 * @param options The language configuration object
 * @returns The unaltered configuration object (preserves types for downstream compilation)
 */
export function language<
  RuleName extends string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  options: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  return options;
}

type ExtractF<T> = T extends Rule<infer F> ? (string extends F ? never : F) : never;

/**
 * Coerces strings and RegExps into `token` rules, leaving existing `Rule` objects unchanged.
 */
export function toRule<F extends string>(r: RuleLike<F>): Rule<F> {
  return typeof r === "string" || r instanceof RegExp ? token(r) : (r as Rule<F>);
}

/**
 * Matches a sequence of rules, one after the other.
 */
export function seq<T extends RuleLike<any>[]>(...rules: T): Rule<ExtractF<T[number]>> {
  return { type: "SEQ", children: rules.map(toRule) };
}

export function choice<T extends RuleLike<any>[]>(...rules: T): Rule<ExtractF<T[number]>> {
  return { type: "CHOICE", children: rules.map(toRule) };
}

export function repeat<F extends string>(rule: RuleLike<F>): Rule<F> {
  return { type: "REPEAT", children: [toRule(rule)] };
}

export function repeat1<F extends string>(rule: RuleLike<F>): Rule<F> {
  return seq(rule, repeat(rule));
}

export function optional<F extends string>(rule: RuleLike<F>): Rule<F> {
  return choice(rule, seq());
}

export function sepBy1<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return seq(rule, repeat(seq(separator, rule)));
}

export function sepBy<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return optional(sepBy1(rule, separator));
}

export function sepBy1Trailing<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return seq(sepBy1(rule, separator), optional(separator));
}

export function sepByTrailing<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return optional(sepBy1Trailing(rule, separator));
}

export function field<F extends string>(name: F, rule: RuleLike<any>): Rule<F> {
  return { type: "FIELD", value: name, children: [toRule(rule)] };
}

/**
 * Defines a lexer token. For strings and RegExps, defines the match pattern.
 * For other rules, groups them into a single monolithic token in the lexer.
 */
export function token<F extends string>(pattern: RuleLike<F>): Rule<F> {
  if (typeof pattern === "string" || pattern instanceof RegExp) {
    return { type: "TOKEN", value: pattern };
  }
  return { type: "TOKEN", children: [toRule(pattern)] };
}

(token as any).immediate = function <F extends string>(rule: RuleLike<F>): Rule<F> {
  return { type: "TOKEN_IMMEDIATE", children: [toRule(rule)] };
};

/**
 * Renames a matched rule in the AST output. Useful for overriding generic rule names with specific context.
 */
export function alias<F extends string>(rule: RuleLike<F>, name: string | Rule<any>): Rule<F> {
  const nameValue = typeof name === "string" ? name : name.value;
  return { type: "ALIAS", value: nameValue, children: [toRule(rule)] };
}

export type SemanticTokenType =
  | "namespace"
  | "type"
  | "class"
  | "enum"
  | "interface"
  | "struct"
  | "typeParameter"
  | "parameter"
  | "variable"
  | "property"
  | "enumMember"
  | "event"
  | "function"
  | "method"
  | "macro"
  | "keyword"
  | "modifier"
  | "comment"
  | "string"
  | "number"
  | "regexp"
  | "operator"
  | "decorator";

export type SemanticTokenModifier =
  | "declaration"
  | "definition"
  | "readonly"
  | "static"
  | "deprecated"
  | "abstract"
  | "async"
  | "modification"
  | "documentation"
  | "defaultLibrary";

export function semanticToken<
  F extends string,
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  tokenType: SemanticTokenType | (string & {}),
  rule: RuleLike<F>,
  modifiers?:
    | (SemanticTokenModifier | (string & {}))[]
    | Record<
        SemanticTokenModifier | (string & {}),
        boolean | string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
      >,
): Rule<F> {
  return { type: "SEMANTIC", value: { type: tokenType, modifiers: modifiers || [] }, children: [toRule(rule)] };
}

export function reserved<F extends string>(wordset: string, rule: RuleLike<F>): Rule<F> {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

export function prec<F extends string>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC", value, children: [rule] };
}

(prec as any).left = function <F extends string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  if (typeof value === "object") return { type: "PREC_LEFT", value: 0, children: [value] };
  return { type: "PREC_LEFT", value, children: [rule!] };
};

(prec as any).right = function <F extends string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  if (typeof value === "object") return { type: "PREC_RIGHT", value: 0, children: [value] };
  return { type: "PREC_RIGHT", value, children: [rule!] };
};

(prec as any).dynamic = function <F extends string>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC_DYNAMIC", value, children: [rule] };
};
