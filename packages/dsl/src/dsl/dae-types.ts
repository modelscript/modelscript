// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DAE enums, flags, chunked array polyfills, and DaeBuilder interfaces.
 */

/** Fundamental primitive or clock type of a DAE variable. */
export enum VarType {
  Real = 0,
  Integer = 1,
  Boolean = 2,
  String = 3,
  Enumeration = 4,
  Clock = 5,
}

/** Temporal variability of a DAE variable (`continuous`, `discrete`, `parameter`, or `constant`). */
export enum Variability {
  Continuous = 0,
  Discrete = 1,
  Parameter = 2,
  Constant = 3,
}

/** Interface causality of a DAE variable (`local`, `input`, or `output`). */
export enum Causality {
  Local = 0,
  Input = 1,
  Output = 2,
}

/** Equation kind discriminator in the linear-memory DAE equation table (`EQ_STRIDE = 4`). */
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
  InitialFunctionCall = 9,
}

/** Expression node kind discriminator in the linear-memory DAE expression table (`EXPR_STRIDE = 4`). */
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

/** Binary operator kind stored in `EXPR_DATA1` for `ExprKind.Binary` nodes. */
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
  Colon = 18,
}

/** Unary operator kind stored in `EXPR_DATA1` for `ExprKind.Unary` nodes. */
export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

/** Statement kind discriminator in the linear-memory DAE statement table (`STMT_STRIDE = 4`). */
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

/** Variable selected as a tearing variable during algebraic loop tearing (`1 << 0`). */
export const FLAG_TEARING_VAR: number = 1 << 0;
/** Connector `flow` variable obeying Kirchhoff's zero-sum conservation law (`1 << 1`). */
export const FLAG_VAR_FLOW: number = 1 << 1;
/** Connector `stream` variable transported by an associated `flow` variable (`1 << 2`). */
export const FLAG_VAR_STREAM: number = 1 << 2;
/** Continuous differential state variable $x$ differentiated by `der(x)` (`1 << 3`). */
export const FLAG_VAR_STATE: number = 1 << 3;
/** State derivative variable $\dot{x} = \text{der}(x)$ (`1 << 4`). */
export const FLAG_VAR_STATE_DER: number = 1 << 4;
/** Variable whose `fixed = true` initial value attribute is enforced at $t_0$ (`1 << 5`). */
export const FLAG_VAR_FIXED: number = 1 << 5;
/** Variable eliminated during alias elimination or dead-variable pruning (`1 << 6`). */
export const FLAG_VAR_REMOVED: number = 1 << 6;
/** Variable declared inside a `protected` class section (`1 << 7`). */
export const FLAG_VAR_PROTECTED: number = 1 << 7;
/** Variable declared with the `final` prefix prohibiting further modification (`1 << 8`). */
export const FLAG_VAR_FINAL: number = 1 << 8;
/** Compiler-synthesized virtual/auxiliary variable (`1 << 9`). */
export const FLAG_VAR_VIRTUAL: number = 1 << 9;

/** Equation belongs to an `initial equation` section (`1 << 0`). */
export const FLAG_EQ_INITIAL: number = 1 << 0;
/** Overconstrained connection equation subject to `Connections.branch`/`root` spanning-tree pruning (`1 << 1`). */
export const FLAG_EQ_OVERCONSTRAINED: number = 1 << 1;
/** Equation synthesized from a stream connector `connect()` clause (`1 << 2`). */
export const FLAG_EQ_STREAM_CONNECT: number = 1 << 2;
/** Equation differentiated or constrained during Pantelides high-index reduction (`1 << 3`). */
export const FLAG_HIGH_INDEX_EQ: number = 1 << 3;

/** Host-side interface mirroring the WASM linear-memory `ChunkedUint32Array` container. */
export interface ChunkedUint32Array {
  /** Reads the unsigned 32-bit integer at index `idx`. */
  get(idx: number): number;
  /** Writes the unsigned 32-bit integer `val` at index `idx`. */
  set(idx: number, val: number): void;
}

/** Host-side interface mirroring the WASM linear-memory `ChunkedInt32Array` container. */
export interface ChunkedInt32Array {
  /** Reads the signed 32-bit integer at index `idx`. */
  get(idx: number): number;
  /** Writes the signed 32-bit integer `val` at index `idx`. */
  set(idx: number, val: number): void;
}

/** Allocates a host-side `Uint32Array`-backed polyfill for `ChunkedUint32Array`. */
export function createChunkedUint32Array(capacity: number): ChunkedUint32Array {
  const buf = new Uint32Array(capacity);
  return {
    get: (idx: number) => buf[idx] || 0,
    set: (idx: number, val: number) => {
      buf[idx] = val;
    },
  };
}

/** Allocates a host-side `Int32Array`-backed polyfill for `ChunkedInt32Array`. */
export function createChunkedInt32Array(capacity: number): ChunkedInt32Array {
  const buf = new Int32Array(capacity);
  return {
    get: (idx: number) => buf[idx] || 0,
    set: (idx: number, val: number) => {
      buf[idx] = val;
    },
  };
}

/** Host-side interface mirroring the WASM linear-memory 64-bit integer hash map (`UnmanagedMap64`). */
export interface UnmanagedMap64 {
  /** Looks up the value mapped to `key` (returns `0` if absent). */
  get(key: bigint | number): bigint | number;
  /** Associates `key` with `val`. */
  set(key: bigint | number, val: bigint | number): void;
  /** Returns true if `key` is present in the map. */
  has(key: bigint | number): boolean;
}

/** Host-side interface mirroring the WASM linear-memory 64-bit integer hash set (`UnmanagedSet64`). */
export interface UnmanagedSet64 {
  /** Returns true if `val` is present in the set. */
  has(val: bigint | number): boolean;
  /** Inserts `val` into the set. */
  add(val: bigint | number): void;
}

/** Creates a host-side `Map`-backed polyfill for `UnmanagedMap64`. */
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

/** Creates a host-side `Set`-backed polyfill for `UnmanagedSet64`. */
export function createSet64(): UnmanagedSet64 {
  const set = new Set<bigint | number>();
  return {
    has: (v) => set.has(v),
    add: (v) => {
      set.add(v);
    },
  };
}

/** Stub host polyfill returning the first child pointer of a linear-memory CST node. */
export function getNodeFirstChild(_nodePtr: number): number {
  return 0;
}
/** Stub host polyfill returning the next sibling pointer of a linear-memory CST node. */
export function getNodeNextSibling(_nodePtr: number): number {
  return 0;
}
/** Stub host polyfill returning the 10-bit syntax kind ID of a linear-memory CST node. */
export function getNodeType(_nodePtr: number): number {
  return 0;
}
/** Stub host polyfill for atomic linear-memory chunk allocation. */
export function atomicChunkAlloc(_bytes: number): number {
  return 0;
}

/** Minimal DAE arena builder contract exposed to DSL lowering and flattening passes. */
export interface DaeBuilder {
  /** Total number of variables emitted into the DAE arena. */
  varCount: number;
  /** Total number of equations emitted into the DAE arena. */
  eqCount: number;
  /** Total number of expression nodes allocated in the DAE arena. */
  exprCount: number;
  /** Total number of algorithm statements emitted into the DAE arena. */
  stmtCount: number;
  /** Appends a variable row (`VAR_STRIDE = 8`) and returns its 0-based variable index. */
  addVariable(
    nameId: number,
    type: number,
    variability: number,
    causality: number,
    startVal: number,
    flags?: number,
  ): number;
  /** Appends an expression row (`EXPR_STRIDE = 4`) and returns its 0-based `ExprId`. */
  addExpression(kind: number, data1: number, left?: number, right?: number): number;
  /** Appends an equation row (`EQ_STRIDE = 4`) and returns its 0-based `EqId`. */
  addEquation(kind: number, lhs: number, rhs: number, flags?: number): number;
  /** Allocates an `ExprKind.RealLiteral` node for `val` and returns its `ExprId`. */
  addRealLiteral(val: number): number;
  /** Allocates an `ExprKind.IntLiteral` node for `val` and returns its `ExprId`. */
  addIntLiteral(val: number): number;
}

/** Interned string pool contract shared between the host and WASM DAE arena. */
export interface ArenaStringPool {
  /** Interns `str` and returns its deterministic integer `StringId`. */
  intern(str: string): number;
  /** Resolves an interned `StringId` back to its UTF-8 string. */
  resolve(id: number): string;
  /** Concatenates two interned string IDs with a `.` separator and returns the resulting `StringId`. */
  concatIds(id1: number, id2: number): number;
}

/** Hierarchical lexical/component scope stack used during CST-to-DAE flattening. */
export interface GenericScopeStack {
  /** Enters a new top-level or nested scope prefix. */
  enter(prefix: number | string): void;
  /** Pushes a component or class prefix onto the active qualification stack. */
  push(prefix: number | string): void;
  /** Pops the innermost prefix from the qualification stack. */
  pop(): void;
  /** Resets the scope stack to empty. */
  reset(): void;
  /** Returns the interned `StringId` of the current fully-qualified name. */
  currentFqn(): number;
  /** Returns the interned `StringId` of the current enclosing component prefix. */
  currentPrefix(): number;
}
