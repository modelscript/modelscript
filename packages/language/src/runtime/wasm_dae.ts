// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * DAEBuilder / WasmDaeBridge — Flat, arena-backed storage for flattened DAE data.
 *
 * Implements `IDaeBuilder` backed by the zero-GC WebAssembly `DaeBuilder` runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StringId } from "../compiler/interner.js";
import { StringInterner } from "../compiler/interner.js";
import type { SourceLocation } from "../compiler/modelica-types.js";

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

/** Variable attribute kind tag. */
export enum VarAttrKind {
  Min = 0,
  Max = 1,
  Unit = 2,
  DisplayUnit = 3,
  Nominal = 4,
  Start = 5,
  Fixed = 6,
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
}

// ── Structured Equation Meta Types ──

export interface WhenEquationMeta {
  conditionExprId: number;
  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
  equations: { kind: EqKind; lhs: number; rhs: number; aux?: number }[];
  elseWhenClauses: {
    conditionExprId: number;
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
    equations: { kind: EqKind; lhs: number; rhs: number; aux?: number }[];
  }[];
  elseEquations?: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
}

export interface ForEquationMeta {
  indexNameId: number;
  rangeExprId: number;
  bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
  equations: { kind: EqKind; lhs: number; rhs: number; aux?: number }[];
}

export interface IfEquationMeta {
  conditionExprId: number;
  thenEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
  elseIfClauses: {
    conditionExprId: number;
    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
    equations: { kind: EqKind; lhs: number; rhs: number; aux?: number }[];
  }[];
  elseEquations?: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number }[];
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

export const FLAG_TEARING_VAR = 1 << 0;
export const FLAG_VAR_FLOW = 1 << 1;
export const FLAG_VAR_STREAM = 1 << 2;
export const FLAG_VAR_STATE = 1 << 3;
export const FLAG_VAR_STATE_DER = 1 << 4;
export const FLAG_VAR_FIXED = 1 << 5;
export const FLAG_VAR_REMOVED = 1 << 6;
export const FLAG_VAR_PROTECTED = 1 << 7;
export const FLAG_VAR_FINAL = 1 << 8;

export const FLAG_EQ_INITIAL = 1 << 0;
export const FLAG_EQ_OVERCONSTRAINED = 1 << 1;
export const FLAG_EQ_STREAM_CONNECT = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// WASM Singleton Loader
// ─────────────────────────────────────────────────────────────────────────────

let cachedWasmExports: any = null;

export function setCachedWasmExports(exports: any): void {
  cachedWasmExports = exports;
}

export function getDefaultWasmExports(): any {
  if (cachedWasmExports) return cachedWasmExports;
  if (typeof process !== "undefined" && process.versions?.node != null) {
    try {
      const candidate1 = join(import.meta.dirname, "..", "build", "release.wasm");
      const candidate2 = join(import.meta.dirname, "..", "..", "build", "release.wasm");
      const wasmPath = existsSync(candidate1) ? candidate1 : existsSync(candidate2) ? candidate2 : null;
      if (wasmPath) {
        const bytes = readFileSync(wasmPath);
        const mod = new WebAssembly.Module(bytes);
        const inst = new WebAssembly.Instance(mod, {
          env: {
            abort: () => {
              /* empty */
            },
          },
        });
        cachedWasmExports = inst.exports;
        return cachedWasmExports;
      }
    } catch {
      // Fallback
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// IDaeBuilder
// ─────────────────────────────────────────────────────────────────────────────

export interface IDaeBuilder {
  addVariable(
    nameId: StringId | string,
    type: VarType,
    variability: Variability,
    causality: Causality,
    startVal?: number,
    flags?: number,
    shapeDim?: number,
  ): number;
  addEquation(kind: EqKind, lhsId: number, rhsId: number, auxId?: number): number;
  addExpression(kind: ExprKind, data1?: number, left?: number, right?: number): number;
  addStatement(kind: StmtKind, data1?: number, left?: number, right?: number): number;
  addBinaryExpr(op: BinOp, left: number, right: number): number;
  addUnaryExpr(op: UnaryOp, operand: number): number;
  addRealLiteral(value: number): number;
  addIntLiteral(value: number): number;
  addBoolLiteral(value: boolean): number;
  addStringLiteral(value: string | number): number;
  addDer(varId: number): number;
  addName(varId: number): number;
  addIfElse(condExpr: number, trueExpr: number, falseExpr: number): number;
  addCall(funcId: number, firstArg: number, argCount: number): number;
  lookupVariable(name: string | StringId): number;
  getVarCount(): number;
  getEqCount(): number;
  getExprCount(): number;
  getStmtCount(): number;
  snapshot(): void;
  rollback(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// WasmDaeBridge / DAEBuilder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Universal DAE Builder backed directly by WebAssembly `DaeBuilder` in linear memory.
 */
export class WasmDaeBridge implements IDaeBuilder {
  public readonly exports: any;
  public ptr = 0;
  readonly interner: StringInterner;

  nameId: StringId = 0;
  descriptionId: StringId = 0;

  classKind = "class";
  isImpure = false;
  externalDecl: string | null = null;
  jsSource?: string;
  jsPath?: string;

  objectiveExprId: number = -1;
  objectiveIntegrandExprId: number = -1;
  startTimeExprId: number = -1;
  finalTimeExprId: number = -1;
  externalIncludes: string[] = [];
  externalObjects: {
    name: string;
    type?: string;
    className?: string;
    constructorName?: string;
    destructorName?: string;
  }[] = [];
  equationAnnotations: string[] = [];
  algorithmAnnotations: string[] = [];
  eventIndicatorExprIds: number[] = [];
  diagnostics: any[] = [];

  groupEquationsForParity(): void {}

  experiment: {
    startTime?: number;
    stopTime?: number;
    tolerance?: number;
    interval?: number;
    __modelscript_equidistantOutput?: boolean;
  } = {};

  public functions = new Map<string | number, WasmDaeBridge>();
  public _algorithmSections: { start: number; count: number }[] = [];
  public _initialAlgorithmSections: { start: number; count: number }[] = [];
  public stmtLocations = new Map<number, SourceLocation>();
  public boundaryNodes: any[] = [];

  // Host-side maps for metadata and structured equations
  private varShapes = new Map<number, number[]>();
  private varShapeExprs = new Map<number, number[]>();
  private varAttrs = new Map<number, Map<string, number>>();
  private varExpressions = new Map<number, number>();
  private varDescriptions = new Map<number, string>();
  private varCadAnnotations = new Map<number, any>();
  private varCustomTypes = new Map<number, string>();
  private varEnumLiterals = new Map<number, any[]>();
  private whenMeta = new Map<number, WhenEquationMeta>();
  private forMeta = new Map<number, ForEquationMeta>();
  private ifMeta = new Map<number, IfEquationMeta>();
  public stateMachines: ArenaStateMachine[] = [];

  constructor(wasmExportsOrInterner?: any, nameOrPtr: string | number = "Model", desc = "", interner?: StringInterner) {
    if (
      typeof wasmExportsOrInterner === "object" &&
      wasmExportsOrInterner !== null &&
      !("intern" in wasmExportsOrInterner) &&
      ("dae_createBuilder" in wasmExportsOrInterner || "memory" in wasmExportsOrInterner)
    ) {
      this.exports = wasmExportsOrInterner;
      this.ptr =
        typeof nameOrPtr === "number" && nameOrPtr !== 0
          ? nameOrPtr
          : this.exports.dae_createBuilder
            ? this.exports.dae_createBuilder()
            : 0;
      this.interner = interner ?? new StringInterner();
      this.nameId = this.interner.intern(typeof nameOrPtr === "string" ? nameOrPtr : "Model");
      this.descriptionId = this.interner.intern(desc);
    } else {
      this.interner =
        wasmExportsOrInterner instanceof StringInterner ? wasmExportsOrInterner : (interner ?? new StringInterner());
      this.exports = getDefaultWasmExports();
      this.ptr =
        typeof nameOrPtr === "number" && nameOrPtr !== 0
          ? nameOrPtr
          : this.exports?.dae_createBuilder
            ? this.exports.dae_createBuilder()
            : 0;
      const nameStr = typeof nameOrPtr === "string" ? nameOrPtr : "Model";
      this.nameId = this.interner.intern(nameStr);
      this.descriptionId = this.interner.intern(desc);
    }
  }

  get name(): string {
    return this.interner.resolve(this.nameId) ?? "Model";
  }
  set name(value: string) {
    this.nameId = this.interner.intern(value);
  }

  get description(): string {
    return this.interner.resolve(this.descriptionId) ?? "";
  }
  set description(value: string) {
    this.descriptionId = this.interner.intern(value);
  }

  get varCount(): number {
    return this.getVarCount();
  }

  get eqCount(): number {
    return this.getEqCount();
  }

  get exprCount(): number {
    return this.getExprCount();
  }

  get stmtCount(): number {
    return this.getStmtCount();
  }

  get algorithmSections(): { start: number; count: number }[] {
    return this._algorithmSections;
  }

  get initialAlgorithmSections(): { start: number; count: number }[] {
    return this._initialAlgorithmSections;
  }

  addAlgorithmSection(startIdx: number, count: number): void {
    this._algorithmSections.push({ start: startIdx, count });
  }

  addInitialAlgorithmSection(startIdx: number, count: number): void {
    this._initialAlgorithmSections.push({ start: startIdx, count });
  }

  setStmtLocation(stmtIdx: number, location: SourceLocation): void {
    this.stmtLocations.set(stmtIdx, location);
  }

  addFunction(nameOrId: string | number, funcDae: WasmDaeBridge): void {
    this.functions.set(nameOrId, funcDae);
    if (typeof nameOrId === "string") {
      const id = this.interner.intern(nameOrId);
      this.functions.set(id, funcDae);
    }
  }

  getFunction(nameOrId: string | number): WasmDaeBridge | undefined {
    let fn = this.functions.get(nameOrId);
    if (!fn && typeof nameOrId === "number") {
      const resolved = this.interner.resolve(nameOrId);
      if (resolved) fn = this.functions.get(resolved);
    } else if (!fn && typeof nameOrId === "string") {
      const id = this.interner.lookup(nameOrId);
      if (id !== undefined) fn = this.functions.get(id);
    }
    return fn;
  }

  // ── Variable Operations ──

  addVariable(
    nameIdOrString: StringId | string,
    type: VarType = VarType.Real,
    variability: Variability = Variability.Continuous,
    causality: Causality = Causality.Local,
    startVal = 0.0,
    flags = 0,
    shapeDim = 0,
  ): number {
    const nameId = typeof nameIdOrString === "string" ? this.interner.intern(nameIdOrString) : nameIdOrString;
    if (this.exports?.dae_addVariable) {
      const idx = this.exports.dae_addVariable(this.ptr, nameId, type, variability, causality, startVal, flags);
      if (shapeDim > 0) this.setVarShapeDim(idx, 0, shapeDim);
      return idx;
    }
    return -1;
  }

  lookupVariable(nameOrId: string | StringId): number {
    const nId = typeof nameOrId === "string" ? this.interner.lookup(nameOrId) : nameOrId;
    if (nId === undefined || nId === 0) return -1;
    return this.exports?.dae_lookupVariable ? this.exports.dae_lookupVariable(this.ptr, nId) : -1;
  }

  getVarName(varIdx: number): string {
    const nId = this.getVarNameId(varIdx);
    return this.interner.resolve(nId) ?? "";
  }

  getVarIdxByName(name: string): number {
    return this.lookupVariable(name);
  }

  getVarNameId(varId: number): number {
    return this.exports?.dae_getVarNameId ? this.exports.dae_getVarNameId(this.ptr, varId) : 0;
  }

  getVarType(varId: number): VarType {
    return this.exports?.dae_getVarType ? (this.exports.dae_getVarType(this.ptr, varId) as VarType) : VarType.Real;
  }

  getVarVariability(varId: number): Variability {
    return this.exports?.dae_getVarVariability
      ? (this.exports.dae_getVarVariability(this.ptr, varId) as Variability)
      : Variability.Continuous;
  }

  getVarCausality(varId: number): Causality {
    return this.exports?.dae_getVarCausality
      ? (this.exports.dae_getVarCausality(this.ptr, varId) as Causality)
      : Causality.Local;
  }

  getVarFlags(varId: number): number {
    return this.exports?.dae_getVarFlags ? this.exports.dae_getVarFlags(this.ptr, varId) : 0;
  }

  setVarFlags(varId: number, flags: number): void {
    if (this.exports?.dae_setVarFlags) {
      this.exports.dae_setVarFlags(this.ptr, varId, flags);
    }
  }

  getVarStartValue(varId: number): number {
    return this.exports?.dae_getVarStartValue ? this.exports.dae_getVarStartValue(this.ptr, varId) : 0.0;
  }

  setVarStartValue(varId: number, val: number): void {
    if (this.exports?.dae_setVarStartValue) {
      this.exports.dae_setVarStartValue(this.ptr, varId, val);
    }
  }

  getVarExpression(varIdx: number): number | undefined {
    return this.varExpressions.get(varIdx) ?? (this.getVarAttrExpr(varIdx, VarAttrKind.Start) || undefined);
  }

  setVarExpression(varIdx: number, exprId: number): void {
    this.varExpressions.set(varIdx, exprId);
    this.setVarAttrExpr(varIdx, VarAttrKind.Start, exprId);
  }

  getVarDescription(varIdx: number): string | undefined {
    return this.varDescriptions.get(varIdx);
  }

  setVarDescription(varIdx: number, desc: string): void {
    this.varDescriptions.set(varIdx, desc);
  }

  getVarCadAnnotation(varIdx: number): any {
    return this.varCadAnnotations.get(varIdx);
  }

  setVarCadAnnotation(varIdx: number, cad: any): void {
    this.varCadAnnotations.set(varIdx, cad);
  }

  isVarRemoved(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_REMOVED) !== 0;
  }

  removeVariable(varIdx: number): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, flags | FLAG_VAR_REMOVED);
  }

  isVarState(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STATE) !== 0;
  }

  setVarState(varIdx: number, isState = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isState ? flags | FLAG_VAR_STATE : flags & ~FLAG_VAR_STATE);
  }

  isVarStateDer(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STATE_DER) !== 0;
  }

  setVarStateDer(varIdx: number, isDer = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isDer ? flags | FLAG_VAR_STATE_DER : flags & ~FLAG_VAR_STATE_DER);
  }

  isVarFlow(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_FLOW) !== 0;
  }

  setVarFlow(varIdx: number, isFlow = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFlow ? flags | FLAG_VAR_FLOW : flags & ~FLAG_VAR_FLOW);
  }

  isVarStream(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STREAM) !== 0;
  }

  setVarStream(varIdx: number, isStream = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isStream ? flags | FLAG_VAR_STREAM : flags & ~FLAG_VAR_STREAM);
  }

  getVarFlowPrefix(varIdx: number): string | null {
    if (this.isVarStream(varIdx)) return "stream";
    if (this.isVarFlow(varIdx)) return "flow";
    return null;
  }

  isVarFixed(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_FIXED) !== 0;
  }

  setVarFixed(varIdx: number, isFixed = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFixed ? flags | FLAG_VAR_FIXED : flags & ~FLAG_VAR_FIXED);
  }

  isVarProtected(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_PROTECTED) !== 0;
  }

  setVarProtected(varIdx: number, isProtected = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isProtected ? flags | FLAG_VAR_PROTECTED : flags & ~FLAG_VAR_PROTECTED);
  }

  isVarFinal(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_FINAL) !== 0;
  }

  setVarFinal(varIdx: number, isFinal = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFinal ? flags | FLAG_VAR_FINAL : flags & ~FLAG_VAR_FINAL);
  }

  getVarCustomType(varIdx: number): string | undefined {
    return this.varCustomTypes.get(varIdx);
  }

  setVarCustomType(varIdx: number, customType: string): void {
    this.varCustomTypes.set(varIdx, customType);
  }

  getVarEnumerationLiterals(varIdx: number): any[] | undefined {
    return this.varEnumLiterals.get(varIdx);
  }

  setVarEnumerationLiterals(varIdx: number, lits: any[]): void {
    this.varEnumLiterals.set(varIdx, lits as any);
  }

  hasArrayElements(baseName: string): boolean {
    const prefix = `${baseName}[`;
    for (let i = 0; i < this.varCount; i++) {
      if (this.getVarName(i).startsWith(prefix)) return true;
    }
    return false;
  }

  getArrayElementIndices(baseName: string): number[] {
    const prefix = `${baseName}[`;
    const indices: number[] = [];
    for (let i = 0; i < this.varCount; i++) {
      if (this.getVarName(i).startsWith(prefix)) indices.push(i);
    }
    return indices;
  }

  getVarShape(varIdx: number): number[] {
    return this.varShapes.get(varIdx) ?? [];
  }

  setVarShape(varIdx: number, shape: number[]): void {
    this.varShapes.set(varIdx, [...shape]);
    for (let d = 0; d < shape.length; d++) {
      this.setVarShapeDim(varIdx, d, shape[d]!);
    }
  }

  getVarShapeExprs(varIdx: number): number[] {
    return this.varShapeExprs.get(varIdx) ?? [];
  }

  setVarShapeExprs(varIdx: number, exprs: number[]): void {
    this.varShapeExprs.set(varIdx, [...exprs]);
  }

  getVarShapeDim(varIdx: number, dimIdx: number): number {
    return this.exports?.dae_getVarShapeDim ? this.exports.dae_getVarShapeDim(this.ptr, varIdx, dimIdx) : 0;
  }

  setVarShapeDim(varIdx: number, dimIdx: number, size: number): void {
    if (this.exports?.dae_setVarShapeDim) {
      this.exports.dae_setVarShapeDim(this.ptr, varIdx, dimIdx, size);
    }
  }

  getVarAttrExpr(varIdx: number, attrKind: VarAttrKind): number {
    return this.exports?.dae_getVarAttrExpr ? this.exports.dae_getVarAttrExpr(this.ptr, varIdx, attrKind) : 0;
  }

  setVarAttrExpr(varIdx: number, attrKind: VarAttrKind, exprId: number): void {
    if (this.exports?.dae_setVarAttrExpr) {
      this.exports.dae_setVarAttrExpr(this.ptr, varIdx, attrKind, exprId);
    }
  }

  getVarAttrExprId(varIdx: number, attrName: string): number | undefined {
    return this.varAttrs.get(varIdx)?.get(attrName);
  }

  getVarAttrExprIds(varIdx: number): Map<string, number> | undefined {
    return this.varAttrs.get(varIdx);
  }

  setVarAttr(varIdx: number, attrName: string, exprId: number): void {
    let map = this.varAttrs.get(varIdx);
    if (!map) {
      map = new Map<string, number>();
      this.varAttrs.set(varIdx, map);
    }
    map.set(attrName, exprId);
  }

  addAlias(varIdx: number, targetNameId: number): void {
    if (this.exports?.dae_addAlias) this.exports.dae_addAlias(this.ptr, varIdx, targetNameId);
  }

  getAlias(varIdx: number): number {
    return this.exports?.dae_getAlias ? this.exports.dae_getAlias(this.ptr, varIdx) : 0;
  }

  getVariables(): {
    name: string;
    type: VarType;
    variability: Variability;
    causality: Causality;
    startValue: number;
    flags: number;
  }[] {
    const list = [];
    for (let i = 0; i < this.varCount; i++) {
      list.push({
        name: this.getVarName(i),
        type: this.getVarType(i),
        variability: this.getVarVariability(i),
        causality: this.getVarCausality(i),
        startValue: this.getVarStartValue(i),
        flags: this.getVarFlags(i),
      });
    }
    return list;
  }

  // ── Equation Operations ──

  addEquation(kind: EqKind, lhsId: number, rhsId: number, auxId = 0xffffffff): number {
    if (!this.exports?.dae_addEquation) return -1;
    return this.exports.dae_addEquation(this.ptr, kind, lhsId, rhsId, auxId);
  }

  setEqLhs(eqId: number, lhs: number): void {
    if (this.exports?.dae_setEqLhs) {
      this.exports.dae_setEqLhs(this.ptr, eqId, lhs);
    }
  }

  setEqRhs(eqId: number, rhs: number): void {
    if (this.exports?.dae_setEqRhs) {
      this.exports.dae_setEqRhs(this.ptr, eqId, rhs);
    }
  }

  getEqKind(eqId: number): EqKind {
    return this.exports?.dae_getEqKind ? (this.exports.dae_getEqKind(this.ptr, eqId) as EqKind) : EqKind.Simple;
  }

  getEqLhs(eqId: number): number {
    return this.exports?.dae_getEqLhs ? this.exports.dae_getEqLhs(this.ptr, eqId) : -1;
  }

  getEqRhs(eqId: number): number {
    return this.exports?.dae_getEqRhs ? this.exports.dae_getEqRhs(this.ptr, eqId) : -1;
  }

  getEqAux(eqId: number): number {
    return this.exports?.dae_getEqAux ? this.exports.dae_getEqAux(this.ptr, eqId) : 0;
  }

  getEquations(): { kind: EqKind; lhs: number; rhs: number; aux?: number }[] {
    const list = [];
    for (let i = 0; i < this.eqCount; i++) {
      list.push({
        kind: this.getEqKind(i),
        lhs: this.getEqLhs(i),
        rhs: this.getEqRhs(i),
        aux: this.getEqAux(i),
      });
    }
    return list;
  }

  // ── Expression Operations ──

  addExpression(kind: ExprKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (!this.exports?.dae_addExpression) return -1;
    return this.exports.dae_addExpression(this.ptr, kind, data1, left, right);
  }

  addBinaryExpr(op: BinOp, left: number, right: number): number {
    if (this.exports?.dae_addBinaryExpr) {
      return this.exports.dae_addBinaryExpr(this.ptr, op, left, right);
    }
    return this.addExpression(ExprKind.Binary, op, left, right);
  }

  addUnaryExpr(op: UnaryOp, operand: number): number {
    return this.addExpression(ExprKind.Unary, op, operand);
  }

  addRealLiteral(value: number): number {
    if (this.exports?.dae_addRealLiteral) {
      return this.exports.dae_addRealLiteral(this.ptr, value);
    }
    return this.addExpression(ExprKind.RealLiteral, 0, 0, 0);
  }

  addIntLiteral(value: number): number {
    if (this.exports?.dae_addIntLiteral) {
      return this.exports.dae_addIntLiteral(this.ptr, value);
    }
    return this.addExpression(ExprKind.IntLiteral, value, 0, 0);
  }

  addBoolLiteral(value: boolean): number {
    return this.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }

  addStringLiteral(value: string | number): number {
    const sId = typeof value === "string" ? this.interner.intern(value) : value;
    return this.addExpression(ExprKind.StringLiteral, sId);
  }

  addNameExpr(name: string): number {
    const sId = this.interner.intern(name);
    return this.addExpression(ExprKind.Name, sId, 0, 0);
  }

  addDer(varId: number): number {
    if (this.exports?.dae_addDer) {
      return this.exports.dae_addDer(this.ptr, varId);
    }
    return this.addExpression(ExprKind.Der, varId, 0, 0);
  }

  addDerExpr(operand: number): number {
    return this.addExpression(ExprKind.Der, operand);
  }

  addPreExpr(operand: number): number {
    return this.addExpression(ExprKind.Pre, operand);
  }

  addCallExpr(funcNameOrId: string | number, args: number[]): number {
    const nameId = typeof funcNameOrId === "string" ? this.interner.intern(funcNameOrId) : funcNameOrId;
    let firstArg = 0xffffffff;
    if (args.length > 0) {
      firstArg = this.addTupleExpr(args);
    }
    return this.addExpression(ExprKind.Call, nameId, firstArg, args.length);
  }

  addTupleExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.Tuple, 0, 0xffffffff);
    let prev = 0xffffffff;
    for (let i = elements.length - 1; i >= 0; i--) {
      prev = this.addExpression(ExprKind.Tuple, elements[i]!, prev);
    }
    return prev;
  }

  addArrayCtorExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff);
    let prev = 0xffffffff;
    for (let i = elements.length - 1; i >= 0; i--) {
      prev = this.addExpression(ExprKind.ArrayCtor, elements[i]!, prev);
    }
    return prev;
  }

  addColonExpr(): number {
    return this.addExpression(ExprKind.Colon);
  }

  addSubscriptExpr(baseExpr: number, subIds: number[]): number {
    let curr = baseExpr;
    for (const sub of subIds) {
      curr = this.addSubscript(curr, sub);
    }
    return curr;
  }

  addEnumLiteral(ordinal: number, pathOrValue: string): number {
    const sId = this.interner.intern(pathOrValue);
    return this.addExpression(ExprKind.EnumLiteral, ordinal, sId);
  }

  addRangeExpr(startId: number, stopId: number, stepId = -1): number {
    return this.addRange(startId, stopId, stepId);
  }

  addComprehensionExpr(funcName: string, bodyId: number, iteratorCount: number): number {
    const sId = this.interner.intern(funcName);
    return this.addExpression(ExprKind.Comprehension, sId, bodyId, iteratorCount);
  }

  addPartialFuncExpr(funcName: string, argIds: number[]): number {
    const sId = this.interner.intern(funcName);
    const argsTuple = this.addTupleExpr(argIds);
    return this.addExpression(ExprKind.PartialFunc, sId, argsTuple, argIds.length);
  }

  addIfElseExpr(condExpr: number, trueExpr: number, falseExpr: number): number {
    return this.addIfElse(condExpr, trueExpr, falseExpr);
  }

  addName(varId: number): number {
    if (this.exports?.dae_addName) {
      return this.exports.dae_addName(this.ptr, varId);
    }
    return this.addExpression(ExprKind.Name, varId, 0, 0);
  }

  addIfElse(condExpr: number, trueExpr: number, falseExpr: number): number {
    if (this.exports?.dae_addIfElse) {
      return this.exports.dae_addIfElse(this.ptr, condExpr, trueExpr, falseExpr);
    }
    return this.addExpression(ExprKind.IfElse, condExpr, trueExpr, falseExpr);
  }

  addCall(funcId: number, firstArg: number, argCount: number): number {
    if (this.exports?.dae_addCall) {
      return this.exports.dae_addCall(this.ptr, funcId, firstArg, argCount);
    }
    return this.addExpression(ExprKind.Call, funcId, firstArg, argCount);
  }

  addRange(start: number, stop: number, step = 0): number {
    return this.addExpression(ExprKind.Range, step, start, stop);
  }

  addSubscript(baseExpr: number, subExpr: number): number {
    return this.addExpression(ExprKind.Subscript, 0, baseExpr, subExpr);
  }

  addArrayCtor(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.ArrayCtor, count, firstElem);
  }

  addTuple(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.Tuple, count, firstElem);
  }

  getExprKind(exprId: number): ExprKind {
    return this.exports?.dae_getExprKind ? (this.exports.dae_getExprKind(this.ptr, exprId) as ExprKind) : ExprKind.Name;
  }

  getExprData1(exprId: number): number {
    return this.exports?.dae_getExprData1 ? this.exports.dae_getExprData1(this.ptr, exprId) : 0;
  }

  getExprLeft(exprId: number): number {
    return this.exports?.dae_getExprLeft ? this.exports.dae_getExprLeft(this.ptr, exprId) : -1;
  }

  getExprRight(exprId: number): number {
    return this.exports?.dae_getExprRight ? this.exports.dae_getExprRight(this.ptr, exprId) : -1;
  }

  getExprRealValue(exprId: number): number {
    if (this.exports?.dae_getExprRealValue) {
      return this.exports.dae_getExprRealValue(this.ptr, exprId);
    }
    const hi = this.getExprData1(exprId);
    const lo = this.getExprLeft(exprId);
    const buf = new ArrayBuffer(8);
    const i32 = new Int32Array(buf);
    const f64 = new Float64Array(buf);
    i32[0] = lo;
    i32[1] = hi;
    return f64[0]!;
  }

  // ── Statement Operations ──

  addStatement(kind: StmtKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (!this.exports?.dae_addStatement) return -1;
    return this.exports.dae_addStatement(this.ptr, kind, data1, left, right);
  }

  getStmtKind(stmtId: number): StmtKind {
    return this.exports?.dae_getStmtKind
      ? (this.exports.dae_getStmtKind(this.ptr, stmtId) as StmtKind)
      : StmtKind.Assignment;
  }

  getStmtData1(stmtId: number): number {
    return this.exports?.dae_getStmtData1 ? this.exports.dae_getStmtData1(this.ptr, stmtId) : 0;
  }

  getStmtLeft(stmtId: number): number {
    return this.exports?.dae_getStmtLeft ? this.exports.dae_getStmtLeft(this.ptr, stmtId) : -1;
  }

  getStmtRight(stmtId: number): number {
    return this.exports?.dae_getStmtRight ? this.exports.dae_getStmtRight(this.ptr, stmtId) : -1;
  }

  getStatements(): { kind: StmtKind; data1: number; left: number; right: number }[] {
    const list = [];
    for (let i = 0; i < this.stmtCount; i++) {
      list.push({
        kind: this.getStmtKind(i),
        data1: this.getStmtData1(i),
        left: this.getStmtLeft(i),
        right: this.getStmtRight(i),
      });
    }
    return list;
  }

  // ── Clocks & Synchronous Features ──

  addClock(intervalExprId: number, resolutionExprId = 0, shiftExprId = 0): number {
    return this.exports?.dae_addClock
      ? this.exports.dae_addClock(this.ptr, intervalExprId, resolutionExprId, shiftExprId)
      : 0;
  }

  setVarClock(varIdx: number, clockId: number): void {
    if (this.exports?.dae_setVarClock) this.exports.dae_setVarClock(this.ptr, varIdx, clockId);
  }

  getVarClock(varIdx: number): number {
    return this.exports?.dae_getVarClock ? this.exports.dae_getVarClock(this.ptr, varIdx) : 0;
  }

  setEqClock(eqIdx: number, clockId: number): void {
    if (this.exports?.dae_setEqClock) this.exports.dae_setEqClock(this.ptr, eqIdx, clockId);
  }

  getEqClock(eqIdx: number): number {
    return this.exports?.dae_getEqClock ? this.exports.dae_getEqClock(this.ptr, eqIdx) : 0;
  }

  // ── Conditionals & Structured Equations ──

  addWhenEquation(conditionExprId: number): number {
    const idx = this.exports?.dae_addWhenEquation
      ? this.exports.dae_addWhenEquation(this.ptr, conditionExprId)
      : this.whenMeta.size;
    const meta: WhenEquationMeta = {
      conditionExprId,
      bodyEquations: [],
      equations: [],
      elseWhenClauses: [],
      elseEquations: [],
    };
    this.whenMeta.set(idx, meta);
    return idx;
  }

  addWhenBodyEquation(whenIdx: number, kind: EqKind, lhsId: number, rhsId: number): number {
    if (this.exports?.dae_addWhenBodyEquation) {
      this.exports.dae_addWhenBodyEquation(this.ptr, whenIdx, kind, lhsId, rhsId);
    }
    const meta = this.whenMeta.get(whenIdx);
    if (meta) {
      meta.equations.push({ kind, lhs: lhsId, rhs: rhsId });
      meta.bodyEquations.push({ kind, lhsExprId: lhsId, rhsExprId: rhsId });
    }
    return 0;
  }

  getWhenEquationMeta(eqIdx: number): WhenEquationMeta | undefined {
    return this.whenMeta.get(eqIdx);
  }

  addForEquation(indexNameId: number, rangeExprId: number): number {
    const idx = this.exports?.dae_addForEquation
      ? this.exports.dae_addForEquation(this.ptr, indexNameId, rangeExprId)
      : this.forMeta.size;
    const meta: ForEquationMeta = {
      indexNameId,
      rangeExprId,
      bodyEquations: [],
      equations: [],
    };
    this.forMeta.set(idx, meta);
    return idx;
  }

  addForBodyEquation(forIdx: number, kind: EqKind, lhsId: number, rhsId: number): number {
    if (this.exports?.dae_addForBodyEquation) {
      this.exports.dae_addForBodyEquation(this.ptr, forIdx, kind, lhsId, rhsId);
    }
    const meta = this.forMeta.get(forIdx);
    if (meta) {
      meta.equations.push({ kind, lhs: lhsId, rhs: rhsId });
      meta.bodyEquations.push({ kind, lhsExprId: lhsId, rhsExprId: rhsId });
    }
    return 0;
  }

  getForEquationMeta(eqIdx: number): ForEquationMeta | undefined {
    return this.forMeta.get(eqIdx);
  }

  addIfEquation(conditionExprId: number): number {
    const idx = this.exports?.dae_addIfEquation
      ? this.exports.dae_addIfEquation(this.ptr, conditionExprId)
      : this.ifMeta.size;
    const meta: IfEquationMeta = {
      conditionExprId,
      thenEquations: [],
      elseIfClauses: [],
      elseEquations: [],
    };
    this.ifMeta.set(idx, meta);
    return idx;
  }

  addIfThenEquation(ifIdx: number, kind: EqKind, lhsId: number, rhsId: number): number {
    if (this.exports?.dae_addIfThenEquation) {
      this.exports.dae_addIfThenEquation(this.ptr, ifIdx, kind, lhsId, rhsId);
    }
    const meta = this.ifMeta.get(ifIdx);
    if (meta) {
      meta.thenEquations.push({ kind, lhsExprId: lhsId, rhsExprId: rhsId });
    }
    return 0;
  }

  getIfEquationMeta(eqIdx: number): IfEquationMeta | undefined {
    return this.ifMeta.get(eqIdx);
  }

  // ── State Machines ──

  addStateMachine(nameId: number, initialStateId: number): number {
    return this.exports?.dae_addStateMachine ? this.exports.dae_addStateMachine(this.ptr, nameId, initialStateId) : 0;
  }

  addState(smId: number, nameId: number): number {
    return this.exports?.dae_addState ? this.exports.dae_addState(this.ptr, smId, nameId) : 0;
  }

  addStateEquation(smId: number, stateId: number, targetNameId: number, exprId: number, isDerivative: boolean): number {
    return this.exports?.dae_addStateEquation
      ? this.exports.dae_addStateEquation(this.ptr, smId, stateId, targetNameId, exprId, isDerivative)
      : 0;
  }

  addTransition(
    smId: number,
    fromStateId: number,
    toStateId: number,
    conditionExprId: number,
    flags = 0,
    priority = 0,
  ): number {
    return this.exports?.dae_addTransition
      ? this.exports.dae_addTransition(this.ptr, smId, fromStateId, toStateId, conditionExprId, flags, priority)
      : 0;
  }

  getStateMachines(): ArenaStateMachine[] {
    return this.stateMachines;
  }

  getVarStartAttr(varIdx: number): number {
    return this.getVarStartValue(varIdx);
  }

  // ── Optimization & Events ──

  addEventIndicator(exprId: number): number {
    this.eventIndicatorExprIds.push(exprId);
    return this.exports?.dae_addEventIndicator ? this.exports.dae_addEventIndicator(this.ptr, exprId) : 0;
  }

  getEventIndicatorCount(): number {
    return this.exports?.dae_getEventIndicatorCount ? this.exports.dae_getEventIndicatorCount(this.ptr) : 0;
  }

  getEventIndicatorExprId(idx: number): number {
    return this.exports?.dae_getEventIndicatorExprId ? this.exports.dae_getEventIndicatorExprId(this.ptr, idx) : 0;
  }

  setOptimizationObjective(objExpr: number, integrandExpr: number, startExpr: number, finalExpr: number): void {
    this.objectiveExprId = objExpr;
    this.objectiveIntegrandExprId = integrandExpr;
    this.startTimeExprId = startExpr;
    this.finalTimeExprId = finalExpr;
    if (this.exports?.dae_setOptimizationObjective) {
      this.exports.dae_setOptimizationObjective(this.ptr, objExpr, integrandExpr, startExpr, finalExpr);
    }
  }

  // ── Memory & Views ──

  varView(): Int32Array {
    const count = this.getVarCount();
    const arr = new Int32Array(count * 8);
    for (let i = 0; i < count; i++) {
      const offset = i * 8;
      arr[offset + 0] = this.getVarNameId(i);
      arr[offset + 1] = this.getVarType(i);
      arr[offset + 2] = this.getVarVariability(i);
      arr[offset + 3] = this.getVarCausality(i);
      const val = this.getVarStartValue(i);
      const buf = new ArrayBuffer(8);
      const f64 = new Float64Array(buf);
      const i32 = new Int32Array(buf);
      f64[0] = val;
      arr[offset + 4] = i32[1]!;
      arr[offset + 5] = i32[0]!;
      arr[offset + 6] = this.getVarShape(i).length;
      arr[offset + 7] = this.getVarFlags(i);
    }
    return arr;
  }

  eqView(): Int32Array {
    const count = this.getEqCount();
    const arr = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      arr[offset + 0] = this.getEqKind(i);
      arr[offset + 1] = this.getEqLhs(i);
      arr[offset + 2] = this.getEqRhs(i);
      arr[offset + 3] = this.getEqAux(i);
    }
    return arr;
  }

  exprView(): Int32Array {
    const count = this.getExprCount();
    const arr = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      arr[offset + 0] = this.getExprKind(i);
      arr[offset + 1] = this.getExprData1(i);
      arr[offset + 2] = this.getExprLeft(i);
      arr[offset + 3] = this.getExprRight(i);
    }
    return arr;
  }

  stmtView(): Int32Array {
    const count = this.getStmtCount();
    const arr = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      arr[offset + 0] = this.getStmtKind(i);
      arr[offset + 1] = this.getStmtData1(i);
      arr[offset + 2] = this.getStmtLeft(i);
      arr[offset + 3] = this.getStmtRight(i);
    }
    return arr;
  }

  snapshot(): void {
    if (this.exports?.dae_snapshot) this.exports.dae_snapshot(this.ptr);
  }

  rollback(): void {
    if (this.exports?.dae_rollback) this.exports.dae_rollback(this.ptr);
  }

  getVarCount(): number {
    return this.exports?.dae_getVarCount ? this.exports.dae_getVarCount(this.ptr) : 0;
  }

  getEqCount(): number {
    return this.exports?.dae_getEqCount ? this.exports.dae_getEqCount(this.ptr) : 0;
  }

  getExprCount(): number {
    return this.exports?.dae_getExprCount ? this.exports.dae_getExprCount(this.ptr) : 0;
  }

  getStmtCount(): number {
    return this.exports?.dae_getStmtCount ? this.exports.dae_getStmtCount(this.ptr) : 0;
  }

  estimateMemoryBytes(): number {
    return this.getVarCount() * 32 + this.getEqCount() * 16 + this.getExprCount() * 16 + this.getStmtCount() * 16;
  }

  clone(): WasmDaeBridge {
    const copy = new WasmDaeBridge(this.exports, 0, this.description, this.interner);
    copy.nameId = this.nameId;
    copy.descriptionId = this.descriptionId;
    copy.classKind = this.classKind;
    copy.isImpure = this.isImpure;
    copy.externalDecl = this.externalDecl;
    copy.jsSource = this.jsSource;
    copy.jsPath = this.jsPath;
    copy.objectiveExprId = this.objectiveExprId;
    copy.objectiveIntegrandExprId = this.objectiveIntegrandExprId;
    copy.startTimeExprId = this.startTimeExprId;
    copy.finalTimeExprId = this.finalTimeExprId;
    copy.externalIncludes = [...this.externalIncludes];
    copy.externalObjects = this.externalObjects.map((o) => ({ ...o }));
    copy.equationAnnotations = [...this.equationAnnotations];
    copy.algorithmAnnotations = [...this.algorithmAnnotations];
    copy.experiment = { ...this.experiment };
    for (const [k, v] of this.functions) copy.functions.set(k, v);
    for (const s of this._algorithmSections) copy._algorithmSections.push({ ...s });
    for (const s of this._initialAlgorithmSections) copy._initialAlgorithmSections.push({ ...s });
    for (const [k, v] of this.stmtLocations) copy.stmtLocations.set(k, { ...v });
    for (const [k, v] of this.varShapes) copy.varShapes.set(k, [...v]);
    for (const [k, v] of this.varShapeExprs) copy.varShapeExprs.set(k, [...v]);
    for (const [k, v] of this.varAttrs) copy.varAttrs.set(k, new Map(v));
    for (const [k, v] of this.varExpressions) copy.varExpressions.set(k, v);
    for (const [k, v] of this.varDescriptions) copy.varDescriptions.set(k, v);
    for (const [k, v] of this.varCadAnnotations) copy.varCadAnnotations.set(k, v);
    for (const [k, v] of this.varCustomTypes) copy.varCustomTypes.set(k, v);
    for (const [k, v] of this.varEnumLiterals) copy.varEnumLiterals.set(k, v);
    for (const [k, v] of this.whenMeta)
      copy.whenMeta.set(k, {
        ...v,
        equations: [...v.equations],
        bodyEquations: [...v.bodyEquations],
        elseWhenClauses: [...v.elseWhenClauses],
      });
    for (const [k, v] of this.forMeta)
      copy.forMeta.set(k, { ...v, equations: [...v.equations], bodyEquations: [...v.bodyEquations] });
    for (const [k, v] of this.ifMeta)
      copy.ifMeta.set(k, { ...v, thenEquations: [...v.thenEquations], elseIfClauses: [...v.elseIfClauses] });
    copy.stateMachines = this.stateMachines.map((sm) => ({ ...sm }));

    for (let i = 0; i < this.varCount; i++) {
      copy.addVariable(
        this.getVarNameId(i),
        this.getVarType(i),
        this.getVarVariability(i),
        this.getVarCausality(i),
        this.getVarStartValue(i),
        this.getVarFlags(i),
      );
    }
    for (let i = 0; i < this.eqCount; i++) {
      copy.addEquation(this.getEqKind(i), this.getEqLhs(i), this.getEqRhs(i), this.getEqAux(i));
    }
    for (let i = 0; i < this.exprCount; i++) {
      copy.addExpression(this.getExprKind(i), this.getExprData1(i), this.getExprLeft(i), this.getExprRight(i));
    }
    for (let i = 0; i < this.stmtCount; i++) {
      copy.addStatement(this.getStmtKind(i), this.getStmtData1(i), this.getStmtLeft(i), this.getStmtRight(i));
    }
    return copy;
  }
}

/** Export DAEBuilder as canonical alias to WasmDaeBridge. */
export { WasmDaeBridge as DAEBuilder };

// ─────────────────────────────────────────────────────────────────────────────
// CAS & Symbolic Differentiation Routines
// ─────────────────────────────────────────────────────────────────────────────

export function simplifyArenaExpression(arena: WasmDaeBridge, exprId: number): number {
  return exprId;
}

export function substituteArenaExpr(
  arena: WasmDaeBridge,
  exprId: number,
  targetNameId: number,
  replacementExprId: number,
): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (nameId === targetNameId) {
        return replacementExprId;
      }
      return exprId;
    }

    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.Colon:
      return exprId;

    case ExprKind.Der:
    case ExprKind.Pre: {
      const inner = arena.getExprData1(exprId);
      const newInner = substituteArenaExpr(arena, inner, targetNameId, replacementExprId);
      if (newInner === inner) return exprId;
      return arena.addExpression(kind, newInner);
    }

    case ExprKind.Negate:
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const operand = arena.getExprLeft(exprId);
      const newOperand = substituteArenaExpr(arena, operand, targetNameId, replacementExprId);
      if (newOperand === operand) return exprId;
      return kind === ExprKind.Negate
        ? arena.addExpression(ExprKind.Negate, 0, newOperand)
        : arena.addUnaryExpr(op as UnaryOp, newOperand);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      const newLeft = substituteArenaExpr(arena, left, targetNameId, replacementExprId);
      const newRight = substituteArenaExpr(arena, right, targetNameId, replacementExprId);
      if (newLeft === left && newRight === right) return exprId;
      return arena.addBinaryExpr(op, newLeft, newRight);
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const newCond = substituteArenaExpr(arena, cond, targetNameId, replacementExprId);
      const newTrue = substituteArenaExpr(arena, trueBranch, targetNameId, replacementExprId);
      const newFalse = substituteArenaExpr(arena, falseBranch, targetNameId, replacementExprId);
      if (newCond === cond && newTrue === trueBranch && newFalse === falseBranch) return exprId;
      return arena.addIfElse(newCond, newTrue, newFalse);
    }

    default:
      return exprId;
  }
}

export function differentiateArenaExpression(
  arena: WasmDaeBridge,
  exprId: number,
  wrt: string | number | Set<number>,
): number {
  if (typeof wrt === "string") {
    return differentiateArenaExpressionWrt(arena, exprId, arena.interner.intern(wrt));
  } else if (typeof wrt === "number") {
    return differentiateArenaExpressionWrt(arena, exprId, wrt);
  } else {
    return differentiateArenaExpressionWrtSet(arena, exprId, wrt);
  }
}

export function differentiateArenaExpressionWrt(arena: WasmDaeBridge, exprId: number, wrtVarId: number): number {
  if (exprId < 0) return arena.addRealLiteral(0.0);
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (nameId === wrtVarId) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        const fullDerNameId = arena.interner.intern(`der(${innerName})`);
        if (fullDerNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.Sub: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          return arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

function differentiateArenaExpressionWrtSet(arena: WasmDaeBridge, exprId: number, wrtVarIds: Set<number>): number {
  if (exprId < 0) return arena.addRealLiteral(0.0);
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (wrtVarIds.has(nameId)) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        const fullDerNameId = arena.interner.intern(`der(${innerName})`);
        if (wrtVarIds.has(fullDerNameId)) {
          return arena.addRealLiteral(1.0);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrtSet(arena, operand, wrtVarIds));
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.Sub: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          return arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

/**
 * The Modelica source for the ModelScript.CAS package.
 */
export const MODELSCRIPT_CAS_PACKAGE = `
package ModelScript
  package CAS "Computer Algebra System"

    function simplify "Simplify an expression using E-Graph equality saturation"
      input Expression expr;
      output Expression result;
      external "builtin";
    end simplify;

    function expand "Expand polynomial expressions (distribute multiplication)"
      input Expression expr;
      output Expression result;
      external "builtin";
    end expand;

    function normalize "Normalize to canonical form via E-Graph"
      input Expression expr;
      output Expression result;
      external "builtin";
    end normalize;

    function trigSimplify "Simplify using trigonometric identities"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigSimplify;

    function trigExpand "Expand trig expressions using addition formulas"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigExpand;

    function diff "Symbolic differentiation"
      input Expression expr;
      input Expression var "Variable to differentiate with respect to (as an expression node)";
      input Integer n = 1 "Order of derivative";
      output Expression result;
      external "builtin";
    end diff;

    function integrate "Symbolic anti-differentiation"
      input Expression expr;
      input Expression var "Variable to integrate with respect to";
      output Expression result;
      external "builtin";
    end integrate;

    function solve "Solve expr = 0 for var (returns first solution)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression result;
      external "builtin";
    end solve;

    function solveAll "Solve expr = 0 for var (returns all solutions)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression[:] result;
      external "builtin";
    end solveAll;

    function factor "Factor a quadratic polynomial"
      input Expression expr;
      input Expression var;
      output Expression result;
      external "builtin";
    end factor;

    function taylor "Taylor series expansion"
      input Expression expr;
      input Expression var;
      input Real point;
      input Integer order;
      output Expression result;
      external "builtin";
    end taylor;

    function limit "Evaluate limit of expr as var -> point"
      input Expression expr;
      input Expression var;
      input Real point;
      output Expression result;
      external "builtin";
    end limit;

    function degree "Get polynomial degree of expr in var"
      input Expression expr;
      input Expression var;
      output Integer result;
      external "builtin";
    end degree;

    function roots "Find rational roots of polynomial expr in var (returns numeric roots)"
      input Expression expr;
      input Expression var;
      output Real[:] result;
      external "builtin";
    end roots;

  end CAS;
end ModelScript;
`;

// ─────────────────────────────────────────────────────────────────────────────
// Alias Elimination & Type Inference Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function eliminateArenaAliases(dae: WasmDaeBridge): void {
  const aliasMap = new Map<number, number>();

  function find(id: number): number {
    let curr = id;
    while (aliasMap.has(curr)) {
      curr = aliasMap.get(curr)!;
    }
    return curr;
  }

  function union(id1: number, id2: number): void {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      aliasMap.set(root2, root1);
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Connect || kind === EqKind.Simple) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (lhs >= 0 && rhs >= 0 && dae.getExprKind(lhs) === ExprKind.Name && dae.getExprKind(rhs) === ExprKind.Name) {
        const name1 = dae.getExprData1(lhs);
        const name2 = dae.getExprData1(rhs);
        union(name1, name2);
      }
    }
  }

  if (aliasMap.size === 0) return;

  for (let i = 0; i < dae.exprCount; i++) {
    if (dae.getExprKind(i) === ExprKind.Name) {
      const nameId = dae.getExprData1(i);
      const rootId = find(nameId);
      if (rootId !== nameId) {
        if (dae.exports?.dae_setExprData1) {
          dae.exports.dae_setExprData1(dae.ptr, i, rootId);
        }
      }
    }
  }
}

export function inferArenaExprVarType(dae: WasmDaeBridge, exprId: number): VarType {
  if (exprId < 0) return VarType.Real;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return VarType.Real;
    case ExprKind.IntLiteral:
      return VarType.Integer;
    case ExprKind.BoolLiteral:
      return VarType.Boolean;
    case ExprKind.StringLiteral:
      return VarType.String;
    case ExprKind.EnumLiteral:
      return VarType.Enumeration;
    case ExprKind.Name: {
      const nameId = dae.getExprData1(exprId);
      const vIdx = dae.lookupVariable(nameId);
      if (vIdx >= 0) return dae.getVarType(vIdx);
      return VarType.Real;
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      switch (op) {
        case BinOp.Eq:
        case BinOp.Neq:
        case BinOp.Lt:
        case BinOp.Gt:
        case BinOp.Lte:
        case BinOp.Gte:
        case BinOp.And:
        case BinOp.Or:
          return VarType.Boolean;
        case BinOp.Add:
        case BinOp.Sub:
        case BinOp.Mul:
        case BinOp.Div:
        case BinOp.Pow:
        case BinOp.ElemAdd:
        case BinOp.ElemSub:
        case BinOp.ElemMul:
        case BinOp.ElemDiv:
        case BinOp.ElemPow: {
          const lType = inferArenaExprVarType(dae, dae.getExprLeft(exprId));
          const rType = inferArenaExprVarType(dae, dae.getExprRight(exprId));
          if (lType === VarType.Real || rType === VarType.Real) return VarType.Real;
          if (lType === VarType.Integer && rType === VarType.Integer) {
            return op === BinOp.Div ? VarType.Real : VarType.Integer;
          }
          return lType;
        }
      }
      return VarType.Real;
    }
    case ExprKind.Unary: {
      const uop = dae.getExprData1(exprId) as UnaryOp;
      return uop === UnaryOp.Not ? VarType.Boolean : inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    }
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.IfElse:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    default:
      return VarType.Real;
  }
}

export function isAssignableType(source: VarType, target: VarType): boolean {
  if (source === target) return true;
  if (source === VarType.Integer && target === VarType.Real) return true;
  return false;
}

export function varTypeName(type: VarType): string {
  switch (type) {
    case VarType.Real:
      return "Real";
    case VarType.Integer:
      return "Integer";
    case VarType.Boolean:
      return "Boolean";
    case VarType.String:
      return "String";
    case VarType.Enumeration:
      return "Enumeration";
    case VarType.Clock:
      return "Clock";
    default:
      return "Unknown";
  }
}
