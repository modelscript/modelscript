// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript kernels for NSGA-III:
 *  - Fast non-dominated sorting (`nsga3FastNonDominatedSortWasm`)
 *  - Reference point perpendicular-distance association (`nsga3AssociateRefPointsWasm`)
 */

@inline
function dominatesFlat(objs: usize, iOff: usize, jOff: usize, m: u32): bool {
  let betterInAtLeastOne = false;
  for (let k: u32 = 0; k < m; k++) {
    let off = (k as usize) << 3;
    let a = load<f64>(objs + iOff + off);
    let b = load<f64>(objs + jOff + off);
    if (a > b) return false;
    if (a < b) betterInAtLeastOne = true;
  }
  return betterInAtLeastOne;
}

/**
 * Computes Pareto front ranks (0-based) for `n` individuals with `m` objectives.
 * Returns the number of fronts.
 */
export function nsga3FastNonDominatedSortWasm(
  n: u32,
  m: u32,
  objsPtr: u32,
  ranksPtr: u32,
): u32 {
  if (n == 0) return 0;
  let objs = objsPtr as usize;
  let ranks = ranksPtr as usize;
  let nn = (n as usize) * (n as usize);
  let domMat = heap.alloc(nn);
  let domCount = heap.alloc((n as usize) << 2);
  let queue = heap.alloc((n as usize) << 2);
  let nextQueue = heap.alloc((n as usize) << 2);

  memory.fill(domMat, 0, nn);
  memory.fill(domCount, 0, (n as usize) << 2);

  let mStride = (m as usize) << 3;
  let qLen: u32 = 0;

  for (let i: u32 = 0; i < n; i++) {
    let iOff = (i as usize) * mStride;
    let iRow = (i as usize) * (n as usize);
    let cnt: i32 = 0;
    for (let j: u32 = 0; j < n; j++) {
      if (i == j) continue;
      let jOff = (j as usize) * mStride;
      if (dominatesFlat(objs, iOff, jOff, m)) {
        store<u8>(domMat + iRow + (j as usize), 1);
      } else if (dominatesFlat(objs, jOff, iOff, m)) {
        cnt++;
      }
    }
    store<i32>(domCount + ((i as usize) << 2), cnt);
    if (cnt == 0) {
      store<i32>(ranks + ((i as usize) << 2), 0);
      store<u32>(queue + ((qLen as usize) << 2), i);
      qLen++;
    }
  }

  let currentRank: i32 = 0;
  while (qLen > 0) {
    let nqLen: u32 = 0;
    for (let qi: u32 = 0; qi < qLen; qi++) {
      let p = load<u32>(queue + ((qi as usize) << 2));
      let pRow = domMat + (p as usize) * (n as usize);
      for (let q: u32 = 0; q < n; q++) {
        if (load<u8>(pRow + (q as usize)) != 0) {
          let qOff = (q as usize) << 2;
          let rem = load<i32>(domCount + qOff) - 1;
          store<i32>(domCount + qOff, rem);
          if (rem == 0) {
            store<i32>(ranks + qOff, currentRank + 1);
            store<u32>(nextQueue + ((nqLen as usize) << 2), q);
            nqLen++;
          }
        }
      }
    }
    currentRank++;
    if (nqLen > 0) {
      memory.copy(queue, nextQueue, (nqLen as usize) << 2);
    }
    qLen = nqLen;
  }

  heap.free(domMat);
  heap.free(domCount);
  heap.free(queue);
  heap.free(nextQueue);

  return currentRank as u32;
}

/**
 * Associates each of `n` normalized objective vectors (`n x m`) with its nearest
 * reference point among `rCount` reference points (`rCount x m`).
 */
export function nsga3AssociateRefPointsWasm(
  n: u32,
  rCount: u32,
  m: u32,
  normObjsPtr: u32,
  refPointsPtr: u32,
  outRefIdxPtr: u32,
  outDistPtr: u32,
): void {
  if (n == 0 || rCount == 0) return;
  let normObjs = normObjsPtr as usize;
  let refPts = refPointsPtr as usize;
  let outIdx = outRefIdxPtr as usize;
  let outDist = outDistPtr as usize;
  let mStride = (m as usize) << 3;

  let refNormSqPtr = heap.alloc((rCount as usize) << 3);
  for (let r: u32 = 0; r < rCount; r++) {
    let rOff = refPts + (r as usize) * mStride;
    let sumSq: f64 = 0.0;
    for (let k: u32 = 0; k < m; k++) {
      let v = load<f64>(rOff + ((k as usize) << 3));
      sumSq += v * v;
    }
    store<f64>(refNormSqPtr + ((r as usize) << 3), sumSq);
  }

  for (let i: u32 = 0; i < n; i++) {
    let pOff = normObjs + (i as usize) * mStride;
    let bestRef: i32 = 0;
    let minDist: f64 = Infinity;

    for (let r: u32 = 0; r < rCount; r++) {
      let refNormSq = load<f64>(refNormSqPtr + ((r as usize) << 3));
      let d: f64 = 0.0;
      if (refNormSq >= 1e-12) {
        let rOff = refPts + (r as usize) * mStride;
        let dot: f64 = 0.0;
        for (let k: u32 = 0; k < m; k++) {
          let kOff = (k as usize) << 3;
          dot += load<f64>(pOff + kOff) * load<f64>(rOff + kOff);
        }
        let scale = dot / refNormSq;
        let distSq: f64 = 0.0;
        for (let k: u32 = 0; k < m; k++) {
          let kOff = (k as usize) << 3;
          let diff = load<f64>(pOff + kOff) - scale * load<f64>(rOff + kOff);
          distSq += diff * diff;
        }
        d = Math.sqrt(distSq > 0.0 ? distSq : 0.0);
      }
      if (d < minDist) {
        minDist = d;
        bestRef = r as i32;
      }
    }

    store<i32>(outIdx + ((i as usize) << 2), bestRef);
    store<f64>(outDist + ((i as usize) << 3), minDist);
  }

  heap.free(refNormSqPtr);
}
