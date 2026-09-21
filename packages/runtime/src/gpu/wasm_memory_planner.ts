// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * XLA-Style Static Linear-Memory Planner for DAE Arenas.
 *
 * Performs liveness analysis across the BLT execution schedule to map
 * sparse, variable-count-bounded DAE memory into a dense, cache-aligned
 * packed buffer with maximum memory reuse for transient algebraic variables.
 */

import { type ArenaBltResult, collectArenaExprDeps } from "../analysis/wasm_blt.js";
import { Causality, DAEBuilder, Variability } from "../dae/wasm_dae.js";

export interface VariableLiveness {
  varIdx: number;
  name: string;
  nameId: number;
  isPersistent: boolean;
  birth: number;
  death: number;
}

export interface PackedMemoryLayout {
  /** Map from global varIdx -> packed buffer offset. */
  varIdxToOffset: Int32Array;
  /** Map from string pool nameId -> packed buffer offset (sparse lookup). */
  nameIdToOffset: Map<number, number>;
  /** Total number of persistent variable slots. */
  persistentCount: number;
  /** Peak number of scratchpad slots required for transient variables. */
  scratchpadCount: number;
  /** Total packed buffer size (persistentCount + scratchpadCount). */
  totalPackedSize: number;
  /** Detailed liveness diagnostics for each variable. */
  liveness: VariableLiveness[];
  /** Memory savings ratio: (1 - totalPackedSize / varCount). */
  compressionRatio: number;
}

/**
 * Plan static memory allocation for an arena DAE model based on its BLT schedule.
 */
export function planStaticArenaMemory(
  arena: DAEBuilder,
  bltResult: ArenaBltResult,
  stateVars?: Set<string | number>,
  derivativeVars?: Set<string | number>,
): PackedMemoryLayout {
  const varCount = arena.varCount;
  const blocks = bltResult.blocks;
  const numBlocks = blocks.length;

  // 1. Collect block dependencies (definitions and uses)
  const blockDefs: Set<number>[] = [];
  const blockUses: Set<number>[] = [];

  for (let b = 0; b < numBlocks; b++) {
    const blk = blocks[b]!;
    const defs = new Set<number>();
    const uses = new Set<number>();

    // Solved variables in this block are definitions
    for (const v of blk.vars) {
      defs.add(v);
    }

    // Expressions in this block define uses
    for (const eqIdx of blk.eqIdxs) {
      const lhs = arena.getEqLhs(eqIdx);
      const rhs = arena.getEqRhs(eqIdx);
      const eqDeps = new Set<number>();
      collectArenaExprDeps(arena, lhs, eqDeps, true);
      collectArenaExprDeps(arena, rhs, eqDeps, true);
      for (const d of eqDeps) {
        if (!defs.has(d)) {
          uses.add(d);
        }
      }
    }

    blockDefs.push(defs);
    blockUses.push(uses);
  }

  // 2. Identify persistent vs. transient variables
  const isPersistent = new Uint8Array(varCount);
  const birthBlock = new Int32Array(varCount).fill(-1);
  const deathBlock = new Int32Array(varCount).fill(-1);

  for (let i = 0; i < varCount; i++) {
    if (arena.isVarRemoved(i)) continue;

    const variability = arena.getVarVariability(i);
    const causality = arena.getVarCausality(i);
    const varName = arena.getVarName(i);
    const isDer = varName.startsWith("der(");

    // Persistent criteria:
    // - States (x) and derivatives (der(x))
    // - Parameters and Constants
    // - Inputs and Outputs (interface variables)
    // - Explicitly designated state or derivative variables
    const isState =
      stateVars?.has(i) || stateVars?.has(varName) || derivativeVars?.has(i) || derivativeVars?.has(varName) || isDer;
    const isParam = variability === Variability.Parameter || variability === Variability.Constant;
    const isIO = causality === Causality.Input || causality === Causality.Output;

    if (isState || isParam || isIO) {
      isPersistent[i] = 1;
      birthBlock[i] = 0;
      deathBlock[i] = numBlocks;
    }
  }

  // 3. Compute liveness for transient variables
  for (let b = 0; b < numBlocks; b++) {
    for (const v of blockDefs[b]!) {
      if (v < varCount && isPersistent[v] === 0) {
        if (birthBlock[v] === -1) birthBlock[v] = b;
        if (deathBlock[v] < b) deathBlock[v] = b;
      }
    }
    for (const v of blockUses[b]!) {
      if (v < varCount && isPersistent[v] === 0) {
        if (birthBlock[v] === -1) birthBlock[v] = b;
        if (deathBlock[v] < b) deathBlock[v] = b;
      }
    }
  }

  // If a variable is never defined or used in blocks, treat as persistent (e.g. unreferenced start value)
  for (let i = 0; i < varCount; i++) {
    if (!arena.isVarRemoved(i) && isPersistent[i] === 0 && birthBlock[i] === -1) {
      isPersistent[i] = 1;
      birthBlock[i] = 0;
      deathBlock[i] = numBlocks;
    }
  }

  // 4. Allocate Persistent Variable Slots: [0 ... P - 1]
  const varIdxToOffset = new Int32Array(varCount).fill(-1);
  const nameIdToOffset = new Map<number, number>();
  let persistentCount = 0;

  for (let i = 0; i < varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    if (isPersistent[i] === 1) {
      const offset = persistentCount++;
      varIdxToOffset[i] = offset;
      nameIdToOffset.set(arena.getVarNameId(i), offset);
    }
  }

  // 5. Greedy Interval Coloring for Transient Scratchpad Slots: [P ... P + S - 1]
  const transientVars: number[] = [];
  for (let i = 0; i < varCount; i++) {
    if (!arena.isVarRemoved(i) && isPersistent[i] === 0) {
      transientVars.push(i);
    }
  }

  // Sort transient variables by birth block
  transientVars.sort((a, b) => birthBlock[a]! - birthBlock[b]!);

  // Active slots tracking: slotIndex -> deathBlock
  const activeSlots: number[] = [];
  let peakScratchpad = 0;

  for (const v of transientVars) {
    const birth = birthBlock[v]!;
    const death = deathBlock[v]!;

    // Find a free slot whose occupant died before this birth
    let assignedSlot = -1;
    for (let s = 0; s < activeSlots.length; s++) {
      if (activeSlots[s]! < birth) {
        assignedSlot = s;
        activeSlots[s] = death;
        break;
      }
    }

    if (assignedSlot === -1) {
      assignedSlot = activeSlots.length;
      activeSlots.push(death);
    }

    if (activeSlots.length > peakScratchpad) {
      peakScratchpad = activeSlots.length;
    }

    const packedOffset = persistentCount + assignedSlot;
    varIdxToOffset[v] = packedOffset;
    nameIdToOffset.set(arena.getVarNameId(v), packedOffset);
  }

  const totalPackedSize = persistentCount + peakScratchpad;

  // Compile detailed liveness report
  const liveness: VariableLiveness[] = [];
  for (let i = 0; i < varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    liveness.push({
      varIdx: i,
      name: arena.getVarName(i),
      nameId: arena.getVarNameId(i),
      isPersistent: isPersistent[i] === 1,
      birth: birthBlock[i]!,
      death: deathBlock[i]!,
    });
  }

  const compressionRatio = varCount > 0 ? 1 - totalPackedSize / varCount : 0;

  return {
    varIdxToOffset,
    nameIdToOffset,
    persistentCount,
    scratchpadCount: peakScratchpad,
    totalPackedSize,
    liveness,
    compressionRatio,
  };
}

/**
 * Creates a packed contiguous Float64Array sized exactly to the memory plan.
 */
export function createPackedBuffer(layout: PackedMemoryLayout): Float64Array {
  return new Float64Array(layout.totalPackedSize);
}

/**
 * Pack values from a sparse string-pool-indexed buffer into the packed layout.
 */
export function packFromSparse(
  layout: PackedMemoryLayout,
  sparseBuffer: Float64Array,
  packedBuffer: Float64Array,
): void {
  for (const [nameId, offset] of layout.nameIdToOffset) {
    if (nameId < sparseBuffer.length) {
      packedBuffer[offset] = sparseBuffer[nameId]!;
    }
  }
}

/**
 * Unpack values from the packed layout back to a sparse string-pool-indexed buffer.
 */
export function unpackToSparse(
  layout: PackedMemoryLayout,
  packedBuffer: Float64Array,
  sparseBuffer: Float64Array,
): void {
  for (const [nameId, offset] of layout.nameIdToOffset) {
    if (nameId < sparseBuffer.length && offset < packedBuffer.length) {
      sparseBuffer[nameId] = packedBuffer[offset]!;
    }
  }
}
