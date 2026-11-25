// SPDX-License-Identifier: AGPL-3.0-or-later

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


import { initGSS, ParseHead, t_activeHeads, activeHeadsCount, nextHeadsCount } from "./gss";
import { allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, setNodeByteLength, FLAG_HAS_ERROR, atomicChunkAlloc, resetGeneration, S, clearAstMarks, setParseWatermark } from "../arena";
import { UnmanagedUint32Array, UnmanagedInt32Array, createChunkedUint32Array } from "../core/array";
import { lexPos, lexLen, srcLexPos, currentScannerState, inputLength, lex } from "../parser";
import { TOKEN_EOF, TOKEN_UNKNOWN, NODE_TYPE_ERROR, MAX_CHILD_NODES, t_lrStateStack, t_lrNodeStack, t_lrScannerStack, t_lrBalanceStack, t_globalChildNodes, t_globalChildren, t_globalReduceCollected, MODE_LR, currentParserMode, reportGlobalError, debugLog, expected_tokens, resetExpectedTokensPool, globalIsCatastrophic, commitDiagnostics, lastBestCost, lastIterCount, isSuspended, globalLoopIterations, globalSearchIterations, initGlobalCursor, errorCount, MAX_TERMINAL_ID, START_SYMBOL_ID, configEnableMultiFile , configEnableIslandMode } from "./engine";
import { globalAstRoot, setLastParsedAstRoot } from "./lsp";
import { initQueryArena, resetQueryArena, clearDiagnostics } from "../graph";
import { diag_count_reduce, diag_count_clone, diag_count_append, diag_count_shift, g_counter_lex_calls, g_counter_expected_tokens_calls, g_counter_action_memo_hits, g_counter_action_memo_misses, g_counter_peak_active_heads, resetDebugCounters, resetFrontierLexMemo, invokeLexer, g_expectedMemoState, g_expectedFrontierPos, g_expectedFrontierVersion, furthestDyingPos, bestDyingHead, bestAcceptingHead, setBestDyingHead, setBestAcceptingHead, acceptedNode, bestAcceptedCost, bestAcceptedRealBytes, bestAcceptedCount, bestAcceptedPad, bestAcceptedPrec } from "./loop/loop-actions";
import { cloneNodeShallow, fixNodeLength, fixNodeLengthRecursive, sanitizeTree, wrapWithTrailingErrors } from "./loop/loop-tree";
import { g_oldTree, g_editStart, g_editOldEnd, g_editNewEnd, t_editRangesPtr, t_editRangesCount, t_defaultSingleEdit, g_isMultiEdit, TextEditRange, setEditRanges } from "./loop/loop-incremental";
import { parseLR } from "./loop/loop-lr";
import { advanceGLR } from "./loop/loop-glr";

export { diag_count_reduce, diag_count_clone, diag_count_append, diag_count_shift, g_counter_lex_calls, g_counter_expected_tokens_calls, g_counter_action_memo_hits, g_counter_action_memo_misses, g_counter_peak_active_heads, getDebugCounter, resetDebugCounters, findActionEntry, lookupActions, resetFrontierLexMemo, addStateExpectedTokens, savedExpectedTokensPtr, lastPeekedTokenLen, lastPeekedTokenEnd, peekNextTokenInState, t_stateReachability, t_stateReachabilityComputed, isEpsilonReachable, g_stateCanAcceptMaxCost, stateCanAccept, isPureErrorNode, getBestAcceptingHead, furthestDyingPos, bestDyingHead, bestAcceptingHead, setBestDyingHead, setBestAcceptingHead, acceptedNode, bestAcceptedCost, bestAcceptedRealBytes, bestAcceptedCount, bestAcceptedPad, bestAcceptedPrec } from "./loop/loop-actions";
export { cloneNodeShallow, fixNodeLength, fixNodeLengthRecursive, getRightmostLeafSpan } from "./loop/loop-tree";
export { g_lastSlicedEnd, getListDepth, concatLists, appendToList, extractListSlice } from "./loop/loop-lists";
export { g_oldTree, g_editStart, g_editOldEnd, g_editNewEnd, t_editRangesPtr, t_editRangesCount, t_defaultSingleEdit, g_isMultiEdit, TextEditRange, setEditRanges, mapNewPosToOldPos, mapOldPosToNewPos, isOldRangeEdited, findReusableNode } from "./loop/loop-incremental";
export { advanceGLR } from "./loop/loop-glr";
export { configEnableIslandMode, configEnableIslandMode as g_configIslandMode };

/**
 * Entry point for the ModelScript incremental parser.
 *
 * @param oldTree Pointer to the root of the previously parsed AST (for incremental reuse), or 0 for fresh parse.
 * @param editStart Byte offset where the edit starts.
 * @param editOldEnd Byte offset where the old replaced text ended.
 * @param editNewEnd Byte offset where the new inserted text ends.
 * @returns Pointer to the new AST root node.
 */
let g_lastGcChunkCount: u32 = 0;

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
    let first = TextEditRange.at(editsPtr, 0);
    eStart = first.start;
    eOldEnd = first.oldEnd;
    eNewEnd = first.newEnd;
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
      t_defaultSingleEdit = atomicChunkAlloc(offsetof<TextEditRange>());
    }
    let edit = TextEditRange.at(t_defaultSingleEdit, 0);
    edit.start = editStart;
    edit.oldEnd = editOldEnd;
    edit.newEnd = editNewEnd;
    t_editRangesPtr = t_defaultSingleEdit;
    t_editRangesCount = (editOldEnd > 0 || editNewEnd > 0) ? 1 : 0;
  }

  globalIsCatastrophic = false;
  globalSearchIterations = 0;
  resetDebugCounters();
  resetFrontierLexMemo();
  debugLog(9001, oldTree, editStart, editOldEnd);

  if (changetype<usize>(t_activeHeads) == 0) {
    initGSS();
    t_globalReduceCollected = changetype<UnmanagedUint32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildNodes = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_globalChildren = changetype<UnmanagedInt32Array>(atomicChunkAlloc(MAX_CHILD_NODES * 4));
    t_lrStateStack = createChunkedUint32Array(10000);
    t_lrNodeStack = createChunkedUint32Array(10000);
    t_lrScannerStack = createChunkedUint32Array(10000);
    t_lrBalanceStack = createChunkedUint32Array(10000);

    initQueryArena();
  } else {
    t_lrStateStack.clear();
    t_lrNodeStack.clear();
    t_lrScannerStack.clear();
    t_lrBalanceStack.clear();
  }

  let pos: u32 = 0;
  let token: i32 = 0;

  // Only perform complete reset if we are not resuming from an async suspend
  if (!isSuspended) {
    if (oldTree == 0) {
      if (!configEnableMultiFile) {
        resetGeneration(1);
        S().freeNodeHead = 0;
        g_lastGcChunkCount = 0;
      }
      setParseWatermark(false);
    } else {
      // Clear the free list: free-list nodes are from the old tree's Gen1 space
      S().freeNodeHead = 0;
      setParseWatermark(true);
    }

    resetGeneration(0);
    initGSS();
    setBestDyingHead(0);
    setBestAcceptingHead(0);
    resetQueryArena();
    clearDiagnostics();
    resetExpectedTokensPool();
    diag_count_reduce = 0;
    diag_count_clone = 0;
    diag_count_append = 0;
    diag_count_shift = 0;
    errorCount = 0;
    lexPos = 0;
    lexLen = 0;
    currentScannerState = 0;
    pos = 0;

    initGlobalCursor(oldTree);

    currentParserMode = MODE_LR;
    let accepted = parseLR();
    if (currentParserMode == MODE_LR) {
      if (oldTree != 0 && !configEnableMultiFile && S().activeRootCount == 0 && S().gen1_active_chunk >= g_lastGcChunkCount + 16) {
        clearAstMarks(accepted);
        g_lastGcChunkCount = S().gen1_active_chunk;
      }
      globalAstRoot = accepted;
      setLastParsedAstRoot(accepted);
      debugLog(9100, diag_count_reduce, diag_count_clone, diag_count_append);
      debugLog(9101, diag_count_shift, 0, 0);
      debugLog(9701, g_counter_lex_calls as i32, g_counter_expected_tokens_calls as i32, g_counter_peak_active_heads as i32);
      debugLog(9702, g_counter_action_memo_hits as i32, g_counter_action_memo_misses as i32, 0);
      debugLog(9002, editNewEnd, accepted, currentParserMode);
      t_editRangesPtr = 0;
      t_editRangesCount = 0;
      g_editStart = 0;
      g_editOldEnd = 0;
      g_editNewEnd = 0;
      return accepted;
    }
  }
  isSuspended = false;

  // Error recovery trackers
  furthestDyingPos = 0;
  setBestDyingHead(0);

  setBestAcceptingHead(0);
  acceptedNode = 0;
  bestAcceptedCost = 999999;
  bestAcceptedRealBytes = 0; // Track amount of input consumed (more is better)
  bestAcceptedCount = 0xffffffff; // Track GSS fragmentation (fewer is better)
  bestAcceptedPad = 0xffffffff; // Track leftmost match padding (smaller is better)
  bestAcceptedPrec = -999999;
  lastBestCost = 999999;
  lastIterCount = 0;
  globalLoopIterations = 0;
  advanceGLR();

  if (acceptedNode != 0) {
    setBestDyingHead(0);
    if (bestAcceptingHead != 0) {
      let bah = changetype<ParseHead>(bestAcceptingHead);
      commitDiagnostics(bah.errorTail);
    }
      sanitizeTree(acceptedNode);
      fixNodeLengthRecursive(acceptedNode);
      let acceptedPos: u32 = bestAcceptingHead != 0 ? changetype<ParseHead>(bestAcceptingHead).pos : 0;
      let finalTree = wrapWithTrailingErrors(acceptedNode, acceptedPos);
      if (finalTree != acceptedNode) {
        let errSibling = getNodeNextSibling(getNodeFirstChild(finalTree));
        if (errSibling != 0 && getNodeType(errSibling) == NODE_TYPE_ERROR) {
          fixNodeLength(errSibling);
          fixNodeLength(finalTree);
        }
      }
      if (oldTree != 0 && !configEnableMultiFile && S().activeRootCount == 0 && S().gen1_active_chunk >= g_lastGcChunkCount + 16) {
        clearAstMarks(finalTree);
        g_lastGcChunkCount = S().gen1_active_chunk;
      }
      globalAstRoot = finalTree;
      setLastParsedAstRoot(finalTree);
      debugLog(9100, diag_count_reduce, diag_count_clone, diag_count_append);
      debugLog(9101, diag_count_shift, activeHeadsCount, nextHeadsCount);
      debugLog(9701, g_counter_lex_calls as i32, g_counter_expected_tokens_calls as i32, g_counter_peak_active_heads as i32);
      debugLog(9702, g_counter_action_memo_hits as i32, g_counter_action_memo_misses as i32, 0);
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
    let maxWalkHops4: u32 = MAX_CHILD_NODES;
    while (curr && maxWalkHops4-- > 0) {
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

      // Report unexpected token error at the failure point
      if (inputLength > p) {
        let firstTokLen: u32 = lexLen > 0 ? (lexLen as u32) : 1;
        if (p + firstTokLen > inputLength) firstTokLen = inputLength > p ? inputLength - p : 1;
        reportGlobalError(p as u32, (p + firstTokLen) as u32);
      }

      // Force lexer to accept any token during garbage collection
      // v5 fix: use bounded fill instead of hardcoded 2048
      let _catCopyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
      if (_catCopyLen > 65536) _catCopyLen = 65536;
      memory.fill(expected_tokens, 1, _catCopyLen);
      g_expectedMemoState = -1;
      g_expectedFrontierPos = 0xffffffff;
      g_expectedFrontierVersion = 0xffffffff;

      while (p < inputLength) {
        let tok = lex(p);
        if (tok == TOKEN_EOF) break;
        let pad = srcLexPos > p ? srcLexPos - p : 0;
        let tLen = lexLen;
        if (tLen == 0) {
          p += 1;
          continue;
        }

        if (lastTokNode == 0 && pad > 0) {
          setNodePadding(unparsedNode, getNodePadding(unparsedNode) + pad);
          let curLen = getNodeByteLength(unparsedNode);
          setNodeByteLength(unparsedNode, curLen >= pad ? curLen - pad : 0);
        }
        let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, lastTokNode == 0 ? 0 : pad, tLen, 0, false);
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

    let totalNodes = nodeCount < (MAX_CHILD_NODES as u32) ? nodeCount : (MAX_CHILD_NODES as u32);
    let c_idx = totalNodes;

    // Append the unparsed chunk
    if (unparsedNode != 0 && c_idx > 0) {
      c_idx--;
      if (c_idx < (MAX_CHILD_NODES as u32)) t_globalChildNodes[c_idx] = unparsedNode;
    }

    // Append the successfully parsed nodes from the GSS
    curr = changetype<ParseHead>(bestDyingHead);
    let maxWalkHops5: u32 = MAX_CHILD_NODES;
    while (curr && maxWalkHops5-- > 0) {
      if (curr.astNode != 0 && c_idx > 0) {
        c_idx--;
        if (c_idx < (MAX_CHILD_NODES as u32)) t_globalChildNodes[c_idx] = curr.astNode;
      }
      curr = curr.prev;
    }

    let firstChildPadding = totalNodes > 0 ? getNodePadding(t_globalChildNodes[0]) : 0;
    let root = allocNode(
      START_SYMBOL_ID as u16,
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
      if (lastChild == 0) {
        setNodePadding(clone, 0);
        setFirstChild(root, clone);
      } else {
        setNextSibling(lastChild, clone);
      }
      lastChild = clone;
    }

    globalAstRoot = root;
    setLastParsedAstRoot(root);
    debugLog(9701, g_counter_lex_calls as i32, g_counter_expected_tokens_calls as i32, g_counter_peak_active_heads as i32);
    debugLog(9702, g_counter_action_memo_hits as i32, g_counter_action_memo_misses as i32, 0);
    debugLog(9003, root, 999999, errorCount);
    t_editRangesPtr = 0;
    t_editRangesCount = 0;
    g_editStart = 0;
    g_editOldEnd = 0;
    g_editNewEnd = 0;
    return root;
  }
  globalAstRoot = 0;
  setLastParsedAstRoot(0);
  debugLog(9701, g_counter_lex_calls as i32, g_counter_expected_tokens_calls as i32, g_counter_peak_active_heads as i32);
  debugLog(9702, g_counter_action_memo_hits as i32, g_counter_action_memo_misses as i32, 0);
  debugLog(9003, 0, 999999, errorCount);
  t_editRangesPtr = 0;
  t_editRangesCount = 0;
  g_editStart = 0;
  g_editOldEnd = 0;
  g_editNewEnd = 0;
  return 0;
}
