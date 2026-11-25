// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview GLR shift, reduce, pop-path DFS, stack breakdown, and accept action handlers.
 */

import { ParseHead, GssEdge, pushActiveHead, pushNextHead, allocParseHead } from "../gss";
import { allocNode, allocLeafNode, getNodeType, setNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_HAS_ERROR, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_FRAGILE, setNodeStartState, setNodeReductionLookahead, getInputBuffer, setNodeMerkleHash, getNodeMerkleHash, getNodeRawMerkleHash, EPHEMERAL_FLAGS } from "../../arena";
import { UnmanagedUint32Array, UnmanagedInt32Array } from "../../core/array";
import { lexPos, lexLen, srcLexPos, currentScannerState, inputLength, peekChar, peekCharLen, inputEncoding } from "../../parser";
import { TOKEN_EOF, NODE_TYPE_ERROR, ACTION_REDUCE, action_offsets, action_data, token_bracket_deltas, isOpenBracketChar, isCloseBracketChar, updateBalanceHash, prod_lengths, prod_lhs, prod_is_invisible, prod_is_list, prod_dynamic_prec, prod_aliases, alias_data, MAX_CHILD_NODES, t_globalChildNodes, t_globalChildren, t_globalReduceCollected, DiagnosticNode, lastBestCost, MAX_TERMINAL_ID, START_SYMBOL_ID, lookupGoto } from "../engine";
import { findShiftTarget } from "../recovery";
import { diag_count_reduce, diag_count_shift, lookupActions, g_reduceLookahead, bestAcceptingHead, setBestAcceptingHead, acceptedNode, bestAcceptedCost, bestAcceptedRealBytes, bestAcceptedCount, bestAcceptedPad, bestAcceptedPrec, isPureErrorNode } from "./loop-actions";
import { cloneNodeShallow } from "./loop-tree";
import { appendToList } from "./loop-lists";


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
export function processShiftAction(head: ParseHead, target: i32, token: i32, pos: u32, isVirtual: boolean, cameFromVirtualQueue: boolean): void {
  let prevBal: u32 = head.balanceHash;
  let newBalance: u32 = prevBal;
  if (token >= 0 && token <= MAX_TERMINAL_ID && changetype<usize>(token_bracket_deltas) != 0 && token_bracket_deltas[token] != 0) {
    newBalance = updateBalanceHash(prevBal, token);
  } else {
    let charLen = peekCharLen(lexPos);
    if (lexLen == charLen) {
      let c = peekChar(lexPos);
      let depth = prevBal & 0xff;
      if (isOpenBracketChar(c)) {
        newBalance = (prevBal & 0xffffff00) | (depth < 255 ? depth + 1 : 255);
      } else if (isCloseBracketChar(c) && depth > 0) {
        newBalance = ((prevBal >>> 10) << 8) | (depth - 1);
      }
    }
  }

  let paddingLength: u32 = 0;
  let leafLen: u32 = 0;
  if (!isVirtual) {
    paddingLength = head.pendingPadding + (srcLexPos > pos ? srcLexPos - pos : 0);
    leafLen = lexLen;
  }

  diag_count_shift++;
  let leaf = allocLeafNode(token as u16, paddingLength, leafLen, newBalance & 0xff, false, head.state as u32);
  if (isVirtual) {
    setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_IS_INSERTED | FLAG_HAS_ERROR);
  } else {
    let lh: u64 = 0xcbf29ce484222325;
    lh ^= (token as u64);
    lh = lh * 0x100000001b3;
    lh ^= (leafLen as u64);
    lh = lh * 0x100000001b3;
    let inBuf = getInputBuffer();
    if (inputEncoding == 0) {
      let basePtr = inBuf + (srcLexPos as usize);
      for (let i: u32 = 0; i < leafLen; i++) {
        lh ^= load<u8>(basePtr + (i as usize)) as u64;
        lh = lh * 0x100000001b3;
      }
    } else {
      let basePtr = inBuf + ((srcLexPos as usize) << 1);
      for (let i: u32 = 0; i < leafLen; i++) {
        lh ^= load<u16>(basePtr + ((i as usize) << 1)) as u64;
        lh = lh * 0x100000001b3;
      }
    }
    setNodeMerkleHash(leaf, (lh & 0xffffffff) as u32, (lh >> 32) as u32);
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
 * Constructs a reduced non-terminal parent CST node from popped GSS child nodes.
 *
 * Computes aggregate byte spans and leading padding, optimizes left-recursive
 * list productions in-place via {@link appendToList}, allocates a new parent node
 * when not appending, shallow-clones and links non-empty child nodes while applying
 * production symbol aliases and propagating error flags, and finally computes a
 * 64-bit FNV-1a Merkle structural hash over the parent and its children.
 *
 * @param lhsSym The non-terminal symbol ID produced by the reduction.
 * @param reduceProd The production rule index being reduced.
 * @param childNodes Buffer containing popped child node pointers.
 * @param childOffset Starting index of this reduction's children in `childNodes`.
 * @param actualCount Number of child nodes popped along this GSS path.
 * @param bottomState The automaton state at the bottom of the reduced GSS path.
 * @param balanceHash Accumulated delimiter balance hash for error recovery ranking.
 * @param isFragile True if the reduction occurred under fragile/speculative recovery.
 * @returns The arena pointer (`u32`) to the newly constructed or appended parent CST node.
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
  // Step 1: Compute the parent's leading padding (inherited from the first non-empty child)
  // and total byte length (first non-empty child's byte length plus all subsequent children's
  // leading padding + byte length).
  let totalByteLength: u32 = 0;
  let firstChildPadding: u32 = 0;
  let firstNonEmptyIdx: i32 = -1;
  if (actualCount > 0) {
    for (let k = 0; k < actualCount; k++) {
      let cPadding = getNodeLeadingPad(childNodes[childOffset + k]);
      let cLen = getNodeByteLength(childNodes[childOffset + k]);
      if (firstNonEmptyIdx == -1 && (cPadding > 0 || cLen > 0)) {
        firstNonEmptyIdx = k;
        firstChildPadding = cPadding;
        totalByteLength += cLen;
      } else {
        totalByteLength += cPadding + cLen;
      }
    }
  }
  diag_count_reduce++;

  // Step 2: Fast-path for left-recursive list productions (e.g., `List -> List Elem`
  // or `List -> List Sep Elem`). Instead of building a deeply nested O(N) binary spine,
  // flatten the new element(s) directly onto the existing list node via `appendToList`.
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
      let parentNode = childNodes[childOffset];
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
      if (g_reduceLookahead != 0) setNodeReductionLookahead(parentNode, g_reduceLookahead);
      if (isFragile) {
        setNodeFlags(parentNode, getNodeFlags(parentNode) | FLAG_FRAGILE);
      }
      return parentNode;
    }
  }

  // Step 3: Allocate a fresh parent non-terminal node and propagate production flags
  // (`FLAG_IS_LIST`, `FLAG_INVISIBLE`, `FLAG_FRAGILE`) and reduction lookahead state.
  let parentNode = allocNode(lhsSym as u16, firstChildPadding, totalByteLength, balanceHash & 0xff, false, bottomState as u32);
  if (g_reduceLookahead != 0) setNodeReductionLookahead(parentNode, g_reduceLookahead);

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

  // Step 4: Shallow-clone each non-null child so it can have independent sibling pointers
  // under this parent (preserving DAG sharing of deeper subtrees), zero out the first child's
  // padding (since it was hoisted to `parentNode`), apply per-position symbol aliases from
  // `prod_aliases`, and bubble up `FLAG_HAS_ERROR`.
  if (actualCount > 0) {
    let lastChild = 0;
    let logicalChildIndex = 0;

    let aliasPtr = prod_aliases[reduceProd];
    let aliasCount = 0;
    if (aliasPtr >= 0) aliasCount = alias_data[aliasPtr];

    for (let k = 0; k < actualCount; k++) {
      let child = childNodes[childOffset + k];
      if (child == 0) {
        logicalChildIndex++;
        continue;
      }

      let clone = cloneNodeShallow(child);
      if (k == 0 || k == firstNonEmptyIdx) {
        setNodePadding(clone, 0);
      }

      let isError = getNodeType(child) == NODE_TYPE_ERROR || (getNodeFlags(child) & (FLAG_HAS_ERROR | FLAG_IS_INSERTED)) != 0;
      if (!isError && aliasPtr >= 0) {
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

  // Step 5: Compute a 64-bit FNV-1a Merkle hash combining the parent's symbol ID,
  // non-ephemeral semantic flags (`~EPHEMERAL_FLAGS`), total byte length, and each
  // child's precomputed 64-bit Merkle hash for O(1) incremental subtree equality checks.
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

  return parentNode;
}

const MAX_POP_PATHS: i32 = 64;
const MAX_POP_DEPTH: i32 = 128;

let t_popPathNodes: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_popPathBottomHeads: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let t_popPathNodeCounts: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_popPathDynDeltas: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_popDfsNodes: UnmanagedInt32Array = changetype<UnmanagedInt32Array>(0);
let t_breakdownChildren: UnmanagedUint32Array = changetype<UnmanagedUint32Array>(0);
let g_popPathCount: i32 = 0;

export function initPopPathBuffers(): void {
  if (changetype<usize>(t_popPathNodes) == 0) {
    t_popPathNodes = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_PATHS * MAX_POP_DEPTH * 4));
    t_popPathBottomHeads = changetype<UnmanagedUint32Array>(heap.alloc(MAX_POP_PATHS * 4));
    t_popPathNodeCounts = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_PATHS * 4));
    t_popPathDynDeltas = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_PATHS * 4));
    t_popDfsNodes = changetype<UnmanagedInt32Array>(heap.alloc(MAX_POP_DEPTH * 4));
    t_breakdownChildren = changetype<UnmanagedUint32Array>(heap.alloc(256 * 4));
  }
}

function recordPopPath(bottomHead: ParseHead, depth: i32, dynDelta: i32 = 0): void {
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
      if (same) {
        if (dynDelta > t_popPathDynDeltas[p]) {
          t_popPathDynDeltas[p] = dynDelta;
        }
        return;
      }
    }
  }
  let idx = g_popPathCount++;
  t_popPathBottomHeads[idx] = bPtr;
  t_popPathNodeCounts[idx] = depth;
  t_popPathDynDeltas[idx] = dynDelta;
  let off = idx * MAX_POP_DEPTH;
  for (let d = 0; d < depth; d++) {
    t_popPathNodes[off + d] = t_popDfsNodes[depth - 1 - d];
  }
}

function dfsPopPaths(
  curr: ParseHead | null,
  needed: i32,
  isList: bool,
  depth: i32,
  dynDelta: i32 = 0
): void {
  if (g_popPathCount >= MAX_POP_PATHS) return;
  if (curr == null) return;
  if (depth >= MAX_POP_DEPTH) return;

  let nextDepth = depth + 1;
  let savedNode = t_popDfsNodes[depth];

  // Traverse primary predecessor curr.prev
  let currPrev = curr.prev;
  if (currPrev != null) {
    let astNode = curr.astNode;
    let isPure = astNode != 0 && isPureErrorNode(astNode);
    let nextNeeded = (!isPure && needed > 0) ? needed - 1 : needed;
    t_popDfsNodes[depth] = astNode as i32;
    let prevHasMore = currPrev.prev != null || currPrev.firstEdge != 0;
    if (nextNeeded == 0 && (!isList || !prevHasMore || currPrev.astNode == 0 || !isPureErrorNode(currPrev.astNode))) {
      recordPopPath(currPrev, nextDepth, dynDelta);
    } else {
      dfsPopPaths(currPrev, nextNeeded, isList, nextDepth, dynDelta);
    }
  }

  // Traverse alternative predecessors curr.firstEdge
  let edgePtr = curr.firstEdge;
  while (edgePtr != 0 && g_popPathCount < MAX_POP_PATHS) {
    let edge = changetype<GssEdge>(edgePtr);
    let target = edge.targetHead;
    if (target != null) {
      let edgeNode = edge.astNode;
      let edgePure = edgeNode != 0 && isPureErrorNode(edgeNode);
      let edgeNeeded = (!edgePure && needed > 0) ? needed - 1 : needed;
      let nextDynDelta = dynDelta + edge.dynamicPrec;
      t_popDfsNodes[depth] = edgeNode as i32;
      let targetHasMore = target.prev != null || target.firstEdge != 0;
      if (edgeNeeded == 0 && (!isList || !targetHasMore || target.astNode == 0 || !isPureErrorNode(target.astNode))) {
        recordPopPath(target, nextDepth, nextDynDelta);
      } else {
        dfsPopPaths(target, edgeNeeded, isList, nextDepth, nextDynDelta);
      }
    }
    edgePtr = edge.nextEdge;
  }

  t_popDfsNodes[depth] = savedNode;
}

/**
 * Allocates the head produced by reducing `head` to `parentNode` and following the goto
 * from `bottom` to `nextState`. Per-path state that a reduction does not change (scanner
 * state at `head.pos`, error state, stack summary, progress count) is carried over.
 * The open ERROR container is intentionally not carried: the reduced parent may own it.
 */
function allocReducedHead(
  head: ParseHead,
  nextState: i32,
  parentNode: u32,
  bottom: ParseHead | null,
  reduceProd: i32,
  dynDelta: i32 = 0
): ParseHead {
  return allocParseHead(
    nextState, parentNode, bottom, head.pos, head.scannerState, head.errorCost,
    head.successfulShifts, head.balanceHash, head.consecutiveInsertions,
    head.dynamicPrec + dynDelta + prod_dynamic_prec[reduceProd], head.pendingPadding, head.errorTail,
    0, head.inErrorState, head.summaryPtr, head.summaryCount, head.nodeCount
  );
}

/**
 * Executes a REDUCE action on the given head for the specified production rule.
 * Operates across single linear chains as well as branched GSS DAG diamonds for any popCount.
 */
export function processReduceAction(head: ParseHead, reduceProd: i32, pos: u32, isConflict: bool = false): ParseHead | null {
  if (reduceProd < 0 || reduceProd >= prod_lengths.length) {
    throw new Error("BAD reduceProd: " + reduceProd.toString());
  }

  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  let isList = prod_is_list[reduceProd] == 1;

  if (popCount == 0) {
    let curr = head;
    let nextState = lookupGoto(curr.state, lhsSym);
    if (nextState == -1) return null;
    let isFragile = isConflict;
    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_globalChildNodes, 0, 0, curr.state, head.balanceHash, isFragile);
    return allocReducedHead(head, nextState, parentNode, curr, reduceProd, 0);
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

  // Case A: Linear path (no DAG diamonds along the popped chain; base head `curr` is not popped)
  if (!hasMultiLink && curr != null) {
    let actualCount: i32 = (MAX_CHILD_NODES as i32) - 1 - c_idx;
    for (let k: i32 = 0; k < actualCount; k++) {
      t_globalChildNodes[k] = t_globalReduceCollected[c_idx + 1 + k];
    }
    let nextState = lookupGoto(curr.state, lhsSym);
    if (nextState == -1) return null;

    let isFragile = isConflict;
    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_globalChildNodes, 0, actualCount, curr.state, head.balanceHash, isFragile);
    return allocReducedHead(head, nextState, parentNode, curr, reduceProd, 0);
  }

  // Case B: Multi-link path pop across GSS diamonds (Tree-sitter ts_stack_pop_count)
  initPopPathBuffers();
  g_popPathCount = 0;
  dfsPopPaths(head, popCount, isList, 0, 0);

  if (g_popPathCount == 0) return null;

  let primaryHead: ParseHead | null = null;
  let isFragile = true;

  for (let p = 0; p < g_popPathCount; p++) {
    let bHead = changetype<ParseHead>(t_popPathBottomHeads[p]);
    let pCount = t_popPathNodeCounts[p];
    let pDynDelta = t_popPathDynDeltas[p];
    if (bHead == null) continue;
    let pNextState = lookupGoto(bHead.state, lhsSym);
    if (pNextState == -1) continue;

    let parentNode = constructReducedParentNode(lhsSym, reduceProd, t_popPathNodes, p * MAX_POP_DEPTH, pCount, bHead.state, head.balanceHash, isFragile);
    let newHead = allocReducedHead(head, pNextState, parentNode, bHead, reduceProd, pDynDelta);

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
export function breakdownTopOfStack(head: ParseHead): ParseHead | null {
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

  let checkState: i32 = baseHead.state;
  for (let i = 0; i < childCount; i++) {
    let childPtr = t_breakdownChildren[i];
    let childType = getNodeType(childPtr);
    let nextState = childType > (MAX_TERMINAL_ID as u16)
      ? lookupGoto(checkState, childType as i32)
      : findShiftTarget(checkState, childType);
    if (nextState == -1) {
      return null;
    }
    t_breakdownChildren[128 + i] = nextState as u32;
    checkState = nextState;
  }

  let currHead: ParseHead = baseHead;
  let currPos: u32 = baseHead.pos;
  let topPad: u32 = getNodePadding(topNode);
  let restoredTopPad = false;

  for (let i = 0; i < childCount; i++) {
    let childPtr = t_breakdownChildren[i];
    let childByteLen = getNodeByteLength(childPtr);
    let childPad = getNodeLeadingPad(childPtr);
    let nextState = t_breakdownChildren[128 + i] as i32;

    if (!restoredTopPad && (childPad > 0 || childByteLen > 0 || i == childCount - 1)) {
      childPad += topPad;
      restoredTopPad = true;
    }

    currPos += childPad + childByteLen;
    // v5 fix: clone child to avoid stale sibling pointers from the reused subtree
    let clonedChild = cloneNodeShallow(childPtr);
    setNodePadding(clonedChild, childPad);
    setNextSibling(clonedChild, 0); // Clear stale sibling link
    if (getNodeFirstChild(clonedChild) != 0) {
      setNodeFlags(clonedChild, getNodeFlags(clonedChild) | FLAG_EXTRACTED);
    }
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
  }

  return currHead;
}

/**
 * Speculatively determines the target LR state of a reduction without constructing AST nodes
 * or pushing speculative heads into the frontier (eliminating head leaks).
 */
function simulateReduceNextState(head: ParseHead, reduceProd: i32, lookaheadTok: i32 = -1): i32 {
  if (reduceProd < 0 || reduceProd >= prod_lengths.length) return -1;
  let popCount = prod_lengths[reduceProd];
  let lhsSym = prod_lhs[reduceProd];
  let isList = prod_is_list[reduceProd] == 1;

  if (popCount == 0) {
    return lookupGoto(head.state, lhsSym);
  }

  let curr: ParseHead | null = head;
  let needed = popCount;
  let hasMultiLink = false;
  while ((needed > 0 || (isList && curr != null && curr.astNode != 0 && isPureErrorNode(curr.astNode))) && curr != null) {
    if (curr.firstEdge != 0) hasMultiLink = true;
    let astNode = curr.astNode;
    let isPure = astNode != 0 && isPureErrorNode(astNode);
    if (!isPure) {
      if (needed > 0) needed--;
    }
    curr = curr.prev;
  }

  let primaryGoto = -1;
  if (curr != null && needed == 0) {
    primaryGoto = lookupGoto(curr.state, lhsSym);
    if (!hasMultiLink || (primaryGoto != -1 && (lookaheadTok < 0 || lookupActions(primaryGoto, lookaheadTok) > 0))) {
      return primaryGoto;
    }
  } else if (!hasMultiLink) {
    return -1;
  }

  // Fallback for merged GSS diamonds: inspect alternative bottom heads via dfsPopPaths
  initPopPathBuffers();
  g_popPathCount = 0;
  dfsPopPaths(head, popCount, isList, 0, 0);
  for (let p = 0; p < g_popPathCount; p++) {
    let bHead = changetype<ParseHead>(t_popPathBottomHeads[p]);
    if (bHead == null) continue;
    let pNext = lookupGoto(bHead.state, lhsSym);
    if (pNext != -1 && (lookaheadTok < 0 || lookupActions(pNext, lookaheadTok) > 0)) {
      return pNext;
    }
    if (primaryGoto == -1 && pNext != -1) {
      primaryGoto = pNext;
    }
  }
  return primaryGoto;
}

/**
 * Performs all lookahead-independent reductions on head before error recovery.
 * Mirrors Tree-sitter's ts_parser__do_all_potential_reductions.
 * Returns the reduced head (or original head if no reductions possible).
 */
export function doAllPotentialReductions(head: ParseHead, frontierPos: u32, tok: i32): ParseHead {
  let curr = head;
  let iters = 0;
  while (iters++ < 8) {
    let state = curr.state;
    if (state < 0 || state >= action_offsets.length) break;
    let actionOffset = action_offsets[state];
    if (actionOffset < 0 || actionOffset >= action_data.length) break;

    let actCount = action_data[actionOffset];
    let idx = actionOffset + 1;
    let shiftCandidateReduce = -1;
    let seenSim0: i32 = -1;
    let seenSim1: i32 = -1;
    let seenSim2: i32 = -1;
    let seenSim3: i32 = -1;

    for (let a = 0; a < actCount; a++) {
      let sym = action_data[idx++];
      let numActions = action_data[idx++];
      for (let na = 0; na < numActions; na++) {
        let aType = action_data[idx++];
        let aTarget = action_data[idx++];
        if (aType == ACTION_REDUCE) {
          if (aTarget >= 0 && aTarget < prod_lhs.length) {
            // B7 fix: prioritize reduction that allows the lookahead token to be shifted
            if (
              shiftCandidateReduce == -1 &&
              tok != TOKEN_EOF &&
              aTarget != seenSim0 &&
              aTarget != seenSim1 &&
              aTarget != seenSim2 &&
              aTarget != seenSim3
            ) {
              if (seenSim0 == -1) seenSim0 = aTarget;
              else if (seenSim1 == -1) seenSim1 = aTarget;
              else if (seenSim2 == -1) seenSim2 = aTarget;
              else if (seenSim3 == -1) seenSim3 = aTarget;
              let rhsLen = prod_lengths[aTarget];
              if (!(curr.state == 0 && rhsLen == 0)) {
                let simNextState = simulateReduceNextState(curr, aTarget, tok);
                if (simNextState != -1 && lookupActions(simNextState, tok) > 0) {
                  shiftCandidateReduce = aTarget;
                }
              }
            }
          }
        }
      }
    }

    let chosenReduce = shiftCandidateReduce;
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
export function processAcceptAction(head: ParseHead): void {
  let t_curr: ParseHead | null = head;
  let t_bytes: u32 = 0;
  let t_count: u32 = 0;
  let firstPad: u32 = 0;
  let realBytes: u32 = 0;
  let maxWalkHops: u32 = MAX_CHILD_NODES;

  while (t_curr && maxWalkHops-- > 0) {
    if (t_curr.astNode != 0) {
      let tNodeType = getNodeType(t_curr.astNode);
      let tNodeLen = getNodeByteLength(t_curr.astNode);
      let tNodePad = getNodePadding(t_curr.astNode);
      if (tNodeType != TOKEN_EOF && (tNodeLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
        t_bytes += tNodePad + tNodeLen;
        t_count++;
        firstPad = tNodePad;
      }
      if (tNodeType != TOKEN_EOF && tNodeType != NODE_TYPE_ERROR) {
        let nodePad = t_curr.prev != null ? tNodePad : 0;
        realBytes += nodePad + tNodeLen;
      }
    }
    t_curr = t_curr.prev;
  }

  let effectiveCost: i32 = head.errorCost;
  if (effectiveCost > 0) {
    let shiftDiscount: i32 = (head.successfulShifts as i32) * 15;
    if (shiftDiscount >= effectiveCost) {
      effectiveCost = 1; // Retain base penalty so 0-error parse always strictly beats it
    } else {
      effectiveCost -= shiftDiscount;
    }
  }

  if (realBytes > inputLength) realBytes = inputLength;
  let unparsedBytes: u32 = inputLength > realBytes ? inputLength - realBytes : 0;
  effectiveCost += (unparsedBytes as i32) * 20;
  // firstPad should not penalize error cost

  let curHasError = acceptedNode != 0 && (((getNodeFlags(acceptedNode) & FLAG_HAS_ERROR) != 0) || (bestAcceptingHead != 0 && (changetype<ParseHead>(bestAcceptingHead).errorCost > 0 || changetype<ParseHead>(bestAcceptingHead).errorTail != 0)));
  let newHasError = (head.astNode != 0 && ((getNodeFlags(head.astNode) & FLAG_HAS_ERROR) != 0)) || head.errorCost > 0 || head.errorTail != 0;
  let errorBetter = curHasError && !newHasError;
  let cleanBeatsError = !curHasError && newHasError;

  let curIsInserted = acceptedNode != 0 && (getNodeFlags(acceptedNode) & FLAG_IS_INSERTED) != 0;
  let newIsInserted = head.astNode != 0 && (getNodeFlags(head.astNode) & FLAG_IS_INSERTED) != 0;
  let insertedBetter = curIsInserted && !newIsInserted && effectiveCost <= bestAcceptedCost;

  let curTailLen = acceptedNode != 0 && bestAcceptingHead != 0 ? getTailLength(changetype<ParseHead>(bestAcceptingHead).errorTail) : 999;
  let newTailLen = getTailLength(head.errorTail);
  let tailBetter = newTailLen < curTailLen && effectiveCost <= bestAcceptedCost;

  let precBetter = effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && head.dynamicPrec > bestAcceptedPrec;
  // The shift discount above saturates at 1, so two recoveries of different raw cost can tie on
  // effectiveCost. Prefer the cheaper repair (e.g. inserting a delimiter beats deleting a valid token).
  let rawBetter = bestAcceptingHead != 0 && effectiveCost == bestAcceptedCost && head.errorCost < changetype<ParseHead>(bestAcceptingHead).errorCost;
  if (
    acceptedNode == 0 ||
    errorBetter ||
    (!cleanBeatsError && (
      effectiveCost < bestAcceptedCost ||
      rawBetter ||
      precBetter ||
      insertedBetter ||
      tailBetter ||
      (effectiveCost == bestAcceptedCost && realBytes > bestAcceptedRealBytes) ||
      (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && head.dynamicPrec == bestAcceptedPrec && firstPad < bestAcceptedPad) ||
      (effectiveCost == bestAcceptedCost && realBytes == bestAcceptedRealBytes && head.dynamicPrec == bestAcceptedPrec && firstPad == bestAcceptedPad && t_count < bestAcceptedCount)
    ))
  ) {
    if (t_count <= 1) {
      setBestAcceptingHead(changetype<u32>(head));
      bestAcceptedCost = effectiveCost;
      bestAcceptedRealBytes = realBytes;
      bestAcceptedCount = t_count;
      bestAcceptedPad = firstPad;
      bestAcceptedPrec = head.dynamicPrec;
      lastBestCost = bestAcceptedCost;

      let singleNode: u32 = 0;
      let rc: ParseHead | null = head;
      let maxWalkHops3: u32 = MAX_CHILD_NODES;
      while (rc && maxWalkHops3-- > 0) {
        if (rc.astNode != 0 && getNodeType(rc.astNode) != TOKEN_EOF) {
          let t = getNodeType(rc.astNode);
          if (singleNode == 0) {
            singleNode = rc.astNode;
          } else if (t > (MAX_TERMINAL_ID as u16) && getNodeType(singleNode) <= (MAX_TERMINAL_ID as u16)) {
            singleNode = rc.astNode;
          }
        }
        rc = rc.prev;
      }

      if (singleNode != 0) {
        acceptedNode = cloneNodeShallow(singleNode);
      } else {
        acceptedNode = head.astNode;
      }
    } else {
      setBestAcceptingHead(changetype<u32>(head));
      bestAcceptedCost = effectiveCost;
      bestAcceptedRealBytes = realBytes;
      bestAcceptedCount = t_count;
      bestAcceptedPad = firstPad;
      bestAcceptedPrec = head.dynamicPrec;
      lastBestCost = bestAcceptedCost;

      let c_idx: i32 = (t_count as i32) - 1;
      t_curr = head;
      while (t_curr && c_idx >= 0) {
        if (t_curr.astNode != 0) {
          let cType = getNodeType(t_curr.astNode);
          let cLen = getNodeByteLength(t_curr.astNode);
          if (cType != TOKEN_EOF && (cLen > 0 || getNodeFirstChild(t_curr.astNode) != 0)) {
            t_globalChildren[c_idx] = t_curr.astNode;
            c_idx--;
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
      let newRoot = allocNode(START_SYMBOL_ID as u16, firstChildPad, targetLen, 0);

      let lastC2: u32 = 0;
      let firstCloned: u32 = 0;
      let appendedError = false;

      for (let i: u32 = 0; i < actualCount; i++) {
        let c = t_globalChildren[i];
        if (c == 0) continue;
        let cType = getNodeType(c);
        if (cType == START_SYMBOL_ID as u16) {
          let innerChild = getNodeFirstChild(c);
          let isFirstInner = true;
          while (innerChild != 0) {
            let clone = cloneNodeShallow(innerChild);
            if (isFirstInner && i > 0) {
              setNodePadding(clone, getNodePadding(clone) + getNodeLeadingPad(c));
            }
            isFirstInner = false;
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

      if (firstCloned != 0) {
        setNodePadding(firstCloned, 0);
        setFirstChild(newRoot, firstCloned);
      }
      if (appendedError) {
        setNodeFlags(newRoot, getNodeFlags(newRoot) | FLAG_HAS_ERROR);
      }
      acceptedNode = newRoot;
    }
  }
}

