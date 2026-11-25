// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Fast-path deterministic LR parsing loop and LR-to-GLR transition.
 */

import { ParseHead, t_activeHeads, activeHeadsCount, allocParseHead, globalCursorDepth, cursorNodeStack, cursorContentStartStack, saveCursorCheckpoint, restoreCursorCheckpoint, rebuildFrontierSummary } from "../gss";
import { allocNode, allocLeafNode, getNodeType, setNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_HAS_ERROR, FLAG_IS_TAINED, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_FRAGILE, getNodeEnvHash, setNodeReductionInfo, getInputBuffer, setNodeMerkleHash, getNodeMerkleHash, getNodeRawMerkleHash, EPHEMERAL_FLAGS } from "../../arena";
import { lexPos, lexLen, srcLexPos, currentScannerState, inputLength, peekChar, peekCharLen, inputEncoding } from "../../parser";
import { TOKEN_EOF, ACTION_SHIFT, ACTION_REDUCE, ACTION_ACCEPT, action_offsets, action_data, token_bracket_deltas, isOpenBracketChar, isCloseBracketChar, updateBalanceHash, prod_lengths, prod_lhs, prod_is_invisible, prod_is_list, prod_aliases, alias_data, t_lrStateStack, t_lrNodeStack, t_lrScannerStack, t_lrBalanceStack, lrStackDepth, MODE_LR, MODE_GLR, currentParserMode, debugLog, tempActions, initGlobalCursor, MAX_TERMINAL_ID, isReachableZeroDist, lookupGoto, action_disp_base, action_disp_check, action_disp_val, goto_disp_base, goto_disp_check, goto_disp_val } from "../engine";
import { lookupActions, resetFrontierLexMemo, stateCanAcceptFnBool, invokeLexer, g_skipPos, g_skipPad, skipExtraTokens, restoreLexerState, g_reduceLookahead } from "./loop-actions";
import { cloneNodeShallow, isMutable } from "./loop-tree";
import { g_lastSlicedEnd, concatLists, appendToList, extractListSlice } from "./loop-lists";
import { g_oldTree, g_editStart, g_editOldEnd, g_editNewEnd, t_editRangesCount, mapNewPosToOldPos, mapOldPosToNewPos, isOldRangeEdited, findReusableNode, reuseLookaheadMatches } from "./loop-incremental";

/**
 * Transitions the parser from fast LR mode to full GLR mode.
 * Converts the flat LR stack into a Graph-Structured Stack (GSS) head.
 *
 * @param pos Current byte offset in the input stream.
 * @param pendingPadding Extraneous whitespace/comments accumulated before the current token.
 * @param scannerState The state of the lexer at transition time.
 */
export function transitionToGlr(pos: u32, pendingPadding: u32, scannerState: u32): void {
  debugLog(8888, pos, lrStackDepth, scannerState);
  g_reduceLookahead = 0;
  let prevHead: ParseHead | null = null;
  let currentPos: u32 = 0;
  for (let i = 0; i < lrStackDepth; i++) {
    let state = t_lrStateStack[i] as i32;
    let node = t_lrNodeStack[i];

    if (node != 0) {
      currentPos += getNodePadding(node) + getNodeByteLength(node);
    }


    let headScannerState = i == 0 ? 0 : t_lrScannerStack[i];
    let headBalance = i == 0 ? 0 : t_lrBalanceStack[i];
    let head = allocParseHead(
      state,
      node,
      prevHead,
      currentPos,
      headScannerState,
      0,
      0,
      headBalance,
      0,
      0,
      0,
      0
    );
    prevHead = head;
  }

  if (prevHead) {
    prevHead.pos = pos;
    prevHead.pendingPadding = pendingPadding;
    activeHeadsCount = 0;
    t_activeHeads[activeHeadsCount++] = changetype<u32>(prevHead);
    rebuildFrontierSummary(0, t_activeHeads, activeHeadsCount);
  }

  resetFrontierLexMemo();
  currentParserMode = MODE_GLR;
}

/**
 * Fast-path LR parser. This parser loop handles deterministic code sections.
 * If an ambiguity is encountered (actionCount > 1) or an error occurs (actionCount == 0),
 * it calls `transitionToGlr` to switch over to the heavy GLR machinery.
 *
 * @returns The final accepted AST root node pointer, or 0 if transitioning to GLR.
 */
export function parseLR(startPos: u32 = 0, startToken: i32 = -1, startPendingPad: u32 = 0): u32 {
  let pos: u32 = startPos;
  let token: i32 = startToken;
  let pendingPadding: u32 = startPendingPad;

  if (startToken == -1) {
    t_lrStateStack[0] = 0;
    t_lrNodeStack[0] = 0;
    t_lrScannerStack[0] = currentScannerState;
    t_lrBalanceStack[0] = 0;
    lrStackDepth = 1;

    token = skipExtraTokens(invokeLexer(pos), pos, 1);
    pendingPadding += g_skipPad;
    pos = g_skipPos;
  }


  let consecutiveReductions: u32 = 0;
  let dispBasePtr: usize = changetype<usize>(action_disp_base);
  let dispCheckPtr: usize = changetype<usize>(action_disp_check);
  let dispValPtr: usize = changetype<usize>(action_disp_val);
  let dispBaseLen: i32 = dispBasePtr != 0 ? action_disp_base.length : 0;
  let dispCheckLen: i32 = dispCheckPtr != 0 ? action_disp_check.length : 0;
  let actDataPtr: usize = changetype<usize>(action_data);
  let gDispBasePtr: usize = changetype<usize>(goto_disp_base);
  let gDispCheckPtr: usize = changetype<usize>(goto_disp_check);
  let gDispValPtr: usize = changetype<usize>(goto_disp_val);
  let gDispBaseLen: i32 = gDispBasePtr != 0 ? goto_disp_base.length : 0;
  let gDispCheckLen: i32 = gDispCheckPtr != 0 ? goto_disp_check.length : 0;
  let eofSlot: i32 = MAX_TERMINAL_ID + 1;
  let hasEdit: bool = g_editNewEnd > 0 || g_editOldEnd > 0 || t_editRangesCount > 0;

  while (currentParserMode == MODE_LR) {
    let currentState = t_lrStateStack[(lrStackDepth - 1)] as i32;

    // Single direct O(1) action lookup per LR step (eliminates duplicate lookupActions + tempActions copy).
    let actionCount: i32 = 0;
    let type: u32 = 0;
    let target: i32 = 0;
    if (dispBasePtr != 0 && currentState >= 0 && currentState < dispBaseLen) {
      let base = load<i32>(dispBasePtr + ((currentState as usize) << 2));
      if (base >= 0) {
        let sym = token == TOKEN_EOF ? eofSlot : token;
        let matchIdx: i32 = -1;
        if (sym >= 0 && sym <= eofSlot) {
          let slot = base + sym;
          if (slot < dispCheckLen && load<i32>(dispCheckPtr + ((slot as usize) << 2)) == currentState) {
            matchIdx = load<i32>(dispValPtr + ((slot as usize) << 2));
          } else if (sym != 0 && base < dispCheckLen && load<i32>(dispCheckPtr + ((base as usize) << 2)) == currentState) {
            matchIdx = load<i32>(dispValPtr + ((base as usize) << 2));
          }
        }
        if (matchIdx != -1) {
          actionCount = load<i32>(actDataPtr + (((matchIdx + 1) as usize) << 2));
          if (actionCount == 1) {
            type = load<i32>(actDataPtr + (((matchIdx + 2) as usize) << 2)) as u32;
            target = load<i32>(actDataPtr + (((matchIdx + 3) as usize) << 2));
          }
        }
      }
    } else {
      actionCount = lookupActions(currentState, token);
      if (actionCount == 1) {
        type = tempActions[0];
        target = tempActions[1] as i32;
      }
    }

    let isPendingReduce = (actionCount == 1 && type == (ACTION_REDUCE as u32));
    // Stack index of a speculatively pushed empty list (step 0 below), or -1.
    let speculativeEmptyIdx: i32 = -1;

    if (!isPendingReduce && hasEdit && pos < inputLength && token != TOKEN_EOF && globalCursorDepth >= 0) {
      let oldPos = mapNewPosToOldPos(pos);
      let oldSrcLexPos = mapNewPosToOldPos(srcLexPos);

      if (oldSrcLexPos != 0xffffffff) {
        let expectedPadding: u32 = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
        let lastNode = t_lrNodeStack[lrStackDepth - 1];
        let headSym: u32 = lastNode != 0 ? (getNodeType(lastNode) as u32) : 0xffffffff;
        let isListOnStack = lastNode != 0 && (getNodeFlags(lastNode) & FLAG_IS_LIST) != 0;

        let oldListRoot: u32 = 0;
        let oldListStart: u32 = 0;
        if (isListOnStack && g_oldTree != 0) {
          for (let d: i32 = 0; d <= globalCursorDepth; d++) {
            let node = cursorNodeStack[d];
            if (node != 0 && (getNodeFlags(node) & FLAG_IS_LIST) != 0 && (getNodeType(node) as u32) == headSym) {
              oldListRoot = node;
              oldListStart = cursorContentStartStack[d];
              break;
            }
          }
          if (oldListRoot == 0 && globalCursorDepth >= 0) {
            let curr = cursorNodeStack[globalCursorDepth];
            if (curr != 0) {
              let sib = getNodeNextSibling(curr);
              let prevEnd = cursorContentStartStack[globalCursorDepth] + getNodeByteLength(curr);
              let sibCount: i32 = 0;
              while (sib != 0 && sibCount < 4) {
                sibCount++;
                if ((getNodeFlags(sib) & FLAG_IS_LIST) != 0 && (getNodeType(sib) as u32) == headSym) {
                  oldListRoot = sib;
                  oldListStart = prevEnd + getNodePadding(sib);
                  break;
                }
                prevEnd = prevEnd + getNodePadding(sib) + getNodeByteLength(sib);
                sib = getNodeNextSibling(sib);
              }
            }
          }
        }

        // 0. Speculative ε-reduction: if an ancestor cursor node is an edited list and the list
        // type isn't on the stack yet, force-create an empty list to enable prefix/suffix splicing.
        if (oldListRoot == 0 && !isListOnStack && g_oldTree != 0 && globalCursorDepth >= 0) {
          let candidateList: u32 = 0;
          let candidateListStart: u32 = 0;
          // Search all ancestor cursor depths for a list node that overlaps the edit.
          for (let d: i32 = 0; d <= globalCursorDepth; d++) {
            let node = cursorNodeStack[d];
            if (node != 0 && (getNodeFlags(node) & FLAG_IS_LIST) != 0) {
              let cStart = cursorContentStartStack[d];
              let cEnd = cStart + getNodeByteLength(node);
              if (isOldRangeEdited(cStart, cEnd)) {
                candidateList = node;
                candidateListStart = cStart;
                break;
              }
            }
          }
          // Also check immediate siblings of cursor nodes for adjacent list nodes.
          if (candidateList == 0) {
            let curNode = cursorNodeStack[globalCursorDepth];
            if (curNode != 0) {
              let sib = getNodeNextSibling(curNode);
              let prevEnd = cursorContentStartStack[globalCursorDepth] + getNodeByteLength(curNode);
              let sibCount: i32 = 0;
              while (sib != 0 && sibCount < 4) {
                sibCount++;
                let sibStart = prevEnd + getNodePadding(sib);
                if (t_editRangesCount <= 1 && sibStart >= g_editOldEnd && g_editOldEnd > 0) break;
                if ((getNodeFlags(sib) & FLAG_IS_LIST) != 0) {
                  let sibEnd = sibStart + getNodeByteLength(sib);
                  if (isOldRangeEdited(sibStart, sibEnd)) {
                    candidateList = sib;
                    candidateListStart = sibStart;
                    break;
                  }
                }
                prevEnd = sibStart + getNodeByteLength(sib);
                sib = getNodeNextSibling(sib);
              }
            }
          }
          if (candidateList != 0) {
            let curListType = getNodeType(candidateList);
            // Check if currentState has a goto for this list type.
            let gotoState = lookupGoto(currentState, curListType as i32);
            if (gotoState != -1) {
              // Verify the goto state accepts the current token.
              let gotoAccepts = lookupActions(gotoState, token) > 0 || stateCanAcceptFnBool(gotoState, token) || isReachableZeroDist(gotoState, token);
              if (gotoAccepts) {
                // Force ε-reduction: create empty list, push via goto.
                let prevBal: u32 = lrStackDepth > 0 ? t_lrBalanceStack[lrStackDepth - 1] : 0;
                let emptyList = allocNode(curListType, 0, 0, prevBal & 0xff);
                setNodeFlags(emptyList, FLAG_IS_LIST | FLAG_INVISIBLE);
                t_lrStateStack[lrStackDepth] = gotoState;
                t_lrNodeStack[lrStackDepth] = emptyList;
                t_lrScannerStack[lrStackDepth] = lrStackDepth > 0 ? t_lrScannerStack[lrStackDepth - 1] : 0;
                t_lrBalanceStack[lrStackDepth] = prevBal;
                speculativeEmptyIdx = lrStackDepth as i32;
                lrStackDepth++;
                // Re-derive state variables for the new stack top.
                currentState = gotoState;
                lastNode = emptyList;
                headSym = curListType as u32;
                isListOnStack = true;
                // Set up oldListRoot from the candidate list node.
                oldListRoot = candidateList;
                oldListStart = candidateListStart;
              }
            }
          }
        }

        // 1. Suffix list splicing optimization (past the edited region):
        if ((t_editRangesCount > 1 || pos >= g_editNewEnd) && oldListRoot != 0 && (getNodeFlags(oldListRoot) & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) == 0) {
          let oldListEnd = oldListStart + getNodeByteLength(oldListRoot);
          if (oldSrcLexPos < oldListEnd && !isOldRangeEdited(oldSrcLexPos, oldListEnd)) {
            let newEndOfList: u32 = 0;
            if (t_editRangesCount <= 1) {
              newEndOfList = g_editNewEnd + (oldListEnd - g_editOldEnd);
            } else {
              // Only edits located before the list end shift it.
              newEndOfList = mapOldPosToNewPos(oldListEnd);
            }
            let savedLexPos = lexPos;
            let savedSrcLexPos = srcLexPos;
            let savedLexLen = lexLen;
            let savedScannerState = currentScannerState;
            let nextTok = skipExtraTokens(invokeLexer(newEndOfList), newEndOfList, 1);
            let nextPendingPad: u32 = g_skipPad;
            newEndOfList = g_skipPos;
            let canAccept = lookupActions(currentState, nextTok) > 0 || stateCanAcceptFnBool(currentState, nextTok) || isReachableZeroDist(currentState, nextTok);
            if (canAccept) {
              let suffix = extractListSlice(oldListRoot, oldListStart, oldSrcLexPos, 0xffffffff, headSym as u16, 0);
              if (suffix != 0) {
                let clone = cloneNodeShallow(suffix);
                setNodePadding(clone, expectedPadding);
                let combined = concatLists(lastNode, clone, headSym as u16, 0);
                t_lrNodeStack[lrStackDepth - 1] = combined;
                pos = newEndOfList;
                token = nextTok;
                pendingPadding = nextPendingPad;
                consecutiveReductions = 0;
                initGlobalCursor(g_oldTree);
                continue;
              }
            }
            lexPos = savedLexPos;
            srcLexPos = savedSrcLexPos;
            lexLen = savedLexLen;
            currentScannerState = savedScannerState;
          }
        }

        // 2. Prefix list splicing optimization (before the edited region):
        if (t_editRangesCount <= 1 && oldSrcLexPos < g_editStart && oldListRoot != 0 && g_editStart > 0 && (getNodeFlags(oldListRoot) & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) == 0) {
          let savedLexPos = lexPos;
          let savedSrcLexPos = srcLexPos;
          let savedLexLen = lexLen;
          let savedScannerState = currentScannerState;
          let prefixSlice = extractListSlice(oldListRoot, oldListStart, oldSrcLexPos, g_editStart, headSym as u16, 0);
          if (prefixSlice != 0) {
            let newEndOfSlice = g_lastSlicedEnd;
            let nextTok = skipExtraTokens(invokeLexer(newEndOfSlice), newEndOfSlice, 1);
            let nextPendingPad: u32 = g_skipPad;
            newEndOfSlice = g_skipPos;
            let canAccept = lookupActions(currentState, nextTok) > 0 || stateCanAcceptFnBool(currentState, nextTok) || isReachableZeroDist(currentState, nextTok);
            if (canAccept) {
              let combined = concatLists(lastNode, prefixSlice, headSym as u16, 0);
              t_lrNodeStack[lrStackDepth - 1] = combined;
              pos = newEndOfSlice;
              token = nextTok;
              pendingPadding = nextPendingPad;
              consecutiveReductions = 0;
              initGlobalCursor(g_oldTree);
              continue;
            }
          }
          lexPos = savedLexPos;
          srcLexPos = savedSrcLexPos;
          lexLen = savedLexLen;
          currentScannerState = savedScannerState;
        }


        saveCursorCheckpoint();
        let curBalance: u32 = lrStackDepth > 0 ? t_lrBalanceStack[lrStackDepth - 1] : 0;
        let reusedNode = findReusableNode(
          oldPos,
          oldSrcLexPos,
          currentState,
          curBalance & 0xff,
          g_editStart,
          g_editOldEnd,
          headSym,
          expectedPadding,
          token
        );
        if (reusedNode != 0) {
          let nodeType = getNodeType(reusedNode);
          let isListChunk = lastNode != 0 && (getNodeFlags(reusedNode) & FLAG_IS_LIST) != 0 && (nodeType as u32) == headSym;
          if (isListChunk) {
            let totalPadding = expectedPadding;
            let endPos = srcLexPos + getNodeByteLength(reusedNode);
            let savedLexPos = lexPos;
            let savedSrcLexPos = srcLexPos;
            let savedLexLen = lexLen;
            let savedScannerState = currentScannerState;
            let nextTok = skipExtraTokens(invokeLexer(endPos), endPos, 0);
            let nextPendingPad: u32 = g_skipPad;
            endPos = g_skipPos;
            let canAccept = lookupActions(currentState, nextTok) > 0 || stateCanAcceptFnBool(currentState, nextTok) || isReachableZeroDist(currentState, nextTok);
            if (canAccept) {
              let clone = cloneNodeShallow(reusedNode);
              setNodePadding(clone, totalPadding);
              setNodeFlags(clone, getNodeFlags(clone) | FLAG_EXTRACTED);
              let combined = concatLists(lastNode, clone, nodeType, 0);
              t_lrNodeStack[lrStackDepth - 1] = combined;
              pos = endPos;
              token = nextTok;
              pendingPadding = nextPendingPad;
              consecutiveReductions = 0;
              continue;
            } else {
              restoreCursorCheckpoint();
              restoreLexerState(savedLexPos, savedSrcLexPos, savedLexLen, savedScannerState);
            }
          } else {
            let nextState = -1;
            if (nodeType > (MAX_TERMINAL_ID as u16)) {
              nextState = lookupGoto(currentState, nodeType as i32);
            } else {
              let numActions = lookupActions(currentState, nodeType as i32);
              if (numActions > 0 && tempActions[0] == (ACTION_SHIFT as u32)) {
                nextState = tempActions[1] as i32;
              }
            }
            if (nextState != -1) {
              let totalPadding = expectedPadding;
              let endPos = srcLexPos + getNodeByteLength(reusedNode);
              let savedLexPos = lexPos;
              let savedSrcLexPos = srcLexPos;
              let savedLexLen = lexLen;
              let savedScannerState = currentScannerState;
              t_lrStateStack[lrStackDepth] = nextState;
              t_lrScannerStack[lrStackDepth] = currentScannerState;
              t_lrBalanceStack[lrStackDepth] = getNodeEnvHash(reusedNode);
              lrStackDepth++;
              let nextTok = skipExtraTokens(invokeLexer(endPos), endPos, 0);
              let nextPendingPad: u32 = g_skipPad;
              endPos = g_skipPos;
              let canAccept = lookupActions(nextState, nextTok) > 0 || stateCanAcceptFnBool(nextState, nextTok) || isReachableZeroDist(nextState, nextTok);
              // The reused subtree's internal reductions were decided with the old lookahead;
              // reject reuse if the token following it has changed.
              if (canAccept && !reuseLookaheadMatches(reusedNode, nextTok)) {
                canAccept = false;
              }
              if (canAccept) {
                let clone = cloneNodeShallow(reusedNode);
                setNodePadding(clone, totalPadding);
                setNodeFlags(clone, getNodeFlags(clone) | FLAG_EXTRACTED);
                t_lrNodeStack[lrStackDepth - 1] = clone;
                pos = endPos;
                token = nextTok;
                pendingPadding = nextPendingPad;
                consecutiveReductions = 0;
                continue;
              } else {
                restoreCursorCheckpoint();
                lrStackDepth--;
                restoreLexerState(savedLexPos, savedSrcLexPos, savedLexLen, savedScannerState);
              }
            } else {
              restoreCursorCheckpoint();
            }
          }
        } else {
          restoreCursorCheckpoint();
        }
      }
    }

    // A speculative empty list that no splice/reuse consumed must not stay on the stack:
    // the LR table may not even contain that ε-reduction for `token`, which would make
    // the incremental tree diverge from a fresh parse.
    if (speculativeEmptyIdx >= 0 && lrStackDepth == speculativeEmptyIdx + 1) {
      lrStackDepth--;
      currentState = t_lrStateStack[(lrStackDepth - 1)] as i32;
      actionCount = lookupActions(currentState, token);
      if (actionCount == 1) {
        type = tempActions[0];
        target = tempActions[1] as i32;
      }
    }

    if (actionCount == 0 || actionCount > 1) {
      let defaultReduce = -1;
      let hasConflictingReduce = false;
      if (actionCount == 0 && token == TOKEN_EOF) {
        let actionOffset = action_offsets[currentState];
        if (actionOffset >= 0 && actionOffset + 1 < action_data.length) {
          let rIdx = actionOffset + 1;
          let rCount = action_data[actionOffset];
          for (let j = 0; j < rCount; j++) {
            let sym = action_data[rIdx++];
            let actCount = action_data[rIdx++];
            for (let a = 0; a < actCount; a++) {
              let aType = action_data[rIdx++];
              let aTarget = action_data[rIdx++];
              if (aType == ACTION_REDUCE) {
                let pLen = prod_lengths[aTarget];
                if (pLen > 0) {
                  if (defaultReduce == -1) {
                    defaultReduce = aTarget;
                  } else if (defaultReduce != aTarget) {
                    hasConflictingReduce = true;
                  }
                }
              }
            }
          }
        }
      }

      if (actionCount == 0 && defaultReduce != -1 && !hasConflictingReduce && token == TOKEN_EOF) {
        type = ACTION_REDUCE;
        target = defaultReduce;
      } else {
        debugLog(9301, currentState as u32, token as u32, actionCount as u32);
        debugLog(9302, lrStackDepth as u32, pos, srcLexPos);
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }


    } else if (actionCount != 1) {
      type = tempActions[0];
      target = tempActions[1] as i32;
    }

    if (type == ACTION_SHIFT) {
      consecutiveReductions = 0;
      let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
      let prevBal: u32 = lrStackDepth > 0 ? t_lrBalanceStack[lrStackDepth - 1] : 0;
      let curBalance: u32 = prevBal;
      if (token >= 0 && token <= MAX_TERMINAL_ID && changetype<usize>(token_bracket_deltas) != 0 && token_bracket_deltas[token] != 0) {
        curBalance = updateBalanceHash(prevBal, token);
      } else {
        let charLen = peekCharLen(lexPos);
        if (lexLen == charLen) {
          let c = peekChar(lexPos);
          let depth = prevBal & 0xff;
          if (isOpenBracketChar(c)) {
            curBalance = (prevBal & 0xffffff00) | (depth < 255 ? depth + 1 : 255);
          } else if (isCloseBracketChar(c) && depth > 0) {
            curBalance = ((prevBal >>> 10) << 8) | (depth - 1);
          }
        }
      }

      let leaf = allocLeafNode(token as u16, paddingLength, lexLen, curBalance & 0xff, false, currentState as u32);

      let lh: u64 = 0xcbf29ce484222325;
      lh ^= (token as u64);
      lh = lh * 0x100000001b3;
      lh ^= (lexLen as u64);
      lh = lh * 0x100000001b3;
      let inBuf = getInputBuffer();
      if (inputEncoding == 0) {
        let basePtr = inBuf + (srcLexPos as usize);
        for (let i: u32 = 0; i < lexLen; i++) {
          lh ^= load<u8>(basePtr + (i as usize)) as u64;
          lh = lh * 0x100000001b3;
        }
      } else {
        let basePtr = inBuf + ((srcLexPos as usize) << 1);
        for (let i: u32 = 0; i < lexLen; i++) {
          lh ^= load<u16>(basePtr + ((i as usize) << 1)) as u64;
          lh = lh * 0x100000001b3;
        }
      }
      setNodeMerkleHash(leaf, (lh & 0xffffffff) as u32, (lh >> 32) as u32);

      t_lrStateStack[lrStackDepth] = target;
      t_lrNodeStack[lrStackDepth] = leaf;
      t_lrScannerStack[lrStackDepth] = currentScannerState;
      t_lrBalanceStack[lrStackDepth] = curBalance;
      lrStackDepth++;

      pos = srcLexPos + lexLen;

      token = skipExtraTokens(invokeLexer(pos), pos, 1);
      pendingPadding = g_skipPad;
      pos = g_skipPos;

    } else if (type == ACTION_REDUCE) {
      if (++consecutiveReductions > 5000) {
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }
      let reduceProd = target;
      let popCount = prod_lengths[reduceProd] as i32;
      let lhsSym = prod_lhs[reduceProd];
      let childStartIdx = lrStackDepth - popCount;
      let prevState = t_lrStateStack[(childStartIdx - 1)] as i32;
      let nextState: i32 = -1;
      if (gDispBasePtr != 0 && prevState >= 0 && prevState < gDispBaseLen) {
        let gBase = load<i32>(gDispBasePtr + ((prevState as usize) << 2));
        if (gBase >= 0) {
          let gSlot = gBase + (lhsSym as i32);
          if (gSlot >= 0 && gSlot < gDispCheckLen && load<i32>(gDispCheckPtr + ((gSlot as usize) << 2)) == prevState) {
            nextState = load<i32>(gDispValPtr + ((gSlot as usize) << 2));
          }
        }
      } else {
        nextState = lookupGoto(prevState, lhsSym);
      }

      if (nextState == -1) {
        debugLog(9300, reduceProd as u32, lhsSym as u32, prevState as u32);
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }

      lrStackDepth = childStartIdx;

      let totalByteLength: u32 = 0;
      let firstChildPadding: u32 = 0;
      let firstNonEmptyIdx: i32 = -1;
      if (popCount > 0) {
        for (let k = 0; k < popCount; k++) {
          let child = t_lrNodeStack[(childStartIdx + k)];
          let cPadding = getNodeLeadingPad(child);
          let cLen = getNodeByteLength(child);
          if (firstNonEmptyIdx == -1 && (cPadding > 0 || cLen > 0)) {
            firstNonEmptyIdx = k;
            firstChildPadding = cPadding;
            totalByteLength += cLen;
          } else {
            totalByteLength += cPadding + cLen;
          }
        }
      }

      let parentNode: u32 = 0;
      let isListAppend = false;
      if (popCount > 0) {
        if (
          (popCount == 2 || popCount == 3) &&
          t_lrNodeStack[childStartIdx] != 0 &&
          prod_is_list[reduceProd] == 1
        ) {
          let leftSym = getNodeType(t_lrNodeStack[childStartIdx]);
          if (leftSym == lhsSym) isListAppend = true;
        }
      }

      let prevBalance: u32 = lrStackDepth > 0 ? t_lrBalanceStack[lrStackDepth - 1] : 0;
      if (isListAppend) {
        if (popCount == 2) {
          parentNode = appendToList(
            t_lrNodeStack[childStartIdx],
            t_lrNodeStack[(childStartIdx + 1)],
            lhsSym as u16,
            currentScannerState,
            true
          );
        } else {
          let temp = appendToList(
            t_lrNodeStack[childStartIdx],
            t_lrNodeStack[(childStartIdx + 1)],
            lhsSym as u16,
            currentScannerState,
            false
          );
          parentNode = appendToList(
            temp,
            t_lrNodeStack[(childStartIdx + 2)],
            lhsSym as u16,
            currentScannerState,
            true
          );
        }
        setNodeReductionInfo(parentNode, prevState as u32, token as u32);
      } else {
        parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, prevBalance & 0xff, false, prevState as u32);
        if (prod_is_list[reduceProd] == 1) {
          setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_IS_LIST);
        }
        if (prod_is_invisible[reduceProd] == 1) {
          setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_INVISIBLE);
        }
        let lastChild = 0;
        let logicalChildIndex = 0;
        let aliasPtr = prod_aliases[reduceProd];
        let aliasCount = 0;
        if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

        for (let k = 0; k < popCount; k++) {
            let child = t_lrNodeStack[(childStartIdx + k)];
            if (child == 0) {
              logicalChildIndex++;
              continue;
            }

            // P1: in LR mode a popped child is owned solely by this reduction unless it was
            // reused from the old tree or is shared; only clone in those cases.
            let clone = isMutable(child) ? child : cloneNodeShallow(child);

            if (k == 0 || k == firstNonEmptyIdx) {
              setNodePadding(clone, 0);
            }

            if (aliasPtr >= 0) {
              for (let a = 0; a < aliasCount; a++) {
                let aIndex = alias_data[aliasPtr + 1 + a * 2];
                let aSym = alias_data[aliasPtr + 1 + a * 2 + 1];
                if (aIndex == logicalChildIndex) {
                  if (getNodeType(clone) != (aSym as u16)) {
                    let prevM = getNodeRawMerkleHash(clone);
                    setNodeType(clone, aSym as u16);
                    if (prevM != 0) {
                      let ah: u64 = prevM ^ ((aSym as u64) | 0x9e3779b97f4a7c15);
                      ah = ah * 0x100000001b3;
                      let aLow = (ah & 0xffffffff) as u32;
                      let aHigh = (ah >> 32) as u32;
                      if (aLow == 0 && aHigh == 0) aLow = 1;
                      setNodeMerkleHash(clone, aLow, aHigh);
                    }
                  }
                  break;
                }
              }
              logicalChildIndex++;
            } else {
              logicalChildIndex++;
            }

            if (lastChild == 0) setFirstChild(parentNode, clone);
            else setNextSibling(lastChild, clone);
            setNextSibling(clone, 0);
            lastChild = clone;
            if (getNodeType(child) == 0 || (getNodeFlags(child) & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) != 0) {
              setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_HAS_ERROR);
            }
          }

        setNodeReductionInfo(parentNode, prevState as u32, token as u32);

        let ph: u64 = 0xcbf29ce484222325;
        let semFlags = getNodeFlags(parentNode) & ~EPHEMERAL_FLAGS;
        ph ^= (lhsSym as u64) | ((semFlags as u64) << 16);
        ph = ph * 0x100000001b3;
        ph ^= (totalByteLength as u64);
        ph = ph * 0x100000001b3;
        let ch = getNodeFirstChild(parentNode);
        while (ch != 0) {
          let chM = getNodeMerkleHash(ch);
          ph ^= chM;
          ph = ph * 0x100000001b3;
          ch = getNodeNextSibling(ch);
        }
        setNodeMerkleHash(parentNode, (ph & 0xffffffff) as u32, (ph >> 32) as u32);
      }

      t_lrStateStack[lrStackDepth] = nextState;
      t_lrNodeStack[lrStackDepth] = parentNode;
      t_lrScannerStack[lrStackDepth] = lrStackDepth > 0 ? t_lrScannerStack[lrStackDepth - 1] : 0;
      t_lrBalanceStack[lrStackDepth] = prevBalance;
      lrStackDepth++;

    } else if (type == ACTION_ACCEPT) {
      // debugLog(7777, currentState as u32, token as u32, lrStackDepth as u32);
      let rootNode = t_lrNodeStack[1];
      return cloneNodeShallow(rootNode);
    }
  }

  return 0;
}
