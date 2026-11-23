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
/** Parameter marked with `annotation(Evaluate = true)` or structural evaluation (`1 << 10`). */
export const FLAG_VAR_EVALUATE: i32 = 1 << 10;
/** Variable hidden from standard result output (`HideResult` or internal helper) (`1 << 11`). */
export const FLAG_VAR_HIDDEN: i32 = 1 << 11;
/** Binary decision variable restricted to $\{0, 1\}$ for MILP/MINLP (`1 << 12`). */
export const FLAG_VAR_BINARY: i32 = 1 << 12;

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
/** Equation is a two-point or multi-point boundary condition for a BVP (`1 << 5`). */
export const FLAG_EQ_BOUNDARY: i32 = 1 << 5;

// ─────────────────────────────────────────────────────────────────────────────
// Problem Class Bitmask Flags
// ─────────────────────────────────────────────────────────────────────────────

/** Explicit or implicit ODE system (`1 << 0`). */
export const PROBLEM_ODE: u32 = 1 << 0;
/** Differential-Algebraic Equation system (`1 << 1`). */
export const PROBLEM_DAE: u32 = 1 << 1;
/** Mathematical programming / dynamic optimization / OCP (`1 << 2`). */
export const PROBLEM_OPTIMIZATION: u32 = 1 << 2;
/** Stochastic Differential Equation system (`1 << 3`). */
export const PROBLEM_SDE: u32 = 1 << 3;
/** Delay or Neutral Delay Differential Equation system (`1 << 4`). */
export const PROBLEM_DDE: u32 = 1 << 4;
/** Two-point or multi-point Boundary Value Problem (`1 << 5`). */
export const PROBLEM_BVP: u32 = 1 << 5;
/** Stochastic jump process / chemical kinetics SSA (`1 << 6`). */
export const PROBLEM_JUMP: u32 = 1 << 6;
/** Parametric or initial-state uncertainty distributions/intervals (`1 << 7`). */
export const PROBLEM_UNCERTAIN: u32 = 1 << 7;
/** Formal reachability / STL safety verification specs (`1 << 8`). */
export const PROBLEM_REACHABILITY: u32 = 1 << 8;
/** Hybrid continuous + discrete event / state-machine / jump system (`1 << 9`). */
export const PROBLEM_HYBRID: u32 = 1 << 9;

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
  Boundary = 10,
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
 * - `TensorSlice`: `DATA1` = base `ExprId`, `LEFT` = slice range `ExprId`, `RIGHT` = axis index.
 * - `TensorBroadcast`: `DATA1` = target shape descriptor, `LEFT` = operand `ExprId`, `RIGHT` = axis flags.
 * - `TensorMatMul`: `DATA1` = transposition flags, `LEFT` = lhs `ExprId`, `RIGHT` = rhs `ExprId`.
 * - `TensorReduce`: `DATA1` = `TensorReduceOp`, `LEFT` = operand `ExprId`, `RIGHT` = axis index.
 * - `TensorMap`: `DATA1` = operator ID, `LEFT` = operand `ExprId`, `RIGHT` = aux.
 * - `AtBoundary`: `DATA1` = `varId`, `LEFT` = boundary point index (`0 = t0`, `1 = tf`, `k = interior`).
 * - `Delay`: `DATA1` = delay channel index in `delayData`, `LEFT` = target `ExprId`, `RIGHT` = tau `ExprId`.
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
  TensorSlice = 21,
  TensorBroadcast = 22,
  TensorMatMul = 23,
  TensorReduce = 24,
  TensorMap = 25,
  AtBoundary = 26,
  Delay = 27,
}

/** Reduction operator kind stored in `EXPR_DATA1` when `EXPR_KIND == ExprKind.TensorReduce`. */
export enum TensorReduceOp {
  Sum = 0,
  Product = 1,
  Max = 2,
  Min = 3,
  Mean = 4,
  Norm2 = 5,
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

// ─────────────────────────────────────────────────────────────────────────────
// Execution Block & Linear Bytecode Layout
// ─────────────────────────────────────────────────────────────────────────────

/** Number of i32 words per linear execution block row. */
export const EXEC_BLOCK_STRIDE: u32 = 3;
/** Word offset: block kind (0 = single assign, 1 = system loop, 2 = direct copy, 3 = negated copy). */
export const EXEC_KIND: u32 = 0;
/** Word offset: target variable ID (or StringId). */
export const EXEC_TARGET: u32 = 1;
/** Word offset: expression ID (or source variable ID) to evaluate. */
export const EXEC_EXPR: u32 = 2;

/** Execution block kinds. */
export const EXEC_OP_SINGLE: i32 = 0;
export const EXEC_OP_SYSTEM: i32 = 1;
export const EXEC_OP_DIRECT_COPY: i32 = 2;
export const EXEC_OP_NEG_COPY: i32 = 3;

/** Flat linear bytecode opcodes for simulation kernel. */
export const BC_OP_NAME: i32 = 1;       // [BC_OP_NAME, targetId, srcId]
export const BC_OP_NEG_NAME: i32 = 2;   // [BC_OP_NEG_NAME, targetId, srcId]
export const BC_OP_LIT: i32 = 3;        // [BC_OP_LIT, targetId, litIdx]
export const BC_OP_ADD_NAMES: i32 = 4;  // [BC_OP_ADD_NAMES, targetId, leftId, rightId]
export const BC_OP_SUB_NAMES: i32 = 5;  // [BC_OP_SUB_NAMES, targetId, leftId, rightId]
export const BC_OP_MUL_NAMES: i32 = 6;  // [BC_OP_MUL_NAMES, targetId, leftId, rightId]
export const BC_OP_DIV_NAMES: i32 = 7;  // [BC_OP_DIV_NAMES, targetId, leftId, rightId]
export const BC_OP_EXPR: i32 = 8;       // [BC_OP_EXPR, targetId, exprId]
export const BC_OP_SYSTEM: i32 = 9;     // [BC_OP_SYSTEM, sysBlockIndex]

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Problem Side-Table Layouts & Enums
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Optimization / Math Programming / OCP ──

/** Words per objective row: `[mayerExprId, lagrangeExprId, sense, flags]`. */
export const OBJ_STRIDE: u32 = 4;
export const OBJ_MAYER_EXPR: u32 = 0;
export const OBJ_LAGRANGE_EXPR: u32 = 1;
export const OBJ_SENSE: u32 = 2;
export const OBJ_FLAGS: u32 = 3;

export enum ObjectiveSense {
  Minimize = 0,
  Maximize = 1,
}

export const FLAG_OBJ_MAYER: i32 = 1 << 0;
export const FLAG_OBJ_LAGRANGE: i32 = 1 << 1;

/** Words per constraint row: `[exprId, lbHi, lbLo, ubHi, ubLo, kindAndFlags]`. */
export const CON_STRIDE: u32 = 6;
export const CON_EXPR: u32 = 0;
export const CON_LB_HI: u32 = 1;
export const CON_LB_LO: u32 = 2;
export const CON_UB_HI: u32 = 3;
export const CON_UB_LO: u32 = 4;
export const CON_KIND_FLAGS: u32 = 5;

export enum ConstraintKind {
  Algebraic = 0,
  Path = 1,
  Initial = 2,
  Terminal = 3,
  Complementarity = 4,
  SOC = 5,
  PSD = 6,
}

/** Words per cone/complementarity block row: `[kind, memberStart, memberCount, dim]`. */
export const CONE_STRIDE: u32 = 4;
export const CONE_KIND: u32 = 0;
export const CONE_MEMBER_START: u32 = 1;
export const CONE_MEMBER_COUNT: u32 = 2;
export const CONE_DIM: u32 = 3;

// ── 2. Stochastic Differential Equations (SDE) ──

/** Words per diffusion row: `[stateVarId, noiseChannelId, exprId, flags]`. */
export const DIFF_STRIDE: u32 = 4;
export const DIFF_STATE_VAR: u32 = 0;
export const DIFF_NOISE_CH: u32 = 1;
export const DIFF_EXPR: u32 = 2;
export const DIFF_FLAGS: u32 = 3;

export enum SdeNoiseType {
  Diagonal = 0,
  Scalar = 1,
  Matrix = 2,
}

export enum SdeCalculus {
  Ito = 0,
  Stratonovich = 1,
}

// ── 3. Boundary Value Problems (BVP) ──

export enum BvpMethod {
  Collocation = 0,
  Shooting = 1,
}

// ── 4. Delay Differential Equations (DDE / NDDE) ──

/** Words per delay channel row: `[targetExprId, tauExprId, historyExprId, historyDerivExprId, flags]`. */
export const DELAY_STRIDE: u32 = 5;
export const DELAY_TARGET_EXPR: u32 = 0;
export const DELAY_TAU_EXPR: u32 = 1;
export const DELAY_HISTORY_EXPR: u32 = 2;
export const DELAY_HISTORY_DERIV_EXPR: u32 = 3;
export const DELAY_FLAGS: u32 = 4;

export const FLAG_DELAY_CONSTANT: i32 = 1 << 0;
export const FLAG_DELAY_TIME_DEP: i32 = 1 << 1;
export const FLAG_DELAY_STATE_DEP: i32 = 1 << 2;
export const FLAG_DELAY_NEUTRAL: i32 = 1 << 3;

// ── 5. Jump Processes / Hybrid Kinetics (SSA) ──

/** Words per jump/reaction row: `[propensityExprId, affectStart, affectCount, flags]`. */
export const JUMP_STRIDE: u32 = 4;
export const JUMP_PROPENSITY_EXPR: u32 = 0;
export const JUMP_AFFECT_START: u32 = 1;
export const JUMP_AFFECT_COUNT: u32 = 2;
export const JUMP_FLAGS: u32 = 3;

/** Words per jump affect row: `[targetVarId, deltaExprId, mode]`. */
export const AFFECT_STRIDE: u32 = 3;
export const AFFECT_VAR: u32 = 0;
export const AFFECT_EXPR: u32 = 1;
export const AFFECT_MODE: u32 = 2;

export enum JumpRateKind {
  ConstantRate = 0,
  VariableRate = 1,
  MassAction = 2,
}

export enum JumpAffectMode {
  Additive = 0,
  Assign = 1,
}

// ── 6. Uncertainty, Formal Reachability & STL Verification ──

/** Words per variable uncertainty row: `[varId, distKind, p1Hi, p1Lo, p2Hi, p2Lo]`. */
export const UNC_STRIDE: u32 = 6;
export const UNC_VAR: u32 = 0;
export const UNC_DIST_KIND: u32 = 1;
export const UNC_P1_HI: u32 = 2;
export const UNC_P1_LO: u32 = 3;
export const UNC_P2_HI: u32 = 4;
export const UNC_P2_LO: u32 = 5;

export enum UncertaintyDistKind {
  Interval = 0,
  Uniform = 1,
  Normal = 2,
  LogNormal = 3,
  TruncNormal = 4,
  Discrete = 5,
}

/** Words per STL specification node row: `[op, leftId, rightId, tLoHi, tLoLo, tHiHi, tHiLo, flags]`. */
export const STL_STRIDE: u32 = 8;
export const STL_OP: u32 = 0;
export const STL_LEFT: u32 = 1;
export const STL_RIGHT: u32 = 2;
export const STL_TLO_HI: u32 = 3;
export const STL_TLO_LO: u32 = 4;
export const STL_THI_HI: u32 = 5;
export const STL_THI_LO: u32 = 6;
export const STL_FLAGS: u32 = 7;

export enum StlOp {
  Atomic = 0,
  Not = 1,
  And = 2,
  Or = 3,
  Always = 4,
  Eventually = 5,
  Until = 6,
}

/** Words per hybrid state invariant row: `[stateId, varId, loHi, loLo, hiHi, hiLo]`. */
export const INV_STRIDE: u32 = 6;
export const INV_STATE: u32 = 0;
export const INV_VAR: u32 = 1;
export const INV_LO_HI: u32 = 2;
export const INV_LO_LO: u32 = 3;
export const INV_HI_HI: u32 = 4;
export const INV_HI_LO: u32 = 5;




