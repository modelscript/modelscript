// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  EqKind,
  ExprKind,
  UnaryOp,
  VarType,
  Variability,
  evaluateArenaExpression,
  isolateSymbolicallyArena,
  tryOptimizeLoopWithGroebner,
  type ArenaBltBlock,
  type ArenaExecutionBlock,
} from "@modelscript/runtime";
import { evaluateArenaRuntime } from "@modelscript/runtime/wasm_evaluator.js";
import type { FrictionStateMapping, SimDAEBuilder } from "./arena-sim-types.js";

/**
 * Converts BLT blocks into executable `ArenaExecutionBlock` entries by attempting symbolic
 * isolation (`isolateSymbolicallyArena`) for $1 \times 1$ blocks and Groebner-basis triangularization
 * (`tryOptimizeLoopWithGroebner`) for multi-equation algebraic loops.
 */
export function buildArenaExecutionBlocks(
  arena: DAEBuilder,
  blocks: ArenaBltBlock[],
  sortedEquations: number[],
  stateVars: Set<number>,
  derivativeVars: Set<number>,
  executionBlocks: ArenaExecutionBlock[],
): void {
  // Phase 3: Batch In-WASM Symbolic Isolation for 1x1 BLT Blocks
  const singleBlocks: Array<{ eqIdx: number; varIdx: number; blockIdx: number }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.eqIdxs.length === 1 && block.vars.length === 1) {
      const eqIdx = block.eqIdxs[0] ?? -1;
      const varIdx = block.vars[0] ?? -1;
      if (eqIdx !== -1 && varIdx !== -1 && !stateVars.has(varIdx) && !derivativeVars.has(varIdx)) {
        singleBlocks.push({ eqIdx, varIdx, blockIdx: i });
      }
    }
  }

  const isolatedMap = new Map<number, number>();
  const wasmExports = arena.exports;
  if (
    singleBlocks.length > 0 &&
    arena.ptr !== 0 &&
    wasmExports &&
    typeof wasmExports.dae_batchIsolate1x1Blocks === "function" &&
    typeof wasmExports.atomicChunkAlloc === "function"
  ) {
    if (typeof arena.syncWasmStringPool === "function") {
      arena.syncWasmStringPool();
    }
    const count = singleBlocks.length;
    const bytes = count * 4;
    const eqPtr = wasmExports.atomicChunkAlloc(bytes);
    const varPtr = wasmExports.atomicChunkAlloc(bytes);
    const outPtr = wasmExports.atomicChunkAlloc(bytes);

    if (eqPtr && varPtr && outPtr) {
      const eqView = new Int32Array(wasmExports.memory.buffer, eqPtr, count);
      const varView = new Int32Array(wasmExports.memory.buffer, varPtr, count);
      for (let i = 0; i < count; i++) {
        eqView[i] = singleBlocks[i]!.eqIdx;
        varView[i] = singleBlocks[i]!.varIdx;
      }

      wasmExports.dae_batchIsolate1x1Blocks(arena.ptr, eqPtr, varPtr, count, outPtr);
      const outView = new Int32Array(wasmExports.memory.buffer, outPtr, count);
      for (let i = 0; i < count; i++) {
        const exprId = outView[i]!;
        if (exprId !== -1 && exprId !== 0xffffffff) {
          isolatedMap.set(singleBlocks[i]!.blockIdx, exprId);
        }
      }

      if (typeof wasmExports.atomicChunkFree === "function") {
        wasmExports.atomicChunkFree(eqPtr);
        wasmExports.atomicChunkFree(varPtr);
        wasmExports.atomicChunkFree(outPtr);
      }
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    // Skip blocks with no equations — these are unmatched state variables
    // managed by the ODE integrator, not algebraic unknowns.
    if (block.eqIdxs.length === 0) continue;

    if (block.eqIdxs.length === 1 && block.vars.length === 1) {
      const eqIdx = block.eqIdxs[0] ?? -1;
      const varIdx = block.vars[0] ?? -1;

      if (eqIdx === -1 || varIdx === -1) continue;
      // Continuous state variables are stepped by the ODE integrator, not solved as algebraic assignments
      if (stateVars.has(varIdx)) continue;

      let isolatedExprId = isolatedMap.get(i) ?? -1;
      if (isolatedExprId === -1) {
        isolatedExprId = isolateSymbolicallyArena(arena, eqIdx, varIdx);
      }

      if (isolatedExprId !== -1) {
        executionBlocks.push({ type: "single", varIdx, exprId: isolatedExprId });
      } else {
        // Could not isolate, leave as implicit 1x1 system
        executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: block.vars });
      }
    } else {
      const activeVars = block.vars.filter((v) => !stateVars.has(v));
      if (activeVars.length === 0) continue;
      const optimized = tryOptimizeLoopWithGroebner(arena, block.eqIdxs, activeVars);
      if (optimized) {
        executionBlocks.push(...optimized);
      } else {
        executionBlocks.push({ type: "system", eqIdxs: block.eqIdxs, vars: activeVars, tearing: block.tearing });
      }
    }
  }

  // Identify unused sorted equations (if any)
  const assignedEqs = new Set<number>();
  for (const block of blocks) {
    for (const eqIdx of block.eqIdxs) assignedEqs.add(eqIdx);
  }

  for (const eqIdx of sortedEquations) {
    if (!assignedEqs.has(eqIdx)) {
      // Equation without an assigned variable (e.g. constraints)
      executionBlocks.push({ type: "system", eqIdxs: [eqIdx], vars: [] });
    }
  }
}

/**
 * Maps requested output name ids to the slot that actually holds the solved value.
 *
 * `eliminateArenaAliases` removes alias variables (e.g. every connector `vr` that is merely
 * `a.vr = b.vr`) and rewrites all equations to their alias root, so the solver never writes the
 * eliminated name's slot and it would be reported as constant zero. Reading the root's slot
 * reproduces the value the alias is equal to.
 */
export function resolveArenaOutputIds(arenaBuilder: DAEBuilder, ids: number[]): number[] {
  const arena = arenaBuilder as unknown as {
    getAlias?: (v: number) => number;
    lookupVariable: (id: number) => number | undefined;
    isVarRemoved: (v: number) => boolean;
  };
  if (typeof arena.getAlias !== "function") return ids;
  let out: number[] | null = null;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k]!;
    const v = arena.lookupVariable(id);
    if (v === undefined || v < 0 || !arena.isVarRemoved(v)) continue;
    let target = arena.getAlias(v);
    for (let hop = 0; target && hop < 64; hop++) {
      const tv = arena.lookupVariable(target);
      if (tv === undefined || tv < 0) {
        target = 0;
        break;
      }
      if (!arena.isVarRemoved(tv)) break;
      const next = arena.getAlias(tv);
      if (!next || next === target) break;
      target = next;
    }
    if (target) {
      if (!out) out = ids.slice();
      out[k] = target;
    }
  }
  return out ?? ids;
}

/**
 * Identifies parameter and constant variables in the arena, evaluates their binding expressions
 * or start attributes, and populates `parameterVars` and `parameters`.
 */
export function resolveArenaParameters(
  arena: DAEBuilder,
  parameters: Map<string, number>,
  parameterVars: Set<number>,
  stateVars: Set<number>,
  preOverrides?: Map<string, number> | null,
): void {
  const exprReferencesContinuous = (exprId: number): boolean => {
    if (exprId < 0) return false;
    const k = arena.getExprKind(exprId);
    if (k === ExprKind.Name) {
      const nameId = arena.getExprData1(exprId);
      const name = arena.interner.resolve(nameId);
      if (name === "time") return true;
      const vIdx = arena.lookupVariable(nameId);
      if (vIdx >= 0) {
        const v = arena.getVarVariability(vIdx);
        return v !== Variability.Parameter && v !== Variability.Constant;
      }
      return false;
    }
    if (k === ExprKind.Der || k === ExprKind.Pre) return true;
    if (k === ExprKind.Unary || k === ExprKind.Negate) {
      return exprReferencesContinuous(arena.getExprLeft(exprId));
    }
    if (k === ExprKind.Binary) {
      return (
        exprReferencesContinuous(arena.getExprLeft(exprId)) || exprReferencesContinuous(arena.getExprRight(exprId))
      );
    }
    if (k === ExprKind.IfElse) {
      return (
        exprReferencesContinuous(arena.getExprData1(exprId)) ||
        exprReferencesContinuous(arena.getExprLeft(exprId)) ||
        exprReferencesContinuous(arena.getExprRight(exprId))
      );
    }
    if (k === ExprKind.Call) {
      const argc = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let a = 0; a < argc; a++) {
        const argId = a === 0 ? firstArg : arena.getExprLeft(exprId + a);
        if (exprReferencesContinuous(argId)) return true;
      }
    }
    return false;
  };

  const simArena = arena as SimDAEBuilder;
  let paramRuntimeVals: Float64Array | null = null;
  const evalParamExpr = (exprId: number, varIdx: number): unknown => {
    const rawVal = evaluateArenaExpression(arena, exprId, parameters);
    if (typeof rawVal === "string" || Array.isArray(rawVal)) {
      return rawVal;
    }
    if (rawVal !== null && rawVal !== undefined) {
      const numVal = typeof rawVal === "boolean" ? (rawVal ? 1 : 0) : rawVal;
      if (typeof numVal === "number" && Number.isFinite(numVal)) {
        return rawVal;
      }
    }
    if (varIdx >= 0 && arena.getVarType(varIdx) === VarType.String) {
      return rawVal;
    }
    const neededLen = Math.max(arena.interner.size + 64, 4096);
    if (!paramRuntimeVals || paramRuntimeVals.length < neededLen) {
      paramRuntimeVals = new Float64Array(neededLen);
    }
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v)) continue;
      const vid = arena.getVarNameId(v);
      if (vid >= 0 && vid < paramRuntimeVals.length) {
        paramRuntimeVals[vid] = arena.getVarStartValue(v);
      }
    }
    for (const [k, v] of parameters) {
      if (typeof v === "number" && Number.isFinite(v)) {
        const sid = arena.interner.intern(k);
        if (sid >= 0 && sid < paramRuntimeVals.length) {
          paramRuntimeVals[sid] = v;
        }
      }
    }
    try {
      const rtVal = evaluateArenaRuntime(arena, exprId, paramRuntimeVals);
      if (Number.isFinite(rtVal)) {
        return rtVal;
      }
    } catch {
      // Ignore domain/assertion errors while evaluating fallback parameter expressions
    }
    return rawVal;
  };

  let existingBindingEqs: Map<number, Set<number>> | null = null;
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const variability = arena.getVarVariability(i);
    const isParam = variability === Variability.Parameter || variability === Variability.Constant;
    const hasExplicitExpr = simArena.hasExplicitVarExpression?.(i);
    const isNotState = !stateVars.has(i);

    if (!isParam && !(hasExplicitExpr && isNotState)) continue;

    const exprId = typeof arena.getVarExpression === "function" ? arena.getVarExpression(i) : undefined;
    if (!isParam && typeof exprId === "number" && exprId >= 0 && exprReferencesContinuous(exprId)) {
      // Continuous/discrete variable with a continuous binding expression (e.g. from omcCompatibility: true).
      // Ensure its binding equation is present in the DAE arena rather than treating it as a static parameter.
      if (existingBindingEqs === null) {
        existingBindingEqs = new Map<number, Set<number>>();
        for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
          if (arena.isEqRemoved(eqIdx) || arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
          const lhs = arena.getEqLhs(eqIdx);
          const rhs = arena.getEqRhs(eqIdx);
          if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name) {
            const nid = arena.getExprData1(lhs);
            let s = existingBindingEqs.get(nid);
            if (!s) {
              s = new Set<number>();
              existingBindingEqs.set(nid, s);
            }
            s.add(rhs);
          }
        }
      }
      const varNameId = arena.getVarNameId(i);
      if (arena.getExprKind(exprId) === ExprKind.Name && arena.getExprData1(exprId) === varNameId) {
        continue;
      }
      const hasEq = existingBindingEqs.has(varNameId);
      if (!hasEq) {
        const lhsExprId = arena.addExpression(ExprKind.Name, varNameId);
        arena.addEquation(EqKind.Simple, lhsExprId, exprId);
        let s = existingBindingEqs.get(varNameId);
        if (!s) {
          s = new Set<number>();
          existingBindingEqs.set(varNameId, s);
        }
        s.add(exprId);
      }
      continue;
    }

    parameterVars.add(i);

    const name = arena.getVarName(i);
    if (preOverrides && preOverrides.has(name)) {
      parameters.set(name, preOverrides.get(name)!);
      continue;
    }
    let val: number | null = null;
    if (typeof exprId === "number" && exprId !== -1) {
      const rawVal = evalParamExpr(exprId, i);
      if (Array.isArray(rawVal)) {
        for (let idx = 0; idx < rawVal.length; idx++) {
          const elem = rawVal[idx];
          const numElem = typeof elem === "boolean" ? (elem ? 1 : 0) : elem;
          if (typeof numElem === "number" && isFinite(numElem)) {
            const elemKey = `${name}[${idx + 1}]`;
            arena.interner.intern(elemKey);
            parameters.set(elemKey, numElem);
          }
        }
      } else {
        const numVal = typeof rawVal === "boolean" ? (rawVal ? 1 : 0) : rawVal;
        if (typeof numVal === "number" && isFinite(numVal)) {
          val = numVal;
        }
      }
    }
    if (val === null || typeof val !== "number" || !isFinite(val)) {
      val = arena.getVarStartValue(i);
    }
    parameters.set(name, val);
    arena.setVarStartValue(i, val);
  }

  // Multi-pass resolution to ensure dependent parameter expressions and fixed=false InitialSimple parameter equations converge
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (const i of parameterVars) {
      if (arena.isVarRemoved(i)) continue;
      if (!arena.isVarFixed(i) && !simArena.hasExplicitVarExpression?.(i)) continue;
      const name = arena.getVarName(i);
      if (preOverrides && preOverrides.has(name)) continue;
      const exprId = typeof arena.getVarExpression === "function" ? arena.getVarExpression(i) : undefined;
      if (typeof exprId === "number" && exprId !== -1) {
        const rawVal = evalParamExpr(exprId, i);
        if (Array.isArray(rawVal)) {
          for (let idx = 0; idx < rawVal.length; idx++) {
            const elem = rawVal[idx];
            const numElem = typeof elem === "boolean" ? (elem ? 1 : 0) : elem;
            if (typeof numElem === "number" && isFinite(numElem)) {
              const elemKey = `${name}[${idx + 1}]`;
              arena.interner.intern(elemKey);
              if (parameters.get(elemKey) !== numElem) {
                parameters.set(elemKey, numElem);
                changed = true;
              }
            }
          }
        } else {
          const numVal = typeof rawVal === "boolean" ? (rawVal ? 1 : 0) : rawVal;
          if (typeof numVal === "number" && isFinite(numVal)) {
            if (parameters.get(name) !== numVal) {
              parameters.set(name, numVal);
              arena.setVarStartValue(i, numVal);
              changed = true;
            }
          }
        }
      }
    }

    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      const eqKind = arena.getEqKind(eqIdx);
      if (eqKind !== EqKind.InitialSimple && eqKind !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      if (lhs < 0 || rhs < 0 || arena.getExprKind(lhs) !== ExprKind.Name) continue;
      const lhsNameId = arena.getExprData1(lhs);
      const vIdx = arena.lookupVariable(lhsNameId);
      if (vIdx < 0 || !parameterVars.has(vIdx)) continue;
      if (arena.isVarFixed(vIdx) || simArena.hasExplicitVarExpression?.(vIdx)) continue;
      const vName = arena.getVarName(vIdx);
      if (preOverrides && preOverrides.has(vName)) continue;
      if (exprReferencesContinuous(rhs)) continue;
      const rawVal = evalParamExpr(rhs, vIdx);
      const numVal = typeof rawVal === "boolean" ? (rawVal ? 1 : 0) : rawVal;
      if (typeof numVal === "number" && isFinite(numVal)) {
        if (parameters.get(vName) !== numVal) {
          parameters.set(vName, numVal);
          arena.setVarStartValue(vIdx, numVal);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Propagate resolved parameter values into variable `start` attributes (e.g. `Real e1q(start = e1q0)`)
  for (let vIdx = 0; vIdx < arena.varCount; vIdx++) {
    if (arena.isVarRemoved(vIdx) || parameterVars.has(vIdx)) continue;
    const startAttrId = arena.getVarAttr(vIdx, "start");
    if (typeof startAttrId === "number" && startAttrId >= 0) {
      const rawStart = evalParamExpr(startAttrId, vIdx);
      const numStart = typeof rawStart === "boolean" ? (rawStart ? 1 : 0) : rawStart;
      if (typeof numStart === "number" && isFinite(numStart)) {
        arena.setVarStartValue(vIdx, numStart);
      }
    }
  }
}

/**
 * Resolves translational (`v = der(s)`) and rotational (`w = der(phi)`) kinematic velocity couplings
 * across rigid mechanical components to prevent redundant index-2 velocity state constraints.
 */
export function resolveArenaKinematicVelocities(
  arena: DAEBuilder,
  parameters: Map<string, number>,
  parameterVars: Set<number>,
  eliminatedDerVars: Set<number>,
): void {
  // 1. Identify all differential pairs v = der(p) (and second-order a = der(v)) in the DAE
  const derVarOf = new Map<number, number>(); // pIdx -> vIdx
  const derEqOf = new Map<number, number>(); // pIdx -> eqIdx
  const isDerTarget = new Set<number>();
  const flowCoupledVars = new Set<number>();

  for (let v = 0; v < arena.varCount; v++) {
    if (!arena.isVarRemoved(v) && arena.isVarFlow(v)) {
      flowCoupledVars.add(v);
    }
  }

  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.isEqRemoved(i) || arena.isEqInitial(i)) continue;
    if (arena.getEqKind(i) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    if (arena.getExprKind(rhs) === ExprKind.Der && arena.getExprKind(lhs) === ExprKind.Name) {
      const derArg = arena.getExprData1(rhs);
      if (arena.getExprKind(derArg) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(lhs));
        const pIdx = arena.lookupVariable(arena.getExprData1(derArg));
        if (vIdx >= 0 && pIdx >= 0 && !flowCoupledVars.has(vIdx)) {
          derVarOf.set(pIdx, vIdx);
          derEqOf.set(pIdx, i);
          isDerTarget.add(vIdx);
        }
      }
    }
  }

  if (derVarOf.size === 0) return;

  // Helper: check if an expression references a specific variable index or any flow-coupled variable
  const exprRefsVar = (exprId: number, targetVarIdx: number): boolean => {
    if (exprId < 0) return false;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      return arena.lookupVariable(arena.getExprData1(exprId)) === targetVarIdx;
    }
    if (kind === ExprKind.Binary) {
      return (
        exprRefsVar(arena.getExprLeft(exprId), targetVarIdx) || exprRefsVar(arena.getExprRight(exprId), targetVarIdx)
      );
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      return exprRefsVar(arena.getExprLeft(exprId), targetVarIdx);
    }
    if (kind === ExprKind.IfElse) {
      return (
        exprRefsVar(arena.getExprData1(exprId), targetVarIdx) ||
        exprRefsVar(arena.getExprLeft(exprId), targetVarIdx) ||
        exprRefsVar(arena.getExprRight(exprId), targetVarIdx)
      );
    }
    return false;
  };

  const exprHasDer = (exprId: number): boolean => {
    if (exprId < 0) return false;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) return true;
    if (kind === ExprKind.Binary) {
      return exprHasDer(arena.getExprLeft(exprId)) || exprHasDer(arena.getExprRight(exprId));
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      return exprHasDer(arena.getExprLeft(exprId));
    }
    if (kind === ExprKind.IfElse) {
      return (
        exprHasDer(arena.getExprData1(exprId)) ||
        exprHasDer(arena.getExprLeft(exprId)) ||
        exprHasDer(arena.getExprRight(exprId))
      );
    }
    return false;
  };

  // Determine generalized inertia for a differential pair (pIdx, vIdx):
  // > 0 if backed by positive mass/inertia or non-derivative kinematic source equation;
  // === 0 if degenerate zero-mass/inertia; < 0 if massless kinematic sensor/element.
  const getGeneralizedInertiaStatus = (pIdx: number, vIdx: number): "positive" | "zero" | "kinematic" => {
    const aIdx = derVarOf.get(vIdx) ?? -1;
    const vName = arena.getVarName(vIdx);
    const dotPos = vName.lastIndexOf(".");
    const prefix = dotPos >= 0 ? vName.substring(0, dotPos) : "";

    if (prefix) {
      // Check any mass/inertia parameter in the same component scope multiplying acceleration
      for (const suffix of ["m", "J"]) {
        const paramIdx = arena.getVarIdxByName(`${prefix}.${suffix}`);
        if (paramIdx >= 0 && parameterVars.has(paramIdx)) {
          const pVal = parameters.get(`${prefix}.${suffix}`) ?? arena.getVarStartValue(paramIdx);
          return pVal > 0 ? "positive" : "zero";
        }
      }
    }

    // Structural check on dynamic equation involving acceleration `aIdx` and flow variables
    if (aIdx >= 0) {
      for (let k = 0; k < arena.eqCount; k++) {
        if (arena.getEqKind(k) !== EqKind.Simple || k === derEqOf.get(vIdx)) continue;
        const kLhs = arena.getEqLhs(k);
        const kRhs = arena.getEqRhs(k);
        if (exprRefsVar(kLhs, aIdx) || exprRefsVar(kRhs, aIdx)) {
          for (const fVar of flowCoupledVars) {
            if (exprRefsVar(kLhs, fVar) || exprRefsVar(kRhs, fVar)) {
              return "positive";
            }
          }
        }
      }
    }

    // Structural check for kinematic position source equation (pIdx defined by non-derivative, non-flow equation)
    for (let k = 0; k < arena.eqCount; k++) {
      if (arena.getEqKind(k) !== EqKind.Simple || k === derEqOf.get(pIdx)) continue;
      const kLhs = arena.getEqLhs(k);
      const kRhs = arena.getEqRhs(k);
      if (
        arena.getExprKind(kLhs) === ExprKind.Name &&
        arena.lookupVariable(arena.getExprData1(kLhs)) === pIdx &&
        !exprHasDer(kRhs)
      ) {
        return "positive";
      }
    }

    return "kinematic";
  };

  const velOfPos = new Map<number, number>();
  const inertiaStatusOfPos = new Map<number, "positive" | "zero" | "kinematic">();

  for (const [pIdx, vIdx] of derVarOf) {
    if (isDerTarget.has(pIdx)) continue; // Skip second-order (v, a) pairs
    const status = getGeneralizedInertiaStatus(pIdx, vIdx);
    inertiaStatusOfPos.set(pIdx, status);
    if (status === "positive") {
      velOfPos.set(pIdx, vIdx);
      // Also seed same-component connector positions connected by constant geometry offset
      const pName = arena.getVarName(pIdx);
      const dotIdx = pName.lastIndexOf(".");
      if (dotIdx >= 0) {
        const prefix = pName.substring(0, dotIdx);
        const leaf = pName.substring(dotIdx + 1);
        for (const port of ["flange_a", "flange_b", "flange"]) {
          const portVarIdx = arena.getVarIdxByName(`${prefix}.${port}.${leaf}`);
          if (portVarIdx >= 0) velOfPos.set(portVarIdx, vIdx);
        }
      }
    }
  }

  const coupledMasses = new Map<number, number>();

  // 2. Propagate driving velocities across position equality and constant-offset equations
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < arena.eqCount; i++) {
      if (arena.getEqKind(i) !== EqKind.Simple && arena.getEqKind(i) !== EqKind.Connect) continue;
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (arena.getExprKind(lhs) === ExprKind.Name && arena.getExprKind(rhs) === ExprKind.Name) {
        const id1 = arena.lookupVariable(arena.getExprData1(lhs));
        const id2 = arena.lookupVariable(arena.getExprData1(rhs));
        if (id1 >= 0 && id2 >= 0) {
          const v1 = velOfPos.get(id1);
          const v2 = velOfPos.get(id2);
          if (v1 !== undefined && v2 === undefined) {
            velOfPos.set(id2, v1);
            changed = true;
          } else if (v2 !== undefined && v1 === undefined) {
            velOfPos.set(id1, v2);
            changed = true;
          } else if (v1 !== undefined && v2 !== undefined && v1 !== v2) {
            const primary = Math.min(v1, v2);
            const secondary = Math.max(v1, v2);
            coupledMasses.set(secondary, primary);
          }
        }
      }
    }
  }

  // 3. Rewrite dependent kinematic velocity (and coupled acceleration) equations
  for (const [sIdx, vIdx] of derVarOf) {
    if (isDerTarget.has(sIdx)) continue;
    const eqIdx = derEqOf.get(sIdx)!;

    if (coupledMasses.has(vIdx)) {
      const primaryV = coupledMasses.get(vIdx)!;
      const vExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(primaryV));
      arena.setEqRhs(eqIdx, vExpr);
      eliminatedDerVars.add(sIdx);
      const aIdx = derVarOf.get(vIdx) ?? -1;
      const primaryAIdx = derVarOf.get(primaryV) ?? -1;
      if (aIdx >= 0 && primaryAIdx >= 0) {
        const aEqIdx = derEqOf.get(vIdx);
        if (aEqIdx !== undefined) {
          const aExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(primaryAIdx));
          arena.setEqRhs(aEqIdx, aExpr);
          eliminatedDerVars.add(vIdx);
        }
      }
      continue;
    }

    const status = inertiaStatusOfPos.get(sIdx);
    if (status === "positive" || status === "zero") continue;

    let resolvedV = velOfPos.get(sIdx);
    if (resolvedV === undefined) {
      const sName = arena.getVarName(sIdx);
      const dotIdx = sName.lastIndexOf(".");
      if (dotIdx >= 0) {
        const prefix = sName.substring(0, dotIdx);
        const leaf = sName.substring(dotIdx + 1).replace(/_rel$/, "");
        for (const port of ["flange", "flange_b", "flange_a"]) {
          const portIdx = arena.getVarIdxByName(`${prefix}.${port}.${leaf}`);
          if (portIdx >= 0 && velOfPos.has(portIdx)) {
            resolvedV = velOfPos.get(portIdx);
            break;
          }
        }
      }
    }

    if (resolvedV !== undefined && resolvedV !== vIdx) {
      const vExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(resolvedV));
      arena.setEqRhs(eqIdx, vExpr);
      eliminatedDerVars.add(sIdx);
    }
  }

  // 4. Structural kinematic ratio resolution for zero-inertia chains coupled to positive-inertia chains
  //    via linear transformer/rolling-wheel constraints (e.g. `(phi_R - phi_0) * radius = s_T - s_0`)
  const posChainOf = new Map<number, number>();
  for (const [pIdx] of derVarOf) {
    if (isDerTarget.has(pIdx)) continue;
    posChainOf.set(pIdx, pIdx);
    const pName = arena.getVarName(pIdx);
    const dotIdx = pName.lastIndexOf(".");
    if (dotIdx >= 0) {
      const prefix = pName.substring(0, dotIdx);
      const leaf = pName.substring(dotIdx + 1).replace(/_rel$/, "");
      for (const port of ["flange_a", "flange_b", "flange"]) {
        const portVarIdx = arena.getVarIdxByName(`${prefix}.${port}.${leaf}`);
        if (portVarIdx >= 0 && !posChainOf.has(portVarIdx)) {
          posChainOf.set(portVarIdx, pIdx);
        }
      }
    }
  }
  let chainChanged = true;
  while (chainChanged) {
    chainChanged = false;
    for (let i = 0; i < arena.eqCount; i++) {
      if (arena.getEqKind(i) !== EqKind.Simple && arena.getEqKind(i) !== EqKind.Connect) continue;
      const lhs = arena.getEqLhs(i);
      const rhs = arena.getEqRhs(i);
      if (arena.getExprKind(lhs) === ExprKind.Name && arena.getExprKind(rhs) === ExprKind.Name) {
        const id1 = arena.lookupVariable(arena.getExprData1(lhs));
        const id2 = arena.lookupVariable(arena.getExprData1(rhs));
        if (id1 >= 0 && id2 >= 0 && !flowCoupledVars.has(id1) && !flowCoupledVars.has(id2)) {
          const c1 = posChainOf.get(id1);
          const c2 = posChainOf.get(id2);
          if (c1 !== undefined && c2 === undefined) {
            posChainOf.set(id2, c1);
            chainChanged = true;
          } else if (c2 !== undefined && c1 === undefined) {
            posChainOf.set(id1, c2);
            chainChanged = true;
          }
        }
      }
    }
  }

  for (const [pZeroIdx, vZeroIdx] of derVarOf) {
    if (inertiaStatusOfPos.get(pZeroIdx) !== "zero") continue;
    const aZeroIdx = derVarOf.get(vZeroIdx) ?? -1;
    const zeroPrefix = arena.getVarName(pZeroIdx).split(".").slice(0, -2).join(".");

    // Find a positive-inertia chain coupled via a linear kinematic equation
    for (const [pPosIdx, vPosIdx] of derVarOf) {
      if (inertiaStatusOfPos.get(pPosIdx) !== "positive" || pPosIdx === pZeroIdx) continue;
      const posPrefix = arena.getVarName(pPosIdx).split(".").slice(0, -2).join(".");
      if (zeroPrefix !== posPrefix) continue;

      interface PairLinComb {
        cZero: number;
        cPos: number;
        constVal: number;
        unknowns: Map<number, number>;
      }

      const pairVarComb = new Map<number, { cZero: number; cPos: number; constVal: number }>();

      const evalPairLin = (exprId: number): PairLinComb | null => {
        if (exprId < 0) return null;
        const k = arena.getExprKind(exprId);
        if (k === ExprKind.RealLiteral) {
          return { cZero: 0, cPos: 0, constVal: arena.getExprRealValue(exprId), unknowns: new Map() };
        }
        if (k === ExprKind.IntLiteral || k === ExprKind.BoolLiteral || k === ExprKind.EnumLiteral) {
          return { cZero: 0, cPos: 0, constVal: arena.getExprData1(exprId), unknowns: new Map() };
        }
        if (k === ExprKind.Name) {
          const nameId = arena.getExprData1(exprId);
          const vIdx = arena.lookupVariable(nameId);
          if (vIdx < 0) {
            const name = arena.interner.resolve(nameId);
            if (name && parameters.has(name)) {
              return { cZero: 0, cPos: 0, constVal: parameters.get(name)!, unknowns: new Map() };
            }
            return null;
          }
          if (parameterVars.has(vIdx)) {
            const name = arena.getVarName(vIdx);
            const val = parameters.get(name) ?? arena.getVarStartValue(vIdx);
            return { cZero: 0, cPos: 0, constVal: val, unknowns: new Map() };
          }
          if (flowCoupledVars.has(vIdx)) return null;
          const chainRoot = posChainOf.get(vIdx);
          if (vIdx === pZeroIdx || vIdx === vZeroIdx || chainRoot === pZeroIdx) {
            return { cZero: 1, cPos: 0, constVal: 0, unknowns: new Map() };
          }
          if (vIdx === pPosIdx || vIdx === vPosIdx || chainRoot === pPosIdx) {
            return { cZero: 0, cPos: 1, constVal: 0, unknowns: new Map() };
          }
          if (chainRoot !== undefined || derVarOf.has(vIdx) || isDerTarget.has(vIdx)) {
            return null;
          }
          const known = pairVarComb.get(vIdx);
          if (known) {
            return { cZero: known.cZero, cPos: known.cPos, constVal: known.constVal, unknowns: new Map() };
          }
          return { cZero: 0, cPos: 0, constVal: 0, unknowns: new Map([[vIdx, 1.0]]) };
        }
        if (k === ExprKind.Negate || (k === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
          const sub = evalPairLin(arena.getExprLeft(exprId));
          if (!sub) return null;
          const unknowns = new Map<number, number>();
          for (const [uk, uv] of sub.unknowns) unknowns.set(uk, -uv);
          return { cZero: -sub.cZero, cPos: -sub.cPos, constVal: -sub.constVal, unknowns };
        }
        if (k === ExprKind.Binary) {
          const op = arena.getExprData1(exprId) as BinOp;
          const l = evalPairLin(arena.getExprLeft(exprId));
          if (!l) return null;
          const r = evalPairLin(arena.getExprRight(exprId));
          if (!r) return null;
          if (op === BinOp.Add || op === BinOp.Sub) {
            const s = op === BinOp.Add ? 1 : -1;
            const unknowns = new Map(l.unknowns);
            for (const [uk, uv] of r.unknowns) {
              const next = (unknowns.get(uk) ?? 0) + s * uv;
              if (Math.abs(next) < 1e-14) unknowns.delete(uk);
              else unknowns.set(uk, next);
            }
            return {
              cZero: l.cZero + s * r.cZero,
              cPos: l.cPos + s * r.cPos,
              constVal: l.constVal + s * r.constVal,
              unknowns,
            };
          }
          if (op === BinOp.Mul) {
            const lPureConst = l.cZero === 0 && l.cPos === 0 && l.unknowns.size === 0;
            const rPureConst = r.cZero === 0 && r.cPos === 0 && r.unknowns.size === 0;
            if (lPureConst) {
              const f = l.constVal;
              const unknowns = new Map<number, number>();
              for (const [uk, uv] of r.unknowns) if (Math.abs(uv * f) >= 1e-14) unknowns.set(uk, uv * f);
              return { cZero: r.cZero * f, cPos: r.cPos * f, constVal: r.constVal * f, unknowns };
            }
            if (rPureConst) {
              const f = r.constVal;
              const unknowns = new Map<number, number>();
              for (const [uk, uv] of l.unknowns) if (Math.abs(uv * f) >= 1e-14) unknowns.set(uk, uv * f);
              return { cZero: l.cZero * f, cPos: l.cPos * f, constVal: l.constVal * f, unknowns };
            }
            return null;
          }
          if (op === BinOp.Div) {
            const rPureConst = r.cZero === 0 && r.cPos === 0 && r.unknowns.size === 0 && Math.abs(r.constVal) > 1e-15;
            if (rPureConst) {
              const f = 1.0 / r.constVal;
              const unknowns = new Map<number, number>();
              for (const [uk, uv] of l.unknowns) if (Math.abs(uv * f) >= 1e-14) unknowns.set(uk, uv * f);
              return { cZero: l.cZero * f, cPos: l.cPos * f, constVal: l.constVal * f, unknowns };
            }
            return null;
          }
        }
        return null;
      };

      let ratioVal = 0;
      const usedPairEqs = new Set<number>();
      let pairProg = true;
      while (pairProg && ratioVal === 0) {
        pairProg = false;
        for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
          if (usedPairEqs.has(eqIdx) || arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
          const lComb = evalPairLin(arena.getEqLhs(eqIdx));
          if (!lComb) continue;
          const rComb = evalPairLin(arena.getEqRhs(eqIdx));
          if (!rComb) continue;
          const unknowns = new Map(lComb.unknowns);
          for (const [uk, uv] of rComb.unknowns) {
            const next = (unknowns.get(uk) ?? 0) - uv;
            if (Math.abs(next) < 1e-14) unknowns.delete(uk);
            else unknowns.set(uk, next);
          }
          const cZero = lComb.cZero - rComb.cZero;
          const cPos = lComb.cPos - rComb.cPos;
          const constVal = lComb.constVal - rComb.constVal;

          if (unknowns.size === 0) {
            if (Math.abs(cZero) > 1e-12 && Math.abs(cPos) > 1e-12) {
              ratioVal = Math.abs(cZero / cPos);
              break;
            }
          } else if (unknowns.size === 1) {
            const [uIdx, uCoeff] = unknowns.entries().next().value!;
            if (Math.abs(uCoeff) > 1e-12) {
              pairVarComb.set(uIdx, {
                cZero: -cZero / uCoeff,
                cPos: -cPos / uCoeff,
                constVal: -constVal / uCoeff,
              });
              usedPairEqs.add(eqIdx);
              pairProg = true;
            }
          } else if (Math.abs(cZero) > 1e-12 && Math.abs(cPos) > 1e-12) {
            // Equation couples cZero and cPos alongside fixed housing/support offsets
            let allSupportOffsets = true;
            for (const uIdx of unknowns.keys()) {
              if (flowCoupledVars.has(uIdx) || derVarOf.has(uIdx) || isDerTarget.has(uIdx)) {
                allSupportOffsets = false;
                break;
              }
            }
            if (allSupportOffsets) {
              ratioVal = Math.abs(cZero / cPos);
              break;
            }
          }
        }
      }

      // Fallback: check parameter in scope ONLY if it is referenced in an equation alongside a position chain variable
      if (ratioVal === 0) {
        for (const pVarIdx of parameterVars) {
          const pVarName = arena.getVarName(pVarIdx);
          const matchesScope = zeroPrefix ? pVarName.startsWith(zeroPrefix + ".") : !pVarName.includes(".");
          if (!matchesScope || !(pVarName.endsWith(".radius") || pVarName.endsWith(".R"))) continue;
          const val = parameters.get(pVarName) ?? arena.getVarStartValue(pVarIdx);
          if (val <= 0) continue;
          let referencedWithChain = false;
          for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
            if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
            const lhs = arena.getEqLhs(eqIdx);
            const rhs = arena.getEqRhs(eqIdx);
            if (exprRefsVar(lhs, pVarIdx) || exprRefsVar(rhs, pVarIdx)) {
              for (const [chainVarIdx, rootIdx] of posChainOf) {
                if (rootIdx === pZeroIdx || rootIdx === pPosIdx) {
                  if (exprRefsVar(lhs, chainVarIdx) || exprRefsVar(rhs, chainVarIdx)) {
                    referencedWithChain = true;
                    break;
                  }
                }
              }
            }
            if (referencedWithChain) break;
          }
          if (referencedWithChain) {
            ratioVal = val;
            break;
          }
        }
      }

      if (ratioVal > 0) {
        const vZeroEq = derEqOf.get(pZeroIdx);
        if (vZeroEq !== undefined) {
          const vExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(vPosIdx));
          const rExpr = arena.addRealLiteral(ratioVal);
          arena.setEqRhs(vZeroEq, arena.addBinaryExpr(BinOp.Div, vExpr, rExpr));
          eliminatedDerVars.add(pZeroIdx);
        }
        const aPosIdx = derVarOf.get(vPosIdx) ?? -1;
        const aZeroEq = derEqOf.get(vZeroIdx);
        if (aZeroIdx >= 0 && aPosIdx >= 0 && aZeroEq !== undefined) {
          const aExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(aPosIdx));
          const rExpr = arena.addRealLiteral(ratioVal);
          arena.setEqRhs(aZeroEq, arena.addBinaryExpr(BinOp.Div, aExpr, rExpr));
          eliminatedDerVars.add(vZeroIdx);
        }
        break;
      }
    }
  }
}

/**
 * Performs symbolic index-reduction on affine constraints among differentiated states
 * (e.g., Rigidly connected rotational inertias `phi1 = phi2 + c` or translational masses `s1 = s2`).
 *
 * 1. Scans all `EqKind.Simple` equations to identify candidate state variables (`allDerVars`) and
 *    first-order derivative aliases (`w = der(x)`).
 * 2. Evaluates equations symbolically into affine combinations (`constant + sum_i coeff_i * x_i`).
 * 3. Uses `stateSelect` priority attributes (`never` > `avoid` > `default` > `prefer` > `always`)
 *    and `fixed` flags to select dependent states for elimination.
 * 4. Rewrites `der(sDep)` (and second-order `der(wDep)`) into linear combinations of independent state derivatives.
 */
export function reduceArenaAffineStateConstraints(
  arena: DAEBuilder,
  parameters: Map<string, number>,
  parameterVars: Set<number>,
  eliminatedDerVars: Set<number>,
): void {
  const allDerVars = new Set<number>();
  const derAliasOf = new Map<number, number>();
  const isDerAliasTarget = new Set<number>();

  // Helper: ignore degenerate zero-inertia or zero-mass mechanical states
  const isZeroMassOrInertia = (varIdx: number): boolean => {
    const name = arena.getVarName(varIdx);
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx < 0) return false;
    const prefix = name.substring(0, dotIdx);
    for (const paramSuffix of ["J", "m"]) {
      const pIdx = arena.getVarIdxByName(`${prefix}.${paramSuffix}`);
      if (pIdx >= 0 && parameterVars.has(pIdx)) {
        const pVal = parameters.get(`${prefix}.${paramSuffix}`) ?? arena.getVarStartValue(pIdx);
        if (pVal === 0) return true;
      }
    }
    return false;
  };

  // 1. Recursively scan arena expressions to collect all variables appearing inside `der(x)`
  const scanDerExpr = (exprId: number) => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) {
      currentEqHasDerOrNonAffine = true;
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(argId));
        if (vIdx >= 0 && !isZeroMassOrInertia(vIdx)) {
          allDerVars.add(vIdx);
        }
      }
      return;
    }
    switch (kind) {
      case ExprKind.Binary:
        scanDerExpr(arena.getExprLeft(exprId));
        scanDerExpr(arena.getExprRight(exprId));
        break;
      case ExprKind.Unary:
      case ExprKind.Negate:
        scanDerExpr(arena.getExprLeft(exprId));
        break;
      case ExprKind.IfElse:
        currentEqHasDerOrNonAffine = true;
        scanDerExpr(arena.getExprData1(exprId));
        scanDerExpr(arena.getExprLeft(exprId));
        scanDerExpr(arena.getExprRight(exprId));
        break;
      case ExprKind.Call: {
        currentEqHasDerOrNonAffine = true;
        const argCount = arena.getExprRight(exprId);
        if (argCount > 0) {
          const firstArg = arena.getExprLeft(exprId);
          for (let a = 0; a < argCount; a++) {
            scanDerExpr(a === 0 ? firstArg : arena.getExprLeft(exprId + a));
          }
        }
        break;
      }
      case ExprKind.Tuple:
      case ExprKind.ArrayCtor: {
        currentEqHasDerOrNonAffine = true;
        const count = arena.getExprData1(exprId);
        if (count > 0) {
          const firstElem = arena.getExprLeft(exprId);
          for (let e = 0; e < count; e++) {
            scanDerExpr(e === 0 ? firstElem : arena.getExprLeft(exprId + e));
          }
        }
        break;
      }
    }
  };

  let currentEqHasDerOrNonAffine = false;
  const affineCandidateEqs: number[] = [];

  // Also record direct velocity/angular-velocity alias equations `w = der(x)`
  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.isEqRemoved(i) || arena.isEqInitial(i)) continue;
    if (arena.getEqKind(i) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(i);
    const rhs = arena.getEqRhs(i);
    currentEqHasDerOrNonAffine = false;
    scanDerExpr(lhs);
    scanDerExpr(rhs);
    if (!currentEqHasDerOrNonAffine) {
      affineCandidateEqs.push(i);
    }

    if (arena.getExprKind(lhs) === ExprKind.Name && arena.getExprKind(rhs) === ExprKind.Der) {
      const derArg = arena.getExprData1(rhs);
      if (arena.getExprKind(derArg) === ExprKind.Name) {
        const wIdx = arena.lookupVariable(arena.getExprData1(lhs));
        const xIdx = arena.lookupVariable(arena.getExprData1(derArg));
        if (wIdx >= 0 && xIdx >= 0 && !isZeroMassOrInertia(xIdx)) {
          derAliasOf.set(xIdx, wIdx);
          isDerAliasTarget.add(wIdx);
        }
      }
    } else if (arena.getExprKind(rhs) === ExprKind.Name && arena.getExprKind(lhs) === ExprKind.Der) {
      const derArg = arena.getExprData1(lhs);
      if (arena.getExprKind(derArg) === ExprKind.Name) {
        const wIdx = arena.lookupVariable(arena.getExprData1(rhs));
        const xIdx = arena.lookupVariable(arena.getExprData1(derArg));
        if (wIdx >= 0 && xIdx >= 0 && !isZeroMassOrInertia(xIdx)) {
          derAliasOf.set(xIdx, wIdx);
          isDerAliasTarget.add(wIdx);
        }
      }
    }
  }

  if (allDerVars.size === 0 || affineCandidateEqs.length === 0) return;

  // 2. Seed primary candidate states (excluding derivative alias targets `w` where `w = der(phi)`)
  const activeCandidateStates = new Set<number>();
  for (const v of allDerVars) {
    if (!isDerAliasTarget.has(v)) {
      activeCandidateStates.add(v);
    }
  }
  if (activeCandidateStates.size === 0) return;

  const collectExprNonParamVars = (exprId: number, out: Set<number>): void => {
    if (exprId < 0) return;
    const k = arena.getExprKind(exprId);
    if (k === ExprKind.Name) {
      const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
      if (vIdx >= 0 && !parameterVars.has(vIdx)) {
        out.add(vIdx);
      }
      return;
    }
    if (k === ExprKind.Binary) {
      collectExprNonParamVars(arena.getExprLeft(exprId), out);
      collectExprNonParamVars(arena.getExprRight(exprId), out);
    } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
      collectExprNonParamVars(arena.getExprLeft(exprId), out);
    } else if (k === ExprKind.IfElse) {
      collectExprNonParamVars(arena.getExprData1(exprId), out);
      collectExprNonParamVars(arena.getExprLeft(exprId), out);
      collectExprNonParamVars(arena.getExprRight(exprId), out);
    }
  };

  // Fast structural pre-check: an affine state constraint can only arise if either
  // (a) some derivative-free equation references ONLY candidate states (0 non-state variables), or
  // (b) some non-state variable appears in >= 2 derivative-free equations.
  const eqVarsScratch = new Set<number>();
  const nonStateDegree = new Map<number, number>();
  let canHaveAffineStateConstraint = false;
  for (let idx = 0; idx < affineCandidateEqs.length; idx++) {
    const eqIdx = affineCandidateEqs[idx]!;
    eqVarsScratch.clear();
    collectExprNonParamVars(arena.getEqLhs(eqIdx), eqVarsScratch);
    collectExprNonParamVars(arena.getEqRhs(eqIdx), eqVarsScratch);
    let stateCount = 0;
    let nonStateCount = 0;
    for (const v of eqVarsScratch) {
      if (activeCandidateStates.has(v)) {
        stateCount++;
      } else {
        nonStateCount++;
        const deg = (nonStateDegree.get(v) ?? 0) + 1;
        nonStateDegree.set(v, deg);
        if (deg >= 2) {
          canHaveAffineStateConstraint = true;
        }
      }
    }
    if (stateCount > 0 && nonStateCount === 0) {
      canHaveAffineStateConstraint = true;
    }
  }
  if (!canHaveAffineStateConstraint) return;

  // Identify flow-coupled generalized force/torque variables structurally from connector flow flags
  // and multi-term non-state force/torque balances (e.g. tau = tau_c + tau_d)
  const flowCoupledVars = new Set<number>();
  for (let v = 0; v < arena.varCount; v++) {
    if (!arena.isVarRemoved(v) && arena.isVarFlow(v)) {
      flowCoupledVars.add(v);
    }
  }
  let flowChanged = flowCoupledVars.size > 0;
  while (flowChanged) {
    flowChanged = false;
    for (let idx = 0; idx < affineCandidateEqs.length; idx++) {
      const eqIdx = affineCandidateEqs[idx]!;
      eqVarsScratch.clear();
      collectExprNonParamVars(arena.getEqLhs(eqIdx), eqVarsScratch);
      collectExprNonParamVars(arena.getEqRhs(eqIdx), eqVarsScratch);
      let touchesState = false;
      let touchesFlow = false;
      for (const v of eqVarsScratch) {
        if (allDerVars.has(v)) touchesState = true;
        if (flowCoupledVars.has(v)) touchesFlow = true;
      }
      if (!touchesState && touchesFlow) {
        for (const v of eqVarsScratch) {
          if (!flowCoupledVars.has(v)) {
            flowCoupledVars.add(v);
            flowChanged = true;
          }
        }
      }
    }
  }

  interface AffineComb {
    constant: number;
    coeffs: Map<number, number>;
  }

  const stateComb = new Map<number, AffineComb>();
  for (const s of activeCandidateStates) {
    stateComb.set(s, { constant: 0, coeffs: new Map([[s, 1.0]]) });
  }

  const cloneComb = (c: AffineComb): AffineComb => ({
    constant: c.constant,
    coeffs: new Map(c.coeffs),
  });

  const addComb = (a: AffineComb, b: AffineComb, signB: number): AffineComb => {
    const coeffs = new Map(a.coeffs);
    for (const [k, v] of b.coeffs) {
      const next = (coeffs.get(k) ?? 0) + signB * v;
      if (Math.abs(next) < 1e-14) {
        coeffs.delete(k);
      } else {
        coeffs.set(k, next);
      }
    }
    return { constant: a.constant + signB * b.constant, coeffs };
  };

  const scaleComb = (a: AffineComb, factor: number): AffineComb => {
    if (Math.abs(factor) < 1e-15) {
      return { constant: 0, coeffs: new Map() };
    }
    const coeffs = new Map<number, number>();
    for (const [k, v] of a.coeffs) {
      const next = v * factor;
      if (Math.abs(next) >= 1e-14) {
        coeffs.set(k, next);
      }
    }
    return { constant: a.constant * factor, coeffs };
  };

  // 3. Symbolically evaluate an arena expression into an AffineComb if it is purely linear/affine
  const evalAffine = (exprId: number): AffineComb | null => {
    if (exprId < 0) return null;
    const kind = arena.getExprKind(exprId);
    switch (kind) {
      case ExprKind.RealLiteral:
        return { constant: arena.getExprRealValue(exprId), coeffs: new Map() };
      case ExprKind.IntLiteral:
      case ExprKind.BoolLiteral:
      case ExprKind.EnumLiteral:
        return { constant: arena.getExprData1(exprId), coeffs: new Map() };
      case ExprKind.Name: {
        const nameId = arena.getExprData1(exprId);
        const vIdx = arena.lookupVariable(nameId);
        if (vIdx < 0) {
          const name = arena.interner.resolve(nameId);
          if (name && parameters.has(name)) {
            return { constant: parameters.get(name)!, coeffs: new Map() };
          }
          return null;
        }
        if (parameterVars.has(vIdx)) {
          const name = arena.getVarName(vIdx);
          const val = parameters.get(name) ?? arena.getVarStartValue(vIdx);
          return { constant: val, coeffs: new Map() };
        }
        if (isDerAliasTarget.has(vIdx) || flowCoupledVars.has(vIdx)) {
          return null;
        }
        const existing = stateComb.get(vIdx);
        if (existing) {
          return cloneComb(existing);
        }
        return { constant: 0, coeffs: new Map([[vIdx, 1.0]]) };
      }
      case ExprKind.Negate: {
        const sub = evalAffine(arena.getExprLeft(exprId));
        return sub ? scaleComb(sub, -1.0) : null;
      }
      case ExprKind.Unary: {
        const op = arena.getExprData1(exprId);
        const sub = evalAffine(arena.getExprLeft(exprId));
        if (!sub) return null;
        if (op === UnaryOp.Negate) return scaleComb(sub, -1.0);
        return null;
      }
      case ExprKind.Binary: {
        const op = arena.getExprData1(exprId);
        const left = evalAffine(arena.getExprLeft(exprId));
        if (!left) return null;
        const right = evalAffine(arena.getExprRight(exprId));
        if (!right) return null;
        if (op === BinOp.Add) return addComb(left, right, 1.0);
        if (op === BinOp.Sub) return addComb(left, right, -1.0);
        if (op === BinOp.Mul) {
          if (left.coeffs.size === 0) return scaleComb(right, left.constant);
          if (right.coeffs.size === 0) return scaleComb(left, right.constant);
          return null;
        }
        if (op === BinOp.Div) {
          if (right.coeffs.size === 0 && Math.abs(right.constant) > 1e-15) {
            return scaleComb(left, 1.0 / right.constant);
          }
          return null;
        }
        return null;
      }
      default:
        return null;
    }
  };

  const usedEqs = new Set<number>();
  const eliminatedStates: number[] = [];

  // 4. Fixed-point Gaussian elimination over affine algebraic equations
  let changed = true;
  while (changed) {
    changed = false;
    for (let idx = 0; idx < affineCandidateEqs.length; idx++) {
      const eqIdx = affineCandidateEqs[idx]!;
      if (usedEqs.has(eqIdx)) continue;
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      const lComb = evalAffine(lhs);
      if (!lComb) continue;
      const rComb = evalAffine(rhs);
      if (!rComb) continue;
      const diff = addComb(lComb, rComb, -1.0);

      const unknownNonStates: number[] = [];
      for (const k of diff.coeffs.keys()) {
        if (!activeCandidateStates.has(k)) {
          unknownNonStates.push(k);
        }
      }

      if (unknownNonStates.length === 1) {
        // Case A: Equation defines a single algebraic kinematic variable `u` in terms of states
        const u = unknownNonStates[0]!;
        const cu = diff.coeffs.get(u)!;
        if (Math.abs(cu) > 1e-12) {
          const coeffsU = new Map<number, number>();
          for (const [k, v] of diff.coeffs) {
            if (k === u) continue;
            const c = -v / cu;
            if (Math.abs(c) >= 1e-14) coeffsU.set(k, c);
          }
          stateComb.set(u, { constant: -diff.constant / cu, coeffs: coeffsU });
          usedEqs.add(eqIdx);
          changed = true;
        }
      } else if (unknownNonStates.length === 0) {
        // Case B: Pure affine constraint among candidate states — score and eliminate one dependent state `bestS`
        usedEqs.add(eqIdx);
        if (diff.coeffs.size >= 1) {
          const lhsVarIdx =
            arena.getExprKind(lhs) === ExprKind.Name ? arena.lookupVariable(arena.getExprData1(lhs)) : -1;
          let bestS = -1;
          let bestScore = -Infinity;
          for (const [s, cs] of diff.coeffs) {
            if (Math.abs(cs) <= 1e-12) continue;
            const sName = arena.getVarName(s);
            let score = 0;
            const ssAttr = arena.getVarAttr(s, "stateSelect");
            if (ssAttr !== undefined && ssAttr >= 0) {
              const ssKind = arena.getExprKind(ssAttr);
              if (ssKind === ExprKind.IntLiteral) {
                const ssVal = arena.getExprData1(ssAttr);
                // 1=never, 2=avoid, 3=default, 4=prefer, 5=always
                if (ssVal === 1) score += 2000;
                else if (ssVal === 2) score += 1000;
                else if (ssVal === 4) score -= 1000;
                else if (ssVal === 5) score -= 2000;
              } else if (ssKind === ExprKind.Name || ssKind === ExprKind.EnumLiteral) {
                const ssText = arena.interner.resolve(arena.getExprData1(ssAttr)) ?? "";
                if (ssText.endsWith(".never") || ssText === "never") score += 2000;
                else if (ssText.endsWith(".avoid") || ssText === "avoid") score += 1000;
                else if (ssText.endsWith(".prefer") || ssText === "prefer") score -= 1000;
                else if (ssText.endsWith(".always") || ssText === "always") score -= 2000;
              }
            }
            const isRelativeCoordinate = (s === lhsVarIdx && diff.coeffs.size >= 3) || sName.endsWith("_rel");
            if (isRelativeCoordinate) {
              score += 1000;
            }
            score += !arena.isVarFixed(s) ? 500 : -500;
            if (s === lhsVarIdx) score += 50;
            score += s * 1e-4;
            if (score > bestScore) {
              bestScore = score;
              bestS = s;
            }
          }

          if (bestS >= 0) {
            const cDep = diff.coeffs.get(bestS)!;
            const coeffsDep = new Map<number, number>();
            for (const [s, cs] of diff.coeffs) {
              if (s === bestS) continue;
              const c = -cs / cDep;
              if (Math.abs(c) >= 1e-14) coeffsDep.set(s, c);
            }
            const combDep: AffineComb = {
              constant: -diff.constant / cDep,
              coeffs: coeffsDep,
            };
            activeCandidateStates.delete(bestS);
            eliminatedStates.push(bestS);

            // Substitute bestS -> combDep in all existing stateComb entries
            for (const [vKey, vComb] of stateComb) {
              void vKey;
              const coeffInV = vComb.coeffs.get(bestS);
              if (coeffInV !== undefined) {
                vComb.coeffs.delete(bestS);
                vComb.constant += coeffInV * combDep.constant;
                for (const [sRem, cRem] of combDep.coeffs) {
                  const next = (vComb.coeffs.get(sRem) ?? 0) + coeffInV * cRem;
                  if (Math.abs(next) < 1e-14) {
                    vComb.coeffs.delete(sRem);
                  } else {
                    vComb.coeffs.set(sRem, next);
                  }
                }
              }
            }
            stateComb.set(bestS, combDep);
            changed = true;
          }
        }
      }
    }
  }

  if (eliminatedStates.length === 0) return;

  // 5. Differentiate the affine state relation `sDep = c_0 + sum c_i * s_i` to synthesize
  //    `der(sDep) = sum c_i * der(s_i)` (order 1) and `der(wDep) = sum c_i * der(w_i)` (order 2)
  const buildLinearDerComboExpr = (coeffs: Map<number, number>, order: 1 | 2): number => {
    let sumExpr = -1;
    for (const [s, c] of coeffs) {
      if (Math.abs(c) < 1e-14) continue;
      let baseDerExpr: number;
      if (order === 1) {
        const wIdx = derAliasOf.get(s);
        if (wIdx !== undefined && allDerVars.has(wIdx)) {
          baseDerExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(wIdx));
        } else {
          const sNameExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(s));
          baseDerExpr = arena.addDerExpr(sNameExpr);
        }
      } else {
        const wIdx = derAliasOf.get(s);
        const targetIdx = wIdx !== undefined ? wIdx : s;
        const targetNameExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(targetIdx));
        baseDerExpr = arena.addDerExpr(targetNameExpr);
      }

      let termExpr: number;
      const absC = Math.abs(c);
      const isNeg = c < 0;
      if (Math.abs(absC - 1.0) < 1e-12) {
        termExpr = baseDerExpr;
      } else {
        const cLit = arena.addRealLiteral(absC);
        termExpr = arena.addBinaryExpr(BinOp.Mul, cLit, baseDerExpr);
      }

      if (sumExpr === -1) {
        sumExpr = isNeg ? arena.addNegateExpr(termExpr) : termExpr;
      } else {
        sumExpr = arena.addBinaryExpr(isNeg ? BinOp.Sub : BinOp.Add, sumExpr, termExpr);
      }
    }
    if (sumExpr === -1) {
      sumExpr = arena.addRealLiteral(0.0);
    }
    return sumExpr;
  };

  const replaceDerInExpr = (exprId: number, targetVarIdx: number, replacementExprId: number): number => {
    if (exprId < 0) return exprId;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(argId));
        if (vIdx === targetVarIdx) {
          return replacementExprId;
        }
      }
      return exprId;
    }
    switch (kind) {
      case ExprKind.Binary: {
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
        if (nl !== l || nr !== r) {
          return arena.addBinaryExpr(arena.getExprData1(exprId), nl, nr);
        }
        return exprId;
      }
      case ExprKind.Negate: {
        const l = arena.getExprLeft(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        if (nl !== l) {
          return arena.addNegateExpr(nl);
        }
        return exprId;
      }
      case ExprKind.Unary: {
        const l = arena.getExprLeft(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        if (nl !== l) {
          return arena.addUnaryExpr(arena.getExprData1(exprId), nl);
        }
        return exprId;
      }
      case ExprKind.IfElse: {
        const cond = arena.getExprData1(exprId);
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nCond = replaceDerInExpr(cond, targetVarIdx, replacementExprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
        if (nCond !== cond || nl !== l || nr !== r) {
          return arena.addExpression(ExprKind.IfElse, nCond, nl, nr);
        }
        return exprId;
      }
      default:
        return exprId;
    }
  };

  // 6. Rewrite all occurrences of `der(sDep)` and `der(wDep)` across the DAE equation arena
  for (const sDep of eliminatedStates) {
    const finalComb = stateComb.get(sDep);
    if (!finalComb) continue;
    eliminatedDerVars.add(sDep);
    const derExpr1 = buildLinearDerComboExpr(finalComb.coeffs, 1);
    for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
      if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      const nLhs = replaceDerInExpr(lhs, sDep, derExpr1);
      const nRhs = replaceDerInExpr(rhs, sDep, derExpr1);
      if (nLhs !== lhs) arena.setEqLhs(eqIdx, nLhs);
      if (nRhs !== rhs) arena.setEqRhs(eqIdx, nRhs);
    }

    const wDep = derAliasOf.get(sDep);
    if (wDep !== undefined && allDerVars.has(wDep)) {
      eliminatedDerVars.add(wDep);
      const derExpr2 = buildLinearDerComboExpr(finalComb.coeffs, 2);
      for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
        if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
        const lhs = arena.getEqLhs(eqIdx);
        const rhs = arena.getEqRhs(eqIdx);
        const nLhs = replaceDerInExpr(lhs, wDep, derExpr2);
        const nRhs = replaceDerInExpr(rhs, wDep, derExpr2);
        if (nLhs !== lhs) arena.setEqLhs(eqIdx, nLhs);
        if (nRhs !== rhs) arena.setEqRhs(eqIdx, nRhs);
      }
    }
  }
}

/**
 * Transforms bilinear extensive-intensive state product constraints of the form `U = m * u`
 * (where `U` and `m` both appear in `der(...)` and `u` is a continuous intensive property)
 * using the product rule `der(U) = der(m) * u + m * der(u)`. This promotes `u` to the ODE state
 * variable and avoids `0 / 0` division singularities in `u = U / m` when `m -> 0` (e.g. empty tanks).
 */
export function reduceArenaBilinearVolumeStates(
  arena: DAEBuilder,
  parameterVars: Set<number>,
  eliminatedDerVars: Set<number>,
): void {
  const currentDerVars = new Set<number>();
  const scanDer = (exprId: number): void => {
    if (exprId < 0) return;
    const k = arena.getExprKind(exprId);
    if (k === ExprKind.Der) {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(argId));
        if (vIdx >= 0 && !eliminatedDerVars.has(vIdx)) {
          currentDerVars.add(vIdx);
        }
      }
      return;
    }
    if (k === ExprKind.Binary) {
      scanDer(arena.getExprLeft(exprId));
      scanDer(arena.getExprRight(exprId));
    } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
      scanDer(arena.getExprLeft(exprId));
    } else if (k === ExprKind.IfElse) {
      scanDer(arena.getExprData1(exprId));
      scanDer(arena.getExprLeft(exprId));
      scanDer(arena.getExprRight(exprId));
    }
  };

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
    scanDer(arena.getEqLhs(eqIdx));
    scanDer(arena.getEqRhs(eqIdx));
  }
  if (currentDerVars.size < 2) return;

  const replaceDerInExpr = (exprId: number, targetVarIdx: number, replacementExprId: number): number => {
    if (exprId < 0) return exprId;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(argId));
        if (vIdx === targetVarIdx) {
          return replacementExprId;
        }
      }
      return exprId;
    }
    switch (kind) {
      case ExprKind.Binary: {
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
        if (nl !== l || nr !== r) {
          return arena.addBinaryExpr(arena.getExprData1(exprId), nl, nr);
        }
        return exprId;
      }
      case ExprKind.Negate: {
        const l = arena.getExprLeft(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        return nl !== l ? arena.addNegateExpr(nl) : exprId;
      }
      case ExprKind.Unary: {
        const l = arena.getExprLeft(exprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        return nl !== l ? arena.addUnaryExpr(arena.getExprData1(exprId), nl) : exprId;
      }
      case ExprKind.IfElse: {
        const cond = arena.getExprData1(exprId);
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const nCond = replaceDerInExpr(cond, targetVarIdx, replacementExprId);
        const nl = replaceDerInExpr(l, targetVarIdx, replacementExprId);
        const nr = replaceDerInExpr(r, targetVarIdx, replacementExprId);
        if (nCond !== cond || nl !== l || nr !== r) {
          return arena.addExpression(ExprKind.IfElse, nCond, nl, nr);
        }
        return exprId;
      }
      default:
        return exprId;
    }
  };

  const matchProductEq = (sideA: number, sideB: number): { U: number; m: number; u: number } | null => {
    if (arena.getExprKind(sideA) !== ExprKind.Name) return null;
    if (arena.getExprKind(sideB) !== ExprKind.Binary || arena.getExprData1(sideB) !== BinOp.Mul) {
      return null;
    }
    const f1 = arena.getExprLeft(sideB);
    const f2 = arena.getExprRight(sideB);
    if (arena.getExprKind(f1) !== ExprKind.Name || arena.getExprKind(f2) !== ExprKind.Name) {
      return null;
    }
    const U = arena.lookupVariable(arena.getExprData1(sideA));
    const v1 = arena.lookupVariable(arena.getExprData1(f1));
    const v2 = arena.lookupVariable(arena.getExprData1(f2));
    if (U < 0 || v1 < 0 || v2 < 0) return null;
    if (!currentDerVars.has(U) || arena.isVarFixed(U)) return null;
    const v1IsState = currentDerVars.has(v1);
    const v2IsState = currentDerVars.has(v2);
    if (v1IsState === v2IsState) return null;
    const m = v1IsState ? v1 : v2;
    const u = v1IsState ? v2 : v1;
    if (m === U || u === U) return null;
    if (parameterVars.has(u) || arena.isVarFixed(u) || arena.getVarType(u) !== VarType.Real) {
      return null;
    }
    return { U, m, u };
  };

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    if (arena.getEqKind(eqIdx) !== EqKind.Simple) continue;
    if (arena.isEqInitial(eqIdx)) continue;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    const matched = matchProductEq(lhs, rhs) ?? matchProductEq(rhs, lhs);
    if (!matched) continue;
    const { U, m, u } = matched;

    eliminatedDerVars.add(U);
    currentDerVars.delete(U);
    currentDerVars.add(u);

    const mNameExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(m));
    const uNameExpr = arena.addExpression(ExprKind.Name, arena.getVarNameId(u));
    const derMExpr = arena.addDerExpr(mNameExpr);
    const derUExpr = arena.addDerExpr(uNameExpr);
    const term1 = arena.addBinaryExpr(BinOp.Mul, derMExpr, uNameExpr);

    const absM = arena.addCallExpr("abs", [mNameExpr]);
    const epsPos = arena.addRealLiteral(1e-2);
    const epsNeg = arena.addRealLiteral(-1e-2);
    const zeroLit = arena.addRealLiteral(0.0);
    const isSmall = arena.addBinaryExpr(BinOp.Lt, absM, epsPos);
    const isNonNeg = arena.addBinaryExpr(BinOp.Gte, mNameExpr, zeroLit);
    const clampedSign = arena.addExpression(ExprKind.IfElse, isNonNeg, epsPos, epsNeg);
    const mSafe = arena.addExpression(ExprKind.IfElse, isSmall, clampedSign, mNameExpr);

    const term2 = arena.addBinaryExpr(BinOp.Mul, mSafe, derUExpr);
    const prodRuleExpr = arena.addBinaryExpr(BinOp.Add, term1, term2);

    for (let k = 0; k < arena.eqCount; k++) {
      if (arena.getEqKind(k) !== EqKind.Simple) continue;
      const kl = arena.getEqLhs(k);
      const kr = arena.getEqRhs(k);
      const nkl = replaceDerInExpr(kl, U, prodRuleExpr);
      const nkr = replaceDerInExpr(kr, U, prodRuleExpr);
      if (nkl !== kl) arena.setEqLhs(k, nkl);
      if (nkr !== kr) arena.setEqRhs(k, nkr);
    }
  }
}

/**
 * Scans all DAE arena equations for `ExprKind.Der` nodes, registers their inner variables
 * in `stateVars` (excluding derivatives already eliminated by kinematic/affine reduction),
 * and ensures a corresponding `der(x)` variable exists in `derivativeVars`.
 */
export function identifyArenaDerivatives(
  arena: DAEBuilder,
  stateVars: Set<number>,
  derivativeVars: Set<number>,
  parameterVars: Set<number>,
  eliminatedDerVars: Set<number>,
): void {
  const scanExpr = (exprId: number) => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const nameId = arena.getExprData1(argId);
        // O(1): resolve StringId → name → VarIdx via name index
        const name = arena.interner.resolve(nameId);
        if (name) {
          const varIdx = arena.getVarIdxByName(name);
          if (varIdx !== -1) {
            if (eliminatedDerVars.has(varIdx)) return;

            stateVars.add(varIdx);
            parameterVars.delete(varIdx);
            // O(1): look up derivative variable, or create it if it doesn't exist
            const derName = `der(${name})`;
            let derVarIdx = arena.getVarIdxByName(derName);
            if (derVarIdx === -1) {
              const baseVarType = arena.getVarType(varIdx);
              // The derivative variable always has continuous variability and inherits base causality/type.
              derVarIdx = arena.addVariable(
                derName,
                baseVarType,
                Variability.Continuous,
                arena.getVarCausality(varIdx),
                0.0,
              );
            }
            derivativeVars.add(derVarIdx);
            parameterVars.delete(derVarIdx);
          }
        }
      }
      return;
    }
    switch (kind) {
      case ExprKind.Binary:
        scanExpr(arena.getExprLeft(exprId));
        scanExpr(arena.getExprRight(exprId));
        break;
      case ExprKind.Unary:
      case ExprKind.Negate:
        scanExpr(arena.getExprLeft(exprId));
        break;
      case ExprKind.IfElse:
        scanExpr(arena.getExprData1(exprId));
        scanExpr(arena.getExprLeft(exprId));
        scanExpr(arena.getExprRight(exprId));
        break;
      case ExprKind.Call: {
        const argCount = arena.getExprRight(exprId);
        if (argCount > 0) {
          const firstArg = arena.getExprLeft(exprId);
          for (let a = 0; a < argCount; a++) {
            scanExpr(a === 0 ? firstArg : arena.getExprLeft(exprId + a));
          }
        }
        break;
      }
      case ExprKind.Tuple:
      case ExprKind.ArrayCtor: {
        const count = arena.getExprData1(exprId);
        if (count > 0) {
          const firstElem = arena.getExprLeft(exprId);
          for (let e = 0; e < count; e++) {
            scanExpr(e === 0 ? firstElem : arena.getExprLeft(exprId + e));
          }
        }
        break;
      }
    }
  };

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    scanExpr(arena.getEqLhs(eqIdx));
    scanExpr(arena.getEqRhs(eqIdx));
  }
}

/**
 * Pre-resolves mechanical friction/stiction state variables and associated connector
 * flow variables once during prepare(), avoiding inner-loop string parsing and full-arena scans.
 */
export function prepareArenaFrictionMappings(
  arena: DAEBuilder,
  stateVars: Set<number>,
  parameters: Map<string, number>,
): FrictionStateMapping[] {
  const frictionStateMappings: FrictionStateMapping[] = [];
  const stateStringIds = Array.from(stateVars).map((v) => arena.getVarNameId(v));
  const n = stateStringIds.length;

  const frictionSuffixes = [
    ".locked",
    ".startForward",
    ".startBackward",
    ".sa",
    ".f_c",
    ".tau_c",
    ".v_small",
    ".w_small",
    ".mode",
    ".free",
    ".mu_pos",
    ".cgeo",
    ".F_prop",
    ".F_Coulomb",
  ];

  let hasAnyFrictionIndicator = false;
  for (let vIdx = 0; vIdx < arena.varCount; vIdx++) {
    if (arena.isVarRemoved(vIdx)) continue;
    const vName = arena.getVarName(vIdx);
    for (const suf of frictionSuffixes) {
      if (vName.endsWith(suf)) {
        hasAnyFrictionIndicator = true;
        break;
      }
    }
    if (hasAnyFrictionIndicator) break;
  }

  if (!hasAnyFrictionIndicator) return frictionStateMappings;

  for (let i = 0; i < n; i++) {
    const sId = stateStringIds[i] ?? -1;
    if (sId < 0) continue;
    const name = arena.interner.resolve(sId);
    if (!name) continue;
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx < 0) continue;
    const leaf = name.substring(dotIdx + 1);
    if (leaf !== "v" && leaf !== "w" && leaf !== "v_rel" && leaf !== "w_rel") continue;

    const prefix = name.substring(0, dotIdx);
    let hasFrictionIndicator = false;
    for (const suf of frictionSuffixes) {
      if (arena.getVarIdxByName(prefix + suf) >= 0 || parameters.has(prefix + suf)) {
        hasFrictionIndicator = true;
        break;
      }
    }
    if (!hasFrictionIndicator) continue;

    let flowVarNameId = -1;
    for (let vIdx = 0; vIdx < arena.varCount; vIdx++) {
      if (arena.isVarRemoved(vIdx) || !arena.isVarFlow(vIdx)) continue;
      const vName = arena.getVarName(vIdx);
      if (vName.startsWith(prefix + ".")) {
        flowVarNameId = arena.getVarNameId(vIdx);
        break;
      }
    }
    if (flowVarNameId < 0) {
      const faIdx = arena.getVarIdxByName(`${prefix}.flange_a.f`);
      const faPhiIdx = arena.getVarIdxByName(`${prefix}.flange_a.tau`);
      if (faIdx >= 0) flowVarNameId = arena.getVarNameId(faIdx);
      else if (faPhiIdx >= 0) flowVarNameId = arena.getVarNameId(faPhiIdx);
    }
    if (flowVarNameId >= 0) {
      frictionStateMappings.push({
        stateIndex: i,
        stateId: sId,
        flowVarId: flowVarNameId,
      });
    }
  }
  return frictionStateMappings;
}

/**
 * Projects velocity states of components with dry/rolling friction to rest (0)
 * when the velocity crosses zero or is within regularized friction boundary
 * without an active driving force/torque.
 */
export function projectArenaFrictionRestStates(
  frictionStateMappings: FrictionStateMapping[],
  y0: Float64Array | number[],
  vals: Float64Array,
  _stateIds: number[],
): void {
  if (frictionStateMappings.length === 0) return;

  for (const mapping of frictionStateMappings) {
    const v0 = y0[mapping.stateIndex] ?? 0;
    const v1 = vals[mapping.stateId] ?? 0;
    const crossedZero = (v0 > 1e-9 && v1 <= 0) || (v0 < -1e-9 && v1 >= 0);
    const deceleratingIntoStiction =
      Math.abs(v0) > Math.abs(v1) && ((v0 > 0 && v1 <= 0.005) || (v0 < 0 && v1 >= -0.005) || Math.abs(v1) <= 1e-4);
    if (!crossedZero && !deceleratingIntoStiction) continue;

    const flowVal = vals[mapping.flowVarId] ?? 0;
    if (Math.abs(flowVal) < 1e-3) {
      vals[mapping.stateId] = 0;
    }
  }
}

/**
 * Computes the structural upper (`mu`) and lower (`ml`) bandwidths of the ODE state Jacobian
 * by propagating state dependencies through `executionBlocks`.
 */
export function computeArenaStateJacobianBandwidth(
  arena: DAEBuilder,
  executionBlocks: ArenaExecutionBlock[],
  stateStringIds: number[],
  derivStringIds: number[],
): { mu: number; ml: number } {
  const n = stateStringIds.length;
  if (n <= 1) return { mu: 0, ml: 0 };

  const stateDeps = new Map<number, Set<number>>();
  for (let j = 0; j < n; j++) {
    stateDeps.set(stateStringIds[j] as number, new Set([j]));
  }

  const collectExprDeps = (exprId: number, out: Set<number>): void => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const nid = arena.getExprData1(exprId);
      const deps = stateDeps.get(nid);
      if (deps) {
        for (const s of deps) out.add(s);
      }
      return;
    }
    if (kind === ExprKind.Der) {
      const inner = arena.getExprData1(exprId);
      if (arena.getExprKind(inner) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(inner));
        if (innerName) {
          const derId = arena.interner.intern(`der(${innerName})`);
          const deps = stateDeps.get(derId);
          if (deps) {
            for (const s of deps) out.add(s);
          }
        }
      }
      return;
    }
    if (kind === ExprKind.Binary) {
      collectExprDeps(arena.getExprLeft(exprId), out);
      collectExprDeps(arena.getExprRight(exprId), out);
      return;
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      collectExprDeps(arena.getExprLeft(exprId), out);
      return;
    }
    if (kind === ExprKind.IfElse) {
      collectExprDeps(arena.getExprData1(exprId), out);
      collectExprDeps(arena.getExprLeft(exprId), out);
      collectExprDeps(arena.getExprRight(exprId), out);
      return;
    }
    if (kind === ExprKind.Call) {
      const argc = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      for (let a = 0; a < argc; a++) {
        collectExprDeps(a === 0 ? firstArg : arena.getExprLeft(exprId + a), out);
      }
    }
  };

  for (const block of executionBlocks) {
    if (block.type === "single") {
      const deps = new Set<number>();
      collectExprDeps(block.exprId, deps);
      stateDeps.set(arena.getVarNameId(block.varIdx), deps);
    } else if (block.type === "system") {
      const deps = new Set<number>();
      for (const eqIdx of block.eqIdxs) {
        collectExprDeps(arena.getEqLhs(eqIdx), deps);
        collectExprDeps(arena.getEqRhs(eqIdx), deps);
      }
      for (const vIdx of block.vars) {
        stateDeps.set(arena.getVarNameId(vIdx), deps);
      }
    }
  }

  let mu = 0;
  let ml = 0;
  for (let i = 0; i < n; i++) {
    const dDeps = stateDeps.get(derivStringIds[i] as number);
    if (!dDeps) continue;
    for (const j of dDeps) {
      if (j > i && j - i > mu) mu = j - i;
      if (i > j && i - j > ml) ml = i - j;
    }
  }
  return { mu, ml };
}
