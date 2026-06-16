// @ts-nocheck

import {
  atomicChunkAlloc,
  FLAG_LSP_VISITED,
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

import { debugLog } from "./engine";

function allocDiagnostic(start: u32, end: u32, lintId: u32, argPtr: u32): void {
  debugLog(start, end, lintId, argPtr);
  if (lspBinaryLength > 0 && lintId == 0) {
    let lastLintId = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 1) * 4);
    if (lastLintId == 0) {
      let lastEnd = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 2) * 4);
      let lastStart = load<u32>(t_lspBinaryBuffer + (lspBinaryLength - 3) * 4);
      // Merge if adjacent or overlapping
      if (start <= lastEnd) {
        if (end > lastEnd) {
          store<u32>(t_lspBinaryBuffer + (lspBinaryLength - 2) * 4, end);
        }
        if (start < lastStart) {
          store<u32>(t_lspBinaryBuffer + (lspBinaryLength - 3) * 4, start);
        }
        return;
      }
    }
  }
  if (lspBinaryLength + 3 > 500000) return;
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, start);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, end);
  store<u32>(t_lspBinaryBuffer + lspBinaryLength++ * 4, lintId);
}

import {
  __LEX_FN__,
  currentScannerState,
  is_extra_token,
  lexLen,
  lexPos,
  setCurrentScannerState,
  setLexLen,
  setLexPos,
  setSrcLexPos,
  srcLexPos,
} from "./parser";

function scanPaddingForErrors(start: u32, padLen: u32): void {
  if (padLen == 0) return;
  let end = start + padLen;
  let p = start;
  let errorStart: i32 = -1;

  let savedLexLen = lexLen;
  let savedLexPos = lexPos;
  let savedSrcLexPos = srcLexPos;
  let savedScannerState = currentScannerState;

  while (p < end) {
    let token = __LEX_FN__(p);
    let tokenStart = lexPos;
    let tokenLen = lexLen > 0 ? lexLen : 2;

    // If the token starts exactly at or after our padding end, we are done
    // and should only report skipped spaces before this token if any.
    if (tokenStart >= end) {
      if (errorStart != -1 && (p as i32) > errorStart) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
      }
      errorStart = -1;
      break;
    }

    // Check if lexer skipped any valid whitespace/comments BEFORE the token
    if (tokenStart > p) {
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, p, 0, 0);
        errorStart = -1;
      }
    }

    if (token == 0) break; // EOF

    // Now consider the matched token
    if (is_extra_token[token]) {
      // Valid extra token
      if (errorStart != -1) {
        allocDiagnostic(errorStart as u32, tokenStart, 0, 0);
        errorStart = -1;
      }
    } else {
      // Invalid garbage inside padding!
      if (errorStart == -1) {
        errorStart = tokenStart as i32;
      }
    }

    p = tokenStart + tokenLen;
  }

  if (errorStart != -1) {
    allocDiagnostic(errorStart as u32, end, 0, 0);
  }

  setLexLen(savedLexLen);
  setLexPos(savedLexPos);
  setSrcLexPos(savedSrcLexPos);
  setCurrentScannerState(savedScannerState);
}

function lsp_clearVisited(): void {
  for (let i: u32 = 0; i < lspVisitedCount; i++) {
    let node = load<u32>(t_lspVisitedNodes + i * 4);
    let val = load<u32>(node, 0);
    if (((val >> 10) & FLAG_LSP_VISITED) != 0) {
      store<u32>(node, val & ~((<u32>FLAG_LSP_VISITED) << 10), 0);
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
      allocDiagnostic(dStart, dEnd, type, 0);
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
