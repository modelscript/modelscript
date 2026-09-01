// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DaeBuilder } from "@modelscript/language";
import type { DAEBuilder } from "@modelscript/language/compiler";
import { EqKind, ExprKind } from "@modelscript/language/compiler";

interface DAEAdapter {
  addEquation(kind: number, lhs: number, rhs: number, flags?: number): number;
  setEqCondition?(eqIdx: number, conditionExprId: number, isTrueBranch: boolean): void;
  addExpression(kind: number, data1: number, left?: number, right?: number): number;
}

/**
 * Modelica Equation Flattener & SSA Algorithm Lowering Engine.
 * Handles simple scalar equations, array loop unrolling, conditional if/when equations,
 * array equation scalarization, and lowers sequential algorithm blocks into SSA algebraic DAE equations.
 */
export class ModelicaEquationFlattener {
  dae: DAEBuilder | DaeBuilder | DAEAdapter;
  equationCount: number;

  constructor(dae?: DAEBuilder | DaeBuilder | DAEAdapter) {
    if (dae) {
      this.dae = dae;
      this.equationCount = 0;
    } else {
      this.dae = null as unknown as DAEAdapter;
      this.equationCount = 0;
    }
  }

  init(dae: DAEBuilder | DaeBuilder | DAEAdapter): void {
    this.dae = dae;
    this.equationCount = 0;
  }

  /**
   * Adds an algebraic equation lhs = rhs into the DAE system.
   */
  addEquation(lhsExprId: number, rhsExprId: number, flags = 0, kind = EqKind.Simple): number {
    const adapter = this.dae as DAEAdapter;
    const eqIdx = adapter.addEquation(kind, lhsExprId, rhsExprId, flags);
    this.equationCount++;
    return eqIdx;
  }

  /**
   * Unrolls a for-equation over integer range [start, stop].
   */
  unrollForEquation(
    rangeStart: number,
    rangeStop: number,
    generator: (index: number) => { lhs: number; rhs: number } | null,
  ): number {
    let count = 0;
    for (let i = rangeStart; i <= rangeStop; i++) {
      const pair = generator(i);
      if (pair) {
        this.addEquation(pair.lhs, pair.rhs);
        count++;
      }
    }
    return count;
  }

  /**
   * Scalarizes vector/matrix equations into element-wise scalar equations.
   */
  scalarizeArrayEquation(lhsExprIds: number[], rhsExprIds: number[]): number {
    const n = Math.min(lhsExprIds.length, rhsExprIds.length);
    for (let i = 0; i < n; i++) {
      const lhs = lhsExprIds[i];
      const rhs = rhsExprIds[i];
      if (lhs !== undefined && rhs !== undefined) {
        this.addEquation(lhs, rhs);
      }
    }
    return n;
  }

  /**
   * Adds an if-equation or guarded conditional equation.
   */
  addIfEquation(conditionExprId: number, trueEqIdxs: number[], falseEqIdxs?: number[]): void {
    const adapter = this.dae as DAEAdapter;
    // Registers equations under condition guard
    for (const eqIdx of trueEqIdxs) {
      adapter.setEqCondition?.(eqIdx, conditionExprId, true);
    }
    if (falseEqIdxs) {
      for (const eqIdx of falseEqIdxs) {
        adapter.setEqCondition?.(eqIdx, conditionExprId, false);
      }
    }
  }

  /**
   * Translates sequential statements from an algorithm block into SSA algebraic DAE equations.
   * e.g. `x := x + 1; y := x * 2;` -> `x_1 = x_0 + 1; y = x_1 * 2;`
   */
  lowerAlgorithmToSSA(
    statements: { varName: string; exprId: number; isState?: boolean }[],
    createTempVar: (baseName: string, version: number) => number,
  ): number {
    const adapter = this.dae as DAEAdapter;
    const versionMap = new Map<string, number>();
    let emittedEqs = 0;

    for (const stmt of statements) {
      const currentVer = versionMap.get(stmt.varName) ?? 0;
      const nextVer = currentVer + 1;
      versionMap.set(stmt.varName, nextVer);

      const targetVarId = createTempVar(stmt.varName, nextVer);
      const lhsExpr = adapter.addExpression(ExprKind.Name, targetVarId);
      this.addEquation(lhsExpr, stmt.exprId);
      emittedEqs++;
    }

    return emittedEqs;
  }
}
