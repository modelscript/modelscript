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

  let basePtr: usize = (stringArenaPtr != 0 && start >= (stringArenaPtr as u32) && start < (stringArenaPtr + stringArenaCapacity) as u32)
    ? (start as usize)
    : getInputBuffer() + (start as usize);

  for (let i: u32 = 0; i < len; i++) {
    let b = load<u8>(basePtr + i);
    t_unparseBuffer.push(b as u32);
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
