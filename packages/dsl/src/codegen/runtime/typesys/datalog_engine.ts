// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Stratified Datalog Reasoning Engine (Zero-GC) ---
// Computes semi-naive fixpoints, negation via stratification,
// and axiom rule evaluation in WebAssembly linear memory.

import { ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import { getNodeFirstChild, getNodeNextSibling } from "../arena";

export const FACT_STRIDE: u32 = 4;
export const MAX_FACTS: u32 = 25000;
export let factTable = createChunkedUint32Array(100000);
export let factCount: u32 = 0;

// --- Predicate Index for O(k) Join Acceleration ---
const PRED_INDEX_CAPACITY: u32 = 4096;
const PRED_INDEX_MASK: u32 = PRED_INDEX_CAPACITY - 1;
export let predIndexHead = createChunkedUint32Array(PRED_INDEX_CAPACITY);
export let predIndexNext = createChunkedUint32Array(MAX_FACTS);

// --- Hash Index for O(1) Fact Existence Checks ---
const FACT_HASH_CAPACITY: u32 = 100000;
export let factHashTable = createChunkedUint32Array(FACT_HASH_CAPACITY);

// --- Provenance Semiring (PosBool / N[X]) ---
export let factProvTable = createChunkedUint32Array(MAX_FACTS);

export function factHashKey(pred: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): u32 {
  let h = pred;
  h = (h ^ (arg1 * 2654435761)) >>> 0;
  h = (h ^ (arg2 * 2654435761)) >>> 0;
  h = (h ^ (arg3 * 2654435761)) >>> 0;
  return h % FACT_HASH_CAPACITY;
}

/**
 * Returns the fact index for the given tuple if it exists, or -1.
 */
export function findFactIndex(pred: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): i32 {
  let hk = factHashKey(pred, arg1, arg2, arg3);
  let guard: u32 = 0;
  while (guard < FACT_HASH_CAPACITY) {
    let slot = factHashTable[hk];
    if (slot == 0) return -1;
    let idx = (slot - 1) * FACT_STRIDE;
    if (
      factTable[idx] == pred &&
      factTable[idx + 1] == arg1 &&
      factTable[idx + 2] == arg2 &&
      factTable[idx + 3] == arg3
    ) {
      return (slot - 1) as i32;
    }
    hk = (hk + 1) % FACT_HASH_CAPACITY;
    guard++;
  }
  return -1;
}

/**
 * Adds a fact with an initial provenance bitmask / polynomial token.
 * If the fact already exists, accumulates provenance via PosBool semiring addition (OR).
 */
export function addFactWithProv(pred: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0, provMask: u32 = 1): u32 {
  if (factCount >= MAX_FACTS) return 0;
  let existingIdx = findFactIndex(pred, arg1, arg2, arg3);
  if (existingIdx >= 0) {
    factProvTable[existingIdx as u32] |= provMask;
    return existingIdx as u32;
  }

  let idx = factCount * FACT_STRIDE;
  factTable[idx + 0] = pred;
  factTable[idx + 1] = arg1;
  factTable[idx + 2] = arg2;
  factTable[idx + 3] = arg3;

  let factIdx = factCount;
  factProvTable[factIdx] = provMask != 0 ? provMask : 1;
  factCount++;

  let hk = factHashKey(pred, arg1, arg2, arg3);
  let guard: u32 = 0;
  while (factHashTable[hk] != 0 && guard < FACT_HASH_CAPACITY) {
    hk = (hk + 1) % FACT_HASH_CAPACITY;
    guard++;
  }
  if (guard < FACT_HASH_CAPACITY) factHashTable[hk] = factCount;

  let predSlot = (pred >>> 0) & PRED_INDEX_MASK;
  predIndexNext[factIdx] = predIndexHead[predSlot];
  predIndexHead[predSlot] = factIdx + 1;

  return factIdx;
}

export function addFact(pred: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): void {
  addFactWithProv(pred, arg1, arg2, arg3, 1);
}

export function factExists(pred: u32, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): boolean {
  return findFactIndex(pred, arg1, arg2, arg3) >= 0;
}

/**
 * Gets the raw provenance bitmask for a given fact.
 */
export function getFactProvenance(factIdx: u32): u32 {
  if (factIdx < factCount && factTable[factIdx * FACT_STRIDE] != 0) {
    return factProvTable[factIdx];
  }
  return 0;
}

/**
 * Returns an array of token IDs (0..31) that contributed to this fact's derivation.
 */
export function getFactProvenanceTokens(factIdx: u32): StaticArray<u32> {
  let mask = getFactProvenance(factIdx);
  let count: i32 = 0;
  for (let b: u32 = 0; b < 32; b++) {
    if (((mask >>> b) & 1) != 0) count++;
  }
  let res = new StaticArray<u32>(count);
  let idx = 0;
  for (let b: u32 = 0; b < 32; b++) {
    if (((mask >>> b) & 1) != 0) {
      res[idx++] = b;
    }
  }
  return res;
}

/**
 * Retracts an input token. Any fact whose provenance becomes 0 (no independent derivation)
 * is tombstoned in O(1) per affected fact.
 * Returns the number of tombstoned facts.
 */
export function retractToken(tokenId: u32): u32 {
  if (tokenId >= 32) return 0;
  let tokenBit: u32 = (1 << tokenId);
  let retractedCount: u32 = 0;

  for (let i: u32 = 0; i < factCount; i++) {
    let fIdx = i * FACT_STRIDE;
    if (factTable[fIdx] == 0) continue;

    if ((factProvTable[i] & tokenBit) != 0) {
      factProvTable[i] &= ~tokenBit;
      if (factProvTable[i] == 0) {
        tombstoneFact(i);
        retractedCount++;
      }
    }
  }
  return retractedCount;
}

export function initFactArena(): void {
  factCount = 0;
  for (let i: u32 = 0; i < FACT_HASH_CAPACITY; i++) factHashTable[i] = 0;
  for (let i: u32 = 0; i < PRED_INDEX_CAPACITY; i++) predIndexHead[i] = 0;
  for (let i: u32 = 0; i < MAX_FACTS; i++) factProvTable[i] = 0;
}

export function tombstoneFact(factIdx: u32): void {
  if (factIdx < factCount) {
    factTable[factIdx * FACT_STRIDE] = 0;
    factProvTable[factIdx] = 0;
  }
}

export function garbageCollectFacts(): void {
  let writeIdx: u32 = 0;
  for (let i: u32 = 0; i < factCount; i++) {
    let idx = i * FACT_STRIDE;
    if (factTable[idx] == 0) continue;

    if (writeIdx != i) {
      let wIdx = writeIdx * FACT_STRIDE;
      for (let k: u32 = 0; k < FACT_STRIDE; k++) {
        factTable[wIdx + k] = factTable[idx + k];
      }
      factProvTable[writeIdx] = factProvTable[i];
    }
    writeIdx++;
  }
  factCount = writeIdx;

  for (let i: u32 = 0; i < FACT_HASH_CAPACITY; i++) factHashTable[i] = 0;
  for (let i: u32 = 0; i < PRED_INDEX_CAPACITY; i++) predIndexHead[i] = 0;

  for (let i: u32 = 0; i < factCount; i++) {
    let idx = i * FACT_STRIDE;
    let hk = factHashKey(factTable[idx], factTable[idx + 1], factTable[idx + 2], factTable[idx + 3]);
    let guard: u32 = 0;
    while (factHashTable[hk] != 0 && guard < FACT_HASH_CAPACITY) {
      hk = (hk + 1) % FACT_HASH_CAPACITY;
      guard++;
    }
    if (guard < FACT_HASH_CAPACITY) factHashTable[hk] = i + 1;

    let predSlot = (factTable[idx] >>> 0) & PRED_INDEX_MASK;
    predIndexNext[i] = predIndexHead[predSlot];
    predIndexHead[predSlot] = i + 1;
  }
}

export function datalog_ask_string(q: string): boolean {
  let parenIdx: i32 = -1;
  for (let i = 0; i < q.length; i++) {
    if (q.charCodeAt(i) == 40) {
      parenIdx = i;
      break;
    }
  }

  let predEnd = parenIdx >= 0 ? parenIdx : q.length;
  let predHash: u32 = 5381;
  for (let i = 0; i < predEnd; i++) {
    predHash = ((predHash << 5) + predHash + q.charCodeAt(i)) >>> 0;
  }

  let argHashes = new StaticArray<u32>(3);
  let argCount: u32 = 0;

  if (parenIdx >= 0) {
    let closeIdx = q.length - 1;
    for (let i = q.length - 1; i >= parenIdx; i--) {
      if (q.charCodeAt(i) == 41) {
        closeIdx = i;
        break;
      }
    }

    let argStart = parenIdx + 1;
    for (let i = parenIdx + 1; i <= closeIdx; i++) {
      let ch = i < closeIdx ? q.charCodeAt(i) : 44;
      if (ch == 44 || i == closeIdx) {
        let h: u32 = 5381;
        let hasContent = false;
        for (let j = argStart; j < i; j++) {
          let c = q.charCodeAt(j);
          if (c != 32 && c != 9) {
            h = ((h << 5) + h + c) >>> 0;
            hasContent = true;
          }
        }
        if (hasContent && argCount < 3) {
          argHashes[argCount] = h;
          argCount++;
        }
        argStart = i + 1;
      }
    }
  }

  return factExists(
    predHash,
    argCount > 0 ? argHashes[0] : 0,
    argCount > 1 ? argHashes[1] : 0,
    argCount > 2 ? argHashes[2] : 0,
  );
}
