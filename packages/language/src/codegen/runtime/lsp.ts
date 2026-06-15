// @ts-nocheck

import {
  atomicChunkAlloc,
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
  if (lspBinaryLength + 3 > 500000) return;
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, start);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, end);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, lintId);
}

import { __LEX_FN__, is_extra_token, lexLen, setLexLen } from "./parser";

function scanPaddingForErrors(start: u32, padLen: u32): void {
  if (padLen == 0) return;
  let end = start + padLen;
  let p = start;
  let errorStart: i32 = -1;

  let savedLexLen = lexLen;

  while (p < end) {
    let token = __LEX_FN__(p);

    // Fallback if __LEX_FN__ somehow doesn't advance pos (infinite loop guard)
    let advance = lexLen > 0 ? lexLen : 2;

    if (token == 0) break; // EOF

    if (is_extra_token[token]) {
      // It's a valid extra token (whitespace, comment, etc.)
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
    } else {
      // It's NOT an extra! It's an error fragment in the padding!
      if (errorStart == -1) {
        errorStart = p as i32;
      }
    }

    p += advance;
  }

  if (errorStart != -1) {
    allocDiagnostic(errorStart as u32, end, 0, 0);
  }

  setLexLen(savedLexLen);
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
    // 3. Mark the node as an error if it's explicitly typed as ERROR (0)
    // We only emit diagnostics for LEAF error nodes to prevent squiggling
    // valid syntax that was successfully shifted but wrapped in a fragmented root.
    if (isErrorNode) {
      // Ignore 0-length ERROR nodes to prevent the editor from squiggling the preceding valid word
      if (firstChild == 0 && len > 0) {
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
