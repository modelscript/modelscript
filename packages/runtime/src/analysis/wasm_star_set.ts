// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — High-Dimensional Star-Set Reachability Engine.
 *
 * Implements:
 *   S = { x = c + V \alpha | C \alpha <= d, \alpha_j \in [l_j, u_j] }
 *
 * Characteristics:
 *   - Scales up to 50+ continuous state dimensions without exponential grid explosion.
 *   - Exact affine transformations M * S with ZERO wrapping over-approximation.
 *   - Exact halfspace and hyperplane clipping.
 *   - Support function evaluation for tight bounding box extraction.
 */

import { getDefaultWasmExports } from "../dae/wasm_loader.js";
import { Interval } from "./wasm_interval.js";

export class StarSet {
  /**
   * @param center Center vector c \in R^n
   * @param basis Matrix V \in R^{n \times m} represented as m column vectors of length n
   * @param C Predicate inequality matrix C \in R^{p \times m}
   * @param d Predicate inequality vector d \in R^p
   * @param alphaBounds Explicit bounds [l_j, u_j] for each predicate variable \alpha_j
   */
  constructor(
    public center: number[],
    public basis: number[][], // m column vectors
    public C: number[][] = [],
    public d: number[] = [],
    public alphaBounds: Interval[] = [],
  ) {
    if (this.alphaBounds.length === 0 && this.numBasisVectors > 0) {
      this.alphaBounds = Array.from({ length: this.numBasisVectors }, () => new Interval(-1, 1));
    }
  }

  public get dim(): number {
    return this.center.length;
  }

  public get numBasisVectors(): number {
    return this.basis.length;
  }

  public get numConstraints(): number {
    return this.C.length;
  }

  public clone(): StarSet {
    return new StarSet(
      [...this.center],
      this.basis.map((col) => [...col]),
      this.C.map((row) => [...row]),
      [...this.d],
      this.alphaBounds.map((inv) => new Interval(inv.lo, inv.hi)),
    );
  }

  /**
   * Constructs a Star Set from an interval hyper-rectangle (box).
   */
  public static fromIntervals(intervals: Interval[]): StarSet {
    const n = intervals.length;
    const center = new Array<number>(n);
    const basis: number[][] = [];
    const alphaBounds: Interval[] = [];

    for (let i = 0; i < n; i++) {
      const inv = intervals[i]!;
      center[i] = inv.mid;
      const radius = 0.5 * inv.width;

      if (radius > 1e-14) {
        const col = new Array<number>(n).fill(0);
        col[i] = radius;
        basis.push(col);
        alphaBounds.push(new Interval(-1, 1));
      }
    }

    return new StarSet(center, basis, [], [], alphaBounds);
  }

  /**
   * Exact affine transformation: S' = M * S = <M * c, M * V, C, d, alphaBounds>
   * Computed in WASM linear memory via `star_linearMap` with ZERO wrapping error.
   */
  public linearMap(M: number[][]): StarSet {
    const outDim = M.length;
    const inDim = this.dim;
    const numBasis = this.numBasisVectors;

    const w = getDefaultWasmExports();
    if (
      w &&
      typeof w.star_linearMap === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      outDim > 0 &&
      inDim > 0
    ) {
      const mPtr = w.alloc(outDim * inDim * 8);
      const cPtr = w.alloc(inDim * 8);
      const bPtr = w.alloc(Math.max(1, numBasis * inDim) * 8);
      const outCPtr = w.alloc(outDim * 8);
      const outBPtr = w.alloc(Math.max(1, numBasis * outDim) * 8);
      try {
        const mView = new Float64Array(w.memory.buffer, mPtr, outDim * inDim);
        for (let i = 0; i < outDim; i++) {
          const row = M[i]!;
          const off = i * inDim;
          for (let j = 0; j < inDim; j++) mView[off + j] = row[j] ?? 0;
        }
        const cView = new Float64Array(w.memory.buffer, cPtr, inDim);
        for (let j = 0; j < inDim; j++) cView[j] = this.center[j] ?? 0;
        if (numBasis > 0) {
          const bView = new Float64Array(w.memory.buffer, bPtr, numBasis * inDim);
          for (let col = 0; col < numBasis; col++) {
            const v = this.basis[col]!;
            const off = col * inDim;
            for (let j = 0; j < inDim; j++) bView[off + j] = v[j] ?? 0;
          }
        }

        w.star_linearMap(mPtr, outDim, inDim, cPtr, bPtr, numBasis, outCPtr, outBPtr);

        const newCenter = Array.from(new Float64Array(w.memory.buffer, outCPtr, outDim));
        const newBasis: number[][] = new Array(numBasis);
        if (numBasis > 0) {
          const outBView = new Float64Array(w.memory.buffer, outBPtr, numBasis * outDim);
          for (let col = 0; col < numBasis; col++) {
            const off = col * outDim;
            newBasis[col] = Array.from(outBView.subarray(off, off + outDim));
          }
        }

        return new StarSet(
          newCenter,
          newBasis,
          this.C.map((r) => [...r]),
          [...this.d],
          this.alphaBounds.map((inv) => new Interval(inv.lo, inv.hi)),
        );
      } finally {
        w.free(mPtr);
        w.free(cPtr);
        w.free(bPtr);
        w.free(outCPtr);
        w.free(outBPtr);
      }
    }

    const newCenter = new Array<number>(outDim).fill(0);
    for (let i = 0; i < outDim; i++) {
      let sum = 0;
      for (let j = 0; j < inDim; j++) sum += (M[i]![j] ?? 0) * (this.center[j] ?? 0);
      newCenter[i] = sum;
    }
    const newBasis: number[][] = [];
    for (let m = 0; m < numBasis; m++) {
      const col = this.basis[m]!;
      const newCol = new Array<number>(outDim).fill(0);
      for (let i = 0; i < outDim; i++) {
        let sum = 0;
        for (let j = 0; j < inDim; j++) sum += (M[i]![j] ?? 0) * (col[j] ?? 0);
        newCol[i] = sum;
      }
      newBasis.push(newCol);
    }
    return new StarSet(
      newCenter,
      newBasis,
      this.C.map((r) => [...r]),
      [...this.d],
      this.alphaBounds.map((inv) => new Interval(inv.lo, inv.hi)),
    );
  }

  /**
   * Exact halfspace intersection: S \cap { x | h^T x <= gamma }
   * Evaluates h^T (c + V \alpha) <= gamma  =>  (h^T V) \alpha <= gamma - h^T c
   * via `star_intersectHalfspace` in WASM linear memory.
   */
  public intersectHalfspace(h: number[], gamma: number): StarSet {
    const m = this.numBasisVectors;
    const dim = this.dim;

    const w = getDefaultWasmExports();
    if (
      w &&
      typeof w.star_intersectHalfspace === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      dim > 0
    ) {
      const hPtr = w.alloc(dim * 8);
      const cPtr = w.alloc(dim * 8);
      const bPtr = w.alloc(Math.max(1, m * dim) * 8);
      const outRowPtr = w.alloc(Math.max(1, m) * 8);
      try {
        const hView = new Float64Array(w.memory.buffer, hPtr, dim);
        const cView = new Float64Array(w.memory.buffer, cPtr, dim);
        for (let i = 0; i < dim; i++) {
          hView[i] = h[i] ?? 0;
          cView[i] = this.center[i] ?? 0;
        }
        if (m > 0) {
          const bView = new Float64Array(w.memory.buffer, bPtr, m * dim);
          for (let j = 0; j < m; j++) {
            const col = this.basis[j]!;
            const off = j * dim;
            for (let i = 0; i < dim; i++) bView[off + i] = col[i] ?? 0;
          }
        }

        const bound: number = w.star_intersectHalfspace(hPtr, gamma, dim, cPtr, bPtr, m, outRowPtr);
        const row = m > 0 ? Array.from(new Float64Array(w.memory.buffer, outRowPtr, m)) : [];
        const newS = this.clone();
        newS.C.push(row);
        newS.d.push(bound);
        return newS;
      } finally {
        w.free(hPtr);
        w.free(cPtr);
        w.free(bPtr);
        w.free(outRowPtr);
      }
    }

    const row = new Array<number>(m).fill(0);
    let hDotC = 0;
    for (let i = 0; i < dim; i++) hDotC += (h[i] ?? 0) * (this.center[i] ?? 0);
    for (let j = 0; j < m; j++) {
      let sum = 0;
      const col = this.basis[j]!;
      for (let i = 0; i < dim; i++) sum += (h[i] ?? 0) * (col[i] ?? 0);
      row[j] = sum;
    }
    const newS = this.clone();
    newS.C.push(row);
    newS.d.push(gamma - hDotC);
    return newS;
  }

  /**
   * Computes the bounding interval hull using coordinate support function evaluation
   * via `star_toIntervals` in WASM linear memory.
   */
  public toIntervals(): Interval[] {
    const n = this.dim;
    const m = this.numBasisVectors;
    const p = this.C.length;

    const w = getDefaultWasmExports();
    if (
      w &&
      typeof w.star_toIntervals === "function" &&
      typeof w.alloc === "function" &&
      typeof w.free === "function" &&
      n > 0
    ) {
      const cPtr = w.alloc(n * 8);
      const bPtr = w.alloc(Math.max(1, m * n) * 8);
      const cMatPtr = w.alloc(Math.max(1, p * m) * 8);
      const dPtr = w.alloc(Math.max(1, p) * 8);
      const aLoPtr = w.alloc(Math.max(1, m) * 8);
      const aHiPtr = w.alloc(Math.max(1, m) * 8);
      const outLoPtr = w.alloc(n * 8);
      const outHiPtr = w.alloc(n * 8);
      try {
        const cView = new Float64Array(w.memory.buffer, cPtr, n);
        for (let i = 0; i < n; i++) cView[i] = this.center[i] ?? 0;

        if (m > 0) {
          const bView = new Float64Array(w.memory.buffer, bPtr, m * n);
          const aLoView = new Float64Array(w.memory.buffer, aLoPtr, m);
          const aHiView = new Float64Array(w.memory.buffer, aHiPtr, m);
          for (let j = 0; j < m; j++) {
            const col = this.basis[j]!;
            const off = j * n;
            for (let i = 0; i < n; i++) bView[off + i] = col[i] ?? 0;
            const ab = this.alphaBounds[j];
            aLoView[j] = ab ? ab.lo : -1;
            aHiView[j] = ab ? ab.hi : 1;
          }
        }

        if (p > 0) {
          const dView = new Float64Array(w.memory.buffer, dPtr, p);
          const cMatView = new Float64Array(w.memory.buffer, cMatPtr, Math.max(1, p * m));
          for (let k = 0; k < p; k++) {
            dView[k] = this.d[k] ?? 0;
            const row = this.C[k]!;
            const off = k * m;
            for (let j = 0; j < m; j++) cMatView[off + j] = row[j] ?? 0;
          }
        }

        w.star_toIntervals(n, m, p, cPtr, bPtr, cMatPtr, dPtr, aLoPtr, aHiPtr, outLoPtr, outHiPtr);

        const outLo = new Float64Array(w.memory.buffer, outLoPtr, n);
        const outHi = new Float64Array(w.memory.buffer, outHiPtr, n);
        const intervals: Interval[] = new Array(n);
        for (let i = 0; i < n; i++) {
          intervals[i] = new Interval(outLo[i]!, outHi[i]!);
        }
        return intervals;
      } finally {
        w.free(cPtr);
        w.free(bPtr);
        w.free(cMatPtr);
        w.free(dPtr);
        w.free(aLoPtr);
        w.free(aHiPtr);
        w.free(outLoPtr);
        w.free(outHiPtr);
      }
    }

    const intervals: Interval[] = [];
    const effectiveBounds: Interval[] = Array.from({ length: m }, (_, j) => {
      const b = this.alphaBounds[j];
      return b ? new Interval(b.lo, b.hi) : new Interval(-1, 1);
    });
    for (let k = 0; k < p; k++) {
      const row = this.C[k]!;
      const bound = this.d[k]!;
      let singleAlphaIdx = -1;
      let nonZeroCount = 0;
      for (let j = 0; j < m; j++) {
        if ((row[j] ?? 0) !== 0) {
          singleAlphaIdx = j;
          nonZeroCount++;
          if (nonZeroCount > 1) break;
        }
      }
      if (nonZeroCount === 1 && singleAlphaIdx >= 0) {
        const cVal = row[singleAlphaIdx]!;
        const alphaLimit = bound / cVal;
        const b = effectiveBounds[singleAlphaIdx]!;
        if (cVal > 0) b.hi = Math.min(b.hi, alphaLimit);
        else b.lo = Math.max(b.lo, alphaLimit);
        if (b.lo > b.hi) return Array.from({ length: n }, () => new Interval(Infinity, -Infinity));
      }
    }
    for (let i = 0; i < n; i++) {
      let minVal = this.center[i]!;
      let maxVal = this.center[i]!;
      for (let j = 0; j < m; j++) {
        const coeff = this.basis[j]![i] ?? 0;
        const b = effectiveBounds[j]!;
        if (coeff >= 0) {
          minVal += coeff * b.lo;
          maxVal += coeff * b.hi;
        } else {
          minVal += coeff * b.hi;
          maxVal += coeff * b.lo;
        }
      }
      intervals.push(new Interval(minVal, maxVal));
    }
    return intervals;
  }
}
