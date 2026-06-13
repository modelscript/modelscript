/* eslint-disable */
export interface Rule {
  type: string;
  value?: any;
  children?: Rule[];
}

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
}

export type RuleLike = Rule | string | RegExp;

type RuleBuilder<RuleName extends string> = ($: Record<RuleName, Rule>) => RuleLike;

export interface CompilerOptions<RuleName extends string = string> {
  name: string;
  word?: string; // Tree-sitter keyword extraction optimization token
  rules: Record<RuleName, RuleBuilder<RuleName>>;

  // Composable Scanner Primitives (Phase 1)
  scannerPrimitives?: ScannerPrimitives;

  // External Scanner (Context-Sensitive Lexing)
  externals?: ($: Record<RuleName, Rule>) => Rule[];
  externalScanner?: string | ((currentPos: number, scannerState: number) => number);

  /** Optional post-processing hook */
  postprocessorHook?: string;

  /** Optional blackboard settings */
  blackboard?: any;

  /** Optional namespaces settings */
  namespaces?: any;

  // Preprocessor Interceptor (Phase 3)
  preprocessorHook?: string;

  // Tokens used for island-based error recovery (e.g., [';', '}'])
  syncTokens?: string[];

  // Tree-sitter Parity: GLR Conflicts, Inlining, and Precedences
  inline?: RuleName[];
  conflicts?: (($: Record<RuleName, Rule>) => RuleLike[][]) | RuleName[][];
  precedences?: string[][];
  reserved?: Record<string, ($: Record<RuleName, Rule>) => Rule[]>;
}

export type GrammarOptions = CompilerOptions<any>;
export type LanguageOptions = CompilerOptions<any>;

export function language<RuleName extends string>(options: CompilerOptions<RuleName>): CompilerOptions<RuleName> {
  return options;
}

export function toRule(r: RuleLike): Rule {
  return typeof r === "string" || r instanceof RegExp ? token(r) : r;
}

export function seq(...rules: RuleLike[]): Rule {
  return { type: "SEQ", children: rules.map(toRule) };
}

export function choice(...rules: RuleLike[]): Rule {
  return { type: "CHOICE", children: rules.map(toRule) };
}

export function repeat(rule: RuleLike): Rule {
  return { type: "REPEAT", children: [toRule(rule)] };
}

export function repeat1(rule: RuleLike): Rule {
  return seq(rule, repeat(rule));
}

export function optional(rule: RuleLike): Rule {
  return choice(rule, seq());
}

export function sepBy1(rule: RuleLike, separator: RuleLike): Rule {
  return seq(rule, repeat(seq(separator, rule)));
}

export function sepBy(rule: RuleLike, separator: RuleLike): Rule {
  return optional(sepBy1(rule, separator));
}

export function sepBy1Trailing(rule: RuleLike, separator: RuleLike): Rule {
  return seq(sepBy1(rule, separator), optional(separator));
}

export function sepByTrailing(rule: RuleLike, separator: RuleLike): Rule {
  return optional(sepBy1Trailing(rule, separator));
}

export function between(left: RuleLike, right: RuleLike, rule: RuleLike): Rule {
  return seq(left, rule, right);
}

export function terminatedBy(rule: RuleLike, terminator: RuleLike): Rule {
  return seq(rule, terminator);
}

export function manyTill(rule: RuleLike, terminator: RuleLike): Rule {
  return seq(repeat(rule), terminator);
}

export function separatedPair(left: RuleLike, separator: RuleLike, right: RuleLike): Rule {
  return seq(left, separator, right);
}

export function field(name: string, rule: RuleLike): Rule {
  return { type: "FIELD", value: name, children: [toRule(rule)] };
}

export function sym(name: string): Rule {
  return { type: "SYMBOL", value: name };
}

export function token(pattern: RegExp | string): Rule {
  return { type: "TOKEN", value: pattern };
}

token.immediate = function (rule: RuleLike): Rule {
  return { type: "TOKEN_IMMEDIATE", children: [toRule(rule)] };
};

export function alias(rule: RuleLike, name: string | Rule): Rule {
  const nameValue = typeof name === "string" ? name : name.value;
  return { type: "ALIAS", value: nameValue, children: [toRule(rule)] };
}

export function reserved(wordset: string, rule: RuleLike): Rule {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

export function def(rule: Rule): Rule {
  return { type: "DEF", children: [rule] };
}

export function ref(rule: Rule): Rule {
  return { type: "REF", children: [rule] };
}

export function sync(rule: Rule, ...tokens: string[]): Rule {
  return { type: "SYNC", value: tokens, children: [rule] };
}

export function prec(value: number, rule: Rule): Rule {
  return { type: "PREC", value, children: [rule] };
}

prec.left = function (value: number | Rule, rule?: Rule): Rule {
  if (typeof value === "object") return { type: "PREC_LEFT", value: 0, children: [value] };
  return { type: "PREC_LEFT", value, children: [rule!] };
};

prec.right = function (value: number | Rule, rule?: Rule): Rule {
  if (typeof value === "object") return { type: "PREC_RIGHT", value: 0, children: [value] };
  return { type: "PREC_RIGHT", value, children: [rule!] };
};

prec.dynamic = function (value: number, rule: Rule): Rule {
  return { type: "PREC_DYNAMIC", value, children: [rule] };
};
