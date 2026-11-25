// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DAEBuilder / WasmDaeBridge — Flat, arena-backed storage for flattened DAE data.
 *
 * Implements `IDaeBuilder` backed by the zero-GC WebAssembly `DaeBuilder` runtime.
 */

import { WasmDaeEquations } from "./bridge/equations.js";
import { ExprKind, type IDaeBuilder } from "./bridge/types.js";
import { ArenaEquation, ArenaExpr, ArenaVariable } from "./fluent/index.js";

export * from "./bridge/aliases.js";
export * from "./bridge/differentiate.js";
export * from "./bridge/simplify.js";
export * from "./bridge/type_inference.js";
export * from "./bridge/types.js";
export * from "./facets/index.js";
export * from "./path_index.js";
export * from "./problem_types.js";
export * from "./wasm_loader.js";

/**
 * Universal DAE Builder (`DAEBuilder`) backed directly by the WebAssembly `DaeBuilder`
 * struct-of-arrays arena in linear memory, augmented with host-side metadata tables for
 * structured equations, state machines, annotations, and source ranges.
 */
export class WasmDaeBridge extends WasmDaeEquations implements IDaeBuilder {
  /** Map of compiled helper/called functions keyed by function name or interned `StringId`. */
  public functions = new Map<string | number, WasmDaeBridge>();
  /** Parent DAE arena when this builder represents a compiled function or sub-model. */
  public parentDae?: WasmDaeBridge | undefined;

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

  /**
   * Creates a deep copy of this `WasmDaeBridge` (`DAEBuilder`), duplicating all WASM arena columns
   * and host-side metadata tables into a fresh WASM builder allocation.
   */
  clone(): WasmDaeBridge {
    const clonedPtr = this.ptr && this.exports?.dae_clone ? this.exports.dae_clone(this.ptr) >>> 0 : 0;
    const copy = new WasmDaeBridge(this.exports, clonedPtr, this.description, this.interner);
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
    copy.extensionMetadata = {
      ...this.extensionMetadata,
      ...(this.extensionMetadata.webgpu && { webgpu: { ...this.extensionMetadata.webgpu } }),
      ...(this.extensionMetadata.audioClock && { audioClock: { ...this.extensionMetadata.audioClock } }),
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
    for (const [k, v] of this.origEqRhs) {
      copy.origEqRhs.set(k, v);
    }
    copy.eventIndicatorExprIds = [...this.eventIndicatorExprIds];
    copy.nameExprIndices = [...this.nameExprIndices];

    if (clonedPtr === 0) {
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
      for (let i = 0; i < this.stmtCount; i++) {
        copy.addStatement(this.getStmtKind(i), this.getStmtData1(i), this.getStmtLeft(i), this.getStmtRight(i));
      }
      for (const id of this.eventIndicatorExprIds) {
        copy.addEventIndicator(id);
      }
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
