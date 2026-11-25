// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Equation, clock, structured equation (`when`/`for`/`if`), state machine,
 * event indicator, and optimization objective operations for `WasmDaeBridge`.
 */

import { DaeObjectiveSense, FLAG_OBJ_LAGRANGE, FLAG_OBJ_MAYER } from "../problem_types.js";
import {
  type ArenaStateMachine,
  EqKind,
  type ForEquationMeta,
  type IfEquationMeta,
  type WhenEquationMeta,
} from "./types.js";
import { WasmDaeVariables } from "./variables.js";

export class WasmDaeEquations extends WasmDaeVariables {
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
    if (kind === EqKind.Connect) {
      return false;
    }
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
    if (this.removedEquations.has(eqIdx)) return true;
    const flags = this.getEqFlags(eqIdx);
    return flags !== -1 && flags >>> 0 !== 0xffffffff && (flags & 16) /* FLAG_EQ_REMOVED */ !== 0;
  }

  /**
   * Marks equation `eqIdx` as eliminated/removed.
   *
   * @param eqIdx - 0-based equation index.
   */
  markEqRemoved(eqIdx: number): void {
    this.removedEquations.add(eqIdx);
    if (this.exports?.dae_setEqRemoved) {
      this.exports.dae_setEqRemoved(this.ptr, eqIdx, true);
    }
  }

  /**
   * Alias for {@link markEqRemoved} marking equation `eqIdx` as eliminated/removed.
   *
   * @param eqIdx - 0-based equation index.
   */
  removeEquation(eqIdx: number): void {
    this.removedEquations.add(eqIdx);
    if (this.exports?.dae_setEqRemoved) {
      this.exports.dae_setEqRemoved(this.ptr, eqIdx, true);
    }
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

  /**
   * Preserves an array / tensor equation (`lhs = rhs` where lhs and rhs are vectors/tensors)
   * without unrolling into individual scalar equations.
   */
  addArrayEquation(lhsExprId: number, rhsExprId: number, shape?: number[]): number {
    const elementCount = shape ? shape.reduce((a, b) => a * b, 1) : 0;
    const eqIdx = this.addEquation(EqKind.Array, lhsExprId, rhsExprId, elementCount);
    if (shape && eqIdx >= 0) {
      this.equationShapes.set(eqIdx, [...shape]);
    }
    return eqIdx;
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
    if (typeof this.exports?.dae_opt_addObjective === "function" && this.optimization.objectiveCount === 0) {
      const flags = (objExpr >= 0 ? FLAG_OBJ_MAYER : 0) | (integrandExpr >= 0 ? FLAG_OBJ_LAGRANGE : 0);
      this.optimization.addObjective(objExpr, integrandExpr, DaeObjectiveSense.Minimize, flags);
    }
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
}
