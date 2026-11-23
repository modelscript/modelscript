// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime for `@modelscript/jedec-std-lib`.
 *
 * Implements deterministic PLD architecture sizing (`PAL16L8`, `PAL16R8`, `GAL16V8`, `GAL22V10`)
 * and fuse-array utilization kernels in WebAssembly.
 */

const ARCH_PAL16L8: i32 = 1;
const ARCH_PAL16R8: i32 = 2;
const ARCH_GAL16V8: i32 = 3;
const ARCH_GAL22V10: i32 = 4;

/**
 * Returns the canonical total fuse count (`QF`) for a classic 1980s PLD archetype ID.
 */
export function jedecFuseCountForDevice(archetypeId: i32): i32 {
  if (archetypeId == ARCH_PAL16L8) return 2048;
  if (archetypeId == ARCH_PAL16R8) return 2048;
  if (archetypeId == ARCH_GAL16V8) return 2194;
  if (archetypeId == ARCH_GAL22V10) return 5892;
  return 0;
}

/**
 * Returns the canonical package pin count (`QP`) for a classic 1980s PLD archetype ID.
 */
export function jedecPinCountForDevice(archetypeId: i32): i32 {
  if (archetypeId == ARCH_PAL16L8) return 20;
  if (archetypeId == ARCH_PAL16R8) return 20;
  if (archetypeId == ARCH_GAL16V8) return 20;
  if (archetypeId == ARCH_GAL22V10) return 24;
  return 0;
}

/**
 * Computes fuse utilization ratio (`blownFuses / totalFuses`) in `[0.0, 1.0]`.
 */
export function jedecBlownFuseRatio(blownFuses: i32, totalFuses: i32): f64 {
  if (totalFuses <= 0) return 0.0;
  return (<f64>blownFuses) / (<f64>totalFuses);
}

/**
 * Computes the JESD3 16-bit fuse checksum contribution of an 8-bit fuse byte added to an accumulator.
 */
export function jedecChecksumAccumulateByte(acc: i32, fuseByte: i32): i32 {
  return (acc + (fuseByte & 0xff)) & 0xffff;
}
