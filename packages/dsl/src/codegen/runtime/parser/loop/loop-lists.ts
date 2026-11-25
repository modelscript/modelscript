// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview O(log N) balanced list concatenation, appending, and incremental slice extraction.
 */

import { allocNode, getNodeType, getNodeFlags, getNodePadding, getNodeLeadingPad, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, setFirstChild, setNextSibling, setNodeFlags, setNodePadding, setNodeByteLength, FLAG_IS_LIST, FLAG_INVISIBLE, FLAG_LIST_BOUNDARY, FLAG_HAS_ERROR, FLAG_IS_TAINED, FLAG_IS_INSERTED, FLAG_FRAGILE, getNodeStartState, setNodeMerkleHash } from "../../arena";
import { type_is_list, MAX_AST_TRAVERSAL_DEPTH, LIST_MAX_CHILDREN, LIST_SPLIT_POINT, debugLog, MAX_TERMINAL_ID } from "../engine";
import { diag_count_append } from "./loop-actions";
import { g_editStart, isWhitespaceBetween } from "./loop-incremental";
import { cloneNodeShallow, fixNodeLength, copyChildren, isMutable } from "./loop-tree";

export let g_lastSlicedEnd: u32 = 0;

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
let _listRecurDepth: u32 = 0;
let appendListCalls = 0;

/**
 * Fallback combination of two nodes that never discards content: returns a new invisible
 * parent of type `sym` with shallow clones of `leftNode` and `rightNode` as children.
 * Used when `concatLists` cannot perform a proper balanced merge.
 */
function concatFlatPair(leftNode: u32, rightNode: u32, sym: u16, envHash: u32, asList: bool): u32 {
  if (leftNode == 0) return cloneNodeShallow(rightNode);
  if (rightNode == 0) return cloneNodeShallow(leftNode);
  let errFlag = (getNodeFlags(leftNode) | getNodeFlags(rightNode)) & FLAG_HAS_ERROR;
  let p = allocNode(sym, getNodePadding(leftNode), 0, envHash, false, getNodeStartState(leftNode));
  setNodeFlags(p, (asList ? FLAG_IS_LIST : (0 as u16)) | FLAG_INVISIBLE | errFlag);
  let l = cloneNodeShallow(leftNode);
  setNodePadding(l, 0);
  let r = cloneNodeShallow(rightNode);
  setFirstChild(p, l);
  setNextSibling(l, r);
  setNextSibling(r, 0);
  fixNodeLength(p);
  return p;
}

/**
 * Concatenates two AST nodes into a single list of type `listSym`.
 * Extremely complex logic handles flattening uneven trees and splitting
 * trees that exceed `LIST_MAX_CHILDREN` (to ensure operations on the AST
 * remain O(log N) instead of O(N) when scanning siblings).
 */
export function concatLists(leftNode: u32, rightNode: u32, listSym: u16, envHash: u32): u32 {
  _listRecurDepth++;
  // Cycle / runaway-recursion guard. Never drop an operand: fall back to a flat pair.
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    debugLog(9401, leftNode, rightNode, listSym as u32);
    return concatFlatPair(leftNode, rightNode, listSym, envHash, true);
  }

  if (listSym == 0) {
    listSym = getNodeType(leftNode) != 0 ? getNodeType(leftNode) : getNodeType(rightNode);
  }
  let fallbackSym = listSym;
  if (listSym > (MAX_TERMINAL_ID as u16) && listSym < (type_is_list.length as u16)) {
    if (type_is_list[listSym] != 1) {
      listSym = 0; // Prevent non-list structural symbols (Equation/Decl) from creating phantom wrapper nodes
    }
  }
  if (listSym == 0) {
    // Cannot determine a valid list symbol — don't wrap in ERROR-typed nodes.
    _listRecurDepth--;
    if (leftNode == 0 || getNodeByteLength(leftNode) == 0) return cloneNodeShallow(rightNode);
    if (rightNode == 0 || getNodeByteLength(rightNode) == 0) return cloneNodeShallow(leftNode);
    // Both operands carry content: keep both under an invisible (non-list) wrapper that
    // consumers flatten, rather than silently discarding one of them.
    debugLog(9402, leftNode, rightNode, fallbackSym as u32);
    return concatFlatPair(leftNode, rightNode, fallbackSym, envHash, false);
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
    let clone = cloneNodeShallow(rightNode);
    let leftPad = getNodePadding(leftNode);
    if (leftPad > 0 && getNodePadding(clone) == 0) {
      setNodePadding(clone, leftPad);
    }
    return clone;
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
      lDirectChildCount = 1;
    }
  }

  // If the trees are at the same depth, attempt to merge their children
  if (lDepth == rDepth) {
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
           // Bug #3 fix: Accumulate the first child's padding on cloneLeft (its
           // direct parent), not on p (the outer wrapper). fixNodeLength(p) will
           // later absorb cloneLeft's padding via the standard invariant.
           setNodePadding(cloneLeft, getNodePadding(cloneLeft) + getNodePadding(clone));
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
  let rightMost = getNodeFirstChild(leftNode);
  for (let i = 0; i < lDirectChildCount - 1; i++) {
    rightMost = getNodeNextSibling(rightMost);
  }
  let newRightMost = concatLists(rightMost, rightNode, listSym, envHash);
  let nrDepth = getListDepth(newRightMost, listSym);

  if (nrDepth == lDepth && lDirectChildCount >= LIST_MAX_CHILDREN) {
    let origC1 = getNodeFirstChild(newRightMost);
    if (origC1 != 0) {
      let origC2 = getNodeNextSibling(origC1);
      let c1 = cloneNodeShallow(origC1);
      let c2 = origC2 != 0 ? cloneNodeShallow(origC2) : 0;

      let superP = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
      setNodeFlags(superP, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let p = allocNode(listSym, 0, 0, envHash);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);

      let newRightChunk = allocNode(listSym, 0, 0, envHash); // fixNodeLength absorbs its first child's padding
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
      if (lastChild2 == 0) {
        setNodePadding(newRightChunk, getNodePadding(newRightChunk) + getNodePadding(newRightMost));
        setFirstChild(newRightChunk, c1);
      } else {
        setNodePadding(c1, getNodePadding(c1) + getNodePadding(newRightMost));
        setNextSibling(lastChild2, c1);
      }
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
  }

  let p = allocNode(listSym, getNodePadding(leftNode), 0, envHash);
  setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
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

  if (nrDepth == lDepth) {
    let origC1 = getNodeFirstChild(newRightMost);
    if (origC1 == 0) {
      // Degenerate: recursive concat returned an empty list. Just attach newRightMost directly.
      if (lastChild == 0) setFirstChild(p, newRightMost);
      else setNextSibling(lastChild, newRightMost);
      setNextSibling(newRightMost, 0);
      setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
      fixNodeLength(p);
      _listRecurDepth--;
      return p;
    }
    let origC2 = getNodeNextSibling(origC1); // origC1 is non-null here

    let c1 = cloneNodeShallow(origC1);
    let c2 = origC2 != 0 ? cloneNodeShallow(origC2) : 0; // B5 fix: null check

    if (lastChild == 0) {
      setNodePadding(p, getNodePadding(p) + getNodePadding(newRightMost));
      setFirstChild(p, c1);
    } else {
      setNodePadding(c1, getNodePadding(c1) + getNodePadding(newRightMost));
      setNextSibling(lastChild, c1);
    }
    if (c2 != 0) setNextSibling(c1, c2);
    if (c2 != 0) setNextSibling(c2, 0);
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
    fixNodeLength(p);
    _listRecurDepth--;
    return p;
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
 * Appends a single leaf node to a list node of type `listSym`.
 * Tries to perform an in-place mutation if `leftNode` is mutable and has room.
 * Otherwise, clones the list structure to safely append without disturbing shared branches.
 */
export function appendToList(leftNode: u32, leafOrig: u32, listSym: u16, envHash: u32, isBoundary: boolean = true): u32 {
  let combinedErrorFlag = (getNodeFlags(leftNode) | getNodeFlags(leafOrig)) & FLAG_HAS_ERROR;
  appendListCalls++;
  diag_count_append++;
  _listRecurDepth++;
  if (_listRecurDepth > 50) {
    _listRecurDepth--;
    let leaf = isMutable(leafOrig) ? leafOrig : cloneNodeShallow(leafOrig);
    setNextSibling(leaf, 0);
    if (leftNode == 0) return leaf;
    return concatFlatPair(leftNode, leaf, listSym, envHash, true);
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

  if (isBoundary) {
    setNodeFlags(leaf, getNodeFlags(leaf) | FLAG_LIST_BOUNDARY);
  }

  // B-tree append: descend the rightmost spine to the deepest chunk, append there and
  // propagate splits upward. All items therefore stay at the same depth, keeping the
  // list tree O(log N) deep (previously, appends after the first split were attached
  // beside the chunks at the top level, so depth grew linearly with list length).
  let root = appendRec(leftNode, leaf, listSym, envHash, isBoundary, combinedErrorFlag);
  let split = g_appendSplit;
  g_appendSplit = 0;
  if (split != 0) {
    let p = allocNode(listSym, getNodePadding(root), 0, envHash, false, getNodeStartState(root));
    setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | combinedErrorFlag);
    root = ownForPaddingChange(root);
    setNodePadding(root, 0); // parent absorbs first child's padding
    setFirstChild(p, root);
    setNextSibling(root, split);
    setNextSibling(split, 0);
    fixNodeLength(p);
    root = p;
  }
  _listRecurDepth--;
  return root;
}

/** Extra right sibling chunk produced by a split inside `appendRec` (0 if none). */
let g_appendSplit: u32 = 0;

/** True if `node` is an (invisible) chunk of the list `listSym`. */
@inline
function isListChunkOf(node: u32, listSym: u16): bool {
  return node != 0 && getNodeType(node) == listSym && (getNodeFlags(node) & FLAG_IS_LIST) != 0;
}

/**
 * Returns `node` if it may be mutated in place, otherwise a fresh shallow clone
 * (preserving its sibling link) that can be.
 */
function ownForPaddingChange(node: u32): u32 {
  if (isMutable(node)) return node;
  let clone = cloneNodeShallow(node);
  setNextSibling(clone, getNodeNextSibling(node));
  return clone;
}

/**
 * Returns a list chunk equivalent to `node` whose child links may be modified:
 * `node` itself if mutable, otherwise a copy with shallow-cloned children.
 */
function ownListChunk(node: u32, listSym: u16, envHash: u32): u32 {
  if (isMutable(node)) return node;
  let p = allocNode(listSym, getNodePadding(node), 0, envHash, false, getNodeStartState(node));
  setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE | (getNodeFlags(node) & FLAG_HAS_ERROR));
  copyChildren(p, node);
  fixNodeLength(p);
  return p;
}

/**
 * Detaches the children following `splitTail` from the owned chunk `node` and moves
 * them into a new chunk, which is returned. Lengths/padding of both chunks are fixed.
 */
function splitChunkAfter(node: u32, splitTail: u32, listSym: u16, envHash: u32, errFlag: u16): u32 {
  let head = getNodeNextSibling(splitTail);
  setNextSibling(splitTail, 0);
  fixNodeLength(node);
  head = ownForPaddingChange(head);
  let right = allocNode(listSym, getNodePadding(head), 0, envHash, false, getNodeStartState(head));
  setNodeFlags(right, FLAG_IS_LIST | FLAG_INVISIBLE | errFlag);
  setNodePadding(head, 0); // the chunk absorbs its first child's padding
  setFirstChild(right, head);
  fixNodeLength(right);
  return right;
}

/**
 * Appends `leaf` to the rightmost deepest chunk of the list subtree `node`.
 * Returns the (possibly copied) replacement for `node`; if `node` overflowed, the
 * split-off right sibling is stored in `g_appendSplit`.
 */
function appendRec(node: u32, leaf: u32, listSym: u16, envHash: u32, isBoundary: boolean, errFlag: u16): u32 {
  g_appendSplit = 0;
  let count: i32 = 0;
  let last: u32 = 0;
  let c = getNodeFirstChild(node);
  while (c != 0) {
    count++;
    last = c;
    c = getNodeNextSibling(c);
  }

  if (isListChunkOf(last, listSym)) {
    // Internal level: recurse into the rightmost chunk.
    let newLast = appendRec(last, leaf, listSym, envHash, isBoundary, errFlag);
    let split = g_appendSplit;
    g_appendSplit = 0;
    let owned = ownListChunk(node, listSym, envHash);
    // Replace the last child of `owned` with `newLast`.
    let prev: u32 = 0;
    let cur = getNodeFirstChild(owned);
    while (getNodeNextSibling(cur) != 0) {
      prev = cur;
      cur = getNodeNextSibling(cur);
    }
    if (prev == 0) setFirstChild(owned, newLast);
    else setNextSibling(prev, newLast);
    setNextSibling(newLast, split);
    if (split != 0) {
      setNextSibling(split, 0);
      count++;
    }
    setNodeFlags(owned, getNodeFlags(owned) | errFlag);
    if (count > LIST_MAX_CHILDREN) {
      // Internal chunks hold whole items, so any position is a valid split point.
      let tail = getNodeFirstChild(owned);
      for (let i = 1; i < count / 2; i++) tail = getNodeNextSibling(tail);
      g_appendSplit = splitChunkAfter(owned, tail, listSym, envHash, errFlag);
    } else {
      fixNodeLength(owned);
    }
    return owned;
  }

  // Leaf level: holds the list items themselves.
  let owned = ownListChunk(node, listSym, envHash);
  setNodeFlags(owned, getNodeFlags(owned) | errFlag);
  let lastOwned = getNodeFirstChild(owned);
  if (lastOwned != 0) {
    while (getNodeNextSibling(lastOwned) != 0) lastOwned = getNodeNextSibling(lastOwned);
  }

  if (count < LIST_MAX_CHILDREN || !isBoundary || lastOwned == 0) {
    if (lastOwned == 0) {
      setNodePadding(owned, getNodePadding(owned) + getNodePadding(leaf));
      setNodePadding(leaf, 0);
      setFirstChild(owned, leaf);
      setNextSibling(leaf, 0);
      setNodeByteLength(owned, getNodeByteLength(leaf));
    } else {
      setNextSibling(lastOwned, leaf);
      setNextSibling(leaf, 0);
      setNodeByteLength(owned, getNodeByteLength(owned) + getNodePadding(leaf) + getNodeByteLength(leaf));
    }
    setNodeMerkleHash(owned, 0, 0);
    return owned;
  }

  // Overflow: split after the first item boundary at or beyond LIST_SPLIT_POINT, so an
  // item is never separated from the separator that was reduced together with it.
  let splitTail = getNodeFirstChild(owned);
  for (let i = 0; i < LIST_SPLIT_POINT - 1; i++) {
    if (getNodeNextSibling(splitTail) == 0) break;
    splitTail = getNodeNextSibling(splitTail);
  }
  let initialSplitTail = splitTail;
  let foundBoundary = false;
  while (getNodeNextSibling(splitTail) != 0) {
    if ((getNodeFlags(splitTail) & FLAG_LIST_BOUNDARY) != 0) {
      foundBoundary = true;
      break;
    }
    splitTail = getNodeNextSibling(splitTail);
  }
  if (!foundBoundary) splitTail = initialSplitTail;

  if (getNodeNextSibling(splitTail) == 0) {
    // Nothing to move: append to this chunk.
    setNextSibling(splitTail, leaf);
    setNextSibling(leaf, 0);
    fixNodeLength(owned);
    return owned;
  }

  let right = splitChunkAfter(owned, splitTail, listSym, envHash, errFlag);
  let rLast = getNodeFirstChild(right);
  while (getNodeNextSibling(rLast) != 0) rLast = getNodeNextSibling(rLast);
  setNextSibling(rLast, leaf);
  setNextSibling(leaf, 0);
  fixNodeLength(right);
  g_appendSplit = right;
  return owned;
}

/**
 * Recursively extracts elements of a list node within the range [sliceStart, sliceEnd).
 * Returns a new (or reused) list node containing only the sliced elements, or 0 if none.
 */
export function extractListSlice(
  node: u32,
  nodeContentStart: u32,
  sliceStart: u32,
  sliceEnd: u32,
  listSym: u16,
  envHash: u32
): u32 {
  if (node == 0) return 0;
  let byteLen = getNodeByteLength(node);
  let nodeContentEnd = nodeContentStart + byteLen;
  if (nodeContentEnd <= sliceStart || nodeContentStart >= sliceEnd) return 0;

  let flags = getNodeFlags(node);
  if ((flags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) != 0 || getNodeType(node) == 0) {
    return 0;
  }
  let isList = (flags & FLAG_IS_LIST) != 0;

  if (!isList) {
    if (nodeContentStart >= sliceStart && nodeContentEnd <= sliceEnd) {
      if (sliceEnd == g_editStart && g_editStart > 0) {
        let isTerm = getNodeType(node) <= (MAX_TERMINAL_ID as u16);
        if (nodeContentEnd == sliceEnd || (!isTerm && isWhitespaceBetween(nodeContentEnd, sliceEnd))) {
          return 0;
        }
      }
      let clone = cloneNodeShallow(node);
      setNextSibling(clone, 0);
      g_lastSlicedEnd = nodeContentEnd;
      return clone;
    }
    return 0;
  }

  // If the entire node is cleanly inside [sliceStart, sliceEnd], reuse it directly!
  if (nodeContentStart >= sliceStart && nodeContentEnd <= sliceEnd) {
    let touchesEdit = false;
    if (sliceEnd == g_editStart && g_editStart > 0) {
      if (nodeContentEnd == sliceEnd || isWhitespaceBetween(nodeContentEnd, sliceEnd)) {
        touchesEdit = true;
      }
    }
    if (!touchesEdit) {
      let clone = cloneNodeShallow(node);
      setNextSibling(clone, 0);
      g_lastSlicedEnd = nodeContentEnd;
      return clone;
    }
  }

  let firstSlicedChild: u32 = 0;
  let lastSlicedChild: u32 = 0;
  let child = getNodeFirstChild(node);
  let curOffset = nodeContentStart;
  let isFirstChild = true;
  let firstChildIncluded = false;

  while (child != 0) {
    let childFlags = getNodeFlags(child);
    if ((childFlags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) != 0 || getNodeType(child) == 0) {
      return 0;
    }

    let cPad = getNodeLeadingPad(child);
    let cStart = isFirstChild ? curOffset : curOffset + cPad;
    let cLen = getNodeByteLength(child);
    let cEnd = cStart + cLen;
    let wasFirst = isFirstChild;
    isFirstChild = false;

    if (cEnd <= sliceStart) {
      curOffset = cEnd;
      child = getNodeNextSibling(child);
      continue;
    }

    if (cStart >= sliceEnd) {
      break;
    }

    let childIsList = (childFlags & FLAG_IS_LIST) != 0;
    let extractedChild: u32 = 0;
    let childSliceStart = firstSlicedChild != 0 ? cStart : sliceStart;

    if (cStart == childSliceStart && cEnd <= sliceEnd) {
      if (sliceEnd == g_editStart && g_editStart > 0) {
        let isTerm = getNodeType(child) <= (MAX_TERMINAL_ID as u16);
        if (cEnd == sliceEnd || (!isTerm && isWhitespaceBetween(cEnd, sliceEnd))) {
          if (childIsList) {
            let savedSlicedEnd = g_lastSlicedEnd;
            extractedChild = extractListSlice(child, cStart, childSliceStart, sliceEnd, listSym, envHash);
            if (extractedChild == 0) {
              g_lastSlicedEnd = savedSlicedEnd;
            }
            if (wasFirst && extractedChild != 0) firstChildIncluded = true;
          } else {
            break;
          }
        } else {
          extractedChild = cloneNodeShallow(child);
          setNextSibling(extractedChild, 0);
          g_lastSlicedEnd = cEnd;
          if (wasFirst) firstChildIncluded = true;
        }
      } else {
        extractedChild = cloneNodeShallow(child);
        setNextSibling(extractedChild, 0);
        g_lastSlicedEnd = cEnd;
        if (wasFirst) firstChildIncluded = true;
      }
    } else if (childIsList) {
      let savedSlicedEnd = g_lastSlicedEnd;
      extractedChild = extractListSlice(child, cStart, childSliceStart, sliceEnd, listSym, envHash);
      if (extractedChild == 0) {
        g_lastSlicedEnd = savedSlicedEnd; // Don't let failed recursion advance the end pointer
      }
      if (wasFirst && extractedChild != 0) firstChildIncluded = true;
    }

    if (extractedChild != 0) {
      if (firstSlicedChild == 0) {
        firstSlicedChild = extractedChild;
        lastSlicedChild = extractedChild;
      } else {
        setNextSibling(lastSlicedChild, extractedChild);
        lastSlicedChild = extractedChild;
      }
      if (g_lastSlicedEnd < cEnd) {
        if (sliceEnd == 0xffffffff) return 0;
        break;
      }
    } else {
      if (sliceEnd == 0xffffffff || firstSlicedChild == 0) {
        return 0;
      }
      break;
    }

    curOffset = cEnd;
    child = getNodeNextSibling(child);
  }

  if (firstSlicedChild == 0) return 0;

  let leadingPad = firstChildIncluded ? getNodePadding(node) : 0;
  let p = allocNode(listSym, leadingPad, 0, envHash);
  setNodeFlags(p, FLAG_IS_LIST | FLAG_INVISIBLE);
  if (leadingPad > 0) {
    setNodePadding(firstSlicedChild, 0);
  }
  setFirstChild(p, firstSlicedChild);
  fixNodeLength(p);
  return p;
}
