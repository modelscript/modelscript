import { ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { atomicChunkAlloc, atomicChunkFree } from "./arena";

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

// Strides
const VAR_STRIDE = 8;
const VAR_NAME = 0;
const VAR_TYPE = 1;
const VAR_VARIABILITY = 2;
const VAR_CAUSALITY = 3;
const VAR_START_HI = 4;
const VAR_START_LO = 5;
const VAR_SHAPE_DIM = 6;
const VAR_FLAGS = 7;

const EQ_STRIDE = 4;
const EQ_KIND = 0;
const EQ_LHS = 1;
const EQ_RHS = 2;
const EQ_AUX = 3;

const EXPR_STRIDE = 4;
const EXPR_KIND = 0;
const EXPR_DATA1 = 1;
const EXPR_LEFT = 2;
const EXPR_RIGHT = 3;

const STMT_STRIDE = 4;
const STMT_KIND = 0;
const STMT_DATA1 = 1;
const STMT_LEFT = 2;
const STMT_RIGHT = 3;

@unmanaged
export class DaeBuilder {
  varData: ChunkedInt32Array;
  varCount: u32;

  eqData: ChunkedInt32Array;
  eqCount: u32;

  exprData: ChunkedInt32Array;
  exprCount: u32;

  stmtData: ChunkedInt32Array;
  stmtCount: u32;

  snapshotVarCount: u32;
  snapshotEqCount: u32;
  snapshotExprCount: u32;
  snapshotStmtCount: u32;

  init(): void {
    this.varData = createChunkedInt32Array(512 * VAR_STRIDE);
    this.varCount = 0;

    this.eqData = createChunkedInt32Array(1024 * EQ_STRIDE);
    this.eqCount = 0;

    this.exprData = createChunkedInt32Array(4096 * EXPR_STRIDE);
    this.exprCount = 0;

    this.stmtData = createChunkedInt32Array(256 * STMT_STRIDE);
    this.stmtCount = 0;

    this.snapshotVarCount = 0;
    this.snapshotEqCount = 0;
    this.snapshotExprCount = 0;
    this.snapshotStmtCount = 0;
  }

  @inline
  addVariable(
    nameId: u32,
    type: u8,
    variability: u8,
    causality: u8,
    startValue: f64,
    flags: i32 = 0
  ): u32 {
    let idx = this.varCount++;
    let offset = idx * VAR_STRIDE;
    
    // Use f64.reinterpret_i64 for native bit conversion
    let startBits = reinterpret<u64>(startValue);
    let startHi = (startBits >>> 32) as i32;
    let startLo = (startBits & 0xffffffff) as i32;

    this.varData.set(offset + VAR_NAME, nameId);
    this.varData.set(offset + VAR_TYPE, type);
    this.varData.set(offset + VAR_VARIABILITY, variability);
    this.varData.set(offset + VAR_CAUSALITY, causality);
    this.varData.set(offset + VAR_START_HI, startHi);
    this.varData.set(offset + VAR_START_LO, startLo);
    this.varData.set(offset + VAR_SHAPE_DIM, 0);
    this.varData.set(offset + VAR_FLAGS, flags);

    return idx;
  }

  @inline
  addExpression(kind: u8, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.exprCount++;
    let offset = idx * EXPR_STRIDE;

    this.exprData.set(offset + EXPR_KIND, kind);
    this.exprData.set(offset + EXPR_DATA1, data1);
    this.exprData.set(offset + EXPR_LEFT, left);
    this.exprData.set(offset + EXPR_RIGHT, right);

    return idx;
  }

  @inline
  addEquation(kind: u8, lhsId: u32, rhsId: u32, auxId: u32 = 0xffffffff): u32 {
    let idx = this.eqCount++;
    let offset = idx * EQ_STRIDE;

    this.eqData.set(offset + EQ_KIND, kind);
    this.eqData.set(offset + EQ_LHS, lhsId);
    this.eqData.set(offset + EQ_RHS, rhsId);
    this.eqData.set(offset + EQ_AUX, auxId);

    return idx;
  }

  @inline
  addStatement(kind: u8, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.stmtCount++;
    let offset = idx * STMT_STRIDE;

    this.stmtData.set(offset + STMT_KIND, kind);
    this.stmtData.set(offset + STMT_DATA1, data1);
    this.stmtData.set(offset + STMT_LEFT, left);
    this.stmtData.set(offset + STMT_RIGHT, right);

    return idx;
  }

  @inline
  snapshot(): void {
    this.snapshotVarCount = this.varCount;
    this.snapshotEqCount = this.eqCount;
    this.snapshotExprCount = this.exprCount;
    this.snapshotStmtCount = this.stmtCount;
  }

  @inline
  rollback(): void {
    this.varCount = this.snapshotVarCount;
    this.varData.length = this.varCount * VAR_STRIDE;
    
    this.eqCount = this.snapshotEqCount;
    this.eqData.length = this.eqCount * EQ_STRIDE;
    
    this.exprCount = this.snapshotExprCount;
    this.exprData.length = this.exprCount * EXPR_STRIDE;

    this.stmtCount = this.snapshotStmtCount;
    this.stmtData.length = this.stmtCount * STMT_STRIDE;
  }
}

export function dae_createBuilder(): u32 {
  let ptr = atomicChunkAlloc(offsetof<DaeBuilder>());
  let builder = changetype<DaeBuilder>(ptr);
  builder.init();
  return ptr as u32;
}

export function dae_free(ptr: u32): void {
  if (ptr == 0) return;
  // Note: Unmanaged structures that rely on atomicChunkAlloc just let the arena handle bulk frees.
  // In a full implementation, we'd add free methods to ChunkedInt32Array to return blocks to the pool.
}

export function dae_snapshot(ptr: u32): void {
  changetype<DaeBuilder>(ptr).snapshot();
}

export function dae_rollback(ptr: u32): void {
  changetype<DaeBuilder>(ptr).rollback();
}
