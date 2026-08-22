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
export type RuleLike<F extends string = string> = Rule<F> | string | RegExp;

/**
 * A function that takes a map of all grammar rules and returns a grammar definition rule.
 */
export type RuleBuilder<RuleName extends string, FieldName extends string = string> = (
  $: Record<RuleName | (string & {}), RuleLike<any>>,
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
export type bool = boolean;
export type FieldId = u16;
export type SyntaxId = u16;
export type TensorHandle = u32;

export const SOURCE_PATH_SYMBOL: unique symbol = Symbol.for("modelscript.sourcePath");
export const SOURCE_TEXT_SYMBOL: unique symbol = Symbol.for("modelscript.sourceText");

export enum TensorType {
  Float64 = 0,
  Int32 = 1,
  Boolean = 2,
  Float32 = 3,
  Float16 = 4,
  Int64 = 5,
  Int16 = 6,
}

export interface Cursor extends Iterable<u32> {
  hasNext(): boolean;
  next(): u32;
  release(): void;
  [Symbol.iterator](): Iterator<u32>;
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

/**
 * The core Arena-Native CodeGraph API bridging TypeScript to WASM.
 * Exposes methods to query AST nodes, allocate memory, and interact with the Semantic Reasoner.
 */
export interface CodeGraph<
  ModelAttrs extends Record<string, Record<string, any>> = any,
  RuleName extends string = any,
  FieldName extends string = string,
  QueryName extends string = string,
> {
  tensor: TensorAPI;
  hash: HashAPI;
  ast: AstAPI<RuleName, FieldName>;
  model: ModelAPI<ModelAttrs>;
  map: MapAPI;
  set: SetAPI;
  dae: DaeAPI;
  blt: BltAPI;
  scope: ScopeAPI;
  env: EnvAPI;
  connectors: ConnectorAPI;
  ssa: SsaAPI;

  unroll(iterVar: string, start: i32, end: i32, fn: (idx: i32) => void): void;
  error(message: string): void;
  runQuery(queryId: QueryName | (string & {}) | u32, queryArg?: u32, queryArg2?: u32): u32;
  runHostQuery(queryId: string, arg1?: u32, arg2?: u32, arg3?: u32): u32;
  diagnostic(targetNode: u32, arg0?: u32, arg1?: u32, arg2?: u32, arg3?: u32): void;
}

/**
 * Hierarchical Scope and FQN Stack API for zero-GC prefix management.
 */
export interface ScopeAPI {
  enter(prefix: string | u32, fn: () => void): void;
  push(prefix: string | u32): void;
  pop(): void;
  reset(): void;
  currentFqn(): u32;
  currentPrefix(): u32;
  resolve(localName: string | u32): u32;
}

/**
 * Cascading Parameter and Modification Environment API.
 */
export interface EnvAPI {
  create(): u32;
  bind(envId: u32, keyHash: u32, valExprId: u32): void;
  lookup(envId: u32, keyHash: u32): u32;
  enterMod(envId: u32, modNodeId: u32): u32;
}

/**
 * Acausal Connection Graph and Zero-Sum Flow/Stream Partitioning API.
 */
export interface ConnectorAPI {
  add(p1VarId: u32, p2VarId: u32, isFlow?: boolean, isBoundary?: boolean): u32;
  finalize(): u32;
  connect(lhsConnectorId: u32, rhsConnectorId: u32): u32;
}

/**
 * Single Static Assignment (SSA) Lowering API.
 */
export interface SsaAPI {
  lowerToDAE(blockNodeId: u32, assignmentOp?: string): u32;
}

/**
 * Declarative physical connector schema definition.
 */
export interface ConnectorDefinition {
  potential?: string[];
  flow?: string[];
  stream?: string[];
}

/**
 * Methods for querying the Abstract Syntax Tree inside the WASM Arena.
 * Nodes are represented by their `u32` pointer offsets.
 */
export interface AstAPI<RuleName extends string, FieldName extends string = string> {
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
  getByteLength(nodeId: u32): u32;

  getTextSpan(nodeId: u32, absoluteStart?: u32): u64;
  getRootNode(): u32;
  hashSpan(span: u64): u32;
}

/**
 * DJB2 Hashing API for fast symbol and string interning in WASM.
 */
export interface HashAPI {
  init(): u32;
  span(currentHash: u32, span: u64): u32;
  byte(currentHash: u32, byte: u8): u32;
  span64(span: u64): u64;
}

/**
 * Open-addressing Hash Set API.
 */
export interface SetAPI {
  create(): u32;
  add(setId: u32, hash: u64): void;
  has(setId: u32, hash: u64): boolean;
  release(setId: u32): void;
}

/**
 * Differential Algebraic Equation (DAE) Builder API for the Modelica flattener.
 */
export interface DaeAPI {
  addVariable(nameId: u32, type: u8, variability: u8, causality: u8, startValue: f64, flags?: i32): u32;
  addExpression(kind: u8, data1: u32, left?: u32, right?: u32): u32;
  addEquation(kind: u8, lhsId: u32, rhsId: u32, auxId?: u32): u32;
  addStatement(kind: u8, data1: u32, left?: u32, right?: u32): u32;
  extractEquations(rootId: u32): void;
}

/**
 * Block Lower Triangular (BLT) Transformation API.
 */
export interface BltAPI {
  computeBLT(): void;
  rollback(snapshotEqCount: u32, snapshotVarCount: u32): void;
  buildDependencies(): void;
  computeMatching(): void;
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

export const FLAG_TEARING_VAR: number = 1 << 0;
export const FLAG_VAR_FLOW: number = 1 << 1;
export const FLAG_VAR_STREAM: number = 1 << 2;
export const FLAG_VAR_STATE: number = 1 << 3;
export const FLAG_VAR_STATE_DER: number = 1 << 4;
export const FLAG_VAR_FIXED: number = 1 << 5;

export const FLAG_EQ_INITIAL: number = 1 << 0;
export const FLAG_EQ_OVERCONSTRAINED: number = 1 << 1;
export const FLAG_EQ_STREAM_CONNECT: number = 1 << 2;

export interface ChunkedUint32Array {
  get(idx: number): number;
  set(idx: number, val: number): void;
}

export interface ChunkedInt32Array {
  get(idx: number): number;
  set(idx: number, val: number): void;
}

export function createChunkedUint32Array(capacity: number): ChunkedUint32Array {
  const buf = new Uint32Array(capacity);
  return {
    get: (idx: number) => buf[idx] || 0,
    set: (idx: number, val: number) => {
      buf[idx] = val;
    },
  };
}

export function createChunkedInt32Array(capacity: number): ChunkedInt32Array {
  const buf = new Int32Array(capacity);
  return {
    get: (idx: number) => buf[idx] || 0,
    set: (idx: number, val: number) => {
      buf[idx] = val;
    },
  };
}

export interface UnmanagedMap64 {
  get(key: bigint | number): bigint | number;
  set(key: bigint | number, val: bigint | number): void;
  has(key: bigint | number): boolean;
}

export interface UnmanagedSet64 {
  has(val: bigint | number): boolean;
  add(val: bigint | number): void;
}

export function createMap64(): UnmanagedMap64 {
  const map = new Map<bigint | number, bigint | number>();
  return {
    get: (k) => map.get(k) || 0,
    set: (k, v) => {
      map.set(k, v);
    },
    has: (k) => map.has(k),
  };
}

export function createSet64(): UnmanagedSet64 {
  const set = new Set<bigint | number>();
  return {
    has: (v) => set.has(v),
    add: (v) => {
      set.add(v);
    },
  };
}

export function getNodeFirstChild(nodePtr: number): number {
  return 0;
}
export function getNodeNextSibling(nodePtr: number): number {
  return 0;
}
export function getNodeType(nodePtr: number): number {
  return 0;
}
export function atomicChunkAlloc(bytes: number): number {
  return 0;
}

export interface DaeBuilder {
  varCount: number;
  eqCount: number;
  exprCount: number;
  stmtCount: number;
  addVariable(
    nameId: number,
    type: number,
    variability: number,
    causality: number,
    startVal: number,
    flags?: number,
  ): number;
  addExpression(kind: number, data1: number, left?: number, right?: number): number;
  addEquation(kind: number, lhs: number, rhs: number, flags?: number): number;
  addRealLiteral(val: number): number;
  addIntLiteral(val: number): number;
}

export interface ArenaStringPool {
  intern(str: string): number;
  resolve(id: number): string;
  concatIds(id1: number, id2: number): number;
}

export interface GenericScopeStack {
  enter(prefix: number | string): void;
  push(prefix: number | string): void;
  pop(): void;
  reset(): void;
  currentFqn(): number;
  currentPrefix(): number;
}

/**
 * Open-addressing Hash Map API.
 */
export interface MapAPI {
  create(): u32;
  set(mapId: u32, hash: u64, valueId: u32): void;
  get(mapId: u32, hash: u64): u32;
  release(mapId: u32): void;
}

/**
 * API for instantiating and mutating logical entities and objects in the typed model graph.
 */
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
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
> = (graph: CodeGraph<ModelAttrs, RuleName, FieldName>, queryArg: u32, ...args: any[]) => u32 | boolean | void;

export type ASTLintFunction<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
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
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  nodes?: NoInfer<RuleName>[];
  query: string | ASTLintFunction<RuleName, FieldName, QueryName, ModelAttrs>;
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

export interface CompilationPipeline<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  label: string;
  target: "dae" | "blt" | "ast" | "wat" | "json" | "binary";
  passes: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>[];
}

/**
 * Declaration & Stub metadata configuration for Tier 1 Workspace Indexing.
 */
export interface SymbolConfig<FieldName extends string = string> {
  /** Field name containing the identifier token */
  name: FieldName;
  /** Symbol kind (e.g. 'Class', 'Package', 'Function', 'Variable') or field name containing kind */
  kind?: string | FieldName;
  /** Whether this symbol introduces a new nested lexical scope (default: true) */
  scope?: boolean;
  /** Field name containing the declared type (if typed declaration) */
  type?: FieldName;
  /** Field name containing the base / super class for inheritance */
  extends?: FieldName;
  /** Field name containing the visibility modifier (e.g. 'public' / 'protected') */
  visibility?: FieldName;
}

/**
 * Configuration options for defining a ModelScript language grammar.
 * Modeled after Tree-sitter's Grammar API.
 */
export interface LanguageOptions<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** The name of the language (e.g., 'modelica', 'javascript'). */
  name: string;

  /** Optional file path of the language source file for Direct Source AST extraction. */
  sourcePath?: string;

  /** Optional source code text of the language file for in-memory AST extraction. */
  sourceText?: string;

  /** Internal symbol property for source path */
  [SOURCE_PATH_SYMBOL]?: string;
  /** Internal symbol property for source text */
  [SOURCE_TEXT_SYMBOL]?: string;

  /**
   * Declarative Compilation & Lowering Pipelines (e.g. DAE Flattening, BLT Decomposition)
   */
  pipelines?: Record<string, CompilationPipeline<RuleName, FieldName, QueryName, ModelAttrs>>;

  /**
   * Declarative Physical Connector Port Definitions
   */
  connectors?: Record<string, ConnectorDefinition>;

  /**
   * Domain-Specific Abstract Interpretation & Solver Domains (DAE, Simulation, Reasoner, Octagon)
   */
  domains?: Record<string, any>;

  /**
   * Declarative Dataflow & Control Flow Analysis Configuration
   */
  dataflow?: any;

  /**
   * A rule name or token representing the language's typical keyword structure.
   * Tree-sitter uses this for keyword extraction optimization.
   */
  word?: string | RuleBuilder<RuleName, FieldName>;

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
  extras?: ($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => RuleLike<any>[];

  /** Composable Scanner Primitives (Phase 1) */
  primitives?: ScannerPrimitives;

  /** External Scanner (Context-Sensitive Lexing) */
  externals?: ($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[];

  /** External scanner logic (WASM fallback). Not typically used directly in DSL. */
  scanner?: (currentPos: number, scannerState: number) => number;

  /**
   * Tree-sitter Parity: Rules that serve as supertypes (interfaces/abstract classes)
   * in the generated AST. Useful for aliases and unifying node queries.
   */
  supertypes?: ($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[];

  /** Rules that should be inlined directly into their parents during codegen to reduce AST depth. */
  inline?: NoInfer<RuleName>[];

  /** Expected GLR conflicts. Specifies arrays of rule names that can legitimately conflict. */
  conflicts?:
    | (($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => RuleLike<any>[][])
    | NoInfer<RuleName>[][];

  /** Default precedence/associativity matrices for conflict resolution. */
  precedences?: string[][];

  /** Reserved keywords to omit from generic identifier matching. */
  reserved?: Record<string, ($: Record<string, Rule<any>> & Record<RuleName, Rule<any>>) => Rule<any>[]>;

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

  /**
   * First-Class AssemblyScript / TypeScript Custom Classes
   * Injected as zero-GC `@unmanaged export class` definitions into WebAssembly linear memory.
   */
  classes?:
    | ((new (...args: any[]) => any) | ((...args: any[]) => any))[]
    | Record<string, (new (...args: any[]) => any) | ((...args: any[]) => any)>;

  /**
   * First-Class AssemblyScript / TypeScript Custom Helper Functions
   * Injected as exported functions into WebAssembly linear memory.
   */
  functions?: ((...args: any[]) => any)[] | Record<string, (...args: any[]) => any>;

  /** Dedicated Declaration & Stub Symbol Schema for Tier 1 Workspace Indexing and fast F12 */
  symbols?: Partial<Record<RuleName, SymbolConfig<FieldName>>>;

  /** Built-in Language Server Protocol features */
  lsp?: {
    /** The file extension associated with this language (e.g. '.mo'). Defaults to '.<name>' */
    fileExtension?: string;
    /** Relative paths to light and dark mode file icons */
    icons?: {
      light: string;
      dark: string;
    };
    /** List of node types that can be folded */
    folding?: NoInfer<RuleName>[];
    /** List of node types that define a new variable scope */
    outline?: NoInfer<RuleName>[];
    /** AssemblyScript callback or function name for goto definition */
    definition?: string | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>;
  };

  /** Zero-GC Code Formatter & Unparser Configuration */
  formatting?: {
    indentSize?: number;
    newlineBeforeBrace?: boolean;
    rules?: Record<string, (node: any, out: any) => void>;
  };

  /** Declarative 2D Diagram & Visual Modeling Configuration */
  diagram?: DiagramConfig<RuleName, FieldName, QueryName, ModelAttrs>;

  /** Declarative Control Flow Graph Nodes Configuration */
  cfgNodes?: Record<
    string,
    {
      condition?: string;
      trueBranch?: string;
      falseBranch?: string;
      branchList?: string;
      isLoop?: boolean;
      isBreak?: boolean;
      isContinue?: boolean;
      isReturn?: boolean;
      tryBody?: string;
      catchBody?: string;
      finallyBody?: string;
    }
  >;

  /** Declarative Lattice-Based Data Flow Analysis Engine Configuration */
  analysis?: Record<
    string,
    {
      lattice?: string[];
      direction?: "forward" | "backward";
      join?: (...args: any[]) => any;
      transfer?: (...args: any[]) => any;
    }
  >;

  /** Equality Saturation and E-Graph Algebraic Simplifications */
  simplification?: {
    rules: (
      | {
          name: string;
          lhs: TransformCombinator | string | ((...args: any[]) => any);
          rhs: TransformCombinator | string | ((...args: any[]) => any);
        }
      | Record<string, (...args: any[]) => [any, any] | any>
      | Record<string, any>
    )[];
  };

  /** Zero-GC Hindley-Milner Type System Engine Configuration */
  typeSystem?: {
    constraints?: ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>;
    subtypingPredicates?: (string | ((db: any, sourceId: number, targetId: number) => boolean))[];
    customCode?: string;
  };

  /** DL-Lite / Datalog Semantic Reasoning Engine Configuration */
  semantics?: {
    rules?: (string | ((...args: any[]) => any) | object)[];
    axioms?: (string | ((...args: any[]) => any) | object)[];
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

  /** Target Hardware & Backend Code Generation Options */
  targets?: {
    /** WebGPU Compute Shader Options */
    webgpu?: {
      tileSize?: number;
      workgroupSize?: [number, number];
    };
    /** WebAssembly Text (WAT) Emitter Options */
    wat?: {
      exportName?: string;
      simd?: boolean;
    };
    /** WASM Interface Types (WIT) Generator Options */
    wit?: {
      package?: string;
      world?: string;
    };
    /** CUDA GPU Kernel Emitter Options */
    cuda?: {
      blockSize?: number;
      gridSize?: number;
      arch?: string;
    };
    /** LLVM IR Backend Options */
    llvm?: {
      targetTriple?: string;
      optLevel?: number;
    };
  };

  /** Module System Configuration */
  moduleSystem?: {
    resolve_module?: boolean;
  };

  /** Error Recovery Configuration */
  recovery?: {
    /** Sync tokens for error recovery anchors */
    sync?: string[];
    /** Token names or strings treated as scope delimiters for insertion penalties */
    delimiters?: string[];
    /** Operator strings penalized during insertion */
    operators?: string[];
    /** Rule names classified as structural scope boundaries for unwind penalties */
    structuralRules?: NoInfer<RuleName>[];
  };

  /**
   * Polyglot Cross-Language Transformation Configuration.
   * Declares Triple Graph Grammar (TGG) rules for bidirectional model projection.
   */
  polyglot?: PolyglotConfig<RuleName, FieldName, QueryName, ModelAttrs>;
}

/**
 * Main entry point for defining a new language grammar.
 *
 * @param options The language configuration object
 * @returns The unaltered configuration object (preserves types for downstream compilation)
 */
export function language<
  RuleName extends string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  options: LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): LanguageOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  if (options.sourcePath) {
    (options as any)[SOURCE_PATH_SYMBOL] = options.sourcePath;
  }
  if (options.sourceText) {
    (options as any)[SOURCE_TEXT_SYMBOL] = options.sourceText;
  }

  // Auto-detect caller source file path via stack trace if not explicitly provided
  if (!(options as any)[SOURCE_PATH_SYMBOL] && !(options as any)[SOURCE_TEXT_SYMBOL]) {
    try {
      const err = new Error();
      if (err.stack) {
        const lines = err.stack.split("\n");
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (
            line.includes("/dsl.") ||
            line.includes("\\dsl.") ||
            line.includes("node_modules") ||
            line.includes("internal/")
          ) {
            continue;
          }
          const match = line.match(/(?:file:\/\/)?(\/[^:\s)]+):(?:\d+):(?:\d+)/);
          if (match && match[1]) {
            (options as any)[SOURCE_PATH_SYMBOL] = match[1];
            break;
          }
        }
      }
    } catch {
      // Ignore stack inspection failures in restricted runtimes
    }
  }

  return options;
}

/** Alias for `language` grammar definition */
export const grammar = language;

type ExtractF<T> = T extends (infer U)[] ? (U extends Rule<infer F> ? F : any) : T extends Rule<infer F> ? F : any;

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

export interface DefineLanguageConfig<
  RuleName extends string = string,
  F extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
> {
  options: LanguageOptions<RuleName, FieldName, QueryName>;
}

export function reserved<F extends string = string>(wordset: string, rule: RuleLike<F>): Rule<F> {
  return { type: "RESERVED", value: wordset, children: [toRule(rule)] };
}

/**
 * Resolves GLR shift/reduce or reduce/reduce conflicts by assigning static or dynamic precedences.
 */
export interface PrecFunction {
  <F extends string = string>(value: number, rule: Rule<F>): Rule<F>;
  /** Assigns a static precedence level with left associativity. */
  left<F extends string = string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F>;
  /** Assigns a static precedence level with right associativity. */
  right<F extends string = string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F>;
  /** Assigns a dynamic precedence for GLR tie-breaking at runtime. */
  dynamic<F extends string = string>(value: number, rule: Rule<F>): Rule<F>;
}

export const prec: PrecFunction = function <F extends string = string>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC", value, children: [toRule(rule)] };
} as PrecFunction;

prec.left = function <F extends string = string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  const r = rule !== undefined ? rule : (value as Rule<F>);
  const val = rule !== undefined ? (value as number) : 0;
  return { type: "PREC_LEFT", value: val, children: [toRule(r)] };
};

prec.right = function <F extends string = string>(value: number | Rule<F>, rule?: Rule<F>): Rule<F> {
  const r = rule !== undefined ? rule : (value as Rule<F>);
  const val = rule !== undefined ? (value as number) : 0;
  return { type: "PREC_RIGHT", value: val, children: [toRule(r)] };
};

prec.dynamic = function <F extends string = string>(value: number, rule: Rule<F>): Rule<F> {
  return { type: "PREC_DYNAMIC", value, children: [rule] };
};

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

declare global {
  interface Number {
    is(targetType: any): boolean;
  }
}

if (typeof Number !== "undefined" && !(Number.prototype as any).is) {
  Object.defineProperty(Number.prototype, "is", {
    value: function (targetType: any) {
      const val =
        typeof targetType === "object" && targetType !== null
          ? targetType.value || targetType.id || targetType.type
          : targetType;
      return Number(this) === Number(val);
    },
    configurable: true,
    writable: true,
  });
}

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

export {
  AffineArithmeticMixin,
  CSGMixin,
  McCormickMixin,
  SparsityMixin,
  StandardAdjointMixin,
  StandardHessianMixin,
  StandardIntervalMixin,
  StandardTangentMixin,
} from "./codegen/transform_mixins.js";

// Unified Configuration System Types & Schema Builders

export interface EnumOption<T extends string = string> {
  type: "enum";
  choices: T[];
  default: T;
  description?: string;
}

export interface IntOption {
  type: "int";
  default: number;
  min?: number;
  max?: number;
  description?: string;
}

export interface FloatOption {
  type: "float";
  default: number;
  min?: number;
  max?: number;
  description?: string;
}

export interface BoolOption {
  type: "bool";
  default: boolean;
  description?: string;
}

export type ConfigOption = EnumOption<any> | IntOption | FloatOption | BoolOption;
export type ConfigSchemaCategory = Record<string, ConfigOption>;
export type ConfigSchema = Record<string, ConfigSchemaCategory>;

export function enumOption<T extends string>(opts: { choices: T[]; default: T; description?: string }): EnumOption<T> {
  return { type: "enum", ...opts };
}

export function intOption(opts: { default: number; min?: number; max?: number; description?: string }): IntOption {
  return { type: "int", ...opts };
}

export function floatOption(opts: { default: number; min?: number; max?: number; description?: string }): FloatOption {
  return { type: "float", ...opts };
}

export function boolOption(opts: { default: boolean; description?: string }): BoolOption {
  return { type: "bool", ...opts };
}

export function defineConfigSchema<S extends ConfigSchema>(schema: S): S {
  return schema;
}

export type InferConfigValue<O extends ConfigOption> =
  O extends EnumOption<infer T>
    ? T
    : O extends IntOption
      ? number
      : O extends FloatOption
        ? number
        : O extends BoolOption
          ? boolean
          : never;

export type InferConfigCategory<C extends ConfigSchemaCategory> = {
  [K in keyof C]: InferConfigValue<C[K]>;
};

export type InferConfigSchema<S extends ConfigSchema> = {
  [K in keyof S]: InferConfigCategory<S[K]>;
};

// ---------------------------------------------------------------------------
// Triple Graph Grammar (TGG) Polyglot DSL
// ---------------------------------------------------------------------------

export interface TGGPattern {
  /** The syntax node type or fact predicate to match/create */
  nodeType: string;
  /** Named variable bindings or literal values */
  bindings: Record<string, any>;
  /** Optional inner/nested patterns for child elements or body */
  children?: TGGPattern[];
}

export type TGGConstraintKind = "eq" | "typeMap" | "defaultVal" | "formatUri" | "mapList" | "compute";

export interface TGGConstraint {
  kind: TGGConstraintKind;
  args: any[];
}

export interface TGGRuleOptions<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  name: string;
  /** Existing structural prerequisites in source, target, and correspondence */
  context?: (
    $: any,
    v: (name: string) => any,
  ) => {
    source?: TGGPattern | any;
    target?: TGGPattern | any;
    corr?: TGGPattern | any;
  };
  /** Source language pattern (matched in forward, created in backward) */
  source: ($: any, v: (name: string) => any) => TGGPattern | any;
  /** Target language pattern (created in forward, matched in backward) */
  target: ($: any, v: (name: string) => any) => TGGPattern | any;
  /** Bidirectional attribute constraints and value mapping equations */
  where?: (v: (name: string) => any) => TGGConstraint[];
  /** Priority override (default: 0, higher wins in dispatch) */
  priority?: number;
}

export interface PolyglotConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Target language identifiers this language can project to/from */
  languages?: string[];
  /** Declarative TGG rules */
  rules?: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>[];
  /** Type mapping tables between source and target primitive types */
  typeMaps?: Record<string, Record<string, string>>;
  /** Reasoner predicates that supply inferred facts for TGG matching (e.g. ['subClassOf', 'hasFeature']) */
  reasonerBindings?: string[];
}

/**
 * Declares a Triple Graph Grammar (TGG) transformation rule.
 */
export function tggRule<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
>(
  options: TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs>,
): TGGRuleOptions<RuleName, FieldName, QueryName, ModelAttrs> {
  return options;
}

export function tggEq(a: any, b: any): TGGConstraint {
  return { kind: "eq", args: [a, b] };
}

export function tggTypeMap(
  sourceVar: any,
  targetVar: any,
  mapOrLangName: string | Record<string, string>,
): TGGConstraint {
  return { kind: "typeMap", args: [sourceVar, targetVar, mapOrLangName] };
}

export function tggDefaultVal(targetVar: any, value: any): TGGConstraint {
  return { kind: "defaultVal", args: [targetVar, value] };
}

export function tggFormatUri(idVar: any, prefix: string, targetVar: any): TGGConstraint {
  return { kind: "formatUri", args: [idVar, prefix, targetVar] };
}

export function tggMapList(sourceListVar: any, targetListVar: any, mapper: (item: any) => any): TGGConstraint {
  return { kind: "mapList", args: [sourceListVar, targetListVar, mapper] };
}

export function tggCompute(targetVar: any, queryName: string, sourceVar: any): TGGConstraint {
  return { kind: "compute", args: [targetVar, queryName, sourceVar] };
}

// ---------------------------------------------------------------------------
// General-Purpose 2D Diagram & Visual Modeling DSL (First-Principles Engine)
// ---------------------------------------------------------------------------

/** Visual styling attributes for graphical entities and connections */
export interface VisualStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  textColor?: string;
  headerFill?: string;
  opacity?: number;
  rx?: number;
  ry?: number;
  r?: number;
  size?: number;
  fontSize?: number;
  fontStyle?: string;
  icon?: string;
  router?: "manhattan" | "orth" | "metro" | "normal" | "bezier" | string;
  connector?: "rounded" | "smooth" | "jumpover" | "normal" | string;
  arrowHead?: "classic" | "block" | "diamond" | "cross" | "none" | string;
}

/** Spatial mapping & coordinate system configuration */
export interface SpatialPlacementConfig<FieldName extends string = string> {
  /** In-syntax annotation field or decorator where layout coordinates are stored */
  annotationField?: FieldName;
  /** Schema: 'explicit' (custom fields), 'modelica' (origin + extent + rotation), 'point' (x, y), 'box' (x, y, w, h) */
  schema?: "explicit" | "modelica" | "point" | "box" | "custom";
  originField?: FieldName;
  extentField?: FieldName;
  rotationField?: FieldName;
  xField?: FieldName;
  yField?: FieldName;
  widthField?: FieldName;
  heightField?: FieldName;
  /** Invert Y-axis for mathematical coordinate systems (Y-up) vs screen coordinate systems (Y-down) */
  invertY?: boolean;
  /** Default automatic layout algorithm when placement is not explicit in the code */
  autoLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular";
}

/** Port / Anchor configuration for connecting edges to nodes */
export interface VisualPortConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Query or rule to retrieve child port nodes */
  query?:
    | QueryName
    | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
  /** Field or callback for port identifier / label */
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, port: u32) => string);
  /** Anchor placement group */
  group?: "in" | "out" | "left" | "right" | "top" | "bottom" | "auto" | "radial";
  style?: VisualStyle;
}

/** Structured internal compartment configuration (e.g. attributes, operations, parameters) */
export interface VisualCompartmentConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  header: string;
  query:
    | QueryName
    | ASTQueryFunction<RuleName, FieldName, QueryName, ModelAttrs>
    | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
  itemLabel?: (db: CodeGraph<ModelAttrs, RuleName, FieldName>, item: u32) => string;
}

/** Reactive / Live Simulation Animation Binding Channel */
export interface ReactiveAnimationChannel {
  /** Target visual attribute (e.g., 'rotation', 'extent', 'fill', 'stroke', 'origin', 'visible', 'text', 'scale') */
  attribute: "rotation" | "extent" | "fill" | "stroke" | "origin" | "visible" | "text" | "scale" | string;
  /** Signal / variable name in the simulation state vector (e.g., 'phi', 'temperature', 'active') */
  signal?: string;
  /** Value transformation callback (converts simulation numeric state to visual attribute value) */
  transform?: (db: CodeGraph, node: u32, signalValue: f64) => any;
}

/** Configuration for simulation-time reactive animations & dynamic selection */
export interface ReactiveDynamicsConfig {
  /** Function name used in AST for in-code dynamic value selection (e.g., 'DynamicSelect', 'animate') */
  selectFunction?: string;
  /** Extract static design-time AST argument vs dynamic simulation AST expression */
  extractDynamicSelect?: (db: CodeGraph, callNode: u32) => { staticExpr: u32; dynamicExpr: u32 };
  /** Evaluates dynamic AST expression against live state lookup */
  evaluateDynamic?: (db: CodeGraph, dynamicExprNode: u32, getState: (varName: string) => f64) => any;
  /** Static animation channel bindings */
  channels?: ReactiveAnimationChannel[];
}

/**
 * Visual Element / Vector Glyph Primitive & DOM-Free SVG Hierarchy
 * Fully isomorphic with X6Markup: supports high-level geometric primitives,
 * SVG element tag names, and nested container trees (<svg>, <defs>, <g>, <linearGradient>, <pattern>).
 */
export interface VisualElement {
  /** Primitive type or SVG tag name (e.g. 'rect', 'circle', 'path', 'g', 'svg', 'defs') */
  type?:
    | "rect"
    | "circle"
    | "ellipse"
    | "line"
    | "polygon"
    | "path"
    | "text"
    | "image"
    | "group"
    | "svg"
    | "defs"
    | "g"
    | string;
  tagName?: string;
  selector?: string;
  groupSelector?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  textContent?: string;

  // Spatial & visual coordinates
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  d?: string;
  points?: [number, number][] | { x: number; y: number }[] | string;
  text?: string;
  src?: string;
  style?: VisualStyle;

  /** Nested children / sub-elements / SVG container hierarchy */
  children?: VisualElement[];
}

/** Visual Node & Group configuration */
export interface VisualNodeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  role?: "node" | "group" | "compartment";
  label?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string);
  stereotype?: string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => string);
  shape?: "rect" | "circle" | "diamond" | "cylinder" | "package" | "subsystem" | "pill" | "custom" | string;
  style?: VisualStyle;
  size?: { width: number; height: number };
  spatial?: SpatialPlacementConfig<FieldName>;
  placement?: SpatialPlacementConfig<FieldName>; // Alias for backward-compat
  ports?: VisualPortConfig<RuleName, FieldName, QueryName, ModelAttrs>;
  compartments?: VisualCompartmentConfig<RuleName, FieldName, QueryName, ModelAttrs>[];

  /**
   * Dynamic visual representation function / query.
   * Inspects AST nodes, symbols, or types and returns visual elements or vector markup.
   */
  render?: (
    db: CodeGraph<ModelAttrs, RuleName, FieldName>,
    node: u32,
    env: EvaluationEnvironment,
  ) => VisualElement[] | any;

  /**
   * Declarative AST graphics extractor: extracts child graphical shape AST nodes from any field/query
   */
  graphics?: {
    query?: FieldName | QueryName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => Cursor);
    primitives?: Record<string, Record<string, string>>;
  };

  /** Dynamic template expansions & property bindings (e.g. %name, %R, %class) */
  propertyBindings?: Record<
    string,
    FieldName | string | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, node: u32) => any)
  >;

  /** Reactive simulation animation & dynamic expression evaluation */
  dynamics?: ReactiveDynamicsConfig;
  animation?: ReactiveDynamicsConfig; // Alias for backward-compat
}

/** Visual Edge & Connection configuration */
export interface VisualEdgeConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  source: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  target: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  sourcePort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  targetPort?: FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  label?: string | FieldName | ((db: CodeGraph<ModelAttrs, RuleName, FieldName>, edge: u32) => string);
  waypointsField?: FieldName;
  style?: VisualStyle;

  /** Live simulation animation for edge states (e.g. flow velocity, current, active transitions) */
  dynamics?: ReactiveDynamicsConfig;
  animation?: ReactiveDynamicsConfig; // Alias for backward-compat
}

/** General Diagram Projection (View / Slice / Perspective) */
export interface DiagramProjectionConfig<RuleName extends string = string, FieldName extends string = string> {
  label: string;
  description?: string;
  /** Perspective / Viewpoint identifier */
  perspective?: string;
  viewpoint?: string; // Alias for backward-compat
  /** Scope query: which AST nodes are candidate entities */
  scope?: (db: CodeGraph, root: u32) => Cursor;
  expose?: string[] | ((db: CodeGraph, root: u32) => Cursor);
  /** Node filter predicate */
  filter?: (db: CodeGraph, node: u32) => boolean;
  /** Layout strategy */
  defaultLayout?: "dagre" | "elk" | "grid" | "force" | "tree" | "sequence" | "circular" | "manual";
}

/** Dynamic In-Model Projection Discovery (e.g. SysML2 views, SQL views, Mermaid subgraphs) */
export interface InModelProjectionDiscoveryConfig<RuleName extends string = string, FieldName extends string = string> {
  /** The grammar rule defining views/projections in user code (e.g. 'ViewUsage', 'ViewDefinition') */
  rule?: NoInfer<RuleName>;
  viewRule?: NoInfer<RuleName>; // Alias for backward-compat
  /** Perspective / viewpoint definition rule */
  perspectiveRule?: NoInfer<RuleName>;
  viewpointRule?: NoInfer<RuleName>; // Alias for backward-compat
  /** Field extracting the projection name */
  nameField?: FieldName;
  /** Field extracting the viewpoint / perspective target reference */
  perspectiveField?: FieldName;
  viewpointField?: FieldName; // Alias for backward-compat
  /** Field extracting the expose / scope query expression */
  exposeField?: FieldName;
  /** Field extracting the filter predicate expression */
  filterField?: FieldName;
  /** Evaluates user's in-model filter expression against candidate AST nodes */
  evaluateFilter?: (db: CodeGraph, filterNode: u32, candidateNode: u32) => boolean;
  /** Evaluates user's in-model expose expression to return an AST cursor */
  evaluateExpose?: (db: CodeGraph, exposeNode: u32) => Cursor;
}

/** Dynamic Graphic Annotation Parser (e.g. Modelica Icon/Diagram, CAD 2D primitives) */
export interface GraphicAnnotationsConfig<RuleName extends string = string, FieldName extends string = string> {
  /** Annotation clause field in AST (e.g. 'annotationClause') */
  annotationField?: FieldName;
  /** Graphic primitive AST constructor mappings */
  primitives?: Record<string, Record<string, string>>;
  iconSection?: string;
  diagramSection?: string;
  /** Resolves string template macros (%name, %<param>) against active instance scope */
  resolveTemplate?: (db: CodeGraph, templateString: string, componentNode: u32) => string;
}

/** Bidirectional Visual Mutations (Canvas Action -> AST Synthesis via Unparser) */
export interface VisualMutationConfig {
  createEdge?: (source: string, target: string, sourcePort?: string, targetPort?: string) => string;
  createNode?: (ruleName: string, name: string, x: number, y: number) => string;
  updatePlacement?: (db: CodeGraph, node: u32, x: number, y: number, w: number, h: number, rot: number) => void;
  deleteEntity?: (db: CodeGraph, node: u32) => void;
  renameEntity?: (db: CodeGraph, node: u32, newName: string) => void;
}

/**
 * Generic Runtime Environment / State Store Lookup
 * Resolves identifiers to values from either static parameter bindings (design-time)
 * or live simulation / telemetry state vectors (runtime playback).
 */
export interface EvaluationEnvironment {
  /** Retrieves variable or parameter value by identifier */
  get(identifier: string): any;
  /** Numerical value lookup */
  getNumber(identifier: string): f64;
  /** String value lookup */
  getString(identifier: string): string;
  /** Boolean condition lookup */
  getBoolean(identifier: string): boolean;
  /** Current simulation / execution time */
  time?: f64;
}

/**
 * Universal In-Language Expression Evaluator Protocol
 */
export interface ExpressionEvaluatorConfig {
  /**
   * Evaluates ANY in-language AST expression node using an evaluation environment.
   * Works identically for design-time parameter resolution and 60 FPS simulation playback.
   */
  evaluate?: (db: CodeGraph, exprNode: u32, env: EvaluationEnvironment) => any;

  /**
   * Optional recognizer for languages with explicit static/dynamic wrapper syntax (e.g. Modelica DynamicSelect)
   */
  splitStaticDynamic?: (db: CodeGraph, exprNode: u32) => { staticNode: u32; dynamicNode: u32 };
}

/**
 * Universal 2D Visual Modeling & Diagram DSL Configuration
 */
export interface DiagramConfig<
  RuleName extends string = string,
  FieldName extends string = string,
  QueryName extends string = string,
  ModelAttrs extends Record<string, Record<string, any>> = any,
> {
  /** Static / built-in diagram projections */
  projections?: Record<string, DiagramProjectionConfig<RuleName, FieldName>>;
  views?: Record<string, DiagramProjectionConfig<RuleName, FieldName>>; // Alias for backward-compat

  /** Dynamic in-model projection / view discovery from user AST (e.g. SysML2 views) */
  inModelProjections?: InModelProjectionDiscoveryConfig<RuleName, FieldName>;
  inModelViews?: InModelProjectionDiscoveryConfig<RuleName, FieldName>; // Alias for backward-compat

  /** In-model graphic annotations & vector shape extraction (optional fallback) */
  annotations?: GraphicAnnotationsConfig<RuleName, FieldName>;

  /** General in-language expression evaluation engine (evaluates in-code expressions at design-time and live simulation) */
  evaluator?: ExpressionEvaluatorConfig;

  /** Universal reactive dynamics & simulation animation protocol (e.g. DynamicSelect) */
  dynamics?: ReactiveDynamicsConfig;
  dynamicSelect?: ReactiveDynamicsConfig; // Alias for backward-compat

  /** Visual entity / node configurations */
  entities?: Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>;
  nodes?: Partial<Record<NoInfer<RuleName>, VisualNodeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>; // Alias for backward-compat

  /** Visual relationship / edge configurations */
  connections?: Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>;
  edges?: Partial<Record<NoInfer<RuleName>, VisualEdgeConfig<RuleName, FieldName, QueryName, ModelAttrs>>>; // Alias for backward-compat

  /** Visual mutations (Unparser-backed AST transformations) */
  mutations?: VisualMutationConfig;
}

// Backward-compatible type aliases
export type DiagramStyle = VisualStyle;
export type DiagramPlacementConfig<FieldName extends string = string> = SpatialPlacementConfig<FieldName>;
export type DiagramPortConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualPortConfig<R, F, Q, M>;
export type DiagramCompartmentConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualCompartmentConfig<R, F, Q, M>;
export type DiagramAnimationBinding = ReactiveAnimationChannel;
export type DiagramAnimationConfig = ReactiveDynamicsConfig;
export type DiagramNodeConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualNodeConfig<R, F, Q, M>;
export type DiagramEdgeConfig<
  R extends string = string,
  F extends string = string,
  Q extends string = string,
  M extends Record<string, Record<string, any>> = any,
> = VisualEdgeConfig<R, F, Q, M>;
export type DiagramViewConfig = DiagramProjectionConfig;
export type DiagramMutationConfig = VisualMutationConfig;
export type InModelViewDiscoveryConfig<
  R extends string = string,
  F extends string = string,
> = InModelProjectionDiscoveryConfig<R, F>;
export type InModelGraphicAnnotationsConfig<
  R extends string = string,
  F extends string = string,
> = GraphicAnnotationsConfig<R, F>;
export type InModelDynamicSelectConfig = ReactiveDynamicsConfig;
