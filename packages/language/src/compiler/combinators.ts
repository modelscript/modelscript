import type {
  AliasNode,
  BlankNode,
  ChoiceNode,
  DefNode,
  DefOptions,
  ExtractFieldNames,
  FieldNode,
  OptionalNode,
  PrecDynamicNode,
  PrecLeftNode,
  PrecNode,
  PrecRightNode,
  RefNode,
  RefOptions,
  Repeat1Node,
  RepeatNode,
  Rule,
  SeqNode,
  SymbolNode,
  TokenImmediateNode,
  TokenNode,
} from "./language-dsl.js";

// ---------------------------------------------------------------------------
// Generic combinators — preserve literal types for field name inference
// ---------------------------------------------------------------------------

export function seq<T extends (Rule | string | RegExp)[]>(...args: T): SeqNode<any> {
  return { type: "seq", args } as any;
}

export function optional<T extends Rule | string | RegExp>(arg: T): OptionalNode<any> {
  return { type: "optional", arg } as any;
}

export function repeat<T extends Rule | string | RegExp>(arg: T): RepeatNode<any> {
  return { type: "repeat", arg } as any;
}

export function repeat1<T extends Rule | string | RegExp>(arg: T): Repeat1Node<any> {
  return { type: "repeat1", arg } as any;
}

export function choice<T extends (Rule | string | RegExp)[]>(...args: T): ChoiceNode<any> {
  return { type: "choice", args } as any;
}

export function token<T extends Rule | string | RegExp>(arg: T): TokenNode<any> {
  return { type: "token", arg } as any;
}

/**
 * Marks a token as immediate (no whitespace allowed before it).
 * Attached as `token.immediate()` for Tree-Sitter compatibility.
 */
token.immediate = function <T extends Rule | string | RegExp>(arg: T): TokenImmediateNode<any> {
  return { type: "token_immediate", arg } as any;
};

export function field<N extends string>(name: N, arg: Rule | string | RegExp): FieldNode<N> {
  return { type: "field", name, arg } as any;
}

export function blank(): BlankNode {
  return { type: "blank" };
}

/**
 * Assigns a precedence level to a rule.
 * Higher values bind tighter.
 */
export function prec(precedence: number, arg: Rule | string | RegExp): PrecNode {
  return { type: "prec", precedence, arg } as any;
}

/** Left-associative precedence. */
prec.left = function (precedence: number, arg: Rule | string | RegExp): PrecLeftNode {
  return { type: "prec_left", precedence, arg } as any;
};

/** Right-associative precedence. */
prec.right = function (precedence: number, arg: Rule | string | RegExp): PrecRightNode {
  return { type: "prec_right", precedence, arg } as any;
};

/** Dynamic precedence (resolved at parse time). */
prec.dynamic = function (precedence: number, arg: Rule | string | RegExp): PrecDynamicNode {
  return { type: "prec_dynamic", precedence, arg } as any;
};

/**
 * Renames a node in the generated CST.
 */
export function alias(arg: Rule | string | RegExp, value: string | SymbolNode): AliasNode {
  return { type: "alias", arg, value } as any;
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
  return { type: "def", rule: syntax, options: options as unknown as DefOptions<string> };
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
  return { type: "ref", rule: syntax, options: options as RefOptions<string> };
}
