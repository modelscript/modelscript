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
  token_is_word,
} from "./engine";
import { stateCanAccept, cloneNodeShallow, peekNextTokenInState, lastPeekedTokenEnd } from "./parser-loop";
import {
  getNodePadding,
  setNodePadding,
  getNodeLeadingPad,
  getNodeByteLength,
  setFirstChild,
  setNextSibling,
  getNodeType,
  allocNode,
  FLAG_IS_INSERTED,
  FLAG_HAS_ERROR,
  FLAG_IS_LIST,
  FLAG_INVISIBLE,
  getNodeFlags,
  setNodeFlags,
} from "./arena";
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
} from "./parser";

export const ERROR_COST_PER_SKIPPED_TREE: i32 = 100;
export const ERROR_COST_PER_MISSING_TREE: i32 = 110;
export const ERROR_COST_PER_SKIPPED_CHAR: i32 = 1;

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
export function wrapPoppedNodesInError(startHead: ParseHead, endHead: ParseHead, currentPos: u32): u32 {
  let count: u32 = 0;
  let curr: ParseHead | null = startHead;
  let totalBytes: u32 = 0;

  while (curr != null && curr != endHead) {
    if (curr.astNode != 0) {
      if (count < (MAX_CHILD_NODES as u32)) {
        t_globalChildNodes[count] = curr.astNode;
        count++;
      }
      totalBytes += getNodePadding(curr.astNode) + getNodeByteLength(curr.astNode);
    }
    curr = curr.prev;
  }

  let pad: u32 = 0;
  if (count > 0) {
    pad = getNodePadding(t_globalChildNodes[count - 1]);
  }
  if (currentPos > 0 && currentPos > endHead.pos) {
    let span = currentPos - endHead.pos;
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
      setFirstChild(errNode, clone);
    } else {
      setNextSibling(lastChild, clone);
    }
    lastChild = clone;
  }

  return errNode;
}

/**
 * Tree-sitter Strategy 1: StackSummary Unwind.
 * Walks the GSS ancestor chain within local scope to find a previous state where
 * the current lookahead token is valid. If found, wraps all popped nodes in an ERROR node.
 */
export function recoverStackSummary(head: ParseHead, token: i32, pos: u32): boolean {
  if (token == TOKEN_EOF) return false;
  let anc: ParseHead | null = head.prev;
  let depth: u32 = 1;
  let currentCost = head.errorCost;
  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;

  while (anc != null && depth <= 8) {
    let ancState = anc.state;
    // Guard: Do not unwind all the way back to root position 0 when deep inside a class
    if (anc.pos == 0 && pos > 20 && depth > 2) {
      break;
    }
    if (ancState >= 0 && ancState < action_offsets.length) {
      let canAccept = stateCanAccept(anc, ancState, token, 0, 1);
      if (canAccept > 0) {
        let errNode = wrapPoppedNodesInError(head, anc, pos);
        let firstPad: u32 = getNodePadding(errNode);
        let diagStart = anc.pos + firstPad;
        let diagEnd = pos > diagStart ? pos : diagStart + 1;
        while (diagStart < diagEnd && (peekChar(diagStart) == 32 || peekChar(diagStart) == 9 || peekChar(diagStart) == 10 || peekChar(diagStart) == 13)) {
          let cl = peekCharLen(diagStart);
          diagStart += cl > 0 ? cl : 1;
        }
        while (diagEnd > diagStart) {
          let lastCh = peekChar(diagEnd - 1);
          if (lastCh == 32 || lastCh == 9 || lastCh == 10 || lastCh == 13) {
            diagEnd--;
          } else {
            break;
          }
        }
        let errLen = diagEnd > diagStart ? diagEnd - diagStart : 1;
        let penalty: i32 = ERROR_COST_PER_SKIPPED_TREE + ((errLen as i32) * ERROR_COST_PER_SKIPPED_CHAR);
        let nextTail = pushDiagnostic(anc.errorTail, diagStart, diagEnd);

        let errHead = allocParseHead(
          ancState,
          errNode,
          anc,
          pos,
          anc.scannerState,
          currentCost + penalty,
          0,
          anc.balanceHash,
          0,
          anc.dynamicPrec,
          0,
          nextTail
        );
        pushActiveHead(changetype<u32>(errHead));
        return true;
      }
    }
    anc = anc.prev;
    depth++;
  }
  return false;
}

/**
 * Tree-sitter Strategy 2: Single-Token Error Shift.
 * Consumes the current invalid lookahead token into an ERROR leaf, advances the
 * byte position past the token, and pushes the head to the next frontier in t_nextHeads
 * with Tree-sitter's standard ERROR_COST_PER_SKIPPED_TREE penalty.
 */
export function recoverSkipToken(head: ParseHead, token: i32, pos: u32): void {
  if (head.errorCost > 0 && head.successfulShifts == 0) return;
  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;
  let pad = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
  
  let tNode = allocNode(((token == TOKEN_UNKNOWN || token == -1 ? NODE_TYPE_ERROR : token) | 0x8000) as u16, pad, tLen, 0, false);
  setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);

  let nextPos = srcLexPos + tLen;
  let newPos = nextPos > pos ? nextPos : pos + 1;
  let diagStart = srcLexPos;
  let diagEnd = srcLexPos + tLen;
  let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

  let unconfirmedPenalty: i32 = head.successfulShifts < 2 ? 60 : 0;
  let skippedHead = allocParseHead(
    head.state,
    head.astNode,
    head.prev,
    newPos,
    head.scannerState,
    head.errorCost + ERROR_COST_PER_SKIPPED_TREE + unconfirmedPenalty + (tLen as i32) * ERROR_COST_PER_SKIPPED_CHAR,
    0,
    head.balanceHash,
    0,
    head.dynamicPrec,
    0,
    nextTail
  );
  pushNextHead(changetype<u32>(skippedHead));
}

function tryRecoverMissingInState(head: ParseHead, state: i32, token: i32, pos: u32, depth: i32): boolean {
  if (head.errorCost > 0 && head.successfulShifts == 0) return false;
  if (depth > 2 || state < 0 || state >= action_offsets.length) return false;
  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) return false;

  let rCount = action_data[actionOffset];
  let rIdx = actionOffset + 1;
  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
  if (tLen == 0) tLen = 1;
  let curSrcLexPos = srcLexPos;
  let curTLen = tLen;

  for (let j = 0; j < rCount; j++) {
    let sym = action_data[rIdx++];
    let actCount = action_data[rIdx++];
    for (let a = 0; a < actCount; a++) {
      let aType = action_data[rIdx++];
      let aTarget = action_data[rIdx++];
      if (aType == ACTION_SHIFT && sym > 0 && sym <= MAX_TERMINAL_ID) {
        // Strategy A: Keyword / Token Substitution (Replacing current error token with expected terminal sym)
        let firstCh = peekChar(curSrcLexPos);
        let isInputWord = (firstCh >= 65 && firstCh <= 90) || (firstCh >= 97 && firstCh <= 122) || firstCh == 95;
        let isWordSym = token_is_word.length > sym ? (token_is_word[sym] == 1) : false;

        if (isInputWord && curTLen > 1 && !isWordSym) {
          // Do not mutate multi-char words into punctuation operators (=, +, ;, etc.)
        } else {
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
            return true;
          }
        }

        // Strategy B: Missing Token Insertion (0-width sym, keeping current token in stream)
        let insCost: i32 = token_insert_costs.length > sym ? (token_insert_costs[sym] as i32) : 1;
        if (insCost >= 50 && sym != 1 && pos > 0) {
          continue;
        }

        let canAcceptNext = stateCanAccept(head, aTarget, token, 0, 1);
        if (canAcceptNext > 0) {
          let insNode = allocNode((sym | 0x8000) as u16, 0, 0, 0, false);
          setNodeFlags(insNode, FLAG_IS_INSERTED | FLAG_HAS_ERROR);

          let diagStart = curSrcLexPos;
          let diagEnd = curSrcLexPos + curTLen;
          let nextTail = pushDiagnostic(head.errorTail, diagStart, diagEnd);

          let insHead = allocParseHead(
            aTarget,
            insNode,
            head,
            pos,
            head.scannerState,
            head.errorCost + (insCost * ERROR_COST_PER_MISSING_TREE),
            0,
            head.balanceHash,
            head.consecutiveInsertions + 1,
            head.dynamicPrec,
            0,
            nextTail
          );

          pushNextHead(changetype<u32>(insHead));
          return true;
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
                return true;
              }
              break;
            } else gIdx++;
          }
        }
      }
    }
  }
  return false;
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
