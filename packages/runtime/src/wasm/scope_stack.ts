import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { ArenaStringPool } from "./string_pool";

/**
 * Reusable zero-GC stack structure for maintaining nested scope frames and FQNs in linear memory.
 */
@unmanaged
export class GenericScopeStack {
  scopeNodePtrs: ChunkedUint32Array;
  prefixStringIds: ChunkedUint32Array;
  fqnStringIds: ChunkedUint32Array;
  modMapPtrs: ChunkedUint32Array;
  depth: u32;
  pool: ArenaStringPool | null;

  init(pool: ArenaStringPool | null = null): void {
    this.scopeNodePtrs = createChunkedUint32Array(256);
    this.prefixStringIds = createChunkedUint32Array(256);
    this.fqnStringIds = createChunkedUint32Array(256);
    this.modMapPtrs = createChunkedUint32Array(256);
    this.depth = 0;
    this.pool = pool;
  }

  pushFrame(scopeNodePtr: u32, prefixStringId: u32, modMapPtr: u32 = 0): u32 {
    let idx = this.depth++;
    this.scopeNodePtrs.set(idx, scopeNodePtr);
    this.prefixStringIds.set(idx, prefixStringId);
    this.modMapPtrs.set(idx, modMapPtr);

    let currentFqn = prefixStringId;
    if (idx > 0 && this.pool != null) {
      let parentFqn = this.fqnStringIds.get(idx - 1);
      if (parentFqn != 0) {
        currentFqn = this.pool!.concatIds(parentFqn, prefixStringId);
      }
    }
    this.fqnStringIds.set(idx, currentFqn);
    return currentFqn;
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

  currentFqnStringId(): u32 {
    return this.depth > 0 ? this.fqnStringIds.get(this.depth - 1) : 0;
  }

  currentModMapPtr(): u32 {
    return this.depth > 0 ? this.modMapPtrs.get(this.depth - 1) : 0;
  }

  reset(): void {
    this.depth = 0;
  }

  resolveLocal(localNameStringId: u32): u32 {
    if (this.depth == 0 || this.pool == null) return localNameStringId;
    let currFqn = this.currentFqnStringId();
    if (currFqn == 0) return localNameStringId;
    return this.pool!.concatIds(currFqn, localNameStringId);
  }
}

