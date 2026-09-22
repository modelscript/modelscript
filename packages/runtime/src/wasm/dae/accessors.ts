// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @fileoverview Zero-Overhead Typed Accessor Views for DAE SoA Arrays
 *
 * Provides `@unmanaged` accessor structs that wrap raw SoA row access with
 * type-safe inline properties. These compile to identical machine code as
 * raw `data.get(id * STRIDE + FIELD)` calls but provide:
 *   - IntelliSense / autocomplete for all field names
 *   - Type safety (VarType vs Variability vs Causality)
 *   - Centralized f64 reinterpretation logic (startValue)
 *   - Flag predicate helpers (isFlow, isState, isRemoved, etc.)
 *
 * Usage (zero allocation — stack-local value):
 *   let v = VarAccessor.at(dae.varData, varId);
 *   let name = v.nameId;
 *   let isFlow = v.isFlow;
 *
 * All accessors are @inline and compile away to direct load/store instructions.
 */

import { ChunkedInt32Array, atomicChunkAlloc } from "../core/array";
import {
  VAR_STRIDE, VAR_NAME, VAR_TYPE, VAR_VARIABILITY, VAR_CAUSALITY,
  VAR_START_HI, VAR_START_LO, VAR_SHAPE_DIM, VAR_FLAGS,
  FLAG_TEARING_VAR, FLAG_VAR_FLOW, FLAG_VAR_STREAM,
  FLAG_VAR_STATE, FLAG_VAR_STATE_DER, FLAG_VAR_FIXED, FLAG_VAR_REMOVED,
  EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS, EQ_AUX,
  EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT,
  STMT_STRIDE, STMT_KIND, STMT_DATA1, STMT_LEFT, STMT_RIGHT,
  NULL_ID,
  VarType, Variability, Causality, ExprKind, EqKind, StmtKind, BinOp, UnaryOp,
} from "./types";

const ACCESSOR_SLOTS: u32 = 64;
const ACCESSOR_MASK: u32 = ACCESSOR_SLOTS - 1;

let g_varAccessorIdx: u32 = 0;
let g_varAccessorBuf: usize = 0;

let g_exprAccessorIdx: u32 = 0;
let g_exprAccessorBuf: usize = 0;

let g_eqAccessorIdx: u32 = 0;
let g_eqAccessorBuf: usize = 0;

let g_stmtAccessorIdx: u32 = 0;
let g_stmtAccessorBuf: usize = 0;

// ─────────────────────────────────────────────────────────────────────────────
// VarAccessor: Zero-overhead view over a variable row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-overhead typed view for reading/writing a single variable row in the
 * DAE struct-of-arrays. Does not allocate — instantiate via `VarAccessor.at()`.
 *
 * Each property getter/setter is `@inline` and compiles to a single
 * `ChunkedInt32Array.get/set` call with the offset pre-computed.
 */
@unmanaged
export class VarAccessor {
  private _data: ChunkedInt32Array;
  private _offset: u32;

  /**
   * Creates an accessor pointing at `varData[varId * VAR_STRIDE]`.
   * Uses a thread-safe / recursion-safe ring buffer to avoid clobbering concurrent accessors.
   */
  @inline static at(data: ChunkedInt32Array, varId: u32): VarAccessor {
    if (g_varAccessorBuf == 0) {
      g_varAccessorBuf = atomicChunkAlloc(ACCESSOR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_varAccessorIdx++) & ACCESSOR_MASK;
    let a = changetype<VarAccessor>(g_varAccessorBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = varId * VAR_STRIDE;
    return a;
  }

  // ── Field Getters ──

  @inline get nameId(): u32 { return this._data.get(this._offset + VAR_NAME) as u32; }
  @inline get varType(): VarType { return this._data.get(this._offset + VAR_TYPE) as VarType; }
  @inline get variability(): Variability { return this._data.get(this._offset + VAR_VARIABILITY) as Variability; }
  @inline get causality(): Causality { return this._data.get(this._offset + VAR_CAUSALITY) as Causality; }
  @inline get shapeDim(): u32 { return this._data.get(this._offset + VAR_SHAPE_DIM) as u32; }
  @inline get flags(): i32 { return this._data.get(this._offset + VAR_FLAGS); }

  /** Reconstructs the f64 start value from its split hi/lo i32 representation. */
  @inline get startValue(): f64 {
    let hi = (this._data.get(this._offset + VAR_START_HI) as u64) << 32;
    let lo = (this._data.get(this._offset + VAR_START_LO) as u64) & 0xffffffff;
    return f64.reinterpret_i64((hi | lo) as i64);
  }

  // ── Field Setters ──

  @inline set nameId(v: u32) { this._data.set(this._offset + VAR_NAME, v as i32); }
  @inline set varType(v: VarType) { this._data.set(this._offset + VAR_TYPE, v as i32); }
  @inline set variability(v: Variability) { this._data.set(this._offset + VAR_VARIABILITY, v as i32); }
  @inline set causality(v: Causality) { this._data.set(this._offset + VAR_CAUSALITY, v as i32); }
  @inline set shapeDim(v: u32) { this._data.set(this._offset + VAR_SHAPE_DIM, v as i32); }
  @inline set flags(v: i32) { this._data.set(this._offset + VAR_FLAGS, v); }

  /** Splits and stores an f64 start value into its hi/lo i32 representation. */
  @inline set startValue(val: f64) {
    let bits = i64.reinterpret_f64(val) as u64;
    this._data.set(this._offset + VAR_START_HI, (bits >> 32) as i32);
    this._data.set(this._offset + VAR_START_LO, (bits & 0xffffffff) as i32);
  }

  // ── Flag Predicates ──

  @inline get isTearing(): bool { return (this.flags & FLAG_TEARING_VAR) != 0; }
  @inline get isFlow(): bool { return (this.flags & FLAG_VAR_FLOW) != 0; }
  @inline get isStream(): bool { return (this.flags & FLAG_VAR_STREAM) != 0; }
  @inline get isState(): bool { return (this.flags & FLAG_VAR_STATE) != 0; }
  @inline get isStateDer(): bool { return (this.flags & FLAG_VAR_STATE_DER) != 0; }
  @inline get isFixed(): bool { return (this.flags & FLAG_VAR_FIXED) != 0; }
  @inline get isRemoved(): bool { return (this.flags & FLAG_VAR_REMOVED) != 0; }

  @inline get isParameter(): bool { return this.variability == Variability.Parameter; }
  @inline get isConstant(): bool { return this.variability == Variability.Constant; }
  @inline get isContinuous(): bool { return this.variability == Variability.Continuous; }
  @inline get isDiscrete(): bool { return this.variability == Variability.Discrete; }
  @inline get isInput(): bool { return this.causality == Causality.Input; }
  @inline get isOutput(): bool { return this.causality == Causality.Output; }
  @inline get isLocal(): bool { return this.causality == Causality.Local; }
  @inline get isReal(): bool { return this.varType == VarType.Real; }
  @inline get isInteger(): bool { return this.varType == VarType.Integer; }
  @inline get isBoolean(): bool { return this.varType == VarType.Boolean; }
  @inline get isScalar(): bool { return this.shapeDim == 0; }

  // ── Flag Mutators ──

  @inline setFlag(flag: i32): void {
    this._data.set(this._offset + VAR_FLAGS, this.flags | flag);
  }

  @inline clearFlag(flag: i32): void {
    this._data.set(this._offset + VAR_FLAGS, this.flags & ~flag);
  }

  @inline hasFlag(flag: i32): bool {
    return (this.flags & flag) != 0;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// ExprAccessor: Zero-overhead view over an expression row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-overhead typed view for reading/writing a single expression row
 * in the DAE struct-of-arrays.
 */
@unmanaged
export class ExprAccessor {
  private _data: ChunkedInt32Array;
  private _offset: u32;

  @inline static at(data: ChunkedInt32Array, exprId: u32): ExprAccessor {
    if (g_exprAccessorBuf == 0) {
      g_exprAccessorBuf = atomicChunkAlloc(ACCESSOR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_exprAccessorIdx++) & ACCESSOR_MASK;
    let a = changetype<ExprAccessor>(g_exprAccessorBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = exprId * EXPR_STRIDE;
    return a;
  }

  // ── Field Getters ──

  @inline get kind(): ExprKind { return this._data.get(this._offset + EXPR_KIND) as ExprKind; }
  @inline get data1(): i32 { return this._data.get(this._offset + EXPR_DATA1); }
  @inline get data1u(): u32 { return this._data.get(this._offset + EXPR_DATA1) as u32; }
  @inline get left(): u32 { return this._data.get(this._offset + EXPR_LEFT) as u32; }
  @inline get right(): u32 { return this._data.get(this._offset + EXPR_RIGHT) as u32; }

  // ── Field Setters ──

  @inline set kind(v: ExprKind) { this._data.set(this._offset + EXPR_KIND, v as i32); }
  @inline set data1(v: i32) { this._data.set(this._offset + EXPR_DATA1, v); }
  @inline set left(v: u32) { this._data.set(this._offset + EXPR_LEFT, v as i32); }
  @inline set right(v: u32) { this._data.set(this._offset + EXPR_RIGHT, v as i32); }

  // ── Kind Predicates ──

  @inline get isLiteral(): bool {
    let k = this.kind;
    return k == ExprKind.IntLiteral || k == ExprKind.RealLiteral ||
           k == ExprKind.BoolLiteral || k == ExprKind.StringLiteral;
  }
  @inline get isNumericLiteral(): bool {
    let k = this.kind;
    return k == ExprKind.IntLiteral || k == ExprKind.RealLiteral;
  }
  @inline get isName(): bool { return this.kind == ExprKind.Name; }
  @inline get isBinary(): bool { return this.kind == ExprKind.Binary; }
  @inline get isUnary(): bool { return this.kind == ExprKind.Unary; }
  @inline get isCall(): bool { return this.kind == ExprKind.Call; }
  @inline get isDer(): bool { return this.kind == ExprKind.Der; }
  @inline get isIfElse(): bool { return this.kind == ExprKind.IfElse; }
  @inline get isNull(): bool { return this._offset / EXPR_STRIDE == NULL_ID; }

  // ── Typed Data Access ──

  /** For Name expressions: the variable ID. */
  @inline get varId(): u32 { return this.data1u; }

  /** For IntLiteral / BoolLiteral / EnumLiteral: the integer value. */
  @inline get intValue(): i32 { return this.data1; }

  /** For RealLiteral: reconstructs the f64 from split hi/lo. */
  @inline get realValue(): f64 {
    let lo = (this._data.get(this._offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (this._data.get(this._offset + EXPR_LEFT) as u64) << 32;
    return f64.reinterpret_i64((hi | lo) as i64);
  }

  /** For Binary expressions: the BinOp enum. */
  @inline get binOp(): BinOp { return this.data1 as BinOp; }

  /** For Unary expressions: the UnaryOp enum. */
  @inline get unaryOp(): UnaryOp { return this.data1 as UnaryOp; }

  /** For Call expressions: the function ID. */
  @inline get funcId(): u32 { return this.data1u; }
}


// ─────────────────────────────────────────────────────────────────────────────
// EqAccessor: Zero-overhead view over an equation row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-overhead typed view for reading/writing a single equation row
 * in the DAE struct-of-arrays.
 */
@unmanaged
export class EqAccessor {
  private _data: ChunkedInt32Array;
  private _offset: u32;

  @inline static at(data: ChunkedInt32Array, eqId: u32): EqAccessor {
    if (g_eqAccessorBuf == 0) {
      g_eqAccessorBuf = atomicChunkAlloc(ACCESSOR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_eqAccessorIdx++) & ACCESSOR_MASK;
    let a = changetype<EqAccessor>(g_eqAccessorBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = eqId * EQ_STRIDE;
    return a;
  }

  // ── Field Getters ──

  @inline get kind(): EqKind { return this._data.get(this._offset + EQ_KIND) as EqKind; }
  @inline get lhs(): u32 { return this._data.get(this._offset + EQ_LHS) as u32; }
  @inline get rhs(): u32 { return this._data.get(this._offset + EQ_RHS) as u32; }
  @inline get aux(): u32 { return this._data.get(this._offset + EQ_AUX) as u32; }

  // ── Field Setters ──

  @inline set kind(v: EqKind) { this._data.set(this._offset + EQ_KIND, v as i32); }
  @inline set lhs(v: u32) { this._data.set(this._offset + EQ_LHS, v as i32); }
  @inline set rhs(v: u32) { this._data.set(this._offset + EQ_RHS, v as i32); }
  @inline set aux(v: u32) { this._data.set(this._offset + EQ_AUX, v as i32); }

  // ── Kind Predicates ──

  @inline get isSimple(): bool { return this.kind == EqKind.Simple; }
  @inline get isFor(): bool { return this.kind == EqKind.For; }
  @inline get isIf(): bool { return this.kind == EqKind.If; }
  @inline get isWhen(): bool { return this.kind == EqKind.When; }
  @inline get isConnect(): bool { return this.kind == EqKind.Connect; }
  @inline get isArray(): bool { return this.kind == EqKind.Array; }
  @inline get isFunctionCall(): bool { return this.kind == EqKind.FunctionCall; }
  @inline get isInitial(): bool {
    let k = this.kind;
    return k == EqKind.InitialSimple || k == EqKind.InitialFor || k == EqKind.InitialFunctionCall;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// StmtAccessor: Zero-overhead view over a statement row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zero-overhead typed view for reading/writing a single statement row
 * in the DAE struct-of-arrays.
 */
@unmanaged
export class StmtAccessor {
  private _data: ChunkedInt32Array;
  private _offset: u32;

  @inline static at(data: ChunkedInt32Array, stmtId: u32): StmtAccessor {
    if (g_stmtAccessorBuf == 0) {
      g_stmtAccessorBuf = atomicChunkAlloc(ACCESSOR_SLOTS * (sizeof<usize>() * 2));
    }
    let slot = (g_stmtAccessorIdx++) & ACCESSOR_MASK;
    let a = changetype<StmtAccessor>(g_stmtAccessorBuf + slot * (sizeof<usize>() * 2));
    a._data = data;
    a._offset = stmtId * STMT_STRIDE;
    return a;
  }

  // ── Field Getters ──

  @inline get kind(): StmtKind { return this._data.get(this._offset + STMT_KIND) as StmtKind; }
  @inline get data1(): i32 { return this._data.get(this._offset + STMT_DATA1); }
  @inline get data1u(): u32 { return this._data.get(this._offset + STMT_DATA1) as u32; }
  @inline get left(): u32 { return this._data.get(this._offset + STMT_LEFT) as u32; }
  @inline get right(): u32 { return this._data.get(this._offset + STMT_RIGHT) as u32; }

  // ── Field Setters ──

  @inline set kind(v: StmtKind) { this._data.set(this._offset + STMT_KIND, v as i32); }
  @inline set data1(v: i32) { this._data.set(this._offset + STMT_DATA1, v); }
  @inline set left(v: u32) { this._data.set(this._offset + STMT_LEFT, v as i32); }
  @inline set right(v: u32) { this._data.set(this._offset + STMT_RIGHT, v as i32); }

  // ── Kind Predicates ──

  @inline get isAssignment(): bool { return this.kind == StmtKind.Assignment; }
  @inline get isFor(): bool { return this.kind == StmtKind.For; }
  @inline get isWhile(): bool { return this.kind == StmtKind.While; }
  @inline get isIf(): bool { return this.kind == StmtKind.If; }
  @inline get isReturn(): bool { return this.kind == StmtKind.Return; }
  @inline get isBreak(): bool { return this.kind == StmtKind.Break; }
}
