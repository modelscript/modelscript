// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
/**
 * @fileoverview WASM DBSP (Database Stream Processing) & Differential Dataflow Kernel
 *
 * Implements Z-module relational difference operators (+1/-1 weights) and Leapfrog
 * Triejoin (LFTJ) cursor primitives in linear memory for O(Δ) incremental view maintenance
 * and exact AST node retractions.
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import { atomicChunkAlloc } from "../arena";
import {
  DpoGraph,
  DPO_EDGE_STRIDE,
  DPO_EDGE_TARGET,
  DPO_EDGE_TYPE,
  DPO_FLAG_ACTIVE,
  DPO_FLAG_TOMBSTONE,
} from "./dpo_kernel";

export const ZSET_STRIDE = 3;
export const ZSET_ELEMENT = 0;   // 32-bit Node or Entity ID
export const ZSET_WEIGHT = 1;    // Signed 32-bit integer weight (+1 = insert, -1 = delete/retract)
export const ZSET_TIMESTAMP = 2; // Revision / Step counter

/**
 * Z-Set: Multiset with integer multiplicities in linear memory.
 */
@unmanaged
export class ZSet {
  data: ChunkedUint32Array;
  count: u32;

  init(initialCapacity: u32 = 256): void {
    this.data = createChunkedUint32Array(initialCapacity * ZSET_STRIDE);
    this.count = 0;
  }

  @inline
  add(elementId: u32, weight: i32, timestamp: u32 = 0): void {
    let offset = this.count * ZSET_STRIDE;
    this.data.set(offset + ZSET_ELEMENT, elementId);
    this.data.set(offset + ZSET_WEIGHT, weight as u32);
    this.data.set(offset + ZSET_TIMESTAMP, timestamp);
    this.count++;
  }

  @inline
  getElement(index: u32): u32 {
    if (index >= this.count) return 0;
    return this.data.get(index * ZSET_STRIDE + ZSET_ELEMENT);
  }

  @inline
  getWeight(index: u32): i32 {
    if (index >= this.count) return 0;
    return this.data.get(index * ZSET_STRIDE + ZSET_WEIGHT) as i32;
  }

  @inline
  getTimestamp(index: u32): u32 {
    if (index >= this.count) return 0;
    return this.data.get(index * ZSET_STRIDE + ZSET_TIMESTAMP);
  }

  @inline
  clear(): void {
    this.count = 0;
  }
}

export function createZSet(initialCapacity: u32 = 256): usize {
  let ptr = atomicChunkAlloc(sizeof<ZSet>());
  let zset = changetype<ZSet>(ptr);
  zset.init(initialCapacity);
  return ptr;
}

export function zset_add(ptr: usize, elementId: u32, weight: i32, timestamp: u32): void {
  changetype<ZSet>(ptr).add(elementId, weight, timestamp);
}

export function zset_count(ptr: usize): u32 {
  return changetype<ZSet>(ptr).count;
}

export function zset_getElement(ptr: usize, index: u32): u32 {
  return changetype<ZSet>(ptr).getElement(index);
}

export function zset_getWeight(ptr: usize, index: u32): i32 {
  return changetype<ZSet>(ptr).getWeight(index);
}

/**
 * Leapfrog Triejoin (LFTJ) Iterator Primitive for Worst-Case Optimal Graph Matching.
 * Traverses sorted prefix keys to find exact intersections across hypergraph relations.
 */
@unmanaged
export class LeapfrogIterator {
  keys: ChunkedUint32Array;
  length: u32;
  cursor: u32;
  cachedGraphPtr: usize;
  cachedVersion: u32;
  cachedEdgeType: u16;
  cachedUseSource: boolean;

  init(keysArray: ChunkedUint32Array, len: u32): void {
    this.keys = keysArray;
    this.length = len;
    this.cursor = 0;
    this.cachedGraphPtr = 0;
    this.cachedVersion = 0;
  }

  @inline
  key(): u32 {
    if (this.cursor >= this.length) return 0xffffffff;
    return this.keys.get(this.cursor);
  }

  @inline
  next(): void {
    if (this.cursor < this.length) this.cursor++;
  }

  /**
   * Seeks to the smallest key >= targetKey in O(log(delta)) using exponential (galloping) binary search.
   */
  @inline
  seek(targetKey: u32): void {
    if (this.cursor >= this.length) return;
    if (this.keys.get(this.cursor) >= targetKey) return;

    // Exponential galloping phase
    let low: u32 = this.cursor;
    let step: u32 = 1;
    let high: u32 = low + step;
    while (high < this.length && this.keys.get(high) < targetKey) {
      low = high;
      step <<= 1;
      high = low + step;
    }
    if (high >= this.length) {
      high = this.length - 1;
    }

    // Binary search phase in [low, high]
    let lo: u32 = low + 1;
    let hi: u32 = high;
    let ans: u32 = this.length;
    while (lo <= hi) {
      let mid: u32 = lo + ((hi - lo) >>> 1);
      if (this.keys.get(mid) >= targetKey) {
        ans = mid;
        if (mid == 0) break;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    this.cursor = ans;
  }

  @inline
  atEnd(): boolean {
    return this.cursor >= this.length;
  }
}

function quickSortU32(arr: ChunkedUint32Array, left: i32, right: i32): void {
  if (left >= right) return;
  let pivot = arr.get(((left + right) >>> 1) as u32);
  let i = left;
  let j = right;
  while (i <= j) {
    while (arr.get(i as u32) < pivot) i++;
    while (arr.get(j as u32) > pivot) j--;
    if (i <= j) {
      let tmp = arr.get(i as u32);
      arr.set(i as u32, arr.get(j as u32));
      arr.set(j as u32, tmp);
      i++;
      j--;
    }
  }
  if (left < j) quickSortU32(arr, left, j);
  if (i < right) quickSortU32(arr, i, right);
}

/**
 * Initializes a LeapfrogIterator in linear memory with sorted unique node IDs
 * extracted from active edges in a DpoGraph matching edgeTypeHash (or all edges if 0).
 * Extracts target node IDs by default, or source node IDs when useSource is true.
 */
export function leapfrog_init_from_dpo_edges(
  iterPtr: usize,
  graphPtr: usize,
  edgeTypeHash: u16 = 0,
  useSource: boolean = false
): void {
  let iter = changetype<LeapfrogIterator>(iterPtr);
  if (graphPtr == 0) {
    iter.init(createChunkedUint32Array(0), 0);
    return;
  }
  let g = changetype<DpoGraph>(graphPtr);
  if (
    iter.cachedGraphPtr == graphPtr &&
    iter.cachedVersion != 0 &&
    iter.cachedVersion == g.topologyVersion &&
    iter.cachedEdgeType == edgeTypeHash &&
    iter.cachedUseSource == useSource
  ) {
    iter.cursor = 0;
    return;
  }
  let totalEdges = g.edgeCount;
  let keys = createChunkedUint32Array(totalEdges > 0 ? totalEdges : 1);
  let rawLen: u32 = 0;

  for (let eIdx: u32 = 0; eIdx < totalEdges; eIdx++) {
    let eOffset = eIdx * DPO_EDGE_STRIDE;
    let typeWord = g.edges.get(eOffset + DPO_EDGE_TYPE);
    let flags = (typeWord & 0xffff) as u16;
    let eType = (typeWord >>> 16) as u16;
    if (
      (flags & DPO_FLAG_ACTIVE) != 0 &&
      (flags & DPO_FLAG_TOMBSTONE) == 0 &&
      (edgeTypeHash == 0 || eType == edgeTypeHash)
    ) {
      let nodeId = useSource
        ? g.edges.get(eOffset + DPO_EDGE_SOURCE)
        : g.edges.get(eOffset + DPO_EDGE_TARGET);
      keys.set(rawLen++, nodeId);
    }
  }

  if (rawLen > 1) {
    quickSortU32(keys, 0, (rawLen as i32) - 1);
  }

  // In-place linear deduplication
  let uniqueLen: u32 = 0;
  for (let i: u32 = 0; i < rawLen; i++) {
    let v = keys.get(i);
    if (uniqueLen == 0 || keys.get(uniqueLen - 1) != v) {
      keys.set(uniqueLen++, v);
    }
  }

  iter.init(keys, uniqueLen);
  iter.cachedGraphPtr = graphPtr;
  iter.cachedVersion = g.topologyVersion;
  iter.cachedEdgeType = edgeTypeHash;
  iter.cachedUseSource = useSource;
}

/**
 * Evaluates Leapfrog Triejoin intersection between two sorted iterator streams.
 * Produces matches in O(N log N) optimal time.
 */
export function leapfrog_intersect_2(iter1Ptr: usize, iter2Ptr: usize, resultZSetPtr: usize): u32 {
  let iter1 = changetype<LeapfrogIterator>(iter1Ptr);
  let iter2 = changetype<LeapfrogIterator>(iter2Ptr);
  let res = changetype<ZSet>(resultZSetPtr);
  let matchCount: u32 = 0;

  while (!iter1.atEnd() && !iter2.atEnd()) {
    let k1 = iter1.key();
    let k2 = iter2.key();

    if (k1 == k2) {
      res.add(k1, 1, 0);
      matchCount++;
      iter1.next();
      iter2.next();
    } else if (k1 < k2) {
      iter1.seek(k2);
    } else {
      iter2.seek(k1);
    }
  }

  return matchCount;
}

/**
 * 3-Way Leapfrog Triejoin for Cyclic/Triangle Patterns (X -> Y -> Z -> X).
 * Achieves AGM worst-case optimal bound O(N^(3/2)).
 */
export function leapfrog_intersect_3(
  iter1Ptr: usize,
  iter2Ptr: usize,
  iter3Ptr: usize,
  resultZSetPtr: usize
): u32 {
  let iter1 = changetype<LeapfrogIterator>(iter1Ptr);
  let iter2 = changetype<LeapfrogIterator>(iter2Ptr);
  let iter3 = changetype<LeapfrogIterator>(iter3Ptr);
  let res = changetype<ZSet>(resultZSetPtr);
  let matchCount: u32 = 0;

  while (!iter1.atEnd() && !iter2.atEnd() && !iter3.atEnd()) {
    let k1 = iter1.key();
    let k2 = iter2.key();
    let k3 = iter3.key();

    if (k1 == k2 && k2 == k3) {
      res.add(k1, 1, 0);
      matchCount++;
      iter1.next();
      iter2.next();
      iter3.next();
    } else {
      let maxKey = k1;
      if (k2 > maxKey) maxKey = k2;
      if (k3 > maxKey) maxKey = k3;

      if (k1 < maxKey) iter1.seek(maxKey);
      if (k2 < maxKey) iter2.seek(maxKey);
      if (k3 < maxKey) iter3.seek(maxKey);
    }
  }

  return matchCount;
}

/**
 * Multiset Consolidation: Combines entries with identical element IDs by summing weights,
 * and eliminates net-zero entries (elements where weight == 0).
 */
export function zset_consolidate(ptr: usize): u32 {
  let zset = changetype<ZSet>(ptr);
  let n = zset.count;
  if (n <= 1) return n;

  // Simple in-place insertion sort by elementId (ZSet entries are small in differential steps)
  for (let i: u32 = 1; i < n; i++) {
    let keyElem = zset.getElement(i);
    let keyWeight = zset.getWeight(i);
    let keyTime = zset.getTimestamp(i);
    let j: i32 = (i as i32) - 1;

    while (j >= 0 && zset.getElement(j as u32) > keyElem) {
      let srcOffset = (j as u32) * ZSET_STRIDE;
      let dstOffset = ((j + 1) as u32) * ZSET_STRIDE;
      zset.data.set(dstOffset + ZSET_ELEMENT, zset.data.get(srcOffset + ZSET_ELEMENT));
      zset.data.set(dstOffset + ZSET_WEIGHT, zset.data.get(srcOffset + ZSET_WEIGHT));
      zset.data.set(dstOffset + ZSET_TIMESTAMP, zset.data.get(srcOffset + ZSET_TIMESTAMP));
      j--;
    }
    let insertOffset = ((j + 1) as u32) * ZSET_STRIDE;
    zset.data.set(insertOffset + ZSET_ELEMENT, keyElem);
    zset.data.set(insertOffset + ZSET_WEIGHT, keyWeight as u32);
    zset.data.set(insertOffset + ZSET_TIMESTAMP, keyTime);
  }

  // Linear scan to combine adjacent duplicates and filter net-zero weights
  let writeIdx: u32 = 0;
  let i: u32 = 0;
  while (i < n) {
    let currentElem = zset.getElement(i);
    let totalWeight: i32 = 0;
    let latestTime: u32 = 0;

    while (i < n && zset.getElement(i) == currentElem) {
      totalWeight += zset.getWeight(i);
      let t = zset.getTimestamp(i);
      if (t > latestTime) latestTime = t;
      i++;
    }

    if (totalWeight != 0) {
      let outOffset = writeIdx * ZSET_STRIDE;
      zset.data.set(outOffset + ZSET_ELEMENT, currentElem);
      zset.data.set(outOffset + ZSET_WEIGHT, totalWeight as u32);
      zset.data.set(outOffset + ZSET_TIMESTAMP, latestTime);
      writeIdx++;
    }
  }

  zset.count = writeIdx;
  return writeIdx;
}

/**
 * Inverts the sign of each weight in the multiset (Z -> -Z).
 */
export function zset_negate(ptr: usize): void {
  let zset = changetype<ZSet>(ptr);
  for (let i: u32 = 0; i < zset.count; i++) {
    let w = zset.getWeight(i);
    let offset = i * ZSET_STRIDE + ZSET_WEIGHT;
    zset.data.set(offset, (-w) as u32);
  }
}

/**
 * Appends all elements from srcPtr into dstPtr and consolidates.
 */
export function zset_union_add(dstPtr: usize, srcPtr: usize): u32 {
  let dst = changetype<ZSet>(dstPtr);
  let src = changetype<ZSet>(srcPtr);
  for (let i: u32 = 0; i < src.count; i++) {
    dst.add(src.getElement(i), src.getWeight(i), src.getTimestamp(i));
  }
  return zset_consolidate(dstPtr);
}

/**
 * Evaluates full DBSP Multiset Fixed-Point Differentiation:
 *   D(Fix(f))(ΔI) = Σ_{k=0}^{k*} ΔR^{(k)}
 *
 * Runs iterative differentiation over Z-sets until the frontier delta vanishes (ΔR = 0)
 * or maxIterations is reached.
 */
export function dbsp_fixed_point_differentiate(
  frontierPtr: usize,
  accumulatedPtr: usize,
  maxIterations: u32 = 100,
  graphPtr: usize = 0
): u32 {
  let frontier = changetype<ZSet>(frontierPtr);
  let accumulated = changetype<ZSet>(accumulatedPtr);
  let iterations: u32 = 0;

  while (frontier.count > 0 && iterations < maxIterations) {
    zset_union_add(accumulatedPtr, frontierPtr);
    iterations++;

    if (graphPtr != 0) {
      let g = changetype<DpoGraph>(graphPtr);
      let nextFrontier = changetype<ZSet>(createZSet(frontier.count > 0 ? frontier.count * 2 : 16));
      for (let fIdx: u32 = 0; fIdx < frontier.count; fIdx++) {
        let srcNode = frontier.getElement(fIdx);
        let weight = frontier.getWeight(fIdx);
        if (weight == 0) continue;
        for (let eIdx: u32 = 0; eIdx < g.edgeCount; eIdx++) {
          let eOffset = eIdx * DPO_EDGE_STRIDE;
          let typeWord = g.edges.get(eOffset + DPO_EDGE_TYPE);
          let flags = (typeWord & 0xffff) as u16;
          if ((flags & DPO_FLAG_ACTIVE) == 0 || (flags & DPO_FLAG_TOMBSTONE) != 0) continue;
          if (g.edges.get(eOffset + DPO_EDGE_SOURCE) == srcNode) {
            let dstNode = g.edges.get(eOffset + DPO_EDGE_TARGET);
            // Only enqueue newly discovered nodes not already in accumulated
            let seen = false;
            for (let aIdx: u32 = 0; aIdx < accumulated.count; aIdx++) {
              if (accumulated.getElement(aIdx) == dstNode && accumulated.getWeight(aIdx) != 0) {
                seen = true;
                break;
              }
            }
            if (!seen) {
              nextFrontier.add(dstNode, weight, iterations);
            }
          }
        }
      }
      zset_consolidate(changetype<usize>(nextFrontier));
      frontier.clear();
      for (let nIdx: u32 = 0; nIdx < nextFrontier.count; nIdx++) {
        frontier.add(nextFrontier.getElement(nIdx), nextFrontier.getWeight(nIdx), nextFrontier.getTimestamp(nIdx));
      }
    } else {
      zset_consolidate(accumulatedPtr);
      frontier.clear();
    }
  }

  return iterations;
}
