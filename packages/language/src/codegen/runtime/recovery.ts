import { ParseHead, ErrorBranch, allocErrorBranch, pushActiveHead, allocParseHead, t_activeHeads, activeHeadsCount, setActiveHeadsCount } from "./gss";
import { debugLog, pushDiagnostic, MAX_ERRORS, MAX_CHILD_NODES, t_globalChildNodes, MAX_TERMINAL_ID,
  action_offsets, action_data, ACTION_SHIFT, MAX_PANIC_SCAN_TOKENS, token_insert_costs, token_delete_costs,
  NODE_TYPE_ERROR, goto_offsets, goto_data, configEnableBranchA1, configEnableBranchB, configEnableIslandMode, ACTION_REDUCE, configPenaltyUnwindNode, configPenaltySyncToken, configIslandBasePenalty, configIslandSyncMultiplier, configIslandPoppedMultiplier
} from "./engine";
import { advanceGLR, stateCanAccept, cloneNodeShallow, concatLists, appendToList, isPureErrorNode, g_stateCanAcceptMaxCost, isEpsilonReachable, resetSimulator, getBestAcceptingHead, saveSimulationState, restoreSimulationState } from "./parser-loop";
import { prod_lengths, prod_lhs, logInt } from "./parser";
import { 
  getNodePadding, 
  setNodePadding,
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
  getNodeFlags,
  setNodeFlags,
  S,
  resetGeneration,
  atomicChunkAlloc
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
  reachability_matrix
} from "./parser";

const t_branchB_outTokens = new Int32Array(8);
const t_branchB_outStates = new Int32Array(8);
const t_branchA1_outStates = new Int32Array(1);
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
    tempHead = allocParseHead(baseHead.state, baseHead.astNode, baseHead.prev, p, baseHead.scannerState, baseHead.errorCost, baseHead.successfulShifts, baseHead.balanceHash, baseHead.consecutiveInsertions, baseHead.dynamicPrec, baseHead.pendingPadding, baseHead.errorTail, 0, 0, 0, 0, 0, 0);
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
  
  advanceGLR();
  
  let result = getBestAcceptingHead() != 0 ? 1 : 0;
  
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
      outTokens[depth] = sym;
      outStates[depth] = shiftTarget;
      
      let simRes = simulateLookahead(unwindCurr, outStates, depth, laTok, -1, -1, unwindCurr.errorCost + 250, 3, laTokPos, laTokLen);

      if (simRes > 0) {
        return depth + 1;
      }
      
      let res = searchBudgetedInsertions(
        unwindCurr, shiftTarget, laTok,
        budget - numTerminals, depth + 1, maxDepth,
        outTokens, outStates,
        laTokLen, laTokPos
      );
      if (res > 0) return res;
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
        
        if (simulateLookahead(unwindCurr, outStates, depth, laTok, -1, -1, unwindCurr.errorCost + 250, 3, laTokPos, laTokLen) > 0) {
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


@inline
function getInsertCost(tok: i32): i32 {
  if (tok < 0 || tok >= token_insert_costs.length) return 25;
  return token_insert_costs[tok] * 25;
}

@inline
function getDeleteCost(tok: i32): i32 {
  if (tok < 0 || tok >= token_delete_costs.length) return 10;
  return token_delete_costs[tok];
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
        
        // If forced reduction didn't work, we iteratively pop (unwind) states from the GSS
        // up to a depth of 5. For each popped state, we attempt:
        // Branch A (Deletion): Deleting the current token (skip)
        // Branch B (Insertion): Inserting a missing token (virtual shift)
        let unwindCurr: ParseHead | null = head;
        let unwindDepth = 0;

        while (unwindCurr != null && unwindDepth < 3) {
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
              getDeleteCost(token == TOKEN_EOF ? 0 : token) + unwindDepth * configPenaltyUnwindNode + droppedBytes;
            let hasNewline = false;
            let p_nl = head.pos;
            while (p_nl < srcLexPos) {
              let ch = peekChar(p_nl);
              if (ch == 10 || ch == 13) {
                hasNewline = true;
                break;
              }
              p_nl += peekCharLen(p_nl);
            }
            if (hasNewline) baseDelCost += 4000; // Heavily penalize merging lines via deletion

            if (lexLen == 1 && lexPos < inputLength) {
              let c = changetype<UnmanagedUint8Array>(getInputBuffer())[lexPos];
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = getDeleteCost(token) + (unwindDepth as i32) + (hasNewline ? 1000 : 0);
              }
            }

            // A1. Standard Deletion: Discard current token(s) and advance scanner
            // We scan forward up to 5 tokens to see if deleting them allows the state to recover.
            // If unwindDepth > 0, we also try skipCount=0 (just unwinding without dropping the current token).
            let maxSkips: u32 = 3;
            let startSkip: u32 = unwindDepth == 0 ? 1 : 0;
            let a1NextScanPos = startSkip == 1 ? (srcLexPos + lexLen) : srcLexPos;
            
            // baseDelCost includes the cost of dropping 'token'. If we do startSkip=0,
            // we are NOT dropping 'token', so we refund its cost in a1DelCost.
            let a1DelCost = startSkip == 0 ? -(getDeleteCost(token == TOKEN_EOF ? 0 : token) + (hasNewline ? 1000 : 0)) : 0;

            if (configEnableBranchA1) {
            // Force lexer to recognize all tokens during recovery forward scan
            memory.fill(changetype<usize>(expected_tokens), 1, 2048);
            for (let skipCount: u32 = startSkip; skipCount <= maxSkips; skipCount++) {
              let savedLexPos = lexPos;
              let savedLexLen = lexLen;
              let savedSrcLexPos = srcLexPos;
              let savedScannerState = currentScannerState;

              let nextToken = invokeLexer(a1NextScanPos);
              let searchPos = srcLexPos;
              let stateBeforeLex = currentScannerState;
              
              let nextTokenLen = lexLen;

              let tok2Pos = srcLexPos + lexLen;
              let tok2 = invokeLexer(tok2Pos);

              let pos3 = srcLexPos + lexLen;
              let state3 = currentScannerState;
              let tok3 = invokeLexer(pos3);
            
              setSrcLexPos(searchPos);
              setCurrentScannerState(stateBeforeLex);

              let tokenEndPos = srcLexPos + lexLen;

              setLexPos(savedLexPos);
              setLexLen(savedLexLen);
              setSrcLexPos(savedSrcLexPos);
              setCurrentScannerState(savedScannerState);

              let tokCost = getDeleteCost(nextToken == TOKEN_EOF ? 0 : nextToken);
              
              t_branchA1_outStates[0] = recState;
              let canAccept = simulateLookahead(unwindCurr, null, 0, nextToken, tok2, tok3, 999999, 3, a1NextScanPos, nextTokenLen);

              
              if (canAccept && (a1DelCost + tokCost) < 4000) {
                // ── 2-token lookahead validation ──
                // After finding that nextToken can be accepted from recState,
                // check whether the SECOND token ahead can also be processed
                // from the state we'd reach AFTER shifting nextToken.
                // This prevents shallow recoveries that match one token but
                // immediately fail (e.g., "let <skip print> velocity ;" where
                // velocity matches Identifier but ';' doesn't match '=').
                let weakRecovery: bool = false;
                if (tokenEndPos < inputLength) {
                  // Disabled 2-token validation to test if it's the culprit
                }

                let currChild: ParseHead | null = head;
                let childCount = 0;
                while (currChild != null && currChild != unwindCurr) {
                  if (childCount < MAX_CHILD_NODES) t_globalChildNodes[childCount] = currChild.astNode;
                  childCount++;
                  currChild = currChild.prev;
                }
                if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

                let mergedNode = unwindCurr != null ? unwindCurr.astNode : 0;
                let parentType = mergedNode != 0 ? getNodeType(mergedNode) : 0;

                for (let k = childCount - 1; k >= 0; k--) {
                  let child = t_globalChildNodes[k];
                  if (child == 0) continue;
                  
                  let clone = cloneNodeShallow(child);
                  if (mergedNode != 0) {
                    mergedNode = concatLists(mergedNode, clone, parentType, 0);
                  } else {
                    mergedNode = clone;
                    parentType = getNodeType(clone);
                  }
                }

                let errNode = allocNode(NODE_TYPE_ERROR, 0, 0, newBalance & 0xff, false);
                let lastChild = 0;

                let gapStart: u32 = unwindCurr.pos;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = t_globalChildNodes[k];
                  if (child != 0) {
                    gapStart += getNodePadding(child) + getNodeByteLength(child);
                  }
                }
                let lostPad: u32 = head.pos > gapStart ? head.pos - gapStart : 0;

                memory.fill(changetype<usize>(expected_tokens), 1, 2048);
                let p = head.pos;
                let newTail = head.errorTail;
                let isFirstLoopToken = true;
                while (p < a1NextScanPos) {
                  let tok = invokeLexer(p);
                  let tempPad = isFirstLoopToken ? lostPad : 0;
                  isFirstLoopToken = false;
                  while (tok != -1 && load<u8>(is_extra_token + tok) == 1 && srcLexPos < a1NextScanPos) {
                    tempPad += lexLen;
                    p += lexLen;
                    tok = invokeLexer(p);
                  }
                  if (tok == -1 || srcLexPos >= a1NextScanPos) break;
                  let tLen = lexLen;
                  if (tLen == 0) break;
                  let pad = tempPad + (srcLexPos > p ? srcLexPos - p : 0);
                  if (lastChild == 0) {
                    setNodePadding(errNode, pad);
                    pad = 0;
                  }
                  newTail = pushDiagnostic(newTail, srcLexPos as u32, (srcLexPos + tLen) as u32);
                  let tNode = allocNode(((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, pad as u32, tLen, 0, false);
                  setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
                  if (lastChild == 0) setFirstChild(errNode, tNode);
                  else setNextSibling(lastChild, tNode);
                  lastChild = tNode;
                  p = srcLexPos + tLen;
                }
                
                let expectedStart = head.pos + getNodePadding(errNode);
                let errByteLen = p > expectedStart ? p - expectedStart : 0;
                setNodeByteLength(errNode, errByteLen);

                let weakPenalty: i32 = weakRecovery ? 50 : 0;
                let delHeadCost = head.errorCost + baseDelCost + a1DelCost + weakPenalty;
                if (bestAcceptedCost < 20000 && delHeadCost >= bestAcceptedCost) break;
                
                let shouldPushDelHead = (skipCount > 0 || unwindDepth > 0);
                
                if (lastChild != 0 || errByteLen > 0) {
                  if (mergedNode != 0) {
                      mergedNode = concatLists(mergedNode, errNode, parentType, 0);
                  } else {
                      mergedNode = errNode;
                  }
                }

                debugLog(111, unwindDepth, delHeadCost, canAccept ? 1 : 0);
                let delHead = allocParseHead(
                  recState,
                  mergedNode,
                  unwindCurr != null ? unwindCurr.prev : null,
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
                  pushActiveHead(changetype<u32>(delHead));
                }
                break;
              }

              a1DelCost += tokCost;

              if (nextToken == TOKEN_EOF) break; // EOF

              a1NextScanPos = tokenEndPos;
            }

            // A3. Skip-to-EOF has been removed. Island Mode handles this fallback significantly better.

            // A2 has been removed to prevent AST corruption via concatLists on non-list nodes.
            } // end configEnableBranchA1
          }

          // ------------------------------------------------------------
          // Branch B (Insertion): Virtual Shift
          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          //
          // Guard: At depth=0, skip insertions if the last significant character
          // before head.pos is a scope closer (}, ), ]). This means the parser
          // just completed a scope-closing reduction and any insertion here would
          // absorb inter-scope garbage into the preceding node's byte length.
          // Island mode will handle the garbage correctly instead.
          if (configEnableBranchB) {

          let skipBranchB = false;
          if (unwindDepth == 0 && head.pos > 0) {
            // Scan backwards past whitespace to find the last significant character
            let scanBack: u32 = head.pos;
            let step: u32 = inputEncoding == 0 ? 1 : (inputEncoding <= 2 ? 2 : 4);
            while (scanBack >= step) {
              scanBack -= step;
              let ch = peekChar(scanBack);
              if (ch != 32 && ch != 9 && ch != 10 && ch != 13) {  // not space/tab/LF/CR
                if (ch == 125 || ch == 41 || ch == 93) {  // } ) ]
                  skipBranchB = true;
                }
                
                break;
              }
            }
          }
          if (!skipBranchB && head.consecutiveInsertions < 8) {
            let savedLexPosB = lexPos;
            let savedLexLenB = lexLen;
            let savedSrcLexPosB = srcLexPos;
            let savedScannerStateB = currentScannerState;



            memory.fill(changetype<usize>(expected_tokens), 1, 2048);

            let laScanPos = head.pos;
            let candidateViable = false;
            let seqLen = 0;

            for (let skip = 0; skip <= 3; skip++) {
              if (laScanPos >= inputLength) {
                if (skip == 0 && token == TOKEN_EOF) {
                  seqLen = searchBudgetedInsertions(unwindCurr, recState, TOKEN_EOF, 5000, 0, 5, t_branchB_outTokens, t_branchB_outStates, 0, inputLength);

                  if (seqLen > 0 && seqLen <= 5) candidateViable = true;
                }
                break;
              }

              setLexPos(laScanPos);
              let laTok = invokeLexer(laScanPos);
              let laEnd = srcLexPos + lexLen;

              seqLen = searchBudgetedInsertions(unwindCurr, recState, laTok, 5000, 0, 5, t_branchB_outTokens, t_branchB_outStates, lexLen, laScanPos);


              if (seqLen > 0 && seqLen <= 5) {
                candidateViable = true;
                break;
              }

              if (laTok == TOKEN_EOF) break;
              laScanPos = laEnd;
            }

            setLexPos(savedLexPosB);
            setLexLen(savedLexLenB);
            setSrcLexPos(savedSrcLexPosB);
            setCurrentScannerState(savedScannerStateB);

            if (candidateViable && seqLen > 0) {
              let actualCost = 0;
              for (let k = 0; k < seqLen; k++) {
                let sym = t_branchB_outTokens[k];
                let baseCost = getInsertCost(sym == TOKEN_EOF ? 0 : sym);
                if (baseCost <= 0) baseCost = 10;
                actualCost += baseCost;
              }

              let uPos = unwindCurr.pos;
              let bDropped: u32 = head.pos > uPos ? head.pos - uPos : 0;
              let retroCost = (unwindDepth as i32) * configPenaltyUnwindNode + (bDropped as i32);
              actualCost += retroCost;

              if (bestAcceptedCost >= 20000 || (head.errorCost + actualCost) < bestAcceptedCost) {
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

                let v0 = seqLen > 0 ? t_branchB_outTokens[0] : 0;
                let v1 = seqLen > 1 ? t_branchB_outTokens[1] : 0;
                let v2 = seqLen > 2 ? t_branchB_outTokens[2] : 0;
                let v3 = seqLen > 3 ? t_branchB_outTokens[3] : 0;
                let v4 = seqLen > 4 ? t_branchB_outTokens[4] : 0;
                
                let currentHead = allocParseHead(
                  unwindCurr.state,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  unwindCurr.pos,
                  initialScannerState,
                  head.errorCost + actualCost,
                  0,
                  unwindCurr.balanceHash,
                  head.consecutiveInsertions + seqLen,
                  unwindCurr.dynamicPrec,
                  unwindCurr.pendingPadding,
                  head.errorTail,
                  v0, v1, v2, v3, v4, seqLen
                );
                pushActiveHead(changetype<u32>(currentHead));
                return true;
              }
            }
          }
          } // end configEnableBranchB

          unwindCurr = unwindCurr.prev;
          unwindDepth++;
        }
        return false;
}
@inline
export function recoverIslandMode(
  head: ParseHead,
  inputLength: u32,
  bestAcceptedCost: i32,
  activeHeadsCount: u32
): void {
        // ERROR RECOVERY: Island Parsing (Block-Level Panic Mode)
        // --------------------------------------------------------------------
        // If local insertions/deletions fail, we fallback to a coarse panic mode.
        // We advance the scanner forward until we hit a "sync token" (e.g. `}`, `;`, `end`).
        // Then we search the GSS stack backwards for a state that can consume that sync token.
        // Everything in between is wrapped in an ERROR node and discarded from the AST.
        if (configEnableIslandMode) {
        if (head.consecutiveInsertions == 0) {
          let syncCost = 5; // Balanced initial penalty for destroying a span of code
          let searchPos = head.pos;
          let foundTarget = -1;
          let foundBalance = head.balanceHash;
          let currPop: ParseHead | null = null;
          let resumePos = 0;

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
              if (tok == -1) break;
              tokenLen = lexLen;
              if (tokenLen == 0) break;
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
            // Remove artificial constraint: allow popping as deep as needed (cost will penalize).
            while (currPop != null && gssDepth < 20) {
              // Check if this popped state can eventually consume the sync token
              // stateCanAccept is reduction-aware!
              
            let canAcceptTok = stateCanAccept(currPop, currPop.state, tok, 0) ? 1 : 0;
            let canAcceptNext = stateCanAccept(currPop, currPop.state, nextTok, 0) ? 1 : 0;

            if (canAcceptTok > 0) {
              foundTarget = currPop.state;
              resumePos = searchPos;
              targetScannerState = stateBeforeLex;
              break;
            } else if (canAcceptNext > 0) {
              foundTarget = currPop.state;
              resumePos = nextPos;
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
            
            if (bestAcceptedCost < 20000 && islandCost >= bestAcceptedCost) return;
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
            if ((resumePos as u32) > head.pos) {
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
                tempPad += lexLen;
                p += lexLen;
                tok = invokeLexer(p);
              }
              if (tok == -1) break;
              if (srcLexPos >= (resumePos as u32)) break;

              // All tokens between the last valid parsed node and the recovery anchor
              // are definitively garbage (skipped by panic mode). We must consume them
              // and emit them as ERROR leaves so they get accurately squiggled,
              // regardless of whether they cross a line boundary.

              let tLen = lexLen;
              if (tLen == 0) break; // prevent infinite loop
              
              let insCost = tok == TOKEN_UNKNOWN ? 2 : token_insert_costs[tok];
              islandCost += (insCost > 0 ? insCost : 3);

              let pad = tempPad + (srcLexPos > p ? srcLexPos - p : 0);

              let tNode = allocNode(((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, pad, tLen, 0, false);
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

              // Emit a diagnostic specifically for this garbage token
              newTail = pushDiagnostic(newTail, srcLexPos, srcLexPos + tLen);

              p = srcLexPos + tLen;
            }

            // The ERROR node's byte length MUST cover all bytes from its
            // start up to the resume position (where the parser picks back
            // up). The parser resumes at `resumePos` and the next token's
            // padding is computed relative to that position. If we used
            // `actualEnd` (end of last garbage token) instead, there would
            // be a gap of uncovered bytes (trailing whitespace/newlines
            // between the error tokens and the resume point) that no node
            // accounts for, causing all subsequent sibling offsets to drift.
            let islandByteLen = (resumePos as u32) > head.pos + islandPad ? (resumePos as u32) - head.pos - islandPad : 0;
            setNodeByteLength(islandLeaf, islandByteLen);

            if ((resumePos as u32) == head.pos && foundTarget == head.state) {
              // This makes zero progress (same position, same state).
              // Pushing it resets consecutiveInsertions and causes an infinite loop.
              // We just drop this branch.
            } else {
              // Branch the GSS from the recovery anchor, shifting the new ERROR node.
              // Instead of pushing an extra head (which corrupts GSS depth), we REPLACE currPop
              // with a new head that has the same state and prev, but merges the ERROR node into its astNode.
              let nextConsecutive = ((resumePos as u32) == head.pos) ? head.consecutiveInsertions : 0;
              let parentType = currPop.astNode != 0 ? getNodeType(currPop.astNode) : NODE_TYPE_ERROR;
              let mergedNode = currPop.astNode != 0 ? cloneNodeShallow(currPop.astNode) : 0;
              
              // 1. Re-append the valid popped nodes as siblings!
              for (let k = childCount - 1; k >= 0; k--) {
                let child = t_globalChildNodes[k];
                if (child == 0) continue;
                if (mergedNode != 0) {
                  mergedNode = appendToList(mergedNode, child, parentType as u16, 0);
                } else {
                  mergedNode = cloneNodeShallow(child);
                }
              }

              // 2. Append the garbage ERROR node as a sibling!
              if (islandByteLen > 0 || getNodeFirstChild(islandLeaf) != 0) {
                if (mergedNode != 0) {
                  mergedNode = appendToList(mergedNode, islandLeaf, parentType as u16, 0);
                } else {
                  mergedNode = islandLeaf;
                }
              }

              logInt(islandPad);
              logInt(islandByteLen);
              let islandHead = allocParseHead(
                currPop.state, 
                mergedNode,
                currPop.prev, // Use currPop.prev to maintain correct GSS depth!
                resumePos as u32,
                islandScannerState,
                currPop.errorCost + islandCost,
                currPop.successfulShifts,
                foundBalance,
                nextConsecutive,
                head.dynamicPrec,
                0, // pendingPadding
                newTail,
                0, 0, 0, 0 // No virtual tokens in Island Mode
              );
              pushActiveHead(changetype<u32>(islandHead));
            }
          }
        }
        } // end configEnableIslandMode
}
