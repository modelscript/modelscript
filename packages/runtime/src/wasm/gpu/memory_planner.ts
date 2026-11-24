// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript XLA-Style Static Linear-Memory Planner Kernel.
 * Performs birth-sorted greedy interval graph coloring for transient DAE variables
 * to minimize scratchpad memory footprint with zero GC overhead.
 */

/**
 * Assigns scratchpad offsets [persistentCount .. persistentCount + peakScratchpad - 1]
 * to all non-removed transient variables (isPersistent[i] == 0 && isRemoved[i] == 0).
 *
 * - birthPtr, deathPtr: i32[varCount]
 * - isPersistentPtr, isRemovedPtr: u8[varCount]
 * - outOffsetsPtr: i32[varCount] (persistent slots already filled; transient slots written here)
 * - workTransPtr: scratch i32[varCount]
 * - workSlotsPtr: scratch i32[varCount]
 * Returns peakScratchpad slot count.
 */
export function gpu_greedyIntervalColoring(
  varCount: i32,
  persistentCount: i32,
  birthPtr: usize,
  deathPtr: usize,
  isPersistentPtr: usize,
  isRemovedPtr: usize,
  outOffsetsPtr: usize,
  workTransPtr: usize,
  workSlotsPtr: usize,
): i32 {
  // 1. Collect transient variables
  let tCount: i32 = 0;
  for (let i: i32 = 0; i < varCount; i++) {
    if (load<u8>(isRemovedPtr + <usize>i) == 0 && load<u8>(isPersistentPtr + <usize>i) == 0) {
      store<i32>(workTransPtr + ((<usize>tCount) << 2), i);
      tCount++;
    }
  }
  if (tCount == 0) return 0;

  // 2. Stable insertion sort by birthBlock (nearly sorted in BLT order)
  for (let i: i32 = 1; i < tCount; i++) {
    const keyVar = load<i32>(workTransPtr + ((<usize>i) << 2));
    const keyBirth = load<i32>(birthPtr + ((<usize>keyVar) << 2));
    let j: i32 = i - 1;
    while (j >= 0) {
      const prevVar = load<i32>(workTransPtr + ((<usize>j) << 2));
      if (load<i32>(birthPtr + ((<usize>prevVar) << 2)) > keyBirth) {
        store<i32>(workTransPtr + ((<usize>(j + 1)) << 2), prevVar);
        j--;
      } else {
        break;
      }
    }
    store<i32>(workTransPtr + ((<usize>(j + 1)) << 2), keyVar);
  }

  // 3. Greedy interval coloring
  let activeLen: i32 = 0;
  let peakScratchpad: i32 = 0;

  for (let idx: i32 = 0; idx < tCount; idx++) {
    const v = load<i32>(workTransPtr + ((<usize>idx) << 2));
    const birth = load<i32>(birthPtr + ((<usize>v) << 2));
    const death = load<i32>(deathPtr + ((<usize>v) << 2));

    let assignedSlot: i32 = -1;
    for (let s: i32 = 0; s < activeLen; s++) {
      if (load<i32>(workSlotsPtr + ((<usize>s) << 2)) < birth) {
        assignedSlot = s;
        store<i32>(workSlotsPtr + ((<usize>s) << 2), death);
        break;
      }
    }

    if (assignedSlot == -1) {
      assignedSlot = activeLen;
      store<i32>(workSlotsPtr + ((<usize>activeLen) << 2), death);
      activeLen++;
    }

    if (activeLen > peakScratchpad) {
      peakScratchpad = activeLen;
    }

    store<i32>(outOffsetsPtr + ((<usize>v) << 2), persistentCount + assignedSlot);
  }

  return peakScratchpad;
}
