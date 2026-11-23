// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript Linear-Memory Polymorphic Inline Cache (PIC) for TGG & Cross-Language Dispatch.
 *
 * Mirrors GraalVM/Truffle's monomorphic -> 4-way polymorphic -> megamorphic dispatch hierarchy
 * over packed 32-bit `(sourceDomainId: u8, sourceKindTag: u16, targetDomainId: u8)` keys.
 */

import { atomicChunkAlloc, atomicChunkFree } from "../core/array";

// Header layout (48 bytes):
//  0: monoKey (u32)
//  4: monoRuleId (u32)        (0xffffffff = empty)
//  8: polyCount (u32)         (0..4)
// 12: megaCap (u32)           (power of 2)
// 16: megaCount (u32)
// 20: megaKeysPtr (u32)
// 24: megaValsPtr (u32)
// 28: monoHits (u32)
// 32: polyHits (u32)
// 36: megaHits (u32)
// 40: misses (u32)
// 44: polyDataPtr (u32)       (4 * 8 = 32 bytes: [key: u32, ruleId: u32] x 4)
const PIC_HEADER_BYTES: u32 = 48;
const PIC_POLY_SLOTS: u32 = 4;
const PIC_EMPTY_VAL: u32 = 0xffffffff;
const PIC_EMPTY_KEY: u32 = 0xffffffff;

const OFF_MONO_KEY: usize = 0;
const OFF_MONO_VAL: usize = 4;
const OFF_POLY_COUNT: usize = 8;
const OFF_MEGA_CAP: usize = 12;
const OFF_MEGA_COUNT: usize = 16;
const OFF_MEGA_KEYS: usize = 20;
const OFF_MEGA_VALS: usize = 24;
const OFF_MONO_HITS: usize = 28;
const OFF_POLY_HITS: usize = 32;
const OFF_MEGA_HITS: usize = 36;
const OFF_MISSES: usize = 40;
const OFF_POLY_DATA: usize = 44;

@inline
function hashKey(key: u32): u32 {
  let x = key;
  x ^= x >> 16;
  x = x * 0x7feb352d;
  x ^= x >> 15;
  x = x * 0x846ca68b;
  x ^= x >> 16;
  return x;
}

/**
 * Packs `(sourceDomainId, sourceKindTag, targetDomainId)` into a single 32-bit dispatch key.
 */
export function pic_packKey(sourceDomainId: u32, sourceKindTag: u32, targetDomainId: u32): u32 {
  return ((sourceDomainId & 0xff) << 24) | ((sourceKindTag & 0xffff) << 8) | (targetDomainId & 0xff);
}

/**
 * Allocates a new linear-memory PIC table with `initialMegaCapacity` (rounded to power of 2, min 16).
 */
export function pic_create(initialMegaCapacity: u32 = 64): usize {
  let cap: u32 = 16;
  while (cap < initialMegaCapacity) cap <<= 1;

  let ptr = atomicChunkAlloc(PIC_HEADER_BYTES);
  let polyPtr = atomicChunkAlloc(PIC_POLY_SLOTS * 8);
  let keysPtr = atomicChunkAlloc(cap * 4);
  let valsPtr = atomicChunkAlloc(cap * 4);

  store<u32>(ptr + OFF_MONO_KEY, PIC_EMPTY_KEY);
  store<u32>(ptr + OFF_MONO_VAL, PIC_EMPTY_VAL);
  store<u32>(ptr + OFF_POLY_COUNT, 0);
  store<u32>(ptr + OFF_MEGA_CAP, cap);
  store<u32>(ptr + OFF_MEGA_COUNT, 0);
  store<u32>(ptr + OFF_MEGA_KEYS, keysPtr as u32);
  store<u32>(ptr + OFF_MEGA_VALS, valsPtr as u32);
  store<u32>(ptr + OFF_MONO_HITS, 0);
  store<u32>(ptr + OFF_POLY_HITS, 0);
  store<u32>(ptr + OFF_MEGA_HITS, 0);
  store<u32>(ptr + OFF_MISSES, 0);
  store<u32>(ptr + OFF_POLY_DATA, polyPtr as u32);

  for (let i: u32 = 0; i < PIC_POLY_SLOTS; i++) {
    store<u32>(polyPtr + (i as usize) * 8, PIC_EMPTY_KEY);
    store<u32>(polyPtr + (i as usize) * 8 + 4, PIC_EMPTY_VAL);
  }
  for (let i: u32 = 0; i < cap; i++) {
    store<u32>(keysPtr + (i as usize) * 4, PIC_EMPTY_KEY);
    store<u32>(valsPtr + (i as usize) * 4, PIC_EMPTY_VAL);
  }

  return ptr;
}

/**
 * Frees all linear-memory buffers owned by the PIC table.
 */
export function pic_destroy(ptr: usize): void {
  if (ptr == 0) return;
  let polyPtr = load<u32>(ptr + OFF_POLY_DATA) as usize;
  let keysPtr = load<u32>(ptr + OFF_MEGA_KEYS) as usize;
  let valsPtr = load<u32>(ptr + OFF_MEGA_VALS) as usize;
  if (polyPtr != 0) atomicChunkFree(polyPtr);
  if (keysPtr != 0) atomicChunkFree(keysPtr);
  if (valsPtr != 0) atomicChunkFree(valsPtr);
  atomicChunkFree(ptr);
}

function megaGrow(ptr: usize): void {
  let oldCap = load<u32>(ptr + OFF_MEGA_CAP);
  let newCap = oldCap << 1;
  let oldKeys = load<u32>(ptr + OFF_MEGA_KEYS) as usize;
  let oldVals = load<u32>(ptr + OFF_MEGA_VALS) as usize;

  let newKeys = atomicChunkAlloc(newCap * 4);
  let newVals = atomicChunkAlloc(newCap * 4);
  for (let i: u32 = 0; i < newCap; i++) {
    store<u32>(newKeys + (i as usize) * 4, PIC_EMPTY_KEY);
    store<u32>(newVals + (i as usize) * 4, PIC_EMPTY_VAL);
  }

  let mask = newCap - 1;
  for (let i: u32 = 0; i < oldCap; i++) {
    let k = load<u32>(oldKeys + (i as usize) * 4);
    if (k != PIC_EMPTY_KEY) {
      let v = load<u32>(oldVals + (i as usize) * 4);
      let slot = hashKey(k) & mask;
      while (load<u32>(newKeys + (slot as usize) * 4) != PIC_EMPTY_KEY) {
        slot = (slot + 1) & mask;
      }
      store<u32>(newKeys + (slot as usize) * 4, k);
      store<u32>(newVals + (slot as usize) * 4, v);
    }
  }

  atomicChunkFree(oldKeys);
  atomicChunkFree(oldVals);
  store<u32>(ptr + OFF_MEGA_CAP, newCap);
  store<u32>(ptr + OFF_MEGA_KEYS, newKeys as u32);
  store<u32>(ptr + OFF_MEGA_VALS, newVals as u32);
}

/**
 * Registers or updates a dispatch mapping `key -> ruleId` in the megamorphic backing table
 * and invalidates stale monomorphic/polymorphic cache slots for `key`.
 */
export function pic_register(ptr: usize, key: u32, ruleId: u32): void {
  if (ptr == 0 || key == PIC_EMPTY_KEY) return;

  // Keep monomorphic slot coherent if it already caches this key
  if (load<u32>(ptr + OFF_MONO_KEY) == key) {
    store<u32>(ptr + OFF_MONO_VAL, ruleId);
  }
  // Keep polymorphic slots coherent
  let polyPtr = load<u32>(ptr + OFF_POLY_DATA) as usize;
  let polyCount = load<u32>(ptr + OFF_POLY_COUNT);
  for (let i: u32 = 0; i < polyCount; i++) {
    if (load<u32>(polyPtr + (i as usize) * 8) == key) {
      store<u32>(polyPtr + (i as usize) * 8 + 4, ruleId);
    }
  }

  let cap = load<u32>(ptr + OFF_MEGA_CAP);
  let count = load<u32>(ptr + OFF_MEGA_COUNT);
  if ((count + 1) * 10 >= cap * 7) {
    megaGrow(ptr);
    cap = load<u32>(ptr + OFF_MEGA_CAP);
  }

  let keysPtr = load<u32>(ptr + OFF_MEGA_KEYS) as usize;
  let valsPtr = load<u32>(ptr + OFF_MEGA_VALS) as usize;
  let mask = cap - 1;
  let slot = hashKey(key) & mask;

  while (true) {
    let existing = load<u32>(keysPtr + (slot as usize) * 4);
    if (existing == PIC_EMPTY_KEY) {
      store<u32>(keysPtr + (slot as usize) * 4, key);
      store<u32>(valsPtr + (slot as usize) * 4, ruleId);
      store<u32>(ptr + OFF_MEGA_COUNT, count + 1);
      return;
    }
    if (existing == key) {
      store<u32>(valsPtr + (slot as usize) * 4, ruleId);
      return;
    }
    slot = (slot + 1) & mask;
  }
}

/**
 * Looks up `ruleId` for `key` using the 3-tier PIC hierarchy:
 *   1. Monomorphic 1-slot check
 *   2. 4-way polymorphic cache line scan
 *   3. Open-addressed megamorphic hash table (promoting hit to mono/poly)
 * Returns `-1` (`0xffffffff`) on miss.
 */
export function pic_lookup(ptr: usize, key: u32): i32 {
  if (ptr == 0 || key == PIC_EMPTY_KEY) return -1;

  // Tier 1: Monomorphic fast path
  if (load<u32>(ptr + OFF_MONO_KEY) == key) {
    store<u32>(ptr + OFF_MONO_HITS, load<u32>(ptr + OFF_MONO_HITS) + 1);
    return load<u32>(ptr + OFF_MONO_VAL) as i32;
  }

  // Tier 2: 4-way polymorphic cache line
  let polyPtr = load<u32>(ptr + OFF_POLY_DATA) as usize;
  let polyCount = load<u32>(ptr + OFF_POLY_COUNT);
  for (let i: u32 = 0; i < polyCount; i++) {
    let base = polyPtr + (i as usize) * 8;
    if (load<u32>(base) == key) {
      let val = load<u32>(base + 4);
      store<u32>(ptr + OFF_POLY_HITS, load<u32>(ptr + OFF_POLY_HITS) + 1);
      // Promote to monomorphic slot
      store<u32>(ptr + OFF_MONO_KEY, key);
      store<u32>(ptr + OFF_MONO_VAL, val);
      return val as i32;
    }
  }

  // Tier 3: Megamorphic open-addressed hash table
  let cap = load<u32>(ptr + OFF_MEGA_CAP);
  let keysPtr = load<u32>(ptr + OFF_MEGA_KEYS) as usize;
  let valsPtr = load<u32>(ptr + OFF_MEGA_VALS) as usize;
  let mask = cap - 1;
  let slot = hashKey(key) & mask;

  for (let probe: u32 = 0; probe < cap; probe++) {
    let k = load<u32>(keysPtr + (slot as usize) * 4);
    if (k == PIC_EMPTY_KEY) break;
    if (k == key) {
      let val = load<u32>(valsPtr + (slot as usize) * 4);
      store<u32>(ptr + OFF_MEGA_HITS, load<u32>(ptr + OFF_MEGA_HITS) + 1);
      // Promote into mono + poly cache line
      store<u32>(ptr + OFF_MONO_KEY, key);
      store<u32>(ptr + OFF_MONO_VAL, val);
      if (polyCount < PIC_POLY_SLOTS) {
        let pBase = polyPtr + (polyCount as usize) * 8;
        store<u32>(pBase, key);
        store<u32>(pBase + 4, val);
        store<u32>(ptr + OFF_POLY_COUNT, polyCount + 1);
      } else {
        // Evict slot 0 (FIFO shift)
        for (let j: u32 = 0; j < PIC_POLY_SLOTS - 1; j++) {
          let dst = polyPtr + (j as usize) * 8;
          let src = polyPtr + ((j + 1) as usize) * 8;
          store<u32>(dst, load<u32>(src));
          store<u32>(dst + 4, load<u32>(src + 4));
        }
        let tail = polyPtr + ((PIC_POLY_SLOTS - 1) as usize) * 8;
        store<u32>(tail, key);
        store<u32>(tail + 4, val);
      }
      return val as i32;
    }
    slot = (slot + 1) & mask;
  }

  store<u32>(ptr + OFF_MISSES, load<u32>(ptr + OFF_MISSES) + 1);
  return -1;
}

export function pic_getMonoHits(ptr: usize): u32 {
  return ptr == 0 ? 0 : load<u32>(ptr + OFF_MONO_HITS);
}

export function pic_getPolyHits(ptr: usize): u32 {
  return ptr == 0 ? 0 : load<u32>(ptr + OFF_POLY_HITS);
}

export function pic_getMegaHits(ptr: usize): u32 {
  return ptr == 0 ? 0 : load<u32>(ptr + OFF_MEGA_HITS);
}

export function pic_getMisses(ptr: usize): u32 {
  return ptr == 0 ? 0 : load<u32>(ptr + OFF_MISSES);
}

// ── Compact AOT TGG Rule Bytecode Executor ───────────────────────────
// Each instruction is 2 x u32 (8 bytes): [opcode: u32, operand: u32].
export const TGG_OP_HALT: u32 = 0;
export const TGG_OP_MATCH_TRAIT: u32 = 1; // operand = required InteropTrait bitmask; fails if (srcTraits & operand) != operand
export const TGG_OP_COPY_PARAM: u32 = 2; // operand = paramHash; increments copied-param counter
export const TGG_OP_MAP_PORT_CONJUGATED: u32 = 3; // operand = portHash; increments mapped-port counter
export const TGG_OP_LINK_CORR: u32 = 4; // operand = relationId; marks link-emitted bit

/**
 * Executes a compact AOT TGG rule bytecode buffer in linear memory.
 * Returns packed status:
 *   - `-1` if a `MATCH_TRAIT` guard failed
 *   - Otherwise `(linkedFlag << 24) | (mappedPorts << 12) | (copiedParams & 0xfff)`
 */
export function tgg_execBytecode(codePtr: usize, instrCount: u32, srcTraits: u32): i32 {
  if (codePtr == 0) return -1;
  let copiedParams: u32 = 0;
  let mappedPorts: u32 = 0;
  let linked: u32 = 0;

  for (let i: u32 = 0; i < instrCount; i++) {
    let base = codePtr + (i as usize) * 8;
    let op = load<u32>(base);
    let operand = load<u32>(base + 4);
    if (op == TGG_OP_HALT) break;
    if (op == TGG_OP_MATCH_TRAIT) {
      if ((srcTraits & operand) != operand) return -1;
    } else if (op == TGG_OP_COPY_PARAM) {
      copiedParams++;
    } else if (op == TGG_OP_MAP_PORT_CONJUGATED) {
      mappedPorts++;
    } else if (op == TGG_OP_LINK_CORR) {
      linked = 1;
    }
  }

  return (((linked & 1) << 24) | ((mappedPorts & 0xfff) << 12) | (copiedParams & 0xfff)) as i32;
}
