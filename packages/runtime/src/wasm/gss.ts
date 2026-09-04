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
  activeHeadsCount = 0;
  nextHeadsCount = 0;
  candidateHeadsCount = 0;
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

/**
 * Pushes a new active parse head to the current GSS queue.
 * @param headPtr Pointer to the ParseHead instance.
 * @returns true if pushed successfully, false if the queue is full.
 */
export function pushActiveHead(headPtr: u32): boolean {
  if (activeHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  let newHead = changetype<ParseHead>(headPtr);
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let existingHead = changetype<ParseHead>(t_activeHeads[i]);
    if (existingHead.state == newHead.state && existingHead.pos == newHead.pos && existingHead.balanceHash == newHead.balanceHash && existingHead.prev == newHead.prev) {
      if (newHead.errorCost < existingHead.errorCost || (newHead.errorCost == existingHead.errorCost && newHead.dynamicPrec > existingHead.dynamicPrec)) {
        t_activeHeads[i] = headPtr;
      }
      return true;
    }
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
  for (let i: u32 = 0; i < nextHeadsCount; i++) {
    let existingHead = changetype<ParseHead>(t_nextHeads[i]);
    if (existingHead.state == newHead.state && existingHead.pos == newHead.pos && existingHead.balanceHash == newHead.balanceHash && existingHead.prev == newHead.prev) {
      if (newHead.errorCost < existingHead.errorCost || (newHead.errorCost == existingHead.errorCost && newHead.dynamicPrec > existingHead.dynamicPrec)) {
        t_nextHeads[i] = headPtr;
      }
      return true;
    }
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
  activeHeadsCount = nextHeadsCount;
  nextHeadsCount = 0;
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
}

/**
 * Allocates and initializes a new ParseHead instance in Generation 0 linear memory (48 bytes).
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
): ParseHead {
  let ptr = allocGen0(48);
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
// Global Tree Traversal Cursor
// ----------------------------------------------------------------------------

export const cursorNodeStack = createChunkedUint32Array();
export const cursorContentStartStack = createChunkedUint32Array();

export let globalCursorDepth: i32 = -1;

/**
 * Initializes the global singleton tree cursor at the root node.
 * @param rootPtr Arena pointer to the root AST node.
 */
export function initGlobalCursor(rootPtr: u32): void {
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
  if (globalCursorDepth < 0) return 0;
  return cursorNodeStack[globalCursorDepth];
}

/**
 * Moves the global cursor to the first child of the current node.
 */
export function globalCursorGotoFirstChild(): boolean {
  if (globalCursorDepth < 0 || globalCursorDepth >= MAX_CURSOR_DEPTH) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let child = getNodeFirstChild(cPtr);
  if (child == 0) return false;

  // Rule 2: First child starts at the parent's exact content start
  let parentContentStart = cursorContentStartStack[globalCursorDepth];

  globalCursorDepth++;
  cursorNodeStack[globalCursorDepth] = child;
  cursorContentStartStack[globalCursorDepth] = parentContentStart;
  return true;
}

/**
 * Moves the global cursor to the next sibling of the current node.
 */
export function globalCursorGotoNextSibling(): boolean {
  if (globalCursorDepth < 0) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let sibling = getNodeNextSibling(cPtr);
  if (sibling == 0) return false;

  // Rule 3: Sibling starts after previous child's content end + sibling's padding
  let prevContentEnd = cursorContentStartStack[globalCursorDepth] + getNodeByteLength(cPtr);
  let siblingContentStart = prevContentEnd + getNodePadding(sibling);

  cursorNodeStack[globalCursorDepth] = sibling;
  cursorContentStartStack[globalCursorDepth] = siblingContentStart;
  return true;
}

/**
 * Moves the global cursor up to the parent node.
 */
export function globalCursorGotoParent(): boolean {
  if (globalCursorDepth <= 0) return false;
  globalCursorDepth--;
  return true;
}
