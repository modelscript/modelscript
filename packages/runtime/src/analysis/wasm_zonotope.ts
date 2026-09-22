// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — High-Performance Zonotope Reachability Arithmetic.
 *
 * Implements convex sets as Zonotopes:
 *   Z = <c, G> = { c + \sum_{j=0}^{p-1} \xi_j g_j | \xi_j \in [-1, 1] }
 *
 * Key operations:
 *   - Linear maps A*Z in O(n^2 p) with zero wrapping effect
 *   - Exact Minkowski addition Z1 \oplus Z2
 *   - Giroux order reduction to limit generator count p <= maxOrder * n
 *   - Exact Interval Hull calculation
 *   - Support function evaluation and half-space guard crossing detection
 *   - Convex set enclosure and branching splits
 */

import { Interval } from "./wasm_interval.js";

export class Zonotope {
  /**
   * @param center - Center vector c in R^n
   * @param generators - List of p generator column vectors g_j in R^n
   */
  constructor(
    public center: number[],
    public generators: number[][],
  ) {}

  /** Dimension of the zonotope space n */
  public get dim(): number {
    return this.center.length;
  }

  /** Number of generator vectors p */
  public get generatorCount(): number {
    return this.generators.length;
  }

  /** Order of the zonotope p / n */
  public get order(): number {
    return this.dim > 0 ? this.generatorCount / this.dim : 0;
  }

  public clone(): Zonotope {
    return new Zonotope(
      [...this.center],
      this.generators.map((g) => [...g]),
    );
  }

  /**
   * Creates a zonotope from an interval box (hyper-rectangle).
   */
  public static fromIntervals(intervals: Interval[]): Zonotope {
    const n = intervals.length;
    const center = new Array<number>(n);
    const generators: number[][] = [];

    for (let i = 0; i < n; i++) {
      const inv = intervals[i]!;
      center[i] = inv.mid;
      const radius = inv.width / 2;
      if (radius > 1e-14) {
        const gen = new Array<number>(n).fill(0);
        gen[i] = radius;
        generators.push(gen);
      }
    }

    return new Zonotope(center, generators);
  }

  /**
   * Computes the exact interval hull (axis-aligned bounding box).
   */
  public toIntervals(): Interval[] {
    const n = this.dim;
    const result: Interval[] = [];

    for (let i = 0; i < n; i++) {
      let r = 0;
      for (const g of this.generators) {
        r += Math.abs(g[i] ?? 0);
      }
      const c = this.center[i] ?? 0;
      result.push(new Interval(c - r, c + r));
    }

    return result;
  }

  /**
   * Linear transformation: Z' = A * Z = <A * c, [A * g_0, ..., A * g_{p-1}]>
   * Computed with ZERO wrapping effect.
   */
  public linearMap(A: number[][]): Zonotope {
    const m = A.length;
    const n = this.dim;

    // New center: c' = A * c
    const newCenter = new Array<number>(m).fill(0);
    for (let i = 0; i < m; i++) {
      let sum = 0;
      const row = A[i]!;
      for (let j = 0; j < n; j++) {
        sum += (row[j] ?? 0) * (this.center[j] ?? 0);
      }
      newCenter[i] = sum;
    }

    // New generators: g'_k = A * g_k
    const newGenerators: number[][] = [];
    for (const g of this.generators) {
      const newG = new Array<number>(m).fill(0);
      for (let i = 0; i < m; i++) {
        let sum = 0;
        const row = A[i]!;
        for (let j = 0; j < n; j++) {
          sum += (row[j] ?? 0) * (g[j] ?? 0);
        }
        newG[i] = sum;
      }
      newGenerators.push(newG);
    }

    return new Zonotope(newCenter, newGenerators);
  }

  /**
   * Minkowski addition: Z1 \oplus Z2 = <c1 + c2, [G1, G2]>
   */
  public minkowskiSum(other: Zonotope): Zonotope {
    if (this.dim !== other.dim) {
      throw new Error(`Dimension mismatch: ${this.dim} vs ${other.dim}`);
    }
    const n = this.dim;
    const newCenter = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      newCenter[i] = (this.center[i] ?? 0) + (other.center[i] ?? 0);
    }

    const newGenerators = [...this.generators.map((g) => [...g]), ...other.generators.map((g) => [...g])];

    return new Zonotope(newCenter, newGenerators);
  }

  /**
   * Scale zonotope by a scalar factor alpha.
   */
  public scale(factor: number): Zonotope {
    return new Zonotope(
      this.center.map((c) => c * factor),
      this.generators.map((g) => g.map((v) => v * Math.abs(factor))),
    );
  }

  /**
   * Giroux Order Reduction:
   * Caps the number of generators to at most `maxOrder * n` by over-approximating
   * the smallest generators with an axis-aligned bounding box.
   */
  public reduce(maxOrder = 5): Zonotope {
    const n = this.dim;
    const maxG = Math.floor(maxOrder * n);
    if (this.generators.length <= maxG || maxG <= n) {
      return this.clone();
    }

    // Calculate L1 norm of each generator: ||g_j||_1
    const scored = this.generators.map((g, idx) => {
      let l1 = 0;
      for (let i = 0; i < n; i++) {
        l1 += Math.abs(g[i] ?? 0);
      }
      return { g, l1, idx };
    });

    // Sort descending by magnitude
    scored.sort((a, b) => b.l1 - a.l1);

    // Keep the largest (maxG - n) generators untouched
    const keepCount = Math.max(0, maxG - n);
    const keptGenerators = scored.slice(0, keepCount).map((s) => [...s.g]);

    // Box the remaining smaller generators into an axis-aligned box
    const reducedBox = new Array<number>(n).fill(0);
    for (let k = keepCount; k < scored.length; k++) {
      const g = scored[k]!.g;
      for (let i = 0; i < n; i++) {
        reducedBox[i] = (reducedBox[i] ?? 0) + Math.abs(g[i] ?? 0);
      }
    }

    // Add n axis-aligned generators for the box
    for (let i = 0; i < n; i++) {
      const r = reducedBox[i] ?? 0;
      if (r > 1e-14) {
        const diagG = new Array<number>(n).fill(0);
        diagG[i] = r;
        keptGenerators.push(diagG);
      }
    }

    return new Zonotope([...this.center], keptGenerators);
  }

  /**
   * Support function evaluation in direction v:
   * sigma_Z(v) = max_{x \in Z} v^T x = v^T c + \sum_j |v^T g_j|
   */
  public support(direction: number[]): { min: number; max: number } {
    const n = this.dim;
    let vDotC = 0;
    for (let i = 0; i < n; i++) {
      vDotC += (direction[i] ?? 0) * (this.center[i] ?? 0);
    }

    let radius = 0;
    for (const g of this.generators) {
      let vDotG = 0;
      for (let i = 0; i < n; i++) {
        vDotG += (direction[i] ?? 0) * (g[i] ?? 0);
      }
      radius += Math.abs(vDotG);
    }

    return {
      min: vDotC - radius,
      max: vDotC + radius,
    };
  }

  /**
   * Tests if zonotope intersects a linear half-space: a^T x <= b
   */
  public intersectsHalfspace(
    normal: number[],
    offset: number,
  ): { intersects: boolean; fullyInside: boolean; fullyOutside: boolean } {
    const { min, max } = this.support(normal);
    const fullyInside = max <= offset;
    const fullyOutside = min > offset;
    const intersects = !fullyInside && !fullyOutside;

    return { intersects, fullyInside, fullyOutside };
  }

  /**
   * Splits a zonotope into two halves along its dominant generator.
   */
  public split(directionIndex?: number): [Zonotope, Zonotope] {
    if (this.generators.length === 0) {
      return [this.clone(), this.clone()];
    }

    let splitGenIdx = 0;
    if (directionIndex !== undefined && directionIndex < this.generators.length) {
      splitGenIdx = directionIndex;
    } else {
      // Find generator with largest L2 norm
      let maxNormSq = -1;
      for (let k = 0; k < this.generators.length; k++) {
        let normSq = 0;
        for (const v of this.generators[k]!) normSq += v * v;
        if (normSq > maxNormSq) {
          maxNormSq = normSq;
          splitGenIdx = k;
        }
      }
    }

    const gSplit = this.generators[splitGenIdx]!;
    const remainingG = this.generators.filter((_, idx) => idx !== splitGenIdx);

    const c1 = new Array<number>(this.dim);
    const c2 = new Array<number>(this.dim);
    const halfG = new Array<number>(this.dim);

    for (let i = 0; i < this.dim; i++) {
      const shift = 0.5 * (gSplit[i] ?? 0);
      c1[i] = (this.center[i] ?? 0) + shift;
      c2[i] = (this.center[i] ?? 0) - shift;
      halfG[i] = shift;
    }

    const z1 = new Zonotope(c1, [...remainingG.map((g) => [...g]), halfG]);
    const z2 = new Zonotope(c2, [...remainingG.map((g) => [...g]), halfG]);

    return [z1, z2];
  }

  /**
   * Encloses two zonotopes into a single conservative bounding zonotope.
   */
  public static enclose(z1: Zonotope, z2: Zonotope): Zonotope {
    if (z1.dim !== z2.dim) {
      throw new Error("Dimension mismatch during zonotope enclose");
    }
    const n = z1.dim;
    const c = new Array<number>(n);
    const deltaC = new Array<number>(n);

    for (let i = 0; i < n; i++) {
      c[i] = 0.5 * ((z1.center[i] ?? 0) + (z2.center[i] ?? 0));
      deltaC[i] = 0.5 * ((z1.center[i] ?? 0) - (z2.center[i] ?? 0));
    }

    const newGenerators: number[][] = [
      ...z1.generators.map((g) => g.map((v) => 0.5 * v)),
      ...z2.generators.map((g) => g.map((v) => 0.5 * v)),
      deltaC,
    ];

    return new Zonotope(c, newGenerators).reduce(8);
  }
}
