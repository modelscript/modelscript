// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Fast Linear-Memory Hex Array Decoder ---

import { atomicChunkAlloc } from "../arena";
import { UnmanagedUint8Array, UnmanagedUint16Array, UnmanagedUint32Array } from "./array";

export function decodeHexIntArray(hex: string, numElements: i32): usize {
  let raw = atomicChunkAlloc(4 + numElements * 4 + 4);
  let ptr = (raw + 3) & ~3;
  store<i32>(ptr, numElements);
  let dataPtr = ptr + 4;
  let arr = changetype<UnmanagedUint32Array>(dataPtr);
  for (let i = 0; i < numElements; i++) {
    let val: u32 = 0;
    for (let j = 0; j < 8; j++) {
      let c = hex.charCodeAt(i * 8 + j);
      let nibble = c >= 97 ? c - 97 + 10 : c >= 65 ? c - 65 + 10 : c - 48;
      val = (val << 4) | (nibble as u32);
    }
    arr[i] = val;
  }
  return dataPtr;
}

export function decodeHexU16Array(hex: string, numElements: i32): usize {
  let raw = atomicChunkAlloc(4 + numElements * 2 + 4);
  let ptr = (raw + 3) & ~3;
  store<i32>(ptr, numElements);
  let dataPtr = ptr + 4;
  let arr = changetype<UnmanagedUint16Array>(dataPtr);
  for (let i = 0; i < numElements; i++) {
    let val: u32 = 0;
    let base = i * 4;
    for (let j = 0; j < 4; j++) {
      let c = hex.charCodeAt(base + j);
      let nibble = c >= 97 ? c - 97 + 10 : c >= 65 ? c - 65 + 10 : c - 48;
      val = (val << 4) | (nibble as u32);
    }
    arr[i] = val as u16;
  }
  return dataPtr;
}

export function decodeHexByteArray(hex: string, numElements: i32): usize {
  let raw = atomicChunkAlloc(4 + numElements + 4);
  let ptr = (raw + 3) & ~3;
  store<i32>(ptr, numElements);
  let dataPtr = ptr + 4;
  let arr = changetype<UnmanagedUint8Array>(dataPtr);
  for (let i = 0; i < numElements; i++) {
    let base = i * 2;
    let c0 = hex.charCodeAt(base);
    let c1 = hex.charCodeAt(base + 1);
    let n0 = c0 >= 97 ? c0 - 97 + 10 : c0 >= 65 ? c0 - 65 + 10 : c0 - 48;
    let n1 = c1 >= 97 ? c1 - 97 + 10 : c1 >= 65 ? c1 - 65 + 10 : c1 - 48;
    arr[i] = ((n0 << 4) | n1) as u8;
  }
  return dataPtr;
}

