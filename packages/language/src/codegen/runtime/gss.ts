import {
  allocGen0,
  atomicChunkAlloc,
  getNodeFirstChild,
  getNodeNextSibling,
  getNodePadding,
  getNodeByteLength,
  getNodeType,
  setNodeFlags,
  FLAG_LSP_VISITED,
  FLAG_INVISIBLE,
  getNodeFlags,
} from "./arena";

import { ChunkedUint32Array, UnmanagedUint32Array } from "./array";
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
  return t_activeHeads[index];
}

export function setActiveHeadsCount(count: u32): void {
  activeHeadsCount = count;
}

@unmanaged
export class ParseHead {
  state: i32;
  astNode: u32;
  prev: ParseHead | null;
  pos: u32;
  scannerState: u32;
  errorCost: i32;
  successfulShifts: i32;
  balanceHash: u32;
  consecutiveInsertions: i32;
  dynamicPrec: i32;
  pendingPadding: u32;
  errorTail: u32;
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

export const cursorNodeStack = new ChunkedUint32Array();
export const cursorOffsetStack = new ChunkedUint32Array();
export const savedCursorNodeStack = new ChunkedUint32Array();
export const savedCursorOffsetStack = new ChunkedUint32Array();

let globalCursorDepth: i32 = -1;

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

export function findReusableNode(
  targetOldPos: u32,
  targetSrcOldPos: u32,
  currentState: i32,
  envHash: u32,
  editStart: u32,
  editOldEnd: u32,
  headSym: u32,
  expectedPadding: u32,
  stateCanAcceptFn: (state: i32, tok: i32) => boolean,
  actionLookupFn: (state: i32, token: i32) => boolean
): u32 {
  if (globalCursorDepth < 0) return 0;

  let startNode = cursorNodeStack[globalCursorDepth];
  let startSrc = cursorOffsetStack[globalCursorDepth] + getNodePadding(startNode);
  if (startSrc > targetSrcOldPos) {
    return 0;
  }

  let savedDepth = globalCursorDepth;
  let copyCount = (savedDepth + 1) as u32;
  let stackSaved = false;

  let searching = true;
  while (searching) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    let absStart = cursorOffsetStack[globalCursorDepth];
    let pad = getNodePadding(cPtr);
    let absContentStart = absStart + pad;
    let byteLen = getNodeByteLength(cPtr);
    let absContentEnd = absContentStart + byteLen;
    let nodeType = getNodeType(cPtr);

    if (absContentEnd <= targetOldPos) {
      if (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) searching = false;
        else {
          while (!globalCursorGotoNextSibling()) {
            if (!globalCursorGotoParent()) {
              searching = false;
              break;
            }
          }
        }
      }
      continue;
    }

    if (absContentStart > targetOldPos) {
      searching = false;
      continue;
    }

    if (absContentStart == targetOldPos && absContentEnd > targetOldPos) {
      if (
        absContentEnd < editStart ||
        absContentStart >= editOldEnd
      ) {
        let isError = nodeType == 0;
        let isMissing = byteLen == 0 && getNodeFirstChild(cPtr) == 0 && pad == 0;
        let hasErrorPadding = pad > expectedPadding && (pad - expectedPadding) > 0;
        
        if (!isError && !isMissing && !hasErrorPadding) {
            let typeFlags = getNodeFlags(cPtr);
            let isInvisible = (typeFlags & FLAG_INVISIBLE) != 0;
            if (!isInvisible && (actionLookupFn(currentState, nodeType) || stateCanAcceptFn(currentState, nodeType))) {
               return cPtr;
            }
        }
      }
    }

    if (!stackSaved) {
      savedCursorNodeStack.copyFrom(cursorNodeStack, copyCount);
      savedCursorOffsetStack.copyFrom(cursorOffsetStack, copyCount);
      stackSaved = true;
    }

    if (!globalCursorGotoFirstChild()) {
      if (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) searching = false;
        else {
          while (!globalCursorGotoNextSibling()) {
            if (!globalCursorGotoParent()) {
              searching = false;
              break;
            }
          }
        }
      }
    }
  }

  if (stackSaved) {
    globalCursorDepth = savedDepth;
    cursorNodeStack.copyFrom(savedCursorNodeStack, copyCount);
    cursorOffsetStack.copyFrom(savedCursorOffsetStack, copyCount);
  }

  return 0;
}
