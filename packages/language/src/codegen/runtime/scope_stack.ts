import { ChunkedUint32Array, createChunkedUint32Array } from "./array";

/**
 * Reusable zero-GC stack structure for maintaining nested scope frames in linear memory.
 */
@unmanaged
export class GenericScopeStack {
  scopeNodePtrs: ChunkedUint32Array;
  prefixStringIds: ChunkedUint32Array;
  modMapPtrs: ChunkedUint32Array;
  depth: u32;

  init(): void {
    this.scopeNodePtrs = createChunkedUint32Array(256);
    this.prefixStringIds = createChunkedUint32Array(256);
    this.modMapPtrs = createChunkedUint32Array(256);
    this.depth = 0;
  }

  pushFrame(scopeNodePtr: u32, prefixStringId: u32, modMapPtr: u32 = 0): void {
    let idx = this.depth++;
    this.scopeNodePtrs.set(idx, scopeNodePtr);
    this.prefixStringIds.set(idx, prefixStringId);
    this.modMapPtrs.set(idx, modMapPtr);
  }

  popFrame(): void {
    if (this.depth > 0) {
      this.depth--;
    }
  }

  currentScopePtr(): u32 {
    return this.depth > 0 ? this.scopeNodePtrs.get(this.depth - 1) : 0;
  }

  currentPrefixStringId(): u32 {
    return this.depth > 0 ? this.prefixStringIds.get(this.depth - 1) : 0;
  }

  currentModMapPtr(): u32 {
    return this.depth > 0 ? this.modMapPtrs.get(this.depth - 1) : 0;
  }
}
