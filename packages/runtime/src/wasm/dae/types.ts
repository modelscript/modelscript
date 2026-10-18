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

/** Variable selected as a tearing variable during algebraic loop tearing (`1 << 0`). */
export const FLAG_TEARING_VAR: i32 = 1 << 0;
/** Connector `flow` variable obeying Kirchhoff's zero-sum conservation law (`1 << 1`). */
export const FLAG_VAR_FLOW: i32 = 1 << 1;
/** Connector `stream` variable transported by an associated `flow` variable (`1 << 2`). */
export const FLAG_VAR_STREAM: i32 = 1 << 2;
/** Continuous differential state variable $x$ differentiated by `der(x)` (`1 << 3`). */
export const FLAG_VAR_STATE: i32 = 1 << 3;
/** State derivative variable $\dot{x} = \text{der}(x)$ (`1 << 4`). */
export const FLAG_VAR_STATE_DER: i32 = 1 << 4;
/** Variable whose `fixed = true` initial value attribute is enforced at $t_0$ (`1 << 5`). */
export const FLAG_VAR_FIXED: i32 = 1 << 5;
/** Variable eliminated during alias elimination or dead-variable pruning (`1 << 6`). */
export const FLAG_VAR_REMOVED: i32 = 1 << 6;
/** Variable declared inside a `protected` class section (`1 << 7`). */
export const FLAG_VAR_PROTECTED: i32 = 1 << 7;
/** Variable declared with the `final` prefix prohibiting further modification (`1 << 8`). */
export const FLAG_VAR_FINAL: i32 = 1 << 8;
/** Compiler-synthesized virtual/auxiliary variable (`1 << 9`). */
export const FLAG_VAR_VIRTUAL: i32 = 1 << 9;

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

/** Equation belongs to an `initial equation` section (`1 << 0`). */
export const FLAG_EQ_INITIAL: i32 = 1 << 0;
/** Overconstrained connection equation subject to `Connections.branch`/`root` spanning-tree pruning (`1 << 1`). */
export const FLAG_EQ_OVERCONSTRAINED: i32 = 1 << 1;
/** Equation synthesized from a stream connector `connect()` clause (`1 << 2`). */
export const FLAG_EQ_STREAM_CONNECT: i32 = 1 << 2;
/** Equation differentiated or constrained during Pantelides high-index reduction (`1 << 3`). */
export const FLAG_HIGH_INDEX_EQ: i32 = 1 << 3;
/** Equation eliminated during alias elimination or dead-equation pruning (`1 << 4`). */
export const FLAG_EQ_REMOVED: i32 = 1 << 4;

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
/** Word offset: `StmtKind` enum discriminator. */
export const STMT_KIND: u32 = 0;
/** Word offset: primary statement payload (target variable/expr ID, condition expr ID, or loop variable StringId). */
export const STMT_DATA1: u32 = 1;
/** Word offset: secondary statement payload (RHS expr ID, range expr ID, or body start index). */
export const STMT_LEFT: u32 = 2;
/** Word offset: tertiary statement payload (body statement count, `else` branch index, or auxiliary metadata). */
export const STMT_RIGHT: u32 = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Compound Equation & State Machine Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of `i32` words per variable attribute row (`VarAttrKind` indexed: `min`, `max`, `unit`, `displayUnit`, `nominal`, `start`, `fixed`, `binding`, `quantity`, `description`). */
export const VAR_ATTR_STRIDE: u32 = 10;
/** Number of `i32` words per synchronous clock row (`[clockId, kind, intervalExprId, resolutionExprId]`). */
export const CLOCK_STRIDE: u32 = 4;
/** Number of `i32` words per `when`-equation metadata row (`[condExprId, bodyEqStart, bodyEqCount, elseWhenIdx]`). */
export const WHEN_STRIDE: u32 = 4;
/** Number of `i32` words per `for`-equation metadata row (`[iterNameId, rangeExprId, bodyEqStart, bodyEqCount]`). */
export const FOR_STRIDE: u32 = 4;
/** Number of `i32` words per `if`-equation metadata row (`[condExprId, thenStart, thenCount, elseStart, elseCount, elseIfIdx]`). */
export const IF_STRIDE: u32 = 6;
/** Number of `i32` words per state machine header row (`[smId, initialStateId, stateStart, stateCount]`). */
export const SM_STRIDE: u32 = 4;
/** Number of `i32` words per state machine state row (`[stateId, nameId, eqStart, eqCount, transStart, transCount]`). */
export const STATE_STRIDE: u32 = 6;
/** Number of `i32` words per state machine transition row (`[fromStateId, toStateId, condExprId, priority, flags, ticksExprId]`). */
export const TRANSITION_STRIDE: u32 = 6;

/** Transition fires immediately in the same clock tick when its guard becomes true (`1 << 0`). */
export const FLAG_TRANSITION_IMMEDIATE: i32 = 1 << 0;
/** Transition resets the target state's internal variables upon entry (`1 << 1`). */
export const FLAG_TRANSITION_RESET: i32 = 1 << 1;
/** Transition waits for sub-state machines in the source state to reach final states (`1 << 2`). */
export const FLAG_TRANSITION_SYNCHRONIZE: i32 = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel Value
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel value for "no ID" / "null expression". */
export const NULL_ID: u32 = 0xffffffff;

// ─────────────────────────────────────────────────────────────────────────────
// Enum Types
// ─────────────────────────────────────────────────────────────────────────────

/** Fundamental primitive or clock type of a DAE variable. */
export enum VarType {
  Real = 0,
  Integer = 1,
  Boolean = 2,
  String = 3,
  Enumeration = 4,
  Clock = 5,
}

/** Temporal variability of a DAE variable (Modelica Specification §4.4.4). */
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

/**
 * Discriminator for rows in the DAE equation table (`EQ_STRIDE = 4`: `[EQ_KIND, EQ_LHS, EQ_RHS, EQ_AUX]`).
 * - `Simple` / `InitialSimple`: `EQ_LHS` = left expr ID, `EQ_RHS` = right expr ID, `EQ_AUX` = `FLAG_EQ_*`.
 * - `Array`: `EQ_LHS` = array LHS expr ID, `EQ_RHS` = array RHS expr ID, `EQ_AUX` = element count.
 * - `For` / `InitialFor`: `EQ_LHS` = `FOR_STRIDE` metadata index.
 * - `If`: `EQ_LHS` = `IF_STRIDE` metadata index.
 * - `When`: `EQ_LHS` = `WHEN_STRIDE` metadata index.
 * - `FunctionCall` / `InitialFunctionCall`: `EQ_LHS` = call expr ID, `EQ_RHS` = `NULL_ID` (or tuple LHS expr ID).
 * - `Connect`: `EQ_LHS` = connector A expr ID, `EQ_RHS` = connector B expr ID.
 */
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

/**
 * Discriminator for rows in the DAE expression table (`EXPR_STRIDE = 4`: `[EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT]`).
 * - `Name`: `DATA1` = interned variable `StringId`, `LEFT` = resolved `varId` (or `NULL_ID`).
 * - `IntLiteral`: `DATA1` = 32-bit signed integer value.
 * - `RealLiteral`: `LEFT` = high 32 bits of `f64`, `RIGHT` = low 32 bits of `f64` (or `DATA1` = float pool index).
 * - `BoolLiteral`: `DATA1` = `0` (`false`) or `1` (`true`).
 * - `StringLiteral`: `DATA1` = interned `StringId`.
 * - `Binary`: `DATA1` = `BinOp`, `LEFT` = left operand `ExprId`, `RIGHT` = right operand `ExprId`.
 * - `Unary` / `Negate`: `DATA1` = `UnaryOp`, `LEFT` = operand `ExprId`.
 * - `Call`: `DATA1` = function name `StringId`, `LEFT` = arg list start offset, `RIGHT` = arg count.
 * - `Subscript`: `DATA1` = base `ExprId`, `LEFT` = subscript list start offset, `RIGHT` = subscript count.
 * - `ArrayCtor` / `Tuple`: `LEFT` = element list start offset, `RIGHT` = element count.
 * - `Range`: `DATA1` = start `ExprId`, `LEFT` = step `ExprId` (or `NULL_ID`), `RIGHT` = stop `ExprId`.
 * - `IfElse`: `DATA1` = condition `ExprId`, `LEFT` = then `ExprId`, `RIGHT` = else `ExprId`.
 * - `Der` / `Pre`: `LEFT` = argument `ExprId`, `DATA1` = derivative order (for `Der`).
 * - `EnumLiteral`: `DATA1` = qualified literal `StringId`, `LEFT` = 1-based ordinal index.
 * - `Comprehension`: `DATA1` = body `ExprId`, `LEFT` = iterator variable `StringId`, `RIGHT` = range `ExprId`.
 */
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

/** Binary operator kind stored in `EXPR_DATA1` when `EXPR_KIND == ExprKind.Binary`. */
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

/** Unary operator kind stored in `EXPR_DATA1` when `EXPR_KIND == ExprKind.Unary`. */
export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

/**
 * Discriminator for rows in the DAE algorithm statement table (`STMT_STRIDE = 4`: `[STMT_KIND, STMT_DATA1, STMT_LEFT, STMT_RIGHT]`).
 * - `Assignment`: `DATA1` = target `ExprId` (or `StringId`), `LEFT` = RHS `ExprId`.
 * - `For`: `DATA1` = loop variable `StringId`, `LEFT` = range `ExprId`, `RIGHT` = packed body `(start, count)`.
 * - `While`: `DATA1` = condition `ExprId`, `LEFT` = body start index, `RIGHT` = body statement count.
 * - `If` / `When`: `DATA1` = condition `ExprId`, `LEFT` = then-branch block, `RIGHT` = else/elsewhen link.
 * - `ProcedureCall`: `DATA1` = call `ExprId`.
 * - `ComplexAssignment`: `DATA1` = tuple LHS `ExprId`, `LEFT` = call RHS `ExprId`.
 */
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

/** Column index within each `VAR_ATTR_STRIDE` (10-word) variable attribute row. */
export enum VarAttrKind {
  Min = 0,
  Max = 1,
  Unit = 2,
  DisplayUnit = 3,
  Nominal = 4,
  Start = 5,
  Fixed = 6,
  Binding = 7,
  Quantity = 8,
  Description = 9,
}

/** Fast-path numeric IDs for standard Modelica mathematical intrinsic functions. */
export enum BuiltinMathFunc {
  Sin = 0,
  Cos = 1,
  Tan = 2,
  Asin = 3,
  Acos = 4,
  Atan = 5,
  Atan2 = 6,
  Sinh = 7,
  Cosh = 8,
  Tanh = 9,
  Exp = 10,
  Log = 11,
  Log10 = 12,
  Sqrt = 13,
  Abs = 14,
  Sign = 15,
  Min = 16,
  Max = 17,
  Floor = 18,
  Ceil = 19,
  Fmod = 20,
  Mod = 20,
  Pow = 21,
  NoEvent = 22,
  Smooth = 23,
  Homotopy = 24,
  SemiLinear = 25,
}


