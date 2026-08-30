// SPDX-License-Identifier: AGPL-3.0-or-later

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

    // Allocate temp scratch space
    const bytesNeeded = (nVars * 2 + nodeCount * 2) * 8;
    const scratchPtr = 1024; // Use safe linear scratch space or offset

    const varLoOffset = scratchPtr >> 3;
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
   * Evaluates forward McCormick relaxations for all tape nodes.
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
}
