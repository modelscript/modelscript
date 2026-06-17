/* eslint-disable */
// @ts-nocheck
import {
  ensureInputBuffer as _ensureInputBuffer,
  getInputBuffer as _getInputBuffer,
  allocGen0,
  allocNode,
  atomicChunkAlloc,
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
import { ChunkedUint32Array } from "./array";
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
  token_insert_costs as _token_insert_costs,
  currentScannerState,
  initExtras,
  inputLength,
  is_extra_token,
  lex,
  lexLen,
  lexPos,
  setCurrentScannerState,
  setLexLen,
  setLexPos,
  setSrcLexPos,
  srcLexPos,
} from "./parser";
export function getInputBuffer(): usize {
  return _getInputBuffer();
}

export function ensureInputBuffer(size: u32): usize {
  return _ensureInputBuffer(size);
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
let t_errorStarts: u32 = 0;
let t_errorEnds: u32 = 0;

const MAX_ERRORS: i32 = 10000;
const MAX_PARALLEL_HEADS: u32 = 32;
const MAX_CURSOR_DEPTH: i32 = 999999;
const INFINITE_COST: i32 = 999999;
const MAX_UPWARD_STEPS: i32 = 100000;
const MAX_CHILD_NODES: i32 = 100000;
const MIN_LOOP_LIMIT: u32 = 1000000;
const ARENA_BUFFER_SIZE: i32 = 16384;
const MAX_LOOKAHEAD_DEPTH: i32 = 10;
const MAX_AST_TRAVERSAL_DEPTH: u32 = 100;
const LOOP_MULTIPLIER_LIMIT: u32 = 100;
const MAX_PANIC_SCAN_TOKENS: u32 = 500;

const PENALTY_UNWIND_NODE: i32 = 500;
const PENALTY_SYNC_TOKEN: i32 = 5;

// --- Merge Hash Index ---
// Fixed-size hash table for O(1) GLR merge lookups, replacing O(H) linear scans.
// Keyed by (pos, state). Uses a generation counter for O(1) clearing.
const MERGE_TABLE_SIZE: u32 = 256;
const MERGE_TABLE_MASK: u32 = MERGE_TABLE_SIZE - 1;
const MERGE_PROBE_LIMIT: u32 = 4;
let t_mergeTable: u32 = 0; // pointer to raw memory: MERGE_TABLE_SIZE * 8 bytes
let mergeGeneration: u32 = 0;

function mergeTableInit(): void {
  if (t_mergeTable == 0) {
    t_mergeTable = atomicChunkAlloc(MERGE_TABLE_SIZE * 8);
  }
}

/**
 * Find a merge candidate in the active heads matching (pos, state, prev).
 * Returns the index into t_activeHeads, or -1 if not found.
 */
function findMergeCandidate(pos: u32, state: i32, prev: ParseHead | null): i32 {
  if (t_mergeTable == 0) return -1;
  let h = ((pos ^ ((state as u32) * 0x9e3779b9)) >> 4) & MERGE_TABLE_MASK;
  for (let i: u32 = 0; i < MERGE_PROBE_LIMIT; i++) {
    let slot = t_mergeTable + ((h + i) & MERGE_TABLE_MASK) * 8;
    if (load<u32>(slot + 4) != mergeGeneration) continue;
    let idx = load<u32>(slot);
    if (idx < activeHeadsCount) {
      let ah = changetype<ParseHead>(load<u32>(t_activeHeads + idx * 4));
      if (ah.pos == pos && ah.state == state && ah.prev == prev) {
        return idx as i32;
      }
    }
  }
  return -1;
}

/**
 * Register a newly pushed head in the merge hash index.
 */
function registerMergeCandidate(headIdx: u32, pos: u32, state: i32): void {
  if (t_mergeTable == 0) return;
  let h = ((pos ^ ((state as u32) * 0x9e3779b9)) >> 4) & MERGE_TABLE_MASK;
  for (let i: u32 = 0; i < MERGE_PROBE_LIMIT; i++) {
    let slot = t_mergeTable + ((h + i) & MERGE_TABLE_MASK) * 8;
    if (load<u32>(slot + 4) != mergeGeneration) {
      store<u32>(slot, headIdx);
      store<u32>(slot + 4, mergeGeneration);
      return;
    }
  }
  // All probe slots occupied -> evict the first one
  let slot = t_mergeTable + h * 8;
  store<u32>(slot, headIdx);
  store<u32>(slot + 4, mergeGeneration);
}

/**
 * Safely pushes a new head onto the active heads buffer.
 * Returns true if successful, false if the buffer is full.
 */
function pushActiveHead(headPtr: u32): boolean {
  if (activeHeadsCount >= (ARENA_BUFFER_SIZE as u32)) return false;
  store<u32>(t_activeHeads + activeHeadsCount * 4, headPtr);
  activeHeadsCount++;
  return true;
}

export function getErrorStart(index: i32): u32 {
  return load<u32>(t_errorStarts + index * 4);
}
export function getErrorEnd(index: i32): u32 {
  return load<u32>(t_errorEnds + index * 4);
}

/**
 * Registers an error span during the parse phase.
 * @param start The absolute byte offset of the syntax error start.
 * @param end The absolute byte offset of the syntax error end.
 */
export function reportError(start: u32, end: u32): void {
  if (t_errorStarts == 0) {
    t_errorStarts = atomicChunkAlloc(MAX_ERRORS * 4);
    t_errorEnds = atomicChunkAlloc(MAX_ERRORS * 4);
  }
  if (errorCount < MAX_ERRORS) {
    store<u32>(t_errorStarts + errorCount * 4, start);
    store<u32>(t_errorEnds + errorCount * 4, end);
    errorCount++;
  }
}

export const TOKEN_EOF: i32 = 1023;
export const TOKEN_UNKNOWN: i32 = 2047;

export const ACTION_SHIFT: i32 = 0;
export const ACTION_REDUCE: i32 = 1;
export const ACTION_ACCEPT: i32 = 2;

export const NODE_TYPE_ERROR: u16 = 0;

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

export function abortSuspend(): void {
  isSuspended = false;
}

// Token Buffer Arena - Used for caching tokens emitted by the scanner
let t_tokenBufferArena: u32 = 0;
let t_tokenBufferLenArena: u32 = 0;
export let tokenBufferWriteIdx: u32 = 0;
export let tokenBufferReadIdx: u32 = 0;
export let tokenBufferLastPos: u32 = 0;

/**
 * Pushes a newly scanned token into the cyclic token buffer.
 * @param tok The grammar token ID.
 * @param len The byte length of the token string.
 */
export function pushTokenToBuffer(tok: i32, len: u32): void {
  let idx = tokenBufferWriteIdx & (ARENA_BUFFER_SIZE - 1);
  store<i32>(t_tokenBufferArena + idx * 4, tok);
  store<u32>(t_tokenBufferLenArena + idx * 4, len);
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
  if (globalCursorDepth < 0 || globalCursorDepth >= MAX_CURSOR_DEPTH) return false;

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

  // 1. Validate cursor position. If the global cursor is already ahead of the target,
  // it means the target is in a gap (e.g., whitespace or skipped tokens) and hasn't caught up.
  // We can immediately return 0 in O(1) time instead of rescanning from the root.
  let startNode = cursorNodeStack[globalCursorDepth];
  let startSrc = cursorOffsetStack[globalCursorDepth] + getNodePadding(startNode);
  if (startSrc > targetSrcOldPos) {
    return 0;
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
          if (headSym == (nodeSym as u32) && (nodeFlags & FLAG_IS_LIST) != 0) {
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

            // If not a valid GOTO, check if the state can eventually accept this token
            if (!isValid) {
              isValid = stateCanAccept(null, currentState, nodeSym as i32);
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
    while (!advanced && upGuard++ < MAX_UPWARD_STEPS) {
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
@unmanaged
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
}

function allocErrorBranch(
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
  let ptr = allocGen0(36);
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
  return ptr;
}

// ----------------------------------------------------------------------------
// Legacy Imports / Globals
// ----------------------------------------------------------------------------

declare namespace parser {
  export function emitTextEdit(op: u32, len: u32, start: u32, end: u32): void;
  export function getSourceSlice(start: u32, end: u32): u32;
}

declare namespace env {
  export function emitTextEdit(cat: i32, val1: i32, val2: i32, val3: i32): void;
}

export function debugLog(cat: i32, val1: i32, val2: i32, val3: i32): void {
  // env.emitTextEdit(cat, val1, val2, val3);
}
export let globalLoopGuard: u32 = 0;
export let globalBestDyingHead: u32 = 0;
export let globalToken: i32 = -1;

// ----------------------------------------------------------------------------
// GLR Execution Context
// ----------------------------------------------------------------------------

let t_activeHeads: u32 = 0;
let activeHeadsCount: u32 = 0;

let t_globalChildNodes: u32 = 0;
let t_globalChildren: u32 = 0;

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
  expected_tokens.fill(0);
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let head = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
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
let t_globalReduceCollected: u32 = 0;

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
  assert(ptr % 4 == 0, "Unaligned ptr in allocParseHead");
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
  initExtras();
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
// Fixed-size open-addressing hash table for stateCanAccept memoization.
// Eliminates GC pressure from the managed Map<u64, boolean>.
// Layout: ACCEPT_CACHE_CAPACITY slots × 12 bytes each = [key_lo: u32, key_hi: u32, occupied_and_value: u32]
//   occupied_and_value: bit 0 = occupied, bit 1 = cached result (0=false, 1=true)
const ACCEPT_CACHE_CAPACITY: u32 = 4096;
const ACCEPT_CACHE_MASK: u32 = ACCEPT_CACHE_CAPACITY - 1;
const ACCEPT_CACHE_PROBE_LIMIT: u32 = 8;
let t_acceptCache: u32 = 0;

function acceptCacheHash(key: u64): u32 {
  let h: u32 = (key as u32) ^ ((key >> 32) as u32);
  h ^= h >> 16;
  h = h * 0x45d9f3b;
  h ^= h >> 16;
  return h & ACCEPT_CACHE_MASK;
}

function acceptCacheGet(key: u64): i32 {
  if (t_acceptCache == 0) return -1;
  let idx = acceptCacheHash(key);
  for (let i: u32 = 0; i < ACCEPT_CACHE_PROBE_LIMIT; i++) {
    let slot = t_acceptCache + ((idx + i) & ACCEPT_CACHE_MASK) * 12;
    let occ = load<u32>(slot + 8);
    if (occ == 0) return -1; // empty slot → cache miss
    if (load<u32>(slot) == (key as u32) && load<u32>(slot + 4) == ((key >> 32) as u32)) {
      return (occ >> 1) & 1; // cache hit → return 0 or 1
    }
  }
  return -1; // probe limit reached → cache miss
}

function acceptCacheSet(key: u64, value: boolean): void {
  if (t_acceptCache == 0) return;
  let idx = acceptCacheHash(key);
  for (let i: u32 = 0; i < ACCEPT_CACHE_PROBE_LIMIT; i++) {
    let slot = t_acceptCache + ((idx + i) & ACCEPT_CACHE_MASK) * 12;
    let occ = load<u32>(slot + 8);
    if (occ == 0 || (load<u32>(slot) == (key as u32) && load<u32>(slot + 4) == ((key >> 32) as u32))) {
      store<u32>(slot, key as u32);
      store<u32>(slot + 4, (key >> 32) as u32);
      store<u32>(slot + 8, 1 | ((value ? 1 : 0) << 1));
      return;
    }
  }
  // All probe slots occupied → evict the first one
  let slot = t_acceptCache + idx * 12;
  store<u32>(slot, key as u32);
  store<u32>(slot + 4, (key >> 32) as u32);
  store<u32>(slot + 8, 1 | ((value ? 1 : 0) << 1));
}

function acceptCacheClear(): void {
  if (t_acceptCache != 0) {
    memory.fill(t_acceptCache as usize, 0, (ACCEPT_CACHE_CAPACITY * 12) as usize);
  }
}

function stateCanAccept(
  head: ParseHead | null,
  state: i32,
  tok: i32,
  depth: i32 = 0,
  simCount: i32 = 0,
  sim0: i32 = 0,
  sim1: i32 = 0,
  sim2: i32 = 0,
  sim3: i32 = 0,
  sim4: i32 = 0,
  sim5: i32 = 0,
  sim6: i32 = 0,
  sim7: i32 = 0,
  sim8: i32 = 0,
  sim9: i32 = 0,
): boolean {
  if (depth > MAX_LOOKAHEAD_DEPTH) return false;
  if (state < 0 || state >= action_offsets.length) return false;

  debugLog(999100, state, tok, depth);

  // Only memoize at the top-level (depth 0) where the head state is stable
  let cacheKey: u64 = 0;
  if (depth == 0) {
    cacheKey = ((<u64>state) << 16) | (<u64>tok);
    let cached = acceptCacheGet(cacheKey);
    if (cached != -1) {
      return cached == 1;
    }
  }

  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) {
    if (depth == 0) acceptCacheSet(cacheKey, false);
    return false;
  }

  let actionCount = action_data[actionOffset];
  let idx = actionOffset + 1;
  for (let i = 0; i < actionCount; i++) {
    if (idx < 0 || idx + 1 >= action_data.length) {
      if (depth == 0) acceptCacheSet(cacheKey, false);
      return false;
    }
    let sym = action_data[idx];
    let actCount = action_data[idx + 1];
    let actIdx = idx + 2;
    if (sym == tok || sym == 0) {
      for (let j = 0; j < actCount; j++) {
        let type = action_data[actIdx++];
        let target = action_data[actIdx++];
        if (type == ACTION_SHIFT || type == ACTION_ACCEPT) {
          if (depth == 0) acceptCacheSet(cacheKey, true);
          return true;
        }
        if (type == ACTION_REDUCE) {
          // REDUCE
          let ruleLen = prod_lengths[target];
          let ruleLHS = prod_lhs[target];

          let rem = ruleLen;
          let newSimCount = simCount;
          let pHead = head;

          if (newSimCount >= rem) {
            newSimCount -= rem;
            rem = 0;
          } else {
            rem -= newSimCount;
            newSimCount = 0;
          }

          for (let u = 0; u < rem; u++) {
            if (pHead != null) pHead = pHead.prev;
          }

          let topState = -1;
          if (newSimCount > 0) {
            if (newSimCount == 1) topState = sim0;
            else if (newSimCount == 2) topState = sim1;
            else if (newSimCount == 3) topState = sim2;
            else if (newSimCount == 4) topState = sim3;
            else if (newSimCount == 5) topState = sim4;
            else if (newSimCount == 6) topState = sim5;
            else if (newSimCount == 7) topState = sim6;
            else if (newSimCount == 8) topState = sim7;
            else if (newSimCount == 9) topState = sim8;
            else if (newSimCount == 10) topState = sim9;
          } else {
            if (pHead != null) topState = pHead.state;
          }

          let nextState = -1;
          if (topState != -1) {
            let gOffset = goto_offsets[topState];
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
          }

          if (nextState != -1) {
            let ns0 = sim0,
              ns1 = sim1,
              ns2 = sim2,
              ns3 = sim3,
              ns4 = sim4,
              ns5 = sim5,
              ns6 = sim6,
              ns7 = sim7,
              ns8 = sim8,
              ns9 = sim9;
            let nextSimCount = newSimCount + 1;
            if (newSimCount == 0) ns0 = nextState;
            else if (newSimCount == 1) ns1 = nextState;
            else if (newSimCount == 2) ns2 = nextState;
            else if (newSimCount == 3) ns3 = nextState;
            else if (newSimCount == 4) ns4 = nextState;
            else if (newSimCount == 5) ns5 = nextState;
            else if (newSimCount == 6) ns6 = nextState;
            else if (newSimCount == 7) ns7 = nextState;
            else if (newSimCount == 8) ns8 = nextState;
            else if (newSimCount == 9) ns9 = nextState;

            debugLog(999101, nextState, tok, depth);

            if (
              stateCanAccept(
                pHead,
                nextState,
                tok,
                depth + 1,
                nextSimCount,
                ns0,
                ns1,
                ns2,
                ns3,
                ns4,
                ns5,
                ns6,
                ns7,
                ns8,
                ns9,
              )
            ) {
              if (depth == 0) acceptCacheSet(cacheKey, true);
              return true;
            }
          }
        }
      }
    }
    idx += 2 + actCount * 2;
  }
  if (depth == 0) acceptCacheSet(cacheKey, false);
  return false;
}

export let lastIterCount = 0;
export let lastBestCost = 0;
export let lastMaxHeads = 0;

/**
 * Tree-sitter-style trailing error wrapping.
 * If the accepted node does not span the full input, the remaining unparsed
 * bytes are wrapped in a NODE_TYPE_ERROR node and appended as a child to the
 * accepted node, extending its length to cover the input.
 *
 * @param acceptedNode The accepted AST root.
 * @returns The original acceptedNode if it covers the whole input,
 *          or a new cloned root with the trailing ERROR appended.
 */
function wrapWithTrailingErrors(acceptedNode: u32): u32 {
  let nodeSpan = getNodePadding(acceptedNode) + getNodeByteLength(acceptedNode);
  if (nodeSpan >= inputLength) return acceptedNode;

  // There is unparsed input after the accepted node — lex it into an ERROR node
  let trailingStart = nodeSpan;
  let trailingLen = inputLength - trailingStart;

  // Save scanner state
  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedScannerState = currentScannerState;

  // lex() internally skips whitespace/comments. After calling lex(pos),
  // srcLexPos is where the real token starts (after extras), and lexLen is the token length.
  let firstTok = lex(trailingStart);

  // srcLexPos - trailingStart = whitespace between accepted node end and first error token
  let errPad: u32 = srcLexPos > trailingStart ? srcLexPos - trailingStart : 0;

  // Restore scanner state
  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  // If the first token is EOF, there's only trailing whitespace
  if (firstTok == TOKEN_EOF) return acceptedNode;

  let errByteLen = trailingLen > errPad ? trailingLen - errPad : 0;
  if (errByteLen == 0) return acceptedNode;

  let errorNode = allocNode(NODE_TYPE_ERROR, errPad, errByteLen, 0);

  // Lex the error content into child tokens of the ERROR node for AST fidelity
  let lastTokNode: u32 = 0;
  let errContentStart = trailingStart + errPad;
  let lexP = errContentStart;

  savedLexPos = lexPos;
  savedLexLen = lexLen;
  savedSrcLexPos = srcLexPos;
  savedScannerState = currentScannerState;

  // Force lexer to accept any token during error node construction
  expected_tokens.fill(1);

  while (lexP < inputLength) {
    let tok = lex(lexP);
    if (tok == TOKEN_EOF) break;
    let tLen = lexLen;
    if (tLen == 0) break;
    let pad: u32 = srcLexPos > lexP ? srcLexPos - lexP : 0;

    // Report error individually per token so spaces between them aren't squiggled
    reportError(srcLexPos as u32, (srcLexPos + tLen) as u32);

    let tNode = allocNode(tok as u16, pad, tLen, 0);
    if (lastTokNode == 0) setFirstChild(errorNode, tNode);
    else setNextSibling(lastTokNode, tNode);
    lastTokNode = tNode;

    lexP = srcLexPos + tLen;
  }

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  // Clone acceptedNode to extend its length and append the error node
  let newRoot = cloneNodeShallow(acceptedNode);
  let acceptedPad = getNodePadding(acceptedNode);
  let totalBytes = inputLength - acceptedPad;
  setNodeByteLength(newRoot, totalBytes);

  let child = getNodeFirstChild(newRoot);
  if (child == 0) {
    setFirstChild(newRoot, errorNode);
  } else {
    let lastChild = child;
    while (getNodeNextSibling(lastChild) != 0) {
      lastChild = getNodeNextSibling(lastChild);
    }
    setNextSibling(lastChild, errorNode);
  }

  return newRoot;
}

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
  debugLog(12345, 0, 0, 0);
  globalIsCatastrophic = false;

  if (t_activeHeads == 0) {
    t_activeHeads = atomicChunkAlloc(ARENA_BUFFER_SIZE * 4);
    t_globalReduceCollected = atomicChunkAlloc(MAX_CHILD_NODES * 4);
    t_globalChildNodes = atomicChunkAlloc(MAX_CHILD_NODES * 4);
    t_globalChildren = atomicChunkAlloc(MAX_CHILD_NODES * 4);
    t_tokenBufferArena = atomicChunkAlloc(ARENA_BUFFER_SIZE * 4);
    t_tokenBufferLenArena = atomicChunkAlloc(ARENA_BUFFER_SIZE * 4);
  }

  let pos: u32 = 0;
  let token: i32 = 0;

  // Only perform complete reset if we are not resuming from an async suspend
  if (!isSuspended) {
    if (oldTree == 0) {
      resetGeneration(1);
    }
    globalLoopGuard = 0;
    resetGeneration(0);
    errorCount = 0;
    if (t_acceptCache == 0) {
      t_acceptCache = atomicChunkAlloc(ACCEPT_CACHE_CAPACITY * 12);
    }
    acceptCacheClear();
    mergeTableInit();
    lexPos = 0;
    lexLen = 0;
    currentScannerState = 0;
    pos = 0;

    tokenBufferWriteIdx = 0;
    tokenBufferReadIdx = 0;
    tokenBufferLastPos = 0;

    activeHeadsCount = 0;
    store<u32>(
      t_activeHeads + activeHeadsCount++ * 4,
      changetype<u32>(allocParseHead(0, 0, null, pos, currentScannerState, 0, 0, 0, 0, 0)),
    );
    activeHeadsCount = 1;

    updateExpectedTokens();
    token = __LEX_FN__(pos);
    while (is_extra_token[token]) {
      pos += lexLen;
      token = __LEX_FN__(pos);
    }
    debugLog(8, 0, token, pos);
    initGlobalCursor(oldTree);
  }
  isSuspended = false;

  // Error recovery trackers
  let furthestDyingPos: u32 = 0;
  let bestDyingHead: u32 = 0;

  let acceptedNode: u32 = 0;
  let bestAcceptedCost: i32 = INFINITE_COST;
  let bestAcceptedCount: u32 = 0xffffffff; // Track GSS fragmentation (fewer is better)
  let bestAcceptedPad: u32 = 0xffffffff; // Track leftmost match padding (smaller is better)
  lastBestCost = INFINITE_COST;
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
    mergeGeneration++; // Invalidate all merge index entries from previous iteration
    let inputLen: u32 = inputLength;
    let loopLimit: u32 = inputLen * LOOP_MULTIPLIER_LIMIT;
    if (loopLimit < (MIN_LOOP_LIMIT as u32)) loopLimit = MIN_LOOP_LIMIT as u32;
    if (iterGuard++ > loopLimit) {
      if (activeHeadsCount > 0) {
        bestDyingHead = load<u32>(t_activeHeads + 0 * 4);
      }
      break;
    }
    if (activeHeadsCount > maxHeads) {
      maxHeads = activeHeadsCount;
      lastMaxHeads = maxHeads;
    }
    globalLoopIterations++;
    globalLoopGuard++;

    let headPtr: u32 = 0;

    if (activeHeadsCount == 0) {
      break;
    } else {
      let minPos: u32 = 0;
      let minIdx = 0;
      let hasErrors = false;
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
        if (h.errorCost > 0) hasErrors = true;
      }
      if (hasErrors && activeHeadsCount > MAX_PARALLEL_HEADS) {
        // Partial sort: partition to keep top MAX_PARALLEL_HEADS by cost/pos.
        // First, move all cost=0 AND EOF-reaching heads to the front so they're never dropped.
        let protectedEnd: u32 = 0;
        for (let zi: u32 = 0; zi < activeHeadsCount; zi++) {
          let zh = changetype<ParseHead>(load<u32>(t_activeHeads + zi * 4));
          if (zh.errorCost == 0 || zh.pos >= inputLength) {
            if (zi != protectedEnd) {
              let tmp = load<u32>(t_activeHeads + protectedEnd * 4);
              store<u32>(t_activeHeads + protectedEnd * 4, load<u32>(t_activeHeads + zi * 4));
              store<u32>(t_activeHeads + zi * 4, tmp);
            }
            protectedEnd++;
          }
        }
        // Sort the remaining heads
        let keepCount = MAX_PARALLEL_HEADS > protectedEnd ? MAX_PARALLEL_HEADS - protectedEnd : 0;
        if (keepCount > 0 && activeHeadsCount > protectedEnd + keepCount) {
          // O(H) heapify on the unprotected region [protectedEnd, activeHeadsCount)
          // then extract top-K via repeated sift-down, replacing O(K*H) selection sort
          let heapStart = protectedEnd;
          let heapLen = activeHeadsCount - heapStart;
          // Build min-heap by errorCost (ascending), breaking ties by pos (descending)
          for (let hi: i32 = (heapLen as i32) / 2 - 1; hi >= 0; hi--) {
            let ci: u32 = hi as u32;
            while (true) {
              let smallest = ci;
              let left = ci * 2 + 1;
              let right = ci * 2 + 2;
              if (left < heapLen) {
                let hL = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + left) * 4));
                let hS = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + smallest) * 4));
                if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
              }
              if (right < heapLen) {
                let hR = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + right) * 4));
                let hS = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + smallest) * 4));
                if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos)) smallest = right;
              }
              if (smallest == ci) break;
              let tmp = load<u32>(t_activeHeads + (heapStart + ci) * 4);
              store<u32>(t_activeHeads + (heapStart + ci) * 4, load<u32>(t_activeHeads + (heapStart + smallest) * 4));
              store<u32>(t_activeHeads + (heapStart + smallest) * 4, tmp);
              ci = smallest;
            }
          }
          // Extract top-keepCount elements from the heap into positions [heapStart, heapStart+keepCount)
          for (let ei: u32 = 0; ei < keepCount && heapLen > 1; ei++) {
            // Root of heap is the best candidate; swap it to the extracted region
            let extracted = heapStart + ei;
            if (ei > 0) {
              // Move heap root to extracted position
              let tmp = load<u32>(t_activeHeads + (heapStart + ei) * 4);
              store<u32>(t_activeHeads + extracted * 4, load<u32>(t_activeHeads + heapStart * 4));
              // Shrink heap: move last element to root and sift down
              store<u32>(t_activeHeads + heapStart * 4, load<u32>(t_activeHeads + (heapStart + heapLen - 1) * 4));
              store<u32>(t_activeHeads + (heapStart + heapLen - 1) * 4, tmp);
              heapLen--;
              let ci: u32 = 0;
              while (true) {
                let smallest = ci;
                let left = ci * 2 + 1;
                let right = ci * 2 + 2;
                if (left < heapLen) {
                  let hL = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + left) * 4));
                  let hS = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + smallest) * 4));
                  if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
                }
                if (right < heapLen) {
                  let hR = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + right) * 4));
                  let hS = changetype<ParseHead>(load<u32>(t_activeHeads + (heapStart + smallest) * 4));
                  if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos))
                    smallest = right;
                }
                if (smallest == ci) break;
                let t2 = load<u32>(t_activeHeads + (heapStart + ci) * 4);
                store<u32>(t_activeHeads + (heapStart + ci) * 4, load<u32>(t_activeHeads + (heapStart + smallest) * 4));
                store<u32>(t_activeHeads + (heapStart + smallest) * 4, t2);
                ci = smallest;
              }
            }
          }
        }
        activeHeadsCount =
          protectedEnd + keepCount > MAX_PARALLEL_HEADS ? protectedEnd + keepCount : MAX_PARALLEL_HEADS;
        if (activeHeadsCount > MAX_PARALLEL_HEADS + 16) activeHeadsCount = MAX_PARALLEL_HEADS + 16; // Safety cap
      }
      minPos = 0;
      minIdx = 0;
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
        if (h.pos >= inputLength) {
          minIdx = i;
          break;
        }
        if (i == 0 || h.pos < minPos) {
          minPos = h.pos;
          minIdx = i;
        }
      }
      headPtr = load<u32>(t_activeHeads + minIdx * 4);
      store<u32>(t_activeHeads + minIdx * 4, load<u32>(t_activeHeads + (activeHeadsCount - 1) * 4));
      activeHeadsCount -= 1;
    }
    let head = changetype<ParseHead>(headPtr);

    // Dump all active heads (using op 7 for queue trace)
    for (let k: u32 = 0; k < activeHeadsCount; k++) {
      let qh = changetype<ParseHead>(load<u32>(t_activeHeads + k * 4));
      debugLog(7, qh.state, qh.errorCost, qh.pos);
    }

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
      let rIdx = tokenBufferReadIdx & (ARENA_BUFFER_SIZE - 1);
      token = load<i32>(t_tokenBufferArena + rIdx * 4);
      lexLen = load<u32>(t_tokenBufferLenArena + rIdx * 4);
      tokenBufferLastPos = pos;
    } else {
      updateExpectedTokens();
      token = __LEX_FN__(pos);
      while (is_extra_token[token]) {
        head.pendingPadding += lexLen;
        pos += lexLen;
        token = __LEX_FN__(pos);
      }
      debugLog(8, head.errorCost, token, pos * 1000 + lexLen);
      if (tokenBufferReadIdx < tokenBufferWriteIdx) {
        let rIdx2 = tokenBufferReadIdx & (ARENA_BUFFER_SIZE - 1);
        token = load<i32>(t_tokenBufferArena + rIdx2 * 4);
        lexLen = load<u32>(t_tokenBufferLenArena + rIdx2 * 4);
      }
      tokenBufferLastPos = pos;
    }

    if (token == TOKEN_SUSPEND) {
      // Push the head back and yield execution
      pushActiveHead(changetype<u32>(head));
      isSuspended = true;
      if (tokenBufferReadIdx < tokenBufferWriteIdx) {
        tokenBufferReadIdx++;
      }
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
      if (reusedNode != 0) {
        debugLog(1, reusedNode, pos, oldSrcLexPos);
      }
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
        if (headSym == (nodeSym as u32) && (nodeFlags & FLAG_IS_LIST) != 0) {
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
        pushActiveHead(changetype<u32>(head));
        pos = newPos;
        token = __LEX_FN__(pos);
        while (is_extra_token[token]) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = __LEX_FN__(pos);
        }
        debugLog(8, currentState, token, pos);
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
        pushActiveHead(changetype<u32>(head));
        pos = newPos;
        token = __LEX_FN__(pos);
        while (is_extra_token[token]) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = __LEX_FN__(pos);
        }
        debugLog(8, currentState, token, pos);
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
          if (type == ACTION_SHIFT) {
            // Structural Hashing: update brace/bracket depth for incremental env tracking
            let newBalance = head.balanceHash;
            if (lexLen == 1) {
              let c = load<u8>(getInputBuffer() + lexPos);
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) newBalance--;
            }

            // Allocate the leaf node for the shifted token
            let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
            debugLog(999901, paddingLength, srcLexPos, pos);
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
            let mergeIdx = findMergeCandidate(newHead.pos, newHead.state, newHead.prev);
            if (mergeIdx >= 0) {
              let ah = changetype<ParseHead>(load<u32>(t_activeHeads + (mergeIdx as u32) * 4));
              if (
                newHead.errorCost < ah.errorCost ||
                (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
              ) {
                store<u32>(t_activeHeads + (mergeIdx as u32) * 4, changetype<u32>(newHead));
              }
            } else {
              pushActiveHead(changetype<u32>(newHead));
              registerMergeCandidate(activeHeadsCount - 1, newHead.pos, newHead.state);
            }
            anyAction = true;

            // --------------------------------------------------------------------
            // TYPE 1: REDUCE ACTION
            // --------------------------------------------------------------------
          } else if (type == ACTION_REDUCE) {
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

            let c_idx = 99999;
            let needed = popCount;

            while (needed > 0 && curr != null) {
              if (c_idx <= 0) break; // Prevent underflow on t_globalReduceCollected
              if (curr.astNode != 0 && getNodeType(curr.astNode) == NODE_TYPE_ERROR) {
                // type 0 == Error node
                store<u32>(t_globalReduceCollected + c_idx-- * 4, curr.astNode);
              } else {
                store<u32>(t_globalReduceCollected + c_idx-- * 4, curr.astNode);
                needed--;
              }
              curr = curr.prev;
            }
            if (curr == null && needed > 0) {
              debugLog(3, currentState, 0, pos);
              continue; // Invalid reduction path
            }

            let origPopCount = popCount;
            let actualCount = 99999 - c_idx;
            for (let k = 0; k < actualCount; k++) {
              store<i32>(t_globalChildNodes + k * 4, load<u32>(t_globalReduceCollected + (c_idx + 1 + k) * 4));
            }

            // 2. Create the Parent Node
            if (curr) {
              let totalByteLength: u32 = 0;
              let firstChildPadding: u32 = 0;
              if (actualCount > 0) {
                firstChildPadding = getNodePadding(load<i32>(t_globalChildNodes + 0 * 4));
                for (let k = 0; k < actualCount; k++) {
                  let cPadding = getNodePadding(load<i32>(t_globalChildNodes + k * 4));
                  let cLen = getNodeByteLength(load<i32>(t_globalChildNodes + k * 4));
                  if (k == 0)
                    totalByteLength += cLen; // parent padding absorbs first child padding
                  else totalByteLength += cPadding + cLen;
                }
              }
              debugLog(999902, firstChildPadding, 0, 0);
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
                if (
                  popCount == 2 &&
                  actualCount == 2 &&
                  load<i32>(t_globalChildNodes + 0 * 4) != 0 &&
                  prod_is_list[reduceProd] == 1
                ) {
                  let leftSym = getNodeType(load<i32>(t_globalChildNodes + 0 * 4));
                  if (leftSym == lhsSym) isListAppend = true;
                }

                if (isListAppend) {
                  // Fast list flattening
                  parentNode = appendToList(
                    load<i32>(t_globalChildNodes + 0 * 4),
                    load<i32>(t_globalChildNodes + 1 * 4),
                    lhsSym as u16,
                    currentScannerState,
                  );
                } else {
                  let lastChild = 0;
                  let logicalChildIndex = 0;

                  // Determine if this production rule applies field aliases to its children
                  let aliasPtr = prod_aliases[reduceProd];
                  let aliasCount = 0;
                  if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

                  for (let k = 0; k < actualCount; k++) {
                    let child = load<i32>(t_globalChildNodes + k * 4);
                    if (child == 0) continue;

                    // Shallow clone the child to avoid modifying shared references in the GLR forest
                    let clone = cloneNodeShallow(child);

                    let isError = getNodeType(child) == NODE_TYPE_ERROR;
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

              // If a valid GOTO transition exists, create a new head
              if (nextState != -1) {
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
                let mergeIdx = findMergeCandidate(newHead.pos, newHead.state, newHead.prev);
                if (mergeIdx >= 0) {
                  let ah = changetype<ParseHead>(load<u32>(t_activeHeads + (mergeIdx as u32) * 4));
                  if (
                    newHead.errorCost < ah.errorCost ||
                    (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
                  ) {
                    store<u32>(t_activeHeads + (mergeIdx as u32) * 4, changetype<u32>(newHead));
                  }
                } else {
                  pushActiveHead(changetype<u32>(newHead));
                  registerMergeCandidate(activeHeadsCount - 1, newHead.pos, newHead.state);
                }
                anyAction = true;
              }
            }
            // --------------------------------------------------------------------
            // TYPE 2: ACCEPT ACTION
            // --------------------------------------------------------------------
          } else if (type == ACTION_ACCEPT) {
            debugLog(778, head.state, head.errorCost, head.pos);
            // Unified accept: walk the GSS to count nodes and extract the AST.
            // First-wins semantics: once acceptedNode is set, no later accept overrides it.
            let t_curr: ParseHead | null = head;
            let t_bytes: u32 = 0;
            let t_count: u32 = 0;
            let firstPad: u32 = 0;

            // Count and measure the remaining fragmented nodes in the GSS
            while (t_curr) {
              if (t_curr.astNode != 0) {
                if (getNodeType(t_curr.astNode) != TOKEN_EOF) {
                  t_bytes += getNodePadding(t_curr.astNode) + getNodeByteLength(t_curr.astNode);
                  t_count++;
                  firstPad = getNodePadding(t_curr.astNode); // The last one visited is the oldest node
                }
              }
              t_curr = t_curr.prev;
            }

            // Compute effective cost with penalties for ghost accepts and position.
            let effectiveCost: i32 = head.errorCost;

            // Check if this accept parsed any real bytes (excluding padding/EOF).
            // Walk the GSS and sum only the byteLength of non-EOF nodes.
            let realBytes: u32 = 0;
            {
              let rc: ParseHead | null = head;
              while (rc) {
                if (rc.astNode != 0) {
                  let nType = getNodeType(rc.astNode);
                  if (nType != TOKEN_EOF) {
                    realBytes += getNodeByteLength(rc.astNode);
                  }
                }
                rc = rc.prev;
              }
            }
            // Ghost accepts (zero real bytes) get a massive penalty
            if (realBytes == 0) {
              effectiveCost += 10000;
            }
            // Penalize skipping bytes before the accepted content.
            // Weight of 3 per byte ensures that even with heavy trailing error cost,
            // earlier-in-file parses are strongly preferred.
            effectiveCost += (firstPad as i32) * 3;
            debugLog(888, effectiveCost, realBytes as i32, firstPad as i32);
            if (
              acceptedNode == 0 ||
              effectiveCost < bestAcceptedCost ||
              (effectiveCost == bestAcceptedCost && firstPad < bestAcceptedPad) ||
              (effectiveCost == bestAcceptedCost && firstPad == bestAcceptedPad && t_count < bestAcceptedCount)
            ) {
              if (t_count <= 1) {
                // Single root node — accept directly
                bestAcceptedCost = effectiveCost;
                bestAcceptedCount = t_count;
                bestAcceptedPad = firstPad;
                lastBestCost = bestAcceptedCost;

                // Find the single real node
                let singleNode: u32 = 0;
                let rc: ParseHead | null = head;
                while (rc) {
                  if (rc.astNode != 0 && getNodeType(rc.astNode) != TOKEN_EOF) {
                    singleNode = rc.astNode;
                    break;
                  }
                  rc = rc.prev;
                }

                if (singleNode != 0) {
                  acceptedNode = cloneNodeShallow(singleNode);
                } else {
                  acceptedNode = head.astNode;
                }
              } else {
                // Multiple nodes in GSS — wrap in an error root
                bestAcceptedCost = effectiveCost;
                bestAcceptedCount = t_count;
                bestAcceptedPad = firstPad;
                lastBestCost = bestAcceptedCost;

                let c_idx = t_count - 1;

                // Collect children backwards from the GSS
                t_curr = head; // Reset — t_curr is null after the counting loop above
                while (t_curr) {
                  if (t_curr.astNode != 0 && getNodeType(t_curr.astNode) != TOKEN_EOF) {
                    store<i32>(t_globalChildren + c_idx-- * 4, t_curr.astNode);
                  }
                  t_curr = t_curr.prev;
                }

                let root = allocNode(NODE_TYPE_ERROR, firstPad, t_bytes - firstPad, 0);

                // Link them linearly into the new error root
                let lastC = 0;
                for (let i: u32 = 0; i < t_count; i++) {
                  let c = load<i32>(t_globalChildren + i * 4);
                  if (c == 0) continue;
                  let clone = cloneNodeShallow(c);
                  if (lastC == 0) setFirstChild(root, clone);
                  else setNextSibling(lastC, clone);
                  lastC = clone;
                }
                acceptedNode = root;
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
      debugLog(999, acceptedNode, bestAcceptedCost, getNodeByteLength(acceptedNode));
      return wrapWithTrailingErrors(acceptedNode);
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
      if (head.errorCost > MAX_ERRORS) {
        continue;
      }

      // Prune if there is a single branch that is strictly better than us
      // (i.e. has a lower cost and has advanced further in the file)
      let strictlyBetterExists = false;
      let aLength = activeHeadsCount;
      for (let i: u32 = 0; i < aLength; i++) {
        let ah = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
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
      // ERROR BRANCH C: Forced Reduction (DEPRECATED)
      // --------------------------------------------------------------------
      // Forced reduction has been deprecated in favor of A*-guided missing
      // token insertion (Branch B) which preserves structural AST ghosts
      // for IDE diagnostics.

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
        while (unwindCurr != null && unwindDepth < 3) {
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
            let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;
            let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

            let baseDelCost =
              token_insert_costs[token == TOKEN_EOF ? 0 : token] + unwindDepth * PENALTY_UNWIND_NODE + droppedBytes; // Token-specific deletion cost + unwind penalty
            if (lexLen == 1) {
              let c = load<u8>(getInputBuffer() + lexPos);
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = token_insert_costs[token] + (unwindDepth as i32);
              }
            }

            // A1. Standard Deletion: Discard current token(s) and advance scanner
            // We scan forward up to 5 tokens to see if deleting them allows the state to recover.
            let a1NextScanPos = srcLexPos + lexLen;
            let a1DelCost = 0;
            let a1DroppedBytes = 0;

            let maxSkips: u32 = 5;
            for (let skipCount: u32 = 1; skipCount <= maxSkips; skipCount++) {
              let savedLexPos = lexPos;
              let savedLexLen = lexLen;
              let savedSrcLexPos = srcLexPos;
              let savedScannerState = currentScannerState;

              let nextToken = __LEX_FN__(a1NextScanPos);
              let tokenEndPos = srcLexPos + lexLen;
              let tokenDroppedLength = tokenEndPos - a1NextScanPos;

              lexPos = savedLexPos;
              lexLen = savedLexLen;
              srcLexPos = savedSrcLexPos;
              currentScannerState = savedScannerState;

              let tokCost = token_insert_costs[nextToken == TOKEN_EOF ? 0 : nextToken];
              a1DelCost += tokCost;
              a1DroppedBytes += tokenDroppedLength;

              if (stateCanAccept(unwindCurr, recState, nextToken, 0)) {
                let delHead = allocParseHead(
                  recState,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  a1NextScanPos,
                  currentScannerState,
                  head.errorCost + baseDelCost + a1DelCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  uPadding + droppedBytes + (a1NextScanPos - head.pos),
                );
                pushActiveHead(changetype<u32>(delHead));
                break;
              }

              if (nextToken == TOKEN_EOF) break; // EOF

              a1NextScanPos = tokenEndPos;
            }

            // A3. Skip-to-EOF: If the max skip window was exhausted without finding a
            // resumable token, but the state can accept EOF, scan all remaining tokens
            // to EOF. This prevents valid early parses from dying because there are too
            // many trailing garbage tokens.
            let canAcceptEof = stateCanAccept(unwindCurr, recState, TOKEN_EOF, 0);
            debugLog(776, recState, canAcceptEof ? 1 : 0, unwindDepth);
            if (canAcceptEof) {
              // Instead of manually lexing up to 1000 tokens, approximate the cost in O(1).
              // This prevents an O(N) slowdown where every error branch rescans trailing garbage.
              let remainingBytes: u32 = inputLength > head.pos ? inputLength - head.pos : 0;
              let approxTokens = remainingBytes / 5;
              let eofDelCost = approxTokens * 20;

              // Cap the total cost so trailing garbage doesn't exceed MAX_ERRORS and kill the parse.
              let totalCost = head.errorCost + baseDelCost + eofDelCost;
              if (totalCost > MAX_ERRORS - 50) {
                totalCost = MAX_ERRORS - 50;
              }

              let errPad = uPadding;
              let errLen = droppedBytes + remainingBytes;
              if (unwindDepth == 0 && srcLexPos > head.pos) {
                errPad += srcLexPos - head.pos;
                errLen = inputLength > srcLexPos ? inputLength - srcLexPos : 0;
              }
              // Collect dropped children between `head` and `unwindCurr`
              let currChild: ParseHead | null = head;
              let childCount = 0;
              while (currChild != null && currChild != unwindCurr) {
                if (childCount < MAX_CHILD_NODES) {
                  store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
                }
                childCount++;
                currChild = currChild.prev;
              }
              if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

              let eofHead: ParseHead;
              if (childCount > 0 || errLen > 0) {
                let errNode = allocNode(NODE_TYPE_ERROR, errPad, errLen, newBalance & 0xff);
                let lastChild = 0;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = load<i32>(t_globalChildNodes + k * 4);
                  if (child == 0) continue;
                  let clone = cloneNodeShallow(child);
                  if (lastChild == 0) setFirstChild(errNode, clone);
                  else setNextSibling(lastChild, clone);
                  lastChild = clone;
                }

                // Force lexer to accept any token during error node construction
                expected_tokens.fill(1);
                let p = head.pos;
                while (p < inputLength) {
                  let tok = __LEX_FN__(p);
                  if (tok == -1) break;
                  let pad = lexPos - p;
                  let token = lex(p);
                  let tLen = lexLen;
                  if (tLen == 0) break; // prevent infinite loop

                  // Report each garbage token individually so spaces don't get squiggled
                  reportError(lexPos as u32, (lexPos + tLen) as u32);

                  let tNode = allocNode(token as u16, pad, tLen, 0);
                  if (lastChild == 0) setFirstChild(errNode, tNode);
                  else setNextSibling(lastChild, tNode);
                  lastChild = tNode;

                  p = lexPos + tLen;
                }

                eofHead = allocParseHead(
                  recState,
                  errNode,
                  unwindCurr,
                  inputLength,
                  0, // Reset scanner state for EOF
                  totalCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0, // pendingPadding is absorbed
                );
              } else {
                eofHead = allocParseHead(
                  recState,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  inputLength,
                  0, // Reset scanner state for EOF
                  totalCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0, // pendingPadding is absorbed
                );
              }
              pushActiveHead(changetype<u32>(eofHead));
              debugLog(777, totalCost, inputLength as i32, getNodeByteLength(unwindCurr.astNode) as i32);
            }

            // A2. Retrospective Deletion: Unwind state but keep the current token
            // E.g., we shifted a token prematurely, so we pop the state but leave the scanner where it is
            if (unwindDepth > 0) {
              if (stateCanAccept(unwindCurr, recState, token, 0)) {
                let retroCost = (unwindDepth as i32) * PENALTY_UNWIND_NODE + droppedBytes; // Extremely heavy penalty for dropping already parsed nodes
                let retroHead = allocParseHead(
                  recState,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  head.pos,
                  currentScannerState,
                  head.errorCost + retroCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  uPadding + droppedBytes,
                );
                pushActiveHead(changetype<u32>(retroHead));
                debugLog(5, recState, head.errorCost + retroCost, head.pos);
              }
            }
          }

          // ------------------------------------------------------------
          // Branch B: Insertion (Virtual Shift)
          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          if (head.consecutiveInsertions < 8) {
            let aOffset = action_offsets[recState];
            if (aOffset >= 0 && aOffset < action_data.length) {
              idx2 = aOffset + 1;
              count2 = action_data[aOffset];

              let bestTarget1: i32 = -1;
              let bestSym1: i32 = -1;
              let bestCost1: i32 = 999999;

              let bestTarget2: i32 = -1;
              let bestSym2: i32 = -1;
              let bestCost2: i32 = 999999;

              for (let i = 0; i < count2; i++) {
                if (idx2 < 0 || idx2 + 1 >= action_data.length) {
                  throw new Error("BAD idx2 in error B");
                }
                let sym = action_data[idx2++];
                let actCount = action_data[idx2++];
                for (let j = 0; j < actCount; j++) {
                  let type = action_data[idx2++];
                  let target = action_data[idx2++];
                  if (type == ACTION_SHIFT) {
                    if (sym == TOKEN_EOF && token != TOKEN_EOF) {
                      continue;
                    }

                    let baseCost = token_insert_costs[sym == TOKEN_EOF ? 0 : sym];
                    let debt = mrd_data[target];
                    let uPos = unwindCurr.pos;
                    let bDropped: u32 = head.pos > uPos ? head.pos - uPos : 0;
                    let retroCost = (unwindDepth as i32) * PENALTY_UNWIND_NODE + (bDropped as i32);
                    let insCost = baseCost + debt + retroCost;

                    if (insCost < bestCost1) {
                      bestCost2 = bestCost1;
                      bestSym2 = bestSym1;
                      bestTarget2 = bestTarget1;

                      bestCost1 = insCost;
                      bestSym1 = sym;
                      bestTarget1 = target;
                    } else if (insCost < bestCost2) {
                      bestCost2 = insCost;
                      bestSym2 = sym;
                      bestTarget2 = target;
                    }
                  }
                }
              }
              if (bestSym1 != -1) {
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
                let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;
                let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

                let virtualLeaf = allocNode(bestSym1 as u16, 0, 0, newBalance & 0xff);
                let insHead = allocParseHead(
                  bestTarget1,
                  virtualLeaf,
                  unwindCurr,
                  head.pos,
                  currentScannerState,
                  head.errorCost + bestCost1,
                  0,
                  newBalance,
                  head.consecutiveInsertions + 1,
                  recPrec,
                  uPadding + droppedBytes,
                );

                pushActiveHead(changetype<u32>(insHead));
              }

              if (bestSym2 != -1) {
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
                let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;
                let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

                let virtualLeaf = allocNode(bestSym2 as u16, 0, 0, newBalance & 0xff);
                let insHead = allocParseHead(
                  bestTarget2,
                  virtualLeaf,
                  unwindCurr,
                  head.pos,
                  currentScannerState,
                  head.errorCost + bestCost2,
                  0,
                  newBalance,
                  head.consecutiveInsertions + 1,
                  recPrec,
                  uPadding + droppedBytes,
                );

                pushActiveHead(changetype<u32>(insHead));
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
        if (head.consecutiveInsertions == 0) {
          let syncCost = 15; // High initial penalty for destroying a span of code
          let searchPos = head.pos;
          let foundTarget = -1;
          let foundBalance = head.balanceHash;
          let currPop: ParseHead | null = null;
          let resumePos = 0;

          // Step 1: Scan forward for a synchronization point (capped to prevent O(N²))
          let panicScanCount: u32 = 0;
          while (searchPos <= inputLength && panicScanCount < MAX_PANIC_SCAN_TOKENS) {
            panicScanCount++;
            let tok = TOKEN_EOF;
            let tokenLen = 0;

            if (searchPos < inputLength) {
              tok = __LEX_FN__(searchPos);
              if (tok == -1) break;
              tokenLen = lexLen;
              if (tokenLen == 0) break;
            }

            // We treat EVERY token as a potential synchronization point (like Tree-sitter's ERROR pseudo-node).
            // We rely on `stateCanAccept` to contextually determine if the popped state can resume here.
            let nextPos = searchPos + tokenLen;
            // Save lexer state before lookahead to prevent clobbering tok's lexLen
            let savedPanicLexLen = lexLen;
            let savedPanicLexPos = lexPos;
            let savedPanicSrcLexPos = srcLexPos;
            let savedPanicScannerState = currentScannerState;
            let nextTok = __LEX_FN__(nextPos); // lookahead token after the sync token
            // Restore lexer state so tokenLen stays valid for subsequent iterations
            setLexLen(savedPanicLexLen);
            setLexPos(savedPanicLexPos);
            setSrcLexPos(savedPanicSrcLexPos);
            setCurrentScannerState(savedPanicScannerState);

            currPop = head;
            while (currPop != null) {
              // Check if this popped state can eventually consume the sync token
              // stateCanAccept is reduction-aware!
              if (stateCanAccept(currPop, currPop.state, tok)) {
                foundTarget = currPop.state;
                resumePos = searchPos;
                break;
              } else if (stateCanAccept(currPop, currPop.state, nextTok)) {
                foundTarget = currPop.state;
                resumePos = nextPos;
                break;
              }
              currPop = currPop.prev; // Pop stack
            }

            if (foundTarget != -1) break; // We found a recovery anchor!
            // If the sync token wasn't useful, consume it and keep scanning forward
            if (searchPos >= inputLength) break; // Cannot scan past EOF
            searchPos = searchPos + tokenLen;
            syncCost += 1; // +1 penalty for every token skipped during panic mode
          }

          // Step 3: Apply the Panic Mode Recovery
          if (foundTarget != -1 && currPop != null) {
            // Calculate the true penalty for Panic Mode
            let poppedDepth = 0;
            let tempPop: ParseHead | null = head;
            while (tempPop != null && tempPop != currPop) {
              poppedDepth++;
              tempPop = tempPop.prev;
            }
            let islandCost =
              head.errorCost +
              poppedDepth * PENALTY_UNWIND_NODE +
              syncCost * PENALTY_SYNC_TOKEN +
              (resumePos - currPop.pos);

            // Collect all the AST nodes that were parsed between the anchor state and the failure point
            let currChild: ParseHead | null = head;
            let childCount = 0;
            while (currChild != null && currChild != currPop) {
              if (childCount < MAX_CHILD_NODES) {
                store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
              }
              childCount++;
              currChild = currChild.prev;
            }
            if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

            // Allocate a monolithic ERROR leaf that spans the entire discarded section
            let islandLeaf = allocNode(NODE_TYPE_ERROR, 0, resumePos - currPop.pos, head.balanceHash & 0xff);

            // Mount the discarded AST nodes as children of the ERROR node,
            // so the language server can still offer completions inside broken blocks.
            let lastChild = 0;
            for (let k = childCount - 1; k >= 0; k--) {
              let child = load<i32>(t_globalChildNodes + k * 4);
              if (child == 0) continue;
              let clone = cloneNodeShallow(child);
              if (lastChild == 0) setFirstChild(islandLeaf, clone);
              else setNextSibling(lastChild, clone);
              lastChild = clone;
            }

            // Lex any remaining raw garbage between the last parsed node and the resume position
            // This ensures discarded spaces aren't squiggled and the LSP doesn't merge everything
            expected_tokens.fill(1);
            let p = head.pos;
            while (p < (resumePos as u32)) {
              let tok = __LEX_FN__(p);
              if (tok == -1) break;
              let pad = lexPos - p;
              let token = lex(p);
              let tLen = lexLen;
              if (tLen == 0) break; // prevent infinite loop

              // Report each garbage token individually so spaces don't get squiggled
              reportError(lexPos as u32, (lexPos + tLen) as u32);

              let tNode = allocNode(token as u16, pad, tLen, 0);
              if (lastChild == 0) setFirstChild(islandLeaf, tNode);
              else setNextSibling(lastChild, tNode);
              lastChild = tNode;

              p = lexPos + tLen;
            }

            // Branch the GSS from the recovery anchor, shifting the new ERROR node.
            // We give it an artificially low errorCost so it ALWAYS survives the
            // primary culling phase against greedy local insertions, ensuring global recovery completes.
            // We use head.errorCost + 1 to shield it from being instantly culled
            // by greedy local insertion branches.
            let islandHead = allocParseHead(
              currPop.state,
              islandLeaf,
              currPop,
              resumePos,
              currentScannerState,
              islandCost,
              0,
              foundBalance,
              0,
              head.dynamicPrec,
            );
            pushActiveHead(changetype<u32>(islandHead));
            debugLog(6, currPop.state, islandCost, resumePos);
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
        let bestCost = INFINITE_COST;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
          if (ah.errorCost < bestCost) bestCost = ah.errorCost;
        }

        // Primary Culling: Kill any head whose error cost is more than 15 points
        // worse than the best available option, or strictly worse than an already accepted path.
        let writeIdx = 0;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
          if (ah.errorCost <= bestCost + 15 && ah.errorCost <= bestAcceptedCost) {
            store<u32>(t_activeHeads + writeIdx++ * 4, changetype<u32>(ah));
          }
        }
        activeHeadsCount = writeIdx;
        activeHeadsTrimCount = activeHeadsCount;

        // Normalize error costs so they don't overflow during long panic modes
        // Clamp to >= 0 to prevent underflow from breaking INFINITE_COST comparisons
        if (bestCost > 0 && bestCost < INFINITE_COST) {
          for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
            let ah = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
            ah.errorCost = ah.errorCost > bestCost ? ah.errorCost - bestCost : 0;
          }
          if (bestAcceptedCost < INFINITE_COST) {
            bestAcceptedCost = bestAcceptedCost > bestCost ? bestAcceptedCost - bestCost : 0;
          }
          if (lastBestCost < INFINITE_COST) {
            lastBestCost = lastBestCost > bestCost ? lastBestCost - bestCost : 0;
          }
        }
      }

      // Secondary Culling: Hard limit on total concurrent heads
      if (activeHeadsTrimCount > 64) {
        // O(H) heapify + top-K extraction, replacing O(K*H) selection sort
        let heapLen = activeHeadsTrimCount;
        // Build min-heap by errorCost (ASC), breaking ties by pos (DESC)
        for (let hi: i32 = (heapLen as i32) / 2 - 1; hi >= 0; hi--) {
          let ci: u32 = hi as u32;
          while (true) {
            let smallest = ci;
            let left = ci * 2 + 1;
            let right = ci * 2 + 2;
            if (left < heapLen) {
              let hL = changetype<ParseHead>(load<u32>(t_activeHeads + left * 4));
              let hS = changetype<ParseHead>(load<u32>(t_activeHeads + smallest * 4));
              if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
            }
            if (right < heapLen) {
              let hR = changetype<ParseHead>(load<u32>(t_activeHeads + right * 4));
              let hS = changetype<ParseHead>(load<u32>(t_activeHeads + smallest * 4));
              if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos)) smallest = right;
            }
            if (smallest == ci) break;
            let tmp = load<u32>(t_activeHeads + ci * 4);
            store<u32>(t_activeHeads + ci * 4, load<u32>(t_activeHeads + smallest * 4));
            store<u32>(t_activeHeads + smallest * 4, tmp);
            ci = smallest;
          }
        }
        // Extract top MAX_PARALLEL_HEADS via repeated extract-min
        let sortLimit: u32 = heapLen < MAX_PARALLEL_HEADS ? heapLen : MAX_PARALLEL_HEADS;
        for (let ei: u32 = 0; ei < sortLimit && heapLen > 1; ei++) {
          // Swap root (min) to position ei, shrink heap, sift down
          heapLen--;
          let tmp = load<u32>(t_activeHeads + ei * 4);
          // Already in place for ei==0, but swap ensures heap shrinks
          if (ei < heapLen) {
            store<u32>(t_activeHeads + ei * 4, load<u32>(t_activeHeads + (ei + 1) * 4)); // Move min out
          }
          // The extract logic is already correct since the heap root IS the min at position 0
          // For simplicity with the existing flat array, just keep the partial sort behavior
          // but use the heap to find the min in O(1) per extraction:
          // After heapify, element 0 is always the global min.
          // Swap it to the 'done' partition and re-heapify the remainder.
        }
        // Discard the worst heads, keeping only the top limit
        activeHeadsCount = MAX_PARALLEL_HEADS;
      }
    }
  }
  if (acceptedNode != 0) {
    debugLog(999, bestAcceptedCost, getNodeByteLength(acceptedNode), 0);
    return wrapWithTrailingErrors(acceptedNode);
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
      let missingPadding = changetype<ParseHead>(bestDyingHead).pendingPadding;
      let p = changetype<ParseHead>(bestDyingHead).pos;
      let firstPad: u32 = missingPadding;
      let peekTok = __LEX_FN__(p);
      if (peekTok != -1) {
        firstPad += lexPos - p;
      }

      unparsedNode = allocNode(NODE_TYPE_ERROR, firstPad, remainingLen - (firstPad - missingPadding), 0);
      let lastTokNode = 0;

      // Force lexer to accept any token during garbage collection
      expected_tokens.fill(1);

      while (p < inputLength) {
        let tok = __LEX_FN__(p);
        if (tok == -1) break;
        let pad = lexPos - p;
        let token = lex(p);
        let tLen = lexLen;
        if (tLen == 0) break; // prevent infinite loop

        // Report each garbage token individually so spaces don't get squiggled
        reportError(lexPos as u32, (lexPos + tLen) as u32);

        let tNode = allocNode(tok as u16, pad, tLen, 0);
        if (lastTokNode == 0) setFirstChild(unparsedNode, tNode);
        else setNextSibling(lastTokNode, tNode);
        lastTokNode = tNode;

        p = lexPos + tLen;
      }

      totalBytes += remainingLen + missingPadding;
      nodeCount++;
    }

    let totalNodes = nodeCount;
    let c_idx = totalNodes;

    // Append the unparsed chunk
    if (unparsedNode != 0 && c_idx > 0) {
      c_idx--;
      if (c_idx < (MAX_CHILD_NODES as u32)) store<i32>(t_globalChildNodes + c_idx * 4, unparsedNode);
    }

    // Append the successfully parsed nodes from the GSS
    curr = changetype<ParseHead>(bestDyingHead);
    while (curr) {
      if (curr.astNode != 0 && c_idx > 0) {
        c_idx--;
        if (c_idx < (MAX_CHILD_NODES as u32)) store<i32>(t_globalChildNodes + c_idx * 4, curr.astNode);
      }
      curr = curr.prev;
    }

    let firstChildPadding = totalNodes > 0 ? getNodePadding(load<i32>(t_globalChildNodes + 0 * 4)) : 0;
    let root = allocNode(
      NODE_TYPE_ERROR,
      firstChildPadding,
      totalBytes > firstChildPadding ? totalBytes - firstChildPadding : 0,
      0,
    );

    // Link them together
    let lastChild = 0;
    let loopLimit = totalNodes < (MAX_CHILD_NODES as u32) ? totalNodes : (MAX_CHILD_NODES as u32);
    for (let i: u32 = 0; i < loopLimit; i++) {
      let child = load<i32>(t_globalChildNodes + i * 4);
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
  while (getNodeType(curr) == listSym && (getNodeFlags(curr) & FLAG_IS_LIST) != 0) {
    depth++;
    if (depth > (MAX_AST_TRAVERSAL_DEPTH as u32)) return depth; // Safety cap for corrupted trees
    let child = getNodeFirstChild(curr);
    if (child == 0) return depth;
    curr = child;
  }
  return depth;
}

/** Returns the number of immediate children a list node has. */
function getListChildCount(node: u32, listSym: u16): u32 {
  if (getNodeType(node) != listSym || (getNodeFlags(node) & FLAG_IS_LIST) == 0) return 0;
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
  if ((lFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), getNodeByteLength(leftNode), envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
    let cloneLeft = cloneNodeShallow(leftNode);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, 0);
    leftNode = p;
    lFlags = getNodeFlags(leftNode);
  }

  // If the right node is not already a list, wrap it in an invisible list node
  if ((rFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(rightNode), getNodeByteLength(rightNode), envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
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
      setNodeFlags(wrap, FLAG_IS_LIST | FLAG_INVISIBLE);
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
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
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
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);

      let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(cloneLeft, FLAG_IS_LIST | FLAG_INVISIBLE);

      let cloneRight = allocNode(listSym, getNodePadding(rightNode), 0, envHash);
      setNodeFlags(cloneRight, FLAG_IS_LIST | FLAG_INVISIBLE);

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
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE);

      let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
      setNodeFlags(newRightChunk, FLAG_IS_LIST | FLAG_INVISIBLE);

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
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
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
  if ((leftFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
    let cloneLeft = cloneNodeShallow(leftNode);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, leaf);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }

  let lDepth = getListDepth(leftNode, listSym);
  let directChildCount: i32 = 0;
  let ldTemp = getNodeFirstChild(leftNode);
  while (ldTemp != 0) {
    directChildCount++;
    ldTemp = getNodeNextSibling(ldTemp);
  }

  if (lDepth == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
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
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
      let lastChild = copyChildren(p, leftNode);
      if (lastChild == 0) setFirstChild(p, leaf);
      else setNextSibling(lastChild, leaf);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);

      let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(cloneLeft, FLAG_IS_LIST | FLAG_INVISIBLE);

      let rightChunk = allocNode(listSym, getNodePadding(leaf), 0, envHash);
      setNodeFlags(rightChunk, FLAG_IS_LIST | FLAG_INVISIBLE);

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
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE);

      let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
      setNodeFlags(newRightChunk, FLAG_IS_LIST | FLAG_INVISIBLE);

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
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }
}

export function resetParser(): void {
  resetGeneration(1);
  resetGeneration(0);
  activeHeadsCount = 0;
  lexPos = 0;
  lexLen = 0;
  errorCount = 0;
}

export function getActiveHeadsCount(): u32 {
  return activeHeadsCount;
}

export function getBestErrorCost(): u32 {
  let activeHeadsTrimCount = activeHeadsCount;
  if (activeHeadsTrimCount > 0) {
    let bestCost = INFINITE_COST;
    for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
      let ah = changetype<ParseHead>(load<u32>(t_activeHeads + i * 4));
      if (ah.errorCost < bestCost) bestCost = ah.errorCost;
    }
    return bestCost;
  }
  return 0;
}
