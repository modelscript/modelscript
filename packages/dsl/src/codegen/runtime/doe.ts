/* eslint-disable */
// SPDX-License-Identifier: AGPL-3.0-or-later

import { atomicChunkAlloc } from "./arena";
import { SobolSequence, Xoshiro256pp } from "./monte_carlo";

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
      let levels = load<u32>(rangesPtr + d * 24 + 16);
      if (levels == 0) levels = 5;
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
  let totalSamples: u32 = 1;

  for (let d: u32 = 0; d < nInputs; d++) {
    let levels = load<u32>(rangesPtr + d * 24 + 16);
    if (levels == 0) levels = 5;
    store<u32>(levelCountsPtr + d * 4, levels);
    totalSamples *= levels;
  }

  for (let s: u32 = 0; s < totalSamples; s++) {
    let idx = s;
    for (let d: i32 = (nInputs as i32) - 1; d >= 0; d--) {
      let nL = load<u32>(levelCountsPtr + (d as u32) * 4);
      let levelIdx = idx % nL;
      idx = idx / nL;

      let minVal = load<f64>(rangesPtr + (d as u32) * 24);
      let maxVal = load<f64>(rangesPtr + (d as u32) * 24 + 8);
      let val: f64;
      if (nL == 1) {
        val = (minVal + maxVal) / 2.0;
      } else {
        val = minVal + ((levelIdx as f64) / ((nL - 1) as f64)) * (maxVal - minVal);
      }
      store<f64>(outSamplesPtr + (s * nInputs + (d as u32)) * 8, val);
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

  for (let d: u32 = 0; d < nInputs; d++) {
    let minVal = load<f64>(rangesPtr + d * 24);
    let maxVal = load<f64>(rangesPtr + d * 24 + 8);
    let span = maxVal - minVal;

    for (let i: u32 = 0; i < numSamples; i++) {
      let u = ((i as f64) + rng.random()) / (numSamples as f64);
      store<f64>(strataPtr + i * 8, u);
    }

    for (let i: i32 = (numSamples as i32) - 1; i > 0; i--) {
      let randVal = rng.random();
      let k: i32 = (randVal * ((i + 1) as f64)) as i32;
      if (k > i) k = i;
      let iOffset: usize = (i as usize) * 8;
      let kOffset: usize = (k as usize) * 8;
      let tmp = load<f64>(strataPtr + iOffset);
      store<f64>(strataPtr + iOffset, load<f64>(strataPtr + kOffset));
      store<f64>(strataPtr + kOffset, tmp);
    }

    for (let s: u32 = 0; s < numSamples; s++) {
      let u = load<f64>(strataPtr + (s as usize) * 8);
      let val = minVal + u * span;
      store<f64>(outSamplesPtr + ((s * nInputs + d) as usize) * 8, val);
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
  sobol.next(rawPointPtr);

  for (let s: u32 = 0; s < numSamples; s++) {
    sobol.next(rawPointPtr);
    for (let d: u32 = 0; d < nInputs; d++) {
      let minVal = load<f64>(rangesPtr + d * 24);
      let maxVal = load<f64>(rangesPtr + d * 24 + 8);
      let u = load<f64>(rawPointPtr + d * 8);
      let val = minVal + u * (maxVal - minVal);
      store<f64>(outSamplesPtr + (s * nInputs + d) * 8, val);
    }
  }

  return numSamples;
}

function generateCentralComposite(rangesPtr: usize, nInputs: u32, outSamplesPtr: usize): u32 {
  let k = nInputs;
  let alpha: f64 = Math.pow(2.0, (k as f64) / 4.0);

  let centersPtr = atomicChunkAlloc(k * 8);
  let halfRangesPtr = atomicChunkAlloc(k * 8);

  for (let d: u32 = 0; d < k; d++) {
    let minVal = load<f64>(rangesPtr + d * 24);
    let maxVal = load<f64>(rangesPtr + d * 24 + 8);
    store<f64>(centersPtr + d * 8, (minVal + maxVal) / 2.0);
    store<f64>(halfRangesPtr + d * 8, (maxVal - minVal) / 2.0);
  }

  let sampleIdx: u32 = 0;

  // 1. Factorial Corners (2^k)
  let nFactorial: u32 = 1 << k;
  for (let i: u32 = 0; i < nFactorial; i++) {
    for (let d: u32 = 0; d < k; d++) {
      let coded: f64 = ((i >> d) & 1) != 0 ? 1.0 : -1.0;
      let center = load<f64>(centersPtr + d * 8);
      let half = load<f64>(halfRangesPtr + d * 8);
      store<f64>(outSamplesPtr + (sampleIdx * k + d) * 8, center + coded * half);
    }
    sampleIdx++;
  }

  // 2. Axial (Star) Points at ±alpha
  for (let axis: u32 = 0; axis < k; axis++) {
    for (let d: u32 = 0; d < k; d++) {
      let center = load<f64>(centersPtr + d * 8);
      let half = load<f64>(halfRangesPtr + d * 8);
      let minVal = load<f64>(rangesPtr + d * 24);
      let maxVal = load<f64>(rangesPtr + d * 24 + 8);
      let val = center;
      if (d == axis) {
        val = center + alpha * half;
        if (val > maxVal) val = maxVal;
      }
      store<f64>(outSamplesPtr + (sampleIdx * k + d) * 8, val);
    }
    sampleIdx++;

    for (let d: u32 = 0; d < k; d++) {
      let center = load<f64>(centersPtr + d * 8);
      let half = load<f64>(halfRangesPtr + d * 8);
      let minVal = load<f64>(rangesPtr + d * 24);
      let maxVal = load<f64>(rangesPtr + d * 24 + 8);
      let val = center;
      if (d == axis) {
        val = center - alpha * half;
        if (val < minVal) val = minVal;
      }
      store<f64>(outSamplesPtr + (sampleIdx * k + d) * 8, val);
    }
    sampleIdx++;
  }

  // 3. Center Point
  for (let d: u32 = 0; d < k; d++) {
    let center = load<f64>(centersPtr + d * 8);
    store<f64>(outSamplesPtr + (sampleIdx * k + d) * 8, center);
  }
  sampleIdx++;

  return sampleIdx;
}
