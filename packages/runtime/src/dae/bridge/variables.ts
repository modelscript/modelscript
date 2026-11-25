// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Variable declarations, attributes, shapes, array prefix indexing, and alias
 * operations for `WasmDaeBridge`.
 */

import type { StringId, StringInterner } from "../../workspace/wasm_string_pool.js";
import { splitPath } from "../path_index.js";
import type { WasmRuntimeExports } from "../wasm_loader.js";
import { WasmDaeExpressions } from "./expressions.js";
import {
  Causality,
  type EnumLiteralDescriptor,
  ExprKind,
  FLAG_VAR_EVALUATE,
  FLAG_VAR_FINAL,
  FLAG_VAR_FIXED,
  FLAG_VAR_FLOW,
  FLAG_VAR_PROTECTED,
  FLAG_VAR_REMOVED,
  FLAG_VAR_STATE,
  FLAG_VAR_STATE_DER,
  FLAG_VAR_STREAM,
  FLAG_VAR_VIRTUAL,
  VarAttrKind,
  VarType,
  Variability,
} from "./types.js";

export class WasmDaeVariables extends WasmDaeExpressions {
  constructor(
    wasmExportsOrInterner?: WasmRuntimeExports | WebAssembly.Exports | StringInterner | string | null,
    nameOrPtr: string | number = "Model",
    desc = "",
    interner?: StringInterner,
  ) {
    super(wasmExportsOrInterner, nameOrPtr, desc, interner);
    if (typeof nameOrPtr === "number" && nameOrPtr !== 0 && this.varCount > 0) {
      for (let i = 0; i < this.varCount; i++) {
        const vName = this.getVarName(i);
        if (vName) {
          this._indexArrayVariable(i, vName);
        }
      }
      this._indexedVarCount = this.varCount;
    }
  }

  /**
   * Computes all unsubscripted base prefixes and stripped-segment dotted paths for `varName`.
   */
  protected _getArrayBaseKeys(varName: string): Set<string> {
    const keys = new Set<string>();
    if (!varName.includes("[")) return keys;
    let pos = 0;
    while ((pos = varName.indexOf("[", pos)) !== -1) {
      keys.add(varName.slice(0, pos));
      pos++;
    }
    if (varName.includes(".")) {
      const parts = splitPath(varName);
      const subIndices: { idx: number; base: string }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const vp = parts[i]!;
        if (vp.endsWith("]")) {
          const bPos = vp.indexOf("[");
          if (bPos > 0) {
            subIndices.push({ idx: i, base: vp.slice(0, bPos) });
          }
        }
      }
      if (subIndices.length > 0 && subIndices.length <= 6) {
        const total = 1 << subIndices.length;
        for (let mask = 1; mask < total; mask++) {
          const cand = [...parts];
          for (let b = 0; b < subIndices.length; b++) {
            if ((mask & (1 << b)) !== 0) {
              const info = subIndices[b]!;
              cand[info.idx] = info.base;
            }
          }
          keys.add(cand.join("."));
        }
      }
    }
    return keys;
  }

  /**
   * Ensures all arena variables up to `this.varCount` have been indexed in `baseArrayIndices`.
   */
  protected _ensureArrayVariablesIndexed(): void {
    const vc = this.varCount;
    if (this._indexedVarCount < vc) {
      for (let i = this._indexedVarCount; i < vc; i++) {
        const vn = this.getVarName(i);
        if (vn) this._indexArrayVariable(i, vn);
      }
      this._indexedVarCount = vc;
    }
  }

  /**
   * Indexes a scalarized array variable (e.g., `x[1,2]` or `comp[1].y[2]`) under all of its
   * unsubscripted base prefixes and stripped-segment paths in `baseArrayIndices`.
   */
  protected _indexArrayVariable(varIdx: number, varName: string): void {
    if (!varName.includes("[")) return;
    for (const base of this._getArrayBaseKeys(varName)) {
      let list = this.baseArrayIndices.get(base);
      if (!list) {
        list = [];
        this.baseArrayIndices.set(base, list);
      }
      if (list.length === 0 || varIdx > list[list.length - 1]!) {
        list.push(varIdx);
      } else if (!list.includes(varIdx)) {
        list.push(varIdx);
      }
    }
  }

  /**
   * Removes a scalarized array variable from all base prefix entries in `baseArrayIndices`.
   */
  protected _unindexArrayVariable(varIdx: number, varName: string): void {
    if (!varName.includes("[")) return;
    for (const base of this._getArrayBaseKeys(varName)) {
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
    }
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
        if (idx === this._indexedVarCount) {
          this._indexedVarCount = idx + 1;
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
    if (typeof nameOrId === "number" && this._renamedVars.size === 0) {
      if (nameOrId !== 0 && this.exports?.dae_lookupVariable) {
        return this.exports.dae_lookupVariable(this.ptr, nameOrId);
      }
      return -1;
    }
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
    this._isRealNameCache?.clear();
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
   * Returns the binding expression ID for `varIdx`, checking explicit binding first then falling back to expression.
   */
  getVarBindingExpr(varIdx: number): number | undefined {
    return this.getExplicitVarExpression(varIdx) ?? this.getVarExpression(varIdx);
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
  getVarCadAnnotation(varIdx: number): string | undefined {
    return this.varCadAnnotations.get(varIdx);
  }

  /**
   * Attaches a CAD/graphical annotation payload to `varIdx`.
   *
   * @param varIdx - 0-based variable index.
   * @param cad - Annotation payload.
   */
  setVarCadAnnotation(varIdx: number, cad: string): void {
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
   * Checks whether the variable at `varIdx` is marked for compile-time evaluation (`FLAG_VAR_EVALUATE`).
   */
  isVarEvaluate(varIdx: number): boolean {
    return (this.getVarFlags(varIdx) & FLAG_VAR_EVALUATE) !== 0;
  }

  /**
   * Sets or clears the `FLAG_VAR_EVALUATE` flag on `varIdx`.
   */
  setVarEvaluate(varIdx: number, isEvaluate = true): void {
    const flags = this.getVarFlags(varIdx);
    this.setVarFlags(varIdx, isEvaluate ? flags | FLAG_VAR_EVALUATE : flags & ~FLAG_VAR_EVALUATE);
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
  getVarEnumerationLiterals(varIdx: number): EnumLiteralDescriptor[] | undefined {
    return this.varEnumLiterals.get(varIdx);
  }

  /**
   * Sets the ordered list of enumeration literal descriptors for an enumeration variable at `varIdx`.
   */
  setVarEnumerationLiterals(varIdx: number, lits: readonly (EnumLiteralDescriptor | string)[]): void {
    const normalized: EnumLiteralDescriptor[] = lits.map((l) => (typeof l === "string" ? { stringValue: l } : l));
    this.varEnumLiterals.set(varIdx, normalized);
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
    this._ensureArrayVariablesIndexed();
    const direct = this.baseArrayIndices.get(baseName);
    return direct !== undefined && direct.length > 0;
  }

  /**
   * Returns the variable indices of all scalarized array elements belonging to `baseName`.
   *
   * @param baseName - Unsubscripted base variable path.
   * @returns Array of 0-based variable indices.
   */
  getArrayElementIndices(baseName: string): number[] {
    this._ensureArrayVariablesIndexed();
    const direct = this.baseArrayIndices.get(baseName);
    if (direct && direct.length > 0) {
      return [...direct];
    }
    return [];
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
      const hasConstOrParamBinding =
        this.varExpressions.has(varIdx) &&
        (this.getVarVariability(varIdx) === Variability.Constant ||
          (this.getVarVariability(varIdx) === Variability.Parameter && this.isVarFixed(varIdx)));
      if (!hasConstOrParamBinding) {
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
   * Alias for {@link getVarStartValue}.
   */
  getVarStartAttr(varIdx: number): number {
    return this.getVarStartValue(varIdx);
  }

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
}
