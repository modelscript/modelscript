// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Set-Based Graph (SBG) Strided Integer Interval Core Kernels.
 * Implements O(log(step)) extended-GCD diophantine intersection and batch
 * Multi-Dimensional Interval (MDI) intersection in WASM linear memory.
 */

@inline
function i64Abs(x: i64): i64 {
  return x < 0 ? -x : x;
}

@inline
function floorDiv(a: i64, b: i64): i64 {
  const q = a / b;
  const r = a % b;
  return (r != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
}

@inline
function ceilDiv(a: i64, b: i64): i64 {
  const q = a / b;
  const r = a % b;
  return (r != 0 && ((a > 0) == (b > 0))) ? q + 1 : q;
}

/**
 * Intersects two 1D strided intervals [lo1, step1, hi1] and [lo2, step2, hi2].
 * Writes resulting [lo, step, hi] to `outPtr` (3 x i32) and returns 1 if non-empty, 0 if empty.
 */
export function sbg_intervalIntersect(
  lo1: i32,
  step1: i32,
  hi1: i32,
  lo2: i32,
  step2: i32,
  hi2: i32,
  outPtr: usize,
): i32 {
  if (lo1 > hi1 || lo2 > hi2 || step1 <= 0 || step2 <= 0) return 0;

  // Extended Euclidean algorithm: g = s1*x + s2*y
  let oldR: i64 = <i64>step1;
  let r: i64 = <i64>step2;
  let oldS: i64 = 1;
  let s: i64 = 0;
  while (r != 0) {
    const q = oldR / r;
    const tmpR = r;
    r = oldR - q * r;
    oldR = tmpR;
    const tmpS = s;
    s = oldS - q * s;
    oldS = tmpS;
  }

  const g = oldR;
  const diff: i64 = <i64>lo2 - <i64>lo1;
  if (diff % g != 0) return 0;

  const lcmStep: i64 = (<i64>step1 / g) * <i64>step2;
  const k0: i64 = (diff / g) * oldS;
  let firstVal: i64 = <i64>lo1 + <i64>step1 * k0;

  const minBound: i64 = lo1 > lo2 ? <i64>lo1 : <i64>lo2;
  const maxBound: i64 = hi1 < hi2 ? <i64>hi1 : <i64>hi2;
  if (minBound > maxBound) return 0;

  // Shift firstVal into [minBound, minBound + lcmStep - 1]
  const shift = ceilDiv(minBound - firstVal, lcmStep);
  const resLo = firstVal + shift * lcmStep;
  if (resLo > maxBound) return 0;

  const countSteps = floorDiv(maxBound - resLo, lcmStep);
  const resHi = resLo + countSteps * lcmStep;

  store<i32>(outPtr, <i32>resLo);
  store<i32>(outPtr + 4, <i32>lcmStep);
  store<i32>(outPtr + 8, <i32>resHi);
  return 1;
}

/**
 * Batch-intersects two d-dimensional Multi-Intervals (each stored as d x [lo, step, hi] i32 triples).
 * Writes resulting d triples to `outPtr`. Returns 1 if non-empty, 0 if empty in any dimension.
 */
export function sbg_mdiIntersect(
  aPtr: usize,
  bPtr: usize,
  dims: i32,
  outPtr: usize,
): i32 {
  for (let d: i32 = 0; d < dims; d++) {
    const off = <usize>(d * 12);
    const ok = sbg_intervalIntersect(
      load<i32>(aPtr + off),
      load<i32>(aPtr + off + 4),
      load<i32>(aPtr + off + 8),
      load<i32>(bPtr + off),
      load<i32>(bPtr + off + 4),
      load<i32>(bPtr + off + 8),
      outPtr + off,
    );
    if (ok == 0) return 0;
  }
  return 1;
}

/**
 * Computes all-pairs intersections of two sets of d-dimensional MDIs (`countA` and `countB`).
 * Each MDI is stored as `dims` consecutive `[lo, step, hi]` i32 triples (`dims * 12` bytes).
 * Writes non-empty intersection MDIs into `outPtr` (up to `maxOut` MDIs).
 * Returns the number of output MDIs, or -1 if `maxOut` would be exceeded.
 */
export function sbg_setCap(
  aPtr: usize,
  countA: i32,
  bPtr: usize,
  countB: i32,
  dims: i32,
  outPtr: usize,
  maxOut: i32,
): i32 {
  if (countA <= 0 || countB <= 0 || dims <= 0) return 0;
  const stride = <usize>(dims * 12);
  let outCount: i32 = 0;

  for (let i: i32 = 0; i < countA; i++) {
    const aiPtr = aPtr + <usize>i * stride;
    for (let j: i32 = 0; j < countB; j++) {
      if (outCount >= maxOut) return -1;
      const bjPtr = bPtr + <usize>j * stride;
      const dstPtr = outPtr + <usize>outCount * stride;
      const ok = sbg_mdiIntersect(aiPtr, bjPtr, dims, dstPtr);
      if (ok != 0) {
        outCount++;
      }
    }
  }
  return outCount;
}

@inline
function intervalEquals(lo1: i32, s1: i32, hi1: i32, lo2: i32, s2: i32, hi2: i32): bool {
  if (lo1 == hi1 && lo2 == hi2) return lo1 == lo2;
  return lo1 == lo2 && s1 == s2 && hi1 == hi2;
}

@inline
function intervalCanCompact(lo1: i32, s1: i32, hi1: i32, lo2: i32, s2: i32, hi2: i32): bool {
  const sz1Gt1 = hi1 > lo1;
  const sz2Gt1 = hi2 > lo2;
  if (sz1Gt1 && sz2Gt1 && s1 != s2) return false;
  let s: i64 = sz1Gt1 ? <i64>s1 : sz2Gt1 ? <i64>s2 : i64Abs(<i64>lo2 - <i64>lo1);
  if (s == 0) s = 1;
  if (<i64>hi1 + s == <i64>lo2 && (!sz1Gt1 || <i64>s1 == s) && (!sz2Gt1 || <i64>s2 == s)) {
    return true;
  }
  if (<i64>hi2 + s == <i64>lo1 && (!sz1Gt1 || <i64>s1 == s) && (!sz2Gt1 || <i64>s2 == s)) {
    return true;
  }
  return false;
}

/**
 * Checks if two d-dimensional MDIs can be compacted:
 * returns -2 if incompatible, -1 if equal on all dims, or `diffDim >= 0` if compactable on `diffDim`.
 */
@inline
function mdiCanCompact(aPtr: usize, bPtr: usize, dims: i32): i32 {
  let diffDim: i32 = -1;
  for (let d: i32 = 0; d < dims; d++) {
    const off = <usize>(d * 12);
    const lo1 = load<i32>(aPtr + off);
    const s1 = load<i32>(aPtr + off + 4);
    const hi1 = load<i32>(aPtr + off + 8);
    const lo2 = load<i32>(bPtr + off);
    const s2 = load<i32>(bPtr + off + 4);
    const hi2 = load<i32>(bPtr + off + 8);
    if (!intervalEquals(lo1, s1, hi1, lo2, s2, hi2)) {
      if (diffDim != -1) return -2;
      diffDim = d;
    }
  }
  if (diffDim == -1) return -1;
  const dOff = <usize>(diffDim * 12);
  const ok = intervalCanCompact(
    load<i32>(aPtr + dOff),
    load<i32>(aPtr + dOff + 4),
    load<i32>(aPtr + dOff + 8),
    load<i32>(bPtr + dOff),
    load<i32>(bPtr + dOff + 4),
    load<i32>(bPtr + dOff + 8),
  );
  return ok ? diffDim : -2;
}

@inline
function compareMdiMinLex(aPtr: usize, bPtr: usize, dims: i32): i32 {
  for (let d: i32 = 0; d < dims; d++) {
    const off = <usize>(d * 12);
    const la = load<i32>(aPtr + off);
    const lb = load<i32>(bPtr + off);
    if (la != lb) return la < lb ? -1 : 1;
  }
  return 0;
}

@inline
function swapMdis(aPtr: usize, bPtr: usize, i32Count: i32): void {
  for (let k: i32 = 0; k < i32Count; k++) {
    const off = <usize>(k << 2);
    const tmp = load<i32>(aPtr + off);
    store<i32>(aPtr + off, load<i32>(bPtr + off));
    store<i32>(bPtr + off, tmp);
  }
}

/**
 * In-place pairwise compaction and lexicographic minElem sort of `count` non-empty
 * d-dimensional MDIs stored at `mdisPtr` (`count * dims * 3` i32s).
 * Returns the compacted MDI count.
 */
export function sbg_compactMdis(mdisPtr: usize, count: i32, dims: i32): i32 {
  if (count <= 1 || dims <= 0) return count;
  const i32Count = dims * 3;
  const stride = <usize>(i32Count << 2);
  let n: i32 = count;

  let changed = true;
  while (changed && n > 1) {
    changed = false;
    for (let i: i32 = 0; i < n && !changed; i++) {
      const iPtr = mdisPtr + <usize>i * stride;
      for (let j: i32 = i + 1; j < n; j++) {
        const jPtr = mdisPtr + <usize>j * stride;
        const diffDim = mdiCanCompact(iPtr, jPtr, dims);
        if (diffDim != -2) {
          if (diffDim >= 0) {
            const dOff = <usize>(diffDim * 12);
            const lo1 = load<i32>(iPtr + dOff);
            const s1 = load<i32>(iPtr + dOff + 4);
            const hi1 = load<i32>(iPtr + dOff + 8);
            const lo2 = load<i32>(jPtr + dOff);
            const s2 = load<i32>(jPtr + dOff + 4);
            const hi2 = load<i32>(jPtr + dOff + 8);
            const newLo = lo1 < lo2 ? lo1 : lo2;
            const newHi = hi1 > hi2 ? hi1 : hi2;
            let newStep: i64 = hi1 > lo1 ? <i64>s1 : hi2 > lo2 ? <i64>s2 : i64Abs(<i64>lo2 - <i64>lo1);
            if (newStep < 1) newStep = 1;
            const rem = (<i64>newHi - <i64>newLo) % newStep;
            store<i32>(iPtr + dOff, newLo);
            store<i32>(iPtr + dOff + 4, <i32>newStep);
            store<i32>(iPtr + dOff + 8, <i32>(<i64>newHi - rem));
          }
          for (let k: i32 = j + 1; k < n; k++) {
            memory.copy(mdisPtr + <usize>(k - 1) * stride, mdisPtr + <usize>k * stride, stride);
          }
          n--;
          changed = true;
          break;
        }
      }
    }
  }

  // Lexicographic insertion sort by minElem (lo per dimension)
  for (let i: i32 = 1; i < n; i++) {
    let j: i32 = i;
    while (j > 0) {
      const prevPtr = mdisPtr + <usize>(j - 1) * stride;
      const curPtr = mdisPtr + <usize>j * stride;
      if (compareMdiMinLex(prevPtr, curPtr, dims) > 0) {
        swapMdis(prevPtr, curPtr, i32Count);
        j--;
      } else {
        break;
      }
    }
  }

  return n;
}

@inline
function emitDiffBox(
  aPtr: usize,
  interPtr: usize,
  dims: i32,
  d: i32,
  pieceLo: i32,
  pieceStep: i32,
  pieceHiRaw: i32,
  outPtr: usize,
  outCount: i32,
  maxOut: i32,
): i32 {
  if (pieceHiRaw < pieceLo) return outCount;
  if (outCount >= maxOut) return -1;
  const s = pieceStep <= 0 ? 1 : pieceStep;
  const pieceHi = pieceHiRaw - ((pieceHiRaw - pieceLo) % s);
  const stride = <usize>(dims * 12);
  const dstPtr = outPtr + <usize>outCount * stride;

  for (let k: i32 = 0; k < dims; k++) {
    const kOff = <usize>(k * 12);
    if (k < d) {
      store<i32>(dstPtr + kOff, load<i32>(interPtr + kOff));
      store<i32>(dstPtr + kOff + 4, load<i32>(interPtr + kOff + 4));
      store<i32>(dstPtr + kOff + 8, load<i32>(interPtr + kOff + 8));
    } else if (k == d) {
      store<i32>(dstPtr + kOff, pieceLo);
      store<i32>(dstPtr + kOff + 4, s);
      store<i32>(dstPtr + kOff + 8, pieceHi);
    } else {
      store<i32>(dstPtr + kOff, load<i32>(aPtr + kOff));
      store<i32>(dstPtr + kOff + 4, load<i32>(aPtr + kOff + 4));
      store<i32>(dstPtr + kOff + 8, load<i32>(aPtr + kOff + 8));
    }
  }
  return outCount + 1;
}

/**
 * Multi-dimensional set difference `A \ B` decomposed into mutually disjoint MDIs in linear memory.
 * `interScratchPtr` must provide at least `dims * 12` bytes.
 * Returns the number of resulting MDIs written to `outPtr`, or -1 if `maxOut` is exceeded.
 */
export function sbg_mdiDiff(
  aPtr: usize,
  bPtr: usize,
  dims: i32,
  outPtr: usize,
  maxOut: i32,
  interScratchPtr: usize,
): i32 {
  if (dims <= 0) return 0;
  const stride = <usize>(dims * 12);

  const hasInter = sbg_mdiIntersect(aPtr, bPtr, dims, interScratchPtr);
  if (hasInter == 0) {
    if (maxOut < 1) return -1;
    memory.copy(outPtr, aPtr, stride);
    return 1;
  }

  let outCount: i32 = 0;
  for (let d: i32 = 0; d < dims; d++) {
    const dOff = <usize>(d * 12);
    const aLo = load<i32>(aPtr + dOff);
    const aStep = load<i32>(aPtr + dOff + 4);
    const aHi = load<i32>(aPtr + dOff + 8);
    const iLo = load<i32>(interScratchPtr + dOff);
    const iStep = load<i32>(interScratchPtr + dOff + 4);
    const iHi = load<i32>(interScratchPtr + dOff + 8);

    // Elements strictly before inter.lo
    if (aLo < iLo) {
      outCount = emitDiffBox(aPtr, interScratchPtr, dims, d, aLo, aStep, iLo - aStep, outPtr, outCount, maxOut);
      if (outCount < 0) return -1;
    }
    // Elements strictly after inter.hi
    if (aHi > iHi) {
      outCount = emitDiffBox(aPtr, interScratchPtr, dims, d, iHi + aStep, aStep, aHi, outPtr, outCount, maxOut);
      if (outCount < 0) return -1;
    }
    // Interleaved residue classes within [inter.lo, inter.hi] when inter.step > a.step
    if (iStep > aStep) {
      const ratio = iStep / aStep;
      for (let r: i32 = 1; r < ratio; r++) {
        outCount = emitDiffBox(aPtr, interScratchPtr, dims, d, iLo + r * aStep, iStep, iHi, outPtr, outCount, maxOut);
        if (outCount < 0) return -1;
      }
    }
  }

  return outCount;
}

