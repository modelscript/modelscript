// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed TypeScript Bridges for Linear-Memory AssemblyScript Analysis & Formal Kernels:
 * - `WasmEGraphBridge` (union-find + hash-consed congruence closure)
 * - `wasmSbgIntervalIntersect` / `wasmSbgMdiIntersect` (strided integer interval intersection)
 * - `wasmHc4Revise` (forward-backward HC4 interval constraint contraction)
 * - `wasmTaylorModelMulTruncate` (multivariate polynomial multiplication & truncation)
 */

import { getDefaultWasmExports } from "../dae/wasm_dae.js";

/**
 * Intersects two 1D strided intervals `[lo1, step1, hi1]` and `[lo2, step2, hi2]` in WASM linear memory.
 * Returns `[lo, step, hi]` or `null` if empty (or `undefined` if WASM is not yet initialized).
 */
export function wasmSbgIntervalIntersect(
  lo1: number,
  step1: number,
  hi1: number,
  lo2: number,
  step2: number,
  hi2: number,
): [number, number, number] | null | undefined {
  const w = getDefaultWasmExports() as any;
  if (!w || typeof w.sbg_intervalIntersect !== "function") return undefined;

  const outPtr = w.alloc(12);
  try {
    const ok = w.sbg_intervalIntersect(lo1, step1, hi1, lo2, step2, hi2, outPtr);
    if (!ok) return null;
    const view = new Int32Array(w.memory.buffer, outPtr, 3);
    return [view[0]!, view[1]!, view[2]!];
  } finally {
    w.free(outPtr);
  }
}

/**
 * Executes one forward-backward HC4 interval contraction pass in WASM linear memory.
 * Updates `varLo` and `varHi` in place.
 * Returns `true` if consistent, `false` if UNSAT, or `undefined` if WASM is unavailable.
 */
export function wasmHc4Revise(
  nodes: Int32Array,
  consts: Float64Array,
  varLo: Float64Array,
  varHi: Float64Array,
  targetLo: number,
  targetHi: number,
): boolean | undefined {
  const w = getDefaultWasmExports() as any;
  if (!w || typeof w.hc4_revise !== "function") return undefined;

  const numNodes = Math.floor(nodes.length / 4);
  const nPtr = w.alloc(nodes.byteLength);
  const cPtr = consts.byteLength > 0 ? w.alloc(consts.byteLength) : 0;
  const loPtr = w.alloc(varLo.byteLength);
  const hiPtr = w.alloc(varHi.byteLength);

  try {
    new Int32Array(w.memory.buffer, nPtr, nodes.length).set(nodes);
    if (cPtr) new Float64Array(w.memory.buffer, cPtr, consts.length).set(consts);
    new Float64Array(w.memory.buffer, loPtr, varLo.length).set(varLo);
    new Float64Array(w.memory.buffer, hiPtr, varHi.length).set(varHi);

    const ok = w.hc4_revise(nPtr, numNodes, cPtr, loPtr, hiPtr, targetLo, targetHi);
    if (ok) {
      varLo.set(new Float64Array(w.memory.buffer, loPtr, varLo.length));
      varHi.set(new Float64Array(w.memory.buffer, hiPtr, varHi.length));
    }
    return ok === 1;
  } finally {
    w.free(nPtr);
    if (cPtr) w.free(cPtr);
    w.free(loPtr);
    w.free(hiPtr);
  }
}

/**
 * Multiplies two sparse multivariate Taylor Models and truncates to `maxOrder` in WASM linear memory.
 */
export function wasmTaylorModelMulTruncate(
  dim: number,
  maxOrder: number,
  expA: Uint8Array,
  coefA: Float64Array,
  remA: [number, number],
  expB: Uint8Array,
  coefB: Float64Array,
  remB: [number, number],
  maxOutTerms = 256,
): { exp: Uint8Array; coef: Float64Array; rem: [number, number] } | undefined {
  const w = getDefaultWasmExports() as any;
  if (!w || typeof w.tm_mulTruncate !== "function") return undefined;

  const eAPtr = w.alloc(Math.max(1, expA.byteLength));
  const cAPtr = w.alloc(Math.max(8, coefA.byteLength));
  const eBPtr = w.alloc(Math.max(1, expB.byteLength));
  const cBPtr = w.alloc(Math.max(8, coefB.byteLength));
  const outEPtr = w.alloc(Math.max(1, maxOutTerms * dim));
  const outCPtr = w.alloc(maxOutTerms * 8);
  const outRPtr = w.alloc(16);

  try {
    if (expA.length > 0) new Uint8Array(w.memory.buffer, eAPtr, expA.length).set(expA);
    if (coefA.length > 0) new Float64Array(w.memory.buffer, cAPtr, coefA.length).set(coefA);
    if (expB.length > 0) new Uint8Array(w.memory.buffer, eBPtr, expB.length).set(expB);
    if (coefB.length > 0) new Float64Array(w.memory.buffer, cBPtr, coefB.length).set(coefB);

    const count = w.tm_mulTruncate(
      dim,
      maxOrder,
      coefA.length,
      eAPtr,
      cAPtr,
      remA[0],
      remA[1],
      coefB.length,
      eBPtr,
      cBPtr,
      remB[0],
      remB[1],
      outEPtr,
      outCPtr,
      maxOutTerms,
      outRPtr,
    );

    const exp = new Uint8Array(count * dim);
    const coef = new Float64Array(count);
    const remView = new Float64Array(w.memory.buffer, outRPtr, 2);
    if (count > 0) {
      exp.set(new Uint8Array(w.memory.buffer, outEPtr, count * dim));
      coef.set(new Float64Array(w.memory.buffer, outCPtr, count));
    }
    return { exp, coef, rem: [remView[0]!, remView[1]!] };
  } finally {
    w.free(eAPtr);
    w.free(cAPtr);
    w.free(eBPtr);
    w.free(cBPtr);
    w.free(outEPtr);
    w.free(outCPtr);
    w.free(outRPtr);
  }
}

/**
 * Lightweight TS handle wrapping an in-WASM E-Graph instance.
 */
export class WasmEGraphBridge {
  private readonly w: any;
  private readonly ptr: number;

  constructor(initialCap = 1024) {
    const w = getDefaultWasmExports() as any;
    if (!w || typeof w.egraph_create !== "function") {
      throw new Error("WASM E-Graph kernel not initialized. Call initBltWasm() first.");
    }
    this.w = w;
    this.ptr = w.egraph_create(initialCap);
  }

  addNode(op: number, left = -1, right = -1): number {
    return this.w.egraph_addNode(this.ptr, op, left, right);
  }

  find(id: number): number {
    return this.w.egraph_find(this.ptr, id);
  }

  union(a: number, b: number): number {
    return this.w.egraph_union(this.ptr, a, b);
  }

  rebuild(): number {
    return this.w.egraph_rebuild(this.ptr);
  }

  get classCount(): number {
    return this.w.egraph_classCount(this.ptr);
  }
}

/**
 * Solves a Dutertre–de Moura LRA Simplex feasibility problem in WASM linear memory
 * using the compiled `wasm/formal/simplex.ts` tableau engine.
 *
 * Matrix A (m x n): basic slack variables s_i = sum_j A[i, j] * x_j,
 * bounds for all totalVars = m + n variables (0..n-1 = structural, n..n+m-1 = slack).
 * Returns `{ status: "SAT" | "UNSAT" | "UNKNOWN", assignments?: Float64Array }` or `undefined` if WASM unavailable.
 */
export function wasmSimplexSolveDutertreDeMoura(
  A: Float64Array,
  m: number,
  n: number,
  bounds: { varIdx: number; isLower: boolean; r: number; kDelta?: number }[],
  maxIterations = 2000,
): { status: "SAT" | "UNSAT" | "UNKNOWN"; assignments?: Float64Array } | undefined {
  const w = getDefaultWasmExports() as any;
  if (!w || typeof w.simplex_create !== "function" || typeof w.simplex_solveDutertreDeMoura !== "function") {
    return undefined;
  }

  const sPtr = w.simplex_create(m + 2, n + 2);
  try {
    w.simplex_initDutertreDeMoura(sPtr, m, n);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        const val = A[i * n + j]!;
        if (val !== 0) w.simplex_setEntry(sPtr, i, j, val);
      }
    }
    for (const b of bounds) {
      w.simplex_setBound(sPtr, b.varIdx, b.isLower, b.r, b.kDelta ?? 0);
    }
    const resCode: number = w.simplex_solveDutertreDeMoura(sPtr, maxIterations);
    if (resCode === 1) {
      const assignments = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        assignments[j] = w.simplex_getAssignment(sPtr, j);
      }
      return { status: "SAT", assignments };
    }
    if (resCode === 2) return { status: "UNSAT" };
    return { status: "UNKNOWN" };
  } finally {
    w.simplex_destroy(sPtr);
  }
}

/**
 * Typed TS handle wrapping the in-WASM Hybrid Event Detector (`wasm/simulation/events.ts`):
 * zero-crossing detection, Brent root localization, Zeno chattering guard, and sign updates.
 */
export class WasmEventDetectorBridge {
  private readonly w: any;
  public readonly ptr: number;

  constructor(daePtr: number) {
    const w = getDefaultWasmExports() as any;
    if (!w || typeof w.event_createDetector !== "function") {
      throw new Error("WASM EventDetector kernel not initialized. Call initBltWasm() first.");
    }
    this.w = w;
    this.ptr = w.event_createDetector(daePtr);
  }

  /** Registers a zero-crossing expression ID (`targetDirection`: 1 = rising, -1 = falling, 0 = both). */
  addZcf(zcfExprId: number, initialValue: number, targetDirection: -1 | 0 | 1 = 0): number {
    return this.w.event_addZcf(this.ptr, zcfExprId, initialValue, targetDirection);
  }

  /** Checks all registered ZCFs against `varValues` in linear memory; returns first triggered ZCF index, or `-1` if none. */
  checkZeroCrossings(varValues: Float64Array): number {
    const valPtr = this.w.alloc(varValues.byteLength);
    try {
      new Float64Array(this.w.memory.buffer, valPtr, varValues.length).set(varValues);
      return this.w.event_checkZeroCrossings(this.ptr, valPtr);
    } finally {
      this.w.free(valPtr);
    }
  }

  /** Updates stored ZCF signs after event handling. */
  updateSigns(varValues: Float64Array): void {
    const valPtr = this.w.alloc(varValues.byteLength);
    try {
      new Float64Array(this.w.memory.buffer, valPtr, varValues.length).set(varValues);
      this.w.event_updateZcfSigns(this.ptr, valPtr);
    } finally {
      this.w.free(valPtr);
    }
  }

  /** Checks whether an event at `tEvent` violates the Zeno chattering limit. */
  checkZenoLimit(tEvent: number, maxConsecutive = 50, windowTol = 1e-9): boolean {
    return Boolean(this.w.event_checkZenoLimit(this.ptr, tEvent, maxConsecutive, windowTol));
  }
}
