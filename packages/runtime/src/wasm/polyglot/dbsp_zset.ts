// SPDX-License-Identifier: AGPL-3.0-or-later

import { atomicChunkAlloc, atomicChunkFree } from "../core/array";

const ZSET_HEADER_BYTES: u32 = 16;
const ZSET_COUNT_OFF: usize = 0;
const ZSET_CAP_OFF: usize = 4;
const ZSET_DATA_OFF: usize = 8;
const ENTRY_BYTES: u32 = 12; // elementId: u32 (0), weight: i32 (4), timestamp: u32 (8)

@inline
function readCount(ptr: usize): u32 {
  return load<u32>(ptr + ZSET_COUNT_OFF);
}

@inline
function writeCount(ptr: usize, count: u32): void {
  store<u32>(ptr + ZSET_COUNT_OFF, count);
}

@inline
function readCap(ptr: usize): u32 {
  return load<u32>(ptr + ZSET_CAP_OFF);
}

@inline
function writeCap(ptr: usize, cap: u32): void {
  store<u32>(ptr + ZSET_CAP_OFF, cap);
}

@inline
function readData(ptr: usize): usize {
  return load<u32>(ptr + ZSET_DATA_OFF) as usize;
}

@inline
function writeData(ptr: usize, dataPtr: u32): void {
  store<u32>(ptr + ZSET_DATA_OFF, dataPtr);
}

@inline
function getEntryElement(data: usize, idx: u32): u32 {
  return load<u32>(data + (idx as usize) * 12);
}

@inline
function getEntryWeight(data: usize, idx: u32): i32 {
  return load<i32>(data + (idx as usize) * 12 + 4);
}

@inline
function getEntryTimestamp(data: usize, idx: u32): u32 {
  return load<u32>(data + (idx as usize) * 12 + 8);
}

@inline
function setEntry(data: usize, idx: u32, elementId: u32, weight: i32, timestamp: u32): void {
  let base = data + (idx as usize) * 12;
  store<u32>(base, elementId);
  store<i32>(base + 4, weight);
  store<u32>(base + 8, timestamp);
}

@inline
function swapEntries(data: usize, a: u32, b: u32): void {
  if (a == b) return;
  let ae = getEntryElement(data, a);
  let aw = getEntryWeight(data, a);
  let at = getEntryTimestamp(data, a);
  setEntry(data, a, getEntryElement(data, b), getEntryWeight(data, b), getEntryTimestamp(data, b));
  setEntry(data, b, ae, aw, at);
}

function siftDown(data: usize, start: u32, count: u32): void {
  let root = start;
  while (root * 2 + 1 < count) {
    let child = root * 2 + 1;
    let swapIdx = root;
    if (getEntryElement(data, swapIdx) < getEntryElement(data, child)) {
      swapIdx = child;
    }
    if (child + 1 < count && getEntryElement(data, swapIdx) < getEntryElement(data, child + 1)) {
      swapIdx = child + 1;
    }
    if (swapIdx == root) return;
    swapEntries(data, root, swapIdx);
    root = swapIdx;
  }
}

export function createZSet(initialCapacity: u32): u32 {
  let cap = initialCapacity < 16 ? 16 : initialCapacity;
  let ptr = atomicChunkAlloc(ZSET_HEADER_BYTES);
  if (ptr == 0) return 0;
  let dataPtr = atomicChunkAlloc(cap * ENTRY_BYTES);
  if (dataPtr == 0) {
    atomicChunkFree(ptr as usize);
    return 0;
  }
  writeCount(ptr as usize, 0);
  writeCap(ptr as usize, cap);
  writeData(ptr as usize, dataPtr);
  return ptr;
}

export function zset_destroy(ptr: u32): void {
  if (ptr == 0) return;
  let p = ptr as usize;
  let data = readData(p);
  if (data != 0) {
    atomicChunkFree(data);
    writeData(p, 0);
  }
  atomicChunkFree(p);
}

export function zset_add(ptr: u32, elementId: u32, weight: i32, timestamp: u32): void {
  if (ptr == 0 || weight == 0) return;
  let p = ptr as usize;
  let count = readCount(p);
  let cap = readCap(p);
  let data = readData(p);

  if (count >= cap) {
    let newCap = cap < 16 ? 16 : cap * 2;
    let newData = atomicChunkAlloc(newCap * ENTRY_BYTES);
    if (newData == 0) return;
    if (data != 0) {
      memory.copy(newData as usize, data, (count as usize) * 12);
      atomicChunkFree(data);
    }
    data = newData as usize;
    writeData(p, newData);
    writeCap(p, newCap);
  }

  setEntry(data, count, elementId, weight, timestamp);
  writeCount(p, count + 1);
}

export function zset_consolidate(ptr: u32): u32 {
  if (ptr == 0) return 0;
  let p = ptr as usize;
  let count = readCount(p);
  if (count == 0) return 0;

  let data = readData(p);
  if (count > 1) {
    // Iterative O(N log N) heapsort by elementId so large batches never overflow stack.
    let i: i32 = ((count >> 1) as i32) - 1;
    while (i >= 0) {
      siftDown(data, i as u32, count);
      i--;
    }
    let end: u32 = count - 1;
    while (end > 0) {
      swapEntries(data, 0, end);
      siftDown(data, 0, end);
      end--;
    }
  }

  let outIdx: u32 = 0;
  let idx: u32 = 0;
  while (idx < count) {
    let curId = getEntryElement(data, idx);
    let sumWeight = getEntryWeight(data, idx);
    let maxTs = getEntryTimestamp(data, idx);
    idx++;

    while (idx < count && getEntryElement(data, idx) == curId) {
      sumWeight += getEntryWeight(data, idx);
      let ts = getEntryTimestamp(data, idx);
      if (ts > maxTs) maxTs = ts;
      idx++;
    }

    if (sumWeight != 0) {
      setEntry(data, outIdx, curId, sumWeight, maxTs);
      outIdx++;
    }
  }

  writeCount(p, outIdx);
  return outIdx;
}

export function zset_count(ptr: u32): u32 {
  if (ptr == 0) return 0;
  return readCount(ptr as usize);
}

export function zset_getElement(ptr: u32, index: u32): u32 {
  if (ptr == 0) return 0;
  let p = ptr as usize;
  if (index >= readCount(p)) return 0;
  return getEntryElement(readData(p), index);
}

export function zset_getWeight(ptr: u32, index: u32): i32 {
  if (ptr == 0) return 0;
  let p = ptr as usize;
  if (index >= readCount(p)) return 0;
  return getEntryWeight(readData(p), index);
}
