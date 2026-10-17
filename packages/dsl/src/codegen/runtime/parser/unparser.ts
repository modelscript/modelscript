// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ast_getTextSpan,
  FLAG_IS_INSERTED,
  FLAG_IS_TAINED,
  getInputBuffer,
  getNodeByteLength,
  getNodeFirstChild,
  getNodeFlags,
  getNodeNextSibling,
  getNodePadding,
  getNodeType,
  inputEncoding,
  stringArenaPtr,
  stringArenaCapacity,
} from "../arena";
import { ChunkedUint32Array, UnmanagedUint32Array, createChunkedUint32Array } from "../core/array";

let t_unparseBuffer: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
let t_unparseIndentSize: u32 = 2;

export function initUnparser(indentSize: u32 = 2): void {
  t_unparseIndentSize = indentSize;
  if (changetype<usize>(t_unparseBuffer) == 0) {
    t_unparseBuffer = createChunkedUint32Array();
  } else {
    t_unparseBuffer.clear();
  }
}

@inline
function isCleanNode(nodeId: u32): boolean {
  let flags = getNodeFlags(nodeId);
  return (flags & (FLAG_IS_TAINED | FLAG_IS_INSERTED)) == 0;
}

@inline
function emitCodePointUtf8(cp: u32): void {
  if (cp < 0x80) {
    t_unparseBuffer.push(cp);
  } else if (cp < 0x800) {
    t_unparseBuffer.push(0xc0 | (cp >> 6));
    t_unparseBuffer.push(0x80 | (cp & 0x3f));
  } else if (cp < 0x10000) {
    t_unparseBuffer.push(0xe0 | (cp >> 12));
    t_unparseBuffer.push(0x80 | ((cp >> 6) & 0x3f));
    t_unparseBuffer.push(0x80 | (cp & 0x3f));
  } else {
    t_unparseBuffer.push(0xf0 | (cp >> 18));
    t_unparseBuffer.push(0x80 | ((cp >> 12) & 0x3f));
    t_unparseBuffer.push(0x80 | ((cp >> 6) & 0x3f));
    t_unparseBuffer.push(0x80 | (cp & 0x3f));
  }
}

/**
 * Emits verbatim bytes of clean node from input buffer or string override arena.
 */
export function emitVerbatimNode(nodeId: u32): void {
  if (changetype<usize>(t_unparseBuffer) == 0) {
    t_unparseBuffer = createChunkedUint32Array();
  }
  let span = ast_getTextSpan(nodeId);
  let start = (span >> 32) as u32;
  let len = (span & 0xffffffff) as u32;
  if (len == 0) return;

  let isOverride =
    stringArenaPtr != 0 &&
    start >= (stringArenaPtr as u32) + 4 &&
    start < ((stringArenaPtr + stringArenaCapacity) as u32);
  let basePtr: usize;
  let isUtf8: boolean;
  let step: u32 = 2;
  if (isOverride) {
    basePtr = start as usize;
    let header = load<u32>((start - 4) as usize);
    isUtf8 = (header & 0x80000000) != 0;
    step = isUtf8 ? 1 : 2;
  } else {
    basePtr = getInputBuffer() + ((start as usize) << 1);
    len = len << 1;
    isUtf8 = false;
    step = 2;
  }

  if (isUtf8) {
    for (let i: u32 = 0; i < len; i++) {
      let b = load<u8>(basePtr + i);
      t_unparseBuffer.push(b as u32);
    }
  } else if (step == 2) {
    let i: u32 = 0;
    while (i + 1 < len) {
      let code = load<u16>(basePtr + i) as u32;
      i += 2;
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
        let low = load<u16>(basePtr + i) as u32;
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i += 2;
        }
      }
      emitCodePointUtf8(code);
    }
  } else {
    for (let i: u32 = 0; i + 3 < len; i += 4) {
      let cp = load<u32>(basePtr + i);
      emitCodePointUtf8(cp);
    }
  }
}

export function emitIndent(depth: u32): void {
  if (changetype<usize>(t_unparseBuffer) == 0) {
    t_unparseBuffer = createChunkedUint32Array();
  }
  let totalSpaces = depth * t_unparseIndentSize;
  for (let i: u32 = 0; i < totalSpaces; i++) {
    t_unparseBuffer.push(32); // ' '
  }
}

export function emitNewline(): void {
  if (changetype<usize>(t_unparseBuffer) == 0) {
    t_unparseBuffer = createChunkedUint32Array();
  }
  t_unparseBuffer.push(10); // '\n'
}

export function emitSpace(): void {
  if (changetype<usize>(t_unparseBuffer) == 0) {
    t_unparseBuffer = createChunkedUint32Array();
  }
  t_unparseBuffer.push(32); // ' '
}
