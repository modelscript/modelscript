import { ParseHead, ErrorBranch, allocErrorBranch, pushActiveHead, allocParseHead, t_activeHeads, activeHeadsCount, setActiveHeadsCount, pushCandidateHead, t_candidateHeadsBuffer, candidateHeadsCount } from "./gss";
import { debugLog, pushDiagnostic, MAX_ERRORS, MAX_CHILD_NODES, t_globalChildNodes, MAX_TERMINAL_ID,
  action_offsets, action_data, ACTION_SHIFT, MAX_PANIC_SCAN_TOKENS, token_insert_costs, token_delete_costs, token_is_word, token_is_operator,
  NODE_TYPE_ERROR, goto_offsets, goto_data, configEnableBranchA1, configEnableBranchB, configEnableBranchT, configEnableIslandMode, ACTION_REDUCE, configPenaltyUnwindNode, configPenaltySyncToken, configIslandBasePenalty, configIslandSyncMultiplier, configIslandPoppedMultiplier, prod_is_list, type_is_list,
  inputLength
} from "./engine";
import { advanceGLR, stateCanAccept, cloneNodeShallow, concatLists, appendToList, isPureErrorNode, g_stateCanAcceptMaxCost, isEpsilonReachable, resetSimulator, getBestAcceptingHead, saveSimulationState, restoreSimulationState, fixNodeLength, findGotoSymbol } from "./parser-loop";
import {
  COST_SUBSTITUTION_KEYWORD,
  COST_SUBSTITUTION_STANDARD,
  COST_SHIFT_TRANSITION,
  COST_SHIFT_REOPEN_BASE,
  COST_SHIFT_REOPEN_PER_UNWIND,
  COST_DELETE_BASE_MULTIPLIER,
  PENALTY_DELETE_LINE_END_DANGLING,
  PENALTY_DELETE_NEWLINE_CROSS,
  PENALTY_DELETE_DEEP_UNWIND_LINE_MERGE,
  COST_DELETE_DUPLICATE_TOKEN,
  THRESHOLD_DELETE_SCAN_LIMIT,
  COST_INSERT_BASE_DEFAULT,
  PENALTY_INSERT_STRUCTURAL_BRACE,
  PENALTY_SUBSTITUTION_CROSS_LINE,
  PENALTY_INSERT_CROSS_LINE,
  PENALTY_INSERT_MULTI_TOKEN_CROSS_LINE,
  THRESHOLD_INSERT_MAX_COST,
  THRESHOLD_PANIC_MODE_CUTOFF,
  THRESHOLD_HEAD_PRUNING_DISTANCE,
  COST_ISLAND_INITIAL_SYNC,
  MAX_RECOVERY_CANDIDATES,
  RECOVERY_BEAM_WIDTH,
  PENALTY_WEAK_LOOKAHEAD
} from "./recovery-config";
import { prod_lengths, prod_lhs, logInt } from "./parser";
@inline function isListNodeByPtr(node: u32): boolean { return node != 0 && (getNodeFlags(node) & FLAG_IS_LIST) != 0; }
import { 
  getNodePadding, 
  setNodePadding,
  getNodeLeadingPad,
  getNodeByteLength, 
  setNodeByteLength, 
  getNodeFirstChild, 
  setFirstChild, 
  setNextSibling,
  getNodeNextSibling,
  getNodeType,
  allocNode,
  getInputBuffer,
  ASTNode,
  FLAG_IS_INSERTED,
  FLAG_HAS_ERROR,
  FLAG_IS_LIST,
  FLAG_INVISIBLE,
  getNodeFlags,
  setNodeFlags,
  cloneNode,
  S,
  resetGeneration,
  atomicChunkAlloc,
  getNodeEnvHash
} from "./arena";
import { UnmanagedUint16Array, UnmanagedUint8Array, UnmanagedUint32Array } from "./array";
import {
  lexPos,
  lexLen,
  srcLexPos,
  currentScannerState,
  invokeLexer,
  is_extra_token,
  lex,
  expected_tokens,
  setLexPos,
  setLexLen,
  setSrcLexPos,
  setCurrentScannerState,
  TOKEN_EOF,
  TOKEN_UNKNOWN,
  SYMBOL_COUNT,
  peekChar,
  peekCharLen,
  inputEncoding,
  reachability_matrix,
  precomputed_repairs,
  state_scope_bounds,
  min_yield_offsets,
  min_yield_data
} from "./parser";

const t_branchB_outTokens = new Int32Array(8);
const t_branchB_outStates = new Int32Array(8);
const t_branchB_confirmedShifts = new Int32Array(8);
const t_branchA1_outStates = new Int32Array(1);
const t_expanded_tokens = new Int32Array(16);
const savedHeadsBuffer = changetype<UnmanagedUint32Array>(atomicChunkAlloc(16384 * 4));

export function simulateLookahead(
  baseHead: ParseHead,
  outStates: Int32Array | null,
  depth: i32,
  tok1: i32,
  tok2: i32 = -1,
  tok3: i32 = -1,
  targetCost: i32 = 999999,
  maxTokens: i32 = 3,
  resumePos: i32 = -1,
  tok1Len: i32 = 0
): i32 {
  // 1. Backup globals
  let savedCount = activeHeadsCount;
  if (savedCount > 16384) savedCount = 16384;
  memory.copy(changetype<usize>(savedHeadsBuffer), changetype<usize>(t_activeHeads), savedCount * 4);
  
  let oldGen = S().activeGeneration;
  let savedFreeNodeHead = S().freeNodeHead;
  let savedFatPaddingCount = S().fatPaddingCount;
  S().activeGeneration = 2; // Scratch Arena
  S().freeNodeHead = 0; // Prevent Gen2 from handing out or corrupting Gen1 free-list nodes
  
  // 2. Build temporary heads
  let tempHead: ParseHead;
  if (outStates != null && depth >= 0) {
    let p = resumePos == -1 ? baseHead.pos : (resumePos as u32);
    tempHead = baseHead;
    for(let i: i32 = 0; i <= depth; i++) {
      tempHead = allocParseHead(outStates[i], 0, tempHead, p, baseHead.scannerState, 0, 0, 0, 0, baseHead.dynamicPrec, 0, baseHead.errorTail, 0, 0, 0, 0, 0, 0);
    }
  } else {
    // Clone baseHead into the Scratch Arena to safely receive virtual tokens without mutating the Main Arena
    let p = resumePos == -1 ? baseHead.pos : (resumePos as u32);
    tempHead = allocParseHead(baseHead.state, baseHead.astNode, baseHead.prev, p, baseHead.scannerState, baseHead.errorCost, 0, baseHead.balanceHash, baseHead.consecutiveInsertions, baseHead.dynamicPrec, baseHead.pendingPadding, baseHead.errorTail, 0, 0, 0, 0, 0, 0);
  }
  
  // 3. Setup Virtual Tokens
  let vCount = 0;
  // ONLY put tok1 in the virtual queue if it is HALLUCINATED (tok1Len == 0)!
  // If it is a real token, the parser will naturally read it from the input buffer via invokeLexer!
  if (tok1 != -1 && tok1Len == 0) {
    tempHead.virtualQueue0 = (tok1 & 0xFFFF) | ((tok1Len as u32) << 16);
    vCount++;
    if (tok2 != -1 && tok1Len == 0) { // wait, if tok1 is real, tok2 shouldn't exist, but just in case
      tempHead.virtualQueue1 = tok2;
      vCount++;
      if (tok3 != -1 && tok1Len == 0) {
        tempHead.virtualQueue2 = tok3;
        vCount++;
      }
    }
  }
  tempHead.virtualQueueCount = vCount;
  
  saveSimulationState();
  resetSimulator(targetCost, maxTokens);
  setActiveHeadsCount(1);
  t_activeHeads[0] = changetype<u32>(tempHead);
  
  let startPos: u32 = resumePos == -1 ? baseHead.pos : (resumePos as u32);
  let simSteps = 0;
  let maxSimSteps = maxTokens + vCount + 2;
  while (activeHeadsCount > 0 && getBestAcceptingHead() == 0 && simSteps < maxSimSteps) {
    advanceGLR();
    simSteps++;
  }
  
  let maxShifts: i32 = 0;
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    let h = changetype<ParseHead>(t_activeHeads[i]);
    if (h.successfulShifts > maxShifts) {
      maxShifts = h.successfulShifts;
    } else if (h.pos > startPos && maxShifts == 0) {
      maxShifts = 1;
    }
  }
  let bestH = changetype<ParseHead>(getBestAcceptingHead());
  if (bestH != null) {
    if (bestH.successfulShifts > maxShifts) {
      maxShifts = bestH.successfulShifts;
    } else if (maxShifts == 0) {
      maxShifts = 1;
    }
  }
  let result = (getBestAcceptingHead() != 0 || (activeHeadsCount > 0 && maxShifts > 0)) ? maxShifts : 0;
  
  restoreSimulationState();
  resetGeneration(2);
  S().activeGeneration = oldGen;
  S().freeNodeHead = savedFreeNodeHead;
  S().fatPaddingCount = savedFatPaddingCount;
  
  // Clear stale Gen2 pointers that were pushed during the simulation
  if (activeHeadsCount > savedCount) {
    memory.fill(changetype<usize>(t_activeHeads) + savedCount * 4, 0, (activeHeadsCount - savedCount) * 4);
  }
  
  setActiveHeadsCount(savedCount);
  memory.copy(changetype<usize>(t_activeHeads), changetype<usize>(savedHeadsBuffer), savedCount * 4);
  
  return result;
}

function searchBudgetedInsertions(
  unwindCurr: ParseHead,
  currentState: i32,
  laTok: i32,
  budget: i32,
  depth: i32,
  maxDepth: i32,
  outTokens: Int32Array,
  outStates: Int32Array,
  laTokLen: i32 = 0,
  laTokPos: i32 = -1
): i32 {
  if (depth >= maxDepth) return -1;

  
  let actOffset = action_offsets[currentState];
  if (actOffset < 0 || actOffset >= action_data.length) return -1;
  
  let numTerminals = action_data[actOffset];
  if (numTerminals > budget) return -1; // Abort: Too ambiguous
  
  let actIdx = actOffset + 1;
  for (let i = 0; i < numTerminals; i++) {
    let sym = action_data[actIdx];
    let actCount = action_data[actIdx + 1];
    let aIdx = actIdx + 2;
    actIdx += 2 + actCount * 2;
    
    // Skip EOF unless it's the actual lookahead
    if (sym == TOKEN_EOF && laTok != TOKEN_EOF) continue;
    
    let shiftTarget = -1;
    let reduceTarget = -1;
    
    for (let j = 0; j < actCount; j++) {
      let aType = action_data[aIdx++];
      let aTarget = action_data[aIdx++];
      if (aType == ACTION_SHIFT) {
        shiftTarget = aTarget;
      } else if (aType == ACTION_REDUCE) {
        if (load<i32>(prod_lengths + (aTarget << 2)) == 0) {
          reduceTarget = aTarget;
        }
      }
    }
    
    // Branch 1: Try shifting terminal
    if (shiftTarget != -1 && sym <= MAX_TERMINAL_ID) {
      let remainingDepth = maxDepth - depth - 1;
      let dist = 255;
      if (laTok <= MAX_TERMINAL_ID) {
        dist = load<u32>(reachability_matrix + ((shiftTarget * (MAX_TERMINAL_ID + 1) + laTok) << 2));
      } else {
        dist = 0; // Don't prune EOF or special tokens
      }

      if (dist > remainingDepth) continue;

      let isKeywordSym = (sym <= MAX_TERMINAL_ID && token_is_word[sym] == 1 && load<u8>(is_extra_token + sym) == 0);
      if (isKeywordSym) {
        let appearsDownstream = false;
        let savedScanPosS = srcLexPos;
        let savedLexLenS = lexLen;
        let savedStateS = currentScannerState;
        let lookPos = (laTokPos >= 0 ? (laTokPos as u32) : (unwindCurr.pos as u32));
        let maxLook = lookPos + 60;
        if (maxLook > inputLength) maxLook = inputLength;
        while (lookPos < maxLook) {
          let peekT = invokeLexer(lookPos);
          if (peekT == -1 || peekT == TOKEN_EOF) break;
          if (peekT == sym) {
            appearsDownstream = true;
            break;
          }
          lookPos = srcLexPos + (lexLen > 0 ? lexLen : 1);
        }
        setSrcLexPos(savedScanPosS);
        setLexLen(savedLexLenS);
        setCurrentScannerState(savedStateS);
        if (appearsDownstream) {
          continue;
        }
      }

      let insCost = getInsertCost(sym);
      if (insCost >= 1000) {
        insCost = 200; // Standard minimal-yield synthetic placeholder insertion cost
      }
      outStates[depth] = shiftTarget;
      let simRes = simulateLookahead(unwindCurr, outStates, depth, laTok, -1, -1, unwindCurr.errorCost + insCost, 3, laTokPos, laTokLen);

      if (simRes > 0) {
        if (depth < 8) t_branchB_confirmedShifts[depth] = simRes;
        outTokens[depth] = sym;
        return depth + 1;
      }
      
      let res = searchBudgetedInsertions(
        unwindCurr, shiftTarget, laTok,
        budget - numTerminals, depth + 1, maxDepth,
        outTokens, outStates,
        laTokLen, laTokPos
      );
      if (res > 0) {
        outTokens[depth] = sym;
        outStates[depth] = shiftTarget;
        return res;
      }
    }
    
    // Branch 2: Try empty reduction (hallucinating non-terminal)
    if (reduceTarget != -1) {
      let ruleLHS = load<i32>(prod_lhs + (reduceTarget << 2));
      let nextState = -1;
      let gOffset = goto_offsets[currentState];
      if (gOffset >= 0 && gOffset < goto_data.length) {
        let gCount = goto_data[gOffset];
        let gIdx = gOffset + 1;
        for (let k = 0; k < gCount; k++) {
          if (goto_data[gIdx++] == ruleLHS) {
            nextState = goto_data[gIdx];
            break;
          }
          gIdx++;
        }
      }
      
      if (nextState != -1) {
        let remainingDepth = maxDepth - depth - 1;
        let dist = 255;
        if (laTok <= MAX_TERMINAL_ID) {
          dist = load<u32>(reachability_matrix + ((nextState * (MAX_TERMINAL_ID + 1) + laTok) << 2));
        } else {
          dist = 0;
        }
        if (dist > remainingDepth) continue;
        outTokens[depth] = ruleLHS;
        outStates[depth] = nextState;
        
        let simRes2 = simulateLookahead(unwindCurr, outStates, depth, laTok, -1, -1, unwindCurr.errorCost + (COST_SUBSTITUTION_STANDARD * 10), 3, laTokPos, laTokLen);
        if (simRes2 > 0) {
          if (depth < 8) t_branchB_confirmedShifts[depth] = simRes2;
          return depth + 1;
        }
        
        let res = searchBudgetedInsertions(
          unwindCurr, nextState, laTok,
          budget, depth + 1, maxDepth, // don't decrease budget for empty reductions
          outTokens, outStates,
          laTokLen, laTokPos
        );
        if (res > 0) return res;
      }
    }
  }
  
  return -1;
}

export let errorQueueHead: u32 = 0;
export let errorQueueTail: u32 = 0;

export function clearErrorQueue(): void {
  errorQueueHead = 0;
  errorQueueTail = 0;
}

const CHAR_LBRACE: u8 = 123;
const CHAR_RBRACE: u8 = 125;
const CHAR_LBRACKET: u8 = 91;
const CHAR_RBRACKET: u8 = 93;
const CHAR_LPAREN: u8 = 40;
const CHAR_RPAREN: u8 = 41;


function markTreeError(n: u32): void {
  if (n == 0) return;
  setNodeFlags(n, getNodeFlags(n) | FLAG_HAS_ERROR);
  let c = getNodeFirstChild(n);
  while (c != 0) {
    markTreeError(c);
    c = getNodeNextSibling(c);
  }
}

@inline
function getInsertCost(tok: i32): i32 {
  if (tok < 0 || tok >= token_insert_costs.length) return 250;
  let baseCost = token_insert_costs[tok] * 5;
  if (token_insert_costs[tok] >= 10) {
    baseCost += PENALTY_INSERT_STRUCTURAL_BRACE; // Structural closing braces ("}", "]", ")")
  }
  return baseCost;
}

@inline
function getDeleteCost(tok: i32): i32 {
  if (tok < 0 || tok >= token_delete_costs.length) return 10;
  if (tok <= MAX_TERMINAL_ID && (token_insert_costs[tok] >= 20 || token_delete_costs[tok] <= 1)) {
    return PENALTY_INSERT_MULTI_TOKEN_CROSS_LINE; // Structural keywords/delimiters are expensive to delete to prevent code destruction
  }
  let c = token_delete_costs[tok] * COST_DELETE_BASE_MULTIPLIER;
  return c < 10 ? 10 : c;
}

@inline
function getDeleteCostForState(tok: i32, state: i32): i32 {
  let cost = getDeleteCost(tok);
  if (state >= 0 && tok > 0 && tok <= MAX_TERMINAL_ID) {
    let isBound = load<u8>(state_scope_bounds + (state * (MAX_TERMINAL_ID + 1) + tok));
    if (isBound == 1) {
      cost += PENALTY_DELETE_DEEP_UNWIND_LINE_MERGE;
    }
  }
  return cost;
}

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

@inline
export function recoverUnwindAndMutate(
  head: ParseHead,
  token: i32,
  inputLength: u32,
  bestAcceptedCost: i32
): boolean {
        // === ERROR RECOVERY ENTRY ===
        
        // ERROR RECOVERY: Deletion and Insertion (Unwind & Mutate)


        // ----------------------------------------------------------------
        let initialScannerState = currentScannerState;
        let initialSrcLexPos = srcLexPos;
        let initialLexLen = lexLen;
        let initialHeadCount: u32 = activeHeadsCount;
        candidateHeadsCount = 0;
        
        memory.fill(changetype<usize>(expected_tokens), 1, 2048);
        
        // If forced reduction didn't work, we iteratively pop (unwind) states from the GSS
        // up to a depth of 5. For each popped state, we attempt:
        // Branch A (Deletion): Deleting the current token (skip)
        // Branch B (Insertion): Inserting a missing token (virtual shift)


        let unwindCurr: ParseHead | null = head;
        let unwindDepth = 0;

        while (unwindCurr != null && unwindDepth < 6) {
          let recState = unwindCurr.state;
          let recPrev = unwindCurr.prev;
          let recBalance = unwindCurr.balanceHash;
          let recPrec = unwindCurr.dynamicPrec;

          // Note: The scope boundary check that previously prevented unwinding
          // past }/)/] has been removed. It was scanning [unwindCurr.pos, head.pos)
          // which looks backward into already-parsed input. After a valid reduction
          // like `scope {}`, the `}` was inside this range despite being part of a
          // successfully consumed production, causing ALL structural recovery to be
          // aborted at depth 1. The PENALTY_UNWIND_NODE cost (500 per depth level)
          // is sufficient to naturally prevent excessively deep unwinds.

          // ------------------------------------------------------------
          // Branch R (Re-open Premature Empty Block):
          // ------------------------------------------------------------
          if (unwindDepth == 0 && unwindCurr.astNode != 0 && unwindCurr.prev != null) {
            let hp = unwindCurr.prev;
            if (hp != null) {
              let topNode = unwindCurr.astNode;
              let c1 = getNodeFirstChild(topNode);
              if (c1 != 0) {
                let c2 = getNodeNextSibling(c1);
                if (c2 != 0 && getNodeNextSibling(c2) == 0) {
                  let c2Len = getNodeByteLength(c2);
                  let isClosingBrace = false;
                  if (c2Len > 0 && unwindCurr.pos >= c2Len) {
                    let ch = peekChar(unwindCurr.pos - c2Len);
                    if (ch == 125 || ch == 41 || ch == 93) isClosingBrace = true; // }, ), ]
                  }
                  if (isClosingBrace) {
                    let st1 = findShiftTarget(hp.state, getNodeType(c1));
                    if (st1 != -1) {
                      let st2 = findShiftTarget(st1, getNodeType(c2));
                    if (st2 != -1) {
                      let openBlockNode = concatLists(c1, c2, getNodeType(topNode), 0);
                      let tempSt2Head = allocParseHead(
                        st2,
                        openBlockNode,
                        hp,
                        unwindCurr.pos,
                        initialScannerState,
                        0,
                        0,
                        unwindCurr.balanceHash,
                        0,
                        recPrec,
                        0,
                        0
                      );
                      let canAcceptErrorTok = stateCanAccept(tempSt2Head, st2, token, 0);
                      if (canAcceptErrorTok > 0) {
                        let openBlockNode = concatLists(c1, c2, getNodeType(topNode), 0);
                        let errBraceNode = allocNode(NODE_TYPE_ERROR, 0, 0, 0);
                        setNodeFlags(errBraceNode, FLAG_HAS_ERROR | FLAG_IS_INSERTED);
                        openBlockNode = concatLists(openBlockNode, errBraceNode, getNodeType(topNode), 0);
                        let reopenCost = unwindCurr.errorCost + COST_SHIFT_REOPEN_BASE + (unwindDepth * COST_SHIFT_REOPEN_PER_UNWIND);
                        let errPos = unwindCurr.pos > 0 ? unwindCurr.pos - 1 : 0;
                        let newTailR = unwindCurr.errorTail;
                        newTailR = pushDiagnostic(unwindCurr.errorTail, errPos, unwindCurr.pos);
                        let reopenHead = allocParseHead(
                          st2,
                          openBlockNode,
                          hp,
                          unwindCurr.pos,
                          initialScannerState,
                          reopenCost,
                          0,
                          unwindCurr.balanceHash,
                          0,
                          recPrec,
                          0,
                          newTailR
                        );
                        pushCandidateHead(changetype<u32>(reopenHead));
                      }
                    }
                  }
                }
              }
            }
          }
        }

          // ------------------------------------------------------------
          // Branch T (Transposition): Swapped Tokens
          // ------------------------------------------------------------
          if (configEnableBranchT && token != TOKEN_EOF && unwindDepth == 0 && head.consecutiveInsertions == 0) {
            let pos2 = srcLexPos + lexLen;
            let hasNlT = false;
            let pNlT = head.pos;
            while (pNlT < pos2 && pNlT < inputLength) {
              let ch = peekChar(pNlT);
              if (ch == 10 || ch == 13) {
                hasNlT = true;
                break;
              }
              pNlT += peekCharLen(pNlT);
            }
            if (!hasNlT && pos2 < inputLength) {
              let tok2 = invokeLexer(pos2);
              if (srcLexPos > pos2) {
                let pNlT2 = pos2;
                while (pNlT2 < srcLexPos && pNlT2 < inputLength) {
                  let ch = peekChar(pNlT2);
                  if (ch == 10 || ch == 13) {
                    hasNlT = true;
                    break;
                  }
                  pNlT2 += peekCharLen(pNlT2);
                }
              }
              if (!hasNlT && tok2 != token) {
                let tok2Len = lexLen;
                let pos3 = srcLexPos + lexLen;
                let tok3 = invokeLexer(pos3);
              
              if (tok2 != -1 && tok2 != TOKEN_EOF) {

                let canShift2 = stateCanAccept(unwindCurr, recState, tok2, 0);
                if (canShift2 > 0) {
                  let simT = simulateLookahead(unwindCurr, null, 0, tok2, token, tok3, 999999, 2, pos2 + tok2Len, 0);
                  if (simT > 0) {
                    let bestHead = changetype<ParseHead>(getBestAcceptingHead());
                    if (bestHead != null) {
                      let transCost = head.errorCost + COST_SHIFT_TRANSITION;
                      if (bestAcceptedCost >= THRESHOLD_PANIC_MODE_CUTOFF || transCost < bestAcceptedCost) {
                        let padT: u32 = head.pendingPadding;
                        let errNodeT = allocNode(NODE_TYPE_ERROR, padT, (pos3 > head.pos ? pos3 - head.pos : 0) as u32, head.balanceHash & 0xff, false);
                        let tNode1 = allocNode(((tok2 == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok2) | 0x8000) as u16, 0, tok2Len, 0, false);
                        let tNode2 = allocNode(((token == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : token) | 0x8000) as u16, 0, lexLen, 0, false);
                        setFirstChild(errNodeT, tNode1);
                        setNextSibling(tNode1, tNode2);
                        setNodeFlags(errNodeT, getNodeFlags(errNodeT) | FLAG_HAS_ERROR);

                        let newTailT = pushDiagnostic(head.errorTail, head.pos - padT, pos3);

                        let mergedNodeT = unwindCurr.astNode != 0 ? concatLists(unwindCurr.astNode, errNodeT, getNodeType(unwindCurr.astNode), 0) : errNodeT;

                        let transHead = allocParseHead(
                          bestHead.state,
                          mergedNodeT,
                          unwindCurr.prev,
                          bestHead.pos,
                          initialScannerState,
                          transCost,
                          0,
                          head.balanceHash,
                          0,
                          recPrec,
                          0,
                          newTailT
                        );
                        pushCandidateHead(changetype<u32>(transHead));
                      }
                    }
                  }
                }
                }
              }
            }
            setSrcLexPos(initialSrcLexPos);
            setLexLen(initialLexLen);
            setCurrentScannerState(initialScannerState);
          }

          // ------------------------------------------------------------
          // Branch S (Substitution): Replace unexpected token with expected terminal
          // ------------------------------------------------------------
          if (token != TOKEN_EOF && unwindDepth == 0 && head.consecutiveInsertions == 0 && stateCanAccept(unwindCurr, recState, token, 0) == 0) {
            let savedSrcLexPosS = srcLexPos;
            let savedLexLenS = lexLen;
            let posAfterTokenS = srcLexPos + lexLen;
            let nextTokAfterS = (posAfterTokenS < inputLength) ? invokeLexer(posAfterTokenS) : TOKEN_EOF;
            while (nextTokAfterS != TOKEN_EOF && nextTokAfterS != -1 && load<u8>(is_extra_token + nextTokAfterS) == 1) {
              if (lexLen == 0) break;
              posAfterTokenS += lexLen;
              nextTokAfterS = (posAfterTokenS < inputLength) ? invokeLexer(posAfterTokenS) : TOKEN_EOF;
            }
            srcLexPos = savedSrcLexPosS;
            setLexLen(savedLexLenS);



            let isSourceWordS = token <= MAX_TERMINAL_ID && token_is_word[token] == 1;

            // O(1) Precomputed 1-Token Repair Table Fast-Path (Phase 2)
            let p1 = unwindCurr.prev;
            let p2 = p1 != null ? p1.prev : null;
            if (p2 != null && token > 0 && token <= MAX_TERMINAL_ID) {
              let precomputedRepair = load<u16>(precomputed_repairs + (((recState * (MAX_TERMINAL_ID + 1) + token) as u32) << 1)) as i32;
              if (precomputedRepair > 0 && precomputedRepair <= MAX_TERMINAL_ID) {
                let isTargetWordP = precomputedRepair <= MAX_TERMINAL_ID && token_is_word[precomputedRepair] == 1;
                if (isSourceWordS == isTargetWordP) {
                  let shiftTargetP = findShiftTarget(recState, precomputedRepair as u16);
                  if (shiftTargetP != -1) {
                    let simP = simulateLookahead(unwindCurr, null, 0, precomputedRepair, -1, -1, 999999, 3, posAfterTokenS, 0);
                    if (simP > 0 && isTargetWordP) {
                      let savedScanPosP = srcLexPos;
                      let savedLexLenP = lexLen;
                      let savedStateP = currentScannerState;
                      memory.fill(changetype<usize>(expected_tokens), 1, 2048);
                      let lookPos = posAfterTokenS;
                      while (lookPos < inputLength && lookPos < (posAfterTokenS + 60)) {
                        let peekT = invokeLexer(lookPos);
                        if (peekT == -1 || peekT == TOKEN_EOF) break;
                        if (peekT == precomputedRepair) {
                          simP = 0;
                          break;
                        }
                        lookPos = srcLexPos + (lexLen > 0 ? lexLen : 1);
                      }
                      setSrcLexPos(savedScanPosP);
                      setLexLen(savedLexLenP);
                      setCurrentScannerState(savedStateP);
                    }
                    if (simP > 0) {
                      let subCostP = head.errorCost + (isTargetWordP ? COST_SUBSTITUTION_KEYWORD : COST_SUBSTITUTION_STANDARD);
                      let p_nlP = srcLexPos;
                      while (p_nlP < posAfterTokenS && p_nlP < inputLength) {
                        let ch = peekChar(p_nlP);
                        if (ch == 10 || ch == 13) {
                          subCostP += PENALTY_DELETE_NEWLINE_CROSS;
                          break;
                        }
                        p_nlP += peekCharLen(p_nlP);
                      }
                      if (bestAcceptedCost >= THRESHOLD_PANIC_MODE_CUTOFF || subCostP < bestAcceptedCost) {
                        let rawTokEndP = srcLexPos + lexLen;
                        let tokLenP: u32 = rawTokEndP > srcLexPos ? (rawTokEndP - srcLexPos) : 0;
                        let diagStartP = srcLexPos;
                        let newTailP = pushDiagnostic(head.errorTail, diagStartP, rawTokEndP);

                        let v0P = (precomputedRepair & 0xFFFF) | ((tokLenP as u32) << 16);
                        let prevHeadPosP: u32 = unwindCurr != null ? unwindCurr.pos : head.pos;
                        let padBeforeSubP: u32 = srcLexPos > prevHeadPosP ? (srcLexPos - prevHeadPosP) : 0;
                        let subHeadP = allocParseHead(
                          unwindCurr != null ? unwindCurr.state : recState,
                          unwindCurr != null ? unwindCurr.astNode : 0,
                          unwindCurr != null ? unwindCurr.prev : null,
                          posAfterTokenS,
                          initialScannerState,
                          subCostP,
                          1,
                          head.balanceHash,
                          0,
                          recPrec,
                          padBeforeSubP,
                          newTailP,
                          v0P,
                          0,
                          0,
                          0,
                          0,
                          1
                        );
                        pushCandidateHead(changetype<u32>(subHeadP));
                      }
                    }
                  }
                }
              }
            }

            if (bestAcceptedCost >= THRESHOLD_PANIC_MODE_CUTOFF || head.errorCost < bestAcceptedCost) {
              let actOffsetS = action_offsets[recState];
              if (actOffsetS >= 0 && actOffsetS < action_data.length) {
                let actCountS = action_data[actOffsetS];
                let actIdxS = actOffsetS + 1;
                for (let a = 0; a < actCountS; a++) {
                  let expSym = action_data[actIdxS++];
                  let aCountS = action_data[actIdxS++];
                  let aIdxS = actIdxS + 2;
                  actIdxS += 2 + actCountS * 2;
                  
                  let isTargetWordS = expSym <= MAX_TERMINAL_ID && token_is_word[expSym] == 1;
                  if (isSourceWordS == isTargetWordS && expSym != 0 && expSym <= MAX_TERMINAL_ID && expSym != token) {
                    let simS = simulateLookahead(unwindCurr, null, 0, expSym, -1, -1, 999999, 3, posAfterTokenS, 0);
                    if (simS > 0 && isTargetWordS) {
                      let savedScanPosS2 = srcLexPos;
                      let savedLexLenS2 = lexLen;
                      let savedStateS2 = currentScannerState;
                      memory.fill(changetype<usize>(expected_tokens), 1, 2048);
                      let lookPos = posAfterTokenS;
                      while (lookPos < inputLength && lookPos < (posAfterTokenS + 60)) {
                        let peekT = invokeLexer(lookPos);
                        if (peekT == -1 || peekT == TOKEN_EOF) break;
                        if (peekT == expSym) {
                          simS = 0;
                          break;
                        }
                        lookPos = srcLexPos + (lexLen > 0 ? lexLen : 1);
                      }
                      setSrcLexPos(savedScanPosS2);
                      setLexLen(savedLexLenS2);
                      setCurrentScannerState(savedStateS2);
                    }
                    if (simS > 0) {
                      let bDroppedS: u32 = head.pos > (unwindCurr != null ? unwindCurr.pos : 0) ? head.pos - (unwindCurr != null ? unwindCurr.pos : 0) : 0;
                      let retroCostS = (unwindDepth as i32) * configPenaltyUnwindNode + (bDroppedS as i32);
                      let subCost = head.errorCost + (isTargetWordS ? COST_SUBSTITUTION_KEYWORD : COST_SUBSTITUTION_STANDARD) + retroCostS;
                      let p_nlS = srcLexPos;
                      while (p_nlS < posAfterTokenS && p_nlS < inputLength) {
                        let ch = peekChar(p_nlS);
                        if (ch == 10 || ch == 13) {
                          subCost += PENALTY_SUBSTITUTION_CROSS_LINE;
                          break;
                        }
                        p_nlS += peekCharLen(p_nlS);
                      }
                      if (bestAcceptedCost >= THRESHOLD_PANIC_MODE_CUTOFF || subCost < bestAcceptedCost) {
                        let rawTokEndS = srcLexPos + lexLen;
                        let tokLenS: u32 = rawTokEndS > srcLexPos ? (rawTokEndS - srcLexPos) : 0;
                        let diagStart = srcLexPos;
                        let newTailS = pushDiagnostic(head.errorTail, diagStart, rawTokEndS);

                        let v0 = (expSym & 0xFFFF) | ((tokLenS as u32) << 16);
                        let prevHeadPos: u32 = unwindCurr != null ? unwindCurr.pos : head.pos;
                        let padBeforeSub: u32 = srcLexPos > prevHeadPos ? (srcLexPos - prevHeadPos) : 0;
                        let subHead = allocParseHead(
                          unwindCurr != null ? unwindCurr.state : recState,
                          unwindCurr != null ? unwindCurr.astNode : 0,
                          unwindCurr != null ? unwindCurr.prev : null,
                          posAfterTokenS,
                          initialScannerState,
                          subCost,
                          1,
                          head.balanceHash,
                          0,
                          recPrec,
                          padBeforeSub,
                          newTailS,
                          v0,
                          0,
                          0,
                          0,
                          0,
                          1
                        );
                        pushCandidateHead(changetype<u32>(subHead));
                      }
                    }
                  }
                }
              }
            }
          }

          // ------------------------------------------------------------
          // Branch A (Deletion): Skip Token
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
              (unwindDepth == 0 ? getDeleteCost(token == TOKEN_EOF ? 0 : token) : 0) +
              unwindDepth * configPenaltyUnwindNode +
              droppedBytes;
            let hasNewline = false;
            let p_nl = uPos;
            while (p_nl < srcLexPos) {
              let ch = peekChar(p_nl);
              if (ch == 10 || ch == 13) {
                hasNewline = true;
                break;
              }
              p_nl += peekCharLen(p_nl);
            }
             if (hasNewline) {
               if (unwindDepth <= 1) {
                 baseDelCost += PENALTY_DELETE_LINE_END_DANGLING; // Low penalty for discarding dangling token at line end
               } else {
                 baseDelCost += PENALTY_DELETE_DEEP_UNWIND_LINE_MERGE; // Heavily penalize merging lines via deletion across deeper unwinds
               }
             }


            if (lexLen == 1 && lexPos < inputLength) {
              let c = changetype<UnmanagedUint8Array>(getInputBuffer())[lexPos];
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = getDeleteCost(token) + (unwindDepth as i32) + (hasNewline ? PENALTY_DELETE_NEWLINE_CROSS : 0);
              }
            }

            // A1. Standard Deletion: Discard current token(s) and advance scanner
            // We scan forward up to 5 tokens to see if deleting them allows the state to recover.
            // If unwindDepth > 0, we also try skipCount=0 (just unwinding without dropping the current token).
            let maxSkips: u32 = 3;
            let startSkip: u32 = unwindDepth == 0 ? 1 : 0;
            let a1NextScanPos = startSkip == 1 ? (srcLexPos + lexLen) : srcLexPos;
            let dupCount = 0;
            if (startSkip == 1 && token != TOKEN_EOF) {
              let pScan = srcLexPos + lexLen;
              while (pScan < inputLength) {
                let peekT = invokeLexer(pScan);
                while (peekT != -1 && load<u8>(is_extra_token + peekT) == 1) {
                  if (lexLen == 0) break;
                  pScan = srcLexPos + lexLen;
                  peekT = invokeLexer(pScan);
                }
                if ((peekT == token || (token == TOKEN_UNKNOWN && peekT == TOKEN_UNKNOWN)) && lexLen > 0) {
                  pScan = srcLexPos + lexLen;
                  dupCount++;
                } else {
                  break;
                }
              }
              a1NextScanPos = pScan;
              setSrcLexPos(initialSrcLexPos);
              setLexLen(initialLexLen);
              setCurrentScannerState(initialScannerState);
            }
            
            if (configEnableBranchA1) {

            for (let skipCount: u32 = startSkip; skipCount <= maxSkips; skipCount++) {
              let a1DelCost = dupCount * COST_DELETE_DUPLICATE_TOKEN;


              let savedLexPos = lexPos;
              let savedLexLen = lexLen;
              let savedSrcLexPos = srcLexPos;
              let savedScannerState = currentScannerState;

              let nextToken = invokeLexer(a1NextScanPos);
              let searchPos = srcLexPos;
              let stateBeforeLex = currentScannerState;
              
              let nextTokenLen = lexLen;

              let tok2Pos = searchPos + nextTokenLen;
              let tok2 = invokeLexer(tok2Pos);
              let tok2Len = lexLen;

              let pos3 = tok2Pos + tok2Len;
              let state3 = currentScannerState;
              let tok3 = invokeLexer(pos3);
            
              setSrcLexPos(searchPos);
              setCurrentScannerState(stateBeforeLex);

              let tokenEndPos = searchPos + nextTokenLen;

              setLexPos(savedLexPos);
              setLexLen(savedLexLen);
              setSrcLexPos(savedSrcLexPos);
              setCurrentScannerState(savedScannerState);

              let tokCost = getDeleteCost(nextToken == TOKEN_EOF ? 0 : nextToken);
              let startP = head.pos < searchPos ? head.pos : srcLexPos;
              if (searchPos > startP) {
                let p_fwd = startP;
                while (p_fwd < searchPos && p_fwd < inputLength) {
                  let ch = peekChar(p_fwd);
                  if (ch == 10 || ch == 13) {
                    tokCost += PENALTY_DELETE_NEWLINE_CROSS;
                    break;
                  }
                  p_fwd += peekCharLen(p_fwd);
                }
              }

              
              t_branchA1_outStates[0] = recState;
              let canAccept = 0;
              if (stateCanAccept(unwindCurr, recState, nextToken, 0) > 0) {
                canAccept = 1;
              }

              let currentScanCost = a1DelCost + (skipCount > 0 ? tokCost : 0);
              if (canAccept && currentScanCost < THRESHOLD_DELETE_SCAN_LIMIT) {
                // ── 2-token lookahead validation ──
                // After finding that nextToken can be accepted from recState,
                // check whether the SECOND token ahead can also be processed
                // from the state we'd reach AFTER shifting nextToken.
                // This prevents shallow recoveries that match one token but
                // immediately fail (e.g., "let <skip print> velocity ;" where
                // velocity matches Identifier but ';' doesn't match '=').
                let weakRecovery: bool = false;
                if (tokenEndPos < inputLength) {
                  let simA1 = simulateLookahead(unwindCurr, null, 0, nextToken, tok2, -1, 999999, 2, a1NextScanPos, nextTokenLen);
                  if (simA1 == 0) {
                    weakRecovery = true;
                  }
                           let currChild: ParseHead | null = head;
                let childCount = 0;
                while (currChild != null && currChild != unwindCurr) {
                  if (childCount < MAX_CHILD_NODES) t_globalChildNodes[childCount] = currChild.astNode;
                  childCount++;
                  currChild = currChild.prev;
                }
                let parentHead: ParseHead | null = unwindCurr;

                let errFirstChild: u32 = 0;
                let errLastChild: u32 = 0;

                for (let k = childCount - 1; k >= 0; k--) {
                  let child = t_globalChildNodes[k];
                  if (child == 0) continue;
                  let clonedChild = cloneNodeShallow(child);
                  if (errFirstChild == 0) {
                    errFirstChild = clonedChild;
                  } else {
                    setNextSibling(errLastChild, clonedChild);
                  }
                  errLastChild = clonedChild;
                }

                let gapStart: u32 = unwindCurr.pos;
                let newTail = head.errorTail;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = t_globalChildNodes[k];
                  if (child != 0) {
                    let childPad = getNodePadding(child);
                    let childLen = getNodeByteLength(child);
                    let cStart = gapStart + childPad;
                    let cEnd = cStart + childLen;
                    if (cEnd > cStart) {
                      newTail = pushDiagnostic(newTail, cStart, cEnd);
                    }
                    gapStart += childPad + childLen;
                  }
                }
                let lostPad: u32 = head.pos > gapStart ? head.pos - gapStart : 0;

                memory.fill(changetype<usize>(expected_tokens), 1, 2048);
                let p = head.pos;
                let lastChild = 0;
                let isFirstLoopToken = true;
                while (p < searchPos) {
                  let tok = invokeLexer(p);
                  let tempPad = isFirstLoopToken ? lostPad : 0;
                  isFirstLoopToken = false;
                  while (tok != -1 && load<u8>(is_extra_token + tok) == 1 && srcLexPos < searchPos) {
                    if (lexLen == 0) break;
                    tempPad += lexLen;
                    p += lexLen;
                    tok = invokeLexer(p);
                  }
                  if (srcLexPos >= searchPos) break;
                  let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
                  if (tLen == 0) tLen = 1;
                  let pad = tempPad + (srcLexPos > p ? srcLexPos - p : 0);
                  let tNode = allocNode(((tok == TOKEN_UNKNOWN || tok == -1 ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, pad as u32, tLen, 0, false);
                  setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
                  if (lastChild == 0) {
                    if (errFirstChild == 0) {
                      errFirstChild = tNode;
                    } else {
                      setNextSibling(errLastChild, tNode);
                    }
                  } else {
                    setNextSibling(lastChild, tNode);
                  }
                  lastChild = tNode;
                  errLastChild = tNode;
                  p = srcLexPos + tLen;
                }
                
                let errNode: u32 = 0;
                if (errFirstChild != 0) {
                  let firstPad = getNodeLeadingPad(errFirstChild);
                  setNodePadding(errFirstChild, 0);
                  errNode = allocNode(NODE_TYPE_ERROR, firstPad, 0, newBalance & 0xff, false);
                  setFirstChild(errNode, errFirstChild);
                  setNodeFlags(errNode, FLAG_HAS_ERROR);
                  fixNodeLength(errNode);
                }
                let weakPenalty: i32 = weakRecovery ? 50 : 0;
                let delHeadCost = head.errorCost + baseDelCost + a1DelCost + weakPenalty;

                if (bestAcceptedCost < THRESHOLD_PANIC_MODE_CUTOFF && delHeadCost >= bestAcceptedCost) break;
                
                let shouldPushDelHead = (skipCount > 0 || unwindDepth > 0);
                
                let mergedNode: u32 = errNode;
                let delState: i32 = recState;
                let delParent = parentHead;

                if (unwindDepth == 0 && head.astNode != 0 && isListNodeByPtr(head.astNode) && errNode != 0) {
                  let listSym = getNodeType(head.astNode);
                  let envHash = getNodeEnvHash(head.astNode);
                  let updatedList = appendToList(head.astNode, errNode, listSym, envHash);
                  mergedNode = updatedList;
                  if (head.prev != null) delParent = head.prev!;
                  delState = head.state;
                } else if (unwindCurr != null && errNode != 0) {
                  let gOffset = goto_offsets[recState];
                  if (gOffset >= 0 && gOffset < goto_data.length) {
                    let gCount = goto_data[gOffset];
                    let gIdx = gOffset + 1;
                    for (let g = 0; g < gCount; g++) {
                      let sym = goto_data[gIdx++];
                      let targetSt = goto_data[gIdx++];
                      if (sym > (MAX_TERMINAL_ID as i32) && sym < type_is_list.length) {
                        if (type_is_list[sym] == 1) {
                          if (stateCanAccept(unwindCurr, targetSt, nextToken, 0) > 0) {
                            let listPad = getNodeLeadingPad(errNode);
                            setNodePadding(errNode, 0);
                            let listNode = allocNode(sym as u16, listPad, getNodeByteLength(errNode), 0, false);
                            setFirstChild(listNode, errNode);
                            setNodeFlags(listNode, FLAG_IS_LIST | FLAG_INVISIBLE);
                            fixNodeLength(listNode);
                            mergedNode = listNode;
                            delState = targetSt;
                            break;
                          }
                        }
                      }
                    }
                  }
                }

                let delHead = allocParseHead(
                  delState,
                  mergedNode,
                  delParent,
                  p,
                  initialScannerState,
                  delHeadCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0,
                  newTail
                );

                
                if (shouldPushDelHead) {
                  pushCandidateHead(changetype<u32>(delHead));
                }
                if (!weakRecovery) break;
              }       }

              a1DelCost += tokCost;

              if (nextToken == TOKEN_EOF) break; // EOF

              a1NextScanPos = tokenEndPos;
            }

            // A3. Skip-to-EOF has been removed. Island Mode handles this fallback significantly better.

            // A2 has been removed to prevent AST corruption via concatLists on non-list nodes.
            } // end configEnableBranchA1
            setSrcLexPos(initialSrcLexPos);
            setLexLen(initialLexLen);
            setCurrentScannerState(initialScannerState);
          }

          // ------------------------------------------------------------
          // Branch B (Insertion): Virtual Shift

          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          //
          if (configEnableBranchB && head.consecutiveInsertions < 8) {
            let savedLexPosB = lexPos;
            let savedLexLenB = lexLen;
            let savedSrcLexPosB = srcLexPos;
            let savedScannerStateB = currentScannerState;



            memory.fill(changetype<usize>(expected_tokens), 1, 2048);

            let laScanPos = head.pos;
            let candidateViable = false;
            let seqLen = 0;
            let skipCost = 0;

            for (let skip = 0; skip <= 200; skip++) {
              if (laScanPos >= inputLength) {
                if (skip == 0 && token == TOKEN_EOF) {
                  seqLen = searchBudgetedInsertions(unwindCurr, recState, TOKEN_EOF, 5000, 0, 7, t_branchB_outTokens, t_branchB_outStates, 0, inputLength);

                  if (seqLen > 0 && seqLen <= 7) candidateViable = true;
                }
                break;
              }

              setLexPos(laScanPos);
              let laTok = invokeLexer(laScanPos);
              let laEnd = srcLexPos + lexLen;

              seqLen = searchBudgetedInsertions(unwindCurr, recState, laTok, 5000, 0, 7, t_branchB_outTokens, t_branchB_outStates, lexLen, laScanPos);

              if (seqLen > 0 && seqLen <= 7) {
                candidateViable = true;
                break;
              }

              if (laTok == TOKEN_EOF) break;
              skipCost += getDeleteCost(laTok == TOKEN_EOF ? 0 : laTok);
              let startB = (skip == 0 && head.pos < laScanPos) ? head.pos : laScanPos;
              let p_nlB = startB;
              while (p_nlB < laEnd && p_nlB < inputLength) {
                let ch = peekChar(p_nlB);
                if (ch == 10 || ch == 13) {
                  skipCost += PENALTY_DELETE_NEWLINE_CROSS;
                  break;
                }
                p_nlB += peekCharLen(p_nlB);
              }
              laScanPos = laEnd;
            }

            setLexPos(savedLexPosB);
            setLexLen(savedLexLenB);
            setSrcLexPos(savedSrcLexPosB);
            setCurrentScannerState(savedScannerStateB);

            if (candidateViable && seqLen > 0) {
              let actualCost = skipCost;

              for (let k = 0; k < seqLen; k++) {
                let sym = t_branchB_outTokens[k];
                let baseCost = getInsertCost(sym == TOKEN_EOF ? 0 : sym);
                let confirmedShifts = (k < 8) ? t_branchB_confirmedShifts[k] : 0;
                let isKeyword = (sym <= MAX_TERMINAL_ID && token_is_word[sym] == 1 && load<u8>(is_extra_token + sym) == 0);
                if (isKeyword && baseCost >= 100 && confirmedShifts >= 3) {
                  let appearsDownstream = false;
                  let savedScanPosD = srcLexPos;
                  let savedLexLenD = lexLen;
                  let savedStateD = currentScannerState;
                  memory.fill(changetype<usize>(expected_tokens), 1, 2048);
                  let lookPos = laScanPos;
                  while (lookPos < inputLength && lookPos < (laScanPos + 60)) {
                    let peekT = invokeLexer(lookPos);
                    if (peekT == -1 || peekT == TOKEN_EOF) break;
                    if (peekT == sym) {
                      appearsDownstream = true;
                      break;
                    }
                    lookPos = srcLexPos + (lexLen > 0 ? lexLen : 1);
                  }
                  setSrcLexPos(savedScanPosD);
                  setLexLen(savedLexLenD);
                  setCurrentScannerState(savedStateD);

                  if (!appearsDownstream) {
                    // Lookahead confirmation reward: empirical verification unlocked 3+ valid downstream tokens
                    baseCost = 25;
                  } else {
                    candidateViable = false;
                    break;
                  }
                }
                if (token != TOKEN_EOF) {
                  let hasNewlineInGap = false;
                  let p_gap = unwindCurr.pos;
                  while (p_gap < srcLexPos && p_gap < inputLength) {
                    let ch = peekChar(p_gap);
                    if (ch == 10 || ch == 13) {
                      hasNewlineInGap = true;
                      break;
                    }
                    p_gap += peekCharLen(p_gap);
                  }
                  if (hasNewlineInGap) {
                    let isOp = (sym <= MAX_TERMINAL_ID && token_is_operator[sym] == 1);
                    let isNonTerm = (sym > MAX_TERMINAL_ID);
                    if (isOp || isNonTerm || seqLen > 1 || unwindDepth > 0) {
                      baseCost += PENALTY_INSERT_MULTI_TOKEN_CROSS_LINE;
                    }
                  }
                }

                actualCost += baseCost;
              }

              let uPos = unwindCurr.pos;
              let bDropped: u32 = head.pos > uPos ? head.pos - uPos : 0;
              let retroCost = (unwindDepth as i32) * configPenaltyUnwindNode + (bDropped as i32);
              
              actualCost += retroCost;

              if (candidateViable && actualCost < THRESHOLD_INSERT_MAX_COST) {
                let pCount = unwindDepth;
                let uCurr: ParseHead | null = head;
                let newBalance = head.balanceHash;
                for (let u = 0; u < pCount; u++) {
                  if (uCurr != null) {
                    newBalance = uCurr.balanceHash;
                    uCurr = uCurr.prev;
                  }
                }
                let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;

                // Phase 3: Expand minimal yield terminals for non-terminals
                let expandedLen = 0;
                for (let i = 0; i < seqLen; i++) {
                  let tok = t_branchB_outTokens[i];
                  if (tok > MAX_TERMINAL_ID) {
                    let yieldOffset = load<u32>(min_yield_offsets + (tok << 2));
                    let yieldLen = load<u32>(min_yield_data + (yieldOffset << 2));
                    for (let j: u32 = 0; j < yieldLen; j++) {
                      if (expandedLen < 16) {
                        t_expanded_tokens[expandedLen++] = load<u32>(min_yield_data + ((yieldOffset + 1 + j) << 2));
                      }
                    }
                  } else {
                    if (expandedLen < 16) {
                      t_expanded_tokens[expandedLen++] = tok;
                    }
                  }
                }

                let v0 = expandedLen > 0 ? t_expanded_tokens[0] : 0;
                let v1 = expandedLen > 1 ? t_expanded_tokens[1] : 0;
                let v2 = expandedLen > 2 ? t_expanded_tokens[2] : 0;
                let v3 = expandedLen > 3 ? t_expanded_tokens[3] : 0;
                let v4 = expandedLen > 4 ? t_expanded_tokens[4] : 0;
                let finalLen = expandedLen > 5 ? 5 : expandedLen;
                
                let currentHead = allocParseHead(
                  unwindCurr.state,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  unwindCurr.pos,
                  initialScannerState,
                  head.errorCost + actualCost,
                  0,
                  unwindCurr.balanceHash,
                  head.consecutiveInsertions + finalLen,
                  unwindCurr.dynamicPrec,
                  unwindCurr.pendingPadding,
                  head.errorTail,
                  v0, v1, v2, v3, v4, finalLen
                );
                pushCandidateHead(changetype<u32>(currentHead));
              }
            }
          } // end configEnableBranchB
          unwindCurr = unwindCurr.prev;
          unwindDepth++;
        }


        // Branch Summary (Active Stack Summary Recovery - Inspired by Tree-sitter fallback):
        if (configEnableIslandMode == 0 && candidateHeadsCount == 0 && token != TOKEN_EOF) {
          let ancCurr: ParseHead | null = head;
          let ancDepth = 0;
          while (ancCurr != null && ancDepth <= 8) {
            let ancState = ancCurr.state;
            let scanTok = token;
            let scanPos = srcLexPos;
            let scanTokLen = lexLen;

            // Test 1: Can ancState accept current token directly?
            let canAcceptDirect = stateCanAccept(ancCurr, ancState, scanTok, 0);

            // Test 2: If not, can ancState accept nextToken after skipping 1 token?
            let canAcceptAfterSkip = false;
            let nextScanPos = srcLexPos + lexLen;
            let nextTok = TOKEN_EOF;
            let nextTokLen = 0;
            if (canAcceptDirect == 0 && nextScanPos < inputLength) {
              let savedLP = lexPos;
              let savedLL = lexLen;
              let savedSLP = srcLexPos;
              let savedSS = currentScannerState;

              nextTok = invokeLexer(nextScanPos);
              nextTokLen = lexLen;

              setLexPos(savedLP);
              setLexLen(savedLL);
              setSrcLexPos(savedSLP);
              setCurrentScannerState(savedSS);

              if (nextTok != TOKEN_EOF && nextTok != -1) {
                if (stateCanAccept(ancCurr, ancState, nextTok, 0) > 0) {
                  canAcceptAfterSkip = true;
                  scanTok = nextTok;
                  scanPos = nextScanPos;
                  scanTokLen = nextTokLen;
                }
              }
            }

            if (canAcceptDirect > 0 || canAcceptAfterSkip) {
              let simRes = simulateLookahead(ancCurr, null, 0, scanTok, -1, -1, 999999, 2, scanPos + scanTokLen, 0);
              if (simRes > 0) {
                let summaryCost = head.errorCost + 500 + ((ancDepth as i32) * configPenaltyUnwindNode) + (canAcceptAfterSkip ? PENALTY_DELETE_LINE_END_DANGLING : 0);
                if (bestAcceptedCost >= THRESHOLD_PANIC_MODE_CUTOFF || summaryCost < bestAcceptedCost) {
                  // Collect intermediate nodes between head and ancCurr
                  let currNodePtr: ParseHead | null = head;
                  let intermediateCount = 0;
                  while (currNodePtr != null && currNodePtr != ancCurr) {
                    if (intermediateCount < MAX_CHILD_NODES) {
                      t_globalChildNodes[intermediateCount] = currNodePtr.astNode;
                    }
                    intermediateCount++;
                    currNodePtr = currNodePtr.prev;
                  }
                  if (intermediateCount > MAX_CHILD_NODES) intermediateCount = MAX_CHILD_NODES;

                  let pSum = head.pos;
                  let lastTokenEndSum = head.pos;
                  let firstErrPadSum: u32 = 0;
                  let isFirstLoopToken = true;
                  while (pSum < (scanPos as u32)) {
                    let tok = invokeLexer(pSum);
                    let tempPad: u32 = 0;
                    while (tok != -1 && load<u8>(is_extra_token + tok) == 1) {
                      if (lexLen == 0) break;
                      tempPad += lexLen;
                      pSum += lexLen;
                      tok = invokeLexer(pSum);
                    }
                    if (tok == -1 || srcLexPos >= (scanPos as u32)) break;
                    let tLen = lexLen;
                    if (tLen == 0) break;
                    if (isFirstLoopToken) {
                      firstErrPadSum = tempPad + (srcLexPos > pSum ? srcLexPos - pSum : 0);
                      isFirstLoopToken = false;
                    }
                    pSum = srcLexPos + tLen;
                    lastTokenEndSum = pSum;
                  }

                  let totalErrLenSum: u32 = (scanPos as u32) > (head.pos as u32) ? (scanPos as u32) - (head.pos as u32) : 0;
                  let errByteLenSum: u32 = totalErrLenSum >= firstErrPadSum ? totalErrLenSum - firstErrPadSum : totalErrLenSum;
                  let errNodeSum = allocNode(NODE_TYPE_ERROR, firstErrPadSum, errByteLenSum, ancCurr.balanceHash & 0xff, false);
                  setNodeFlags(errNodeSum, FLAG_HAS_ERROR);

                  let diagStartSum = (head.pos as u32) + firstErrPadSum;
                  let diagEndSum = scanPos as u32;
                  if (diagEndSum <= diagStartSum) diagEndSum = diagStartSum + 1;
                  let newTailSum = pushDiagnostic(head.errorTail, diagStartSum, diagEndSum);

                  let sumPendingPadding: u32 = 0;
                  let summaryHead = allocParseHead(
                    ancState,
                    errNodeSum,
                    ancCurr,
                    scanPos,
                    initialScannerState,
                    summaryCost,
                    0,
                    ancCurr.balanceHash,
                    0,
                    ancCurr.dynamicPrec,
                    sumPendingPadding,
                    newTailSum
                  );
                  pushCandidateHead(changetype<u32>(summaryHead));
                }
              }
            }

            ancCurr = ancCurr.prev;
            ancDepth++;
          }
        }

        // Candidate Pool Flush: Sort, Deduplicate, and Beam Select Top K (K=4)
        if (candidateHeadsCount > 0) {
          // Zero-Alloc In-Place Insertion Sort by composite score (errorCost)
          for (let i: u32 = 1; i < candidateHeadsCount; i++) {
            let keyPtr = t_candidateHeadsBuffer[i];
            let keyCost = changetype<ParseHead>(keyPtr).errorCost;
            let j: i32 = (i as i32) - 1;
            while (j >= 0 && changetype<ParseHead>(t_candidateHeadsBuffer[j]).errorCost > keyCost) {
              t_candidateHeadsBuffer[j + 1] = t_candidateHeadsBuffer[j];
              j--;
            }
            t_candidateHeadsBuffer[j + 1] = keyPtr;
          }

          let pushedCount: u32 = 0;
          for (let i: u32 = 0; i < candidateHeadsCount && pushedCount < RECOVERY_BEAM_WIDTH; i++) {
            let hPtr = t_candidateHeadsBuffer[i];
            if (pushActiveHead(hPtr)) {
              pushedCount++;
            }
          }


          if (pushedCount > 0) {
            return true;
          }
        }
        return false;
}
@inline
export function recoverIslandMode(
  head: ParseHead,
  inputLength: u32,
  bestAcceptedCost: i32,
  initialHeadsCount: u32
): void {
        // ERROR RECOVERY: Island Parsing (Block-Level Panic Mode)
        // --------------------------------------------------------------------
        // If local insertions/deletions fail, we fallback to a coarse panic mode.
        // We advance the scanner forward until we hit a "sync token" (e.g. `}`, `;`, `end`).
        // Then we search the GSS stack backwards for a state that can consume that sync token.
        // Everything in between is wrapped in an ERROR node and discarded from the AST.
        if (configEnableIslandMode) {
          let hasCleanLocalHead = false;
          for (let hIdx: u32 = 0; hIdx < initialHeadsCount; hIdx++) {
            let hPtr = changetype<ParseHead>(t_activeHeads[hIdx]);
            if (hPtr != head && hPtr.errorCost <= head.errorCost + THRESHOLD_HEAD_PRUNING_DISTANCE) {
              hasCleanLocalHead = true;
              break;
            }
          }
          if (!hasCleanLocalHead && head.consecutiveInsertions <= 3) {
          let syncCost = COST_ISLAND_INITIAL_SYNC; // Balanced initial penalty for destroying a span of code
          let searchPos = head.pos;
          let foundTarget = -1;
          let foundBalance = head.balanceHash;
          let currPop: ParseHead | null = null;
          let resumePos = 0;
          let nextTokStart: u32 = 0;

           // Step 1: Scan forward for a synchronization point (capped to prevent O(N²))
          // Enable all tokens so the lexer can match any keyword/symbol during scanning.
          // Without this, keywords may be mis-lexed as identifiers when the current head's
          // expected_tokens bitmap has been cleared, preventing stateCanAccept from finding
          // a valid recovery anchor.
          memory.fill(changetype<usize>(expected_tokens), 1, 2048);
          let panicScanCount: u32 = 0;
          let targetScannerState = currentScannerState;
          while (searchPos <= inputLength && panicScanCount < MAX_PANIC_SCAN_TOKENS) {
            panicScanCount++;
            let tok = TOKEN_EOF;
            let tokenLen = 0;

            let stateBeforeLex = currentScannerState;

            if (searchPos < inputLength) {
              tok = invokeLexer(searchPos);
              if (tok <= 0 || (tok != TOKEN_EOF && load<u8>(is_extra_token + tok) == 1)) {
                let step = lexLen > 0 ? lexLen : peekCharLen(searchPos);
                searchPos += (step > 0 ? step : 1);
                continue;
              }
              tokenLen = lexLen;
              if (tokenLen == 0) {
                let step = peekCharLen(searchPos);
                searchPos += (step > 0 ? step : 1);
                continue;
              }
            }

            

            // We treat EVERY token as a potential synchronization point (like Tree-sitter's ERROR pseudo-node).
            // We rely on `stateCanAccept` to contextually determine if the popped state can resume here.
            let nextPos = searchPos < inputLength ? srcLexPos + tokenLen : searchPos;
            // Save lexer state before lookahead to prevent clobbering tok's lexLen
            let savedPanicLexLen = lexLen;
            let savedPanicLexPos = lexPos;
            let savedPanicSrcLexPos = srcLexPos;
            let savedPanicScannerState = currentScannerState;
            let nextTok = invokeLexer(nextPos); // lookahead token after the sync token
            nextTokStart = srcLexPos;
            let nextTokLen = lexLen;

            let nextNextPos = nextPos < inputLength ? srcLexPos + nextTokLen : nextPos;
            let nextNextTok = invokeLexer(nextNextPos);
            
            let nextStateBeforeLex = currentScannerState;
            // Restore lexer state so tokenLen stays valid for subsequent iterations
            setLexLen(savedPanicLexLen);
            setLexPos(savedPanicLexPos);
            setSrcLexPos(savedPanicSrcLexPos);
            setCurrentScannerState(savedPanicScannerState);

            currPop = head;
            let gssDepth: i32 = 0;
            while (currPop != null && gssDepth < 3) {
              // Check if this popped state can eventually consume the sync token
              // stateCanAccept is reduction-aware!
              
            let canAcceptTok = stateCanAccept(currPop, currPop.state, tok, 0) ? 1 : 0;
            let canAcceptNext = stateCanAccept(currPop, currPop.state, nextTok, 0) ? 1 : 0;



            if (canAcceptTok > 0) {
              foundTarget = currPop.state;
              resumePos = srcLexPos;
              targetScannerState = stateBeforeLex;
              break;
            } else if (canAcceptNext > 0) {
              foundTarget = currPop.state;
              resumePos = nextTokStart;
              targetScannerState = nextStateBeforeLex;
              break;
            }
              currPop = currPop.prev; // Pop stack
              gssDepth++;
            }
            

            // (Brute-force fallback removed: it was too aggressive and matched invalid states for Identifier, causing infinite recovery loops. The GSS walk is sufficient now that stateCanAccept cache is fixed.)

            if (foundTarget != -1) break; // We found a recovery anchor!
            // If the sync token wasn't useful, consume it and keep scanning forward
            if (searchPos >= inputLength) break; // Cannot scan past EOF
            searchPos = nextPos;
            syncCost += 1; // +1 penalty for every token skipped during panic mode
          }
          

          // Step 3: Apply the Panic Mode Recovery
          if (foundTarget != -1 && currPop != null && (resumePos as u32) <= inputLength) {
            // Calculate the true penalty for Panic Mode
            let poppedDepth = 0;
            let tempPop: ParseHead | null = head;
            let poppedValidBytes: u32 = 0;
            while (tempPop != null && tempPop != currPop) {
              poppedDepth++;
              if (tempPop.astNode != 0 && !isPureErrorNode(tempPop.astNode)) {
                poppedValidBytes += getNodeByteLength(tempPop.astNode);
              }
              tempPop = tempPop.prev;
            }
            let islandCost =
              poppedDepth * configIslandPoppedMultiplier +
              syncCost * configIslandSyncMultiplier +
              configIslandBasePenalty;
            


            
            let uTemp: ParseHead | null = head;
            for (let u = 0; u < poppedDepth; u++) {
              if (uTemp != null && uTemp.astNode != 0) {
                 let tLen = getNodeByteLength(uTemp.astNode);
                 if (tLen <= 4 && tLen > 0) {
                   let tStart = uTemp.pos - tLen;
                   let c = peekChar(tStart);
                   if (c == 125 || c == 93 || c == 41) { // }, ], )
                     islandCost += 20000; // CRITICAL: NEVER UNWIND A SCOPE CLOSER!
                   }
                 }
              }
              if (uTemp != null) uTemp = uTemp.prev;
            }
            
            // Allow panic mode recovery to branch from the recovery anchor
            // Collect all the AST nodes that were parsed between the anchor state and the failure point
            let currChild: ParseHead | null = head;
            let childCount = 0;
            while (currChild != null && currChild != currPop) {
              if (childCount < MAX_CHILD_NODES) {
                t_globalChildNodes[childCount] = currChild.astNode;
              }
              childCount++;
              currChild = currChild.prev;
            }
            if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

            let islandPad: u32 = 0;
            let islandScannerState = targetScannerState;
            
            // Allocate a monolithic ERROR node container
            let islandLeaf = allocNode(NODE_TYPE_ERROR, 0, 0, head.balanceHash & 0xff, false);
            // We no longer mount discarded valid AST nodes inside the ERROR node.
            // They are preserved as valid siblings in the AST.
            // We will concatenate them directly to the `mergedNode` below.

            // Lex any remaining raw garbage between the last parsed node and the resume position
            // This ensures discarded spaces aren't squiggled and the LSP doesn't merge everything
            memory.fill(changetype<usize>(expected_tokens), 1, 2048);
            let p = head.pos;
            let newTail = currPop != null ? currPop.errorTail : 0;
            
            // Determine the actual start of the first garbage token by peeking
            // forward from head.pos. head.pos sits right after the last consumed
            // token (e.g., after `;` on line 3), so it includes the newline and
            // indentation whitespace leading to the error tokens on the next line.
            // Using head.pos directly would create a ghost squiggle on the
            // previous line. Instead, lex once to get srcLexPos which is the
            // byte offset of the first real token after whitespace.
            let diagStart: u32 = head.pos;
            let lastChild = 0;
            if (childCount > 0) {
              let firstPoppedChild = t_globalChildNodes[childCount - 1];
              if (firstPoppedChild != 0) {
                let childPad = getNodePadding(firstPoppedChild);
                let childPos = (currPop != null ? currPop.pos : head.pos) + childPad;
                diagStart = childPos;
              }
            } else if ((resumePos as u32) > head.pos) {
              let savedLP = lexPos;
              let savedSLP = srcLexPos;
              let savedLL = lexLen;
              let savedSS = currentScannerState;
              let peekTok = invokeLexer(head.pos);
              if (peekTok != -1 && srcLexPos > head.pos) {
                diagStart = srcLexPos;  // skip whitespace
              }
              setLexLen(savedLL);
              setLexPos(savedLP);
              setSrcLexPos(savedSLP);
              setCurrentScannerState(savedSS);
            }

            let gapStart: u32 = currPop != null ? currPop.pos : head.pos;
            for (let k = childCount - 1; k >= 0; k--) {
              let child = t_globalChildNodes[k];
              if (child != 0) {
                gapStart += getNodePadding(child) + getNodeByteLength(child);
              }
            }
            let lostPad: u32 = head.pos > gapStart ? head.pos - gapStart : 0;

            let isFirstLoopToken = true;
            while (p < (resumePos as u32)) {
              let tok = invokeLexer(p);
              let tempPad = isFirstLoopToken ? lostPad : 0;
              isFirstLoopToken = false;
              while (tok != -1 && load<u8>(is_extra_token + tok) == 1) {
                if (lexLen == 0) break;
                tempPad += lexLen;
                p += lexLen;
                tok = invokeLexer(p);
              }
              if (srcLexPos >= (resumePos as u32)) break;

              // All tokens between the last valid parsed node and the recovery anchor
              // are definitively garbage (skipped by panic mode). We must consume them
              // and emit them as ERROR leaves so they get accurately squiggled,
              // regardless of whether they cross a line boundary.

              let tLen = lexLen > 0 ? lexLen : peekCharLen(srcLexPos);
              if (tLen == 0) tLen = 1;
              
              let insCost = (tok == TOKEN_UNKNOWN || tok == -1) ? 2 : token_insert_costs[tok];
              islandCost += (insCost > 0 ? insCost : 3);

              let pad = tempPad + (srcLexPos > p ? srcLexPos - p : 0);

              let tNode = allocNode(((tok == TOKEN_UNKNOWN || tok == -1 ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, pad, tLen, 0, false);
              setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
              // Do NOT set FLAG_IS_INSERTED here because this is shifting a real terminal, not inserting a missing one!
              if (lastChild == 0) {
                if (childCount > 0) {
                  islandPad += pad;
                } else {
                  islandPad = pad;
                }
                setNodePadding(islandLeaf, islandPad);
                setNodePadding(tNode, 0);
                setFirstChild(islandLeaf, tNode);
              } else setNextSibling(lastChild, tNode);
              lastChild = tNode;

              p = srcLexPos + tLen;
            }

            if ((resumePos as u32) > diagStart) {
              newTail = pushDiagnostic(newTail, diagStart, resumePos as u32);
            }

            let searchPos = resumePos;
            let islandByteLen = (searchPos as u32) > gapStart ? (searchPos as u32) - gapStart : 0;
            setNodeByteLength(islandLeaf, islandByteLen);
            if (getNodeFirstChild(islandLeaf) != 0) {
              fixNodeLength(islandLeaf);
            }

            if ((resumePos as u32) == head.pos && foundTarget == head.state) {
              // This makes zero progress (same position, same state).
              // Pushing it resets consecutiveInsertions and causes an infinite loop.
              // We just drop this branch.
            } else {
              // Branch the GSS from the recovery anchor, preserving currPop.astNode as a clean sibling.
              let nextConsecutive = ((resumePos as u32) == head.pos) ? head.consecutiveInsertions : 0;
              
              let errFirstChild: u32 = 0;
              let errLastChild: u32 = 0;

              for (let k = childCount - 1; k >= 0; k--) {
                let child = t_globalChildNodes[k];
                if (child == 0) continue;
                let clonedChild = cloneNodeShallow(child);
                if (errFirstChild == 0) {
                  errFirstChild = clonedChild;
                } else {
                  setNextSibling(errLastChild, clonedChild);
                }
                errLastChild = clonedChild;
              }

              let leafChild = getNodeFirstChild(islandLeaf);
              while (leafChild != 0) {
                let nextLeaf = getNodeNextSibling(leafChild);
                setNextSibling(leafChild, 0);
                if (errFirstChild == 0) {
                  errFirstChild = leafChild;
                } else {
                  setNextSibling(errLastChild, leafChild);
                }
                errLastChild = leafChild;
                leafChild = nextLeaf;
              }

              let errNode: u32 = 0;
              if (errFirstChild != 0) {
                let firstPad = islandPad > 0 ? islandPad : getNodeLeadingPad(errFirstChild);
                setNodePadding(errFirstChild, 0);
                errNode = allocNode(NODE_TYPE_ERROR, firstPad, 0, head.balanceHash & 0xff, false);
                setFirstChild(errNode, errFirstChild);
                setNodeFlags(errNode, FLAG_HAS_ERROR);
                fixNodeLength(errNode);
              } else if (islandByteLen > 0 || getNodeFirstChild(islandLeaf) != 0) {
                errNode = islandLeaf;
              }

              let finalAstNode: u32 = errNode;
              let finalPrev: ParseHead | null = currPop;
              let islandState: i32 = currPop != null ? currPop.state : 0;

              if (currPop != null && errNode != 0) {
                let gOffset = goto_offsets[currPop.state];
                if (gOffset >= 0 && gOffset < goto_data.length) {
                  let gCount = goto_data[gOffset];
                  let gIdx = gOffset + 1;
                  for (let g = 0; g < gCount; g++) {
                    let sym = goto_data[gIdx++];
                    let targetSt = goto_data[gIdx++];
                    if (sym > (MAX_TERMINAL_ID as i32) && sym < type_is_list.length) {
                      if (type_is_list[sym] == 1) {
                        let peekResumeTok = invokeLexer(resumePos);
                        if (stateCanAccept(currPop, targetSt, peekResumeTok, 0) > 0) {
                          let listPad = getNodeLeadingPad(errNode);
                          setNodePadding(errNode, 0);
                          let listNode = allocNode(sym as u16, listPad, getNodeByteLength(errNode), 0, false);
                          setFirstChild(listNode, errNode);
                          setNodeFlags(listNode, FLAG_IS_LIST | FLAG_INVISIBLE);
                          finalAstNode = listNode;
                          islandState = targetSt;
                          break;
                        }
                      }
                    }
                  }
                }
              }

              let islandPendingPadding: u32 = (resumePos as u32) > p ? (resumePos as u32) - p : 0;
              let islandHead = allocParseHead(
                islandState, 
                finalAstNode,
                finalPrev,
                resumePos as u32,
                islandScannerState,
                (currPop != null ? currPop.errorCost : 0) + islandCost,
                currPop != null ? currPop.successfulShifts : 0,
                foundBalance,
                nextConsecutive,
                head.dynamicPrec,
                islandPendingPadding, // pendingPadding
                newTail,
                0, 0, 0, 0, 0, 0 // No virtual tokens in Island Mode
              );
              pushActiveHead(changetype<u32>(islandHead));
            }
          }
        }
        } // end configEnableIslandMode
}
