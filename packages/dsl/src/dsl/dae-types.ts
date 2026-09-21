/**
 * DAE enums, flags, chunked array polyfills, and DaeBuilder interfaces.
 */

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
  InitialFunctionCall = 9,
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
  Colon = 18,
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
