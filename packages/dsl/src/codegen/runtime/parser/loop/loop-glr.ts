// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Main GLR frontier parsing loop and error-recovery hypothesis dispatch.
 */

import { resetGSSProbe, ParseHead, t_activeHeads, t_nextHeads, activeHeadsCount, nextHeadsCount, pushActiveHead, pushNextHead, swapActiveAndNextHeads, allocParseHead, t_extractedHeadsBuffer, t_pausedHeads, pausedHeadsCount, resetPausedHeads, globalCursorDepth, saveCursorCheckpoint, restoreCursorCheckpoint, rebuildFrontierSummary } from "../gss";
import { getNodeType, getNodeFlags, getNodeByteLength, setNodeFlags, setNodePadding, propagateFirstChildPadding, FLAG_IS_LIST, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_HAS_ERROR, FLAG_EXTRACTED, resetGeneration } from "../../arena";
import { lexPos, lexLen, srcLexPos, currentScannerState, inputLength } from "../../parser";
import { TOKEN_EOF, ACTION_SHIFT, ACTION_REDUCE, ACTION_ACCEPT, action_offsets, action_data, prod_lengths, MAX_PARALLEL_HEADS, INFINITE_COST, LOOP_MULTIPLIER_LIMIT, t_lrStateStack, t_lrNodeStack, t_lrScannerStack, t_lrBalanceStack, lrStackDepth, MODE_LR, currentParserMode, debugLog, pushDiagnostic, getExpectedTokensForState, commitDiagnostics, globalLoopIterations, MAX_TERMINAL_ID, isReachableZeroDist, lookupGoto, configEnableBranchA1, configEnableBranchB, configEnableBranchC } from "../engine";
import { recoverStackSummary, recoverSkipToken, recoverMissingToken, findShiftTarget, tryLocalAStarRepair } from "../recovery";
import { g_counter_peak_active_heads, findActionEntry, resetFrontierLexMemo, stateCanAccept, getFrontierToken, invokeLexer, g_skipPos, g_skipPad, skipExtraTokens, restoreLexerState, g_reduceLookahead, updateExpectedTokens, furthestDyingPos, bestDyingHead, setBestDyingHead, setBestAcceptingHead, acceptedNode } from "./loop-actions";
import { cloneNodeShallow, getRightmostLeafSpan } from "./loop-tree";
import { concatLists } from "./loop-lists";
import { g_oldTree, g_editStart, g_editOldEnd, mapNewPosToOldPos, findReusableNode, reuseLookaheadMatches, advanceGlobalCursorTo } from "./loop-incremental";
import { processShiftAction, processReduceAction, breakdownTopOfStack, doAllPotentialReductions, processAcceptAction } from "./loop-glr-actions";
import { parseLR } from "./loop-lr";

/**
 * Graceful EOF Error Acceptance (Tree-sitter Strategy):
 * When parsing reaches TOKEN_EOF with unclosed blocks or unreduced constructs,
 * do not panic or flatten the CST. Instead, record an error diagnostic for the unclosed construct,
 * wrap the stack in an accepted root via processAcceptAction, and terminate cleanly.
 */
function recoverEofAccept(head: ParseHead, pos: u32): void {
  let span = getRightmostLeafSpan(head, pos);
  let diagStart = (span >>> 32) as u32;
  let diagEnd = (span & 0xffffffff) as u32;
  let exp = getExpectedTokensForState(head.state);
  head.errorTail = pushDiagnostic(head.errorTail, diagStart, diagEnd, TOKEN_EOF as u32, 2, (exp & 0xffffffff) as u32, ((exp >>> 32) & 0xffffffff) as u32);
  head.errorCost += 500;
  processAcceptAction(head);
  if (acceptedNode != 0) {
    setNodeFlags(acceptedNode, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  }
}

/**
 * Runs the error-recovery hypotheses for a head that cannot act on `tok`.
 * A repair (insertion/substitution) is speculative, so it is always raced against the
 * "stray token" hypothesis (skip it). Shared by the active and paused-head paths so the
 * outcome does not depend on whether the head happened to be paused first.
 */
function recoverHeadHypotheses(head: ParseHead, tok: i32, pos: u32): void {
  let didRecover = false;
  if (configEnableBranchB && head.consecutiveInsertions < 6) {
    didRecover = recoverMissingToken(head, tok, pos);
    if (!didRecover && tok != TOKEN_EOF) {
      didRecover = tryLocalAStarRepair(head, tok, pos);
    }
  }
  if (configEnableBranchC && (head.prev != null || head.inErrorState)) {
    let summaryRecovered = recoverStackSummary(head, tok, pos);
    if (summaryRecovered) didRecover = true;
  }
  if (configEnableBranchA1) {
    recoverSkipToken(head, tok, pos);
  }
}

/**
 * The main GLR parsing engine loop.
 * Operates in lockstep token-by-token rounds synchronized at the current byte position frontier.
 * Prunes and condenses heads in O(H) time without arbitrary iteration bounds.
 */
export function advanceGLR(): void {
  let lastCursorAdvancePos: u32 = 0xffffffff;
  while (activeHeadsCount > 0) {
    // Safe, non-speculative GLR -> LR re-entry:
    // When GLR has collapsed to a single clean, stabilized, linear ParseHead (no forks,
    // no paused heads, no pending acceptance, >= 4 clean shifts since recovery), hand
    // the exact linear stack back to `parseLR` and reclaim 100% of Gen0 memory.
    if (pausedHeadsCount == 0 && acceptedNode == 0) {
      let sole: ParseHead | null = null;
      let liveHeads: u32 = 0;
      for (let li: u32 = 0; li < activeHeadsCount; li++) {
        let hCand = changetype<ParseHead>(t_activeHeads[li]);
        if (!hCand.isDead) {
          sole = hCand;
          if (++liveHeads > 1) break;
        }
      }
      if (
        liveHeads == 1 &&
        sole != null &&
        !sole.inErrorState &&
        !sole.isPaused &&
        sole.errorNode == 0 &&
        sole.consecutiveInsertions == 0 &&
        sole.successfulShifts >= 2 &&
        sole.pos < inputLength
      ) {
        let depth: i32 = 0;
        let linear = true;
        let curr: ParseHead | null = sole;
        while (curr != null) {
          if ((sole.errorCost == 0 && curr.firstEdge != 0) || curr.inErrorState || curr.errorNode != 0 || depth >= 2048) {
            linear = false;
            break;
          }
          if (curr.prev == null) {
            if (curr.state != 0 || curr.astNode != 0) linear = false;
          }
          depth++;
          curr = curr.prev;
        }
        if (linear && depth > 0) {
          if (sole.errorTail != 0) {
            commitDiagnostics(sole.errorTail);
            sole.errorTail = 0;
          }
          let resumePos = sole.pos;
          let resumePad = sole.pendingPadding;
          let resumeScanner = sole.scannerState;

          // Materialize the linear spine bottom-up into the LR stacks before resetting Gen0.
          let writeIdx = depth - 1;
          curr = sole;
          while (curr != null && writeIdx >= 0) {
            t_lrStateStack[writeIdx] = curr.state as u32;
            t_lrNodeStack[writeIdx] = curr.astNode;
            t_lrScannerStack[writeIdx] = curr.scannerState;
            t_lrBalanceStack[writeIdx] = curr.balanceHash;
            writeIdx--;
            curr = curr.prev;
          }
          lrStackDepth = depth;

          // Clear all Gen0 references and reclaim 100% of Gen0 linear memory.
          setBestDyingHead(0);
          furthestDyingPos = 0;
          activeHeadsCount = 0;
          nextHeadsCount = 0;
          pausedHeadsCount = 0;
          resetGSSProbe();
          resetFrontierLexMemo();
          resetGeneration(0);

          currentScannerState = resumeScanner;
          currentParserMode = MODE_LR;
          let resumeTok = skipExtraTokens(invokeLexer(resumePos), resumePos, 1);
          let nextPad = resumePad + g_skipPad;
          let nextPos = g_skipPos;
          let lrAccepted = parseLR(nextPos, resumeTok, nextPad);
          if (currentParserMode == MODE_LR && lrAccepted != 0) {
            acceptedNode = lrAccepted;
            setBestAcceptingHead(0);
            return;
          }
          // parseLR hit another error/conflict and called transitionToGlr -> seamlessly resume GLR.
          lastCursorAdvancePos = 0xffffffff;
          continue;
        }
      }
    }

    if (activeHeadsCount > g_counter_peak_active_heads) g_counter_peak_active_heads = activeHeadsCount;
    if (nextHeadsCount > g_counter_peak_active_heads) g_counter_peak_active_heads = nextHeadsCount;
    if ((++globalLoopIterations as u32) > (inputLength > 1000 ? inputLength : 1000) * LOOP_MULTIPLIER_LIMIT) {
      break;
    }
    // 1. Find minimum byte offset frontier across all active heads
    let frontierPos: u32 = 0xffffffff;
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let h = changetype<ParseHead>(t_activeHeads[i]);
      if (h.isDead) continue;
      if (h.pos < frontierPos) {
        frontierPos = h.pos;
      }
    }
    if (frontierPos == 0xffffffff) break;

    // Monotonically advance the incremental reuse cursor once per frontierPos so per-head
    // save/restore checkpoints stay O(1) amortized instead of rewinding O(N) on every head.
    if (g_oldTree != 0 && globalCursorDepth >= 0 && frontierPos != lastCursorAdvancePos) {
      let oldFrontier = mapNewPosToOldPos(frontierPos);
      if (oldFrontier != 0xffffffff) {
        advanceGlobalCursorTo(oldFrontier);
        lastCursorAdvancePos = frontierPos;
      }
    }

    resetFrontierLexMemo();
    updateExpectedTokens(frontierPos);
    resetPausedHeads();

    // 2. Process all heads at frontierPos
    let i: u32 = 0;
    while (i < activeHeadsCount) {
      for (; i < activeHeadsCount; i++) {
        let head: ParseHead = changetype<ParseHead>(t_activeHeads[i]);
      if (head.isDead) continue;
      if (head.pos > furthestDyingPos || (head.pos == furthestDyingPos && bestDyingHead == 0)) {
        furthestDyingPos = head.pos;
        setBestDyingHead(changetype<u32>(head));
      }
      if (head.pos != frontierPos) {
        pushNextHead(changetype<u32>(head));
        continue;
      }
      // From here on this head's actions (incl. reductions) run; later merges must not
      // attach new predecessor edges to it (see ParseHead.processed).
      head.processed = true;

      // Skip token-type extras. The head stays at frontierPos: padding for the next
      // token is computed as `head.pendingPadding + (srcLexPos - frontierPos)`, which
      // already spans any skipped extras, so pendingPadding must not be bumped here.
      let tok = getFrontierToken(frontierPos, head.scannerState);

      // Check for Subtree Reuse
      let reusedNode: u32 = 0;
      let expectedPadding: u32 = (srcLexPos > frontierPos ? srcLexPos - frontierPos : 0) + head.pendingPadding;
      let headSym: u32 = 0xffffffff;
      if (head != null && head.astNode != 0 && head.firstEdge == 0 && head.errorTail == 0) {
        headSym = getNodeType(head.astNode) as u32;
      }
      if (g_oldTree != 0 && frontierPos < inputLength && tok != TOKEN_EOF) {
        let oldPos = mapNewPosToOldPos(frontierPos);
        let oldSrcLexPos = mapNewPosToOldPos(srcLexPos);
        if (oldSrcLexPos != 0xffffffff) {
          saveCursorCheckpoint();
          reusedNode = findReusableNode(
            oldPos,
            oldSrcLexPos,
            head.state,
            head.balanceHash & 0xff,
            g_editStart,
            g_editOldEnd,
            headSym,
            expectedPadding,
            tok
          );
          if (reusedNode == 0) {
            restoreCursorCheckpoint();
          }
        }
      }


      if (reusedNode != 0) {
        let totalPadding = expectedPadding;
        let nodeType = getNodeType(reusedNode);
        let isListChunk =
          head.astNode != 0 &&
          (getNodeFlags(reusedNode) & FLAG_IS_LIST) != 0 &&
          (nodeType as u32) == headSym &&
          head.firstEdge == 0 &&
          head.errorTail == 0;

        let savedLexPos = lexPos;
        let savedSrcLexPos = srcLexPos;
        let savedLexLen = lexLen;
        let savedScannerState = currentScannerState;

        if (isListChunk) {
          let endPos = srcLexPos + getNodeByteLength(reusedNode);
          let nextTok = skipExtraTokens(invokeLexer(endPos), endPos, 1);
          let canAccept = stateCanAccept(head, head.state, nextTok, 0, 1);
          if (canAccept == 0 && nextTok >= 0 && nextTok <= MAX_TERMINAL_ID) {
            let checkTok = nextTok == TOKEN_EOF ? 0 : nextTok;
            if (isReachableZeroDist(head.state, checkTok)) {
              canAccept = 1;
            }
          }
          if (canAccept != 0) {
            let clone = cloneNodeShallow(reusedNode);
            if (clone == 0) clone = reusedNode;
            setNodePadding(clone, totalPadding);
            setNodeFlags(clone, (getNodeFlags(clone) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
            let combined = concatLists(head.astNode, clone, nodeType, 0);
            let nextHead = allocParseHead(
              head.state,
              combined,
              head.prev,
              endPos,
              currentScannerState,
              head.errorCost,
              head.successfulShifts + 1,
              head.balanceHash,
              0,
              head.dynamicPrec,
              0,
              0
            );
            pushNextHead(changetype<u32>(nextHead));
            restoreCursorCheckpoint();
            continue;
          } else {
            restoreCursorCheckpoint();
            restoreLexerState(savedLexPos, savedSrcLexPos, savedLexLen, savedScannerState);
          }
        } else {
          let nextState = nodeType > (MAX_TERMINAL_ID as u16)
            ? lookupGoto(head.state as i32, nodeType as i32)
            : findShiftTarget(head.state as i32, nodeType);

          if (nextState != -1) {
            let endPos = srcLexPos + getNodeByteLength(reusedNode);
            let nextTok = skipExtraTokens(invokeLexer(endPos), endPos, 1);
            let canAccept = stateCanAccept(head, nextState, nextTok, 0, 1);
            if (canAccept == 0 && nextTok >= 0 && nextTok <= MAX_TERMINAL_ID) {
              let checkTok = nextTok == TOKEN_EOF ? 0 : nextTok;
              if (isReachableZeroDist(nextState, checkTok)) {
                canAccept = 1;
              }
            }
            if (canAccept != 0 && !reuseLookaheadMatches(reusedNode, nextTok)) {
              canAccept = 0;
            }
            if (canAccept == 0) {
              nextState = -1;
            }
          }

          if (nextState != -1) {
            let clone = cloneNodeShallow(reusedNode);
            if (clone == 0) clone = reusedNode;
            setNodePadding(clone, totalPadding);
            setNodeFlags(clone, (getNodeFlags(clone) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
            propagateFirstChildPadding(clone, totalPadding);

            let newPos = savedSrcLexPos + getNodeByteLength(reusedNode);

            let nextHead = allocParseHead(
              nextState,
              clone,
              head,
              newPos,
              currentScannerState,
              head.errorCost,
              head.successfulShifts + 1,
              head.balanceHash,
              0,
              head.dynamicPrec,
              0,
              head.errorTail
            );
            pushNextHead(changetype<u32>(nextHead));
            restoreCursorCheckpoint();
            continue;
          } else {
            restoreCursorCheckpoint();
            // Undo the speculative re-lex so the standard action loop below sees `tok`'s lexer state.
            restoreLexerState(savedLexPos, savedSrcLexPos, savedLexLen, savedScannerState);
          }
        }
      }

      g_reduceLookahead = tok as u32;

      // Standard LR action loop: exact match -> wildcard fallback -> SHIFT/ACCEPT/REDUCE
      let didAct = false;
      let reductionGuard: u32 = 0;
      let breakdownAttempted = false;
      let preReduceAttempted = false;

      while (reductionGuard++ < 100 && !didAct) {
        let actionOffset = action_offsets[head.state];
        if (actionOffset < 0 || actionOffset >= action_data.length) break;

        let matchIdx = findActionEntry(head.state, tok);
        let foundTok = false;
        let actOffsetInActions = -1;
        let totalActionsForSym = 0;
        if (matchIdx != -1) {
          foundTok = true;
          totalActionsForSym = action_data[matchIdx + 1];
          actOffsetInActions = matchIdx + 2;
        }

        // Pass 3: Reused node decomposition & default reduction
        if (!foundTok) {
          // Step 3a: Decompose top-of-stack reused composite node (Tree-sitter breakdown_top_of_stack)
          // If the top of stack was reused from the previous tree, but the next token cannot
          // be shifted in the current state, the reuse was too coarse.
          // Decompose the reused node into its children BEFORE applying any default reductions.
          let brokenHead = breakdownTopOfStack(head);
          if (brokenHead != null) {
            head = brokenHead;
            continue;
          }

          // Step 3b: Default reduction if state has only consistent non-epsilon reductions and no shifts
          let hasAnyShift = false;
          let candidateReduce = -1;
          let hasConflictingReduce = false;
          let actCount = action_data[actionOffset];
          let idx = actionOffset + 1;
          for (let a = 0; a < actCount; a++) {
            let sym = action_data[idx++];
            let numActions = action_data[idx++];
            for (let na = 0; na < numActions; na++) {
              let aType = action_data[idx++];
              let aTarget = action_data[idx++];
              if (aType == ACTION_SHIFT) {
                hasAnyShift = true;
              } else if (aType == ACTION_REDUCE) {
                let pLen = prod_lengths[aTarget];
                if (pLen > 0) {
                  if (candidateReduce == -1) {
                    candidateReduce = aTarget;
                  } else if (candidateReduce != aTarget) {
                    hasConflictingReduce = true;
                  }
                }
              }
            }
          }
          if (!hasAnyShift && candidateReduce != -1 && !hasConflictingReduce) {
            let reducedHead = processReduceAction(head, candidateReduce, frontierPos);
            if (reducedHead != null) {
              head = reducedHead;
              continue;
            }
          }

          // Step 3c: Pre-error lookahead-independent reductions (Tree-sitter do_all_potential_reductions)
          if (!preReduceAttempted) {
            preReduceAttempted = true;
            let preReducedHead = doAllPotentialReductions(head, frontierPos, tok);
            if (preReducedHead != head) {
              head = preReducedHead;
              continue;
            }
          }

          break;
        }

        if (totalActionsForSym == 1) {
          let aType = action_data[actOffsetInActions];
          let aTarget = action_data[actOffsetInActions + 1];
          if (aType == ACTION_ACCEPT) {
            processAcceptAction(head);
            didAct = true;
            break;
          } else if (aType == ACTION_SHIFT) {
            processShiftAction(head, aTarget, tok, frontierPos, false, false);
            didAct = true;
            break;
          } else if (aType == ACTION_REDUCE) {
            let reducedHead = processReduceAction(head, aTarget, frontierPos);
            if (reducedHead != null) {
              head = reducedHead;
              continue;
            }
            break;
          }
        } else if (totalActionsForSym > 1) {
          // GLR Fork: Execute all conflicting actions
          for (let na = 0; na < totalActionsForSym; na++) {
            let aType = action_data[actOffsetInActions + na * 2];
            let aTarget = action_data[actOffsetInActions + na * 2 + 1];
            if (aType == ACTION_ACCEPT) {
              processAcceptAction(head);
              didAct = true;
            } else if (aType == ACTION_SHIFT) {
              processShiftAction(head, aTarget, tok, frontierPos, false, false);
              didAct = true;
            } else if (aType == ACTION_REDUCE) {
              let redHead = processReduceAction(head, aTarget, frontierPos, true);
              if (redHead != null) {
                pushActiveHead(changetype<u32>(redHead));
                didAct = true;
              }
            }
          }
          break;
        }
        break;
      }

      if (!didAct) {
        if (tok != TOKEN_EOF) {
          // Tree-sitter Version Pausing:
          // If other heads are alive or have already shifted this token, pause this failing head.
          if ((activeHeadsCount > 1 || nextHeadsCount > 0) && pausedHeadsCount < 64) {
            head.isPaused = true;
            head.pausedLookahead = tok;
            t_pausedHeads[pausedHeadsCount++] = changetype<u32>(head);
            debugLog(9201, changetype<u32>(head), tok, pausedHeadsCount);
          } else {
            recoverHeadHypotheses(head, tok, frontierPos);
          }
        } else {
          // Graceful EOF Error Acceptance (Tree-sitter Strategy):
          // If the parser reached EOF with an unclosed construct, do not drop into catastrophic panic.
          // Instead, record an error diagnostic for the unclosed construct and accept the tree.
          recoverEofAccept(head, frontierPos);
        }
      }
    }
      // Tree-sitter Strategy: Compare best paused head against advanced heads in nextHeads
      if (pausedHeadsCount > 0) {
        let minNextCost = INFINITE_COST;
        for (let ni: u32 = 0; ni < nextHeadsCount; ni++) {
          let nh = changetype<ParseHead>(t_nextHeads[ni]);
          if (nh.errorCost < minNextCost) minNextCost = nh.errorCost;
        }

        let bestPausedHead: ParseHead | null = null;
        let bestPausedCost = INFINITE_COST;
        let bestPausedPrec: i32 = -999999;
        for (let p: u32 = 0; p < pausedHeadsCount; p++) {
          let cand = changetype<ParseHead>(t_pausedHeads[p]);
          if (cand.errorCost < bestPausedCost || (cand.errorCost == bestPausedCost && cand.dynamicPrec > bestPausedPrec)) {
            bestPausedHead = cand;
            bestPausedCost = cand.errorCost;
            bestPausedPrec = cand.dynamicPrec;
          }
        }

        // Resume best paused head if all heads stalled; OR if paused head has strictly lower error cost than advanced heads!
        if (bestPausedHead != null && (nextHeadsCount == 0 || bestPausedCost < minNextCost)) {
          bestPausedHead.isPaused = false;
          let resumeTok = bestPausedHead.pausedLookahead;
          debugLog(9202, changetype<u32>(bestPausedHead), resumeTok, nextHeadsCount);
          if (resumeTok != TOKEN_EOF) {
            getFrontierToken(bestPausedHead.pos, bestPausedHead.scannerState);
            recoverHeadHypotheses(bestPausedHead, resumeTok, bestPausedHead.pos);
          } else {
            recoverEofAccept(bestPausedHead, bestPausedHead.pos);
          }

          // If all active heads stalled, also resume up to 2 other viable paused heads
          if (nextHeadsCount == 0 && pausedHeadsCount > 1) {
            let resumedCount: u32 = 1;
            for (let p: u32 = 0; p < pausedHeadsCount && resumedCount < 3; p++) {
              let cand = changetype<ParseHead>(t_pausedHeads[p]);
              if (cand != bestPausedHead && cand.errorCost <= bestPausedCost + 500) {
                cand.isPaused = false;
                let cTok = cand.pausedLookahead;
                debugLog(9202, changetype<u32>(cand), cTok, nextHeadsCount);
                if (cTok != TOKEN_EOF) {
                  getFrontierToken(cand.pos, cand.scannerState);
                  recoverHeadHypotheses(cand, cTok, cand.pos);
                } else {
                  recoverEofAccept(cand, cand.pos);
                }
                resumedCount++;
              }
            }
          }
        }
        pausedHeadsCount = 0;
      }
    }

    // 3. Condense and prune next heads (Top-K heap extraction)
    if (nextHeadsCount > MAX_PARALLEL_HEADS) {
      // Compact live heads first so dead heads never compete for Top-K slots
      let liveCount: u32 = 0;
      for (let li: u32 = 0; li < nextHeadsCount; li++) {
        let hLive = changetype<ParseHead>(t_nextHeads[li]);
        if (!hLive.isDead) {
          t_nextHeads[liveCount++] = t_nextHeads[li];
        }
      }
      nextHeadsCount = liveCount;
    }
    if (nextHeadsCount > MAX_PARALLEL_HEADS) {
      let heapLen = nextHeadsCount;
      for (let hi: i32 = (heapLen as i32) / 2 - 1; hi >= 0; hi--) {
        let ci: u32 = hi as u32;
        while (true) {
          let smallest = ci;
          let left = ci * 2 + 1;
          let right = ci * 2 + 2;
          if (left < heapLen) {
            let hL = changetype<ParseHead>(t_nextHeads[left]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cL = hL.errorCost == 0 ? 0 : (hL.errorCost > (hL.successfulShifts * 15) ? hL.errorCost - (hL.successfulShifts * 15) : 1);
            let cS = hS.errorCost == 0 ? 0 : (hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 1);
            if (cL < cS || (cL == cS && hL.dynamicPrec > hS.dynamicPrec)) smallest = left;
          }
          if (right < heapLen) {
            let hR = changetype<ParseHead>(t_nextHeads[right]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cR = hR.errorCost == 0 ? 0 : (hR.errorCost > (hR.successfulShifts * 15) ? hR.errorCost - (hR.successfulShifts * 15) : 1);
            let cS = hS.errorCost == 0 ? 0 : (hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 1);
            if (cR < cS || (cR == cS && hR.dynamicPrec > hS.dynamicPrec)) smallest = right;
          }
          if (smallest == ci) break;
          let tmp = t_nextHeads[ci];
          t_nextHeads[ci] = t_nextHeads[smallest];
          t_nextHeads[smallest] = tmp;
          ci = smallest;
        }
      }
      let sortLimit: u32 = heapLen < MAX_PARALLEL_HEADS ? heapLen : MAX_PARALLEL_HEADS;
      for (let ei: u32 = 0; ei < sortLimit && heapLen > 0; ei++) {
        t_extractedHeadsBuffer[ei] = t_nextHeads[0];
        t_nextHeads[0] = t_nextHeads[heapLen - 1];
        heapLen--;
        let ci: u32 = 0;
        while (true) {
          let smallest = ci;
          let left = ci * 2 + 1;
          let right = ci * 2 + 2;
          if (left < heapLen) {
            let hL = changetype<ParseHead>(t_nextHeads[left]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cL = hL.errorCost == 0 ? 0 : (hL.errorCost > (hL.successfulShifts * 15) ? hL.errorCost - (hL.successfulShifts * 15) : 1);
            let cS = hS.errorCost == 0 ? 0 : (hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 1);
            if (cL < cS || (cL == cS && hL.dynamicPrec > hS.dynamicPrec)) smallest = left;
          }
          if (right < heapLen) {
            let hR = changetype<ParseHead>(t_nextHeads[right]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cR = hR.errorCost == 0 ? 0 : (hR.errorCost > (hR.successfulShifts * 15) ? hR.errorCost - (hR.successfulShifts * 15) : 1);
            let cS = hS.errorCost == 0 ? 0 : (hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 1);
            if (cR < cS || (cR == cS && hR.dynamicPrec > hS.dynamicPrec)) smallest = right;
          }
          if (smallest == ci) break;
          let tmp = t_nextHeads[ci];
          t_nextHeads[ci] = t_nextHeads[smallest];
          t_nextHeads[smallest] = tmp;
          ci = smallest;
        }
      }
      for (let ei: u32 = 0; ei < sortLimit; ei++) {
        t_nextHeads[ei] = t_extractedHeadsBuffer[ei];
      }
      nextHeadsCount = sortLimit;
      rebuildFrontierSummary(1, t_nextHeads, nextHeadsCount);
    }

    // 4. Swap buffers and advance
    swapActiveAndNextHeads();

    // 5. Note on GLR-to-LR Transition:
    // Speculative parseLR invocation from GLR causes unbounded AST node accumulation in Gen1 because
    // failed parseLR attempts cannot roll back bump allocations without a transactional arena watermark.
    // In pure GLR mode, single-head paths are already deterministic and linear, keeping memory strictly bounded.
  }
}
