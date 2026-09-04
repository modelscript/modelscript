/* eslint-disable */
// @ts-nocheck
import { AdTape } from "./tape";
import { McCormickTuple, tape_evaluateMcCormick } from "./mccormick";
import { tape_evaluateInterval } from "./interval";

/**
 * Result of WASM Spatial Branch & Bound Global Optimization.
 */
export class BnBResult {
  optimumValue: f64;
  iterations: u32;
  converged: bool;

  constructor(optimumValue: f64 = 0.0, iterations: u32 = 0, converged: bool = false) {
    this.optimumValue = optimumValue;
    this.iterations = iterations;
    this.converged = converged;
  }
}

class SpatialBox {
  lo: StaticArray<f64>;
  hi: StaticArray<f64>;
  lowerBound: f64;

  constructor(nVars: u32) {
    this.lo = new StaticArray<f64>(nVars);
    this.hi = new StaticArray<f64>(nVars);
    this.lowerBound = f64.NEGATIVE_INFINITY;
  }

  clone(nVars: u32): SpatialBox {
    let copy = new SpatialBox(nVars);
    for (let i: u32 = 0; i < nVars; i++) {
      copy.lo[i] = this.lo[i];
      copy.hi[i] = this.hi[i];
    }
    copy.lowerBound = this.lowerBound;
    return copy;
  }
}

/**
 * Solves a global optimization problem via Spatial Branch-and-Bound on AdTape.
 * min f(x) subject to lo_i <= x_i <= hi_i
 */
export function bnb_solveGlobalMin(
  tape: AdTape,
  targetTapeNode: u32,
  nVars: u32,
  initBoundsLoPtr: usize,
  initBoundsHiPtr: usize,
  outBestSolutionPtr: usize,
  maxIterations: u32 = 500,
  tol: f64 = 1e-4,
): BnBResult {
  let nodeCount = tape.nodeCount;
  let strideBytes = nodeCount << 3;

  // Allocate scratch buffers in WASM memory for tape passes
  let varVals = new StaticArray<f64>(nVars);
  let varLo = new StaticArray<f64>(nVars);
  let varHi = new StaticArray<f64>(nVars);

  let cvBuf = new StaticArray<f64>(nodeCount);
  let ccBuf = new StaticArray<f64>(nodeCount);
  let loBuf = new StaticArray<f64>(nodeCount);
  let hiBuf = new StaticArray<f64>(nodeCount);

  let cvPtr = changetype<usize>(cvBuf);
  let ccPtr = changetype<usize>(ccBuf);
  let loPtr = changetype<usize>(loBuf);
  let hiPtr = changetype<usize>(hiBuf);

  let rootBox = new SpatialBox(nVars);
  for (let i: u32 = 0; i < nVars; i++) {
    rootBox.lo[i] = load<f64>(initBoundsLoPtr + (i << 3));
    rootBox.hi[i] = load<f64>(initBoundsHiPtr + (i << 3));
    varVals[i] = 0.5 * (rootBox.lo[i] + rootBox.hi[i]);
  }

  // Initial McCormick pass
  tape_evaluateMcCormick(
    tape,
    changetype<usize>(varVals),
    changetype<usize>(rootBox.lo),
    changetype<usize>(rootBox.hi),
    cvPtr,
    ccPtr,
    loPtr,
    hiPtr,
  );

  rootBox.lowerBound = load<f64>(cvPtr + (targetTapeNode << 3));
  let bestUB = load<f64>(ccPtr + (targetTapeNode << 3));

  for (let i: u32 = 0; i < nVars; i++) {
    store<f64>(outBestSolutionPtr + (i << 3), varVals[i]);
  }

  let queue = new Array<SpatialBox>();
  queue.push(rootBox);

  let iter: u32 = 0;
  let converged = false;

  while (queue.length > 0 && iter < maxIterations) {
    iter++;

    // Pick box with lowest lower bound
    let bestIdx = 0;
    let minLB = queue[0].lowerBound;
    for (let j = 1; j < queue.length; j++) {
      if (queue[j].lowerBound < minLB) {
        minLB = queue[j].lowerBound;
        bestIdx = j;
      }
    }

    let currentBox = queue[bestIdx];
    queue.splice(bestIdx, 1);

    if (bestUB - currentBox.lowerBound <= tol) {
      converged = true;
      break;
    }

    // Branching variable selection: choose variable with widest relative interval
    let branchVar: u32 = 0;
    let maxW: f64 = -1.0;
    for (let i: u32 = 0; i < nVars; i++) {
      let w = currentBox.hi[i] - currentBox.lo[i];
      if (w > maxW) {
        maxW = w;
        branchVar = i;
      }
    }

    let mid = 0.5 * (currentBox.lo[branchVar] + currentBox.hi[branchVar]);

    // Box 1: [lo, mid]
    let box1 = currentBox.clone(nVars);
    box1.hi[branchVar] = mid;

    // Box 2: [mid, hi]
    let box2 = currentBox.clone(nVars);
    box2.lo[branchVar] = mid;

    // Evaluate Box 1
    for (let i: u32 = 0; i < nVars; i++) {
      varVals[i] = 0.5 * (box1.lo[i] + box1.hi[i]);
    }
    tape_evaluateMcCormick(
      tape,
      changetype<usize>(varVals),
      changetype<usize>(box1.lo),
      changetype<usize>(box1.hi),
      cvPtr,
      ccPtr,
      loPtr,
      hiPtr,
    );
    box1.lowerBound = load<f64>(cvPtr + (targetTapeNode << 3));
    let ub1 = load<f64>(ccPtr + (targetTapeNode << 3));
    if (ub1 < bestUB) {
      bestUB = ub1;
      for (let i: u32 = 0; i < nVars; i++) {
        store<f64>(outBestSolutionPtr + (i << 3), varVals[i]);
      }
    }
    if (box1.lowerBound <= bestUB) {
      queue.push(box1);
    }

    // Evaluate Box 2
    for (let i: u32 = 0; i < nVars; i++) {
      varVals[i] = 0.5 * (box2.lo[i] + box2.hi[i]);
    }
    tape_evaluateMcCormick(
      tape,
      changetype<usize>(varVals),
      changetype<usize>(box2.lo),
      changetype<usize>(box2.hi),
      cvPtr,
      ccPtr,
      loPtr,
      hiPtr,
    );
    box2.lowerBound = load<f64>(cvPtr + (targetTapeNode << 3));
    let ub2 = load<f64>(ccPtr + (targetTapeNode << 3));
    if (ub2 < bestUB) {
      bestUB = ub2;
      for (let i: u32 = 0; i < nVars; i++) {
        store<f64>(outBestSolutionPtr + (i << 3), varVals[i]);
      }
    }
    if (box2.lowerBound <= bestUB) {
      queue.push(box2);
    }
  }

  return new BnBResult(bestUB, iter, converged);
}
