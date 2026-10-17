// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
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
  FLAG_IS_INSERTED,
  FLAG_LSP_VISITED,
  getNodeByteLength,
  getNodeEnvHash,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeLeadingPad,
  getNodeType,
  initArena,
  resetGeneration,
  S,
  setFirstChild,
  setNextSibling,
  setNodeByteLength,
  setNodeFlags,
  setNodePadding,
} from "../arena";
import { ChunkedUint32Array, UnmanagedInt32Array, UnmanagedUint32Array, UnmanagedUint16Array, UnmanagedUint8Array, createChunkedUint32Array } from "../core/array";
import { initQueryArena, resetQueryArena, clearDiagnostics } from "../graph";
import {
  action_data as _action_data,
  action_offsets as _action_offsets,
  action_entry_offsets as _action_entry_offsets,
  action_entry_data as _action_entry_data,
  token_bracket_deltas as _token_bracket_deltas,
  open_bracket_chars as _open_bracket_chars,
  close_bracket_chars as _close_bracket_chars,
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
  prod_right_offsets as _prod_right_offsets,
  prod_right_symbols as _prod_right_symbols,
  token_insert_costs as _token_insert_costs,
  token_delete_costs as _token_delete_costs,
  token_is_word as _token_is_word,
  reachability_matrix as _reachability_matrix,
  precomputed_repairs as _precomputed_repairs,
  token_string_offsets as _token_string_offsets,
  token_string_bytes as _token_string_bytes,
  type_fields as _type_fields,
  type_field_data as _type_field_data,
  type_is_list as _type_is_list,
  expected_tokens,
  currentScannerState,
  initExtras,
  inputLength,
  is_extra_token,
  invokeLexer,
  MAX_TERMINAL_ID,
  MAX_FIELD_CURSOR_DEPTH,
  lexLen,
  lexPos,
  setCurrentScannerState,
  setLexLen,
  setLexPos,
  setSrcLexPos,
  srcLexPos,
} from "../parser";
import { ParseHead, activeHeadsCount, t_activeHeads, resetFrontierSummary, t_activeSummary, t_nextSummary, globalCursorDepth, cursorNodeStack } from "./gss";
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


/**
 * Zero-allocation static wrapper for baked WASM memory tables.
 * Used to directly read arrays exported by the `wabt` C-backend without instantiating Array objects.
 */
@unmanaged
class StaticTable {
  /** Reads a 32-bit integer at the given logical index. */
  @inline @operator("[]") get(index: i32): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    let len = load<i32>(ptr - 4);
    if (index < 0 || index >= len) {
      return 0;
    }
    return load<i32>(ptr + ((index as usize) << 2));
  }
  /** Retrieves the encoded array length from the preceding 4-byte header. */
  @inline get length(): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    return load<i32>(ptr - 4);
  }
}

@unmanaged
class StaticU16Table {
  /** Reads a 16-bit unsigned integer at the given logical index. */
  @inline @operator("[]") get(index: i32): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    let len = load<i32>(ptr - 4);
    if (index < 0 || index >= len) {
      return 0;
    }
    return load<u16>(ptr + ((index as usize) << 1)) as i32;
  }
  @inline get length(): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    return load<i32>(ptr - 4);
  }
}

@unmanaged
class StaticByteTable {
  /** Reads an 8-bit unsigned integer at the given logical index. */
  @inline @operator("[]") get(index: i32): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    let len = load<i32>(ptr - 4);
    if (index < 0 || index >= len) {
      return 0;
    }
    return load<u8>(ptr + (index as usize)) as i32;
  }
  @inline get length(): i32 {
    let ptr = changetype<usize>(this);
    if (ptr < 4) return 0;
    return load<i32>(ptr - 4);
  }
}

export let action_offsets: StaticTable = changetype<StaticTable>(0);
export let action_data: StaticTable = changetype<StaticTable>(0);
export let action_entry_offsets: StaticTable = changetype<StaticTable>(0);
export let action_entry_data: StaticTable = changetype<StaticTable>(0);
export let token_bracket_deltas: StaticTable = changetype<StaticTable>(0);
export let open_bracket_chars: StaticTable = changetype<StaticTable>(0);
export let close_bracket_chars: StaticTable = changetype<StaticTable>(0);
export let goto_offsets: StaticTable = changetype<StaticTable>(0);
export let goto_data: StaticTable = changetype<StaticTable>(0);
export let mrd_data: StaticByteTable = changetype<StaticByteTable>(0);
export let token_insert_costs: StaticByteTable = changetype<StaticByteTable>(0);
export let token_delete_costs: StaticU16Table = changetype<StaticU16Table>(0);
export let token_is_word: StaticByteTable = changetype<StaticByteTable>(0);
export let reachability_matrix: StaticByteTable = changetype<StaticByteTable>(0);
export let precomputed_repairs: StaticU16Table = changetype<StaticU16Table>(0);
export let token_string_offsets: StaticTable = changetype<StaticTable>(0);
export let token_string_bytes: StaticTable = changetype<StaticTable>(0);

export let prod_lengths: StaticByteTable = changetype<StaticByteTable>(0);
export let prod_right_offsets: StaticTable = changetype<StaticTable>(0);
export let prod_right_symbols: StaticU16Table = changetype<StaticU16Table>(0);
export let prod_lhs: StaticU16Table = changetype<StaticU16Table>(0);
export let prod_is_invisible: StaticByteTable = changetype<StaticByteTable>(0);
export let prod_is_list: StaticByteTable = changetype<StaticByteTable>(0);
export let prod_dynamic_prec: StaticTable = changetype<StaticTable>(0);
export let prod_aliases: StaticTable = changetype<StaticTable>(0);
export let alias_data: StaticTable = changetype<StaticTable>(0);
export let type_fields: StaticTable = changetype<StaticTable>(0);
export let type_field_data: StaticTable = changetype<StaticTable>(0);
export let type_is_list: StaticByteTable = changetype<StaticByteTable>(0);

export function initStaticTables(): void {
  action_offsets = changetype<StaticTable>(_action_offsets);
  action_data = changetype<StaticTable>(_action_data);
  action_entry_offsets = changetype<StaticTable>(_action_entry_offsets);
  action_entry_data = changetype<StaticTable>(_action_entry_data);
  token_bracket_deltas = changetype<StaticTable>(_token_bracket_deltas);
  open_bracket_chars = changetype<StaticTable>(_open_bracket_chars);
  close_bracket_chars = changetype<StaticTable>(_close_bracket_chars);
  goto_offsets = changetype<StaticTable>(_goto_offsets);
  goto_data = changetype<StaticTable>(_goto_data);
  mrd_data = changetype<StaticByteTable>(_mrd_data);
  token_insert_costs = changetype<StaticByteTable>(_token_insert_costs);
  token_delete_costs = changetype<StaticU16Table>(_token_delete_costs);
  token_is_word = changetype<StaticByteTable>(_token_is_word);
  reachability_matrix = changetype<StaticByteTable>(_reachability_matrix);
  precomputed_repairs = changetype<StaticU16Table>(_precomputed_repairs);
  token_string_offsets = changetype<StaticTable>(_token_string_offsets);
  token_string_bytes = changetype<StaticTable>(_token_string_bytes);
  prod_lengths = changetype<StaticByteTable>(_prod_lengths);
  prod_right_offsets = changetype<StaticTable>(_prod_right_offsets);
  prod_right_symbols = changetype<StaticU16Table>(_prod_right_symbols);
  prod_lhs = changetype<StaticU16Table>(_prod_lhs);
  prod_is_invisible = changetype<StaticByteTable>(_prod_is_invisible);
  prod_is_list = changetype<StaticByteTable>(_prod_is_list);
  prod_dynamic_prec = changetype<StaticTable>(_prod_dynamic_prec);
  prod_aliases = changetype<StaticTable>(_prod_aliases);
  alias_data = changetype<StaticTable>(_alias_data);
  type_fields = changetype<StaticTable>(_type_fields);
  type_field_data = changetype<StaticTable>(_type_field_data);
  type_is_list = changetype<StaticByteTable>(_type_is_list);
}

/**
 * Checks whether `tok` is reachable at distance 0 from `state` in the bit-packed `reachability_matrix`.
 * Each bit `idx = state * (MAX_TERMINAL_ID + 1) + tok` is 1 iff `tok` is reachable at distance 0.
 */
@inline
export function isReachableZeroDist(state: i32, tok: i32): boolean {
  if (state < 0 || tok <= 0 || tok > MAX_TERMINAL_ID) return false;
  let idx = state * (MAX_TERMINAL_ID + 1) + tok;
  let byteIdx = idx >> 3;
  if (byteIdx < 0 || byteIdx >= reachability_matrix.length) return false;
  return (reachability_matrix[byteIdx] & (1 << (idx & 7))) != 0;
}

/**
 * Looks up the GOTO target state for `(state, lhs)` in `goto_data`.
 * Since `goto_data` entries per state are sorted by `symId`, uses binary search
 * when `gCount > 8` and an early-exiting linear scan for small tables.
 * Returns -1 if no transition exists.
 */
export function lookupGoto(state: i32, lhs: i32): i32 {
  if (state < 0 || state >= goto_offsets.length) return -1;
  let gOffset = goto_offsets[state];
  if (gOffset < 0 || gOffset >= goto_data.length) return -1;
  let gCount = goto_data[gOffset];
  if (gCount <= 0) return -1;
  let base = gOffset + 1;
  if (gCount <= 8) {
    for (let k = 0; k < gCount; k++) {
      let sym = goto_data[base];
      if (sym == lhs) return goto_data[base + 1];
      if (sym > lhs) return -1;
      base += 2;
    }
    return -1;
  }
  let low = 0;
  let high = gCount - 1;
  while (low <= high) {
    let mid = (low + high) >> 1;
    let idx = base + (mid << 1);
    let sym = goto_data[idx];
    if (sym == lhs) {
      return goto_data[idx + 1];
    } else if (sym < lhs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return -1;
}



// GSS Head Structure (Simplified LR stack for this skeleton)


// ----------------------------------------------------------------------------
// Diagnostics & Error Reporting
// ----------------------------------------------------------------------------
export let errorCount: i32 = 0;
export let t_errorStarts: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorEnds: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorArg0: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorArg1: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorArg2: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_errorArg3: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);

export const MAX_ERRORS: i32 = 10000;
export const MAX_PARALLEL_HEADS: u32 = 32;
const MAX_CURSOR_DEPTH: i32 = 999999;
export const INFINITE_COST: i32 = 999999;
const MAX_UPWARD_STEPS: i32 = 100000;
export const MAX_CHILD_NODES: i32 = 100000;
export const MIN_LOOP_LIMIT: u32 = 10000;
export const ARENA_BUFFER_SIZE: i32 = 16384;
export const MAX_LOOKAHEAD_DEPTH: i32 = 6;
export const MAX_AST_TRAVERSAL_DEPTH: u32 = 100;
export const LOOP_MULTIPLIER_LIMIT: u32 = 50;
export const MAX_PANIC_SCAN_TOKENS: u32 = 500;

export const PENALTY_UNWIND_NODE: i32 = 500;
export const PENALTY_SYNC_TOKEN: i32 = 50;

/**
 * Retrieves the start byte offset of a reported syntax error by index.
 */
export function getErrorStart(index: i32): u32 {
  if (index < 0 || index >= errorCount) return 0;
  return t_errorStarts[index];
}

/**
 * Retrieves the end byte offset of a reported syntax error by index.
 */
export function getErrorEnd(index: i32): u32 {
  if (index < 0 || index >= errorCount) return 0;
  return t_errorEnds[index];
}

/**
 * Registers an error span during the parse phase.
 * @param start The absolute byte offset of the syntax error start.
 * @param end The absolute byte offset of the syntax error end.
 */
export function reportGlobalError(start: u32, end: u32, arg0: u32 = 0, arg1: u32 = 0, arg2: u32 = 0, arg3: u32 = 0): void {
  if (changetype<u32>(t_errorStarts) == 0) {
    t_errorStarts = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorEnds = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorArg0 = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorArg1 = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorArg2 = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
    t_errorArg3 = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_ERRORS * 4));
  }
  if (errorCount < MAX_ERRORS) {
    t_errorStarts[errorCount] = start;
    t_errorEnds[errorCount] = end;
    t_errorArg0[errorCount] = arg0;
    t_errorArg1[errorCount] = arg1;
    t_errorArg2[errorCount] = arg2;
    t_errorArg3[errorCount] = arg3;
    errorCount++;
  }
}

@unmanaged
export class DiagnosticNode {
  next: u32;
  start: u32;
  end: u32;
  tokenType: u32;
  arg0: u32;
  arg1: u32;
  arg2: u32;
}

export function pushDiagnostic(
  tailPtr: u32,
  start: u32,
  end: u32,
  tokenType: u32 = 0,
  arg0: u32 = 0,
  arg1: u32 = 0,
  arg2: u32 = 0
): u32 {
  let node = changetype<DiagnosticNode>(allocGen0(offsetof<DiagnosticNode>()));
  node.next = tailPtr;
  node.start = start;
  node.end = end;
  node.tokenType = tokenType;
  node.arg0 = arg0;
  node.arg1 = arg1;
  node.arg2 = arg2;
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
    reportGlobalError(n.start, n.end, n.arg0, n.tokenType, n.arg1, n.arg2);
  }
}

export let t_diagExpectedPool: UnmanagedUint16Array = changetype<UnmanagedUint16Array>(0);
export let t_diagExpectedPoolCapacity: u32 = 0;
export let t_diagExpectedPoolLen: u32 = 0;

let t_diagExpectedBitset: UnmanagedUint8Array = changetype<UnmanagedUint8Array>(0);
let t_diagExpectedBitsetCap: u32 = 0;
let t_diagVisitedStates: UnmanagedUint8Array = changetype<UnmanagedUint8Array>(0);
let t_diagVisitedStatesCap: u32 = 0;
let t_stateExpectedCache: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_stateExpectedCacheCap: u32 = 0;
let g_crawlSawEof: bool = false;

export function getExpectedTokensPoolPtr(): u32 {
  if (changetype<usize>(t_diagExpectedPool) == 0) {
    t_diagExpectedPoolCapacity = 8192;
    let ptr = atomicChunkAlloc(t_diagExpectedPoolCapacity * 2);
    t_diagExpectedPool = changetype<UnmanagedUint16Array>(ptr);
  }
  return changetype<u32>(t_diagExpectedPool);
}

export function getExpectedTokensPoolLen(): u32 {
  return t_diagExpectedPoolLen;
}

export function resetExpectedTokensPool(): void {
  // Static grammar expected-token sets are invariant across parses; keep cache warm.
}

function ensureExpectedPoolCapacity(required: u32): void {
  if (required <= t_diagExpectedPoolCapacity) return;
  let newCap: u32 = t_diagExpectedPoolCapacity == 0 ? 8192 : t_diagExpectedPoolCapacity * 2;
  while (newCap < required) newCap *= 2;
  let newPtr = atomicChunkAlloc(newCap * 2);
  if (t_diagExpectedPoolLen > 0 && changetype<usize>(t_diagExpectedPool) != 0) {
    memory.copy(newPtr, changetype<usize>(t_diagExpectedPool), t_diagExpectedPoolLen * 2);
  }
  t_diagExpectedPool = changetype<UnmanagedUint16Array>(newPtr);
  t_diagExpectedPoolCapacity = newCap;
}

function crawlStateExpectedTokens(state: i32, depth: i32): void {
  if (depth > 4 || state < 0 || state >= action_offsets.length || state >= goto_offsets.length) return;
  if ((state as u32) < t_diagVisitedStatesCap) {
    let depthCode: u8 = (depth + 1) as u8;
    let prev = t_diagVisitedStates[state];
    if (prev != 0 && prev <= depthCode) return;
    t_diagVisitedStates[state] = depthCode;
  }
  let gOffset = action_offsets[state];
  if (gOffset < 0 || gOffset >= action_data.length) return;
  let actionCount = action_data[gOffset];
  let idx = gOffset + 1;

  for (let j = 0; j < actionCount; j++) {
    let sym = action_data[idx++];
    let actCount = action_data[idx++];
    if (sym == TOKEN_EOF) {
      g_crawlSawEof = true;
    } else if (sym > 0 && sym <= (MAX_TERMINAL_ID as i32)) {
      if ((sym as u32) < t_diagExpectedBitsetCap) {
        t_diagExpectedBitset[sym] = 1;
      }
    }
    for (let na = 0; na < actCount; na++) {
      let aType = action_data[idx + na * 2];
      let aTarget = action_data[idx + na * 2 + 1];
      if (aType == ACTION_REDUCE && aTarget >= 0 && aTarget < prod_lhs.length && prod_lengths[aTarget] == 0) {
        let lhs = prod_lhs[aTarget];
        let nextSt = lookupGoto(state, lhs);
        if (nextSt != -1) {
          crawlStateExpectedTokens(nextSt, depth + 1);
        }
      }
    }
    idx += actCount * 2;
  }
}

export function getExpectedTokensForState(state: i32, depth: i32 = 0): u64 {
  if (state < 0 || state >= action_offsets.length) return 0;

  let numStates = action_offsets.length as u32;
  if (changetype<usize>(t_stateExpectedCache) == 0 || t_stateExpectedCacheCap < numStates) {
    t_stateExpectedCacheCap = numStates;
    t_stateExpectedCache = changetype<UnmanagedUint32Array>(atomicChunkAlloc(numStates * 8));
    memory.fill(changetype<usize>(t_stateExpectedCache), 0xff, numStates * 8);
  }
  let cacheIdx = (state as u32) * 2;
  let cachedStart = t_stateExpectedCache[cacheIdx];
  if (cachedStart != 0xffffffff) {
    let cachedCount = t_stateExpectedCache[cacheIdx + 1] & 0x7fffffff;
    return (cachedStart as u64) | ((cachedCount as u64) << 32);
  }

  if (changetype<usize>(t_diagExpectedPool) == 0) {
    t_diagExpectedPoolCapacity = 8192;
    t_diagExpectedPool = changetype<UnmanagedUint16Array>(atomicChunkAlloc(t_diagExpectedPoolCapacity * 2));
  }
  let maxSym = (MAX_TERMINAL_ID as u32) + 1;
  if (changetype<usize>(t_diagExpectedBitset) == 0 || t_diagExpectedBitsetCap < maxSym) {
    t_diagExpectedBitsetCap = maxSym < 2048 ? 2048 : maxSym;
    t_diagExpectedBitset = changetype<UnmanagedUint8Array>(atomicChunkAlloc(t_diagExpectedBitsetCap));
  }
  if (changetype<usize>(t_diagVisitedStates) == 0 || t_diagVisitedStatesCap < numStates) {
    t_diagVisitedStatesCap = numStates < 2048 ? 2048 : numStates;
    t_diagVisitedStates = changetype<UnmanagedUint8Array>(atomicChunkAlloc(t_diagVisitedStatesCap));
  }

  memory.fill(changetype<usize>(t_diagExpectedBitset), 0, maxSym);
  memory.fill(changetype<usize>(t_diagVisitedStates), 0, numStates);
  g_crawlSawEof = false;

  crawlStateExpectedTokens(state, 0);

  ensureExpectedPoolCapacity(t_diagExpectedPoolLen + maxSym);
  let poolStart = t_diagExpectedPoolLen;

  // Pass 1: Words & identifiers first
  for (let s: i32 = 1; s < (maxSym as i32); s++) {
    if (t_diagExpectedBitset[s] == 1) {
      let isWord = token_is_word.length > s && token_is_word[s] == 1;
      if (isWord) {
        t_diagExpectedPool[t_diagExpectedPoolLen++] = s as u16;
      }
    }
  }

  // Pass 2: Delimiters, operators, and symbols
  for (let s: i32 = 1; s < (maxSym as i32); s++) {
    if (t_diagExpectedBitset[s] == 1) {
      let isWord = token_is_word.length > s && token_is_word[s] == 1;
      if (!isWord) {
        t_diagExpectedPool[t_diagExpectedPoolLen++] = s as u16;
      }
    }
  }

  let poolCount = t_diagExpectedPoolLen - poolStart;
  t_stateExpectedCache[cacheIdx] = poolStart;
  t_stateExpectedCache[cacheIdx + 1] = poolCount | (g_crawlSawEof ? 0x80000000 : 0);
  return (poolStart as u64) | ((poolCount as u64) << 32);
}

export function populateStateExpectedTokens(state: i32, expectedTokensPtr: usize): void {
  if (state < 0 || state >= action_offsets.length || expectedTokensPtr == 0) return;
  let packed = getExpectedTokensForState(state, 0);
  let poolStart = (packed & 0xffffffff) as u32;
  let poolCount = (packed >> 32) as u32;
  let rawCount = t_stateExpectedCache[(state as u32) * 2 + 1];
  if ((rawCount & 0x80000000) != 0) {
    store<u8>(expectedTokensPtr + (TOKEN_EOF as usize), 1);
  }
  let poolPtr = changetype<usize>(t_diagExpectedPool);
  for (let i: u32 = 0; i < poolCount; i++) {
    let sym = load<u16>(poolPtr + ((poolStart + i) << 1)) as usize;
    store<u8>(expectedTokensPtr + sym, 1);
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

@inline
export function isOpenBracketChar(c: i32): bool {
  if (changetype<usize>(open_bracket_chars) != 0) {
    let len = open_bracket_chars.length;
    for (let i = 0; i < len; i++) {
      if (open_bracket_chars[i] == c) return true;
    }
    return false;
  }
  return c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN;
}

@inline
export function isCloseBracketChar(c: i32): bool {
  if (changetype<usize>(close_bracket_chars) != 0) {
    let len = close_bracket_chars.length;
    for (let i = 0; i < len; i++) {
      if (close_bracket_chars[i] == c) return true;
    }
    return false;
  }
  return c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN;
}

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

// ----------------------------------------------------------------------------
// GSS Logic Extracted to gss.ts
// ----------------------------------------------------------------------------
export {
  t_activeHeads,
  activeHeadsCount,
  pushActiveHead,
  ParseHead,
  allocParseHead,
  initGlobalCursor
} from "./gss";

@external("engine", "debugLog")
export declare function debugLog(cat: i32, val1: i32, val2: i32, val3: i32): void;
export let globalBestDyingHead: u32 = 0;
export let globalToken: i32 = -1;

// ----------------------------------------------------------------------------
// GLR Execution Context

export const MODE_LR: i32 = 0;
export const MODE_GLR: i32 = 1;
export let currentParserMode: i32 = 0;
export let configEnableBranchA1: boolean = true;
export let configEnableBranchB: boolean = true;
export let configEnableMultiFile: boolean = false;

export function lsp_setConfigEnableMultiFile(val: boolean): void {
  configEnableMultiFile = val;
}

export let t_lrStateStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_lrNodeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_lrScannerStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
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
export { expected_tokens };

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
  initStaticTables();
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
}


export function resetParser(): void {
  resetGeneration(1);
  resetGeneration(0);
  activeHeadsCount = 0;
  lexPos = 0;
  lexLen = 0;
  errorCount = 0;
  resetExpectedTokensPool();
  resetCursorPool();
  resetFrontierSummary(t_activeSummary);
  resetFrontierSummary(t_nextSummary);
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

  currentChild: u32;
  currentChildIdx: i32;

  frameDepth: i32;
  stackPtr: usize;
  private cachedNext: u32;
  private hasCachedNext: boolean;
  isActive: boolean;

  @inline
  pushFrame(node: u32, offset: i32, count: i32, ptr: i32): void {
    if (this.frameDepth < MAX_FIELD_CURSOR_DEPTH) {
      let base = this.stackPtr + ((this.frameDepth as usize) << 5);
      store<u32>(base, node);
      store<i32>(base + 4, offset);
      store<i32>(base + 8, count);
      store<i32>(base + 12, ptr);
      store<u32>(base + 16, this.currentChild);
      store<i32>(base + 20, this.currentChildIdx);
      this.frameDepth++;
    }
  }

  @inline
  popFrame(): void {
    if (this.frameDepth > 0) {
      this.frameDepth--;
      let base = this.stackPtr + ((this.frameDepth as usize) << 5);
      this.node = load<u32>(base);
      this.offset = load<i32>(base + 4);
      this.indexCount = load<i32>(base + 8);
      this.currentIdxPtr = load<i32>(base + 12);
      this.currentChild = load<u32>(base + 16);
      this.currentChildIdx = load<i32>(base + 20);
    }
  }

  @inline
  init(node: u32, fieldId: i32): void {
    if (this.stackPtr == 0) {
      this.stackPtr = atomicChunkAlloc(64 << 5) as usize;
    }
    this.node = node;
    this.fieldId = fieldId;
    this.hasCachedNext = false;
    this.cachedNext = 0;
    this.offset = -1;
    this.indexCount = 0;
    this.currentIdxPtr = 0;
    this.currentChild = node != 0 ? getNodeFirstChild(node) : 0;
    this.currentChildIdx = 0;
    this.frameDepth = 0;
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
      currentOffset += 2 + (indexCount * 2);
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
    while (true) {
      if (this.indexCount == 0) {
        if (this.frameDepth > 0) {
          this.popFrame();
          continue;
        }
        this.offset = -1;
        return 0;
      }

      if (this.currentIdxPtr < 0 || this.currentIdxPtr >= type_field_data.length) {
        this.offset = -1;
        return 0;
      }

      let rawIndex = type_field_data[this.currentIdxPtr];
      let expectedType = type_field_data[this.currentIdxPtr + 1] as u16;
      this.currentIdxPtr += 2;
      this.indexCount--;

      let isSyntheticField = (rawIndex & 0x8000) != 0;
      let logicalIndex = rawIndex & 0x7fff;
      let targetIdx = logicalIndex;
      
      if (targetIdx < this.currentChildIdx) {
        this.currentChild = getNodeFirstChild(this.node);
        this.currentChildIdx = 0;
      }

      while (this.currentChild != 0) {
        let childType = getNodeType(this.currentChild);
        if (childType == NODE_TYPE_ERROR || childType == 0) {
          this.currentChild = getNodeNextSibling(this.currentChild);
          continue;
        }
        if (this.currentChildIdx == targetIdx) break;
        this.currentChildIdx++;
        this.currentChild = getNodeNextSibling(this.currentChild);
      }

      let child = this.currentChild;
      if (child != 0) {
        this.currentChildIdx++;
        this.currentChild = getNodeNextSibling(this.currentChild);
      }

      if (child == 0) continue;

      let rawChildType = getNodeType(child);
      if (!isSyntheticField) {
        while (child != 0 && ((getNodeFlags(child) & FLAG_IS_LIST) != 0 || getNodeType(child) == 0)) {
          let first = getNodeFirstChild(child);
          if (first != 0 && getNodeType(first) != NODE_TYPE_ERROR) {
            child = first;
          } else {
            break;
          }
        }
      }

      if (isSyntheticField) {
        if (this.frameDepth < MAX_FIELD_CURSOR_DEPTH) {
          this.pushFrame(this.node, this.offset, this.indexCount, this.currentIdxPtr);

          this.node = child;
          this.offset = -1;
          this.indexCount = 0;
          this.currentChild = getNodeFirstChild(child);
          this.currentChildIdx = 0;
          
          let type = getNodeType(child);
          if (type < (type_fields.length as u16)) {
            let offset = type_fields[type];
            if (offset != -1 && offset >= 0 && offset < type_field_data.length) {
              let fieldCount = type_field_data[offset];
              let currentOffset = offset + 1;
              for (let i = 0; i < fieldCount; i++) {
                if (currentOffset + 1 >= type_field_data.length) break;
                let currentFieldId = type_field_data[currentOffset];
                let indexCount = type_field_data[currentOffset + 1];
                if (currentFieldId == this.fieldId && indexCount > 0) {
                  this.offset = currentOffset;
                  this.indexCount = indexCount;
                  this.currentIdxPtr = currentOffset + 2;
                  break;
                }
                currentOffset += 2 + (indexCount * 2);
              }
            }
          }
        }
        continue;
      }
      if (child != 0 && (getNodeFlags(child) & FLAG_HAS_ERROR) != 0) {
        let inner = getNodeFirstChild(child);
        if (inner != 0 && getNodeType(inner) == getNodeType(child)) {
          return inner;
        }
      }
      // Unwrap any invisible synthetic wrapper node down to the real child
      while (child != 0 && (getNodeFlags(child) & FLAG_INVISIBLE) != 0 && (getNodeFlags(child) & FLAG_IS_INSERTED) == 0) {
        let first = getNodeFirstChild(child);
        if (first != 0) {
          child = first;
        } else {
          break;
        }
      }
      // If child is an empty epsilon node (0 length, no children, not inserted by recovery), it is absent
      if (child != 0 && (getNodeFlags(child) & FLAG_IS_INSERTED) == 0 && getNodeByteLength(child) == 0 && getNodeFirstChild(child) == 0) {
        continue;
      }
      if (expectedType != 0 && rawChildType != expectedType && getNodeType(child) != expectedType) {
        continue;
      }
      return child;
    }
    return 0;
  }

  @inline
  release(): void {
    if (!this.isActive) return;
    this.isActive = false;
    releaseFieldCursor(this);
  }
}

let cursorPoolInitialized: boolean = false;
const CURSOR_POOL_CAPACITY: i32 = 64;
let cursorPool: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let cursorPoolAll: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let cursorPoolDepth: i32 = 0;

function initCursorPool(): void {
  cursorPool = changetype<UnmanagedUint32Array>(atomicChunkAlloc(CURSOR_POOL_CAPACITY * 4));
  cursorPoolAll = changetype<UnmanagedUint32Array>(atomicChunkAlloc(CURSOR_POOL_CAPACITY * 4));
  for (let i = 0; i < CURSOR_POOL_CAPACITY; i++) {
    let ptr = atomicChunkAlloc(offsetof<FieldCursor>());
    let cursor = changetype<FieldCursor>(ptr);
    cursor.isActive = false;
    cursor.stackPtr = atomicChunkAlloc(64 << 5) as usize;
    cursorPool[i] = ptr as u32;
    cursorPoolAll[i] = ptr as u32;
  }
  cursorPoolDepth = CURSOR_POOL_CAPACITY;
  cursorPoolInitialized = true;
}

export function resetCursorPool(): void {
  if (!cursorPoolInitialized) return;
  for (let i = 0; i < CURSOR_POOL_CAPACITY; i++) {
    let ptr = cursorPoolAll[i];
    cursorPool[i] = ptr;
    let c = changetype<FieldCursor>(ptr);
    if (changetype<usize>(c) != 0) c.isActive = false;
  }
  cursorPoolDepth = CURSOR_POOL_CAPACITY;
}

export function getChildrenByFieldId(node: u32, fieldId: i32): FieldCursor {
  if (!cursorPoolInitialized) initCursorPool();
  let cursor: FieldCursor;
  if (cursorPoolDepth > 0) {
    cursorPoolDepth--;
    cursor = changetype<FieldCursor>(cursorPool[cursorPoolDepth]);
  } else {
    let ptr = atomicChunkAlloc(offsetof<FieldCursor>());
    cursor = changetype<FieldCursor>(ptr);
    cursor.stackPtr = atomicChunkAlloc(64 << 5) as usize;
  }
  cursor.init(node, fieldId);
  return cursor;
}

export function releaseFieldCursor(cursor: FieldCursor): void {
  if (!cursorPoolInitialized) initCursorPool();
  cursor.isActive = false;
  if (cursorPoolDepth < CURSOR_POOL_CAPACITY) {
    cursorPool[cursorPoolDepth] = changetype<u32>(cursor);
    cursorPoolDepth++;
  }
}

export function fieldCursorNext(cursor: FieldCursor): u32 {
  if (changetype<usize>(cursor) == 0) return 0;
  return cursor.next();
}

export function getChildByFieldId(ptr: u32, fieldId: i32): u32 {
  let cursor = getChildrenByFieldId(ptr, fieldId);
  let child = cursor.next();
  cursor.release();
  return child;
}

export function getFieldIdForChild(type: u16, childIndex: u16, childType: u16, directOnly: i32): i32 {
  let tablePtr = changetype<usize>(type_fields);
  if (tablePtr < 4) return -1;
  let len = type_fields.length;
  if ((type as i32) < 0 || (type as i32) >= len) return -1;
  let offset = type_fields[type as i32];
  let dataTablePtr = changetype<usize>(type_field_data);
  let dataLen = type_field_data.length;
  if (dataTablePtr < 4 || offset == -1 || offset < 0 || offset >= dataLen) return -1;
  let fieldCount = type_field_data[offset];
  if (fieldCount <= 0 || fieldCount > 1000) return -1;
  let currentOffset = offset + 1;
  for (let i = 0; i < fieldCount; i++) {
    if (currentOffset + 1 >= dataLen) break;
    let currentFieldId = type_field_data[currentOffset];
    let indexCount = type_field_data[currentOffset + 1];
    if (indexCount <= 0 || indexCount > 1000) break;
    let idxPtr = currentOffset + 2;
    for (let j = 0; j < indexCount; j++) {
      if (idxPtr + 1 >= dataLen) break;
      let rawIdx = type_field_data[idxPtr];
      let expectedType = type_field_data[idxPtr + 1] as u16;
      let isSynthetic = (rawIdx & 0x8000) != 0;
      if (directOnly != 0 && isSynthetic) {
        idxPtr += 2;
        continue;
      }
      if (rawIdx == (childIndex as i32) || (rawIdx & 0x7FFF) == (childIndex as i32)) {
        if (childType == 0 || expectedType == 0 || expectedType == childType) {
          return currentFieldId;
        }
      }
      idxPtr += 2;
    }
    currentOffset += 2 + (indexCount * 2);
  }
  return -1;
}

export function getDirectFieldIdForChild(type: u16, childIndex: u16, childType: u16): i32 {
  return getFieldIdForChild(type, childIndex, childType, 1);
}

// ---------------------------------------------------------------------------
// Parent-table cache. Nodes carry no parent pointers, so without a cache every
// getAncestors() call is an O(file size) DFS from the root. While a lint run is
// active (tree immutable) we build a node->parent open-addressing hash table
// once per root and answer ancestor queries in O(depth).
// ---------------------------------------------------------------------------
let ancestorCacheOn: boolean = false;
let ancestorCacheRoot: u32 = 0;
let ancestorTable: usize = 0; // entries of (key u32, parent u32)
let ancestorTableCap: u32 = 0; // power of two
let ancestorTableCount: u32 = 0;

export let lintRunGeneration: u32 = 0;

export function setAncestorCacheEnabled(on: boolean): void {
  ancestorCacheOn = on;
  ancestorCacheRoot = 0; // force rebuild on next use
  if (on) lintRunGeneration++; // invalidates per-run lint memo caches
}

function ancestorTableInsert(key: u32, parent: u32): void {
  let mask = ancestorTableCap - 1;
  let i = (key * 2654435761) & mask;
  while (true) {
    let k = load<u32>(ancestorTable + ((<usize>i) << 3));
    if (k == 0) {
      store<u32>(ancestorTable + ((<usize>i) << 3), key);
      store<u32>(ancestorTable + ((<usize>i) << 3) + 4, parent);
      ancestorTableCount++;
      return;
    }
    if (k == key) {
      store<u32>(ancestorTable + ((<usize>i) << 3) + 4, parent);
      return;
    }
    i = (i + 1) & mask;
  }
}

function ancestorTableLookup(key: u32): i64 {
  let mask = ancestorTableCap - 1;
  let i = (key * 2654435761) & mask;
  while (true) {
    let k = load<u32>(ancestorTable + ((<usize>i) << 3));
    if (k == 0) return -1;
    if (k == key) return <i64>load<u32>(ancestorTable + ((<usize>i) << 3) + 4);
    i = (i + 1) & mask;
  }
  return -1;
}

function ancestorTableGrow(): void {
  let oldTable = ancestorTable;
  let oldCap = ancestorTableCap;
  let newCap: u32 = oldCap == 0 ? 1 << 16 : oldCap << 1;
  ancestorTable = heap.alloc(<usize>newCap << 3);
  memory.fill(ancestorTable, 0, <usize>newCap << 3);
  ancestorTableCap = newCap;
  ancestorTableCount = 0;
  for (let j: u32 = 0; j < oldCap; j++) {
    let k = load<u32>(oldTable + ((<usize>j) << 3));
    if (k != 0) ancestorTableInsert(k, load<u32>(oldTable + ((<usize>j) << 3) + 4));
  }
  if (oldTable != 0) {
    // old table intentionally not freed (runtime may use a stub allocator)
  }
}

function buildAncestorTable(rootNode: u32): void {
  if (ancestorTableCap == 0) ancestorTableGrow();
  else memory.fill(ancestorTable, 0, <usize>ancestorTableCap << 3);
  ancestorTableCount = 0;
  ancestorTableInsert(rootNode, 0xFFFFFFFF);
  let current = getNodeFirstChild(rootNode);
  if (current != 0) ancestorTableInsert(current, rootNode);
  let guard = 0;
  while (current != 0 && ++guard < 50000000) {
    if (ancestorTableCount * 2 > ancestorTableCap) ancestorTableGrow();
    let child = getNodeFirstChild(current);
    if (child != 0) {
      ancestorTableInsert(child, current);
      current = child;
      continue;
    }
    // climb until a sibling exists
    let n = current;
    let next: u32 = 0;
    while (n != 0 && n != rootNode) {
      let sib = getNodeNextSibling(n);
      let p = <u32>ancestorTableLookup(n);
      if (sib != 0) {
        ancestorTableInsert(sib, p);
        next = sib;
        break;
      }
      n = p;
    }
    current = next;
  }
  ancestorCacheRoot = rootNode;
}

@unmanaged
export class AncestorCursor {
  pathStack: usize; 
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

     if (globalCursorDepth >= 0 && cursorNodeStack[globalCursorDepth] == targetNode) {
       let depth = globalCursorDepth;
       if (depth > 4096) depth = 4096;
       let stack = this.pathStack;
       for (let d = 0; d < depth; d++) {
         store<u32>(stack + (d << 2), cursorNodeStack[d]);
       }
       this.pathLength = depth;
       this.currentIndex = depth - 1;
       return;
     }
     
     if (ancestorCacheOn) {
       // Rebuild only if rootNode is not already covered by the current table.
       if (ancestorCacheRoot == 0 || (ancestorCacheRoot != rootNode && ancestorTableLookup(rootNode) < 0)) {
         buildAncestorTable(rootNode);
       }
       let tmp = ancestorTableLookup(targetNode);
       if (tmp >= 0) {
         let depth = 0;
         let p = <u32>tmp;
         while (p != 0xFFFFFFFF && p != 0 && depth < 4096) {
           depth++;
           let up = ancestorTableLookup(p);
           if (up < 0) break;
           p = <u32>up;
         }
         let stk = this.pathStack;
         let idx = depth - 1;
         p = <u32>tmp;
         while (idx >= 0 && p != 0xFFFFFFFF && p != 0) {
           store<u32>(stk + (<usize>idx << 2), p);
           idx--;
           let up = ancestorTableLookup(p);
           if (up < 0) break;
           p = <u32>up;
         }
         if (rootNode != ancestorCacheRoot) {
           // Path must start at rootNode: drop everything above it.
           let k = 0;
           while (k < depth && load<u32>(stk + (<usize>k << 2)) != rootNode) k++;
           if (k >= depth) {
             depth = 0; // target is not under rootNode
           } else if (k > 0) {
             for (let m = k; m < depth; m++) {
               store<u32>(stk + (<usize>(m - k) << 2), load<u32>(stk + (<usize>m << 2)));
             }
             depth -= k;
           }
         }
         this.pathLength = depth;
         this.currentIndex = depth - 1;
       }
       return;
     }

     // Iterative DFS to find targetNode
     let stack = this.pathStack; 
     let stackDepth = 0;
     let current = rootNode;
     let iters = 0;
     
     while (current != 0 && ++iters < 2000000) {
         if (current == targetNode) {
             this.pathLength = stackDepth;
             this.currentIndex = stackDepth - 1;
             return;
         }
         let child = getNodeFirstChild(current);
         if (child != 0) {
             if (stackDepth < 4096) {
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
          if (this.filterType == 0xFFFF || this.filterType == 0 || getNodeType(n) == this.filterType) {
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

let ancestorCursorPoolInitialized: boolean = false;
let ancestorCursorPool: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let ancestorCursorPoolDepth: i32 = 0;

function initAncestorCursorPool(): void {
  ancestorCursorPool = changetype<UnmanagedUint32Array>(atomicChunkAlloc(16 * 4));
  for (let i = 0; i < 16; i++) {
    let ptr = atomicChunkAlloc(offsetof<AncestorCursor>());
    let cursor = changetype<AncestorCursor>(ptr);
    cursor.isActive = false;
    cursor.pathStack = atomicChunkAlloc(4096 * 4) as usize;
    ancestorCursorPool[i] = ptr;
  }
  ancestorCursorPoolDepth = 16;
  ancestorCursorPoolInitialized = true;
}

export function getAncestors(node: u32, filterType: u16, rootNode: u32): AncestorCursor {
  if (!ancestorCursorPoolInitialized) initAncestorCursorPool();
  let cursor: AncestorCursor;
  if (ancestorCursorPoolDepth > 0) {
    ancestorCursorPoolDepth--;
    cursor = changetype<AncestorCursor>(ancestorCursorPool[ancestorCursorPoolDepth]);
  } else {
    let ptr = atomicChunkAlloc(offsetof<AncestorCursor>());
    cursor = changetype<AncestorCursor>(ptr);
    cursor.pathStack = atomicChunkAlloc(4096 * 4) as usize;
  }
  cursor.init(node, filterType, rootNode);
  return cursor;
}

export function releaseAncestorCursor(cursor: AncestorCursor): void {
  if (!ancestorCursorPoolInitialized) initAncestorCursorPool();
  if (ancestorCursorPoolDepth < 16) {
    ancestorCursorPool[ancestorCursorPoolDepth] = changetype<u32>(cursor);
    ancestorCursorPoolDepth++;
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
         if (this.filterType == 0xFFFF || this.filterType == 0 || getNodeType(this.current) == this.filterType) {
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
         if (this.stackDepth < 4096) {
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

let descendantCursorPoolInitialized: boolean = false;
let descendantCursorPool: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let descendantCursorPoolDepth: i32 = 0;

function initDescendantCursorPool(): void {
  descendantCursorPool = changetype<UnmanagedUint32Array>(atomicChunkAlloc(16 * 4));
  for (let i = 0; i < 16; i++) {
    let ptr = atomicChunkAlloc(offsetof<DescendantCursor>());
    let cursor = changetype<DescendantCursor>(ptr);
    cursor.isActive = false;
    cursor.stack = atomicChunkAlloc(4096 * 4);
    descendantCursorPool[i] = ptr;
  }
  descendantCursorPoolDepth = 16;
  descendantCursorPoolInitialized = true;
}

export function getDescendants(node: u32, filterType: u16): DescendantCursor {
  if (!descendantCursorPoolInitialized) initDescendantCursorPool();
  let cursor: DescendantCursor;
  if (descendantCursorPoolDepth > 0) {
    descendantCursorPoolDepth--;
    cursor = changetype<DescendantCursor>(descendantCursorPool[descendantCursorPoolDepth]);
  } else {
    let ptr = atomicChunkAlloc(offsetof<DescendantCursor>());
    cursor = changetype<DescendantCursor>(ptr);
    cursor.stack = atomicChunkAlloc(4096 * 4);
  }
  cursor.init(node, filterType);
  return cursor;
}

export function releaseDescendantCursor(cursor: DescendantCursor): void {
  if (!descendantCursorPoolInitialized) initDescendantCursorPool();
  if (descendantCursorPoolDepth < 16) {
    descendantCursorPool[descendantCursorPoolDepth] = changetype<u32>(cursor);
    descendantCursorPoolDepth++;
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

let semanticCursorPoolInitialized: boolean = false;
let semanticCursorPool: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let semanticCursorPoolDepth: i32 = 0;

function initSemanticCursorPool(): void {
  semanticCursorPool = changetype<UnmanagedUint32Array>(atomicChunkAlloc(16 * 4));
  for (let i = 0; i < 16; i++) {
    let ptr = atomicChunkAlloc(offsetof<SemanticCursor>());
    let cursor = changetype<SemanticCursor>(ptr);
    cursor.isActive = false;
    semanticCursorPool[i] = ptr;
  }
  semanticCursorPoolDepth = 16;
  semanticCursorPoolInitialized = true;
}

export function getSemanticChildren(node: u32): SemanticCursor {
  if (!semanticCursorPoolInitialized) initSemanticCursorPool();
  let cursor: SemanticCursor;
  if (semanticCursorPoolDepth > 0) {
    semanticCursorPoolDepth--;
    cursor = changetype<SemanticCursor>(semanticCursorPool[semanticCursorPoolDepth]);
  } else {
    let ptr = atomicChunkAlloc(offsetof<SemanticCursor>());
    cursor = changetype<SemanticCursor>(ptr);
  }
  cursor.init(node);
  return cursor;
}

export function releaseSemanticCursor(cursor: SemanticCursor): void {
  if (!semanticCursorPoolInitialized) initSemanticCursorPool();
  if (semanticCursorPoolDepth < 16) {
    semanticCursorPool[semanticCursorPoolDepth] = changetype<u32>(cursor);
    semanticCursorPoolDepth++;
  }
}

export function getPathTokens(node: u32): DescendantCursor {
  // PathTokens is essentially a DescendantCursor filtering for all terminal nodes. 
  // In our engine, MAX_TERMINAL_ID defines terminals, but we can't easily filter by "isTerminal" 
  // inside DescendantCursor. We can let the user filter, or we can just yield all descendants.
  // We'll yield all descendants and let the caller handle it.
  return getDescendants(node, 0xFFFF);
}


import { inputLength, setInputLength, inputEncoding, setInputEncoding, MAX_TERMINAL_ID, logInt } from "../parser";
export { inputLength, setInputLength, inputEncoding, setInputEncoding, MAX_TERMINAL_ID, getNodeLeadingPad };

export function lsp_setInputLength(len: u32): void {
  setInputLength(len);
}
export function lsp_setInputEncoding(encoding: u8): void {
  setInputEncoding(encoding);
}
export function lsp_getInputEncoding(): u8 {
  return inputEncoding;
}
export function lsp_isCharOffsetKernel(): u32 {
  return 1;
}
export function lsp_getNodeLeadingPad(ptr: u32): u32 {
  return getNodeLeadingPad(ptr);
}





