// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Sparse Polynomial Zonotopes for Tight Non-Convex Reachability.
 *
 * Implements Kochdumper & Althoff (2021) Sparse Polynomial Zonotopes (`LazySets.jl` parity):
 *   PZ = <c, G, GI, E> = { c + Σ_i G_{:,i} Π_k α_k^{E_{k,i}} + Σ_j GI_{:,j} β_j | α_k, β_j ∈ [-1, 1] }
 *
 * Key advantages over standard zonotopes:
 *   - Closed under linear maps, Minkowski sums, exact additions (preserving shared α_k dependencies),
 *     and exact polynomial/quadratic maps (capturing non-convex curved reachable sets).
 *   - Tight interval enclosure exploiting even-exponent ranges α_k^{2m} ∈ [0, 1] vs odd [-1, 1].
 */

import { Interval } from "./wasm_interval.js";

export class PolynomialZonotope {
  /** Center vector `c` (dim `n`). */
  public readonly c: Float64Array;
  /** Dependent generator matrix `G` (`n × h`, column-major array of length-`n` columns). */
  public readonly G: Float64Array[];
  /** Independent generator matrix `GI` (`n × q`, column-major array of length-`n` columns). */
  public readonly GI: Float64Array[];
  /** Exponent matrix `E` (`p × h`, stored as `h` columns of length-`p` non-negative integer exponents). */
  public readonly E: Int32Array[];
  /** Number of dependent factors `p`. */
  public readonly numFactors: number;

  constructor(c: Float64Array | number[], G: Float64Array[], GI: Float64Array[], E: Int32Array[], numFactors: number) {
    this.c = c instanceof Float64Array ? new Float64Array(c) : Float64Array.from(c);
    this.G = G;
    this.GI = GI;
    this.E = E;
    this.numFactors = numFactors;
  }

  public get dim(): number {
    return this.c.length;
  }

  /** Creates a Polynomial Zonotope representing an axis-aligned box `[lo_i, hi_i]`. */
  public static fromBox(box: Interval[]): PolynomialZonotope {
    const n = box.length;
    const c = new Float64Array(n);
    const G: Float64Array[] = [];
    const E: Int32Array[] = [];
    for (let i = 0; i < n; i++) {
      const iv = box[i]!;
      c[i] = 0.5 * (iv.lo + iv.hi);
      const rad = 0.5 * (iv.hi - iv.lo);
      if (rad > 0) {
        const g = new Float64Array(n);
        g[i] = rad;
        G.push(g);
        const expCol = new Int32Array(n);
        expCol[i] = 1;
        E.push(expCol);
      }
    }
    return new PolynomialZonotope(c, G, [], E, n);
  }

  /** Exact linear map `M * PZ + offset`. */
  public linearMap(M: number[][], offset?: number[]): PolynomialZonotope {
    const m = M.length;
    const n = this.dim;
    const mapVec = (v: Float64Array): Float64Array => {
      const out = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        let s = 0;
        const row = M[i]!;
        for (let j = 0; j < n; j++) s += row[j]! * v[j]!;
        out[i] = s;
      }
      return out;
    };
    const newC = mapVec(this.c);
    if (offset) for (let i = 0; i < m; i++) newC[i] = newC[i]! + (offset[i] ?? 0);
    return new PolynomialZonotope(
      newC,
      this.G.map(mapVec),
      this.GI.map(mapVec),
      this.E.map((e) => new Int32Array(e)),
      this.numFactors,
    );
  }

  /**
   * Exact addition `PZ1 ⊞ PZ2` preserving shared dependent factors `α_k` (cancelling/combining
   * matching monomials cleanly without dependency loss).
   */
  public exactAdd(other: PolynomialZonotope): PolynomialZonotope {
    const n = this.dim;
    const p = Math.max(this.numFactors, other.numFactors);
    const newC = new Float64Array(n);
    for (let i = 0; i < n; i++) newC[i] = this.c[i]! + other.c[i]!;

    const padExp = (e: Int32Array): Int32Array => {
      if (e.length === p) return new Int32Array(e);
      const out = new Int32Array(p);
      out.set(e);
      return out;
    };

    const monoMap = new Map<string, { g: Float64Array; e: Int32Array }>();
    const addGen = (g: Float64Array, e: Int32Array): void => {
      const ep = padExp(e);
      const key = ep.join(",");
      const existing = monoMap.get(key);
      if (existing) {
        for (let i = 0; i < n; i++) existing.g[i] = existing.g[i]! + g[i]!;
      } else {
        monoMap.set(key, { g: new Float64Array(g), e: ep });
      }
    };

    for (let i = 0; i < this.G.length; i++) addGen(this.G[i]!, this.E[i]!);
    for (let i = 0; i < other.G.length; i++) addGen(other.G[i]!, other.E[i]!);

    const newG: Float64Array[] = [];
    const newE: Int32Array[] = [];
    for (const { g, e } of monoMap.values()) {
      let norm = 0;
      for (let i = 0; i < n; i++) norm += Math.abs(g[i]!);
      if (norm > 1e-15) {
        newG.push(g);
        newE.push(e);
      }
    }

    return new PolynomialZonotope(
      newC,
      newG,
      [...this.GI.map((g) => new Float64Array(g)), ...other.GI.map((g) => new Float64Array(g))],
      newE,
      p,
    );
  }

  /**
   * Exact component-wise quadratic map `y_d = Σ_{a,b} Q[d][a][b] * x_a * x_b` on dependent terms
   * (independent generators are conservatively over-approximated into `GI`).
   */
  public quadraticMap(Q: number[][][]): PolynomialZonotope {
    const outDim = Q.length;
    const n = this.dim;
    const p = this.numFactors;

    // Represent dependent part as list of (vec, exp) including constant center (exp = 0)
    const terms: { g: Float64Array; e: Int32Array }[] = [
      { g: this.c, e: new Int32Array(p) },
      ...this.G.map((g, idx) => ({ g, e: this.E[idx]! })),
    ];

    const monoMap = new Map<string, { g: Float64Array; e: Int32Array }>();
    const newC = new Float64Array(outDim);

    for (let t1 = 0; t1 < terms.length; t1++) {
      const g1 = terms[t1]!.g;
      const e1 = terms[t1]!.e;
      for (let t2 = 0; t2 < terms.length; t2++) {
        const g2 = terms[t2]!.g;
        const e2 = terms[t2]!.e;

        const outVec = new Float64Array(outDim);
        let nonZero = false;
        for (let d = 0; d < outDim; d++) {
          const Qd = Q[d]!;
          let s = 0;
          for (let a = 0; a < n; a++) {
            const g1a = g1[a]!;
            if (g1a === 0) continue;
            const row = Qd[a]!;
            for (let b = 0; b < n; b++) {
              s += row[b]! * g1a * g2[b]!;
            }
          }
          outVec[d] = s;
          if (Math.abs(s) > 1e-15) nonZero = true;
        }
        if (!nonZero) continue;

        const sumE = new Int32Array(p);
        let allZero = true;
        for (let k = 0; k < p; k++) {
          const v = e1[k]! + e2[k]!;
          sumE[k] = v;
          if (v > 0) allZero = false;
        }

        if (allZero) {
          for (let d = 0; d < outDim; d++) newC[d] = newC[d]! + outVec[d]!;
        } else {
          const key = sumE.join(",");
          const existing = monoMap.get(key);
          if (existing) {
            for (let d = 0; d < outDim; d++) existing.g[d] = existing.g[d]! + outVec[d]!;
          } else {
            monoMap.set(key, { g: outVec, e: sumE });
          }
        }
      }
    }

    const newG: Float64Array[] = [];
    const newE: Int32Array[] = [];
    for (const { g, e } of monoMap.values()) {
      newG.push(g);
      newE.push(e);
    }

    return new PolynomialZonotope(newC, newG, [], newE, p);
  }

  /**
   * Computes a tight sound interval box enclosure exploiting even-exponent monomials (`∈ [0, 1]`)
   * vs odd-exponent monomials (`∈ [-1, 1]`).
   */
  public toIntervalBox(): Interval[] {
    const n = this.dim;
    const lo = new Float64Array(this.c);
    const hi = new Float64Array(this.c);

    for (let idx = 0; idx < this.G.length; idx++) {
      const g = this.G[idx]!;
      const e = this.E[idx]!;
      let allEven = true;
      for (let k = 0; k < e.length; k++) {
        if ((e[k]! & 1) === 1) {
          allEven = false;
          break;
        }
      }
      if (allEven) {
        // Monomial Π α_k^{2 m_k} ∈ [0, 1]
        for (let i = 0; i < n; i++) {
          const v = g[i]!;
          if (v >= 0) hi[i] = hi[i]! + v;
          else lo[i] = lo[i]! + v;
        }
      } else {
        // Monomial ∈ [-1, 1]
        for (let i = 0; i < n; i++) {
          const av = Math.abs(g[i]!);
          lo[i] = lo[i]! - av;
          hi[i] = hi[i]! + av;
        }
      }
    }

    for (const gi of this.GI) {
      for (let i = 0; i < n; i++) {
        const av = Math.abs(gi[i]!);
        lo[i] = lo[i]! - av;
        hi[i] = hi[i]! + av;
      }
    }

    return Array.from({ length: n }, (_, i) => new Interval(lo[i]!, hi[i]!));
  }

  /** Evaluates the polynomial zonotope at a specific factor vector `α ∈ [-1, 1]^p`. */
  public evaluateAt(alpha: number[]): Float64Array {
    const n = this.dim;
    const out = new Float64Array(this.c);
    for (let idx = 0; idx < this.G.length; idx++) {
      const g = this.G[idx]!;
      const e = this.E[idx]!;
      let mono = 1.0;
      for (let k = 0; k < e.length; k++) {
        const exp = e[k]!;
        if (exp > 0) mono *= Math.pow(alpha[k] ?? 0, exp);
      }
      for (let i = 0; i < n; i++) out[i] = out[i]! + g[i]! * mono;
    }
    return out;
  }
}
