// @ts-nocheck

import {
  atomicChunkAlloc,
  getInputBuffer,
  getNodeByteLength,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  setNodeFlags,
} from "./arena";
import { errorCount, getErrorEnd, getErrorStart } from "./engine";
import { inputLength } from "./parser";

// --- LSP Endpoints ---

let t_lspTraverseStack: u32 = 0;
let t_lspOffsetStack: u32 = 0;
let t_lspVisitedNodes: u32 = 0;
let lspVisitedCount: u32 = 0;

// --- Binary Serialization ---
let t_lspBinaryBuffer: u32 = 0;
let lspBinaryLength: u32 = 0;

export function lsp_getBinaryBuffer(): u32 {
  return t_lspBinaryBuffer;
}
export function lsp_getBinaryLength(): u32 {
  return lspBinaryLength;
}

function allocDiagnostic(start: u32, end: u32, lintId: u32, argPtr: u32): void {
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, start);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, end);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, lintId);
}

const CHAR_SPACE: u16 = 32;
const CHAR_TAB: u16 = 9;
const CHAR_LF: u16 = 10;
const CHAR_CR: u16 = 13;
const CHAR_SLASH: u16 = 47;
const CHAR_HASH: u16 = 35;
const CHAR_STAR: u16 = 42;

function scanPaddingForErrors(start: u32, padLen: u32): void {
  if (padLen == 0) return;
  let end = start + padLen;
  let p = start;
  let errorStart: i32 = -1;

  while (p < end) {
    let c = load<u16>(getInputBuffer() + p);

    // Check if it's whitespace
    if (__IGNORE_WS__ && (c == CHAR_SPACE || c == CHAR_TAB || c == CHAR_LF || c == CHAR_CR)) {
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
      p += 2;
      continue;
    }

    // Check for line comment //
    if (
      __IGNORE_COMMENT_SLASH__ &&
      c == CHAR_SLASH &&
      p + 2 < end &&
      load<u16>(getInputBuffer() + p + 2) == CHAR_SLASH
    ) {
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
      p += 4;
      while (p < end && load<u16>(getInputBuffer() + p) != CHAR_LF) p += 2;
      continue;
    }

    // Check for line comment #
    if (__IGNORE_COMMENT_HASH__ && c == CHAR_HASH) {
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
      p += 2;
      while (p < end && load<u16>(getInputBuffer() + p) != CHAR_LF) p += 2;
      continue;
    }

    // Check for block comment /* ... */
    if (
      __IGNORE_COMMENT_BLOCK__ &&
      c == CHAR_SLASH &&
      p + 2 < end &&
      load<u16>(getInputBuffer() + p + 2) == CHAR_STAR
    ) {
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
      p += 4;
      let depth = 1;
      while (p + 2 < end && depth > 0) {
        let cc = load<u16>(getInputBuffer() + p);
        let cn = load<u16>(getInputBuffer() + p + 2);
        if (cc == CHAR_SLASH && cn == CHAR_STAR) {
          depth++;
          p += 4;
        } else if (cc == CHAR_STAR && cn == CHAR_SLASH) {
          depth--;
          p += 4;
        } else p += 2;
      }
      if (depth > 0) {
        p = end; // unmatched block comment, consume rest
      }
      continue;
    }

    // It's a non-whitespace, non-comment character: start/continue error range!
    if (errorStart == -1) {
      errorStart = p as i32;
    }
    p += 2;
  }

  if (errorStart != -1) {
    allocDiagnostic(errorStart as u32, end, 0, 0);
  }
}

function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < lspVisitedCount; i++) {
    let node = load<u32>(t_lspVisitedNodes + i * 4);
    let val = load<u32>(node, 0);
    if ((val >> 10) & 0x3f & 8) {
      store<u32>(node, val & ~(8 << 10), 0);
    }
  }
  lspVisitedCount = 0;
}

export function lsp_getDiagnostics(astRoot: u32): u32 {
  if (t_lspBinaryBuffer == 0) {
    t_lspBinaryBuffer = atomicChunkAlloc(500000 * 4);
    t_lspTraverseStack = atomicChunkAlloc(100000 * 4);
    t_lspOffsetStack = atomicChunkAlloc(100000 * 4);
    t_lspVisitedNodes = atomicChunkAlloc(200000 * 4);
  }

  lspBinaryLength = 0;
  lspVisitedCount = 0;

  // 1. Add all engine-level syntax errors (from parse failures)
  for (let i: i32 = 0; i < errorCount; i++) {
    allocDiagnostic(getErrorStart(i), getErrorEnd(i), 0, 0);
  }

  if (astRoot == 0) return lspBinaryLength;

  let stackTop = 0;
  store<u32>(t_lspTraverseStack + stackTop * 4, astRoot);
  store<u32>(t_lspOffsetStack + stackTop * 4, 0);
  stackTop++;

  while (stackTop > 0) {
    stackTop--;
    let node = load<u32>(t_lspTraverseStack + stackTop * 4);
    let start = load<u32>(t_lspOffsetStack + stackTop * 4);

    let flags = getNodeFlags(node);
    if ((flags & 8) != 0) continue;
    setNodeFlags(node, flags | 8);
    store<u32>(t_lspVisitedNodes + lspVisitedCount++ * 4, node);

    let pad = getNodePadding(node);
    let len = getNodeByteLength(node);
    let nodeStart = start + pad;
    let nodeEnd = nodeStart + len;
    let type = getNodeType(node);

    let isErrorNode = type == 0;
    let firstChild = getNodeFirstChild(node);
    if (isErrorNode) {
      if (node == astRoot && firstChild != 0) {
        // Skip wrapper error node
      } else {
        allocDiagnostic(nodeStart, nodeEnd, 0, 0);
      }
    } else if (firstChild == 0 && len == 0 && type <= __MAX_TERMINAL_ID__ && type != 1023 && type != 47 && type != 36) {
      // Unlexed empty terminal (2 bytes for UTF-16)
      let dStart = nodeStart;
      let dEnd = nodeStart + 2;
      if (dEnd > inputLength) {
        dEnd = inputLength;
        if (dEnd > 0) dStart = dEnd - 2;
        if (dStart < 0) dStart = 0;
      }
      allocDiagnostic(dStart, dEnd, 0, 0);
    }

    if (firstChild == 0) {
      scanPaddingForErrors(start, pad);
    }

    let child = getNodeFirstChild(node);
    if (child != 0) {
      let cCount = 0;
      let temp = child;
      while (temp != 0) {
        cCount++;
        temp = getNodeNextSibling(temp);
      }

      let currOffset = start + pad - getNodePadding(child);
      let ptr = stackTop + cCount - 1;
      let pushCount = 0;
      while (child != 0 && pushCount < cCount) {
        pushCount++;
        store<u32>(t_lspTraverseStack + ptr * 4, child);
        let padVal = getNodePadding(child);
        let cLen = padVal + getNodeByteLength(child);
        store<u32>(t_lspOffsetStack + ptr * 4, currOffset);
        currOffset += cLen;
        child = getNodeNextSibling(child);
        ptr--;
      }
      stackTop += cCount;
    }
  }

  let astRootEnd: u32 = 0;
  if (astRoot != 0) {
    astRootEnd = getNodePadding(astRoot) + getNodeByteLength(astRoot);
  }
  if (astRootEnd < inputLength) {
    scanPaddingForErrors(astRootEnd, inputLength - astRootEnd);
  }

  lsp_clearVisited();
  return lspBinaryLength;
}
