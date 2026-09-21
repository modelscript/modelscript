// SPDX-License-Identifier: AGPL-3.0-or-later
// --- Fast Linear-Memory Hex Array Decoder ---

import { atomicChunkAlloc } from "../arena";
import { UnmanagedUint32Array } from "./array";

export function decodeHexIntArray(hex: string, numElements: i32): usize {
  let raw = atomicChunkAlloc((numElements + 1) * 4);
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
