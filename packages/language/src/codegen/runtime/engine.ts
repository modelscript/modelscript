/* eslint-disable */
// @ts-nocheck
import {
  getInputBuffer as _getInputBuffer,
  allocGen0,
  allocNode,
  FLAG_GC_MARK,
  FLAG_INVISIBLE,
  FLAG_IS_LIST,
  FLAG_LSP_VISITED,
  getNodeByteLength,
  getNodeEnvHash,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  initArena,
  resetGeneration,
  S,
  setFirstChild,
  setNextSibling,
  setNodeByteLength,
  setNodeFlags,
  setNodePadding,
} from "./arena";
import { ChunkedInt32Array, ChunkedUint32Array } from "./array";
import {
  action_data as _action_data,
  action_offsets as _action_offsets,
  alias_data as _alias_data,
  goto_data as _goto_data,
  goto_offsets as _goto_offsets,
  mrd_data as _mrd_data,
  prod_aliases as _prod_aliases,
  prod_dynamic_prec as _prod_dynamic_prec,
  prod_is_invisible as _prod_is_invisible,
  prod_is_list as _prod_is_list,
  prod_lengths as _prod_lengths,
  prod_lhs as _prod_lhs,
  sync_tokens as _sync_tokens,
  token_insert_costs as _token_insert_costs,
  currentScannerState,
  inputLength,
  lex,
  lexLen,
  lexPos,
  peekToken,
  srcLexPos,
} from "./parser";
export function getInputBuffer(): usize {
  return _getInputBuffer();
}

/**
 * Zero-allocation static wrapper for baked WASM memory tables.
 * Used to directly read arrays exported by the `wabt` C-backend without instantiating Array objects.
 */
@unmanaged
class StaticTable {
  /** Reads a 32-bit integer at the given logical index. */
  @inline @operator("[]") get(index: u32): i32 {
    return load<i32>(changetype<usize>(this) + (index << 2));
  }
  /** Retrieves the encoded array length from the preceding 4-byte header. */
  @inline get length(): i32 {
    return load<i32>(changetype<usize>(this) - 4);
  }
}

const action_offsets = changetype<StaticTable>(_action_offsets);
const action_data = changetype<StaticTable>(_action_data);
const goto_offsets = changetype<StaticTable>(_goto_offsets);
const goto_data = changetype<StaticTable>(_goto_data);
const mrd_data = changetype<StaticTable>(_mrd_data);
const token_insert_costs = changetype<StaticTable>(_token_insert_costs);
const sync_tokens = changetype<StaticTable>(_sync_tokens);
const prod_lengths = changetype<StaticTable>(_prod_lengths);
const prod_lhs = changetype<StaticTable>(_prod_lhs);
const prod_is_invisible = changetype<StaticTable>(_prod_is_invisible);
const prod_is_list = changetype<StaticTable>(_prod_is_list);
const prod_dynamic_prec = changetype<StaticTable>(_prod_dynamic_prec);
const prod_aliases = changetype<StaticTable>(_prod_aliases);
const alias_data = changetype<StaticTable>(_alias_data);

import { cursorNodeStack, cursorOffsetStack } from "./cursor";

// GSS Head Structure (Simplified LR stack for this skeleton)
let stackHead: u32 = 0; // Pointer to current state
let stackBuffer = new ChunkedUint32Array(); // state stack
let astBuffer = new ChunkedUint32Array(); // ast node stack
let stackPtr: u32 = 0;

// ----------------------------------------------------------------------------
// Diagnostics & Error Reporting
// ----------------------------------------------------------------------------
export let errorCount: i32 = 0;
let errorStarts = new ChunkedUint32Array();
let errorEnds = new ChunkedUint32Array();

export function getErrorStart(index: i32): u32 {
  return errorStarts[index];
}
export function getErrorEnd(index: i32): u32 {
  return errorEnds[index];
}

/**
 * Registers an error span during the parse phase.
 * @param start The absolute byte offset of the syntax error start.
 * @param end The absolute byte offset of the syntax error end.
 */
export function reportError(start: u32, end: u32): void {
  if (errorCount < 100000) {
    errorStarts[errorCount] = start;
    errorEnds[errorCount] = end;
    errorCount++;
  }
}

export const TOKEN_EOF: i32 = 1023;
export const TOKEN_UNKNOWN: i32 = 2047;

const CHAR_LBRACE: u8 = 123; // '{'
const CHAR_RBRACE: u8 = 125; // '}'
const CHAR_LBRACKET: u8 = 91; // '['
const CHAR_RBRACKET: u8 = 93; // ']'
const CHAR_LPAREN: u8 = 40; // '('
const CHAR_RPAREN: u8 = 41; // ')'

const LIST_MAX_CHILDREN: i32 = 21;
const LIST_SPLIT_POINT: i32 = 11;

// ----------------------------------------------------------------------------
// Async Preprocessor & Token Buffer
// ----------------------------------------------------------------------------

/** Token ID signaling the parser to suspend execution and yield to the host environment. */
export const TOKEN_SUSPEND: i32 = 0x7fffffff;
export let isSuspended: boolean = false;

// Token Buffer Arena - Used for caching tokens emitted by the scanner
export let tokenBufferArena = new ChunkedInt32Array();
export let tokenBufferLenArena = new ChunkedUint32Array();
export let tokenBufferWriteIdx: u32 = 0;
export let tokenBufferReadIdx: u32 = 0;
export let tokenBufferLastPos: u32 = 0;

/**
 * Pushes a newly scanned token into the cyclic token buffer.
 * @param tok The grammar token ID.
 * @param len The byte length of the token string.
 */
export function pushTokenToBuffer(tok: i32, len: u32): void {
  tokenBufferArena[tokenBufferWriteIdx] = tok;
  tokenBufferLenArena[tokenBufferWriteIdx] = len;
  tokenBufferWriteIdx++;
}

/** Resets the read and write pointers of the token buffer. */
export function clearTokenBuffer(): void {
  tokenBufferWriteIdx = 0;
  tokenBufferReadIdx = 0;
}

// ----------------------------------------------------------------------------
// Global Tree Traversal Cursor
// ----------------------------------------------------------------------------

let lastReusedNode: u32 = 0;
let globalCursorDepth: i32 = -1;

/**
 * Initializes the global structural cursor at the given AST root.
 * This cursor is used by the incremental parser to traverse the old tree
 * and locate reusable branches during recompilation.
 * @param rootPtr The root AST node of the old parse tree.
 */
export function initGlobalCursor(rootPtr: u32): void {
  if (rootPtr != 0) {
    globalCursorDepth = 0;
    cursorNodeStack[0] = rootPtr;
    cursorOffsetStack[0] = 0; // Absolute offset is always 0 at the root
  } else {
    globalCursorDepth = -1;
  }
}

/** Returns the node currently focused by the global cursor. */
export function globalCursorCurrentNode(): u32 {
  if (globalCursorDepth < 0) return 0;
  return cursorNodeStack[globalCursorDepth];
}

/**
 * Steps the global cursor down into the first child of the current node.
 * Automatically computes and tracks the absolute offset of the new child.
 * @returns True if successful, false if there are no children.
 */
export function globalCursorGotoFirstChild(): boolean {
  if (globalCursorDepth < 0 || globalCursorDepth >= 999999) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let child = getNodeFirstChild(cPtr);
  if (child == 0) return false;

  // Calculate new absolute start by considering parent padding
  let parentStart = cursorOffsetStack[globalCursorDepth] + getNodePadding(cPtr);
  let childPad = getNodePadding(child);
  // Saturating subtraction to prevent underflow if child padding engulfs parent start
  let absStart: u32 = parentStart >= childPad ? parentStart - childPad : 0;

  globalCursorDepth++;
  cursorNodeStack[globalCursorDepth] = child;
  cursorOffsetStack[globalCursorDepth] = absStart;
  return true;
}

/**
 * Steps the global cursor horizontally to the next sibling.
 * Automatically computes the sibling's absolute starting offset.
 * @returns True if successful, false if it's the last sibling.
 */
export function globalCursorGotoNextSibling(): boolean {
  if (globalCursorDepth < 0) return false;

  let cPtr = cursorNodeStack[globalCursorDepth];
  let sibling = getNodeNextSibling(cPtr);
  if (sibling == 0) return false;

  // Sibling offset = Current Offset + Current Padding + Current Byte Length
  let nextOffset = cursorOffsetStack[globalCursorDepth] + getNodePadding(cPtr) + getNodeByteLength(cPtr);

  cursorNodeStack[globalCursorDepth] = sibling;
  cursorOffsetStack[globalCursorDepth] = nextOffset;
  return true;
}

/**
 * Steps the global cursor upward to the parent node.
 * @returns True if successful, false if already at the root.
 */
export function globalCursorGotoParent(): boolean {
  if (globalCursorDepth <= 0) return false;
  globalCursorDepth--;
  return true;
}

/**
 * Attempts to locate a structurally identical branch from the previous parse tree that can be reused
 * in the current incremental parsing phase.
 *
 * The algorithm:
 * 1. Restores the global cursor context and walks the tree forward.
 * 2. Prunes subtrees that lie completely behind or beyond the current scan position.
 * 3. Rejects nodes that intersect the user's text edit boundary.
 * 4. Validates that the node is a legal transition (SHIFT or GOTO) for the current parser state.
 *
 * @param targetOldPos The previous parse iteration's cursor position.
 * @param targetSrcOldPos The absolute byte offset in the old source buffer.
 * @param currentState The active parser state (LR stack top).
 * @param envHash The expected structural hash environment (e.g. brace depth).
 * @param editStart The byte offset where the user's edit began.
 * @param editOldEnd The byte offset where the old replaced text ended.
 * @param headSym The symbol ID of the current GSS parse head.
 * @param expectedPadding The exact whitespace/comment padding length required to match.
 * @returns The pointer to the reusable node, or 0 if none is found.
 */
export function findReusableNode(
  targetOldPos: u32,
  targetSrcOldPos: u32,
  currentState: i32,
  envHash: u32,
  editStart: u32,
  editOldEnd: u32,
  headSym: u32,
  expectedPadding: u32,
): u32 {
  if (globalCursorDepth < 0) return 0;

  // 1. Validate cursor position and reset to root if we've somehow overshot
  let startNode = cursorNodeStack[globalCursorDepth];
  let startSrc = cursorOffsetStack[globalCursorDepth] + getNodePadding(startNode);
  if (startSrc > targetSrcOldPos) {
    globalCursorDepth = 0;
    cursorOffsetStack[0] = 0;
  }

  // 2. Snapshot the global cursor state so we can restore it if search fails
  let initialDepth = globalCursorDepth;
  let savedCursorNodeStack = globalSavedCursorNodeStack;
  let savedCursorOffsetStack = globalSavedCursorOffsetStack;
  for (let i = 0; i <= initialDepth; i++) {
    savedCursorNodeStack[i] = cursorNodeStack[i];
    savedCursorOffsetStack[i] = cursorOffsetStack[i];
  }

  let searching = true;
  let guard = 0;

  // 3. Tree Traversal Loop
  while (searching && guard++ < 200000) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    let cSrcStart = cursorOffsetStack[globalCursorDepth] + getNodePadding(cPtr);
    let cStart = cSrcStart - getNodePadding(cPtr);
    let cEnd = cSrcStart + getNodeByteLength(cPtr);
    let cEnvHash = getNodeEnvHash(cPtr);

    // Break early if we've moved past the target origin point
    if (cSrcStart > targetSrcOldPos) {
      break;
    }

    // Check if the current node encloses the target position
    if (cSrcStart <= targetSrcOldPos && cEnd > targetSrcOldPos) {
      // A node cannot be reused if the user's edit overlaps with its span
      let intersects = !(cEnd < editStart || cStart > editOldEnd);
      let isValid = false;
      let nodeFlags = getNodeFlags(cPtr);

      // Strict matching: must not intersect, must have exact start, non-empty, and matching environment
      if (
        cPtr != cursorNodeStack[0] &&
        !intersects &&
        cSrcStart == targetSrcOldPos &&
        cEnvHash == envHash &&
        cEnd > cSrcStart
      ) {
        if (expectedPadding == getNodePadding(cPtr)) {
          let nodeSym = getNodeType(cPtr) as i32;

          // Direct symbol match (e.g., splicing a list of the exact same type)
          if (headSym == (nodeSym as u32) && (nodeFlags & 4) != 0) {
            isValid = true;
          } else {
            // Validate against the GOTO table
            let gOffset = goto_offsets[currentState];
            let gCount = goto_data[gOffset];
            let gIdx = gOffset + 1;
            for (let i = 0; i < gCount; i++) {
              if (goto_data[gIdx++] == nodeSym) {
                isValid = true;
                break;
              } else {
                gIdx++;
              }
            }

            // If not a valid GOTO, check the ACTION table for a valid SHIFT
            if (!isValid) {
              let actionOffset = action_offsets[currentState];
              let actionCount = 0;
              let idx = 0;
              if (actionOffset >= 0) {
                actionCount = action_data[actionOffset];
                idx = actionOffset + 1;
              }
              for (let i = 0; i < actionCount; i++) {
                let sym = action_data[idx++];
                let actCount = action_data[idx++];
                if (sym == nodeSym) {
                  for (let j = 0; j < actCount; j++) {
                    let type = action_data[idx++];
                    // type 0 == SHIFT
                    if (type == 0) isValid = true;
                    idx++; // skip target
                  }
                  break;
                } else {
                  idx += actCount * 2;
                }
              }
            }
          }
        }
      }

      if (isValid) {
        return cPtr;
      }

      // Step down into children if node wasn't perfectly reusable but encloses the target
      let hasChildren = getNodeFirstChild(cPtr) != 0;
      if (hasChildren) {
        if (globalCursorGotoFirstChild()) {
          continue;
        }
      }
    }

    // 4. Backtrack / Sibling Advance
    let advanced = false;
    let upGuard = 0;
    while (!advanced && upGuard++ < 100000) {
      if (globalCursorGotoNextSibling()) {
        advanced = true;
      } else {
        if (!globalCursorGotoParent()) {
          searching = false;
          break;
        }
      }
    }
  }

  // 5. Restore snapshot on failure
  globalCursorDepth = initialDepth;
  for (let i = 0; i <= initialDepth; i++) {
    cursorNodeStack[i] = savedCursorNodeStack[i];
    cursorOffsetStack[i] = savedCursorOffsetStack[i];
  }

  return 0;
}

// ----------------------------------------------------------------------------
// GLR Data Structures
// ----------------------------------------------------------------------------

/**
 * Represents a single concurrent parse state (head) in the Graph-Structured Stack (GSS).
 * This class is `@unmanaged`, meaning it is allocated in Generation 0 (short-lived)
 * memory and is manually collected during garbage collection sweeps.
 */
@unmanaged
class ParseHead {
  /** The LR state ID of this head. */
  state: i32;
  /** Pointer to the AST node parsed immediately before entering this state. */
  astNode: u32;
  /** Pointer to the predecessor head in the GSS. */
  prev: ParseHead | null;
  /** The absolute byte offset in the input buffer where this head currently is. */
  pos: u32;
  /** The active scanner state (e.g. tracking multiline comments or strings). */
  scannerState: u32;
  /** Accumulated error recovery penalty cost. Lower is better. 0 means valid syntax. */
  errorCost: i32;
  /** Counter used to decay errorCost after successfully shifting N valid tokens. */
  successfulShifts: i32;
  /** Structural environment hash (tracks brace/bracket/parenthesis depth). */
  balanceHash: u32;
  /** Penalizes consecutive inserted tokens to prevent runaway recovery loops. */
  consecutiveInsertions: i32;
  /** Dynamic precedence score used to resolve shift/reduce conflicts globally. */
  dynamicPrec: i32;
  /** Whitespace/comments accumulating before the next valid syntax node. */
  pendingPadding: u32;
}

/**
 * Represents a suspended alternative parse path created during error recovery.
 * Error branches are explored iteratively based on their cost threshold.
 */
class ErrorBranch {
  head: u32;
  cost: i32;
  lexPos: u32;
  token: i32;
  lexLen: u32;
  threshold: i32;
  errStart: u32;
  errEnd: u32;
  scannerState: u32;

  constructor(
    head: u32,
    cost: i32,
    lexPos: u32,
    token: i32,
    lexLen: u32,
    threshold: i32,
    errStart: u32,
    errEnd: u32,
    scannerState: u32,
  ) {
    this.head = head;
    this.cost = cost;
    this.lexPos = lexPos;
    this.token = token;
    this.lexLen = lexLen;
    this.threshold = threshold;
    this.errStart = errStart;
    this.errEnd = errEnd;
    this.scannerState = scannerState;
  }
}

// ----------------------------------------------------------------------------
// Legacy Imports / Globals
// ----------------------------------------------------------------------------

declare namespace parser {
  export function emitTextEdit(op: u32, len: u32, start: u32, end: u32): void;
  export function getSourceSlice(start: u32, end: u32): u32;
}

export let globalLoopGuard: u32 = 0;
export let globalBestDyingHead: u32 = 0;
export let globalToken: i32 = -1;

// ----------------------------------------------------------------------------
// GLR Execution Context
// ----------------------------------------------------------------------------

let globalActiveHeads = new ChunkedUint32Array();
let activeHeadsCount: u32 = 0;

let globalNewActiveHeads = new ChunkedUint32Array();
let globalChildNodes = new ChunkedInt32Array();
let globalChildren = new ChunkedInt32Array();

let globalIsCatastrophic: boolean = false;
/** Returns true if the parser encountered an unrecoverable syntax error. */
export function lsp_isCatastrophicError(): boolean {
  return globalIsCatastrophic;
}

let globalSavedCursorNodeStack = new ChunkedUint32Array();
let globalSavedCursorOffsetStack = new ChunkedUint32Array();

/**
 * A bitmap of tokens that are valid transitions from the current active GLR heads.
 * Used by the language server for auto-completion triggering.
 */
export const expected_tokens = new StaticArray<u8>(2048);

/**
 * Computes the union of all valid next tokens across all currently active GSS heads.
 * Scans the action table for each active head's state.
 */
function updateExpectedTokens(): void {
  memory.fill(changetype<usize>(expected_tokens), 0, 2048);
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let head = changetype<ParseHead>(globalActiveHeads.get(i));
    let state = head.state;
    let actionOffset = action_offsets[state];
    let actionCount = 0;
    let idx = 0;

    if (actionOffset >= 0) {
      actionCount = action_data[actionOffset];
      idx = actionOffset + 1;
    }

    for (let j = 0; j < actionCount; j++) {
      let sym = action_data[idx++];
      if (sym < 2048) expected_tokens[sym] = 1;
      let actCount = action_data[idx++];
      idx += actCount * 2;
    }
  }
}

// Pre-allocated buffer for REDUCE child collection (avoids per-reduction GC allocation)
let globalReduceCollected = new ChunkedUint32Array();

/**
 * Allocates a new ParseHead struct in Generation 0 memory.
 * Gen0 is cleared at the start of every parse pass, providing zero-overhead GC.
 */
function allocParseHead(
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
): ParseHead {
  let ptr = allocGen0(44);
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
  return h;
}

let globalLoopIterations = 0;

/** Retrieves the total number of LR state transitions evaluated in the last parse. */
export function getLoopIterations(): u32 {
  return globalLoopIterations;
}

/** Bootstraps the WASM memory arena with the requested byte capacity (default 96MB). */
export function initCompiler(): void {
  const ARENA_SIZE = 96 * 1024 * 1024;
  initArena(ARENA_SIZE);
}

/**
 * Explores the LR state machine forward (depth-first) to determine if a specific token
 * can be legally shifted from a given state without encountering an error.
 * Used exclusively for lookahead during error recovery branch pruning.
 *
 * @param head The parse head from which to explore.
 * @param state The current LR state.
 * @param tok The token to test acceptance for.
 * @param depth Recursion limit (prevents infinite loop on cyclic epsilon reductions).
 * @returns True if the token is accepted (SHIFT or ACCEPT action found).
 */
function stateCanAccept(head: ParseHead | null, state: i32, tok: i32, depth: i32 = 0): boolean {
  if (depth > 10) return false;
  if (state < 0 || state >= action_offsets.length) return false;

  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) return false;

  let actionCount = action_data[actionOffset];
  let idx = actionOffset + 1;
  for (let i = 0; i < actionCount; i++) {
    if (idx < 0 || idx + 1 >= action_data.length) return false;
    let sym = action_data[idx];
    let actCount = action_data[idx + 1];
    let actIdx = idx + 2;
    if (sym == tok || sym == 0) {
      for (let j = 0; j < actCount; j++) {
        let type = action_data[actIdx++];
        let target = action_data[actIdx++];
        if (type == 0 || type == 2) {
          return true;
        }
        if (type == 1) {
          // REDUCE
          let ruleLen = prod_lengths[target];
          let ruleLHS = prod_lhs[target];
          let pHead = head;
          for (let u = 0; u < ruleLen; u++) {
            if (pHead != null) pHead = pHead.prev;
          }
          let nextState = -1;
          if (pHead != null) {
            let gOffset = goto_offsets[pHead.state];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              let gIdx = gOffset + 1;
              for (let k = 0; k < gCount; k++) {
                if (goto_data[gIdx++] == ruleLHS) {
                  nextState = goto_data[gIdx++];
                  break;
                } else {
                  gIdx++;
                }
              }
            }
          } else if (ruleLen == 0) {
            // If pHead is null and ruleLen is 0, we can't reliably goto without a state.
          }
          if (nextState != -1) {
            if (stateCanAccept(pHead, nextState, tok, depth + 1)) return true;
          }
        }
      }
    }
    idx += 2 + actCount * 2;
  }
  return false;
}

export let lastIterCount = 0;
export let lastBestCost = 0;
export let lastMaxHeads = 0;

/**
 * The main entrypoint for the GLR/LR(1) parser.
 * Executes incrementally by attempting to reuse nodes from the `oldTree` outside of the edit bounds.
 *
 * @param oldTree Pointer to the root of the previous parse tree (0 if first parse).
 * @param editStart The absolute byte offset where the user's text edit began.
 * @param editOldEnd The absolute byte offset where the old text ended before replacement.
 * @param editNewEnd The absolute byte offset of the new total input length.
 * @returns A pointer to the newly allocated AST root node.
 */
export function parse(oldTree: u32, editStart: u32, editOldEnd: u32, editNewEnd: u32): u32 {
  globalIsCatastrophic = false;

  let pos: u32 = 0;
  let token: i32 = 0;
  inputLength = editNewEnd;

  let activeHeads = globalActiveHeads;

  // Only perform complete reset if we are not resuming from an async suspend
  if (!isSuspended) {
    resetGeneration(0);
    errorCount = 0;
    lexPos = 0;
    lexLen = 0;
    currentScannerState = 0;
    pos = 0;
    activeHeadsCount = 0;

    // Initialize the GSS with State 0
    activeHeads.set(0, changetype<u32>(allocParseHead(0, 0, null, pos, currentScannerState, 0, 0, 0, 0, 0)));
    activeHeadsCount = 1;

    updateExpectedTokens();
    token = __LEX_FN__(pos);
    initGlobalCursor(oldTree);
  }
  isSuspended = false;

  // Error recovery trackers
  let furthestDyingPos: u32 = 0;
  let bestDyingHead: u32 = 0;

  let acceptedNode: u32 = 0;
  let bestAcceptedCost: i32 = 999999;
  lastBestCost = 999999;
  lastIterCount = 0;
  lastReusedNode = 0;
  globalLoopIterations = 0;

  let maxHeads: u32 = 0;
  let iterGuard: u32 = 0;

  // --------------------------------------------------------------------------
  // Main GSS Processing Loop
  // --------------------------------------------------------------------------
  while (true) {
    lastIterCount = iterGuard;
    if (iterGuard++ > 200000) {
      break;
    }
    if (activeHeadsCount > maxHeads) {
      maxHeads = activeHeadsCount;
      lastMaxHeads = maxHeads;
    }
    globalLoopIterations++;
    globalLoopGuard++;
    // Proportional loop guard: 100× input length, minimum 1M iterations.
    // This scales with file size instead of using a fixed limit that may be
    // too low for large files or too high for small ones.
    let inputLen: u32 = inputLength;
    let loopLimit: u32 = inputLen * 100;
    if (loopLimit < 1000000) loopLimit = 1000000;
    if (globalLoopGuard > loopLimit) {
      if (activeHeadsCount > 0) {
        bestDyingHead = activeHeads.get(0);
      }
      break;
    }

    let headPtr: u32 = 0;

    if (activeHeadsCount == 0) {
      break;
    } else {
      let minPos: u32 = 0;
      let minIdx = 0;
      let hasErrors = false;
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(activeHeads.get(i));
        if (h.errorCost > 0) hasErrors = true;
      }
      if (hasErrors && activeHeadsCount > 256) {
        // Sort by quality (errorCost ASC, pos DESC) before trimming
        // so we keep the most promising parse paths.
        for (let si: u32 = 0; si < activeHeadsCount && si < 256; si++) {
          let bestIdx = si;
          let bestH = changetype<ParseHead>(activeHeads.get(si));
          for (let sj: u32 = si + 1; sj < activeHeadsCount; sj++) {
            let candH = changetype<ParseHead>(activeHeads.get(sj));
            if (candH.errorCost < bestH.errorCost || (candH.errorCost == bestH.errorCost && candH.pos > bestH.pos)) {
              bestIdx = sj;
              bestH = candH;
            }
          }
          if (bestIdx != si) {
            let tmp = activeHeads.get(si);
            activeHeads.set(si, activeHeads.get(bestIdx));
            activeHeads.set(bestIdx, tmp);
          }
        }
        activeHeadsCount = 256;
      }
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(activeHeads.get(i));
        if (i == 0 || h.pos < minPos) {
          minPos = h.pos;
          minIdx = i;
        }
      }
      headPtr = activeHeads.get(minIdx);
      activeHeads.set(minIdx, activeHeads.get(activeHeadsCount - 1));
      activeHeadsCount -= 1;
    }
    let head = changetype<ParseHead>(headPtr);
    let allocStart = S().allocCount;

    pos = head.pos;

    currentScannerState = head.scannerState;
    lexPos = pos;

    // Token Buffer Arena Consumption
    // Advance buffer read index only if we have moved past the previous buffer token
    if (pos > tokenBufferLastPos && tokenBufferReadIdx < tokenBufferWriteIdx) {
      tokenBufferReadIdx++;
    }

    if (tokenBufferReadIdx < tokenBufferWriteIdx) {
      token = tokenBufferArena[tokenBufferReadIdx];
      lexLen = tokenBufferLenArena[tokenBufferReadIdx];
      tokenBufferLastPos = pos;
    } else {
      updateExpectedTokens();
      token = __LEX_FN__(pos);
      if (tokenBufferReadIdx < tokenBufferWriteIdx) {
        token = tokenBufferArena[tokenBufferReadIdx];
        lexLen = tokenBufferLenArena[tokenBufferReadIdx];
      }
      tokenBufferLastPos = pos;
    }

    if (token == TOKEN_SUSPEND) {
      // Push the head back and yield execution
      activeHeads.set(activeHeadsCount, changetype<u32>(head));
      activeHeadsCount++;
      isSuspended = true;
      return 0xffffffff; // Special yield signal
    }

    let currentState = head.state;
    if (currentState < 0 || currentState >= action_offsets.length) {
      throw new Error("BAD currentState: " + currentState.toString());
    }

    let oldPos = lexPos;
    let oldSrcLexPos = srcLexPos;

    if (lexPos >= editNewEnd) {
      oldPos = editOldEnd + (lexPos - editNewEnd);
    } else if (lexPos >= editStart) {
      oldPos = 0xffffffff;
    }

    if (srcLexPos >= editNewEnd) {
      oldSrcLexPos = editOldEnd + (srcLexPos - editNewEnd);
    } else if (srcLexPos >= editStart) {
      oldSrcLexPos = 0xffffffff;
    }

    let headSym: u32 = 0xffffffff;
    if (head != null && head.astNode != 0) headSym = getNodeType(head.astNode) as u32;

    // ------------------------------------------------------------------------
    // Structural Node Reuse (Incremental Parsing Phase)
    // ------------------------------------------------------------------------
    let reusedNode: u32 = 0;
    if (oldSrcLexPos != 0xffffffff) {
      let expectedPadding = srcLexPos > pos ? srcLexPos - pos : 0;
      reusedNode = findReusableNode(
        oldPos,
        oldSrcLexPos,
        currentState,
        head.balanceHash & 0xff,
        editStart,
        editOldEnd,
        headSym,
        expectedPadding,
      );
    }

    if (reusedNode != 0) {
      let nodeSym = getNodeType(reusedNode) as i32;

      // Query the GOTO table to determine if this non-terminal can transition from the current state
      let gOffset = goto_offsets[currentState];
      let gCount = goto_data[gOffset];
      let gIdx = gOffset + 1;
      let nextState = -1;
      for (let i = 0; i < gCount; i++) {
        if (goto_data[gIdx++] == nodeSym) {
          nextState = goto_data[gIdx++];
          break;
        } else {
          gIdx++;
        }
      }

      // Splicing: If the parser is currently building a list (headSym == nodeSym)
      // and there is no valid GOTO, we can manually append this list node.
      let isSplice = false;
      if (nextState == -1) {
        let nodeFlags = getNodeFlags(reusedNode);
        if (headSym == (nodeSym as u32) && (nodeFlags & 4) != 0) {
          isSplice = true;
        }
      }

      if (isSplice) {
        // Shallow clone the reused node so we can mutate its links without affecting the old tree
        let cloneReused = allocNode(
          nodeSym as u16,
          getNodePadding(reusedNode) + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(cloneReused, getNodeFlags(reusedNode) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(cloneReused, getNodeFirstChild(reusedNode)); // Inherit old children

        // Splice it into the GSS head
        let merged = concatLists(head.astNode, cloneReused, nodeSym as u16, currentScannerState);
        let newPos = pos + getNodePadding(reusedNode) + head.pendingPadding + getNodeByteLength(reusedNode);

        head = allocParseHead(
          head.state,
          merged,
          head.prev,
          newPos,
          currentScannerState,
          head.errorCost,
          head.successfulShifts,
          head.balanceHash,
          head.consecutiveInsertions,
          head.dynamicPrec,
        );
        activeHeads.set(activeHeadsCount++, changetype<u32>(head));
        pos = newPos;
        token = __LEX_FN__(pos);
        continue; // Yield to the next GSS iteration
      } else if (nextState != -1) {
        // Standard GOTO shift over the reused subtree
        let clone = allocNode(
          getNodeType(reusedNode),
          getNodePadding(reusedNode) + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(clone, getNodeFlags(reusedNode) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(clone, getNodeFirstChild(reusedNode));

        let newPos = pos + getNodePadding(reusedNode) + head.pendingPadding + getNodeByteLength(reusedNode);

        head = allocParseHead(
          nextState,
          clone,
          head,
          newPos,
          currentScannerState,
          head.errorCost,
          head.successfulShifts,
          head.balanceHash,
          head.consecutiveInsertions,
          head.dynamicPrec,
        );
        activeHeads.set(activeHeadsCount++, changetype<u32>(head));
        pos = newPos;
        token = __LEX_FN__(pos);
        continue; // Yield to the next GSS iteration
      }
    }

    // ------------------------------------------------------------------------
    // Action Table Lookups (SHIFT / REDUCE / ACCEPT)
    // ------------------------------------------------------------------------
    let actionOffset = action_offsets[currentState];
    let actionCount = 0;
    let idx = 0;
    if (actionOffset >= 0 && actionOffset < action_data.length) {
      actionCount = action_data[actionOffset];
      idx = actionOffset + 1;
    }

    let anyAction = false;
    for (let i = 0; i < actionCount; i++) {
      if (idx < 0 || idx + 1 >= action_data.length) {
        throw new Error("BAD idx in action loop");
      }

      let sym = action_data[idx++];
      let actCount = action_data[idx++];

      // Match the exact token, or token 0 (which signifies a wildcard/default action)
      if (sym == token || sym == 0) {
        for (let j = 0; j < actCount; j++) {
          let type = action_data[idx++];
          let target = action_data[idx++];

          // --------------------------------------------------------------------
          // TYPE 0: SHIFT ACTION
          // --------------------------------------------------------------------
          if (type == 0) {
            // Structural Hashing: update brace/bracket depth for incremental env tracking
            let newBalance = head.balanceHash;
            if (lexLen == 1) {
              let c = load<u8>(getInputBuffer() + lexPos);
              if (c == 123 || c == 91 || c == 40) newBalance++;
              else if (c == 125 || c == 93 || c == 41) newBalance--;
            }

            // Allocate the leaf node for the shifted token
            let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
            let leaf = allocNode(token as u16, paddingLength, lexLen, newBalance & 0xff);

            let nPos = srcLexPos + lexLen;
            let newCost = head.errorCost;
            let newShifts = head.successfulShifts + 1;

            // Branch the GSS: create a new parse head
            let newHead = allocParseHead(
              target,
              leaf,
              head,
              nPos,
              currentScannerState,
              newCost,
              newShifts,
              newBalance,
              0,
              head.dynamicPrec,
              0,
            );

            // GLR Merge: If multiple active heads end up in the identical state at the same position,
            // merge them by keeping the one with the lowest error cost or highest precedence.
            let mergedH = false;
            for (let k: u32 = 0; k < activeHeadsCount; k++) {
              let ah = changetype<ParseHead>(activeHeads.get(k));
              if (ah.pos == newHead.pos && ah.state == newHead.state && ah.prev == newHead.prev) {
                mergedH = true;
                if (
                  newHead.errorCost < ah.errorCost ||
                  (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
                ) {
                  activeHeads.set(k, changetype<u32>(newHead));
                }
                break;
              }
            }

            if (!mergedH) activeHeads.set(activeHeadsCount++, changetype<u32>(newHead));
            anyAction = true;

            // --------------------------------------------------------------------
            // TYPE 1: REDUCE ACTION
            // --------------------------------------------------------------------
          } else if (type == 1) {
            let reduceProd = target;
            if (reduceProd < 0 || reduceProd >= prod_lengths.length) {
              throw new Error("BAD reduceProd: " + reduceProd.toString());
            }

            let popCount = prod_lengths[reduceProd];
            let lhsSym = prod_lhs[reduceProd];

            // 1. Pop children from the GSS
            // We pop `popCount` syntax nodes from the stack.
            // We also automatically include any parsed Error nodes that happen to exist in that span.
            let curr: ParseHead | null = head;
            let childNodes = globalChildNodes;
            let collected = globalReduceCollected;
            let c_idx = 99;
            let needed = popCount;

            while (needed > 0 && curr != null) {
              if (getNodeType(curr.astNode) == 0) {
                // type 0 == Error node
                collected[c_idx--] = curr.astNode;
              } else {
                collected[c_idx--] = curr.astNode;
                needed--;
              }
              curr = curr.prev;
            }
            if (curr == null && needed > 0) continue; // Invalid reduction path

            let origPopCount = popCount;
            let actualCount = 99 - c_idx;
            for (let k = 0; k < actualCount; k++) {
              childNodes[k] = collected[c_idx + 1 + k];
            }

            // 2. Create the Parent Node
            if (curr) {
              let totalByteLength: u32 = 0;
              let firstChildPadding: u32 = 0;
              if (actualCount > 0) {
                firstChildPadding = getNodePadding(childNodes[0]);
                for (let k = 0; k < actualCount; k++) {
                  let cPadding = getNodePadding(childNodes[k]);
                  let cLen = getNodeByteLength(childNodes[k]);
                  if (k == 0)
                    totalByteLength += cLen; // parent padding absorbs first child padding
                  else totalByteLength += cPadding + cLen;
                }
              }
              let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, head.balanceHash & 0xff);

              // Apply grammar-defined visibility and list flags
              if (prod_is_list[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_IS_LIST);
              }
              if (prod_is_invisible[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_INVISIBLE);
              }

              // 3. Link Children into the new Parent
              if (actualCount > 0) {
                let isListAppend = false;
                // List append optimization: if the grammar rule is recursive on the left, flatten it
                if (popCount == 2 && actualCount == 2 && childNodes[0] != 0 && prod_is_list[reduceProd] == 1) {
                  let leftSym = getNodeType(childNodes[0]);
                  if (leftSym == lhsSym) isListAppend = true;
                }

                if (isListAppend) {
                  // Fast list flattening
                  parentNode = appendToList(childNodes[0], childNodes[1], lhsSym as u16, currentScannerState);
                } else {
                  let lastChild = 0;
                  let logicalChildIndex = 0;

                  // Determine if this production rule applies field aliases to its children
                  let aliasPtr = prod_aliases[reduceProd];
                  let aliasCount = 0;
                  if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

                  for (let k = 0; k < actualCount; k++) {
                    let child = childNodes[k];
                    if (child == 0) continue;

                    // Shallow clone the child to avoid modifying shared references in the GLR forest
                    let clone = cloneNodeShallow(child);

                    let isError = getNodeType(child) == 0;
                    if (!isError && aliasPtr >= 0) {
                      // Apply field alias mapping if the grammar defines one for this logical index
                      for (let a = 0; a < aliasCount; a++) {
                        let aIndex = alias_data[aliasPtr + 1 + a * 2];
                        let aSym = alias_data[aliasPtr + 1 + a * 2 + 1];
                        if (aIndex == logicalChildIndex) {
                          let currentVal = load<u32>(clone, 0);
                          // Mask out the lower 10 bits (type ID) and overwrite with the alias ID
                          store<u32>(clone, (currentVal & ~0x03ff) | (aSym as u32), 0);
                          break;
                        }
                      }
                      logicalChildIndex++;
                    } else if (!isError) {
                      logicalChildIndex++;
                    }

                    // Append the clone to the parent's children linked list
                    if (lastChild == 0) setFirstChild(parentNode, clone);
                    else setNextSibling(lastChild, clone);
                    lastChild = clone;
                  }
                  let pFlags = getNodeFlags(parentNode);
                  setNodeFlags(parentNode, pFlags);
                }
              }

              // 4. State Transition (GOTO lookup)
              if (curr.state < 0 || curr.state >= goto_offsets.length) {
                throw new Error("BAD curr.state in REDUCE: " + curr.state.toString());
              }

              let gOffset = goto_offsets[curr.state];
              if (gOffset < 0 || gOffset >= goto_data.length) {
                throw new Error("BAD gOffset: " + gOffset.toString());
              }

              let gCount = goto_data[gOffset];
              let nextState = -1;
              let gIdx = gOffset + 1;
              for (let k = 0; k < gCount; k++) {
                // Search the GOTO table for the LHS symbol of the reduction
                if (goto_data[gIdx++] == lhsSym) {
                  nextState = goto_data[gIdx++];
                  break;
                } else {
                  gIdx++;
                }
              }

              // If a valid GOTO transition exists (or it's the root accepting state)
              if (nextState != -1 && (nextState != 1 || token == TOKEN_EOF)) {
                let newHead = allocParseHead(
                  nextState,
                  parentNode,
                  curr,
                  head.pos,
                  currentScannerState,
                  head.errorCost,
                  head.successfulShifts,
                  head.balanceHash,
                  head.consecutiveInsertions,
                  head.dynamicPrec + prod_dynamic_prec[reduceProd],
                  head.pendingPadding,
                );
                let mergedH = false;
                for (let k: u32 = 0; k < activeHeadsCount; k++) {
                  let ah = changetype<ParseHead>(activeHeads.get(k));
                  if (ah.pos == newHead.pos && ah.state == newHead.state && ah.prev == newHead.prev) {
                    mergedH = true;
                    if (
                      newHead.errorCost < ah.errorCost ||
                      (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
                    ) {
                      activeHeads.set(k, changetype<u32>(newHead));
                    }
                    break;
                  }
                }
                if (!mergedH) activeHeads.set(activeHeadsCount++, changetype<u32>(newHead));
                anyAction = true;
              }
            }
            // --------------------------------------------------------------------
            // TYPE 2: ACCEPT ACTION
            // --------------------------------------------------------------------
          } else if (type == 2) {
            // If this parse path accumulated error recovery costs
            if (head.errorCost > 0) {
              let t_curr: ParseHead | null = head;
              let t_bytes: u32 = 0;
              let t_count = 0;

              // Count and measure the remaining fragmented nodes in the GSS
              while (t_curr) {
                if (t_curr.astNode != 0) {
                  t_bytes += getNodePadding(t_curr.astNode) + getNodeByteLength(t_curr.astNode);
                  t_count++;
                }
                t_curr = t_curr.prev;
              }

              // If there's only 1 root node, we can accept it directly if it's the best option
              if (t_count <= 1) {
                if (head.errorCost < bestAcceptedCost) {
                  bestAcceptedCost = head.errorCost;
                  lastBestCost = bestAcceptedCost;
                  acceptedNode = head.astNode;
                }
              } else {
                // Otherwise, we wrap the fragmented GSS path into an artificial Error node (Type 0)
                if (head.errorCost < bestAcceptedCost) {
                  bestAcceptedCost = head.errorCost;
                  lastBestCost = bestAcceptedCost;

                  let root = allocNode(0, 0, t_bytes, 0); // 0 = Error Node
                  t_curr = head;
                  let children = globalChildren;
                  let c_idx = t_count - 1;

                  // Collect children backwards from the GSS
                  while (t_curr) {
                    if (t_curr.astNode != 0) {
                      children[c_idx--] = t_curr.astNode;
                    }
                    t_curr = t_curr.prev;
                  }

                  // Link them linearly into the new error root
                  let lastC = 0;
                  for (let i = 0; i < t_count; i++) {
                    let c = children[i];
                    if (c == 0) continue;
                    let clone = cloneNodeShallow(c);
                    if (lastC == 0) setFirstChild(root, clone);
                    else setNextSibling(lastC, clone);
                    lastC = clone;
                  }
                  acceptedNode = root;
                }
              }
            } else {
              // Clean path (no error cost). We accept the final produced AST node.
              let t_curr: ParseHead | null = head;
              while (t_curr != null) {
                if (t_curr.astNode != 0) {
                  let t = getNodeType(t_curr.astNode);
                  if (t != TOKEN_UNKNOWN && t != TOKEN_EOF) {
                    break;
                  }
                }
                t_curr = t_curr.prev;
              }
              if (t_curr != null && t_curr.astNode != 0) {
                if (head.errorCost < bestAcceptedCost) {
                  bestAcceptedCost = head.errorCost;
                  lastBestCost = bestAcceptedCost;
                  acceptedNode = t_curr.astNode;
                }
              } else {
                if (head.errorCost < bestAcceptedCost) {
                  bestAcceptedCost = head.errorCost;
                  lastBestCost = bestAcceptedCost;
                  acceptedNode = head.astNode;
                }
              }
            }
            anyAction = true;
          }
        }
        break;
      } else {
        idx += actCount * 2;
      }
    }

    if (acceptedNode != 0 && activeHeadsCount == 0) {
      return acceptedNode;
    }

    if (!anyAction) {
      // --------------------------------------------------------------------
      // PHASE 3: GLR Error Recovery Forking
      // --------------------------------------------------------------------
      // When a parse head cannot shift or reduce the current token, it enters error recovery.
      // We branch the GSS in multiple directions (Deletion, Insertion, Forced Reduction)
      // and assign a penalty cost to each branch.

      if (head.pos >= furthestDyingPos) {
        furthestDyingPos = head.pos;
        bestDyingHead = changetype<u32>(head);
      }

      // Prevent infinite error recovery loops by killing heads with catastrophic costs
      if (head.errorCost > 100) {
        continue;
      }

      // Prune if there is a single branch that is strictly better than us
      // (i.e. has a lower cost and has advanced further in the file)
      let strictlyBetterExists = false;
      let aLength = activeHeadsCount;
      for (let i: u32 = 0; i < aLength; i++) {
        let ah = changetype<ParseHead>(activeHeads.get(i));
        if (ah.errorCost < head.errorCost && ah.pos > pos) {
          strictlyBetterExists = true;
          break;
        }
      }
      if (strictlyBetterExists) continue;

      let errorType = 0; // SyntaxType.ERROR

      let count2 = action_data[actionOffset];
      let idx2 = actionOffset + 1;
      let reduced = false;

      // --------------------------------------------------------------------
      // ERROR BRANCH C: Forced Reduction
      // --------------------------------------------------------------------
      // If the state allows it, try reducing regardless of the lookahead token.
      // This helps pop out of nested statements where a closing bracket was missed.
      for (let i = 0; i < count2; i++) {
        if (idx2 < 0 || idx2 + 1 >= action_data.length) {
          throw new Error("BAD idx2 in error C");
        }
        let sym = action_data[idx2++];
        let actCount = action_data[idx2++];
        for (let j = 0; j < actCount; j++) {
          let type = action_data[idx2++];
          let target = action_data[idx2++];

          if (type == 1) {
            // Reduce transition
            let reduceProd = target;
            let popCount = prod_lengths[reduceProd];
            let lhsSym = prod_lhs[reduceProd];

            let curr: ParseHead | null = head;
            let childNodes = globalChildNodes;
            let collected = globalReduceCollected;
            let c_idx = 99;
            let needed = popCount;

            while (needed > 0 && curr != null) {
              if (getNodeType(curr.astNode) == 0) {
                collected[c_idx--] = curr.astNode;
              } else {
                collected[c_idx--] = curr.astNode;
                needed--;
              }
              curr = curr.prev;
            }

            if (curr == null && needed > 0) {
              continue; // Invalid reduction, not enough non-error nodes
            }

            popCount = 99 - c_idx;
            for (let k = 0; k < popCount; k++) {
              childNodes[k] = collected[c_idx + 1 + k];
            }
            if (curr) {
              let totalByteLength: u32 = 0;
              let firstChildPadding: u32 = 0;
              if (popCount > 0) {
                firstChildPadding = getNodePadding(childNodes[0]);
                for (let k = 0; k < popCount; k++) {
                  let cPadding = getNodePadding(childNodes[k]);
                  let cLen = getNodeByteLength(childNodes[k]);
                  if (k == 0) totalByteLength += cLen;
                  else totalByteLength += cPadding + cLen;
                }
              }
              let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, head.balanceHash & 0xff);
              if (popCount > 0) {
                let lastChild = 0;
                for (let k = 0; k < popCount; k++) {
                  let child = childNodes[k];
                  if (child == 0) continue;
                  let clone = cloneNodeShallow(child);
                  if (lastChild == 0) setFirstChild(parentNode, clone);
                  else setNextSibling(lastChild, clone);
                  lastChild = clone;
                }
              }

              if (prod_is_list[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_IS_LIST);
              }
              if (prod_is_invisible[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_INVISIBLE);
              }
              let gOffset = goto_offsets[curr.state];
              if (gOffset < 0 || gOffset >= goto_data.length) {
                throw new Error("BAD gOffset error C");
              }
              let gCount = goto_data[gOffset];
              let nextState = -1;
              let gIdx = gOffset + 1;
              for (let k = 0; k < gCount; k++) {
                if (goto_data[gIdx++] == lhsSym) {
                  nextState = goto_data[gIdx++];
                  break;
                } else {
                  gIdx++;
                }
              }
              if (nextState != -1 && nextState != 1) {
                let redHead = allocParseHead(
                  nextState,
                  parentNode,
                  curr,
                  head.pos,
                  currentScannerState,
                  head.errorCost + 1,
                  0,
                  head.balanceHash,
                  head.consecutiveInsertions,
                  head.dynamicPrec + prod_dynamic_prec[reduceProd],
                  head.pendingPadding,
                );
                let mergedH = false;
                for (let k: u32 = 0; k < activeHeadsCount; k++) {
                  let ah = changetype<ParseHead>(activeHeads.get(k));
                  if (ah.pos == redHead.pos && ah.state == redHead.state && ah.prev == redHead.prev) {
                    mergedH = true;
                    if (
                      redHead.errorCost < ah.errorCost ||
                      (redHead.errorCost == ah.errorCost && redHead.dynamicPrec > ah.dynamicPrec)
                    ) {
                      activeHeads.set(k, changetype<u32>(redHead));
                    }
                    break;
                  }
                }
                if (!mergedH) {
                  activeHeads.set(activeHeadsCount, changetype<u32>(redHead));
                  activeHeadsCount++;
                }
                reduced = true;
              }
            }
          }
        }
      }

      if (!reduced) {
        // ----------------------------------------------------------------
        // ERROR BRANCH A & B: Unwind and Mutate
        // ----------------------------------------------------------------
        // If forced reduction didn't work, we iteratively pop (unwind) states from the GSS
        // up to a depth of 5. For each popped state, we attempt:
        // Branch A: Deleting the current token (skip)
        // Branch B: Inserting a missing token (virtual shift)
        let unwindCurr: ParseHead | null = head;
        let unwindDepth = 0;
        while (unwindCurr != null && unwindDepth < 5) {
          let recState = unwindCurr.state;
          let recPrev = unwindCurr.prev;
          let recBalance = unwindCurr.balanceHash;
          let recPrec = unwindCurr.dynamicPrec;

          // ------------------------------------------------------------
          // Branch A: Deletion (Skip Token)
          // ------------------------------------------------------------
          if (token != TOKEN_EOF) {
            let pCount = unwindDepth;
            let uCurr: ParseHead | null = head;
            let newBalance = head.balanceHash;
            for (let u = 0; u < pCount; u++) {
              if (uCurr != null) {
                newBalance = uCurr.balanceHash;
                uCurr = uCurr.prev;
              }
            }
            let uPos: u32 = uCurr ? uCurr.pos : 0;
            let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

            let baseDelCost = token_insert_costs[token] + (unwindDepth as i32); // Token-specific deletion cost + unwind penalty
            if (lexLen == 1) {
              let c = load<u8>(getInputBuffer() + lexPos);
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = token_insert_costs[token] + (unwindDepth as i32);
              }
            }

            // A1. Standard Deletion: Discard current token and advance scanner
            let nextToken = peekToken(srcLexPos + lexLen);
            // Use lookahead to verify the state can actually consume the NEXT token
            if (stateCanAccept(unwindCurr, recState, nextToken, 0)) {
              let delHead = allocParseHead(
                recState,
                unwindCurr.astNode,
                unwindCurr.prev,
                srcLexPos + lexLen,
                currentScannerState,
                head.errorCost + baseDelCost + 1,
                0,
                newBalance,
                0,
                recPrec,
                head.pendingPadding + droppedBytes + (srcLexPos + lexLen - head.pos),
              );
              activeHeads.set(activeHeadsCount, changetype<u32>(delHead));
              activeHeadsCount++;
            }

            // A2. Retrospective Deletion: Unwind state but keep the current token
            // E.g., we shifted a token prematurely, so we pop the state but leave the scanner where it is
            if (unwindDepth > 0) {
              if (stateCanAccept(unwindCurr, recState, token, 0)) {
                let retroHead = allocParseHead(
                  recState,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  head.pos,
                  currentScannerState,
                  head.errorCost + baseDelCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  head.pendingPadding + droppedBytes,
                );
                activeHeads.set(activeHeadsCount, changetype<u32>(retroHead));
                activeHeadsCount++;
              }
            }
          }

          // ------------------------------------------------------------
          // Branch B: Insertion (Virtual Shift)
          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          if (head.consecutiveInsertions < 1) {
            let aOffset = action_offsets[recState];
            if (aOffset >= 0 && aOffset < action_data.length) {
              idx2 = aOffset + 1;
              count2 = action_data[aOffset];
              for (let i = 0; i < count2; i++) {
                if (idx2 < 0 || idx2 + 1 >= action_data.length) {
                  throw new Error("BAD idx2 in error B");
                }
                let sym = action_data[idx2++];
                let actCount = action_data[idx2++];
                for (let j = 0; j < actCount; j++) {
                  let type = action_data[idx2++];
                  let target = action_data[idx2++];
                  if (type == 0) {
                    // Shift transition
                    let pCount = unwindDepth;
                    let uCurr: ParseHead | null = head;
                    let newBalance = head.balanceHash;
                    for (let u = 0; u < pCount; u++) {
                      if (uCurr != null) {
                        newBalance = uCurr.balanceHash;
                        uCurr = uCurr.prev;
                      }
                    }
                    let uPos: u32 = uCurr ? uCurr.pos : 0;
                    let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

                    // Calculate insertion penalty: token base cost + structural depth penalty
                    let baseCost = token_insert_costs[sym];
                    let debt = mrd_data[target];
                    let insCost = baseCost + debt;

                    // Allocate virtual zero-length leaf
                    let virtualLeaf = allocNode(sym as u16, 0, 0, newBalance & 0xff);
                    let insHead = allocParseHead(
                      target,
                      virtualLeaf,
                      unwindCurr,
                      head.pos,
                      currentScannerState,
                      head.errorCost + insCost,
                      0,
                      newBalance,
                      head.consecutiveInsertions + 1,
                      recPrec,
                      head.pendingPadding + droppedBytes,
                    );

                    // Prune branches that immediately fail on the current real token
                    if (stateCanAccept(insHead, target, token, 0)) {
                      activeHeads.set(activeHeadsCount, changetype<u32>(insHead));
                      activeHeadsCount++;
                    }
                  }
                }
              }
            }
          }

          unwindCurr = unwindCurr.prev;
          unwindDepth++;
        }

        // --------------------------------------------------------------------
        // ERROR BRANCH D: Island Parsing (Panic Mode)
        // --------------------------------------------------------------------
        // If local insertions/deletions fail, we fallback to a coarse panic mode.
        // We advance the scanner forward until we hit a "sync token" (e.g. `}`, `;`, `end`).
        // Then we search the GSS stack backwards for a state that can consume that sync token.
        // Everything in between is wrapped in an ERROR node and discarded from the AST.
        if (head.consecutiveInsertions == 0 && sync_tokens.length > 0) {
          let syncCost = 15; // High initial penalty for destroying a span of code
          let searchPos = head.pos;
          let foundTarget = -1;
          let foundBalance = head.balanceHash;
          let currPop: ParseHead | null = null;
          let resumePos = 0;

          // Step 1: Scan forward for a synchronization point
          while (searchPos < inputLength) {
            let tok = __LEX_FN__(searchPos);
            if (tok == -1) break;
            let tokenLen = lexLen;
            if (tokenLen == 0) break;

            let isSync = false;
            for (let s = 0; s < sync_tokens.length; s++) {
              if (tok == sync_tokens[s]) {
                isSync = true;
                break;
              }
            }

            // Step 2: If we found a sync point, walk backwards through the GSS
            if (isSync) {
              let nextPos = searchPos + tokenLen;
              let nextTok = __LEX_FN__(nextPos); // lookahead token after the sync token

              currPop = head;
              while (currPop != null) {
                let aOffset = action_offsets[currPop.state];
                if (aOffset >= 0 && aOffset < action_data.length) {
                  let count = action_data[aOffset];
                  let aIdx = aOffset + 1;

                  // Check if this popped state can shift the sync token (or the one right after it)
                  for (let i = 0; i < count; i++) {
                    let aSym = action_data[aIdx++];
                    let actCount = action_data[aIdx++];
                    for (let j = 0; j < actCount; j++) {
                      let aType = action_data[aIdx++];
                      let aTarget = action_data[aIdx++];
                      if (aType == 0) {
                        // SHIFT
                        if (aSym == tok) {
                          foundTarget = aTarget;
                          resumePos = searchPos;
                          break;
                        } else if (aSym == nextTok) {
                          foundTarget = aTarget;
                          resumePos = nextPos;
                          break;
                        }
                      }
                    }
                    if (foundTarget != -1) break;
                  }
                }
                if (foundTarget != -1) break;
                currPop = currPop.prev; // Pop stack
              }
              if (foundTarget != -1) break; // We found a recovery anchor!
            }

            // If the sync token wasn't useful, consume it and keep scanning forward
            searchPos = searchPos + tokenLen;
            syncCost += 1; // +1 penalty for every token skipped during panic mode
          }

          // Step 3: Apply the Panic Mode Recovery
          if (foundTarget != -1 && currPop != null) {
            // Collect all the AST nodes that were parsed between the anchor state and the failure point
            let currChild: ParseHead | null = head;
            let childCount = 0;
            while (currChild != null && currChild != currPop) {
              globalChildNodes[childCount++] = currChild.astNode;
              currChild = currChild.prev;
            }

            // Allocate a monolithic ERROR leaf that spans the entire discarded section
            let islandLeaf = allocNode(0 /* ERROR */, 0, resumePos - currPop.pos, head.balanceHash & 0xff);

            // Mount the discarded AST nodes as children of the ERROR node,
            // so the language server can still offer completions inside broken blocks.
            let lastChild = 0;
            for (let k = childCount - 1; k >= 0; k--) {
              let child = globalChildNodes[k];
              if (child == 0) continue;
              let clone = cloneNodeShallow(child);
              if (lastChild == 0) setFirstChild(islandLeaf, clone);
              else setNextSibling(lastChild, clone);
              lastChild = clone;
            }

            // Branch the GSS from the recovery anchor, shifting the new ERROR node
            let islandHead = allocParseHead(
              currPop.state,
              islandLeaf,
              currPop,
              resumePos,
              currentScannerState,
              head.errorCost + syncCost,
              0,
              foundBalance,
              0,
              head.dynamicPrec,
            );
            activeHeads.set(activeHeadsCount, changetype<u32>(islandHead));
            activeHeadsCount++;
          }
        }
      } // close if (!reduced)

      // --------------------------------------------------------------------
      // GSS PRUNING AND COMBINATORIAL EXPLOSION PREVENTION
      // --------------------------------------------------------------------
      // Avoid keeping too many active heads, which causes exponential time/memory blowup.
      let activeHeadsTrimCount = activeHeadsCount;
      if (activeHeadsTrimCount > 0) {
        // Find the global lowest error cost currently active
        let bestCost = 999999;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(activeHeads.get(i));
          if (ah.errorCost < bestCost) bestCost = ah.errorCost;
        }

        // Primary Culling: Kill any head whose error cost is more than 5 points
        // worse than the best available option.
        let writeIdx = 0;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(activeHeads.get(i));
          if (ah.errorCost <= bestCost + 5) {
            activeHeads.set(writeIdx++, changetype<u32>(ah));
          }
        }
        activeHeadsCount = writeIdx;
        activeHeadsTrimCount = activeHeadsCount;

        // Normalize error costs so they don't overflow during long panic modes
        if (bestCost > 0 && bestCost < 999999) {
          for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
            let ah = changetype<ParseHead>(activeHeads.get(i));
            ah.errorCost -= bestCost;
          }
        }
      }

      // Secondary Culling: Hard limit on total concurrent heads
      if (activeHeadsTrimCount > 64) {
        // Sort remaining heads by error cost (ASC) then position (DESC)
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let bestIdx = i;
          let headI = changetype<ParseHead>(activeHeads.get(i));
          for (let j: u32 = i + 1; j < activeHeadsTrimCount; j++) {
            let headJ = changetype<ParseHead>(activeHeads.get(j));
            if (headJ.errorCost < headI.errorCost || (headJ.errorCost == headI.errorCost && headJ.pos > headI.pos)) {
              bestIdx = j;
              headI = headJ;
            }
          }
          if (bestIdx != i) {
            let tmp = activeHeads.get(i);
            activeHeads.set(i, activeHeads.get(bestIdx));
            activeHeads.set(bestIdx, tmp);
          }
        }
        // Discard the worst heads, keeping only the top 32
        activeHeadsCount = 32;
      }
    }
  }
  if (acceptedNode != 0) {
    return acceptedNode;
  }
  if (bestDyingHead != 0) {
    // ----------------------------------------------------------------------
    // CATASTROPHIC FAILURE FALLBACK
    // ----------------------------------------------------------------------
    // If the parser exhausted the iteration guard or all branches died, we
    // cannot return a valid AST. However, for language servers, returning `null`
    // destroys all syntax highlighting and code folding.
    // Instead, we bundle whatever we successfully parsed on the best dying head,
    // parse the remaining unconsumed tokens as flat ERROR leaves, and return
    // a single monolithic ERROR root that spans the whole file.
    globalIsCatastrophic = true;

    let curr: ParseHead | null = changetype<ParseHead>(bestDyingHead);
    let totalBytes: u32 = 0;
    let nodeCount: u32 = 0;

    // Calculate size of the successfully parsed portion
    while (curr) {
      if (curr.astNode != 0) {
        totalBytes += getNodePadding(curr.astNode) + getNodeByteLength(curr.astNode);
        nodeCount++;
      }
      curr = curr.prev;
    }

    // Lex the remainder of the file
    let remainingLen =
      inputLength > changetype<ParseHead>(bestDyingHead).pos
        ? inputLength - changetype<ParseHead>(bestDyingHead).pos
        : 0;
    let unparsedNode: u32 = 0;

    if (remainingLen > 0) {
      let p = changetype<ParseHead>(bestDyingHead).pos;
      let firstPad: u32 = 0;
      let peekTok = __LEX_FN__(p);
      if (peekTok != -1) {
        firstPad = lexPos - p;
      }

      unparsedNode = allocNode(0 /* ERROR */, firstPad, remainingLen - firstPad, 0);
      let lastTokNode = 0;

      while (p < inputLength) {
        let tok = __LEX_FN__(p);
        if (tok == -1) break;
        let pad = lexPos - p;
        let token = lex(p);
        let tLen = lexLen;
        if (tLen == 0) break; // prevent infinite loop

        let tNode = allocNode(tok as u16, pad, tLen, 0);
        if (lastTokNode == 0) setFirstChild(unparsedNode, tNode);
        else setNextSibling(lastTokNode, tNode);
        lastTokNode = tNode;

        p = lexPos + tLen;
      }

      totalBytes += remainingLen;
      nodeCount++;
    }

    // Create the root ERROR node
    let root = allocNode(0 /* ERROR */, 0, totalBytes, 0);
    curr = changetype<ParseHead>(bestDyingHead);
    let childNodes = globalChildren;
    let c_idx = nodeCount;

    // Append the unparsed chunk
    if (unparsedNode != 0) {
      c_idx--;
      childNodes[c_idx] = unparsedNode;
    }

    // Append the successfully parsed nodes from the GSS
    curr = changetype<ParseHead>(bestDyingHead);
    while (curr) {
      if (curr.astNode != 0) {
        c_idx--;
        childNodes[c_idx] = curr.astNode;
      }
      curr = curr.prev;
    }

    // Link them together
    let lastChild = 0;
    for (let i: u32 = 0; i < nodeCount; i++) {
      let child = childNodes[i];
      if (child == 0) continue;
      let clone = cloneNodeShallow(child);
      if (lastChild == 0) setFirstChild(root, clone);
      else setNextSibling(lastChild, clone);
      lastChild = clone;
    }

    return root;
  }
  return 0;
}

// ----------------------------------------------------------------------------
// AST Tree Manipulation & Cloning
// ----------------------------------------------------------------------------

/**
 * Creates a shallow copy of an AST node in the arena.
 * Clears the GC mark and LSP visited flags to ensure the clone is recognized as "new"
 * and properly evaluated during subsequent passes.
 * Retains the original `firstChild` pointer, so children are structurally shared.
 */
function cloneNodeShallow(gc: u32): u32 {
  let clone = allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc));
  setNodeFlags(clone, getNodeFlags(gc) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED)); // Clear GC mark and LSP visited
  setFirstChild(clone, getNodeFirstChild(gc)); // Keep original children
  return clone;
}

/**
 * Deeply copies the children of `leftNode` and attaches them to parent `p`.
 * Performs shallow clones on each immediate child, breaking the top-level
 * sibling chain but preserving deeper subtree sharing.
 * @returns The pointer to the last cloned child appended.
 */
function copyChildren(p: u32, leftNode: u32): u32 {
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  while (gc != 0) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) setFirstChild(p, clone);
    else setNextSibling(lastChild, clone);
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }
  return lastChild;
}

export let currentLspNodeStart: u32 = 0;
export let currentLspNodeEnd: u32 = 0;
export let globalLastLen: u32 = 0;

/**
 * Recalculates and updates the `padding` and `byteLength` of a parent node
 * based on the cumulative sizes of its newly attached children.
 */
function fixNodeLength(node: u32): void {
  let gc = getNodeFirstChild(node);
  if (gc == 0) return;

  let firstPad = getNodePadding(gc);
  let totalLen = getNodeByteLength(gc);
  gc = getNodeNextSibling(gc);

  while (gc != 0) {
    totalLen += getNodePadding(gc) + getNodeByteLength(gc);
    gc = getNodeNextSibling(gc);
  }
  setNodePadding(node, firstPad);
  setNodeByteLength(node, totalLen);
}

// ----------------------------------------------------------------------------
// List Concatenation & Appending
// ----------------------------------------------------------------------------

/**
 * Calculates the depth of a left-recursive list tree.
 * Used to limit deep recursion during list flattening.
 */
export function getListDepth(node: u32, listSym: u16): u32 {
  let depth: u32 = 0;
  let curr = node;
  while (getNodeType(curr) == listSym && (getNodeFlags(curr) & 4) != 0) {
    // FLAG_IS_LIST == 4
    depth++;
    if (depth > 100) return depth; // Safety cap for corrupted trees
    let child = getNodeFirstChild(curr);
    if (child == 0) return depth;
    curr = child;
  }
  return depth;
}

/** Returns the number of immediate children a list node has. */
function getListChildCount(node: u32, listSym: u16): u32 {
  if (getNodeType(node) != listSym || (getNodeFlags(node) & 4) == 0) return 0;
  let count = 0;
  let child = getNodeFirstChild(node);
  while (child != 0) {
    count++;
    child = getNodeNextSibling(child);
  }
  return count;
}

let _listRecurDepth: u32 = 0;

/**
 * Concatenates two list nodes of the same grammar symbol type.
 * Ensures the resulting tree structure remains balanced and properly flagged.
 * List flattening relies on this to optimize deep recursive rules like:
 * `statements -> statements statement`
 *
 * @param leftNode - The left-hand AST node
 * @param rightNode - The right-hand AST node
 * @param listSym - The grammar symbol ID representing this list type
 * @param envHash - Environment state hash for the newly allocated parent
 * @returns A pointer to the concatenated root node
 */
function concatLists(leftNode: u32, rightNode: u32, listSym: u16, envHash: u32): u32 {
  _listRecurDepth++;
  // Cycle detection guard
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode); // bail: cycle detected
  }

  if (leftNode == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode);
  }
  if (rightNode == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(leftNode);
  }

  if (getNodeByteLength(leftNode) == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode);
  }
  if (getNodeByteLength(rightNode) == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(leftNode);
  }

  let lFlags = getNodeFlags(leftNode);
  let rFlags = getNodeFlags(rightNode);

  // If the left node is not already a list, wrap it in an invisible list node
  if ((lFlags & 4) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), getNodeByteLength(leftNode), envHash);
    setNodeFlags(p, FLAG_INVISIBLE);
    let cloneLeft = cloneNodeShallow(leftNode);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, 0);
    leftNode = p;
    lFlags = getNodeFlags(leftNode);
  }

  // If the right node is not already a list, wrap it in an invisible list node
  if ((rFlags & 4) == 0) {
    let p = allocNode(listSym, getNodePadding(rightNode), getNodeByteLength(rightNode), envHash);
    setNodeFlags(p, FLAG_INVISIBLE);
    let cloneRight = cloneNodeShallow(rightNode);
    setFirstChild(p, cloneRight);
    setNextSibling(cloneRight, 0);
    rightNode = p;
    rFlags = getNodeFlags(rightNode);
  }

  let lDepth = getListDepth(leftNode, listSym);
  let rDepth = getListDepth(rightNode, listSym);
  let lChildCount = getListChildCount(leftNode, listSym);
  let lDirectChildCount = 0;
  let ldTemp = getNodeFirstChild(leftNode);
  while (ldTemp != 0) {
    lDirectChildCount++;
    ldTemp = getNodeNextSibling(ldTemp);
  }

  // Balance depths before merging
  if (lDepth < rDepth) {
    while (lDepth < rDepth) {
      let wrap = allocNode(listSym, getNodePadding(leftNode), getNodeByteLength(leftNode), envHash);
      setNodeFlags(wrap, FLAG_INVISIBLE);
      let cloneLeft = cloneNodeShallow(leftNode);
      setFirstChild(wrap, cloneLeft);
      setNextSibling(cloneLeft, 0);
      leftNode = wrap;
      lDepth++;
      lChildCount = 1;
      lDirectChildCount = 1;
    }
  }

  // If the trees are at the same depth, attempt to merge their children
  if (lDepth == rDepth) {
    let rChildCount = getListChildCount(rightNode, listSym);
    let rDirectChildCount = 0;
    let rdTemp = getNodeFirstChild(rightNode);
    while (rdTemp != 0) {
      rDirectChildCount++;
      rdTemp = getNodeNextSibling(rdTemp);
    }

    // Strategy A: If merging keeps the child count under the threshold, merge them flat
    if (lDirectChildCount + rDirectChildCount < LIST_MAX_CHILDREN) {
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_INVISIBLE);
      let lastChild = copyChildren(p, leftNode);
      let rc = getNodeFirstChild(rightNode);
      while (rc != 0) {
        let clone = cloneNodeShallow(rc);
        if (lastChild == 0) setFirstChild(p, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
        rc = getNodeNextSibling(rc);
      }
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      // Strategy B: Over threshold. Split the children evenly into two new sibling list nodes.
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_INVISIBLE);

      let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(cloneLeft, FLAG_INVISIBLE);

      let cloneRight = allocNode(listSym, getNodePadding(rightNode), 0, envHash);
      setNodeFlags(cloneRight, FLAG_INVISIBLE);

      let total = lDirectChildCount + rDirectChildCount;
      let leftHalf = total / 2;

      let gc = getNodeFirstChild(leftNode);
      let rc = getNodeFirstChild(rightNode);

      let lastChild = 0;
      for (let i = 0; i < (leftHalf as i32); i++) {
        let curr: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        if (lastChild == 0) setFirstChild(cloneLeft, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
      }
      fixNodeLength(cloneLeft);

      lastChild = 0;
      for (let i = leftHalf as i32; i < (total as i32); i++) {
        let curr: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        if (lastChild == 0) setFirstChild(cloneRight, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
      }
      fixNodeLength(cloneRight);

      setFirstChild(p, cloneLeft);
      setNextSibling(cloneLeft, cloneRight);
      setNextSibling(cloneRight, 0);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    }
  }
  // ------------------------------------------------------------------------
  // Asymmetrical Trees: lDepth > rDepth
  // ------------------------------------------------------------------------
  // If the left tree is deeper, we drill down into the rightmost branch
  // of the left tree and recursively concatenate the right tree there.
  let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  for (let i = 0; i < lDirectChildCount - 1; i++) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) setFirstChild(p, clone);
    else setNextSibling(lastChild, clone);
    setNextSibling(clone, 0);
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }

  let rightMost = gc;
  let newRightMost = concatLists(rightMost, rightNode, listSym, envHash);

  let nrDepth = getListDepth(newRightMost, listSym);
  if (nrDepth == lDepth) {
    let origC1 = getNodeFirstChild(newRightMost);
    let origC2 = getNodeNextSibling(origC1);

    let c1 = cloneNodeShallow(origC1);
    let c2 = cloneNodeShallow(origC2);

    if (lDirectChildCount < LIST_MAX_CHILDREN) {
      if (lastChild == 0) setFirstChild(p, c1);
      else setNextSibling(lastChild, c1);
      setNextSibling(c1, c2);
      setNextSibling(c2, 0);
      setNodeFlags(p, FLAG_INVISIBLE);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_INVISIBLE);

      let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
      setNodeFlags(newRightChunk, FLAG_INVISIBLE);

      let gc2 = getNodeFirstChild(leftNode);
      let lastChild2 = 0;
      for (let i = 0; i < LIST_SPLIT_POINT; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(p, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      fixNodeLength(p);

      lastChild2 = 0;
      for (let i = LIST_SPLIT_POINT; i < lDirectChildCount - 1; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(newRightChunk, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      if (lastChild2 == 0) setFirstChild(newRightChunk, c1);
      else setNextSibling(lastChild2, c1);
      setNextSibling(c1, c2);
      setNextSibling(c2, 0);
      fixNodeLength(newRightChunk);

      setFirstChild(superP, p);
      setNextSibling(p, newRightChunk);
      setNextSibling(newRightChunk, 0);
      fixNodeLength(superP);
      _listRecurDepth--;
      return superP;
    }
  } else {
    if (lastChild == 0) setFirstChild(p, newRightMost);
    else setNextSibling(lastChild, newRightMost);
    setNextSibling(newRightMost, 0);
    setNodeFlags(p, FLAG_INVISIBLE);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }
}

let appendListCalls = 0;

/**
 * Fast-path optimization for left-recursive grammar rules.
 * Instead of creating a new binary tree node for every appended element,
 * this function attempts to flatten the new element into the existing list node
 * up to `LIST_MAX_CHILDREN`. If the node is full, it splits it.
 *
 * @param leftNode - The existing list node
 * @param leafOrig - The new child node to append
 * @param listSym - The list's grammar symbol
 * @param envHash - Environment state hash
 * @returns The updated list root
 */
export function appendToList(leftNode: u32, leafOrig: u32, listSym: u16, envHash: u32): u32 {
  appendListCalls++;
  _listRecurDepth++;
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    return cloneNodeShallow(leafOrig); // bail: cycle detected
  }

  let leaf = cloneNodeShallow(leafOrig);
  setNextSibling(leaf, 0);

  if (leftNode == 0) {
    _listRecurDepth--;
    return leaf;
  }

  let leftFlags = getNodeFlags(leftNode);
  if ((leftFlags & 4) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    setNodeFlags(p, FLAG_INVISIBLE);
    let cloneLeft = cloneNodeShallow(leftNode);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, leaf);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }

  let lDepth = getListDepth(leftNode, listSym);
  let lChildCount = getListChildCount(leftNode, listSym);
  let lDirectChildCount = 0;
  let ldTemp = getNodeFirstChild(leftNode);
  while (ldTemp != 0) {
    lDirectChildCount++;
    ldTemp = getNodeNextSibling(ldTemp);
  }
  let directChildCount = 0;
  let dTemp = getNodeFirstChild(leftNode);
  while (dTemp != 0) {
    directChildCount++;
    dTemp = getNodeNextSibling(dTemp);
  }

  if (lDepth == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    setNodeFlags(p, FLAG_INVISIBLE);
    let cloneLeft = cloneNodeShallow(leftNode);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, leaf);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }

  if (lDepth == 1) {
    if (directChildCount < LIST_MAX_CHILDREN) {
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_INVISIBLE);
      let lastChild = copyChildren(p, leftNode);
      if (lastChild == 0) setFirstChild(p, leaf);
      else setNextSibling(lastChild, leaf);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_INVISIBLE);

      let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(cloneLeft, FLAG_INVISIBLE);

      let rightChunk = allocNode(listSym, getNodePadding(leaf), 0, envHash);
      setNodeFlags(rightChunk, FLAG_INVISIBLE);

      let gc = getNodeFirstChild(leftNode);
      let lastChild = 0;
      for (let i = 0; i < LIST_SPLIT_POINT; i++) {
        let clone = cloneNodeShallow(gc);
        if (lastChild == 0) setFirstChild(cloneLeft, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
        gc = getNodeNextSibling(gc);
      }
      fixNodeLength(cloneLeft);

      lastChild = 0;
      for (let i = LIST_SPLIT_POINT; i < LIST_MAX_CHILDREN; i++) {
        let clone = cloneNodeShallow(gc);
        if (lastChild == 0) setFirstChild(rightChunk, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
        gc = getNodeNextSibling(gc);
      }
      if (lastChild == 0) setFirstChild(rightChunk, leaf);
      else setNextSibling(lastChild, leaf);
      setNextSibling(leaf, 0);
      fixNodeLength(rightChunk);

      setFirstChild(p, cloneLeft);
      setNextSibling(cloneLeft, rightChunk);
      setNextSibling(rightChunk, 0);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    }
  }

  let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  for (let i = 0; i < directChildCount - 1; i++) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) setFirstChild(p, clone);
    else setNextSibling(lastChild, clone);
    setNextSibling(clone, 0);
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }

  let rightMost = gc;
  let newRightMost = appendToList(rightMost, leaf, listSym, envHash);

  let nrDepth = getListDepth(newRightMost, listSym);
  if (nrDepth == lDepth) {
    let origC1 = getNodeFirstChild(newRightMost);
    let origC2 = getNodeNextSibling(origC1);

    let c1 = cloneNodeShallow(origC1);
    let c2 = cloneNodeShallow(origC2);

    if (directChildCount < LIST_MAX_CHILDREN) {
      if (lastChild == 0) setFirstChild(p, c1);
      else setNextSibling(lastChild, c1);
      setNextSibling(c1, c2);
      setNextSibling(c2, 0);
      setNodeFlags(p, FLAG_INVISIBLE);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_INVISIBLE);

      let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
      setNodeFlags(newRightChunk, FLAG_INVISIBLE);

      let gc2 = getNodeFirstChild(leftNode);
      let lastChild2 = 0;
      for (let i = 0; i < LIST_SPLIT_POINT; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(p, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      fixNodeLength(p);

      lastChild2 = 0;
      for (let i = LIST_SPLIT_POINT; i < directChildCount - 1; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(newRightChunk, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      if (lastChild2 == 0) setFirstChild(newRightChunk, c1);
      else setNextSibling(lastChild2, c1);
      setNextSibling(c1, c2);
      setNextSibling(c2, 0);
      fixNodeLength(newRightChunk);

      setFirstChild(superP, p);
      setNextSibling(p, newRightChunk);
      setNextSibling(newRightChunk, 0);
      fixNodeLength(superP);
      _listRecurDepth--;
      return superP;
    }
  } else {
    if (lastChild == 0) setFirstChild(p, newRightMost);
    else setNextSibling(lastChild, newRightMost);
    setNextSibling(newRightMost, 0);
    setNodeFlags(p, FLAG_INVISIBLE);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }
}

export function getActiveHeadsCount(): u32 {
  return activeHeadsCount;
}

export function getBestErrorCost(): u32 {
  let activeHeadsTrimCount = activeHeadsCount;
  if (activeHeadsTrimCount > 0) {
    let bestCost = 999999;
    for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
      let ah = changetype<ParseHead>(globalActiveHeads.get(i));
      if (ah.errorCost < bestCost) bestCost = ah.errorCost;
    }
    return bestCost;
  }
  return 0;
}
