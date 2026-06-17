/* eslint-disable */
// @ts-nocheck
import { getNodeByteLength, getNodeFirstChild, getNodeNextSibling, getNodePadding } from "./arena";
import { ChunkedUint32Array } from "./array";
// TreeCursor State Machine for Persistent AST

export const cursorNodeStack = new ChunkedUint32Array();
export const cursorOffsetStack = new ChunkedUint32Array();

class TreeCursor {
  private depth: i32 = -1;

  constructor(rootPtr: u32) {
    if (rootPtr != 0) {
      this.depth = 0;
      cursorNodeStack.set(0, rootPtr);
      cursorOffsetStack.set(0, 0);
    }
  }

  get currentNode(): u32 {
    if (this.depth < 0) return 0;
    return cursorNodeStack.get(this.depth);
  }

  get startByte(): u32 {
    if (this.depth < 0) return 0;
    return cursorOffsetStack.get(this.depth) + getNodePadding(this.currentNode);
  }

  get endByte(): u32 {
    if (this.depth < 0) return 0;
    return this.startByte + getNodeByteLength(this.currentNode);
  }

  gotoFirstChild(): boolean {
    if (this.depth < 0) return false;
    let child = getNodeFirstChild(this.currentNode);
    if (child == 0) return false;
    let absStart = cursorOffsetStack.get(this.depth); // First child starts exactly at parent's absolute offset
    this.depth++;
    cursorNodeStack.set(this.depth, child);
    cursorOffsetStack.set(this.depth, absStart);
    return true;
  }

  gotoNextSibling(): boolean {
    if (this.depth < 0) return false;
    let sibling = getNodeNextSibling(this.currentNode);
    if (sibling == 0) return false;
    let nextOffset = this.startByte + getNodeByteLength(this.currentNode);
    cursorNodeStack.set(this.depth, sibling);
    cursorOffsetStack.set(this.depth, nextOffset);
    return true;
  }

  gotoParent(): boolean {
    if (this.depth <= 0) return false;
    this.depth--;
    return true;
  }
}
