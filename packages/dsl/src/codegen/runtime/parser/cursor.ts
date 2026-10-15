// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable */
import { getNodeByteLength, getNodeFirstChild, getNodeNextSibling, getNodePadding } from "../arena";
import { ChunkedUint32Array } from "../core/array";

import { createChunkedUint32Array } from "../core/array";

// TreeCursor State Machine for Persistent AST
export const cursorNodeStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export const cursorOffsetStack: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/**
 * A lightweight, zero-GC state machine for traversing the generated AST.
 * Models tree-sitter's cursor API, allowing O(1) allocation traversal of the tree
 * while computing absolute byte offsets dynamically on the fly.
 */
class TreeCursor {
  private depth: i32 = -1;
  private nodeStack: ChunkedUint32Array = createChunkedUint32Array(128);
  private offsetStack: ChunkedUint32Array = createChunkedUint32Array(128);

  /**
   * Initializes the cursor at the provided root node.
   * @param rootPtr The pointer to the root node of the AST.
   */
  constructor(rootPtr: u32) {
    if (rootPtr != 0) {
      this.depth = 0;
      this.nodeStack[0] = rootPtr;
      this.offsetStack[0] = 0;
    }
  }

  /**
   * Gets the physical arena pointer to the node currently under the cursor.
   */
  get currentNode(): u32 {
    if (this.depth < 0) return 0;
    return this.nodeStack[this.depth];
  }

  /**
   * Retrieves the absolute start byte index of the current node in the input string.
   * Computed dynamically by adding the node's padding to its accumulated relative offset.
   */
  get startByte(): u32 {
    if (this.depth < 0) return 0;
    return this.offsetStack[this.depth] + getNodePadding(this.currentNode);
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
    
    // The first child's padding is 0 because leading whitespace before a parent's first token
    // is stored in the parent's padding field. Thus the first child starts at parent's startByte.
    let absStart = this.startByte;
    this.depth++;
    this.nodeStack[this.depth] = child;
    this.offsetStack[this.depth] = absStart;
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
    this.nodeStack[this.depth] = sibling;
    this.offsetStack[this.depth] = nextOffset;
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
