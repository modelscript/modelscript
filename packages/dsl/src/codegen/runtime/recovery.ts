import {
  ParseHead,
  allocParseHead,
  pushActiveHead,
  pushNextHead,
  t_activeHeads,
  activeHeadsCount,
} from "./gss";
import { logInt } from "./parser";
import {
  pushDiagnostic,
  MAX_CHILD_NODES,
  t_globalChildNodes,
  MAX_TERMINAL_ID,
  action_offsets,
  action_data,
  ACTION_SHIFT,
  ACTION_REDUCE,
  NODE_TYPE_ERROR,
  goto_offsets,
  goto_data,
  prod_lengths,
  prod_lhs,
  inputLength,
  token_insert_costs,
  token_delete_costs,
  token_is_word,
  precomputed_repairs,
  reachability_matrix,
  token_string_offsets,
  token_string_bytes,
  prod_is_list,
} from "./engine";
import { stateCanAccept, cloneNodeShallow, peekNextTokenInState, lastPeekedTokenEnd, fixNodeLength } from "./parser-loop";
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
  FLAG_IS_INSERTED,
  FLAG_HAS_ERROR,
  FLAG_IS_LIST,
  FLAG_INVISIBLE,
  getNodeFlags,
  setNodeFlags,
  allocGen0,
  setNodeByteLength,
} from "./arena";
import { MAX_SUMMARY_DEPTH } from "./recovery-config";
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
} from "./parser";

export const ERROR_COST_PER_SKIPPED_TREE: i32 = 100;
export const ERROR_COST_PER_MISSING_TREE: i32 = 110;
export const ERROR_COST_PER_SKIPPED_CHAR: i32 = 1;
export const PENALTY_DELETE_NEWLINE_CROSS: i32 = 5000;

/**
 * Searches the action table for a SHIFT transition for the given state and terminal token.
 */
export function findShiftTarget(state: i32, tok: u16): i32 {
  if (state < 0 || state >= action_offsets.length) return -1;
  let actOffset = action_offsets[state];
  if (actOffset < 0 || actOffset >= action_data.length) return -1;
  let actionCount = action_data[actOffset];
  let idx = actOffset + 1;
  for (let i = 0; i < actionCount; i++) {
    let sym = action_data[idx];
    let actCount = action_data[idx + 1];
    let actPtr = idx + 2;
    if (sym == (tok as i32) || sym == 0) {
      for (let a = 0; a < actCount; a++) {
        let type = action_data[actPtr + a * 2];
        let target = action_data[actPtr + a * 2 + 1];
        if (type == ACTION_SHIFT) return target;
      }
    }
    idx += 2 + actCount * 2;
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

  while (curr != null && curr != endHead) {
    let node = curr.astNode;
    if (node != 0) {
      if (count < (MAX_CHILD_NODES as u32)) {
        t_globalChildNodes[count] = node;
        count++;
      }
      totalBytes += getNodePadding(node) + getNodeByteLength(node);
    }
    curr = curr.prev;
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
  while (curr != null && d <= MAX_SUMMARY_DEPTH) {
    if (!(curr.pos == 0 && head.pos > 20 && d > 2)) {
      let entryPtr = summaryMem + count * SIZEOF_STACK_SUMMARY_ENTRY;
      let entry = changetype<StackSummaryEntry>(entryPtr);
      entry.ancHead = curr;
      entry.state = curr.state;
      entry.depth = d;
      entry.pos = curr.pos;
      count++;
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

  for (let i: u32 = 0; i < head.summaryCount; i++) {
    let entry = changetype<StackSummaryEntry>(head.summaryPtr + i * SIZEOF_STACK_SUMMARY_ENTRY);
    let anc = entry.ancHead;
    if (anc == null) continue;
    let ancState = entry.state;
    let depth = entry.depth;

    if (ancState >= 0 && ancState < action_offsets.length) {
      let canAccept = stateCanAccept(anc, ancState, token, 0, 0);
      if (canAccept > 0) {
        let errNode = wrapPoppedNodesInError(head, anc, pos);
        let firstPad: u32 = getNodePadding(errNode);

        let step: u32 = inputEncoding == 0 ? 1 : (inputEncoding <= 2 ? 2 : 4);
        let diagStart: u32 = anc.pos + firstPad;
        let diagEnd: u32 = pos;
        if (diagEnd <= diagStart) {
          diagEnd = diagStart + (lexLen > 0 ? lexLen : step);
        }

        while (diagStart < diagEnd) {
          let ch = peekChar(diagStart);
          if (ch == 32 || ch == 9 || ch == 10 || ch == 13 || ch == 0) {
            let cl = peekCharLen(diagStart);
            diagStart += cl > 0 ? cl : step;
          } else {
            break;
          }
        }
        while (diagEnd > diagStart) {
          let cl = peekCharLen(diagEnd - step);
          let lastCh = peekChar(diagEnd - step);
          if (lastCh == 32 || lastCh == 9 || lastCh == 10 || lastCh == 13 || lastCh == 0) {
            diagEnd -= cl > 0 ? cl : step;
          } else {
            break;
          }
        }
        let errLen = diagEnd > diagStart ? diagEnd - diagStart : 1;
        let penalty: i32 = ((depth as i32) * ERROR_COST_PER_SKIPPED_TREE) + ((errLen as i32) * ERROR_COST_PER_SKIPPED_CHAR);
        let nextTail = pushDiagnostic(anc.errorTail, diagStart, diagEnd);

        let targetNode = errNode;
        let parentHead: ParseHead | null = anc;
        if (anc.astNode != 0) {
          let aFlags = getNodeFlags(anc.astNode);
          let aType = getNodeType(anc.astNode);
          let isList = (aFlags & FLAG_IS_LIST) != 0 || ((prod_is_list.length as u32) > (aType as u32) && prod_is_list[aType] == 1);
          if (isList) {
            let fc = getNodeFirstChild(anc.astNode);
            if (fc == 0) {
              setNodePadding(errNode, 0);
              setFirstChild(anc.astNode, errNode);
            } else {
              let curC = fc;
              while (getNodeNextSibling(curC) != 0) {
                curC = getNodeNextSibling(curC);
              }
              setNextSibling(curC, errNode);
            }
            setNodeFlags(anc.astNode, aFlags | FLAG_HAS_ERROR);
            fixNodeLength(anc.astNode);
            targetNode = anc.astNode;
            parentHead = anc.prev;
          }
        }

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
        pushActiveHead(changetype<u32>(errHead));
        return true;
      }
    }
  }
  return false;
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
  
  let tNode = head.errorNode;
  if (tNode == 0) {
    tNode = allocNode(((token == TOKEN_UNKNOWN || token == -1 ? NODE_TYPE_ERROR : token) | 0x8000) as u16, pad, tLen, 0, false);
    setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
  } else {
    let prevByteLen = getNodeByteLength(tNode);
    setNodeByteLength(tNode, prevByteLen + pad + tLen);
  }

  let nextPos = srcLexPos + tLen;
  let newPos = nextPos > pos ? nextPos : pos + 1;
  let diagStart = srcLexPos;
  let diagEnd = srcLexPos + tLen;
  let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

  let hasNl = false;
  let pNl = nextPos;
  while (pNl < inputLength) {
    let ch = peekChar(pNl);
    if (ch == 10 || ch == 13) {
      hasNl = true;
      break;
    }
    if (ch != 32 && ch != 9) break;
    pNl += peekCharLen(pNl);
  }
  let nlPenalty: i32 = hasNl ? PENALTY_DELETE_NEWLINE_CROSS : 0;

  let unconfirmedPenalty: i32 = head.successfulShifts < 2 ? 60 : 0;
  let skippedHead = allocParseHead(
    head.state,
    tNode,
    head,
    newPos,
    head.scannerState,
    head.errorCost + ERROR_COST_PER_SKIPPED_TREE + unconfirmedPenalty + nlPenalty + (tLen as i32) * ERROR_COST_PER_SKIPPED_CHAR,
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
    tNode
  );
  pushNextHead(changetype<u32>(skippedHead));
}

export let lastKeywordMatchSpan: u32 = 0;

/**
 * Calculates a penalty for substituting the text at `pos` with grammar keyword terminal `sym`.
 * Compares characters branchlessly with lowercase ASCII normalization.
 * Handles split-word typos like "mo del" -> "model" by inspecting downstream characters.
 */
function computeKeywordSimilarityPenalty(pos: u32, len: u32, sym: i32): i32 {
  lastKeywordMatchSpan = len;
  if (changetype<usize>(token_string_offsets) == 0 || sym < 0 || sym >= token_string_offsets.length) return 50;
  let offset = token_string_offsets[sym];
  if (offset < 0 || offset >= token_string_bytes.length) return 50;

  let kwLen = token_string_bytes[offset] as u32;
  if (kwLen == 0) return 50;

  let matchChars: u32 = 0;
  let minLen = len < kwLen ? len : kwLen;
  for (let i: u32 = 0; i < minLen; i++) {
    let inputCh = peekChar(pos + i);
    let kwCh = token_string_bytes[offset + 1 + i];
    if (inputCh >= 65 && inputCh <= 90) inputCh += 32;
    if (kwCh >= 65 && kwCh <= 90) kwCh += 32;
    if (inputCh == kwCh) {
      matchChars++;
    } else {
      break;
    }
  }

  // Also check if combined with next token ("mo" + "del" = "model")
  let combinedMatch = false;
  if (matchChars == len && len < kwLen) {
    let nextP = pos + len;
    while (nextP < inputLength && (peekChar(nextP) == 32 || peekChar(nextP) == 9 || peekChar(nextP) == 10 || peekChar(nextP) == 13)) {
      nextP++;
    }
    let remainingKw = kwLen - len;
    let nextMatch: u32 = 0;
    for (let j: u32 = 0; j < remainingKw; j++) {
      let ch = peekChar(nextP + j);
      let kwCh = token_string_bytes[offset + 1 + len + j];
      if (ch >= 65 && ch <= 90) ch += 32;
      if (kwCh >= 65 && kwCh <= 90) kwCh += 32;
      if (ch == kwCh) {
        nextMatch++;
      } else {
        break;
      }
    }
    if (nextMatch == remainingKw) {
      combinedMatch = true;
      lastKeywordMatchSpan = (nextP + remainingKw) - pos;
    }
  }

  if (combinedMatch) {
    return 0; // Perfect combined split-word typo match!
  }

  let delta = kwLen > matchChars ? (kwLen - matchChars) : 0;
  let penalty: i32 = (delta as i32) * 15;
  if (matchChars == 0) penalty += 80;
  return penalty;
}

function findShiftTargetThroughEpsilons(head: ParseHead, state: i32, sym: i32): ParseHead | null {
  let currHead = head;
  let currState = state;
  let maxHops = 10;

  while (maxHops-- > 0) {
    if (currState < 0 || currState >= action_offsets.length) return null;
    let actionOffset = action_offsets[currState];
    if (actionOffset < 0 || actionOffset >= action_data.length) return null;

    let rCount = action_data[actionOffset];
    let rIdx = actionOffset + 1;
    let found = false;

    for (let j = 0; j < rCount; j++) {
      let s = action_data[rIdx++];
      let actCount = action_data[rIdx++];
      for (let a = 0; a < actCount; a++) {
        let aType = action_data[rIdx++];
        let aTarget = action_data[rIdx++];
        if (s == sym) {
          if (aType == ACTION_SHIFT) {
            return allocParseHead(
              aTarget,
              0,
              currHead.astNode == 0 ? currHead.prev : currHead,
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
            let gOffset = goto_offsets[currState];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              let gIdx = gOffset + 1;
              for (let k = 0; k < gCount; k++) {
                if (goto_data[gIdx++] == lhs) {
                  let nextSt = goto_data[gIdx++];
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
                } else gIdx++;
              }
            }
          }
        }
      }
      if (found) break;
    }
    if (!found) break;
  }
  return null;
}

function tryRecoverMissingInState(head: ParseHead, state: i32, token: i32, pos: u32, depth: i32): boolean {
  if (head.errorCost > 0 && head.successfulShifts == 0) return false;
  if (depth > 2 || state < 0 || state >= action_offsets.length) return false;

  let foundAny = false;

  // 1. O(1) Precomputed Fast Path for missing token insertions
  if (depth == 0 && changetype<usize>(precomputed_repairs) != 0 && token >= 0 && token <= MAX_TERMINAL_ID) {
    let bestRep = precomputed_repairs[state * (MAX_TERMINAL_ID + 1) + token];
    if (bestRep > 0 && bestRep <= MAX_TERMINAL_ID) {
      let insCost = token_insert_costs.length > bestRep ? (token_insert_costs[bestRep] as i32) : 1;
      let isDelimLookahead = token >= 0 && token < token_insert_costs.length && token_insert_costs[token] == 1;
      if (insCost < 50 || (isDelimLookahead && insCost <= 50) || bestRep == 1) {
        let aTarget = findShiftTarget(state, bestRep as u16);
        if (aTarget != -1 && stateCanAccept(head, aTarget, token, 0, 1) > 0) {
          let insNode = allocNode((bestRep | 0x8000) as u16, 0, 0, 0, false);
          setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

          let diagStart = srcLexPos;
          let diagEnd = srcLexPos + (lexLen > 0 ? lexLen : 1);
          let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

          let repairCost: i32 = isDelimLookahead ? ERROR_COST_PER_MISSING_TREE : (insCost * ERROR_COST_PER_MISSING_TREE);
          let insHead = allocParseHead(
            aTarget,
            insNode,
            head,
            pos,
            head.scannerState,
            head.errorCost + repairCost,
            0,
            head.balanceHash,
            head.consecutiveInsertions + 1,
            head.dynamicPrec,
            head.pendingPadding,
            nextTail
          );
          pushNextHead(changetype<u32>(insHead));
          foundAny = true;
        }
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

  for (let j = 0; j < rCount; j++) {
    let sym = action_data[rIdx++];
    let actCount = action_data[rIdx++];
    for (let a = 0; a < actCount; a++) {
      let aType = action_data[rIdx++];
      let aTarget = action_data[rIdx++];
      let firstCh = peekChar(curSrcLexPos);
      let isInputWord = (firstCh >= 65 && firstCh <= 90) || (firstCh >= 97 && firstCh <= 122) || firstCh == 95;
      let isWordSym = sym > 0 && sym <= MAX_TERMINAL_ID && token_is_word.length > sym ? (token_is_word[sym] == 1) : false;

      // Strategy A: Keyword / Token Substitution (handling both direct shifts and epsilon-reduction paths)
      if (isInputWord && isWordSym) {
        let simPenalty = computeKeywordSimilarityPenalty(curSrcLexPos, curTLen, sym);
        if (simPenalty < bestSubstPenalty) {
          let span = lastKeywordMatchSpan;
          let resolvedHead = findShiftTargetThroughEpsilons(head, state, sym);
          if (resolvedHead != null) {
            let nextPosAfterTok = curSrcLexPos + span;
            let nextTok = peekNextTokenInState(nextPosAfterTok, resolvedHead.state);
            let canAcceptAfterSubst = stateCanAccept(resolvedHead, resolvedHead.state, nextTok, 0, 0);
            if (canAcceptAfterSubst > 0) {
              bestSubstPenalty = simPenalty;
              bestSubstSym = sym;
              bestSubstResolvedHead = resolvedHead;
              bestSubstSpan = span;
            }
          }
        }
      }

      if (aType == ACTION_SHIFT && sym > 0 && sym <= MAX_TERMINAL_ID) {
        if (!isInputWord) {
          let nextPosAfterTok = curSrcLexPos + curTLen;
          let nextTok = peekNextTokenInState(nextPosAfterTok, aTarget);
          let canAcceptAfterSubst = stateCanAccept(head, aTarget, nextTok, 0, 1);
          if (canAcceptAfterSubst > 0) {
            let pad = (curSrcLexPos > pos ? curSrcLexPos - pos : 0) + head.pendingPadding;
            let mutatedNode = allocNode((sym | 0x8000) as u16, pad, curTLen, 0, false);
            setNodeFlags(mutatedNode, FLAG_HAS_ERROR);

            let diagStart = curSrcLexPos;
            let diagEnd = curSrcLexPos + curTLen;
            let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

            let substHead = allocParseHead(
              aTarget,
              mutatedNode,
              head,
              nextPosAfterTok,
              head.scannerState,
              head.errorCost + ERROR_COST_PER_MISSING_TREE,
              0,
              head.balanceHash,
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
        let insCost: i32 = token_insert_costs.length > sym ? (token_insert_costs[sym] as i32) : 1;
        let isDelimLookahead = token >= 0 && token < token_insert_costs.length && token_insert_costs[token] == 1;
        if (insCost < 50 || (isDelimLookahead && insCost <= 50) || sym == 1 || pos == 0) {
          let canAcceptNext = stateCanAccept(head, aTarget, token, 0, 1);
          if (canAcceptNext > 0) {
            let insNode = allocNode((sym | 0x8000) as u16, 0, 0, 0, false);
            setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

            let diagStart = curSrcLexPos;
            let diagEnd = curSrcLexPos + curTLen;
            let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

            let repairCost: i32 = isDelimLookahead ? ERROR_COST_PER_MISSING_TREE : (insCost * ERROR_COST_PER_MISSING_TREE);
            let insHead = allocParseHead(
              aTarget,
              insNode,
              head,
              pos,
              head.scannerState,
              head.errorCost + repairCost,
              0,
              head.balanceHash,
              head.consecutiveInsertions + 1,
              head.dynamicPrec,
              head.pendingPadding,
              nextTail
            );

            pushNextHead(changetype<u32>(insHead));
            foundAny = true;
          }
        }
      } else if (aType == ACTION_REDUCE && aTarget >= 0 && aTarget < prod_lengths.length && prod_lengths[aTarget] == 0) {
        let lhs = prod_lhs[aTarget];
        let gOffset = goto_offsets[state];
        if (gOffset >= 0 && gOffset < goto_data.length) {
          let gCount = goto_data[gOffset];
          let gIdx = gOffset + 1;
          for (let k = 0; k < gCount; k++) {
            if (goto_data[gIdx++] == lhs) {
              let nextSt = goto_data[gIdx++];
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
              break;
            } else gIdx++;
          }
        }
      }
    }
  }

  // Push the best scored keyword substitution candidate
  if (bestSubstResolvedHead != null) {
    let nextPosAfterTok = curSrcLexPos + bestSubstSpan;
    let pad = (curSrcLexPos > pos ? curSrcLexPos - pos : 0) + head.pendingPadding;
    let mutatedNode = allocNode((bestSubstSym | 0x8000) as u16, pad, bestSubstSpan, 0, false);
    setNodeFlags(mutatedNode, FLAG_HAS_ERROR);

    let diagStart = curSrcLexPos;
    let diagEnd = curSrcLexPos + bestSubstSpan;
    let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

    let substHead = allocParseHead(
      bestSubstResolvedHead.state,
      mutatedNode,
      bestSubstResolvedHead.prev,
      nextPosAfterTok,
      head.scannerState,
      head.errorCost + ERROR_COST_PER_MISSING_TREE + bestSubstPenalty,
      0,
      head.balanceHash,
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
 * Tree-sitter 1-Token Missing Insertion.
 * Checks if inserting a single expected delimiter (such as ';' or ')') allows shifting
 * the upcoming lookahead token. If so, inserts a zero-width MISSING leaf and retries.
 */
export function recoverMissingToken(head: ParseHead, token: i32, pos: u32): boolean {
  if (head.consecutiveInsertions >= 3 || token == TOKEN_EOF) return false;
  return tryRecoverMissingInState(head, head.state, token, pos, 0);
}
