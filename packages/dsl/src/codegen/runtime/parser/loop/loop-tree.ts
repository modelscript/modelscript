// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview AST subtree cloning, sanitization, trailing error wrapping, and length recomputation.
 */

import { ParseHead, activeHeadsCount, nextHeadsCount, pausedHeadsCount } from "../gss";
import { allocNode, allocLeafNode, isLeafNode, getNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, setNodeByteLength, FLAG_IS_LIST, FLAG_GC_MARK, FLAG_LSP_VISITED, FLAG_HAS_ERROR, FLAG_IS_INSERTED, FLAG_EXTRACTED, FLAG_IS_SHARED, getNodeEnvHash, getNodeStartState, getNodeReductionLookahead, setNodeReductionLookahead, atomicChunkAlloc, isCurrentParseNode, setNodeMerkleHash, copyNodeMerkleHash } from "../../arena";
import { ChunkedUint32Array, createChunkedUint32Array } from "../../core/array";
import { lexPos, lexLen, srcLexPos, currentScannerState, is_extra_token, inputLength, lex, SYMBOL_COUNT } from "../../parser";
import { TOKEN_EOF, TOKEN_UNKNOWN, NODE_TYPE_ERROR, MODE_GLR, currentParserMode, debugLog, expected_tokens, MAX_TERMINAL_ID } from "../engine";
import { diag_count_clone, savedExpectedTokensPtr, g_expectedMemoState, g_expectedFrontierPos, g_expectedFrontierVersion, bestDyingHead, bestAcceptingHead, t_sanitizeStack, t_sanitizeVisited } from "./loop-actions";
import { g_oldTree } from "./loop-incremental";

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
export function deepCloneSubtree(root: u32, _depth: i32 = 0): u32 {
  if (root == 0) return 0;
  if (changetype<usize>(t_cloneStack) == 0) {
    t_cloneStack = createChunkedUint32Array(50000);
  } else {
    t_cloneStack.clear();
  }

  let rootClone = isLeafNode(root)
    ? allocLeafNode(getNodeType(root), getNodePadding(root), getNodeByteLength(root), getNodeEnvHash(root), false, 0)
    : allocNode(getNodeType(root), getNodePadding(root), getNodeByteLength(root), getNodeEnvHash(root), false, getNodeStartState(root));
  setNodeReductionLookahead(rootClone, getNodeReductionLookahead(root));
  setNodeFlags(rootClone, getNodeFlags(root) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
  copyNodeMerkleHash(rootClone, root);

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
      let childClone = isLeafNode(child)
        ? allocLeafNode(getNodeType(child), getNodePadding(child), getNodeByteLength(child), getNodeEnvHash(child), false, 0)
        : allocNode(getNodeType(child), getNodePadding(child), getNodeByteLength(child), getNodeEnvHash(child), false, getNodeStartState(child));
      setNodeReductionLookahead(childClone, getNodeReductionLookahead(child));
      setNodeFlags(childClone, getNodeFlags(child) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
      copyNodeMerkleHash(childClone, child);

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

/**
 * Post-parse sanitization algorithm. Walk the AST to:
 * 1. Remove nodes with corrupt/invalid Type IDs that occasionally slip through error recovery.
 * 2. Identify shared subtrees (aliased pointers resulting from GLR tree forks) and clone them
 *    so the final AST is a strict DAG, preventing infinite loops during LSP traversal.
 *
 * @param root The accepted AST root node.
 */
export function sanitizeTree(root: u32): void {
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
        if (!isCurrentParseNode(node, g_oldTree) || (prevChild != 0 && !isCurrentParseNode(prevChild, g_oldTree))) {
          prevChild = child;
        } else {
          if (prevChild == 0) setFirstChild(node, nextSib);
          else setNextSibling(prevChild, nextSib);
          modified = true;
        }
      } else {
        if (g_oldTree != 0 && !isCurrentParseNode(child, g_oldTree)) {
          prevChild = child;
          child = nextSib;
          continue;
        }

        // Check if this child was already visited (shared subtree)
        let cFlags = getNodeFlags(child);
        let isShared = (cFlags & FLAG_LSP_VISITED) != 0;

        if (isShared) {
          // Cannot mutate Gen1 parent or Gen1 prevChild to break aliasing
          if (!isCurrentParseNode(node, g_oldTree) || (prevChild != 0 && !isCurrentParseNode(prevChild, g_oldTree))) {
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
 * If the parser accepts a prefix of the file but leaves unparsed trailing text,
 * this function captures the remainder and wraps it in an ERROR node appended
 * to the AST root. This ensures `inputLength` bytes are fully represented.
 *
 * @param acceptedNode The AST root node.
 * @returns The wrapped node.
 */
export function wrapWithTrailingErrors(acceptedNode: u32, acceptedPos: u32 = 0): u32 {
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

  // Force lexer to accept any token during trailing inspection, saving previous mask
  if (expected_tokens == 0) expected_tokens = atomicChunkAlloc(65536);
  if (savedExpectedTokensPtr == 0) savedExpectedTokensPtr = atomicChunkAlloc(65536);
  let _copyLen: u32 = (MAX_TERMINAL_ID as u32) + 1;
  if (_copyLen > 65536) _copyLen = 65536;
  memory.copy(savedExpectedTokensPtr, expected_tokens, _copyLen);
  memory.fill(expected_tokens, 1, _copyLen);

  // Skip whitespace and extra tokens (e.g. comments) to find the first real trailing token.
  let scanP = trailingStart;
  let firstTok = lex(scanP);
  while (firstTok >= 0 && firstTok <= MAX_TERMINAL_ID && load<u8>(is_extra_token + firstTok) == 1) {
    if (lexLen == 0) {
      scanP += 1;
      break;
    }
    let start = srcLexPos > scanP ? srcLexPos : scanP;
    scanP = start + lexLen;
    firstTok = lex(scanP);
  }

  // srcLexPos - trailingStart = whitespace/comments between accepted node end and first error token
  let errPad: u32 = srcLexPos > trailingStart ? srcLexPos - trailingStart : 0;

  // If the first token is EOF, there's only trailing whitespace/comments
  if (firstTok == TOKEN_EOF) {
    memory.copy(expected_tokens, savedExpectedTokensPtr, _copyLen);
    g_expectedMemoState = -1;
    g_expectedFrontierPos = 0xffffffff;
    g_expectedFrontierVersion = 0xffffffff;
    lexPos = savedLexPos;
    lexLen = savedLexLen;
    srcLexPos = savedSrcLexPos;
    currentScannerState = savedScannerState;
    if (trailingLen > 0) {
      if (isMutable(acceptedNode)) {
        setNodeByteLength(acceptedNode, getNodeByteLength(acceptedNode) + trailingLen);
      } else {
        let cloned = cloneNodeShallow(acceptedNode);
        setNodeByteLength(cloned, getNodeByteLength(acceptedNode) + trailingLen);
        acceptedNode = cloned;
      }
    }
    return acceptedNode;
  }

  let errByteLen = trailingLen > errPad ? trailingLen - errPad : 0;
  if (errByteLen == 0) {
    memory.copy(expected_tokens, savedExpectedTokensPtr, _copyLen);
    g_expectedMemoState = -1;
    g_expectedFrontierPos = 0xffffffff;
    g_expectedFrontierVersion = 0xffffffff;
    lexPos = savedLexPos;
    lexLen = savedLexLen;
    srcLexPos = savedSrcLexPos;
    currentScannerState = savedScannerState;
    return acceptedNode;
  }

  let errorNode = allocNode(NODE_TYPE_ERROR, errPad, errByteLen, 0);
  setNodeFlags(errorNode, getNodeFlags(errorNode) | FLAG_HAS_ERROR);

  // Lex the error content into child tokens of the ERROR node for AST fidelity
  let lastTokNode: u32 = 0;
  let errContentStart = trailingStart + errPad;
  let lexP = errContentStart;

  while (lexP < inputLength) {
    let tok = lex(lexP);
    while (tok >= 0 && tok <= MAX_TERMINAL_ID && load<u8>(is_extra_token + tok) == 1) {
      if (lexLen == 0) {
        lexP += 1;
        break;
      }
      let start = srcLexPos > lexP ? srcLexPos : lexP;
      lexP = start + lexLen;
      tok = lex(lexP);
    }
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
  g_expectedMemoState = -1;
  g_expectedFrontierPos = 0xffffffff;
  g_expectedFrontierVersion = 0xffffffff;
  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  currentScannerState = savedScannerState;

  let rootType = getNodeType(acceptedNode);
  if (rootType == NODE_TYPE_ERROR || rootType <= (MAX_TERMINAL_ID as u16)) {
    rootType = NODE_TYPE_ERROR;
  }
  let rootPad = getNodePadding(acceptedNode);
  let newRoot = allocNode(rootType, rootPad, inputLength > rootPad ? inputLength - rootPad : 0, 0);
  setNodeFlags(newRoot, getNodeFlags(acceptedNode) | FLAG_HAS_ERROR);
  if (!isMutable(acceptedNode)) {
    acceptedNode = cloneNodeShallow(acceptedNode);
  }
  setNodePadding(acceptedNode, 0);
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
  diag_count_clone++;
  // Mark the original node as shared so its child list isn't mutated in-place,
  // ruining the clone. We use FLAG_IS_SHARED instead of FLAG_EXTRACTED to avoid
  // confusing `injectStrandedNodes` into thinking the original node is a clone.
  setNodeFlags(gc, getNodeFlags(gc) | FLAG_IS_SHARED);
  let clone = isLeafNode(gc)
    ? allocLeafNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc), false, 0)
    : allocNode(getNodeType(gc), getNodePadding(gc), getNodeByteLength(gc), getNodeEnvHash(gc), false, getNodeStartState(gc));
  setNodeReductionLookahead(clone, getNodeReductionLookahead(gc));
  // Keep FLAG_EXTRACTED on the clone so its shared children are not mutated in-place
  setNodeFlags(clone, (getNodeFlags(gc) | FLAG_EXTRACTED) & ~(FLAG_GC_MARK | FLAG_LSP_VISITED));
  setFirstChild(clone, getNodeFirstChild(gc)); // Keep original children
  copyNodeMerkleHash(clone, gc);
  return clone;
}
/**
 * Helper to shallow-clone the children of `leftNode` and attach them to `p`.
 * Used during list concatenation/appending when mutating `leftNode` in-place is unsafe.
 */
export function copyChildren(p: u32, leftNode: u32): u32 {
  let gc = getNodeFirstChild(leftNode);
  let lastChild = 0;
  while (gc != 0) {
    let clone = cloneNodeShallow(gc);
    if (lastChild == 0) {
      if (getNodePadding(p) == 0 && getNodePadding(gc) > 0) {
        setNodePadding(p, getNodePadding(gc));
      }
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
 * Determines whether an AST node can be mutated in-place safely.
 * Returns false if in GLR mode (where subtrees are shared across heads),
 * if the node was extracted/shared, or if it belongs to an older incremental generation.
 */
export function isMutable(ptr: u32): boolean {
  if (ptr == 0) return false;
  // In GLR mode (multiple active heads), never mutate in-place:
  // shared list nodes can be referenced by multiple heads, and
  // mutating one corrupts the others' trees.
  // Note: The current head is popped from the queue during evaluation,
  // so if activeHeadsCount > 0, it means there is at least one OTHER head.
  // Paused heads and the best dying/accepting fallback heads are parked outside the
  // frontiers but still reference (possibly shared) subtrees, so they count too.
  if (currentParserMode == MODE_GLR && (activeHeadsCount > 0 || nextHeadsCount > 0 || pausedHeadsCount > 0 ||
      bestDyingHead != 0 || bestAcceptingHead != 0)) {
    return false;
  }
  if ((getNodeFlags(ptr) & (FLAG_EXTRACTED | FLAG_IS_SHARED)) != 0) return false;
  return isCurrentParseNode(ptr, g_oldTree);
}

/**
 * Recalculates the total byte length of a parent node by summing the padding
 * and byte length of all its direct children.
 */
export function fixNodeLength(node: u32): void {
  let gc = getNodeFirstChild(node);
  if (gc == 0) return;

  let pPad = getNodePadding(node);
  let totalLen: u32 = 0;
  let foundNonEmpty = false;
  let prev: u32 = 0;
  let curr = gc;

  // Invariant: parent.padding absorbs the first non-empty child's leading whitespace,
  // and that child's padding must be 0. This matches constructReducedParentNode.
  while (curr != 0) {
    let cPad = getNodeLeadingPad(curr);
    let cLen = getNodeByteLength(curr);
    if (!foundNonEmpty && (cPad > 0 || cLen > 0)) {
      foundNonEmpty = true;
      if (cPad > 0) {
        if (pPad == 0) {
          setNodePadding(node, cPad);
        } else if (pPad != cPad) {
          setNodePadding(node, pPad + cPad);
        }
        if (isMutable(curr)) {
          setNodePadding(curr, 0);
        } else {
          let clone = cloneNodeShallow(curr);
          setNodePadding(clone, 0);
          if (prev == 0) {
            setFirstChild(node, clone);
          } else {
            setNextSibling(prev, clone);
          }
          setNextSibling(clone, getNodeNextSibling(curr));
          // Mark remaining siblings as shared so they can't be mutated in-place
          // by operations that share this sibling chain via the clone.
          let sib = getNodeNextSibling(curr);
          while (sib != 0) {
            setNodeFlags(sib, getNodeFlags(sib) | FLAG_IS_SHARED);
            sib = getNodeNextSibling(sib);
          }
          curr = clone;
        }
      }
      totalLen += cLen;
    } else {
      totalLen += cPad + cLen;
    }
    prev = curr;
    curr = getNodeNextSibling(curr);
  }

  setNodeByteLength(node, totalLen);
  setNodeMerkleHash(node, 0, 0);
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
      if (g_oldTree == 0 || isCurrentParseNode(child, g_oldTree)) {
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
 * Finds the exact byte span `[start, end]` (packed as `(start << 32) | end`) of the
 * rightmost non-empty leaf token on `head`'s stack.
 */
export function getRightmostLeafSpan(head: ParseHead | null, fallbackPos: u32): u64 {
  let curr = head;
  let hops = 0;
  while (curr != null && hops++ < 32) {
    let node = curr.astNode;
    if (node != 0 && getNodeByteLength(node) > 0) {
      let nLen = getNodeByteLength(node);
      let nStart = curr.pos >= nLen ? curr.pos - nLen : 0;
      let c = node;
      let guard = 0;
      while (getNodeFirstChild(c) != 0 && guard++ < 64) {
        let ch = getNodeFirstChild(c);
        let off = nStart;
        let lastNonEmpty: u32 = 0;
        let lastStart: u32 = off;
        let idx = 0;
        while (ch != 0) {
          if (idx > 0) off += getNodeLeadingPad(ch);
          let chLen = getNodeByteLength(ch);
          if (chLen > 0 && (getNodeFlags(ch) & FLAG_IS_INSERTED) == 0) {
            lastNonEmpty = ch;
            lastStart = off;
          }
          off += chLen;
          idx++;
          ch = getNodeNextSibling(ch);
        }
        if (lastNonEmpty == 0) break;
        c = lastNonEmpty;
        nStart = lastStart;
      }
      let cLen = getNodeByteLength(c);
      if (cLen > 0) {
        return ((nStart as u64) << 32) | ((nStart + cLen) as u64);
      }
    }
    curr = curr.prev;
  }
  let s = fallbackPos > 0 ? fallbackPos - 1 : 0;
  let e = fallbackPos > s ? fallbackPos : s + 1;
  return ((s as u64) << 32) | (e as u64);
}
