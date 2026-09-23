// SPDX-License-Identifier: AGPL-3.0-or-later

export { OCTAGON_INF, OctagonDBM } from "@modelscript/runtime";
import { OCTAGON_INF, OctagonDBM } from "@modelscript/runtime";

export interface SubscriptViolation {
  arrayName: string;
  subscriptText: string;
  dimensionIndex: number;
  dimensionSize: number;
  subscriptValue?: number;
}

/**
 * Modelica static bounds analyzer using the Octagon DBM domain.
 */
export class ModelicaBoundsAnalyzer {
  private varMap = new Map<string, number>();
  private nextVarId = 0;
  private dbm: OctagonDBM;

  constructor(maxVars = 64) {
    this.dbm = new OctagonDBM(maxVars);
  }

  getOrCreateVar(name: string): number {
    let id = this.varMap.get(name);
    if (id === undefined) {
      id = this.nextVarId++;
      this.varMap.set(name, id);
    }
    return id;
  }

  setParamInterval(name: string, lower: number, upper: number): void {
    const v = this.getOrCreateVar(name);
    this.dbm.assumeInterval(v, lower, upper);
  }

  setLoopRange(loopVar: string, lower: number, upper: number): void {
    const v = this.getOrCreateVar(loopVar);
    this.dbm.assumeInterval(v, lower, upper);
  }

  checkArraySubscript(
    arrayName: string,
    dimIndex: number,
    dimSize: number,
    subscriptExpr: number | { baseVar: string; offset: number },
  ): SubscriptViolation | null {
    if (typeof subscriptExpr === "number") {
      // Modelica 1-indexed: 1 <= subscript <= dimSize
      if (subscriptExpr < 1 || subscriptExpr > dimSize) {
        return {
          arrayName,
          subscriptText: String(subscriptExpr),
          dimensionIndex: dimIndex,
          dimensionSize: dimSize,
          subscriptValue: subscriptExpr,
        };
      }
      return null;
    }

    const { baseVar, offset } = subscriptExpr;
    const v = this.varMap.get(baseVar);
    if (v === undefined) return null;

    // Check lower bound: baseVar + offset >= 1
    const lower = this.dbm.getLowerBound(v);
    if (lower !== -OCTAGON_INF && lower + offset < 1) {
      return {
        arrayName,
        subscriptText: `${baseVar}${offset >= 0 ? ` + ${offset}` : ` - ${Math.abs(offset)}`}`,
        dimensionIndex: dimIndex,
        dimensionSize: dimSize,
      };
    }

    // Check upper bound: baseVar + offset <= dimSize
    const upper = this.dbm.getUpperBound(v);
    if (upper !== OCTAGON_INF && upper + offset > dimSize) {
      return {
        arrayName,
        subscriptText: `${baseVar}${offset >= 0 ? ` + ${offset}` : ` - ${Math.abs(offset)}`}`,
        dimensionIndex: dimIndex,
        dimensionSize: dimSize,
      };
    }

    return null;
  }

  hasContradiction(): boolean {
    return this.dbm.hasNegativeCycle();
  }
}
