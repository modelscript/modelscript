import { atomicChunkAlloc, stringArenaPtr, stringArenaCapacity, ensureStringArena } from "./arena";
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { UnmanagedMap64, createMap64 } from "./hashmap";
import { STUB_STRIDE, t_stubCount, t_stubTable, ensureStubStore, t_stubBinaryBuffer, flushStubBuffer } from "./stub";

export let t_trigramPostings: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_trigramScores: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);
export let t_trigramHeadMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);
export let t_trigramPostingCount: u32 = 1;

@inline
function hashTrigram(c0: u32, c1: u32, c2: u32): u64 {
  if (c0 >= 65 && c0 <= 90) c0 += 32;
  if (c1 >= 65 && c1 <= 90) c1 += 32;
  if (c2 >= 65 && c2 <= 90) c2 += 32;
  let hash32: u32 = ((c0 & 0xff) << 16) | ((c1 & 0xff) << 8) | (c2 & 0xff);
  return hash32 as u64;
}

export function ensureTrigramStore(): void {
  ensureStubStore();
  if (changetype<usize>(t_trigramPostings) == 0) {
    t_trigramPostings = createChunkedUint32Array(2000); // pairs of [stubId, nextPostingIdx]
    t_trigramScores = createChunkedUint32Array(2000);
    t_trigramHeadMap = changetype<UnmanagedMap64>(createMap64());
    t_trigramPostingCount = 1;
  }
}

export function trigram_clear(): void {
  if (changetype<usize>(t_trigramPostings) != 0) {
    t_trigramPostings.clear();
    t_trigramScores.clear();
    t_trigramHeadMap.init(1024);
    t_trigramPostingCount = 1;
  }
}

/**
 * Indexes symbol name trigrams into inverted index map.
 */
export function trigram_indexStub(stubId: u32, nameHandle: u32): void {
  if (nameHandle == 0 || stringArenaPtr == 0) return;
  if (nameHandle + 4 > stringArenaCapacity) return;

  ensureTrigramStore();

  let lenBytes = load<u32>(stringArenaPtr + nameHandle) & 0x7fffffff;
  if (lenBytes < 6) return; // Must have at least 3 UTF-16 chars (6 bytes)
  if (nameHandle + 4 + lenBytes > stringArenaCapacity) return;

  let len = lenBytes >> 1;
  let strPtr = stringArenaPtr + nameHandle + 4;

  for (let i: u32 = 0; i <= len - 3; i++) {
    let c0 = load<u16>(strPtr + (i * 2)) as u32;
    let c1 = load<u16>(strPtr + ((i + 1) * 2)) as u32;
    let c2 = load<u16>(strPtr + ((i + 2) * 2)) as u32;

    let triHash = hashTrigram(c0, c1, c2);
    let prevHead = t_trigramHeadMap.get(triHash);

    let postIdx = t_trigramPostingCount++;
    t_trigramPostings.set(postIdx * 2 + 0, stubId);
    t_trigramPostings.set(postIdx * 2 + 1, prevHead);
    t_trigramHeadMap.set(triHash, postIdx);
  }
}

/**
 * Indexes all stubs currently present in t_stubTable.
 */
export function trigram_indexAllStubs(): u32 {
  ensureStubStore();
  ensureTrigramStore();
  trigram_clear();

  let indexedCount: u32 = 0;
  for (let id: u32 = 1; id < t_stubCount; id++) {
    let baseIdx = id * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    let nameHandle = t_stubTable.get(baseIdx + 5);

    if (fId != 0 && nameHandle != 0) {
      trigram_indexStub(id, nameHandle);
      indexedCount++;
    }
  }
  return indexedCount;
}

/**
 * Fast Dex-style Fuzzy Search over indexed stubs.
 * Pushes top matching results into t_stubBinaryBuffer and returns total matches.
 * Format per matched result: [stubId, fileId, kind, nameHash, startByte, endByte, score] (7 u32 words)
 */
@sideeffects
@external("parser", "logInt") declare function logInt(val: i32): void;

export function trigram_fuzzyFind(queryHandle: u32, maxResults: u32): u32 {
  if (queryHandle == 0 || stringArenaPtr == 0) return 0;
  ensureStubStore();
  ensureTrigramStore();

  let queryLenBytes = load<u32>(stringArenaPtr + queryHandle) & 0x7fffffff;
  let queryLen = queryLenBytes >> 1;
  if (queryLen == 0) return 0;

  let queryPtr = stringArenaPtr + queryHandle + 4;
  let maxCount = t_stubCount;
  if (maxCount <= 1) return 0;

  for (let sId: u32 = 0; sId < maxCount; sId++) {
    t_trigramScores.set(sId, 0);
  }

  if (queryLen >= 3) {
    for (let i: u32 = 0; i <= queryLen - 3; i++) {
      let c0 = load<u16>(queryPtr + (i * 2)) as u32;
      let c1 = load<u16>(queryPtr + ((i + 1) * 2)) as u32;
      let c2 = load<u16>(queryPtr + ((i + 2) * 2)) as u32;

      let triHash = hashTrigram(c0, c1, c2);
      let postIdx = t_trigramHeadMap.get(triHash as u64);

      let loopCap = 0;
      while (postIdx != 0 && loopCap++ < 5000) {
        let stubId = t_trigramPostings.get(postIdx * 2 + 0);
        if (stubId > 0 && stubId < maxCount) {
          let curr = t_trigramScores.get(stubId);
          t_trigramScores.set(stubId, curr + 10);
        }
        postIdx = t_trigramPostings.get(postIdx * 2 + 1);
      }
    }
  } else {
    let prefixC0 = load<u16>(queryPtr) as u32;
    if (prefixC0 >= 65 && prefixC0 <= 90) prefixC0 += 32;

    for (let id: u32 = 1; id < maxCount; id++) {
      let baseIdx = id * STUB_STRIDE;
      let fId = t_stubTable.get(baseIdx + 0);
      let nameHandle = t_stubTable.get(baseIdx + 5);

      if (fId != 0 && nameHandle != 0 && nameHandle + 4 <= stringArenaCapacity) {
        let nameLenBytes = load<u32>(stringArenaPtr + nameHandle) & 0x7fffffff;
        if (nameLenBytes > 0 && nameHandle + 4 + nameLenBytes <= stringArenaCapacity) {
          let firstChar = load<u16>(stringArenaPtr + nameHandle + 4) as u32;
          if (firstChar >= 65 && firstChar <= 90) firstChar += 32;
          if (firstChar == prefixC0) {
            t_trigramScores.set(id, 20);
          }
        }
      }
    }
  }

  for (let id: u32 = 1; id < maxCount; id++) {
    let score = t_trigramScores.get(id);
    if (score == 0) continue;

    let baseIdx = id * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    let nameHandle = t_stubTable.get(baseIdx + 5);

    if (fId == 0) {
      t_trigramScores.set(id, 0);
      continue;
    }

    if (nameHandle != 0 && nameHandle + 4 <= stringArenaCapacity) {
      let nameLenBytes = load<u32>(stringArenaPtr + nameHandle) & 0x7fffffff;
      if (nameLenBytes == 0 || nameLenBytes > 2000) continue;
      if (nameHandle + 4 + nameLenBytes > stringArenaCapacity) continue;
      let nameLen = nameLenBytes >> 1;
      let namePtr = stringArenaPtr + nameHandle + 4;

      let matchesPrefix = true;
      let minLen = queryLen < nameLen ? queryLen : nameLen;
      for (let k: u32 = 0; k < minLen; k++) {
        let qc = load<u16>(queryPtr + (k * 2)) as u32;
        let nc = load<u16>(namePtr + (k * 2)) as u32;
        if (qc >= 65 && qc <= 90) qc += 32;
        if (nc >= 65 && nc <= 90) nc += 32;
        if (qc != nc) {
          matchesPrefix = false;
          break;
        }
      }

      if (matchesPrefix) {
        score += 500;
        if (queryLen == nameLen) score += 1000;
      }

      t_trigramScores.set(id, score);
    }
  }

  if (changetype<usize>(t_stubBinaryBuffer) == 0) {
    t_stubBinaryBuffer = createChunkedUint32Array(2000);
  } else {
    t_stubBinaryBuffer.clear();
  }

  let matchCount: u32 = 0;

  for (let id: u32 = 1; id < maxCount; id++) {
    let score = t_trigramScores.get(id);
    if (score > 0) {
      let baseIdx = id * STUB_STRIDE;
      let fId = t_stubTable.get(baseIdx + 0);
      let symId = t_stubTable.get(baseIdx + 1);
      let kf = t_stubTable.get(baseIdx + 3);
      let nameHash = t_stubTable.get(baseIdx + 4);
      let startByte = t_stubTable.get(baseIdx + 6);
      let endByte = t_stubTable.get(baseIdx + 7);

      t_stubBinaryBuffer.push(id);
      t_stubBinaryBuffer.push(fId);
      t_stubBinaryBuffer.push(kf);
      t_stubBinaryBuffer.push(nameHash);
      t_stubBinaryBuffer.push(startByte);
      t_stubBinaryBuffer.push(endByte);
      t_stubBinaryBuffer.push(score);

      matchCount++;
      if (matchCount >= maxResults) break;
    }
  }

  flushStubBuffer();
  return matchCount;
}
