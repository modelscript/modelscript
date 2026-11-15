// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Grammar combinator functions, rule builders, and rewriting DSL helpers.
 */

import type { ASTQueryFunction, LintResult, QueryFnOrObject } from "./query-types.js";
import type { QueryDB, SymbolEntry } from "./types.js";

/**
 * Represents a single rule in the grammar's AST representation.
 */
export interface Rule<F extends string = string> {
  /** Phantom type brand tracking AST field names declared within this rule. */
  __fields?: F | undefined;
  /** The type of the rule (e.g., 'SEQ', 'CHOICE', 'TOKEN', 'FIELD', etc.) */
  type: string;
  /** Optional metadata or literal value for the rule (e.g., field name, regex string, precedence level) */
  value?: unknown;
  /** Child rules that this rule composes */
  children?: Rule<string>[] | undefined;
}

/**
 * A type that accepts either a strict `Rule` object, a string literal, or a regular expression.
 */
export type RuleLike<F extends string = string> = Rule<F> | string | RegExp;

/**
 * A function that takes a map of all grammar rules and returns a grammar definition rule.
 */
export type RuleBuilder<RuleName extends string, FieldName extends string = string> = (
  $: Record<RuleName | (string & {}), RuleLike<string>>,
) => RuleLike<FieldName>;

/**
 * Extracts the union of AST field names `F` from a `Rule<F>` or an array/tuple of rules.
 */
export type ExtractF<T> = T extends (infer U)[]
  ? U extends Rule<infer F>
    ? F
    : never
  : T extends Rule<infer F>
    ? F
    : never;

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
export function seq<T extends RuleLike<string>[]>(...rules: T): Rule<ExtractF<T[number]>> {
  return { type: "SEQ", children: rules.map(toRule) };
}

/**
 * Matches any one of the provided rules.
 * Equivalent to alternation in EBNF: `A | B | C`
 */
export function choice<T extends RuleLike<string>[]>(...rules: T): Rule<ExtractF<T[number]>> {
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
  return { type: "REPEAT1", children: [toRule(rule)] };
}

/**
 * Makes the given rule optional.
 * Equivalent to optional in EBNF: `A?`
 */
export function optional<F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return { type: "OPTIONAL", children: [toRule(rule)] };
}

/**
 * Matches one or more occurrences of `rule` separated by `separator`.
 * Equivalent to `rule (separator rule)*` in EBNF.
 */
export function sepBy1<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Matches zero or more occurrences of `rule` separated by `separator`.
 * Equivalent to `(rule (separator rule)*)?` in EBNF.
 */
export function sepBy<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return optional(sepBy1(rule, separator));
}

/**
 * Matches one or more occurrences of `rule` separated by `separator`, allowing an optional trailing `separator`.
 */
export function sepBy1Trailing<F1 extends string, F2 extends string>(
  rule: RuleLike<F1>,
  separator: RuleLike<F2>,
): Rule<F1 | F2> {
  return seq(sepBy1(rule, separator), optional(separator));
}

/**
 * Matches zero or more occurrences of `rule` separated by `separator`, allowing an optional trailing `separator`.
 */
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
export function field<F extends string = string>(name: F, rule: RuleLike<string>): Rule<F> {
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

/**
 * Matches a token immediately adjacent to the previous token without allowing intervening extras/whitespace.
 */
(token as typeof token & { immediate: <F extends string = string>(rule: RuleLike<F>) => Rule<F> }).immediate =
  function <F extends string = string>(rule: RuleLike<F>): Rule<F> {
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

/**
 * High-level lexical token categories used for syntax highlighting.
 */
export type TokenClass = "keyword" | "type" | "operator" | "string" | "number" | "comment" | "punctuation";

/**
 * Wraps a grammar rule with a lexical `TokenClass` for syntax highlighting.
 */
export function syntaxToken<F extends string = string>(tokenClass: TokenClass, rule: RuleLike<F>): Rule<F> {
  return { type: "SYNTAX_TOKEN", value: tokenClass, children: [toRule(rule)] };
}

/**
 * Marks a grammar rule as a language keyword for syntax highlighting and lexical classification.
 */
export function keyword<F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return syntaxToken("keyword", rule);
}

/**
 * Marks a grammar rule as an operator token for syntax highlighting and lexical classification.
 */
export function op<F extends string = string>(rule: RuleLike<F>): Rule<F> {
  return syntaxToken("operator", rule);
}

/**
 * Standard LSP semantic token types for context-sensitive syntax highlighting.
 */
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

/**
 * Standard LSP semantic token modifiers that refine a semantic token's classification.
 */
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

/**
 * Attaches an LSP semantic token type and optional static or query-computed modifiers to a grammar rule.
 */
export function semanticToken<
  F extends string = never,
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>,
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

/**
 * Associates a grammar rule with a named set of reserved words that cannot be matched as identifiers in this context.
 */
export function reserved<F extends string = string>(wordset: string, rule: RuleLike<F>): Rule<F> {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

/**
 * Resolves GLR shift/reduce or reduce/reduce conflicts by assigning static or dynamic precedences.
 */
export interface PrecFunction {
  /** Assigns a static numeric precedence level without associativity. */
  <F extends string = string>(value: number, rule: RuleLike<F>): Rule<F>;
  /** Assigns a static precedence level with left associativity. */
  left<F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F>;
  /** Assigns a static precedence level with right associativity. */
  right<F extends string = string>(value: number | RuleLike<F>, rule?: RuleLike<F>): Rule<F>;
  /** Assigns a dynamic precedence for GLR tie-breaking at runtime. */
  dynamic<F extends string = string>(value: number, rule: RuleLike<F>): Rule<F>;
}

/**
 * Combinator for assigning static or dynamic precedence and associativity to grammar rules.
 */
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

prec.dynamic = function <F extends string = string>(value: number, rule: RuleLike<F>): Rule<F> {
  return { type: "PREC_DYNAMIC", value, children: [toRule(rule)] };
};

/**
 * Matches the empty string (epsilon production).
 */
export function blank(): Rule<never> {
  return { type: "BLANK" };
}

/**
 * Configuration options for a symbol definition rule (`def`).
 */
export interface DefConfig<F extends string = string> {
  /** Underlying grammar syntax rule matched for this symbol definition. */
  syntax?: RuleLike<F> | undefined;
  /** Field name or extractor function yielding the symbol's declared identifier. */
  name?: string | { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined;
  /** Extractor function computing custom symbol metadata from the AST node. */
  symbol?: { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined;
  /** Semantic queries attached to symbols produced by this definition rule. */
  queries?: Record<string, QueryFnOrObject> | undefined;
  /** Symbol-level lint functions evaluated against `QueryDB` and the indexed `SymbolEntry`. */
  lint?:
    | Record<string, (db: QueryDB, self: SymbolEntry, ...args: unknown[]) => LintResult | LintResult[] | null>
    | undefined;
  /** Additional AST or compiler lint definitions associated with this definition. */
  lints?: Record<string, unknown> | undefined;
  /** Semantic diffing configuration (e.g., custom identity extractor for matching symbols across versions). */
  diff?:
    | { identity?: { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined; [key: string]: unknown }
    | undefined;
  /** Domain model attribute schema attached to this symbol definition. */
  model?: unknown;
  [key: string]: unknown;
}

/**
 * Configuration options for a symbol reference rule (`ref`).
 */
export interface RefConfig<F extends string = string> {
  /** Underlying grammar syntax rule matched for this symbol reference. */
  syntax?: RuleLike<F> | undefined;
  /** Field name or extractor function yielding the referenced target identifier. */
  name?: string | { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined;
  /** Extractor function computing custom reference metadata from the AST node. */
  symbol?: { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined;
  /** Semantic queries attached to this reference rule. */
  queries?: Record<string, QueryFnOrObject> | undefined;
  /** Symbol-level lint functions evaluated against `QueryDB` and the indexed `SymbolEntry`. */
  lint?:
    | Record<string, (db: QueryDB, self: SymbolEntry, ...args: unknown[]) => LintResult | LintResult[] | null>
    | undefined;
  /** Additional AST or compiler lint definitions associated with this reference. */
  lints?: Record<string, unknown> | undefined;
  /** Semantic diffing configuration for comparing references across versions. */
  diff?:
    | { identity?: { bivarianceHack(self: unknown): unknown }["bivarianceHack"] | undefined; [key: string]: unknown }
    | undefined;
  /** Domain model attribute schema attached to this symbol reference. */
  model?: unknown;
  [key: string]: unknown;
}

/**
 * Wraps a syntax rule as a symbol definition site in the scope graph and symbol index.
 */
export function def<F extends string = string>(config: DefConfig<F>): Rule<F> {
  const { syntax, ...options } = config;
  return { type: "DEF", value: options, children: syntax ? [toRule(syntax)] : [] } as Rule<F>;
}

/**
 * Wraps a syntax rule as a symbol reference site to be resolved against the scope graph.
 */
export function ref<F extends string = string>(config: RefConfig<F>): Rule<F> {
  const { syntax, ...options } = config;
  return { type: "REF", value: options, children: syntax ? [toRule(syntax)] : [] } as Rule<F>;
}

// --- E-Graph Rewrite Rule Combinators ---

/**
 * Defines algebraic rewrite rules for the Equality Saturation E-Graph.
 * Nodes represent expressions to be dynamically simplified at compile time.
 */
export class TransformCombinator {
  constructor(
    /** The operator or node tag name (e.g., `"add"`, `"mul"`, `"variable"`, `"constant"`). */
    public op: string,
    /** The child operands or pattern arguments for this expression node. */
    public args: unknown[],
  ) {}

  /**
   * Serializes this combinator expression tree into an S-expression string for the E-Graph engine.
   */
  toSExpr(): string {
    if (this.op === "variable") return `?${this.args[0]}`;
    if (this.op === "constant") return `${this.args[0]}`;
    const argsStr = this.args.map((a) => (a instanceof TransformCombinator ? a.toSExpr() : String(a))).join(" ");
    return `(${this.op} ${argsStr})`;
  }
}

/** Constructs an E-Graph addition expression `(add a b)`. */
export function add(a: unknown, b: unknown) {
  return new TransformCombinator("add", [a, b]);
}
/** Constructs an E-Graph subtraction expression `(sub a b)`. */
export function sub(a: unknown, b: unknown) {
  return new TransformCombinator("sub", [a, b]);
}
/** Constructs an E-Graph multiplication expression `(mul a b)`. */
export function mul(a: unknown, b: unknown) {
  return new TransformCombinator("mul", [a, b]);
}
/** Constructs an E-Graph division expression `(div a b)`. */
export function div(a: unknown, b: unknown) {
  return new TransformCombinator("div", [a, b]);
}
/** Constructs an E-Graph numeric constant literal node. */
export function constant(val: number) {
  return new TransformCombinator("constant", [val]);
}
/** Shorthand alias for `constant`. */
export const c = constant;
/** Constructs an E-Graph pattern variable node `?name` for matching arbitrary subexpressions. */
export function variable(name: string) {
  return new TransformCombinator("variable", [name]);
}
/** Shorthand alias for `variable`. */
export const v = variable;
/** Constructs an E-Graph unary negation expression `(neg a)`. */
export function neg(a: unknown) {
  return new TransformCombinator("neg", [a]);
}
/** Constructs an E-Graph absolute value expression `(abs a)`. */
export function abs(a: unknown) {
  return new TransformCombinator("abs", [a]);
}
/** Constructs an E-Graph equality comparison expression `(eq a b)`. */
export function eq(a: unknown, b: unknown) {
  return new TransformCombinator("eq", [a, b]);
}
/** Constructs an E-Graph inequality comparison expression `(neq a b)`. */
export function neq(a: unknown, b: unknown) {
  return new TransformCombinator("neq", [a, b]);
}
/** Constructs an E-Graph less-than comparison expression `(lt a b)`. */
export function lt(a: unknown, b: unknown) {
  return new TransformCombinator("lt", [a, b]);
}
/** Constructs an E-Graph greater-than comparison expression `(gt a b)`. */
export function gt(a: unknown, b: unknown) {
  return new TransformCombinator("gt", [a, b]);
}
/** Constructs an E-Graph logical AND expression `(and a b)`. */
export function and(a: unknown, b: unknown) {
  return new TransformCombinator("and", [a, b]);
}
/** Constructs an E-Graph logical OR expression `(or a b)`. */
export function or(a: unknown, b: unknown) {
  return new TransformCombinator("or", [a, b]);
}
/** Constructs an E-Graph logical NOT expression `(not a)`. */
export function not(a: unknown) {
  return new TransformCombinator("not", [a]);
}
/** Constructs an E-Graph trigonometric sine expression `(sin a)`. */
export function sin(a: unknown) {
  return new TransformCombinator("sin", [a]);
}
/** Constructs an E-Graph trigonometric cosine expression `(cos a)`. */
export function cos(a: unknown) {
  return new TransformCombinator("cos", [a]);
}

/**
 * Namespace bundle of E-Graph algebraic rewrite combinators passed to rewrite rule builders.
 */
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

/**
 * Declares a subtyping relation fact and runtime type-check predicate between `sourceType` and `targetType`.
 */
export function subtype(sourceType: unknown, targetType: unknown) {
  const unwrap = (val: unknown) => {
    if (typeof val === "object" && val !== null) {
      const obj = val as { value?: unknown; name?: unknown; id?: unknown };
      return String(obj.value ?? obj.name ?? obj.id ?? val);
    }
    return String(val);
  };
  const f = fact("subtype", unwrap(sourceType), unwrap(targetType));
  const fn = (db: { ast: { getType(id: number): unknown } }, source: number, target: number) => {
    const sType = typeof sourceType === "number" ? sourceType : db.ast.getType(source);
    const tType = typeof targetType === "number" ? targetType : db.ast.getType(target);
    return sType === tType;
  };
  return Object.assign(fn, f, { args: [sourceType, targetType] });
}
/** Alias for `subtype`. */
export const Subtype = subtype;

/**
 * Constructs a Datalog fact or Horn clause rule (via `.if(...)`) for declarative semantic reasoning.
 */
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
/** Alias for `fact`. */
export const Fact = fact;

/**
 * Proxy object that dynamically creates `REF` rule references on property access (e.g., `$.expression`).
 */
export const $: Record<string, Rule<string>> = new Proxy({} as Record<string, Rule<string>>, {
  get(_target, prop: string) {
    return { type: "REF", value: prop };
  },
});

// --- Functional Combinators for CFG, DFA & Abstract Domains ---

/**
 * Represents a node in a declarative Control-Flow Graph (CFG) specification.
 */
export interface FlowNode {
  /** The control-flow construct type (e.g., `'SEQ'`, `'BRANCH'`, `'LOOP'`, `'CALL'`). */
  type: string;
  /** Configuration payload describing the control-flow edges and child AST fields. */
  payload: Record<string, unknown>;
}

/**
 * Combinators for declaratively specifying Control-Flow Graph (CFG) construction over AST nodes.
 */
export const flow = {
  /** Evaluates a named child AST field within an optional lexical scope. */
  field(name: string, scope?: unknown): FlowNode {
    return { type: "FIELD", payload: { name, scope } };
  },
  /** Iterates over a named list of child AST nodes, optionally mapping each child through `mapper`. */
  children(name: string, mapper?: { bivarianceHack(node: unknown): unknown }["bivarianceHack"]): FlowNode {
    return { type: "CHILDREN", payload: { name, mapper } };
  },
  /** Executes a sequence of control-flow steps in order. */
  seq(...steps: unknown[]): FlowNode {
    return { type: "SEQ", payload: { steps } };
  },
  /** Models a conditional branch with `cond`, `then`, and optional `else` paths. */
  branch(config: { cond: unknown; then: unknown; else?: unknown }): FlowNode {
    return { type: "BRANCH", payload: config };
  },
  /** Models a generic `while`/`loop` construct with optional `cond`, `body`, and `step`. */
  loop(config: { cond?: unknown; body: unknown; step?: unknown }): FlowNode {
    return { type: "LOOP", payload: config };
  },
  /** Models a structured `for` loop with `init`, `cond`, `step`, and `body` phases. */
  for(config: { init?: unknown; cond?: unknown; step?: unknown; body: unknown }): FlowNode {
    return { type: "FOR", payload: config };
  },
  /** Models a multi-way `switch` dispatch over a `discriminant`, `cases`, and optional `default`. */
  switch(config: { discriminant: unknown; cases: unknown; default?: unknown }): FlowNode {
    return { type: "SWITCH", payload: config };
  },
  /** Models exception handling flow with `body`, `catchers`, `else`, and `finally` blocks. */
  try(config: { body: unknown; catchers?: unknown; else?: unknown; finally?: unknown }): FlowNode {
    return { type: "TRY", payload: config };
  },
  /** Models a function or method invocation site and its argument evaluation order. */
  call(config: {
    target: unknown;
    arguments?: unknown;
    positional?: unknown;
    keywords?: unknown;
    spreadPositional?: unknown;
    spreadKeywords?: unknown;
  }): FlowNode {
    return { type: "CALL", payload: config };
  },
  /** Models stack unwinding with cleanup handlers executed upon scope exit. */
  unwind(config: { body: unknown; cleanups: unknown }): FlowNode {
    return { type: "UNWIND", payload: config };
  },
  /** Maps grammar rule names to their corresponding CFG construction `FlowNode` definitions. */
  rules(map: Record<string, FlowNode>): Record<string, FlowNode> {
    return map;
  },
};

/**
 * Combinators for configuring abstract interpretation, numerical simulation, and reasoning domains.
 */
export const domain = {
  /** Configures the relational Octagon abstract domain ($\pm x \pm y \le c$). */
  octagon(opts?: {
    varExtractor?: { bivarianceHack(node: unknown, graph: unknown): string | null }["bivarianceHack"] | undefined;
  }): Record<string, unknown> {
    return { kind: "octagon", varExtractor: opts?.varExtractor };
  },
  /** Configures the non-relational Interval abstract domain ($[a, b]$). */
  interval(): Record<string, unknown> {
    return { kind: "interval" };
  },
  /** Configures a finite Bitset dataflow domain (e.g., for liveness or reaching definitions). */
  bitset(): Record<string, unknown> {
    return { kind: "bitset" };
  },
  /** Configures a pointer/reference Alias analysis domain. */
  alias(): Record<string, unknown> {
    return { kind: "alias" };
  },
  /** Combines multiple abstract domains into a reduced Cartesian product domain. */
  product(...domains: unknown[]): Record<string, unknown> {
    return { kind: "product", domains };
  },
  /** Configures a Differential-Algebraic Equation (DAE) structural and symbolic reduction domain. */
  dae(opts?: {
    indexReduction?: "pantelides" | "none" | undefined;
    tearing?: "cellier" | "minimum_degree" | "none" | undefined;
    groebnerPreReduction?: boolean | undefined;
    warmStart?: boolean | undefined;
    homotopy?: boolean | undefined;
    dualAD?: boolean | undefined;
    isolationMethods?:
      | ("explicit" | "linear" | "quadratic" | "harmonic" | "lambertW" | "treePeeling" | "fixedPoint" | "groebner")[]
      | undefined;
  }): Record<string, unknown> {
    return { kind: "dae", ...opts };
  },
  /** Configures a numerical ODE/DAE time-domain simulation solver domain. */
  simulation(opts?: {
    solver?: "euler" | "rk4" | "radau" | "cvode" | undefined;
    startTime?: number | undefined;
    stopTime?: number | undefined;
    stepSize?: number | undefined;
    tolerance?: number | undefined;
  }): Record<string, unknown> {
    return { kind: "simulation", ...opts };
  },
  /** Configures incremental workspace indexing and Salsa query memoization. */
  workspace(opts?: {
    incrementalQueries?: boolean | undefined;
    memoization?: "salsa" | "naive" | undefined;
  }): Record<string, unknown> {
    return { kind: "workspace", ...opts };
  },
  /** Configures an ontological / Datalog deductive reasoner domain. */
  reasoner(opts?: {
    expressivity?: "OWL2RL" | "DL-Lite" | "RDFS" | undefined;
    datalogFixpoint?: "semi-naive" | "naive" | undefined;
    axioms?: unknown[] | undefined;
  }): Record<string, unknown> {
    return { kind: "reasoner", ...opts };
  },
};

/**
 * Combinators for defining abstract interpretation transfer functions over AST/CFG nodes.
 */
export const transfer = {
  /** Attaches a transfer function handler to a specific AST or CFG `nodeType`. */
  on(nodeType: unknown, transferFn: unknown): Record<string, unknown> {
    return { nodeType, transferFn };
  },
  /** Models an abstract state assignment updating `lhs` with the abstract evaluation of `rhs`. */
  assign(lhs: unknown, rhs: unknown): Record<string, unknown> {
    return { type: "ASSIGN", lhs, rhs };
  },
  /** Models an abstract guard assumption restricting the abstract state to satisfy `cond`. */
  assume(cond: unknown): Record<string, unknown> {
    return { type: "ASSUME", cond };
  },
  /** Havocs / forgets abstract state constraints associated with `variable`. */
  kill(variable: unknown): Record<string, unknown> {
    return { type: "KILL", variable };
  },
};

/**
 * Combinators for specifying static analysis diagnostic assertions over abstract states.
 */
export const check = {
  /** Asserts that `predicate` holds at `nodeType`, emitting `message` as a diagnostic when violated. */
  assert(nodeType: unknown, predicate: unknown, message: string): Record<string, unknown> {
    return { nodeType, predicate, message };
  },
};

/**
 * Configures a static analysis pass combining a Control-Flow Graph (`cfg`), abstract `domain`, `transfers`, and `diagnostics`.
 */
export function analysis(config: {
  cfg?: unknown;
  domain: unknown;
  transfers?: unknown[] | undefined;
  diagnostics?: unknown[] | undefined;
}): Record<string, unknown> {
  return config;
}
