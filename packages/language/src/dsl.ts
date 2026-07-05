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
export type RuleBuilder<RuleName extends string, FieldName extends string = never> = (
  $: Record<RuleName | (string & {}), RuleLike<never>>,
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

export const enum TensorType {
  Float64 = 0,
  Int32 = 1,
  Boolean = 2,
  Float32 = 3,
  Float16 = 4,
  Int64 = 5,
  Int16 = 6,
}

export interface Cursor {
  hasNext(): boolean;
  next(): u32;
  release(): void;
}

export interface TensorAPI {
  create1D(type: TensorType, size: u32): TensorHandle;
  create2D(type: TensorType, rows: u32, cols: u32): TensorHandle;
  create3D(type: TensorType, d0: u32, d1: u32, d2: u32): TensorHandle;

  setFloat(handle: TensorHandle, flatIndex: u32, val: f64): void;
  getFloat(handle: TensorHandle, flatIndex: u32): f64;
  setFloat32(handle: TensorHandle, flatIndex: u32, val: f32): void;
  getFloat32(handle: TensorHandle, flatIndex: u32): f32;
  setFloat16Raw(handle: TensorHandle, flatIndex: u32, val: u16): void;
  getFloat16Raw(handle: TensorHandle, flatIndex: u32): u16;

  setInt(handle: TensorHandle, flatIndex: u32, val: i32): void;
  getInt(handle: TensorHandle, flatIndex: u32): i32;
  setInt64(handle: TensorHandle, flatIndex: u32, val: i64): void;
  getInt64(handle: TensorHandle, flatIndex: u32): i64;
  setInt16(handle: TensorHandle, flatIndex: u32, val: i16): void;
  getInt16(handle: TensorHandle, flatIndex: u32): i16;

  setBool(handle: TensorHandle, flatIndex: u32, val: boolean): void;
  getBool(handle: TensorHandle, flatIndex: u32): boolean;
}

export interface CodeGraph<
  ModelAttrs extends Record<string, Record<string, any>> = any,
  RuleName extends string = any,
  FieldName extends string = never,
> {
  tensor: TensorAPI;
  hash: HashAPI;
  ast: AstAPI<RuleName, FieldName>;
  model: ModelAPI<ModelAttrs>;
  map: MapAPI;
  set: SetAPI;
  dae: DaeAPI;
  blt: BltAPI;

  error(message: string): void;
  runQuery(queryId: u32, queryArg: u32, queryArg2?: u32): u32;
  runHostQuery(queryId: string, arg1?: u32, arg2?: u32, arg3?: u32): u32;
  diagnostic(targetNode: u32, arg0?: u32, arg1?: u32, arg2?: u32, arg3?: u32): void;
}

export interface AstAPI<RuleName extends string, FieldName extends string = never> {
  getChildByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): u32;
  getChildrenByFieldId(nodeId: u32, fieldId: FieldName | (string & {}) | i32): Cursor;

  getAncestors(nodeId: u32, stopAtType?: Extract<RuleName, string> | (string & {}) | u16): Cursor;
  getDescendants(nodeId: u32, filterType?: Extract<RuleName, string> | (string & {}) | u16): Cursor;
  getPathTokens(nodeId: u32): Cursor;

  textEqualsNode(nodeA: u32, nodeB: u32): boolean;
  textEquals(nodeId: u32, literal: string): boolean;

  getType(nodeId: u32): u16;
  getFirstChild(nodeId: u32): u32;
  getNextSibling(nodeId: u32): u32;
  getChildCount(nodeId: u32): u32;

  getTextSpan(nodeId: u32, absoluteStart?: u32): u64;
  getRootNode(): u32;
  hashSpan(span: u64): u32;
}

export interface HashAPI {
  init(): u32;
  span(currentHash: u32, span: u64): u32;
  byte(currentHash: u32, byte: u8): u32;
  span64(span: u64): u64;
}

export interface SetAPI {
  create(): u32;
  add(setId: u32, hash: u64): void;
  has(setId: u32, hash: u64): boolean;
  release(setId: u32): void;
}

export interface DaeAPI {
  addVariable(nameId: u32, type: u8, variability: u8, causality: u8, startValue: f64, flags?: i32): u32;
  addExpression(kind: u8, data1: u32, left?: u32, right?: u32): u32;
  addEquation(kind: u8, lhsId: u32, rhsId: u32, auxId?: u32): u32;
  addStatement(kind: u8, data1: u32, left?: u32, right?: u32): u32;
}

export interface BltAPI {
  computeBLT(): void;
  rollback(snapshotEqCount: u32, snapshotVarCount: u32): void;
}

export enum VarType {
  Real = 0,
  Integer = 1,
  Boolean = 2,
  String = 3,
  Enumeration = 4,
  Clock = 5,
}

export enum Variability {
  Continuous = 0,
  Discrete = 1,
  Parameter = 2,
  Constant = 3,
}

export enum Causality {
  Local = 0,
  Input = 1,
  Output = 2,
}

export enum EqKind {
  Simple = 0,
  Array = 1,
  For = 2,
  If = 3,
  When = 4,
  FunctionCall = 5,
  Connect = 6,
  InitialSimple = 7,
  InitialFor = 8,
}

export enum ExprKind {
  Name = 0,
  IntLiteral = 1,
  RealLiteral = 2,
  BoolLiteral = 3,
  StringLiteral = 4,
  Binary = 5,
  Unary = 6,
  Call = 7,
  Subscript = 8,
  ArrayCtor = 9,
  Range = 10,
  IfElse = 11,
  Der = 12,
  Pre = 13,
  Negate = 14,
  Tuple = 15,
  Colon = 16,
  EnumLiteral = 17,
  Comprehension = 18,
  PartialFunc = 19,
  Object = 20,
}

export enum BinOp {
  Add = 0,
  Sub = 1,
  Mul = 2,
  Div = 3,
  Pow = 4,
  ElemAdd = 5,
  ElemSub = 6,
  ElemMul = 7,
  ElemDiv = 8,
  ElemPow = 9,
  And = 10,
  Or = 11,
  Eq = 12,
  Neq = 13,
  Lt = 14,
  Gt = 15,
  Lte = 16,
  Gte = 17,
}

export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

export enum StmtKind {
  Assignment = 0,
  For = 1,
  While = 2,
  If = 3,
  When = 4,
  Return = 5,
  Break = 6,
  ProcedureCall = 7,
  ComplexAssignment = 8,
  Block = 9,
}

export interface MapAPI {
  create(): u32;
  set(mapId: u32, hash: u64, valueId: u32): void;
  get(mapId: u32, hash: u64): u32;
  release(mapId: u32): void;
}

export interface ModelAPI<ModelAttrs extends Record<string, Record<string, any>>> {
  create(type: Extract<keyof ModelAttrs, string> | (string & {}) | u16): u32;
  clone(nodeId: u32, deep: boolean): u32;

  compute<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    attrName: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): u32;

  getProperty<RetType = number, T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    propName: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): RetType;

  setProperty<ValType = number, T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    propName: Extract<keyof ModelAttrs[T], string> | (string & {}),
    value: ValType,
  ): void;

  bind(scopeNodeId: u32, nameNodeId: u32, targetId: u32): void;
  resolve(scopeNodeId: u32, nameNodeId: u32): u32;

  bindHash(scopeNodeId: u32, nameHash: u32, targetId: u32): void;
  resolveHash(scopeNodeId: u32, nameHash: u32): u32;

  setFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): void;
  clearFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): void;
  hasFlag<T extends keyof ModelAttrs = keyof ModelAttrs>(
    nodeId: u32,
    flag: Extract<keyof ModelAttrs[T], string> | (string & {}),
  ): boolean;

  appendChild(parentId: u32, childId: u32): void;
  insertSibling(targetId: u32, siblingId: u32): void;
  setFirstChild(parentId: u32, childId: u32): void;
  setNextSibling(nodeId: u32, siblingId: u32): void;
  replaceChild(parentId: u32, oldChildId: u32, newChildId: u32): void;
  removeChild(parentId: u32, childId: u32): void;

  getSemanticChildren(nodeId: u32): Cursor;
}

export type ASTQueryFunction<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (graph: CodeGraph<ModelAttrs, RuleName, FieldName>, queryArg: u32, ...args: any[]) => u32 | boolean;

export type ASTLintFunction<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> = (
  graph: CodeGraph<ModelAttrs, RuleName, FieldName>,
  queryArg: u32,
  $: Record<string, u16> & Record<RuleName, u16>,
) => void;

export interface DiagnosticContext<FieldName extends string = string> {
  text: string;
  fields: Record<FieldName | (string & {}), string>;
}

export interface CompilerLint<
  RuleName extends string = string,
  FieldName extends string = never,
  QueryName extends string = never,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  nodes?: NoInfer<RuleName>[];
  query: ASTLintFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  code?: string | number;
  message:
    | string
    | ((
        target: DiagnosticContext<FieldName>,
        arg0: DiagnosticContext<FieldName>,
        arg1: DiagnosticContext<FieldName>,
        arg2: DiagnosticContext<FieldName>,
      ) => string);
  severity: "error" | "warning" | "info";
}

export interface ModelProperty {
  type: "u8" | "u16" | "u32" | "i32" | "f32" | "f64" | "bool" | "flag" | "string" | "ref" | "tensor";
  default?: number | boolean | string;
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
   * Host Queries allow WASM to call out to the host environment (Node.js/V8)
   * for complex semantic resolutions (e.g. multi-file workspace lookups) via FFI.
   */
  hostQueries?: Record<string, (facade: any, arg1: u32, arg2: u32, arg3: u32) => u32>;

  /**
   * Tokens to skip automatically (e.g., whitespace, comments) everywhere in the grammar.
   */
  extras?: ($: Record<string, Rule<never>> & Record<RuleName, Rule<never>>) => RuleLike<any>[];

  /** Composable Scanner Primitives (Phase 1) */
  primitives?: ScannerPrimitives;

  /** External Scanner (Context-Sensitive Lexing) */
  externals?: ($: Record<string, Rule<never>> & Record<RuleName, Rule<never>>) => Rule<any>[];

  /** External scanner logic (WASM fallback). Not typically used directly in DSL. */
  scanner?: (currentPos: number, scannerState: number) => number;

  /**
   * Tree-sitter Parity: Rules that serve as supertypes (interfaces/abstract classes)
   * in the generated AST. Useful for aliases and unifying node queries.
   */
  supertypes?: ($: Record<string, Rule<never>> & Record<RuleName, Rule<never>>) => Rule<any>[];

  /** Rules that should be inlined directly into their parents during codegen to reduce AST depth. */
  inline?: NoInfer<RuleName>[];

  /** Expected GLR conflicts. Specifies arrays of rule names that can legitimately conflict. */
  conflicts?:
    | (($: Record<string, Rule<never>> & Record<RuleName, Rule<never>>) => RuleLike<any>[][])
    | NoInfer<RuleName>[][];

  /** Default precedence/associativity matrices for conflict resolution. */
  precedences?: string[][];

  /** Reserved keywords to omit from generic identifier matching. */
  reserved?: Record<string, ($: Record<string, Rule<never>> & Record<RuleName, Rule<never>>) => Rule<any>[]>;

  model?: Partial<
    Record<
      NoInfer<RuleName>,
      Record<string, ModelProperty | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>>
    >
  >;

  /** Queries (imperative AssemblyScript methods) */
  queries?: Record<QueryName, ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>>;

  /** Diagnostic Rules (imperative AssemblyScript methods) */
  lints?: Record<string, CompilerLint<RuleName, FieldName, QueryName, ModelAttrs>>;

  /** Built-in Language Server Protocol features */
  lsp?: {
    /** List of node types that can be folded */
    folding?: NoInfer<RuleName>[];
    /** List of node types that define a new variable scope */
    outline?: NoInfer<RuleName>[];
    /** AssemblyScript callback or function name for goto definition */
    definition?: string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  };

  /** Equality Saturation and E-Graph Algebraic Simplifications */
  simplification?: {
    rules: { name: string; lhs: TransformCombinator; rhs: TransformCombinator }[];
  };

  /** Zero-GC Hindley-Milner Type System Engine Configuration */
  typeSystem?: {
    constraints?: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>;
    subtypingPredicates?: string[];
    customCode?: string;
  };

  /** DL-Lite / Datalog Semantic Reasoning Engine Configuration */
  semantics?: {
    rules?: string[];
    axioms?: string[];
    vocabularies?: string[];
    extensions?: Record<string, string[]>;
    maxArity?: number;
    extraction?: Record<string, string>;
    typeExtraction?: Record<string, string>;
    pathResolution?:
      | {
          ownership: string;
          naming: string;
          subsetting?: string;
        }
      | boolean;
    reasoner?: {
      maxFacts?: number;
    };
  };

  /** Module System Configuration */
  moduleSystem?: {
    resolve_module?: boolean;
  };
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
export function toRule<F extends string = never>(r: RuleLike<F>): Rule<F> {
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

export function repeat<F extends string = never>(rule: RuleLike<F>): Rule<F> {
  return { type: "REPEAT", children: [toRule(rule)] };
}

export function repeat1<F extends string = never>(rule: RuleLike<F>): Rule<F> {
  return seq(rule, repeat(rule));
}

export function optional<F extends string = never>(rule: RuleLike<F>): Rule<F> {
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

export function field<F extends string = never>(name: F, rule: RuleLike<any>): Rule<F> {
  return { type: "FIELD", value: name, children: [toRule(rule)] };
}

/**
 * Defines a lexer token. For strings and RegExps, defines the match pattern.
 * For other rules, groups them into a single monolithic token in the lexer.
 */
export function token<F extends string = never>(pattern: RuleLike<F>): Rule<F> {
  if (typeof pattern === "string" || pattern instanceof RegExp) {
    return { type: "TOKEN", value: pattern };
  }
  return { type: "TOKEN", children: [toRule(pattern)] };
}

(token as any).immediate = function <F extends string = never>(rule: RuleLike<F>): Rule<F> {
  return { type: "TOKEN_IMMEDIATE", children: [toRule(rule)] };
};

/**
 * Renames a matched rule in the AST output. Useful for overriding generic rule names with specific context.
 */
export function alias<F extends string = never>(rule: RuleLike<F>, name: string | Rule<never>): Rule<F> {
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

export function reserved<F extends string = never>(wordset: string, rule: RuleLike<F>): Rule<F> {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

export function prec<F extends string = never>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC", value, children: [rule] };
}

(prec as any).left = function <F extends string = never>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  if (typeof value === "object") return { type: "PREC_LEFT", value: 0, children: [value] };
  return { type: "PREC_LEFT", value, children: [rule!] };
};

(prec as any).right = function <F extends string = never>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  if (typeof value === "object") return { type: "PREC_RIGHT", value: 0, children: [value] };
  return { type: "PREC_RIGHT", value, children: [rule!] };
};

(prec as any).dynamic = function <F extends string = never>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC_DYNAMIC", value, children: [rule] };
};

// --- E-Graph Rewrite Rule Combinators ---

export class TransformCombinator {
  constructor(
    public op: string,
    public args: any[],
  ) {}

  toSExpr(): string {
    if (this.op === "variable") return `?${this.args[0]}`;
    if (this.op === "constant") return `${this.args[0]}`;
    let argsStr = this.args.map((a) => (a instanceof TransformCombinator ? a.toSExpr() : String(a))).join(" ");
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
export function variable(name: string) {
  return new TransformCombinator("variable", [name]);
}
export const v = variable;
export function constant(val: number) {
  return new TransformCombinator("constant", [val]);
}
export const c = constant;
