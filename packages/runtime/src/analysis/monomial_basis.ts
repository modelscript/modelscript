// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Graded-Lexicographical Monomial Basis for Multivariate Taylor Models.
 *
 * Provides dense integer-indexed graded-lexicographical (grlex) monomial indexing,
 * precomputed multiplication tables, variable restriction maps, and time integration maps.
 *
 * For n variables and max order k, monomials are ordered:
 * 1. By total degree |alpha| ascending (graded).
 * 2. For identical total degrees, lexicographically by exponent vector (x_0 > x_1 > ... > x_{n-1}).
 *
 * Invariants:
 * - Index 0 is always the constant term: x^0 = 1.
 * - Indices 1 .. n are always the linear coordinate terms: x_0, x_1, ..., x_{n-1}.
 */

export class MonomialBasis {
  private static readonly cache = new Map<string, MonomialBasis>();

  /** Total number of monomials in this basis: binom(numVars + maxOrder, maxOrder). */
  public readonly totalMonomials: number;

  /** Exponent vectors for each monomial index: exponents[i] has length numVars. */
  public readonly exponents: number[][];

  /** Total degree of each monomial index: degrees[i] = sum(exponents[i]). */
  public readonly degrees: Int32Array;

  /** Precomputed string key for each monomial index: serializedKeys[i] = "e0,e1,...". */
  public readonly serializedKeys: string[];

  /** Fast string key -> index lookup. */
  public readonly keyToIndex: Map<string, number>;

  /**
   * Precomputed multiplication table for dense bases (totalMonomials <= 1024).
   * mulTable[i * totalMonomials + j] gives the index k of alpha_i + alpha_j if
   * degree <= maxOrder, or -1 if the product exceeds maxOrder.
   * Null for large/sparse bases.
   */
  public readonly mulTable: Int32Array | null;

  /**
   * Variable restriction maps: for each variable v,
   * restrictTarget[v][i] gives the index of alpha_i with alpha_i[v] set to 0.
   * restrictDegree[v][i] gives alpha_i[v].
   */
  public readonly restrictTarget: Int32Array[];
  public readonly restrictDegree: Uint8Array[];

  /**
   * Variable integration maps: for each variable v,
   * integrateTarget[v][i] gives the index of alpha_i with alpha_i[v] incremented by 1
   * (or -1 if degree exceeds maxOrder).
   * integrateDivisor[v][i] gives alpha_i[v] + 1.
   */
  public readonly integrateTarget: Int32Array[];
  public readonly integrateDivisor: Float64Array[];

  private constructor(
    public readonly numVars: number,
    public readonly maxOrder: number,
  ) {
    // 1. Generate monomials in graded-lexicographical order
    const list: number[][] = [];
    for (let deg = 0; deg <= maxOrder; deg++) {
      MonomialBasis.generateDegree(numVars, deg, 0, new Array(numVars).fill(0), list);
    }
    this.exponents = list;
    this.totalMonomials = list.length;

    // 2. Precompute degrees, keys, and index map
    this.degrees = new Int32Array(this.totalMonomials);
    this.serializedKeys = new Array(this.totalMonomials);
    this.keyToIndex = new Map<string, number>();

    for (let i = 0; i < this.totalMonomials; i++) {
      const exps = list[i]!;
      let deg = 0;
      for (let v = 0; v < numVars; v++) deg += exps[v]!;
      this.degrees[i] = deg;
      const key = exps.join(",");
      this.serializedKeys[i] = key;
      this.keyToIndex.set(key, i);
    }

    // 3. Precompute multiplication table if totalMonomials <= 1024
    if (this.totalMonomials <= 1024) {
      const M = this.totalMonomials;
      const table = new Int32Array(M * M);
      for (let i = 0; i < M; i++) {
        const expsI = list[i]!;
        const degI = this.degrees[i]!;
        const rowOffset = i * M;
        for (let j = 0; j < M; j++) {
          const degJ = this.degrees[j]!;
          if (degI + degJ > maxOrder) {
            table[rowOffset + j] = -1;
          } else {
            const expsJ = list[j]!;
            const sumExps = new Array(numVars);
            for (let v = 0; v < numVars; v++) sumExps[v] = expsI[v]! + expsJ[v]!;
            const key = sumExps.join(",");
            table[rowOffset + j] = this.keyToIndex.get(key) ?? -1;
          }
        }
      }
      this.mulTable = table;
    } else {
      this.mulTable = null;
    }

    // 4. Precompute restriction maps for each variable
    this.restrictTarget = new Array(numVars);
    this.restrictDegree = new Array(numVars);
    for (let v = 0; v < numVars; v++) {
      const targets = new Int32Array(this.totalMonomials);
      const degrees = new Uint8Array(this.totalMonomials);
      for (let i = 0; i < this.totalMonomials; i++) {
        const exps = list[i]!;
        const e = exps[v]!;
        degrees[i] = e;
        if (e === 0) {
          targets[i] = i;
        } else {
          const reduced = [...exps];
          reduced[v] = 0;
          targets[i] = this.keyToIndex.get(reduced.join(",")) ?? 0;
        }
      }
      this.restrictTarget[v] = targets;
      this.restrictDegree[v] = degrees;
    }

    // 5. Precompute integration maps for each variable
    this.integrateTarget = new Array(numVars);
    this.integrateDivisor = new Array(numVars);
    for (let v = 0; v < numVars; v++) {
      const targets = new Int32Array(this.totalMonomials);
      const divisors = new Float64Array(this.totalMonomials);
      for (let i = 0; i < this.totalMonomials; i++) {
        const exps = list[i]!;
        const e = exps[v]!;
        divisors[i] = e + 1;
        if (this.degrees[i]! + 1 > maxOrder) {
          targets[i] = -1;
        } else {
          const inc = [...exps];
          inc[v] = e + 1;
          targets[i] = this.keyToIndex.get(inc.join(",")) ?? -1;
        }
      }
      this.integrateTarget[v] = targets;
      this.integrateDivisor[v] = divisors;
    }
  }

  /**
   * Retrieves or constructs a cached MonomialBasis for the specified (numVars, maxOrder).
   */
  public static get(numVars: number, maxOrder: number): MonomialBasis {
    const key = `${numVars}_${maxOrder}`;
    let basis = MonomialBasis.cache.get(key);
    if (!basis) {
      basis = new MonomialBasis(numVars, maxOrder);
      MonomialBasis.cache.set(key, basis);
    }
    return basis;
  }

  /**
   * Looks up the integer index for an exponent vector.
   * Returns -1 if the exponents exceed maxOrder or are not in the basis.
   */
  public indexOf(exponents: number[]): number {
    let deg = 0;
    for (let i = 0; i < exponents.length; i++) deg += exponents[i]!;
    if (deg > this.maxOrder) return -1;
    const key = exponents.join(",");
    return this.keyToIndex.get(key) ?? -1;
  }

  /**
   * Returns the linear coordinate variable index: 1 + varIndex.
   */
  public variableIndex(varIndex: number): number {
    return 1 + varIndex;
  }

  private static generateDegree(
    numVars: number,
    remainingDeg: number,
    varIdx: number,
    current: number[],
    out: number[][],
  ): void {
    if (numVars === 0) {
      out.push([]);
      return;
    }
    if (varIdx === numVars - 1) {
      current[varIdx] = remainingDeg;
      out.push([...current]);
      return;
    }
    for (let d = remainingDeg; d >= 0; d--) {
      current[varIdx] = d;
      MonomialBasis.generateDegree(numVars, remainingDeg - d, varIdx + 1, current, out);
    }
  }
}
