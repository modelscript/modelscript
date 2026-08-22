import { ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { atomicChunkAlloc } from "./arena";

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
export const VAR_STRIDE = 8;
export const VAR_NAME = 0;
export const VAR_TYPE = 1;
export const VAR_VARIABILITY = 2;
export const VAR_CAUSALITY = 3;
export const VAR_START_HI = 4;
export const VAR_START_LO = 5;
export const VAR_SHAPE_DIM = 6;
export const VAR_FLAGS = 7;
export const FLAG_TEARING_VAR: i32 = 1 << 0;
export const FLAG_VAR_FLOW: i32 = 1 << 1;
export const FLAG_VAR_STREAM: i32 = 1 << 2;
export const FLAG_VAR_STATE: i32 = 1 << 3;
export const FLAG_VAR_STATE_DER: i32 = 1 << 4;
export const FLAG_VAR_FIXED: i32 = 1 << 5;

export const FLAG_EQ_INITIAL: i32 = 1 << 0;
export const FLAG_EQ_OVERCONSTRAINED: i32 = 1 << 1;
export const FLAG_EQ_STREAM_CONNECT: i32 = 1 << 2;

export const EQ_STRIDE = 4;
export const EQ_KIND = 0;
export const EQ_LHS = 1;
export const EQ_RHS = 2;
export const EQ_AUX = 3;

export const EXPR_STRIDE = 4;
export const EXPR_KIND = 0;
export const EXPR_DATA1 = 1;
export const EXPR_LEFT = 2;
export const EXPR_RIGHT = 3;

export const STMT_STRIDE = 4;
export const STMT_KIND = 0;
export const STMT_DATA1 = 1;
export const STMT_LEFT = 2;
export const STMT_RIGHT = 3;

/**
 * Struct-of-Arrays (SoA) Builder for flat Differential Algebraic Equations (DAE).
 * Enables zero-GC memory efficiency when constructing large systems of equations.
 */
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

  /**
   * Initializes the chunked memory arrays for variables, equations, expressions, and statements.
   */
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

  /**
   * Registers a variable declaration in the DAE system.
   * Encodes `startValue` into 64-bit IEEE-754 bit representations across high/low 32-bit fields.
   */
  @inline
  addVariable(
    nameId: u32,
    type: i32,
    variability: i32,
    causality: i32,
    startValue: f64,
    flags: i32 = 0
  ): u32 {
    let idx = this.varCount++;
    let offset = idx * VAR_STRIDE;
    
    // Use i64.reinterpret_f64 for native bit conversion
    let startBits = i64.reinterpret_f64(startValue) as u64;
    let startHi = (startBits >> 32) as i32;
    let startLo = (startBits & 0xffffffff) as i32;

    this.varData.set(offset + VAR_NAME, nameId as i32);
    this.varData.set(offset + VAR_TYPE, type);
    this.varData.set(offset + VAR_VARIABILITY, variability);
    this.varData.set(offset + VAR_CAUSALITY, causality);
    this.varData.set(offset + VAR_START_HI, startHi);
    this.varData.set(offset + VAR_START_LO, startLo);
    this.varData.set(offset + VAR_SHAPE_DIM, 0);
    this.varData.set(offset + VAR_FLAGS, flags);

    return idx;
  }

  /**
   * Adds an expression node to the DAE system.
   */
  @inline
  addExpression(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.exprCount++;
    let offset = idx * EXPR_STRIDE;

    this.exprData.set(offset + EXPR_KIND, kind);
    this.exprData.set(offset + EXPR_DATA1, data1);
    this.exprData.set(offset + EXPR_LEFT, left);
    this.exprData.set(offset + EXPR_RIGHT, right);

    return idx;
  }

  /**
   * Adds an integer literal expression.
   */
  @inline
  addIntLiteral(value: i32): u32 {
    return this.addExpression(ExprKind.IntLiteral, value as u32);
  }

  /**
   * Adds a real literal expression.
   */
  @inline
  addRealLiteral(value: f64): u32 {
    let bits = i64.reinterpret_f64(value) as u64;
    let lo = (bits & 0xffffffff) as u32;
    let hi = (bits >> 32) as u32;
    return this.addExpression(ExprKind.RealLiteral, lo, hi);
  }

  /**
   * Adds an equation to the DAE system (e.g. `lhs = rhs`).
   */
  @inline
  addEquation(kind: i32, lhsId: u32, rhsId: u32, auxId: u32 = 0xffffffff): u32 {
    let idx = this.eqCount++;
    let offset = idx * EQ_STRIDE;

    this.eqData.set(offset + EQ_KIND, kind);
    this.eqData.set(offset + EQ_LHS, lhsId);
    this.eqData.set(offset + EQ_RHS, rhsId);
    this.eqData.set(offset + EQ_AUX, auxId);

    return idx;
  }

  /**
   * Adds an algorithm statement to the DAE system.
   */
  @inline
  addStatement(kind: i32, data1: u32, left: u32 = 0xffffffff, right: u32 = 0xffffffff): u32 {
    let idx = this.stmtCount++;
    let offset = idx * STMT_STRIDE;

    this.stmtData.set(offset + STMT_KIND, kind);
    this.stmtData.set(offset + STMT_DATA1, data1);
    this.stmtData.set(offset + STMT_LEFT, left);
    this.stmtData.set(offset + STMT_RIGHT, right);

    return idx;
  }

  @inline
  setVarFlag(varId: u32, flag: i32): void {
    if (varId >= this.varCount) return;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    let curr = this.varData.get(offset);
    this.varData.set(offset, curr | flag);
  }

  @inline
  hasVarFlag(varId: u32, flag: i32): boolean {
    if (varId >= this.varCount) return false;
    let offset = varId * VAR_STRIDE + VAR_FLAGS;
    return (this.varData.get(offset) & flag) != 0;
  }

  @inline
  exportDaeBinary(targetBuf: usize): u32 {
    if (targetBuf == 0) return 0;
    store<u32>(targetBuf, this.varCount);
    store<u32>(targetBuf + 4, this.eqCount);
    store<u32>(targetBuf + 8, this.exprCount);
    store<u32>(targetBuf + 12, this.stmtCount);
    return 16;
  }

  /**
   * Captures a snapshot checkpoint of the current variable/equation counts.
   * Enables incremental rollback during speculative compilation or failed branches.
   */
  @inline
  snapshot(): void {
    this.snapshotVarCount = this.varCount;
    this.snapshotEqCount = this.eqCount;
    this.snapshotExprCount = this.exprCount;
    this.snapshotStmtCount = this.stmtCount;
  }

  /**
   * Restores the DAE system state back to the previous snapshot checkpoint.
   */
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

/**
 * Creates and initializes a new DaeBuilder instance in linear memory.
 */
export function dae_createBuilder(): u32 {
  let ptr = atomicChunkAlloc(sizeof<DaeBuilder>());
  let builder = changetype<DaeBuilder>(ptr);
  builder.init();
  return ptr as u32;
}

/**
 * Frees a DaeBuilder instance.
 */
export function dae_free(ptr: u32): void {
  if (ptr == 0) return;
}

/**
 * Takes a snapshot of the specified DaeBuilder instance.
 */
export function dae_snapshot(ptr: u32): void {
  changetype<DaeBuilder>(ptr).snapshot();
}

/**
 * Rolls back the specified DaeBuilder instance to its previous snapshot.
 */
export function dae_rollback(ptr: u32): void {
  changetype<DaeBuilder>(ptr).rollback();
}

/**
 * Helper export to register a variable on a DaeBuilder pointer.
 */
export function dae_addVariable(ptr: u32, nameId: u32, type: i32, variability: i32, causality: i32, startValue: f64, flags: i32): u32 {
  return changetype<DaeBuilder>(ptr).addVariable(nameId, type, variability, causality, startValue, flags);
}

/**
 * Helper export to register an expression on a DaeBuilder pointer.
 */
export function dae_addExpression(ptr: u32, kind: i32, data1: u32, left: u32, right: u32): u32 {
  return changetype<DaeBuilder>(ptr).addExpression(kind, data1, left, right);
}

/**
 * Helper export to add a real literal on a DaeBuilder pointer.
 */
export function dae_addRealLiteral(ptr: u32, value: f64): u32 {
  return changetype<DaeBuilder>(ptr).addRealLiteral(value);
}

/**
 * Helper export to add an int literal on a DaeBuilder pointer.
 */
export function dae_addIntLiteral(ptr: u32, value: i32): u32 {
  return changetype<DaeBuilder>(ptr).addIntLiteral(value);
}

/**
 * Helper export to add an equation on a DaeBuilder pointer.
 */
export function dae_addEquation(ptr: u32, kind: i32, lhsId: u32, rhsId: u32, auxId: u32): u32 {
  return changetype<DaeBuilder>(ptr).addEquation(kind, lhsId, rhsId, auxId);
}

/**
 * Helper export to set a variable flag.
 */
export function dae_setVarFlag(ptr: u32, varId: u32, flag: i32): void {
  changetype<DaeBuilder>(ptr).setVarFlag(varId, flag);
}

/**
 * Helper export to get total equations in DaeBuilder.
 */
export function dae_getEqCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).eqCount;
}

/**
 * Helper export to get total variables in DaeBuilder.
 */
export function dae_getVarCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).varCount;
}

/**
 * Helper export to get total expressions in DaeBuilder.
 */
export function dae_getExprCount(ptr: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprCount;
}

/**
 * Helper export to inspect the kind of an expression.
 */
export function dae_getExprKind(ptr: u32, exprId: u32): i32 {
  return changetype<DaeBuilder>(ptr).exprData.get(exprId * 4 + 0);
}

/**
 * Helper export to inspect data1 of an expression.
 */
export function dae_getExprData1(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprData.get(exprId * 4 + 1);
}

/**
 * Helper export to inspect left operand of an expression.
 */
export function dae_getExprLeft(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprData.get(exprId * 4 + 2);
}

/**
 * Helper export to inspect right operand of an expression.
 */
export function dae_getExprRight(ptr: u32, exprId: u32): u32 {
  return changetype<DaeBuilder>(ptr).exprData.get(exprId * 4 + 3);
}

