// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Incremental edit range tracking, coordinate mapping, and reusable AST node search.
 */

import { globalCursorDepth, cursorNodeStack, cursorContentStartStack, globalCursorGotoNextSibling, globalCursorGotoParent, globalCursorGotoFirstChild } from "../gss";
import { getNodeType, getNodeFlags, getNodePadding, getNodeByteLength, getNodeFirstChild, getNodeNextSibling, FLAG_IS_LIST, FLAG_HAS_ERROR, FLAG_IS_TAINED, FLAG_IS_INSERTED, FLAG_FRAGILE, getNodeEnvHash, getNodeStartState, getNodeReductionLookahead } from "../../arena";
import { lexLen, peekChar, peekCharLen } from "../../parser";
import { ACTION_SHIFT, debugLog, tempActions, MAX_TERMINAL_ID } from "../engine";
import { lookupActions } from "./loop-actions";

/**
 * Returns true if `node` may be reused when followed by `nextTok`.
 *
 * Non-terminal subtrees record the lookahead token that was current when they were
 * reduced (see `setNodeReductionInfo`). If the token following the subtree changed,
 * reductions inside it (e.g. precedence decisions at its right edge) may differ, so
 * reuse is rejected. Terminals, list nodes (whose B-tree chunks don't carry a
 * meaningful lookahead) and nodes with no recorded lookahead are accepted.
 */
export function reuseLookaheadMatches(node: u32, nextTok: i32): bool {
  if (getNodeType(node) <= (MAX_TERMINAL_ID as u16)) return true;
  if ((getNodeFlags(node) & FLAG_IS_LIST) != 0) return true;
  let la = getNodeReductionLookahead(node);
  if (la == 0) return true;
  return la == ((nextTok as u32) & 0x7fff);
}

export let g_oldTree: u32 = 0;
export let g_editStart: u32 = 0;
export let g_editOldEnd: u32 = 0;
export let g_editNewEnd: u32 = 0;

// --- Tier 4: Multi-Range Incremental Edits ---
export let t_editRangesPtr: usize = 0;
export let t_editRangesCount: u32 = 0;
export let t_defaultSingleEdit: usize = 0;

/**
 * Unmanaged view over a 12-byte text edit range [start, oldEnd, newEnd] in linear memory.
 *
 * Coordinate convention (sequential edits, sorted by `start`): every edit is expressed in
 * the coordinates of the text *after all previous edits were applied*.
 * - `start`  : edit start (new-text coordinates)
 * - `newEnd` : `start + insertedLength` (new-text coordinates)
 * - `oldEnd` : `start + deletedLength`; the true old-text end is `oldEnd - prevDelta`,
 *              where `prevDelta` is the sum of `newEnd - oldEnd` over the previous edits.
 */
@unmanaged
export class TextEditRange {
  start: u32;
  oldEnd: u32;
  newEnd: u32;

  @inline static at(ptr: usize, index: u32 = 0): TextEditRange {
    return changetype<TextEditRange>(ptr + index * offsetof<TextEditRange>());
  }

  @inline swapWith(other: TextEditRange): void {
    let s = this.start;
    let o = this.oldEnd;
    let n = this.newEnd;
    this.start = other.start;
    this.oldEnd = other.oldEnd;
    this.newEnd = other.newEnd;
    other.start = s;
    other.oldEnd = o;
    other.newEnd = n;
  }
}

export function setEditRanges(ptr: usize, count: u32): void {
  t_editRangesPtr = ptr;
  t_editRangesCount = count;
  // Ensure edit intervals are monotonically sorted by start offset
  if (count > 1 && ptr != 0) {
    for (let i: u32 = 0; i < count - 1; i++) {
      for (let j: u32 = 0; j < count - 1 - i; j++) {
        let r1 = TextEditRange.at(ptr, j);
        let r2 = TextEditRange.at(ptr, j + 1);
        if (r1.start > r2.start) {
          r1.swapWith(r2);
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
    let edit = TextEditRange.at(t_editRangesPtr, i);
    if (pos < edit.start) {
      let mapped: i32 = (pos as i32) - delta;
      return mapped < 0 ? 0xffffffff : (mapped as u32);
    }
    if (pos >= edit.start && pos < edit.newEnd) {
      return 0xffffffff;
    }
    delta += (edit.newEnd as i32) - (edit.oldEnd as i32);
  }
  let finalMapped: i32 = (pos as i32) - delta;
  return finalMapped < 0 ? 0xffffffff : (finalMapped as u32);
}

/**
 * Maps an old-text position to the new text. Returns 0xffffffff if `oldPos` lies strictly
 * inside a replaced range. Positions at or after an edit's old end are shifted by that edit.
 */
export function mapOldPosToNewPos(oldPos: u32): u32 {
  if (t_editRangesCount <= 1) {
    if (g_editNewEnd == 0 && g_editOldEnd == 0) return oldPos;
    if (oldPos >= g_editOldEnd) return g_editNewEnd + (oldPos - g_editOldEnd);
    if (oldPos > g_editStart) return 0xffffffff;
    return oldPos;
  }
  let prevDelta: i32 = 0;
  for (let i: u32 = 0; i < t_editRangesCount; i++) {
    let edit = TextEditRange.at(t_editRangesPtr, i);
    let oldStartSigned: i32 = (edit.start as i32) - prevDelta;
    let oldEndSigned: i32 = (edit.oldEnd as i32) - prevDelta;
    let oldStart: u32 = oldStartSigned < 0 ? 0 : (oldStartSigned as u32);
    let oldEnd: u32 = oldEndSigned < 0 ? 0 : (oldEndSigned as u32);
    if (oldPos <= oldStart) {
      let mapped: i32 = (oldPos as i32) + prevDelta;
      return mapped < 0 ? 0xffffffff : (mapped as u32);
    }
    if (oldPos < oldEnd) return 0xffffffff;
    prevDelta += (edit.newEnd as i32) - (edit.oldEnd as i32);
  }
  let finalMapped: i32 = (oldPos as i32) + prevDelta;
  return finalMapped < 0 ? 0xffffffff : (finalMapped as u32);
}

export function isOldRangeEdited(start: u32, end: u32): boolean {
  if (t_editRangesCount <= 1) {
    if (g_editOldEnd == 0 && g_editNewEnd == 0) return false;
    return !(end <= g_editStart || start >= g_editOldEnd);
  }

  let prevDelta: i32 = 0;
  for (let i: u32 = 0; i < t_editRangesCount; i++) {
    let edit = TextEditRange.at(t_editRangesPtr, i);
    let oldStart = (edit.start as i32 - prevDelta) as u32;
    let oldEnd = (edit.oldEnd as i32 - prevDelta) as u32;
    if (end > oldStart && start < oldEnd) {
      return true;
    }
    prevDelta += (edit.newEnd - edit.oldEnd) as i32;
  }
  return false;
}

export let g_isMultiEdit: boolean = false;

export function isWhitespaceBetween(from: u32, to: u32): bool {
  let p = from;
  while (p < to) {
    let ch = peekChar(p);
    if (ch != 32 && ch != 9 && ch != 10 && ch != 13) {
      return false;
    }
    let clen = peekCharLen(p);
    if (clen == 0) break;
    p += clen;
  }
  return p >= to;
}

/** Upper bound on cursor steps in a single `findReusableNode` search (runaway guard). */
const REUSE_SEARCH_MAX_STEPS: u32 = 1 << 16;

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
 * @param curToken Token freshly lexed at `targetSrcOldPos` in the new text (-1 if unknown).
 *                 Terminal leaves are only reused if they match this token's type and length.
 * @returns Pointer to a reusable AST node, or 0 if none found.
 */
/**
 * Monotonically advances the global incremental cursor to the first node in `g_oldTree`
 * whose byte span ends after `targetOldPos`. Called once per frontierPos round in GLR mode.
 */
export function advanceGlobalCursorTo(targetOldPos: u32): void {
  let steps: u32 = 0;
  while (globalCursorDepth >= 0 && ++steps <= REUSE_SEARCH_MAX_STEPS) {
    let cPtr = cursorNodeStack[globalCursorDepth];
    if (cPtr == 0) {
      if (!globalCursorGotoParent()) return;
      continue;
    }
    let start = cursorContentStartStack[globalCursorDepth];
    let end = start + getNodeByteLength(cPtr);
    if (end <= targetOldPos) {
      if (globalCursorGotoNextSibling()) continue;
      if (!globalCursorGotoParent()) return;
      while (!globalCursorGotoNextSibling()) {
        if (!globalCursorGotoParent()) return;
      }
      continue;
    }
    if (start < targetOldPos) {
      if (globalCursorGotoFirstChild()) continue;
      return;
    }
    return;
  }
}

export function findReusableNode(
  targetOldPos: u32,
  targetSrcOldPos: u32,
  currentState: i32,
  envHash: u32,
  editStart: u32,
  editOldEnd: u32,
  headSym: u32,
  expectedPadding: u32,
  curToken: i32 = -1
): u32 {
  if (globalCursorDepth < 0) {
    return 0;
  }

  let _cursorSearchIter: u32 = 0;
  while (globalCursorDepth >= 0) {
    // Runaway guard only: each iteration is a sibling step, drill-down or ascent, so a
    // legitimate search is bounded by (tree depth x fan-out). The previous cap of
    // MAX_AST_TRAVERSAL_DEPTH (100) silently disabled reuse for items deep in long lists.
    if (++_cursorSearchIter > REUSE_SEARCH_MAX_STEPS) return 0;
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
    let typeFlags = getNodeFlags(cPtr);
    let hasErrorFlags = (typeFlags & (FLAG_HAS_ERROR | FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) != 0;
    let canReuse = (!isError && !isMissing && !hasErrorFlags && nodeEnvHash == envHash);

    if (canReuse) {
      let isTouchingEdit = false;
      let isTerminalLeaf = nodeType <= (MAX_TERMINAL_ID as u16);
      if (t_editRangesCount <= 1) {
        if (end <= g_editStart && g_editStart > 0 && (g_editOldEnd > 0 || g_editNewEnd > 0)) {
          if (end == g_editStart || (!isTerminalLeaf && isWhitespaceBetween(end, g_editStart))) {
            isTouchingEdit = true;
          }
        }
        if (!isTouchingEdit && start == g_editOldEnd && g_editNewEnd > 0 && pad == 0) {
          isTouchingEdit = true;
        }
      } else {
        let prevDelta: i32 = 0;
        for (let i: u32 = 0; i < t_editRangesCount; i++) {
          let edit = TextEditRange.at(t_editRangesPtr, i);
          let oldStart = (edit.start as i32 - prevDelta) as u32;
          let oldEditEnd = (edit.oldEnd as i32 - prevDelta) as u32;
          if (end <= oldStart && oldStart > 0) {
            if (end == oldStart || (!isTerminalLeaf && isWhitespaceBetween((end as i32 + prevDelta) as u32, edit.start))) {
              isTouchingEdit = true;
            }
            break;
          }
          if (start == oldEditEnd && edit.newEnd > 0 && pad == 0) {
            isTouchingEdit = true;
            break;
          }
          prevDelta += (edit.newEnd - edit.oldEnd) as i32;
        }
      }
      if (!isTouchingEdit && !isOldRangeEdited(start, end)) {
        let isTerminalLeaf = nodeType <= (MAX_TERMINAL_ID as u16);
        let canTransition = false;
        let isListChunk = ((typeFlags & FLAG_IS_LIST) != 0) && ((nodeType as u32) == headSym);
        if (isListChunk) {
          canTransition = true;
        } else if (!isTerminalLeaf) {
          canTransition = (nodeStartState == (currentState as u32));
        } else {
          // Terminal leaf reuse: the leaf must be the very token the lexer produces now
          // (contextual lexing or an adjacent edit may have changed it), and currentState
          // must have a valid shift action for it.
          let sameToken = curToken < 0 || ((nodeType as i32) == curToken && byteLen == lexLen);
          let numActions = sameToken ? lookupActions(currentState as i32, nodeType as i32) : 0;
          if (numActions > 0 && tempActions[0] == (ACTION_SHIFT as u32)) {
            canTransition = true;
          }
        }
        if (canTransition) {
          debugLog(9008, cPtr, start, end);
          return cPtr;
        }
      }
    }

    // Node cannot be reused as a whole.
    // If this node directly owns error/inserted/tainted leaves and is a non-list construct
    // (e.g. a broken statement), do not drill down into its broken pieces; reparse it cleanly.
    // Allow drilling down through higher-level container nodes (e.g. root or class definitions)
    // whose FLAG_HAS_ERROR was propagated from a deeper descendant.
    if (nodeType == 0 || (typeFlags & (FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) != 0) {
      return 0;
    }
    let hasErr = (typeFlags & FLAG_HAS_ERROR) != 0;
    if (hasErr && (typeFlags & FLAG_IS_LIST) == 0) {
      let ch = getNodeFirstChild(cPtr);
      while (ch != 0) {
        if (getNodeType(ch) == 0 || (getNodeFlags(ch) & (FLAG_IS_TAINED | FLAG_IS_INSERTED | FLAG_FRAGILE)) != 0) {
          return 0;
        }
        ch = getNodeNextSibling(ch);
      }
    }

    // Drill down into its children to find smaller reusable subtrees.
    if (globalCursorGotoFirstChild()) {
      continue;
    }

    // Cannot drill down further from this leaf.
    return 0;
  }

  return 0;
}
