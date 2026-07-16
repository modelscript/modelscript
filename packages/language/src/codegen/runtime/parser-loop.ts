
import {
    initGSS,
    ParseHead, t_activeHeads, activeHeadsCount, pushActiveHead, allocParseHead,
    globalCursorDepth, cursorNodeStack, cursorOffsetStack, globalCursorGotoNextSibling, globalCursorGotoParent, globalCursorGotoFirstChild
} from "./gss";
import { 
    allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeByteLength, getNodeFirstChild,
    getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding,
    setNodeByteLength, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_LIST_BOUNDARY, FLAG_HAS_ERROR, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_IS_SHARED,
    getNodeEnvHash, getInputBuffer,
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
    prod_lengths, prod_lhs, prod_is_structural, prod_is_invisible, prod_is_list, prod_dynamic_prec, prod_aliases, alias_data,
    type_fields, type_field_data,
    MAX_ERRORS, MAX_PARALLEL_HEADS, INFINITE_COST, MAX_CHILD_NODES, MIN_LOOP_LIMIT, ARENA_BUFFER_SIZE,
    MAX_LOOKAHEAD_DEPTH, MAX_AST_TRAVERSAL_DEPTH, LOOP_MULTIPLIER_LIMIT, MAX_PANIC_SCAN_TOKENS,
    PENALTY_UNWIND_NODE, PENALTY_SYNC_TOKEN,
    CHAR_LBRACE, CHAR_RBRACE, CHAR_LBRACKET, CHAR_RBRACKET, CHAR_LPAREN, CHAR_RPAREN,
    LIST_MAX_CHILDREN, LIST_SPLIT_POINT,
    t_tokenBufferArena, t_tokenBufferLenArena,
    t_lrStateStack, t_lrNodeStack, lrStackDepth,
    t_globalChildNodes, t_globalChildren, t_globalReduceCollected,
    MODE_LR, MODE_GLR, currentParserMode,
    reportGlobalError, debugLog, pushDiagnostic,
    expected_tokens,
    findMergeCandidate, registerMergeCandidate,
    incrementalStartOffset,
    TOKEN_SUSPEND, releaseFieldCursor,
    globalIsCatastrophic, commitDiagnostics,
    lastBestCost, lastIterCount, lastMaxHeads,
    tokenBufferReadIdx, tokenBufferWriteIdx,
    isSuspended, tokenBufferLastPos,
    globalLoopIterations, globalLoopGuard,
    globalSearchIterations, mergeGeneration,
    tempActions, mergeTableInit, initGlobalCursor, errorCount,
    MAX_LR_STACK_DEPTH, FieldCursor, MAX_TERMINAL_ID
} from "./engine";

const configEnableBranchA1 = true;
const configEnableBranchA2 = false;
const configEnableBranchB = true;
const configEnableBranchC = true;
const configEnableIslandMode = true;
const ACCEPT_CACHE_CAPACITY: u32 = 16384;
const ACCEPT_CACHE_MASK: u32 = 16383;
const ACCEPT_CACHE_PROBE_LIMIT: u32 = 8;
let t_acceptCache: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
import { recoverUnwindAndMutate, recoverIslandMode } from "./recovery";
import { initQueryArena, resetQueryArena, clearDiagnostics } from "./graph";

function lookupActions(state: i32, token: i32): i32 {
  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) {
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
    tempActions = changetype<UnmanagedUint32Array>(atomicChunkAlloc(16 * sizeof<u32>()));
  }
  let actCount = action_data[matchIdx + 1];
  let actPtr = matchIdx + 2;
  let count = actCount < 8 ? actCount : 8;
  for (let i = 0; i < count; i++) {
    tempActions[i * 2] = action_data[actPtr + i * 2];
    tempActions[i * 2 + 1] = action_data[actPtr + i * 2 + 1];
  }
  return count;
}

function actionLookupFnBool(state: i32, token: i32): boolean {
  return lookupActions(state, token) != 0;
}

function stateCanAcceptFnBool(state: i32, token: i32): boolean {
  return stateCanAccept(null, state, token) > 0;
}
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
    prevHead.pendingPadding = pendingPadding;
    activeHeadsCount = 0;
    t_activeHeads[activeHeadsCount++] = changetype<u32>(prevHead);
    activeHeadsCount = 1;
  }
  
  currentParserMode = MODE_GLR;
}
function parseLR(): u32 {
  let pos: u32 = 0;
  let token: i32 = 0;
  let pendingPadding: u32 = 0;
  
  t_lrStateStack[0] = 0;
  t_lrNodeStack[0] = 0;
  lrStackDepth = 1;
  
  updateExpectedTokens();
  token = invokeLexer(pos);
  while (load<u8>(is_extra_token + token) == 1) {
    pendingPadding += lexLen;
    pos += lexLen;
    token = invokeLexer(pos);
  }
  
  while (currentParserMode == MODE_LR) {
    let currentState = t_lrStateStack[(lrStackDepth - 1)] as i32;
    let actionCount = lookupActions(currentState, token);
    
    if (actionCount == 0 || actionCount > 1) {
      transitionToGlr(pos, pendingPadding, currentScannerState);
      return 0;
    }
    
    let type = tempActions[0];
    let target = tempActions[1] as i32;
    
    if (type == ACTION_SHIFT) {
      let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + pendingPadding;
      let leaf = allocNode(token as u16, paddingLength, lexLen, 0);
      
      t_lrStateStack[lrStackDepth] = target;
      t_lrNodeStack[lrStackDepth] = leaf;
      lrStackDepth++;
      
      pos = srcLexPos + lexLen;
      
      updateExpectedTokens();
      token = invokeLexer(pos);
      while (load<u8>(is_extra_token + token) == 1) {
        pendingPadding += lexLen;
        pos += lexLen;
        token = invokeLexer(pos);
      }
      
    } else if (type == ACTION_REDUCE) {
      let reduceProd = target;
      let popCount = prod_lengths[reduceProd] as i32;
      let lhsSym = prod_lhs[reduceProd];
      
      lrStackDepth -= popCount;
      let childStartIdx = lrStackDepth;
      
      let totalByteLength: u32 = 0;
      let firstChildPadding: u32 = 0;
      if (popCount > 0) {
        firstChildPadding = getNodePadding(t_lrNodeStack[childStartIdx]);
        for (let k = 0; k < popCount; k++) {
          let child = t_lrNodeStack[(childStartIdx + k)];
          let cPadding = getNodePadding(child);
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
function updateExpectedTokens(): void {
  if (expected_tokens == 0) {
    expected_tokens = atomicChunkAlloc(2048);
  }
  memory.fill(expected_tokens, 0, 2048);
  if (currentParserMode == MODE_LR) {
    if (lrStackDepth > 0) {
      let state = t_lrStateStack[lrStackDepth - 1] as i32;
      let actionOffset = action_offsets[state];
      if (actionOffset >= 0) {
        let actionCount = action_data[actionOffset];
        let idx = actionOffset + 1;
        for (let j = 0; j < actionCount; j++) {
          let sym = action_data[idx++];
          if (sym < 2048) store<u8>(expected_tokens + sym, 1);
          let actCount = action_data[idx++];
          idx += actCount * 2;
        }
      }
    }
  } else {
    for (let i: u32 = 0; i < activeHeadsCount; i++) {
      let head = changetype<ParseHead>(t_activeHeads[i]);
      let state = head.state;
      let actionOffset = action_offsets[state];
      let actionCount = 0;
      let idx = 0;
  
      if (actionOffset >= 0) {
        actionCount = action_data[actionOffset];
        idx = actionOffset + 1;
      }
  
      for (let j = 0; j < actionCount; j++) {
        let sym = action_data[idx++];
        if (sym < 2048) store<u8>(expected_tokens + sym, 1);
        let actCount = action_data[idx++];
        idx += actCount * 2;
      }
    }
  }
}
function acceptCacheHash(key: u64): u32 {
  return 0;
}
function acceptCacheGet(key: u64): i32 {
  return -1;
}
function acceptCacheSet(key: u64, result: i32): void {
}
function acceptCacheClear(): void {
}

export let t_stateReachability: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
export let t_stateReachabilityComputed: UnmanagedUint8Array = changetype<UnmanagedUint8Array>(0);
let computingReachability = false;

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

export function stateCanAccept(head: ParseHead | null, state: i32, tok: i32, depth: i32 = 0): i32 {
  if (depth > 50) return 0;
  if (state < 0 || state >= action_offsets.length) return 0;
  if (head == null && !computingReachability) {
    if (!isEpsilonReachable(state, tok)) return 0;
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
          
          let pHead = head;
          let remCounter = ruleLen;
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
          
          let topState = pHead != null ? pHead.state : -1;
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
            let res = stateCanAccept(pHead, nextState, tok, depth + 1);
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
function deepCloneSubtree(node: u32, depth: i32): u32 {
  if (node == 0 || depth > 50) return 0;
  let clone = allocNode(getNodeType(node), getNodePadding(node), getNodeByteLength(node), getNodeEnvHash(node));
  setNodeFlags(clone, getNodeFlags(node) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));

  let lastChild: u32 = 0;
  let child = getNodeFirstChild(node);
  let guard: u32 = 0;
  while (child != 0 && guard < 10000) {
    guard++;
    let childClone = deepCloneSubtree(child, depth + 1);
    if (childClone != 0) {
      if (lastChild == 0) setFirstChild(clone, childClone);
      else setNextSibling(lastChild, childClone);
      lastChild = childClone;
    }
    child = getNodeNextSibling(child);
  }
  return clone;
}

let t_sanitizeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_sanitizeVisited: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

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

    while (child != 0 && siblingGuard < 10000) {
      siblingGuard++;
      let childType = getNodeType(child);
      let nextSib = getNodeNextSibling(child);

      if (childType > (SYMBOL_COUNT as u16) && childType != TOKEN_EOF) {
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

    while (curr) {
      if (curr.astNode != 0 && curr.astNode != acceptedNode && curr.astNode != acceptBase && getNodeType(curr.astNode) != TOKEN_EOF) {
      if (c_idx < (MAX_CHILD_NODES as u32)) {
        t_globalChildNodes[c_idx++] = curr.astNode;
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
    
    if (!isNodeGen2(acceptedNode)) {
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
    
    fixNodeLength(acceptedNode);
  }
  return acceptedNode;
}

function wrapWithTrailingErrors(acceptedNode: u32): u32 {
  let nodeSpan = getNodePadding(acceptedNode) + getNodeByteLength(acceptedNode);
  
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

    lexP = srcLexPos + tLen;
  }

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  let newRoot = allocNode(NODE_TYPE_ERROR, 0, inputLength, 0);
  setNodeFlags(newRoot, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  if (!isNodeGen2(acceptedNode)) {
    acceptedNode = cloneNodeShallow(acceptedNode);
  }
  setFirstChild(newRoot, acceptedNode);
  setNextSibling(acceptedNode, errorNode);
  return newRoot;
}
export function cloneNodeShallow(gc: u32): u32 {
  if (gc == 0) return 0;
  setNodeFlags(gc, getNodeFlags(gc) | FLAG_EXTRACTED);
  let clone = allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc));
  // Keep FLAG_EXTRACTED on the clone so its shared children are not mutated in-place
  setNodeFlags(clone, (getNodeFlags(gc) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED)); 
  setFirstChild(clone, getNodeFirstChild(gc)); // Keep original children
  return clone;
}
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
function copyChildren(p: u32, leftNode: u32): u32 {
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  while (gc != 0) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) setFirstChild(p, clone);
    else setNextSibling(lastChild, clone);
    lastChild = clone;
    gc = getNodeNextSibling(gc);
  }
  return lastChild;
}
function fixNodeLength(node: u32): void {
  let gc = getNodeFirstChild(node);
  if (gc == 0) return;

  let totalLen = getNodePadding(gc) + getNodeByteLength(gc);
  gc = getNodeNextSibling(gc);

  while (gc != 0) {
    totalLen += getNodePadding(gc) + getNodeByteLength(gc);
    gc = getNodeNextSibling(gc);
  }
  
  setNodeByteLength(node, totalLen);
}
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

export function concatLists(leftNode: u32, rightNode: u32, listSym: u16, envHash: u32): u32 {
  _listRecurDepth++;
  // Cycle detection guard
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    return cloneNodeShallow(rightNode); // bail: cycle detected
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
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
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
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
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

      let cloneRight = allocNode(listSym, getNodePadding(rightNode), 0, envHash);
      setNodeFlags(cloneRight, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let total = lDirectChildCount + rDirectChildCount;
      let leftHalf = total / 2;

      let gc = getNodeFirstChild(leftNode);
      let rc = getNodeFirstChild(rightNode);

      let lastChild = 0;
      for (let i = 0; i < (leftHalf as i32); i++) {
        let curr: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        if (lastChild == 0) setFirstChild(cloneLeft, clone);
        else setNextSibling(lastChild, clone);
        setNextSibling(clone, 0);
        lastChild = clone;
      }
      fixNodeLength(cloneLeft);

      lastChild = 0;
      for (let i = leftHalf as i32; i < (total as i32); i++) {
        let curr: u32 = 0;
        if (gc != 0) {
          curr = gc;
          gc = getNodeNextSibling(gc);
        } else {
          curr = rc;
          rc = getNodeNextSibling(rc);
        }
        let clone = cloneNodeShallow(curr);
        if (i == leftHalf && cloneRight != 0 && curr == rc) {
           // If the first child of cloneRight came from rightNode, it might need rightNode's padding!
           // But cloneRight already has rightNode's padding! So clone gets pad=0.
           // Actually, if it's the first child, it shouldn't have double padding.
        }
        if (lastChild == 0) setFirstChild(cloneRight, clone);
        else setNextSibling(lastChild, clone);
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
      setNextSibling(c2, 0);
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
function isMutable(ptr: u32): boolean {
  // In GLR mode (multiple active heads), never mutate in-place:
  // shared list nodes can be referenced by multiple heads, and
  // mutating one corrupts the others' trees.
  // Note: The current head is popped from the queue during evaluation,
  // so if activeHeadsCount > 0, it means there is at least one OTHER head.
  if (activeHeadsCount > 0) return false;
  if ((getNodeFlags(ptr) & (FLAG_EXTRACTED | FLAG_IS_SHARED)) != 0) return false;
  return ptr >= incrementalStartOffset;
}
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
        if (lastChild == 0) setFirstChild(p, leaf);
        else setNextSibling(lastChild, leaf);
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


  if (isMutable(leftNode)) {
    let prevOfRightMost = 0;
    let rightMost = getNodeFirstChild(leftNode);
    let allChildrenMutable = true;
    while (getNodeNextSibling(rightMost) != 0) {
      prevOfRightMost = rightMost;
      rightMost = getNodeNextSibling(rightMost);
    }
    
    // CRITICAL FIX: Even if the list node itself is mutable, if its children
    // have been extracted (shared with another clone), we cannot mutate
    // the last child's nextSibling pointer in-place!
    if ((getNodeFlags(rightMost) & FLAG_EXTRACTED) != 0 || 
        (prevOfRightMost != 0 && (getNodeFlags(prevOfRightMost) & FLAG_EXTRACTED) != 0)) {
       allChildrenMutable = false;
    }

    if (allChildrenMutable) {
      let newRightMost = appendToList(rightMost, leaf, listSym, envHash, isBoundary);

    let nrDepth = getListDepth(newRightMost, listSym);
    if (nrDepth == lDepth) {
      let origC1 = getNodeFirstChild(newRightMost);
      let origC2 = getNodeNextSibling(origC1);

      let c1 = isMutable(origC1) ? origC1 : cloneNodeShallow(origC1);
      let c2 = isMutable(origC2) ? origC2 : cloneNodeShallow(origC2);

      if (directChildCount < LIST_MAX_CHILDREN || !isBoundary) {
        if (prevOfRightMost == 0) setFirstChild(leftNode, c1);
        else setNextSibling(prevOfRightMost, c1);
        setNextSibling(c1, c2);
        setNextSibling(c2, 0);
        setNodeFlags(leftNode, getNodeFlags(leftNode) | combinedErrorFlag);
        fixNodeLength(leftNode);
        _listRecurDepth--;
        return leftNode;
      } else {
        // Split leftNode in-place
        let splitTail = getNodeFirstChild(leftNode);
        for (let i = 0; i < LIST_SPLIT_POINT - 1; i++) {
          if (getNodeNextSibling(splitTail) == 0) break;
          splitTail = getNodeNextSibling(splitTail);
        }
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

        // Find the node before rightMost in the rightChunk sublist
        let curr = splitHead;
        while (getNodeNextSibling(curr) != rightMost && getNodeNextSibling(curr) != 0) {
          curr = getNodeNextSibling(curr);
        }
        if (curr == rightMost) {
          setFirstChild(rightChunk, c1);
          setNextSibling(c1, c2);
          setNextSibling(c2, 0);
        } else {
          setNextSibling(curr, c1);
          setNextSibling(c1, c2);
          setNextSibling(c2, 0);
        }
        fixNodeLength(rightChunk);
  

        let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
        setFirstChild(superP, leftNode);
        setNextSibling(leftNode, rightChunk);
        setNextSibling(rightChunk, 0);
        fixNodeLength(superP);

        _listRecurDepth--;
        return superP;
      }
    } else {
      if (prevOfRightMost == 0) setFirstChild(leftNode, newRightMost);
      else setNextSibling(prevOfRightMost, newRightMost);
      setNextSibling(newRightMost, 0);
      setNodeFlags(leftNode, getNodeFlags(leftNode) | combinedErrorFlag);
      fixNodeLength(leftNode);
      _listRecurDepth--;
      }
    }
  }
  
  // If we reach here, we must clone the list and its children to avoid mutating shared state.
  {
    let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
    let gc = getNodeFirstChild(leftNode);
    let lastChild = 0;
    for (let i = 0; i < directChildCount - 1; i++) {
      let clone = cloneNodeShallow(gc);
      if (lastChild == 0) setFirstChild(p, clone);
      else setNextSibling(lastChild, clone);
      setNextSibling(clone, 0);
      lastChild = clone;
      gc = getNodeNextSibling(gc);
    }

    let rightMost = gc;
    let newRightMost = appendToList(rightMost, leaf, listSym, envHash, isBoundary);

    let nrDepth = getListDepth(newRightMost, listSym);
    if (nrDepth == lDepth) {
      let origC1 = getNodeFirstChild(newRightMost);
      let origC2 = getNodeNextSibling(origC1);

      let c1 = cloneNodeShallow(origC1);
      let c2 = cloneNodeShallow(origC2);

      if (directChildCount < LIST_MAX_CHILDREN || !isBoundary) {
        if (lastChild == 0) setFirstChild(p, c1);
        else setNextSibling(lastChild, c1);
        setNextSibling(c1, c2);
        setNextSibling(c2, 0);
        setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
        fixNodeLength(p);
        _listRecurDepth--;
        return p;
      } else {
        let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        let gc2 = getNodeFirstChild(leftNode);
        let splitTail = gc2;
        for (let i = 0; i < LIST_SPLIT_POINT - 1; i++) {
          if (getNodeNextSibling(splitTail) == 0) break;
          splitTail = getNodeNextSibling(splitTail);
        }
        while (getNodeNextSibling(splitTail) != 0 && (getNodeFlags(splitTail) & FLAG_LIST_BOUNDARY) == 0) {
          splitTail = getNodeNextSibling(splitTail);
        }

        let actualSplitCount = 0;
        let curr = gc2;
        while (curr != 0) {
          actualSplitCount++;
          if (curr == splitTail) break;
          curr = getNodeNextSibling(curr);
        }

        let lastChild2 = 0;
        for (let i = 0; i < actualSplitCount; i++) {
          let clone = cloneNodeShallow(gc2);
          if (lastChild2 == 0) setFirstChild(p, clone);
          else setNextSibling(lastChild2, clone);
          setNextSibling(clone, 0);
          lastChild2 = clone;
          if (gc2 == splitTail) {
            gc2 = getNodeNextSibling(gc2);
            break;
          }
          gc2 = getNodeNextSibling(gc2);
        }
        fixNodeLength(p);

        let splitHead = gc2;
        let newRightChunk = allocNode(listSym, getNodePadding(splitHead), 0, envHash);
        setNodeFlags(newRightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        lastChild2 = 0;
        while (gc2 != rightMost && gc2 != 0) {
          let clone = cloneNodeShallow(gc2);
          if (lastChild2 == 0) {
            setNodePadding(clone, 0); // Avoid double padding!
            setFirstChild(newRightChunk, clone);
          } else {
            setNextSibling(lastChild2, clone);
          }
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
}




export function resetSimulator(targetCost: i32, maxTokens: i32): void {
  bestAcceptingHead = 0;
  bestAcceptedCost = targetCost;
  g_simulatorMaxCost = targetCost;
  g_simulatorMaxTokens = maxTokens;
}

let savedLexPos: u32 = 0;
let savedLexLen: u32 = 0;
let savedSrcLexPos: u32 = 0;
let savedCurrentScannerState: i32 = 0;
let savedTokenBufferReadIdx: u32 = 0;
let savedTokenBufferWriteIdx: u32 = 0;
let savedTokenBufferLastPos: u32 = 0;
let savedExpectedTokens = changetype<UnmanagedUint8Array>(atomicChunkAlloc(2048));

let savedSimulatorMaxCost: i32 = 999999;
let savedSimulatorMaxTokens: i32 = 0;
let savedBestAcceptingHead: u32 = 0;
let savedAcceptedNode: u32 = 0;
let savedBestAcceptedCost: i32 = 999999;
let savedBestAcceptedRealBytes: u32 = 0;
let savedBestAcceptedCount: u32 = 0xffffffff;
let savedBestAcceptedPad: u32 = 0xffffffff;

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

  memory.copy(changetype<usize>(savedExpectedTokens), changetype<usize>(expected_tokens), 2048);
}

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

  memory.copy(changetype<usize>(expected_tokens), changetype<usize>(savedExpectedTokens), 2048);
}
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

function processShiftAction(head: ParseHead, target: i32, token: i32, pos: u32, isVirtual: boolean): void {
  let newBalance = head.balanceHash;
  let charLen = peekCharLen(lexPos);
  if (lexLen == charLen) {
    let c = peekChar(lexPos);
    if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
    else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) newBalance--;
  }

  let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
  let leaf = allocNode(token as u16, paddingLength, lexLen, newBalance & 0xff);
  
  let vq0 = head.virtualQueue0;
  let vq1 = head.virtualQueue1;
  let vq2 = head.virtualQueue2;
  let vCount = head.virtualQueueCount;

  if (isVirtual) {
    setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_IS_INSERTED);
    if (vCount > 0) {
      vq0 = (vq0 >>> 16) | ((vq1 & 0xFFFF) << 16);
      vq1 = (vq1 >>> 16) | ((vq2 & 0xFFFF) << 16);
      vq2 = (vq2 >>> 16);
      vCount--;
    }
  }

  let nPos = srcLexPos + lexLen;
  let newCost = head.errorCost;
  let newShifts = head.successfulShifts + 1;
          if (g_simulatorMaxTokens > 0 && newShifts >= g_simulatorMaxTokens) {
            // we will allocate newHead just for saving it.
            let nextConsecutive = isVirtual ? head.consecutiveInsertions : 0;
            let finalHead = allocParseHead(
              target, leaf, head, nPos, currentScannerState, newCost, newShifts, head.balanceHash, nextConsecutive, head.dynamicPrec, 0, head.errorTail,
              vq0, vq1, vq2, vCount
            );
            if (newCost < bestAcceptedCost) {
              bestAcceptedCost = newCost;
              bestAcceptingHead = changetype<u32>(finalHead);
            }
            return; // Stop advancing this head
          }

  let nextConsecutive = isVirtual ? head.consecutiveInsertions : 0;

  let newHead = allocParseHead(
    target, leaf, head, nPos, currentScannerState, newCost, newShifts, newBalance, nextConsecutive, head.dynamicPrec, 0, head.errorTail,
    vq0, vq1, vq2, vCount
  );

  let mergeIdx = findMergeCandidate(newHead.pos, newHead.state, newHead.prev);
  if (mergeIdx >= 0) {
    let ah = changetype<ParseHead>(t_activeHeads[(mergeIdx as u32)]);
    if (
      newHead.errorCost < ah.errorCost ||
      (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
    ) {
      t_activeHeads[(mergeIdx as u32)] = changetype<u32>(newHead);
    }
  } else {
    pushActiveHead(changetype<u32>(newHead));
    registerMergeCandidate(activeHeadsCount - 1, newHead.pos, newHead.state);
  }
}


function processReduceAction(head: ParseHead, reduceProd: i32, pos: u32): boolean {
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
    
    return false;
  }

  let actualCount = 99999 - c_idx;
  for (let k = 0; k < actualCount; k++) {
    t_globalChildNodes[k] = t_globalReduceCollected[c_idx + 1 + k];
  }

  if (curr) {
    let totalByteLength: u32 = 0;
    let firstChildPadding: u32 = 0;
    if (actualCount > 0) {
      firstChildPadding = getNodePadding(t_globalChildNodes[0]);
      for (let k = 0; k < actualCount; k++) {
        let cPadding = getNodePadding(t_globalChildNodes[k]);
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

          let isError = getNodeType(child) == NODE_TYPE_ERROR;
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
        nextState, parentNode, curr, head.pos, currentScannerState, head.errorCost,
        head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
        head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail
      );
      let mergeIdx = findMergeCandidate(newHead.pos, newHead.state, newHead.prev);
      if (mergeIdx >= 0) {
        let ah = changetype<ParseHead>(t_activeHeads[(mergeIdx as u32)]);
        if (
          newHead.errorCost < ah.errorCost ||
          (newHead.errorCost == ah.errorCost && newHead.dynamicPrec > ah.dynamicPrec)
        ) {
          t_activeHeads[(mergeIdx as u32)] = changetype<u32>(newHead);
        }
      } else {
        pushActiveHead(changetype<u32>(newHead));
        registerMergeCandidate(activeHeadsCount - 1, newHead.pos, newHead.state);
      }
      return true;
    } else {
      
      return false;
    }
  }
  return false;
}


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
  if (realBytes == 0) {
    effectiveCost += 10000;
  }
  effectiveCost += (firstPad as i32) * 3;
  effectiveCost += (t_count as i32) * 10; // Penalize fragmented GSS
  
  

  if (
    acceptedNode == 0 ||
    effectiveCost < bestAcceptedCost ||
    (effectiveCost == bestAcceptedCost && realBytes > bestAcceptedRealBytes) ||
    (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad < bestAcceptedPad) ||
    (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad == bestAcceptedPad && t_count < bestAcceptedCount)
  ) {
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
          singleNode = rc.astNode;
          break;
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
      let bestRootBytes: u32 = 0;
      while (t_curr) {
        if (t_curr.astNode != 0) {
          let cType = getNodeType(t_curr.astNode);
          let cLen = getNodeByteLength(t_curr.astNode);
          if (cType != TOKEN_EOF && (cLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
            t_globalChildren[c_idx--] = t_curr.astNode;
            if (cType != NODE_TYPE_ERROR && cLen > bestRootBytes) {
              bestRoot = t_curr.astNode;
              bestRootBytes = cLen;
            }
          }
        }
        t_curr = t_curr.prev;
      }



      if (bestRoot != 0) {
        let newRoot = cloneNodeShallow(bestRoot);
        let acceptedPad2 = getNodePadding(bestRoot);
        let targetLen = t_bytes > acceptedPad2 ? t_bytes - acceptedPad2 : t_bytes;
        let maxLen = inputLength > acceptedPad2 ? inputLength - acceptedPad2 : 0;
        if (targetLen > maxLen) targetLen = maxLen;
        setNodeByteLength(newRoot, targetLen);

        let lastC2: u32 = 0;
        let firstCloned: u32 = 0;
        let appendedError = false;

        for (let i: u32 = 0; i < t_count; i++) {
          let c = t_globalChildren[i];
          if (c == 0) continue;
          
          if (c == bestRoot) {
            let oc = getNodeFirstChild(c);
            while (oc != 0) {
              let cloned = cloneNodeShallow(oc);
              if (firstCloned == 0) firstCloned = cloned;
              if (lastC2 != 0) setNextSibling(lastC2, cloned);
              lastC2 = cloned;
              oc = getNodeNextSibling(oc);
            }
          } else {
            let clone = cloneNodeShallow(c);
            if (lastC2 == 0) firstCloned = clone;
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
      } else {
        let errLen = t_bytes > firstPad ? t_bytes - firstPad : 0;
        let errMaxLen = inputLength > firstPad ? inputLength - firstPad : 0;
        if (errLen > errMaxLen) errLen = errMaxLen;
        let root = allocNode(NODE_TYPE_ERROR, firstPad, errLen, 0);

        let lastC = 0;
        for (let i: u32 = 0; i < t_count; i++) {
          let c = t_globalChildren[i];
          if (c == 0) continue;
          let clone = cloneNodeShallow(c);
          if (lastC == 0) setFirstChild(root, clone);
          else setNextSibling(lastC, clone);
          lastC = clone;
        }
        acceptedNode = root;
      }
    }
  }
}


function processForcedReduction(head: ParseHead, actionOffset: i32, count2: i32): boolean {
  let reduced = false;
  let scanIdx = actionOffset + 1;
  for (let si = 0; si < count2; si++) {
    let scanSym = action_data[scanIdx++];
    let scanActCount = action_data[scanIdx++];
    for (let sj = 0; sj < scanActCount; sj++) {
      let scanType = action_data[scanIdx++];
      let scanTarget = action_data[scanIdx++];

      if (scanType == ACTION_ACCEPT && !reduced) {

        let t_curr2: ParseHead | null = head;
        let t_bytes2: u32 = 0;
        let t_count2: u32 = 0;
        let firstPad2: u32 = 0;
        while (t_curr2) {
          if (t_curr2.astNode != 0) {
            let tNodeType2 = getNodeType(t_curr2.astNode);
            let tNodeLen2 = getNodeByteLength(t_curr2.astNode);
            if (tNodeType2 != TOKEN_EOF && (tNodeLen2 > 0 || getNodeFirstChild(t_curr2.astNode) != 0)) {
              t_bytes2 += getNodePadding(t_curr2.astNode) + tNodeLen2;
              t_count2++;
              firstPad2 = getNodePadding(t_curr2.astNode);
            }
          }
          t_curr2 = t_curr2.prev;
        }

        let realBytes2: u32 = 0;
        {
          let rc2: ParseHead | null = head;
          while (rc2) {
            if (rc2.astNode != 0) {
              let nType2 = getNodeType(rc2.astNode);
              if (nType2 != TOKEN_EOF) {
                realBytes2 += getNodeByteLength(rc2.astNode);
              }
            }
            rc2 = rc2.prev;
          }
        }
        let effectiveCost2: i32 = head.errorCost;
        if (realBytes2 == 0) effectiveCost2 += 10000;
        effectiveCost2 += (firstPad2 as i32) * 3;

        let trailingBytes: u32 = inputLength > head.pos ? inputLength - head.pos : 0;
        if (trailingBytes > 0) {
          effectiveCost2 += 1000 + (trailingBytes as i32) * 15;
        }

        if (t_count2 <= 1) {
          let singleNode2: u32 = 0;
          let rc2: ParseHead | null = head;
          while (rc2) {
            if (rc2.astNode != 0 && getNodeType(rc2.astNode) != TOKEN_EOF) {
              singleNode2 = rc2.astNode;
              break;
            }
            rc2 = rc2.prev;
          }
          if (singleNode2 != 0) {
            if (acceptedNode == 0 || effectiveCost2 < bestAcceptedCost) {
              acceptedNode = cloneNodeShallow(singleNode2);
              bestAcceptedCost = effectiveCost2;
              bestAcceptingHead = changetype<u32>(head);
              bestAcceptedCount = t_count2;
              bestAcceptedPad = firstPad2;
            }
          }
        }
        reduced = true;
      } else if (scanType == ACTION_REDUCE && !reduced) {
        let reduceProd = scanTarget;
        if (reduceProd < 0 || reduceProd >= prod_lengths.length) continue;

        let popCount = prod_lengths[reduceProd];
        let lhsSym = prod_lhs[reduceProd];

        let availableNodes = 0;
        let tempCurr: ParseHead | null = head;
        while (tempCurr != null) {
          if (tempCurr.astNode != 0 && !isPureErrorNode(tempCurr.astNode)) {
            availableNodes++;
          }
          tempCurr = tempCurr.prev;
        }
        
        let missingCount = popCount > availableNodes ? popCount - availableNodes : 0;
        let c_idx2 = 99999;
        
        // 1. Prepend virtual nodes for the missing trailing pieces
        for (let m: i32 = 0; m < missingCount; m++) {
          let virtualNode = allocNode(NODE_TYPE_ERROR, 0, 0, 0);
          setNodeFlags(virtualNode, FLAG_IS_INSERTED);
          t_globalReduceCollected[c_idx2--] = virtualNode;
        }
        
        // 2. Pop the remaining actual nodes from the stack
        let needed = popCount - missingCount;
        let curr: ParseHead | null = head;
        let isList = prod_is_list[reduceProd] == 1;

        while ((needed > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
          if (c_idx2 <= 0) break;
          let astNode = curr.astNode;
          let isPure = astNode != 0 && isPureErrorNode(astNode);
          if (isPure) {
            t_globalReduceCollected[c_idx2--] = astNode;
          } else {
            t_globalReduceCollected[c_idx2--] = astNode;
            if (needed > 0) needed--;
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
              if (getNodeType(c) == 0 || (getNodeFlags(c) & FLAG_HAS_ERROR) != 0) {
                appendedError = true;
              }
            }
            if (appendedError) {
              setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_HAS_ERROR);
            }
          }

          let anchorState = curr != null ? curr.state : 0;
          let gOffset = goto_offsets[anchorState];
          let gCount = goto_data[gOffset];
          let gIdx2 = gOffset + 1;
          let nextState: i32 = -1;
          for (let gi = 0; gi < gCount; gi++) {
            if (goto_data[gIdx2] == lhsSym) {
              nextState = goto_data[gIdx2 + 1];
              break;
            }
            gIdx2 += 2;
          }

          if (nextState != -1) {
            let newHead = allocParseHead(
              nextState, parentNode, curr, head.pos, currentScannerState, head.errorCost + (missingCount * 50),
              head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
              head.dynamicPrec + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail,
              head.virtualQueue0, head.virtualQueue1, head.virtualQueue2, head.virtualQueueCount
            );
            pushActiveHead(changetype<u32>(newHead));
            reduced = true;
          }
      } else if (scanType == ACTION_SHIFT && !reduced && scanSym == TOKEN_EOF) {
        let shiftTarget = scanTarget;
        if (shiftTarget >= 0 && shiftTarget < action_offsets.length) {
          let targetOffset = action_offsets[shiftTarget];
          if (targetOffset >= 0 && targetOffset < action_data.length) {
            let targetCount = action_data[targetOffset];
            let targetIdx = targetOffset + 1;
            for (let ti = 0; ti < targetCount; ti++) {
              let tSym = action_data[targetIdx++];
              let tActCount = action_data[targetIdx++];
              for (let tj = 0; tj < tActCount; tj++) {
                let tType = action_data[targetIdx++];
                let tTarget = action_data[targetIdx++];
                if (tType == ACTION_ACCEPT) {
                  let singleNode3: u32 = 0;
                  let rc3: ParseHead | null = head;
                  while (rc3) {
                    if (rc3.astNode != 0 && getNodeType(rc3.astNode) != TOKEN_EOF) {
                      let nLen3 = getNodeByteLength(rc3.astNode);
                      if (nLen3 > 0 || getNodeFirstChild(rc3.astNode) != 0) {
                        singleNode3 = rc3.astNode;
                        break;
                      }
                    }
                    rc3 = rc3.prev;
                  }
                  if (singleNode3 != 0) {
                    let effectiveCost3: i32 = head.errorCost;
                    let trailingBytes3: u32 = inputLength > head.pos ? inputLength - head.pos : 0;
                    if (trailingBytes3 > 0) {
                      let nonWsCount: u32 = 0;
                      for (let i: u32 = head.pos; i < inputLength; i++) {
                        let ch = peekChar(i);
                        if (ch != 32 && ch != 9 && ch != 10 && ch != 13) nonWsCount++;
                      }
                      if (nonWsCount > 0) {
                        effectiveCost3 += 1000 + (nonWsCount as i32) * 15;
                      }
                    }
                    if (acceptedNode == 0 || effectiveCost3 < bestAcceptedCost) {
                      acceptedNode = cloneNodeShallow(singleNode3);
                      bestAcceptedCost = effectiveCost3;
                      bestAcceptingHead = changetype<u32>(head);
                      bestAcceptedCount = 1;
                      bestAcceptedPad = getNodePadding(singleNode3);
                    }
                  }
                  reduced = true;
                }
              }
            }
          }
        }
      }
    }
  }
  return reduced;
}


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
      let margin: i32 = ah.pos > bestPos ? 1000 : 15;

      if (ah.errorCost <= bestCost + margin && ah.errorCost <= bestAcceptedCost) {
        t_activeHeads[writeIdx++] = changetype<u32>(ah);
      }
    }
    activeHeadsCount = writeIdx;
    activeHeadsTrimCount = activeHeadsCount;
    

    if (bestCost > 0 && bestCost < INFINITE_COST) {
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

  if (activeHeadsTrimCount > 64) {
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
    for (let ei: u32 = 0; ei < sortLimit && heapLen > 1; ei++) {
      heapLen--;
      let tmp = t_activeHeads[ei];
      if (ei < heapLen) {
        t_activeHeads[ei] = t_activeHeads[ei + 1];
      }
    }
    activeHeadsCount = MAX_PARALLEL_HEADS;
  }
}




export let g_editStart: u32 = 0;
export let g_editOldEnd: u32 = 0;
export let g_editNewEnd: u32 = 0;

export function advanceGLR(): void {
  let pos: u32 = 0;
  let token: i32 = 0;
  let maxHeads: u32 = 0;
  let iterGuard: u32 = 0;

  // --------------------------------------------------------------------------
  // Main GSS Processing Loop
  // --------------------------------------------------------------------------
  while (true) {
    lastIterCount = iterGuard;
    mergeGeneration++; // Invalidate all merge index entries from previous iteration
    let inputLen: u32 = inputLength;
    let loopLimit: u32 = inputLen * LOOP_MULTIPLIER_LIMIT;
    if (loopLimit < (MIN_LOOP_LIMIT as u32)) loopLimit = MIN_LOOP_LIMIT as u32;
    if (iterGuard++ > loopLimit) {
      if (activeHeadsCount > 0) {
        bestDyingHead = t_activeHeads[0];
      }
      break;
    }
    if (activeHeadsCount > maxHeads) {
      maxHeads = activeHeadsCount;
      lastMaxHeads = maxHeads;
    }
    globalLoopIterations++;
    globalLoopGuard++;

    let headPtr: u32 = 0;

    if (activeHeadsCount == 0) {
      break;
    } else {
      let minPos: u32 = 0;
      let minIdx = 0;
      let hasErrors = false;
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(t_activeHeads[i]);
        if (h.errorCost > 0) hasErrors = true;
      }
      if (hasErrors && activeHeadsCount > MAX_PARALLEL_HEADS) {
        // Find the absolute frontier (maximum position) among all active heads.
        // This protects heads generated by forward-scanning branches (like Branch A)
        // that have proven they can recover, ensuring they aren't culled by cheaper
        // but less advanced Branch B hallucinations.
        let maxPos: u32 = 0;
        for (let zi: u32 = 0; zi < activeHeadsCount; zi++) {
          let zh = changetype<ParseHead>(t_activeHeads[zi]);
          if (zh.pos > maxPos) maxPos = zh.pos;
        }

        // Partial sort: partition to keep top MAX_PARALLEL_HEADS by cost/pos.
        // First, move all cost=0 AND EOF-reaching heads to the front so they're never dropped.
        let protectedEnd: u32 = 0;
        for (let zi: u32 = 0; zi < activeHeadsCount; zi++) {
          let zh = changetype<ParseHead>(t_activeHeads[zi]);
          if (zh.errorCost == 0 || zh.pos >= inputLength) {
            if (zi != protectedEnd) {
              let tmp = t_activeHeads[protectedEnd];
              t_activeHeads[protectedEnd] = t_activeHeads[zi];
              t_activeHeads[zi] = tmp;
            }
            protectedEnd++;
          }
        }
        // Sort the remaining heads
        let keepCount = MAX_PARALLEL_HEADS > protectedEnd ? MAX_PARALLEL_HEADS - protectedEnd : 0;
        if (keepCount > 0 && activeHeadsCount > protectedEnd + keepCount) {
          // O(H) heapify on the unprotected region [protectedEnd, activeHeadsCount)
          // then extract top-K via repeated sift-down, replacing O(K*H) selection sort
          let heapStart = protectedEnd;
          let heapLen = activeHeadsCount - heapStart;
          // Build min-heap by errorCost (ascending), breaking ties by pos (descending)
          for (let hi: i32 = (heapLen as i32) / 2 - 1; hi >= 0; hi--) {
            let ci: u32 = hi as u32;
            while (true) {
              let smallest = ci;
              let left = ci * 2 + 1;
              let right = ci * 2 + 2;
              if (left < heapLen) {
                let hL = changetype<ParseHead>(t_activeHeads[(heapStart + left)]);
                let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                let costL: i32 = hL.errorCost - (hL.pos == maxPos ? 10000 : 0);
                let costS: i32 = hS.errorCost - (hS.pos == maxPos ? 10000 : 0);
                if (costL < costS || (costL == costS && hL.pos > hS.pos)) smallest = left;
              }
              if (right < heapLen) {
                let hR = changetype<ParseHead>(t_activeHeads[(heapStart + right)]);
                let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                let costR: i32 = hR.errorCost - (hR.pos == maxPos ? 10000 : 0);
                let costS: i32 = hS.errorCost - (hS.pos == maxPos ? 10000 : 0);
                if (costR < costS || (costR == costS && hR.pos > hS.pos)) smallest = right;
              }
              if (smallest == ci) break;
              let tmp = t_activeHeads[heapStart + ci];
              t_activeHeads[heapStart + ci] = t_activeHeads[heapStart + smallest];
              t_activeHeads[(heapStart + smallest)] = tmp;
              ci = smallest;
            }
          }
          // Extract top-keepCount elements from the heap into a temporary array
          let extracted = new Array<u32>(keepCount);
          for (let ei: u32 = 0; ei < keepCount && heapLen > 0; ei++) {
            // The root of the heap is the smallest element
            extracted[ei] = t_activeHeads[heapStart];
            
            // Move the last element to the root and shrink the heap
            let lastIdx = heapStart + heapLen - 1;
            t_activeHeads[heapStart] = t_activeHeads[lastIdx];
            heapLen--;
            
            // Sift down the new root
            let ci: u32 = 0;
            while (true) {
              let smallest = ci;
              let left = ci * 2 + 1;
              let right = ci * 2 + 2;
              if (left < heapLen) {
                let hL = changetype<ParseHead>(t_activeHeads[(heapStart + left)]);
                let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                let costL: i32 = hL.errorCost - (hL.pos == maxPos ? 10000 : 0);
                let costS: i32 = hS.errorCost - (hS.pos == maxPos ? 10000 : 0);
                if (costL < costS || (costL == costS && hL.pos > hS.pos)) smallest = left;
              }
              if (right < heapLen) {
                let hR = changetype<ParseHead>(t_activeHeads[(heapStart + right)]);
                let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                let costR: i32 = hR.errorCost - (hR.pos == maxPos ? 10000 : 0);
                let costS: i32 = hS.errorCost - (hS.pos == maxPos ? 10000 : 0);
                if (costR < costS || (costR == costS && hR.pos > hS.pos)) smallest = right;
              }
              if (smallest == ci) break;
              let t2 = t_activeHeads[heapStart + ci];
              t_activeHeads[heapStart + ci] = t_activeHeads[heapStart + smallest];
              t_activeHeads[(heapStart + smallest)] = t2;
              ci = smallest;
            }
          }
          
          // Copy the extracted elements back to the active heads array
          for (let ei: u32 = 0; ei < keepCount; ei++) {
            t_activeHeads[heapStart + ei] = extracted[ei];
          }
        }
        activeHeadsCount =
          protectedEnd + keepCount > MAX_PARALLEL_HEADS ? protectedEnd + keepCount : MAX_PARALLEL_HEADS;
        if (activeHeadsCount > MAX_PARALLEL_HEADS + 16) activeHeadsCount = MAX_PARALLEL_HEADS + 16; // Safety cap
      }
      minPos = 0;
      minIdx = 0;
      for (let i: u32 = 0; i < activeHeadsCount; i++) {
        let h = changetype<ParseHead>(t_activeHeads[i]);
        if (h.pos >= inputLength) {
          minIdx = i;
          break;
        }
        if (i == 0 || h.pos < minPos) {
          minPos = h.pos;
          minIdx = i;
        }
      }
      headPtr = t_activeHeads[minIdx];
      t_activeHeads[minIdx] = t_activeHeads[activeHeadsCount - 1];
      activeHeadsCount -= 1;
    }
    let head = changetype<ParseHead>(headPtr);

    if (g_simulatorMaxCost < 999999 && head.errorCost > g_simulatorMaxCost) {
      continue;
    }

    // Dump all active heads (using op 7 for queue trace)
    for (let k: u32 = 0; k < activeHeadsCount; k++) {
      let qh = changetype<ParseHead>(t_activeHeads[k]);
      
    }

    pos = head.pos;
    

    currentScannerState = head.scannerState;
    lexPos = pos;

    // Token Buffer Arena Consumption
    // Advance buffer read index only if we have moved past the previous buffer token
    if (pos > tokenBufferLastPos && tokenBufferReadIdx < tokenBufferWriteIdx) {
      // If position jumped forward (e.g., island recovery), invalidate the buffer
      // to prevent serving stale tokens from the old position.
      if (pos > tokenBufferLastPos + 4) {
        tokenBufferReadIdx = tokenBufferWriteIdx; // flush buffer
      } else {
        tokenBufferReadIdx++;
      }
    }

    let is_current_token_virtual = false;
    if (head.virtualQueueCount > 0) {
      token = head.virtualQueue0 & 0xFFFF;
      lexLen = 0;
      is_current_token_virtual = true;
    } else if (tokenBufferReadIdx < tokenBufferWriteIdx) {
      let rIdx = tokenBufferReadIdx & (ARENA_BUFFER_SIZE - 1);
      token = t_tokenBufferArena[rIdx];
      lexLen = t_tokenBufferLenArena[rIdx];
      tokenBufferLastPos = pos;
    } else {
      updateExpectedTokens();
      // Also include the current head's expected tokens.
      // The head was popped from activeHeads, so updateExpectedTokens() doesn't
      // see it. Without this, island recovery heads that are the sole remaining
      // head get empty expected_tokens, causing keywords to lex as identifiers.
      {
        let hState = head.state;
        let hOff = action_offsets[hState];
        if (hOff >= 0) {
          let hCount = action_data[hOff];
          let hIdx = hOff + 1;
          for (let hj = 0; hj < hCount; hj++) {
            let hSym = action_data[hIdx++];
            if (hSym < 2048) store<u8>(expected_tokens + hSym, 1);
            let hActCount = action_data[hIdx++];
            hIdx += hActCount * 2;
          }
        }
      }
      
      token = invokeLexer(pos);
      while (load<u8>(is_extra_token + token) == 1) {
        head.pendingPadding += lexLen;
        pos += lexLen;
        token = invokeLexer(pos);
      }
      
      if (tokenBufferReadIdx < tokenBufferWriteIdx) {
        let rIdx2 = tokenBufferReadIdx & (ARENA_BUFFER_SIZE - 1);
        token = t_tokenBufferArena[rIdx2];
        lexLen = t_tokenBufferLenArena[rIdx2];
      }
      tokenBufferLastPos = pos;
    }

    if (token == TOKEN_SUSPEND) {
      // Push the head back and yield execution
      pushActiveHead(changetype<u32>(head));
      isSuspended = true;
      if (tokenBufferReadIdx < tokenBufferWriteIdx) {
        tokenBufferReadIdx++;
      }
      return 0xffffffff; // Special yield signal
    }



    let currentState = head.state;
    if (currentState < 0 || currentState >= action_offsets.length) {
      throw new Error("BAD currentState: " + currentState.toString() + " (max " + action_offsets.length.toString() + ")");
    }

    let oldPos = lexPos;
    let oldSrcLexPos = srcLexPos;

    if (lexPos >= g_editNewEnd) {
      oldPos = g_editOldEnd + (lexPos - g_editNewEnd);
    } else if (lexPos >= g_editStart) {
      oldPos = 0xffffffff;
    }

    if (srcLexPos >= g_editNewEnd) {
      oldSrcLexPos = g_editOldEnd + (srcLexPos - g_editNewEnd);
    } else if (srcLexPos >= g_editStart) {
      oldSrcLexPos = 0xffffffff;
    }

    let headSym: u32 = 0xffffffff;
    if (head != null && head.astNode != 0) headSym = getNodeType(head.astNode) as u32;

    // ------------------------------------------------------------------------
    // Structural Node Reuse (Incremental Parsing Phase)
    // ------------------------------------------------------------------------
    let reusedNode: u32 = 0;
    let expectedPadding: u32 = srcLexPos > pos ? srcLexPos - pos : 0;
    if (oldSrcLexPos != 0xffffffff) {
      reusedNode = findReusableNode(
        oldPos,
        oldSrcLexPos,
        currentState,
        head.balanceHash & 0xff,
        g_editStart,
        g_editOldEnd,
        headSym,
        expectedPadding
      );
      if (reusedNode != 0) {
        
      } else {
      }
    }

    if (reusedNode != 0) {
      let nodeSym = getNodeType(reusedNode) as i32;
      

      // Query the GOTO table to determine if this non-terminal can transition from the current state
      let gOffset = goto_offsets[currentState];
      let gCount = goto_data[gOffset];
      let gIdx = gOffset + 1;
      let nextState = -1;
      for (let i = 0; i < gCount; i++) {
        if (goto_data[gIdx++] == nodeSym) {
          nextState = goto_data[gIdx++];
          break;
        } else {
          gIdx++;
        }
      }

      // If we found a valid GOTO state, verify that it can accept the UPCOMING token!
      // If it cannot, shifting this massive reused node would trap the parser immediately before a garbage token,
      // leading to catastrophic error recovery that swallows the node.
      if (nextState != -1) {
        let canAccept = stateCanAccept(head, nextState, token);
        
        if (canAccept == 0) {
          nextState = -1;
        }
      }

      // Splicing: If the parser is currently building a list (headSym == nodeSym)
      // and there is no valid GOTO, we can manually append this list node.
      let isSplice = false;
      if (nextState == -1) {
        let nodeFlags = getNodeFlags(reusedNode);
        if (headSym == (nodeSym as u32) && (nodeFlags & FLAG_IS_LIST) != 0) {
          isSplice = true;
        }
      }

      if (isSplice) {
        // Shallow clone the reused node so we can mutate its links without affecting the old tree
        let cloneReused = allocNode(
          nodeSym as u16,
          expectedPadding + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(cloneReused, (getNodeFlags(reusedNode) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(cloneReused, getNodeFirstChild(reusedNode)); // Inherit old children

        // Splice it into the GSS head
        let merged = concatLists(head.astNode, cloneReused, nodeSym as u16, currentScannerState);
        let newPos = pos + expectedPadding + head.pendingPadding + getNodeByteLength(reusedNode);

        head = allocParseHead(
          head.state,
          merged,
          head.prev,
          newPos,
          currentScannerState,
          head.errorCost,
          head.successfulShifts,
          head.balanceHash,
          head.consecutiveInsertions,
          head.dynamicPrec,
          0,
          head.errorTail
        );
        pushActiveHead(changetype<u32>(head));
        pos = newPos;
        token = invokeLexer(pos);
        while (load<u8>(is_extra_token + token) == 1) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = invokeLexer(pos);
        }
        
        continue; // Yield to the next GSS iteration
      } else if (nextState != -1) {
        // Standard GOTO shift over the reused subtree
        let clone = allocNode(
          getNodeType(reusedNode) as u16,
          expectedPadding + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(clone, (getNodeFlags(reusedNode) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(clone, getNodeFirstChild(reusedNode));

        let newPos = pos + expectedPadding + head.pendingPadding + getNodeByteLength(reusedNode);

        head = allocParseHead(
          nextState,
          clone,
          head,
          newPos,
          currentScannerState,
          head.errorCost,
          head.successfulShifts,
          head.balanceHash,
          head.consecutiveInsertions,
          head.dynamicPrec,
          0,
          head.errorTail
        );
        pushActiveHead(changetype<u32>(head));
        pos = newPos;
        token = invokeLexer(pos);
        while (load<u8>(is_extra_token + token) == 1) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = invokeLexer(pos);
        }
        
        continue; // Yield to the next GSS iteration
      }
    }

    // ------------------------------------------------------------------------
    // Action Table Lookups (SHIFT / REDUCE / ACCEPT)
    // ------------------------------------------------------------------------
    let actionOffset = action_offsets[currentState];
    let actionCount = 0;
    let idx = 0;
    if (actionOffset >= 0 && actionOffset < action_data.length) {
      actionCount = action_data[actionOffset];
      idx = actionOffset + 1;
    }
    

    let anyAction = false;
    for (let i = 0; i < actionCount; i++) {
      if (idx < 0 || idx + 1 >= action_data.length) {
        throw new Error("BAD idx in action loop");
      }

      let sym = action_data[idx++];
      let actCount = action_data[idx++];
      

      // Match the exact token, or token 0 (which signifies a wildcard/default action)
      if (sym == token || sym == 0) {
        if (actCount > 1) {
          let uCurr: ParseHead | null = head;
          while (uCurr != null) {
            if (uCurr.astNode != 0 && isNodeGen2(uCurr.astNode)) {
              setNodeFlags(uCurr.astNode, getNodeFlags(uCurr.astNode) | FLAG_IS_SHARED);
            }
            uCurr = uCurr.prev;
          }
        }
        for (let j = 0; j < actCount; j++) {
          let type = action_data[idx++];
          let target = action_data[idx++];
          // --------------------------------------------------------------------
          // TYPE 0: SHIFT ACTION
          // --------------------------------------------------------------------
          if (type == ACTION_SHIFT) {
            processShiftAction(head, target, token, pos, is_current_token_virtual);
            anyAction = true;
          } else if (type == ACTION_REDUCE) {
            if (processReduceAction(head, target, pos)) {
              anyAction = true;
            }
          } else if (type == ACTION_ACCEPT) {
            processAcceptAction(head);
            anyAction = true;
          }
        }
        break;
      } else {
        idx += actCount * 2;
      }
    }

    if (acceptedNode != 0 && activeHeadsCount == 0) {
      return;
    }

    if (!anyAction) {
      if (g_simulatorMaxCost < 999999) {
        continue; // In simulation mode, do not spawn recursive recoveries
      }

      // --------------------------------------------------------------------
      // PHASE 3: GLR Error Recovery Forking
      // --------------------------------------------------------------------
      // When a parse head cannot shift or reduce the current token, it enters error recovery.
      // We branch the GSS in multiple directions (Deletion, Insertion, Forced Reduction)
      // and assign a penalty cost to each branch.
      
      let uCurr: ParseHead | null = head;
      while (uCurr != null) {
        if (uCurr.astNode != 0 && isNodeGen2(uCurr.astNode)) {
          setNodeFlags(uCurr.astNode, getNodeFlags(uCurr.astNode) | FLAG_IS_SHARED);
        }
        uCurr = uCurr.prev;
      }

      if (head.pos >= furthestDyingPos) {
        furthestDyingPos = head.pos;
        bestDyingHead = changetype<u32>(head);
      }

      // Prevent infinite error recovery loops by killing heads with catastrophic costs
      if (head.errorCost > MAX_ERRORS) {
        continue;
      }

      // Prune if there is a single branch that is strictly better than us
      // (i.e. has a lower cost and has advanced further in the file)
      let strictlyBetterExists = false;
      let aLength = activeHeadsCount;
      for (let i: u32 = 0; i < aLength; i++) {
        let ah = changetype<ParseHead>(t_activeHeads[i]);
        if (ah.errorCost < head.errorCost && ah.pos > pos) {
          strictlyBetterExists = true;
          break;
        }

      }
      if (strictlyBetterExists) continue;

      let errorType = 0; // SyntaxType.ERROR

      let count2 = action_data[actionOffset];
      let idx2 = actionOffset + 1;
      let reduced = false;

      // If we hallucinated a token that caused an error, the recovery path is dead.
      // Do not attempt to recover from our own recoveries, as this causes infinite loops.
      if (is_current_token_virtual) {
         pruneGSS(pos);
         continue;
      }

      // --------------------------------------------------------------------
      // ERROR BRANCH A & B: Token Deletion / Insertion (via Unwind & Mutate)
      // --------------------------------------------------------------------
      // Try inserting/deleting tokens FIRST before forced reductions, because
      // insertion preserves more of the parse tree (e.g., inserting a missing
      // Number before `;` in `let x = ;` completes the Decl properly).
      recoverUnwindAndMutate(head, token, inputLength, bestAcceptedCost);

      recoverIslandMode(head, inputLength, bestAcceptedCost, activeHeadsCount);
      // Restore expected_tokens after recovery — the recovery functions call
      // expected_tokens.fill(1) for unrestricted lexing during lookahead, but
      // the main parse loop needs the correct filtered set.
      updateExpectedTokens();

      // --------------------------------------------------------------------
      // ERROR BRANCH C: Forced Default Reduction
      if (configEnableBranchC) {
        reduced = processForcedReduction(head, actionOffset, count2);
      }

      // GSS PRUNING AND COMBINATORIAL EXPLOSION PREVENTION
      pruneGSS(pos);
    }
  }
  
  

}

export function parse(oldTree: u32, editStart: u32, editOldEnd: u32, editNewEnd: u32): u32 {
  g_editStart = editStart;
  g_editOldEnd = editOldEnd;
  g_editNewEnd = editNewEnd;
  globalIsCatastrophic = false;
  globalSearchIterations = 0;

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
      resetGeneration(1);
      incrementalStartOffset = 0;
    } else {
      incrementalStartOffset = S().arenaOffset;
      // Clear the free list: free-list nodes are from the old tree's Gen1 space
      // and have addresses below incrementalStartOffset. Reclaiming them would
      // make isMutable() return false, and their proximity to live old-tree nodes
      // can cause memory corruption during cursor traversal.
      S().freeNodeHead = 0;
    }
    globalLoopGuard = 0;
    resetGeneration(0);
    resetQueryArena();
    clearDiagnostics();
    errorCount = 0;
    if (changetype<usize>(t_acceptCache) == 0) {
      t_acceptCache = changetype<UnmanagedUint32Array>(atomicChunkAlloc(ACCEPT_CACHE_CAPACITY * 12));
    }
    acceptCacheClear();
    mergeTableInit();
    lexPos = 0;
    lexLen = 0;
    currentScannerState = 0;
    pos = 0;

    tokenBufferWriteIdx = 0;
    tokenBufferReadIdx = 0;
    tokenBufferLastPos = 0;



    initGlobalCursor(oldTree);

    if (oldTree == 0) {
      currentParserMode = MODE_LR;
      let accepted = parseLR();
      if (currentParserMode == MODE_LR) {
        clearAstMarks(accepted);
        return accepted;
      }
    } else {
      currentParserMode = MODE_GLR;
      activeHeadsCount = 0;
      t_activeHeads[activeHeadsCount++] = changetype<u32>(allocParseHead(0, 0, null, pos, currentScannerState, 0, 0, 0, 0, 0));
      activeHeadsCount = 1;

      updateExpectedTokens();
      token = invokeLexer(pos);
      while (load<u8>(is_extra_token + token) == 1) {
        pos += lexLen;
        token = invokeLexer(pos);
      }
      
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
      commitDiagnostics(bestAcceptingHead != 0 ? changetype<ParseHead>(bestAcceptingHead).errorTail : 0);
      acceptedNode = injectStrandedNodes(acceptedNode, bestAcceptingHead);
      sanitizeTree(acceptedNode);
      let finalTree = wrapWithTrailingErrors(acceptedNode);
      clearAstMarks(finalTree);
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
        if (tLen == 0) break; // prevent infinite loop

        let tNode = allocNode(((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) | 0x8000) as u16, pad, tLen, 0, false);
        setNodeFlags(tNode, getNodeFlags(tNode) | FLAG_HAS_ERROR);
        if (lastTokNode == 0) {
          setFirstChild(unparsedNode, tNode);
        } else {
          setNextSibling(lastTokNode, tNode);
        }
        lastTokNode = tNode;

        p = srcLexPos + tLen;
      }

      totalBytes += remainingLen + missingPadding;
      nodeCount++;
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

    return root;
  }
  return 0;
}

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
  if (globalCursorDepth < 0) return 0;

  let startNode = cursorNodeStack[globalCursorDepth];
  let startSrc = cursorOffsetStack[globalCursorDepth] + getNodePadding(startNode);
  if (startSrc > targetSrcOldPos) {
    return 0;
  }

  let searching = true;
  while (searching) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    let absStart = cursorOffsetStack[globalCursorDepth];
    let pad = getNodePadding(cPtr);
    let absContentStart = absStart + pad;
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
        absContentEnd < editStart ||
        absContentStart >= editOldEnd
      ) {
        let isError = nodeType == 0 || (getNodeFlags(cPtr) & FLAG_HAS_ERROR) != 0;
        let isMissing = byteLen == 0 && getNodeFirstChild(cPtr) == 0 && pad == 0;
        let nodeEnvHash = getNodeEnvHash(cPtr) & 0xff;
        
        if (!isError && !isMissing && nodeEnvHash == envHash) {
            let typeFlags = getNodeFlags(cPtr);
            let isInvisible = (typeFlags & FLAG_INVISIBLE) != 0;
            if (!isInvisible && (actionLookupFnBool(currentState, nodeType) || stateCanAcceptFnBool(currentState, nodeType))) {
               return cPtr;
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
  
  return 0;
}
