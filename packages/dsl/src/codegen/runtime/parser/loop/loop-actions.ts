// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview GLR action table lookup, action cache, lex memoization, expected tokens, and lookahead.
 */

import { ParseHead, t_activeHeads, activeHeadsCount, g_expectedVersion, gssBestAcceptingHead, gssBestDyingHead } from "../gss";
import { getNodeType, getNodeFlags, getNodeFirstChild, getNodeNextSibling, FLAG_IS_LIST, FLAG_IS_INSERTED, atomicChunkAlloc } from "../../arena";
import { UnmanagedUint32Array, UnmanagedUint8Array, UnmanagedInt32Array, ChunkedUint32Array, createChunkedUint32Array } from "../../core/array";
import { lexPos, lexLen, srcLexPos, currentScannerState, is_extra_token, lex, saveLexerAuxState, restoreLexerAuxState } from "../../parser";
import { TOKEN_EOF, NODE_TYPE_ERROR, ACTION_SHIFT, ACTION_REDUCE, ACTION_ACCEPT, action_offsets, action_data, action_entry_offsets, action_entry_data, prod_lengths, prod_lhs, MAX_LOOKAHEAD_DEPTH, t_lrStateStack, lrStackDepth, MODE_LR, MODE_GLR, currentParserMode, debugLog, expected_tokens, populateStateExpectedTokens, tempActions, MAX_TERMINAL_ID, lookupGoto, action_disp_base, action_disp_check, action_disp_val } from "../engine";
import { resetRecoveryLookaheadCache } from "../recovery";

export let diag_count_reduce: u32 = 0;
export let diag_count_clone: u32 = 0;
export let diag_count_append: u32 = 0;
export let diag_count_shift: u32 = 0;


const ACTION_CACHE_SIZE: u32 = 512;
const ACTION_CACHE_MASK: u32 = 511;

let t_actionCacheState: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_actionCacheToken: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_actionCacheMatchIdx: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_actionCacheTable: usize = 0;

export function initActionCache(): void {
  if (changetype<usize>(t_actionCacheState) == 0) {
    t_actionCacheState = changetype<UnmanagedInt32Array>(atomicChunkAlloc(ACTION_CACHE_SIZE * sizeof<i32>()));
    t_actionCacheToken = changetype<UnmanagedInt32Array>(atomicChunkAlloc(ACTION_CACHE_SIZE * sizeof<i32>()));
    t_actionCacheMatchIdx = changetype<UnmanagedInt32Array>(atomicChunkAlloc(ACTION_CACHE_SIZE * sizeof<i32>()));
  }
  for (let i: u32 = 0; i < ACTION_CACHE_SIZE; i++) {
    t_actionCacheState[i] = -2;
  }
  t_actionCacheTable = changetype<usize>(action_data);
}

export let g_counter_lex_calls: u32 = 0;
export let g_counter_expected_tokens_calls: u32 = 0;
export let g_counter_action_memo_hits: u32 = 0;
export let g_counter_action_memo_misses: u32 = 0;
export let g_counter_peak_active_heads: u32 = 0;

export function getDebugCounter(kind: i32): u32 {
  if (kind == 0) return g_counter_lex_calls;
  if (kind == 1) return g_counter_expected_tokens_calls;
  if (kind == 2) return g_counter_action_memo_hits;
  if (kind == 3) return g_counter_action_memo_misses;
  if (kind == 4) return g_counter_peak_active_heads;
  return 0;
}

export function resetDebugCounters(): void {
  g_counter_lex_calls = 0;
  g_counter_expected_tokens_calls = 0;
  g_counter_action_memo_hits = 0;
  g_counter_action_memo_misses = 0;
  g_counter_peak_active_heads = 0;
}

/** Maximum number of actions copied into `tempActions` (it holds 128 u32 = 64 pairs). */
const MAX_LOOKUP_ACTIONS: i32 = 64;

/**
 * Finds the index of the matching action entry in `action_data` for a given state and token.
 * Uses binary search when `action_entry_offsets` is available and `actionCount > 8`.
 * Falls back to default entry (`sym == 0`) if exact match is not found.
 */
function computeActionEntry(state: i32, token: i32): i32 {
  if (state < 0 || state >= action_offsets.length) return -1;
  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset + 1 >= action_data.length) return -1;
  let actionCount = action_data[actionOffset];
  if (actionCount == 0) return -1;

  if (actionCount > 8 && changetype<usize>(action_entry_data) != 0 && changetype<usize>(action_entry_offsets) != 0) {
    let entryBase = action_entry_offsets[state];
    let low = 0;
    let high = actionCount - 1;
    let defaultIdx = -1;
    let firstIdx = action_entry_data[entryBase];
    if (action_data[firstIdx] == 0) {
      defaultIdx = firstIdx;
      low = 1;
    }
    while (low <= high) {
      let mid = (low + high) >> 1;
      let entryIdx = action_entry_data[entryBase + mid];
      let sym = action_data[entryIdx];
      if (sym == token) {
        return entryIdx;
      } else if (sym < token) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return defaultIdx;
  }

  // Linear path for <= 8 entries or unindexed tables
  let idx = actionOffset + 1;
  let exactIdx = -1;
  let defaultIdx = -1;
  for (let i = 0; i < actionCount; i++) {
    let sym = action_data[idx];
    let actCount = action_data[idx + 1];
    if (sym == token) {
      exactIdx = idx;
      break;
    } else if (sym == 0) {
      defaultIdx = idx;
    }
    idx += 2 + actCount * 2;
  }
  return exactIdx != -1 ? exactIdx : defaultIdx;
}

/**
 * Finds the index of the matching action entry in `action_data` for a given state and token.
 * Uses a direct-mapped cache (512 entries) in linear memory.
 * Falls back to default entry (`sym == 0`) if exact match is not found.
 */
export function findActionEntry(state: i32, token: i32): i32 {
  if (changetype<usize>(action_disp_base) != 0 && state >= 0 && state < action_disp_base.length) {
    let base = action_disp_base[state];
    if (base < 0) return -1;
    let eofSlot = MAX_TERMINAL_ID + 1;
    let sym = token == TOKEN_EOF ? eofSlot : token;
    if (sym >= 0 && sym <= eofSlot) {
      let slot = base + sym;
      if (slot >= 0 && slot < action_disp_check.length && action_disp_check[slot] == state) {
        return action_disp_val[slot];
      }
      if (sym != 0 && base < action_disp_check.length && action_disp_check[base] == state) {
        return action_disp_val[base];
      }
      return -1;
    }
  }
  if (changetype<usize>(t_actionCacheState) == 0 || t_actionCacheTable != changetype<usize>(action_data)) {
    initActionCache();
  }
  let cacheIdx: u32 = (((state as u32) * 31) ^ (token as u32)) & ACTION_CACHE_MASK;
  if (t_actionCacheState[cacheIdx] == state && t_actionCacheToken[cacheIdx] == token) {
    g_counter_action_memo_hits++;
    return t_actionCacheMatchIdx[cacheIdx];
  }
  g_counter_action_memo_misses++;

  let matchIdx = computeActionEntry(state, token);
  t_actionCacheState[cacheIdx] = state;
  t_actionCacheToken[cacheIdx] = token;
  t_actionCacheMatchIdx[cacheIdx] = matchIdx;
  return matchIdx;
}

/**
 * Looks up the GLR action count for a given parser state and token.
 * This checks the `action_offsets` and `action_data` tables via the direct-mapped cache.
 * Populates `tempActions` with the action pairs.
 *
 * @param state The current parser state.
 * @param token The token ID to look up (terminal or non-terminal).
 * @returns The number of possible actions (1 for LR, >1 for GLR conflicts).
 */
export function lookupActions(state: i32, token: i32): i32 {
  let matchIdx = findActionEntry(state, token);
  if (matchIdx == -1) {
    return 0;
  }

  if (changetype<usize>(tempActions) == 0) {
    tempActions = changetype<UnmanagedUint32Array>(atomicChunkAlloc(128 * sizeof<u32>()));
  }
  let actCount = action_data[matchIdx + 1];
  let actPtr = matchIdx + 2;
  let count = actCount < MAX_LOOKUP_ACTIONS ? actCount : MAX_LOOKUP_ACTIONS;
  if (actCount > MAX_LOOKUP_ACTIONS) {
    // Surface grammar conflicts that exceed the scratch buffer instead of dropping silently.
    debugLog(9501, state, token, actCount);
  }
  for (let i = 0; i < count; i++) {
    tempActions[i * 2] = action_data[actPtr + i * 2];
    tempActions[i * 2 + 1] = action_data[actPtr + i * 2 + 1];
  }
  return count;
}

/**
 * Fast boolean check if the token can eventually be accepted from this state
 * (performing simulated lookahead through error recoveries if necessary).
 */
export function stateCanAcceptFnBool(state: i32, token: i32): boolean {
  return stateCanAccept(null, state, token) > 0;
}

/** Input byte offset (`frontierPos`) for which the current lookahead token is memoized (`0xffffffff` if invalid). */
let g_memoFrontierPos: u32 = 0xffffffff;
/** Lexer/scanner mode (`scannerState`) corresponding to the memoized frontier lookahead token. */
let g_memoScannerState: u32 = 0xffffffff;
/** Version of the `expected_tokens` bitset (`g_expectedVersion`) when the lookahead token was memoized. */
let g_memoExpectedVersion: u32 = 0xffffffff;
/** Memoized terminal symbol ID (`tok`) returned by `invokeLexer` at `(g_memoFrontierPos, g_memoScannerState)`. */
let g_memoTok: i32 = 0;
/** Memoized byte length (`lexLen`) of the matched lookahead token. */
let g_memoLexLen: u32 = 0;
/** Memoized start byte offset (`lexPos`) of the matched lookahead token after skipping trivia. */
let g_memoLexPos: u32 = 0;
/** Memoized raw source start offset (`srcLexPos`) before trivia/preprocessor adjustments. */
let g_memoSrcLexPos: u32 = 0;
/** Memoized trivia skip start offset (`g_skipPos`) preceding the lookahead token. */
let g_memoSkipPos: u32 = 0;
/** Memoized leading trivia/whitespace byte length (`g_skipPad`) preceding the lookahead token. */
let g_memoSkipPad: u32 = 0;

/** Frontier byte position for which the `expected_tokens` lookahead bitset was last populated. */
export let g_expectedFrontierPos: u32 = 0xffffffff;
/** Monotonically increasing version tag for the active frontier's `expected_tokens` bitset. */
export let g_expectedFrontierVersion: u32 = 0xffffffff;

/**
 * Retrieves the best accepting head found so far.
 */
export function getBestAcceptingHead(): u32 {
  return bestAcceptingHead;
}
export let furthestDyingPos: u32 = 0;
export let bestDyingHead: u32 = 0;
export let bestAcceptingHead: u32 = 0;

@inline
export function setBestDyingHead(val: u32): void {
  bestDyingHead = val;
  gssBestDyingHead = val;
}

@inline
export function setBestAcceptingHead(val: u32): void {
  bestAcceptingHead = val;
  gssBestAcceptingHead = val;
}
export let acceptedNode: u32 = 0;
export let bestAcceptedCost: i32 = 999999;
export let bestAcceptedRealBytes: u32 = 0;
export let bestAcceptedCount: u32 = 0xffffffff;
export let bestAcceptedPad: u32 = 0xffffffff;
export let bestAcceptedPrec: i32 = -999999;

/**
 * Invalidates the single-slot frontier lexer memoization cache when advancing
 * the GLR frontier or switching parser modes.
 */
export function resetFrontierLexMemo(): void {
  g_memoFrontierPos = 0xffffffff;
  g_memoScannerState = 0xffffffff;
  g_memoExpectedVersion = 0xffffffff;
  g_expectedFrontierPos = 0xffffffff;
  g_expectedFrontierVersion = 0xffffffff;
  resetRecoveryLookaheadCache();
}

/**
 * Returns the lookahead token at frontierPos for the given scanner state.
 * Memoized per (frontierPos, scannerState, expectedVersion) across all GLR heads at this frontier.
 */
export function getFrontierToken(frontierPos: u32, scannerState: u32): i32 {
  if (frontierPos == g_memoFrontierPos && scannerState == g_memoScannerState && g_expectedVersion == g_memoExpectedVersion) {
    lexLen = g_memoLexLen;
    lexPos = g_memoLexPos;
    srcLexPos = g_memoSrcLexPos;
    currentScannerState = scannerState;
    g_skipPos = g_memoSkipPos;
    g_skipPad = g_memoSkipPad;
    return g_memoTok;
  }
  currentScannerState = scannerState;
  let rawTok = invokeLexer(frontierPos);
  let tok = skipExtraTokens(rawTok, frontierPos, 1);
  g_memoFrontierPos = frontierPos;
  g_memoScannerState = scannerState;
  g_memoExpectedVersion = g_expectedVersion;
  g_memoTok = tok;
  g_memoLexLen = lexLen;
  g_memoLexPos = lexPos;
  g_memoSrcLexPos = srcLexPos;
  g_memoSkipPos = g_skipPos;
  g_memoSkipPad = g_skipPad;
  return tok;
}

/**
 * Interacts with the lexer module to fetch the next token ID.
 * The `lex` function also updates global `lexLen` and `srcLexPos`.
 */
export function invokeLexer(pos: u32): i32 {
  g_counter_lex_calls++;
  updateExpectedTokens(pos);
  let token = lex(pos);
  return token;
}

/** Position immediately after the last extra token consumed by `skipExtraTokens`. */
export let g_skipPos: u32 = 0;
/** Bytes consumed by `skipExtraTokens` (whitespace preceding each extra + the extra itself). */
export let g_skipPad: u32 = 0;

/**
 * Skips token-type extras (e.g. grammar-declared comment tokens) starting from `tok`,
 * which must have just been produced by `invokeLexer(pos)`.
 *
 * `lex(pos)` skips built-in whitespace internally, so each extra token begins at
 * `srcLexPos`, not at `pos`. Advancing must therefore resume from `srcLexPos + lexLen`.
 *
 * On return, `g_skipPos` holds the position after the last consumed extra and
 * `g_skipPad` holds the number of bytes consumed in `[pos, g_skipPos)`, so that
 * `g_skipPad + (srcLexPos - g_skipPos)` equals the full padding before the returned token.
 *
 * @param zeroLenAdvance Amount to advance `pos` by if a zero-length extra is encountered.
 * @returns The first non-extra token (or the zero-length extra token).
 */
export function skipExtraTokens(tok: i32, pos: u32, zeroLenAdvance: u32): i32 {
  let pad: u32 = 0;
  while (tok >= 0 && tok <= MAX_TERMINAL_ID && load<u8>(is_extra_token + tok) == 1) {
    if (lexLen == 0) {
      pos += zeroLenAdvance;
      break;
    }
    let start = srcLexPos > pos ? srcLexPos : pos;
    let nextPos = start + lexLen;
    pad += nextPos - pos;
    pos = nextPos;
    tok = invokeLexer(pos);
  }
  g_skipPos = pos;
  g_skipPad = pad;
  return tok;
}

/** Restores all lexer globals after a speculative re-lex (e.g. a rejected subtree reuse). */
export function restoreLexerState(savedLexPos: u32, savedSrcLexPos: u32, savedLexLen: u32, savedScannerState: u32): void {
  lexPos = savedLexPos;
  srcLexPos = savedSrcLexPos;
  lexLen = savedLexLen;
  currentScannerState = savedScannerState;
}

/**
 * Lookahead token in effect for GLR reductions; recorded on reduced parent nodes so that
 * a later incremental parse can verify the subtree's reductions still hold.
 * 0 (NODE_TYPE_ERROR) means "unknown".
 */
export let g_reduceLookahead: u32 = 0;


export function addStateExpectedTokens(state: i32, _depth: i32 = 0): void {
  if (expected_tokens == 0) return;
  populateStateExpectedTokens(state, expected_tokens);
}

export let savedExpectedTokensPtr: usize = 0;

export let lastPeekedTokenLen: u32 = 0;
export let lastPeekedTokenEnd: u32 = 0;

export function peekNextTokenInState(pos: u32, state: i32): i32 {
  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  if (expected_tokens == 0) expected_tokens = atomicChunkAlloc(65536);
  if (savedExpectedTokensPtr == 0) savedExpectedTokensPtr = atomicChunkAlloc(copyLen);
  // P5 fix: Only copy the used range (MAX_TERMINAL_ID+1 bytes) instead of full 64KB
  memory.copy(savedExpectedTokensPtr, expected_tokens, copyLen);
  let savedEof = load<u8>(expected_tokens + (TOKEN_EOF as usize));
  memory.fill(expected_tokens, 0, copyLen);
  store<u8>(expected_tokens + (TOKEN_EOF as usize), 0);
  addStateExpectedTokens(state, 0);

  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedScannerState = currentScannerState;
  let savedAux = saveLexerAuxState();

  let tok = skipExtraTokens(lex(pos), pos, 0);
  lastPeekedTokenLen = lexLen;
  lastPeekedTokenEnd = srcLexPos + lexLen;

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;
  restoreLexerAuxState(savedAux);

  memory.copy(expected_tokens, savedExpectedTokensPtr, copyLen);
  store<u8>(expected_tokens + (TOKEN_EOF as usize), savedEof);
  return tok;
}

/**
 * LR state whose expected-token set currently fills `expected_tokens` (-1 = unknown).
 * Any code that writes `expected_tokens` outside `updateExpectedTokens` must reset it.
 */
export let g_expectedMemoState: i32 = -1;

/**
 * Updates the `expected_tokens` bitset based on the valid action transitions
 * from the active parsing heads (either the single LR head or all GLR heads).
 * This acts as context-aware feedback for the lexer (for keywords vs identifiers).
 */
export function updateExpectedTokens(frontierPos: u32 = 0): void {
  if (currentParserMode == MODE_GLR && frontierPos == g_expectedFrontierPos && g_expectedVersion == g_expectedFrontierVersion) {
    return;
  }
  g_counter_expected_tokens_calls++;
  if (expected_tokens == 0) {
    expected_tokens = atomicChunkAlloc(65536);
    g_expectedMemoState = -1;
  }
  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  if (currentParserMode == MODE_LR) {
    let state = lrStackDepth > 0 ? (t_lrStateStack[lrStackDepth - 1] as i32) : -2;
    if (state == g_expectedMemoState) return;
    memory.fill(expected_tokens, 0, copyLen);
    store<u8>(expected_tokens + (TOKEN_EOF as usize), 0);
    if (state >= 0) addStateExpectedTokens(state, 0);
    g_expectedMemoState = state;
  } else {
    g_expectedMemoState = -1;
    memory.fill(expected_tokens, 0, copyLen);
    store<u8>(expected_tokens + (TOKEN_EOF as usize), 0);
    let healthyCount: u32 = 0;
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let head = changetype<ParseHead>(t_activeHeads[i]);
      if (!head.inErrorState && head.pos == frontierPos) {
        healthyCount++;
        addStateExpectedTokens(head.state, 0);
      }
    }
    // Only unmask all tokens when ALL active heads at this frontier are in an error state
    if (healthyCount == 0) {
      memory.fill(expected_tokens, 1, copyLen);
    }
    g_expectedFrontierPos = frontierPos;
    g_expectedFrontierVersion = g_expectedVersion;
  }
}

export let t_stateReachability: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_stateReachabilityComputed: UnmanagedUint8Array = changetype<UnmanagedUint8Array>(0);
let computingReachability = false;

/**
 * Pre-computes and checks if a target token is reachable from a state via
 * an epsilon transition (a reduction sequence that consumes no input).
 *
 * @param state The anchor parse state.
 * @param tok The token to search for.
 * @returns True if `tok` can be shifted/reduced within `MAX_LOOKAHEAD_DEPTH`.
 */
export function isEpsilonReachable(state: i32, tok: i32): boolean {
  if (state < 0 || state >= action_offsets.length) return false;
  let mappedTok = tok;
  if (tok == TOKEN_EOF) mappedTok = 0;
  else if (tok < 0 || tok > MAX_TERMINAL_ID) return false;

  if (changetype<usize>(t_stateReachability) == 0) {
    let numStates = action_offsets.length;
    let u32PerState = (MAX_TERMINAL_ID >> 5) + 1;
    t_stateReachability = changetype<UnmanagedUint32Array>(atomicChunkAlloc(numStates * u32PerState * 4));
    t_stateReachabilityComputed = changetype<UnmanagedUint8Array>(atomicChunkAlloc(numStates));
    memory.fill(changetype<usize>(t_stateReachability), 0, numStates * u32PerState * 4);
    memory.fill(changetype<usize>(t_stateReachabilityComputed), 0, numStates);
  }
  if (t_stateReachabilityComputed[state] == 0) {
    t_stateReachabilityComputed[state] = 1;
    let u32PerState = (MAX_TERMINAL_ID >> 5) + 1;
    let baseIdx = state * u32PerState;
    computingReachability = true;
    let actionOffset = action_offsets[state];
    if (actionOffset >= 0 && actionOffset < action_data.length) {
      let actionCount = action_data[actionOffset];
      let idx = actionOffset + 1;
      let hasWildcard = false;
      for (let i = 0; i < actionCount; i++) {
        let sym = action_data[idx];
        let actCount = action_data[idx + 1];
        if (sym == 0) {
          hasWildcard = true;
          break;
        }
        idx += 2 + actCount * 2;
      }
      if (hasWildcard) {
        for (let t = 0; t <= MAX_TERMINAL_ID; t++) {
          let checkTok = t == 0 ? TOKEN_EOF : t;
          if (stateCanAccept(null, state, checkTok) > 0) {
            t_stateReachability[baseIdx + (t >> 5)] |= (1 << (t & 31));
          }
        }
      } else {
        idx = actionOffset + 1;
        for (let i = 0; i < actionCount; i++) {
          let sym = action_data[idx];
          let actCount = action_data[idx + 1];
          let mappedSym = sym == TOKEN_EOF ? 0 : sym;
          if (mappedSym >= 0 && mappedSym <= MAX_TERMINAL_ID) {
            if (stateCanAccept(null, state, sym) > 0) {
              t_stateReachability[baseIdx + (mappedSym >> 5)] |= (1 << (mappedSym & 31));
            }
          }
          idx += 2 + actCount * 2;
        }
      }
    }
    computingReachability = false;
  }
  let u32PerState = (MAX_TERMINAL_ID >> 5) + 1;
  let idx = (state * u32PerState) + (mappedTok >> 5);
  let bit = 1 << (mappedTok & 31);
  return (t_stateReachability[idx] & bit) != 0;
}

export let g_stateCanAcceptMaxCost: i32 = MAX_LOOKAHEAD_DEPTH * 10;

const t_virtualStates = new StaticArray<i32>(64);

/**
 * Core reachability simulation. Simulates parsing forward on a cloned GSS head
 * to determine if `tok` is eventually accepted.
 * Used for Error Recovery (checking if a virtual token is helpful).
 *
 * @param head The parse head (can be null if doing static state reachability).
 * @param state The state to look ahead from.
 * @param tok The token ID that we want to successfully shift/accept.
 * @param depth The current lookahead recursion depth (capped to prevent infinite loops).
 * @param virtualDepth The number of virtual frames on top of the physical head stack.
 * @returns >0 if reachable, 0 if not reachable.
 */
export function stateCanAccept(head: ParseHead | null, state: i32, tok: i32, depth: i32 = 0, virtualDepth: i32 = 0): i32 {
  if (depth > 40) return 0;
  if (state < 0 || state >= action_offsets.length) return 0;
  if (head == null && !computingReachability && depth == 0 && virtualDepth == 0) {
    return isEpsilonReachable(state, tok) ? 1 : 0;
  }
  if (depth == 0 && virtualDepth > 0 && virtualDepth <= 64) {
    t_virtualStates[0] = state;
  }

  let matchIdx = findActionEntry(state, tok);
  if (matchIdx == -1) return 0;

  let actCount = action_data[matchIdx + 1];
  let actIdx = matchIdx + 2;
  for (let j = 0; j < actCount; j++) {
    let type = action_data[actIdx++];
    let target = action_data[actIdx++];
    if (type == ACTION_SHIFT) return target + 1;
    if (type == ACTION_ACCEPT) return 1;
    if (type == ACTION_REDUCE) {
      let ruleLen = prod_lengths[target];
      let ruleLHS = prod_lhs[target];

      let virtualPopped = ruleLen <= virtualDepth ? ruleLen : virtualDepth;
      let remCounter = ruleLen - virtualPopped;
      let newVirtualDepth = virtualDepth - virtualPopped;

      let pHead = head;
      while (remCounter > 0 && pHead != null) {
        let pNode = pHead.astNode;
        let pIsInserted = pNode != 0 ? (getNodeFlags(pNode) & FLAG_IS_INSERTED) != 0 : false;
        if (pNode != 0 && isPureErrorNode(pNode) && !pIsInserted) {
          pHead = pHead.prev;
        } else {
          pHead = pHead.prev;
          remCounter--;
        }
      }

      let topState: i32 = -1;
      if (newVirtualDepth > 0) {
        topState = t_virtualStates[newVirtualDepth - 1];
      } else {
        topState = pHead != null ? pHead.state : (ruleLen == 0 ? state : (remCounter == 0 ? 0 : -1));
      }

      let nextState = topState != -1 ? lookupGoto(topState, ruleLHS) : -1;

      if (nextState != -1) {
        let savedVirtualState: i32 = 0;
        if (newVirtualDepth < 64) {
          savedVirtualState = t_virtualStates[newVirtualDepth];
          t_virtualStates[newVirtualDepth] = nextState;
        }
        let res = stateCanAccept(pHead, nextState, tok, depth + 1, newVirtualDepth + 1);
        if (newVirtualDepth < 64) {
          t_virtualStates[newVirtualDepth] = savedVirtualState;
        }
        if (res > 0) return res;
      }
    }
  }
  return 0;
}

export let t_sanitizeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_sanitizeVisited: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/**
 * Checks if a node consists entirely of error nodes (or lists of error nodes).
 * Pure error nodes are handled differently during reductions to avoid wrapping
 * garbage tokens in legitimate non-terminals.
 */
export function isPureErrorNode(node: u32): boolean {
  if (node == 0) return false;
  if (getNodeType(node) != NODE_TYPE_ERROR) return false;

  let flags = getNodeFlags(node);
  if ((flags & FLAG_IS_LIST) == 0) return true;

  if (changetype<usize>(t_sanitizeStack) == 0) {
    t_sanitizeStack = createChunkedUint32Array(50000);
    t_sanitizeVisited = createChunkedUint32Array(50000);
  }
  let savedLen = t_sanitizeStack.length;
  t_sanitizeStack.push(node);
  let isPure = true;
  let iterations: u32 = 0;

  while (t_sanitizeStack.length > savedLen && iterations < 500000) {
    iterations++;
    let curr = t_sanitizeStack.pop();
    if (curr == 0) continue;
    if (getNodeType(curr) != NODE_TYPE_ERROR) {
      isPure = false;
      break;
    }
    let cFlags = getNodeFlags(curr);
    if ((cFlags & FLAG_IS_LIST) != 0) {
      let child = getNodeFirstChild(curr);
      let sibCount: u32 = 0;
      while (child != 0 && sibCount < 200000) {
        t_sanitizeStack.push(child);
        child = getNodeNextSibling(child);
        sibCount++;
      }
    }
  }
  while (t_sanitizeStack.length > savedLen) t_sanitizeStack.pop();
  return isPure;
}

