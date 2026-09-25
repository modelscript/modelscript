// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Shared Octagon Abstract Domain (Difference Bound Matrix).
 *
 * Encodes constraints of the form ±x_i ± x_j ≤ c in a (2N × 2N) matrix
 * over 32-bit integers. Supports:
 *   - Floyd-Warshall transitive closure for bound propagation
 *   - Variable interval assumptions and queries
 *   - Difference constraint assumptions and queries
 *   - Negative cycle detection for infeasibility
 *
 * Used by:
 *   - Modelica bounds analyzer (array subscript verification)
 *   - SysML2 SMT bridge (requirement consistency)
 *   - SysML2 state machine verifier (guard mutual exclusion)
 */

export const OCTAGON_INF = 0x3fffffff;

/**
 * Difference Bound Matrix (DBM) representing ±x_i ± x_j ≤ c
 * in a (2N × 2N) matrix over 32-bit integers.
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
    const current = this.matrix[i * dim + j]!;
    if (bound < current) {
      this.matrix[i * dim + j] = bound;
    }
  }

  /**
   * Floyd-Warshall transitive closure — propagates all derived bounds.
   */
  close(): void {
    const dim = this.dim;
    for (let k = 0; k < dim; k++) {
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          const ik = this.matrix[i * dim + k]!;
          const kj = this.matrix[k * dim + j]!;
          if (ik !== OCTAGON_INF && kj !== OCTAGON_INF) {
            const newBound = ik + kj;
            if (newBound < this.matrix[i * dim + j]!) {
              this.matrix[i * dim + j] = newBound;
            }
          }
        }
      }
    }
  }

  /**
   * Assumes var1 - var2 ≤ maxDiff.
   */
  assumeDiff(var1: number, var2: number, maxDiff: number): void {
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    this.setBound(p1, p2, maxDiff);
    this.setBound(p2 + 1, p1 + 1, maxDiff);
    this.close();
  }

  /**
   * Checks if var1 - var2 ≤ limit holds in the current DBM.
   */
  checkDiff(var1: number, var2: number, limit: number): boolean {
    const dim = this.dim;
    const p1 = var1 * 2;
    const p2 = var2 * 2;
    if (p1 >= dim || p2 >= dim) return true;
    return this.matrix[p1 * dim + p2]! <= limit;
  }

  /**
   * Assumes lower ≤ var ≤ upper.
   */
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

  setInterval(varIdx: number, lower: number, upper: number): void {
    this.assumeInterval(varIdx, lower, upper);
  }

  setDifference(var1: number, var2: number, maxDiff: number): void {
    this.assumeDiff(var1, var2, maxDiff);
  }

  /**
   * Checks if the variable's current bounds are within [lower, upper].
   */
  checkInterval(varIdx: number, lower: number, upper: number): boolean {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return true;
    if (upper < OCTAGON_INF / 2) {
      const uBound = this.matrix[p * dim + (p + 1)]!;
      if (uBound > upper * 2) return false;
    }
    if (lower > -OCTAGON_INF / 2) {
      const lBound = this.matrix[(p + 1) * dim + p]!;
      if (lBound > -lower * 2) return false;
    }
    return true;
  }

  getUpperBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return OCTAGON_INF;
    const raw = this.matrix[p * dim + (p + 1)]!;
    return raw >= OCTAGON_INF ? OCTAGON_INF : Math.floor(raw / 2);
  }

  getLowerBound(varIdx: number): number {
    const p = varIdx * 2;
    const dim = this.dim;
    if (p + 1 >= dim) return -OCTAGON_INF;
    const raw = this.matrix[(p + 1) * dim + p]!;
    return raw >= OCTAGON_INF ? -OCTAGON_INF : Math.ceil(-raw / 2);
  }

  /**
   * Returns true if the DBM contains a negative self-loop (infeasibility).
   */
  hasNegativeCycle(): boolean {
    const dim = this.dim;
    for (let i = 0; i < dim; i++) {
      if (this.matrix[i * dim + i]! < 0) return true;
    }
    return false;
  }

  clone(): OctagonDBM {
    const copy = new OctagonDBM(this.numVars);
    copy.matrix.set(this.matrix);
    return copy;
  }

  isLeq(other: OctagonDBM): boolean {
    if (this.hasNegativeCycle()) return true;
    if (other.hasNegativeCycle()) return false;
    const dim = Math.min(this.dim, other.dim);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        if (this.matrix[i * this.dim + j]! > other.matrix[i * other.dim + j]!) {
          return false;
        }
      }
    }
    return true;
  }

  join(other: OctagonDBM): OctagonDBM {
    if (this.hasNegativeCycle()) return other.clone();
    if (other.hasNegativeCycle()) return this.clone();

    const n = Math.max(this.numVars, other.numVars);
    const res = new OctagonDBM(n);
    const dim = res.dim;

    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const valA = i < this.dim && j < this.dim ? this.matrix[i * this.dim + j]! : OCTAGON_INF;
        const valB = i < other.dim && j < other.dim ? other.matrix[i * other.dim + j]! : OCTAGON_INF;
        res.matrix[i * dim + j] = Math.max(valA, valB);
      }
    }
    return res;
  }

  meet(other: OctagonDBM): OctagonDBM {
    if (this.hasNegativeCycle()) return this.clone();
    if (other.hasNegativeCycle()) return other.clone();

    const n = Math.max(this.numVars, other.numVars);
    const res = new OctagonDBM(n);
    const dim = res.dim;

    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const valA = i < this.dim && j < this.dim ? this.matrix[i * this.dim + j]! : OCTAGON_INF;
        const valB = i < other.dim && j < other.dim ? other.matrix[i * other.dim + j]! : OCTAGON_INF;
        res.matrix[i * dim + j] = Math.min(valA, valB);
      }
    }
    res.close();
    return res;
  }

  widenWithThresholds(other: OctagonDBM, thresholds?: number[]): OctagonDBM {
    if (this.hasNegativeCycle()) return other.clone();
    if (other.hasNegativeCycle()) return this.clone();

    const n = Math.max(this.numVars, other.numVars);
    const res = new OctagonDBM(n);
    const dim = res.dim;

    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const aVal = i < this.dim && j < this.dim ? this.matrix[i * this.dim + j]! : OCTAGON_INF;
        const bVal = i < other.dim && j < other.dim ? other.matrix[i * other.dim + j]! : OCTAGON_INF;

        if (bVal <= aVal) {
          res.matrix[i * dim + j] = aVal;
        } else {
          if (thresholds && thresholds.length > 0) {
            let nextT = OCTAGON_INF;
            for (let t = 0; t < thresholds.length; t++) {
              const th2 = thresholds[t]! * 2;
              if (th2 >= bVal) {
                nextT = th2;
                break;
              }
            }
            res.matrix[i * dim + j] = nextT;
          } else {
            res.matrix[i * dim + j] = OCTAGON_INF;
          }
        }
      }
    }
    return res;
  }

  narrow(other: OctagonDBM): OctagonDBM {
    if (this.hasNegativeCycle() || other.hasNegativeCycle()) return this.clone();
    const n = Math.max(this.numVars, other.numVars);
    const res = new OctagonDBM(n);
    const dim = res.dim;

    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        const aVal = i < this.dim && j < this.dim ? this.matrix[i * this.dim + j]! : OCTAGON_INF;
        const bVal = i < other.dim && j < other.dim ? other.matrix[i * other.dim + j]! : OCTAGON_INF;
        res.matrix[i * dim + j] = aVal === OCTAGON_INF ? bVal : aVal;
      }
    }
    res.close();
    return res;
  }
}
