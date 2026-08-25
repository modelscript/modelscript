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
    ParseHead, t_activeHeads, t_nextHeads, activeHeadsCount, nextHeadsCount, pushActiveHead, pushNextHead, swapActiveAndNextHeads, allocParseHead, t_extractedHeadsBuffer,
    globalCursorDepth, cursorNodeStack, cursorContentStartStack, globalCursorGotoNextSibling, globalCursorGotoParent, globalCursorGotoFirstChild
} from "./gss";
import { 
    allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild,
    getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, propagateFirstChildPadding,
    setNodeByteLength, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_LIST_BOUNDARY, FLAG_HAS_ERROR, FLAG_IS_TAINED, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_IS_SHARED,
    getNodeEnvHash, getNodeStartState, getInputBuffer,
    atomicChunkAlloc, resetGeneration, S, ASTNode, clearAstMarks, isNodeGen2
} from "./arena";
import { UnmanagedUint32Array, UnmanagedUint8Array, UnmanagedInt32Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";
import {
    lexPos, lexLen, srcLexPos, currentScannerState, invokeLexer, is_extra_token, inputLength,
    lex, setLexPos, setLexLen, setSrcLexPos, setCurrentScannerState, SYMBOL_COUNT, logInt, peekChar, peekCharLen
} from "./parser";
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
    expected_tokens,
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
import { initQueryArena, resetQueryArena, clearDiagnostics } from "./graph";

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
function parseLR(): u32 {
  let pos: u32 = 0;
  let token: i32 = 0;
  let pendingPadding: u32 = 0;
  
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
  
  let consecutiveReductions: u32 = 0;
  while (currentParserMode == MODE_LR) {
    let currentState = t_lrStateStack[(lrStackDepth - 1)] as i32;
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
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }


    } else {
      type = tempActions[0];
      target = tempActions[1] as i32;
    }
    
    if (type == ACTION_SHIFT) {
      consecutiveReductions = 0;
      let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
      let leaf = allocNode(token as u16, paddingLength, lexLen, 0);
      
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
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }
      let reduceProd = target;
      let popCount = prod_lengths[reduceProd] as i32;
      let lhsSym = prod_lhs[reduceProd];
      
      lrStackDepth -= popCount;
      let childStartIdx = lrStackDepth;
      
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
      
      let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, 0);
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
      
      let prevState = t_lrStateStack[(lrStackDepth - 1)] as i32;
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
        transitionToGlr(pos, pendingPadding, currentScannerState);
        return 0;
      }
      
      t_lrStateStack[lrStackDepth] = nextState;
      t_lrNodeStack[lrStackDepth] = parentNode;
      lrStackDepth++;
      
    } else if (type == ACTION_ACCEPT) {
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
  memory.copy(savedExpectedTokensPtr, expected_tokens, 65536);
  memory.fill(expected_tokens, 0, 65536);
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

  memory.copy(expected_tokens, savedExpectedTokensPtr, 65536);
  return tok;
}

/**
 * Updates the `expected_tokens` bitset based on the valid action transitions
 * from the active parsing heads (either the single LR head or all GLR heads).
 * This acts as context-aware feedback for the lexer (for keywords vs identifiers).
 */
function updateExpectedTokens(): void {
  if (expected_tokens == 0) {
    expected_tokens = atomicChunkAlloc(65536);
  }
  memory.fill(expected_tokens, 0, 65536);
  if (currentParserMode == MODE_LR) {
    if (lrStackDepth > 0) {
      let state = t_lrStateStack[lrStackDepth - 1] as i32;
      addStateExpectedTokens(state, 0);
    }
  } else {
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let head = changetype<ParseHead>(t_activeHeads[i]);
      addStateExpectedTokens(head.state, 0);
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
  if (depth > 8) return 0;
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
        if (!isNodeGen2(node) || (prevChild != 0 && !isNodeGen2(prevChild))) {
          // Cannot mutate Gen1 nodes. Leave as is.
        } else {
          if (prevChild == 0) setFirstChild(node, nextSib);
          else setNextSibling(prevChild, nextSib);
          modified = true;
        }
      } else {
        // Check if this child was already visited (shared subtree)
        let cFlags = getNodeFlags(child);
        let isShared = (cFlags & FLAG_LSP_VISITED) != 0;
        
        if (isShared) {
          if (!isNodeGen2(node) || (prevChild != 0 && !isNodeGen2(prevChild))) {
            // Cannot mutate Gen1 nodes to break aliasing. Skip.
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
              // Clone failed (too deep); unlink to prevent cycle
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
  let flags = getNodeFlags(node);
  if ((flags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED)) != 0) return true;
  let type = getNodeType(node);
  if (type == NODE_TYPE_ERROR || (type & 0x8000) != 0) return true;
  let child = getNodeFirstChild(node);
  let depth = 0;
  while (child != 0 && depth < 50) {
    if (nodeHasAnyErrors(child)) return true;
    child = getNodeNextSibling(child);
    depth++;
  }
  return false;
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
    while ((getNodeFlags(acceptBase) & FLAG_EXTRACTED) != 0 && getNodeFirstChild(acceptBase) != 0) {
      let isShallowClone = false;
      let currTemp: ParseHead | null = headPtr != 0 ? changetype<ParseHead>(headPtr) : null;
      while (currTemp) {
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

  // Force lexer to accept any token during error node construction
  memory.fill(expected_tokens, 1, 2048);

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
  let clone = allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc));
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
  if ((flags & FLAG_IS_LIST) != 0) {
    let child = getNodeFirstChild(node);
    while (child != 0) {
      if (!isPureErrorNode(child)) {
        return false;
      }
      child = getNodeNextSibling(child);
    }
  }
  return true;
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
  if (getNodePadding(node) == 0 && firstPad > 0) {
    setNodePadding(node, firstPad);
  }

  let totalLen = getNodeByteLength(gc);
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
      t_sanitizeStack.push(child);
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
    let origC2 = getNodeNextSibling(origC1);

    let c1 = cloneNodeShallow(origC1);
    let c2 = cloneNodeShallow(origC2);

    if (lDirectChildCount < LIST_MAX_CHILDREN) {
      if (lastChild == 0) setFirstChild(p, c1);
      else setNextSibling(lastChild, c1);
      setNextSibling(c1, c2);
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
      setNextSibling(c1, c2);
      setNextSibling(c2, 0);
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
  while (ldTemp != 0) {
    directChildCount++;
    ldTemp = getNodeNextSibling(ldTemp);
  }

    if (isBoundary) {
      setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_LIST_BOUNDARY);
    }

    if (directChildCount < LIST_MAX_CHILDREN || !isBoundary) {
      if (isMutable(leftNode)) {
        let curr = getNodeFirstChild(leftNode);
        if (curr == 0) {
          setNodePadding(leftNode, getNodePadding(leftNode) + getNodePadding(leaf));
          setNodePadding(leaf, 0);
          setFirstChild(leftNode, leaf);
        } else {
          while (getNodeNextSibling(curr) != 0) {
            curr = getNodeNextSibling(curr);
          }
          setNextSibling(curr, leaf);
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

  memory.copy(changetype<usize>(savedExpectedTokens), changetype<usize>(expected_tokens), 65536);
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

  memory.copy(changetype<usize>(expected_tokens), changetype<usize>(savedExpectedTokens), 65536);
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

  let paddingLength = head.pendingPadding;
  if (!isVirtual) {
    paddingLength += (srcLexPos > pos ? srcLexPos - pos : 0);
  }

  let leaf = allocNode(token as u16, paddingLength, lexLen, newBalance & 0xff);
  if (isVirtual) {
    setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_IS_INSERTED);
  }

  let nextPos = isVirtual ? pos : srcLexPos + lexLen;
  let nPos = nextPos > pos ? nextPos : pos + 1;
  currentScannerState = 0;
  let newCost = head.errorCost;
  let newShifts = head.successfulShifts + 1;
  let nextConsecutive = isVirtual ? head.consecutiveInsertions : 0;

  let newHead = allocParseHead(
    target, leaf, head, nPos, currentScannerState, newCost, newShifts, newBalance, nextConsecutive, head.dynamicPrec, 0, head.errorTail
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
function processReduceAction(head: ParseHead, reduceProd: i32, pos: u32): ParseHead | null {
  if (reduceProd < 0 || reduceProd >= prod_lengths.length) {
    throw new Error("BAD reduceProd: " + reduceProd.toString());
  }

  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  
  let curr: ParseHead | null = head;


  let c_idx = 99999;
  let needed = popCount;
  let foundFirstGrammar = false;
  let isList = prod_is_list[reduceProd] == 1;

  while ((needed > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
    if (c_idx <= 0) break;
    let astNode = curr.astNode;
    let isPure = astNode != 0 && isPureErrorNode(astNode);
    
    if (isPure) {
      t_globalReduceCollected[c_idx--] = astNode;
    } else {
      foundFirstGrammar = true;
      t_globalReduceCollected[c_idx--] = astNode;
      if (needed > 0) needed--;
    }
    curr = curr.prev;
  }
  if (curr == null && needed > 0) {
    
    return null;
  }

  let actualCount = 99999 - c_idx;
  for (let k = 0; k < actualCount; k++) {
    t_globalChildNodes[k] = t_globalReduceCollected[c_idx + 1 + k];
  }

  if (curr) {
    let totalByteLength: u32 = 0;
    let firstChildPadding: u32 = 0;
    if (actualCount > 0) {
      firstChildPadding = getNodeLeadingPad(t_globalChildNodes[0]);
      for (let k = 0; k < actualCount; k++) {
        let cPadding = getNodeLeadingPad(t_globalChildNodes[k]);
        let cLen = getNodeByteLength(t_globalChildNodes[k]);
        if (k == 0) totalByteLength += cLen;
        else totalByteLength += cPadding + cLen;
      }
    }
    let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, head.balanceHash & 0xff);

    if (prod_is_list[reduceProd] == 1) {
      let flags = getNodeFlags(parentNode);
      setNodeFlags(parentNode, flags | FLAG_IS_LIST);
    }
    if (prod_is_invisible[reduceProd] == 1) {
      let flags = getNodeFlags(parentNode);
      setNodeFlags(parentNode, flags | FLAG_INVISIBLE);
    }

    if (actualCount > 0) {
      let isListAppend = false;
      if (
        (popCount == 2 || popCount == 3) &&
        (actualCount == 2 || actualCount == 3) &&
        t_globalChildNodes[0] != 0 &&
        prod_is_list[reduceProd] == 1
      ) {
        let leftSym = getNodeType(t_globalChildNodes[0]);
        if (leftSym == lhsSym) isListAppend = true;
      }
      

      if (isListAppend) {
        parentNode = t_globalChildNodes[0];
        for (let i = 1; i < actualCount; i++) {
          parentNode = appendToList(
            parentNode,
            t_globalChildNodes[i],
            lhsSym as u16,
            currentScannerState,
            i == actualCount - 1
          );
        }
      } else {

        let lastChild = 0;
        let logicalChildIndex = 0;

        let aliasPtr = prod_aliases[reduceProd];
        let aliasCount = 0;
        if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

        for (let k = 0; k < actualCount; k++) {
          let child = t_globalChildNodes[k];
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
        let pFlags = getNodeFlags(parentNode);
        setNodeFlags(parentNode, pFlags);
      }
    }

    if (curr.state < 0 || curr.state >= goto_offsets.length) {
      throw new Error("BAD curr.state in REDUCE: " + curr.state.toString());
    }

    let gOffset = goto_offsets[curr.state];
    if (gOffset < 0 || gOffset >= goto_data.length) {
      throw new Error("BAD gOffset: " + gOffset.toString());
    }

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

    if (nextState != -1) {
      let newHead = allocParseHead(
        nextState, parentNode, curr, head.pos, 0, head.errorCost,
        head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
        head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
      );
      return newHead;
    } else {
      return null;
    }
  }
  return null;
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
        let accLen = getNodeByteLength(acceptedNode);
        let expectedLen = inputLength > accPad ? inputLength - accPad : 0;
        if (accLen != expectedLen && head.pos >= inputLength) {
          setNodeByteLength(acceptedNode, expectedLen);
        }
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

      let c_idx = t_count - 1;
      t_curr = head;
      let bestRoot: u32 = 0;
      let bestRootType: u16 = 65535;
      while (t_curr) {
        if (t_curr.astNode != 0) {
          let cType = getNodeType(t_curr.astNode);
          let cLen = getNodeByteLength(t_curr.astNode);
          if (cType != TOKEN_EOF && (cLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
            t_globalChildren[c_idx--] = t_curr.astNode;
            let isNonTerminal = cType > (MAX_TERMINAL_ID as u16);
            if (cType != NODE_TYPE_ERROR && isNonTerminal && cType < bestRootType) {
              bestRoot = t_curr.astNode;
              bestRootType = cType;
            }
          }
        }
        t_curr = t_curr.prev;
      }



      let firstChildPad = t_count > 0 && t_globalChildren[0] != 0 ? getNodePadding(t_globalChildren[0]) : 0;
      let targetLen = inputLength > firstChildPad ? inputLength - firstChildPad : 0;
      let newRoot = allocNode((MAX_TERMINAL_ID + 1) as u16, firstChildPad, targetLen, 0);

      let lastC2: u32 = 0;
      let firstCloned: u32 = 0;
      let appendedError = false;

      for (let i: u32 = 0; i < t_count; i++) {
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
  let totalProds = prod_lengths.length;
  for (let p = 0; p < totalProds; p++) {
    if (prod_lhs[p] == expected && prod_lengths[p] == 1 && prod_is_invisible[p] == 1) {
      let rOffset = prod_right_offsets[p];
      let rhsSym = prod_right_symbols[rOffset];
      if (rhsSym == actual) return true;
      if (isDerivableInvisible(rhsSym, actual, depth + 1)) return true;
    }
  }
  return false;
}

function isDerivableUnit(expected: i32, actual: i32, depth: i32): boolean {
  if (depth > 3) return false;
  let totalProds = prod_lengths.length;
  for (let p = 0; p < totalProds; p++) {
    if (prod_lhs[p] == expected && prod_lengths[p] == 1) {
      let rOffset = prod_right_offsets[p];
      let rhsSym = prod_right_symbols[rOffset];
      if (rhsSym == actual) return true;
      if (isDerivableUnit(rhsSym, actual, depth + 1)) return true;
    }
  }
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

  let c_idx2 = 99999;

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

  let actualCount: u32 = (99999 - c_idx2) as u32;
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

    let newHead = allocParseHead(
      nextState, parentNode, curr, head.pos, currentScannerState, head.errorCost + dynamicMissingCost + (missingCount > 0 ? 50 : 0) + mrdCost,
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
    

    if (activeHeadsTrimCount > 1 && bestCost > 0 && bestCost < INFINITE_COST) {
      for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
        let ah = changetype<ParseHead>(t_activeHeads[i]);
        ah.errorCost = ah.errorCost > bestCost ? ah.errorCost - bestCost : 0;
      }
      if (bestAcceptedCost < INFINITE_COST) {
        bestAcceptedCost = bestAcceptedCost > bestCost ? bestAcceptedCost - bestCost : 0;
      }
      if (lastBestCost < INFINITE_COST) {
        lastBestCost = lastBestCost > bestCost ? lastBestCost - bestCost : 0;
      }
    }
  }

  if (activeHeadsTrimCount > MAX_PARALLEL_HEADS) {
    let heapLen = activeHeadsTrimCount;
    for (let hi: i32 = (heapLen as i32) / 2 - 1; hi >= 0; hi--) {
      let ci: u32 = hi as u32;
      while (true) {
        let smallest = ci;
        let left = ci * 2 + 1;
        let right = ci * 2 + 2;
        if (left < heapLen) {
          let hL = changetype<ParseHead>(t_activeHeads[left]);
          let hS = changetype<ParseHead>(t_activeHeads[smallest]);
          if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
        }
        if (right < heapLen) {
          let hR = changetype<ParseHead>(t_activeHeads[right]);
          let hS = changetype<ParseHead>(t_activeHeads[smallest]);
          if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos)) smallest = right;
        }
        if (smallest == ci) break;
        let tmp = t_activeHeads[ci];
        t_activeHeads[ci] = t_activeHeads[smallest];
        t_activeHeads[smallest] = tmp;
        ci = smallest;
      }
    }
    let sortLimit: u32 = heapLen < MAX_PARALLEL_HEADS ? heapLen : MAX_PARALLEL_HEADS;
    for (let ei: u32 = 0; ei < sortLimit && heapLen > 0; ei++) {
      t_extractedHeadsBuffer[ei] = t_activeHeads[0];
      t_activeHeads[0] = t_activeHeads[heapLen - 1];
      heapLen--;
      let ci: u32 = 0;
      while (true) {
        let smallest = ci;
        let left = ci * 2 + 1;
        let right = ci * 2 + 2;
        if (left < heapLen) {
          let hL = changetype<ParseHead>(t_activeHeads[left]);
          let hS = changetype<ParseHead>(t_activeHeads[smallest]);
          if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
        }
        if (right < heapLen) {
          let hR = changetype<ParseHead>(t_activeHeads[right]);
          let hS = changetype<ParseHead>(t_activeHeads[smallest]);
          if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos)) smallest = right;
        }
        if (smallest == ci) break;
        let tmp = t_activeHeads[ci];
        t_activeHeads[ci] = t_activeHeads[smallest];
        t_activeHeads[smallest] = tmp;
        ci = smallest;
      }
    }
    for (let ei: u32 = 0; ei < sortLimit; ei++) {
      t_activeHeads[ei] = t_extractedHeadsBuffer[ei];
    }
    activeHeadsCount = sortLimit;
  }
}




export let g_editStart: u32 = 0;
export let g_editOldEnd: u32 = 0;
export let g_editNewEnd: u32 = 0;

/**
 * The main GLR parsing engine loop.
 * Operates in lockstep token-by-token rounds synchronized at the current byte position frontier.
 * Prunes and condenses heads in O(H) time without arbitrary iteration bounds.
 */
export function advanceGLR(): void {
  while (activeHeadsCount > 0) {
    // 1. Find minimum byte offset frontier across all active heads
    let frontierPos: u32 = 0xffffffff;
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let h = changetype<ParseHead>(t_activeHeads[i]);
      if (h.pos < frontierPos) {
        frontierPos = h.pos;
      }
    }
    if (frontierPos == 0xffffffff) break;

    updateExpectedTokens();

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
      let oldPos = frontierPos;
      let oldSrcLexPos = srcLexPos;

      if (frontierPos >= g_editNewEnd) {
        oldPos = g_editOldEnd + (frontierPos - g_editNewEnd);
      } else if (frontierPos >= g_editStart) {
        oldPos = 0xffffffff;
      }

      if (srcLexPos >= g_editNewEnd) {
        oldSrcLexPos = g_editOldEnd + (srcLexPos - g_editNewEnd);
      } else if (srcLexPos >= g_editStart) {
        oldSrcLexPos = 0xffffffff;
      }

      let headSym: u32 = 0xffffffff;
      if (head != null && head.astNode != 0) headSym = getNodeType(head.astNode) as u32;

      let reusedNode: u32 = 0;
      let expectedPadding: u32 = srcLexPos > frontierPos ? srcLexPos - frontierPos : 0;
      if (oldSrcLexPos != 0xffffffff) {
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
          let freshReuse = deepCloneSubtree(reusedNode, 0);
          if (freshReuse != 0) reusedNode = freshReuse;
          setNodePadding(reusedNode, expectedPadding);
        }
      }

      if (reusedNode != 0) {
        let nodeSym = getNodeType(reusedNode) as i32;
        let totalPadding = expectedPadding;

        let nextState = -1;
        let nodeType = getNodeType(reusedNode);
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

      while (reductionGuard++ < 100 && !didAct) {
        let actionOffset = action_offsets[head.state];
        if (actionOffset < 0 || actionOffset >= action_data.length) break;

        let actCount = action_data[actionOffset];
        let idx = actionOffset + 1;
        let foundTok = false;
        let shiftTarget = -1;
        let isAccept = false;
        let reduceProd = -1;

        // Pass 1: exact match for sym == tok
        for (let a = 0; a < actCount; a++) {
          let sym = action_data[idx++];
          let numActions = action_data[idx++];
          if (sym == tok) {
            foundTok = true;
            for (let na = 0; na < numActions; na++) {
              let aType = action_data[idx++];
              let aTarget = action_data[idx++];
              if (aType == ACTION_SHIFT && shiftTarget == -1) shiftTarget = aTarget;
              else if (aType == ACTION_ACCEPT) isAccept = true;
              else if (aType == ACTION_REDUCE && reduceProd == -1) reduceProd = aTarget;
            }
          } else {
            idx += numActions * 2;
          }
        }

        // Pass 2: wildcard match sym == 0 if no exact match found
        if (!foundTok) {
          idx = actionOffset + 1;
          for (let a = 0; a < actCount; a++) {
            let sym = action_data[idx++];
            let numActions = action_data[idx++];
            if (sym == 0) {
              for (let na = 0; na < numActions; na++) {
                let aType = action_data[idx++];
                let aTarget = action_data[idx++];
                if (aType == ACTION_SHIFT && shiftTarget == -1) shiftTarget = aTarget;
                else if (aType == ACTION_ACCEPT) isAccept = true;
                else if (aType == ACTION_REDUCE && reduceProd == -1) reduceProd = aTarget;
              }
            } else {
              idx += numActions * 2;
            }
          }
        }

        // Pass 3: Default reduction if state has only reductions and no shifts
        if (shiftTarget == -1 && !isAccept && reduceProd == -1) {
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
            reduceProd = candidateReduce;
          }
        }

        if (isAccept) {
          processAcceptAction(head);
          didAct = true;
          break;
        }
        if (shiftTarget != -1) {
          processShiftAction(head, shiftTarget, tok, frontierPos, false, false);
          didAct = true;
          break;
        }
        if (reduceProd != -1) {
          if (head.state == 0 && prod_lengths[reduceProd] == 0 && tok != TOKEN_EOF) {
            break;
          }
          let reducedHead = processReduceAction(head, reduceProd, frontierPos);
          if (reducedHead != null) {
            head = reducedHead;
            continue;
          }
        }
        break;
      }

      if (!didAct) {
        if (tok != TOKEN_EOF) {
          if (configEnableBranchB && head.consecutiveInsertions < 3) {
            recoverMissingToken(head, tok, frontierPos);
          }
          if (head.errorCost < 500 && head.prev != null) {
            recoverStackSummary(head, tok, frontierPos);
          }
          if (configEnableBranchA1) {
            recoverSkipToken(head, tok, frontierPos);
          }
        }
      }
    }

    // 3. Condense and prune next heads
    if (nextHeadsCount > MAX_PARALLEL_HEADS) {
      for (let i: u32 = 0; i < nextHeadsCount - 1; i++) {
        let bestIdx = i;
        let hi = changetype<ParseHead>(t_nextHeads[i]);
        let bestCost = hi.errorCost > (hi.successfulShifts * 15) ? hi.errorCost - (hi.successfulShifts * 15) : 0;
        let bestPrec = hi.dynamicPrec;
        for (let j: u32 = i + 1; j < nextHeadsCount; j++) {
          let hj = changetype<ParseHead>(t_nextHeads[j]);
          let hjCost = hj.errorCost > (hj.successfulShifts * 15) ? hj.errorCost - (hj.successfulShifts * 15) : 0;
          if (hjCost < bestCost || (hjCost == bestCost && hj.dynamicPrec > bestPrec)) {
            bestIdx = j;
            bestCost = hjCost;
            bestPrec = hj.dynamicPrec;
          }
        }
        if (bestIdx != i) {
          let tmp = t_nextHeads[i];
          t_nextHeads[i] = t_nextHeads[bestIdx];
          t_nextHeads[bestIdx] = tmp;
        }
      }
      nextHeadsCount = MAX_PARALLEL_HEADS;
    }

    // 4. Swap buffers and advance
    swapActiveAndNextHeads();
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
export function parse(oldTree: u32, editStart: u32, editOldEnd: u32, editNewEnd: u32): u32 {
  g_editStart = editStart;
  g_editOldEnd = editOldEnd;
  g_editNewEnd = editNewEnd;
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
      memory.fill(expected_tokens, 1, 2048);

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
    return root;
  }
  globalAstRoot = 0;
  debugLog(9003, 0, 999999, errorCount);
  return 0;
}
function clearSubtreeErrorFlags(nodePtr: u32): void {
  if (nodePtr == 0) return;
  let typeFlags = getNodeFlags(nodePtr);
  if (getNodeType(nodePtr) != 0) {
    setNodeFlags(nodePtr, (typeFlags & ~((FLAG_HAS_ERROR | FLAG_IS_TAINED) as u32)) as u16);
  }
  let child = getNodeFirstChild(nodePtr);
  while (child != 0) {
    clearSubtreeErrorFlags(child);
    child = getNodeNextSibling(child);
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

  let savedDepth = globalCursorDepth;
  let savedOffset = cursorContentStartStack[globalCursorDepth];

  let startNode = cursorNodeStack[globalCursorDepth];
  let startSrc = cursorContentStartStack[globalCursorDepth];
    if (startSrc > targetSrcOldPos) {
      // Restore cursor state before early exit
      globalCursorDepth = savedDepth;
      if (savedDepth >= 0) {
        cursorContentStartStack[savedDepth] = savedOffset;
      }
      return 0;
    }

    let searching = true;
  while (searching) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    if (globalCursorDepth == 0 && getNodeFirstChild(cPtr) != 0) {
      if (!globalCursorGotoFirstChild()) {
        searching = false;
        continue;
      }
      cPtr = cursorNodeStack[globalCursorDepth];
    }
    let absContentStart = cursorContentStartStack[globalCursorDepth];
    let pad = getNodePadding(cPtr);
    let typeFlags = getNodeFlags(cPtr);
    let byteLen = getNodeByteLength(cPtr);
    let absContentEnd = absContentStart + byteLen;
    let nodeType = getNodeType(cPtr);

    if (absContentEnd <= targetSrcOldPos) {
      if (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) searching = false;
        else {
          while (!globalCursorGotoNextSibling()) {
            if (!globalCursorGotoParent()) {
              searching = false;
              break;
            }
          }
        }
      }
      continue;
    }

    if (absContentStart > targetSrcOldPos) {
      searching = false;
      continue;
    }

    if (absContentStart == targetSrcOldPos && absContentEnd > targetSrcOldPos) {
      if (
        absContentEnd <= editStart ||
        absContentStart >= editOldEnd
      ) {
        let isError = nodeType == 0;
        let isMissing = byteLen == 0 && getNodeFirstChild(cPtr) == 0 && pad == 0;
        let nodeEnvHash = getNodeEnvHash(cPtr) & 0xff;
        let nodeStartState = getNodeStartState(cPtr);
        let canReuse = (!isError && !isMissing && nodeEnvHash == envHash);
        if (canReuse && nodeType > (MAX_TERMINAL_ID as u16)) {
          let validState = nodeStartState == (currentState as u32);
          if (!validState && (currentState as i32) < goto_offsets.length) {
            let gOffset = goto_offsets[currentState];
            if (gOffset >= 0 && gOffset < goto_data.length) {
              let gCount = goto_data[gOffset];
              for (let gi = 0; gi < gCount; gi++) {
                let gSym = goto_data[gOffset + 1 + gi * 2];
                if (gSym == nodeType) {
                  validState = true;
                  break;
                }
              }
            }
          }
          if (validState) {
            let hasErrorFlags = (typeFlags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED)) != 0;
            if (!hasErrorFlags && !nodeHasAnyErrors(cPtr)) {
              return cPtr;
            }
          }
        }
      }
    }

    if (!globalCursorGotoFirstChild()) {
      if (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) searching = false;
        else {
          while (!globalCursorGotoNextSibling()) {
            if (!globalCursorGotoParent()) {
              searching = false;
              break;
            }
          }
        }
      }
    }
  }
  
  globalCursorDepth = savedDepth;
  if (savedDepth >= 0) {
    cursorContentStartStack[savedDepth] = savedOffset;
  }
  return 0;
}
