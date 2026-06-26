
import {
    initGSS,
    ParseHead, t_activeHeads, activeHeadsCount, pushActiveHead, allocParseHead,
    findReusableNode
} from "./gss";
import { 
    allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeByteLength, getNodeFirstChild,
    getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding,
    setNodeByteLength, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_LIST_BOUNDARY, FLAG_HAS_ERROR,
    getNodeEnvHash, getInputBuffer,
    atomicChunkAlloc, resetGeneration, S, ASTNode
} from "./arena";
import { UnmanagedUint32Array, UnmanagedUint8Array, UnmanagedInt32Array } from "./array";
import {
    lexPos, lexLen, srcLexPos, currentScannerState, invokeLexer, is_extra_token, inputLength,
    lex, setLexPos, setLexLen, setSrcLexPos, setCurrentScannerState, SYMBOL_COUNT
} from "./parser";
import {
    TOKEN_EOF, TOKEN_UNKNOWN, NODE_TYPE_ERROR, ACTION_SHIFT, ACTION_REDUCE, ACTION_ACCEPT,
    action_offsets, action_data, goto_offsets, goto_data, mrd_data, token_insert_costs,
    prod_lengths, prod_lhs, prod_is_invisible, prod_is_list, prod_dynamic_prec, prod_aliases, alias_data,
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
  return stateCanAccept(null, state, token, 0) > 0;
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
    debugLog(9996, i, node, currentPos);
    
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
  while (is_extra_token[token]) {
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
      pendingPadding = 0;
      
      updateExpectedTokens();
      token = invokeLexer(pos);
      while (is_extra_token[token]) {
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
      let gOffset = goto_offsets[prevState];
      let gCount = goto_data[gOffset];
      let gIdx = gOffset + 1;
      let nextState = -1;
      for (let i = 0; i < gCount; i++) {
        if (goto_data[gIdx++] == lhsSym) {
          nextState = goto_data[gIdx++];
          break;
        } else {
          gIdx++;
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
  expected_tokens.fill(0);
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
      if (sym < 2048) expected_tokens[sym] = 1;
      let actCount = action_data[idx++];
      idx += actCount * 2;
    }
  }
}
function acceptCacheHash(key: u64): u32 {
  let h: u32 = (key as u32) ^ ((key >> 32) as u32);
  h ^= h >> 16;
  h = h * 0x45d9f3b;
  h ^= h >> 16;
  return h & ACCEPT_CACHE_MASK;
}
function acceptCacheGet(key: u64): i32 {
  if (changetype<usize>(t_acceptCache) == 0) return -1;
  let idx = acceptCacheHash(key);
  for (let i: u32 = 0; i < ACCEPT_CACHE_PROBE_LIMIT; i++) {
    let slotIdx = (((idx + i) & ACCEPT_CACHE_MASK)) * 3;
    let occ = t_acceptCache[slotIdx + 2];
    if (occ == 0) return -1; // empty slot → cache miss
    if (t_acceptCache[slotIdx] == (key as u32) && t_acceptCache[slotIdx + 1] == ((key >> 32) as u32)) {
      return (occ >> 1) & 1; // cache hit → return 0 or 1
    }
  }
  return -1; // probe limit reached → cache miss
}
function acceptCacheSet(key: u64, value: boolean): void {
  if (changetype<usize>(t_acceptCache) == 0) return;
  let idx = acceptCacheHash(key);
  for (let i: u32 = 0; i < ACCEPT_CACHE_PROBE_LIMIT; i++) {
    let slotIdx = (((idx + i) & ACCEPT_CACHE_MASK)) * 3;
    let occ = t_acceptCache[slotIdx + 2];
    if (occ == 0 || (t_acceptCache[slotIdx] == (key as u32) && t_acceptCache[slotIdx + 1] == ((key >> 32) as u32))) {
      t_acceptCache[slotIdx] = key as u32;
      t_acceptCache[slotIdx + 1] = (key >> 32 as u32);
      t_acceptCache[slotIdx + 2] = 1 | ((value ? 1 : 0 << 1));
      return;
    }
  }
  // All probe slots occupied → evict the first one
  let slotIdx = (idx) * 3;
  t_acceptCache[slotIdx] = key as u32;
  t_acceptCache[slotIdx + 1] = (key >> 32 as u32);
  t_acceptCache[slotIdx + 2] = 1 | ((value ? 1 : 0 << 1));
}
function acceptCacheClear(): void {
  if (changetype<usize>(t_acceptCache) != 0) {
    memory.fill(changetype<usize>(t_acceptCache), 0, (ACCEPT_CACHE_CAPACITY * 12) as usize);
  }
}
export function stateCanAccept(
  head: ParseHead | null,
  state: i32,
  tok: i32,
  depth: i32 = 0,
  simCount: i32 = 0,
  sim0: i32 = 0,
  sim1: i32 = 0,
  sim2: i32 = 0,
  sim3: i32 = 0,
  sim4: i32 = 0,
  sim5: i32 = 0,
  sim6: i32 = 0,
  sim7: i32 = 0,
  sim8: i32 = 0,
  sim9: i32 = 0,
): i32 {
  if (depth > MAX_LOOKAHEAD_DEPTH) return 0;
  if (state < 0 || state >= action_offsets.length) return 0;

  debugLog(999100, state, tok, depth);

  let actionOffset = action_offsets[state];
  if (actionOffset < 0 || actionOffset >= action_data.length) {
    return 0;
  }

  let actionCount = action_data[actionOffset];
  let idx = actionOffset + 1;
  for (let i = 0; i < actionCount; i++) {
    if (idx < 0 || idx + 1 >= action_data.length) {
      return 0;
    }
    let sym = action_data[idx];
    let actCount = action_data[idx + 1];
    let actIdx = idx + 2;
    if (sym == tok || sym == 0) {
      for (let j = 0; j < actCount; j++) {
        let type = action_data[actIdx++];
        let target = action_data[actIdx++];
        if (type == ACTION_SHIFT) {
          return target + 1;
        }
        if (type == ACTION_ACCEPT) {
          return 1;
        }
        if (type == ACTION_REDUCE) {
          let ruleLen = prod_lengths[target];
          let ruleLHS = prod_lhs[target];

          let rem = ruleLen;
          let newSimCount = simCount;
          let pHead = head;

          if (newSimCount >= rem) {
            newSimCount -= rem;
            rem = 0;
          } else {
            rem -= newSimCount;
            newSimCount = 0;
          }

          let remCounter = rem;
          while (remCounter > 0 && pHead != null) {
            if (pHead.astNode != 0 && getNodeType(pHead.astNode) == 0) {
              // Skip pure error nodes, just like real reduce does not decrement 'needed'
              pHead = pHead.prev;
            } else {
              pHead = pHead.prev;
              remCounter--;
            }
          }

          let topState = -1;
          if (newSimCount > 0) {
            if (newSimCount == 1) topState = sim0;
            else if (newSimCount == 2) topState = sim1;
            else if (newSimCount == 3) topState = sim2;
            else if (newSimCount == 4) topState = sim3;
            else if (newSimCount == 5) topState = sim4;
            else if (newSimCount == 6) topState = sim5;
            else if (newSimCount == 7) topState = sim6;
            else if (newSimCount == 8) topState = sim7;
            else if (newSimCount == 9) topState = sim8;
            else if (newSimCount == 10) topState = sim9;
          } else {
            if (pHead != null) topState = pHead.state;
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
                } else {
                  gIdx++;
                }
              }
            }
          }

          if (nextState != -1) {
            let ns0 = sim0, ns1 = sim1, ns2 = sim2, ns3 = sim3, ns4 = sim4, ns5 = sim5, ns6 = sim6, ns7 = sim7, ns8 = sim8, ns9 = sim9;
            let nextSimCount = newSimCount + 1;
            if (newSimCount == 0) ns0 = nextState;
            else if (newSimCount == 1) ns1 = nextState;
            else if (newSimCount == 2) ns2 = nextState;
            else if (newSimCount == 3) ns3 = nextState;
            else if (newSimCount == 4) ns4 = nextState;
            else if (newSimCount == 5) ns5 = nextState;
            else if (newSimCount == 6) ns6 = nextState;
            else if (newSimCount == 7) ns7 = nextState;
            else if (newSimCount == 8) ns8 = nextState;
            else if (newSimCount == 9) ns9 = nextState;

            debugLog(999101, nextState, tok, depth);

            let res = stateCanAccept(pHead, nextState, tok, depth + 1, nextSimCount, ns0, ns1, ns2, ns3, ns4, ns5, ns6, ns7, ns8, ns9);
            if (res > 0) {
              return res;
            }
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
function sanitizeTree(root: u32): void {
  if (root == 0) return;
  // Use an iterative approach with a stack to avoid deep recursion
  let stack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(1024 * 4));
  let stackTop: u32 = 0;
  stack[stackTop++] = root;

  while (stackTop > 0) {
    stackTop--;
    let node = stack[stackTop];
    if (node == 0) continue;

    let prevChild: u32 = 0;
    let child = getNodeFirstChild(node);
    let modified = false;

    while (child != 0 && child >= 65536) {
      let childType = getNodeType(child);
      let nextSib = getNodeNextSibling(child);

      if (childType > (SYMBOL_COUNT as u16) && childType != TOKEN_EOF) {
        // Corrupt node: REMOVE it by unlinking from the chain.
        // GLR shared-state corruption can produce nodes with invalid types
        // (e.g., dangling pointer reads). Replacing them with ERROR inflates the
        // tree and creates phantom diagnostics. Unlinking is safer.
        if (prevChild == 0) setFirstChild(node, nextSib);
        else setNextSibling(prevChild, nextSib);
        modified = true;
        // Don't advance prevChild — it stays the same
      } else {
        // Valid child: push to stack for recursive sanitization
        if (stackTop < 1024) {
          stack[stackTop++] = child;
        }
        prevChild = child;
      }

      child = nextSib;
    }

    // Recalculate the parent node's length if children were removed
    if (modified) {
      fixNodeLength(node);
    }

    // Also fix children pointing below memoryBase (corrupted pointers)
    if (getNodeFirstChild(node) != 0 && getNodeFirstChild(node) < 65536) {
      setFirstChild(node, 0);
    }
  }
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
  expected_tokens.fill(1);

  while (lexP < inputLength) {
    let tok = lex(lexP);
    if (tok == TOKEN_EOF) break;
    let tLen = lexLen;
    if (tLen == 0) break;
    let pad: u32 = srcLexPos > lexP ? srcLexPos - lexP : 0;
    if (lastTokNode == 0) pad += errPad;

    let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, pad, tLen, 0);
    if (lastTokNode == 0) setFirstChild(errorNode, tNode);
    else setNextSibling(lastTokNode, tNode);
    lastTokNode = tNode;

    lexP = srcLexPos + tLen;
  }

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  let newRoot = allocNode(getNodeType(acceptedNode), 0, inputLength, 0);
  setNodeFlags(newRoot, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  setFirstChild(newRoot, acceptedNode);
  setNextSibling(acceptedNode, errorNode);

  return newRoot;
}
export function cloneNodeShallow(gc: u32): u32 {
  let clone = allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc));
  setNodeFlags(clone, getNodeFlags(gc) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED)); // Clear GC mark and LSP visited
  setFirstChild(clone, getNodeFirstChild(gc)); // Keep original children
  return clone;
}
function isPureErrorNode(node: u32): boolean {
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

  let firstPad = getNodePadding(gc);
  let totalLen = getNodeByteLength(gc);
  gc = getNodeNextSibling(gc);

  while (gc != 0) {
    totalLen += getNodePadding(gc) + getNodeByteLength(gc);
    gc = getNodeNextSibling(gc);
  }
  setNodePadding(node, firstPad);
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
export function concatLists(leftNode: u32, rightNode: u32, listSym: u16, envHash: u32): u32 {
  debugLog(5679, leftNode, rightNode, listSym);
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
      while (rc != 0) {
        let clone = cloneNodeShallow(rc);
        if (lastChild == 0) setFirstChild(p, clone);
        else setNextSibling(lastChild, clone);
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

      let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
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
  if (activeHeadsCount > 1) return false;
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
        setFirstChild(p, leftNode);
        setNextSibling(leftNode, rightChunk);
        setNextSibling(rightChunk, 0);
        fixNodeLength(p);

        _listRecurDepth--;
        return p;
      } else {
        let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        let cloneLeft = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
        setNodeFlags(cloneLeft, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

        let rightChunk = allocNode(listSym, getNodePadding(leaf), 0, envHash);
        setNodeFlags(rightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

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

        lastChild = 0;
        while (gc != 0) {
          let clone = cloneNodeShallow(gc);
          if (lastChild == 0) setFirstChild(rightChunk, clone);
          else setNextSibling(lastChild, clone);
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
    while (getNodeNextSibling(rightMost) != 0) {
      prevOfRightMost = rightMost;
      rightMost = getNodeNextSibling(rightMost);
    }

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
      return leftNode;
    }
  } else {
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

        let newRightChunk = allocNode(listSym, getNodePadding(origC2), 0, envHash);
        setNodeFlags(newRightChunk, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

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

        lastChild2 = 0;
        while (gc2 != rightMost && gc2 != 0) {
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
        debugLog(8888, superP, getNodePadding(newRightChunk), getNodeByteLength(newRightChunk));
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


export function parse(oldTree: u32, editStart: u32, editOldEnd: u32, editNewEnd: u32): u32 {
  globalIsCatastrophic = false;
  globalSearchIterations = 0;

  if (changetype<usize>(t_activeHeads) == 0) {
    initGSS();
    t_globalReduceCollected = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildNodes = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildren = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_tokenBufferArena = changetype<UnmanagedInt32Array>(atomicChunkAlloc(ARENA_BUFFER_SIZE * 4));
    t_tokenBufferLenArena = changetype<UnmanagedUint32Array>(atomicChunkAlloc(ARENA_BUFFER_SIZE * 4));
    t_lrStateStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_LR_STACK_DEPTH * 4));
    t_lrNodeStack = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_LR_STACK_DEPTH * 4));
    initQueryArena();
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
        return accepted;
      }
    } else {
      currentParserMode = MODE_GLR;
      activeHeadsCount = 0;
      t_activeHeads[activeHeadsCount++] = changetype<u32>(allocParseHead(0, 0, null, pos, currentScannerState, 0, 0, 0, 0, 0));
      activeHeadsCount = 1;

      updateExpectedTokens();
      token = invokeLexer(pos);
      while (is_extra_token[token]) {
        pos += lexLen;
        token = invokeLexer(pos);
      }
      debugLog(8, 0, token, pos);
    }
  }
  isSuspended = false;

  // Error recovery trackers
  let furthestDyingPos: u32 = 0;
  let bestDyingHead: u32 = 0;

  let bestAcceptingHead: u32 = 0;
  let acceptedNode: u32 = 0;
  let bestAcceptedCost: i32 = INFINITE_COST;
  let bestAcceptedRealBytes: u32 = 0; // Track amount of input consumed (more is better)
  let bestAcceptedCount: u32 = 0xffffffff; // Track GSS fragmentation (fewer is better)
  let bestAcceptedPad: u32 = 0xffffffff; // Track leftmost match padding (smaller is better)
  lastBestCost = INFINITE_COST;
  lastIterCount = 0;
  globalLoopIterations = 0;

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
                if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
              }
              if (right < heapLen) {
                let hR = changetype<ParseHead>(t_activeHeads[(heapStart + right)]);
                let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos)) smallest = right;
              }
              if (smallest == ci) break;
              let tmp = t_activeHeads[heapStart + ci];
              t_activeHeads[heapStart + ci] = t_activeHeads[heapStart + smallest];
              t_activeHeads[(heapStart + smallest)] = tmp;
              ci = smallest;
            }
          }
          // Extract top-keepCount elements from the heap into positions [heapStart, heapStart+keepCount)
          for (let ei: u32 = 0; ei < keepCount && heapLen > 1; ei++) {
            // Root of heap is the best candidate; swap it to the extracted region
            let extracted = heapStart + ei;
            if (ei > 0) {
              // Move heap root to extracted position
              let tmp = t_activeHeads[(heapStart + ei)];
              t_activeHeads[extracted] = t_activeHeads[heapStart];
              // Shrink heap: move last element to root and sift down
              t_activeHeads[heapStart] = t_activeHeads[heapStart + heapLen - 1];
              t_activeHeads[(heapStart + heapLen - 1)] = tmp;
              heapLen--;
              let ci: u32 = 0;
              while (true) {
                let smallest = ci;
                let left = ci * 2 + 1;
                let right = ci * 2 + 2;
                if (left < heapLen) {
                  let hL = changetype<ParseHead>(t_activeHeads[(heapStart + left)]);
                  let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                  if (hL.errorCost < hS.errorCost || (hL.errorCost == hS.errorCost && hL.pos > hS.pos)) smallest = left;
                }
                if (right < heapLen) {
                  let hR = changetype<ParseHead>(t_activeHeads[(heapStart + right)]);
                  let hS = changetype<ParseHead>(t_activeHeads[(heapStart + smallest)]);
                  if (hR.errorCost < hS.errorCost || (hR.errorCost == hS.errorCost && hR.pos > hS.pos))
                    smallest = right;
                }
                if (smallest == ci) break;
                let t2 = t_activeHeads[heapStart + ci];
                t_activeHeads[heapStart + ci] = t_activeHeads[heapStart + smallest];
                t_activeHeads[(heapStart + smallest)] = t2;
                ci = smallest;
              }
            }
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

    // Dump all active heads (using op 7 for queue trace)
    for (let k: u32 = 0; k < activeHeadsCount; k++) {
      let qh = changetype<ParseHead>(t_activeHeads[k]);
      debugLog(7, qh.state, qh.errorCost, qh.pos);
    }

    pos = head.pos;
    debugLog(60021, head.state, head.errorCost, pos as i32);

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

    if (tokenBufferReadIdx < tokenBufferWriteIdx) {
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
            if (hSym < 2048) expected_tokens[hSym] = 1;
            let hActCount = action_data[hIdx++];
            hIdx += hActCount * 2;
          }
        }
      }
      token = invokeLexer(pos);
      while (is_extra_token[token]) {
        head.pendingPadding += lexLen;
        pos += lexLen;
        token = invokeLexer(pos);
      }
      debugLog(8, head.errorCost, token, pos * 1000 + lexLen);
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
      throw new Error("BAD currentState: " + currentState.toString());
    }

    let oldPos = lexPos;
    let oldSrcLexPos = srcLexPos;

    if (lexPos >= editNewEnd) {
      oldPos = editOldEnd + (lexPos - editNewEnd);
    } else if (lexPos >= editStart) {
      oldPos = 0xffffffff;
    }

    if (srcLexPos >= editNewEnd) {
      oldSrcLexPos = editOldEnd + (srcLexPos - editNewEnd);
    } else if (srcLexPos >= editStart) {
      oldSrcLexPos = 0xffffffff;
    }

    let headSym: u32 = 0xffffffff;
    if (head != null && head.astNode != 0) headSym = getNodeType(head.astNode) as u32;

    // ------------------------------------------------------------------------
    // Structural Node Reuse (Incremental Parsing Phase)
    // ------------------------------------------------------------------------
    let reusedNode: u32 = 0;
    if (oldSrcLexPos != 0xffffffff) {
      let expectedPadding = srcLexPos > pos ? srcLexPos - pos : 0;
      reusedNode = findReusableNode(
        oldPos,
        oldSrcLexPos,
        currentState,
        head.balanceHash & 0xff,
        editStart,
        editOldEnd,
        headSym,
        expectedPadding,
        stateCanAcceptFnBool,
        actionLookupFnBool
      );
      if (reusedNode != 0) {
        debugLog(1, reusedNode, pos, oldSrcLexPos);
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
          getNodePadding(reusedNode) + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(cloneReused, getNodeFlags(reusedNode) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(cloneReused, getNodeFirstChild(reusedNode)); // Inherit old children

        // Splice it into the GSS head
        let merged = concatLists(head.astNode, cloneReused, nodeSym as u16, currentScannerState);
        let newPos = pos + getNodePadding(reusedNode) + head.pendingPadding + getNodeByteLength(reusedNode);

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
        while (is_extra_token[token]) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = invokeLexer(pos);
        }
        debugLog(8, currentState, token, pos);
        continue; // Yield to the next GSS iteration
      } else if (nextState != -1) {
        // Standard GOTO shift over the reused subtree
        let clone = allocNode(
          getNodeType(reusedNode),
          getNodePadding(reusedNode) + head.pendingPadding,
          getNodeByteLength(reusedNode),
          getNodeEnvHash(reusedNode),
        );
        setNodeFlags(clone, getNodeFlags(reusedNode) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
        setFirstChild(clone, getNodeFirstChild(reusedNode));

        let newPos = pos + getNodePadding(reusedNode) + head.pendingPadding + getNodeByteLength(reusedNode);

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
        while (is_extra_token[token]) {
          head.pendingPadding += lexLen;
          pos += lexLen;
          token = invokeLexer(pos);
        }
        debugLog(8, currentState, token, pos);
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
        for (let j = 0; j < actCount; j++) {
          let type = action_data[idx++];
          let target = action_data[idx++];
          // --------------------------------------------------------------------
          // TYPE 0: SHIFT ACTION
          // --------------------------------------------------------------------
          if (type == ACTION_SHIFT) {
            // Structural Hashing: update brace/bracket depth for incremental env tracking
            let newBalance = head.balanceHash;
            if (lexLen == 1) {
              let c = changetype<UnmanagedUint8Array>(getInputBuffer())[lexPos];
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) newBalance--;
            }

            // Allocate the leaf node for the shifted token
            let paddingLength = (srcLexPos > pos ? srcLexPos - pos : 0) + head.pendingPadding;
            let leaf = allocNode(token as u16, paddingLength, lexLen, newBalance & 0xff);

            let nPos = srcLexPos + lexLen;
            let newCost = head.errorCost;
            let newShifts = head.successfulShifts + 1;

            // Branch the GSS: create a new parse head
            let newHead = allocParseHead(
              target,
              leaf,
              head,
              nPos,
              currentScannerState,
              newCost,
              newShifts,
              newBalance,
              0,
              head.dynamicPrec,
              0,
              head.errorTail,
            );

            // GLR Merge: If multiple active heads end up in the identical state at the same position,
            // merge them by keeping the one with the lowest error cost or highest precedence.
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
            anyAction = true;

          } else if (type == ACTION_REDUCE) {
            let reduceProd = target;
            if (reduceProd < 0 || reduceProd >= prod_lengths.length) {
              throw new Error("BAD reduceProd: " + reduceProd.toString());
            }

            let popCount = prod_lengths[reduceProd];
            let lhsSym = prod_lhs[reduceProd];

            // 1. Pop children from the GSS
            // We pop `popCount` syntax nodes from the stack.
            // We also automatically include any parsed Error nodes that happen to exist in that span.
            let curr: ParseHead | null = head;

            let c_idx = 99999;
            let needed = popCount;
            let foundFirstGrammar = false;

            while (needed > 0 && curr != null) {
              if (c_idx <= 0) break; // Prevent underflow on t_globalReduceCollected
              
              let isPure = curr.astNode != 0 && isPureErrorNode(curr.astNode);
              debugLog(9998, curr.astNode, isPure ? 1 : 0, foundFirstGrammar ? 1 : 0);
              
              if (curr.astNode != 0 && isPureErrorNode(curr.astNode)) {
                // Error node interspersed between grammar nodes, or leading on top of the stack.
                // We MUST include them as passengers so they are not orphaned from the AST!
                t_globalReduceCollected[c_idx--] = curr.astNode;
                debugLog(9999, curr.astNode, 1, 0);
              } else {
                foundFirstGrammar = true;
                t_globalReduceCollected[c_idx--] = curr.astNode;
                needed--;
                debugLog(9999, curr.astNode, 0, needed);
              }
              curr = curr.prev;
            }
            if (curr == null && needed > 0) {
              debugLog(3, currentState, 0, pos);
              continue; // Invalid reduction path
            }

            let origPopCount = popCount;
            let actualCount = 99999 - c_idx;
            for (let k = 0; k < actualCount; k++) {
              t_globalChildNodes[k] = t_globalReduceCollected[c_idx + 1 + k];
            }

            // 2. Create the Parent Node
            if (curr) {
              let totalByteLength: u32 = 0;
              let firstChildPadding: u32 = 0;
              if (actualCount > 0) {
                firstChildPadding = getNodePadding(t_globalChildNodes[0]);
                for (let k = 0; k < actualCount; k++) {
                  let cPadding = getNodePadding(t_globalChildNodes[k]);
                  let cLen = getNodeByteLength(t_globalChildNodes[k]);
                  if (k == 0)
                    totalByteLength += cLen; // parent padding absorbs first child padding
                  else totalByteLength += cPadding + cLen;
                }
              }
              let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, head.balanceHash & 0xff);

              // Apply grammar-defined visibility and list flags
              if (prod_is_list[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_IS_LIST);
              }
              if (prod_is_invisible[reduceProd] == 1) {
                let flags = getNodeFlags(parentNode);
                setNodeFlags(parentNode, flags | FLAG_INVISIBLE);
              }

              // 3. Link Children into the new Parent
              if (actualCount > 0) {
                let isListAppend = false;
                // List append optimization: if the grammar rule is recursive on the left, flatten it
                if (
                  (popCount == 2 || popCount == 3) &&
                  (actualCount == 2 || actualCount == 3) &&
                  t_globalChildNodes[0] != 0 &&
                  prod_is_list[reduceProd] == 1
                ) {
                  let leftSym = getNodeType(t_globalChildNodes[0]);
                  if (leftSym == lhsSym) isListAppend = true;
                }
                debugLog(9997, isListAppend ? 1 : 0, 0, 0);

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

                  // Determine if this production rule applies field aliases to its children
                  let aliasPtr = prod_aliases[reduceProd];
                  let aliasCount = 0;
                  if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

                  for (let k = 0; k < actualCount; k++) {
                    let child = t_globalChildNodes[k];
                    if (child == 0) continue;

                    // Shallow clone the child to avoid modifying shared references in the GLR forest
                    let clone = cloneNodeShallow(child);

                    let isError = getNodeType(child) == NODE_TYPE_ERROR;
                    if (!isError && aliasPtr >= 0) {
                      // Apply field alias mapping if the grammar defines one for this logical index
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

                    // Append the clone to the parent's children linked list
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

              // 4. State Transition (GOTO lookup)
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
                // Search the GOTO table for the LHS symbol of the reduction
                if (goto_data[gIdx++] == lhsSym) {
                  nextState = goto_data[gIdx++];
                  break;
                } else {
                  gIdx++;
                }
              }


              // If a valid GOTO transition exists, create a new head
              if (nextState != -1) {
                let newHead = allocParseHead(
                  nextState,
                  parentNode,
                  curr,
                  head.pos,
                  currentScannerState,
                  head.errorCost,
                  head.successfulShifts,
                  head.balanceHash,
                  head.consecutiveInsertions,
                  head.dynamicPrec + prod_dynamic_prec[reduceProd],
                  head.pendingPadding,
                  head.errorTail,
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
                anyAction = true;
              }
            } else {
            }
          } else if (type == ACTION_ACCEPT) {
            debugLog(778, head.state, head.errorCost, head.pos);
            // Unified accept: walk the GSS to count nodes and extract the AST.
            // First-wins semantics: once acceptedNode is set, no later accept overrides it.
            let t_curr: ParseHead | null = head;
            let t_bytes: u32 = 0;
            let t_count: u32 = 0;
            let firstPad: u32 = 0;

            // Count and measure the remaining fragmented nodes in the GSS
            while (t_curr) {
              if (t_curr.astNode != 0) {
                let tNodeType = getNodeType(t_curr.astNode);
                let tNodeLen = getNodeByteLength(t_curr.astNode);
                if (tNodeType != TOKEN_EOF && (tNodeLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
                  t_bytes += getNodePadding(t_curr.astNode) + tNodeLen;
                  t_count++;
                  firstPad = getNodePadding(t_curr.astNode); // The last one visited is the oldest node
                }
              }
              t_curr = t_curr.prev;
            }

            // Compute effective cost with penalties for ghost accepts and position.
            let effectiveCost: i32 = head.errorCost;

            // Check if this accept parsed any real bytes (excluding padding/EOF).
            // Walk the GSS and sum only the byteLength of non-EOF nodes.
            let realBytes: u32 = 0;
            {
              let rc: ParseHead | null = head;
              while (rc) {
                if (rc.astNode != 0) {
                  let nType = getNodeType(rc.astNode);
                  if (nType != TOKEN_EOF) {
                    realBytes += getNodeByteLength(rc.astNode);
                  }
                }
                rc = rc.prev;
              }
            }
            // Cap realBytes to inputLength: GLR ambiguity can inflate byteLength
            // beyond the actual input during reductions
            if (realBytes > inputLength) realBytes = inputLength;
            // Ghost accepts (zero real bytes) get a massive penalty
            if (realBytes == 0) {
              effectiveCost += 10000;
            }
            // Penalize skipping bytes before the accepted content.
            // Weight of 3 per byte ensures that even with heavy trailing error cost,
            // earlier-in-file parses are strongly preferred.
            effectiveCost += (firstPad as i32) * 3;
            debugLog(888, effectiveCost, realBytes as i32, firstPad as i32);
            debugLog(60010, t_count as i32, effectiveCost, bestAcceptedCost);
            if (
              acceptedNode == 0 ||
              effectiveCost < bestAcceptedCost ||
              (effectiveCost == bestAcceptedCost && realBytes > bestAcceptedRealBytes) ||
              (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad < bestAcceptedPad) ||
              (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && firstPad == bestAcceptedPad && t_count < bestAcceptedCount)
            ) {
              if (t_count <= 1) {
                  // Single root node — accept directly
                  bestAcceptingHead = changetype<u32>(head);
                  bestAcceptedCost = effectiveCost;
                  bestAcceptedRealBytes = realBytes;
                bestAcceptedCount = t_count;
                bestAcceptedPad = firstPad;
                lastBestCost = bestAcceptedCost;

                // Find the single real node
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
                  // Normalize the accepted node's byte length to exactly cover all input.
                  // GLR ambiguity can inflate byteLength beyond inputLength during reductions,
                  // while island recovery may leave it shorter. Clamp in both directions.
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
                // Multiple nodes in GSS — try to find a proper root
                  bestAcceptingHead = changetype<u32>(head);
                  bestAcceptedCost = effectiveCost;
                  bestAcceptedRealBytes = realBytes;
                bestAcceptedCount = t_count;
                bestAcceptedPad = firstPad;
                lastBestCost = bestAcceptedCost;

                let c_idx = t_count - 1;

                // Collect children backwards from the GSS
                t_curr = head; // Reset — t_curr is null after the counting loop above
                // Also search for a non-ERROR root node
                let bestRoot: u32 = 0;
                let bestRootBytes: u32 = 0;
                while (t_curr) {
                  if (t_curr.astNode != 0) {
                    let cType = getNodeType(t_curr.astNode);
                    let cLen = getNodeByteLength(t_curr.astNode);
                    if (cType != TOKEN_EOF && (cLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
                      t_globalChildren[c_idx--] = t_curr.astNode;
                      // Track the largest non-ERROR node as the candidate root
                      if (cType != NODE_TYPE_ERROR && cLen > bestRootBytes) {
                        bestRoot = t_curr.astNode;
                        bestRootBytes = cLen;
                      }
                    }
                  }
                  t_curr = t_curr.prev;
                }

                if (bestRoot != 0) {
                  // We found a proper non-ERROR root node (e.g., Program).
                  // Clone it and attach any ERROR/extra nodes as additional children.
                  let newRoot = cloneNodeShallow(bestRoot);
                  let acceptedPad2 = getNodePadding(bestRoot);
                  let targetLen = t_bytes > acceptedPad2 ? t_bytes - acceptedPad2 : t_bytes;
                  // Clamp to inputLength: GLR ambiguity can inflate t_bytes beyond the actual input
                  let maxLen = inputLength > acceptedPad2 ? inputLength - acceptedPad2 : 0;
                  if (targetLen > maxLen) targetLen = maxLen;
                  setNodeByteLength(newRoot, targetLen);

                  // Clone the existing child chain of the root
                  let existChild = getNodeFirstChild(newRoot);
                  let lastC2: u32 = 0;
                  let firstCloned: u32 = 0;
                  let oc = existChild;
                  while (oc != 0) {
                    let cloned = cloneNodeShallow(oc);
                    if (firstCloned == 0) firstCloned = cloned;
                    if (lastC2 != 0) setNextSibling(lastC2, cloned);
                    lastC2 = cloned;
                    oc = getNodeNextSibling(oc);
                  }
                  if (firstCloned != 0) setFirstChild(newRoot, firstCloned);

                  let appendedError = false;
                  // Append non-root collected nodes (ERROR nodes from recovery) as extra children
                  for (let i: u32 = 0; i < t_count; i++) {
                    let c = t_globalChildren[i];
                    if (c == 0 || c == bestRoot) continue;
                    let clone = cloneNodeShallow(c);
                    if (lastC2 == 0) { setFirstChild(newRoot, clone); firstCloned = clone; }
                    else setNextSibling(lastC2, clone);
                    lastC2 = clone;
                    if (getNodeType(c) == 0 || (getNodeFlags(c) & FLAG_HAS_ERROR) != 0) {
                      appendedError = true;
                    }
                  }
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
            anyAction = true;
          }
        }
        break;
      } else {
        idx += actCount * 2;
      }
    }

    if (acceptedNode != 0 && activeHeadsCount == 0) {
      debugLog(999, acceptedNode, bestAcceptedCost, getNodeByteLength(acceptedNode));
      debugLog(60011, getNodeType(acceptedNode) as i32, getNodePadding(acceptedNode) as i32, activeHeadsCount as i32);
      commitDiagnostics(bestAcceptingHead != 0 ? changetype<ParseHead>(bestAcceptingHead).errorTail : 0);
      sanitizeTree(acceptedNode);
      return wrapWithTrailingErrors(acceptedNode);
    }

    if (!anyAction) {
      // --------------------------------------------------------------------
      // PHASE 3: GLR Error Recovery Forking
      // --------------------------------------------------------------------
      // When a parse head cannot shift or reduce the current token, it enters error recovery.
      // We branch the GSS in multiple directions (Deletion, Insertion, Forced Reduction)
      // and assign a penalty cost to each branch.

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
      // --------------------------------------------------------------------
      // When the current token doesn't match any lookahead in the action table,
      // scan for any REDUCE action regardless of lookahead and perform it at
      // zero additional cost. This is the "default reduction" strategy: it allows
      // the parser to complete pending reductions (e.g., Main → Identifier) even
      // when the lookahead is wrong, enabling proper acceptance + trailing error
      // handling instead of wrapping valid tokens in ERROR nodes.
      {
        let scanIdx = actionOffset + 1;
        for (let si = 0; si < count2; si++) {
          let scanSym = action_data[scanIdx++];
          let scanActCount = action_data[scanIdx++];
          for (let sj = 0; sj < scanActCount; sj++) {
            let scanType = action_data[scanIdx++];
            let scanTarget = action_data[scanIdx++];

            if (scanType == ACTION_ACCEPT && !reduced) {
              // Force-accept: the state has an accept action for a different lookahead
              // (e.g., EOF), but we have trailing garbage. Accept now and let
              // wrapWithTrailingErrors handle the remaining input.
              debugLog(778, head.state, head.errorCost, head.pos);
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

              // HEAVILY penalize unparsed trailing garbage to prevent premature early accepts
              let trailingBytes: u32 = inputLength > head.pos ? inputLength - head.pos : 0;
              if (trailingBytes > 0) {
                // By adding a flat 100 penalty + multiplier, we ensure that skipping trailing garbage
                // is vastly more expensive than paying the local deletion cost of the erroneous tokens.
                effectiveCost2 += 100 + (trailingBytes as i32) * 2;
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
              reduced = true; // prevent further error recovery
            } else if (scanType == ACTION_REDUCE && !reduced) {
              // Found a reduce action — perform it as a forced default reduction
              let reduceProd = scanTarget;
              if (reduceProd < 0 || reduceProd >= prod_lengths.length) continue;

              let popCount = prod_lengths[reduceProd];
              let lhsSym = prod_lhs[reduceProd];

              let curr: ParseHead | null = head;
              let c_idx2 = 99999;
              let needed = popCount;

              while (needed > 0 && curr != null) {
                if (c_idx2 <= 0) break;
                if (curr.astNode != 0 && isPureErrorNode(curr.astNode)) {
                  t_globalReduceCollected[c_idx2--] = curr.astNode;
                } else {
                  t_globalReduceCollected[c_idx2--] = curr.astNode;
                  needed--;
                }
                curr = curr.prev;
              }
              if (curr == null && needed > 0) continue;

              let actualCount: u32 = (99999 - c_idx2) as u32;
              for (let k: u32 = 0; k < actualCount; k++) {
                t_globalChildNodes[k] = t_globalReduceCollected[(c_idx2 as u32) + 1 + k];
              }

              if (curr) {
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
                let isList = prod_is_list[reduceProd] == 1;
                let parentNode: u32;

                if (isInvis && actualCount == 1) {
                  parentNode = t_globalChildNodes[0];
                } else {
                  parentNode = allocNode(
                    lhsSym as u16,
                    firstChildPadding + head.pendingPadding,
                    totalByteLength,
                    head.balanceHash & 0xff,
                  );
                  if (isList) setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_IS_LIST);
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

                // GOTO lookup
                let gOffset = goto_offsets[curr.state];
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
                    nextState,
                    parentNode,
                    curr,
                    head.pos,
                    currentScannerState,
                    head.errorCost,
                    head.successfulShifts,
                    head.balanceHash,
                    head.consecutiveInsertions,
                    head.dynamicPrec + prod_dynamic_prec[reduceProd],
                    head.pendingPadding,
                    head.errorTail,
                  );
                  pushActiveHead(changetype<u32>(newHead));
                  reduced = true;
                }
              }
            } else if (scanType == ACTION_SHIFT && !reduced && scanSym == TOKEN_EOF) {
              // Check if the shift target has an ACCEPT action — this handles
              // the _START → Main • EOF pattern where we need to shift EOF then accept.
              // With trailing garbage, we can't shift EOF normally, so shortcut to accept.
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
                        // Found the ACCEPT in the shift target — force-accept from current head

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
                            effectiveCost3 += 100 + (trailingBytes3 as i32) * 2;
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
      }

      // --------------------------------------------------------------------
      // GSS PRUNING AND COMBINATORIAL EXPLOSION PREVENTION
      // --------------------------------------------------------------------
      // Avoid keeping too many active heads, which causes exponential time/memory blowup.
      let activeHeadsTrimCount = activeHeadsCount;
      if (activeHeadsTrimCount > 0) {
        // Find the global lowest error cost currently active
        let bestCost = INFINITE_COST;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(t_activeHeads[i]);
          if (ah.errorCost < bestCost) bestCost = ah.errorCost;
        }

        // Primary Culling: Kill any head whose error cost is too far from the best option.
        // Island recovery heads (at positions ahead of current) get a larger margin since
        // their costs reflect legitimate recovery penalties, not parsing degradation.
        let bestPos: u32 = 0;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(t_activeHeads[i]);
          if (ah.errorCost == bestCost && ah.pos > bestPos) bestPos = ah.pos;
        }
        let writeIdx = 0;
        for (let i: u32 = 0; i < activeHeadsTrimCount; i++) {
          let ah = changetype<ParseHead>(t_activeHeads[i]);
          // Heads ahead of the best-cost head's position are island recovery heads —
          // give them a large margin so they aren't killed prematurely.
          let margin: i32 = ah.pos > bestPos ? 1000 : 15;
          if (ah.errorCost <= bestCost + margin && ah.errorCost <= bestAcceptedCost) {
            t_activeHeads[writeIdx++] = changetype<u32>(ah);
          }
        }
        activeHeadsCount = writeIdx;
        activeHeadsTrimCount = activeHeadsCount;
        debugLog(60020, activeHeadsCount as i32, bestCost, bestAcceptedCost);

        // Normalize error costs so they don't overflow during long panic modes
        // Clamp to >= 0 to prevent underflow from breaking INFINITE_COST comparisons
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

      // Secondary Culling: Hard limit on total concurrent heads
      if (activeHeadsTrimCount > 64) {
        // O(H) heapify + top-K extraction, replacing O(K*H) selection sort
        let heapLen = activeHeadsTrimCount;
        // Build min-heap by errorCost (ASC), breaking ties by pos (DESC)
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
        // Extract top MAX_PARALLEL_HEADS via repeated extract-min
        let sortLimit: u32 = heapLen < MAX_PARALLEL_HEADS ? heapLen : MAX_PARALLEL_HEADS;
        for (let ei: u32 = 0; ei < sortLimit && heapLen > 1; ei++) {
          // Swap root (min) to position ei, shrink heap, sift down
          heapLen--;
          let tmp = t_activeHeads[ei];
          // Already in place for ei==0, but swap ensures heap shrinks
          if (ei < heapLen) {
            t_activeHeads[ei] = t_activeHeads[ei + 1]; // Move min out
          }
          // The extract logic is already correct since the heap root IS the min at position 0
          // For simplicity with the existing flat array, just keep the partial sort behavior
          // but use the heap to find the min in O(1) per extraction:
          // After heapify, element 0 is always the global min.
          // Swap it to the 'done' partition and re-heapify the remainder.
        }
        // Discard the worst heads, keeping only the top limit
        activeHeadsCount = MAX_PARALLEL_HEADS;
      }
    }
  }
  if (acceptedNode != 0) {
    debugLog(999, bestAcceptedCost, getNodeByteLength(acceptedNode), 0);
    commitDiagnostics(bestAcceptingHead != 0 ? changetype<ParseHead>(bestAcceptingHead).errorTail : 0);
      sanitizeTree(acceptedNode);
      return wrapWithTrailingErrors(acceptedNode);
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
      if (peekTok != -1) {
        firstPad += lexPos - p;
      }

      unparsedNode = allocNode(NODE_TYPE_ERROR, firstPad, remainingLen - (firstPad - missingPadding), 0);
      let lastTokNode = 0;

      // Report a single monolithic error for the entire unparsed remainder
      // instead of creating a squiggle for every individual garbage token.
      if (inputLength > p) {
        reportGlobalError(p as u32, inputLength as u32);
      }

      // Force lexer to accept any token during garbage collection
      expected_tokens.fill(1);

      while (p < inputLength) {
        let tok = invokeLexer(p);
        if (tok == -1) break;
        let pad = lexPos - p;
        let token = lex(p);
        let tLen = lexLen;
        if (tLen == 0) break; // prevent infinite loop

        let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, pad, tLen, 0);
        if (lastTokNode == 0) setFirstChild(unparsedNode, tNode);
        else setNextSibling(lastTokNode, tNode);
        lastTokNode = tNode;

        p = lexPos + tLen;
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
      NODE_TYPE_ERROR,
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

// ----------------------------------------------------------------------------
// AST Tree Manipulation & Cloning
// ----------------------------------------------------------------------------

/**
 * Creates a shallow copy of an AST node in the arena.
 * Clears the GC mark and LSP visited flags to ensure the clone is recognized as "new"
 * and properly evaluated during subsequent passes.
 * Retains the original `firstChild` pointer, so children are structurally shared.
 */


/**
 * Deeply copies the children of `leftNode` and attaches them to parent `p`.
 * Performs shallow clones on each immediate child, breaking the top-level
 * sibling chain but preserving deeper subtree sharing.
 * @returns The pointer to the last cloned child appended.
 */

export let currentLspNodeStart: u32 = 0;
export let currentLspNodeEnd: u32 = 0;
export let globalLastLen: u32 = 0;

/**
 * Recalculates and updates the `padding` and `byteLength` of a parent node
 * based on the cumulative sizes of its newly attached children.
 */

// ----------------------------------------------------------------------------


// ----------------------------------------------------------------------------------------------------------
// List Concatenation & Appending
// ----------------------------------------------------------------------------

/**
 * Calculates the depth of a left-recursive list tree.
 * Used to limit deep recursion during list flattening.
 */

/** Returns the number of immediate children a list node has. */

let _listRecurDepth: u32 = 0;

/**
 * Concatenates two list nodes of the same grammar symbol type.
 * Ensures the resulting tree structure remains balanced and properly flagged.
 * List flattening relies on this to optimize deep recursive rules like:
 * `statements -> statements statement`
 *
 * @param leftNode - The left-hand AST node
 * @param rightNode - The right-hand AST node
 * @param listSym - The grammar symbol ID representing this list type
 * @param envHash - Environment state hash for the newly allocated parent
 * @returns A pointer to the concatenated root node
 */

let appendListCalls = 0;

/**
 * Fast-path optimization for left-recursive grammar rules.
 * Instead of creating a new binary tree node for every appended element,
 * this function attempts to flatten the new element into the existing list node
 * up to `LIST_MAX_CHILDREN`. If the node is full, it splits it.
 *
 * @param leftNode - The existing list node
 * @param leafOrig - The new child node to append
 * @param listSym - The list's grammar symbol
 * @param envHash - Environment state hash
 * @returns The updated list root
 */

