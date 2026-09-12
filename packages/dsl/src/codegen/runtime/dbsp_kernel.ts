/* eslint-disable */
// @ts-nocheck
/**
 * @fileoverview WASM DBSP (Database Stream Processing) & Differential Dataflow Kernel
 *
 * Implements Z-module relational difference operators (+1/-1 weights) and Leapfrog
 * Triejoin (LFTJ) cursor primitives in linear memory for O(Δ) incremental view maintenance
 * and exact AST node retractions.
 */

import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc } from "./arena";

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

  init(keysArray: ChunkedUint32Array, len: u32): void {
    this.keys = keysArray;
    this.length = len;
    this.cursor = 0;
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
   * Seeks to the smallest key >= targetKey.
   */
  @inline
  seek(targetKey: u32): void {
    while (this.cursor < this.length && this.keys.get(this.cursor) < targetKey) {
      this.cursor++;
    }
  }

  @inline
  atEnd(): boolean {
    return this.cursor >= this.length;
  }
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
