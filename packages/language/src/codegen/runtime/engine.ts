/* eslint-disable */
// @ts-nocheck
import {
  ensureInputBuffer as _ensureInputBuffer,
  getInputBuffer as _getInputBuffer,
  allocNode,
  atomicChunkAlloc,
  allocGen0,
  FLAG_GC_MARK,
  FLAG_INVISIBLE,
  FLAG_IS_LIST,
  FLAG_LIST_BOUNDARY,
  FLAG_HAS_ERROR,
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
import { ChunkedUint32Array, UnmanagedInt32Array, UnmanagedUint32Array, createChunkedUint32Array } from "./array";
import { initQueryArena, resetQueryArena, clearDiagnostics } from "./graph";
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
  sorted_insertion_symbols as _sorted_insertion_symbols,
  type_fields as _type_fields,
  type_field_data as _type_field_data,
  currentScannerState,
  initExtras,
  inputLength,
  is_extra_token,
  invokeLexer,
  MAX_TERMINAL_ID,
  lexLen,
  lexPos,
  setCurrentScannerState,
  setLexLen,
  setLexPos,
  setSrcLexPos,
  srcLexPos,
} from "./parser";
import { ParseHead, activeHeadsCount, t_activeHeads } from "./gss";
export function getInputBuffer(): usize {
  return _getInputBuffer();
}

export function ensureInputBuffer(size: u32): usize {
  return _ensureInputBuffer(size);
}

export let globalSearchIterations: u32 = 0;
export function getSearchIterations(): u32 {
  return globalSearchIterations;
}
export let incrementalStartOffset: u32 = 0;

/**
 * Zero-allocation static wrapper for baked WASM memory tables.
 * Used to directly read arrays exported by the `wabt` C-backend without instantiating Array objects.
 */
@unmanaged
class StaticTable {
  /** Reads a 32-bit integer at the given logical index. */
  @inline @operator("[]") get(index: i32): i32 {
    let ptr = changetype<usize>(this);
    if (ptr == 0) return 0;
    let len = load<i32>(ptr - 4);
    if (index < 0 || index >= len) {
      return 0;
    }
    return load<i32>(ptr + ((index as usize) << 2));
  }
  /** Retrieves the encoded array length from the preceding 4-byte header. */
  @inline get length(): i32 {
    let ptr = changetype<usize>(this);
    if (ptr == 0) return 0;
    return load<i32>(ptr - 4);
  }
}

export const action_offsets = changetype<StaticTable>(_action_offsets);
export const action_data = changetype<StaticTable>(_action_data);
export const goto_offsets = changetype<StaticTable>(_goto_offsets);
export const goto_data = changetype<StaticTable>(_goto_data);
export const mrd_data = changetype<StaticTable>(_mrd_data);
export const token_insert_costs = changetype<StaticTable>(_token_insert_costs);
export const sorted_insertion_symbols = changetype<StaticTable>(_sorted_insertion_symbols);

export const prod_lengths = changetype<StaticTable>(_prod_lengths);
export const prod_lhs = changetype<StaticTable>(_prod_lhs);
export const prod_is_invisible = changetype<StaticTable>(_prod_is_invisible);
export const prod_is_list = changetype<StaticTable>(_prod_is_list);
export const prod_dynamic_prec = changetype<StaticTable>(_prod_dynamic_prec);
export const prod_aliases = changetype<StaticTable>(_prod_aliases);
export const alias_data = changetype<StaticTable>(_alias_data);
export const type_fields = changetype<StaticTable>(_type_fields);
export const type_field_data = changetype<StaticTable>(_type_field_data);



// GSS Head Structure (Simplified LR stack for this skeleton)


// ----------------------------------------------------------------------------
// Diagnostics & Error Reporting
// ----------------------------------------------------------------------------
export let errorCount: i32 = 0;
export let t_errorStarts: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorEnds: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);

export const MAX_ERRORS: i32 = 10000;
export const MAX_PARALLEL_HEADS: u32 = 32;
const MAX_CURSOR_DEPTH: i32 = 999999;
export const INFINITE_COST: i32 = 999999;
const MAX_UPWARD_STEPS: i32 = 100000;
export const MAX_CHILD_NODES: i32 = 100000;
export const MIN_LOOP_LIMIT: u32 = 1000000;
export const ARENA_BUFFER_SIZE: i32 = 16384;
export const MAX_LOOKAHEAD_DEPTH: i32 = 6;
export const MAX_AST_TRAVERSAL_DEPTH: u32 = 100;
export const LOOP_MULTIPLIER_LIMIT: u32 = 100;
export const MAX_PANIC_SCAN_TOKENS: u32 = 200;

export const PENALTY_UNWIND_NODE: i32 = 500;
export const PENALTY_SYNC_TOKEN: i32 = 50;

// --- Merge Hash Index ---
// Fixed-size hash table for O(1) GLR merge lookups, replacing O(H) linear scans.
// Keyed by (pos, state). Uses a generation counter for O(1) clearing.
const MERGE_TABLE_SIZE: u32 = 256;
const MERGE_TABLE_MASK: u32 = MERGE_TABLE_SIZE - 1;
const MERGE_PROBE_LIMIT: u32 = 4;
let t_mergeTable: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0); // pointer to raw memory: MERGE_TABLE_SIZE * 8 bytes
export let mergeGeneration: u32 = 0;

export function mergeTableInit(): void {
  if (changetype<usize>(t_mergeTable) == 0) {
    t_mergeTable = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MERGE_TABLE_SIZE * 8));
  }
}

export function rebuildMergeTable(activeHeadsCount: u32, t_activeHeads: UnmanagedUint32Array): void {
  if (changetype<usize>(t_mergeTable) == 0) return;
  mergeGeneration++;
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let h = changetype<ParseHead>(t_activeHeads[i]);
    // Inline registerMergeCandidate to avoid circular imports or just use the same logic
    let hash = ((h.pos ^ ((h.state as u32) * 0x9e3779b9)) >> 4) & MERGE_TABLE_MASK;
    for (let j: u32 = 0; j < MERGE_PROBE_LIMIT; j++) {
      let slotIdx = ((hash + j) & MERGE_TABLE_MASK) << 1;
      if (t_mergeTable[slotIdx + 1] != mergeGeneration) {
        t_mergeTable[slotIdx] = i;
        t_mergeTable[slotIdx + 1] = mergeGeneration;
        break;
      }
    }
  }
}

/**
 * Find a merge candidate in the active heads matching (pos, state, prev).
 * Returns the index into t_activeHeads, or -1 if not found.
 */
export function findMergeCandidate(pos: u32, state: i32, prev: ParseHead | null): i32 {
  if (changetype<usize>(t_mergeTable) == 0) return -1;
  let h = ((pos ^ ((state as u32) * 0x9e3779b9)) >> 4) & MERGE_TABLE_MASK;
  for (let i: u32 = 0; i < MERGE_PROBE_LIMIT; i++) {
    let slotIdx = ((h + i) & MERGE_TABLE_MASK) << 1;
    if (t_mergeTable[slotIdx + 1] != mergeGeneration) continue;
    let idx = t_mergeTable[slotIdx];
    if (idx < activeHeadsCount) {
      let ah = changetype<ParseHead>(t_activeHeads[idx]);
      if (ah.pos == pos && ah.state == state) {
        return idx as i32;
      }
    }
  }
  return -1;
}

/**
 * Register a newly pushed head in the merge hash index.
 */
export function registerMergeCandidate(headIdx: u32, pos: u32, state: i32): void {
  if (changetype<usize>(t_mergeTable) == 0) return;
  let h = ((pos ^ ((state as u32) * 0x9e3779b9)) >> 4) & MERGE_TABLE_MASK;
  for (let i: u32 = 0; i < MERGE_PROBE_LIMIT; i++) {
    let slotIdx = ((h + i) & MERGE_TABLE_MASK) << 1;
    if (t_mergeTable[slotIdx + 1] != mergeGeneration) {
      t_mergeTable[slotIdx] = headIdx;
      t_mergeTable[slotIdx + 1] = mergeGeneration;
      return;
    }
  }
  // All probe slots occupied -> evict the first one
  let slotIdx = h << 1;
  t_mergeTable[slotIdx] = headIdx;
  t_mergeTable[slotIdx + 1] = mergeGeneration;
}



export function getErrorStart(index: i32): u32 {
  if (index < 0 || index >= errorCount) return 0;
  return t_errorStarts[index];
}
export function getErrorEnd(index: i32): u32 {
  if (index < 0 || index >= errorCount) return 0;
  return t_errorEnds[index];
}

/**
 * Registers an error span during the parse phase.
 * @param start The absolute byte offset of the syntax error start.
 * @param end The absolute byte offset of the syntax error end.
 */
export function reportGlobalError(start: u32, end: u32): void {
  if (changetype<u32>(t_errorStarts) == 0) {
    t_errorStarts = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorEnds = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
  }
  if (errorCount < MAX_ERRORS) {
    t_errorStarts[errorCount] = start;
    t_errorEnds[errorCount] = end;
    errorCount++;
  }
}

@unmanaged
export class DiagnosticNode {
  next: u32;
  start: u32;
  end: u32;
}

export function pushDiagnostic(tailPtr: u32, start: u32, end: u32): u32 {
  let node = changetype<DiagnosticNode>(allocGen0(offsetof<DiagnosticNode>()));
  node.next = tailPtr;
  node.start = start;
  node.end = end;
  return changetype<u32>(node);
}

export function commitDiagnostics(tailPtr: u32): void {
  let count = 0;
  let curr = tailPtr;
  while (curr != 0 && count < MAX_ERRORS) {
    count++;
    curr = changetype<DiagnosticNode>(curr).next;
  }
  
  if (count == 0) return;

  let arr = changetype<UnmanagedUint32Array>(allocGen0(count * 4));
  curr = tailPtr;
  for (let i = count - 1; i >= 0; i--) {
    arr[i] = curr;
    curr = changetype<DiagnosticNode>(curr).next;
  }

  for (let i = 0; i < count; i++) {
    let n = changetype<DiagnosticNode>(arr[i]);
    reportGlobalError(n.start, n.end);
  }
}


export const TOKEN_EOF: i32 = 1023;
export const TOKEN_UNKNOWN: i32 = 2047;

export const ACTION_SHIFT: i32 = 0;
export const ACTION_REDUCE: i32 = 1;
export const ACTION_ACCEPT: i32 = 2;

export const NODE_TYPE_ERROR: u16 = 0;

export const CHAR_LBRACE: u8 = 123; // '{'
export const CHAR_RBRACE: u8 = 125; // '}'
export const CHAR_LBRACKET: u8 = 91; // '['
export const CHAR_RBRACKET: u8 = 93; // ']'
export const CHAR_LPAREN: u8 = 40; // '('
export const CHAR_RPAREN: u8 = 41; // ')'

export const LIST_MAX_CHILDREN: i32 = 21;
export const LIST_SPLIT_POINT: i32 = 11;

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
export let t_tokenBufferArena: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
export let t_tokenBufferLenArena: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
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
  t_tokenBufferArena[idx] = tok;
  t_tokenBufferLenArena[idx] = len;
  tokenBufferWriteIdx++;
}

/** Resets the read and write pointers of the token buffer. */
export function clearTokenBuffer(): void {
  tokenBufferWriteIdx = 0;
  tokenBufferReadIdx = 0;
}

// ----------------------------------------------------------------------------
// ----------------------------------------------------------------------------
// GSS Logic Extracted to gss.ts
// ----------------------------------------------------------------------------
export {
  t_activeHeads,
  activeHeadsCount,
  pushActiveHead,
  ParseHead,
  allocParseHead,
  ErrorBranch,
  allocErrorBranch,
  initGlobalCursor
} from "./gss";

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

@external("engine", "debugLog")
export declare function debugLog(cat: i32, val1: i32, val2: i32, val3: i32): void;
export let globalLoopGuard: u32 = 0;
export let globalBestDyingHead: u32 = 0;
export let globalToken: i32 = -1;

// ----------------------------------------------------------------------------
// GLR Execution Context

export const MODE_LR: i32 = 0;
export const MODE_GLR: i32 = 1;
export let currentParserMode: i32 = 0;
export let configEnableBranchA1: boolean = true;
export let configEnableBranchB: boolean = true;
export let configEnableBranchC: boolean = true;
export let configEnableIslandMode: boolean = true;

export let t_lrStateStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_lrNodeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let lrStackDepth: i32 = 0;
export const MAX_LR_STACK_DEPTH: i32 = 65536;
export let tempActions: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);




export let t_globalChildNodes: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
export let t_globalChildren: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);

export let globalIsCatastrophic: boolean = false;
/** Returns true if the parser encountered an unrecoverable syntax error. */
export function lsp_isCatastrophicError(): boolean {
  return globalIsCatastrophic;
}



/**
 * A bitmap of tokens that are valid transitions from the current active GLR heads.
 * Used by the language server for auto-completion triggering.
 */
export let expected_tokens: usize = 0;

/**
 * Computes the union of all valid next tokens across all currently active GSS heads.
 * Scans the action table for each active head's state.
 */

// Pre-allocated buffer for REDUCE child collection (avoids per-reduction GC allocation)
export let t_globalReduceCollected: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);


export let globalLoopIterations = 0;

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
export function testEntry(): void {
  debugLog(999, 0, 0, 0);
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
      let ah = changetype<ParseHead>(t_activeHeads[i]);
      if (ah.errorCost < bestCost) bestCost = ah.errorCost;
    }
    return bestCost;
  }
  return 0;
}

@unmanaged
export class FieldCursor {
  node: u32;
  fieldId: i32;

  offset: i32;
  indexCount: i32;
  currentIdxPtr: i32;

  stackDepth: i32;
  stack0: u32; stack1: u32; stack2: u32; stack3: u32;
  stack4: u32; stack5: u32; stack6: u32; stack7: u32;

  currentChild: u32;
  
  private cachedNext: u32;
  private hasCachedNext: boolean;
  isActive: boolean;

  @inline
  init(node: u32, fieldId: i32): void {
    this.node = node;
    this.fieldId = fieldId;
    this.hasCachedNext = false;
    this.cachedNext = 0;
    this.offset = -1;
    this.indexCount = 0;
    this.currentIdxPtr = 0;
    this.stackDepth = 0;
    this.stack0 = 0; this.stack1 = 0; this.stack2 = 0; this.stack3 = 0;
    this.stack4 = 0; this.stack5 = 0; this.stack6 = 0; this.stack7 = 0;
    this.currentChild = 0;
    this.isActive = true;
    
    if (node == 0) {
      this.offset = -1;
      return;
    }
    
    let type = getNodeType(node);
    if (type >= (type_fields.length as u16)) {
      this.offset = -1;
      return;
    }
    let offset = type_fields[type];
    if (offset == -1) {
      this.offset = -1;
      return;
    }
    
    if (offset < 0 || offset >= type_field_data.length) {
      this.offset = -1;
      return;
    }
    
    let fieldCount = type_field_data[offset];
    let currentOffset = offset + 1;
    
    for (let i = 0; i < fieldCount; i++) {
      if (currentOffset + 1 >= type_field_data.length) {
        break;
      }
      let currentFieldId = type_field_data[currentOffset];
      let indexCount = type_field_data[currentOffset + 1];
      if (currentFieldId == fieldId && indexCount > 0) {
        this.offset = currentOffset;
        this.indexCount = indexCount;
        this.currentIdxPtr = currentOffset + 2;
        return;
      }
      currentOffset += 2 + indexCount;
    }
    this.offset = -1;
  }

  @inline
  hasNext(): boolean {
    if (this.hasCachedNext) return this.cachedNext != 0;
    this.cachedNext = this._advance();
    this.hasCachedNext = true;
    return this.cachedNext != 0;
  }

  @inline
  next(): u32 {
    if (this.hasCachedNext) {
      this.hasCachedNext = false;
      return this.cachedNext;
    }
    return this._advance();
  }

  private _advance(): u32 {
    if (this.offset == -1) return 0;

    while (true) {
      if (this.currentChild != 0) {
        let child = this.currentChild;
        this.currentChild = getNodeNextSibling(child);
        
        let flags = getNodeFlags(child);
        if ((flags & FLAG_INVISIBLE) != 0) {
          if (this.currentChild != 0) {
             if (this.stackDepth < 8) {
               if (this.stackDepth == 0) this.stack0 = this.currentChild;
               else if (this.stackDepth == 1) this.stack1 = this.currentChild;
               else if (this.stackDepth == 2) this.stack2 = this.currentChild;
               else if (this.stackDepth == 3) this.stack3 = this.currentChild;
               else if (this.stackDepth == 4) this.stack4 = this.currentChild;
               else if (this.stackDepth == 5) this.stack5 = this.currentChild;
               else if (this.stackDepth == 6) this.stack6 = this.currentChild;
               else if (this.stackDepth == 7) this.stack7 = this.currentChild;
               this.stackDepth++;
             }
          }
          this.currentChild = getNodeFirstChild(child);
          continue;
        }
        return child;
      }

      if (this.stackDepth > 0) {
        this.stackDepth--;
        if (this.stackDepth == 0) this.currentChild = this.stack0;
        else if (this.stackDepth == 1) this.currentChild = this.stack1;
        else if (this.stackDepth == 2) this.currentChild = this.stack2;
        else if (this.stackDepth == 3) this.currentChild = this.stack3;
        else if (this.stackDepth == 4) this.currentChild = this.stack4;
        else if (this.stackDepth == 5) this.currentChild = this.stack5;
        else if (this.stackDepth == 6) this.currentChild = this.stack6;
        else if (this.stackDepth == 7) this.currentChild = this.stack7;
        continue;
      }

      if (this.indexCount == 0) {
        this.offset = -1;
        return 0;
      }
      
      if (this.currentIdxPtr < 0 || this.currentIdxPtr >= type_field_data.length) {
        this.offset = -1;
        return 0;
      }
      let logicalIndex = type_field_data[this.currentIdxPtr];
      this.currentIdxPtr++;
      this.indexCount--;
      
      let child = getNodeFirstChild(this.node);
      for (let i = 0; i < logicalIndex; i++) {
        if (child == 0) break;
        child = getNodeNextSibling(child);
      }
      this.currentChild = child;
    }
  }

  @inline
  release(): void {
    if (!this.isActive) return;
    this.isActive = false;
    releaseFieldCursor(this);
  }
}

const cursorPool = new Array<FieldCursor>(16);
for (let i = 0; i < 16; i++) {
  let ptr = heap.alloc(offsetof<FieldCursor>());
  let cursor = changetype<FieldCursor>(ptr);
  cursor.isActive = false;
  cursorPool[i] = cursor;
}
let cursorPoolDepth: i32 = 16;

export function getChildrenByFieldId(node: u32, fieldId: i32): FieldCursor {
  let cursor: FieldCursor;
  if (cursorPoolDepth > 0) {
    cursorPoolDepth--;
    cursor = cursorPool[cursorPoolDepth];
  } else {
    let ptr = heap.alloc(offsetof<FieldCursor>());
    cursor = changetype<FieldCursor>(ptr);
  }
  cursor.init(node, fieldId);
  return cursor;
}

export function releaseFieldCursor(cursor: FieldCursor): void {
  if (cursorPoolDepth < 16) {
    cursorPool[cursorPoolDepth] = cursor;
    cursorPoolDepth++;
  } else {
    heap.free(changetype<usize>(cursor));
  }
}

export function getChildByFieldId(ptr: u32, fieldId: i32): u32 {
  let cursor = getChildrenByFieldId(ptr, fieldId);
  let child = cursor.next();
  cursor.release();
  return child;
}

export function getFieldIdForChild(type: u16, childIndex: u16): i32 {
  if (type >= (type_fields.length as u16)) return -1;
  let offset = type_fields[type];
  if (offset == -1 || offset < 0 || offset >= type_field_data.length) return -1;
  let fieldCount = type_field_data[offset];
  let currentOffset = offset + 1;
  for (let i = 0; i < fieldCount; i++) {
    if (currentOffset + 1 >= type_field_data.length) break;
    let currentFieldId = type_field_data[currentOffset];
    let indexCount = type_field_data[currentOffset + 1];
    let idxPtr = currentOffset + 2;
    for (let j = 0; j < indexCount; j++) {
      if (idxPtr >= type_field_data.length) break;
      if (type_field_data[idxPtr] == (childIndex as i32)) return currentFieldId;
      idxPtr++;
    }
    currentOffset += 2 + indexCount;
  }
  return -1;
}

@unmanaged
export class AncestorCursor {
  pathStack: u32; 
  pathLength: i32;
  currentIndex: i32;
  isActive: boolean;
  filterType: u16;
  
  @inline init(targetNode: u32, stopAtType: u16, rootNode: u32): void {
     this.filterType = stopAtType;
     this.pathLength = 0;
     this.currentIndex = -1;
     this.isActive = true;
     
     if (targetNode == rootNode || rootNode == 0) return;
     
     // Iterative DFS to find targetNode
     let stack = this.pathStack; 
     let stackDepth = 0;
     let current = rootNode;
     
     while (current != 0) {
         if (current == targetNode) {
             this.pathLength = stackDepth;
             this.currentIndex = stackDepth - 1;
             return;
         }
         let child = getNodeFirstChild(current);
         if (child != 0) {
             if (stackDepth < 256) {
                 store<u32>(stack + (stackDepth << 2), current);
                 stackDepth++;
             }
             current = child;
             continue;
         }
         let sibling = getNodeNextSibling(current);
         if (sibling != 0) {
             current = sibling;
             continue;
         }
         let foundSibling = false;
         while (stackDepth > 0) {
             stackDepth--;
             let parent = load<u32>(stack + (stackDepth << 2));
             let psib = getNodeNextSibling(parent);
             if (psib != 0) {
                 current = psib;
                 foundSibling = true;
                 break;
             }
         }
         if (!foundSibling) current = 0;
     }
  }

  @inline hasNext(): boolean {
     while (this.currentIndex >= 0) {
         let n = load<u32>(this.pathStack + (this.currentIndex << 2));
         if (this.filterType == 0xFFFF || getNodeType(n) == this.filterType) {
             return true;
         }
         this.currentIndex--;
     }
     return false;
  }
  
  @inline next(): u32 {
     let n = load<u32>(this.pathStack + (this.currentIndex << 2));
     this.currentIndex--;
     return n;
  }

  @inline release(): void {
     if (!this.isActive) return;
     this.isActive = false;
     releaseAncestorCursor(this);
  }
}

const ancestorCursorPool = new Array<AncestorCursor>(16);
let ancestorCursorPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
  let ptr = heap.alloc(offsetof<AncestorCursor>());
  let cursor = changetype<AncestorCursor>(ptr);
  cursor.isActive = false;
  cursor.pathStack = heap.alloc(256 * 4) as u32;
  ancestorCursorPool[i] = cursor;
}

export function getAncestors(node: u32, filterType: u16, rootNode: u32): AncestorCursor {
  let cursor: AncestorCursor;
  if (ancestorCursorPoolDepth > 0) {
    ancestorCursorPoolDepth--;
    cursor = ancestorCursorPool[ancestorCursorPoolDepth];
  } else {
    let ptr = heap.alloc(offsetof<AncestorCursor>());
    cursor = changetype<AncestorCursor>(ptr);
    cursor.pathStack = heap.alloc(256 * 4) as u32;
  }
  cursor.init(node, filterType, rootNode);
  return cursor;
}

export function releaseAncestorCursor(cursor: AncestorCursor): void {
  if (ancestorCursorPoolDepth < 16) {
    ancestorCursorPool[ancestorCursorPoolDepth] = cursor;
    ancestorCursorPoolDepth++;
  } else {
    heap.free(cursor.pathStack as usize);
    heap.free(changetype<usize>(cursor));
  }
}


@unmanaged
export class DescendantCursor {
  stack: u32;
  stackDepth: i32;
  current: u32;
  isActive: boolean;
  filterType: u16;

  @inline init(root: u32, filterType: u16): void {
     this.filterType = filterType;
     this.stackDepth = 0;
     this.current = getNodeFirstChild(root);
     this.isActive = true;
  }
  
  @inline hasNext(): boolean {
     while (this.current != 0) {
         if (this.filterType == 0xFFFF || getNodeType(this.current) == this.filterType) {
             return true;
         }
         this.advance();
     }
     return false;
  }
  
  @inline next(): u32 {
     let n = this.current;
     this.advance();
     return n;
  }

  @inline advance(): void {
     let child = getNodeFirstChild(this.current);
     if (child != 0) {
         if (this.stackDepth < 256) {
             store<u32>(this.stack + (this.stackDepth << 2), this.current);
             this.stackDepth++;
         }
         this.current = child;
         return;
     }
     let sibling = getNodeNextSibling(this.current);
     if (sibling != 0) {
         this.current = sibling;
         return;
     }
     while (this.stackDepth > 0) {
         this.stackDepth--;
         let parent = load<u32>(this.stack + (this.stackDepth << 2));
         let psib = getNodeNextSibling(parent);
         if (psib != 0) {
             this.current = psib;
             return;
         }
     }
     this.current = 0;
  }
  
  @inline release(): void {
     if (!this.isActive) return;
     this.isActive = false;
     releaseDescendantCursor(this);
  }
}

const descendantCursorPool = new Array<DescendantCursor>(16);
let descendantCursorPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
  let ptr = heap.alloc(offsetof<DescendantCursor>());
  let cursor = changetype<DescendantCursor>(ptr);
  cursor.isActive = false;
  cursor.stack = heap.alloc(256 * 4) as u32;
  descendantCursorPool[i] = cursor;
}

export function getDescendants(node: u32, filterType: u16): DescendantCursor {
  let cursor: DescendantCursor;
  if (descendantCursorPoolDepth > 0) {
    descendantCursorPoolDepth--;
    cursor = descendantCursorPool[descendantCursorPoolDepth];
  } else {
    let ptr = heap.alloc(offsetof<DescendantCursor>());
    cursor = changetype<DescendantCursor>(ptr);
    cursor.stack = heap.alloc(256 * 4) as u32;
  }
  cursor.init(node, filterType);
  return cursor;
}

export function releaseDescendantCursor(cursor: DescendantCursor): void {
  if (descendantCursorPoolDepth < 16) {
    descendantCursorPool[descendantCursorPoolDepth] = cursor;
    descendantCursorPoolDepth++;
  } else {
    heap.free(cursor.stack as usize);
    heap.free(changetype<usize>(cursor));
  }
}


@unmanaged
export class SemanticCursor {
  currentChild: u32;
  isActive: boolean;
  
  @inline init(node: u32): void {
     this.currentChild = getNodeFirstChild(node);
     this.isActive = true;
  }
  
  @inline hasNext(): boolean {
     return this.currentChild != 0;
  }
  
  @inline next(): u32 {
     let c = this.currentChild;
     this.currentChild = getNodeNextSibling(c);
     return c;
  }
  
  @inline release(): void {
     if (!this.isActive) return;
     this.isActive = false;
     releaseSemanticCursor(this);
  }
}

const semanticCursorPool = new Array<SemanticCursor>(16);
let semanticCursorPoolDepth: i32 = 16;
for (let i = 0; i < 16; i++) {
  let ptr = heap.alloc(offsetof<SemanticCursor>());
  let cursor = changetype<SemanticCursor>(ptr);
  cursor.isActive = false;
  semanticCursorPool[i] = cursor;
}

export function getSemanticChildren(node: u32): SemanticCursor {
  let cursor: SemanticCursor;
  if (semanticCursorPoolDepth > 0) {
    semanticCursorPoolDepth--;
    cursor = semanticCursorPool[semanticCursorPoolDepth];
  } else {
    let ptr = heap.alloc(offsetof<SemanticCursor>());
    cursor = changetype<SemanticCursor>(ptr);
  }
  cursor.init(node);
  return cursor;
}

export function releaseSemanticCursor(cursor: SemanticCursor): void {
  if (semanticCursorPoolDepth < 16) {
    semanticCursorPool[semanticCursorPoolDepth] = cursor;
    semanticCursorPoolDepth++;
  } else {
    heap.free(changetype<usize>(cursor));
  }
}

export function getPathTokens(node: u32): DescendantCursor {
  // PathTokens is essentially a DescendantCursor filtering for all terminal nodes. 
  // In our engine, MAX_TERMINAL_ID defines terminals, but we can't easily filter by "isTerminal" 
  // inside DescendantCursor. We can let the user filter, or we can just yield all descendants.
  // We'll yield all descendants and let the caller handle it.
  return getDescendants(node, 0xFFFF);
}


import { inputLength, setInputLength, inputEncoding, setInputEncoding, MAX_TERMINAL_ID, logInt } from "./parser";
export { inputLength, setInputLength, inputEncoding, setInputEncoding, MAX_TERMINAL_ID };

export function lsp_setInputLength(len: u32): void {
  setInputLength(len);
}
export function lsp_setInputEncoding(encoding: u8): void {
  setInputEncoding(encoding);
}





