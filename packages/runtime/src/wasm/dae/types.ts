// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @fileoverview Canonical DAE Type Definitions & Layout Constants
 *
 * Single source of truth for all struct-of-arrays layout constants, enum types,
 * and bitfield flag definitions used by the DAE arena. All other modules
 * (eval, fold, alias, blt, pantelides, integrators, etc.) should import from
 * this file rather than from dae.ts directly.
 *
 * Memory Layout Summary:
 *   Variable row:   8 × i32 words (VAR_STRIDE = 8)
 *   Equation row:   4 × i32 words (EQ_STRIDE = 4)
 *   Expression row: 4 × i32 words (EXPR_STRIDE = 4)
 *   Statement row:  4 × i32 words (STMT_STRIDE = 4)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Variable SoA Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of i32 words per variable row. */
export const VAR_STRIDE: u32 = 8;
/** Word offset: interned name StringId. */
export const VAR_NAME: u32 = 0;
/** Word offset: VarType enum. */
export const VAR_TYPE: u32 = 1;
/** Word offset: Variability enum. */
export const VAR_VARIABILITY: u32 = 2;
/** Word offset: Causality enum. */
export const VAR_CAUSALITY: u32 = 3;
/** Word offset: high 32 bits of f64 start value (reinterpreted). */
export const VAR_START_HI: u32 = 4;
/** Word offset: low 32 bits of f64 start value (reinterpreted). */
export const VAR_START_LO: u32 = 5;
/** Word offset: number of shape dimensions (0 = scalar). */
export const VAR_SHAPE_DIM: u32 = 6;
/** Word offset: bitfield flags (FLAG_VAR_*). */
export const VAR_FLAGS: u32 = 7;

// ─────────────────────────────────────────────────────────────────────────────
// Variable Flags
// ─────────────────────────────────────────────────────────────────────────────

export const FLAG_TEARING_VAR: i32 = 1 << 0;
export const FLAG_VAR_FLOW: i32 = 1 << 1;
export const FLAG_VAR_STREAM: i32 = 1 << 2;
export const FLAG_VAR_STATE: i32 = 1 << 3;
export const FLAG_VAR_STATE_DER: i32 = 1 << 4;
export const FLAG_VAR_FIXED: i32 = 1 << 5;
export const FLAG_VAR_REMOVED: i32 = 1 << 6;

// ─────────────────────────────────────────────────────────────────────────────
// Equation SoA Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of i32 words per equation row. */
export const EQ_STRIDE: u32 = 4;
/** Word offset: EqKind enum. */
export const EQ_KIND: u32 = 0;
/** Word offset: LHS expression ID. */
export const EQ_LHS: u32 = 1;
/** Word offset: RHS expression ID. */
export const EQ_RHS: u32 = 2;
/** Word offset: auxiliary data (equation-kind-specific). */
export const EQ_AUX: u32 = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Equation Flags
// ─────────────────────────────────────────────────────────────────────────────

export const FLAG_EQ_INITIAL: i32 = 1 << 0;
export const FLAG_EQ_OVERCONSTRAINED: i32 = 1 << 1;
export const FLAG_EQ_STREAM_CONNECT: i32 = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// Expression SoA Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of i32 words per expression row. */
export const EXPR_STRIDE: u32 = 4;
/** Word offset: ExprKind enum. */
export const EXPR_KIND: u32 = 0;
/** Word offset: primary data (meaning depends on ExprKind). */
export const EXPR_DATA1: u32 = 1;
/** Word offset: left child expr ID or secondary data. */
export const EXPR_LEFT: u32 = 2;
/** Word offset: right child expr ID or tertiary data. */
export const EXPR_RIGHT: u32 = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Statement SoA Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of i32 words per statement row. */
export const STMT_STRIDE: u32 = 4;
export const STMT_KIND: u32 = 0;
export const STMT_DATA1: u32 = 1;
export const STMT_LEFT: u32 = 2;
export const STMT_RIGHT: u32 = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Compound Equation & State Machine Layout
// ─────────────────────────────────────────────────────────────────────────────

export const VAR_ATTR_STRIDE: u32 = 8;
export const CLOCK_STRIDE: u32 = 4;
export const WHEN_STRIDE: u32 = 4;
export const FOR_STRIDE: u32 = 4;
export const IF_STRIDE: u32 = 6;
export const SM_STRIDE: u32 = 4;
export const STATE_STRIDE: u32 = 6;
export const TRANSITION_STRIDE: u32 = 6;

export const FLAG_TRANSITION_IMMEDIATE: i32 = 1 << 0;
export const FLAG_TRANSITION_RESET: i32 = 1 << 1;
export const FLAG_TRANSITION_SYNCHRONIZE: i32 = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel Value
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel value for "no ID" / "null expression". */
export const NULL_ID: u32 = 0xffffffff;

// ─────────────────────────────────────────────────────────────────────────────
// Enum Types
// ─────────────────────────────────────────────────────────────────────────────

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

export enum VarAttrKind {
  Min = 0,
  Max = 1,
  Unit = 2,
  DisplayUnit = 3,
  Nominal = 4,
  Start = 5,
  Fixed = 6,
}
