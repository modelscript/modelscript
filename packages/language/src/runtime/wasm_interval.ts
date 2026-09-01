// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { StaticTapeBuilder, TapeOpKind, evaluateTapeForward, evaluateTapeReverse } from "../compiler/tape.js";
import { DAEBuilder } from "./wasm_dae.js";

/**
 * WebAssembly-backed Interval Arithmetic, McCormick Relaxations,
 * and Spatial Branch-and-Bound (sBB) Global Optimization.
 */

export interface WasmInterval {
  lo: number;
  hi: number;
}

export interface WasmMcCormickTuple {
  cv: number; // Convex underestimator
  cc: number; // Concave overestimator
  lo: number; // Interval lower bound
  hi: number; // Interval upper bound
}

export interface WasmBnBResult {
  optimumValue: number;
  iterations: number;
  converged: boolean;
  solution: Float64Array;
}

export interface WasmIntervalInstance {
  tape_evaluateInterval(
    tapePtr: number,
    varBoundsLoPtr: number,
    varBoundsHiPtr: number,
    outLoPtr: number,
    outHiPtr: number,
  ): void;
  tape_evaluateMcCormick(
    tapePtr: number,
    varValsPtr: number,
    varBoundsLoPtr: number,
    varBoundsHiPtr: number,
    outCvPtr: number,
    outCcPtr: number,
    outLoPtr: number,
    outHiPtr: number,
  ): void;
  bnb_solveGlobalMin(
    tapePtr: number,
    targetTapeNode: number,
    nVars: number,
    initBoundsLoPtr: number,
    initBoundsHiPtr: number,
    outBestSolutionPtr: number,
    maxIterations?: number,
    tol?: number,
  ): number;
  memory: WebAssembly.Memory;
}

/**
 * High-level TypeScript wrapper for WASM Interval Arithmetic, McCormick Relaxations,
 * and Spatial Branch-and-Bound solver.
 */
export class WasmIntervalEngine {
  constructor(private instance: WasmIntervalInstance | any) {}

  /**
   * Evaluates forward interval bounds for all tape nodes in zero-copy linear memory.
   */
  evaluateTapeInterval(
    tapePtr: number,
    nodeCount: number,
    varBoundsLo: Float64Array,
    varBoundsHi: Float64Array,
  ): { lo: Float64Array; hi: Float64Array } {
    if (!this.instance?.tape_evaluateInterval || !this.instance?.memory) {
      throw new Error("WasmIntervalEngine: WASM exports not initialized");
    }

    const nVars = varBoundsLo.length;
    const memF64 = new Float64Array(this.instance.memory.buffer);

    const varLoOffset = 1024 >> 3;
    const varHiOffset = varLoOffset + nVars;
    const outLoOffset = varHiOffset + nVars;
    const outHiOffset = outLoOffset + nodeCount;

    memF64.set(varBoundsLo, varLoOffset);
    memF64.set(varBoundsHi, varHiOffset);

    this.instance.tape_evaluateInterval(
      tapePtr,
      varLoOffset << 3,
      varHiOffset << 3,
      outLoOffset << 3,
      outHiOffset << 3,
    );

    const outLo = new Float64Array(nodeCount);
    const outHi = new Float64Array(nodeCount);
    outLo.set(memF64.subarray(outLoOffset, outLoOffset + nodeCount));
    outHi.set(memF64.subarray(outHiOffset, outHiOffset + nodeCount));

    return { lo: outLo, hi: outHi };
  }

  /**
   * Evaluates forward McCormick relaxations for all tape nodes in zero-copy linear memory.
   */
  evaluateTapeMcCormick(
    tapePtr: number,
    nodeCount: number,
    varVals: Float64Array,
    varBoundsLo: Float64Array,
    varBoundsHi: Float64Array,
  ): { cv: Float64Array; cc: Float64Array; lo: Float64Array; hi: Float64Array } {
    if (!this.instance?.tape_evaluateMcCormick || !this.instance?.memory) {
      throw new Error("WasmIntervalEngine: WASM exports not initialized");
    }

    const nVars = varVals.length;
    const memF64 = new Float64Array(this.instance.memory.buffer);

    const varValsOffset = 1024 >> 3;
    const varLoOffset = varValsOffset + nVars;
    const varHiOffset = varLoOffset + nVars;
    const outCvOffset = varHiOffset + nVars;
    const outCcOffset = outCvOffset + nodeCount;
    const outLoOffset = outCcOffset + nodeCount;
    const outHiOffset = outLoOffset + nodeCount;

    memF64.set(varVals, varValsOffset);
    memF64.set(varBoundsLo, varLoOffset);
    memF64.set(varBoundsHi, varHiOffset);

    this.instance.tape_evaluateMcCormick(
      tapePtr,
      varValsOffset << 3,
      varLoOffset << 3,
      varHiOffset << 3,
      outCvOffset << 3,
      outCcOffset << 3,
      outLoOffset << 3,
      outHiOffset << 3,
    );

    const cv = new Float64Array(nodeCount);
    const cc = new Float64Array(nodeCount);
    const lo = new Float64Array(nodeCount);
    const hi = new Float64Array(nodeCount);

    cv.set(memF64.subarray(outCvOffset, outCvOffset + nodeCount));
    cc.set(memF64.subarray(outCcOffset, outCcOffset + nodeCount));
    lo.set(memF64.subarray(outLoOffset, outLoOffset + nodeCount));
    hi.set(memF64.subarray(outHiOffset, outHiOffset + nodeCount));

    return { cv, cc, lo, hi };
  }

  /**
   * Solves a global minimization problem using Spatial Branch-and-Bound in WASM linear memory.
   */
  solveGlobalMin(
    tapePtr: number,
    targetTapeNode: number,
    nVars: number,
    initBoundsLo: Float64Array,
    initBoundsHi: Float64Array,
    maxIterations: number = 500,
    tol: number = 1e-4,
  ): WasmBnBResult {
    if (!this.instance?.bnb_solveGlobalMin || !this.instance?.memory) {
      throw new Error("WasmIntervalEngine: WASM bnb_solveGlobalMin not initialized");
    }

    const memF64 = new Float64Array(this.instance.memory.buffer);
    const initLoOffset = 1024 >> 3;
    const initHiOffset = initLoOffset + nVars;
    const outSolOffset = initHiOffset + nVars;

    memF64.set(initBoundsLo, initLoOffset);
    memF64.set(initBoundsHi, initHiOffset);

    const bnbResultPtr = this.instance.bnb_solveGlobalMin(
      tapePtr,
      targetTapeNode,
      nVars,
      initLoOffset << 3,
      initHiOffset << 3,
      outSolOffset << 3,
      maxIterations,
      tol,
    );

    const bestSolution = new Float64Array(nVars);
    bestSolution.set(memF64.subarray(outSolOffset, outSolOffset + nVars));

    // Read result structure from WASM memory if pointer returned
    const memU32 = new Uint32Array(this.instance.memory.buffer);
    let optimumValue = 0.0;
    let iterations = 0;
    let converged = false;

    if (bnbResultPtr > 0) {
      const resOffsetF64 = bnbResultPtr >> 3;
      const resOffsetU32 = bnbResultPtr >> 2;
      optimumValue = memF64[resOffsetF64] ?? 0.0;
      iterations = memU32[resOffsetU32 + 2] ?? 0;
      converged = Boolean(memU32[resOffsetU32 + 3] ?? 0);
    }

    return {
      optimumValue,
      iterations,
      converged,
      solution: bestSolution,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Spatial Branch-and-Bound (sBB) Solver & Tape Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Interval representation for Spatial Branch & Bound */
export class Interval {
  constructor(
    public lo: number,
    public hi: number,
  ) {}
  get mid(): number {
    return 0.5 * (this.lo + this.hi);
  }
  get width(): number {
    return this.hi - this.lo;
  }
}

export interface McCormickResult {
  cv: number;
  cc: number;
  lo: number;
  hi: number;
}

/** A box in the search space: variable name → [lo, hi] */
export type DomainBox = Map<string, Interval>;

/** Result of the sBB solver. */
export interface SbbResult {
  /** Optimal variable values (best feasible point). */
  solution: Map<string, number>;
  /** Optimal objective value (upper bound). */
  objectiveValue: number;
  /** Lower bound on optimal objective. */
  lowerBound: number;
  /** Number of nodes explored. */
  nodesExplored: number;
  /** Whether the solver found a global optimum within tolerance. */
  optimal: boolean;
}

/** Configuration for the sBB solver. */
export interface SbbOptions {
  /** Absolute gap tolerance (default: 1e-6). */
  absTol?: number;
  /** Relative gap tolerance (default: 1e-4). */
  relTol?: number;
  /** Maximum number of nodes to explore (default: 10000). */
  maxNodes?: number;
  /** Maximum Newton iterations per local solve (default: 50). */
  maxNewtonIter?: number;
}

export function evaluateTapeInterval(tape: StaticTapeBuilder, box: DomainBox): Interval[] {
  const result: Interval[] = [];
  const nodeCount = tape.length;
  for (let i = 0; i < nodeCount; i++) {
    const offset = i * 4;
    const kind = tape.opData[offset] as TapeOpKind;
    const data1 = tape.opData[offset + 1] ?? 0;
    const data2 = tape.opData[offset + 2] ?? 0;
    switch (kind) {
      case TapeOpKind.Const: {
        const c = tape.valData[i] ?? 0;
        result.push(new Interval(c, c));
        break;
      }
      case TapeOpKind.Var: {
        const name = tape.interner.resolve(data1);
        const iv = box.get(name);
        result.push(iv ? new Interval(iv.lo, iv.hi) : new Interval(-Infinity, Infinity));
        break;
      }
      case TapeOpKind.Add: {
        const l = result[data1] ?? new Interval(0, 0);
        const r = result[data2] ?? new Interval(0, 0);
        result.push(new Interval(l.lo + r.lo, l.hi + r.hi));
        break;
      }
      case TapeOpKind.Sub: {
        const l = result[data1] ?? new Interval(0, 0);
        const r = result[data2] ?? new Interval(0, 0);
        result.push(new Interval(l.lo - r.hi, l.hi - r.lo));
        break;
      }
      case TapeOpKind.Mul: {
        const l = result[data1] ?? new Interval(0, 0);
        const r = result[data2] ?? new Interval(0, 0);
        const p1 = l.lo * r.lo,
          p2 = l.lo * r.hi,
          p3 = l.hi * r.lo,
          p4 = l.hi * r.hi;
        result.push(new Interval(Math.min(p1, p2, p3, p4), Math.max(p1, p2, p3, p4)));
        break;
      }
      case TapeOpKind.Div: {
        const l = result[data1] ?? new Interval(0, 0);
        const r = result[data2] ?? new Interval(0, 0);
        if (r.lo <= 0 && r.hi >= 0) {
          result.push(new Interval(-Infinity, Infinity));
        } else {
          const q1 = l.lo / r.lo,
            q2 = l.lo / r.hi,
            q3 = l.hi / r.lo,
            q4 = l.hi / r.hi;
          result.push(new Interval(Math.min(q1, q2, q3, q4), Math.max(q1, q2, q3, q4)));
        }
        break;
      }
      case TapeOpKind.Neg: {
        const l = result[data1] ?? new Interval(0, 0);
        result.push(new Interval(-l.hi, -l.lo));
        break;
      }
      default:
        result.push(new Interval(-Infinity, Infinity));
    }
  }
  return result;
}

export function evaluateTapeMcCormick(
  tape: StaticTapeBuilder,
  box: DomainBox,
  point: Map<string, number>,
): McCormickResult[] {
  const intervals = evaluateTapeInterval(tape, box);
  const result: McCormickResult[] = [];
  const nodeCount = tape.length;
  for (let i = 0; i < nodeCount; i++) {
    const iv = intervals[i] ?? new Interval(0, 0);
    const offset = i * 4;
    const kind = tape.opData[offset] as TapeOpKind;
    const data1 = tape.opData[offset + 1] ?? 0;
    const data2 = tape.opData[offset + 2] ?? 0;
    switch (kind) {
      case TapeOpKind.Const: {
        const c = tape.valData[i] ?? 0;
        result.push({ cv: c, cc: c, lo: c, hi: c });
        break;
      }
      case TapeOpKind.Var: {
        const name = tape.interner.resolve(data1);
        const x = point.get(name) ?? iv.mid;
        result.push({ cv: x, cc: x, lo: iv.lo, hi: iv.hi });
        break;
      }
      case TapeOpKind.Add: {
        const l = result[data1] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        const r = result[data2] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        result.push({ cv: l.cv + r.cv, cc: l.cc + r.cc, lo: iv.lo, hi: iv.hi });
        break;
      }
      case TapeOpKind.Sub: {
        const l = result[data1] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        const r = result[data2] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        result.push({ cv: l.cv - r.cc, cc: l.cc - r.cv, lo: iv.lo, hi: iv.hi });
        break;
      }
      case TapeOpKind.Mul: {
        const l = result[data1] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        const r = result[data2] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        const cv1 = l.lo * r.cv + l.cv * r.lo - l.lo * r.lo;
        const cv2 = l.hi * r.cv + l.cv * r.hi - l.hi * r.hi;
        const cc1 = l.hi * r.cc + l.cv * r.lo - l.hi * r.lo;
        const cc2 = l.cv * r.hi + l.lo * r.cc - l.lo * r.hi;
        result.push({ cv: Math.max(cv1, cv2), cc: Math.min(cc1, cc2), lo: iv.lo, hi: iv.hi });
        break;
      }
      case TapeOpKind.Neg: {
        const l = result[data1] ?? { cv: 0, cc: 0, lo: 0, hi: 0 };
        result.push({ cv: -l.cc, cc: -l.cv, lo: iv.lo, hi: iv.hi });
        break;
      }
      default:
        result.push({ cv: iv.lo, cc: iv.hi, lo: iv.lo, hi: iv.hi });
    }
  }
  return result;
}

interface SbbNode {
  box: DomainBox;
  lowerBound: number;
}

/**
 * Solve a global optimization problem using spatial branch-and-bound.
 *
 * Minimizes `objective(z)` subject to `constraints_i(z) = 0`.
 */
export function solveSBB(
  objectiveTape: { ops: StaticTapeBuilder; outputIndex: number },
  constraintTapes: { ops: StaticTapeBuilder; outputIndex: number }[],
  variables: string[],
  initialBox: DomainBox,
  options: SbbOptions = {},
): SbbResult {
  const absTol = options.absTol ?? 1e-6;
  const relTol = options.relTol ?? 1e-4;
  const maxNodes = options.maxNodes ?? 10000;
  const maxNewtonIter = options.maxNewtonIter ?? 50;

  let incumbent: Map<string, number> | null = null;
  let upperBound = Infinity;
  let globalLowerBound = -Infinity;
  let nodesExplored = 0;

  const queue: SbbNode[] = [];

  const rootLB = evaluateIntervalLB(objectiveTape, initialBox);
  queue.push({ box: new Map(initialBox), lowerBound: rootLB });

  const midpoint = boxMidpoint(initialBox, variables);
  const localResult = localNewtonSolve(objectiveTape, constraintTapes, variables, midpoint, maxNewtonIter);
  if (localResult !== null && isBoxFeasible(localResult.point, initialBox)) {
    const objVal = evaluateObjective(objectiveTape, localResult.point);
    if (objVal < upperBound) {
      upperBound = objVal;
      incumbent = new Map(localResult.point);
    }
  }

  while (queue.length > 0 && nodesExplored < maxNodes) {
    queue.sort((a, b) => a.lowerBound - b.lowerBound);
    const node = queue.shift()!;
    nodesExplored++;

    if (node.lowerBound >= upperBound - absTol) continue;

    const mid = boxMidpoint(node.box, variables);
    const mcResult = evaluateTapeMcCormick(objectiveTape.ops, node.box, mid);
    const mcLB = mcResult[objectiveTape.outputIndex]?.cv ?? node.lowerBound;
    const tighterLB = Math.max(node.lowerBound, mcLB);

    if (tighterLB >= upperBound - absTol) continue;

    const local = localNewtonSolve(objectiveTape, constraintTapes, variables, mid, maxNewtonIter);
    if (local !== null && isBoxFeasible(local.point, node.box)) {
      const objVal = evaluateObjective(objectiveTape, local.point);
      if (objVal < upperBound) {
        upperBound = objVal;
        incumbent = new Map(local.point);
      }
    }

    globalLowerBound = queue.length > 0 ? Math.min(tighterLB, queue[0]?.lowerBound ?? Infinity) : tighterLB;
    const gap = upperBound - globalLowerBound;
    if (gap <= absTol || (upperBound !== 0 && gap / Math.abs(upperBound) <= relTol)) {
      break;
    }

    const splitVar = findWidestDimension(node.box, variables);
    if (!splitVar) continue;

    const splitInterval = node.box.get(splitVar);
    if (!splitInterval || splitInterval.width < 1e-12) continue;

    const splitMid = splitInterval.mid;

    // Left child: [lo, mid]
    const leftBox: DomainBox = new Map(node.box);
    leftBox.set(splitVar, new Interval(splitInterval.lo, splitMid));
    const leftLB = Math.max(tighterLB, evaluateIntervalLB(objectiveTape, leftBox));
    if (leftLB < upperBound - absTol) {
      queue.push({ box: leftBox, lowerBound: leftLB });
    }

    // Right child: [mid, hi]
    const rightBox: DomainBox = new Map(node.box);
    rightBox.set(splitVar, new Interval(splitMid, splitInterval.hi));
    const rightLB = Math.max(tighterLB, evaluateIntervalLB(objectiveTape, rightBox));
    if (rightLB < upperBound - absTol) {
      queue.push({ box: rightBox, lowerBound: rightLB });
    }
  }

  if (queue.length === 0 && Number.isFinite(upperBound)) {
    globalLowerBound = upperBound;
  }

  const gap = upperBound - globalLowerBound;
  const optimal = queue.length === 0 || gap <= absTol || (upperBound !== 0 && gap / Math.abs(upperBound) <= relTol);

  return {
    solution: incumbent ?? boxMidpoint(initialBox, variables),
    objectiveValue: upperBound,
    lowerBound: globalLowerBound,
    nodesExplored,
    optimal,
  };
}

function evaluateIntervalLB(tape: { ops: StaticTapeBuilder; outputIndex: number }, box: DomainBox): number {
  const intervals = evaluateTapeInterval(tape.ops, box);
  return intervals[tape.outputIndex]?.lo ?? -Infinity;
}

function evaluateObjective(tape: { ops: StaticTapeBuilder; outputIndex: number }, point: Map<string, number>): number {
  const t = evaluateTapeForward(tape.ops, point);
  return t[tape.outputIndex] ?? Infinity;
}

function boxMidpoint(box: DomainBox, variables: string[]): Map<string, number> {
  const mid = new Map<string, number>();
  for (const v of variables) {
    const interval = box.get(v);
    if (interval) {
      mid.set(v, interval.mid);
    }
  }
  for (const [k, v] of box) {
    if (!mid.has(k)) {
      mid.set(k, v.mid);
    }
  }
  return mid;
}

function isBoxFeasible(point: Map<string, number>, box: DomainBox): boolean {
  for (const [name, interval] of box) {
    const val = point.get(name);
    if (val !== undefined && (val < interval.lo - 1e-10 || val > interval.hi + 1e-10)) {
      return false;
    }
  }
  return true;
}

function findWidestDimension(box: DomainBox, variables: string[]): string | null {
  let widest: string | null = null;
  let maxWidth = 0;
  for (const v of variables) {
    const interval = box.get(v);
    if (interval && interval.width > maxWidth) {
      maxWidth = interval.width;
      widest = v;
    }
  }
  return widest;
}

function localNewtonSolve(
  objectiveTape: { ops: StaticTapeBuilder; outputIndex: number },
  constraintTapes: { ops: StaticTapeBuilder; outputIndex: number }[],
  variables: string[],
  startPoint: Map<string, number>,
  maxIter: number,
): { point: Map<string, number> } | null {
  const n = variables.length;
  const nConstraints = constraintTapes.length;
  const point = new Map(startPoint);

  if (nConstraints === 0) {
    for (let iter = 0; iter < maxIter; iter++) {
      const t = evaluateTapeForward(objectiveTape.ops, point);
      const grads = evaluateTapeReverse(objectiveTape.ops, t, objectiveTape.outputIndex);

      let gradNorm = 0;
      for (const v of variables) {
        const g = grads.get(v) ?? 0;
        gradNorm += g * g;
      }
      if (Math.sqrt(gradNorm) < 1e-10) return { point };

      const stepSize = 0.01;
      for (const v of variables) {
        const g = grads.get(v) ?? 0;
        point.set(v, (point.get(v) ?? 0) - stepSize * g);
      }
    }
  } else {
    for (let iter = 0; iter < maxIter; iter++) {
      let totalResidual = 0;
      const R = new Array(nConstraints).fill(0) as number[];
      const J: number[][] = [];
      for (let i = 0; i < nConstraints; i++) {
        J[i] = new Array(n).fill(0) as number[];
      }

      for (let row = 0; row < nConstraints; row++) {
        const ct = constraintTapes[row];
        if (!ct) continue;
        const t = evaluateTapeForward(ct.ops, point);
        R[row] = t[ct.outputIndex] ?? 0;
        totalResidual += Math.abs(R[row] ?? 0);

        const grads = evaluateTapeReverse(ct.ops, t, ct.outputIndex);
        const jRow = J[row];
        if (!jRow) continue;
        for (let col = 0; col < n; col++) {
          const vn = variables[col];
          if (vn) jRow[col] = grads.get(vn) ?? 0;
        }
      }

      if (totalResidual < 1e-10) return { point };

      if (nConstraints === n) {
        const negR = R.map((r) => -(r ?? 0));
        const dz = solveLULocal(J, negR, n);
        for (let i = 0; i < n; i++) {
          const vn = variables[i];
          if (vn) point.set(vn, (point.get(vn) ?? 0) + (dz[i] ?? 0));
        }
      }
    }
  }

  return { point };
}

function solveLULocal(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k]?.[k] ?? 0);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i]?.[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }
    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow] ?? [], M[k] ?? []];
      [rhs[k], rhs[maxRow]] = [rhs[maxRow] ?? 0, rhs[k] ?? 0];
    }
    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;
    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      for (let j = k + 1; j < n; j++) {
        row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      }
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) {
        sum -= (row[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}

/**
 * Build tape data from a DAE for use with the sBB solver.
 */
export function buildSbbFromDAE(
  dae: DAEBuilder,
  objectiveExprId: number,
  constraintExprIds: number[],
): {
  objectiveTape: { ops: StaticTapeBuilder; outputIndex: number };
  constraintTapes: { ops: StaticTapeBuilder; outputIndex: number }[];
} {
  const objTape = new StaticTapeBuilder();
  const objIdx = objTape.addExpression(objectiveExprId, dae);

  const constraintTapes = constraintExprIds.map((exprId) => {
    const tape = new StaticTapeBuilder();
    const idx = tape.addExpression(exprId, dae);
    return { ops: tape, outputIndex: idx };
  });

  return {
    objectiveTape: { ops: objTape, outputIndex: objIdx },
    constraintTapes,
  };
}

/**
 * Expand array variable bounds in a DomainBox.
 */
export function expandArrayBounds(box: DomainBox, dae: DAEBuilder): DomainBox {
  const expanded: DomainBox = new Map();
  for (const [name, interval] of box) {
    const vIdx = dae.getVarIdxByName(name);
    if (vIdx >= 0) {
      const dims = dae.getVarShape(vIdx);
      if (dims && dims.length > 0) {
        const size = dims.reduce((a: number, b: number) => a * b, 1);
        for (let i = 0; i < size; i++) {
          expanded.set(`${name}[${i + 1}]`, new Interval(interval.lo, interval.hi));
        }
        continue;
      }
    }
    expanded.set(name, interval);
  }
  return expanded;
}
