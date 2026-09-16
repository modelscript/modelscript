/* eslint-disable */
// @ts-nocheck
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
} from "./arena";

import { ChunkedUint32Array, UnmanagedUint32Array, createChunkedUint32Array } from "./array";
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

/**
 * Evaluates whether an existing version in the frontier is decisively superior to candidate.
 * Implements Tree-sitter's (deltaCost) * (1 + progress) > MAX_COST_DIFFERENCE pruning.
 */
export function betterVersionExists(candidate: ParseHead, frontier: UnmanagedUint32Array, count: u32): boolean {
  for (let i: u32 = 0; i < count; i++) {
    let existing = changetype<ParseHead>(frontier[i]);
    if (existing == candidate) continue;

    // 1. Healthy head dominates an in-error candidate ONLY if existing has strictly lower error cost
    // and is at or ahead in the stream (Tree-sitter parser.c:252-257).
    // If existing.errorCost >= candidate.errorCost, the candidate's repair is cheaper and must survive.
    if (!existing.inErrorState && candidate.inErrorState) {
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
    // D3 fix: use nodeCount instead of successfulShifts for progress metric
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
 * Pushes a new active parse head to the current GSS queue.
 * @param headPtr Pointer to the ParseHead instance.
 * @returns true if pushed successfully, false if the queue is full.
 */
export function pushActiveHead(headPtr: u32): boolean {
  if (activeHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  let newHead = changetype<ParseHead>(headPtr);
  if (betterVersionExists(newHead, t_activeHeads, activeHeadsCount)) {
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
      return true;
    }
  }
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let existingHead = changetype<ParseHead>(t_activeHeads[i]);
    // D2 fix: removed balanceHash from merge key — merge on (state, pos) only
    if (existingHead.state == newHead.state && existingHead.pos == newHead.pos) {
      if (existingHead.prev == newHead.prev) {
        if (newHead.errorCost < existingHead.errorCost || (newHead.errorCost == existingHead.errorCost && newHead.dynamicPrec > existingHead.dynamicPrec)) {
          t_activeHeads[i] = headPtr;
        }
        return true;
      } else if (existingHead.errorCost == newHead.errorCost) {
        gssMergeHeads(existingHead, newHead);
        return true;
      }
    }
  }
  if (changetype<usize>(t_activeHeadProbe) != 0) {
    t_activeHeadProbe[probeKey] = activeHeadsCount + 1;
  }
  t_activeHeads[activeHeadsCount] = headPtr;
  activeHeadsCount++;
  return true;
}

/**
 * Pushes a parse head into the next-token frontier buffer (lockstep double-buffering).
 */
export function pushNextHead(headPtr: u32): boolean {
  if (nextHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  let newHead = changetype<ParseHead>(headPtr);
  if (betterVersionExists(newHead, t_nextHeads, nextHeadsCount)) {
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
      return true;
    }
  }
  for (let i: u32 = 0; i < nextHeadsCount; i++) {
    let existingHead = changetype<ParseHead>(t_nextHeads[i]);
    // D2 fix: removed balanceHash from merge key — merge on (state, pos) only
    if (existingHead.state == newHead.state && existingHead.pos == newHead.pos) {
      if (existingHead.prev == newHead.prev) {
        if (newHead.errorCost < existingHead.errorCost || (newHead.errorCost == existingHead.errorCost && newHead.dynamicPrec > existingHead.dynamicPrec)) {
          t_nextHeads[i] = headPtr;
        }
        return true;
      } else if (existingHead.errorCost == newHead.errorCost) {
        gssMergeHeads(existingHead, newHead);
        return true;
      }
    }
  }
  if (changetype<usize>(t_nextHeadProbe) != 0) {
    t_nextHeadProbe[probeKey] = nextHeadsCount + 1;
  }
  t_nextHeads[nextHeadsCount] = headPtr;
  nextHeadsCount++;
  return true;
}

/**
 * Swaps active and next head double buffers at the end of a lockstep token frontier.
 */
export function swapActiveAndNextHeads(): void {
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
    let oldPrev = existingHead.prev;
    let oldNode = existingHead.astNode;
    existingHead.prev = newHead.prev;
    existingHead.astNode = newHead.astNode;
    existingHead.dynamicPrec = newHead.dynamicPrec;
    existingHead.errorCost = newHead.errorCost;
    gssAddPredecessor(existingHead, oldPrev, oldNode);
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
  let ptr = allocGen0(96);
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
