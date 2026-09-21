/**
 * Grammar combinator functions, rule builders, and rewriting DSL helpers.
 */

import type { ASTQueryFunction, LintResult, QueryFnOrObject } from "./query-types.js";
import type { QueryDB, SymbolEntry } from "./types.js";

/**
 * Represents a single rule in the grammar's AST representation.
 */
export interface Rule<F extends string = string> {
  __fields?: F;
  /** The type of the rule (e.g., 'SEQ', 'CHOICE', 'TOKEN', 'FIELD', etc.) */
  type: string;
  /** Optional metadata or literal value for the rule (e.g., field name, regex string, precedence level) */
  value?: any;
  /** Child rules that this rule composes */
  children?: Rule<any>[];
}

/**
 * A type that accepts either a strict `Rule` object, a string literal, or a regular expression.
 */
export type RuleLike<F extends string = string> = Rule<F> | string | RegExp;

/**
 * A function that takes a map of all grammar rules and returns a grammar definition rule.
 */
export type RuleBuilder<RuleName extends string, FieldName extends string = string> = (
  $: Record<RuleName | (string & {}), RuleLike<any>>,
) => RuleLike<FieldName>;

export type ExtractF<T> = T extends (infer U)[]
  ? U extends Rule<infer F>
    ? F
    : any
  : T extends Rule<infer F>
    ? F
    : any;

/**
 * Coerces strings and RegExps into `token` rules, leaving existing `Rule` objects unchanged.
 */
export function toRule<F extends string = string>(r: RuleLike<F>): Rule<F> {
  const isRegExp = r instanceof RegExp || Object.prototype.toString.call(r) === "[object RegExp]";
  return typeof r === "string" || isRegExp ? token(r as string | RegExp) : (r as Rule<F>);
}

/**
 * Matches a sequence of rules, one after the other.
 * Equivalent to concatenation in EBNF: `A B C`
 */
export function seq<T extends RuleLike<any>[]>(...rules: T): Rule<ExtractF<T[number]>> {
  return { type: "SEQ", children: rules.map(toRule) };
}

/**
 * Matches any one of the provided rules.
 * Equivalent to alternation in EBNF: `A | B | C`
 */
export function choice<T extends RuleLike<any>[]>(...rules: T): Rule<ExtractF<T[number]>> {
  return { type: "CHOICE", children: rules.map(toRule) };
}

/**
 * Matches zero or more repetitions of the given rule.
 * Equivalent to Kleene star in EBNF: `A*`
 */
export function repeat<F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return { type: "REPEAT", children: [toRule(rule)] };
}

/**
 * Matches one or more repetitions of the given rule.
 * Equivalent to Kleene plus in EBNF: `A+`
 */
export function repeat1<F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return seq(rule, repeat(rule));
}

/**
 * Makes the given rule optional.
 * Equivalent to optional in EBNF: `A?`
 */
export function optional<F extends string = string>(rule: RuleLike<F>): Rule<F> {
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

/**
 * Assigns a specific field name to the matched rule in the AST output.
 * Fields make querying and traversing the AST substantially easier.
 */
export function field<F extends string = string>(name: F, rule: RuleLike<any>): Rule<F> {
  return { type: "FIELD", value: name, children: [toRule(rule)] };
}

/**
 * Defines a lexer token. For strings and RegExps, defines the match pattern.
 * For other rules, groups them into a single monolithic token in the lexer.
 */
export function token<F extends string = string>(pattern: RuleLike<F>): Rule<F> {
  if (
    typeof pattern === "string" ||
    pattern instanceof RegExp ||
    Object.prototype.toString.call(pattern) === "[object RegExp]"
  ) {
    return { type: "TOKEN", value: pattern };
  }
  return { type: "TOKEN", children: [toRule(pattern)] };
}

(token as any).immediate = function <F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return { type: "TOKEN_IMMEDIATE", children: [toRule(rule)] };
};

/**
 * Renames a matched rule in the AST output. Useful for overriding generic rule names with specific context.
 * For example, aliasing a `binary_expression` as `argument`.
 */
export function alias<F extends string = string>(rule: RuleLike<F>, name: string | Rule<never>): Rule<F> {
  const nameValue = typeof name === "string" ? name : name.value;
  return { type: "ALIAS", value: nameValue, children: [toRule(rule)] };
}

export type TokenClass = "keyword" | "type" | "operator" | "string" | "number" | "comment" | "punctuation";

export function syntaxToken<F extends string = string>(tokenClass: TokenClass, rule: RuleLike<F>): any {
  return { type: "SYNTAX_TOKEN", value: tokenClass, children: [toRule(rule)] };
}

export function keyword<F extends string = string>(rule: RuleLike<F>): any {
  return syntaxToken("keyword", rule);
}

export function op<F extends string = string>(rule: RuleLike<F>): any {
  return syntaxToken("operator", rule);
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
  F extends string = never,
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

export function reserved<F extends string = string>(wordset: string, rule: RuleLike<F>): Rule<F> {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

/**
 * Resolves GLR shift/reduce or reduce/reduce conflicts by assigning static or dynamic precedences.
 */
export interface PrecFunction {
  <F extends string = string>(value: number, rule: RuleLike<F>): Rule<F>;
  /** Assigns a static precedence level with left associativity. */
  left<F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F>;
  /** Assigns a static precedence level with right associativity. */
  right<F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F>;
  /** Assigns a dynamic precedence for GLR tie-breaking at runtime. */
  dynamic<F extends string = string>(value: number, rule: RuleLike<F>): Rule<F>;
}

export const prec: PrecFunction = function <F extends string = string>(value: number, rule: RuleLike<F>): Rule<F> {
  return { type: "PREC", value, children: [toRule(rule)] };
} as PrecFunction;

prec.left = function <F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F> {
  const r = rule !== undefined ? rule : (value as RuleLike<F>);
  const val = rule !== undefined ? (value as number) : 0;
  return { type: "PREC_LEFT", value: val, children: [toRule(r)] };
};

prec.right = function <F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F> {
  const r = rule !== undefined ? rule : (value as RuleLike<F>);
  const val = rule !== undefined ? (value as number) : 0;
  return { type: "PREC_RIGHT", value: val, children: [toRule(r)] };
};

export function blank(): any {
  return { type: "BLANK" };
}

export interface DefConfig<F extends string = string> {
  syntax?: RuleLike<F>;
  symbol?: (self: any) => any;
  queries?: Record<string, QueryFnOrObject>;
  lint?: Record<string, (db: QueryDB, self: SymbolEntry, ...args: any[]) => LintResult | LintResult[] | null>;
  diff?: any;
  model?: any;
  [key: string]: any;
}

export interface RefConfig<F extends string = string> {
  syntax?: RuleLike<F>;
  symbol?: (self: any) => any;
  queries?: Record<string, QueryFnOrObject>;
  lint?: Record<string, (db: QueryDB, self: SymbolEntry, ...args: any[]) => LintResult | LintResult[] | null>;
  diff?: any;
  model?: any;
  [key: string]: any;
}

export function def<F extends string = string>(config: DefConfig<F>): Rule<F> {
  const { syntax, ...options } = config;
  return { type: "DEF" as any, value: options, children: syntax ? [toRule(syntax)] : [] } as any;
}

export function ref<F extends string = string>(config: RefConfig<F>): Rule<F> {
  const { syntax, ...options } = config;
  return { type: "REF" as any, value: options, children: syntax ? [toRule(syntax)] : [] } as any;
}

// --- E-Graph Rewrite Rule Combinators ---

/**
 * Defines algebraic rewrite rules for the Equality Saturation E-Graph.
 * Nodes represent expressions to be dynamically simplified at compile time.
 */
export class TransformCombinator {
  constructor(
    public op: string,
    public args: any[],
  ) {}

  toSExpr(): string {
    if (this.op === "variable") return `?${this.args[0]}`;
    if (this.op === "constant") return `${this.args[0]}`;
    const argsStr = this.args.map((a) => (a instanceof TransformCombinator ? a.toSExpr() : String(a))).join(" ");
    return `(${this.op} ${argsStr})`;
  }
}

export function add(a: any, b: any) {
  return new TransformCombinator("add", [a, b]);
}
export function sub(a: any, b: any) {
  return new TransformCombinator("sub", [a, b]);
}
export function mul(a: any, b: any) {
  return new TransformCombinator("mul", [a, b]);
}
export function div(a: any, b: any) {
  return new TransformCombinator("div", [a, b]);
}
export function constant(val: number) {
  return new TransformCombinator("constant", [val]);
}
export const c = constant;
export function variable(name: string) {
  return new TransformCombinator("variable", [name]);
}
export const v = variable;
export function neg(a: any) {
  return new TransformCombinator("neg", [a]);
}
export function abs(a: any) {
  return new TransformCombinator("abs", [a]);
}
export function eq(a: any, b: any) {
  return new TransformCombinator("eq", [a, b]);
}
export function neq(a: any, b: any) {
  return new TransformCombinator("neq", [a, b]);
}
export function lt(a: any, b: any) {
  return new TransformCombinator("lt", [a, b]);
}
export function gt(a: any, b: any) {
  return new TransformCombinator("gt", [a, b]);
}
export function and(a: any, b: any) {
  return new TransformCombinator("and", [a, b]);
}
export function or(a: any, b: any) {
  return new TransformCombinator("or", [a, b]);
}
export function not(a: any) {
  return new TransformCombinator("not", [a]);
}
export function sin(a: any) {
  return new TransformCombinator("sin", [a]);
}
export function cos(a: any) {
  return new TransformCombinator("cos", [a]);
}

export const ruleCombinators = {
  add,
  sub,
  mul,
  div,
  neg,
  abs,
  eq,
  neq,
  lt,
  gt,
  and,
  or,
  not,
  var: variable,
  v: variable,
  const: constant,
  c: constant,
};

export function subtype(sourceType: any, targetType: any) {
  const unwrap = (v: any) => (typeof v === "object" && v !== null ? v.value || v.name || v.id || String(v) : String(v));
  const f = fact("subtype", unwrap(sourceType), unwrap(targetType));
  const fn: any = (db: any, source: number, target: number) => {
    const sType = typeof sourceType === "number" ? sourceType : db.ast.getType(source);
    const tType = typeof targetType === "number" ? targetType : db.ast.getType(target);
    return sType === tType;
  };
  Object.assign(fn, f);
  fn.args = [sourceType, targetType];
  return fn;
}
export const Subtype = subtype;

export function fact(predicate: string, ...args: string[]) {
  return {
    predicate,
    args,
    if(...body: { predicate: string; args: string[] }[]) {
      return {
        head: { predicate, args },
        body,
      };
    },
  };
}
export const Fact = fact;

export const $: any = new Proxy(
  {},
  {
    get(_target, prop: string) {
      return { type: "REF", value: prop };
    },
  },
);

// --- Functional Combinators for CFG, DFA & Abstract Domains ---

export interface FlowNode {
  type: string;
  payload: any;
}

export const flow = {
  field(name: string, scope?: any): FlowNode {
    return { type: "FIELD", payload: { name, scope } };
  },
  children(name: string, mapper?: (node: any) => any): FlowNode {
    return { type: "CHILDREN", payload: { name, mapper } };
  },
  seq(...steps: any[]): FlowNode {
    return { type: "SEQ", payload: { steps } };
  },
  branch(config: { cond: any; then: any; else?: any }): FlowNode {
    return { type: "BRANCH", payload: config };
  },
  loop(config: { cond?: any; body: any; step?: any }): FlowNode {
    return { type: "LOOP", payload: config };
  },
  for(config: { init?: any; cond?: any; step?: any; body: any }): FlowNode {
    return { type: "FOR", payload: config };
  },
  switch(config: { discriminant: any; cases: any; default?: any }): FlowNode {
    return { type: "SWITCH", payload: config };
  },
  try(config: { body: any; catchers?: any; else?: any; finally?: any }): FlowNode {
    return { type: "TRY", payload: config };
  },
  call(config: {
    target: any;
    arguments?: any;
    positional?: any;
    keywords?: any;
    spreadPositional?: any;
    spreadKeywords?: any;
  }): FlowNode {
    return { type: "CALL", payload: config };
  },
  unwind(config: { body: any; cleanups: any }): FlowNode {
    return { type: "UNWIND", payload: config };
  },
  rules(map: Record<string, FlowNode>): Record<string, FlowNode> {
    return map;
  },
};

export const domain = {
  octagon(opts?: { varExtractor?: (node: any, graph: any) => string | null }): any {
    return { kind: "octagon", varExtractor: opts?.varExtractor };
  },
  interval(): any {
    return { kind: "interval" };
  },
  bitset(): any {
    return { kind: "bitset" };
  },
  alias(): any {
    return { kind: "alias" };
  },
  product(...domains: any[]): any {
    return { kind: "product", domains };
  },
  dae(opts?: {
    indexReduction?: "pantelides" | "none";
    tearing?: "cellier" | "minimum_degree" | "none";
    groebnerPreReduction?: boolean;
    warmStart?: boolean;
    homotopy?: boolean;
    dualAD?: boolean;
    isolationMethods?: (
      | "explicit"
      | "linear"
      | "quadratic"
      | "harmonic"
      | "lambertW"
      | "treePeeling"
      | "fixedPoint"
      | "groebner"
    )[];
  }): any {
    return { kind: "dae", ...opts };
  },
  simulation(opts?: {
    solver?: "euler" | "rk4" | "radau" | "cvode";
    startTime?: number;
    stopTime?: number;
    stepSize?: number;
    tolerance?: number;
  }): any {
    return { kind: "simulation", ...opts };
  },
  workspace(opts?: { incrementalQueries?: boolean; memoization?: "salsa" | "naive" }): any {
    return { kind: "workspace", ...opts };
  },
  reasoner(opts?: {
    expressivity?: "OWL2RL" | "DL-Lite" | "RDFS";
    datalogFixpoint?: "semi-naive" | "naive";
    axioms?: any[];
  }): any {
    return { kind: "reasoner", ...opts };
  },
};

export const transfer = {
  on(nodeType: any, transferFn: any): any {
    return { nodeType, transferFn };
  },
  assign(lhs: any, rhs: any): any {
    return { type: "ASSIGN", lhs, rhs };
  },
  assume(cond: any): any {
    return { type: "ASSUME", cond };
  },
  kill(variable: any): any {
    return { type: "KILL", variable };
  },
};

export const check = {
  assert(nodeType: any, predicate: any, message: string): any {
    return { nodeType, predicate, message };
  },
};

export function analysis(config: { cfg?: any; domain: any; transfers?: any[]; diagnostics?: any[] }): any {
  return config;
}
