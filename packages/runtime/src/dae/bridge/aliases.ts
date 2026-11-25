// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Union-find alias elimination pass over DAE arena equations and expressions.
 */

import type { WasmDaeEquations } from "./equations.js";
import { type ArenaStateMachine, EqKind, ExprKind, VarAttrKind, Variability } from "./types.js";

/**
 * Performs union-find alias elimination across trivial equality and connection equations
 * (`x = y`) in `dae`, propagating `start` and `fixed` attributes to the canonical representative
 * variable and rewriting `ExprKind.Name` references in-place.
 *
 * @param dae - Target `WasmDaeEquations` (`DAEBuilder`) arena.
 */
export function eliminateArenaAliases(dae: WasmDaeEquations): void {
  // Use TypeScript implementation to properly eliminate Simple flow aliases
  const aliasMap = new Map<number, number>();

  function find(id: number): number {
    let curr = id;
    while (aliasMap.has(curr)) {
      curr = aliasMap.get(curr)!;
    }
    let p = id;
    while (p !== curr && aliasMap.has(p)) {
      const next = aliasMap.get(p)!;
      aliasMap.set(p, curr);
      p = next;
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

  const scoreCache = new Map<number, number>();
  function getVarScore(nameId: number): number {
    const cached = scoreCache.get(nameId);
    if (cached !== undefined) return cached;

    const vIdx = dae.lookupVariable(nameId);
    const name = dae.interner.resolve(nameId) || "";
    let score = 0;
    if (vIdx >= 0) {
      const vari = dae.getVarVariability(vIdx);
      if (vari === Variability.Constant) score += 2000;
      else if (vari === Variability.Parameter) score += 1000;
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
    scoreCache.set(nameId, score);
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
        if (kind === EqKind.Connect && ((vIdx1 >= 0 && dae.isVarFlow(vIdx1)) || (vIdx2 >= 0 && dae.isVarFlow(vIdx2)))) {
          continue;
        }
        if (vIdx1 < 0 && vIdx2 < 0) {
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

    const vElimVar = dae.getVarVariability(vElim);
    const vRootVar = dae.getVarVariability(vRoot);

    if (dae.isVarFixed(vElim) && !dae.isVarFixed(vRoot)) {
      if (vElimVar === vRootVar) {
        dae.setVarFixed(vRoot, true);
        const fixedAttr = dae.getVarAttrExprId(vElim, "fixed");
        if (fixedAttr !== undefined) {
          dae.setVarAttrExpr(vRoot, VarAttrKind.Fixed, fixedAttr);
        }
      }
    }

    const elimExpr = dae.getVarExpression(vElim);
    const rootExpr = dae.getVarExpression(vRoot);
    if ((rootExpr === undefined || rootExpr < 0) && elimExpr !== undefined && elimExpr >= 0) {
      dae.setVarExpression(vRoot, elimExpr);
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

  // Clear self-referential binding expressions (x = x) introduced by alias substitution
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const exprId = dae.getVarExpression(i);
    if (exprId !== undefined && exprId >= 0 && dae.getExprKind(exprId) === ExprKind.Name) {
      if (dae.getExprData1(exprId) === dae.getVarNameId(i)) {
        dae.removeVarAttr(i, "binding");
      }
    }
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
