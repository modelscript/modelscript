// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * DAEBuilder / WasmDaeBridge — Flat, arena-backed storage for flattened DAE data.
 *
 * Implements `IDaeBuilder` backed by the zero-GC WebAssembly `DaeBuilder` runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceLocation } from "../runtime.js";
import type { FmuInstanceMetadata } from "../simulation/wasm_fmu_subsystem.js";
import type { StringId } from "../workspace/wasm_string_pool.js";
import { StringInterner, WasmStringPool } from "../workspace/wasm_string_pool.js";
import { ArenaEquation, ArenaExpr, ArenaVariable } from "./fluent/index.js";

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

/** Bitmask flag indicating an `initial equation`. */
export const FLAG_EQ_INITIAL = 1 << 0;
/** Bitmask flag indicating an equation belonging to an overconstrained connection set. */
export const FLAG_EQ_OVERCONSTRAINED = 1 << 1;
/** Bitmask flag indicating a synthesized stream connection equation. */
export const FLAG_EQ_STREAM_CONNECT = 1 << 2;

// ─────────────────────────────────────────────────────────────────────────────
// WASM Singleton Loader
// ─────────────────────────────────────────────────────────────────────────────

/** Cached singleton WebAssembly runtime exports instance. */
let cachedWasmExports: any = null;

/**
 * Registers a pre-instantiated WebAssembly runtime exports object as the process-wide default.
 *
 * @param exports - WebAssembly instance exports object.
 */
export function setCachedWasmExports(exports: any): void {
  cachedWasmExports = exports;
  if (typeof globalThis !== "undefined") {
    (globalThis as any).__modelscript_wasm_exports__ = exports;
  }
}

/**
 * Returns the cached WebAssembly runtime exports, lazily loading `build/release.wasm`
 * from disk when running in Node.js if not yet initialized.
 *
 * @returns WebAssembly instance exports, or `null` if unavailable.
 */
export function getDefaultWasmExports(): any {
  if (cachedWasmExports) return cachedWasmExports;
  if (typeof globalThis !== "undefined" && (globalThis as any).__modelscript_wasm_exports__) {
    cachedWasmExports = (globalThis as any).__modelscript_wasm_exports__;
    return cachedWasmExports;
  }
  if (typeof process !== "undefined" && process.versions?.node != null) {
    try {
      const dir = typeof import.meta.dirname === "string" ? import.meta.dirname : "";
      const candidates = [
        dir ? join(dir, "..", "build", "release.wasm") : null,
        dir ? join(dir, "..", "..", "build", "release.wasm") : null,
        join(process.cwd(), "packages", "runtime", "build", "release.wasm"),
        join(process.cwd(), "build", "release.wasm"),
      ].filter((p): p is string => Boolean(p));

      let wasmPath: string | null = null;
      for (const cand of candidates) {
        if (existsSync(cand)) {
          wasmPath = cand;
          break;
        }
      }

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
        if (typeof globalThis !== "undefined") {
          (globalThis as any).__modelscript_wasm_exports__ = cachedWasmExports;
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// WasmDaeBridge / DAEBuilder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a dotted component path into top-level segments while keeping dots inside
 * array subscript brackets (`[...]`) intact.
 *
 * @param path - Dotted component path (e.g., `a[1].b.c[2, 3]`).
 * @returns Array of path segments.
 */
function splitPath(path: string): string[] {
  const parts: string[] = [];
  let bracketDepth = 0;
  let last = 0;
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (ch === "." && bracketDepth === 0) {
      parts.push(path.substring(last, i));
      last = i + 1;
    }
  }
  parts.push(path.substring(last));
  return parts;
}

/**
 * Matches a potentially subscripted scalarized variable path `vn` (e.g., `a[1].b[2]`)
 * against an unsubscripted base path `baseName` (e.g., `a.b`), extracting the 1-based
 * subscript indices across all dimensions.
 *
 * @param vn - Candidate variable name from the arena.
 * @param baseName - Unsubscripted base variable path.
 * @param labelMaps - Optional per-dimension maps for non-numeric (e.g., enumeration) subscripts.
 * @returns Extracted 1-based subscript indices across all dimensions, or `null` if `vn` does not match `baseName`.
 */
export function matchVarPath(vn: string, baseName: string, labelMaps?: Map<string, number>[]): number[] | null {
  const baseParts = splitPath(baseName);
  const vnParts = splitPath(vn);
  if (vnParts.length !== baseParts.length) return null;
  const indices: number[] = [];
  for (let i = 0; i < baseParts.length; i++) {
    const bp = baseParts[i]!;
    const vp = vnParts[i]!;
    if (bp === vp) continue;
    const prefix = `${bp}[`;
    if (vp.startsWith(prefix) && vp.endsWith("]")) {
      const idxStrs = vp.slice(prefix.length, -1).split(",");
      for (let subIdx = 0; subIdx < idxStrs.length; subIdx++) {
        const s = idxStrs[subIdx]!.trim();
        const dim = indices.length;
        if (/^\d+$/.test(s)) {
          indices.push(parseInt(s, 10));
        } else if (labelMaps) {
          if (!labelMaps[dim]) labelMaps[dim] = new Map<string, number>();
          let mapped = labelMaps[dim]!.get(s);
          if (mapped === undefined) {
            mapped = labelMaps[dim]!.size + 1;
            labelMaps[dim]!.set(s, mapped);
          }
          indices.push(mapped);
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }
  return indices;
}

/**
 * Universal DAE Builder (`DAEBuilder`) backed directly by the WebAssembly `DaeBuilder`
 * struct-of-arrays arena in linear memory, augmented with host-side metadata tables for
 * structured equations, state machines, annotations, and source ranges.
 */
export class WasmDaeBridge implements IDaeBuilder {
  /** WebAssembly runtime instance exports. */
  public readonly exports: any;
  /** Pointer to the underlying `DaeBuilder` instance in WebAssembly linear memory. */
  public ptr = 0;
  /** String interner shared with the WASM arena for zero-copy identifier resolution. */
  readonly interner: StringInterner;

  /** Interned `StringId` of the flattened model or function name. */
  nameId: StringId = 0;
  /** Interned `StringId` of the model or function description string. */
  descriptionId: StringId = 0;

  /** Modelica class restriction keyword (`"model"`, `"function"`, `"record"`, `"block"`, etc.). */
  classKind = "class";
  /** Whether the class or function is declared `impure`. */
  isImpure = false;
  /** Whether the class contains at least one `algorithm` section. */
  hasAlgorithmSection = false;
  /** Whether the class contains at least one `initial algorithm` section. */
  hasInitialAlgorithmSection = false;
  /** Raw `external` function declaration clause text, or `null` if not an external function. */
  externalDecl: string | null = null;
  /** Optional inline JavaScript implementation source for external functions. */
  jsSource?: string | undefined;
  /** Optional external JavaScript module path for external functions. */
  jsPath?: string | undefined;

  /** Expression arena ID for the Mayer optimization objective term, or `-1` if unset. */
  objectiveExprId: number = -1;
  /** Expression arena ID for the Lagrange optimization integrand term, or `-1` if unset. */
  objectiveIntegrandExprId: number = -1;
  /** Expression arena ID for optimization start time, or `-1` if unset. */
  startTimeExprId: number = -1;
  /** Expression arena ID for optimization final time, or `-1` if unset. */
  finalTimeExprId: number = -1;
  /** List of C header/source include directives from external function annotations. */
  externalIncludes: string[] = [];
  /** Metadata for `ExternalObject` instances declared in the model. */
  externalObjects: {
    name: string;
    type?: string | undefined;
    className?: string | undefined;
    constructorName?: string | undefined;
    destructorName?: string | undefined;
  }[] = [];
  /** Raw annotation strings attached to `equation` sections. */
  equationAnnotations: string[] = [];
  /** Raw annotation strings attached to `algorithm` sections. */
  algorithmAnnotations: string[] = [];
  /** Expression arena IDs of zero-crossing event indicators. */
  eventIndicatorExprIds: number[] = [];
  /** Compiler and flattener diagnostics collected during instantiation. */
  diagnostics: any[] = [];

  /** No-op hook retained for backwards compatibility with legacy equation grouping passes. */
  groupEquationsForParity(): void {}

  /** Simulation experiment parameters extracted from the `experiment(...)` annotation. */
  experiment: {
    startTime?: number | undefined;
    stopTime?: number | undefined;
    tolerance?: number | undefined;
    interval?: number | undefined;
    numberOfIntervals?: number | undefined;
    algorithm?: string | undefined;
    __modelscript_equidistantOutput?: boolean | undefined;
  } = {};

  /** Set of variable indices hidden from standard output printing (`HideResult` or internal helpers). */
  public hiddenVarIndices = new Set<number>();
  /** Map from state variable index to stochastic diffusion expression ID (for SDE models). */
  public diffusionExprIds = new Map<number, number>();
  /** Domain-specific extension metadata (WebGPU, audio clock, SDE, BVP, surrogate, FEA, CFD, MBSE, etc.). */
  public extensionMetadata: {
    webgpu?:
      | { workgroupSize?: number | undefined; precision?: string | undefined; parallelInstances?: number | undefined }
      | undefined;
    audioClock?:
      | { sampleRate?: number | undefined; targetHz?: number | undefined; realtimeFactor?: number | undefined }
      | undefined;
    sde?: { method?: string | undefined; ensemblePaths?: number | undefined; seed?: number | undefined } | undefined;
    bvp?:
      | { boundaryConditions?: string[] | undefined; method?: string | undefined; intervals?: number | undefined }
      | undefined;
    surrogate?:
      | Map<
          string,
          { architecture?: string | undefined; datasetUri?: string | undefined; errorTolerance?: number | undefined }
        >
      | undefined;
    feaMesh?:
      | {
          cadUri?: string | undefined;
          meshType?: string | undefined;
          material?: string | undefined;
          loadConnector?: string | undefined;
          feedbackDeflection?: string | undefined;
        }[]
      | undefined;
    cfdFlow?:
      | {
          grid?: number[] | undefined;
          dx?: number | undefined;
          turbulenceModel?: string | undefined;
          velocityVariable?: string | undefined;
          dragForceVariable?: string | undefined;
        }[]
      | undefined;
    mbse?: { sysml?: any[] | undefined; owl?: any[] | undefined; telemetry?: any[] | undefined } | undefined;
    expandableBuses?: string[] | undefined;
    outputVars?: Set<string> | undefined;
    isOperatorRecord?: boolean | undefined;
    fmuInstances?: FmuInstanceMetadata[] | undefined;
    [key: string]: any;
  } = {};

  /** Map of compiled helper/called functions keyed by function name or interned `StringId`. */
  public functions = new Map<string | number, WasmDaeBridge>();
  /** Statement index ranges (`{ start, count }`) for each `algorithm` section in the class. */
  public _algorithmSections: { start: number; count: number }[] = [];
  /** Statement index ranges (`{ start, count }`) for each `initial algorithm` section in the class. */
  public _initialAlgorithmSections: { start: number; count: number }[] = [];
  /** Map from statement index to original source location for debugging and diagnostics. */
  public stmtLocations = new Map<number, SourceLocation>();
  /** Boundary node metadata for multi-domain / PDE coupling. */
  public boundaryNodes: any[] = [];

  // Host-side maps for metadata and structured equations
  /** Map from array variable name to its declared dimension sizes. */
  public namedArrayShapes = new Map<string, number[]>();
  /** Map from unsubscripted array base prefix to the list of scalarized element variable indices. */
  public baseArrayIndices = new Map<string, number[]>();
  /** Map from variable index to overridden/renamed variable name. */
  public _renamedVars = new Map<number, string>();
  /** Reverse lookup map from overridden/renamed variable name to variable index. */
  public _renamedVarsReverse = new Map<string, number>();

  /**
   * Indexes a scalarized array variable (e.g., `x[1,2]` or `comp[1].y[2]`) under all of its
   * unsubscripted base prefixes in `baseArrayIndices`.
   */
  private _indexArrayVariable(varIdx: number, varName: string): void {
    if (!varName.includes("[")) return;
    let pos = 0;
    while ((pos = varName.indexOf("[", pos)) !== -1) {
      const base = varName.slice(0, pos);
      let list = this.baseArrayIndices.get(base);
      if (!list) {
        list = [];
        this.baseArrayIndices.set(base, list);
      }
      if (!list.includes(varIdx)) {
        list.push(varIdx);
      }
      pos++;
    }
  }

  /**
   * Removes a scalarized array variable from all base prefix entries in `baseArrayIndices`.
   */
  private _unindexArrayVariable(varIdx: number, varName: string): void {
    if (!varName.includes("[")) return;
    let pos = 0;
    while ((pos = varName.indexOf("[", pos)) !== -1) {
      const base = varName.slice(0, pos);
      const list = this.baseArrayIndices.get(base);
      if (list) {
        const idx = list.indexOf(varIdx);
        if (idx !== -1) {
          list.splice(idx, 1);
          if (list.length === 0) {
            this.baseArrayIndices.delete(base);
          }
        }
      }
      pos++;
    }
  }
  /** Map from variable index to array dimension sizes (`number[]`). */
  private varShapes = new Map<number, number[]>();
  /** Map from variable index to array dimension expression IDs (`number[]`). */
  private varShapeExprs = new Map<number, number[]>();
  /** Map from variable index to attribute map (`attrName -> exprId`). */
  private varAttrs = new Map<number, Map<string, number>>();
  /** Map from variable index to explicit binding expression ID. */
  private varExpressions = new Map<number, number>();
  /** Map from variable index to description string. */
  private varDescriptions = new Map<number, string>();
  /** Map from equation index to description string. */
  private eqDescriptions = new Map<number, string>();
  /** Map from variable index to CAD/graphical annotation payload. */
  private varCadAnnotations = new Map<number, any>();
  /** Map from variable index to custom user-defined type or record name. */
  private varCustomTypes = new Map<number, string>();
  /** Map from enumeration variable index to its ordered list of enumeration literal descriptors. */
  private varEnumLiterals = new Map<number, any[]>();
  /** Map from `When` equation index to its structured {@link WhenEquationMeta}. */
  private whenMeta = new Map<number, WhenEquationMeta>();
  /** Map from `For` equation index to its structured {@link ForEquationMeta}. */
  private forMeta = new Map<number, ForEquationMeta>();
  /** Map from `If` equation index to its structured {@link IfEquationMeta}. */
  private ifMeta = new Map<number, IfEquationMeta>();
  /** List of synchronous state machines compiled into this arena. */
  public stateMachines: ArenaStateMachine[] = [];
  /** Map from equation index to its character offset range in the originating source file. */
  private eqSourceRanges = new Map<number, { startOffset: number; endOffset: number }>();
  /** Map from equation index to explicit ordering rank for canonical output. */
  private eqOrders = new Map<number, number>();
  /** Map from variable index to its character offset range in the originating source file. */
  private varSourceRanges = new Map<number, { startOffset: number; endOffset: number }>();
  /** Dependency map from parameter name to the set of equation indices referencing that parameter. */
  private paramNameToEqs = new Map<string, Set<number>>();
  /** Host-side override map for equation kinds not natively stored in the WASM column. */
  private eqKinds = new Map<number, EqKind>();
  /** Set of equation indices marked as eliminated/removed during vector or structural passes. */
  private removedEquations = new Set<number>();
  /** Map from equation index to its pre-constant-folding right-hand side expression ID. */
  public origEqRhs = new Map<number, number>();
  /** Arena expression IDs of all `ExprKind.Name` nodes, tracked for fast variable renaming. */
  public nameExprIndices: number[] = [];
  /** Cached Block Lower Triangular (BLT) partitioning result for this arena. */
  public cachedBlt?:
    | {
        sortedEquations: number[];
        blocks: { eqIdxs: number[]; vars: number[] }[];
        varCount: number;
        eqCount: number;
      }
    | undefined;
  /** Current homotopy continuation parameter $\lambda \in [0, 1]$ during initialization. */
  public homotopyLambda?: number | undefined;
  /** Indicates whether this arena has undergone destructive in-place simulation transformations. */
  public isMutatedBySim = false;
  /** Backward-compatible accessor for isMutatedBySim. */
  public get _mutatedBySim(): boolean {
    return this.isMutatedBySim;
  }
  public set _mutatedBySim(val: boolean) {
    this.isMutatedBySim = val;
  }

  /**
   * Creates a new `WasmDaeBridge` (`DAEBuilder`) instance backed by WebAssembly linear memory.
   *
   * @param wasmExportsOrInterner - Optional WASM exports object or existing `StringInterner`.
   * @param nameOrPtr - Model/function name string, or an existing WASM `DaeBuilder` pointer.
   * @param desc - Optional model/function description comment.
   * @param interner - Optional explicit `StringInterner` instance.
   */
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
      const poolPtr = this.ptr && this.exports.dae_getStringPool ? this.exports.dae_getStringPool(this.ptr) : 0;
      this.interner = interner ?? new WasmStringPool(this.exports, poolPtr);
      this.nameId = this.interner.intern(typeof nameOrPtr === "string" ? nameOrPtr : "Model");
      this.descriptionId = this.interner.intern(desc);
    } else {
      this.exports = getDefaultWasmExports();
      this.ptr =
        typeof nameOrPtr === "number" && nameOrPtr !== 0
          ? nameOrPtr
          : this.exports?.dae_createBuilder
            ? this.exports.dae_createBuilder()
            : 0;
      const poolPtr = this.ptr && this.exports?.dae_getStringPool ? this.exports.dae_getStringPool(this.ptr) : 0;
      this.interner =
        wasmExportsOrInterner instanceof WasmStringPool ||
        (wasmExportsOrInterner && typeof wasmExportsOrInterner.intern === "function")
          ? wasmExportsOrInterner
          : (interner ?? new WasmStringPool(this.exports, poolPtr));
      const nameStr = typeof nameOrPtr === "string" ? nameOrPtr : "Model";
      this.nameId = this.interner.intern(nameStr);
      this.descriptionId = this.interner.intern(desc);
    }

    if (typeof nameOrPtr === "number" && nameOrPtr !== 0 && this.varCount > 0) {
      for (let i = 0; i < this.varCount; i++) {
        const vName = this.getVarName(i);
        if (vName) {
          this._indexArrayVariable(i, vName);
        }
      }
    }
  }

  /** Resolved name of the flattened model or function. */
  get name(): string {
    return this.interner.resolve(this.nameId) ?? "Model";
  }
  /** Updates the interned name of the flattened model or function. */
  set name(value: string) {
    this.nameId = this.interner.intern(value);
  }

  /** Resolved description comment of the flattened model or function. */
  get description(): string {
    return this.interner.resolve(this.descriptionId) ?? "";
  }
  /** Updates the interned description comment of the flattened model or function. */
  set description(value: string) {
    this.descriptionId = this.interner.intern(value);
  }

  /** Total number of variables declared in the arena. */
  get varCount(): number {
    return this.getVarCount();
  }

  /** Total number of equations in the arena. */
  get eqCount(): number {
    return this.getEqCount();
  }

  /** Total number of expression nodes in the arena. */
  get exprCount(): number {
    return this.getExprCount();
  }

  /** Total number of algorithm statements in the arena. */
  get stmtCount(): number {
    return this.getStmtCount();
  }

  /** Statement index ranges (`{ start, count }`) for each `algorithm` section. */
  get algorithmSections(): { start: number; count: number }[] {
    return this._algorithmSections;
  }

  /** Statement index ranges (`{ start, count }`) for each `initial algorithm` section. */
  get initialAlgorithmSections(): { start: number; count: number }[] {
    return this._initialAlgorithmSections;
  }

  /**
   * Records a contiguous range of statements as an `algorithm` section.
   *
   * @param startIdx - Index of the first statement in the section.
   * @param count - Number of top-level statements in the section.
   */
  addAlgorithmSection(startIdx: number, count: number): void {
    this._algorithmSections.push({ start: startIdx, count });
  }

  /**
   * Records a contiguous range of statements as an `initial algorithm` section.
   *
   * @param startIdx - Index of the first statement in the section.
   * @param count - Number of top-level statements in the section.
   */
  addInitialAlgorithmSection(startIdx: number, count: number): void {
    this._initialAlgorithmSections.push({ start: startIdx, count });
  }

  /**
   * Associates a source file location with an algorithm statement index for debugging and diagnostics.
   *
   * @param stmtIdx - Statement index in the arena.
   * @param location - Source file location.
   */
  setStmtLocation(stmtIdx: number, location: SourceLocation): void {
    this.stmtLocations.set(stmtIdx, location);
  }

  /**
   * Registers a compiled function `DAEBuilder` with this arena under its name and interned `StringId`.
   *
   * @param nameOrId - Function name string or interned `StringId`.
   * @param funcDae - Compiled function `WasmDaeBridge` arena.
   */
  addFunction(nameOrId: string | number, funcDae: WasmDaeBridge): void {
    this.functions.set(nameOrId, funcDae);
    if (typeof nameOrId === "string") {
      const id = this.interner.intern(nameOrId);
      this.functions.set(id, funcDae);
    }
  }

  /**
   * Retrieves a registered function `DAEBuilder` by name string or interned `StringId`.
   *
   * @param nameOrId - Function name string or interned `StringId`.
   * @returns The function's `WasmDaeBridge` arena, or `undefined` if not registered.
   */
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

  /**
   * Appends a new variable or parameter declaration to the WebAssembly DAE arena.
   *
   * @param nameIdOrString - Variable name string or interned `StringId`.
   * @param type - Variable primitive/enumeration type (`VarType`).
   * @param variability - Variable variability (`Continuous`, `Discrete`, `Parameter`, `Constant`).
   * @param causality - Variable causality (`Local`, `Input`, `Output`).
   * @param startVal - Numeric initial/start value.
   * @param flags - Bitmask of `FLAG_VAR_*` attributes.
   * @param shapeDim - Optional first array dimension size.
   * @returns 0-based variable index in the arena, or `-1` on failure.
   */
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
      if (idx >= 0) {
        if (shapeDim > 0) this.setVarShapeDim(idx, 0, shapeDim);
        const nameStr = typeof nameIdOrString === "string" ? nameIdOrString : this.interner.resolve(nameId);
        if (nameStr) {
          this._indexArrayVariable(idx, nameStr);
        }
      }
      return idx;
    }
    return -1;
  }

  /**
   * Looks up the 0-based variable index for a variable name or interned `StringId`,
   * accounting for any host-side variable renamings.
   *
   * @param nameOrId - Variable name string or interned `StringId`.
   * @returns 0-based variable index, or `-1` if not found.
   */
  lookupVariable(nameOrId: string | StringId): number {
    const targetName = typeof nameOrId === "string" ? nameOrId : this.interner.resolve(nameOrId);
    const nId = typeof nameOrId === "string" ? this.interner.lookup(nameOrId) : nameOrId;
    if (nId !== undefined && nId !== 0 && this.exports?.dae_lookupVariable) {
      const idx = this.exports.dae_lookupVariable(this.ptr, nId);
      if (idx >= 0) {
        if (this._renamedVars.has(idx)) {
          if (this._renamedVars.get(idx) === targetName) {
            return idx;
          }
        } else {
          return idx;
        }
      }
    }
    if (this._renamedVars.size === 0 || !targetName) {
      return -1;
    }
    const reverseIdx = this._renamedVarsReverse.get(targetName);
    return reverseIdx !== undefined ? reverseIdx : -1;
  }

  /**
   * Renames an existing variable in the arena from `oldName` to `newName`, updating
   * reverse lookup and array prefix indices.
   *
   * @param oldName - Current variable name.
   * @param newName - New variable name.
   * @returns `true` if the variable was found and renamed, `false` otherwise.
   */
  renameVar(oldName: string, newName: string): boolean {
    const varIdx = this.getVarIdxByName(oldName);
    if (varIdx < 0) return false;
    const currentName = this.getVarName(varIdx);
    this._unindexArrayVariable(varIdx, currentName);
    this._renamedVars.set(varIdx, newName);
    this._renamedVarsReverse.set(newName, varIdx);
    if (this._renamedVarsReverse.get(currentName) === varIdx) {
      this._renamedVarsReverse.delete(currentName);
    }
    this._indexArrayVariable(varIdx, newName);
    (this as any)._isRealNameCache?.clear();
    return true;
  }

  /**
   * Returns the resolved name string of the variable at index `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @returns Variable name string.
   */
  getVarName(varIdx: number): string {
    const renamed = this._renamedVars.get(varIdx);
    if (renamed !== undefined) return renamed;
    const nId = this.getVarNameId(varIdx);
    return this.interner.resolve(nId) ?? "";
  }

  /**
   * Looks up a variable index by its string name (alias for {@link lookupVariable}).
   *
   * @param name - Variable name string.
   * @returns 0-based variable index, or `-1` if not found.
   */
  getVarIdxByName(name: string): number {
    return this.lookupVariable(name);
  }

  /**
   * Looks up a variable index by its string name (alias for {@link lookupVariable}).
   *
   * @param name - Variable name string.
   * @returns 0-based variable index, or `-1` if not found.
   */
  findVar(name: string): number {
    return this.lookupVariable(name);
  }

  /**
   * Returns the interned `StringId` of the variable's original name in the WASM arena.
   *
   * @param varId - 0-based variable index.
   * @returns Interned `StringId`.
   */
  getVarNameId(varId: number): number {
    return this.exports?.dae_getVarNameId ? this.exports.dae_getVarNameId(this.ptr, varId) : 0;
  }

  /**
   * Returns the primitive or enumeration {@link VarType} of the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Variable type enum value.
   */
  getVarType(varId: number): VarType {
    return this.exports?.dae_getVarType ? (this.exports.dae_getVarType(this.ptr, varId) as VarType) : VarType.Real;
  }

  /**
   * Returns the {@link Variability} (`Continuous`, `Discrete`, `Parameter`, `Constant`) of the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Variable variability enum value.
   */
  getVarVariability(varId: number): Variability {
    return this.exports?.dae_getVarVariability
      ? (this.exports.dae_getVarVariability(this.ptr, varId) as Variability)
      : Variability.Continuous;
  }

  /**
   * Returns the {@link Causality} (`Local`, `Input`, `Output`) of the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Variable causality enum value.
   */
  getVarCausality(varId: number): Causality {
    return this.exports?.dae_getVarCausality
      ? (this.exports.dae_getVarCausality(this.ptr, varId) as Causality)
      : Causality.Local;
  }

  /**
   * Returns the raw `FLAG_VAR_*` bitmask for the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Bitmask of variable flags.
   */
  getVarFlags(varId: number): number {
    return this.exports?.dae_getVarFlags ? this.exports.dae_getVarFlags(this.ptr, varId) : 0;
  }

  /**
   * Sets the raw `FLAG_VAR_*` bitmask for the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @param flags - New bitmask of variable flags.
   */
  setVarFlags(varId: number, flags: number): void {
    if (this.exports?.dae_setVarFlags) {
      this.exports.dae_setVarFlags(this.ptr, varId, flags);
    }
  }

  /**
   * Returns the numeric `start` / initial value stored for the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @returns Numeric start value.
   */
  getVarStartValue(varId: number): number {
    return this.exports?.dae_getVarStartValue ? this.exports.dae_getVarStartValue(this.ptr, varId) : 0.0;
  }

  /**
   * Sets the numeric `start` / initial value for the variable at `varId`.
   *
   * @param varId - 0-based variable index.
   * @param val - Numeric start value.
   */
  setVarStartValue(varId: number, val: number): void {
    if (this.exports?.dae_setVarStartValue) {
      this.exports.dae_setVarStartValue(this.ptr, varId, val);
    }
  }

  /**
   * Returns the binding expression ID for `varIdx` (falling back to the `start` attribute
   * expression for parameters and constants when no explicit binding is present).
   *
   * @param varIdx - 0-based variable index.
   * @returns Expression arena ID, or `undefined` if none is set.
   */
  getVarExpression(varIdx: number): number | undefined {
    const expr = this.varExpressions.get(varIdx);
    if (expr !== undefined) return expr;
    if (this.exports?.dae_getVarAttrExpr) {
      const binding = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, VarAttrKind.Binding);
      if (binding !== 0xffffffff && binding >= 0) {
        return binding;
      }
      const attr = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, VarAttrKind.Start);
      if (attr !== 0xffffffff && attr >= 0) {
        const v = this.getVarVariability(varIdx);
        if (v === Variability.Constant || v === Variability.Parameter) {
          return attr;
        }
      }
    }
    return undefined;
  }

  /**
   * Checks whether `varIdx` has an explicit declaration binding expression (`= expr`),
   * excluding `start = expr` attribute fallbacks.
   *
   * @param varIdx - 0-based variable index.
   * @returns `true` if an explicit binding expression exists.
   */
  hasExplicitVarExpression(varIdx: number): boolean {
    return this.getExplicitVarExpression(varIdx) !== undefined;
  }

  /**
   * Returns the explicit declaration binding expression ID (`= expr`) for `varIdx`,
   * without falling back to the `start` attribute expression.
   *
   * @param varIdx - 0-based variable index.
   * @returns Binding expression ID, or `undefined` if none is set.
   */
  getExplicitVarExpression(varIdx: number): number | undefined {
    const expr = this.varExpressions.get(varIdx);
    if (expr !== undefined) return expr;
    if (this.exports?.dae_getVarAttrExpr) {
      const binding = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, VarAttrKind.Binding);
      if (binding !== 0xffffffff && binding >= 0) {
        return binding;
      }
    }
    return undefined;
  }

  /**
   * Sets the explicit declaration binding expression (`= expr`) for `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param exprId - Expression arena ID.
   */
  setVarExpression(varIdx: number, exprId: number): void {
    const prevExpr = this.varExpressions.get(varIdx);
    this.varExpressions.set(varIdx, exprId);
    this.setVarAttrExpr(varIdx, VarAttrKind.Binding, exprId);
    const existingStart = this.exports?.dae_getVarAttrExpr
      ? this.exports.dae_getVarAttrExpr(this.ptr, varIdx, VarAttrKind.Start)
      : 0xffffffff;
    if (existingStart === 0xffffffff || existingStart < 0 || existingStart === prevExpr) {
      this.setVarAttrExpr(varIdx, VarAttrKind.Start, exprId);
    }
  }

  /**
   * Returns the documentation description string attached to the variable at `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @returns Description string, or `undefined` if none is present.
   */
  getVarDescription(varIdx: number): string | undefined {
    const desc = this.varDescriptions.get(varIdx);
    if (desc !== undefined) return desc;
    if ((this.getVarFlags(varIdx) & FLAG_VAR_VIRTUAL) !== 0) {
      return "virtual variable in expandable connector";
    }
    if (this.exports?.dae_getVarAttrExpr) {
      const descExprId = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, VarAttrKind.Description);
      if (descExprId !== 0xffffffff && descExprId !== -1 && descExprId >>> 0 < this.exprCount) {
        const strId = this.getExprData1(descExprId >>> 0);
        const resolved = this.interner.resolve(strId);
        if (resolved) return resolved;
      }
    }
    return undefined;
  }

  /**
   * Checks whether `varIdx` is marked with `FLAG_VAR_VIRTUAL` (e.g., an expandable connector member).
   *
   * @param varIdx - 0-based variable index.
   * @returns `true` if virtual.
   */
  isVarVirtual(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_VIRTUAL) !== 0;
  }

  /**
   * Sets the documentation description string for the variable at `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param desc - Description string.
   */
  setVarDescription(varIdx: number, desc: string): void {
    this.varDescriptions.set(varIdx, desc);
  }

  /**
   * Returns the CAD/graphical annotation payload attached to `varIdx`, if any.
   *
   * @param varIdx - 0-based variable index.
   */
  getVarCadAnnotation(varIdx: number): any {
    return this.varCadAnnotations.get(varIdx);
  }

  /**
   * Attaches a CAD/graphical annotation payload to `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param cad - Annotation payload.
   */
  setVarCadAnnotation(varIdx: number, cad: any): void {
    this.varCadAnnotations.set(varIdx, cad);
  }

  /**
   * Checks whether the variable at `varIdx` has been marked as eliminated (`FLAG_VAR_REMOVED`).
   *
   * @param varIdx - 0-based variable index.
   */
  isVarRemoved(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_REMOVED) !== 0;
  }

  /**
   * Marks the variable at `varIdx` as eliminated (`FLAG_VAR_REMOVED`).
   *
   * @param varIdx - 0-based variable index.
   */
  removeVariable(varIdx: number): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, flags | FLAG_VAR_REMOVED);
  }

  /**
   * Alias for {@link removeVariable} marking `varIdx` as eliminated (`FLAG_VAR_REMOVED`).
   *
   * @param varIdx - 0-based variable index.
   */
  markVarRemoved(varIdx: number): void {
    this.removeVariable(varIdx);
  }

  /**
   * Checks whether the variable at `varIdx` is marked as a continuous state variable (`FLAG_VAR_STATE`).
   *
   * @param varIdx - 0-based variable index.
   */
  isVarState(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STATE) !== 0;
  }

  /**
   * Sets or clears the continuous state variable flag (`FLAG_VAR_STATE`) on `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param isState - Whether the variable is a continuous state.
   */
  setVarState(varIdx: number, isState = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isState ? flags | FLAG_VAR_STATE : flags & ~FLAG_VAR_STATE);
  }

  /**
   * Checks whether the variable at `varIdx` is marked as a state derivative (`FLAG_VAR_STATE_DER`).
   *
   * @param varIdx - 0-based variable index.
   */
  isVarStateDer(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STATE_DER) !== 0;
  }

  /**
   * Alias for {@link isVarStateDer}.
   *
   * @param varIdx - 0-based variable index.
   */
  isVarDerivative(varIdx: number): boolean {
    return this.isVarStateDer(varIdx);
  }

  /**
   * Sets or clears the state derivative flag (`FLAG_VAR_STATE_DER`) on `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param isDer - Whether the variable is a state derivative.
   */
  setVarStateDer(varIdx: number, isDer = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isDer ? flags | FLAG_VAR_STATE_DER : flags & ~FLAG_VAR_STATE_DER);
  }

  /**
   * Alias for {@link setVarStateDer}.
   */
  setVarDeriv(varIdx: number, isDer: boolean | number = true): void {
    this.setVarStateDer(varIdx, Boolean(isDer));
  }

  /**
   * Alias for {@link setVarStateDer}.
   */
  setVarDerivative(varIdx: number, isDer: boolean | number = true): void {
    this.setVarStateDer(varIdx, Boolean(isDer));
  }

  /**
   * Checks whether the variable at `varIdx` has the `flow` connector prefix (`FLAG_VAR_FLOW`).
   */
  isVarFlow(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_FLOW) !== 0;
  }

  /**
   * Sets or clears the `flow` connector prefix flag (`FLAG_VAR_FLOW`) on `varIdx`.
   */
  setVarFlow(varIdx: number, isFlow = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFlow ? flags | FLAG_VAR_FLOW : flags & ~FLAG_VAR_FLOW);
  }

  /**
   * Checks whether the variable at `varIdx` has the `stream` connector prefix (`FLAG_VAR_STREAM`).
   */
  isVarStream(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_STREAM) !== 0;
  }

  /**
   * Sets or clears the `stream` connector prefix flag (`FLAG_VAR_STREAM`) on `varIdx`.
   */
  setVarStream(varIdx: number, isStream = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isStream ? flags | FLAG_VAR_STREAM : flags & ~FLAG_VAR_STREAM);
  }

  /**
   * Returns `"stream"` or `"flow"` if the variable has the corresponding connector prefix, or `null` otherwise.
   */
  getVarFlowPrefix(varIdx: number): string | null {
    if (this.isVarStream(varIdx)) return "stream";
    if (this.isVarFlow(varIdx)) return "flow";
    return null;
  }

  /**
   * Checks whether the variable at `varIdx` has a `fixed = true` initial condition.
   */
  isVarFixed(varIdx: number): boolean {
    const attr = this.getVarAttr(varIdx, "fixed");
    if (attr !== undefined) {
      if (this.getExprKind(attr) === ExprKind.BoolLiteral) {
        return this.getExprData1(attr) !== 0;
      }
    }
    const variability = this.getVarVariability(varIdx);
    if (variability === Variability.Parameter || variability === Variability.Constant) {
      return (this.getVarFlags(varIdx) & FLAG_VAR_FIXED) !== 0 || attr === undefined;
    }
    return (this.getVarFlags(varIdx) & FLAG_VAR_FIXED) !== 0;
  }

  /**
   * Sets or clears the `FLAG_VAR_FIXED` flag on `varIdx`.
   */
  setVarFixed(varIdx: number, isFixed = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFixed ? flags | FLAG_VAR_FIXED : flags & ~FLAG_VAR_FIXED);
  }

  /**
   * Checks whether the variable at `varIdx` is declared `protected` (`FLAG_VAR_PROTECTED`).
   */
  isVarProtected(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_PROTECTED) !== 0;
  }

  /**
   * Sets or clears the `protected` visibility flag (`FLAG_VAR_PROTECTED`) on `varIdx`.
   */
  setVarProtected(varIdx: number, isProtected = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isProtected ? flags | FLAG_VAR_PROTECTED : flags & ~FLAG_VAR_PROTECTED);
  }

  /**
   * Checks whether the variable at `varIdx` is declared `final` (`FLAG_VAR_FINAL`).
   */
  isVarFinal(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_FINAL) !== 0;
  }

  /**
   * Sets or clears the `final` modification flag (`FLAG_VAR_FINAL`) on `varIdx`.
   */
  setVarFinal(varIdx: number, isFinal = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isFinal ? flags | FLAG_VAR_FINAL : flags & ~FLAG_VAR_FINAL);
  }

  /**
   * Returns the custom user-defined type or record class name associated with `varIdx`, if any.
   */
  getVarCustomType(varIdx: number): string | undefined {
    return this.varCustomTypes.get(varIdx);
  }

  /**
   * Associates a custom user-defined type or record class name with `varIdx`.
   */
  setVarCustomType(varIdx: number, customType: string): void {
    this.varCustomTypes.set(varIdx, customType);
  }

  /**
   * Returns the ordered list of enumeration literal descriptors for an enumeration variable at `varIdx`.
   */
  getVarEnumerationLiterals(varIdx: number): any[] | undefined {
    return this.varEnumLiterals.get(varIdx);
  }

  /**
   * Sets the ordered list of enumeration literal descriptors for an enumeration variable at `varIdx`.
   */
  setVarEnumerationLiterals(varIdx: number, lits: any[]): void {
    this.varEnumLiterals.set(varIdx, lits as any);
  }

  /**
   * Records the declared dimension sizes for a named array variable.
   */
  setNamedArrayShape(name: string, shape: number[]): void {
    this.namedArrayShapes.set(name, [...shape]);
  }

  /**
   * Retrieves the declared dimension sizes for a named array variable, if registered.
   */
  getNamedArrayShape(name: string): number[] | undefined {
    return this.namedArrayShapes.get(name);
  }

  /**
   * Checks whether scalarized array element variables exist for the given unsubscripted base name.
   *
   * @param baseName - Unsubscripted base variable path.
   * @returns `true` if array elements exist.
   */
  hasArrayElements(baseName: string): boolean {
    if (this.namedArrayShapes.has(baseName)) return true;
    const direct = this.baseArrayIndices.get(baseName);
    if (direct && direct.length > 0) return true;
    if (baseName.includes(".")) {
      const labelMaps: Map<string, number>[] = [];
      for (let i = 0; i < this.varCount; i++) {
        const idxs = matchVarPath(this.getVarName(i), baseName, labelMaps);
        if (idxs && idxs.length > 0) return true;
      }
    }
    return false;
  }

  /**
   * Returns the variable indices of all scalarized array elements belonging to `baseName`.
   *
   * @param baseName - Unsubscripted base variable path.
   * @returns Array of 0-based variable indices.
   */
  getArrayElementIndices(baseName: string): number[] {
    const direct = this.baseArrayIndices.get(baseName);
    if (direct && direct.length > 0) {
      return [...direct];
    }
    const indices: number[] = [];
    if (baseName.includes(".")) {
      const labelMaps: Map<string, number>[] = [];
      for (let i = 0; i < this.varCount; i++) {
        const idxs = matchVarPath(this.getVarName(i), baseName, labelMaps);
        if (idxs && idxs.length > 0) indices.push(i);
      }
    }
    return indices;
  }

  /**
   * Releases the underlying WebAssembly `DaeBuilder` allocation and clears all host-side metadata maps.
   */
  free(): void {
    if (this.ptr && this.exports?.dae_free) {
      try {
        this.exports.dae_free(this.ptr);
      } catch {
        // ignore
      }
    }
    this.ptr = 0;
    this.baseArrayIndices.clear();
    this._renamedVars.clear();
    this._renamedVarsReverse.clear();
    this.namedArrayShapes.clear();
    this.varShapes.clear();
    this.varShapeExprs.clear();
    this.varAttrs.clear();
    this.varExpressions.clear();
    this.varDescriptions.clear();
    this.eqDescriptions.clear();
    this.varCadAnnotations.clear();
    this.varCustomTypes.clear();
    this.varEnumLiterals.clear();
    this.whenMeta.clear();
    this.forMeta.clear();
    this.ifMeta.clear();
    this.stateMachines = [];
    this.eqSourceRanges.clear();
    this.eqOrders.clear();
    this.varSourceRanges.clear();
    this.paramNameToEqs.clear();
    this.origEqRhs.clear();
    this.nameExprIndices = [];
  }

  /**
   * Returns the array dimension sizes for the variable at `varIdx` (`[]` for scalar variables).
   */
  getVarShape(varIdx: number): number[] {
    return this.varShapes.get(varIdx) ?? [];
  }

  /**
   * Sets the array dimension sizes for the variable at `varIdx` and synchronizes them with WASM memory.
   */
  setVarShape(varIdx: number, shape: number[]): void {
    this.varShapes.set(varIdx, [...shape]);
    for (let d = 0; d < shape.length; d++) {
      this.setVarShapeDim(varIdx, d, shape[d]!);
    }
  }

  /**
   * Returns the array dimension expression IDs for the variable at `varIdx` (used for symbolic/non-literal dimensions).
   */
  getVarShapeExprs(varIdx: number): number[] {
    return this.varShapeExprs.get(varIdx) ?? [];
  }

  /**
   * Sets the array dimension expression IDs for the variable at `varIdx`.
   */
  setVarShapeExprs(varIdx: number, exprs: number[]): void {
    this.varShapeExprs.set(varIdx, [...exprs]);
  }

  /**
   * Returns the size of dimension `dimIdx` for the variable at `varIdx` from WASM memory.
   */
  getVarShapeDim(varIdx: number, dimIdx: number): number {
    return this.exports?.dae_getVarShapeDim ? this.exports.dae_getVarShapeDim(this.ptr, varIdx, dimIdx) : 0;
  }

  /**
   * Sets the size of dimension `dimIdx` for the variable at `varIdx` in WASM memory.
   */
  setVarShapeDim(varIdx: number, dimIdx: number, size: number): void {
    if (this.exports?.dae_setVarShapeDim) {
      this.exports.dae_setVarShapeDim(this.ptr, varIdx, dimIdx, size);
    }
  }

  /**
   * Computes the total number of scalar elements represented by `varIdx` (product of positive dimension sizes, or `1` for scalars).
   */
  getVarShapeElementCount(varIdx: number): number {
    const shape = this.getVarShape(varIdx);
    if (!shape || shape.length === 0) return 1;
    let total = 1;
    for (const d of shape) {
      if (d > 0) total *= d;
    }
    return total;
  }

  /**
   * Computes the sum of scalar element counts across all non-removed variables in the arena.
   */
  getVarTotalScalarElements(): number {
    let total = 0;
    for (let i = 0; i < this.varCount; i++) {
      if (!this.isVarRemoved(i)) {
        total += this.getVarShapeElementCount(i);
      }
    }
    return total;
  }

  /**
   * Computes the prefix-sum scalar offset table mapping each variable index to its flat scalar offset.
   */
  getVarOffsets(): Int32Array {
    const offsets = new Int32Array(this.varCount);
    let curr = 0;
    for (let i = 0; i < this.varCount; i++) {
      offsets[i] = curr;
      if (!this.isVarRemoved(i)) {
        curr += this.getVarShapeElementCount(i);
      }
    }
    return offsets;
  }

  /**
   * Returns the attribute expression ID for `attrKind` on `varIdx` directly from WASM memory.
   */
  getVarAttrExpr(varIdx: number, attrKind: VarAttrKind): number {
    return this.exports?.dae_getVarAttrExpr ? this.exports.dae_getVarAttrExpr(this.ptr, varIdx, attrKind) : 0;
  }

  /**
   * Sets the attribute expression ID for `attrKind` on `varIdx` in WASM memory.
   */
  setVarAttrExpr(varIdx: number, attrKind: VarAttrKind, exprId: number): void {
    if (this.exports?.dae_setVarAttrExpr) {
      this.exports.dae_setVarAttrExpr(this.ptr, varIdx, attrKind, exprId);
    }
  }

  /**
   * Returns the expression ID for a named variable attribute (e.g., `"start"`, `"min"`, `"unit"`).
   */
  getVarAttr(varIdx: number, attrName: string): number | undefined {
    return this.getVarAttrExprId(varIdx, attrName);
  }

  /**
   * Returns the expression ID for a named variable attribute, consulting both host-side maps and WASM attribute columns.
   */
  getVarAttrExprId(varIdx: number, attrName: string): number | undefined {
    const val = this.varAttrs.get(varIdx)?.get(attrName);
    if (val !== undefined) return val;
    if (this.exports?.dae_getVarAttrExpr) {
      const ATTR_NAMES = [
        "min",
        "max",
        "unit",
        "displayUnit",
        "nominal",
        "start",
        "fixed",
        "binding",
        "quantity",
        "description",
      ];
      const k = ATTR_NAMES.indexOf(attrName);
      if (k >= 0) {
        const exprId = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, k);
        if (exprId !== 0xffffffff && exprId !== -1 && exprId >>> 0 < this.exprCount) {
          return exprId >>> 0;
        }
      }
    }
    return undefined;
  }

  /**
   * Returns a map of all attribute names to expression IDs defined on `varIdx`.
   */
  getVarAttrExprIds(varIdx: number): Map<string, number> | undefined {
    let map = this.varAttrs.get(varIdx);
    if (this.exports?.dae_getVarAttrExpr) {
      const ATTR_NAMES = [
        "min",
        "max",
        "unit",
        "displayUnit",
        "nominal",
        "start",
        "fixed",
        "binding",
        "quantity",
        "description",
      ];
      for (let k = 0; k < ATTR_NAMES.length; k++) {
        const attrName = ATTR_NAMES[k]!;
        if (attrName === "binding" || attrName === "description") continue;
        if (!map || !map.has(attrName)) {
          const exprId = this.exports.dae_getVarAttrExpr(this.ptr, varIdx, k);
          if (exprId !== 0xffffffff && exprId !== -1 && exprId >>> 0 < this.exprCount) {
            if (!map) {
              map = new Map<string, number>();
              this.varAttrs.set(varIdx, map);
            }
            map.set(attrName, exprId >>> 0);
          }
        }
      }
    }
    return map;
  }

  public rawVarAttrs: Map<number, Map<string, number>> = new Map();

  /**
   * Sets a named attribute (`"min"`, `"max"`, `"start"`, `"fixed"`, `"unit"`, etc.) on `varIdx` to `exprId`.
   */
  setVarAttr(varIdx: number, attrName: string, exprId: number): void {
    let map = this.varAttrs.get(varIdx);
    if (!map) {
      map = new Map<string, number>();
      this.varAttrs.set(varIdx, map);
    }
    map.set(attrName, exprId);
    if (!Number.isInteger(exprId) || exprId < 0 || exprId >= this.exprCount) {
      let rawMap = this.rawVarAttrs.get(varIdx);
      if (!rawMap) {
        rawMap = new Map<string, number>();
        this.rawVarAttrs.set(varIdx, rawMap);
      }
      rawMap.set(attrName, exprId);
    } else {
      this.rawVarAttrs.get(varIdx)?.delete(attrName);
    }
    if (attrName === "start") {
      this.setVarAttrExpr(varIdx, VarAttrKind.Start, exprId);
      if (this.getExprKind(exprId) === ExprKind.RealLiteral) {
        this.setVarStartValue(varIdx, this.getExprRealValue(exprId));
      } else if (
        this.getExprKind(exprId) === ExprKind.IntLiteral ||
        this.getExprKind(exprId) === ExprKind.BoolLiteral ||
        this.getExprKind(exprId) === ExprKind.EnumLiteral
      ) {
        this.setVarStartValue(varIdx, this.getExprData1(exprId));
      }
    }
  }

  /**
   * Removes a named attribute from `varIdx` in both host-side maps and WASM memory.
   */
  removeVarAttr(varIdx: number, attrName: string): void {
    const map = this.getVarAttrExprIds(varIdx);
    if (map) {
      map.delete(attrName);
    }
    if (attrName === "binding") {
      this.varExpressions.delete(varIdx);
    } else if (attrName === "description") {
      this.varDescriptions.delete(varIdx);
    }
    if (this.exports?.dae_setVarAttrExpr) {
      const ATTR_NAMES = [
        "min",
        "max",
        "unit",
        "displayUnit",
        "nominal",
        "start",
        "fixed",
        "binding",
        "quantity",
        "description",
      ];
      const k = ATTR_NAMES.indexOf(attrName);
      if (k >= 0) {
        this.exports.dae_setVarAttrExpr(this.ptr, varIdx, k, 0xffffffff);
      }
    }
  }

  /**
   * Records a variable alias mapping from `varIdx` to `targetNameId` in WASM memory.
   */
  addAlias(varIdx: number, targetNameId: number, _negated?: boolean): void {
    if (this.exports?.dae_addAlias) this.exports.dae_addAlias(this.ptr, varIdx, targetNameId);
  }

  /**
   * Returns the alias target `StringId` for `varIdx`, or `0` if not aliased.
   */
  getAlias(varIdx: number): number {
    return this.exports?.dae_getAlias ? this.exports.dae_getAlias(this.ptr, varIdx) : 0;
  }

  /**
   * Materializes an array of summary objects for all variables in the arena.
   */
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

  /**
   * Appends an equation of the given `kind` (`lhsId = rhsId`) to the arena and registers
   * any parameter dependencies referenced by its expressions.
   *
   * @param kind - Equation kind (`EqKind`).
   * @param lhsId - Left-hand side expression arena ID.
   * @param rhsId - Right-hand side expression arena ID.
   * @param auxId - Optional auxiliary expression ID or flags bitmask.
   * @returns 0-based equation index, or `-1` on failure.
   */
  addEquation(kind: EqKind, lhsId: number, rhsId: number, auxId = 0xffffffff): number {
    if (!this.exports?.dae_addEquation) return -1;
    const eqIdx = this.exports.dae_addEquation(this.ptr, kind, lhsId, rhsId, auxId);
    if (eqIdx >= 0) {
      this.origEqRhs.set(eqIdx, rhsId);
      if (rhsId >= 0) {
        const names = this.collectExprVarNames(rhsId);
        for (const name of names) {
          this.registerParamEquationDep(name, eqIdx);
        }
      }
      if (lhsId >= 0) {
        const names = this.collectExprVarNames(lhsId);
        for (const name of names) {
          this.registerParamEquationDep(name, eqIdx);
        }
      }
    }
    return eqIdx;
  }

  /**
   * Returns the original (pre-constant-folding) right-hand side expression ID for equation `eqId`.
   */
  getOrigEqRhs(eqId: number): number {
    return this.origEqRhs.get(eqId) ?? this.getEqRhs(eqId);
  }

  /**
   * Records the original (pre-constant-folding) right-hand side expression ID for equation `eqId`.
   */
  setOrigEqRhs(eqId: number, rhs: number): void {
    this.origEqRhs.set(eqId, rhs);
  }

  /**
   * Updates the left-hand side expression ID of equation `eqId`.
   */
  setEqLhs(eqId: number, lhs: number): void {
    if (this.exports?.dae_setEqLhs) {
      this.exports.dae_setEqLhs(this.ptr, eqId, lhs);
    }
  }

  /**
   * Updates the right-hand side expression ID of equation `eqId`.
   */
  setEqRhs(eqId: number, rhs: number): void {
    if (this.exports?.dae_setEqRhs) {
      this.exports.dae_setEqRhs(this.ptr, eqId, rhs);
    }
  }

  /**
   * Updates the {@link EqKind} of equation `eqId`.
   */
  setEqKind(eqId: number, kind: EqKind): void {
    this.eqKinds.set(eqId, kind);
    if (this.exports?.dae_setEqKind) {
      this.exports.dae_setEqKind(this.ptr, eqId, kind);
    }
  }

  /**
   * Records the originating source offset range `[startOffset, endOffset]` for equation `eqIdx`.
   */
  setEqSourceRange(eqIdx: number, startOffset: number, endOffset: number): void {
    this.eqSourceRanges.set(eqIdx, { startOffset, endOffset });
  }

  /**
   * Returns the originating source offset range for equation `eqIdx`, if recorded.
   */
  getEqSourceRange(eqIdx: number): { startOffset: number; endOffset: number } | undefined {
    return this.eqSourceRanges.get(eqIdx);
  }

  /**
   * Returns the documentation description comment attached to equation `eqIdx`, if any.
   */
  getEqDescription(eqIdx: number): string | undefined {
    return this.eqDescriptions.get(eqIdx);
  }

  /**
   * Sets the documentation description comment for equation `eqIdx`.
   */
  setEqDescription(eqIdx: number, desc: string): void {
    this.eqDescriptions.set(eqIdx, desc);
  }

  /**
   * Returns the explicit canonical ordering rank for equation `eqIdx`, if set.
   */
  getEqOrder(eqIdx: number): number | undefined {
    return this.eqOrders.get(eqIdx);
  }

  /**
   * Sets the explicit canonical ordering rank for equation `eqIdx`.
   */
  setEqOrder(eqIdx: number, order: number): void {
    this.eqOrders.set(eqIdx, order);
  }

  /**
   * Finds the index of the first equation whose source offset range overlaps `[startOffset, endOffset]`,
   * or `-1` if no matching equation is found.
   */
  findEqAtRange(startOffset: number, endOffset: number): number {
    for (const [idx, range] of this.eqSourceRanges.entries()) {
      const rStart = range.startOffset;
      const rEnd = range.endOffset;
      if (startOffset >= rStart && endOffset <= rEnd) {
        return idx;
      }
      if (startOffset < rEnd && endOffset > rStart) {
        return idx;
      }
    }
    return -1;
  }

  /**
   * Records the originating source offset range `[startOffset, endOffset]` for variable `varIdx`.
   */
  setVarSourceRange(varIdx: number, startOffset: number, endOffset: number): void {
    this.varSourceRanges.set(varIdx, { startOffset, endOffset });
  }

  /**
   * Returns the originating source offset range for variable `varIdx`, if recorded.
   */
  getVarSourceRange(varIdx: number): { startOffset: number; endOffset: number } | undefined {
    return this.varSourceRanges.get(varIdx);
  }

  /**
   * Finds the index of the first variable whose source offset range overlaps `[startOffset, endOffset]`,
   * or `-1` if no matching variable is found.
   */
  findVarAtRange(startOffset: number, endOffset: number): number {
    for (const [idx, range] of this.varSourceRanges.entries()) {
      const rStart = range.startOffset;
      const rEnd = range.endOffset;
      if (startOffset >= rStart && endOffset <= rEnd) {
        return idx;
      }
      if (startOffset < rEnd && endOffset > rStart) {
        return idx;
      }
    }
    return -1;
  }

  /**
   * Assigns the attribute `attrName = attrExprId` across a batch of variable indices.
   */
  patchVarAttrBatch(varIndices: number[], attrName: string, attrExprId: number): void {
    for (const idx of varIndices) {
      this.setVarAttr(idx, attrName, attrExprId);
    }
  }

  /**
   * Shifts all recorded equation and variable source offset ranges starting after `afterOffset` by `delta`
   * following an incremental source edit.
   */
  shiftSourceRanges(afterOffset: number, delta: number): void {
    if (delta === 0) return;
    for (const [idx, range] of this.eqSourceRanges.entries()) {
      const rStart = range.startOffset;
      const rEnd = range.endOffset;
      if (rStart > afterOffset) {
        this.eqSourceRanges.set(idx, {
          startOffset: rStart + delta,
          endOffset: rEnd + delta,
        });
      }
    }
    for (const [idx, range] of this.varSourceRanges.entries()) {
      const rStart = range.startOffset;
      const rEnd = range.endOffset;
      if (rStart > afterOffset) {
        this.varSourceRanges.set(idx, {
          startOffset: rStart + delta,
          endOffset: rEnd + delta,
        });
      }
    }
  }

  /**
   * Records that equation `eqIdx` depends on the parameter `paramName`.
   */
  registerParamEquationDep(paramName: string, eqIdx: number): void {
    let set = this.paramNameToEqs.get(paramName);
    if (!set) {
      set = new Set<number>();
      this.paramNameToEqs.set(paramName, set);
    }
    set.add(eqIdx);
  }

  /**
   * Returns all equation indices that reference `paramName`.
   */
  getEquationsReferencingParam(paramName: string): number[] {
    const set = this.paramNameToEqs.get(paramName);
    if (set && set.size > 0) {
      return Array.from(set);
    }
    const eqs: number[] = [];
    for (let i = 0; i < this.eqCount; i++) {
      const lhs = this.getEqLhs(i);
      const rhs = this.getOrigEqRhs(i);
      if (this.exprReferencesName(lhs, paramName) || this.exprReferencesName(rhs, paramName)) {
        eqs.push(i);
      }
    }
    return eqs;
  }

  /**
   * Recursively checks whether the expression tree rooted at `exprId` references
   * the variable or array base name `name`.
   */
  exprReferencesName(exprId: number, name: string): boolean {
    if (exprId < 0) return false;
    const kind = this.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const varName = this.interner.resolve(this.getExprData1(exprId));
      return varName === name || varName.startsWith(`${name}[`);
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      return this.exprReferencesName(this.getExprLeft(exprId), name);
    }
    if (kind === ExprKind.Der || kind === ExprKind.Pre) {
      return this.exprReferencesName(this.getExprData1(exprId), name);
    }
    if (kind === ExprKind.Binary) {
      return (
        this.exprReferencesName(this.getExprLeft(exprId), name) ||
        this.exprReferencesName(this.getExprRight(exprId), name)
      );
    }
    if (kind === ExprKind.IfElse) {
      return (
        this.exprReferencesName(this.getExprData1(exprId), name) ||
        this.exprReferencesName(this.getExprLeft(exprId), name) ||
        this.exprReferencesName(this.getExprRight(exprId), name)
      );
    }
    if (kind === ExprKind.Subscript) {
      if (this.exprReferencesName(this.getExprData1(exprId), name)) return true;
      const subCount = this.getExprRight(exprId);
      if (subCount > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < subCount; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      } else {
        const subId = this.getExprLeft(exprId);
        if (subId >= 0 && subId !== 0xffffffff && this.exprReferencesName(subId, name)) return true;
      }
      return false;
    }
    if (kind === ExprKind.Range) {
      if (this.exprReferencesName(this.getExprData1(exprId), name)) return true;
      const stepId = this.getExprLeft(exprId);
      if (stepId >= 0 && stepId !== 0xffffffff && this.exprReferencesName(stepId, name)) return true;
      const stopId = this.getExprRight(exprId);
      if (stopId >= 0 && stopId !== 0xffffffff && this.exprReferencesName(stopId, name)) return true;
      return false;
    }
    if (kind === ExprKind.Call) {
      const argCount = this.getExprRight(exprId);
      if (argCount > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < argCount; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.ArrayCtor) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        const redirect = this.getExprRight(exprId);
        const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < count; i++) {
          if (this.exprReferencesName(this.getExprLeft(baseId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.Tuple) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < count; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.Comprehension) {
      const bodyId = this.getExprLeft(exprId);
      const iterCount = this.getExprRight(exprId);
      if (this.exprReferencesName(bodyId, name)) return true;
      for (let i = 0; i < iterCount; i++) {
        if (this.exprReferencesName(this.getExprLeft(exprId + 1 + i), name)) return true;
      }
      return false;
    }
    return false;
  }

  /**
   * Collects all variable names referenced within the expression tree rooted at `exprId`.
   */
  collectExprVarNames(
    exprId: number,
    out: Set<string> = new Set<string>(),
    visited: Set<number> = new Set<number>(),
  ): Set<string> {
    if (exprId < 0 || visited.has(exprId)) return out;
    visited.add(exprId);
    const kind = this.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const name = this.interner.resolve(this.getExprData1(exprId));
      if (name) {
        out.add(name);
        const bracketIdx = name.indexOf("[");
        if (bracketIdx > 0) {
          out.add(name.slice(0, bracketIdx));
        }
      }
      return out;
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
    } else if (kind === ExprKind.Der || kind === ExprKind.Pre) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
    } else if (kind === ExprKind.Binary) {
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
      this.collectExprVarNames(this.getExprRight(exprId), out, visited);
    } else if (kind === ExprKind.IfElse) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
      this.collectExprVarNames(this.getExprRight(exprId), out, visited);
    } else if (kind === ExprKind.Subscript) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      const subCount = this.getExprRight(exprId);
      if (subCount > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < subCount; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      } else {
        const subId = this.getExprLeft(exprId);
        if (subId >= 0 && subId !== 0xffffffff) {
          this.collectExprVarNames(subId, out, visited);
        }
      }
    } else if (kind === ExprKind.Range) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      const stepId = this.getExprLeft(exprId);
      if (stepId >= 0 && stepId !== 0xffffffff) {
        this.collectExprVarNames(stepId, out, visited);
      }
      const stopId = this.getExprRight(exprId);
      if (stopId >= 0 && stopId !== 0xffffffff) {
        this.collectExprVarNames(stopId, out, visited);
      }
    } else if (kind === ExprKind.Call) {
      const argCount = this.getExprRight(exprId);
      if (argCount > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < argCount; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      }
    } else if (kind === ExprKind.ArrayCtor) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        const redirect = this.getExprRight(exprId);
        const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < count; i++) {
          this.collectExprVarNames(this.getExprLeft(baseId + i), out, visited);
        }
      }
    } else if (kind === ExprKind.Tuple) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < count; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      }
    } else if (kind === ExprKind.Comprehension) {
      const bodyId = this.getExprLeft(exprId);
      const iterCount = this.getExprRight(exprId);
      this.collectExprVarNames(bodyId, out, visited);
      for (let i = 0; i < iterCount; i++) {
        this.collectExprVarNames(this.getExprLeft(exprId + 1 + i), out, visited);
      }
    }
    return out;
  }

  /**
   * Returns the {@link EqKind} of equation `eqId`.
   */
  getEqKind(eqId: number): EqKind {
    const overridden = this.eqKinds.get(eqId);
    if (overridden !== undefined) return overridden;
    return this.exports?.dae_getEqKind ? (this.exports.dae_getEqKind(this.ptr, eqId) as EqKind) : EqKind.Simple;
  }

  /**
   * Returns the left-hand side expression arena ID of equation `eqId`.
   */
  getEqLhs(eqId: number): number {
    return this.exports?.dae_getEqLhs ? this.exports.dae_getEqLhs(this.ptr, eqId) : -1;
  }

  /**
   * Returns the right-hand side expression arena ID of equation `eqId`.
   */
  getEqRhs(eqId: number): number {
    return this.exports?.dae_getEqRhs ? this.exports.dae_getEqRhs(this.ptr, eqId) : -1;
  }

  /**
   * Returns the auxiliary field / flags value of equation `eqId`.
   */
  getEqAux(eqId: number): number {
    return this.exports?.dae_getEqAux ? this.exports.dae_getEqAux(this.ptr, eqId) : 0;
  }

  /**
   * Returns the `FLAG_EQ_*` bitmask for equation `eqId` (alias for {@link getEqAux}).
   */
  getEqFlags(eqId: number): number {
    return this.getEqAux(eqId);
  }

  /**
   * Returns `true` if equation `eqId` is an initial equation (`initial equation` section).
   */
  isEqInitial(eqId: number): boolean {
    const kind = this.getEqKind(eqId);
    if (kind === EqKind.InitialSimple || kind === EqKind.InitialFor || kind === EqKind.InitialFunctionCall) {
      return true;
    }
    const flags = this.getEqFlags(eqId);
    return flags !== -1 && flags >>> 0 !== 0xffffffff && (flags & 1) /* FLAG_EQ_INITIAL */ !== 0;
  }

  /**
   * Checks whether equation `eqIdx` has been marked as eliminated/removed.
   *
   * @param eqIdx - 0-based equation index.
   */
  isEqRemoved(eqIdx: number): boolean {
    return this.removedEquations.has(eqIdx);
  }

  /**
   * Marks equation `eqIdx` as eliminated/removed.
   *
   * @param eqIdx - 0-based equation index.
   */
  markEqRemoved(eqIdx: number): void {
    this.removedEquations.add(eqIdx);
  }

  /**
   * Alias for {@link markEqRemoved} marking equation `eqIdx` as eliminated/removed.
   *
   * @param eqIdx - 0-based equation index.
   */
  removeEquation(eqIdx: number): void {
    this.removedEquations.add(eqIdx);
  }

  /**
   * Materializes an array of summary objects for all equations in the arena.
   */
  getEquations(): { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[] {
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

  /**
   * Appends a raw expression node (`kind`, `data1`, `left`, `right`) to the WASM expression arena.
   */
  addExpression(kind: ExprKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (!this.exports?.dae_addExpression) return -1;
    const exprId = this.exports.dae_addExpression(this.ptr, kind, data1, left, right);
    if (kind === ExprKind.Name && exprId >= 0) {
      this.nameExprIndices.push(exprId);
    }
    return exprId;
  }

  /**
   * Appends a binary operator expression (`left op right`) to the arena.
   */
  addBinaryExpr(op: BinOp, left: number, right: number): number {
    if (this.exports?.dae_addBinaryExpr) {
      return this.exports.dae_addBinaryExpr(this.ptr, op, left, right);
    }
    return this.addExpression(ExprKind.Binary, op, left, right);
  }

  /**
   * Appends a unary operator expression (`op operand`) to the arena.
   */
  addUnaryExpr(op: UnaryOp, operand: number): number {
    return this.addExpression(ExprKind.Unary, op, operand);
  }

  /**
   * Appends a 64-bit IEEE-754 floating-point literal expression (`ExprKind.RealLiteral`) to the arena.
   */
  addRealLiteral(value: number): number {
    if (this.exports?.dae_addRealLiteral) {
      return this.exports.dae_addRealLiteral(this.ptr, value);
    }
    const buf = new ArrayBuffer(8);
    const f64 = new Float64Array(buf);
    const i32 = new Int32Array(buf);
    f64[0] = value;
    const lo = i32[0]!;
    const hi = i32[1]!;
    return this.addExpression(ExprKind.RealLiteral, lo, hi, 0);
  }

  /**
   * Appends a 32-bit signed integer literal expression (`ExprKind.IntLiteral`) to the arena.
   */
  addIntLiteral(value: number): number {
    if (this.exports?.dae_addIntLiteral) {
      return this.exports.dae_addIntLiteral(this.ptr, value);
    }
    return this.addExpression(ExprKind.IntLiteral, value, 0, 0);
  }

  /**
   * Appends a boolean literal expression (`ExprKind.BoolLiteral`) to the arena.
   */
  addBoolLiteral(value: boolean): number {
    return this.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }

  /**
   * Appends a string literal expression (`ExprKind.StringLiteral`) to the arena.
   */
  addStringLiteral(value: string | number): number {
    const sId = typeof value === "string" ? this.interner.intern(value) : value;
    return this.addExpression(ExprKind.StringLiteral, sId);
  }

  /**
   * Interns `name` and appends a variable reference expression (`ExprKind.Name`) to the arena.
   */
  addNameExpr(name: string): number {
    const sId = this.interner.intern(name);
    return this.addExpression(ExprKind.Name, sId, 0, 0);
  }

  /**
   * Appends a `der(varId)` time-derivative expression to the arena.
   */
  addDer(varId: number): number {
    if (this.exports?.dae_addDer) {
      return this.exports.dae_addDer(this.ptr, varId);
    }
    return this.addExpression(ExprKind.Der, varId, 0, 0);
  }

  /**
   * Appends a `der(operand)` expression node to the arena.
   */
  addDerExpr(operand: number): number {
    return this.addExpression(ExprKind.Der, operand);
  }

  /**
   * Appends a `pre(operand)` previous-value expression node to the arena.
   */
  addPreExpr(operand: number): number {
    return this.addExpression(ExprKind.Pre, operand);
  }

  /**
   * Appends a function call expression (`funcNameOrId(args...)`) and its contiguous argument tuple slots to the arena.
   */
  addCallExpr(funcNameOrId: string | number, args: number[]): number {
    const nameId = typeof funcNameOrId === "string" ? this.interner.intern(funcNameOrId) : funcNameOrId;
    if (args.length === 0) {
      return this.addExpression(ExprKind.Call, nameId, 0xffffffff, 0);
    }
    const callId = this.addExpression(ExprKind.Call, nameId, args[0]!, args.length);
    for (let i = 1; i < args.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, args[i]!, 0);
    }
    return callId;
  }

  /**
   * Appends a tuple expression (`(e1, e2, ...)`) and its contiguous element slots to the arena.
   */
  addTupleExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.Tuple, 0, 0xffffffff, -1);
    const tupleId = this.addExpression(ExprKind.Tuple, elements.length, elements[0]!, -1);
    for (let i = 1; i < elements.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, elements[i]!, 0);
    }
    return tupleId;
  }

  /**
   * Appends an arithmetic negation expression (`-operand`) to the arena.
   */
  addNegateExpr(operand: number): number {
    return this.addExpression(ExprKind.Negate, 0, operand);
  }

  /**
   * Appends an array constructor expression (`{e1, e2, ...}`) and its contiguous element slots to the arena.
   */
  addArrayCtorExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff, -1);
    const ctorId = this.addExpression(ExprKind.ArrayCtor, elements.length, elements[0]!, -1);
    for (let i = 1; i < elements.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, elements[i]!, 0);
    }
    return ctorId;
  }

  /**
   * Appends a whole-dimension slice colon (`:`) expression to the arena.
   */
  addColonExpr(): number {
    return this.addExpression(ExprKind.Colon);
  }

  /**
   * Appends a multi-dimensional array subscript expression (`baseExpr[subIds...]`) to the arena.
   */
  addSubscriptExpr(baseExpr: number, subIds: number[]): number {
    if (subIds.length === 0) return baseExpr;
    const subId = this.addExpression(ExprKind.Subscript, baseExpr, subIds[0]!, subIds.length);
    for (let i = 1; i < subIds.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, subIds[i]!, 0);
    }
    return subId;
  }

  /**
   * Appends an enumeration literal expression (`EnumType.Literal`) with its 1-based ordinal to the arena.
   */
  addEnumLiteral(ordinal: number, pathOrValue: string): number {
    const sId = this.interner.intern(pathOrValue);
    return this.addExpression(ExprKind.EnumLiteral, ordinal, sId);
  }

  /**
   * Appends a 2-argument (`start:stop`) or 3-argument (`start:step:stop`) range expression to the arena.
   */
  addRangeExpr(startId: number, arg2: number, arg3 = -1): number {
    if (arg3 !== -1 && arg3 !== 0xffffffff) {
      // 3-arg syntax: start, step, stop
      return this.addRange(startId, arg3, arg2);
    }
    // 2-arg syntax: start, stop
    return this.addRange(startId, arg2, -1);
  }

  /**
   * Appends an array comprehension or reduction expression (`{body for i in range}`) to the arena.
   */
  addComprehensionExpr(
    funcName: string,
    bodyId: number,
    iterators: { name: string; rangeId: number }[] | number,
  ): number {
    const sId = this.interner.intern(funcName);
    if (typeof iterators === "number") {
      return this.addExpression(ExprKind.Comprehension, sId, bodyId, iterators);
    }
    const compId = this.addExpression(ExprKind.Comprehension, sId, bodyId, iterators.length);
    for (const iter of iterators) {
      const varId = this.interner.intern(iter.name);
      this.addExpression(ExprKind.Tuple, varId, iter.rangeId, 0);
    }
    return compId;
  }

  /**
   * Appends a partial function application expression (`function funcName(argIds...)`) to the arena.
   */
  addPartialFuncExpr(funcName: string, argIds: number[]): number {
    const sId = this.interner.intern(funcName);
    if (argIds.length === 0) return this.addExpression(ExprKind.PartialFunc, sId, -1, 0);
    const pfId = this.addExpression(ExprKind.PartialFunc, sId, argIds[0]!, argIds.length);
    for (let i = 1; i < argIds.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, argIds[i]!, 0);
    }
    return pfId;
  }

  /**
   * Alias for {@link addIfElse}.
   */
  addIfElseExpr(condExpr: number, trueExpr: number, falseExpr: number): number {
    return this.addIfElse(condExpr, trueExpr, falseExpr);
  }

  /**
   * Appends a variable reference expression (`ExprKind.Name`) by interned `StringId`.
   */
  addName(varId: number): number {
    if (this.exports?.dae_addName) {
      return this.exports.dae_addName(this.ptr, varId);
    }
    return this.addExpression(ExprKind.Name, varId, 0, 0);
  }

  /**
   * Appends a conditional expression (`if condExpr then trueExpr else falseExpr`) to the arena.
   */
  addIfElse(condExpr: number, trueExpr: number, falseExpr: number): number {
    if (this.exports?.dae_addIfElse) {
      return this.exports.dae_addIfElse(this.ptr, condExpr, trueExpr, falseExpr);
    }
    return this.addExpression(ExprKind.IfElse, condExpr, trueExpr, falseExpr);
  }

  /**
   * Appends a low-level function call expression node (`funcId`, `firstArg`, `argCount`) to the arena.
   */
  addCall(funcId: number, firstArg: number, argCount: number): number {
    if (this.exports?.dae_addCall) {
      return this.exports.dae_addCall(this.ptr, funcId, firstArg, argCount);
    }
    return this.addExpression(ExprKind.Call, funcId, firstArg, argCount);
  }

  /**
   * Appends a range expression (`start:step:stop` or `start:stop`) to the arena.
   */
  addRange(start: number, stop: number, step = -1): number {
    return this.addExpression(ExprKind.Range, start, step, stop);
  }

  /**
   * Appends a single-dimension array subscript expression (`baseExpr[subExpr]`) to the arena.
   */
  addSubscript(baseExpr: number, subExpr: number): number {
    return this.addSubscriptExpr(baseExpr, [subExpr]);
  }

  /**
   * Appends a raw `ExprKind.ArrayCtor` header node (`count`, `firstElem`) to the arena.
   */
  addArrayCtor(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.ArrayCtor, count, firstElem);
  }

  /**
   * Appends a raw `ExprKind.Tuple` header node (`count`, `firstElem`) to the arena.
   */
  addTuple(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.Tuple, count, firstElem);
  }

  /**
   * Returns the {@link ExprKind} of expression `exprId`.
   */
  getExprKind(exprId: number): ExprKind {
    return this.exports?.dae_getExprKind ? (this.exports.dae_getExprKind(this.ptr, exprId) as ExprKind) : ExprKind.Name;
  }

  /**
   * Returns the `data1` 32-bit integer column of expression `exprId`.
   */
  getExprData1(exprId: number): number {
    return this.exports?.dae_getExprData1 ? this.exports.dae_getExprData1(this.ptr, exprId) : 0;
  }

  /**
   * Returns the `left` 32-bit integer column of expression `exprId`.
   */
  getExprLeft(exprId: number): number {
    return this.exports?.dae_getExprLeft ? this.exports.dae_getExprLeft(this.ptr, exprId) : -1;
  }

  /**
   * Returns the `right` 32-bit integer column of expression `exprId`.
   */
  getExprRight(exprId: number): number {
    return this.exports?.dae_getExprRight ? this.exports.dae_getExprRight(this.ptr, exprId) : -1;
  }

  /**
   * Reconstructs the 64-bit IEEE-754 floating-point value of an `ExprKind.RealLiteral` node at `exprId`.
   */
  getExprRealValue(exprId: number): number {
    if (this.exports?.dae_getExprRealValue) {
      return this.exports.dae_getExprRealValue(this.ptr, exprId);
    }
    const lo = this.getExprData1(exprId);
    const hi = this.getExprLeft(exprId);
    const buf = new ArrayBuffer(8);
    const i32 = new Int32Array(buf);
    const f64 = new Float64Array(buf);
    i32[0] = lo;
    i32[1] = hi;
    return f64[0]!;
  }

  /**
   * Resolves the function name of an `ExprKind.Call` node at `exprId`, mapping built-in math
   * function IDs when necessary.
   */
  getExprFuncName(exprId: number): string {
    const funcNameId = this.getExprData1(exprId);
    const resolved = this.interner.resolve(funcNameId) ?? "";
    const BUILTIN_NAMES = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "exp",
      "log",
      "log10",
      "sqrt",
      "abs",
      "sign",
      "min",
      "max",
      "floor",
      "ceil",
      "mod",
      "pow",
      "noEvent",
      "smooth",
      "homotopy",
      "semiLinear",
    ];
    const PREDEFINED_NON_FUNC_KEYWORDS = new Set([
      "parameter",
      "constant",
      "discrete",
      "continuous",
      "input",
      "output",
      "model",
      "record",
      "block",
      "connector",
      "type",
      "package",
      "function",
      "equation",
      "algorithm",
      "initial equation",
      "initial algorithm",
      "public",
      "protected",
      "encapsulated",
      "partial",
    ]);
    if (funcNameId >= 0 && funcNameId < BUILTIN_NAMES.length) {
      if (!resolved || resolved === "<invalid>" || PREDEFINED_NON_FUNC_KEYWORDS.has(resolved)) {
        return BUILTIN_NAMES[funcNameId]!;
      }
      return resolved;
    }
    if ((!resolved || resolved === "<invalid>") && funcNameId >= 56 && funcNameId < 56 + BUILTIN_NAMES.length) {
      return BUILTIN_NAMES[funcNameId - 56]!;
    }
    return resolved;
  }

  // ── Statement Operations ──

  /**
   * Appends a raw algorithm statement node (`kind`, `data1`, `left`, `right`) to the WASM statement arena.
   */
  addStatement(kind: StmtKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (!this.exports?.dae_addStatement) return -1;
    return this.exports.dae_addStatement(this.ptr, kind, data1, left, right);
  }

  /**
   * Appends a scalar/array assignment statement (`targetExpr := valueExpr;`) to the arena.
   */
  addAssignmentStmt(targetExpr: number, valueExpr: number): number {
    return this.addStatement(StmtKind.Assignment, targetExpr, valueExpr);
  }

  /**
   * Appends an `if` algorithm statement header to the arena.
   */
  addIfStmt(condExpr: number, bodyCount: number, elseCount = 0): number {
    return this.addStatement(StmtKind.If, condExpr, bodyCount, elseCount);
  }

  /**
   * Appends a `for` loop algorithm statement header to the arena.
   */
  addForStmt(iteratorNameId: number, rangeExpr: number, bodyCount: number): number {
    return this.addStatement(StmtKind.For, iteratorNameId, rangeExpr, bodyCount);
  }

  /**
   * Appends a `while` loop algorithm statement header to the arena.
   */
  addWhileStmt(condExpr: number, bodyCount: number): number {
    return this.addStatement(StmtKind.While, condExpr, bodyCount);
  }

  /**
   * Appends a `when` algorithm statement header to the arena.
   */
  addWhenStmt(condExpr: number, bodyCount: number, elseCount = 0): number {
    return this.addStatement(StmtKind.When, condExpr, bodyCount, elseCount);
  }

  /**
   * Appends a `return;` statement to the arena.
   */
  addReturnStmt(): number {
    return this.addStatement(StmtKind.Return);
  }

  /**
   * Appends a `break;` statement to the arena.
   */
  addBreakStmt(): number {
    return this.addStatement(StmtKind.Break);
  }

  /** Host-side overrides for statement `data1` column values when mutated after creation. */
  private stmtData1Overrides = new Map<number, number>();
  /** Host-side overrides for statement `left` column values when mutated after creation. */
  private stmtLeftOverrides = new Map<number, number>();

  /**
   * Returns the {@link StmtKind} of statement `stmtId`.
   */
  getStmtKind(stmtId: number): StmtKind {
    return this.exports?.dae_getStmtKind
      ? (this.exports.dae_getStmtKind(this.ptr, stmtId) as StmtKind)
      : StmtKind.Assignment;
  }

  /**
   * Returns the `data1` 32-bit integer column of statement `stmtId`.
   */
  getStmtData1(stmtId: number): number {
    const ov = this.stmtData1Overrides.get(stmtId);
    if (ov !== undefined) return ov;
    return this.exports?.dae_getStmtData1 ? this.exports.dae_getStmtData1(this.ptr, stmtId) : 0;
  }

  /**
   * Returns the `left` 32-bit integer column of statement `stmtId`.
   */
  getStmtLeft(stmtId: number): number {
    const ov = this.stmtLeftOverrides.get(stmtId);
    if (ov !== undefined) return ov;
    return this.exports?.dae_getStmtLeft ? this.exports.dae_getStmtLeft(this.ptr, stmtId) : -1;
  }

  /**
   * Returns the `right` 32-bit integer column of statement `stmtId`.
   */
  getStmtRight(stmtId: number): number {
    return this.exports?.dae_getStmtRight ? this.exports.dae_getStmtRight(this.ptr, stmtId) : -1;
  }

  /**
   * Updates the `data1` column of statement `stmtId`.
   */
  setStmtData1(stmtId: number, data1: number): void {
    this.stmtData1Overrides.set(stmtId, data1);
    if (this.exports?.dae_setStmtData1) {
      this.exports.dae_setStmtData1(this.ptr, stmtId, data1);
    }
  }

  /**
   * Updates the `left` column of statement `stmtId`.
   */
  setStmtLeft(stmtId: number, left: number): void {
    this.stmtLeftOverrides.set(stmtId, left);
    if (this.exports?.dae_setStmtLeft) {
      this.exports.dae_setStmtLeft(this.ptr, stmtId, left);
    }
  }

  /**
   * Materializes an array of summary objects for all algorithm statements in the arena.
   */
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

  /**
   * Registers a synchronous clock definition in the WASM arena and returns its clock ID.
   */
  addClock(intervalExprId: number, resolutionExprId = 0, shiftExprId = 0): number {
    return this.exports?.dae_addClock
      ? this.exports.dae_addClock(this.ptr, intervalExprId, resolutionExprId, shiftExprId)
      : 0;
  }

  /**
   * Associates a synchronous `clockId` with the variable at `varIdx`.
   */
  setVarClock(varIdx: number, clockId: number): void {
    if (this.exports?.dae_setVarClock) this.exports.dae_setVarClock(this.ptr, varIdx, clockId);
  }

  /**
   * Returns the synchronous clock ID associated with the variable at `varIdx`, or `0` if unclocked.
   */
  getVarClock(varIdx: number): number {
    return this.exports?.dae_getVarClock ? this.exports.dae_getVarClock(this.ptr, varIdx) : 0;
  }

  /**
   * Associates a synchronous `clockId` with the equation at `eqIdx`.
   */
  setEqClock(eqIdx: number, clockId: number): void {
    if (this.exports?.dae_setEqClock) this.exports.dae_setEqClock(this.ptr, eqIdx, clockId);
  }

  /**
   * Returns the synchronous clock ID associated with the equation at `eqIdx`, or `0` if unclocked.
   */
  getEqClock(eqIdx: number): number {
    return this.exports?.dae_getEqClock ? this.exports.dae_getEqClock(this.ptr, eqIdx) : 0;
  }

  // ── Conditionals & Structured Equations ──

  /**
   * Appends a structured `When` equation (`EqKind.When`) with condition `conditionExprId`
   * and initializes its host-side {@link WhenEquationMeta} entry.
   */
  addWhenEquation(conditionExprId: number): number {
    const idx = this.addEquation(EqKind.When, conditionExprId, 0);
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

  /**
   * Appends a body equation (`lhsId = rhsId`) to an existing `When` equation at `whenIdx`.
   */
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

  /**
   * Returns the structured {@link WhenEquationMeta} for the `When` equation at `eqIdx`.
   */
  getWhenEquationMeta(eqIdx: number): WhenEquationMeta | undefined {
    return this.whenMeta.get(eqIdx);
  }

  /**
   * Sets or replaces the structured {@link WhenEquationMeta} for the `When` equation at `eqIdx`.
   */
  setWhenEquationMeta(eqIdx: number, meta: WhenEquationMeta): void {
    this.whenMeta.set(eqIdx, meta);
  }

  /**
   * Appends an unexpanded `For` loop equation (`EqKind.For`) and initializes its host-side {@link ForEquationMeta}.
   */
  addForEquation(indexNameId: number, rangeExprId: number): number {
    const idx = this.addEquation(EqKind.For, indexNameId, rangeExprId);
    if (this.exports?.dae_addForEquation) {
      this.exports.dae_addForEquation(this.ptr, indexNameId, rangeExprId);
    }
    const meta: ForEquationMeta = {
      indexNameId,
      rangeExprId,
      bodyEquations: [],
      equations: [],
    };
    this.forMeta.set(idx, meta);
    return idx;
  }

  /**
   * Appends a body equation (`lhsId = rhsId`) to an existing `For` equation at `forIdx`.
   */
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

  /**
   * Returns the structured {@link ForEquationMeta} for the `For` equation at `eqIdx`.
   */
  getForEquationMeta(eqIdx: number): ForEquationMeta | undefined {
    return this.forMeta.get(eqIdx);
  }

  /**
   * Appends a structured conditional `If` equation (`EqKind.If`) and initializes its host-side {@link IfEquationMeta}.
   */
  addIfEquation(conditionExprId: number): number {
    const idx = this.addEquation(EqKind.If, conditionExprId, 0);
    if (this.exports?.dae_addIfEquation) {
      this.exports.dae_addIfEquation(this.ptr, conditionExprId);
    }
    const meta: IfEquationMeta = {
      conditionExprId,
      thenEquations: [],
      elseIfClauses: [],
      elseEquations: [],
    };
    this.ifMeta.set(idx, meta);
    return idx;
  }

  /**
   * Appends a `then`-branch body equation (`lhsId = rhsId`) to an existing `If` equation at `ifIdx`.
   */
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

  /**
   * Returns the structured {@link IfEquationMeta} for the `If` equation at `eqIdx`.
   */
  getIfEquationMeta(eqIdx: number): IfEquationMeta | undefined {
    return this.ifMeta.get(eqIdx);
  }

  /**
   * Sets or replaces the structured {@link IfEquationMeta} for the `If` equation at `eqIdx`.
   */
  setIfEquationMeta(eqIdx: number, meta: IfEquationMeta): void {
    this.ifMeta.set(eqIdx, meta);
  }

  // ── State Machines ──

  /**
   * Registers a synchronous state machine in the WASM arena and returns its state machine ID.
   */
  addStateMachine(nameId: number, initialStateId: number): number {
    return this.exports?.dae_addStateMachine ? this.exports.dae_addStateMachine(this.ptr, nameId, initialStateId) : 0;
  }

  /**
   * Adds a state with interned name `nameId` to state machine `smId` in the WASM arena.
   */
  addState(smId: number, nameId: number): number {
    return this.exports?.dae_addState ? this.exports.dae_addState(this.ptr, smId, nameId) : 0;
  }

  /**
   * Adds a state-local equation to `stateId` within state machine `smId` in the WASM arena.
   */
  addStateEquation(smId: number, stateId: number, targetNameId: number, exprId: number, isDerivative: boolean): number {
    return this.exports?.dae_addStateEquation
      ? this.exports.dae_addStateEquation(this.ptr, smId, stateId, targetNameId, exprId, isDerivative)
      : 0;
  }

  /**
   * Adds a transition between `fromStateId` and `toStateId` in state machine `smId`.
   */
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

  /**
   * Returns all host-side synchronous state machine descriptors attached to this arena.
   */
  getStateMachines(): ArenaStateMachine[] {
    return this.stateMachines;
  }

  /**
   * Alias for {@link getVarStartValue}.
   */
  getVarStartAttr(varIdx: number): number {
    return this.getVarStartValue(varIdx);
  }

  // ── Optimization & Events ──

  /**
   * Registers a zero-crossing event indicator expression ID (`exprId`) in the arena.
   */
  addEventIndicator(exprId: number): number {
    this.eventIndicatorExprIds.push(exprId);
    return this.exports?.dae_addEventIndicator ? this.exports.dae_addEventIndicator(this.ptr, exprId) : 0;
  }

  /**
   * Returns the total number of registered zero-crossing event indicators in WASM memory.
   */
  getEventIndicatorCount(): number {
    return this.exports?.dae_getEventIndicatorCount ? this.exports.dae_getEventIndicatorCount(this.ptr) : 0;
  }

  /**
   * Returns the expression arena ID for the zero-crossing event indicator at `idx`.
   */
  getEventIndicatorExprId(idx: number): number {
    return this.exports?.dae_getEventIndicatorExprId ? this.exports.dae_getEventIndicatorExprId(this.ptr, idx) : 0;
  }

  /**
   * Sets the dynamic optimization objective terms (Mayer `objExpr`, Lagrange `integrandExpr`,
   * `startExpr`, and `finalExpr`) on the arena.
   */
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

  /**
   * Exports all variable columns into a flat packed `Int32Array` (`8` 32-bit words per variable).
   */
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

  /**
   * Exports all equation columns into a flat packed `Int32Array` (`4` 32-bit words per equation: `kind`, `lhs`, `rhs`, `aux`).
   */
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

  /**
   * Exports all expression columns into a flat packed `Int32Array` (`4` 32-bit words per expression: `kind`, `data1`, `left`, `right`).
   */
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

  /**
   * Exports all statement columns into a flat packed `Int32Array` (`4` 32-bit words per statement: `kind`, `data1`, `left`, `right`).
   */
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

  /** Stack of host-side metadata snapshots saved by {@link snapshot} and restored by {@link rollback}. */
  private _hostSnapshots: {
    varShapes: Map<number, number[]>;
    varShapeExprs: Map<number, number[]>;
    varAttrs: Map<number, Map<string, number>>;
    varExpressions: Map<number, number>;
    varDescriptions: Map<number, string>;
    eqDescriptions: Map<number, string>;
    eqKinds: Map<number, EqKind>;
    removedEquations: Set<number>;
    origEqRhs: Map<number, number>;
    whenMeta: Map<number, WhenEquationMeta>;
    forMeta: Map<number, ForEquationMeta>;
    ifMeta: Map<number, IfEquationMeta>;
    nameExprIndicesLen: number;
    paramNameToEqs: Map<string, Set<number>>;
    baseArrayIndices: Map<string, number[]>;
  }[] = [];

  /**
   * Saves a checkpoint snapshot of the current WASM arena lengths and host-side maps
   * so speculative additions can be rolled back.
   */
  snapshot(): number {
    if (this.exports?.dae_snapshot) this.exports.dae_snapshot(this.ptr);
    const snap = {
      varShapes: new Map(Array.from(this.varShapes.entries(), ([k, v]) => [k, [...v]])),
      varShapeExprs: new Map(Array.from(this.varShapeExprs.entries(), ([k, v]) => [k, [...v]])),
      varAttrs: new Map(Array.from(this.varAttrs.entries(), ([k, v]) => [k, new Map(v)])),
      varExpressions: new Map(this.varExpressions),
      varDescriptions: new Map(this.varDescriptions),
      eqDescriptions: new Map(this.eqDescriptions),
      eqKinds: new Map(this.eqKinds),
      removedEquations: new Set(this.removedEquations),
      origEqRhs: new Map(this.origEqRhs),
      whenMeta: new Map(
        Array.from(this.whenMeta.entries(), ([k, v]) => [
          k,
          {
            ...v,
            equations: [...v.equations],
            bodyEquations: [...v.bodyEquations],
            elseWhenClauses: v.elseWhenClauses.map((ew) => ({ ...ew, bodyEquations: [...ew.bodyEquations] })),
            ...(v.elseEquations ? { elseEquations: [...v.elseEquations] } : {}),
          },
        ]),
      ),
      forMeta: new Map(
        Array.from(this.forMeta.entries(), ([k, v]) => [
          k,
          { ...v, equations: [...v.equations], bodyEquations: [...v.bodyEquations] },
        ]),
      ),
      ifMeta: new Map(
        Array.from(this.ifMeta.entries(), ([k, v]) => [
          k,
          {
            ...v,
            thenEquations: [...v.thenEquations],
            elseIfClauses: v.elseIfClauses.map((ei) => ({ ...ei, bodyEquations: [...ei.bodyEquations] })),
            elseEquations: v.elseEquations ? [...v.elseEquations] : [],
          },
        ]),
      ),
      nameExprIndicesLen: this.nameExprIndices.length,
      paramNameToEqs: new Map(Array.from(this.paramNameToEqs.entries(), ([k, v]) => [k, new Set(v)])),
      baseArrayIndices: new Map(Array.from(this.baseArrayIndices.entries(), ([k, v]) => [k, [...v]])),
    };
    this._hostSnapshots.push(snap);
    return this._hostSnapshots.length - 1;
  }

  /**
   * Rolls back the WASM arena lengths and host-side maps to the most recently saved {@link snapshot}.
   */
  rollback(snapId?: number): void {
    if (this.exports?.dae_rollback) this.exports.dae_rollback(this.ptr);
    let snap = undefined;
    if (snapId !== undefined && snapId >= 0 && snapId < this._hostSnapshots.length) {
      snap = this._hostSnapshots[snapId];
      this._hostSnapshots.length = snapId;
    } else {
      snap = this._hostSnapshots.pop();
    }
    if (snap) {
      this.varShapes = snap.varShapes;
      this.varShapeExprs = snap.varShapeExprs;
      this.varAttrs = snap.varAttrs;
      this.varExpressions = snap.varExpressions;
      this.varDescriptions = snap.varDescriptions;
      this.eqDescriptions = snap.eqDescriptions;
      this.eqKinds = snap.eqKinds;
      this.removedEquations = snap.removedEquations;
      this.origEqRhs = snap.origEqRhs;
      this.whenMeta = snap.whenMeta;
      this.forMeta = snap.forMeta;
      this.ifMeta = snap.ifMeta;
      this.nameExprIndices.length = snap.nameExprIndicesLen;
      this.paramNameToEqs = snap.paramNameToEqs;
      this.baseArrayIndices = snap.baseArrayIndices;
    }
  }

  /**
   * Returns the total number of variables in the WASM arena.
   */
  getVarCount(): number {
    return this.exports?.dae_getVarCount ? this.exports.dae_getVarCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of equations in the WASM arena.
   */
  getEqCount(): number {
    return this.exports?.dae_getEqCount ? this.exports.dae_getEqCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of expression nodes in the WASM arena.
   */
  getExprCount(): number {
    return this.exports?.dae_getExprCount ? this.exports.dae_getExprCount(this.ptr) : 0;
  }

  /**
   * Returns the total number of algorithm statement nodes in the WASM arena.
   */
  getStmtCount(): number {
    return this.exports?.dae_getStmtCount ? this.exports.dae_getStmtCount(this.ptr) : 0;
  }

  /**
   * Estimates the byte footprint of the core struct-of-arrays columns in WASM linear memory.
   */
  estimateMemoryBytes(): number {
    return this.getVarCount() * 32 + this.getEqCount() * 16 + this.getExprCount() * 16 + this.getStmtCount() * 16;
  }

  /**
   * Creates a deep copy of this `WasmDaeBridge` (`DAEBuilder`), duplicating all WASM arena columns
   * and host-side metadata tables into a fresh WASM builder allocation.
   */
  clone(): WasmDaeBridge {
    const copy = new WasmDaeBridge(this.exports, 0, this.description, this.interner);
    copy.nameId = this.nameId;
    copy.descriptionId = this.descriptionId;
    copy.classKind = this.classKind;
    copy.isImpure = this.isImpure;
    copy.hasAlgorithmSection = this.hasAlgorithmSection;
    copy.hasInitialAlgorithmSection = this.hasInitialAlgorithmSection;
    copy.externalDecl = this.externalDecl;
    copy.jsSource = this.jsSource;
    copy.jsPath = this.jsPath;
    copy.objectiveExprId = this.objectiveExprId;
    copy.objectiveIntegrandExprId = this.objectiveIntegrandExprId;
    copy.startTimeExprId = this.startTimeExprId;
    copy.finalTimeExprId = this.finalTimeExprId;
    copy.homotopyLambda = this.homotopyLambda;
    copy.externalIncludes = [...this.externalIncludes];
    copy.externalObjects = this.externalObjects.map((o) => ({ ...o }));
    copy.equationAnnotations = [...this.equationAnnotations];
    copy.algorithmAnnotations = [...this.algorithmAnnotations];
    copy.diagnostics = [...this.diagnostics];
    copy.experiment = { ...this.experiment };
    copy.hiddenVarIndices = new Set(this.hiddenVarIndices);
    copy.removedEquations = new Set(this.removedEquations);
    copy.boundaryNodes = [...this.boundaryNodes];
    for (const [k, v] of this.diffusionExprIds) copy.diffusionExprIds.set(k, v);
    copy.extensionMetadata = {
      ...this.extensionMetadata,
      ...(this.extensionMetadata.webgpu && { webgpu: { ...this.extensionMetadata.webgpu } }),
      ...(this.extensionMetadata.audioClock && { audioClock: { ...this.extensionMetadata.audioClock } }),
      ...(this.extensionMetadata.sde && { sde: { ...this.extensionMetadata.sde } }),
      ...(this.extensionMetadata.bvp && {
        bvp: {
          ...this.extensionMetadata.bvp,
          boundaryConditions: this.extensionMetadata.bvp.boundaryConditions
            ? [...this.extensionMetadata.bvp.boundaryConditions]
            : undefined,
        },
      }),
      ...(this.extensionMetadata.surrogate && { surrogate: new Map(this.extensionMetadata.surrogate) }),
      ...(this.extensionMetadata.feaMesh && { feaMesh: this.extensionMetadata.feaMesh.map((x) => ({ ...x })) }),
      ...(this.extensionMetadata.cfdFlow && {
        cfdFlow: this.extensionMetadata.cfdFlow.map((x) => ({ ...x, grid: x.grid ? [...x.grid] : undefined })),
      }),
      ...(this.extensionMetadata.mbse && { mbse: { ...this.extensionMetadata.mbse } }),
      ...(this.extensionMetadata.fmuInstances && {
        fmuInstances: this.extensionMetadata.fmuInstances.map((x) => ({
          ...x,
          inputs: [...x.inputs],
          outputs: [...x.outputs],
          parameters: [...x.parameters],
          terminalMapping: x.terminalMapping ? x.terminalMapping.map((m) => ({ ...m })) : undefined,
        })),
      }),
    };
    for (const [k, v] of this.functions) copy.functions.set(k, v);
    for (const s of this._algorithmSections) copy._algorithmSections.push({ ...s });
    for (const s of this._initialAlgorithmSections) copy._initialAlgorithmSections.push({ ...s });
    for (const [k, v] of this.stmtLocations) copy.stmtLocations.set(k, { ...v });
    for (const [k, v] of this.stmtData1Overrides) copy.stmtData1Overrides.set(k, v);
    for (const [k, v] of this.stmtLeftOverrides) copy.stmtLeftOverrides.set(k, v);
    for (const [k, v] of this.varShapes) copy.varShapes.set(k, [...v]);
    for (const [k, v] of this.varShapeExprs) copy.varShapeExprs.set(k, [...v]);
    for (const [k, v] of this.varAttrs) copy.varAttrs.set(k, new Map(v));
    for (const [k, v] of this.varExpressions) copy.varExpressions.set(k, v);
    for (const [k, v] of this.varDescriptions) copy.varDescriptions.set(k, v);
    for (const [k, v] of this.varCadAnnotations) copy.varCadAnnotations.set(k, v);
    for (const [k, v] of this.varCustomTypes) copy.varCustomTypes.set(k, v);
    for (const [k, v] of this.varEnumLiterals) copy.varEnumLiterals.set(k, v);
    for (const [k, v] of this.eqDescriptions) copy.eqDescriptions.set(k, v);
    for (const [k, v] of this.eqOrders) copy.eqOrders.set(k, v);
    for (const [k, v] of this.eqKinds) copy.eqKinds.set(k, v);
    for (const [k, v] of this.whenMeta)
      copy.whenMeta.set(k, {
        ...v,
        equations: [...v.equations],
        bodyEquations: [...v.bodyEquations],
        elseWhenClauses: v.elseWhenClauses.map((ew) => ({ ...ew, bodyEquations: [...ew.bodyEquations] })),
        ...(v.elseEquations ? { elseEquations: [...v.elseEquations] } : {}),
      });
    for (const [k, v] of this.forMeta)
      copy.forMeta.set(k, { ...v, equations: [...v.equations], bodyEquations: [...v.bodyEquations] });
    for (const [k, v] of this.ifMeta)
      copy.ifMeta.set(k, {
        ...v,
        thenEquations: [...v.thenEquations],
        elseIfClauses: v.elseIfClauses.map((ei) => ({ ...ei, bodyEquations: [...ei.bodyEquations] })),
        elseEquations: v.elseEquations ? [...v.elseEquations] : [],
      });
    copy.stateMachines = this.stateMachines.map((sm) => ({ ...sm }));
    for (const [k, v] of this.eqSourceRanges) copy.eqSourceRanges.set(k, { ...v });
    for (const [k, v] of this.varSourceRanges) copy.varSourceRanges.set(k, { ...v });
    for (const [k, v] of this.paramNameToEqs) copy.paramNameToEqs.set(k, new Set(v));
    if (this._renamedVars.size > 0) {
      copy._renamedVars = new Map(this._renamedVars);
      copy._renamedVarsReverse = new Map(this._renamedVarsReverse);
    }

    for (let i = 0; i < this.varCount; i++) {
      const varName = this.getVarName(i);
      const nameId = copy.interner.intern(varName);
      copy.addVariable(
        nameId,
        this.getVarType(i),
        this.getVarVariability(i),
        this.getVarCausality(i),
        this.getVarStartValue(i),
        this.getVarFlags(i),
      );
    }
    for (let i = 0; i < this.exprCount; i++) {
      copy.addExpression(this.getExprKind(i), this.getExprData1(i), this.getExprLeft(i), this.getExprRight(i));
    }
    for (let i = 0; i < this.eqCount; i++) {
      copy.addEquation(this.getEqKind(i), this.getEqLhs(i), this.getEqRhs(i), this.getEqAux(i));
    }
    for (const [k, v] of this.origEqRhs) {
      copy.origEqRhs.set(k, v);
    }
    for (let i = 0; i < this.stmtCount; i++) {
      copy.addStatement(this.getStmtKind(i), this.getStmtData1(i), this.getStmtLeft(i), this.getStmtRight(i));
    }
    for (const id of this.eventIndicatorExprIds) {
      copy.addEventIndicator(id);
    }
    if (this.cachedBlt) {
      copy.cachedBlt = {
        sortedEquations: [...this.cachedBlt.sortedEquations],
        blocks: this.cachedBlt.blocks.map((b) => ({ eqIdxs: [...b.eqIdxs], vars: [...b.vars] })),
        varCount: this.cachedBlt.varCount,
        eqCount: this.cachedBlt.eqCount,
      };
    }
    return copy;
  }

  // ── Fluent Symbolic API ──

  /** Returns an `ArenaExpr` flyweight wrapping the given expression ID. */
  expr(id: number): ArenaExpr {
    return new ArenaExpr(this, id);
  }

  /** Returns an `ArenaEquation` flyweight wrapping the given equation ID. */
  equation(id: number): ArenaEquation {
    return new ArenaEquation(this, id);
  }

  /** Returns an array of all active `ArenaEquation` objects. */
  equations(): ArenaEquation[] {
    const list: ArenaEquation[] = [];
    const count = this.getEqCount();
    for (let i = 0; i < count; i++) {
      if (!this.isEqRemoved(i)) {
        list.push(new ArenaEquation(this, i));
      }
    }
    return list;
  }

  /** Returns an `ArenaVariable` flyweight by index or by name. */
  variable(idOrName: number | string): ArenaVariable | null {
    const idx = typeof idOrName === "number" ? idOrName : this.lookupVariable(idOrName);
    return idx >= 0 && idx < this.getVarCount() ? new ArenaVariable(this, idx) : null;
  }

  /** Returns an array of all active `ArenaVariable` objects. */
  variables(): ArenaVariable[] {
    const list: ArenaVariable[] = [];
    const count = this.getVarCount();
    for (let i = 0; i < count; i++) {
      if (!this.isVarRemoved(i)) {
        list.push(new ArenaVariable(this, i));
      }
    }
    return list;
  }

  /** Creates a real, integer, boolean, or string literal expression wrapped in an `ArenaExpr`. */
  lit(val: number | boolean | string): ArenaExpr {
    if (typeof val === "boolean") {
      return new ArenaExpr(this, this.addBoolLiteral(val));
    }
    if (typeof val === "string") {
      return new ArenaExpr(this, this.addStringLiteral(val));
    }
    return new ArenaExpr(this, this.addRealLiteral(val));
  }

  /** Creates a variable reference expression wrapped in an `ArenaExpr`. */
  varExpr(nameOrId: string | number): ArenaExpr {
    const nameStr = typeof nameOrId === "string" ? nameOrId : this.getVarName(nameOrId);
    const nameId = this.interner.intern(nameStr);
    return new ArenaExpr(this, this.addExpression(ExprKind.Name, nameId));
  }

  /** Creates a `der(...)` derivative expression wrapped in an `ArenaExpr`. */
  derExpr(nameOrId: string | number): ArenaExpr {
    const vExpr = this.varExpr(nameOrId);
    return new ArenaExpr(this, this.addDerExpr(vExpr.id));
  }
}

/** Export DAEBuilder as canonical alias to WasmDaeBridge. */
export { WasmDaeBridge as DAEBuilder };

// ─────────────────────────────────────────────────────────────────────────────
// CAS & Symbolic Differentiation Routines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the numeric value of an `IntLiteral` or `RealLiteral` expression node,
 * returning `null` for non-numeric expressions.
 */
function getNumericLiteralValue(arena: WasmDaeBridge, exprId: number): number | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  return null;
}

/**
 * Recursively checks structural and numeric equivalence of two expression nodes `a` and `b`
 * within the same `WasmDaeBridge` arena.
 */
function areArenaExprsEqual(arena: WasmDaeBridge, a: number, b: number): boolean {
  if (a === b) return true;
  if (a < 0 || b < 0) return false;
  const kindA = arena.getExprKind(a);
  const kindB = arena.getExprKind(b);
  if (kindA !== kindB) {
    const valA = getNumericLiteralValue(arena, a);
    const valB = getNumericLiteralValue(arena, b);
    return valA !== null && valB !== null && valA === valB;
  }
  switch (kindA) {
    case ExprKind.Colon:
      return true;
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(a) === arena.getExprRealValue(b);
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.Name:
      return arena.getExprData1(a) === arena.getExprData1(b);
    case ExprKind.EnumLiteral:
      return arena.getExprData1(a) === arena.getExprData1(b) && arena.getExprLeft(a) === arena.getExprLeft(b);
    case ExprKind.Der:
    case ExprKind.Pre:
      return areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b));
    case ExprKind.Negate:
      return areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b));
    case ExprKind.Unary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))
      );
    case ExprKind.Binary:
      return (
        arena.getExprData1(a) === arena.getExprData1(b) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    case ExprKind.IfElse:
      return (
        areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b)) &&
        areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    case ExprKind.Range: {
      const stepA = arena.getExprLeft(a);
      const stepB = arena.getExprLeft(b);
      const hasStepA = stepA >= 0 && stepA !== 0xffffffff;
      const hasStepB = stepB >= 0 && stepB !== 0xffffffff;
      if (hasStepA !== hasStepB) return false;
      if (hasStepA && !areArenaExprsEqual(arena, stepA, stepB)) return false;
      return (
        areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b)) &&
        areArenaExprsEqual(arena, arena.getExprRight(a), arena.getExprRight(b))
      );
    }
    case ExprKind.Call: {
      if (arena.getExprFuncName(a) !== arena.getExprFuncName(b)) return false;
      const countA = arena.getExprRight(a);
      const countB = arena.getExprRight(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    case ExprKind.Subscript: {
      if (!areArenaExprsEqual(arena, arena.getExprData1(a), arena.getExprData1(b))) return false;
      const countA = arena.getExprRight(a);
      const countB = arena.getExprRight(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    case ExprKind.ArrayCtor: {
      const countA = arena.getExprData1(a);
      const countB = arena.getExprData1(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      const redA = arena.getExprRight(a);
      const redB = arena.getExprRight(b);
      const baseA = redA >= 0 && redA !== 0xffffffff ? redA : a;
      const baseB = redB >= 0 && redB !== 0xffffffff ? redB : b;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(baseA + i), arena.getExprLeft(baseB + i))) return false;
      }
      return true;
    }
    case ExprKind.Tuple: {
      const countA = arena.getExprData1(a);
      const countB = arena.getExprData1(b);
      if (countA !== countB) return false;
      if (countA <= 0) return true;
      if (!areArenaExprsEqual(arena, arena.getExprLeft(a), arena.getExprLeft(b))) return false;
      for (let i = 1; i < countA; i++) {
        if (!areArenaExprsEqual(arena, arena.getExprLeft(a + i), arena.getExprLeft(b + i))) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * Algebraically simplifies an arena expression tree (`exprId`) in-place by folding constants,
 * eliminating additive/multiplicative identities ($x + 0 \to x$, $x \cdot 1 \to x$, $x \cdot 0 \to 0$),
 * and pruning constant-condition `if` branches.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to simplify.
 * @returns Simplified expression arena ID.
 */
export function simplifyArenaExpression(arena: WasmDaeBridge, exprId: number): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
    case ExprKind.Name:
    case ExprKind.Colon:
      return exprId;

    case ExprKind.Der:
    case ExprKind.Pre: {
      const inner = arena.getExprData1(exprId);
      const simpInner = simplifyArenaExpression(arena, inner);
      if (kind === ExprKind.Der && getNumericLiteralValue(arena, simpInner) !== null) {
        return arena.addRealLiteral(0.0);
      }
      if (simpInner === inner) return exprId;
      return arena.addExpression(kind, simpInner);
    }

    case ExprKind.Negate:
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const isNeg = kind === ExprKind.Negate || op === UnaryOp.Negate;
      const operand = arena.getExprLeft(exprId);
      const simpOp = simplifyArenaExpression(arena, operand);

      if (isNeg) {
        const numVal = getNumericLiteralValue(arena, simpOp);
        if (numVal !== null) {
          if (numVal === 0) return arena.addRealLiteral(0.0);
          return arena.getExprKind(simpOp) === ExprKind.IntLiteral
            ? arena.addIntLiteral(-numVal)
            : arena.addRealLiteral(-numVal);
        }
        const subKind = arena.getExprKind(simpOp);
        if (
          subKind === ExprKind.Negate ||
          (subKind === ExprKind.Unary && arena.getExprData1(simpOp) === UnaryOp.Negate)
        ) {
          return arena.getExprLeft(simpOp);
        }
        if (simpOp === operand) return exprId;
        return kind === ExprKind.Negate
          ? arena.addExpression(ExprKind.Negate, 0, simpOp)
          : arena.addUnaryExpr(UnaryOp.Negate, simpOp);
      }

      if (op === UnaryOp.Not) {
        if (arena.getExprKind(simpOp) === ExprKind.BoolLiteral) {
          return arena.addBoolLiteral(arena.getExprData1(simpOp) === 0);
        }
        if (arena.getExprKind(simpOp) === ExprKind.Unary && arena.getExprData1(simpOp) === UnaryOp.Not) {
          return arena.getExprLeft(simpOp);
        }
      }

      if (simpOp === operand) return exprId;
      return arena.addUnaryExpr(op, simpOp);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const rawLeft = arena.getExprLeft(exprId);
      const rawRight = arena.getExprRight(exprId);
      const left = simplifyArenaExpression(arena, rawLeft);
      const right = simplifyArenaExpression(arena, rawRight);

      const lVal = getNumericLiteralValue(arena, left);
      const rVal = getNumericLiteralValue(arena, right);
      const bothInt =
        lVal !== null &&
        rVal !== null &&
        arena.getExprKind(left) === ExprKind.IntLiteral &&
        arena.getExprKind(right) === ExprKind.IntLiteral;

      if (lVal !== null && rVal !== null) {
        switch (op) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return bothInt ? arena.addIntLiteral(lVal + rVal) : arena.addRealLiteral(lVal + rVal);
          case BinOp.Sub:
          case BinOp.ElemSub:
            return bothInt ? arena.addIntLiteral(lVal - rVal) : arena.addRealLiteral(lVal - rVal);
          case BinOp.Mul:
          case BinOp.ElemMul:
            return bothInt ? arena.addIntLiteral(lVal * rVal) : arena.addRealLiteral(lVal * rVal);
          case BinOp.Div:
          case BinOp.ElemDiv:
            if (rVal !== 0) return arena.addRealLiteral(lVal / rVal);
            break;
          case BinOp.Pow:
          case BinOp.ElemPow:
            return arena.addRealLiteral(Math.pow(lVal, rVal));
        }
      }

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
          if (lVal === 0) return right;
          if (rVal === 0) return left;
          break;

        case BinOp.Sub:
        case BinOp.ElemSub:
          if (rVal === 0) return left;
          if (lVal === 0) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, right));
          if (areArenaExprsEqual(arena, left, right)) return arena.addRealLiteral(0.0);
          break;

        case BinOp.Mul:
        case BinOp.ElemMul:
          if (lVal === 0 || rVal === 0) return arena.addRealLiteral(0.0);
          if (lVal === 1) return right;
          if (rVal === 1) return left;
          if (lVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, right));
          if (rVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, left));
          break;

        case BinOp.Div:
        case BinOp.ElemDiv:
          if (lVal === 0 && rVal !== 0) return arena.addRealLiteral(0.0);
          if (rVal === 1) return left;
          if (rVal === -1) return simplifyArenaExpression(arena, arena.addExpression(ExprKind.Negate, 0, left));
          if (areArenaExprsEqual(arena, left, right) && lVal !== 0) return arena.addRealLiteral(1.0);
          break;

        case BinOp.Pow:
        case BinOp.ElemPow:
          if (rVal === 0) return arena.addRealLiteral(1.0);
          if (rVal === 1) return left;
          if (lVal === 1) return arena.addRealLiteral(1.0);
          if (lVal === 0 && rVal !== null && rVal > 0) return arena.addRealLiteral(0.0);
          break;
      }

      if (left === rawLeft && right === rawRight) return exprId;
      return arena.addBinaryExpr(op, left, right);
    }

    case ExprKind.IfElse: {
      const cond = simplifyArenaExpression(arena, arena.getExprData1(exprId));
      const trueBranch = simplifyArenaExpression(arena, arena.getExprLeft(exprId));
      const falseBranch = simplifyArenaExpression(arena, arena.getExprRight(exprId));
      if (arena.getExprKind(cond) === ExprKind.BoolLiteral) {
        return arena.getExprData1(cond) !== 0 ? trueBranch : falseBranch;
      }
      if (areArenaExprsEqual(arena, trueBranch, falseBranch)) {
        return trueBranch;
      }
      if (
        cond === arena.getExprData1(exprId) &&
        trueBranch === arena.getExprLeft(exprId) &&
        falseBranch === arena.getExprRight(exprId)
      ) {
        return exprId;
      }
      return arena.addIfElse(cond, trueBranch, falseBranch);
    }

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      if (argCount <= 0) return exprId;
      const args: number[] = [];
      let changed = false;
      const firstArg = arena.getExprLeft(exprId);
      const simpFirst = simplifyArenaExpression(arena, firstArg);
      if (simpFirst !== firstArg) changed = true;
      args.push(simpFirst);
      for (let i = 1; i < argCount; i++) {
        const argId = arena.getExprLeft(exprId + i);
        const simpArg = simplifyArenaExpression(arena, argId);
        if (simpArg !== argId) changed = true;
        args.push(simpArg);
      }
      if (!changed) return exprId;
      return arena.addCallExpr(funcNameId, args);
    }

    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const simpBase = simplifyArenaExpression(arena, baseExpr);
      let changed = simpBase !== baseExpr;
      const subs: number[] = [];
      if (subCount > 0) {
        const s0 = arena.getExprLeft(exprId);
        const ss0 = simplifyArenaExpression(arena, s0);
        if (ss0 !== s0) changed = true;
        subs.push(ss0);
        for (let i = 1; i < subCount; i++) {
          const si = arena.getExprLeft(exprId + i);
          const ssi = simplifyArenaExpression(arena, si);
          if (ssi !== si) changed = true;
          subs.push(ssi);
        }
      }
      if (!changed) return exprId;
      return arena.addSubscriptExpr(simpBase, subs);
    }

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const se0 = simplifyArenaExpression(arena, e0);
      if (se0 !== e0) changed = true;
      elems.push(se0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(baseId + i);
        const sei = simplifyArenaExpression(arena, ei);
        if (sei !== ei) changed = true;
        elems.push(sei);
      }
      if (!changed) return exprId;
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const se0 = simplifyArenaExpression(arena, e0);
      if (se0 !== e0) changed = true;
      elems.push(se0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(exprId + i);
        const sei = simplifyArenaExpression(arena, ei);
        if (sei !== ei) changed = true;
        elems.push(sei);
      }
      if (!changed) return exprId;
      return arena.addTupleExpr(elems);
    }

    case ExprKind.Range: {
      const start = arena.getExprData1(exprId);
      const step = arena.getExprLeft(exprId);
      const stop = arena.getExprRight(exprId);
      const simpStart = simplifyArenaExpression(arena, start);
      const simpStep = step >= 0 && step !== 0xffffffff ? simplifyArenaExpression(arena, step) : step;
      const simpStop = simplifyArenaExpression(arena, stop);
      if (simpStart === start && simpStep === step && simpStop === stop) return exprId;
      return arena.addRange(simpStart, simpStop, simpStep);
    }

    default:
      return exprId;
  }
}

/**
 * Substitutes all occurrences of variable `targetNameId` with `replacementExprId` inside
 * the expression tree rooted at `exprId`, returning the resulting arena expression ID.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID.
 * @param targetNameId - Interned `StringId` of the variable to replace.
 * @param replacementExprId - Expression arena ID to substitute in place of `targetNameId`.
 * @returns Rewritten expression arena ID (or `exprId` if unchanged).
 */
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
    case ExprKind.EnumLiteral:
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

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      if (argCount <= 0) return exprId;
      const args: number[] = [];
      let changed = false;
      const firstArg = arena.getExprLeft(exprId);
      const newFirst = substituteArenaExpr(arena, firstArg, targetNameId, replacementExprId);
      if (newFirst !== firstArg) changed = true;
      args.push(newFirst);
      for (let i = 1; i < argCount; i++) {
        const argId = arena.getExprLeft(exprId + i);
        const newArg = substituteArenaExpr(arena, argId, targetNameId, replacementExprId);
        if (newArg !== argId) changed = true;
        args.push(newArg);
      }
      if (!changed) return exprId;
      return arena.addCallExpr(funcNameId, args);
    }

    case ExprKind.Subscript: {
      const baseExpr = arena.getExprData1(exprId);
      const subCount = arena.getExprRight(exprId);
      const newBase = substituteArenaExpr(arena, baseExpr, targetNameId, replacementExprId);
      let changed = newBase !== baseExpr;
      const subs: number[] = [];
      if (subCount > 0) {
        const s0 = arena.getExprLeft(exprId);
        const ns0 = substituteArenaExpr(arena, s0, targetNameId, replacementExprId);
        if (ns0 !== s0) changed = true;
        subs.push(ns0);
        for (let i = 1; i < subCount; i++) {
          const si = arena.getExprLeft(exprId + i);
          const nsi = substituteArenaExpr(arena, si, targetNameId, replacementExprId);
          if (nsi !== si) changed = true;
          subs.push(nsi);
        }
      }
      if (!changed) return exprId;
      // Also check if newBase is a Name and all subs are integer literals that match a scalarized variable
      if (arena.getExprKind(newBase) === ExprKind.Name && subs.length > 0) {
        const baseName = arena.interner.resolve(arena.getExprData1(newBase));
        if (baseName) {
          const litVals: number[] = [];
          for (const s of subs) {
            const v = getNumericLiteralValue(arena, s);
            if (v !== null && Number.isInteger(v)) litVals.push(v);
          }
          if (litVals.length === subs.length) {
            const scalarName = `${baseName}[${litVals.join(",")}]`;
            if (arena.lookupVariable(scalarName) >= 0) {
              return arena.addNameExpr(scalarName);
            }
          }
        }
      }
      return arena.addSubscriptExpr(newBase, subs);
    }

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const ne0 = substituteArenaExpr(arena, e0, targetNameId, replacementExprId);
      if (ne0 !== e0) changed = true;
      elems.push(ne0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(baseId + i);
        const nei = substituteArenaExpr(arena, ei, targetNameId, replacementExprId);
        if (nei !== ei) changed = true;
        elems.push(nei);
      }
      if (!changed) return exprId;
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      let changed = false;
      const e0 = arena.getExprLeft(exprId);
      const ne0 = substituteArenaExpr(arena, e0, targetNameId, replacementExprId);
      if (ne0 !== e0) changed = true;
      elems.push(ne0);
      for (let i = 1; i < count; i++) {
        const ei = arena.getExprLeft(exprId + i);
        const nei = substituteArenaExpr(arena, ei, targetNameId, replacementExprId);
        if (nei !== ei) changed = true;
        elems.push(nei);
      }
      if (!changed) return exprId;
      return arena.addTupleExpr(elems);
    }

    case ExprKind.Range: {
      const start = arena.getExprData1(exprId);
      const step = arena.getExprLeft(exprId);
      const stop = arena.getExprRight(exprId);
      const newStart = substituteArenaExpr(arena, start, targetNameId, replacementExprId);
      const newStep =
        step >= 0 && step !== 0xffffffff ? substituteArenaExpr(arena, step, targetNameId, replacementExprId) : step;
      const newStop = substituteArenaExpr(arena, stop, targetNameId, replacementExprId);
      if (newStart === start && newStep === step && newStop === stop) return exprId;
      return arena.addRange(newStart, newStop, newStep);
    }

    case ExprKind.Comprehension: {
      const sId = arena.getExprData1(exprId);
      const bodyId = arena.getExprLeft(exprId);
      const iterCount = arena.getExprRight(exprId);
      const iters: { iterNameId: number; rangeExprId: number }[] = [];
      let shadowed = false;
      let changed = false;
      for (let i = 0; i < iterCount; i++) {
        const iterSlot = exprId + 1 + i;
        const iterNameId = arena.getExprData1(iterSlot);
        const rangeExprId = arena.getExprLeft(iterSlot);
        const newRangeExprId = shadowed
          ? rangeExprId
          : substituteArenaExpr(arena, rangeExprId, targetNameId, replacementExprId);
        if (newRangeExprId !== rangeExprId) changed = true;
        if (iterNameId === targetNameId) shadowed = true;
        iters.push({ iterNameId, rangeExprId: newRangeExprId });
      }
      const newBodyId = shadowed ? bodyId : substituteArenaExpr(arena, bodyId, targetNameId, replacementExprId);
      if (newBodyId !== bodyId) changed = true;
      if (!changed) return exprId;
      const compId = arena.addExpression(ExprKind.Comprehension, sId, newBodyId, iters.length);
      for (const iter of iters) {
        arena.addExpression(ExprKind.Tuple, iter.iterNameId, iter.rangeExprId, 0);
      }
      return compId;
    }

    default:
      return exprId;
  }
}

/**
 * Symbolically differentiates an arena expression (`exprId`) with respect to a single variable
 * (name string or interned `StringId`) or computes the total time derivative with respect to a
 * set of time-varying variable `StringId`s.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to differentiate.
 * @param wrt - Variable name, interned `StringId`, or set of time-varying `StringId`s.
 * @returns Differentiated expression arena ID.
 */
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

/**
 * Retrieves the expression arena ID of the second argument of a function call node (`exprId`).
 */
function getCallSecondArgId(arena: WasmDaeBridge, exprId: number, firstArgId: number): number {
  if (exprId + 1 < arena.exprCount && arena.getExprKind(exprId + 1) === ExprKind.Tuple) {
    return arena.getExprLeft(exprId + 1);
  }
  const right = arena.getExprRight(exprId);
  if (right >= 0 && right < exprId && !(right === 2 && exprId === firstArgId + 2)) {
    return right;
  }
  return firstArgId + 1 < arena.exprCount ? firstArgId + 1 : right;
}

/**
 * Retrieves the expression arena ID of the third argument of a function call node (`exprId`).
 */
function getCallThirdArgId(arena: WasmDaeBridge, exprId: number, firstArgId: number): number {
  if (exprId + 2 < arena.exprCount && arena.getExprKind(exprId + 2) === ExprKind.Tuple) {
    return arena.getExprLeft(exprId + 2);
  }
  return firstArgId + 2 < arena.exprCount ? firstArgId + 2 : arena.getExprLeft(exprId + 2);
}

/**
 * Reconstructs the canonical string name and intermediate interned `StringId`s for a `Name`,
 * `Subscript`, or `Der` expression node during symbolic differentiation.
 */
function formatArenaDerOrSubscriptName(
  arena: WasmDaeBridge,
  exprId: number,
): { fullName: string; baseNameId: number; intermediateNameIds: number[] } | null {
  if (exprId < 0 || exprId >= arena.exprCount) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const name = arena.interner.resolve(nameId);
    if (!name) return null;
    return { fullName: name, baseNameId: nameId, intermediateNameIds: [nameId] };
  }
  if (kind === ExprKind.Subscript) {
    const baseId = arena.getExprData1(exprId);
    const subCount = arena.getExprRight(exprId);
    const baseInfo = formatArenaDerOrSubscriptName(arena, baseId);
    if (!baseInfo) return null;
    const subStrs: string[] = [];
    for (let i = 0; i < subCount; i++) {
      const sId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
      if (sId < 0) continue;
      const sk = arena.getExprKind(sId);
      if (sk === ExprKind.IntLiteral) {
        subStrs.push(String(arena.getExprData1(sId)));
      } else if (sk === ExprKind.RealLiteral) {
        subStrs.push(String(arena.getExprRealValue(sId)));
      } else if (sk === ExprKind.Name) {
        subStrs.push(arena.interner.resolve(arena.getExprData1(sId)) ?? "");
      } else {
        const subInfo = formatArenaDerOrSubscriptName(arena, sId);
        if (subInfo) subStrs.push(subInfo.fullName);
      }
    }
    const subName = `${baseInfo.fullName}[${subStrs.join(",")}]`;
    const subNameId = arena.interner.intern(subName);
    const ids = [...baseInfo.intermediateNameIds, subNameId];
    if (subStrs.length > 1) {
      ids.push(arena.interner.intern(`${baseInfo.fullName}[${subStrs.join(", ")}]`));
    }
    return { fullName: subName, baseNameId: baseInfo.baseNameId, intermediateNameIds: ids };
  }
  if (kind === ExprKind.Der) {
    const innerId = arena.getExprData1(exprId);
    const innerInfo = formatArenaDerOrSubscriptName(arena, innerId);
    if (!innerInfo) return null;
    const derName = `der(${innerInfo.fullName})`;
    const derNameId = arena.interner.intern(derName);
    return {
      fullName: derName,
      baseNameId: innerInfo.baseNameId,
      intermediateNameIds: [...innerInfo.intermediateNameIds, derNameId],
    };
  }
  return null;
}

function isZeroLiteral(arena: WasmDaeBridge, exprId: number): boolean {
  const val = getNumericLiteralValue(arena, exprId);
  return val === 0;
}

/**
 * Applies the chain rule to differentiate a built-in mathematical or Modelica intrinsic
 * function call node (`exprId`) using the provided recursive child differentiation callback `diffFn`.
 */
function differentiateCallCommon(arena: WasmDaeBridge, exprId: number, diffFn: (childId: number) => number): number {
  const rawName = arena.getExprFuncName(exprId);
  const funcName = rawName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
  const argCount = arena.getExprRight(exprId);
  const firstArgId = arena.getExprLeft(exprId);

  if (
    (funcName === "noEvent" ||
      funcName === "/*Real*/" ||
      funcName === "/*Integer*/" ||
      funcName === "/*Boolean*/" ||
      funcName === "Real") &&
    argCount >= 1
  ) {
    return diffFn(firstArgId);
  }
  if (
    funcName === "sign" ||
    funcName === "floor" ||
    funcName === "ceil" ||
    funcName === "integer" ||
    funcName === "Integer" ||
    funcName === "div"
  ) {
    return arena.addRealLiteral(0.0);
  }
  if ((funcName === "mod" || funcName === "rem" || funcName === "fmod") && argCount >= 1) {
    const dx = diffFn(firstArgId);
    if (argCount >= 2) {
      const yId = getCallSecondArgId(arena, exprId, firstArgId);
      const dy = diffFn(yId);
      if (!isZeroLiteral(arena, dy)) {
        const floorXY = arena.addCallExpr("floor", [arena.addBinaryExpr(BinOp.Div, firstArgId, yId)]);
        return arena.addBinaryExpr(BinOp.Sub, dx, arena.addBinaryExpr(BinOp.Mul, floorXY, dy));
      }
    }
    return dx;
  }
  if (funcName === "smooth" && argCount >= 2) {
    return diffFn(getCallSecondArgId(arena, exprId, firstArgId));
  }
  if (funcName === "homotopy" && argCount >= 2) {
    const dActual = diffFn(firstArgId);
    const secondArgId = getCallSecondArgId(arena, exprId, firstArgId);
    const dSimplified = diffFn(secondArgId);
    return arena.addCallExpr("homotopy", [dActual, dSimplified]);
  }
  if (funcName === "min" && argCount >= 2) {
    const aId = firstArgId;
    const bId = getCallSecondArgId(arena, exprId, firstArgId);
    const da = diffFn(aId);
    const db = diffFn(bId);
    const cond = arena.addBinaryExpr(BinOp.Lt, aId, bId);
    return arena.addIfElse(cond, da, db);
  }
  if (funcName === "max" && argCount >= 2) {
    const aId = firstArgId;
    const bId = getCallSecondArgId(arena, exprId, firstArgId);
    const da = diffFn(aId);
    const db = diffFn(bId);
    const cond = arena.addBinaryExpr(BinOp.Gt, aId, bId);
    return arena.addIfElse(cond, da, db);
  }
  if (funcName === "semiLinear" && argCount >= 3) {
    const xId = firstArgId;
    const kPosId = getCallSecondArgId(arena, exprId, firstArgId);
    const kNegId = getCallThirdArgId(arena, exprId, firstArgId);
    const dx = diffFn(xId);
    const dkPos = diffFn(kPosId);
    const dkNeg = diffFn(kNegId);
    const cond = arena.addBinaryExpr(BinOp.Gte, xId, arena.addRealLiteral(0.0));
    let posBranch = arena.addBinaryExpr(BinOp.Mul, kPosId, dx);
    if (!isZeroLiteral(arena, dkPos)) {
      posBranch = arena.addBinaryExpr(BinOp.Add, posBranch, arena.addBinaryExpr(BinOp.Mul, xId, dkPos));
    }
    let negBranch = arena.addBinaryExpr(BinOp.Mul, kNegId, dx);
    if (!isZeroLiteral(arena, dkNeg)) {
      negBranch = arena.addBinaryExpr(BinOp.Add, negBranch, arena.addBinaryExpr(BinOp.Mul, xId, dkNeg));
    }
    return arena.addIfElse(cond, posBranch, negBranch);
  }
  if (funcName === "pow" && argCount >= 2) {
    const left = firstArgId;
    const right = getCallSecondArgId(arena, exprId, firstArgId);
    const dLeft = diffFn(left);
    const dRight = diffFn(right);
    const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
    const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
    const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
    const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
    if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
      return term1;
    }
    const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
    const ln_u = arena.addCallExpr("log", [left]);
    const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
    return arena.addBinaryExpr(BinOp.Add, term1, term2);
  }
  if (funcName === "sin" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cosU = arena.addCallExpr("cos", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, cosU, du);
  }
  if (funcName === "cos" && argCount === 1) {
    const du = diffFn(firstArgId);
    const sinU = arena.addCallExpr("sin", [firstArgId]);
    const negSinU = arena.addExpression(ExprKind.Negate, 0, sinU);
    return arena.addBinaryExpr(BinOp.Mul, negSinU, du);
  }
  if (funcName === "tan" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cosU = arena.addCallExpr("cos", [firstArgId]);
    const cos2U = arena.addBinaryExpr(BinOp.Mul, cosU, cosU);
    return arena.addBinaryExpr(BinOp.Div, du, cos2U);
  }
  if (funcName === "asin" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const oneMinusU2 = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), u2);
    const denom = arena.addCallExpr("sqrt", [oneMinusU2]);
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "acos" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const oneMinusU2 = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), u2);
    const denom = arena.addCallExpr("sqrt", [oneMinusU2]);
    return arena.addExpression(ExprKind.Negate, 0, arena.addBinaryExpr(BinOp.Div, du, denom));
  }
  if (funcName === "atan" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const denom = arena.addBinaryExpr(BinOp.Add, arena.addRealLiteral(1.0), u2);
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "atan2" && argCount >= 2) {
    const yId = firstArgId;
    const xId = getCallSecondArgId(arena, exprId, firstArgId);
    const dy = diffFn(yId);
    const dx = diffFn(xId);
    const xDy = arena.addBinaryExpr(BinOp.Mul, xId, dy);
    const yDx = arena.addBinaryExpr(BinOp.Mul, yId, dx);
    const num = arena.addBinaryExpr(BinOp.Sub, xDy, yDx);
    const x2 = arena.addBinaryExpr(BinOp.Mul, xId, xId);
    const y2 = arena.addBinaryExpr(BinOp.Mul, yId, yId);
    const denom = arena.addBinaryExpr(BinOp.Add, x2, y2);
    return arena.addBinaryExpr(BinOp.Div, num, denom);
  }
  if (funcName === "sinh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const coshU = arena.addCallExpr("cosh", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, coshU, du);
  }
  if (funcName === "cosh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const sinhU = arena.addCallExpr("sinh", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, sinhU, du);
  }
  if (funcName === "tanh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const tanhU = arena.addCallExpr("tanh", [firstArgId]);
    const tanh2U = arena.addBinaryExpr(BinOp.Mul, tanhU, tanhU);
    const sech2U = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), tanh2U);
    return arena.addBinaryExpr(BinOp.Mul, sech2U, du);
  }
  if (funcName === "exp" && argCount === 1) {
    const du = diffFn(firstArgId);
    const expU = arena.addCallExpr("exp", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, expU, du);
  }
  if (funcName === "log" && argCount === 1) {
    const du = diffFn(firstArgId);
    return arena.addBinaryExpr(BinOp.Div, du, firstArgId);
  }
  if (funcName === "log10" && argCount === 1) {
    const du = diffFn(firstArgId);
    const denom = arena.addBinaryExpr(BinOp.Mul, firstArgId, arena.addRealLiteral(Math.LN10));
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "sqrt" && argCount === 1) {
    const du = diffFn(firstArgId);
    const twoSqrtU = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addCallExpr("sqrt", [firstArgId]));
    return arena.addBinaryExpr(BinOp.Div, du, twoSqrtU);
  }
  if (funcName === "abs" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cond = arena.addBinaryExpr(BinOp.Gte, firstArgId, arena.addRealLiteral(0.0));
    const negDu = arena.addExpression(ExprKind.Negate, 0, du);
    return arena.addIfElse(cond, du, negDu);
  }
  return arena.addRealLiteral(0.0);
}

/**
 * Computes the partial derivative $\frac{\partial(\text{exprId})}{\partial(\text{wrtVarId})}$ of an arena
 * expression with respect to a single variable's interned `StringId`.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to differentiate.
 * @param wrtVarId - Interned `StringId` of the variable to differentiate with respect to.
 * @returns Differentiated expression arena ID.
 */
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

    case ExprKind.Subscript: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info) {
        const fullNameId = arena.interner.intern(info.fullName);
        if (fullNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
        const baseName = arena.interner.resolve(info.baseNameId);
        const isScalarizedElemPresent =
          arena.lookupVariable(fullNameId) >= 0 || (baseName ? arena.hasArrayElements(baseName) : false);
        if (!isScalarizedElemPresent && info.baseNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info && arena.interner.intern(info.fullName) === wrtVarId) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      if (op === UnaryOp.Negate) {
        const operand = arena.getExprLeft(exprId);
        return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
        case BinOp.Sub:
        case BinOp.ElemSub: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul:
        case BinOp.ElemMul: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div:
        case BinOp.ElemDiv: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow:
        case BinOp.ElemPow: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
          if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
            return term1;
          }
          const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
          const ln_u = arena.addCallExpr("log", [left]);
          const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
          return arena.addBinaryExpr(BinOp.Add, term1, term2);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const dTrue = differentiateArenaExpressionWrt(arena, trueBranch, wrtVarId);
      const dFalse = differentiateArenaExpressionWrt(arena, falseBranch, wrtVarId);
      return arena.addIfElse(cond, dTrue, dFalse);
    }

    case ExprKind.Call:
      return differentiateCallCommon(arena, exprId, (childId) =>
        differentiateArenaExpressionWrt(arena, childId, wrtVarId),
      );

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId), wrtVarId));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(baseId + i), wrtVarId));
      }
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId), wrtVarId));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId + i), wrtVarId));
      }
      return arena.addTupleExpr(elems);
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

/**
 * Total time derivative d(expr)/dt given the set of time-varying state/variable StringIds `wrtVarIds`.
 * By the chain rule, d/dt(x) = der(x) for every x in `wrtVarIds`, and d/dt(time) = 1.0.
 */
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
      const name = arena.interner.resolve(nameId);
      if (name === "time") {
        return arena.addRealLiteral(1.0);
      }
      if (wrtVarIds.has(nameId)) {
        return arena.addDerExpr(exprId);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Subscript: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info) {
        const fullNameId = arena.interner.intern(info.fullName);
        if (wrtVarIds.has(fullNameId)) {
          return arena.addDerExpr(exprId);
        }
        const baseName = arena.interner.resolve(info.baseNameId);
        const isScalarizedElemPresent =
          arena.lookupVariable(fullNameId) >= 0 || (baseName ? arena.hasArrayElements(baseName) : false);
        if (!isScalarizedElemPresent && info.intermediateNameIds.some((id) => wrtVarIds.has(id))) {
          return arena.addDerExpr(exprId);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info && info.intermediateNameIds.some((id) => wrtVarIds.has(id))) {
        return arena.addDerExpr(exprId);
      }
      const argId = arena.getExprData1(exprId);
      if (argId >= 0) {
        const dArg = differentiateArenaExpressionWrtSet(arena, argId, wrtVarIds);
        if (arena.getExprKind(dArg) !== ExprKind.RealLiteral || arena.getExprRealValue(dArg) !== 0.0) {
          return arena.addDerExpr(exprId);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrtSet(arena, operand, wrtVarIds));
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      if (op === UnaryOp.Negate) {
        const operand = arena.getExprLeft(exprId);
        return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrtSet(arena, operand, wrtVarIds));
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
        case BinOp.Sub:
        case BinOp.ElemSub: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul:
        case BinOp.ElemMul: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div:
        case BinOp.ElemDiv: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow:
        case BinOp.ElemPow: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
          if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
            return term1;
          }
          const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
          const ln_u = arena.addCallExpr("log", [left]);
          const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
          return arena.addBinaryExpr(BinOp.Add, term1, term2);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const dTrue = differentiateArenaExpressionWrtSet(arena, trueBranch, wrtVarIds);
      const dFalse = differentiateArenaExpressionWrtSet(arena, falseBranch, wrtVarIds);
      return arena.addIfElse(cond, dTrue, dFalse);
    }

    case ExprKind.Call:
      return differentiateCallCommon(arena, exprId, (childId) =>
        differentiateArenaExpressionWrtSet(arena, childId, wrtVarIds),
      );

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId), wrtVarIds));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(baseId + i), wrtVarIds));
      }
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId), wrtVarIds));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId + i), wrtVarIds));
      }
      return arena.addTupleExpr(elems);
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

/**
 * Performs union-find alias elimination across trivial equality and connection equations
 * (`x = y`) in `dae`, propagating `start` and `fixed` attributes to the canonical representative
 * variable and rewriting `ExprKind.Name` references in-place.
 *
 * @param dae - Target `WasmDaeBridge` (`DAEBuilder`) arena.
 */
export function eliminateArenaAliases(dae: WasmDaeBridge): void {
  if (
    typeof dae.exports?.dae_eliminateAliases === "function" &&
    (!dae.stateMachines || dae.stateMachines.length === 0)
  ) {
    dae.exports.dae_eliminateAliases(dae.ptr);
    return;
  }

  const aliasMap = new Map<number, number>();

  function find(id: number): number {
    let curr = id;
    while (aliasMap.has(curr)) {
      curr = aliasMap.get(curr)!;
    }
    return curr;
  }

  const connectorPrefixes = new Set<string>();
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarFlow(i) || dae.isVarStream(i)) {
      const vn = dae.getVarName(i);
      const lastDot = vn.lastIndexOf(".");
      if (lastDot > 0) {
        connectorPrefixes.add(vn.slice(0, lastDot));
      }
    }
  }

  function getVarScore(nameId: number): number {
    const vIdx = dae.lookupVariable(nameId);
    const name = dae.interner.resolve(nameId) || "";
    let score = 0;
    if (vIdx >= 0) {
      if (dae.getVarVariability(vIdx) === Variability.Continuous) score += 1000;
    }
    const lastDot = name.lastIndexOf(".");
    const parentPrefix = lastDot > 0 ? name.slice(0, lastDot) : "";
    if (
      (parentPrefix && connectorPrefixes.has(parentPrefix)) ||
      name.includes(".flange") ||
      name.includes(".port") ||
      name.includes(".support")
    ) {
      score -= 500;
    }
    const dotCount = (name.match(/\./g) || []).length;
    score -= dotCount * 10;
    score -= name.length;
    return score;
  }

  function union(id1: number, id2: number): void {
    const root1 = find(id1);
    const root2 = find(id2);
    if (root1 !== root2) {
      if (getVarScore(root1) >= getVarScore(root2)) {
        aliasMap.set(root2, root1);
      } else {
        aliasMap.set(root1, root2);
      }
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i) || dae.isEqInitial(i)) continue;
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Connect || kind === EqKind.Simple) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (lhs >= 0 && rhs >= 0 && dae.getExprKind(lhs) === ExprKind.Name && dae.getExprKind(rhs) === ExprKind.Name) {
        const name1 = dae.getExprData1(lhs);
        const name2 = dae.getExprData1(rhs);
        const vIdx1 = dae.lookupVariable(name1);
        const vIdx2 = dae.lookupVariable(name2);
        if ((vIdx1 >= 0 && dae.isVarFlow(vIdx1)) || (vIdx2 >= 0 && dae.isVarFlow(vIdx2))) {
          continue;
        }
        if (vIdx1 >= 0 && vIdx2 >= 0 && dae.getVarType(vIdx1) !== dae.getVarType(vIdx2)) {
          continue;
        }
        union(name1, name2);
      }
    }
  }

  if (aliasMap.size === 0) return;

  for (const elimNameId of aliasMap.keys()) {
    const rootNameId = find(elimNameId);
    if (rootNameId === elimNameId) continue;
    const vElim = dae.lookupVariable(elimNameId);
    const vRoot = dae.lookupVariable(rootNameId);
    if (vElim < 0 || vRoot < 0 || vElim === vRoot) continue;

    if (dae.isVarFixed(vElim) && !dae.isVarFixed(vRoot)) {
      dae.setVarFixed(vRoot, true);
      const fixedAttr = dae.getVarAttrExprId(vElim, "fixed");
      if (fixedAttr !== undefined) {
        dae.setVarAttrExpr(vRoot, VarAttrKind.Fixed, fixedAttr);
      }
    }

    const elimStartVal = dae.getVarStartValue(vElim);
    if (elimStartVal !== 0 && dae.getVarStartValue(vRoot) === 0) {
      dae.setVarStartValue(vRoot, elimStartVal);
    }

    const elimStartAttr = dae.getVarAttrExprId(vElim, "start");
    if (elimStartAttr !== undefined && dae.getVarAttrExprId(vRoot, "start") === undefined) {
      dae.setVarAttrExpr(vRoot, VarAttrKind.Start, elimStartAttr);
    }

    dae.removeVariable(vElim);
    dae.addAlias(vElim, rootNameId, false);
  }

  const nameIndices = (dae as any).nameExprIndices;
  if (nameIndices && Array.isArray(nameIndices) && nameIndices.length > 0) {
    for (const exprId of nameIndices) {
      const nameId = dae.getExprData1(exprId);
      const rootId = find(nameId);
      if (rootId !== nameId) {
        if (dae.exports?.dae_setExprData1) {
          dae.exports.dae_setExprData1(dae.ptr, exprId, rootId);
        }
      }
    }
  } else {
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

  // Update targetNameId in stateMachines if any state equation targets an aliased variable
  const updateStateMachineAliases = (sm: ArenaStateMachine): void => {
    for (const st of sm.states) {
      for (const eq of st.equations) {
        const rootId = find(eq.targetNameId);
        if (rootId !== eq.targetNameId) {
          eq.targetNameId = rootId;
        }
      }
      if (st.stateMachines) {
        for (const childSm of st.stateMachines) {
          updateStateMachineAliases(childSm);
        }
      }
    }
  };
  for (const sm of dae.stateMachines) {
    updateStateMachineAliases(sm);
  }

  // Remove trivial self-equations (x = x) introduced by alias substitution in non-initial equations
  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i) || dae.isEqInitial(i)) continue;
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Simple || kind === EqKind.Connect) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (
        lhs >= 0 &&
        rhs >= 0 &&
        (lhs === rhs ||
          (dae.getExprKind(lhs) === ExprKind.Name &&
            dae.getExprKind(rhs) === ExprKind.Name &&
            dae.getExprData1(lhs) === dae.getExprData1(rhs)))
      ) {
        dae.removeEquation(i);
      }
    }
  }
}

/**
 * Infers the Modelica primitive or enumeration {@link VarType} of an expression node (`exprId`)
 * in `dae`, returning `null` if the type cannot be statically determined from the arena.
 *
 * @param dae - Target `WasmDaeBridge` (`DAEBuilder`) arena.
 * @param exprId - Expression arena ID to inspect.
 * @returns Inferred {@link VarType}, or `null` if unknown.
 */
export function inferArenaExprVarType(dae: WasmDaeBridge, exprId: number): VarType | null {
  if (exprId < 0) return null;
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
      const nameStr = dae.interner.resolve(nameId);
      if (nameStr) {
        const vIdx2 = dae.getVarIdxByName(nameStr);
        if (vIdx2 >= 0) return dae.getVarType(vIdx2);
        if (nameStr.includes("[")) {
          const baseName = nameStr.split("[")[0]!;
          const baseIdx = dae.getVarIdxByName(baseName);
          if (baseIdx >= 0) return dae.getVarType(baseIdx);
          const baseId = dae.interner.intern(baseName);
          const baseIdx2 = dae.lookupVariable(baseId);
          if (baseIdx2 >= 0) return dae.getVarType(baseIdx2);
        }
      }
      return null;
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
          if (lType === null || rType === null) return null;
          if (lType === VarType.Real || rType === VarType.Real) return VarType.Real;
          if (lType === VarType.Integer && rType === VarType.Integer) {
            return op === BinOp.Div || op === BinOp.ElemDiv || op === BinOp.Pow || op === BinOp.ElemPow
              ? VarType.Real
              : VarType.Integer;
          }
          return lType;
        }
      }
      return null;
    }
    case ExprKind.Unary: {
      const uop = dae.getExprData1(exprId) as UnaryOp;
      return uop === UnaryOp.Not ? VarType.Boolean : inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    }
    case ExprKind.Negate:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.Der:
      return VarType.Real;
    case ExprKind.Pre:
      return inferArenaExprVarType(dae, dae.getExprData1(exprId));
    case ExprKind.IfElse:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.ArrayCtor:
      return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
    case ExprKind.Subscript: {
      const base = dae.getExprData1(exprId) || dae.getExprLeft(exprId);
      return inferArenaExprVarType(dae, base);
    }
    case ExprKind.Call: {
      const nameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(nameId);
      if (
        fnName === "integer" ||
        fnName === "floor" ||
        fnName === "ceil" ||
        fnName === "round" ||
        fnName === "div" ||
        fnName === "mod" ||
        fnName === "rem" ||
        fnName === "cardinality" ||
        fnName === "sign" ||
        fnName === "size" ||
        fnName === "ndims" ||
        fnName === "Integer" ||
        fnName === "/*Integer*/"
      ) {
        return VarType.Integer;
      }
      if (fnName === "Boolean" || fnName === "/*Boolean*/" || fnName === "initial" || fnName === "terminal")
        return VarType.Boolean;
      if (fnName === "sample") {
        const argCount = dae.getExprRight(exprId);
        if (argCount === 1) return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
        if (argCount === 2) {
          const arg1 = dae.getExprLeft(exprId + 1);
          const t1 = inferArenaExprVarType(dae, arg1);
          if (t1 === VarType.Real || t1 === VarType.Integer) {
            return VarType.Boolean;
          }
          const k1 = dae.getExprKind(arg1);
          if (k1 === ExprKind.RealLiteral || k1 === ExprKind.IntLiteral) {
            return VarType.Boolean;
          }
          return inferArenaExprVarType(dae, dae.getExprLeft(exprId));
        }
      }
      if (fnName === "String" || fnName === "/*String*/" || fnName === "getInstanceName" || fnName === "typeName") {
        return VarType.String;
      }
      if (
        fnName === "Real" ||
        fnName === "/*Real*/" ||
        fnName === "sin" ||
        fnName === "cos" ||
        fnName === "tan" ||
        fnName === "asin" ||
        fnName === "acos" ||
        fnName === "atan" ||
        fnName === "atan2" ||
        fnName === "sinh" ||
        fnName === "cosh" ||
        fnName === "tanh" ||
        fnName === "exp" ||
        fnName === "log" ||
        fnName === "log10" ||
        fnName === "sqrt"
      ) {
        return VarType.Real;
      }
      if (fnName === "min" || fnName === "max" || fnName === "abs" || fnName === "sum" || fnName === "product") {
        const argCount = dae.getExprRight(exprId);
        if (argCount > 0) {
          const t0 = inferArenaExprVarType(dae, dae.getExprLeft(exprId));
          if (t0 !== null) return t0;
          for (let i = 1; i < argCount; i++) {
            const ti = inferArenaExprVarType(dae, dae.getExprLeft(exprId + i));
            if (ti !== null) return ti;
          }
        }
      }
      let fnDae = dae.getFunction(nameId) ?? (fnName ? dae.getFunction(fnName) : undefined);
      if (!fnDae && fnName && fnName.includes(".")) {
        const base = fnName.split(".").pop();
        if (base) fnDae = dae.getFunction(base);
      }
      if (fnDae) {
        for (let i = 0; i < fnDae.varCount; i++) {
          if (fnDae.getVarCausality(i) === Causality.Output) {
            return fnDae.getVarType(i);
          }
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Options controlling type assignability rules in {@link isAssignableType}.
 */
export interface AssignableTypeOptions {
  /** If true, permits implicit conversion from `Integer` to `Enumeration`. */
  intEnumConversion?: boolean | undefined;
}

/**
 * Checks whether a value of type `source` can be assigned or bound to a variable/parameter
 * of type `target` under Modelica's type coercion rules (`Integer` $\to$ `Real`, etc.).
 *
 * @param source - Inferred source expression `VarType` (or `null` if unknown).
 * @param target - Target variable/parameter `VarType`.
 * @param options - Optional conversion flags.
 * @returns `true` if `source` is assignable to `target`.
 */
export function isAssignableType(source: VarType | null, target: VarType, options?: AssignableTypeOptions): boolean {
  if (source === null) return false;
  if (source === target) return true;
  if (source === VarType.Integer && target === VarType.Real) return true;
  if (source === VarType.Integer && target === VarType.Enumeration) {
    return options?.intEnumConversion === true;
  }
  return false;
}

/**
 * Returns the canonical Modelica type name string (`"Real"`, `"Integer"`, `"Boolean"`,
 * `"String"`, `"Enumeration"`, `"Clock"`) for a {@link VarType} enum value.
 *
 * @param type - `VarType` enum value.
 * @returns Human-readable Modelica type name.
 */
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
