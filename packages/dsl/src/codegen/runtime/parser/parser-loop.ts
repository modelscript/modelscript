/**
 * @fileoverview GLR Parser Engine Loop
 * 
 * This file contains the core graph-structured stack (GSS) manipulation and
 * error recovery algorithms for the ModelScript parser. It implements a hybrid
 * LR/GLR architecture: it starts in fast LR mode for deterministic code, and
 * transitions to GLR mode upon encountering ambiguities or syntax errors.
 * 
 * It also handles AST memory management (allocating nodes in the Arena),
 * structural incremental reuse (splicing nodes from a previous AST), and
 * complex heuristics for list flattening to maintain O(log N) operations.
 */

import {
    initGSS,
    ParseHead, GssEdge, t_activeHeads, t_nextHeads, activeHeadsCount, nextHeadsCount, pushActiveHead, pushNextHead, swapActiveAndNextHeads, allocParseHead, t_extractedHeadsBuffer,
    t_pausedHeads, pausedHeadsCount, resetPausedHeads,
    globalCursorDepth, cursorNodeStack, cursorContentStartStack, globalCursorGotoNextSibling, globalCursorGotoParent, globalCursorGotoFirstChild
} from "./gss";
import { 
    allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild,
    getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, propagateFirstChildPadding,
    setNodeByteLength, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_LIST_BOUNDARY, FLAG_HAS_ERROR, FLAG_IS_TAINED, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_IS_SHARED, FLAG_FRAGILE,
    getNodeEnvHash, getNodeStartState, setNodeStartState, getNodeReductionLookahead, setNodeReductionInfo, getInputBuffer,
    atomicChunkAlloc, resetGeneration, S, ASTNode, clearAstMarks, isNodeGen2,
    setNodeMerkleHash, getNodeMerkleHash, EPHEMERAL_FLAGS
} from "../arena";
import { UnmanagedUint32Array, UnmanagedUint8Array, UnmanagedInt32Array, ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import {
    lexPos, lexLen, srcLexPos, currentScannerState, invokeLexer, is_extra_token, inputLength,
    lex, setLexPos, setLexLen, setSrcLexPos, setCurrentScannerState, SYMBOL_COUNT, logInt, peekChar, peekCharLen
} from "../parser";
import {
    TOKEN_EOF, TOKEN_UNKNOWN, NODE_TYPE_ERROR, ACTION_SHIFT, ACTION_REDUCE, ACTION_ACCEPT,
    action_offsets, action_data, goto_offsets, goto_data, mrd_data, token_insert_costs,
    prod_lengths, prod_right_offsets, prod_right_symbols, prod_lhs, prod_is_structural, prod_is_invisible, prod_is_list, prod_dynamic_prec, prod_aliases, alias_data,
    type_fields, type_field_data,
    MAX_ERRORS, MAX_PARALLEL_HEADS, INFINITE_COST, MAX_CHILD_NODES, MIN_LOOP_LIMIT, ARENA_BUFFER_SIZE,
    MAX_LOOKAHEAD_DEPTH, MAX_AST_TRAVERSAL_DEPTH, LOOP_MULTIPLIER_LIMIT, MAX_PANIC_SCAN_TOKENS,
    CHAR_LBRACE, CHAR_RBRACE, CHAR_LBRACKET, CHAR_RBRACKET, CHAR_LPAREN, CHAR_RPAREN,
    LIST_MAX_CHILDREN, LIST_SPLIT_POINT,
    t_tokenBufferArena, t_tokenBufferLenArena,
    t_lrStateStack, t_lrNodeStack, lrStackDepth,
    t_globalChildNodes, t_globalChildren, t_globalReduceCollected,
    MODE_LR, MODE_GLR, currentParserMode,
    reportGlobalError, debugLog, pushDiagnostic,
    expected_tokens, getExpectedTokensForState,
    findMergeCandidate, registerMergeCandidate,
    TOKEN_SUSPEND, releaseFieldCursor,
    globalIsCatastrophic, commitDiagnostics, DiagnosticNode,
    lastBestCost, lastIterCount, lastMaxHeads,
    tokenBufferReadIdx, tokenBufferWriteIdx,
    isSuspended, tokenBufferLastPos,
    globalLoopIterations, globalLoopGuard,
    globalSearchIterations, mergeGeneration,
    tempActions, mergeTableInit, initGlobalCursor, errorCount,
    MAX_LR_STACK_DEPTH, FieldCursor, MAX_TERMINAL_ID, reachability_matrix,
    configEnableBranchA1, configEnableBranchB, configEnableBranchC, configEnableIslandMode, configEnableMultiFile
} from "./engine";
import { globalAstRoot } from "./lsp";

const configEnableBranchA2 = false;
const ACCEPT_CACHE_CAPACITY: u32 = 16384;
const ACCEPT_CACHE_MASK: u32 = 16383;
const ACCEPT_CACHE_PROBE_LIMIT: u32 = 8;
let t_acceptCache: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
import { recoverStackSummary, recoverSkipToken, recoverMissingToken, findShiftTarget } from "./recovery";
import { MAX_PRODUCTION_LENGTH } from "./recovery-config";
import { initQueryArena, resetQueryArena, clearDiagnostics } from "../graph";

/**
 * Looks up the GLR action count for a given parser state and token.
 * This checks the `action_offsets` and `action_data` tables.
 * 
 * @param state The current parser state.
 * @param token The token ID to look up (terminal or non-terminal).
 * @returns The number of possible actions (1 for LR, >1 for GLR conflicts).
 */
function lookupActions(state: i32, token: i32): i32 {
  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset + 1 >= action_data.length) {
    return 0;
  }
  let actionCount = action_data[actionOffset];
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
  
  let matchIdx = exactIdx != -1 ? exactIdx : defaultIdx;
  if (matchIdx == -1) {
    return 0;
  }
  
  if (changetype<usize>(tempActions) == 0) {
    tempActions = changetype<UnmanagedUint32Array>(atomicChunkAlloc(32 * sizeof<u32>()));
  }
  let actCount = action_data[matchIdx + 1];
  let actPtr = matchIdx + 2;
  let count = actCount < 16 ? actCount : 16;
  for (let i = 0; i < count; i++) {
    tempActions[i * 2] = action_data[actPtr + i * 2];
    tempActions[i * 2 + 1] = action_data[actPtr + i * 2 + 1];
  }
  return count;
}

/**
 * Fast boolean check if an action exists for the given state and token.
 */
function actionLookupFnBool(state: i32, token: i32): boolean {
  return lookupActions(state, token) != 0;
}

/**
 * Fast boolean check if the token can eventually be accepted from this state
 * (performing simulated lookahead through error recoveries if necessary).
 */
function stateCanAcceptFnBool(state: i32, token: i32): boolean {
  return stateCanAccept(null, state, token) > 0;
}
/**
 * Transitions the parser from fast LR mode to full GLR mode.
 * Converts the flat LR stack into a Graph-Structured Stack (GSS) head.
 * 
 * @param pos Current byte offset in the input stream.
 * @param pendingPadding Extraneous whitespace/comments accumulated before the current token.
 * @param scannerState The state of the lexer at transition time.
 */
function transitionToGlr(pos: u32, pendingPadding: u32, scannerState: u32): void {
  let prevHead: ParseHead | null = null;
  let currentPos: u32 = 0;
  for (let i = 0; i < lrStackDepth; i++) {
    let state = t_lrStateStack[i] as i32;
    let node = t_lrNodeStack[i];
    
    if (node != 0) {
      currentPos += getNodePadding(node) + getNodeByteLength(node);
    }
    
    
    let head = allocParseHead(
      state,
      node,
      prevHead,
      currentPos,
      scannerState,
      0,
      0,
      0,
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
  }
  
  currentParserMode = MODE_GLR;
}
/**
 * Interacts with the lexer module to fetch the next token ID.
 * The `lex` function also updates global `lexLen` and `srcLexPos`.
 */
function invokeLexer(pos: u32): i32 {
  updateExpectedTokens(pos);
  let token = lex(pos);
  return token;
}
/**
 * Fast-path LR parser. This parser loop handles deterministic code sections.
 * If an ambiguity is encountered (actionCount > 1) or an error occurs (actionCount == 0),
 * it calls `transitionToGlr` to switch over to the heavy GLR machinery.
 * 
 * @returns The final accepted AST root node pointer, or 0 if transitioning to GLR.
 */
function parseLR(startPos: u32 = 0, startToken: i32 = -1, startPendingPad: u32 = 0): u32 {
  let pos: u32 = startPos;
  let token: i32 = startToken;
  let pendingPadding: u32 = startPendingPad;

  if (startToken == -1) {
    t_lrStateStack[0] = 0;
    t_lrNodeStack[0] = 0;
    lrStackDepth = 1;

    token = invokeLexer(pos);
    while (load<u8>(is_extra_token + token) == 1) {
      if (lexLen == 0) {
        pos += 1;
        break;
      }
      pendingPadding += lexLen;
      let nextPos = pos + lexLen;
      pos = nextPos > pos ? nextPos : pos + 1;
      token = invokeLexer(pos);
    }
  }

  
  let consecutiveReductions: u32 = 0;
  while (currentParserMode == MODE_LR) {
    let currentState = t_lrStateStack[(lrStackDepth - 1)] as i32;

    if (pos < inputLength && token != TOKEN_EOF && globalCursorDepth >= 0 && (g_editNewEnd > 0 || g_editOldEnd > 0 || t_editRangesCount > 0)) {
      let oldPos = mapNewPosToOldPos(pos);
      let oldSrcLexPos = mapNewPosToOldPos(srcLexPos);

      if (oldSrcLexPos != 0xffffffff) {
        let expectedPadding: u32 = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
        let lastNode = t_lrNodeStack[lrStackDepth - 1];
        let headSym: u32 = lastNode != 0 ? (getNodeType(lastNode) as u32) : 0xffffffff;
        let reusedNode = findReusableNode(
          oldPos,
          oldSrcLexPos,
          currentState,
          0,
          g_editStart,
          g_editOldEnd,
          headSym,
          expectedPadding
        );
        if (reusedNode != 0) {
          let nodeType = getNodeType(reusedNode);
          let nextState = -1;
          if (nodeType > (MAX_TERMINAL_ID as u16)) {
            if (currentState < goto_offsets.length) {
              let gOffset = goto_offsets[currentState];
              if (gOffset >= 0 && gOffset < goto_data.length) {
                let gCount = goto_data[gOffset];
                for (let gi = 0; gi < gCount; gi++) {
                  if (goto_data[gOffset + 1 + gi * 2] == nodeType) {
                    nextState = goto_data[gOffset + 1 + gi * 2 + 1];
                    break;
                  }
                }
              }
            }
          } else {
            let numActions = lookupActions(currentState, nodeType as i32);
            if (numActions > 0 && tempActions[0] == (ACTION_SHIFT as u32)) {
              nextState = tempActions[1] as i32;
            }
          }
          if (nextState != -1) {
            let totalPadding = expectedPadding;
            let endPos = pos + totalPadding + getNodeByteLength(reusedNode);
            let nextTok = invokeLexer(endPos);
            let nextPendingPad: u32 = 0;
            while (load<u8>(is_extra_token + nextTok) == 1) {
              if (lexLen == 0) {
                endPos += 1;
                break;
              }
              nextPendingPad += lexLen;
              let nextEndPos = endPos + lexLen;
              endPos = nextEndPos > endPos ? nextEndPos : endPos + 1;
              nextTok = invokeLexer(endPos);
            }
            let canAccept = stateCanAcceptFnBool(nextState, nextTok);
            if (!canAccept && nextTok >= 0 && nextTok <= MAX_TERMINAL_ID) {
              let checkTok = nextTok == TOKEN_EOF ? 0 : nextTok;
              let dist = reachability_matrix[nextState * (MAX_TERMINAL_ID + 1) + checkTok];
              if (dist < 250) {
                canAccept = true;
              }
            }
            if (canAccept) {
              let clone = cloneNodeShallow(reusedNode);
              setNodePadding(clone, totalPadding);
              setNodeFlags(clone, getNodeFlags(clone) | FLAG_EXTRACTED);
              t_lrStateStack[lrStackDepth] = nextState;
              t_lrNodeStack[lrStackDepth] = clone;
              lrStackDepth++;
              pos = endPos;
              token = nextTok;
              pendingPadding = nextPendingPad;
              consecutiveReductions = 0;
              continue;
            }
          }
        }
      }
    }

    let actionCount = lookupActions(currentState, token);
    
    let type: u32 = 0;
    let target: i32 = 0;
    if (actionCount == 0 || actionCount > 1) {
      let defaultReduce = -1;
      let hasConflictingReduce = false;
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

      if (actionCount == 0 && defaultReduce != -1 && !hasConflictingReduce && token == TOKEN_EOF) {
        type = ACTION_REDUCE;
        target = defaultReduce;
      } else {
        if (startToken == -1) {
          transitionToGlr(pos, pendingPadding, currentScannerState);
        } else {
          currentParserMode = MODE_GLR;
        }
        return 0;
      }


    } else {
      type = tempActions[0];
      target = tempActions[1] as i32;
    }
    
    if (type == ACTION_SHIFT) {
      consecutiveReductions = 0;
      let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
      let leaf = allocNode(token as u16, paddingLength, lexLen, 0, false, currentState as u32);
      
      let lh: u64 = 0xcbf29ce484222325;
      lh ^= (token as u64);
      lh = lh * 0x100000001b3;
      lh ^= (lexLen as u64);
      lh = lh * 0x100000001b3;
      let inBuf = getInputBuffer() + srcLexPos;
      for (let i: u32 = 0; i < lexLen; i++) {
        lh ^= load<u8>(inBuf + i) as u64;
        lh = lh * 0x100000001b3;
      }
      setNodeMerkleHash(leaf, (lh & 0xffffffff) as u32, (lh >> 32) as u32);

      t_lrStateStack[lrStackDepth] = target;
      t_lrNodeStack[lrStackDepth] = leaf;
      lrStackDepth++;
      
      pos = srcLexPos + lexLen;
      
      token = invokeLexer(pos);
      pendingPadding = 0;
      while (load<u8>(is_extra_token + token) == 1) {
        if (lexLen == 0) {
          pos += 1;
          break;
        }
        pendingPadding += lexLen;
        let nextPos = pos + lexLen;
        pos = nextPos > pos ? nextPos : pos + 1;
        token = invokeLexer(pos);
      }
      
    } else if (type == ACTION_REDUCE) {
      if (++consecutiveReductions > 5000) {
        if (startToken == -1) {
          transitionToGlr(pos, pendingPadding, currentScannerState);
        } else {
          currentParserMode = MODE_GLR;
        }
        return 0;
      }
      let reduceProd = target;
      let popCount = prod_lengths[reduceProd] as i32;
      let lhsSym = prod_lhs[reduceProd];
      
      lrStackDepth -= popCount;
      let childStartIdx = lrStackDepth;
      let prevState = t_lrStateStack[(lrStackDepth - 1)] as i32;
      
      let totalByteLength: u32 = 0;
      let firstChildPadding: u32 = 0;
      if (popCount > 0) {
        firstChildPadding = getNodeLeadingPad(t_lrNodeStack[childStartIdx]);
        for (let k = 0; k < popCount; k++) {
          let child = t_lrNodeStack[(childStartIdx + k)];
          let cPadding = getNodeLeadingPad(child);
          let cLen = getNodeByteLength(child);
          if (k == 0) totalByteLength += cLen;
          else totalByteLength += cPadding + cLen;
        }
      }
      
      let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, 0, false, prevState as u32);
      if (prod_is_list[reduceProd] == 1) {
        setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_IS_LIST);
      }
      if (prod_is_invisible[reduceProd] == 1) {
        setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_INVISIBLE);
      }
      
      if (popCount > 0) {
        let isListAppend = false;
        if (
          (popCount == 2 || popCount == 3) &&
          t_lrNodeStack[childStartIdx] != 0 &&
          prod_is_list[reduceProd] == 1
        ) {
          let leftSym = getNodeType(t_lrNodeStack[childStartIdx]);
          if (leftSym == lhsSym) isListAppend = true;
        }
        
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
          let lastChild = 0;
          let logicalChildIndex = 0;
          let aliasPtr = prod_aliases[reduceProd];
          let aliasCount = 0;
          if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];
          
          for (let k = 0; k < popCount; k++) {
            let child = t_lrNodeStack[(childStartIdx + k)];
            if (child == 0) continue;
            
            let clone = isMutable(child) ? child : cloneNodeShallow(child);
            
            if (k == 0) {
              setNodePadding(clone, 0);
            }
            
            if (aliasPtr >= 0) {
              for (let a = 0; a < aliasCount; a++) {
                let aIndex = alias_data[aliasPtr + 1 + a * 2];
                let aSym = alias_data[aliasPtr + 1 + a * 2 + 1];
                if (aIndex == logicalChildIndex) {
                  let node = changetype<ASTNode>(clone);
                  node.type = aSym as u16;
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
          }
        }
      }
      
      let nextState = -1;
      let gOffset = goto_offsets[prevState];
      if (gOffset >= 0 && gOffset < goto_data.length) {
        let gCount = goto_data[gOffset];
        let gIdx = gOffset + 1;
        for (let k = 0; k < gCount; k++) {
          if (goto_data[gIdx++] == lhsSym) {
            nextState = goto_data[gIdx++];
            break;
          } else {
            gIdx++;
          }
        }
      }
      
      if (nextState == -1) {
        if (startToken == -1) {
          transitionToGlr(pos, pendingPadding, currentScannerState);
        } else {
          currentParserMode = MODE_GLR;
        }
        return 0;
      }
      
      debugLog(7776, reduceProd as u32, lhsSym as u32, lrStackDepth as u32);
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

      t_lrStateStack[lrStackDepth] = nextState;
      t_lrNodeStack[lrStackDepth] = parentNode;
      lrStackDepth++;
      
    } else if (type == ACTION_ACCEPT) {
      debugLog(7777, currentState as u32, token as u32, lrStackDepth as u32);
      let rootNode = t_lrNodeStack[1];
      return cloneNodeShallow(rootNode);
    }
  }
  
  return 0;
}

export function findGotoSymbol(fromState: i32, toState: i32): i32 {
  if (fromState < 0 || fromState >= goto_offsets.length) return -1;
  let gOffset = goto_offsets[fromState];
  if (gOffset < 0 || gOffset >= goto_data.length) return -1;
  let gCount = goto_data[gOffset];
  let gIdx = gOffset + 1;
  for (let k = 0; k < gCount; k++) {
    let sym = goto_data[gIdx];
    let nextSt = goto_data[gIdx + 1];
    if (nextSt == toState) return sym;
    gIdx += 2;
  }
  return -1;
}

export function addStateExpectedTokens(state: i32, depth: i32): void {
  if (depth > 4 || state < 0 || state >= action_offsets.length) return;
  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) return;

  let actionCount = action_data[actionOffset];
  let idx = actionOffset + 1;

  for (let j = 0; j < actionCount; j++) {
    let sym = action_data[idx++];
    let actCount = action_data[idx++];
    if (sym > 0 && sym < 65536) {
      store<u8>(expected_tokens + sym, 1);
    }
    if (sym == 0) {
      for (let na = 0; na < actCount; na++) {
        let aType = action_data[idx + na * 2];
        let aTarget = action_data[idx + na * 2 + 1];
        if (aType == ACTION_REDUCE && aTarget >= 0 && aTarget < prod_lhs.length) {
          let lhs = prod_lhs[aTarget];
          let gOffset = goto_offsets[state];
          if (gOffset >= 0 && gOffset < goto_data.length) {
            let gCount = goto_data[gOffset];
            let gIdx = gOffset + 1;
            for (let k = 0; k < gCount; k++) {
              if (goto_data[gIdx++] == lhs) {
                let nextSt = goto_data[gIdx++];
                addStateExpectedTokens(nextSt, depth + 1);
                break;
              } else gIdx++;
            }
          }
        }
      }
    }
    idx += actCount * 2;
  }
}

export let savedExpectedTokensPtr: usize = 0;

export let lastPeekedTokenLen: u32 = 0;
export let lastPeekedTokenEnd: u32 = 0;

export function peekNextTokenInState(pos: u32, state: i32): i32 {
  if (expected_tokens == 0) expected_tokens = atomicChunkAlloc(65536);
  if (savedExpectedTokensPtr == 0) savedExpectedTokensPtr = atomicChunkAlloc(65536);
  // P5 fix: Only copy the used range (MAX_TERMINAL_ID+1 bytes) instead of full 64KB
  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  memory.copy(savedExpectedTokensPtr, expected_tokens, copyLen);
  memory.fill(expected_tokens, 0, copyLen);
  addStateExpectedTokens(state, 0);

  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedScannerState = currentScannerState;

  let tok = invokeLexer(pos);
  lastPeekedTokenLen = lexLen;
  lastPeekedTokenEnd = srcLexPos + lexLen;

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  memory.copy(expected_tokens, savedExpectedTokensPtr, copyLen);
  return tok;
}

/**
 * Updates the `expected_tokens` bitset based on the valid action transitions
 * from the active parsing heads (either the single LR head or all GLR heads).
 * This acts as context-aware feedback for the lexer (for keywords vs identifiers).
 */
function updateExpectedTokens(frontierPos: u32 = 0): void {
  if (expected_tokens == 0) {
    expected_tokens = atomicChunkAlloc(65536);
  }
  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  memory.fill(expected_tokens, 0, copyLen);
  if (currentParserMode == MODE_LR) {
    if (lrStackDepth > 0) {
      let state = t_lrStateStack[lrStackDepth - 1] as i32;
      addStateExpectedTokens(state, 0);
    }
  } else {
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
  }
}
/** @deprecated Used for structural accept caching. Returns the hash. */
function acceptCacheHash(key: u64): u32 {
  return 0;
}
/** @deprecated Used for structural accept caching. Returns the cached result. */
function acceptCacheGet(key: u64): i32 {
  return -1;
}
/** @deprecated Used for structural accept caching. Stores a result. */
function acceptCacheSet(key: u64, result: i32): void {
}
/** @deprecated Used for structural accept caching. Clears the cache. */
function acceptCacheClear(): void {
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
  let mappedTok = tok;
  if (tok == TOKEN_EOF) mappedTok = 0;
  else if (tok > MAX_TERMINAL_ID) return false;

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
    for (let t = 0; t <= MAX_TERMINAL_ID; t++) {
      let checkTok = t == 0 ? TOKEN_EOF : t;
      let res = stateCanAccept(null, state, checkTok);
      if (res == 2) {
         // Special code: ALL TOKENS REACHABLE!
         for(let t2=0; t2 <= MAX_TERMINAL_ID; t2++) {
             t_stateReachability[baseIdx + (t2 >> 5)] |= (1 << (t2 & 31));
         }
         break;
      }
      if (res > 0) {
        t_stateReachability[baseIdx + (t >> 5)] |= (1 << (t & 31));
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
 * @returns 1 if reachable, 2 if infinitely reachable, 0 if not reachable.
 */
export function stateCanAccept(head: ParseHead | null, state: i32, tok: i32, depth: i32 = 0, virtualDepth: i32 = 0): i32 {
  if (depth > 40) return 0;
  if (state < 0 || state >= action_offsets.length) return 0;
  if (head == null && !computingReachability && depth == 0 && virtualDepth == 0) {
    if (!isEpsilonReachable(state, tok)) return 0;
  }
  if (depth == 0 && virtualDepth > 0 && virtualDepth <= 64) {
    t_virtualStates[0] = state;
  }

  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) return 0;

  let actionCount = action_data[actionOffset];
  let idx = actionOffset + 1;
  for (let i = 0; i < actionCount; i++) {
    let sym = action_data[idx];
    if (computingReachability && sym == tok) return 1;
    let actCount = action_data[idx + 1];
    let actIdx = idx + 2;
    if (sym == tok || sym == 0) {
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
            topState = pHead != null ? pHead.state : (remCounter == 0 ? 0 : (ruleLen == 0 ? state : -1));
          }

          let nextState = -1;
          if (topState != -1) {
            let gOffset = goto_offsets[topState];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              let gIdx = gOffset + 1;
              for (let k = 0; k < gCount; k++) {
                if (goto_data[gIdx++] == ruleLHS) {
                  nextState = goto_data[gIdx++];
                  break;
                } else gIdx++;
              }
            }
          }
          
          if (nextState != -1) {
            if (newVirtualDepth < 64) {
              t_virtualStates[newVirtualDepth] = nextState;
            }
            let res = stateCanAccept(pHead, nextState, tok, depth + 1, newVirtualDepth + 1);
            if (res > 0) return res;
          } else {
            if (computingReachability) return 2;
          }
        }
      }
    }
    idx += 2 + actCount * 2;
  }
  return 0;
}

/**
 * Post-parse sanitization: walks the AST and replaces any child nodes with
 * invalid type IDs (memory corruption from GLR ambiguity or incremental reuse)
 * with clean ERROR nodes. This prevents UNKNOWN nodes from appearing in the
 * final tree output.
 */
/**
 * Deep clones an AST subtree.
 * Memory corruption from GLR ambiguity or incremental reuse can cause invalid type IDs,
 * so this deep-cloning ensures clean separation of shared subtrees.
 */
let t_cloneStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/**
 * Deeply clones an AST subtree using an iterative traversal stack.
 * Operates in O(N) time with zero recursion, safe for arbitrarily deep nested trees.
 * 
 * @param root The root node of the subtree to clone.
 * @param _depth Unused legacy parameter maintained for API compatibility.
 * @returns A fresh, independent clone of the subtree.
 */
function deepCloneSubtree(root: u32, _depth: i32 = 0): u32 {
  if (root == 0) return 0;
  if (changetype<usize>(t_cloneStack) == 0) {
    t_cloneStack = createChunkedUint32Array(50000);
  } else {
    t_cloneStack.clear();
  }

  let rootClone = allocNode(getNodeType(root), getNodePadding(root), getNodeByteLength(root), getNodeEnvHash(root), false, getNodeStartState(root));
  setNodeFlags(rootClone, getNodeFlags(root) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));

  t_cloneStack.push(root);
  t_cloneStack.push(rootClone);

  while (t_cloneStack.length > 0) {
    let currClone = t_cloneStack.pop();
    let currSrc = t_cloneStack.pop();
    if (currSrc == 0 || currClone == 0) continue;

    let child = getNodeFirstChild(currSrc);
    let lastClonedChild: u32 = 0;
    let siblingCount: u32 = 0;

    while (child != 0 && siblingCount < 500000) {
      siblingCount++;
      let childClone = allocNode(getNodeType(child), getNodePadding(child), getNodeByteLength(child), getNodeEnvHash(child), false, getNodeStartState(child));
      setNodeFlags(childClone, getNodeFlags(child) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));

      if (lastClonedChild == 0) {
        setFirstChild(currClone, childClone);
      } else {
        setNextSibling(lastClonedChild, childClone);
      }
      lastClonedChild = childClone;

      if (getNodeFirstChild(child) != 0) {
        t_cloneStack.push(child);
        t_cloneStack.push(childClone);
      }

      child = getNodeNextSibling(child);
    }
  }
  return rootClone;
}

let t_sanitizeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_sanitizeVisited: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/**
 * Post-parse sanitization algorithm. Walk the AST to:
 * 1. Remove nodes with corrupt/invalid Type IDs that occasionally slip through error recovery.
 * 2. Identify shared subtrees (aliased pointers resulting from GLR tree forks) and clone them
 *    so the final AST is a strict DAG, preventing infinite loops during LSP traversal.
 * 
 * @param root The accepted AST root node.
 */
function sanitizeTree(root: u32): void {
  if (root == 0) return;
  
  if (changetype<usize>(t_sanitizeStack) == 0) {
    t_sanitizeStack = createChunkedUint32Array(50000);
    t_sanitizeVisited = createChunkedUint32Array(50000);
  } else {
    t_sanitizeStack.clear();
    t_sanitizeVisited.clear();
  }

  // Mark the root as visited
  setNodeFlags(root, getNodeFlags(root) | FLAG_LSP_VISITED);
  t_sanitizeVisited.push(root);
  t_sanitizeStack.push(root);

  while (t_sanitizeStack.length > 0) {
    let node = t_sanitizeStack.pop();
    if (node == 0) continue;

    let prevChild: u32 = 0;
    let child = getNodeFirstChild(node);
    let modified = false;
    let siblingGuard: u32 = 0;

    while (child != 0 && siblingGuard < 500000) {
      siblingGuard++;
      let childType = getNodeType(child);
      let nextSib = getNodeNextSibling(child);

      let cleanType = childType & 0x7FFF;
      if (cleanType > (SYMBOL_COUNT as u16) && childType != TOKEN_EOF) {
        // Corrupt node: REMOVE it by unlinking from the chain.
        // Gen1 immutability: cannot mutate Gen1 parent (if prevChild==0) or Gen1 prevChild (if prevChild!=0)
        if (!isNodeGen2(node) || (prevChild != 0 && !isNodeGen2(prevChild))) {
          prevChild = child;
        } else {
          if (prevChild == 0) setFirstChild(node, nextSib);
          else setNextSibling(prevChild, nextSib);
          modified = true;
        }
      } else {
        if (g_oldTree != 0 && !isNodeGen2(child)) {
          prevChild = child;
          child = nextSib;
          continue;
        }

        // Check if this child was already visited (shared subtree)
        let cFlags = getNodeFlags(child);
        let isShared = (cFlags & FLAG_LSP_VISITED) != 0;
        
        if (isShared) {
          // Cannot mutate Gen1 parent or Gen1 prevChild to break aliasing
          if (!isNodeGen2(node) || (prevChild != 0 && !isNodeGen2(prevChild))) {
            prevChild = child;
          } else {
            // Deep-clone to break shared-pointer aliasing
            let freshClone = deepCloneSubtree(child, 0);
            if (freshClone != 0) {
              setNextSibling(freshClone, nextSib);
              if (prevChild == 0) setFirstChild(node, freshClone);
              else setNextSibling(prevChild, freshClone);
              prevChild = freshClone;
              // Mark the fresh clone as visited and push for sanitization
              t_sanitizeVisited.push(freshClone);
              t_sanitizeStack.push(freshClone);
            } else {
              // Clone failed (too deep); unlink to prevent cycle (B2 fix: log warning diagnostic)
              debugLog(9009, child, node, 0);
              if (prevChild == 0) setFirstChild(node, nextSib);
              else setNextSibling(prevChild, nextSib);
              modified = true;
            }
          }
        } else {
          // Mark as visited and recurse
          setNodeFlags(child, cFlags | FLAG_LSP_VISITED);
          t_sanitizeVisited.push(child);
          t_sanitizeStack.push(child);
          prevChild = child;
        }
      }

      child = nextSib;
    }

    // Recalculate the parent node's length if children were removed
    if (modified) {
      fixNodeLength(node);
    }

  }

  // Second pass: Clear the FLAG_LSP_VISITED flag
  for (let vi: u32 = 0; vi < t_sanitizeVisited.length; vi++) {
    let vNode = t_sanitizeVisited.get(vi);
    setNodeFlags(vNode, getNodeFlags(vNode) & ~FLAG_LSP_VISITED);
  }
}

/**
 * Checks if a node consists entirely of error nodes (or lists of error nodes).
 * Pure error nodes are handled differently during reductions to avoid wrapping
 * garbage tokens in legitimate non-terminals.
 */
function nodeHasAnyErrors(node: u32): boolean {
  if (node == 0) return false;
  // Iterative traversal with explicit stack to avoid unbounded recursion (B1 fix)
  if (changetype<usize>(t_sanitizeStack) == 0) {
    t_sanitizeStack = createChunkedUint32Array(50000);
    t_sanitizeVisited = createChunkedUint32Array(50000);
  }
  let savedLen = t_sanitizeStack.length;
  t_sanitizeStack.push(node);
  let found = false;
  let iterations: u32 = 0;
  while (t_sanitizeStack.length > savedLen && iterations < 500000) {
    iterations++;
    let curr = t_sanitizeStack.pop();
    if (curr == 0) continue;
    let flags = getNodeFlags(curr);
    if ((flags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED)) != 0) { found = true; break; }
    let type = getNodeType(curr);
    if (type == NODE_TYPE_ERROR || (type & 0x8000) != 0) { found = true; break; }
    let child = getNodeFirstChild(curr);
    let sibCount: u32 = 0;
    while (child != 0 && sibCount < 50) {
      t_sanitizeStack.push(child);
      child = getNodeNextSibling(child);
      sibCount++;
    }
  }
  // Restore stack to saved length
  while (t_sanitizeStack.length > savedLen) t_sanitizeStack.pop();
  return found;
}

/**
 * Scans the parsing head history for "stranded nodes" (nodes that were parsed but never 
 * reduced into the final accepted tree because they were dropped by error recovery or
 * skipped by the GLR acceptor). Re-injects these nodes as error nodes into the AST to ensure
 * total token fidelity (so the LSP doesn't lose user code).
 * 
 * @param acceptedNode The best accepted root node from the GLR parse.
 * @param headPtr The best accepting ParseHead pointer.
 * @returns The new root node containing both the accepted nodes and stranded nodes.
 */
function injectStrandedNodes(acceptedNode: u32, headPtr: u32): u32 {
  if (headPtr == 0 || acceptedNode == 0) return acceptedNode;
  
  let curr: ParseHead | null = changetype<ParseHead>(headPtr);
  let c_idx: u32 = 0;
    let acceptBase = acceptedNode;
    // Follow clones back to their origin
    // Follow clones back to their origin with depth limit to avoid O(H*D) (B4 fix)
    let chaseDepth: u32 = 0;
    while ((getNodeFlags(acceptBase) & FLAG_EXTRACTED) != 0 && getNodeFirstChild(acceptBase) != 0 && chaseDepth < 8) {
      chaseDepth++;
      let isShallowClone = false;
      let currTemp: ParseHead | null = headPtr != 0 ? changetype<ParseHead>(headPtr) : null;
      let tempLimit: u32 = 0;
      while (currTemp && tempLimit < 64) {
        tempLimit++;
        if (currTemp.astNode != 0 && currTemp.astNode != acceptBase && getNodeFirstChild(currTemp.astNode) == getNodeFirstChild(acceptBase)) {
           acceptBase = currTemp.astNode;
           isShallowClone = true;
           break;
        }
        currTemp = currTemp.prev;
      }
      if (!isShallowClone) break;
    }

    let accStart = getNodePadding(acceptBase);
    let accLen = getNodeByteLength(acceptBase);
    if (accLen == 0 || acceptBase == acceptedNode) accLen = inputLength;

    while (curr) {
      if (curr.astNode != 0 && curr.astNode != acceptedNode && curr.astNode != acceptBase && getNodeType(curr.astNode) != TOKEN_EOF) {
        let nEnd = curr.pos;
        let nPad = getNodePadding(curr.astNode);
        let nLen = getNodeByteLength(curr.astNode);
        let nStart = nEnd >= (nPad + nLen) ? nEnd - (nPad + nLen) : 0;
        // If curr.astNode falls within the byte span of acceptedNode/acceptBase, it was already consumed in reductions!
        if (accLen > 0 && nStart >= accStart && nEnd <= (accStart + accLen)) {
          // Already inside acceptedNode! Skip!
        } else {
          if (c_idx < (MAX_CHILD_NODES as u32)) {
            t_globalChildNodes[c_idx++] = curr.astNode;
          }
        }
      }
      curr = curr.prev;
    }
  
  if (c_idx == 0) return acceptedNode;
  
  let firstChild = getNodeFirstChild(acceptedNode);
  let lastStranded = 0;
  let firstStranded = 0;
  
  for (let i: i32 = c_idx - 1; i >= 0; i--) {
    let sNode = t_globalChildNodes[i];
    let clone = cloneNodeShallow(sNode);
    if (lastStranded == 0) {
      firstStranded = clone;
    } else {
      setNextSibling(lastStranded, clone);
    }
    lastStranded = clone;
  }
  
  if (firstStranded != 0) {
    let type = getNodeType(acceptedNode);
    let isTerm = type <= (MAX_TERMINAL_ID as u16) && type != NODE_TYPE_ERROR;
    
    if (!isMutable(acceptedNode)) {
      acceptedNode = cloneNodeShallow(acceptedNode);
    }
    
    if (isTerm) {
      let errorRoot = allocNode(NODE_TYPE_ERROR, getNodePadding(acceptedNode), getNodeByteLength(acceptedNode), 0);
      setNodePadding(acceptedNode, 0);
      setFirstChild(errorRoot, acceptedNode);
      setNextSibling(acceptedNode, firstStranded);
      return errorRoot;
    }

    let p = getNodePadding(firstStranded);
    setNodePadding(acceptedNode, p);
    setNodePadding(firstStranded, 0);
    
    let firstChild = getNodeFirstChild(acceptedNode);
    setNextSibling(lastStranded, firstChild);

    setFirstChild(acceptedNode, firstStranded);
    
    let sCurr = firstStranded;
    while (sCurr != 0) {
      if (nodeHasAnyErrors(sCurr)) {
        setNodeFlags(sCurr, getNodeFlags(sCurr) | FLAG_HAS_ERROR);
        setNodeFlags(acceptedNode, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
      }
      sCurr = getNodeNextSibling(sCurr);
    }

    fixNodeLength(acceptedNode);
  }
  return acceptedNode;
}

/**
 * If the parser accepts a prefix of the file but leaves unparsed trailing text,
 * this function captures the remainder and wraps it in an ERROR node appended 
 * to the AST root. This ensures `inputLength` bytes are fully represented.
 * 
 * @param acceptedNode The AST root node.
 * @returns The wrapped node.
 */
function wrapWithTrailingErrors(acceptedNode: u32, acceptedPos: u32 = 0): u32 {
  if (acceptedPos >= inputLength) return acceptedNode;
  let nodeSpan = getNodePadding(acceptedNode) + getNodeByteLength(acceptedNode);
  if (acceptedPos > nodeSpan) nodeSpan = acceptedPos;
  
  if (nodeSpan >= inputLength) return acceptedNode;

  // There is unparsed input after the accepted node — lex it into an ERROR node
  let trailingStart = nodeSpan;
  let trailingLen = inputLength - trailingStart;

  // Save scanner state
  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedScannerState = currentScannerState;

  // lex() internally skips whitespace/comments. After calling lex(pos),
  // srcLexPos is where the real token starts (after extras), and lexLen is the token length.
  let firstTok = lex(trailingStart);

  // srcLexPos - trailingStart = whitespace between accepted node end and first error token
  let errPad: u32 = srcLexPos > trailingStart ? srcLexPos - trailingStart : 0;

  // Restore scanner state
  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  // If the first token is EOF, there's only trailing whitespace
  if (firstTok == TOKEN_EOF) return acceptedNode;

  let errByteLen = trailingLen > errPad ? trailingLen - errPad : 0;
  if (errByteLen == 0) return acceptedNode;

  let errorNode = allocNode(NODE_TYPE_ERROR, errPad, errByteLen, 0);

  // Lex the error content into child tokens of the ERROR node for AST fidelity
  let lastTokNode: u32 = 0;
  let errContentStart = trailingStart + errPad;
  let lexP = errContentStart;

  savedLexPos = lexPos;
  savedLexLen = lexLen;
  savedSrcLexPos = srcLexPos;
  savedScannerState = currentScannerState;

  // Force lexer to accept any token during error node construction, saving previous mask
  if (expected_tokens == 0) expected_tokens = atomicChunkAlloc(65536);
  if (savedExpectedTokensPtr == 0) savedExpectedTokensPtr = atomicChunkAlloc(65536);
  let _copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (_copyLen > 65536) _copyLen = 65536;
  memory.copy(savedExpectedTokensPtr, expected_tokens, _copyLen);
  memory.fill(expected_tokens, 1, _copyLen);

  while (lexP < inputLength) {
    let tok = lex(lexP);
    if (tok == TOKEN_EOF) break;
    let tLen = lexLen;
    if (tLen == 0) break;
    let pad: u32 = srcLexPos > lexP ? srcLexPos - lexP : 0;

    let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, pad, tLen, 0);
    setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
    if (lastTokNode == 0) {
      setNodePadding(tNode, 0);
      setFirstChild(errorNode, tNode);
    } else {
      setNextSibling(lastTokNode, tNode);
    }
    lastTokNode = tNode;

    lexP = srcLexPos + tLen > lexP ? srcLexPos + tLen : lexP + 1;
  }

  memory.copy(expected_tokens, savedExpectedTokensPtr, _copyLen);
  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  let rootType = getNodeType(acceptedNode);
  if (rootType == NODE_TYPE_ERROR || rootType <= (MAX_TERMINAL_ID as u16)) {
    rootType = NODE_TYPE_ERROR;
  }
  let newRoot = allocNode(rootType, 0, inputLength, 0);
  setNodeFlags(newRoot, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  if (!isMutable(acceptedNode)) {
    acceptedNode = cloneNodeShallow(acceptedNode);
  }
  setFirstChild(newRoot, acceptedNode);
  setNextSibling(acceptedNode, errorNode);
  return newRoot;
}
/**
 * Creates a shallow clone of an AST node (copying its type, padding, length, and env hash).
 * Marks the original node as shared so it isn't mutated in-place by subsequent GLR branches.
 * 
 * @param gc The original node pointer.
 * @returns A new node pointer with the same properties.
 */
export function cloneNodeShallow(gc: u32): u32 {
  if (gc == 0) return 0;
  // Mark the original node as shared so its child list isn't mutated in-place,
  // ruining the clone. We use FLAG_IS_SHARED instead of FLAG_EXTRACTED to avoid
  // confusing `injectStrandedNodes` into thinking the original node is a clone.
  setNodeFlags(gc, getNodeFlags(gc) | FLAG_IS_SHARED);
  let clone = allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc), false, getNodeStartState(gc));
  // Keep FLAG_EXTRACTED on the clone so its shared children are not mutated in-place
  setNodeFlags(clone, (getNodeFlags(gc) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED)); 
  setFirstChild(clone, getNodeFirstChild(gc)); // Keep original children
  return clone;
}
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
      while (child != 0 && sibCount < 50) {
        t_sanitizeStack.push(child);
        child = getNodeNextSibling(child);
        sibCount++;
      }
    }
  }
  while (t_sanitizeStack.length > savedLen) t_sanitizeStack.pop();
  return isPure;
}
/**
 * Helper to shallow-clone the children of `leftNode` and attach them to `p`.
 * Used during list concatenation/appending when mutating `leftNode` in-place is unsafe.
 */
function copyChildren(p: u32, leftNode: u32): u32 {
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  while (gc != 0) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) {
      setNodePadding(clone, 0);
      setFirstChild(p, clone);
    } else {
      setNextSibling(lastChild, clone);
    }
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }
  return lastChild;
}
/**
 * Recalculates the total byte length of a parent node by summing the padding
 * and byte length of all its direct children.
 */
export function fixNodeLength(node: u32): void {
  let gc = getNodeFirstChild(node);
  if (gc == 0) return;

  let firstPad = getNodeLeadingPad(gc);
  let pPad = getNodePadding(node);
  let totalLen = getNodeByteLength(gc);

  if (pPad == 0 && firstPad > 0) {
    setNodePadding(node, firstPad);
  } else if (pPad != 0 && pPad != firstPad) {
    totalLen += firstPad;
  }

  gc = getNodeNextSibling(gc);

  while (gc != 0) {
    totalLen += getNodeLeadingPad(gc) + getNodeByteLength(gc);
    gc = getNodeNextSibling(gc);
  }
  
  setNodeByteLength(node, totalLen);
}

export function fixNodeLengthRecursive(node: u32): void {
  if (node == 0) return;
  if (changetype<usize>(t_sanitizeStack) == 0) {
    t_sanitizeStack = createChunkedUint32Array(50000);
    t_sanitizeVisited = createChunkedUint32Array(50000);
  } else {
    t_sanitizeStack.clear();
    t_sanitizeVisited.clear();
  }

  // Pass 1: Post-order traversal setup using Stack 1 & Stack 2
  t_sanitizeStack.push(node);

  while (t_sanitizeStack.length > 0) {
    let curr = t_sanitizeStack.pop();
    if (curr == 0) continue;
    t_sanitizeVisited.push(curr);

    let child = getNodeFirstChild(curr);
    while (child != 0) {
      if (g_oldTree == 0 || isNodeGen2(child)) {
        t_sanitizeStack.push(child);
      }
      child = getNodeNextSibling(child);
    }
  }

  // Pass 2: Process nodes bottom-up (children before parents)
  while (t_sanitizeVisited.length > 0) {
    let curr = t_sanitizeVisited.pop();
    if (curr != 0) {
      fixNodeLength(curr);
    }
  }
}
/**
 * Measures the nested list depth of a node for a specific list symbol.
 * E.g., `StatementList -> StatementList Statement` is a left-recursive list.
 */
export function getListDepth(node: u32, listSym: u16): u32 {
  let depth: u32 = 0;
  let curr = node;
  while (getNodeType(curr) == listSym && (getNodeFlags(curr) & FLAG_IS_LIST) != 0) {
    depth++;
    if (depth > (MAX_AST_TRAVERSAL_DEPTH as u32)) return depth; // Safety cap for corrupted trees
    let child = getNodeFirstChild(curr);
    if (child == 0) return depth;
    curr = child;
  }
  return depth;
}
/**
 * Gets the number of direct children in a list node.
 */
function getListChildCount(node: u32, listSym: u16): u32 {
  if (getNodeType(node) != listSym || (getNodeFlags(node) & FLAG_IS_LIST) == 0) return 0;
  let count = 0;
  let child = getNodeFirstChild(node);
  while (child != 0) {
    count++;
    child = getNodeNextSibling(child);
  }
  return count;
}

let _listRecurDepth: u32 = 0;
let appendListCalls = 0;

/**
 * Concatenates two AST nodes into a single list of type `listSym`.
 * Extremely complex logic handles flattening uneven trees and splitting
 * trees that exceed `LIST_MAX_CHILDREN` (to ensure operations on the AST 
 * remain O(log N) instead of O(N) when scanning siblings).
 */
export function concatLists(leftNode: u32, rightNode: u32, listSym: u16, envHash: u32): u32 {
  _listRecurDepth++;
  // Cycle detection guard
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode); // bail: cycle detected
  }

  if (listSym == 0) {
    listSym = getNodeType(leftNode) != 0 ? getNodeType(leftNode) : getNodeType(rightNode);
  }
  if (listSym > (MAX_TERMINAL_ID as u16) && listSym < (prod_is_list.length as u16)) {
    if (prod_is_list[listSym] != 1) {
      listSym = 0; // Prevent non-list structural symbols (Equation/Decl) from creating phantom wrapper nodes
    }
  }

  if (leftNode == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode);
  }
  if (rightNode == 0) {
    _listRecurDepth--;
    return cloneNodeShallow(leftNode);
  }

  if (getNodeByteLength(leftNode) == 0 && getNodeType(leftNode) > (MAX_TERMINAL_ID as u16)) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode);
  }
  if (getNodeByteLength(rightNode) == 0 && getNodeType(rightNode) > (MAX_TERMINAL_ID as u16)) {
    _listRecurDepth--;
    return cloneNodeShallow(leftNode);
  }

  let lFlags = getNodeFlags(leftNode);
  let rFlags = getNodeFlags(rightNode);
  let combinedErrorFlag = (lFlags | rFlags) & FLAG_HAS_ERROR;

  // If the left node is not already a list, wrap it in an invisible list node
  if ((lFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), getNodeByteLength(leftNode), envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | (lFlags & FLAG_HAS_ERROR));
    let cloneLeft = cloneNodeShallow(leftNode);
    setNodePadding(cloneLeft, 0);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, 0);
    leftNode = p;
    lFlags = getNodeFlags(leftNode);
  }

  // If the right node is not already a list, wrap it in an invisible list node
  if ((rFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(rightNode), getNodeByteLength(rightNode), envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | (rFlags & FLAG_HAS_ERROR));
    let cloneRight = cloneNodeShallow(rightNode);
    setNodePadding(cloneRight, 0);
    setFirstChild(p, cloneRight);
    setNextSibling(cloneRight, 0);
    rightNode = p;
    rFlags = getNodeFlags(rightNode);
  }

  let lDepth = getListDepth(leftNode, listSym);
  let rDepth = getListDepth(rightNode, listSym);
  let lChildCount = getListChildCount(leftNode, listSym);
  let lDirectChildCount = 0;
  let ldTemp = getNodeFirstChild(leftNode);
  while (ldTemp != 0) {
    lDirectChildCount++;
    ldTemp = getNodeNextSibling(ldTemp);
  }

  // Balance depths before merging
  if (lDepth < rDepth) {
    while (lDepth < rDepth) {
      let wrap = allocNode(listSym, getNodePadding(leftNode), getNodeByteLength(leftNode), envHash);
      setNodeFlags(wrap, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
      let cloneLeft = cloneNodeShallow(leftNode);
      setNodePadding(cloneLeft, 0);
      setFirstChild(wrap, cloneLeft);
      setNextSibling(cloneLeft, 0);
      leftNode = wrap;
      lDepth++;
      lChildCount = 1;
      lDirectChildCount = 1;
    }
  }

  // If the trees are at the same depth, attempt to merge their children
  if (lDepth == rDepth) {
    let rChildCount = getListChildCount(rightNode, listSym);
    let rDirectChildCount = 0;
    let rdTemp = getNodeFirstChild(rightNode);
    while (rdTemp != 0) {
      rDirectChildCount++;
      rdTemp = getNodeNextSibling(rdTemp);
    }

    // Strategy A: If merging keeps the child count under the threshold, merge them flat
    if (lDirectChildCount + rDirectChildCount < LIST_MAX_CHILDREN) {
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
      let lastChild = copyChildren(p, leftNode);
      let rc = getNodeFirstChild(rightNode);
      let isFirstRightChild = true;
      while (rc != 0) {
        let clone = cloneNodeShallow(rc);
        if (isFirstRightChild) {
           setNodePadding(clone, getNodePadding(clone) + getNodePadding(rightNode));
           isFirstRightChild = false;
        }
        if (lastChild == 0) {
           setNodePadding(p, getNodePadding(p) + getNodePadding(clone));
           setNodePadding(clone, 0);
           setFirstChild(p, clone);
        } else {
           setNextSibling(lastChild, clone);
        }
        setNextSibling(clone, 0);
        lastChild = clone;
        rc = getNodeNextSibling(rc);
      }
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      // Strategy B: Over threshold. Split the children evenly into two new sibling list nodes.
      let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let cloneLeft = allocNode(listSym, 0, 0, envHash);
      setNodeFlags(cloneLeft, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let cloneRight = allocNode(listSym, 0, 0, envHash); // Initialize with 0 padding
      setNodeFlags(cloneRight, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let total = lDirectChildCount + rDirectChildCount;
      let leftHalf = total > 1 ? total / 2 : 1;

      let gc = getNodeFirstChild(leftNode);
      let rc = getNodeFirstChild(rightNode);
      let isFirstRight = true;

      let lastChild = 0;
      for (let i = 0; i < (leftHalf as i32); i++) {
        let curr: u32 = 0;
        let pAdd: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          if (isFirstRight) {
             pAdd = getNodePadding(rightNode);
             isFirstRight = false;
          }
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        setNodePadding(clone, getNodePadding(clone) + pAdd);

        if (lastChild == 0) {
           setNodePadding(p, getNodePadding(p) + getNodePadding(clone));
           setNodePadding(clone, 0);
           setFirstChild(cloneLeft, clone);
        } else {
           setNextSibling(lastChild, clone);
        }
        
        setNextSibling(clone, 0);
        lastChild = clone;
      }
      fixNodeLength(cloneLeft);

      lastChild = 0;
      for (let i = leftHalf as i32; i < (total as i32); i++) {
        let curr: u32 = 0;
        let pAdd: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          if (isFirstRight) {
             pAdd = getNodePadding(rightNode);
             isFirstRight = false;
          }
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        setNodePadding(clone, getNodePadding(clone) + pAdd);

        if (lastChild == 0) {
           setNodePadding(cloneRight, getNodePadding(clone)); // Transfer padding to cloneRight
           setNodePadding(clone, 0);
           setFirstChild(cloneRight, clone);
        } else {
           setNextSibling(lastChild, clone);
        }
        
        setNextSibling(clone, 0);
        lastChild = clone;
      }
      fixNodeLength(cloneRight);

      setFirstChild(p, cloneLeft);
      setNextSibling(cloneLeft, cloneRight);
      setNextSibling(cloneRight, 0);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    }
  }
  // ------------------------------------------------------------------------
  // Asymmetrical Trees: lDepth > rDepth
  // ------------------------------------------------------------------------
  // If the left tree is deeper, we drill down into the rightmost branch
  // of the left tree and recursively concatenate the right tree there.
  let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  for (let i = 0; i < lDirectChildCount - 1; i++) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) setFirstChild(p, clone);
    else setNextSibling(lastChild, clone);
    setNextSibling(clone, 0);
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }

  let rightMost = gc;
  let newRightMost = concatLists(rightMost, rightNode, listSym, envHash);

  let nrDepth = getListDepth(newRightMost, listSym);
  if (nrDepth == lDepth) {
    let origC1 = getNodeFirstChild(newRightMost);
    let origC2 = origC1 != 0 ? getNodeNextSibling(origC1) : 0; // B5 fix: null check

    let c1 = cloneNodeShallow(origC1);
    let c2 = origC2 != 0 ? cloneNodeShallow(origC2) : 0; // B5 fix: null check

    if (lDirectChildCount < LIST_MAX_CHILDREN) {
      if (lastChild == 0) setFirstChild(p, c1);
      else setNextSibling(lastChild, c1);
      if (c2 != 0) setNextSibling(c1, c2);
      if (c2 != 0) setNextSibling(c2, 0);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    } else {
      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
      setNodeFlags(newRightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
      
      // p is the first child of superP, so it should not duplicate superP's padding!
      setNodePadding(p, 0);

      let gc2 = getNodeFirstChild(leftNode);
      let lastChild2 = 0;
      for (let i = 0; i < LIST_SPLIT_POINT; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(p, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      fixNodeLength(p);

      lastChild2 = 0;
      for (let i = LIST_SPLIT_POINT; i < lDirectChildCount - 1; i++) {
        let clone = cloneNodeShallow(gc2);
        if (lastChild2 == 0) setFirstChild(newRightChunk, clone);
        else setNextSibling(lastChild2, clone);
        setNextSibling(clone, 0);
        lastChild2 = clone;
        gc2 = getNodeNextSibling(gc2);
      }
      if (lastChild2 == 0) setFirstChild(newRightChunk, c1);
      else setNextSibling(lastChild2, c1);
      if (c2 != 0) {
        setNextSibling(c1, c2);
        setNextSibling(c2, 0);
      } else {
        setNextSibling(c1, 0);
      }
      fixNodeLength(newRightChunk);

      setFirstChild(superP, p);
      setNextSibling(p, newRightChunk);
      setNextSibling(newRightChunk, 0);
      fixNodeLength(superP);
      _listRecurDepth--;
      return superP;
    }
  } else {
    if (lastChild == 0) setFirstChild(p, newRightMost);
    else setNextSibling(lastChild, newRightMost);
    setNextSibling(newRightMost, 0);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }
}
/**
 * Determines whether an AST node can be mutated in-place safely.
 * Returns false if in GLR mode (where subtrees are shared across heads),
 * if the node was extracted/shared, or if it belongs to an older incremental generation.
 */
function isMutable(ptr: u32): boolean {
  // In GLR mode (multiple active heads), never mutate in-place:
  // shared list nodes can be referenced by multiple heads, and
  // mutating one corrupts the others' trees.
  // Note: The current head is popped from the queue during evaluation,
  // so if activeHeadsCount > 0, it means there is at least one OTHER head.
  if (activeHeadsCount > 0) return false;
  if ((getNodeFlags(ptr) & (FLAG_EXTRACTED | FLAG_IS_SHARED)) != 0) return false;
  return isNodeGen2(ptr);
}
/**
 * Appends a single leaf node to a list node of type `listSym`.
 * Tries to perform an in-place mutation if `leftNode` is mutable and has room.
 * Otherwise, clones the list structure to safely append without disturbing shared branches.
 */
export function appendToList(leftNode: u32, leafOrig: u32, listSym: u16, envHash: u32, isBoundary: boolean = true): u32 {
  let combinedErrorFlag = (getNodeFlags(leftNode) | getNodeFlags(leafOrig)) & FLAG_HAS_ERROR;
  appendListCalls++;
  _listRecurDepth++;
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    return isMutable(leafOrig) ? leafOrig : cloneNodeShallow(leafOrig); // bail: cycle detected
  }

  let leaf = isMutable(leafOrig) ? leafOrig : cloneNodeShallow(leafOrig);
  setNextSibling(leaf, 0);

  if (leftNode == 0) {
    _listRecurDepth--;
    return leaf;
  }

  let leftFlags = getNodeFlags(leftNode);
  if ((leftFlags & FLAG_IS_LIST) == 0) {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
    let cloneLeft = isMutable(leftNode) ? leftNode : cloneNodeShallow(leftNode);
    setNodePadding(cloneLeft, 0);
    setFirstChild(p, cloneLeft);
    setNextSibling(cloneLeft, leaf);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
  }

  let lDepth = getListDepth(leftNode, listSym);
  let directChildCount: i32 = 0;
  let ldTemp = getNodeFirstChild(leftNode);
  let lastDirectChild: u32 = 0;
  while (ldTemp != 0) {
    directChildCount++;
    lastDirectChild = ldTemp;
    ldTemp = getNodeNextSibling(ldTemp);
  }

    if (isBoundary) {
      setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_LIST_BOUNDARY);
    }

    if (directChildCount < LIST_MAX_CHILDREN || !isBoundary) {
      if (isMutable(leftNode)) {
        if (lastDirectChild == 0) {
          setNodePadding(leftNode, getNodePadding(leftNode) + getNodePadding(leaf));
          setNodePadding(leaf, 0);
          setFirstChild(leftNode, leaf);
        } else {
          setNextSibling(lastDirectChild, leaf);
        }
        setNextSibling(leaf, 0);
        setNodeFlags(leftNode, getNodeFlags(leftNode) | combinedErrorFlag);
        fixNodeLength(leftNode);
        _listRecurDepth--;
        return leftNode;
      } else {
        let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
        let lastChild = copyChildren(p, leftNode);
        if (lastChild == 0) {
          setNodePadding(p, getNodePadding(p) + getNodePadding(leaf));
          setNodePadding(leaf, 0);
          setFirstChild(p, leaf);
        } else {
          setNextSibling(lastChild, leaf);
        }
        fixNodeLength(p);
        _listRecurDepth--;
        return p;
      }
    } else {
      if (isMutable(leftNode)) {
        let splitTail = getNodeFirstChild(leftNode);
        for (let i = 0; i < LIST_SPLIT_POINT - 1; i++) {
          if (getNodeNextSibling(splitTail) == 0) break;
          splitTail = getNodeNextSibling(splitTail);
        }
        // Advance splitTail until it is a grammatical boundary
        while (getNodeNextSibling(splitTail) != 0 && (getNodeFlags(splitTail) & FLAG_LIST_BOUNDARY) == 0) {
          splitTail = getNodeNextSibling(splitTail);
        }
        
        let splitHead = getNodeNextSibling(splitTail);
        setNextSibling(splitTail, 0); // truncate leftNode
        setNodeFlags(leftNode, getNodeFlags(leftNode) | combinedErrorFlag);
        fixNodeLength(leftNode);

        let rightChunk = allocNode(listSym, getNodePadding(splitHead), 0, envHash);
        setNodeFlags(rightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
        setNodePadding(splitHead, 0); // Avoid double padding!
        setFirstChild(rightChunk, splitHead);

        // Find the last child of rightChunk
        let curr = splitHead;
        while (getNodeNextSibling(curr) != 0) {
          curr = getNodeNextSibling(curr);
        }
        setNextSibling(curr, leaf);
        setNextSibling(leaf, 0);
        fixNodeLength(rightChunk);

        // We still need to return a new parent p containing [leftNode, rightChunk]
        let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
        setNodePadding(leftNode, 0); // Avoid double padding!
        setFirstChild(p, leftNode);
        setNextSibling(leftNode, rightChunk);
        setNextSibling(rightChunk, 0);
        fixNodeLength(p);

        _listRecurDepth--;
        return p;
      } else {
        let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        let cloneLeft = allocNode(listSym, 0, 0, envHash); // Avoid double padding!
        setNodeFlags(cloneLeft, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        let gc = getNodeFirstChild(leftNode);
        let splitTail = gc;
        for (let i = 0; i < LIST_SPLIT_POINT - 1; i++) {
          if (getNodeNextSibling(splitTail) == 0) break;
          splitTail = getNodeNextSibling(splitTail);
        }
        while (getNodeNextSibling(splitTail) != 0 && (getNodeFlags(splitTail) & FLAG_LIST_BOUNDARY) == 0) {
          splitTail = getNodeNextSibling(splitTail);
        }

        let actualSplitCount = 0;
        let curr = gc;
        while (curr != 0) {
          actualSplitCount++;
          if (curr == splitTail) break;
          curr = getNodeNextSibling(curr);
        }

        let lastChild = 0;
        for (let i = 0; i < actualSplitCount; i++) {
          let clone = cloneNodeShallow(gc);
          if (lastChild == 0) setFirstChild(cloneLeft, clone);
          else setNextSibling(lastChild, clone);
          setNextSibling(clone, 0);
          lastChild = clone;
          if (gc == splitTail) {
            gc = getNodeNextSibling(gc);
            break;
          }
          gc = getNodeNextSibling(gc);
        }
        fixNodeLength(cloneLeft);

        let splitHead = gc;
        let rightChunk = allocNode(listSym, getNodePadding(splitHead), 0, envHash);
        setNodeFlags(rightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        lastChild = 0;
        while (gc != 0) {
          let clone = cloneNodeShallow(gc);
          if (lastChild == 0) {
            setNodePadding(clone, 0); // Avoid double padding!
            setFirstChild(rightChunk, clone);
          } else {
            setNextSibling(lastChild, clone);
          }
          setNextSibling(clone, 0);
          lastChild = clone;
          gc = getNodeNextSibling(gc);
        }
        if (lastChild == 0) setFirstChild(rightChunk, leaf);
        else setNextSibling(lastChild, leaf);
        setNextSibling(leaf, 0);
        fixNodeLength(rightChunk);

        setFirstChild(p, cloneLeft);
        setNextSibling(cloneLeft, rightChunk);
        setNextSibling(rightChunk, 0);
        fixNodeLength(p);
        _listRecurDepth--;
        return p;
      }
    }

  _listRecurDepth--;
  return leftNode;
}




/**
 * Prepares the parser engine for simulated lookahead during error recovery.
 * @param targetCost The cost threshold for the simulation.
 * @param maxTokens The maximum number of tokens to simulate.
 */
export function resetSimulator(targetCost: i32, maxTokens: i32): void {
  bestAcceptingHead = 0;
  bestAcceptedCost = targetCost;
  g_simulatorMaxCost = targetCost;
  g_simulatorMaxTokens = maxTokens;
  tokenBufferReadIdx = 0;
  tokenBufferWriteIdx = 0;
}

let savedLexPos: u32 = 0;
let savedLexLen: u32 = 0;
let savedSrcLexPos: u32 = 0;
let savedCurrentScannerState: i32 = 0;
let savedTokenBufferReadIdx: u32 = 0;
let savedTokenBufferWriteIdx: u32 = 0;
let savedTokenBufferLastPos: u32 = 0;
let savedExpectedTokens = changetype<UnmanagedUint8Array>(atomicChunkAlloc(65536));

let savedSimulatorMaxCost: i32 = 999999;
let savedSimulatorMaxTokens: i32 = 0;
let savedBestAcceptingHead: u32 = 0;
let savedAcceptedNode: u32 = 0;
let savedBestAcceptedCost: i32 = 999999;
let savedBestAcceptedRealBytes: u32 = 0;
let savedBestAcceptedCount: u32 = 0xffffffff;
let savedBestAcceptedPad: u32 = 0xffffffff;

/**
 * Checkpoints the global parser state (lexer pos, buffer, costs, best head)
 * before running speculative simulation branches.
 */
export function saveSimulationState(): void {
  savedLexPos = lexPos;
  savedLexLen = lexLen;
  savedSrcLexPos = srcLexPos;
  savedCurrentScannerState = currentScannerState;
  savedTokenBufferReadIdx = tokenBufferReadIdx;
  savedTokenBufferWriteIdx = tokenBufferWriteIdx;
  savedTokenBufferLastPos = tokenBufferLastPos;
  savedSimulatorMaxCost = g_simulatorMaxCost;
  savedSimulatorMaxTokens = g_simulatorMaxTokens;
  
  savedBestAcceptingHead = bestAcceptingHead;
  savedAcceptedNode = acceptedNode;
  savedBestAcceptedCost = bestAcceptedCost;
  savedBestAcceptedRealBytes = bestAcceptedRealBytes;
  savedBestAcceptedCount = bestAcceptedCount;
  savedBestAcceptedPad = bestAcceptedPad;

  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  memory.copy(changetype<usize>(savedExpectedTokens), changetype<usize>(expected_tokens), copyLen);
}

/**
 * Restores the global parser state from the checkpoint after a simulation completes.
 */
export function restoreSimulationState(): void {
  setLexPos(savedLexPos);
  setLexLen(savedLexLen);
  setSrcLexPos(savedSrcLexPos);
  setCurrentScannerState(savedCurrentScannerState);
  tokenBufferReadIdx = savedTokenBufferReadIdx;
  tokenBufferWriteIdx = savedTokenBufferWriteIdx;
  tokenBufferLastPos = savedTokenBufferLastPos;
  g_simulatorMaxCost = savedSimulatorMaxCost;
  g_simulatorMaxTokens = savedSimulatorMaxTokens;
  
  bestAcceptingHead = savedBestAcceptingHead;
  acceptedNode = savedAcceptedNode;
  bestAcceptedCost = savedBestAcceptedCost;
  bestAcceptedRealBytes = savedBestAcceptedRealBytes;
  bestAcceptedCount = savedBestAcceptedCount;
  bestAcceptedPad = savedBestAcceptedPad;

  let copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (copyLen > 65536) copyLen = 65536;
  memory.copy(changetype<usize>(expected_tokens), changetype<usize>(savedExpectedTokens), copyLen);
}
/**
 * Retrieves the best accepting head found so far.
 */
export function getBestAcceptingHead(): u32 {
  return bestAcceptingHead;
}
export let furthestDyingPos: u32 = 0;
export let bestDyingHead: u32 = 0;
export let bestAcceptingHead: u32 = 0;
export let acceptedNode: u32 = 0;
export let bestAcceptedCost: i32 = 999999;
export let bestAcceptedRealBytes: u32 = 0;
export let bestAcceptedCount: u32 = 0xffffffff;
export let bestAcceptedPad: u32 = 0xffffffff;

export let g_simulatorMaxTokens: i32 = 0;
export let g_simulatorMaxCost: i32 = 999999;
export let g_configIslandMode: boolean = true;

/**
 * Processes a SHIFT action in the GLR parser.
 * A SHIFT action consumes a token and pushes it onto the GSS.
 * 
 * @param head The current parsing head.
 * @param target The target state to transition to.
 * @param token The token ID being shifted.
 * @param pos The current byte offset in the input stream.
 * @param isVirtual True if the token is hallucinated by error recovery.
 * @param cameFromVirtualQueue True if the token was pulled from the virtual queue.
 */
function processShiftAction(head: ParseHead, target: i32, token: i32, pos: u32, isVirtual: boolean, cameFromVirtualQueue: boolean): void {
  let newBalance = head.balanceHash;
  let charLen = peekCharLen(lexPos);
  if (lexLen == charLen) {
    let c = peekChar(lexPos);
    if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
    else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) newBalance--;
  }

  let paddingLength: u32 = 0;
  let leafLen: u32 = 0;
  if (!isVirtual) {
    paddingLength = head.pendingPadding + (srcLexPos > pos ? srcLexPos - pos : 0);
    leafLen = lexLen;
  }

  let leaf = allocNode(token as u16, paddingLength, leafLen, newBalance & 0xff, false, head.state as u32);
  if (isVirtual) {
    setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_IS_INSERTED | FLAG_HAS_ERROR);
  }

  let nextPos = isVirtual ? pos : srcLexPos + lexLen;
  let nPos = isVirtual ? pos : (nextPos > pos ? nextPos : pos + 1);
  let shiftScannerState = isVirtual ? head.scannerState : currentScannerState;
  let newCost = head.errorCost;
  let newShifts = head.successfulShifts + 1;
  let nextConsecutive = isVirtual ? head.consecutiveInsertions : 0;
  let nextPendingPad = isVirtual ? head.pendingPadding : 0;

  let newHead = allocParseHead(
    target, leaf, head, nPos, shiftScannerState, newCost, newShifts, newBalance, nextConsecutive, head.dynamicPrec, nextPendingPad, head.errorTail
  );

  pushNextHead(changetype<u32>(newHead));
}


/**
 * Processes a REDUCE action in the GLR parser.
 * Pops nodes off the GSS stack according to the production length, groups them
 * under a new non-terminal parent node, and shifts the parent node into the 
 * state returned by the GOTO table.
 * 
 * @param head The current parsing head.
 * @param reduceProd The index of the production rule to reduce.
 * @param pos The current byte offset in the input stream.
 * @returns True if a valid GOTO transition was found, false if the path is dead.
 */
function constructReducedParentNode(
  lhsSym: i32,
  reduceProd: i32,
  childNodes: UnmanagedInt32Array,
  childOffset: i32,
  actualCount: i32,
  bottomState: i32,
  balanceHash: u32,
  isFragile: bool
): u32 {
  let totalByteLength: u32 = 0;
  let firstChildPadding: u32 = 0;
  if (actualCount > 0) {
    firstChildPadding = getNodeLeadingPad(childNodes[childOffset]);
    for (let k = 0; k < actualCount; k++) {
      let cPadding = getNodeLeadingPad(childNodes[childOffset + k]);
      let cLen = getNodeByteLength(childNodes[childOffset + k]);
      if (k == 0) totalByteLength += cLen;
      else totalByteLength += cPadding + cLen;
    }
  }
  let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, balanceHash & 0xff, false, bottomState as u32);

  if (prod_is_list[reduceProd] == 1) {
    let flags = getNodeFlags(parentNode);
    setNodeFlags(parentNode, flags | FLAG_IS_LIST);
  }
  if (prod_is_invisible[reduceProd] == 1) {
    let flags = getNodeFlags(parentNode);
    setNodeFlags(parentNode, flags | FLAG_INVISIBLE);
  }
  if (isFragile) {
    let flags = getNodeFlags(parentNode);
    setNodeFlags(parentNode, flags | FLAG_FRAGILE);
  }

  if (actualCount > 0) {
    let isListAppend = false;
    let popCount = prod_lengths[reduceProd];
    if (
      (popCount == 2 || popCount == 3) &&
      actualCount >= popCount &&
      childNodes[childOffset] != 0 &&
      prod_is_list[reduceProd] == 1
    ) {
      let leftSym = getNodeType(childNodes[childOffset]);
      if (leftSym == lhsSym) isListAppend = true;
    }

    if (isListAppend) {
      parentNode = childNodes[childOffset];
      for (let i = 1; i < actualCount; i++) {
        parentNode = appendToList(
          parentNode,
          childNodes[childOffset + i],
          lhsSym as u16,
          currentScannerState,
          i == actualCount - 1
        );
      }
      setNodeStartState(parentNode, bottomState as u32);
      if (isFragile) {
        setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_FRAGILE);
      }
    } else {
      let lastChild = 0;
      let logicalChildIndex = 0;

      let aliasPtr = prod_aliases[reduceProd];
      let aliasCount = 0;
      if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

      for (let k = 0; k < actualCount; k++) {
        let child = childNodes[childOffset + k];
        if (child == 0) continue;

        let clone = cloneNodeShallow(child);
        if (k == 0) {
          setNodePadding(clone, 0);
        }

        let isError = getNodeType(child) == NODE_TYPE_ERROR || (getNodeType(child) & 0x8000) != 0;
        if (!isError && aliasPtr >= 0) {
          for (let a = 0; a < aliasCount; a++) {
            let aIndex = alias_data[aliasPtr + 1 + a * 2];
            let aSym = alias_data[aliasPtr + 1 + a * 2 + 1];
            if (aIndex == logicalChildIndex) {
              let node = changetype<ASTNode>(clone);
              node.type = aSym as u16;
              break;
            }
          }
          logicalChildIndex++;
        } else if (!isError) {
          logicalChildIndex++;
        }

        if (lastChild == 0) setFirstChild(parentNode, clone);
        else setNextSibling(lastChild, clone);
        lastChild = clone;
        if (isError || (getNodeFlags(child) & FLAG_HAS_ERROR) != 0) {
          setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_HAS_ERROR);
        }
      }
    }
  }
  return parentNode;
}

const MAX_POP_PATHS: i32 = 32; // D6 fix: increased from 8 to handle complex grammars
const MAX_POP_DEPTH: i32 = 32;

let t_popPathNodes: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_popPathBottomHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_popPathNodeCounts: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_popDfsNodes: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_breakdownChildren: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let g_popPathCount: i32 = 0;

function initPopPathBuffers(): void {
  if (changetype<usize>(t_popPathNodes) == 0) {
    t_popPathNodes = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_PATHS * MAX_POP_DEPTH * 4));
    t_popPathBottomHeads = changetype<UnmanagedUint32Array>(heap.alloc(MAX_POP_PATHS * 4));
    t_popPathNodeCounts = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_PATHS * 4));
    t_popDfsNodes = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_DEPTH * 4));
    t_breakdownChildren = changetype<UnmanagedUint32Array>(heap.alloc(128 * 4));
  }
}

function recordPopPath(bottomHead: ParseHead, depth: i32): void {
  if (g_popPathCount >= MAX_POP_PATHS) return;
  let bPtr = changetype<u32>(bottomHead);
  for (let p = 0; p < g_popPathCount; p++) {
    if (t_popPathBottomHeads[p] == bPtr && t_popPathNodeCounts[p] == depth) {
      let same = true;
      let off = p * MAX_POP_DEPTH;
      for (let d = 0; d < depth; d++) {
        if (t_popPathNodes[off + d] != t_popDfsNodes[depth - 1 - d]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
  }
  let idx = g_popPathCount++;
  t_popPathBottomHeads[idx] = bPtr;
  t_popPathNodeCounts[idx] = depth;
  let off = idx * MAX_POP_DEPTH;
  for (let d = 0; d < depth; d++) {
    t_popPathNodes[off + d] = t_popDfsNodes[depth - 1 - d];
  }
}

function dfsPopPaths(
  curr: ParseHead | null,
  needed: i32,
  isList: bool,
  depth: i32
): void {
  if (g_popPathCount >= MAX_POP_PATHS) return;
  if (curr == null) return;
  if (depth >= MAX_POP_DEPTH) return;

  let astNode = curr.astNode;
  let isPure = astNode != 0 && isPureErrorNode(astNode);
  let nextNeeded = needed;
  if (!isPure && nextNeeded > 0) {
    nextNeeded--;
  }
  t_popDfsNodes[depth] = astNode as i32;
  let nextDepth = depth + 1;

  let currPrev = curr.prev;
  if (nextNeeded == 0 && (!isList || currPrev == null || currPrev.astNode == 0 || !isPureErrorNode(currPrev.astNode))) {
    if (currPrev != null) {
      recordPopPath(currPrev, nextDepth);
    }
    let edgePtr = curr.firstEdge;
    while (edgePtr != 0 && g_popPathCount < MAX_POP_PATHS) {
      let edge = changetype<GssEdge>(edgePtr);
      let target = edge.targetHead;
      if (target != null) {
        let savedNode = t_popDfsNodes[depth];
        if (edge.astNode != 0) {
          t_popDfsNodes[depth] = edge.astNode as i32;
        }
        recordPopPath(target, nextDepth);
        t_popDfsNodes[depth] = savedNode;
      }
      edgePtr = edge.nextEdge;
    }
    return;
  }

  // Traverse primary predecessor curr.prev
  if (currPrev != null) {
    dfsPopPaths(currPrev, nextNeeded, isList, nextDepth);
  }

  // Traverse alternative predecessors curr.firstEdge
  let edgePtr = curr.firstEdge;
  while (edgePtr != 0 && g_popPathCount < MAX_POP_PATHS) {
    let edge = changetype<GssEdge>(edgePtr);
    let target = edge.targetHead;
    if (target != null) {
      let savedNode = t_popDfsNodes[depth];
      if (edge.astNode != 0) {
        t_popDfsNodes[depth] = edge.astNode as i32;
      }
      dfsPopPaths(target, nextNeeded, isList, nextDepth);
      t_popDfsNodes[depth] = savedNode;
    }
    edgePtr = edge.nextEdge;
  }
}

/**
 * Executes a REDUCE action on the given head for the specified production rule.
 * Operates across single linear chains as well as branched GSS DAG diamonds for any popCount.
 */
function processReduceAction(head: ParseHead, reduceProd: i32, pos: u32, isConflict: bool = false): ParseHead | null {
  if (reduceProd < 0 || reduceProd >= prod_lengths.length) {
    throw new Error("BAD reduceProd: " + reduceProd.toString());
  }

  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  let isList = prod_is_list[reduceProd] == 1;

  if (popCount == 0) {
    let curr = head;
    if (curr.state < 0 || curr.state >= goto_offsets.length) return null;
    let gOffset = goto_offsets[curr.state];
    if (gOffset < 0 || gOffset >= goto_data.length) return null;
    let gCount = goto_data[gOffset];
    let nextState = -1;
    let gIdx = gOffset + 1;
    for (let k = 0; k < gCount; k++) {
      if (goto_data[gIdx++] == lhsSym) {
        nextState = goto_data[gIdx++];
        break;
      } else {
        gIdx++;
      }
    }
    if (nextState == -1) return null;
    let isFragile = isConflict;
    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_globalChildNodes, 0, 0, curr.state, head.balanceHash, isFragile);
    return allocParseHead(
      nextState, parentNode, curr, head.pos, 0, head.errorCost,
      head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
      head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
    );
  }

  // Fast-path: traverse linear chain and check if any node has firstEdge != 0
  let curr: ParseHead | null = head;
  // v5 fix: use MAX_CHILD_NODES - 1 instead of 99999 to stay within allocated bounds
  let c_idx: i32 = (MAX_CHILD_NODES as i32) - 1;
  let needed = popCount;
  let hasMultiLink = false;

  while ((needed > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
    if (c_idx <= 0) break;
    if (curr.firstEdge != 0) hasMultiLink = true;
    let astNode = curr.astNode;
    let isPure = astNode != 0 && isPureErrorNode(astNode);
    if (isPure) {
      t_globalReduceCollected[c_idx--] = astNode;
    } else {
      t_globalReduceCollected[c_idx--] = astNode;
      if (needed > 0) needed--;
    }
    curr = curr.prev;
  }
  if (curr == null && needed > 0) {
    return null;
  }

  let actualCount: i32 = (MAX_CHILD_NODES as i32) - 1 - c_idx;
  for (let k: i32 = 0; k < actualCount; k++) {
    t_globalChildNodes[k] = t_globalReduceCollected[c_idx + 1 + k];
  }

  // Case A: Linear path (no DAG diamonds along the pop chain)
  if (!hasMultiLink && curr != null && curr.firstEdge == 0) {
    if (curr.state < 0 || curr.state >= goto_offsets.length) return null;
    let gOffset = goto_offsets[curr.state];
    if (gOffset < 0 || gOffset >= goto_data.length) return null;
    let gCount = goto_data[gOffset];
    let nextState = -1;
    let gIdx = gOffset + 1;
    for (let k = 0; k < gCount; k++) {
      if (goto_data[gIdx++] == lhsSym) {
        nextState = goto_data[gIdx++];
        break;
      } else {
        gIdx++;
      }
    }
    if (nextState == -1) return null;

    let isFragile = isConflict;
    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_globalChildNodes, 0, actualCount, curr.state, head.balanceHash, isFragile);
    return allocParseHead(
      nextState, parentNode, curr, head.pos, 0, head.errorCost,
      head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
      head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
    );
  }

  // Case B: Multi-link path pop across GSS diamonds (Tree-sitter ts_stack_pop_count)
  initPopPathBuffers();
  g_popPathCount = 0;
  dfsPopPaths(head, popCount, isList, 0);

  if (g_popPathCount == 0) return null;

  let primaryHead: ParseHead | null = null;
  let isFragile = true;

  for (let p = 0; p < g_popPathCount; p++) {
    let bHead = changetype<ParseHead>(t_popPathBottomHeads[p]);
    let pCount = t_popPathNodeCounts[p];
    if (bHead == null || bHead.state < 0 || bHead.state >= goto_offsets.length) continue;
    let gOffset = goto_offsets[bHead.state];
    if (gOffset < 0 || gOffset >= goto_data.length) continue;
    let gCount = goto_data[gOffset];
    let pNextState = -1;
    let gIdx = gOffset + 1;
    for (let k = 0; k < gCount; k++) {
      if (goto_data[gIdx++] == lhsSym) {
        pNextState = goto_data[gIdx++];
        break;
      } else {
        gIdx++;
      }
    }
    if (pNextState == -1) continue;

    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_popPathNodes, p * MAX_POP_DEPTH, pCount, bHead.state, head.balanceHash, isFragile);
    let newHead = allocParseHead(
      pNextState, parentNode, bHead, head.pos, 0, head.errorCost,
      head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
      head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
    );

    if (primaryHead == null) {
      primaryHead = newHead;
    } else {
      pushActiveHead(changetype<u32>(newHead));
    }
  }

  return primaryHead;
}

/**
 * Decomposes a reused composite node on top of stack into its constituent children.
 * Mirrors Tree-sitter's ts_parser__breakdown_top_of_stack.
 * If the current lookahead token cannot be accepted and head.astNode was reused from
 * a previous AST, unpacks the immediate children and pushes their stack frames.
 */
function breakdownTopOfStack(head: ParseHead): ParseHead | null {
  let topNode = head.astNode;
  if (topNode == 0) return null;
  let flags = getNodeFlags(topNode);
  if ((flags & FLAG_EXTRACTED) == 0) return null;
  let firstC = getNodeFirstChild(topNode);
  if (firstC == 0) return null;

  initPopPathBuffers();

  let childCount: i32 = 0;
  let c = firstC;
  while (c != 0 && childCount < 128) {
    t_breakdownChildren[childCount++] = c;
    c = getNodeNextSibling(c);
  }
  if (childCount == 0) return null;

  let baseHead = head.prev;
  if (baseHead == null) return null;

  let currHead: ParseHead = baseHead;
  let currState: i32 = baseHead.state;
  let currPos: u32 = baseHead.pos;

  for (let i = 0; i < childCount; i++) {
    let childPtr = t_breakdownChildren[i];
    let childType = getNodeType(childPtr);
    let childByteLen = getNodeByteLength(childPtr);
    let childPad = getNodeLeadingPad(childPtr);
    let nextState = -1;

    if (childType > (MAX_TERMINAL_ID as u16)) {
      if (currState >= 0 && currState < goto_offsets.length) {
        let gOffset = goto_offsets[currState];
        if (gOffset >= 0 && gOffset < goto_data.length) {
          let gCount = goto_data[gOffset];
          let gIdx = gOffset + 1;
          for (let k = 0; k < gCount; k++) {
            if (goto_data[gIdx++] == (childType as i32)) {
              nextState = goto_data[gIdx++];
              break;
            } else {
              gIdx++;
            }
          }
        }
      }
    } else {
      if (currState >= 0 && currState < action_offsets.length) {
        let actOffset = action_offsets[currState];
        if (actOffset >= 0 && actOffset < action_data.length) {
          let actCount = action_data[actOffset];
          let idx = actOffset + 1;
          for (let a = 0; a < actCount; a++) {
            let sym = action_data[idx++];
            let numActions = action_data[idx++];
            if (sym == (childType as i32)) {
              for (let na = 0; na < numActions; na++) {
                let aType = action_data[idx++];
                let aTarget = action_data[idx++];
                if (aType == ACTION_SHIFT) {
                  nextState = aTarget;
                  break;
                }
              }
              break;
            }
            idx += numActions * 2;
          }
        }
      }
    }

    if (nextState == -1) {
      let childStartState = getNodeStartState(childPtr);
      if (childStartState != 0) {
        nextState = childStartState as i32;
      } else {
        return null;
      }
    }

    currPos += childPad + childByteLen;
    // v5 fix: clone child to avoid stale sibling pointers from the reused subtree
    let clonedChild = cloneNodeShallow(childPtr);
    setNextSibling(clonedChild, 0); // Clear stale sibling link
    if (getNodeFirstChild(clonedChild) != 0) {
      setNodeFlags(clonedChild, getNodeFlags(clonedChild) | FLAG_EXTRACTED);
    }
    childPtr = clonedChild;
    let newHead = allocParseHead(
      nextState,
      clonedChild,
      currHead,
      currPos,
      currHead.scannerState,
      currHead.errorCost,
      currHead.successfulShifts + 1,
      currHead.balanceHash,
      0,
      currHead.dynamicPrec,
      0,
      currHead.errorTail
    );
    currHead = newHead;
    currState = nextState;
  }

  return currHead;
}

/**
 * Speculatively determines the target LR state of a reduction without constructing AST nodes
 * or pushing speculative heads into the frontier (eliminating head leaks).
 */
function simulateReduceNextState(head: ParseHead, reduceProd: i32): i32 {
  if (reduceProd < 0 || reduceProd >= prod_lengths.length) return -1;
  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  let isList = prod_is_list[reduceProd] == 1;

  let bottomState = -1;
  if (popCount == 0) {
    bottomState = head.state;
  } else {
    let curr: ParseHead | null = head;
    let needed = popCount;
    while ((needed > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
      let astNode = curr.astNode;
      let isPure = astNode != 0 && isPureErrorNode(astNode);
      if (!isPure) {
        if (needed > 0) needed--;
      }
      curr = curr.prev;
    }
    if (curr == null && needed > 0) return -1;
    if (curr != null) {
      bottomState = curr.state;
    }
  }

  if (bottomState < 0 || bottomState >= goto_offsets.length) return -1;
  let gOffset = goto_offsets[bottomState];
  if (gOffset < 0 || gOffset >= goto_data.length) return -1;
  let gCount = goto_data[gOffset];
  let gIdx = gOffset + 1;
  for (let k = 0; k < gCount; k++) {
    if (goto_data[gIdx++] == lhsSym) {
      return goto_data[gIdx];
    } else {
      gIdx++;
    }
  }
  return -1;
}

/**
 * Performs all lookahead-independent reductions on head before error recovery.
 * Mirrors Tree-sitter's ts_parser__do_all_potential_reductions.
 * Returns the reduced head (or original head if no reductions possible).
 */
function doAllPotentialReductions(head: ParseHead, frontierPos: u32, tok: i32): ParseHead {
  let curr = head;
  let iters = 0;
  while (iters++ < 8) {
    let state = curr.state;
    if (state < 0 || state >= action_offsets.length) break;
    let actionOffset = action_offsets[state];
    if (actionOffset < 0 || actionOffset >= action_data.length) break;

    let actCount = action_data[actionOffset];
    let idx = actionOffset + 1;
    let bestReduce = -1;
    let bestLhs = -1;
    let shiftCandidateReduce = -1;

    for (let a = 0; a < actCount; a++) {
      let sym = action_data[idx++];
      let numActions = action_data[idx++];
      for (let na = 0; na < numActions; na++) {
        let aType = action_data[idx++];
        let aTarget = action_data[idx++];
        if (aType == ACTION_REDUCE) {
          if (aTarget >= 0 && aTarget < prod_lhs.length) {
            let lhs = prod_lhs[aTarget];
            if (lhs > bestLhs || (lhs == bestLhs && aTarget > bestReduce)) {
              bestLhs = lhs;
              bestReduce = aTarget;
            }
            // B7 fix: prioritize reduction that allows the lookahead token to be shifted
            if (shiftCandidateReduce == -1 && tok != TOKEN_EOF) {
              let rhsLen = prod_lengths[aTarget];
              if (!(curr.state == 0 && rhsLen == 0)) {
                let simNextState = simulateReduceNextState(curr, aTarget);
                if (simNextState != -1 && lookupActions(simNextState, tok) > 0) {
                  shiftCandidateReduce = aTarget;
                }
              }
            }
          }
        }
      }
    }

    let chosenReduce = shiftCandidateReduce != -1 ? shiftCandidateReduce : bestReduce;
    if (chosenReduce == -1) break;

    if (curr.state == 0 && prod_lengths[chosenReduce] == 0 && tok != TOKEN_EOF) {
      break;
    }

    let reduced = processReduceAction(curr, chosenReduce, frontierPos);
    if (reduced == null || reduced == curr) break;
    curr = reduced;

    if (lookupActions(curr.state, tok) > 0) {
      break;
    }
  }
  return curr;
}

@inline
function getTailLength(tailPtr: u32): i32 {
  let count = 0;
  let curr = tailPtr;
  while (curr != 0 && count < 100) {
    count++;
    curr = changetype<DiagnosticNode>(curr).next;
  }
  return count;
}

/**
 * Processes an ACCEPT action in the GLR parser.
 * Constructs the final AST from the successful path in the GSS.
 * Calculates an "effective cost" for the accepted tree (penalizing error nodes
 * and fragmented trees) and updates `bestAcceptingHead` if this is the best so far.
 * 
 * @param head The accepting parse head.
 */
function processAcceptAction(head: ParseHead): void {
  let t_curr: ParseHead | null = head;
  let t_bytes: u32 = 0;
  let t_count: u32 = 0;
  let firstPad: u32 = 0;

  while (t_curr) {
    if (t_curr.astNode != 0) {
      let tNodeType = getNodeType(t_curr.astNode);
      let tNodeLen = getNodeByteLength(t_curr.astNode);
      if (tNodeType != TOKEN_EOF && (tNodeLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
        t_bytes += getNodePadding(t_curr.astNode) + tNodeLen;
        t_count++;
        firstPad = getNodePadding(t_curr.astNode);
      }
    }
    t_curr = t_curr.prev;
  }

  let effectiveCost: i32 = head.errorCost;
  let shiftDiscount: i32 = (head.successfulShifts as i32) * 15;
  if (shiftDiscount > effectiveCost) effectiveCost = 0; else effectiveCost -= shiftDiscount;
  let realBytes: u32 = 0;
  {
    let rc: ParseHead | null = head;
    while (rc) {
      if (rc.astNode != 0) {
        let nType = getNodeType(rc.astNode);
        if (nType != TOKEN_EOF && nType != NODE_TYPE_ERROR) {
          realBytes += getNodeByteLength(rc.astNode);
        }
      }
      rc = rc.prev;
    }
  }

  if (realBytes > inputLength) realBytes = inputLength;
  let unparsedBytes: u32 = inputLength > realBytes ? inputLength - realBytes : 0;
  effectiveCost += (unparsedBytes as i32) * 20;
  // firstPad should not penalize error cost

  let curHasError = acceptedNode != 0 && (getNodeFlags(acceptedNode) & FLAG_HAS_ERROR) != 0;
  let newHasError = head.astNode != 0 && (getNodeFlags(head.astNode) & FLAG_HAS_ERROR) != 0;
  let errorBetter = curHasError && !newHasError && effectiveCost <= bestAcceptedCost;

  let curIsInserted = acceptedNode != 0 && (getNodeFlags(acceptedNode) & FLAG_IS_INSERTED) != 0;
  let newIsInserted = head.astNode != 0 && (getNodeFlags(head.astNode) & FLAG_IS_INSERTED) != 0;
  let insertedBetter = curIsInserted && !newIsInserted && effectiveCost <= bestAcceptedCost;

  let curTailLen = acceptedNode != 0 && bestAcceptingHead != 0 ? getTailLength(changetype<ParseHead>(bestAcceptingHead).errorTail) : 999;
  let newTailLen = getTailLength(head.errorTail);
  let tailBetter = newTailLen < curTailLen && effectiveCost <= bestAcceptedCost;

  if (g_simulatorMaxTokens == 0 && (
    acceptedNode == 0 ||
    effectiveCost < bestAcceptedCost ||
    errorBetter ||
    insertedBetter ||
    tailBetter ||
    (effectiveCost == bestAcceptedCost && realBytes > bestAcceptedRealBytes) ||
    (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad < bestAcceptedPad) ||
    (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad == bestAcceptedPad && t_count > bestAcceptedCount)
  )) {
    if (t_count <= 1) {
      bestAcceptingHead = changetype<u32>(head);
      bestAcceptedCost = effectiveCost;
      bestAcceptedRealBytes = realBytes;
      bestAcceptedCount = t_count;
      bestAcceptedPad = firstPad;
      lastBestCost = bestAcceptedCost;

      let singleNode: u32 = 0;
      let rc: ParseHead | null = head;
      while (rc) {
        if (rc.astNode != 0 && getNodeType(rc.astNode) != TOKEN_EOF) {
          let t = getNodeType(rc.astNode);
          if (singleNode == 0) {
            singleNode = rc.astNode;
          } else if (t >= 256 && getNodeType(singleNode) < 256) {
            singleNode = rc.astNode;
          }
        }
        rc = rc.prev;
      }

      if (singleNode != 0) {
        acceptedNode = cloneNodeShallow(singleNode);
        let accPad = getNodePadding(acceptedNode);
        // B3 fix: removed unsafe length mutation — wrapWithTrailingErrors handles any gap
        // let accLen = getNodeByteLength(acceptedNode);
        // let expectedLen = inputLength > accPad ? inputLength - accPad : 0;
        // if (accLen != expectedLen && head.pos >= inputLength) {
        //   setNodeByteLength(acceptedNode, expectedLen);
        // }
      } else {
        acceptedNode = head.astNode;
      }
    } else {
      bestAcceptingHead = changetype<u32>(head);
      bestAcceptedCost = effectiveCost;
      bestAcceptedRealBytes = realBytes;
      bestAcceptedCount = t_count;
      bestAcceptedPad = firstPad;
      lastBestCost = bestAcceptedCost;

      let c_idx: i32 = (t_count as i32) - 1;
      t_curr = head;
      let bestRoot: u32 = 0;
      let bestRootType: u16 = 65535;
      while (t_curr && c_idx >= 0) {
        if (t_curr.astNode != 0) {
          let cType = getNodeType(t_curr.astNode);
          let cLen = getNodeByteLength(t_curr.astNode);
          if (cType != TOKEN_EOF && (cLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
            t_globalChildren[c_idx] = t_curr.astNode;
            c_idx--;
            let isNonTerminal = cType > (MAX_TERMINAL_ID as u16);
            if (cType != NODE_TYPE_ERROR && isNonTerminal && cType < bestRootType) {
              bestRoot = t_curr.astNode;
              bestRootType = cType;
            }
          }
        }
        t_curr = t_curr.prev;
      }

      // Compact valid children to index 0 if any slots were skipped
      let validStart: i32 = c_idx + 1;
      let actualCount: u32 = 0;
      if (validStart > 0 && validStart < (t_count as i32)) {
        for (let i: i32 = validStart; i < (t_count as i32); i++) {
          t_globalChildren[actualCount++] = t_globalChildren[i];
        }
      } else if (validStart <= 0) {
        actualCount = t_count;
      }

      // B2 fix: Use firstPad directly (accurately tracked from the leftmost node during forward pass)
      let firstChildPad = firstPad;
      if (firstChildPad == 0 && actualCount > 0 && t_globalChildren[0] != 0) {
        firstChildPad = getNodePadding(t_globalChildren[0]);
      }
      let targetLen = inputLength > firstChildPad ? inputLength - firstChildPad : 0;
      let newRoot = allocNode((MAX_TERMINAL_ID + 1) as u16, firstChildPad, targetLen, 0);

      let lastC2: u32 = 0;
      let firstCloned: u32 = 0;
      let appendedError = false;

      for (let i: u32 = 0; i < actualCount; i++) {
        let c = t_globalChildren[i];
        if (c == 0) continue;
        let cType = getNodeType(c);
        if (cType == (MAX_TERMINAL_ID + 1) as u16) {
          let innerChild = getNodeFirstChild(c);
          while (innerChild != 0) {
            let clone = cloneNodeShallow(innerChild);
            if (firstCloned == 0) firstCloned = clone;
            if (lastC2 != 0) setNextSibling(lastC2, clone);
            lastC2 = clone;
            if (getNodeType(innerChild) == 0 || (getNodeFlags(innerChild) & FLAG_HAS_ERROR) != 0) {
              appendedError = true;
            }
            innerChild = getNodeNextSibling(innerChild);
          }
        } else {
          let clone = cloneNodeShallow(c);
          if (firstCloned == 0) firstCloned = clone;
          if (lastC2 != 0) setNextSibling(lastC2, clone);
          lastC2 = clone;
          if (getNodeType(c) == 0 || (getNodeFlags(c) & FLAG_HAS_ERROR) != 0) {
            appendedError = true;
          }
        }
      }

      if (firstCloned != 0) setFirstChild(newRoot, firstCloned);
      if (appendedError) {
        setNodeFlags(newRoot, getNodeFlags(newRoot) | FLAG_HAS_ERROR);
      }
      acceptedNode = newRoot;
    }
  }
}

function dropHead(head: ParseHead): void {

  if (changetype<usize>(head) == bestDyingHead) {
    // Do not free bestDyingHead, it is reserved for catastrophic fallback.
    // It will be freed later if replaced, or at the end of parsing.
    return;
  }

  // Find and remove from t_activeHeads
  for (let i: u32 = 0; i < activeHeadsCount; i++) {
    if (t_activeHeads[i] == changetype<u32>(head)) {
      t_activeHeads[i] = t_activeHeads[activeHeadsCount - 1];
      activeHeadsCount--;
      break;
    }
  }
}


let t_dfsVisited: Int32Array | null = null;
let t_dfsReductions: Int32Array | null = null;

/**
 * Initializes the Depth-First Search (DFS) buffers used for traversing
 * the Graph-Structured Stack.
 */
function initDfsBuffers(): void {
  if (t_dfsVisited == null) {
    t_dfsVisited = new Int32Array(32);
    t_dfsReductions = new Int32Array(64);
  }
}

/**
 * Checks if a parsed token matches the expected symbol in a production rule.
 * 
 * @param expected The expected symbol ID.
 * @param actual The actual parsed token ID.
 * @returns True if the symbol matches directly or via an invisible production.
 */
function symbolMatches(expected: i32, actual: i32): boolean {
  if (expected == actual) return true;
  return isDerivableInvisible(expected, actual, 0);
}

function symbolMatchesUnit(expected: i32, actual: i32): boolean {
  if (expected == actual) return true;
  return isDerivableUnit(expected, actual, 0);
}

let t_unitProds: Int32Array | null = null;
let t_unitProdsCount: i32 = -1;
let t_derivableUnitCache: Int32Array | null = null;
let t_derivableInvCache: Int32Array | null = null;
const DERIVABLE_CACHE_MASK: i32 = 4095;

@inline
function getDerivableUnitCached(expected: i32, actual: i32): i32 {
  if (t_derivableUnitCache == null) {
    t_derivableUnitCache = new Int32Array(4096 * 2);
    t_derivableUnitCache!.fill(-1);
  }
  let h = ((((expected as u32) * 31) ^ (actual as u32)) & DERIVABLE_CACHE_MASK) << 1;
  let key = ((expected as u32) << 16) | (actual as u32);
  if (t_derivableUnitCache![h] == (key as i32)) {
    return t_derivableUnitCache![h + 1];
  }
  return -1;
}

@inline
function setDerivableUnitCached(expected: i32, actual: i32, val: i32): void {
  if (t_derivableUnitCache != null) {
    let h = ((((expected as u32) * 31) ^ (actual as u32)) & DERIVABLE_CACHE_MASK) << 1;
    let key = ((expected as u32) << 16) | (actual as u32);
    t_derivableUnitCache![h] = key as i32;
    t_derivableUnitCache![h + 1] = val;
  }
}

@inline
function getDerivableInvCached(expected: i32, actual: i32): i32 {
  if (t_derivableInvCache == null) {
    t_derivableInvCache = new Int32Array(4096 * 2);
    t_derivableInvCache!.fill(-1);
  }
  let h = ((((expected as u32) * 31) ^ (actual as u32)) & DERIVABLE_CACHE_MASK) << 1;
  let key = ((expected as u32) << 16) | (actual as u32);
  if (t_derivableInvCache![h] == (key as i32)) {
    return t_derivableInvCache![h + 1];
  }
  return -1;
}

@inline
function setDerivableInvCached(expected: i32, actual: i32, val: i32): void {
  if (t_derivableInvCache != null) {
    let h = ((((expected as u32) * 31) ^ (actual as u32)) & DERIVABLE_CACHE_MASK) << 1;
    let key = ((expected as u32) << 16) | (actual as u32);
    t_derivableInvCache![h] = key as i32;
    t_derivableInvCache![h + 1] = val;
  }
}

function initUnitProds(): void {
  if (t_unitProdsCount >= 0) return;
  let totalProds = prod_lengths.length;
  let count = 0;
  for (let p = 0; p < totalProds; p++) {
    if (prod_lengths[p] == 1) count++;
  }
  t_unitProds = new Int32Array(count);
  let idx = 0;
  for (let p = 0; p < totalProds; p++) {
    if (prod_lengths[p] == 1) {
      t_unitProds![idx++] = p;
    }
  }
  t_unitProdsCount = count;
}

/**
 * Checks if an `actual` token can be derived from an `expected` non-terminal
 * exclusively through invisible (wrapper) productions.
 * Used during forced reductions to align the stack with production rules.
 * 
 * @param expected The expected non-terminal symbol.
 * @param actual The actual token ID.
 * @param depth The current derivation recursion depth (capped to prevent loops).
 * @returns True if derivable.
 */
function isDerivableInvisible(expected: i32, actual: i32, depth: i32): boolean {
  if (depth > 3) return false;
  if (depth == 0) {
    if (expected == actual) return true;
    let cached = getDerivableInvCached(expected, actual);
    if (cached != -1) return cached == 1;
  }
  initUnitProds();
  let count = t_unitProdsCount;
  let uProds = t_unitProds!;
  for (let i = 0; i < count; i++) {
    let p = uProds[i];
    if (prod_lhs[p] == expected && prod_is_invisible[p] == 1) {
      let rOffset = prod_right_offsets[p];
      let rhsSym = prod_right_symbols[rOffset];
      if (rhsSym == actual) {
        if (depth == 0) setDerivableInvCached(expected, actual, 1);
        return true;
      }
      if (isDerivableInvisible(rhsSym, actual, depth + 1)) {
        if (depth == 0) setDerivableInvCached(expected, actual, 1);
        return true;
      }
    }
  }
  if (depth == 0) setDerivableInvCached(expected, actual, 0);
  return false;
}

function isDerivableUnit(expected: i32, actual: i32, depth: i32): boolean {
  if (depth > 3) return false;
  if (depth == 0) {
    if (expected == actual) return true;
    let cached = getDerivableUnitCached(expected, actual);
    if (cached != -1) return cached == 1;
  }
  initUnitProds();
  let count = t_unitProdsCount;
  let uProds = t_unitProds!;
  for (let i = 0; i < count; i++) {
    let p = uProds[i];
    if (prod_lhs[p] == expected) {
      let rOffset = prod_right_offsets[p];
      let rhsSym = prod_right_symbols[rOffset];
      if (rhsSym == actual) {
        if (depth == 0) setDerivableUnitCached(expected, actual, 1);
        return true;
      }
      if (isDerivableUnit(rhsSym, actual, depth + 1)) {
        if (depth == 0) setDerivableUnitCached(expected, actual, 1);
        return true;
      }
    }
  }
  if (depth == 0) setDerivableUnitCached(expected, actual, 0);
  return false;
}

/**
 * GLR Error Recovery: Forced Reduction
 * Attempts to force a reduction even if the input doesn't match. It finds the "best"
 * production rule that matches a suffix of the symbols on the GSS stack, hallucinates
 * any missing tokens required by the rule, and performs the reduction.
 * 
 * @param head The parse head in distress.
 * @param actionOffset The action table offset for the current state.
 * @param count2 The number of actions in the state.
 * @returns True if a forced reduction successfully branched a new head.
 */
function processForcedReduction(head: ParseHead, actionOffset: i32, count2: i32, currentToken: i32 = -1): boolean {


  // 1. Score and select the best candidate reduction from actions valid in the current state
  let bestProd = -1;
  let bestNeeded = -1;
  let bestMissingCount = 999999;

  let aIdx = actionOffset + 1;
  for (let aAction = 0; aAction < count2; aAction++) {
    let aTok = action_data[aIdx++];
    let aTarget = action_data[aIdx++];
    let isRed = (aTok & 0x8000) != 0;
    if (!isRed) continue;
    let reduceProd = aTarget;
    let popCount = prod_lengths[reduceProd];
    let rOffset = prod_right_offsets[reduceProd];
    let lhsSym = prod_lhs[reduceProd];

    // Find the alignment of the GSS stack with the RHS symbols of this production
    let needed = 0;
    for (let a = (popCount as i32) - 1; a >= 0; a--) {
      let tempCurr: ParseHead | null = head;
      let match = true;
      for (let i = a; i >= 0; i--) {
        if (tempCurr == null || tempCurr.astNode == 0) {
          match = false;
          break;
        }
        let nodeType = getNodeType(tempCurr.astNode);
        let expectedSym = prod_right_symbols[rOffset + i];
        if (!symbolMatches(expectedSym, nodeType)) {
          match = false;
          break;
        }
        tempCurr = tempCurr.prev;
      }
      if (match) {
        needed = a + 1;
        break;
      }
    }

    let missingCount = popCount - needed;

    // Filter: Forced Default Reduction is STRICTLY for completely parsed rules (0 missing tokens)
    if (missingCount > 0) {
      continue;
    }

    // Filter: we require at least one matched symbol (or it's an epsilon production)
    if (needed == 0 && popCount > 0) {
      continue;
    }

    // Filter: Do not hallucinate missing terminal if the active lookahead token already matches it
    if (missingCount > 0 && currentToken != -1) {
      let firstMissingSym = prod_right_symbols[rOffset + needed];
      if (firstMissingSym >= 0 && firstMissingSym <= (MAX_TERMINAL_ID as i32)) {
        if (currentToken == firstMissingSym || symbolMatchesUnit(currentToken, firstMissingSym)) {
          continue;
        }
      }
    }

    // Filter: Do not force-reduce across newline boundaries when tokens are missing
    if (missingCount > 0) {
      let hasNl = false;
      let pNl = head.pos;
      while (pNl < srcLexPos) {
        let ch = peekChar(pNl);
        if (ch == 10 || ch == 13) {
          hasNl = true;
          break;
        }
        pNl += peekCharLen(pNl);
      }
      if (hasNl) {
        continue; // Disallow forced reduction with missing tokens across newlines
      }
    }

    // Filter: prevent self-referential recursive forced reductions.
    // If missingCount > 0 and needed == 1, popping head.astNode (which already matches lhsSym)
    // to produce another lhsSym node without consuming input causes runaway recursive AST nesting.
    if (missingCount > 0 && needed == 1 && head.astNode != 0) {
      let topNodeType = getNodeType(head.astNode);
      if (topNodeType == lhsSym || symbolMatchesUnit(lhsSym, topNodeType) || symbolMatchesUnit(topNodeType, lhsSym)) {
        continue;
      }
    }

    // Filter: we must have a valid GOTO transition from the state BEFORE the matched prefix on the GSS stack
    let curr: ParseHead | null = head;
    let popLeft = needed;
    while (popLeft > 0 && curr != null) {
      curr = curr.prev;
      popLeft--;
    }

    let anchorState = curr != null ? curr.state : 0;
    let gOffset = goto_offsets[anchorState];
    let nextState: i32 = -1;
    if (gOffset >= 0 && gOffset < goto_data.length) {
      let gCount = goto_data[gOffset];
      let gIdx2 = gOffset + 1;
      for (let gi = 0; gi < gCount; gi++) {
        if (goto_data[gIdx2] == lhsSym) {
          nextState = goto_data[gIdx2 + 1];
          break;
        }
        gIdx2 += 2;
      }
    }

    if (nextState == -1) {
      continue;
    }

    let isInvis = prod_is_invisible[reduceProd] == 1;
    if (nextState == head.state && curr == head.prev && missingCount == 0 && isInvis) {
      continue;
    }

    // Select the best: highest needed, then lowest missingCount
    if (needed > bestNeeded || (needed == bestNeeded && missingCount < bestMissingCount)) {
      bestProd = reduceProd;
      bestNeeded = needed;
      bestMissingCount = missingCount;
    }
  }

  if (bestProd == -1) {
    return false;
  }

  // 2. Perform the forced reduction of bestProd
  let reduceProd = bestProd;
  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  let rOffset = prod_right_offsets[reduceProd];
  let needed = bestNeeded;
  let missingCount = bestMissingCount;

  // Calculate missing costs: penalize non-terminals more heavily to prevent runaway virtual injection
  let dynamicMissingCost: i32 = 0;
  for (let m: i32 = 0; m < missingCount; m++) {
    let tokenIndex = rOffset + needed + m;
    if (tokenIndex >= 0 && tokenIndex < prod_right_symbols.length) {
      let missingTokenId = prod_right_symbols[tokenIndex];
      if (missingTokenId > MAX_TERMINAL_ID) {
        dynamicMissingCost += 8000; // Heavy penalty for virtual non-terminals (phantom AST subtrees)
      } else if (missingTokenId >= 0 && missingTokenId <= MAX_TERMINAL_ID) {
        let baseCost = token_insert_costs[missingTokenId];
        if (baseCost >= 10) {
          dynamicMissingCost += 15000; // Structural closing brace/paren penalty to prevent premature block escape
        } else {
          dynamicMissingCost += baseCost * 50;  // Standard penalty for virtual terminal tokens
        }
      }
    }
  }

  if (dynamicMissingCost >= 10000) {
    return false; // Abort forced reduction if missing token cost exceeds budget
  }

  // v5 fix: use MAX_CHILD_NODES - 1 instead of 99999 to stay within allocated bounds
  let c_idx2: i32 = (MAX_CHILD_NODES as i32) - 1;

  // Prepend virtual nodes for the missing trailing pieces
  for (let m: i32 = 0; m < missingCount; m++) {
    let missingSym = prod_right_symbols[rOffset + needed + (missingCount - 1 - m)];
    let nodeType = missingSym >= 0 ? (missingSym as u16) : (NODE_TYPE_ERROR as u16);
    let virtualNode = allocNode(nodeType, 0, 0, 0);
    setNodeFlags(virtualNode, FLAG_IS_INSERTED);
    t_globalReduceCollected[c_idx2--] = virtualNode;
  }

  // Pop the remaining actual nodes from the stack
  let curr: ParseHead | null = head;
  let isList = prod_is_list[reduceProd] == 1;

  let popLeft = needed;
  while ((popLeft > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
    if (c_idx2 <= 0) break;
    let astNode = curr.astNode;
    let isPure = astNode != 0 && isPureErrorNode(astNode);
    if (isPure) {
      t_globalReduceCollected[c_idx2--] = astNode;
    } else {
      t_globalReduceCollected[c_idx2--] = astNode;
      if (popLeft > 0) popLeft--;
    }
    curr = curr.prev;
  }

  let actualCount: u32 = ((MAX_CHILD_NODES as i32) - 1 - c_idx2) as u32;
  for (let k: u32 = 0; k < actualCount; k++) {
    t_globalChildNodes[k] = t_globalReduceCollected[(c_idx2 as u32) + 1 + k];
  }

  let totalByteLength: u32 = 0;
  let firstChildPadding: u32 = 0;
  if (actualCount > 0) {
    let fc = t_globalChildNodes[0];
    if (fc != 0) firstChildPadding = getNodePadding(fc);
  }
  for (let k: u32 = 0; k < actualCount; k++) {
    let c = t_globalChildNodes[k];
    if (c == 0) continue;
    totalByteLength += getNodePadding(c) + getNodeByteLength(c);
  }
  totalByteLength -= firstChildPadding;

  let isInvis = prod_is_invisible[reduceProd] == 1;
  let parentNode: u32;

  let isListAppend = false;
  if (
    (popCount == 2 || popCount == 3) &&
    (actualCount == 2 || actualCount == 3) &&
    t_globalChildNodes[0] != 0 &&
    isList
  ) {
    let leftSym = getNodeType(t_globalChildNodes[0]);
    if (leftSym == lhsSym) isListAppend = true;
  }

  if (isListAppend) {
    parentNode = t_globalChildNodes[0];
    for (let i: u32 = 1; i < actualCount; i++) {
      parentNode = appendToList(
        parentNode,
        t_globalChildNodes[i],
        lhsSym as u16,
        currentScannerState,
        i == actualCount - 1
      );
    }
  } else if (isInvis && actualCount == 1) {
    parentNode = t_globalChildNodes[0];
  } else {
    parentNode = allocNode(
      lhsSym as u16,
      firstChildPadding,
      totalByteLength,
      head.balanceHash & 0xff,
    );
    if (isList) setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_IS_LIST);
    if (isInvis) setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_INVISIBLE);
    let lastC: u32 = 0;
    let appendedError = false;
    for (let k: u32 = 0; k < actualCount; k++) {
      let c = t_globalChildNodes[k];
      if (c == 0) continue;
      let clone = cloneNodeShallow(c);
      if (k == 0) {
        setNodePadding(clone, 0);
      }
      if (lastC == 0) setFirstChild(parentNode, clone);
      else setNextSibling(lastC, clone);
      lastC = clone;
      if (getNodeType(c) == 0 || (getNodeFlags(c) & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) != 0) {
        appendedError = true;
      }
    }
    if (appendedError) {
      setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_HAS_ERROR);
    }
  }

  let anchorState = curr != null ? curr.state : 0;
  let gOffset = goto_offsets[anchorState];
  let nextState: i32 = -1;
  
  if (gOffset >= 0 && gOffset < goto_data.length) {
    let gCount = goto_data[gOffset];
    let gIdx2 = gOffset + 1;
    for (let gi = 0; gi < gCount; gi++) {
      if (goto_data[gIdx2] == lhsSym) {
        nextState = goto_data[gIdx2 + 1];
        break;
      }
      gIdx2 += 2;
    }
  }

  if (nextState != -1) {
    let mrdCost = 0;
    if (nextState >= 0 && nextState < mrd_data.length) {
      mrdCost = mrd_data[nextState] * 20;
      if (mrdCost > 2000) mrdCost = 2000;
    }

    let forcedCost = head.errorCost + dynamicMissingCost + (missingCount > 0 ? 100 : 60) + (prod_lengths[reduceProd] * 15) + mrdCost;
    let newHead = allocParseHead(
      nextState, parentNode, curr, head.pos, currentScannerState, forcedCost,
      head.successfulShifts, head.balanceHash, head.consecutiveInsertions + missingCount,
      head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
    );

    pushActiveHead(changetype<u32>(newHead));
    return true;
  }

  return false;
}


/**
 * Prunes the Graph-Structured Stack (GSS) to prevent combinatorial explosion.
 * This is invoked during error recovery to discard branches that have accumulated
 * too much cost compared to the current lowest-cost branch.
 * 
 * @param pos The current byte offset.
 */
function pruneGSS(pos: u32): void {
  let activeHeadsTrimCount = activeHeadsCount;
  if (activeHeadsTrimCount > 0) {
    let bestCost = INFINITE_COST;
    for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
      let ah = changetype<ParseHead>(t_activeHeads[i]);
      if (ah.errorCost < bestCost) bestCost = ah.errorCost;
    }

    let bestPos: u32 = 0;
    for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
      let ah = changetype<ParseHead>(t_activeHeads[i]);
      if (ah.errorCost == bestCost && ah.pos > bestPos) bestPos = ah.pos;
    }
    let writeIdx = 0;
    for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
      let ah = changetype<ParseHead>(t_activeHeads[i]);
      let margin: i32 = ah.pos > bestPos ? 4000 : 2000;

      if (ah.errorCost <= bestCost + margin && ah.errorCost <= bestAcceptedCost) {
        t_activeHeads[writeIdx++] = changetype<u32>(ah);
      }
    }
    activeHeadsCount = writeIdx;
    activeHeadsTrimCount = activeHeadsCount;
  }

  if (activeHeadsTrimCount > MAX_PARALLEL_HEADS) {
    let sortLimit: u32 = MAX_PARALLEL_HEADS;
    for (let i: u32 = 0; i < sortLimit; i++) {
      let bestIdx = i;
      let hBest = changetype<ParseHead>(t_activeHeads[i]);
      for (let j: u32 = i + 1; j < activeHeadsTrimCount; j++) {
        let hJ = changetype<ParseHead>(t_activeHeads[j]);
        if (hJ.errorCost < hBest.errorCost || (hJ.errorCost == hBest.errorCost && hJ.pos > hBest.pos)) {
          bestIdx = j;
          hBest = hJ;
        }
      }
      if (bestIdx != i) {
        let tmp = t_activeHeads[i];
        t_activeHeads[i] = t_activeHeads[bestIdx];
        t_activeHeads[bestIdx] = tmp;
      }
    }
    activeHeadsCount = sortLimit;
  }
}




export let g_oldTree: u32 = 0;
export let g_editStart: u32 = 0;
export let g_editOldEnd: u32 = 0;
export let g_editNewEnd: u32 = 0;

// --- Tier 4: Multi-Range Incremental Edits ---
export let t_editRangesPtr: usize = 0;
export let t_editRangesCount: u32 = 0;
export let t_defaultSingleEdit: usize = 0;

export function setEditRanges(ptr: usize, count: u32): void {
  t_editRangesPtr = ptr;
  t_editRangesCount = count;
  // Ensure edit intervals are monotonically sorted by start offset
  if (count > 1 && ptr != 0) {
    for (let i: u32 = 0; i < count - 1; i++) {
      for (let j: u32 = 0; j < count - 1 - i; j++) {
        let b1 = ptr + j * 12;
        let b2 = b1 + 12;
        let s1 = load<u32>(b1);
        let s2 = load<u32>(b2);
        if (s1 > s2) {
          let o1 = load<u32>(b1 + 4);
          let n1 = load<u32>(b1 + 8);
          let o2 = load<u32>(b2 + 4);
          let n2 = load<u32>(b2 + 8);
          store<u32>(b1, s2);
          store<u32>(b1 + 4, o2);
          store<u32>(b1 + 8, n2);
          store<u32>(b2, s1);
          store<u32>(b2 + 4, o1);
          store<u32>(b2 + 8, n1);
        }
      }
    }
  }
}

export function mapNewPosToOldPos(pos: u32): u32 {
  if (t_editRangesCount <= 1) {
    if (g_editNewEnd > 0 || g_editOldEnd > 0) {
      if (pos >= g_editNewEnd) {
        return g_editOldEnd + (pos - g_editNewEnd);
      } else if (pos >= g_editStart) {
        return 0xffffffff;
      }
    }
    return pos;
  }

  // Multi-range: displacement calculation across sorted non-overlapping edit intervals
  let delta: i32 = 0;
  for (let i: u32 = 0; i < t_editRangesCount; i++) {
    let base = t_editRangesPtr + i * 12;
    let eStart = load<u32>(base);
    let eOldEnd = load<u32>(base + 4);
    let eNewEnd = load<u32>(base + 8);

    if (pos < eStart) {
      return (pos as i32 - delta) as u32;
    }
    if (pos >= eStart && pos < eNewEnd) {
      return 0xffffffff;
    }
    delta += (eNewEnd - eOldEnd) as i32;
  }
  return (pos as i32 - delta) as u32;
}

export function isOldRangeEdited(start: u32, end: u32): boolean {
  if (t_editRangesCount <= 1) {
    if (g_editOldEnd == 0 && g_editNewEnd == 0) return false;
    return !(end <= g_editStart || start >= g_editOldEnd);
  }

  let prevDelta: i32 = 0;
  for (let i: u32 = 0; i < t_editRangesCount; i++) {
    let base = t_editRangesPtr + i * 12;
    let eStart = load<u32>(base);
    let eOldEnd = load<u32>(base + 4);
    let eNewEnd = load<u32>(base + 8);

    let oldStart = (eStart as i32 - prevDelta) as u32;
    let oldEnd = (eOldEnd as i32 - prevDelta) as u32;
    if (end > oldStart && start < oldEnd) {
      return true;
    }
    prevDelta += (eNewEnd - eOldEnd) as i32;
  }
  return false;
}

/**
 * Graceful EOF Error Acceptance (Tree-sitter Strategy):
 * When parsing reaches TOKEN_EOF with unclosed blocks or unreduced constructs,
 * do not panic or flatten the CST. Instead, record an error diagnostic for the unclosed construct,
 * wrap the stack in an accepted root via processAcceptAction, and terminate cleanly.
 */
function recoverEofAccept(head: ParseHead, pos: u32): void {
  let diagStart = pos > 0 ? pos - 1 : 0;
  let diagEnd = pos > diagStart ? pos : diagStart + 1;
  let exp = getExpectedTokensForState(head.state);
  head.errorTail = pushDiagnostic(head.errorTail, diagStart, diagEnd, TOKEN_EOF as u32, 2, (exp & 0xffffffff) as u32, ((exp >>> 32) & 0xffffffff) as u32);
  head.errorCost += 500;
  processAcceptAction(head);
  if (acceptedNode != 0) {
    setNodeFlags(acceptedNode, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  }
}

/**
 * The main GLR parsing engine loop.
 * Operates in lockstep token-by-token rounds synchronized at the current byte position frontier.
 * Prunes and condenses heads in O(H) time without arbitrary iteration bounds.
 */
export function advanceGLR(): void {
  while (activeHeadsCount > 0) {
    if ((++globalLoopIterations as u32) > (inputLength > 1000 ? inputLength : 1000) * LOOP_MULTIPLIER_LIMIT) {
      break;
    }
    // 1. Find minimum byte offset frontier across all active heads
    let frontierPos: u32 = 0xffffffff;
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let h = changetype<ParseHead>(t_activeHeads[i]);
      if (h.pos < frontierPos) {
        frontierPos = h.pos;
      }
    }
    if (frontierPos == 0xffffffff) break;

    updateExpectedTokens(frontierPos);
    resetPausedHeads();

    // 2. Process all heads at frontierPos
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let head: ParseHead = changetype<ParseHead>(t_activeHeads[i]);
      if (head.pos > furthestDyingPos || (head.pos == furthestDyingPos && bestDyingHead == 0)) {
        furthestDyingPos = head.pos;
        bestDyingHead = changetype<u32>(head);
      }
      if (head.pos != frontierPos) {
        pushNextHead(changetype<u32>(head));
        continue;
      }

      let tok = invokeLexer(frontierPos);
      let curPos = frontierPos;
      while (load<u8>(is_extra_token + tok) == 1) {
        if (lexLen == 0) { curPos += 1; break; }
        head.pendingPadding += lexLen;
        let nextP = curPos + lexLen;
        curPos = nextP > curPos ? nextP : curPos + 1;
        tok = invokeLexer(curPos);
      }

      // Check for Subtree Reuse
      let oldPos = mapNewPosToOldPos(frontierPos);
      let oldSrcLexPos = mapNewPosToOldPos(srcLexPos);

      let headSym: u32 = 0xffffffff;
      if (head != null && head.astNode != 0) headSym = getNodeType(head.astNode) as u32;

      let reusedNode: u32 = 0;
      let expectedPadding: u32 = (srcLexPos > frontierPos ? srcLexPos - frontierPos : 0) + head.pendingPadding;
      if (frontierPos < inputLength && tok != TOKEN_EOF && oldSrcLexPos != 0xffffffff) {
        reusedNode = findReusableNode(
          oldPos,
          oldSrcLexPos,
          head.state,
          head.balanceHash & 0xff,
          g_editStart,
          g_editOldEnd,
          headSym,
          expectedPadding
        );
        if (reusedNode != 0) {
          let freshReuse = cloneNodeShallow(reusedNode);
          if (freshReuse != 0) reusedNode = freshReuse;
          setNodePadding(reusedNode, expectedPadding);
        }
      }


      if (reusedNode != 0) {
        let nodeSym = getNodeType(reusedNode) as i32;
        let totalPadding = expectedPadding;

        let nextState = -1;
        let nodeType = getNodeType(reusedNode);
        if (nodeType > (MAX_TERMINAL_ID as u16)) {
          if ((head.state as i32) < goto_offsets.length) {
            let gOffset = goto_offsets[head.state];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              for (let gi = 0; gi < gCount; gi++) {
                let gSym = goto_data[gOffset + 1 + gi * 2];
                if (gSym == nodeType) {
                  nextState = goto_data[gOffset + 1 + gi * 2 + 1];
                  break;
                }
              }
            }
          }
        } else {
          // v5 fix: parse action table in correct grouped format [sym, actCount, type, target, ...]
          if ((head.state as i32) < action_offsets.length) {
            let aOffset = action_offsets[head.state];
            if (aOffset >= 0 && aOffset < action_data.length) {
              let count = action_data[aOffset];
              let aIdx = aOffset + 1;
              for (let ai = 0; ai < count; ai++) {
                let aSym = action_data[aIdx++];
                let actCount = action_data[aIdx++];
                if (aSym == (nodeType as i32) || aSym == 0) {
                  for (let na = 0; na < actCount; na++) {
                    let aType = action_data[aIdx + na * 2];
                    let aTarget = action_data[aIdx + na * 2 + 1];
                    if (aType == ACTION_SHIFT) {
                      nextState = aTarget;
                      break;
                    }
                  }
                  if (nextState != -1) break;
                }
                aIdx += actCount * 2;
              }
            }
          }
        }

        if (nextState != -1) {
          let endPos = frontierPos + totalPadding + getNodeByteLength(reusedNode);
          let nextTok = invokeLexer(endPos);
          while (load<u8>(is_extra_token + nextTok) == 1) {
            if (lexLen == 0) {
              endPos += 1;
              break;
            }
            let nextEndPos = endPos + lexLen;
            endPos = nextEndPos > endPos ? nextEndPos : endPos + 1;
            nextTok = invokeLexer(endPos);
          }
          let canAccept = stateCanAccept(head, nextState, nextTok, 0, 1);
          if (canAccept == 0 && nextTok >= 0 && nextTok <= MAX_TERMINAL_ID) {
            let checkTok = nextTok == TOKEN_EOF ? 0 : nextTok;
            let dist = reachability_matrix[nextState * (MAX_TERMINAL_ID + 1) + checkTok];
            if (dist < 250) {
              canAccept = 1;
            }
          }
          if (canAccept == 0) {
            nextState = -1;
          }
        }

        if (nextState != -1) {
          let clone = reusedNode;
          setNodeFlags(clone, (getNodeFlags(reusedNode) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
          propagateFirstChildPadding(clone, totalPadding);

          let newPos = frontierPos + totalPadding + getNodeByteLength(reusedNode);

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
          continue;
        }
      }

      // Standard LR action loop: exact match -> wildcard fallback -> SHIFT/ACCEPT/REDUCE
      let didAct = false;
      let reductionGuard: u32 = 0;
      let breakdownAttempted = false;
      let preReduceAttempted = false;

      while (reductionGuard++ < 100 && !didAct) {
        let actionOffset = action_offsets[head.state];
        if (actionOffset < 0 || actionOffset >= action_data.length) break;

        let actCount = action_data[actionOffset];
        let idx = actionOffset + 1;
        let foundTok = false;
        let actOffsetInActions = -1;
        let totalActionsForSym = 0;

        // Pass 1: exact match for sym == tok
        for (let a = 0; a < actCount; a++) {
          let sym = action_data[idx++];
          let numActions = action_data[idx++];
          if (sym == tok) {
            foundTok = true;
            actOffsetInActions = idx;
            totalActionsForSym = numActions;
            break;
          }
          idx += numActions * 2;
        }

        // Pass 2: wildcard match sym == 0 if no exact match found
        if (!foundTok) {
          idx = actionOffset + 1;
          for (let a = 0; a < actCount; a++) {
            let sym = action_data[idx++];
            let numActions = action_data[idx++];
            if (sym == 0) {
              foundTok = true;
              actOffsetInActions = idx;
              totalActionsForSym = numActions;
              break;
            }
            idx += numActions * 2;
          }
        }

        // Pass 3: Default reduction if state has only reductions and no shifts
        if (!foundTok) {
          let hasAnyShift = false;
          let candidateReduce = -1;
          idx = actionOffset + 1;
          for (let a = 0; a < actCount; a++) {
            let sym = action_data[idx++];
            let numActions = action_data[idx++];
            for (let na = 0; na < numActions; na++) {
              let aType = action_data[idx++];
              let aTarget = action_data[idx++];
              if (aType == ACTION_SHIFT) hasAnyShift = true;
              else if (aType == ACTION_REDUCE && candidateReduce == -1) candidateReduce = aTarget;
            }
          }
          if (!hasAnyShift && candidateReduce != -1) {
            let reducedHead = processReduceAction(head, candidateReduce, frontierPos);
            if (reducedHead != null) {
              head = reducedHead;
              continue;
            }
          }

          // Step 3b: Decompose top-of-stack reused composite node (Tree-sitter breakdown_top_of_stack)
          if (!breakdownAttempted) {
            breakdownAttempted = true;
            let brokenHead = breakdownTopOfStack(head);
            if (brokenHead != null) {
              head = brokenHead;
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
          } else {
            let didRecover = false;
            if (configEnableBranchB && head.consecutiveInsertions < 6) {
              didRecover = recoverMissingToken(head, tok, frontierPos);
            }
            if (!didRecover && (head.prev != null || head.inErrorState)) {
              didRecover = recoverStackSummary(head, tok, frontierPos);
            }
            if (!didRecover && configEnableBranchA1) {
              recoverSkipToken(head, tok, frontierPos);
            }
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
    let minNextCost = INFINITE_COST;
    for (let ni: u32 = 0; ni < nextHeadsCount; ni++) {
      let nh = changetype<ParseHead>(t_nextHeads[ni]);
      if (nh.errorCost < minNextCost) minNextCost = nh.errorCost;
    }

    let bestPausedHead: ParseHead | null = null;
    let bestPausedCost = INFINITE_COST;
    let bestPausedPrec: i32 = -999999;
    if (pausedHeadsCount > 0) {
      for (let p: u32 = 0; p < pausedHeadsCount; p++) {
        let cand = changetype<ParseHead>(t_pausedHeads[p]);
        if (cand.errorCost < bestPausedCost || (cand.errorCost == bestPausedCost && cand.dynamicPrec > bestPausedPrec)) {
          bestPausedHead = cand;
          bestPausedCost = cand.errorCost;
          bestPausedPrec = cand.dynamicPrec;
        }
      }
    }

    // Resume best paused head if all heads stalled; OR if paused head has strictly lower error cost than advanced heads!
    if (bestPausedHead != null && (nextHeadsCount == 0 || bestPausedCost < minNextCost)) {
      bestPausedHead.isPaused = false;
      let resumeTok = bestPausedHead.pausedLookahead;
      if (resumeTok != TOKEN_EOF) {
        let didRecover = false;
        if (configEnableBranchB && bestPausedHead.consecutiveInsertions < 6) {
          didRecover = recoverMissingToken(bestPausedHead, resumeTok, bestPausedHead.pos);
        }
        if (!didRecover && (bestPausedHead.prev != null || bestPausedHead.inErrorState)) {
          didRecover = recoverStackSummary(bestPausedHead, resumeTok, bestPausedHead.pos);
        }
        if (!didRecover && configEnableBranchA1) {
          recoverSkipToken(bestPausedHead, resumeTok, bestPausedHead.pos);
        }
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
            if (cTok != TOKEN_EOF) {
              let didRec = false;
              if (configEnableBranchB && cand.consecutiveInsertions < 6) {
                didRec = recoverMissingToken(cand, cTok, cand.pos);
              }
              if (!didRec && (cand.prev != null || cand.inErrorState)) {
                didRec = recoverStackSummary(cand, cTok, cand.pos);
              }
              if (!didRec && configEnableBranchA1) {
                recoverSkipToken(cand, cTok, cand.pos);
              }
            } else {
              recoverEofAccept(cand, cand.pos);
            }
            resumedCount++;
          }
        }
      }
    }
    pausedHeadsCount = 0;

    // 3. Condense and prune next heads (Top-K heap extraction)
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
            let cL = hL.errorCost > (hL.successfulShifts * 15) ? hL.errorCost - (hL.successfulShifts * 15) : 0;
            let cS = hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 0;
            if (cL < cS || (cL == cS && hL.dynamicPrec > hS.dynamicPrec)) smallest = left;
          }
          if (right < heapLen) {
            let hR = changetype<ParseHead>(t_nextHeads[right]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cR = hR.errorCost > (hR.successfulShifts * 15) ? hR.errorCost - (hR.successfulShifts * 15) : 0;
            let cS = hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 0;
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
            let cL = hL.errorCost > (hL.successfulShifts * 15) ? hL.errorCost - (hL.successfulShifts * 15) : 0;
            let cS = hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 0;
            if (cL < cS || (cL == cS && hL.dynamicPrec > hS.dynamicPrec)) smallest = left;
          }
          if (right < heapLen) {
            let hR = changetype<ParseHead>(t_nextHeads[right]);
            let hS = changetype<ParseHead>(t_nextHeads[smallest]);
            let cR = hR.errorCost > (hR.successfulShifts * 15) ? hR.errorCost - (hR.successfulShifts * 15) : 0;
            let cS = hS.errorCost > (hS.successfulShifts * 15) ? hS.errorCost - (hS.successfulShifts * 15) : 0;
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
      nextHeadsCount = MAX_PARALLEL_HEADS;
    }

    // 4. Swap buffers and advance
    swapActiveAndNextHeads();

    // 5. GLR-to-LR Transition: If a single deterministic head has recovered, resume fast-path LR parsing
    if (activeHeadsCount == 1) {
      let singleHead = changetype<ParseHead>(t_activeHeads[0]);
      if (!singleHead.inErrorState && singleHead.successfulShifts >= 2 && singleHead.consecutiveInsertions == 0) {
        let depth: u32 = 0;
        let curr: ParseHead | null = singleHead;
        let isLinear: bool = true;
        let checkDepth: u32 = 0;
        while (curr) {
          depth++;
          if (checkDepth < MAX_PRODUCTION_LENGTH) {
            if (curr.firstEdge != 0) {
              isLinear = false;
            }
            checkDepth++;
          }
          curr = curr.prev;
        }

        if (isLinear && depth > 0 && depth < 10000) {
          curr = singleHead;
          let d: i32 = (depth as i32) - 1;
          while (curr && d >= 0) {
            t_lrStateStack[d] = curr.state as u32;
            t_lrNodeStack[d] = curr.astNode;
            curr = curr.prev;
            d--;
          }
          lrStackDepth = depth;
          currentParserMode = MODE_LR;

          if (g_oldTree != 0) {
            initGlobalCursor(g_oldTree);
          }

          let resumePos = singleHead.pos;
          let resumePad = singleHead.pendingPadding;
          let resumeTok = invokeLexer(resumePos);
          while (load<u8>(is_extra_token + resumeTok) == 1) {
            if (lexLen == 0) {
              resumePos += 1;
              break;
            }
            resumePad += lexLen;
            let nextP = resumePos + lexLen;
            resumePos = nextP > resumePos ? nextP : resumePos + 1;
            resumeTok = invokeLexer(resumePos);
          }

          let lrAccepted = parseLR(resumePos, resumeTok, resumePad);
          if (currentParserMode == MODE_LR && lrAccepted != 0) {
            acceptedNode = lrAccepted;
            singleHead.pos = inputLength;
            bestAcceptingHead = changetype<u32>(singleHead);
            return;
          }
          currentParserMode = MODE_GLR;
        }
      }
    }
  }
}

/**
 * Entry point for the ModelScript incremental parser.
 * 
 * @param oldTree Pointer to the root of the previously parsed AST (for incremental reuse), or 0 for fresh parse.
 * @param editStart Byte offset where the edit starts.
 * @param editOldEnd Byte offset where the old replaced text ended.
 * @param editNewEnd Byte offset where the new inserted text ends.
 * @returns Pointer to the new AST root node.
 */
export let g_isMultiEdit: boolean = false;

/**
 * Multi-Range Incremental Parser Entry Point.
 * Accepts an array of non-overlapping EditRanges [startByte, oldEndByte, newEndByte].
 */
export function parseWithEdits(oldTree: u32, editsPtr: usize, editsCount: u32): u32 {
  setEditRanges(editsPtr, editsCount);
  g_isMultiEdit = true;
  let eStart: u32 = 0;
  let eOldEnd: u32 = 0;
  let eNewEnd: u32 = 0;
  if (editsCount > 0 && editsPtr != 0) {
    eStart = load<u32>(editsPtr);
    eOldEnd = load<u32>(editsPtr + 4);
    eNewEnd = load<u32>(editsPtr + 8);
  }
  let res = parse(oldTree, eStart, eOldEnd, eNewEnd);
  g_isMultiEdit = false;
  t_editRangesCount = 0;
  t_editRangesPtr = 0;
  g_editStart = 0;
  g_editOldEnd = 0;
  g_editNewEnd = 0;
  return res;
}

export function parse(oldTree: u32, editStart: u32, editOldEnd: u32, editNewEnd: u32): u32 {
  g_oldTree = oldTree;
  g_editStart = editStart;
  g_editOldEnd = editOldEnd;
  g_editNewEnd = editNewEnd;

  if (!g_isMultiEdit) {
    t_editRangesPtr = 0;
    t_editRangesCount = 0;
    if (t_defaultSingleEdit == 0) {
      t_defaultSingleEdit = atomicChunkAlloc(12);
    }
    store<u32>(t_defaultSingleEdit, editStart);
    store<u32>(t_defaultSingleEdit + 4, editOldEnd);
    store<u32>(t_defaultSingleEdit + 8, editNewEnd);
    t_editRangesPtr = t_defaultSingleEdit;
    t_editRangesCount = (editOldEnd > 0 || editNewEnd > 0) ? 1 : 0;
  }

  globalIsCatastrophic = false;
  globalSearchIterations = 0;
  debugLog(9001, oldTree, editStart, editOldEnd);

  if (changetype<usize>(t_activeHeads) == 0) {
    initGSS();
    t_globalReduceCollected = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildNodes = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildren = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_tokenBufferArena = changetype<UnmanagedInt32Array>(atomicChunkAlloc(ARENA_BUFFER_SIZE * 4));
    t_tokenBufferLenArena = changetype<UnmanagedUint32Array>(atomicChunkAlloc(ARENA_BUFFER_SIZE * 4));
    t_lrStateStack = createChunkedUint32Array(10000);
    t_lrNodeStack = createChunkedUint32Array(10000);

    initQueryArena();
  } else {
    t_lrStateStack.clear();
    t_lrNodeStack.clear();
  }

  let pos: u32 = 0;
  let token: i32 = 0;

  // Only perform complete reset if we are not resuming from an async suspend
  if (!isSuspended) {
    if (oldTree == 0) {
      if (configEnableMultiFile) {
        resetGeneration(0);
      } else {
        resetGeneration(0);
        resetGeneration(1);
        S().freeNodeHead = 0;
      }
    } else {
      // Clear the free list: free-list nodes are from the old tree's Gen1 space
      S().freeNodeHead = 0;
    }
    
    globalLoopGuard = 0;
    resetGeneration(0);
    resetQueryArena();
    clearDiagnostics();
    errorCount = 0;
    mergeTableInit();
    lexPos = 0;
    lexLen = 0;
    currentScannerState = 0;
    pos = 0;

    tokenBufferWriteIdx = 0;
    tokenBufferReadIdx = 0;
    tokenBufferLastPos = 0;
    errorCount = 0;

    initGlobalCursor(oldTree);

    currentParserMode = MODE_LR;
    let accepted = parseLR();
    if (currentParserMode == MODE_LR) {
      globalAstRoot = accepted;
      debugLog(9002, editNewEnd, accepted, currentParserMode);
      return accepted;
    }
  }
  isSuspended = false;

  // Error recovery trackers
  furthestDyingPos = 0;
  bestDyingHead = 0;

  bestAcceptingHead = 0;
  acceptedNode = 0;
  bestAcceptedCost = 999999;
  bestAcceptedRealBytes = 0; // Track amount of input consumed (more is better)
  bestAcceptedCount = 0xffffffff; // Track GSS fragmentation (fewer is better)
  bestAcceptedPad = 0xffffffff; // Track leftmost match padding (smaller is better)
  lastBestCost = 999999;
  lastIterCount = 0;
  globalLoopIterations = 0;
  advanceGLR();

  if (acceptedNode != 0) {
    bestDyingHead = 0;
    if (bestAcceptingHead != 0) {
      let bah = changetype<ParseHead>(bestAcceptingHead);
      commitDiagnostics(bah.errorTail);
    }
      sanitizeTree(acceptedNode);
      let acceptedPos: u32 = bestAcceptingHead != 0 ? changetype<ParseHead>(bestAcceptingHead).pos : 0;
      let finalTree = wrapWithTrailingErrors(acceptedNode, acceptedPos);
      fixNodeLengthRecursive(finalTree);
      globalAstRoot = finalTree;
      debugLog(9003, finalTree, bestAcceptedCost, errorCount);
      t_editRangesPtr = 0;
      t_editRangesCount = 0;
      g_editStart = 0;
      g_editOldEnd = 0;
      g_editNewEnd = 0;
      return finalTree;
  }
  if (bestDyingHead != 0) {
    // ----------------------------------------------------------------------
    // CATASTROPHIC FAILURE FALLBACK
    // ----------------------------------------------------------------------
    // If the parser exhausted the iteration guard or all branches died, we
    // cannot return a valid AST. However, for language servers, returning `null`
    // destroys all syntax highlighting and code folding.
    // Instead, we bundle whatever we successfully parsed on the best dying head,
    // parse the remaining unconsumed tokens as flat ERROR leaves, and return
    // a single monolithic ERROR root that spans the whole file.
    globalIsCatastrophic = true;
    

    let curr: ParseHead | null = changetype<ParseHead>(bestDyingHead);
    commitDiagnostics(bestDyingHead != 0 ? changetype<ParseHead>(bestDyingHead).errorTail : 0);
    let totalBytes: u32 = 0;
    let nodeCount: u32 = 0;

    // Calculate size of the successfully parsed portion
    while (curr) {
      if (curr.astNode != 0) {
        totalBytes += getNodePadding(curr.astNode) + getNodeByteLength(curr.astNode);
        nodeCount++;
      }
      curr = curr.prev;
    }

    // Lex the remainder of the file
    let remainingLen =
      inputLength > changetype<ParseHead>(bestDyingHead).pos
        ? inputLength - changetype<ParseHead>(bestDyingHead).pos
        : 0;
    let unparsedNode: u32 = 0;

    if (remainingLen > 0) {
      let missingPadding = changetype<ParseHead>(bestDyingHead).pendingPadding;
      let p = changetype<ParseHead>(bestDyingHead).pos;
      let firstPad: u32 = missingPadding;
      let peekTok = invokeLexer(p);
      let errLen = remainingLen;
      unparsedNode = allocNode(NODE_TYPE_ERROR, firstPad, errLen, 0, false);
      let lastTokNode = 0;

      // Report a single monolithic error for the entire unparsed remainder
      // instead of creating a squiggle for every individual garbage token.
      if (inputLength > p) {
        reportGlobalError(p as u32, inputLength as u32);
      }

      // Force lexer to accept any token during garbage collection
      // v5 fix: use bounded fill instead of hardcoded 2048
      let _catCopyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
      if (_catCopyLen > 65536) _catCopyLen = 65536;
      memory.fill(expected_tokens, 1, _catCopyLen);

      while (p < inputLength) {
        let tok = lex(p);
        if (tok == TOKEN_EOF) break;
        let pad = srcLexPos > p ? srcLexPos - p : 0;
        let tLen = lexLen;
        if (tLen == 0) {
          p += 1;
          continue;
        }

        let tNode = allocNode(((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, lastTokNode == 0 ? 0 : pad, tLen, 0, false);
        setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
        if (lastTokNode == 0) {
          setFirstChild(unparsedNode, tNode);
        } else {
          setNextSibling(lastTokNode, tNode);
        }
        lastTokNode = tNode;

        let nextP = srcLexPos + tLen;
        p = nextP > p ? nextP : p + 1;
      }

      totalBytes += remainingLen + missingPadding;
      nodeCount++;
    } else {
      if (errorCount == 0 && inputLength > 0) {
        let errStart = inputLength > 1 ? inputLength - 1 : 0;
        reportGlobalError(errStart, inputLength);
      }
    }

    let totalNodes = nodeCount;
    let c_idx = totalNodes;

    // Append the unparsed chunk
    if (unparsedNode != 0 && c_idx > 0) {
      c_idx--;
      if (c_idx < (MAX_CHILD_NODES as u32)) t_globalChildNodes[c_idx] = unparsedNode;
    }

    // Append the successfully parsed nodes from the GSS
    curr = changetype<ParseHead>(bestDyingHead);
    while (curr) {
      if (curr.astNode != 0 && c_idx > 0) {
        c_idx--;
        if (c_idx < (MAX_CHILD_NODES as u32)) t_globalChildNodes[c_idx] = curr.astNode;
      }
      curr = curr.prev;
    }

    let firstChildPadding = totalNodes > 0 ? getNodePadding(t_globalChildNodes[0]) : 0;
    let root = allocNode(
      (MAX_TERMINAL_ID + 1) as u16,
      firstChildPadding,
      totalBytes > firstChildPadding ? totalBytes - firstChildPadding : 0,
      0,
    );
    setNodeFlags(root, getNodeFlags(root) | FLAG_HAS_ERROR);

    // Link them together
    let lastChild = 0;
    let loopLimit = totalNodes < (MAX_CHILD_NODES as u32) ? totalNodes : (MAX_CHILD_NODES as u32);
    for (let i: u32 = 0; i < loopLimit; i++) {
      let child = t_globalChildNodes[i];
      if (child == 0) continue;
      let clone = cloneNodeShallow(child);
      if (lastChild == 0) setFirstChild(root, clone);
      else setNextSibling(lastChild, clone);
      lastChild = clone;
    }

    globalAstRoot = root;
    debugLog(9003, root, 999999, errorCount);
    t_editRangesPtr = 0;
    t_editRangesCount = 0;
    g_editStart = 0;
    g_editOldEnd = 0;
    g_editNewEnd = 0;
    return root;
  }
  globalAstRoot = 0;
  debugLog(9003, 0, 999999, errorCount);
  t_editRangesPtr = 0;
  t_editRangesCount = 0;
  g_editStart = 0;
  g_editOldEnd = 0;
  g_editNewEnd = 0;
  return 0;
}
function clearSubtreeErrorFlags(nodePtr: u32): void {
  // B8 fix: converted from unbounded recursion to iterative
  if (nodePtr == 0) return;
  if (changetype<usize>(t_sanitizeStack) == 0) {
    t_sanitizeStack = createChunkedUint32Array(50000);
    t_sanitizeVisited = createChunkedUint32Array(50000);
  } else {
    t_sanitizeStack.clear();
  }
  t_sanitizeStack.push(nodePtr);
  let iterations: u32 = 0;
  while (t_sanitizeStack.length > 0 && iterations < 500000) {
    iterations++;
    let curr = t_sanitizeStack.pop();
    if (curr == 0) continue;
    let typeFlags = getNodeFlags(curr);
    if (getNodeType(curr) != 0) {
      setNodeFlags(curr, (typeFlags & ~((FLAG_HAS_ERROR | FLAG_IS_TAINED) as u32)) as u16);
    }
    let child = getNodeFirstChild(curr);
    while (child != 0) {
      t_sanitizeStack.push(child);
      child = getNodeNextSibling(child);
    }
  }
}


/**
 * Searches the old incremental tree for a sub-tree that matches the current parsing
 * state and hasn't been modified by the user's edits.
 * 
 * @param targetOldPos The expected byte offset of the node in the old tree.
 * @param targetSrcOldPos The expected starting position (excluding whitespace padding).
 * @param currentState The current state of the parser to verify GOTO transitions.
 * @param envHash Lexer environment hash matching.
 * @param editStart Start of edits.
 * @param editOldEnd End of replaced region.
 * @param headSym The symbol currently at the top of the GSS head (used for splices).
 * @param expectedPadding Expected leading whitespace.
 * @returns Pointer to a reusable AST node, or 0 if none found.
 */
export function findReusableNode(
  targetOldPos: u32,
  targetSrcOldPos: u32,
  currentState: i32,
  envHash: u32,
  editStart: u32,
  editOldEnd: u32,
  headSym: u32,
  expectedPadding: u32
): u32 {
  if (globalCursorDepth < 0) {
    return 0;
  }

  while (globalCursorDepth >= 0) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    if (cPtr == 0) {
      if (!globalCursorGotoParent()) return 0;
      continue;
    }

    let start = cursorContentStartStack[globalCursorDepth];
    let byteLen = getNodeByteLength(cPtr);
    let end = start + byteLen;

    // Case 1: Node ended before targetSrcOldPos. Move forward to next sibling or parent's next sibling.
    if (end <= targetSrcOldPos) {
      if (globalCursorGotoNextSibling()) {
        continue;
      }
      if (!globalCursorGotoParent()) {
        return 0;
      }
      while (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) {
          return 0;
        }
      }
      continue;
    }

    // Case 2: Node starts after targetSrcOldPos. We are ahead of the current parse position.
    if (start > targetSrcOldPos) {
      return 0;
    }

    // Case 3: Node starts before targetSrcOldPos and ends after targetSrcOldPos.
    // targetSrcOldPos is inside this node. We must drill down into its children.
    if (start < targetSrcOldPos) {
      if (globalCursorGotoFirstChild()) {
        continue;
      }
      // It's a leaf node that spans across targetSrcOldPos.
      return 0;
    }

    // Case 4: start == targetSrcOldPos and end > targetSrcOldPos.
    // Test if this node can be reused!
    let nodeType = getNodeType(cPtr);
    let pad = getNodePadding(cPtr);
    let isError = nodeType == 0;
    let isMissing = byteLen == 0 && getNodeFirstChild(cPtr) == 0 && pad == 0;
    let nodeEnvHash = getNodeEnvHash(cPtr) & 0xff;
    let nodeStartState = getNodeStartState(cPtr);
    let canReuse = (!isError && !isMissing && nodeEnvHash == envHash);

    if (canReuse) {
      if (!isOldRangeEdited(start, end)) {
        let canTransition = false;
        if (nodeType > (MAX_TERMINAL_ID as u16)) {
          canTransition = (nodeStartState == (currentState as u32));
          if (!canTransition && (currentState as i32) >= 0 && (currentState as i32) < goto_offsets.length) {
            let gOffset = goto_offsets[currentState];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              for (let gi = 0; gi < gCount; gi++) {
                if (goto_data[gOffset + 1 + gi * 2] == (nodeType as i32)) {
                  canTransition = true;
                  break;
                }
              }
            }
          }
        } else {
          // Terminal leaf reuse: verify currentState has a valid shift action for this token
          let numActions = lookupActions(currentState as i32, nodeType as i32);
          if (numActions > 0 && tempActions[0] == (ACTION_SHIFT as u32)) {
            canTransition = true;
          }
        }
        if (canTransition) {
          let typeFlags = getNodeFlags(cPtr);
          let hasErrorFlags = (typeFlags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED)) != 0;
          let isCleanGen1 = (g_oldTree != 0 && !isNodeGen2(cPtr));
          if (!hasErrorFlags && (isCleanGen1 || !nodeHasAnyErrors(cPtr))) {
            debugLog(9008, cPtr, start, end);
            return cPtr;
          }
        }
      }
    }

    // Node cannot be reused as a whole. Drill down into its children to find smaller reusable subtrees.
    if (globalCursorGotoFirstChild()) {
      continue;
    }

    // Cannot drill down further from this leaf.
    return 0;
  }

  return 0;
}
