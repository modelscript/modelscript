// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core enums, bitmask flags, metadata interfaces, and `IDaeBuilder` contract
 * for the WebAssembly-backed DAE arena.
 */

import type { StringId } from "../../workspace/wasm_string_pool.js";

// ─────────────────────────────────────────────────────────────────────────────
// Enums (stored as small integers in Uint8Array columns)
// ─────────────────────────────────────────────────────────────────────────────

/** Variable type tag. */
export enum VarType {
  Real = 0,
  Integer = 1,
  Boolean = 2,
  String = 3,
  Enumeration = 4,
  Clock = 5,
}

/** Variable variability. */
export enum Variability {
  Continuous = 0,
  Discrete = 1,
  Parameter = 2,
  Constant = 3,
}

/** Variable causality. */
export enum Causality {
  Local = 0,
  Input = 1,
  Output = 2,
}

/** Equation kind tag. */
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

/** Variable attribute kind tag. */
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

// ── State Machine Types ──

/** A transition in an arena state machine. */
export interface ArenaStateMachineTransition {
  /** Name of the source state. */
  fromState: string;
  /** Name of the destination state. */
  toState: string;
  /** ExprId of the transition condition. */
  conditionExprId: number;
  /** If true, transition fires in the same tick as the condition becomes true ("immediate" transition). */
  immediate: boolean;
  /** If true, reset the destination state's variables on entry. */
  reset: boolean;
  /** If true, wait for all sub-state machines in the source state to reach a final state before firing. */
  synchronize: boolean;
  /** Transition priority (lower = higher priority). */
  priority: number;
}

/** A state in an arena state machine. */
export interface ArenaStateMachineState {
  /** State name. */
  name: string;
  /** Per-state equations: target variable StringId → value ExprId. */
  equations: { targetNameId: number; exprId: number; isDerivative: boolean }[];
  /** Per-state variable initializers: variable StringId → initial value. */
  variables: { nameId: number; startValue: number }[];
  /** Nested sub-state machines within this state (for hierarchical SM composition). */
  stateMachines: ArenaStateMachine[];
  /** Indices of variables belonging to this state. */
  varIndices?: number[] | undefined;
  /** Indices of equations internal to this state. */
  eqIndices?: number[] | undefined;
  /** Synthesized multiplexer equations belonging to this state scope. */
  multiplexerEqIndices?: number[] | undefined;
}

/** An arena-native state machine. */
export interface ArenaStateMachine {
  /** State machine name. */
  name: string;
  /** States in this machine. */
  states: ArenaStateMachineState[];
  /** Transitions (sorted by priority). */
  transitions: ArenaStateMachineTransition[];
  /** Name of the initial state. */
  initialState: string;
  /** EqIndex of the initialState call equation. */
  initialStateEqIdx?: number | undefined;
  /** EqIndices of the transition equations belonging to this state machine. */
  transitionEqIndices?: number[] | undefined;
}

// ── Structured Equation Meta Types ──

/**
 * Host-side metadata for a structured `when` equation, storing the primary condition,
 * body equations, and any `elsewhen` or `else` branches.
 */
export interface WhenEquationMeta {
  /** Expression arena ID for the `when` condition. */
  conditionExprId: number;
  /** Equations activated when the primary `when` condition becomes true. */
  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[];
  /** Legacy equation representation for the primary branch. */
  equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
  /** Ordered `elsewhen` branches with their own condition and body equations. */
  elseWhenClauses: {
    /** Expression arena ID for the `elsewhen` condition. */
    conditionExprId: number;
    /** Equations activated when this `elsewhen` condition becomes true. */
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[];
    /** Legacy equation representation for this `elsewhen` branch. */
    equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
  }[];
  /** Optional fallback `else` equations. */
  elseEquations?: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[] | undefined;
}

/**
 * Host-side metadata for an unexpanded `for` loop equation, storing the loop variable,
 * iteration range expression, and body equations.
 */
export interface ForEquationMeta {
  /** Interned `StringId` of the loop iterator variable name. */
  indexNameId: number;
  /** Expression arena ID of the loop range expression. */
  rangeExprId: number;
  /** Equations inside the `for` loop body. */
  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[];
  /** Legacy equation representation for the loop body. */
  equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
}

/**
 * Host-side metadata for a conditional `if` equation, storing the condition,
 * `then` branch equations, `elseif` branches, and optional `else` branch equations.
 */
export interface IfEquationMeta {
  /** Expression arena ID for the primary `if` condition. */
  conditionExprId: number;
  /** Equations active when the primary condition evaluates to true. */
  thenEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[];
  /** Ordered `elseif` branches with their condition and body equations. */
  elseIfClauses: {
    /** Expression arena ID for the `elseif` condition. */
    conditionExprId: number;
    /** Equations active when this `elseif` condition evaluates to true. */
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[];
    /** Legacy equation representation for this `elseif` branch. */
    equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
  }[];
  /** Equations active when all preceding conditions evaluate to false. */
  elseEquations?: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[] | undefined;
  /** Whether a connection query (`Connections.isRoot`, etc.) was resolved in this `if` condition. */
  hasResolvedConnectionQuery?: boolean | undefined;
}

/** Expression kind tag. */
export enum ExprKind {
  /** Variable reference: data1 = StringId of the variable name. */
  Name = 0,
  /** Integer literal: data1 = integer value. */
  IntLiteral = 1,
  /** Real literal: data1 = Float64 bits (high), left = Float64 bits (low). */
  RealLiteral = 2,
  /** Boolean literal: data1 = 0 (false) or 1 (true). */
  BoolLiteral = 3,
  /** String literal: data1 = StringId. */
  StringLiteral = 4,
  /** Binary expression: data1 = BinOp, left = lhs ExprId, right = rhs ExprId. */
  Binary = 5,
  /** Unary expression: data1 = UnaryOp, left = operand ExprId. */
  Unary = 6,
  /** Function call: data1 = StringId of function name, left = first arg ExprId, right = arg count. */
  Call = 7,
  /** Array subscript: data1 = base ExprId, left = index ExprId. */
  Subscript = 8,
  /** Array constructor: data1 = element count, left = first element ExprId. */
  ArrayCtor = 9,
  /** Range expression: data1 = start ExprId, left = step ExprId (or -1), right = stop ExprId. */
  Range = 10,
  /** If-else expression: data1 = condition ExprId, left = then ExprId, right = else ExprId. */
  IfElse = 11,
  /** der(x): data1 = argument ExprId. */
  Der = 12,
  /** pre(x): data1 = argument ExprId. */
  Pre = 13,
  /** Negation (unary minus): left = operand ExprId. */
  Negate = 14,
  /** Tuple expression: data1 = element count, left = first element ExprId. */
  Tuple = 15,
  /** Colon `:` (whole-dimension slice): no data fields used. */
  Colon = 16,
  /** Enumeration literal: data1 = ordinal value, left = StringId of string value. */
  EnumLiteral = 17,
  /** Comprehension/reduction: data1 = StringId of func name, left = body ExprId, right = iterator count. */
  Comprehension = 18,
  /** Partial function application: data1 = StringId of func name, left = arg count. */
  PartialFunc = 19,
  /** Object/record constructor. */
  Object = 20,
  /** Tensor slice: data1 = base ExprId, left = slice range ExprId, right = axis index. */
  TensorSlice = 21,
  /** Tensor broadcast: data1 = target shape info, left = operand ExprId, right = axis flags. */
  TensorBroadcast = 22,
  /** Tensor matrix multiplication: data1 = flags, left = lhs ExprId, right = rhs ExprId. */
  TensorMatMul = 23,
  /** Tensor reduction: data1 = TensorReduceOp, left = operand ExprId, right = axis index. */
  TensorReduce = 24,
  /** Tensor elementwise map: data1 = operator ID, left = operand ExprId, right = aux. */
  TensorMap = 25,
  /** Boundary value reference y(t0) / y(tf): data1 = varId, left = boundaryPointIdx. */
  AtBoundary = 26,
  /** Delay expression delay(target, tau): data1 = delayChannelIdx, left = target ExprId, right = tau ExprId. */
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

/** Binary operator tag. */
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

/** Unary operator tag. */
export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

/** Statement kind tag. */
export enum StmtKind {
  /** Assignment: data1 = target ExprId, left = source ExprId. */
  Assignment = 0,
  /** For loop: data1 = StringId of index name, left = range ExprId, right = body stmt count. */
  For = 1,
  /** While loop: data1 = condition ExprId, left = body stmt count. */
  While = 2,
  /** If statement: data1 = condition ExprId, left = then stmt count, right = elseif+else block count. */
  If = 3,
  /** When statement: data1 = condition ExprId, left = body stmt count, right = elsewhen block count. */
  When = 4,
  /** Return statement. */
  Return = 5,
  /** Break: no data fields used. */
  Break = 6,
  /** Procedure call: data1 = call ExprId. */
  ProcedureCall = 7,
  /** Complex assignment (tuple): data1 = target count, left = source ExprId. */
  ComplexAssignment = 8,
  /** Block marker for if/when branches: data1 = condition ExprId (or -1 for else), left = stmt count. */
  Block = 9,
}

// ─────────────────────────────────────────────────────────────────────────────
// Flags & Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Bitmask flag indicating a variable selected as an algebraic tearing variable. */
export const FLAG_TEARING_VAR = 1 << 0;
/** Bitmask flag indicating a connector `flow` variable. */
export const FLAG_VAR_FLOW = 1 << 1;
/** Bitmask flag indicating a connector `stream` variable. */
export const FLAG_VAR_STREAM = 1 << 2;
/** Bitmask flag indicating a continuous state variable. */
export const FLAG_VAR_STATE = 1 << 3;
/** Bitmask flag indicating a state derivative variable. */
export const FLAG_VAR_STATE_DER = 1 << 4;
/** Bitmask flag indicating a variable with `fixed = true` initial condition. */
export const FLAG_VAR_FIXED = 1 << 5;
/** Bitmask flag indicating a variable eliminated by alias/dead-variable removal. */
export const FLAG_VAR_REMOVED = 1 << 6;
/** Bitmask flag indicating a `protected` variable declaration. */
export const FLAG_VAR_PROTECTED = 1 << 7;
/** Bitmask flag indicating a `final` variable declaration. */
export const FLAG_VAR_FINAL = 1 << 8;
/** Bitmask flag indicating a compiler-synthesized virtual variable. */
export const FLAG_VAR_VIRTUAL = 1 << 9;
/** Bitmask flag indicating a parameter marked with `annotation(Evaluate = true)` or structural evaluation. */
export const FLAG_VAR_EVALUATE = 1 << 10;
/** Bitmask flag indicating a parameter explicitly annotated with `annotation(Evaluate = true)` (MLS §18.3). */
export const FLAG_VAR_EVALUATE_EXPLICIT = 1 << 11;

/** Bitmask flag indicating an `initial equation`. */
export const FLAG_EQ_INITIAL = 1 << 0;
/** Bitmask flag indicating an equation belonging to an overconstrained connection set. */
export const FLAG_EQ_OVERCONSTRAINED = 1 << 1;
/** Bitmask flag indicating a synthesized stream connection equation. */
export const FLAG_EQ_STREAM_CONNECT = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// IDaeBuilder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core builder interface for populating a flat Differential-Algebraic Equation (DAE) arena
 * with variables, equations, expressions, and algorithm statements.
 */
export interface IDaeBuilder {
  /** Adds a variable declaration to the arena and returns its 0-based variable index. */
  addVariable(
    nameId: StringId | string,
    type: VarType,
    variability: Variability,
    causality: Causality,
    startVal?: number,
    flags?: number,
    shapeDim?: number,
  ): number;
  /** Appends an equation to the arena and returns its 0-based equation index. */
  addEquation(kind: EqKind, lhsId: number, rhsId: number, auxId?: number): number;
  /** Appends a raw expression node to the arena and returns its 0-based expression ID. */
  addExpression(kind: ExprKind, data1?: number, left?: number, right?: number): number;
  /** Appends an algorithm statement node to the arena and returns its 0-based statement index. */
  addStatement(kind: StmtKind, data1?: number, left?: number, right?: number): number;
  /** Creates a binary operator expression (`left op right`). */
  addBinaryExpr(op: BinOp, left: number, right: number): number;
  /** Creates a unary operator expression (`op operand`). */
  addUnaryExpr(op: UnaryOp, operand: number): number;
  /** Creates a 64-bit floating-point literal expression. */
  addRealLiteral(value: number): number;
  /** Creates a 32-bit integer literal expression. */
  addIntLiteral(value: number): number;
  /** Creates a boolean literal expression. */
  addBoolLiteral(value: boolean): number;
  /** Creates a string literal expression from a string or interned `StringId`. */
  addStringLiteral(value: string | number): number;
  /** Creates a time-derivative expression `der(varId)`. */
  addDer(varId: number): number;
  /** Creates a variable reference expression by interned name ID. */
  addName(varId: number): number;
  /** Creates a ternary conditional expression `if condExpr then trueExpr else falseExpr`. */
  addIfElse(condExpr: number, trueExpr: number, falseExpr: number): number;
  /** Creates a function call expression. */
  addCall(funcId: number, firstArg: number, argCount: number): number;
  /** Looks up a variable index by name or `StringId`, returning `-1` if not found. */
  lookupVariable(name: string | StringId): number;
  /** Checks whether scalarized array element variables exist for the given base variable path. */
  hasArrayElements?(baseName: string): boolean;
  /** Returns the variable indices of all scalarized elements belonging to `baseName`. */
  getArrayElementIndices?(baseName: string): number[];
  /** Releases underlying WebAssembly linear memory allocations for this builder. */
  free?(): void;
  /** Returns the total number of variables in the arena. */
  getVarCount(): number;
  /** Returns the total number of equations in the arena. */
  getEqCount(): number;
  /** Returns the total number of expression nodes in the arena. */
  getExprCount(): number;
  /** Returns the total number of statement nodes in the arena. */
  getStmtCount(): number;
  /** Saves a rollback snapshot of current arena counts. */
  snapshot(): void;
  /** Restores arena counts to the most recently saved snapshot. */
  rollback(): void;
}

export interface DaeDiagnosticRange {
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startLine?: number | undefined;
  startColumn?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  file?: string | undefined;
  uri?: string | undefined;
}

export interface DaeDiagnostic {
  severity: "error" | "warning" | "info" | "hint" | string;
  message: string;
  code?: number | string | undefined;
  rule?: string | undefined;
  range?: DaeDiagnosticRange | null | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  file?: string | undefined;
  uri?: string | undefined;
}

export interface EnumLiteralDescriptor {
  stringValue: string;
  name?: string | undefined;
  comment?: string | undefined;
}

/**
 * Options controlling type assignability rules in {@link isAssignableType}.
 */
export interface AssignableTypeOptions {
  /** If true, permits implicit conversion from `Integer` to `Enumeration`. */
  intEnumConversion?: boolean | undefined;
}
