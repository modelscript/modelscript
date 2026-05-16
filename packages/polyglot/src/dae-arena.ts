// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * DAEArenaBuilder — Flat, arena-backed storage for flattened DAE data.
 *
 * During flattening, the compiler currently builds a tree of heavyweight
 * objects (`ModelicaDAE`, `ModelicaRealVariable`, `ModelicaSimpleEquation`,
 * etc.) which consumes ~1.5 GB for a 10k-equation model.
 *
 * This module provides an append-only, TypedArray-backed builder that
 * stores the same data in ~5% of the memory. The flattener appends flat
 * records into typed columns, and the downstream consumers (simulator,
 * code generators) read from those columns via Flyweight views.
 *
 * ## Usage
 *
 * ```typescript
 * const builder = new DAEArenaBuilder(interner);
 *
 * // Flattener appends variables
 * builder.addVariable("resistor1.R", VarType.Real, Variability.Parameter, Causality.Local, 100.0);
 * builder.addVariable("resistor1.v", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
 *
 * // Flattener appends equations
 * const lhsId = builder.addExpression(ExprKind.Name, nameStringId, 0, 0);
 * const rhsId = builder.addExpression(ExprKind.RealLiteral, 0, realBits, 0);
 * builder.addEquation(EqKind.Simple, lhsId, rhsId);
 *
 * // Read back
 * console.log(builder.varCount);        // 2
 * console.log(builder.eqCount);         // 1
 * console.log(builder.estimateMemoryBytes()); // ~200 bytes
 * ```
 *
 * ## Dual-Write Strategy
 *
 * During the migration, the flattener populates BOTH the legacy
 * `ModelicaDAE` object and this arena. Tests validate equivalence.
 * Once all tests pass, the legacy path is removed.
 */

import type { StringId } from "./interner.js";
import { StringInterner } from "./interner.js";

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
  /** Object/record constructor: data1 = field count, left = first field ExprId. */
  Object = 20,
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
}

/** Unary operator tag. */
export enum UnaryOp {
  Negate = 0,
  Not = 1,
}

// ─────────────────────────────────────────────────────────────────────────────
// Column Indices
// ─────────────────────────────────────────────────────────────────────────────

/** Variable record stride (number of Int32 fields per variable). */
const VAR_STRIDE = 8;

// Variable field offsets
const VAR_NAME = 0; // StringId
const VAR_TYPE = 1; // VarType
const VAR_VARIABILITY = 2; // Variability
const VAR_CAUSALITY = 3; // Causality
const VAR_START_HI = 4; // Float64 start value (high 32 bits)
const VAR_START_LO = 5; // Float64 start value (low 32 bits)
const VAR_SHAPE_DIM = 6; // Number of array dimensions (0 = scalar)
const VAR_FLAGS = 7; // Bit flags: isProtected(0), isState(1), isAlias(2), isFlow(3), isFinal(4), isRemoved(5)

/** Equation record stride. */
const EQ_STRIDE = 4;

// Equation field offsets
const EQ_KIND = 0; // EqKind
const EQ_LHS = 1; // ExprId (index into expression arena)
const EQ_RHS = 2; // ExprId
const EQ_AUX = 3; // Auxiliary data (e.g., for-loop range ExprId)

/** Expression record stride. */
const EXPR_STRIDE = 4;

// Expression field offsets
const EXPR_KIND = 0; // ExprKind
const EXPR_DATA1 = 1; // Kind-specific data
const EXPR_LEFT = 2; // Left child ExprId (or -1)
const EXPR_RIGHT = 3; // Right child ExprId (or -1)

// ─────────────────────────────────────────────────────────────────────────────
// DAEArenaBuilder
// ─────────────────────────────────────────────────────────────────────────────

/** Default capacity for each arena segment. */
const DEFAULT_VAR_CAP = 512;
const DEFAULT_EQ_CAP = 1024;
const DEFAULT_EXPR_CAP = 4096;

export class DAEArenaBuilder {
  // ── Variable arena ──
  private varData: Int32Array;
  private _varCount = 0;

  // ── Equation arena ──
  private eqData: Int32Array;
  private _eqCount = 0;

  // ── Expression arena ──
  private exprData: Int32Array;
  private _exprCount = 0;

  // ── Metadata ──
  readonly interner: StringInterner;

  /** DAE name (e.g., the fully-qualified class name). */
  nameId: StringId;
  /** DAE description string. */
  descriptionId: StringId;

  // ── Side stores for variable-length data ──

  /** Array dimensions per variable: varIndex → dimensions array. */
  private shapesMap = new Map<number, number[]>();
  /** Alias targets: varIndex → target variable name StringId. */
  private aliasMap = new Map<number, StringId>();

  // ── Sparse AST Side-Tables (for lossy attributes) ──
  private varDescriptions = new Map<number, string>();
  private varCustomTypes = new Map<number, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private varFunctionTypes = new Map<number, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private varEnumerationLiterals = new Map<number, any[]>();
  private varFlowPrefixes = new Map<number, string>();
  private varCadAnnotations = new Map<number, string>();
  private varExpressions = new Map<number, unknown>();
  /** Start attribute expression per variable (for initialization). */
  private varStartAttrs = new Map<number, unknown>();
  /** Whether each variable has `fixed=true` (for consistent initialization). */
  private varFixedFlags = new Set<number>();

  constructor(interner?: StringInterner, name = "", description = "") {
    this.interner = interner ?? new StringInterner();
    this.nameId = this.interner.intern(name);
    this.descriptionId = this.interner.intern(description);

    this.varData = new Int32Array(DEFAULT_VAR_CAP * VAR_STRIDE);
    this.eqData = new Int32Array(DEFAULT_EQ_CAP * EQ_STRIDE);
    this.exprData = new Int32Array(DEFAULT_EXPR_CAP * EXPR_STRIDE);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Variable API
  // ─────────────────────────────────────────────────────────────────────────

  /** Number of variables stored. */
  get varCount(): number {
    return this._varCount;
  }

  /**
   * Add a variable to the DAE.
   *
   * @param name - Variable name (will be interned).
   * @param type - Variable type (Real, Integer, Boolean, String).
   * @param variability - Variability (continuous, discrete, parameter, constant).
   * @param causality - Causality (local, input, output).
   * @param startValue - Start value (default 0.0).
   * @param flags - Bit flags (isProtected, isState, isAlias, isFlow).
   * @returns The variable index.
   */
  addVariable(
    name: string,
    type: VarType = VarType.Real,
    variability: Variability = Variability.Continuous,
    causality: Causality = Causality.Local,
    startValue = 0.0,
    flags = 0,
  ): number {
    const idx = this._varCount++;
    const offset = idx * VAR_STRIDE;

    // Grow if needed
    while (offset + VAR_STRIDE > this.varData.length) {
      this.varData = growInt32(this.varData);
    }

    this.varData[offset + VAR_NAME] = this.interner.intern(name);
    this.varData[offset + VAR_TYPE] = type;
    this.varData[offset + VAR_VARIABILITY] = variability;
    this.varData[offset + VAR_CAUSALITY] = causality;
    this.varData[offset + VAR_FLAGS] = flags;

    // Store Float64 start value as two Int32s
    FLOAT64_VIEW[0] = startValue;
    this.varData[offset + VAR_START_HI] = INT32_VIEW[0]!;
    this.varData[offset + VAR_START_LO] = INT32_VIEW[1]!;

    this.varData[offset + VAR_SHAPE_DIM] = 0;

    return idx;
  }

  // ── Variable field readers ──

  getVarName(idx: number): string {
    return this.interner.resolve(this.varData[idx * VAR_STRIDE + VAR_NAME]!);
  }

  getVarNameId(idx: number): StringId {
    return this.varData[idx * VAR_STRIDE + VAR_NAME]!;
  }

  getVarType(idx: number): VarType {
    return this.varData[idx * VAR_STRIDE + VAR_TYPE]! as VarType;
  }

  getVarVariability(idx: number): Variability {
    return this.varData[idx * VAR_STRIDE + VAR_VARIABILITY]! as Variability;
  }

  getVarCausality(idx: number): Causality {
    return this.varData[idx * VAR_STRIDE + VAR_CAUSALITY]! as Causality;
  }

  getVarStartValue(idx: number): number {
    const offset = idx * VAR_STRIDE;
    INT32_VIEW[0] = this.varData[offset + VAR_START_HI]!;
    INT32_VIEW[1] = this.varData[offset + VAR_START_LO]!;
    return FLOAT64_VIEW[0]!;
  }

  getVarFlags(idx: number): number {
    return this.varData[idx * VAR_STRIDE + VAR_FLAGS]!;
  }

  isVarProtected(idx: number): boolean {
    return (this.getVarFlags(idx) & 1) !== 0;
  }

  isVarState(idx: number): boolean {
    return (this.getVarFlags(idx) & 2) !== 0;
  }

  isVarAlias(idx: number): boolean {
    return (this.getVarFlags(idx) & 4) !== 0;
  }

  isVarFlow(idx: number): boolean {
    return (this.getVarFlags(idx) & 8) !== 0;
  }

  isVarFinal(idx: number): boolean {
    return (this.getVarFlags(idx) & 16) !== 0;
  }

  isVarRemoved(idx: number): boolean {
    return (this.getVarFlags(idx) & 32) !== 0;
  }

  setVarRemoved(idx: number): void {
    const offset = idx * VAR_STRIDE + VAR_FLAGS;
    this.varData[offset] = this.varData[offset]! | 32;
  }

  /** Set array dimensions for a variable. */
  setVarShape(idx: number, dims: number[]): void {
    this.varData[idx * VAR_STRIDE + VAR_SHAPE_DIM] = dims.length;
    if (dims.length > 0) this.shapesMap.set(idx, dims);
  }

  getVarShape(idx: number): number[] {
    return this.shapesMap.get(idx) ?? [];
  }

  /** Mark a variable as an alias of another. */
  setVarAlias(idx: number, targetName: string): void {
    // Set alias flag
    const offset = idx * VAR_STRIDE + VAR_FLAGS;
    this.varData[offset] = this.varData[offset]! | 4;
    this.aliasMap.set(idx, this.interner.intern(targetName));
  }

  getVarAliasTarget(idx: number): string | null {
    const id = this.aliasMap.get(idx);
    return id !== undefined ? this.interner.resolve(id) : null;
  }

  // ── Sparse Attribute Accessors ──

  getVarDescription(idx: number): string | undefined {
    return this.varDescriptions.get(idx);
  }
  setVarDescription(idx: number, description: string): void {
    this.varDescriptions.set(idx, description);
  }

  getVarCustomType(idx: number): string | undefined {
    return this.varCustomTypes.get(idx);
  }
  setVarCustomType(idx: number, customType: string): void {
    this.varCustomTypes.set(idx, customType);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVarFunctionType(idx: number): any | undefined {
    return this.varFunctionTypes.get(idx);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setVarFunctionType(idx: number, functionType: any): void {
    this.varFunctionTypes.set(idx, functionType);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVarEnumerationLiterals(idx: number): any[] | undefined {
    return this.varEnumerationLiterals.get(idx);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setVarEnumerationLiterals(idx: number, literals: any[]): void {
    this.varEnumerationLiterals.set(idx, literals);
  }

  getVarFlowPrefix(idx: number): string | undefined {
    return this.varFlowPrefixes.get(idx);
  }
  setVarFlowPrefix(idx: number, prefix: string): void {
    this.varFlowPrefixes.set(idx, prefix);
  }

  getVarCadAnnotation(idx: number): string | undefined {
    return this.varCadAnnotations.get(idx);
  }
  setVarCadAnnotation(idx: number, annotation: string): void {
    this.varCadAnnotations.set(idx, annotation);
  }

  setVarExpression(idx: number, expr: unknown): void {
    this.varExpressions.set(idx, expr);
  }

  getVarExpression(idx: number): unknown | undefined {
    return this.varExpressions.get(idx);
  }

  /** Store the `start` attribute expression for a variable. */
  setVarStartAttr(idx: number, expr: unknown): void {
    this.varStartAttrs.set(idx, expr);
  }

  /** Get the `start` attribute expression for a variable. */
  getVarStartAttr(idx: number): unknown | undefined {
    return this.varStartAttrs.get(idx);
  }

  /** Mark a variable as `fixed=true`. */
  setVarFixed(idx: number): void {
    this.varFixedFlags.add(idx);
  }

  /** Check if a variable has `fixed=true`. */
  isVarFixed(idx: number): boolean {
    return this.varFixedFlags.has(idx);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Equation API
  // ─────────────────────────────────────────────────────────────────────────

  /** Number of equations stored. */
  get eqCount(): number {
    return this._eqCount;
  }

  /**
   * Add an equation to the DAE.
   *
   * @param kind - Equation kind (Simple, Array, For, If, When, etc.).
   * @param lhsExprId - Expression ID for the left-hand side.
   * @param rhsExprId - Expression ID for the right-hand side.
   * @param aux - Auxiliary data (e.g., for-loop iterator range).
   * @returns The equation index.
   */
  addEquation(kind: EqKind, lhsExprId: number, rhsExprId: number, aux = -1): number {
    const idx = this._eqCount++;
    const offset = idx * EQ_STRIDE;

    while (offset + EQ_STRIDE > this.eqData.length) {
      this.eqData = growInt32(this.eqData);
    }

    this.eqData[offset + EQ_KIND] = kind;
    this.eqData[offset + EQ_LHS] = lhsExprId;
    this.eqData[offset + EQ_RHS] = rhsExprId;
    this.eqData[offset + EQ_AUX] = aux;

    return idx;
  }

  // ── Equation field readers ──

  getEqKind(idx: number): EqKind {
    return this.eqData[idx * EQ_STRIDE + EQ_KIND]! as EqKind;
  }

  getEqLhs(idx: number): number {
    return this.eqData[idx * EQ_STRIDE + EQ_LHS]!;
  }

  getEqRhs(idx: number): number {
    return this.eqData[idx * EQ_STRIDE + EQ_RHS]!;
  }

  getEqAux(idx: number): number {
    return this.eqData[idx * EQ_STRIDE + EQ_AUX]!;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Expression API
  // ─────────────────────────────────────────────────────────────────────────

  /** Number of expressions stored. */
  get exprCount(): number {
    return this._exprCount;
  }

  /**
   * Add an expression node to the arena.
   *
   * @param kind - Expression kind.
   * @param data1 - Kind-specific data (StringId, operator enum, etc.).
   * @param left - Left child ExprId (or -1).
   * @param right - Right child ExprId (or -1).
   * @returns The expression index (ExprId).
   */
  addExpression(kind: ExprKind, data1 = 0, left = -1, right = -1): number {
    const idx = this._exprCount++;
    const offset = idx * EXPR_STRIDE;

    while (offset + EXPR_STRIDE > this.exprData.length) {
      this.exprData = growInt32(this.exprData);
    }

    this.exprData[offset + EXPR_KIND] = kind;
    this.exprData[offset + EXPR_DATA1] = data1;
    this.exprData[offset + EXPR_LEFT] = left;
    this.exprData[offset + EXPR_RIGHT] = right;

    return idx;
  }

  /** Add a name (variable reference) expression. */
  addNameExpr(name: string): number {
    return this.addExpression(ExprKind.Name, this.interner.intern(name));
  }

  /** Add an integer literal expression. */
  addIntLiteral(value: number): number {
    return this.addExpression(ExprKind.IntLiteral, value);
  }

  /** Add a real literal expression. */
  addRealLiteral(value: number): number {
    FLOAT64_VIEW[0] = value;
    return this.addExpression(ExprKind.RealLiteral, INT32_VIEW[0]!, INT32_VIEW[1]!);
  }

  /** Add a boolean literal expression. */
  addBoolLiteral(value: boolean): number {
    return this.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }

  /** Add a string literal expression. */
  addStringLiteral(value: string): number {
    return this.addExpression(ExprKind.StringLiteral, this.interner.intern(value));
  }

  /** Add a binary expression. */
  addBinaryExpr(op: BinOp, lhs: number, rhs: number): number {
    return this.addExpression(ExprKind.Binary, op, lhs, rhs);
  }

  /** Add a unary expression. */
  addUnaryExpr(op: UnaryOp, operand: number): number {
    return this.addExpression(ExprKind.Unary, op, operand);
  }

  /** Add a function call expression. */
  addCallExpr(funcName: string, args: number[]): number {
    // Chain arguments: first arg in left, count in right
    // Additional args are stored as linked expressions (Binary chains)
    const funcNameId = this.interner.intern(funcName);
    const firstArg = args.length > 0 ? args[0]! : -1;
    const callId = this.addExpression(ExprKind.Call, funcNameId, firstArg, args.length);

    // For >1 arguments, store them as a linked list of aux expressions
    // (The simulator/codegen can read the argCount and collect them)
    for (let i = 1; i < args.length; i++) {
      // Store as ExprKind.Tuple elements that follow the call
      this.addExpression(ExprKind.Tuple, i, args[i]!);
    }

    return callId;
  }

  /** Add a der(x) expression. */
  addDerExpr(argExprId: number): number {
    return this.addExpression(ExprKind.Der, argExprId);
  }

  /** Add a pre(x) expression. */
  addPreExpr(argExprId: number): number {
    return this.addExpression(ExprKind.Pre, argExprId);
  }

  /** Add an if-else expression. */
  addIfElseExpr(condId: number, thenId: number, elseId: number): number {
    return this.addExpression(ExprKind.IfElse, condId, thenId, elseId);
  }

  /** Add a range expression (start:step:stop or start:stop). */
  addRangeExpr(startId: number, stopId: number, stepId = -1): number {
    return this.addExpression(ExprKind.Range, startId, stepId, stopId);
  }

  /** Add an array constructor. Elements are stored as consecutive Tuple entries. */
  addArrayCtorExpr(elementIds: number[]): number {
    const firstElem = elementIds.length > 0 ? elementIds[0]! : -1;
    const ctorId = this.addExpression(ExprKind.ArrayCtor, elementIds.length, firstElem);
    for (let i = 1; i < elementIds.length; i++) {
      this.addExpression(ExprKind.Tuple, i, elementIds[i]!);
    }
    return ctorId;
  }

  /** Add a subscripted expression (base[subscripts]). */
  addSubscriptExpr(baseId: number, indexIds: number[]): number {
    // For multi-subscript, chain: first subscript in left, rest as Tuple entries
    const firstIdx = indexIds.length > 0 ? indexIds[0]! : -1;
    const subId = this.addExpression(ExprKind.Subscript, baseId, firstIdx, indexIds.length);
    for (let i = 1; i < indexIds.length; i++) {
      this.addExpression(ExprKind.Tuple, i, indexIds[i]!);
    }
    return subId;
  }

  /** Add a tuple expression. */
  addTupleExpr(elementIds: number[]): number {
    const firstElem = elementIds.length > 0 ? elementIds[0]! : -1;
    const tupleId = this.addExpression(ExprKind.Tuple, elementIds.length, firstElem);
    for (let i = 1; i < elementIds.length; i++) {
      this.addExpression(ExprKind.Tuple, i, elementIds[i]!);
    }
    return tupleId;
  }

  /** Add a colon `:` expression (whole-dimension slice). */
  addColonExpr(): number {
    return this.addExpression(ExprKind.Colon);
  }

  /** Add an enumeration literal. */
  addEnumLiteral(ordinal: number, stringValue: string): number {
    return this.addExpression(ExprKind.EnumLiteral, ordinal, this.interner.intern(stringValue));
  }

  /** Add a comprehension/reduction expression (e.g., sum(expr for i in range)). */
  addComprehensionExpr(funcName: string, bodyId: number, iteratorCount: number): number {
    return this.addExpression(ExprKind.Comprehension, this.interner.intern(funcName), bodyId, iteratorCount);
  }

  /** Add a partial function application expression. */
  addPartialFuncExpr(funcName: string, argIds: number[]): number {
    const firstArg = argIds.length > 0 ? argIds[0]! : -1;
    const id = this.addExpression(ExprKind.PartialFunc, this.interner.intern(funcName), firstArg, argIds.length);
    for (let i = 1; i < argIds.length; i++) {
      this.addExpression(ExprKind.Tuple, i, argIds[i]!);
    }
    return id;
  }

  // ── Expression field readers ──

  getExprKind(idx: number): ExprKind {
    return this.exprData[idx * EXPR_STRIDE + EXPR_KIND]! as ExprKind;
  }

  getExprData1(idx: number): number {
    return this.exprData[idx * EXPR_STRIDE + EXPR_DATA1]!;
  }

  getExprLeft(idx: number): number {
    return this.exprData[idx * EXPR_STRIDE + EXPR_LEFT]!;
  }

  getExprRight(idx: number): number {
    return this.exprData[idx * EXPR_STRIDE + EXPR_RIGHT]!;
  }

  /** Read a real literal value from an expression. */
  getExprRealValue(idx: number): number {
    INT32_VIEW[0] = this.exprData[idx * EXPR_STRIDE + EXPR_DATA1]!;
    INT32_VIEW[1] = this.exprData[idx * EXPR_STRIDE + EXPR_LEFT]!;
    return FLOAT64_VIEW[0]!;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Management
  // ─────────────────────────────────────────────────────────────────────────

  /** Reset all arenas (clear data, keep buffers). */
  clear(): void {
    this._varCount = 0;
    this._eqCount = 0;
    this._exprCount = 0;
    this.shapesMap.clear();
    this.aliasMap.clear();
    this.varStartAttrs.clear();
    this.varFixedFlags.clear();
  }

  /** Release all buffers for GC. */
  release(): void {
    this.clear();
    this.varData = new Int32Array(0);
    this.eqData = new Int32Array(0);
    this.exprData = new Int32Array(0);
  }

  /** Estimate total memory usage in bytes. */
  estimateMemoryBytes(): number {
    return (
      this.varData.byteLength +
      this.eqData.byteLength +
      this.exprData.byteLength +
      this.shapesMap.size * 80 +
      this.aliasMap.size * 40 +
      this.interner.estimateMemoryBytes()
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk Access (for WASM codegen / simulator)
  // ─────────────────────────────────────────────────────────────────────────

  /** View of variable data up to current count. */
  varView(): Int32Array {
    return this.varData.subarray(0, this._varCount * VAR_STRIDE);
  }

  /** View of equation data up to current count. */
  eqView(): Int32Array {
    return this.eqData.subarray(0, this._eqCount * EQ_STRIDE);
  }

  /** View of expression data up to current count. */
  exprView(): Int32Array {
    return this.exprData.subarray(0, this._exprCount * EXPR_STRIDE);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function growInt32(old: Int32Array): Int32Array {
  const newArr = new Int32Array(Math.max(old.length * 2, 64));
  newArr.set(old);
  return newArr;
}

/** Shared buffer for Float64↔Int32 reinterpretation. */
const SHARED_BUFFER = new ArrayBuffer(8);
const FLOAT64_VIEW = new Float64Array(SHARED_BUFFER);
const INT32_VIEW = new Int32Array(SHARED_BUFFER);
