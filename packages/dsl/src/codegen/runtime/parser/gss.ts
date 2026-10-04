// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Graph-Structured Stack (GSS) for WebAssembly GLR Parser.
 *
 * Implements the core Graph-Structured Stack (GSS) runtime supporting Generalized
 * LR (GLR / RNGLR) parsing of engineering DSLs within WebAssembly linear memory.
 *
 * Academic Citations:
 *   - Tomita, M. (1985). Efficient Parsing for Natural Language: A Fast Generalized LR Algorithm.
 *     Kluwer Academic Publishers. DOI: 10.1007/978-1-4613-2621-2.
 *   - Scott, E., & Johnstone, A. (2006). "Right Numerate Generalized LR Parsers."
 *     ACM Transactions on Programming Languages and Systems (TOPLAS), 28(4), pp. 577–618.
 *     DOI: 10.1145/1176894.1176896. (RNGLR Algorithm)
 *   - McPeak, S., & Necula, G. C. (2004). "Elkhound: A fast, practical GLR parser generator."
 *     In International Conference on Compiler Construction (CC 2004), LNCS 2985, pp. 73–88.
 *     Springer. DOI: 10.1007/978-3-540-24723-4_6.
 *
 * ModelScript Architectural Rationale:
 *   Domain-specific languages like Modelica and SysML v2 feature non-LR(k) grammatical constructs
 *   (e.g., expression vs. component declaration ambiguities, type prefix modifiers). A GLR parser
 *   handles nondeterministic branching by splitting and merging parse paths using the GSS,
 *   enabling expressive, declarative grammars without fragile manual lookahead hacks.
 *
 * Modifications:
 *   - Implemented entirely in WebAssembly linear memory with zero GC allocations.
 *   - Active, next, and candidate stack heads reside in contiguous unmanaged buffers (`t_activeHeads`).
 *   - Fast fixed-size power-of-two hash probing (`HEAD_PROBE_SIZE = 2048`) for O(1) stack head merging.
 *   - Direct integration with incremental error recovery and CST node arena allocation.
 */

/* eslint-disable */
import {
  allocGen0,
  getNodeFirstChild,
  getNodeNextSibling,
  getNodePadding,
  getNodeByteLength,
  getNodeType,
  setNodeFlags,
  FLAG_LSP_VISITED,
  FLAG_INVISIBLE,
  FLAG_HAS_ERROR,
  getNodeFlags,
  FLAG_IS_INSERTED,
  FLAG_FRAGILE,
  treeCursorAlloc,
  treeCursorReset,
  treeCursorCurrentNode,
  treeCursorCurrentOffset,
  treeCursorDepth,
  treeCursorGotoFirstChild,
  treeCursorGotoNextSibling,
  treeCursorGotoParent,
  treeCursorNodeAtDepth,
  treeCursorOffsetAtDepth,
  TREE_CURSOR_SIZE,
} from "../arena";

import { ChunkedUint32Array, UnmanagedUint32Array, createChunkedUint32Array } from "../core/array";
import { debugLog } from "./engine";

export const ARENA_BUFFER_SIZE: i32 = 16384;
const MAX_CURSOR_DEPTH: i32 = 999999;

export let t_activeHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_nextHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_extractedHeadsBuffer: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_candidateHeadsBuffer: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let activeHeadsCount: u32 = 0;
export let nextHeadsCount: u32 = 0;
export let candidateHeadsCount: u32 = 0;
export let t_pausedHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let pausedHeadsCount: u32 = 0;

export const HEAD_PROBE_SIZE: u32 = 2048;
export const HEAD_PROBE_MASK: u32 = 2047;
export let t_activeHeadProbe: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_nextHeadProbe: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);

/**
 * Initializes the Graph-Structured Stack (GSS) active and next heads buffer memory.
 */
export function initGSS(): void {
  if (changetype<usize>(t_activeHeads) == 0) {
    t_activeHeads = changetype<UnmanagedUint32Array>(heap.alloc(ARENA_BUFFER_SIZE * 4));
  }
  if (changetype<usize>(t_nextHeads) == 0) {
    t_nextHeads = changetype<UnmanagedUint32Array>(heap.alloc(ARENA_BUFFER_SIZE * 4));
  }
  if (changetype<usize>(t_extractedHeadsBuffer) == 0) {
    t_extractedHeadsBuffer = changetype<UnmanagedUint32Array>(heap.alloc(ARENA_BUFFER_SIZE * 4));
  }
  if (changetype<usize>(t_candidateHeadsBuffer) == 0) {
    t_candidateHeadsBuffer = changetype<UnmanagedUint32Array>(heap.alloc(64 * 4));
  }
  if (changetype<usize>(t_pausedHeads) == 0) {
    t_pausedHeads = changetype<UnmanagedUint32Array>(heap.alloc(64 * 4));
  }
  if (changetype<usize>(t_activeHeadProbe) == 0) {
    t_activeHeadProbe = changetype<UnmanagedUint32Array>(heap.alloc(HEAD_PROBE_SIZE * 4));
    memory.fill(changetype<usize>(t_activeHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
  if (changetype<usize>(t_nextHeadProbe) == 0) {
    t_nextHeadProbe = changetype<UnmanagedUint32Array>(heap.alloc(HEAD_PROBE_SIZE * 4));
    memory.fill(changetype<usize>(t_nextHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
  if (changetype<usize>(t_activeSummary) == 0) {
    t_activeSummary = changetype<FrontierSummary>(heap.alloc(FS_SIZE));
  }
  if (changetype<usize>(t_nextSummary) == 0) {
    t_nextSummary = changetype<FrontierSummary>(heap.alloc(FS_SIZE));
  }
  resetFrontierSummary(t_activeSummary);
  resetFrontierSummary(t_nextSummary);
  activeHeadsCount = 0;
  nextHeadsCount = 0;
  candidateHeadsCount = 0;
  pausedHeadsCount = 0;
}

export function resetGSSProbe(): void {
  if (changetype<usize>(t_activeHeadProbe) != 0) {
    memory.fill(changetype<usize>(t_activeHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
  if (changetype<usize>(t_nextHeadProbe) != 0) {
    memory.fill(changetype<usize>(t_nextHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
}

export function resetPausedHeads(): void {
  pausedHeadsCount = 0;
}

/**
 * Pushes a parse head candidate into the static zero-alloc candidate pool buffer.
 */
export function pushCandidateHead(headPtr: u32): boolean {
  if (candidateHeadsCount >= 64) return false;
  let newHead = changetype<ParseHead>(headPtr);
  for (let i: u32 = 0; i < candidateHeadsCount; i++) {
    let existingHead = changetype<ParseHead>(t_candidateHeadsBuffer[i]);
    if (existingHead.state == newHead.state && existingHead.pos == newHead.pos && existingHead.balanceHash == newHead.balanceHash) {
      if (newHead.errorCost < existingHead.errorCost) {
        t_candidateHeadsBuffer[i] = headPtr;
      }
      return true;
    }
  }
  t_candidateHeadsBuffer[candidateHeadsCount++] = headPtr;
  return true;
}

export const MAX_COST_DIFFERENCE: i32 = 7000;

export let debugVerifyFrontierPruning: bool = false;
export let configEnableActivePruning: bool = true;
export let gssBestAcceptingHead: u32 = 0;
export let gssBestDyingHead: u32 = 0;

/**
 * FrontierSummary byte layout. The class lives in a raw `FS_SIZE`-byte block (see initGSS):
 * a 64-byte scalar header (fields below, hasOverflow at 64), then eight-slot (32-byte)
 * arrays, then the unconfirmed-repair counter. Keep these in sync with the field list.
 */
const FS_OFF_HEALTHY_POS: usize = 68;
const FS_OFF_HEALTHY_COST: usize = FS_OFF_HEALTHY_POS + 32;
const FS_OFF_NONPAUSED_POS: usize = FS_OFF_HEALTHY_COST + 32;
const FS_OFF_NONPAUSED_COST: usize = FS_OFF_NONPAUSED_POS + 32;
const FS_OFF_PARETO_ERR_COST: usize = FS_OFF_NONPAUSED_COST + 32;
const FS_OFF_PARETO_ERR_NODES: usize = FS_OFF_PARETO_ERR_COST + 32;
const FS_OFF_PARETO_HEALTHY_COST: usize = FS_OFF_PARETO_ERR_NODES + 32;
const FS_OFF_PARETO_HEALTHY_NODES: usize = FS_OFF_PARETO_HEALTHY_COST + 32;
const FS_OFF_UNCONFIRMED_REPAIRS: usize = FS_OFF_PARETO_HEALTHY_NODES + 32;
const FS_SIZE: usize = 512;
// The scalar header must end before the first array, and everything must fit in the block.
assert(offsetof<FrontierSummary>("hasOverflow") < FS_OFF_HEALTHY_POS);
assert(FS_OFF_UNCONFIRMED_REPAIRS + 4 <= FS_SIZE);

@unmanaged
export class FrontierSummary {
  healthyCount: u32;
  minHealthyCost: i32;
  minHealthyCostPos: u32;
  maxHealthyPos: u32;
  maxHealthyNodeCount: u32;

  nonPausedCount: u32;
  minNonPausedCost: i32;
  minNonPausedCostPos: u32;
  maxNonPausedPos: u32;

  inErrorCount: u32;
  minInErrorCost: i32;
  maxInErrorNodeCount: u32;

  posHealthyCount: u32;
  posNonPausedCount: u32;
  paretoErrCount: u32;
  paretoHealthyCount: u32;
  hasOverflow: bool;

  @inline getHealthyPos(i: i32): u32 {
    return load<u32>(changetype<usize>(this) + FS_OFF_HEALTHY_POS + ((i as usize) << 2));
  }
  @inline setHealthyPos(i: i32, val: u32): void {
    store<u32>(changetype<usize>(this) + FS_OFF_HEALTHY_POS + ((i as usize) << 2), val);
  }
  @inline getHealthyCost(i: i32): i32 {
    return load<i32>(changetype<usize>(this) + FS_OFF_HEALTHY_COST + ((i as usize) << 2));
  }
  @inline setHealthyCost(i: i32, val: i32): void {
    store<i32>(changetype<usize>(this) + FS_OFF_HEALTHY_COST + ((i as usize) << 2), val);
  }

  @inline getNonPausedPos(i: i32): u32 {
    return load<u32>(changetype<usize>(this) + FS_OFF_NONPAUSED_POS + ((i as usize) << 2));
  }
  @inline setNonPausedPos(i: i32, val: u32): void {
    store<u32>(changetype<usize>(this) + FS_OFF_NONPAUSED_POS + ((i as usize) << 2), val);
  }
  @inline getNonPausedCost(i: i32): i32 {
    return load<i32>(changetype<usize>(this) + FS_OFF_NONPAUSED_COST + ((i as usize) << 2));
  }
  @inline setNonPausedCost(i: i32, val: i32): void {
    store<i32>(changetype<usize>(this) + FS_OFF_NONPAUSED_COST + ((i as usize) << 2), val);
  }

  @inline getParetoErrCost(i: i32): i32 {
    return load<i32>(changetype<usize>(this) + FS_OFF_PARETO_ERR_COST + ((i as usize) << 2));
  }
  @inline setParetoErrCost(i: i32, val: i32): void {
    store<i32>(changetype<usize>(this) + FS_OFF_PARETO_ERR_COST + ((i as usize) << 2), val);
  }
  @inline getParetoErrNodes(i: i32): u32 {
    return load<u32>(changetype<usize>(this) + FS_OFF_PARETO_ERR_NODES + ((i as usize) << 2));
  }
  @inline setParetoErrNodes(i: i32, val: u32): void {
    store<u32>(changetype<usize>(this) + FS_OFF_PARETO_ERR_NODES + ((i as usize) << 2), val);
  }

  @inline getParetoHealthyCost(i: i32): i32 {
    return load<i32>(changetype<usize>(this) + FS_OFF_PARETO_HEALTHY_COST + ((i as usize) << 2));
  }
  @inline setParetoHealthyCost(i: i32, val: i32): void {
    store<i32>(changetype<usize>(this) + FS_OFF_PARETO_HEALTHY_COST + ((i as usize) << 2), val);
  }
  @inline getParetoHealthyNodes(i: i32): u32 {
    return load<u32>(changetype<usize>(this) + FS_OFF_PARETO_HEALTHY_NODES + ((i as usize) << 2));
  }
  @inline setParetoHealthyNodes(i: i32, val: u32): void {
    store<u32>(changetype<usize>(this) + FS_OFF_PARETO_HEALTHY_NODES + ((i as usize) << 2), val);
  }

  /** Number of heads in this frontier carrying an unconfirmed repair (see isUnconfirmedRepair). */
  @inline get unconfirmedRepairs(): u32 {
    return load<u32>(changetype<usize>(this) + FS_OFF_UNCONFIRMED_REPAIRS);
  }
  @inline set unconfirmedRepairs(val: u32) {
    store<u32>(changetype<usize>(this) + FS_OFF_UNCONFIRMED_REPAIRS, val);
  }

  updateParetoHealthy(newCost: i32, newNodes: u32): void {
    let count = this.paretoHealthyCount;
    for (let i: i32 = 0; i < (count as i32); i++) {
      if (this.getParetoHealthyCost(i) <= newCost && this.getParetoHealthyNodes(i) >= newNodes) {
        return;
      }
    }
    let writeIdx: i32 = 0;
    for (let i: i32 = 0; i < (count as i32); i++) {
      if (!(newCost <= this.getParetoHealthyCost(i) && newNodes >= this.getParetoHealthyNodes(i))) {
        if (writeIdx != i) {
          this.setParetoHealthyCost(writeIdx, this.getParetoHealthyCost(i));
          this.setParetoHealthyNodes(writeIdx, this.getParetoHealthyNodes(i));
        }
        writeIdx++;
      }
    }
    count = writeIdx as u32;
    if (count < 8) {
      this.setParetoHealthyCost(count as i32, newCost);
      this.setParetoHealthyNodes(count as i32, newNodes);
      this.paretoHealthyCount = count + 1;
    } else {
      this.hasOverflow = true;
    }
  }

  updateParetoInError(newCost: i32, newNodes: u32): void {
    let count = this.paretoErrCount;
    for (let i: i32 = 0; i < (count as i32); i++) {
      if (this.getParetoErrCost(i) <= newCost && this.getParetoErrNodes(i) >= newNodes) {
        return;
      }
    }
    let writeIdx: i32 = 0;
    for (let i: i32 = 0; i < (count as i32); i++) {
      if (!(newCost <= this.getParetoErrCost(i) && newNodes >= this.getParetoErrNodes(i))) {
        if (writeIdx != i) {
          this.setParetoErrCost(writeIdx, this.getParetoErrCost(i));
          this.setParetoErrNodes(writeIdx, this.getParetoErrNodes(i));
        }
        writeIdx++;
      }
    }
    count = writeIdx as u32;
    if (count < 8) {
      this.setParetoErrCost(count as i32, newCost);
      this.setParetoErrNodes(count as i32, newNodes);
      this.paretoErrCount = count + 1;
    } else {
      this.hasOverflow = true;
    }
  }
}

export let t_activeSummary: FrontierSummary = changetype<FrontierSummary>(0);
export let t_nextSummary: FrontierSummary = changetype<FrontierSummary>(0);

export function resetFrontierSummary(s: FrontierSummary): void {
  if (changetype<usize>(s) == 0) return;
  memory.fill(changetype<usize>(s), 0, FS_SIZE);
  s.minHealthyCost = 0x7fffffff;
  s.minNonPausedCost = 0x7fffffff;
  s.minInErrorCost = 0x7fffffff;
}

/** A healthy-flagged head that still carries an unconfirmed repair (insertion/substitution). */
@inline function isUnconfirmedRepair(h: ParseHead): bool {
  return !h.inErrorState && h.errorCost > 0 && h.successfulShifts < 2;
}

export function addToFrontierSummary(s: FrontierSummary, h: ParseHead): void {
  if (changetype<usize>(s) == 0 || h.isDead) return;
  if (isUnconfirmedRepair(h)) {
    s.unconfirmedRepairs = s.unconfirmedRepairs + 1;
  }

  if (!h.isPaused) {
    s.nonPausedCount++;
    if (h.errorCost < s.minNonPausedCost) {
      s.minNonPausedCost = h.errorCost;
      s.minNonPausedCostPos = h.pos;
    }
    if (h.pos > s.maxNonPausedPos) {
      s.maxNonPausedPos = h.pos;
    }
    let n = s.posNonPausedCount;
    let found = false;
    for (let i: u32 = 0; i < n; i++) {
      if (s.getNonPausedPos(i as i32) == h.pos) {
        if (h.errorCost < s.getNonPausedCost(i as i32)) {
          s.setNonPausedCost(i as i32, h.errorCost);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      if (n < 8) {
        s.setNonPausedPos(n as i32, h.pos);
        s.setNonPausedCost(n as i32, h.errorCost);
        s.posNonPausedCount++;
      } else {
        s.hasOverflow = true;
      }
    }
  }

  if (!h.inErrorState) {
    s.healthyCount++;
    if (h.errorCost < s.minHealthyCost) {
      s.minHealthyCost = h.errorCost;
      s.minHealthyCostPos = h.pos;
    }
    if (h.pos > s.maxHealthyPos) {
      s.maxHealthyPos = h.pos;
    }
    if (h.nodeCount > s.maxHealthyNodeCount) {
      s.maxHealthyNodeCount = h.nodeCount;
    }

    let n = s.posHealthyCount;
    let found = false;
    for (let i: u32 = 0; i < n; i++) {
      if (s.getHealthyPos(i as i32) == h.pos) {
        if (h.errorCost < s.getHealthyCost(i as i32)) {
          s.setHealthyCost(i as i32, h.errorCost);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      if (n < 8) {
        s.setHealthyPos(n as i32, h.pos);
        s.setHealthyCost(n as i32, h.errorCost);
        s.posHealthyCount++;
      } else {
        s.hasOverflow = true;
      }
    }

    s.updateParetoHealthy(h.errorCost, h.nodeCount);
  } else {
    s.inErrorCount++;
    if (h.errorCost < s.minInErrorCost) {
      s.minInErrorCost = h.errorCost;
    }
    if (h.nodeCount > s.maxInErrorNodeCount) {
      s.maxInErrorNodeCount = h.nodeCount;
    }

    s.updateParetoInError(h.errorCost, h.nodeCount);
  }
}

export function rebuildFrontierSummary(kind: u32, frontier: UnmanagedUint32Array, count: u32): void {
  let s = kind == 1 ? t_nextSummary : t_activeSummary;
  resetFrontierSummary(s);
  for (let i: u32 = 0; i < count; i++) {
    let h = changetype<ParseHead>(frontier[i]);
    if (!h.isDead) {
      addToFrontierSummary(s, h);
    }
  }
}

export function fastBetterVersionExists(candidate: ParseHead, s: FrontierSummary): boolean {
  if (changetype<usize>(s) == 0 || s.hasOverflow) return false;

  // 1. Healthy head dominates an in-error candidate ONLY if existing has strictly lower error cost
  // and is at or ahead in the stream.
  if (candidate.inErrorState && s.healthyCount > s.unconfirmedRepairs) {
    if (s.minHealthyCost < candidate.errorCost && s.maxHealthyPos >= candidate.pos) {
      if (s.minHealthyCostPos >= candidate.pos) {
        return true;
      }
      let n = s.posHealthyCount;
      for (let i: u32 = 0; i < n; i++) {
        if (s.getHealthyPos(i as i32) >= candidate.pos && s.getHealthyCost(i as i32) < candidate.errorCost) {
          return true;
        }
      }
    }
  }

  // 1b. Active head dominates paused head if equal or lower cost
  if (candidate.isPaused && s.nonPausedCount > 0) {
    if (s.minNonPausedCost <= candidate.errorCost && s.maxNonPausedPos >= candidate.pos) {
      if (s.minNonPausedCostPos >= candidate.pos) {
        return true;
      }
      let n = s.posNonPausedCount;
      for (let i: u32 = 0; i < n; i++) {
        if (s.getNonPausedPos(i as i32) >= candidate.pos && s.getNonPausedCost(i as i32) <= candidate.errorCost) {
          return true;
        }
      }
    }
  }

  // 2. Both in error: Tree-sitter relative cost comparison
  if (candidate.inErrorState && s.inErrorCount > 0) {
    let diff = candidate.errorCost - s.minInErrorCost;
    if (diff > 0 && diff * (1 + (s.maxInErrorNodeCount as i32)) > MAX_COST_DIFFERENCE) {
      let n = s.paretoErrCount;
      for (let i: u32 = 0; i < n; i++) {
        let eCost = s.getParetoErrCost(i as i32);
        if (eCost < candidate.errorCost) {
          let costDiff = candidate.errorCost - eCost;
          let progress = 1 + (s.getParetoErrNodes(i as i32) as i32);
          if (costDiff * progress > MAX_COST_DIFFERENCE) {
            return true;
          }
        }
      }
    }
  }

  // 3. Both healthy: relative error cost pruning
  if (!candidate.inErrorState && s.healthyCount > 0) {
    let diff = candidate.errorCost - s.minHealthyCost;
    if (diff > 0 && diff * (1 + (s.maxHealthyNodeCount as i32)) > MAX_COST_DIFFERENCE) {
      let n = s.paretoHealthyCount;
      for (let i: u32 = 0; i < n; i++) {
        let eCost = s.getParetoHealthyCost(i as i32);
        if (eCost < candidate.errorCost) {
          let costDiff = candidate.errorCost - eCost;
          let progress = 1 + (s.getParetoHealthyNodes(i as i32) as i32);
          if (costDiff * progress > MAX_COST_DIFFERENCE) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function slowBetterVersionExists(candidate: ParseHead, frontier: UnmanagedUint32Array, count: u32): boolean {
  for (let i: u32 = 0; i < count; i++) {
    let existing = changetype<ParseHead>(frontier[i]);
    if (existing == candidate || existing.isDead) continue;

    // 1. Healthy head dominates an in-error candidate ONLY if existing has strictly lower error cost
    // and is at or ahead in the stream (Tree-sitter parser.c:252-257).
    if (!existing.inErrorState && !isUnconfirmedRepair(existing) && candidate.inErrorState) {
      if (existing.errorCost < candidate.errorCost && existing.pos >= candidate.pos) {
        return true;
      }
    }

    // 1b. Active head dominates paused head if equal or lower cost
    if (!existing.isPaused && candidate.isPaused) {
      if (existing.errorCost <= candidate.errorCost && existing.pos >= candidate.pos) {
        return true;
      }
    }

    // 2. Both in error: Tree-sitter relative cost comparison
    if (candidate.inErrorState && existing.inErrorState) {
      if (existing.errorCost < candidate.errorCost) {
        let costDiff = candidate.errorCost - existing.errorCost;
        let progress = 1 + (existing.nodeCount as i32);
        if (costDiff * progress > MAX_COST_DIFFERENCE) {
          return true;
        }
      }
    }

    // 3. Both healthy: relative error cost pruning
    if (!candidate.inErrorState && !existing.inErrorState) {
      if (existing.errorCost < candidate.errorCost) {
        let costDiff = candidate.errorCost - existing.errorCost;
        let progress = 1 + (existing.nodeCount as i32);
        if (costDiff * progress > MAX_COST_DIFFERENCE) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Evaluates whether an existing version in the frontier is decisively superior to candidate.
 * Implements Tree-sitter's (deltaCost) * (1 + progress) > MAX_COST_DIFFERENCE pruning.
 */
export function betterVersionExists(candidate: ParseHead, frontier: UnmanagedUint32Array, count: u32, isNext: bool = false): boolean {
  if (count == 0) return false;
  let s = isNext ? t_nextSummary : t_activeSummary;

  let fast = fastBetterVersionExists(candidate, s);
  if (debugVerifyFrontierPruning || changetype<usize>(s) == 0 || s.hasOverflow) {
    let slow = slowBetterVersionExists(candidate, frontier, count);
    if (fast != slow) {
      debugLog(9601, fast ? 1 : 0, slow ? 1 : 0, count);
      return slow;
    }
  }
  return fast;
}

/**
 * Prunes dominated existing heads in the frontier when a new decisively superior head is added.
 */
export function pruneDominatedHeads(newHead: ParseHead, frontier: UnmanagedUint32Array, count: u32): void {
  let healthyCount: u32 = 0;
  for (let i: u32 = 0; i < count; i++) {
    let h = changetype<ParseHead>(frontier[i]);
    if (!h.isDead && !h.inErrorState) healthyCount++;
  }

  for (let i: u32 = 0; i < count; i++) {
    let existing = changetype<ParseHead>(frontier[i]);
    if (existing == newHead || existing.isDead) continue;

    if (existing.processed) continue;

    let existingPtr = changetype<u32>(existing);
    if (existingPtr == gssBestAcceptingHead || existingPtr == gssBestDyingHead) continue;

    if (!existing.inErrorState && healthyCount <= 1) continue;

    let dominated = false;

    // Rule 1: healthy newHead dominates in-error existing
    if (!newHead.inErrorState && !isUnconfirmedRepair(newHead) && existing.inErrorState) {
      if (newHead.errorCost < existing.errorCost && newHead.pos >= existing.pos) {
        dominated = true;
      }
    }

    // Rule 1b: active newHead dominates paused existing
    if (!newHead.isPaused && existing.isPaused) {
      if (newHead.errorCost <= existing.errorCost && newHead.pos >= existing.pos) {
        dominated = true;
      }
    }

    // Rule 2: both in error
    if (newHead.inErrorState && existing.inErrorState) {
      if (newHead.errorCost < existing.errorCost) {
        let costDiff = existing.errorCost - newHead.errorCost;
        let progress = 1 + (newHead.nodeCount as i32);
        if (costDiff * progress > MAX_COST_DIFFERENCE) {
          dominated = true;
        }
      }
    }

    // Rule 3: both healthy
    if (!newHead.inErrorState && !existing.inErrorState) {
      if (newHead.errorCost < existing.errorCost) {
        let costDiff = existing.errorCost - newHead.errorCost;
        let progress = 1 + (newHead.nodeCount as i32);
        if (costDiff * progress > MAX_COST_DIFFERENCE) {
          dominated = true;
        }
      }
    }

    if (dominated) {
      existing.isDead = true;
      if (!existing.inErrorState) {
        healthyCount--;
      }
    }
  }
}

/**
 * Pushes a new active parse head to the current GSS queue.
 * @param headPtr Pointer to the ParseHead instance.
 * @returns true if pushed successfully, false if the queue is full.
 */
export function pushActiveHead(headPtr: u32): boolean {
  if (activeHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  let newHead = changetype<ParseHead>(headPtr);
  if (betterVersionExists(newHead, t_activeHeads, activeHeadsCount, false)) {
    return false;
  }
  if (activeHeadsCount == 0 && changetype<usize>(t_activeHeadProbe) != 0) {
    memory.fill(changetype<usize>(t_activeHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
  let probeKey: u32 = (((newHead.state as u32) * 31) ^ newHead.pos) & HEAD_PROBE_MASK;
  if (changetype<usize>(t_activeHeadProbe) != 0) {
    let probeIdx = t_activeHeadProbe[probeKey];
    if (probeIdx == 0) {
      t_activeHeadProbe[probeKey] = activeHeadsCount + 1;
      t_activeHeads[activeHeadsCount] = headPtr;
      activeHeadsCount++;
      addToFrontierSummary(t_activeSummary, newHead);
      if (configEnableActivePruning) {
        pruneDominatedHeads(newHead, t_activeHeads, activeHeadsCount);
      }
      return true;
    }
  }
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let r = mergeIntoFrontierSlot(t_activeHeads, i, newHead, false);
    if (r != MERGE_NONE) return true;
  }
  if (changetype<usize>(t_activeHeadProbe) != 0) {
    t_activeHeadProbe[probeKey] = activeHeadsCount + 1;
  }
  t_activeHeads[activeHeadsCount] = headPtr;
  activeHeadsCount++;
  addToFrontierSummary(t_activeSummary, newHead);
  if (configEnableActivePruning) {
    pruneDominatedHeads(newHead, t_activeHeads, activeHeadsCount);
  }
  return true;
}

const MERGE_NONE: i32 = 0;
const MERGE_DONE: i32 = 1;

/** True if `a` is a strictly better derivation than `b` for the same (state, pos). */
@inline
function isBetterHead(a: ParseHead, b: ParseHead): bool {
  return a.errorCost < b.errorCost || (a.errorCost == b.errorCost && a.dynamicPrec > b.dynamicPrec);
}

/** Copies every alternative predecessor edge of `from` onto `to`. */
function inheritEdges(to: ParseHead, from: ParseHead): void {
  let curr = from.firstEdge;
  while (curr != 0) {
    let edge = changetype<GssEdge>(curr);
    gssAddPredecessor(to, edge.targetHead, edge.astNode);
    curr = edge.nextEdge;
  }
}

/**
 * Tries to fold `newHead` into the frontier entry `frontier[i]` when both share the same
 * (state, pos). Returns MERGE_DONE if `newHead` was merged, replaced the entry, or was
 * dropped as dominated; MERGE_NONE if the entry is unrelated (or must not be merged).
 */
function mergeIntoFrontierSlot(frontier: UnmanagedUint32Array, i: u32, newHead: ParseHead, isNext: bool = false): i32 {
  let existingHead = changetype<ParseHead>(frontier[i]);
  // D2 fix: removed balanceHash from merge key — merge on (state, pos) only
  if (existingHead.state != newHead.state || existingHead.pos != newHead.pos) return MERGE_NONE;
  if (existingHead == newHead) return MERGE_DONE;
  // Reductions for a processed head have already run; attaching an edge now would skip
  // reductions along it. Keep the new head as a separate version instead.
  if (existingHead.processed) return MERGE_NONE;

  if (existingHead.prev == newHead.prev) {
    // Same predecessor: two derivations of the same span (local ambiguity). Keep the better
    // one, but don't lose the alternative edges either head accumulated.
    let winner = isBetterHead(newHead, existingHead) ? newHead : existingHead;
    let loser = winner == newHead ? existingHead : newHead;
    inheritEdges(winner, loser);
    if (winner.astNode != 0 && loser.astNode != 0 && winner.astNode != loser.astNode) {
      setNodeFlags(winner.astNode, getNodeFlags(winner.astNode) | FLAG_FRAGILE);
    }
    frontier[i] = changetype<u32>(winner);
    if (winner == newHead) {
      let s = isNext ? t_nextSummary : t_activeSummary;
      addToFrontierSummary(s, winner);
    }
    return MERGE_DONE;
  }

  if (existingHead.errorCost == newHead.errorCost) {
    gssMergeHeads(existingHead, newHead);
    return MERGE_DONE;
  }

  // Different predecessors and different error costs: keep both versions. Error recovery
  // relies on the costlier version surviving (its per-path diagnostics/scanner state can
  // still win later via `betterVersionExists`' relative pruning).
  return MERGE_NONE;
}

/**
 * Pushes a parse head into the next-token frontier buffer (lockstep double-buffering).
 */
export function pushNextHead(headPtr: u32): boolean {
  if (nextHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  let newHead = changetype<ParseHead>(headPtr);
  if (betterVersionExists(newHead, t_nextHeads, nextHeadsCount, true)) {
    return false;
  }
  if (nextHeadsCount == 0 && changetype<usize>(t_nextHeadProbe) != 0) {
    memory.fill(changetype<usize>(t_nextHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }
  let probeKey: u32 = (((newHead.state as u32) * 31) ^ newHead.pos) & HEAD_PROBE_MASK;
  if (changetype<usize>(t_nextHeadProbe) != 0) {
    let probeIdx = t_nextHeadProbe[probeKey];
    if (probeIdx == 0) {
      t_nextHeadProbe[probeKey] = nextHeadsCount + 1;
      t_nextHeads[nextHeadsCount] = headPtr;
      nextHeadsCount++;
      addToFrontierSummary(t_nextSummary, newHead);
      if (configEnableActivePruning) {
        pruneDominatedHeads(newHead, t_nextHeads, nextHeadsCount);
      }
      return true;
    }
  }
  for (let i: u32 = 0; i < nextHeadsCount; i++) {
    let r = mergeIntoFrontierSlot(t_nextHeads, i, newHead, true);
    if (r != MERGE_NONE) return true;
  }
  if (changetype<usize>(t_nextHeadProbe) != 0) {
    t_nextHeadProbe[probeKey] = nextHeadsCount + 1;
  }
  t_nextHeads[nextHeadsCount] = headPtr;
  nextHeadsCount++;
  addToFrontierSummary(t_nextSummary, newHead);
  if (configEnableActivePruning) {
    pruneDominatedHeads(newHead, t_nextHeads, nextHeadsCount);
  }
  return true;
}

/**
 * Swaps active and next head double buffers at the end of a lockstep token frontier.
 */
export function swapActiveAndNextHeads(): void {
  if (configEnableActivePruning) {
    let writeIdx: u32 = 0;
    for (let i: u32 = 0; i < nextHeadsCount; i++) {
      let h = changetype<ParseHead>(t_nextHeads[i]);
      if (!h.isDead) {
        t_nextHeads[writeIdx++] = changetype<u32>(h);
      }
    }
    nextHeadsCount = writeIdx;
  }

  let tmp = t_activeHeads;
  t_activeHeads = t_nextHeads;
  t_nextHeads = tmp;
  let tmpProbe = t_activeHeadProbe;
  t_activeHeadProbe = t_nextHeadProbe;
  t_nextHeadProbe = tmpProbe;
  activeHeadsCount = nextHeadsCount;
  nextHeadsCount = 0;
  if (changetype<usize>(t_nextHeadProbe) != 0) {
    memory.fill(changetype<usize>(t_nextHeadProbe), 0, HEAD_PROBE_SIZE * 4);
  }

  let tmpSummary = t_activeSummary;
  t_activeSummary = t_nextSummary;
  t_nextSummary = tmpSummary;
  resetFrontierSummary(t_nextSummary);
}

/**
 * Retrieves the active parse head pointer at the specified queue index.
 * @param index Array index in t_activeHeads.
 */
export function getActiveHead(index: u32): u32 {
  if (index >= activeHeadsCount) return 0;
  return t_activeHeads[index];
}

/**
 * Updates the total count of active parse heads in the GSS queue.
 */
export function setActiveHeadsCount(count: u32): void {
  activeHeadsCount = count;
}

/**
 * Represents a directed link/edge in the Graph-Structured Stack (GSS) DAG.
 */
@unmanaged
export class GssEdge {
  targetHead: ParseHead | null;
  astNode: u32;
  nextEdge: u32;
}

/**
 * Adds an alternative predecessor link to a GSS head, turning it into a true DAG node.
 */
export function gssAddPredecessor(head: ParseHead, pred: ParseHead | null, astNode: u32): void {
  if (pred == null) return;
  if (head == pred) return;
  if (head.prev == pred) return;
  let curr = head.firstEdge;
  while (curr != 0) {
    let edge = changetype<GssEdge>(curr);
    if (edge.targetHead == pred) return;
    curr = edge.nextEdge;
  }
  let edgePtr = allocGen0(16);
  let newEdge = changetype<GssEdge>(edgePtr);
  newEdge.targetHead = pred;
  newEdge.astNode = astNode;
  newEdge.nextEdge = head.firstEdge;
  head.firstEdge = edgePtr;
}

/**
 * Merges two parse heads arriving at the same state and position into a unified DAG node.
 */
export function gssMergeHeads(existingHead: ParseHead, newHead: ParseHead): void {
  if (existingHead == newHead) return;
  // Primary link inversion fix:
  // If newHead has higher dynamic precedence (or lower errorCost), swap existingHead's primary link
  // (prev, astNode) with newHead's so the primary link always points to the superior derivation.
  let swapPrimary = false;
  if (newHead.errorCost < existingHead.errorCost) {
    swapPrimary = true;
  } else if (newHead.errorCost == existingHead.errorCost && newHead.dynamicPrec > existingHead.dynamicPrec) {
    swapPrimary = true;
  }

  if (swapPrimary) {
    if (newHead.prev != existingHead) {
      let oldPrev = existingHead.prev;
      let oldNode = existingHead.astNode;
      existingHead.prev = newHead.prev;
      existingHead.astNode = newHead.astNode;
      existingHead.dynamicPrec = newHead.dynamicPrec;
      existingHead.errorCost = newHead.errorCost;
      // Per-path state must follow the primary derivation, otherwise diagnostics and
      // padding of the losing path are reported for the winning tree.
      existingHead.errorTail = newHead.errorTail;
      existingHead.errorNode = newHead.errorNode;
      existingHead.errorLastChild = newHead.errorLastChild;
      existingHead.summaryPtr = newHead.summaryPtr;
      existingHead.summaryCount = newHead.summaryCount;
      existingHead.pendingPadding = newHead.pendingPadding;
      existingHead.scannerState = newHead.scannerState;
      existingHead.consecutiveInsertions = newHead.consecutiveInsertions;
      gssAddPredecessor(existingHead, oldPrev, oldNode);
    } else {
      gssAddPredecessor(existingHead, newHead.prev, newHead.astNode);
    }
  } else {
    gssAddPredecessor(existingHead, newHead.prev, newHead.astNode);
  }

  let curr = newHead.firstEdge;
  while (curr != 0) {
    let edge = changetype<GssEdge>(curr);
    gssAddPredecessor(existingHead, edge.targetHead, edge.astNode);
    curr = edge.nextEdge;
  }
  if (!newHead.inErrorState) {
    existingHead.inErrorState = false;
  }
  // D9 fix: propagate successfulShifts during merge (take max)
  if (newHead.successfulShifts > existingHead.successfulShifts) {
    existingHead.successfulShifts = newHead.successfulShifts;
  }
  // D9 fix: propagate nodeCount during merge (take max)
  if (newHead.nodeCount > existingHead.nodeCount) {
    existingHead.nodeCount = newHead.nodeCount;
  }
  if (existingHead.astNode != 0) {
    setNodeFlags(existingHead.astNode, getNodeFlags(existingHead.astNode) | FLAG_FRAGILE);
  }
}

/**
 * Represents a single parsing path (or "thread") in the Graph-Structured Stack (GSS)
 * for the GLR parser.
 */
@unmanaged
export class ParseHead {
  /** The current parsing state (from the LR automaton) for this head. */
  state: i32;
  
  /** A pointer to the unmanaged AST node constructed so far along this path. */
  astNode: u32;
  
  /** A pointer to the previous parse head in the Graph-Structured Stack (GSS), forming the parse tree path. */
  prev: ParseHead | null;
  
  /** The current byte offset in the input buffer that this head has successfully consumed. */
  pos: u32;
  
  /** The contextual lexer/scanner state at this head's position. */
  scannerState: u32;
  
  /** The accumulated penalty score for error recovery operations (deletions, insertions) applied to this path. */
  errorCost: i32;
  
  /** A counter of how many tokens have been successfully shifted since the last error. Used to validate recovery viability. */
  successfulShifts: i32;
  
  /** Tracks unmatched block scopes (e.g. `{`, `[`, `(`) to penalize or prevent invalid cross-scope error recovery. */
  balanceHash: u32;
  
  /** Tracks consecutive insertions to prevent runaway insertion loops. */
  consecutiveInsertions: i32;
  
  /** The accumulated dynamic precedence score. Used to deterministically resolve ambiguous paths. */
  dynamicPrec: i32;
  
  /** Number of whitespace/comment padding bytes accumulated that have not yet been attached to the next AST node. */
  pendingPadding: u32;
  
  /** Pointer to the tail of the error recovery linked list. */
  errorTail: u32;

  /** Pointer to the first alternative incoming GssEdge in linear memory (for DAG merging). */
  firstEdge: u32;

  /** True if this head is currently in a persistent error state (Strategy 1/2 recovery loop). */
  inErrorState: bool;

  /** Pointer to recorded StackSummary entries in Gen0 linear memory. */
  summaryPtr: u32;

  /** Number of ancestor entries in the recorded StackSummary. */
  summaryCount: u32;

  /** Count of valid nodes shifted since last error (for Tree-sitter relative version comparison). */
  nodeCount: u32;

  /** Pointer to the active open ERROR container node (if any). */
  errorNode: u32;

  /** Pointer to the last child appended inside errorNode (for O(1) appends). */
  errorLastChild: u32;

  /** True if this head is temporarily paused waiting for parallel heads to advance. */
  isPaused: bool;

  /** The lookahead token that caused this head to pause. */
  pausedLookahead: i32;

  /**
   * True once the GLR loop has started executing actions for this head at its frontier.
   * Merging a new predecessor edge into a processed head would skip the reductions along
   * that edge (the classic GLR "missed reductions" problem), so such heads are not merged.
   */
  processed: bool;

  /** True if this head has been dominated by a better head and should be ignored/compacted. */
  isDead: bool;
}

/**
 * Allocates and initializes a new ParseHead instance in Generation 0 linear memory (96 bytes).
 */
export function allocParseHead(
  state: i32,
  astNode: u32,
  prev: ParseHead | null,
  pos: u32,
  scannerState: u32,
  errorCost: i32 = 0,
  successfulShifts: i32 = 0,
  balanceHash: u32 = 0,
  consecutiveInsertions: i32 = 0,
  dynamicPrec: i32 = 0,
  pendingPadding: u32 = 0,
  errorTail: u32 = 0,
  firstEdge: u32 = 0,
  inErrorState: bool = false,
  summaryPtr: u32 = 0,
  summaryCount: u32 = 0,
  nodeCount: u32 = 0,
  errorNode: u32 = 0,
  errorLastChild: u32 = 0,
  isPaused: bool = false,
  pausedLookahead: i32 = 0,
): ParseHead {
  let ptr = allocGen0((offsetof<ParseHead>() + 7) & ~7);
  let h = changetype<ParseHead>(ptr);
  h.state = state;
  h.astNode = astNode;
  h.prev = prev;
  h.pos = pos;
  h.scannerState = scannerState;
  h.errorCost = errorCost;
  h.successfulShifts = successfulShifts;
  h.balanceHash = balanceHash;
  h.consecutiveInsertions = consecutiveInsertions;
  h.dynamicPrec = dynamicPrec;
  h.pendingPadding = pendingPadding;
  h.errorTail = errorTail;
  h.firstEdge = firstEdge;
  h.inErrorState = inErrorState;
  h.summaryPtr = summaryPtr;
  h.summaryCount = summaryCount;
  h.nodeCount = nodeCount;
  h.errorNode = errorNode;
  h.errorLastChild = errorLastChild;
  h.isPaused = isPaused;
  h.pausedLookahead = pausedLookahead;
  h.processed = false;
  h.isDead = false;
  return h;
}

/**
 * Represents an error recovery branch candidate tracked during GLR parsing.
 */
@unmanaged
export class ErrorBranch {
  head: u32;
  cost: i32;
  lexPos: u32;
  token: i32;
  lexLen: u32;
  threshold: i32;
  errStart: u32;
  errEnd: u32;
  scannerState: u32;
  next: u32;
}

/**
 * Allocates and initializes an ErrorBranch instance in Generation 0 memory.
 */
export function allocErrorBranch(
  head: u32,
  cost: i32,
  lexPos: u32,
  token: i32,
  lexLen: u32,
  threshold: i32,
  errStart: u32,
  errEnd: u32,
  scannerState: u32,
): u32 {
  let ptr = allocGen0(40);
  let b = changetype<ErrorBranch>(ptr);
  b.head = head;
  b.cost = cost;
  b.lexPos = lexPos;
  b.token = token;
  b.lexLen = lexLen;
  b.threshold = threshold;
  b.errStart = errStart;
  b.errEnd = errEnd;
  b.scannerState = scannerState;
  b.next = 0;
  return ptr;
}

// ----------------------------------------------------------------------------
// Global Tree Traversal Cursor (backed by value-type TreeCursor)
// ----------------------------------------------------------------------------

export const cursorNodeStack = createChunkedUint32Array();
export const cursorContentStartStack = createChunkedUint32Array();

export let globalCursorDepth: i32 = -1;
export let g_globalTreeCursor: usize = 0;

export function ensureGlobalTreeCursor(): usize {
  if (g_globalTreeCursor == 0) {
    g_globalTreeCursor = treeCursorAlloc();
  }
  return g_globalTreeCursor;
}

/**
 * Initializes the global singleton tree cursor at the root node.
 * @param rootPtr Arena pointer to the root AST node.
 */
export function initGlobalCursor(rootPtr: u32): void {
  treeCursorReset(ensureGlobalTreeCursor(), rootPtr);
  if (rootPtr != 0) {
    globalCursorDepth = 0;
    cursorNodeStack[0] = rootPtr;
    cursorContentStartStack[0] = getNodePadding(rootPtr);
  } else {
    globalCursorDepth = -1;
  }
}

/**
 * Gets the current AST node pointer under the global cursor.
 */
export function globalCursorCurrentNode(): u32 {
  return treeCursorCurrentNode(ensureGlobalTreeCursor());
}

/**
 * Moves the global cursor to the first child of the current node.
 */
export function globalCursorGotoFirstChild(): boolean {
  let ok = treeCursorGotoFirstChild(ensureGlobalTreeCursor());
  if (ok) {
    globalCursorDepth = treeCursorDepth(ensureGlobalTreeCursor());
    cursorNodeStack[globalCursorDepth] = treeCursorCurrentNode(ensureGlobalTreeCursor());
    cursorContentStartStack[globalCursorDepth] = treeCursorCurrentOffset(ensureGlobalTreeCursor());
  }
  return ok;
}

/**
 * Moves the global cursor to the next sibling of the current node.
 */
export function globalCursorGotoNextSibling(): boolean {
  let ok = treeCursorGotoNextSibling(ensureGlobalTreeCursor());
  if (ok) {
    globalCursorDepth = treeCursorDepth(ensureGlobalTreeCursor());
    cursorNodeStack[globalCursorDepth] = treeCursorCurrentNode(ensureGlobalTreeCursor());
    cursorContentStartStack[globalCursorDepth] = treeCursorCurrentOffset(ensureGlobalTreeCursor());
  }
  return ok;
}

/**
 * Moves the global cursor up to the parent node.
 */
export function globalCursorGotoParent(): boolean {
  let ok = treeCursorGotoParent(ensureGlobalTreeCursor());
  if (ok) {
    globalCursorDepth = treeCursorDepth(ensureGlobalTreeCursor());
  }
  return ok;
}

export let g_cursorCheckpoint: usize = 0;
export let g_checkpointDepth: i32 = -1;

export function ensureCursorCheckpoint(): usize {
  if (g_cursorCheckpoint == 0) {
    g_cursorCheckpoint = treeCursorAlloc();
  }
  return g_cursorCheckpoint;
}

/**
 * Saves a transactional snapshot of the global tree cursor and its path stacks.
 */
export function saveCursorCheckpoint(): void {
  let src = ensureGlobalTreeCursor();
  let dst = ensureCursorCheckpoint();
  memory.copy(dst, src, TREE_CURSOR_SIZE as usize);
  g_checkpointDepth = globalCursorDepth;
}

/**
 * Restores the global tree cursor and path stacks to the last saved checkpoint.
 */
export function restoreCursorCheckpoint(): void {
  if (g_cursorCheckpoint == 0 || g_checkpointDepth < 0) return;
  let src = g_cursorCheckpoint;
  let dst = ensureGlobalTreeCursor();
  memory.copy(dst, src, TREE_CURSOR_SIZE as usize);
  globalCursorDepth = g_checkpointDepth;
  for (let d = 0; d <= globalCursorDepth; d++) {
    cursorNodeStack[d] = treeCursorNodeAtDepth(src, d);
    cursorContentStartStack[d] = treeCursorOffsetAtDepth(src, d);
  }
}
