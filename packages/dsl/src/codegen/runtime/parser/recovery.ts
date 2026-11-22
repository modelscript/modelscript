// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ParseHead,
  allocParseHead,
  pushActiveHead,
  pushNextHead,
  t_activeHeads,
  activeHeadsCount,
  GssEdge,
  t_nextSummary,
  g_expectedVersion,
} from "./gss";
import { logInt } from "../parser";
import {
  pushDiagnostic,
  MAX_CHILD_NODES,
  t_globalChildNodes,
  MAX_TERMINAL_ID,
  action_offsets,
  action_data,
  goto_offsets,
  goto_data,
  mrd_data,
  ACTION_SHIFT,
  ACTION_REDUCE,
  ACTION_ACCEPT,
  NODE_TYPE_ERROR,
  lookupGoto,
  isReachableZeroDist,
  prod_lengths,
  prod_lhs,
  inputLength,
  token_insert_costs,
  type_is_structural,
  token_delete_costs,
  token_bracket_deltas,
  updateBalanceHash,
  isExtraCloser,
  isMismatchedCloser,
  matchesTopBracketKind,
  token_is_word,
  precomputed_repairs,
  precomputed_nt_repairs,
  token_string_offsets,
  token_string_bytes,
  prod_is_list,
  getExpectedTokensForState,
  debugLog,
} from "./engine";
import { stateCanAccept, cloneNodeShallow, peekNextTokenInState, lastPeekedTokenLen, lastPeekedTokenEnd, fixNodeLength, lookupActions, findActionEntry, getRightmostLeafSpan } from "./parser-loop";
import {
  getNodePadding,
  setNodePadding,
  getNodeLeadingPad,
  getNodeByteLength,
  setFirstChild,
  setNextSibling,
  getNodeFirstChild,
  getNodeNextSibling,
  ast_appendChild,
  getNodeType,
  allocNode,
  setNodeByteLength,
  FLAG_IS_INSERTED,
  FLAG_HAS_ERROR,
  FLAG_IS_LIST,
  FLAG_INVISIBLE,
  getNodeFlags,
  setNodeFlags,
  allocGen0,
} from "../arena";
import {
  MAX_SUMMARY_DEPTH,
  MAX_COST_DIFFERENCE,
  MAX_LOCAL_EDITS,
  MAX_LOCAL_EXPANSIONS,
  MAX_LOCAL_NODES,
  LOCAL_CONFIRM_SHIFTS,
  MAX_EOF_COMPLETIONS,
} from "./recovery-config";
import {
  lexPos,
  lexLen,
  srcLexPos,
  currentScannerState,
  invokeLexer,
  is_extra_token,
  TOKEN_EOF,
  TOKEN_UNKNOWN,
  peekChar,
  peekCharLen,
  inputEncoding,
} from "../parser";

// Recovery fix: swapped costs so insertion (less destructive) is cheaper than deletion
export const ERROR_COST_PER_SKIPPED_TREE: i32 = 110;
export const ERROR_COST_PER_MISSING_TREE: i32 = 100;
export const ERROR_COST_PER_SKIPPED_CHAR: i32 = 1;
export const PENALTY_DELETE_NEWLINE_CROSS: i32 = 5000;
export const PENALTY_DELETE_LINE_END_DANGLING: i32 = 100;
export const PENALTY_STRUCTURAL_UNWIND: i32 = 800;
export const PENALTY_DELETE_CLOSE_BRACKET: i32 = 400;

// ----------------------------------------------------------------------------
// 4-Slot Unmanaged Recovery Lookahead Cache (cleared on frontier advance)
// ----------------------------------------------------------------------------
const REC_CACHE_SIZE: i32 = 4;
const recCachePos = new StaticArray<u32>(REC_CACHE_SIZE);
const recCacheState = new StaticArray<i32>(REC_CACHE_SIZE);
const recCacheVer = new StaticArray<u32>(REC_CACHE_SIZE);
const recCacheTok = new StaticArray<i32>(REC_CACHE_SIZE);
const recCacheLen = new StaticArray<u32>(REC_CACHE_SIZE);
const recCacheEnd = new StaticArray<u32>(REC_CACHE_SIZE);
let recCacheValidMask: u32 = 0;
let recCacheNextSlot: i32 = 0;
let recLastPeekLen: u32 = 0;
let recLastPeekEnd: u32 = 0;

/** Invalidates the 4-slot recovery lookahead cache in O(1) when the frontier moves. */
export function resetRecoveryLookaheadCache(): void {
  recCacheValidMask = 0;
  recCacheNextSlot = 0;
}

/**
 * Memoized wrapper around `peekNextTokenInState` keyed by `(pos, state, g_expectedVersion)`.
 * Stores matched token length and end offset in `recLastPeekLen` / `recLastPeekEnd`.
 */
function cachedPeekNextTokenInState(pos: u32, state: i32): i32 {
  let ver = g_expectedVersion;
  for (let i: i32 = 0; i < REC_CACHE_SIZE; i++) {
    if ((recCacheValidMask & (1 << i)) != 0) {
      if (unchecked(recCachePos[i]) == pos && unchecked(recCacheState[i]) == state && unchecked(recCacheVer[i]) == ver) {
        recLastPeekLen = unchecked(recCacheLen[i]);
        recLastPeekEnd = unchecked(recCacheEnd[i]);
        return unchecked(recCacheTok[i]);
      }
    }
  }
  let tok = peekNextTokenInState(pos, state);
  let slot = recCacheNextSlot;
  recCacheNextSlot = (recCacheNextSlot + 1) & 3;
  unchecked(recCachePos[slot] = pos);
  unchecked(recCacheState[slot] = state);
  unchecked(recCacheVer[slot] = ver);
  unchecked(recCacheTok[slot] = tok);
  unchecked(recCacheLen[slot] = lastPeekedTokenLen);
  unchecked(recCacheEnd[slot] = lastPeekedTokenEnd);
  recCacheValidMask |= (1 << slot);
  recLastPeekLen = lastPeekedTokenLen;
  recLastPeekEnd = lastPeekedTokenEnd;
  return tok;
}

/**
 * Searches the action table for a SHIFT transition for the given state and terminal token.
 */
export function findShiftTarget(state: i32, tok: u16): i32 {
  let matchIdx = findActionEntry(state, tok as i32);
  if (matchIdx == -1) return -1;
  let actCount = action_data[matchIdx + 1];
  let actPtr = matchIdx + 2;
  for (let a = 0; a < actCount; a++) {
    if (action_data[actPtr + a * 2] == ACTION_SHIFT) {
      return action_data[actPtr + a * 2 + 1];
    }
  }
  return -1;
}

/**
 * Wraps popped AST subtrees between startHead and endHead into a new ERROR AST node.
 * Operates in zero-alloc linear memory (Generation 0).
 */
/**
 * Wraps popped AST subtrees between startHead and endHead into a new ERROR AST node,
 * while retaining already-completed valid non-terminal subtrees (Completed Subtree Retention).
 * Operates in zero-alloc linear memory (Generation 0).
 */
export function wrapPoppedNodesInError(startHead: ParseHead, endHead: ParseHead, currentPos: u32): u32 {
  let count: u32 = 0;
  let curr: ParseHead | null = startHead;
  let totalBytes: u32 = 0;
  let maxHops: u32 = MAX_CHILD_NODES as u32;

  while (curr != null && curr != endHead && maxHops-- > 0) {
    let node = curr.astNode;
    let nextHead: ParseHead | null = curr.prev;
    if (nextHead != endHead && curr.firstEdge != 0) {
      let edgePtr = curr.firstEdge;
      while (edgePtr != 0) {
        let edge = changetype<GssEdge>(edgePtr);
        if (edge.targetHead == endHead) {
          node = edge.astNode;
          nextHead = edge.targetHead;
          break;
        }
        edgePtr = edge.nextEdge;
      }
    }
    if (node != 0) {
      if (count < (MAX_CHILD_NODES as u32)) {
        t_globalChildNodes[count] = node;
        count++;
      }
      totalBytes += getNodePadding(node) + getNodeByteLength(node);
    }
    curr = nextHead;
  }

  let pad: u32 = 0;
  if (count > 0) {
    pad = getNodePadding(t_globalChildNodes[count - 1]);
  }
  let basePos = endHead != null ? endHead.pos : 0;
  if (currentPos > 0 && currentPos > basePos) {
    let span = currentPos - basePos;
    if (span > totalBytes) totalBytes = span;
  }

  let errNode = allocNode(NODE_TYPE_ERROR, pad, totalBytes >= pad ? totalBytes - pad : totalBytes, 0, false);
  setNodeFlags(errNode, getNodeFlags(errNode) | FLAG_HAS_ERROR);

  let lastChild: u32 = 0;
  for (let i: i32 = (count as i32) - 1; i >= 0; i--) {
    let child = t_globalChildNodes[i];
    if (child == 0) continue;
    let clone = cloneNodeShallow(child);
    if (lastChild == 0) {
      setNodePadding(clone, 0); // Avoid double padding!
      setFirstChild(errNode, clone);
    } else {
      setNextSibling(lastChild, clone);
    }
    lastChild = clone;
  }

  if (lastChild != 0) {
    fixNodeLength(errNode);
  }

  return errNode;
}

/**
 * Entry in a recorded StackSummary.
 */
@unmanaged
export class StackSummaryEntry {
  ancHead: ParseHead | null;
  state: i32;
  depth: u32;
  pos: u32;
}

export const SIZEOF_STACK_SUMMARY_ENTRY: u32 = 16;

@inline
function hasSummaryAncestor(summaryMem: u32, count: u32, anc: ParseHead): boolean {
  for (let i: u32 = 0; i < count; i++) {
    let existing = changetype<StackSummaryEntry>(summaryMem + i * SIZEOF_STACK_SUMMARY_ENTRY);
    if (existing.ancHead == anc) return true;
  }
  return false;
}

/**
 * Records a single-pass summary of ancestor stack states up to MAX_SUMMARY_DEPTH (16).
 * Follows Tree-sitter's ts_stack_record_summary.
 */
export function recordStackSummary(head: ParseHead): void {
  if (head.summaryCount > 0) return;
  let summaryMem = allocGen0(MAX_SUMMARY_DEPTH * SIZEOF_STACK_SUMMARY_ENTRY);
  let count: u32 = 0;
  let curr = head.prev;
  let d: u32 = 1;
  while (curr != null && d <= MAX_SUMMARY_DEPTH && count < MAX_SUMMARY_DEPTH) {
    if (!(curr.pos == 0 && head.pos > 20 && d >= 2)) {
      if (!hasSummaryAncestor(summaryMem, count, curr)) {
        let entryPtr = summaryMem + count * SIZEOF_STACK_SUMMARY_ENTRY;
        let entry = changetype<StackSummaryEntry>(entryPtr);
        entry.ancHead = curr;
        entry.state = curr.state;
        entry.depth = d;
        entry.pos = curr.pos;
        count++;
      }

      // Also record alternative predecessors along firstEdge at this depth
      let edgePtr = curr.firstEdge;
      while (edgePtr != 0 && count < MAX_SUMMARY_DEPTH) {
        let edge = changetype<GssEdge>(edgePtr);
        let altCurr = edge.targetHead;
        if (altCurr != null && !hasSummaryAncestor(summaryMem, count, altCurr)) {
          let altEntryPtr = summaryMem + count * SIZEOF_STACK_SUMMARY_ENTRY;
          let altEntry = changetype<StackSummaryEntry>(altEntryPtr);
          altEntry.ancHead = altCurr;
          altEntry.state = altCurr.state;
          altEntry.depth = d;
          altEntry.pos = altCurr.pos;
          count++;
        }
        edgePtr = edge.nextEdge;
      }
    }
    curr = curr.prev;
    d++;
  }
  head.summaryPtr = summaryMem;
  head.summaryCount = count;
}

/**
 * Stack Summary Error Recovery (Tree-sitter Strategy 1: Recover to State).
 * Evaluates the recorded StackSummary to find an ancestor state that can
 * legally shift or reduce with the lookahead token.
 * Pops and groups the damaged subtrees into an ERROR node, and resumes normal parsing.
 */
export function recoverStackSummary(head: ParseHead, token: i32, pos: u32): boolean {
  if (token == TOKEN_EOF) return false;
  if (head.summaryCount == 0) {
    recordStackSummary(head);
  }
  if (head.summaryCount == 0) return false;

  let currentCost = head.errorCost;
  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;

  // Recovery fix: fork up to 3 recovery candidates instead of returning on the first match
  let forkCount: u32 = 0;
  const MAX_FORKS: u32 = 3;

  for (let i: u32 = 0; i < head.summaryCount; i++) {
    let entry = changetype<StackSummaryEntry>(head.summaryPtr + i * SIZEOF_STACK_SUMMARY_ENTRY);
    let anc = entry.ancHead;
    if (anc == null) continue;
    let ancState = entry.state;
    let depth = entry.depth;

    if (ancState >= 0 && ancState < action_offsets.length) {
      let canAccept = stateCanAccept(anc, ancState, token, 0, 0);
      if (canAccept > 0) {
        // Compute structural/bracket unwind penalty and check dominance BEFORE allocating AST clones
        let structuralPenalty: i32 = 0;
        let scanH: ParseHead | null = head;
        let scanHops: u32 = depth + 2;
        while (scanH != null && scanH != anc && scanHops-- > 0) {
          let sNode = scanH.astNode;
          if (sNode != 0) {
            let sType = getNodeType(sNode) as i32;
            if (sType > 0 && sType < type_is_structural.length && type_is_structural[sType] == 1) {
              structuralPenalty += PENALTY_STRUCTURAL_UNWIND;
            }
            if ((getNodeFlags(sNode) & FLAG_IS_LIST) != 0) {
              structuralPenalty += PENALTY_STRUCTURAL_UNWIND;
            }
            if (sType > 0 && sType < token_bracket_deltas.length && token_bracket_deltas[sType] > 0) {
              structuralPenalty += PENALTY_DELETE_CLOSE_BRACKET;
            }
          }
          scanH = scanH.prev;
        }
        let approxCost: i32 = currentCost + ((depth as i32) * ERROR_COST_PER_SKIPPED_TREE) + structuralPenalty;
        if (
          changetype<usize>(t_nextSummary) != 0 &&
          !t_nextSummary.hasOverflow &&
          t_nextSummary.healthyCount > 0 &&
          t_nextSummary.unconfirmedRepairs == 0 &&
          t_nextSummary.minHealthyCost < approxCost &&
          t_nextSummary.minHealthyCostPos >= pos
        ) {
          let costDiff = approxCost - t_nextSummary.minHealthyCost;
          if ((costDiff as i64) * (1 + (t_nextSummary.maxHealthyNodeCount as i64)) > (MAX_COST_DIFFERENCE as i64)) {
            continue;
          }
        }

        let errNode = wrapPoppedNodesInError(head, anc, pos);
        let firstPad: u32 = getNodePadding(errNode);

        let diagStart: u32 = anc.pos + firstPad;
        let diagEnd: u32 = diagStart + getNodeByteLength(errNode);
        if (pos > diagEnd) diagEnd = pos;

        // Narrow diagStart past valid (non-error) children of the error node.
        // When depth > 0, the error node wraps popped stack nodes that were
        // successfully parsed. The diagnostic should only cover the disruption
        // point (after the valid nodes), not the valid content itself.
        if (depth > 0) {
          let firstChild = getNodeFirstChild(errNode);
          if (firstChild != 0) {
            let child = firstChild;
            let childOff: u32 = diagStart;
            let idx = 0;
            while (child != 0) {
              if (idx > 0) childOff += getNodeLeadingPad(child);
              let cFlags = getNodeFlags(child);
              let cType = getNodeType(child);
              if (cType != 0 && (cFlags & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) == 0) {
                childOff += getNodeByteLength(child);
              } else {
                break;
              }
              idx++;
              child = getNodeNextSibling(child);
            }
            if (child != 0) {
              diagStart = childOff;
            } else {
              // All popped children were non-error nodes: narrow past the first valid
              // child onto the second child (if present), matching lsp.ts CST extraction.
              let secondChild = getNodeNextSibling(firstChild);
              if (secondChild != 0) {
                let nextStart = diagStart + getNodeByteLength(firstChild) + getNodeLeadingPad(secondChild);
                if (nextStart < diagEnd) {
                  diagStart = nextStart;
                }
              }
            }
          }
        }
        if (diagEnd <= diagStart) {
          diagStart = srcLexPos;
          diagEnd = srcLexPos + tLen;
        }

        let errLen = diagEnd > diagStart ? diagEnd - diagStart : 1;
        let penalty: i32 = ((depth as i32) * ERROR_COST_PER_SKIPPED_TREE) + ((errLen as i32) * ERROR_COST_PER_SKIPPED_CHAR) + structuralPenalty;
        let exp = getExpectedTokensForState(ancState);
        let nextTail = pushDiagnostic(anc.errorTail, diagStart, diagEnd, token as u32, 2, (exp & 0xffffffff) as u32, ((exp >>> 32) & 0xffffffff) as u32);

        let targetNode = errNode;
        let parentHead: ParseHead | null = anc;

        let errHead = allocParseHead(
          ancState,
          targetNode,
          parentHead,
          pos,
          anc.scannerState,
          currentCost + penalty,
          0,
          anc.balanceHash,
          0,
          anc.dynamicPrec,
          0,
          nextTail,
          0,
          false,
          0,
          0,
          0,
          0
        );
        pushNextHead(changetype<u32>(errHead));
        forkCount++;
        if (forkCount >= MAX_FORKS) return true;
      }
    }
  }
  return forkCount > 0;
}

/**
 * Tree-sitter Strategy 2: Single-Token Error Shift.
 * Consumes the current invalid lookahead token, appends it into an active ERROR node container,
 * advances byte position past the token, and pushes the head to t_nextHeads remaining in inErrorState.
 */
export function recoverSkipToken(head: ParseHead, token: i32, pos: u32): void {
  if (token >= 0 && token < token_delete_costs.length && token_delete_costs[token] >= 1000) return;

  if (head.summaryCount == 0) {
    recordStackSummary(head);
  }

  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;
  let pad = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
  
  let childTokType = (token == TOKEN_UNKNOWN || token == -1 ? NODE_TYPE_ERROR : token) as u16;
  let tNode = head.errorNode;
  let lastChild = head.errorLastChild;
  if (tNode == 0) {
    tNode = allocNode(NODE_TYPE_ERROR, pad, tLen, 0, false);
    setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
    let childLeaf = allocNode(childTokType, 0, tLen, 0, false);
    setNodeFlags(childLeaf, getNodeFlags(childLeaf) | FLAG_HAS_ERROR);
    setFirstChild(tNode, childLeaf);
    lastChild = childLeaf;
  } else {
    // O(1) Pure Copy-on-Write: wrap a shallow clone of `oldNode` as an invisible spine child
    // alongside the new `childLeaf`, avoiding O(K^2) cloning across K consecutive skipped tokens
    // while never mutating `oldNode` or any shared sibling pointers.
    let oldNode = tNode;
    let prevByteLen = getNodeByteLength(oldNode);
    tNode = allocNode(NODE_TYPE_ERROR, getNodePadding(oldNode), prevByteLen + pad + tLen, 0, false);
    setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
    let oldSpine = cloneNodeShallow(oldNode);
    setNodePadding(oldSpine, 0);
    setNodeFlags(oldSpine, getNodeFlags(oldSpine) | FLAG_INVISIBLE | FLAG_IS_LIST | FLAG_HAS_ERROR);
    let childLeaf = allocNode(childTokType, pad, tLen, 0, false);
    setNodeFlags(childLeaf, getNodeFlags(childLeaf) | FLAG_HAS_ERROR);
    setFirstChild(tNode, oldSpine);
    setNextSibling(oldSpine, childLeaf);
    lastChild = childLeaf;
  }

  let nextPos = srcLexPos + tLen;
  let newPos = nextPos > pos ? nextPos : pos + 1;
  let diagStart = srcLexPos;
  let diagEnd = srcLexPos + tLen;
  let exp = getExpectedTokensForState(head.state);
  let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd, childTokType as u32, 2, (exp & 0xffffffff) as u32, ((exp >>> 32) & 0xffffffff) as u32);

  let crossedNl = false;
  let p = pos;
  while (p < srcLexPos) {
    let ch = peekChar(p);
    if (ch == 10 || ch == 13) {
      crossedNl = true;
      break;
    }
    let cl = peekCharLen(p);
    p += cl > 0 ? cl : 1;
  }

  let hasNl = false;
  let pNl = nextPos;
  while (pNl < inputLength) {
    let ch = peekChar(pNl);
    if (ch == 10 || ch == 13) {
      hasNl = true;
      break;
    }
    if (ch != 32 && ch != 9) break;
    let cl = peekCharLen(pNl);
    pNl += cl > 0 ? cl : 1;
  }
  let nlPenalty: i32 = crossedNl ? PENALTY_DELETE_NEWLINE_CROSS : (hasNl ? PENALTY_DELETE_LINE_END_DANGLING : 0);
  if (crossedNl) {
    let prevIndent = lineIndentAt(pos);
    let nextIndent = lineIndentAt(srcLexPos);
    if (nextIndent <= prevIndent) {
      nlPenalty += 200; // Outer/same-indentation newline barrier
    }
  }

  let unconfirmedPenalty: i32 = head.successfulShifts < 2 ? 60 : 0;
  let closeBracketPenalty: i32 = 0;
  if (isExtraCloser(head.balanceHash, token)) {
    closeBracketPenalty = -50; // Strongly prefer deleting an unmatched extra closer
  } else if (
    (head.balanceHash & 0xff) > 0 &&
    token >= 0 &&
    token < token_bracket_deltas.length &&
    token_bracket_deltas[token] < 0 &&
    !isMismatchedCloser(head.balanceHash, token)
  ) {
    closeBracketPenalty = PENALTY_DELETE_CLOSE_BRACKET;
  }
  let parentHead: ParseHead | null = head.errorNode != 0 ? head.prev : head;
  let skippedHead = allocParseHead(
    head.state,
    tNode,
    parentHead,
    newPos,
    head.scannerState,
    head.errorCost + ERROR_COST_PER_SKIPPED_TREE + unconfirmedPenalty + nlPenalty + closeBracketPenalty + (tLen as i32) * ERROR_COST_PER_SKIPPED_CHAR,
    0,
    head.balanceHash,
    0,
    head.dynamicPrec,
    0,
    nextTail,
    0,
    true,
    head.summaryPtr,
    head.summaryCount,
    0,
    tNode,
    lastChild
  );
  pushNextHead(changetype<u32>(skippedHead));
}

export let lastKeywordMatchSpan: u32 = 0;

export let lastKeywordMatchChars: u32 = 0;

/**
 * Calculates a penalty for substituting the text at `pos` with grammar keyword terminal `sym`.
 * Compares characters branchlessly with lowercase ASCII normalization.
 * Handles split-word typos like "mo del" -> "model" by inspecting downstream characters.
 */
@inline
function lineIndentAt(p: u32): u32 {
  let start = p;
  let steps: u32 = 0;
  while (start > 0 && steps++ < 128) {
    let ch = peekChar(start - 1);
    if (ch == 10 || ch == 13) break;
    start--;
  }
  let indent: u32 = 0;
  while (start < inputLength && indent < 128) {
    let ch = peekChar(start);
    if (ch == 32) indent++;
    else if (ch == 9) indent += 2;
    else break;
    start++;
  }
  return indent;
}

/**
 * True if ASCII/lowercase input slice `[pos, pos + inLen)` is within Damerau-Levenshtein
 * distance 1 of the keyword at `token_string_bytes[kwOffset + 1 .. kwOffset + kwLen]`.
 * Zero allocations; handles 1-transposition ("fucntion"), 1-deletion ("paramter"),
 * 1-insertion ("letr"), or 1-substitution ("modol").
 */
@inline
function isDamerauDist1(pos: u32, inLen: u32, kwOffset: i32, kwLen: u32): bool {
  if (inLen == 0 || kwLen < 4 || pos + inLen > inputLength) return false;
  let diff: i32 = (inLen as i32) - (kwLen as i32);
  if (diff < -1 || diff > 1) return false;
  let i: u32 = 0;
  let j: u32 = 0;
  let edits: i32 = 0;
  while (i < inLen && j < kwLen) {
    let c1 = peekChar(pos + i);
    if (c1 >= 65 && c1 <= 90) c1 += 32;
    let c2 = token_string_bytes[kwOffset + 1 + j] as u32;
    if (c2 >= 65 && c2 <= 90) c2 += 32;
    if (c1 == c2) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (diff == 0) {
      if (i + 1 < inLen && j + 1 < kwLen) {
        let n1 = peekChar(pos + i + 1);
        if (n1 >= 65 && n1 <= 90) n1 += 32;
        let n2 = token_string_bytes[kwOffset + 1 + j + 1] as u32;
        if (n2 >= 65 && n2 <= 90) n2 += 32;
        if (c1 == n2 && n1 == c2) {
          i += 2;
          j += 2;
          continue;
        }
      }
      i++;
      j++;
    } else if (diff > 0) {
      i++;
    } else {
      j++;
    }
  }
  if (i < inLen || j < kwLen) edits++;
  return edits <= 1;
}

function computeKeywordSimilarityPenalty(pos: u32, len: u32, sym: i32, state: i32): i32 {
  lastKeywordMatchSpan = len;
  lastKeywordMatchChars = 0;
  if (changetype<usize>(token_string_offsets) == 0 || sym < 0 || sym >= token_string_offsets.length) return 50;
  let offset = token_string_offsets[sym];
  if (offset < 0 || offset >= token_string_bytes.length) return 50;

  let kwLen = token_string_bytes[offset] as u32;
  if (kwLen == 0) return 50;

  if (kwLen >= 4 && isDamerauDist1(pos, len, offset, kwLen)) {
    lastKeywordMatchChars = kwLen;
    return 10;
  }

  let matchChars: u32 = 0;
  let alignedChars: u32 = 0;
  let kwCursor: u32 = 0;
  let inputCharCount: u32 = 0;
  let currP = pos;
  while (currP < pos + len && currP < inputLength) {
    let inputCh = peekChar(currP);
    let chLen = peekCharLen(currP);
    if (chLen == 0) chLen = 1;
    let inNorm = (inputCh >= 65 && inputCh <= 90) ? inputCh + 32 : inputCh;
    if (matchChars < kwLen) {
      let kwCh = token_string_bytes[offset + 1 + matchChars];
      let kwNorm = (kwCh >= 65 && kwCh <= 90) ? kwCh + 32 : kwCh;
      if (inNorm == kwNorm && matchChars == inputCharCount) {
        matchChars++;
      }
    }
    if (kwCursor < kwLen) {
      let kwCh = token_string_bytes[offset + 1 + kwCursor];
      let kwNorm = (kwCh >= 65 && kwCh <= 90) ? kwCh + 32 : kwCh;
      if (inNorm == kwNorm) {
        alignedChars++;
        kwCursor++;
      } else if (kwCursor + 1 < kwLen) {
        let nextKwCh = token_string_bytes[offset + 1 + kwCursor + 1];
        let nextKwNorm = (nextKwCh >= 65 && nextKwCh <= 90) ? nextKwCh + 32 : nextKwCh;
        if (inNorm == nextKwNorm) {
          alignedChars++;
          kwCursor += 2;
        } else if (currP + chLen < pos + len && currP + chLen < inputLength) {
          let nextInCh = peekChar(currP + chLen);
          let nextInNorm = (nextInCh >= 65 && nextInCh <= 90) ? nextInCh + 32 : nextInCh;
          if (nextInNorm != kwNorm) {
            kwCursor++;
          }
        }
      }
    }
    inputCharCount++;
    currP += chLen;
  }

  // Also check if combined with next lexer token ("mo" + "del" = "model")
  let combinedMatch = false;
  if (matchChars == inputCharCount && matchChars < kwLen) {
    let remainingKw = kwLen - matchChars;
    let nextTok = cachedPeekNextTokenInState(currP, state);
    let isNextWord = nextTok > 0 && nextTok <= MAX_TERMINAL_ID && token_is_word.length > nextTok && token_is_word[nextTok] == 1;
    if (isNextWord && recLastPeekLen == remainingKw && recLastPeekEnd >= remainingKw) {
      let scanP = recLastPeekEnd - remainingKw;
      let nextMatch: u32 = 0;
      while (nextMatch < remainingKw && scanP < recLastPeekEnd) {
        let ch = peekChar(scanP);
        let chLen = peekCharLen(scanP);
        if (chLen == 0) chLen = 1;
        let kwCh = token_string_bytes[offset + 1 + matchChars + nextMatch];
        let inNorm = (ch >= 65 && ch <= 90) ? ch + 32 : ch;
        let kwNorm = (kwCh >= 65 && kwCh <= 90) ? kwCh + 32 : kwCh;
        if (inNorm == kwNorm) {
          nextMatch++;
          scanP += chLen;
        } else {
          break;
        }
      }
      if (nextMatch == remainingKw) {
        combinedMatch = true;
        lastKeywordMatchSpan = recLastPeekEnd - pos;
      }
    }
  }

  if (combinedMatch) {
    lastKeywordMatchChars = kwLen;
    return 0; // Perfect combined split-word typo match!
  }

  // Credit edit-distance character alignment for typos (e.g. "flse" -> "else", "whle" -> "while")
  // when at least 2 characters and at least half the keyword align in order.
  if (alignedChars > matchChars && alignedChars >= 2 && alignedChars * 2 >= kwLen) {
    matchChars = alignedChars;
  }

  lastKeywordMatchChars = matchChars;
  let delta = kwLen > matchChars ? (kwLen - matchChars) : kwLen;
  if (inputCharCount > kwLen) {
    delta += (inputCharCount - kwLen);
  }
  let penalty: i32 = (delta as i32) * 15 + (matchChars == 0 ? 10 : 0);
  return penalty;
}

@inline
function computeNextBalanceHash(balanceHash: u32, sym: i32): u32 {
  return updateBalanceHash(balanceHash, sym);
}

/** True if the most recent `recoverMissingToken` call confirmed 2 tokens of lookahead. */
export let g_missingConfirmedTwoTokens: bool = false;

@inline
function confirmTwoTokenLookahead(head: ParseHead, nextState: i32, tok: i32, afterTokPos: u32): bool {
  let shiftTarget = findShiftTarget(nextState, tok as u16);
  if (shiftTarget == -1) return false;
  if (afterTokPos >= inputLength) return true;
  let secondTok = cachedPeekNextTokenInState(afterTokPos, shiftTarget);
  if (secondTok == TOKEN_EOF) return true;
  return stateCanAccept(head, shiftTarget, secondTok, 0, 1) > 0;
}

function findShiftTargetThroughEpsilons(head: ParseHead, state: i32, sym: i32): ParseHead | null {
  let currHead = head;
  let currState = state;
  let maxHops = 10;

  while (maxHops-- > 0) {
    let matchIdx = findActionEntry(currState, sym);
    if (matchIdx == -1) return null;

    let actCount = action_data[matchIdx + 1];
    let rIdx = matchIdx + 2;
    let found = false;

    for (let a = 0; a < actCount; a++) {
      let aType = action_data[rIdx++];
      let aTarget = action_data[rIdx++];
      if (aType == ACTION_SHIFT) {
        return allocParseHead(
          aTarget,
          0,
          currHead,
          currHead.pos,
          currHead.scannerState,
          currHead.errorCost,
          currHead.successfulShifts,
          currHead.balanceHash,
          currHead.consecutiveInsertions,
          currHead.dynamicPrec,
          currHead.pendingPadding,
          currHead.errorTail
        );
      } else if (aType == ACTION_REDUCE && aTarget >= 0 && aTarget < prod_lengths.length && prod_lengths[aTarget] == 0) {
        let lhs = prod_lhs[aTarget];
        let nextSt = lookupGoto(currState, lhs);
        if (nextSt != -1) {
          let redNode = allocNode(lhs as u16, 0, 0, 0, false);
          currHead = allocParseHead(
            nextSt,
            redNode,
            currHead,
            currHead.pos,
            currHead.scannerState,
            currHead.errorCost,
            currHead.successfulShifts,
            currHead.balanceHash,
            currHead.consecutiveInsertions,
            currHead.dynamicPrec,
            currHead.pendingPadding,
            currHead.errorTail
          );
          currState = nextSt;
          found = true;
          break;
        }
      }
    }
    if (!found) break;
  }
  return null;
}

function tryRecoverMissingInState(head: ParseHead, state: i32, token: i32, pos: u32, depth: i32): boolean {
  if (head.errorCost > 0 && head.successfulShifts == 0) return false;
  if (depth > 2 || state < 0 || state >= action_offsets.length) return false;

  let foundAny = false;
  let precomputedInsertedSym: i32 = -1;

  let insDiagStart = srcLexPos;
  let insDiagEnd = srcLexPos + (lexLen > 0 ? lexLen : 1);
  if (pos > 0) {
    let prevSpan = getRightmostLeafSpan(head, pos);
    let pStart = (prevSpan >>> 32) as u32;
    let pEnd = (prevSpan & 0xffffffff) as u32;
    if (pEnd > pStart && pEnd == pos) {
      insDiagStart = pStart;
      insDiagEnd = pEnd;
    }
  }

  // 1. O(1) Precomputed Fast Path for missing token insertions
  let fastCheapInsertionConfirmed = false;
  if (depth == 0 && changetype<usize>(precomputed_repairs) != 0 && token >= 0 && token <= MAX_TERMINAL_ID) {
    let bestRep = precomputed_repairs[state * (MAX_TERMINAL_ID + 1) + token];
    if (bestRep > 0 && bestRep <= MAX_TERMINAL_ID) {
      let insCost = token_insert_costs.length > bestRep ? (token_insert_costs[bestRep] as i32) : 1;
      let isDelimLookahead = token >= 0 && token < token_insert_costs.length && token_insert_costs[token] <= 3;
      if (insCost < 50 || (isDelimLookahead && insCost <= 50) || bestRep == 1) {
        let aTarget = findShiftTarget(state, bestRep as u16);
        if (aTarget != -1 && stateCanAccept(head, aTarget, token, 0, 1) > 0) {
          let insNode = allocNode(bestRep as u16, 0, 0, 0, false);
          setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

          let nextTail = pushDiagnostic(head.errorTail, insDiagStart, insDiagEnd, bestRep as u32, 1, bestRep as u32, 0);

          let repairCost: i32 = isDelimLookahead ? ERROR_COST_PER_MISSING_TREE : (insCost * ERROR_COST_PER_MISSING_TREE);
          let insHead = allocParseHead(
            aTarget,
            insNode,
            head,
            pos,
            head.scannerState,
            head.errorCost + repairCost,
            0,
            computeNextBalanceHash(head.balanceHash, bestRep),
            head.consecutiveInsertions + 1,
            head.dynamicPrec,
            head.pendingPadding,
            nextTail
          );
          pushNextHead(changetype<u32>(insHead));
          precomputedInsertedSym = bestRep;
          foundAny = true;
          if (insCost == 1) {
            fastCheapInsertionConfirmed = true;
          }
        }
      }
    }
  }

  // 1b. O(1) Precomputed Non-Terminal Placeholder Insertion (GOTO-based recovery for e.g. `Real x = ;`)
  if (depth == 0 && !fastCheapInsertionConfirmed && changetype<usize>(precomputed_nt_repairs) != 0 && token > 0 && token <= MAX_TERMINAL_ID) {
    let bestNt = precomputed_nt_repairs[state * (MAX_TERMINAL_ID + 1) + token];
    if (bestNt > 0) {
      let ntTarget = lookupGoto(state, bestNt);
      if (ntTarget != -1 && stateCanAccept(head, ntTarget, token, 0, 1) > 0) {
        let ntNode = allocNode(bestNt as u16, 0, 0, 0, false);
        setNodeFlags(ntNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

        let nextTail = pushDiagnostic(head.errorTail, insDiagStart, insDiagEnd, bestNt as u32, 1, bestNt as u32, 0);
        let ntHead = allocParseHead(
          ntTarget,
          ntNode,
          head,
          pos,
          head.scannerState,
          head.errorCost + ERROR_COST_PER_MISSING_TREE + 20,
          0,
          head.balanceHash,
          head.consecutiveInsertions + 1,
          head.dynamicPrec,
          head.pendingPadding,
          nextTail
        );
        pushNextHead(changetype<u32>(ntHead));
        foundAny = true;
      }
    }
  }

  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) return foundAny;

  let rCount = action_data[actionOffset];
  let rIdx = actionOffset + 1;
  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;
  let curSrcLexPos = srcLexPos;
  let curTLen = tLen;

  let bestSubstPenalty: i32 = 999999;
  let bestSubstSym: i32 = -1;
  let bestSubstResolvedHead: ParseHead | null = null;
  let bestSubstSpan: u32 = curTLen;

  let isInputWord = token > 0 && token <= MAX_TERMINAL_ID && token_is_word.length > token ? (token_is_word[token] == 1) : false;
  let seenEps0: i32 = -1;
  let seenEps1: i32 = -1;
  let seenEps2: i32 = -1;
  let seenEps3: i32 = -1;

  for (let j = 0; j < rCount; j++) {
    let sym = action_data[rIdx++];
    let actCount = action_data[rIdx++];
    let isWordSym = sym > 0 && sym <= MAX_TERMINAL_ID && token_is_word.length > sym ? (token_is_word[sym] == 1) : false;

    // Strategy A: Keyword / Token Substitution & Merged-Token Prefix Split
    if (isInputWord && isWordSym && !fastCheapInsertionConfirmed) {
      // Strategy A2: Merged-token prefix split (e.g. "endM;" -> "end" + "M;", "Realx;" -> "Real" + "x;")
      // Read-only on input buffer: emits a leaf of length kwLen and advances pos to curSrcLexPos + kwLen.
      if (
        depth == 0 &&
        sym != token &&
        curTLen >= 3 &&
        changetype<usize>(token_string_offsets) != 0 &&
        sym < token_string_offsets.length
      ) {
        let kwOff = token_string_offsets[sym];
        if (kwOff >= 0 && kwOff < token_string_bytes.length) {
          let kwLen = token_string_bytes[kwOff] as u32;
          if (kwLen >= 2 && kwLen < curTLen && curSrcLexPos + kwLen < inputLength) {
            let prefixOk = true;
            let scanP = curSrcLexPos;
            for (let ki: u32 = 0; ki < kwLen; ki++) {
              let ch = peekChar(scanP);
              let chLen = peekCharLen(scanP);
              if (chLen == 0) chLen = 1;
              if (ch != token_string_bytes[kwOff + 1 + ki]) {
                prefixOk = false;
                break;
              }
              scanP += chLen;
            }
            if (prefixOk && scanP == curSrcLexPos + kwLen) {
              let splitTarget = findShiftTarget(state, sym as u16);
              if (splitTarget != -1) {
                let remTok = cachedPeekNextTokenInState(scanP, splitTarget);
                if (stateCanAccept(head, splitTarget, remTok, 0, 1) > 0) {
                  let splitPad = (curSrcLexPos > pos ? curSrcLexPos - pos : 0) + head.pendingPadding;
                  let splitNode = allocNode(sym as u16, splitPad, kwLen, 0, false);
                  setNodeFlags(splitNode, FLAG_HAS_ERROR);
                  let nextTail = pushDiagnostic(head.errorTail, curSrcLexPos, curSrcLexPos + curTLen, sym as u32, 2, sym as u32, 0);
                  let splitHead = allocParseHead(
                    splitTarget,
                    splitNode,
                    head,
                    scanP,
                    head.scannerState,
                    head.errorCost + ERROR_COST_PER_MISSING_TREE + 10,
                    0,
                    computeNextBalanceHash(head.balanceHash, sym),
                    0,
                    head.dynamicPrec,
                    0,
                    nextTail
                  );
                  pushNextHead(changetype<u32>(splitHead));
                  foundAny = true;
                }
              }
            }
          }
        }
      }

      let simPenalty = computeKeywordSimilarityPenalty(curSrcLexPos, curTLen, sym, state);
      if (simPenalty < bestSubstPenalty) {
        let span = lastKeywordMatchSpan;
        let matchCount = lastKeywordMatchChars;
        let resolvedHead = findShiftTargetThroughEpsilons(head, state, sym);
        if (resolvedHead != null) {
          let nextPosAfterTok = curSrcLexPos + span;
          let nextTok = cachedPeekNextTokenInState(nextPosAfterTok, resolvedHead.state);
          let canAcceptAfterSubst = stateCanAccept(resolvedHead, resolvedHead.state, nextTok, 0, 0);
          if (canAcceptAfterSubst > 0) {
            let confirmed = true;
            if (matchCount == 0 || curTLen <= 2) {
              // If the input word shares zero characters with the keyword (e.g. "some" vs "let"),
              // or is a short incomplete prefix (e.g. "le"), require lookahead confirmation on the second token.
              confirmed = false;
              if (canAcceptAfterSubst >= 1) {
                let shiftedState = canAcceptAfterSubst - 1;
                let nextPos2 = recLastPeekEnd;
                if (nextPos2 < inputLength) {
                  let nextTok2 = cachedPeekNextTokenInState(nextPos2, shiftedState);
                  if (stateCanAccept(null, shiftedState, nextTok2, 0, 0) > 0 || lookupActions(shiftedState, nextTok2) > 0) {
                    confirmed = true;
                  }
                } else {
                  confirmed = true;
                }
              }
            }

            // Guard: If the very next token at nextPosAfterTok in `state` is ALREADY the target keyword `sym`,
            // this is a stray token before the actual keyword, NOT a keyword substitution!
            if (confirmed && cachedPeekNextTokenInState(nextPosAfterTok, state) == sym) {
              confirmed = false;
            }

            if (confirmed) {
              bestSubstPenalty = simPenalty;
              bestSubstSym = sym;
              bestSubstResolvedHead = resolvedHead;
              bestSubstSpan = span;
            }
          }
        }
      }
    }

    for (let a = 0; a < actCount; a++) {
      let aType = action_data[rIdx++];
      let aTarget = action_data[rIdx++];

      if (aType == ACTION_SHIFT && sym > 0 && sym <= MAX_TERMINAL_ID) {
        let isDelimLookahead = token >= 0 && token < token_insert_costs.length && token_insert_costs[token] <= 3;
        let isDelimSym = token_insert_costs.length > sym && token_insert_costs[sym] <= 3;
        if (!isInputWord && isDelimLookahead && isDelimSym) {
          let nextPosAfterTok = curSrcLexPos + curTLen;
          let nextTok = cachedPeekNextTokenInState(nextPosAfterTok, aTarget);
          let canAcceptAfterSubst = stateCanAccept(head, aTarget, nextTok, 0, 1);
          if (canAcceptAfterSubst > 0) {
            let pad = (curSrcLexPos > pos ? curSrcLexPos - pos : 0) + head.pendingPadding;
            let mutatedNode = allocNode(sym as u16, pad, curTLen, 0, false);
            setNodeFlags(mutatedNode, FLAG_HAS_ERROR);

            let diagStart = curSrcLexPos;
            let diagEnd = curSrcLexPos + curTLen;
            let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd, sym as u32, 2, sym as u32, 0);

            let substCost: i32 = ERROR_COST_PER_MISSING_TREE;
            if (isMismatchedCloser(head.balanceHash, token) && matchesTopBracketKind(head.balanceHash, sym)) {
              substCost = ERROR_COST_PER_MISSING_TREE > 50 ? ERROR_COST_PER_MISSING_TREE - 50 : 10;
            }
            let substHead = allocParseHead(
              aTarget,
              mutatedNode,
              head,
              nextPosAfterTok,
              head.scannerState,
              head.errorCost + substCost,
              0,
              computeNextBalanceHash(head.balanceHash, sym),
              0,
              head.dynamicPrec,
              0,
              nextTail
            );
            pushNextHead(changetype<u32>(substHead));
            foundAny = true;
          }
        }

        // Strategy B: Missing Token Insertion (0-width sym, keeping current token in stream)
        // Fast-path bitset gate: skip stateCanAccept when token is not reachable at distance 0 from aTarget.
        if (sym != precomputedInsertedSym && isReachableZeroDist(aTarget, token)) {
          let insCost: i32 = token_insert_costs.length > sym ? (token_insert_costs[sym] as i32) : 1;
          if (insCost < 50 || (isDelimLookahead && insCost <= 50) || sym == 1 || pos == 0) {
            let canAcceptNext = stateCanAccept(head, aTarget, token, 0, 1);
            if (canAcceptNext > 0) {
              let insNode = allocNode(sym as u16, 0, 0, 0, false);
              setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

              let nextTail = pushDiagnostic(head.errorTail, insDiagStart, insDiagEnd, sym as u32, 1, sym as u32, 0);

              let repairCost: i32 = isDelimLookahead ? ERROR_COST_PER_MISSING_TREE : (insCost * ERROR_COST_PER_MISSING_TREE);
              let insHead = allocParseHead(
                aTarget,
                insNode,
                head,
                pos,
                head.scannerState,
                head.errorCost + repairCost,
                0,
                computeNextBalanceHash(head.balanceHash, sym),
                head.consecutiveInsertions + 1,
                head.dynamicPrec,
                head.pendingPadding,
                nextTail
              );

              pushNextHead(changetype<u32>(insHead));
              if (!g_missingConfirmedTwoTokens && confirmTwoTokenLookahead(head, aTarget, token, curSrcLexPos + curTLen)) {
                g_missingConfirmedTwoTokens = true;
              }
              foundAny = true;
            }
          }
        }
      } else if (aType == ACTION_REDUCE && aTarget >= 0 && aTarget < prod_lengths.length && prod_lengths[aTarget] == 0) {
        if (aTarget == seenEps0 || aTarget == seenEps1 || aTarget == seenEps2 || aTarget == seenEps3) {
          continue;
        }
        if (seenEps0 == -1) seenEps0 = aTarget;
        else if (seenEps1 == -1) seenEps1 = aTarget;
        else if (seenEps2 == -1) seenEps2 = aTarget;
        else if (seenEps3 == -1) seenEps3 = aTarget;

        let lhs = prod_lhs[aTarget];
        let nextSt = lookupGoto(state, lhs);
        if (nextSt != -1) {
          let redNode = allocNode(lhs as u16, 0, 0, 0, false);
          let redHead = allocParseHead(
            nextSt,
            redNode,
            head,
            pos,
            head.scannerState,
            head.errorCost,
            head.successfulShifts,
            head.balanceHash,
            head.consecutiveInsertions,
            head.dynamicPrec,
            head.pendingPadding,
            head.errorTail
          );
          if (tryRecoverMissingInState(redHead, nextSt, token, pos, depth + 1)) {
            foundAny = true;
          }
        }
      }
    }
  }

  // Push the best scored keyword substitution candidate
  if (bestSubstResolvedHead != null) {
    let nextPosAfterTok = curSrcLexPos + bestSubstSpan;
    let pad = (curSrcLexPos > pos ? curSrcLexPos - pos : 0) + head.pendingPadding;
    let mutatedNode = allocNode(bestSubstSym as u16, pad, bestSubstSpan, 0, false);
    setNodeFlags(mutatedNode, FLAG_HAS_ERROR);

    let diagStart = curSrcLexPos;
    let diagEnd = curSrcLexPos + bestSubstSpan;
    let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd, bestSubstSym as u32, 2, bestSubstSym as u32, 0);

    let substHead = allocParseHead(
      bestSubstResolvedHead.state,
      mutatedNode,
      bestSubstResolvedHead.prev,
      nextPosAfterTok,
      head.scannerState,
      head.errorCost + ERROR_COST_PER_MISSING_TREE + bestSubstPenalty,
      0,
      computeNextBalanceHash(head.balanceHash, bestSubstSym),
      0,
      head.dynamicPrec,
      0,
      nextTail
    );
    pushNextHead(changetype<u32>(substHead));
    foundAny = true;
  }

  return foundAny;
}

/**
 * MRD-Guided EOF Completion: inserts up to `MAX_EOF_COMPLETIONS` minimal closing delimiters
 * (e.g. `)`, `]`, `}`, `;`, `end`) when hitting `TOKEN_EOF` inside an incomplete construct.
 * Read-only on existing heads; allocates new `ParseHead`s in Gen0 only along the completing chain.
 */
function recoverAtEof(head: ParseHead, pos: u32): boolean {
  if (head.consecutiveInsertions >= 6) return false;
  let currHead = head;
  let currState = head.state;
  let inserted = 0;

  let diagStart = pos;
  let diagEnd = pos;
  if (pos > 0) {
    let prevSpan = getRightmostLeafSpan(head, pos);
    let pStart = (prevSpan >>> 32) as u32;
    let pEnd = (prevSpan & 0xffffffff) as u32;
    if (pEnd > pStart && pEnd == pos) {
      diagStart = pStart;
      diagEnd = pEnd;
    }
  }

  for (let step = 0; step < MAX_EOF_COMPLETIONS; step++) {
    if (currState < 0 || currState >= action_offsets.length) break;
    // Stop as soon as EOF can already be accepted/reduced
    if (stateCanAccept(currHead, currState, TOKEN_EOF, 0, 0) > 0) break;

    let actionOffset = action_offsets[currState];
    if (actionOffset < 0 || actionOffset >= action_data.length) break;
    let curMrd: i32 = currState < mrd_data.length ? (mrd_data[currState] as i32) : 255;

    let bestSym: i32 = -1;
    let bestTarget: i32 = -1;
    let bestScore: i32 = 999999;

    let rCount = action_data[actionOffset];
    let rIdx = actionOffset + 1;
    for (let j = 0; j < rCount; j++) {
      let sym = action_data[rIdx++];
      let actCount = action_data[rIdx++];
      for (let a = 0; a < actCount; a++) {
        let aType = action_data[rIdx++];
        let aTarget = action_data[rIdx++];
        if (aType == ACTION_SHIFT && sym > 0 && sym <= MAX_TERMINAL_ID) {
          let insCost: i32 = sym < token_insert_costs.length ? (token_insert_costs[sym] as i32) : 50;
          if (insCost <= 5) {
            let targetMrd: i32 = aTarget >= 0 && aTarget < mrd_data.length ? (mrd_data[aTarget] as i32) : 255;
            let closesBracket = currHead.balanceHash > 0 && sym < token_bracket_deltas.length && token_bracket_deltas[sym] < 0;
            if (targetMrd < curMrd || targetMrd == 0 || closesBracket) {
              let score = targetMrd * 10 + insCost - (closesBracket ? 5 : 0);
              if (score < bestScore || (score == bestScore && (bestSym == -1 || sym < bestSym))) {
                bestScore = score;
                bestSym = sym;
                bestTarget = aTarget;
              }
            }
          }
        }
      }
    }

    if (bestSym == -1 || bestTarget == -1) break;
    let insCost: i32 = bestSym < token_insert_costs.length ? (token_insert_costs[bestSym] as i32) : 1;
    let trailingPad: u32 = inserted == 0 && inputLength > pos ? inputLength - pos : 0;
    let insPad: u32 = inserted == 0 ? currHead.pendingPadding + trailingPad : 0;
    let insNode = allocNode(bestSym as u16, insPad, 0, 0, false);
    setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);
    let nextTail = pushDiagnostic(currHead.errorTail, diagStart, diagEnd, bestSym as u32, 1, bestSym as u32, 0);
    currHead = allocParseHead(
      bestTarget,
      insNode,
      currHead,
      inputLength,
      currHead.scannerState,
      currHead.errorCost + insCost * ERROR_COST_PER_MISSING_TREE,
      0,
      computeNextBalanceHash(currHead.balanceHash, bestSym),
      currHead.consecutiveInsertions + 1,
      currHead.dynamicPrec,
      0,
      nextTail
    );
    currState = bestTarget;
    inserted++;
  }

  if (inserted > 0) {
    pushNextHead(changetype<u32>(currHead));
    return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// Bounded Local A* / CPCT+ Multi-Edit Repair Search (Dedicated Scratch Pool)
// Completely isolated from GSS buffers and existing ParseHead/ASTNode memory.
// ----------------------------------------------------------------------------
const LOP_ROOT: u8 = 0;
const LOP_SHIFT: u8 = 1;
const LOP_INSERT_TERM: u8 = 2;
const LOP_INSERT_NT: u8 = 3;
const LOP_DELETE: u8 = 4;

const localParent = new StaticArray<i32>(MAX_LOCAL_NODES);
const localState = new StaticArray<i32>(MAX_LOCAL_NODES);
const localPos = new StaticArray<u32>(MAX_LOCAL_NODES);
const localOp = new StaticArray<u8>(MAX_LOCAL_NODES);
const localSym = new StaticArray<i32>(MAX_LOCAL_NODES);
const localCost = new StaticArray<i32>(MAX_LOCAL_NODES);
const localFScore = new StaticArray<i32>(MAX_LOCAL_NODES);
const localEdits = new StaticArray<u8>(MAX_LOCAL_NODES);
const localShifts = new StaticArray<u8>(MAX_LOCAL_NODES);
const localExpanded = new StaticArray<u8>(MAX_LOCAL_NODES);
const localPathBuf = new StaticArray<i32>(MAX_LOCAL_NODES);
const localHeap = new StaticArray<i32>(MAX_LOCAL_NODES);
let localHeapLen: i32 = 0;

@inline
function localNodeLess(a: i32, b: i32): bool {
  let fa = unchecked(localFScore[a]);
  let fb = unchecked(localFScore[b]);
  if (fa != fb) return fa < fb;
  let ea = unchecked(localEdits[a]);
  let eb = unchecked(localEdits[b]);
  if (ea != eb) return ea < eb;
  return a < b;
}

@inline
function localHeapPush(nodeIdx: i32): void {
  let i = localHeapLen++;
  unchecked(localHeap[i] = nodeIdx);
  while (i > 0) {
    let p = (i - 1) >> 1;
    let pNode = unchecked(localHeap[p]);
    if (localNodeLess(nodeIdx, pNode)) {
      unchecked(localHeap[i] = pNode);
      unchecked(localHeap[p] = nodeIdx);
      i = p;
    } else {
      break;
    }
  }
}

@inline
function localHeapPop(): i32 {
  if (localHeapLen <= 0) return -1;
  let top = unchecked(localHeap[0]);
  let last = unchecked(localHeap[--localHeapLen]);
  if (localHeapLen > 0) {
    unchecked(localHeap[0] = last);
    let i: i32 = 0;
    while (true) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let smallest = i;
      if (left < localHeapLen && localNodeLess(unchecked(localHeap[left]), unchecked(localHeap[smallest]))) {
        smallest = left;
      }
      if (right < localHeapLen && localNodeLess(unchecked(localHeap[right]), unchecked(localHeap[smallest]))) {
        smallest = right;
      }
      if (smallest == i) break;
      let tmp = unchecked(localHeap[i]);
      unchecked(localHeap[i] = unchecked(localHeap[smallest]));
      unchecked(localHeap[smallest] = tmp);
      i = smallest;
    }
  }
  return top;
}

/**
 * Bounded deterministic A* local repair search (up to `MAX_LOCAL_EDITS` edits,
 * `MAX_LOCAL_EXPANSIONS` expansions, confirmed by `LOCAL_CONFIRM_SHIFTS` real token shifts).
 * Materializes only the confirmed edit prefix onto `head` so real tokens are shifted normally
 * by the main GLR loop. Never mutates existing heads; always falls through cleanly if exhausted.
 */
export function tryLocalAStarRepair(head: ParseHead, token: i32, pos: u32): boolean {
  if (head.consecutiveInsertions >= 5 || token == TOKEN_EOF) return false;
  if (head.state < 0 || head.state >= action_offsets.length) return false;

  let nodeCount: i32 = 1;
  unchecked(localParent[0] = -1);
  unchecked(localState[0] = head.state);
  unchecked(localPos[0] = pos);
  unchecked(localOp[0] = LOP_ROOT);
  unchecked(localSym[0] = 0);
  unchecked(localCost[0] = 0);
  let rootMrd: i32 = head.state < mrd_data.length ? (mrd_data[head.state] as i32) : 0;
  unchecked(localFScore[0] = rootMrd * 10);
  unchecked(localEdits[0] = 0);
  unchecked(localShifts[0] = 0);
  unchecked(localExpanded[0] = 0);
  localHeapLen = 0;
  localHeapPush(0);

  let expansions: i32 = 0;
  let emittedCount: i32 = 0;

  while (expansions < MAX_LOCAL_EXPANSIONS) {
    // O(log K) deterministic binary min-heap pop: (fScore, edits, nodeIdx)
    let bestIdx: i32 = localHeapPop();
    if (bestIdx == -1) break;
    unchecked(localExpanded[bestIdx] = 1);
    expansions++;

    let curSt = unchecked(localState[bestIdx]);
    let curP = unchecked(localPos[bestIdx]);
    let curCost = unchecked(localCost[bestIdx]);
    let curEdits = unchecked(localEdits[bestIdx]);
    let curShifts = unchecked(localShifts[bestIdx]);

    // Determine lookahead token at (curP, curSt)
    let curTok: i32;
    let curTokEnd: u32;
    if (curP == pos && curEdits == 0) {
      curTok = token;
      let tL = lexLen > 0 ? lexLen : 1;
      curTokEnd = srcLexPos + tL;
    } else if (curP >= inputLength) {
      curTok = TOKEN_EOF;
      curTokEnd = inputLength;
    } else {
      curTok = cachedPeekNextTokenInState(curP, curSt);
      curTokEnd = recLastPeekEnd > curP ? recLastPeekEnd : curP + 1;
    }

    // Check confirmation: >= LOCAL_CONFIRM_SHIFTS real shifts after >= 1 edit,
    // OR reached EOF with a state that can accept/reduce on EOF after >= 1 edit.
    let confirmedByShifts = curEdits > 0 && (curShifts as i32) >= LOCAL_CONFIRM_SHIFTS;
    let confirmedByEof = curEdits > 0 && curTok == TOKEN_EOF && stateCanAccept(null, curSt, TOKEN_EOF, 0, 0) > 0;
    if (confirmedByShifts || confirmedByEof) {
      // Reconstruct path from root to bestIdx into localPathBuf
      let pathLen: i32 = 0;
      let walk: i32 = bestIdx;
      while (walk > 0 && pathLen < MAX_LOCAL_NODES) {
        unchecked(localPathBuf[pathLen++] = walk);
        walk = unchecked(localParent[walk]);
      }
      // Materialize ONLY the leading edit operations (stop at first LOP_SHIFT)
      let matHead = head;
      let matBalance = head.balanceHash;
      let matPos = pos;
      let matEdits = 0;
      let diagStart = srcLexPos;
      let diagEnd = srcLexPos + (lexLen > 0 ? lexLen : 1);

      for (let pi: i32 = pathLen - 1; pi >= 0; pi--) {
        let ni = unchecked(localPathBuf[pi]);
        let op = unchecked(localOp[ni]);
        if (op == LOP_SHIFT) break;
        let sym = unchecked(localSym[ni]);
        let nextSt = unchecked(localState[ni]);
        let nextP = unchecked(localPos[ni]);
        if (op == LOP_INSERT_TERM || op == LOP_INSERT_NT) {
          let insNode = allocNode(sym as u16, 0, 0, 0, false);
          setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);
          let stepCost: i32 =
            op == LOP_INSERT_NT
              ? ERROR_COST_PER_MISSING_TREE + 20
              : (sym < token_insert_costs.length ? (token_insert_costs[sym] as i32) : 1) * ERROR_COST_PER_MISSING_TREE;
          let nextTail = pushDiagnostic(matHead.errorTail, diagStart, diagEnd, sym as u32, 1, sym as u32, 0);
          matBalance = op == LOP_INSERT_TERM ? computeNextBalanceHash(matBalance, sym) : matBalance;
          matHead = allocParseHead(
            nextSt,
            insNode,
            matHead,
            matPos,
            matHead.scannerState,
            matHead.errorCost + stepCost,
            0,
            matBalance,
            matHead.consecutiveInsertions + 1,
            matHead.dynamicPrec,
            matHead.pendingPadding,
            nextTail
          );
          matEdits++;
        } else if (op == LOP_DELETE) {
          let delLen = nextP > matPos ? nextP - matPos : 1;
          let errLeaf = allocNode(NODE_TYPE_ERROR, 0, delLen, 0, false);
          setNodeFlags(errLeaf, FLAG_HAS_ERROR);
          let nextTail = pushDiagnostic(matHead.errorTail, matPos, nextP, sym as u32, 2, 0, 0);
          matPos = nextP;
          let delCostMat: i32 = ERROR_COST_PER_SKIPPED_TREE + (delLen as i32) * ERROR_COST_PER_SKIPPED_CHAR + 80;
          matHead = allocParseHead(
            nextSt,
            errLeaf,
            matHead,
            matPos,
            matHead.scannerState,
            matHead.errorCost + delCostMat,
            0,
            matBalance,
            0,
            matHead.dynamicPrec,
            0,
            nextTail
          );
          matEdits++;
        }
      }

      if (matEdits > 0) {
        pushNextHead(changetype<u32>(matHead));
        emittedCount++;
        if (emittedCount >= 2) return true;
      }
      continue;
    }

    // Transition 1: Real shift (cost 0, increments shiftsConfirmed)
    if (curTok != TOKEN_EOF && nodeCount < MAX_LOCAL_NODES) {
      let shiftTarget = findShiftTarget(curSt, curTok as u16);
      if (shiftTarget != -1) {
        let idx = nodeCount++;
        unchecked(localParent[idx] = bestIdx);
        unchecked(localState[idx] = shiftTarget);
        unchecked(localPos[idx] = curTokEnd);
        unchecked(localOp[idx] = LOP_SHIFT);
        unchecked(localSym[idx] = curTok);
        unchecked(localCost[idx] = curCost);
        let hMrd: i32 = shiftTarget < mrd_data.length ? (mrd_data[shiftTarget] as i32) : 0;
        unchecked(localFScore[idx] = curCost + hMrd * 10);
        unchecked(localEdits[idx] = curEdits);
        unchecked(localShifts[idx] = curShifts + 1);
        unchecked(localExpanded[idx] = 0);
        localHeapPush(idx);
      }
    }

    // Only allow edits before real shifts begin (prefix repair model) and within MAX_LOCAL_EDITS
    if (curShifts == 0 && (curEdits as i32) < MAX_LOCAL_EDITS && curSt >= 0 && curSt < action_offsets.length) {
      // Transition 2: Cheap terminal insertion (up to 4 lowest-MRD candidates)
      let actOff = action_offsets[curSt];
      if (actOff >= 0 && actOff < action_data.length) {
        let rCount = action_data[actOff];
        let rIdx = actOff + 1;
        let insertedCands = 0;
        for (let j = 0; j < rCount && insertedCands < 4 && nodeCount < MAX_LOCAL_NODES; j++) {
          let sym = action_data[rIdx++];
          let actCount = action_data[rIdx++];
          for (let a = 0; a < actCount; a++) {
            let aType = action_data[rIdx++];
            let aTarget = action_data[rIdx++];
            if (aType == ACTION_SHIFT && sym > 0 && sym <= MAX_TERMINAL_ID) {
              let insCost: i32 = sym < token_insert_costs.length ? (token_insert_costs[sym] as i32) : 50;
              if (insCost <= 5 && insertedCands < 4 && nodeCount < MAX_LOCAL_NODES) {
                let nCost = curCost + insCost * ERROR_COST_PER_MISSING_TREE;
                let hMrd: i32 = aTarget >= 0 && aTarget < mrd_data.length ? (mrd_data[aTarget] as i32) : 0;
                let idx = nodeCount++;
                unchecked(localParent[idx] = bestIdx);
                unchecked(localState[idx] = aTarget);
                unchecked(localPos[idx] = curP);
                unchecked(localOp[idx] = LOP_INSERT_TERM);
                unchecked(localSym[idx] = sym);
                unchecked(localCost[idx] = nCost);
                unchecked(localFScore[idx] = nCost + hMrd * 10);
                unchecked(localEdits[idx] = curEdits + 1);
                unchecked(localShifts[idx] = 0);
                unchecked(localExpanded[idx] = 0);
                localHeapPush(idx);
                insertedCands++;
              }
            }
          }
        }
      }

      // Transition 3: Non-terminal placeholder insertion via precomputed_nt_repairs
      if (
        changetype<usize>(precomputed_nt_repairs) != 0 &&
        curTok > 0 &&
        curTok <= MAX_TERMINAL_ID &&
        nodeCount < MAX_LOCAL_NODES
      ) {
        let bestNt = precomputed_nt_repairs[curSt * (MAX_TERMINAL_ID + 1) + curTok];
        if (bestNt > 0) {
          let ntTarget = lookupGoto(curSt, bestNt);
          if (ntTarget != -1) {
            let nCost = curCost + ERROR_COST_PER_MISSING_TREE + 20;
            let hMrd: i32 = ntTarget < mrd_data.length ? (mrd_data[ntTarget] as i32) : 0;
            let idx = nodeCount++;
            unchecked(localParent[idx] = bestIdx);
            unchecked(localState[idx] = ntTarget);
            unchecked(localPos[idx] = curP);
            unchecked(localOp[idx] = LOP_INSERT_NT);
            unchecked(localSym[idx] = bestNt);
            unchecked(localCost[idx] = nCost);
            unchecked(localFScore[idx] = nCost + hMrd * 10);
            unchecked(localEdits[idx] = curEdits + 1);
            unchecked(localShifts[idx] = 0);
            unchecked(localExpanded[idx] = 0);
            localHeapPush(idx);
          }
        }
      }

      // Transition 4: Delete current token (blocked on sync tokens & matching closing brackets when balanced;
      // mismatched or extra closers remain deletable)
      if (
        curTok != TOKEN_EOF &&
        nodeCount < MAX_LOCAL_NODES &&
        !(curTok >= 0 && curTok < token_delete_costs.length && token_delete_costs[curTok] >= 1000) &&
        !(
          (head.balanceHash & 0xff) > 0 &&
          curTok >= 0 &&
          curTok < token_bracket_deltas.length &&
          token_bracket_deltas[curTok] < 0 &&
          !isMismatchedCloser(head.balanceHash, curTok)
        )
      ) {
        let delCrossesNl = false;
        let pScan = curP;
        while (pScan < curTokEnd && pScan < inputLength) {
          let ch = peekChar(pScan);
          if (ch == 10 || ch == 13) {
            delCrossesNl = true;
            break;
          }
          if (ch != 32 && ch != 9) break;
          pScan++;
        }
        let delLenEst: i32 = curTokEnd > curP ? ((curTokEnd - curP) as i32) : 1;
        let extraDelPen: i32 = isExtraCloser(head.balanceHash, curTok)
          ? -50
          : (delCrossesNl ? PENALTY_DELETE_NEWLINE_CROSS : 0) + delLenEst * ERROR_COST_PER_SKIPPED_CHAR + 80;
        let nCost = curCost + ERROR_COST_PER_SKIPPED_TREE + extraDelPen;
        let hMrd: i32 = curSt < mrd_data.length ? (mrd_data[curSt] as i32) : 0;
        let idx = nodeCount++;
        unchecked(localParent[idx] = bestIdx);
        unchecked(localState[idx] = curSt);
        unchecked(localPos[idx] = curTokEnd);
        unchecked(localOp[idx] = LOP_DELETE);
        unchecked(localSym[idx] = curTok);
        unchecked(localCost[idx] = nCost);
        unchecked(localFScore[idx] = nCost + hMrd * 10);
        unchecked(localEdits[idx] = curEdits + 1);
        unchecked(localShifts[idx] = 0);
        unchecked(localExpanded[idx] = 0);
        localHeapPush(idx);
      }
    }
  }

  return emittedCount > 0;
}

/**
 * Tree-sitter 1-Token Missing Insertion + MRD EOF Completion.
 * Checks if inserting a single expected delimiter or non-terminal placeholder allows shifting
 * the upcoming lookahead token. At EOF, performs MRD-guided completion.
 */
export function recoverMissingToken(head: ParseHead, token: i32, pos: u32): boolean {
  g_missingConfirmedTwoTokens = false;
  if (head.consecutiveInsertions >= 6) return false;
  if (token == TOKEN_EOF) {
    g_missingConfirmedTwoTokens = true;
    return recoverAtEof(head, pos);
  }
  return tryRecoverMissingInState(head, head.state, token, pos, 0);
}
