/* eslint-disable */
// @ts-nocheck
import { getNodeByteLength, getNodeFirstChild, getNodeNextSibling, getNodePadding } from "./arena";
import { ChunkedUint32Array } from "./array";

import { createChunkedUint32Array } from "./array";

// TreeCursor State Machine for Persistent AST
export const cursorNodeStack = createChunkedUint32Array(128);
export const cursorOffsetStack = createChunkedUint32Array(128);

/**
 * A lightweight, zero-GC state machine for traversing the generated AST.
 * Models tree-sitter's cursor API, allowing O(1) allocation traversal of the tree
 * while computing absolute byte offsets dynamically on the fly.
 */
class TreeCursor {
  private depth: i32 = -1;

  /**
   * Initializes the cursor at the provided root node.
   * @param rootPtr The pointer to the root node of the AST.
   */
  constructor(rootPtr: u32) {
    if (rootPtr != 0) {
      this.depth = 0;
      cursorNodeStack[0] = rootPtr;
      cursorOffsetStack[0] = 0;
    }
  }

  /**
   * Gets the physical arena pointer to the node currently under the cursor.
   */
  get currentNode(): u32 {
    if (this.depth < 0) return 0;
    return cursorNodeStack[this.depth];
  }

  /**
   * Retrieves the absolute start byte index of the current node in the input string.
   * Computed dynamically by adding the node's padding to its accumulated relative offset.
   */
  get startByte(): u32 {
    if (this.depth < 0) return 0;
    return cursorOffsetStack[this.depth] + getNodePadding(this.currentNode);
  }

  /**
   * Retrieves the absolute end byte index of the current node.
   */
  get endByte(): u32 {
    if (this.depth < 0) return 0;
    return this.startByte + getNodeByteLength(this.currentNode);
  }

  /**
   * Moves the cursor to the first child of the current node.
   * @returns true if a child exists and the cursor moved, false otherwise.
   */
  gotoFirstChild(): boolean {
    if (this.depth < 0) return false;
    let child = getNodeFirstChild(this.currentNode);
    if (child == 0) return false;
    
    // The first child's pre-padding absolute offset is identical to the parent's
    // because the parent's padding is strictly defined as the whitespace before its first token.
    let absStart = cursorOffsetStack[this.depth]; 
    this.depth++;
    cursorNodeStack[this.depth] = child;
    cursorOffsetStack[this.depth] = absStart;
    return true;
  }

  /**
   * Moves the cursor to the next sibling of the current node.
   * @returns true if a sibling exists and the cursor moved, false otherwise.
   */
  gotoNextSibling(): boolean {
    if (this.depth < 0) return false;
    let sibling = getNodeNextSibling(this.currentNode);
    if (sibling == 0) return false;
    
    // A sibling's accumulated offset begins exactly at the end byte of the current node.
    let nextOffset = this.startByte + getNodeByteLength(this.currentNode);
    cursorNodeStack[this.depth] = sibling;
    cursorOffsetStack[this.depth] = nextOffset;
    return true;
  }

  /**
   * Moves the cursor to the parent of the current node.
   * @returns true if a parent exists and the cursor moved, false otherwise.
   */
  gotoParent(): boolean {
    if (this.depth <= 0) return false;
    this.depth--;
    return true;
  }
}
