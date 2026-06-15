/**
 * Represents a single rule in the grammar's AST representation.
 */
export interface Rule {
  /** The type of the rule (e.g., 'SEQ', 'CHOICE', 'TOKEN', 'FIELD', etc.) */
  type: string;
  /** Optional metadata or literal value for the rule (e.g., field name, regex string, precedence level) */
  value?: any;
  /** Child rules that this rule composes */
  children?: Rule[];
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
export type RuleLike = Rule | string | RegExp;

/**
 * A function that takes a map of all grammar rules and returns a grammar definition rule.
 */
type RuleBuilder<RuleName extends string> = ($: Record<RuleName, Rule>) => RuleLike;

/**
 * Configuration options for defining a ModelScript language grammar.
 * Modeled after Tree-sitter's Grammar API.
 */
export interface LanguageOptions<RuleName extends string = string> {
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
  rules: Record<RuleName, RuleBuilder<RuleName>>;

  /**
   * Tokens to skip automatically (e.g., whitespace, comments) everywhere in the grammar.
   */
  extras?: ($: Record<RuleName, Rule>) => RuleLike[];

  /** Composable Scanner Primitives (Phase 1) */
  primitives?: ScannerPrimitives;

  /** External Scanner (Context-Sensitive Lexing) */
  externals?: ($: Record<RuleName, Rule>) => Rule[];

  /** External scanner logic (WASM fallback). Not typically used directly in DSL. */
  scanner?: (currentPos: number, scannerState: number) => number;

  /**
   * Tree-sitter Parity: Rules that serve as supertypes (interfaces/abstract classes)
   * in the generated AST. Useful for aliases and unifying node queries.
   */
  supertypes?: ($: Record<RuleName, Rule>) => Rule[];

  /** Rules that should be inlined directly into their parents during codegen to reduce AST depth. */
  inline?: RuleName[];

  /** Expected GLR conflicts. Specifies arrays of rule names that can legitimately conflict. */
  conflicts?: (($: Record<RuleName, Rule>) => RuleLike[][]) | RuleName[][];

  /** Default precedence/associativity matrices for conflict resolution. */
  precedences?: string[][];

  /** Reserved keywords to omit from generic identifier matching. */
  reserved?: Record<string, ($: Record<RuleName, Rule>) => Rule[]>;
}

/**
 * Main entry point for defining a new language grammar.
 *
 * @param options The language configuration object
 * @returns The unaltered configuration object (preserves types for downstream compilation)
 */
export function language<RuleName extends string>(options: LanguageOptions<RuleName>): LanguageOptions<RuleName> {
  return options;
}

/**
 * Coerces strings and RegExps into `token` rules, leaving existing `Rule` objects unchanged.
 */
export function toRule(r: RuleLike): Rule {
  return typeof r === "string" || r instanceof RegExp ? token(r) : r;
}

/**
 * Matches a sequence of rules, one after the other.
 */
export function seq(...rules: RuleLike[]): Rule {
  return { type: "SEQ", children: rules.map(toRule) };
}

/**
 * Matches exactly one of the provided rules (a branch/alternative).
 */
export function choice(...rules: RuleLike[]): Rule {
  return { type: "CHOICE", children: rules.map(toRule) };
}

/**
 * Matches zero or more repetitions of the provided rule.
 */
export function repeat(rule: RuleLike): Rule {
  return { type: "REPEAT", children: [toRule(rule)] };
}

/**
 * Matches one or more repetitions of the provided rule.
 */
export function repeat1(rule: RuleLike): Rule {
  return seq(rule, repeat(rule));
}

/**
 * Matches the provided rule zero or one time.
 */
export function optional(rule: RuleLike): Rule {
  return choice(rule, seq());
}

/**
 * Matches a sequence of the provided rule, separated by the separator rule (one or more times).
 * Trailing separators are NOT allowed.
 */
export function sepBy1(rule: RuleLike, separator: RuleLike): Rule {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Matches a sequence of the provided rule, separated by the separator rule (zero or more times).
 * Trailing separators are NOT allowed.
 */
export function sepBy(rule: RuleLike, separator: RuleLike): Rule {
  return optional(sepBy1(rule, separator));
}

/**
 * Matches a sequence of the provided rule, separated by the separator rule (one or more times).
 * Allows an optional trailing separator.
 */
export function sepBy1Trailing(rule: RuleLike, separator: RuleLike): Rule {
  return seq(sepBy1(rule, separator), optional(separator));
}

/**
 * Matches a sequence of the provided rule, separated by the separator rule (zero or more times).
 * Allows an optional trailing separator.
 */
export function sepByTrailing(rule: RuleLike, separator: RuleLike): Rule {
  return optional(sepBy1Trailing(rule, separator));
}

/**
 * Assigns a field name to a matched rule, making it accessible as an explicit property in the generated AST.
 */
export function field(name: string, rule: RuleLike): Rule {
  return { type: "FIELD", value: name, children: [toRule(rule)] };
}

/**
 * Defines a lexer token. For strings and RegExps, defines the match pattern.
 * For other rules, groups them into a single monolithic token in the lexer.
 */
export function token(pattern: RuleLike): Rule {
  if (typeof pattern === "string" || pattern instanceof RegExp) {
    return { type: "TOKEN", value: pattern };
  }
  return { type: "TOKEN", children: [toRule(pattern)] };
}

/**
 * Defines a token that must immediately follow the previous token (no skipped `extras` like whitespace allowed in between).
 */
token.immediate = function (rule: RuleLike): Rule {
  return { type: "TOKEN_IMMEDIATE", children: [toRule(rule)] };
};

/**
 * Renames a matched rule in the AST output. Useful for overriding generic rule names with specific context.
 */
export function alias(rule: RuleLike, name: string | Rule): Rule {
  const nameValue = typeof name === "string" ? name : name.value;
  return { type: "ALIAS", value: nameValue, children: [toRule(rule)] };
}

/**
 * Specifies that the provided rule is subject to the given reserved word list.
 */
export function reserved(wordset: string, rule: RuleLike): Rule {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

/**
 * Assigns a generic precedence to a rule for conflict resolution. Higher values bind tighter.
 */
export function prec(value: number, rule: Rule): Rule {
  return { type: "PREC", value, children: [rule] };
}

/**
 * Assigns left-associativity and precedence to a rule.
 * If no precedence is given, defaults to 0.
 */
prec.left = function (value: number | Rule, rule?: Rule): Rule {
  if (typeof value === "object") return { type: "PREC_LEFT", value: 0, children: [value] };
  return { type: "PREC_LEFT", value, children: [rule!] };
};

/**
 * Assigns right-associativity and precedence to a rule.
 * If no precedence is given, defaults to 0.
 */
prec.right = function (value: number | Rule, rule?: Rule): Rule {
  if (typeof value === "object") return { type: "PREC_RIGHT", value: 0, children: [value] };
  return { type: "PREC_RIGHT", value, children: [rule!] };
};

/**
 * Assigns dynamic precedence to a rule. Used at runtime during GLR parsing to prioritize
 * one successful parse branch over another.
 */
prec.dynamic = function (value: number, rule: Rule): Rule {
  return { type: "PREC_DYNAMIC", value, children: [rule] };
};
