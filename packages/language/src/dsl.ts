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

export interface FieldCursor {
  hasNext(): boolean;
  next(): u32;
  release(): void;
}

export interface SalsaDB<FieldName extends string = never> {
  getNodeType(nodePtr: u32): u16;
  getNodeFirstChild(nodePtr: u32): u32;
  getNodeNextSibling(nodePtr: u32): u32;
  runQuery(queryType: u32, queryArg: u32): u32;
  getChildByFieldId(ptr: u32, fieldId: FieldName | (string & {}) | i32): u32;
  getChildrenByFieldId(ptr: u32, fieldId: FieldName | (string & {}) | i32): FieldCursor;
}

export type ASTQueryFunction<RuleName extends string = string, FieldName extends string = never> = (
  db: SalsaDB<FieldName>,
  queryArg: u32,
  $: Record<RuleName, u16>,
) => u32;

export interface ModelAttribute<RuleName extends string = string, FieldName extends string = never> {
  type: "u8" | "u16" | "u32" | "i32" | "f32" | "f64" | "bool";
  default?: number;
  compute?: string | ASTQueryFunction<RuleName, FieldName>;
}

/**
 * Configuration options for defining a ModelScript language grammar.
 * Modeled after Tree-sitter's Grammar API.
 */
export interface LanguageOptions<RuleName extends string = string, FieldName extends string = never> {
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

  /** Demand-Driven Semantic AST Attributes (Models) */
  models?: Record<string, ModelAttribute<RuleName, FieldName>>;

  /** Queries (imperative AssemblyScript methods) */
  queries?: Record<string, string | ASTQueryFunction<RuleName, FieldName>>;
}

/**
 * Main entry point for defining a new language grammar.
 *
 * @param options The language configuration object
 * @returns The unaltered configuration object (preserves types for downstream compilation)
 */
export function language<RuleName extends string, FieldName extends string = never>(
  options: LanguageOptions<RuleName, FieldName>,
): LanguageOptions<RuleName, FieldName> {
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
