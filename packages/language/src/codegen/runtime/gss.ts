import {
  atomicChunkAlloc,
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

const ARENA_BUFFER_SIZE: i32 = 16384;
const MAX_CURSOR_DEPTH: i32 = 999999;

export let t_activeHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let activeHeadsCount: u32 = 0;

export function initGSS(): void {
  if (changetype<usize>(t_activeHeads) == 0) {
    t_activeHeads = changetype<UnmanagedUint32Array>(atomicChunkAlloc(ARENA_BUFFER_SIZE * 4));
  }
  activeHeadsCount = 0;
}

export function pushActiveHead(headPtr: u32): boolean {
  if (activeHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  t_activeHeads[activeHeadsCount] = headPtr;
  activeHeadsCount++;
  return true;
}

export function getActiveHead(index: u32): u32 {
  if (index >= activeHeadsCount) return 0;
  return t_activeHeads[index];
}

export function setActiveHeadsCount(count: u32): void {
  activeHeadsCount = count;
}

/**
 * Represents a single parsing path (or "thread") in the Graph-Structured Stack (GSS)
 * for the GLR parser. During ambiguities or error recovery, the parser forks multiple
 * ParseHeads to explore different interpretations or recovery strategies concurrently.
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
  
  /** Tracks how many virtual tokens have been inserted consecutively to prevent runaway hallucination during Insertion/Forced Reduction. */
  consecutiveInsertions: i32;
  
  /** The accumulated dynamic precedence score. Used to deterministically resolve ambiguous paths. */
  dynamicPrec: i32;
  
  /** Number of whitespace/comment padding bytes accumulated that have not yet been attached to the next AST node. */
  pendingPadding: u32;
  
  /** Pointer to the tail of the error recovery linked list, used for mounting discarded tokens in Island mode. */
  errorTail: u32;
  
  /** Virtual token (hallucinated for error recovery) waiting to be shifted, encoded as packed token data. */
  virtualQueue0: u32;
  /** Virtual token (hallucinated for error recovery) waiting to be shifted. */
  virtualQueue1: u32;
  /** Virtual token (hallucinated for error recovery) waiting to be shifted. */
  virtualQueue2: u32;
  /** Virtual token (hallucinated for error recovery) waiting to be shifted. */
  virtualQueue3: u32;
  /** Virtual token (hallucinated for error recovery) waiting to be shifted. */
  virtualQueue4: u32;
  
  /** The number of virtual tokens pending in the queue. */
  virtualQueueCount: u32;
}

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
  virtualQueue0: u32 = 0,
  virtualQueue1: u32 = 0,
  virtualQueue2: u32 = 0,
  virtualQueue3: u32 = 0,
  virtualQueue4: u32 = 0,
  virtualQueueCount: u32 = 0,
): ParseHead {
  let ptr = allocGen0(72);
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
  h.virtualQueue0 = virtualQueue0;
  h.virtualQueue1 = virtualQueue1;
  h.virtualQueue2 = virtualQueue2;
  h.virtualQueue3 = virtualQueue3;
  h.virtualQueue4 = virtualQueue4;
  h.virtualQueueCount = virtualQueueCount;
  return h;
}

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
export const cursorOffsetStack = createChunkedUint32Array();
export const savedCursorNodeStack = createChunkedUint32Array();
export const savedCursorOffsetStack = createChunkedUint32Array();

export let globalCursorDepth: i32 = -1;

export function initGlobalCursor(rootPtr: u32): void {
  if (rootPtr != 0) {
    globalCursorDepth = 0;
    cursorNodeStack[0] = rootPtr;
    cursorOffsetStack[0] = 0;
  } else {
    globalCursorDepth = -1;
  }
}

export function globalCursorCurrentNode(): u32 {
  if (globalCursorDepth < 0) return 0;
  return cursorNodeStack[globalCursorDepth];
}

export function globalCursorGotoFirstChild(): boolean {
  if (globalCursorDepth < 0 || globalCursorDepth >= MAX_CURSOR_DEPTH) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let child = getNodeFirstChild(cPtr);
  if (child == 0) return false;

  let parentStart = cursorOffsetStack[globalCursorDepth] + getNodePadding(cPtr);
  let childPad = getNodePadding(child);
  let absStart: u32 = parentStart >= childPad ? parentStart - childPad : 0;

  globalCursorDepth++;
  cursorNodeStack[globalCursorDepth] = child;
  cursorOffsetStack[globalCursorDepth] = absStart;
  return true;
}

export function globalCursorGotoNextSibling(): boolean {
  if (globalCursorDepth < 0) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let sibling = getNodeNextSibling(cPtr);
  if (sibling == 0) return false;

  let nextOffset = cursorOffsetStack[globalCursorDepth] + getNodePadding(cPtr) + getNodeByteLength(cPtr);

  cursorNodeStack[globalCursorDepth] = sibling;
  cursorOffsetStack[globalCursorDepth] = nextOffset;
  return true;
}

export function globalCursorGotoParent(): boolean {
  if (globalCursorDepth <= 0) return false;
  globalCursorDepth--;
  return true;
}
