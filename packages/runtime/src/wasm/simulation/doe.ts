// SPDX-License-Identifier: AGPL-3.0-or-later

import { atomicChunkAlloc } from "../arena";
import { SobolSequence, Xoshiro256pp } from "./monte_carlo";
import { DenseMatrixView, UnmanagedFloat64Array, UnmanagedUint32Array } from "../core/array";

/**
 * Range specification for an input parameter:
 * min: f64 (offset 0)
 * max: f64 (offset 8)
 * levels: u32 (offset 16)
 * padding: u32 (offset 20) -> total 24 bytes per input range
 */
@unmanaged
export class DoEInputRange {
  min: f64;
  max: f64;
  levels: u32;

  @inline static at(rangesPtr: usize, index: u32): DoEInputRange {
    return changetype<DoEInputRange>(rangesPtr + (index as usize) * 24);
  }
}

export const STRATEGY_FULL_FACTORIAL: u32 = 0;
export const STRATEGY_LATIN_HYPERCUBE: u32 = 1;
export const STRATEGY_SOBOL: u32 = 2;
export const STRATEGY_CENTRAL_COMPOSITE: u32 = 3;

/**
 * Calculate total number of samples for a given strategy and input ranges.
 */
export function doe_calculateTotalSamples(
  strategy: u32,
  rangesPtr: usize,
  nInputs: u32,
  numSamples: u32,
): u32 {
  if (nInputs == 0) return 0;

  if (strategy == STRATEGY_FULL_FACTORIAL) {
    let total: u32 = 1;
    for (let d: u32 = 0; d < nInputs; d++) {
      let range = DoEInputRange.at(rangesPtr, d);
      let levels = range.levels == 0 ? 5 : range.levels;
      total *= levels;
    }
    return total;
  }

  if (strategy == STRATEGY_CENTRAL_COMPOSITE) {
    let nFactorial: u32 = 1 << nInputs;
    let nAxial: u32 = 2 * nInputs;
    let nCenter: u32 = 1;
    return nFactorial + nAxial + nCenter;
  }

  // Latin Hypercube & Sobol use requested numSamples
  return numSamples > 0 ? numSamples : 50;
}

/**
 * Generate Design of Experiments sample points into linear memory.
 * Output format: contiguous matrix of f64 [totalSamples * nInputs].
 * Returns the total number of samples generated.
 */
export function doe_generateSamples(
  strategy: u32,
  rangesPtr: usize,
  nInputs: u32,
  numSamples: u32,
  seed: u64,
  outSamplesPtr: usize,
): u32 {
  if (nInputs == 0 || rangesPtr == 0 || outSamplesPtr == 0) return 0;

  if (strategy == STRATEGY_FULL_FACTORIAL) {
    return generateFullFactorial(rangesPtr, nInputs, outSamplesPtr);
  } else if (strategy == STRATEGY_LATIN_HYPERCUBE) {
    return generateLatinHypercube(rangesPtr, nInputs, numSamples > 0 ? numSamples : 50, seed, outSamplesPtr);
  } else if (strategy == STRATEGY_SOBOL) {
    return generateSobol(rangesPtr, nInputs, numSamples > 0 ? numSamples : 50, outSamplesPtr);
  } else if (strategy == STRATEGY_CENTRAL_COMPOSITE) {
    return generateCentralComposite(rangesPtr, nInputs, outSamplesPtr);
  }
  return 0;
}

function generateFullFactorial(rangesPtr: usize, nInputs: u32, outSamplesPtr: usize): u32 {
  let levelCountsPtr = atomicChunkAlloc(nInputs * 4);
  let levelCounts = changetype<UnmanagedUint32Array>(levelCountsPtr);
  let totalSamples: u32 = 1;

  for (let d: u32 = 0; d < nInputs; d++) {
    let range = DoEInputRange.at(rangesPtr, d);
    let levels = range.levels == 0 ? 5 : range.levels;
    levelCounts[d] = levels;
    totalSamples *= levels;
  }

  let outSamples = DenseMatrixView.at(outSamplesPtr, totalSamples, nInputs);

  for (let s: u32 = 0; s < totalSamples; s++) {
    let idx = s;
    for (let d: i32 = (nInputs as i32) - 1; d >= 0; d--) {
      let nL = levelCounts[d as u32];
      let levelIdx = idx % nL;
      idx = idx / nL;

      let range = DoEInputRange.at(rangesPtr, d as u32);
      let minVal = range.min;
      let maxVal = range.max;
      let val: f64;
      if (nL == 1) {
        val = (minVal + maxVal) / 2.0;
      } else {
        val = minVal + ((levelIdx as f64) / ((nL - 1) as f64)) * (maxVal - minVal);
      }
      outSamples.set(s, d as u32, val);
    }
  }

  return totalSamples;
}

function generateLatinHypercube(
  rangesPtr: usize,
  nInputs: u32,
  numSamples: u32,
  seed: u64,
  outSamplesPtr: usize,
): u32 {
  let rng = changetype<Xoshiro256pp>(atomicChunkAlloc(64));
  rng.init(seed == 0 ? 0x123456789abcdef0 : seed);

  let strataPtr = atomicChunkAlloc(numSamples * 8);
  let strata = changetype<UnmanagedFloat64Array>(strataPtr);
  let outSamples = DenseMatrixView.at(outSamplesPtr, numSamples, nInputs);

  for (let d: u32 = 0; d < nInputs; d++) {
    let range = DoEInputRange.at(rangesPtr, d);
    let minVal = range.min;
    let maxVal = range.max;
    let span = maxVal - minVal;

    for (let i: u32 = 0; i < numSamples; i++) {
      let u = ((i as f64) + rng.random()) / (numSamples as f64);
      strata[i] = u;
    }

    for (let i: i32 = (numSamples as i32) - 1; i > 0; i--) {
      let randVal = rng.random();
      let k: i32 = (randVal * ((i + 1) as f64)) as i32;
      if (k > i) k = i;
      let tmp = strata[i as u32];
      strata[i as u32] = strata[k as u32];
      strata[k as u32] = tmp;
    }

    for (let s: u32 = 0; s < numSamples; s++) {
      let u = strata[s];
      outSamples.set(s, d, minVal + u * span);
    }
  }

  return numSamples;
}

function generateSobol(
  rangesPtr: usize,
  nInputs: u32,
  numSamples: u32,
  outSamplesPtr: usize,
): u32 {
  let sobol = changetype<SobolSequence>(atomicChunkAlloc(64));
  sobol.init(nInputs);

  let rawPointPtr = atomicChunkAlloc(nInputs * 8);
  let rawPoint = changetype<UnmanagedFloat64Array>(rawPointPtr);
  let outSamples = DenseMatrixView.at(outSamplesPtr, numSamples, nInputs);
  sobol.next(rawPointPtr);

  for (let s: u32 = 0; s < numSamples; s++) {
    sobol.next(rawPointPtr);
    for (let d: u32 = 0; d < nInputs; d++) {
      let range = DoEInputRange.at(rangesPtr, d);
      let u = rawPoint[d];
      let val = range.min + u * (range.max - range.min);
      outSamples.set(s, d, val);
    }
  }

  return numSamples;
}

function generateCentralComposite(rangesPtr: usize, nInputs: u32, outSamplesPtr: usize): u32 {
  let k = nInputs;
  let alpha: f64 = Math.pow(2.0, (k as f64) / 4.0);

  let centersPtr = atomicChunkAlloc(k * 8);
  let halfRangesPtr = atomicChunkAlloc(k * 8);
  let centers = changetype<UnmanagedFloat64Array>(centersPtr);
  let halfRanges = changetype<UnmanagedFloat64Array>(halfRangesPtr);

  for (let d: u32 = 0; d < k; d++) {
    let range = DoEInputRange.at(rangesPtr, d);
    centers[d] = (range.min + range.max) / 2.0;
    halfRanges[d] = (range.max - range.min) / 2.0;
  }

  let totalSamples = (1 << k) + 2 * k + 1;
  let outSamples = DenseMatrixView.at(outSamplesPtr, totalSamples, k);
  let sampleIdx: u32 = 0;

  // 1. Factorial Corners (2^k)
  let nFactorial: u32 = 1 << k;
  for (let i: u32 = 0; i < nFactorial; i++) {
    for (let d: u32 = 0; d < k; d++) {
      let coded: f64 = ((i >> d) & 1) != 0 ? 1.0 : -1.0;
      let center = centers[d];
      let half = halfRanges[d];
      outSamples.set(sampleIdx, d, center + coded * half);
    }
    sampleIdx++;
  }

  // 2. Axial (Star) Points at ±alpha
  for (let axis: u32 = 0; axis < k; axis++) {
    for (let d: u32 = 0; d < k; d++) {
      let center = centers[d];
      let half = halfRanges[d];
      let range = DoEInputRange.at(rangesPtr, d);
      let val = center;
      if (d == axis) {
        val = center + alpha * half;
        if (val > range.max) val = range.max;
      }
      outSamples.set(sampleIdx, d, val);
    }
    sampleIdx++;

    for (let d: u32 = 0; d < k; d++) {
      let center = centers[d];
      let half = halfRanges[d];
      let range = DoEInputRange.at(rangesPtr, d);
      let val = center;
      if (d == axis) {
        val = center - alpha * half;
        if (val < range.min) val = range.min;
      }
      outSamples.set(sampleIdx, d, val);
    }
    sampleIdx++;
  }

  // 3. Center Point
  for (let d: u32 = 0; d < k; d++) {
    outSamples.set(sampleIdx, d, centers[d]);
  }
  sampleIdx++;

  return sampleIdx;
}
