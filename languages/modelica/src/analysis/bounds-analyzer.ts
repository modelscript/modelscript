// SPDX-License-Identifier: AGPL-3.0-or-later

export const OCTAGON_INF = 0x3fffffff;

/**
 * Difference Bound Matrix (DBM) representing +/- x_i +/- x_j <= c
 * in an (2N x 2N) matrix over 32-bit integers.
 */
export class OctagonDBM {
  private dim: number;
  private matrix: Int32Array;

  constructor(public readonly numVars: number) {
    this.dim = numVars * 2;
    this.matrix = new Int32Array(this.dim * this.dim);
    this.reset();
  }

  reset(): void {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        this.matrix[i * dim + j] = i === j ? 0 : OCTAGON_INF;
      }
    }
  }

  setBound(i: number, j: number, bound: number): void {
    const dim = this.dim;
    if (i >= dim || j >= dim) return;
    const current = this.matrix[i * dim + j];
    if (bound < current) {
      this.matrix[i * dim + j] = bound;
    }
  }

  close(): void {
    const dim = this.dim;
    for (let k = 0; k < dim; k++) {
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          const ik = this.matrix[i * dim + k];
          const kj = this.matrix[k * dim + j];
          if (ik !== OCTAGON_INF && kj !== OCTAGON_INF) {
            const newBound = ik + kj;
            if (newBound < this.matrix[i * dim + j]) {
              this.matrix[i * dim + j] = newBound;
            }
          }
        }
      }
    }
  }

  assumeDiff(var1: number, var2: number, maxDiff: number): void {
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    this.setBound(p1, p2, maxDiff);
    this.setBound(p2 + 1, p1 + 1, maxDiff);
    this.close();
  }

  checkDiff(var1: number, var2: number, limit: number): boolean {
    const dim = this.dim;
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    if (p1 >= dim || p2 >= dim) return true;
    return this.matrix[p1 * dim + p2] <= limit;
  }

  assumeInterval(varIdx: number, lower: number, upper: number): void {
    const p = varIdx * 2;
    if (upper < OCTAGON_INF / 2) {
      this.setBound(p, p + 1, upper * 2);
    }
    if (lower > -OCTAGON_INF / 2) {
      this.setBound(p + 1, p, -lower * 2);
    }
    this.close();
  }

  checkInterval(varIdx: number, lower: number, upper: number): boolean {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return true;
    if (upper < OCTAGON_INF / 2) {
      const uBound = this.matrix[p * dim + (p + 1)];
      if (uBound > upper * 2) return false;
    }
    if (lower > -OCTAGON_INF / 2) {
      const lBound = this.matrix[(p + 1) * dim + p];
      if (lBound > -lower * 2) return false;
    }
    return true;
  }

  getUpperBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return OCTAGON_INF;
    const raw = this.matrix[p * dim + (p + 1)];
    return raw >= OCTAGON_INF ? OCTAGON_INF : Math.floor(raw / 2);
  }

  getLowerBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return -OCTAGON_INF;
    const raw = this.matrix[(p + 1) * dim + p];
    return raw >= OCTAGON_INF ? -OCTAGON_INF : Math.ceil(-raw / 2);
  }

  hasNegativeCycle(): boolean {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      if (this.matrix[i * dim + i] < 0) return true;
    }
    return false;
  }
}

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
