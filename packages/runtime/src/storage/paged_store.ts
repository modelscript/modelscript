// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "node:fs";
import { hashIri64 } from "../ontology/wasm_ontology.js";

export interface PagedWasmExports {
  paged_init?(bufferPoolFrames?: number): void;
  paged_insertTriple?(s: number, p: number, o: number, axiomType: number, flags: number): number;
  paged_findTriples?(s: number, p: number, o: number): number;
  paged_getQueryBufferPtr?(): number;
  paged_getExchangeBufferPtr?(): number;
  paged_readPageToExchange?(pageId: number): number;
  paged_flush?(): number;
  paged_getPageCount?(): number;

  paged_getTotalTriples?(): number;
  paged_getBufferPoolHitRate?(): number;
  ontology_getOrCreateEntity?(lo: number, hi: number): number;
  memory?: WebAssembly.Memory;
}

export interface PagedTriple {
  subjectId: number;
  predicateId: number;
  objectId: number;
  axiomType: number;
  flags: number;
}

export interface StorageMetrics {
  pageCount: number;
  totalTriples: number;
  bufferPoolHitRate: number;
  allocatedMemoryBytes: number;
}

/**
 * Paged Virtual Storage Engine for WebAssembly Triple Stores.
 * Bridges WASM's 4KB Slotted B+Tree and Clock-eviction BufferPool with
 * persistent disk/OPFS storage.
 */
export class PagedStorageEngine {
  private _wasm: PagedWasmExports;
  private _backingFd: number | null = null;
  private _backingFilePath: string | null = null;
  private _iriMap = new Map<string, number>();

  constructor(wasmExports: PagedWasmExports, bufferPoolFrames: number = 512) {
    this._wasm = wasmExports;
    this._wasm.paged_init?.(bufferPoolFrames);
  }

  /**
   * Attaches a persistent backing file (in Node.js environment).
   */
  public attachFile(filePath: string): void {
    this._backingFilePath = filePath;
    this._backingFd = fs.openSync(filePath, "w+");
  }

  /**
   * Interns an IRI string to a 32-bit dense Entity ID using 64-bit FNV-1a.
   */
  public intern(iri: string): number {
    if (!iri) return 0;
    const existing = this._iriMap.get(iri);
    if (existing !== undefined) return existing;

    const { lo, hi } = hashIri64(iri);
    let id: number;
    if (this._wasm.ontology_getOrCreateEntity) {
      id = this._wasm.ontology_getOrCreateEntity(lo, hi);
    } else {
      id = this._iriMap.size + 1;
    }
    this._iriMap.set(iri, id);
    return id;
  }

  /**
   * Inserts an asserted or inferred triple into the paged B+Tree.
   */
  public insertTriple(
    subject: string | number,
    predicate: string | number,
    object: string | number,
    axiomType: number = 0,
    flags: number = 0,
  ): boolean {
    if (!this._wasm.paged_insertTriple) return false;

    const sId = typeof subject === "string" ? this.intern(subject) : subject;
    const pId = typeof predicate === "string" ? this.intern(predicate) : predicate;
    const oId = typeof object === "string" ? this.intern(object) : object;

    const res = this._wasm.paged_insertTriple(sId, pId, oId, axiomType, flags);
    return res > 0;
  }

  /**
   * Executes a range scan query against the paged B+Tree.
   * Wildcards are represented by 0 or undefined.
   */
  public findTriples(pattern: {
    subject?: string | number;
    predicate?: string | number;
    object?: string | number;
  }): PagedTriple[] {
    if (!this._wasm.paged_findTriples || !this._wasm.memory || !this._wasm.paged_getQueryBufferPtr) {
      return [];
    }

    const sId =
      pattern.subject !== undefined
        ? typeof pattern.subject === "string"
          ? this.intern(pattern.subject)
          : pattern.subject
        : 0;
    const pId =
      pattern.predicate !== undefined
        ? typeof pattern.predicate === "string"
          ? this.intern(pattern.predicate)
          : pattern.predicate
        : 0;
    const oId =
      pattern.object !== undefined
        ? typeof pattern.object === "string"
          ? this.intern(pattern.object)
          : pattern.object
        : 0;

    const count = this._wasm.paged_findTriples(sId, pId, oId);
    if (count === 0) return [];

    const bufPtr = this._wasm.paged_getQueryBufferPtr();
    const u32 = new Uint32Array(this._wasm.memory.buffer, bufPtr, count * 5);
    const results: PagedTriple[] = [];

    for (let i = 0; i < count; i++) {
      const offset = i * 5;
      results.push({
        subjectId: u32[offset]!,
        predicateId: u32[offset + 1]!,
        objectId: u32[offset + 2]!,
        axiomType: u32[offset + 3]!,
        flags: u32[offset + 4]!,
      });
    }

    return results;
  }

  /**
   * Flushes all dirty buffer pool frames to disk / virtual disk.
   */
  public flush(): number {
    const flushed = this._wasm.paged_flush?.() ?? 0;
    if (
      this._backingFd !== null &&
      this._wasm.paged_getExchangeBufferPtr &&
      this._wasm.paged_readPageToExchange &&
      this._wasm.memory
    ) {
      const pageCount = this._wasm.paged_getPageCount?.() ?? 0;
      const exBufPtr = this._wasm.paged_getExchangeBufferPtr();
      const nodeBuf = Buffer.from(this._wasm.memory.buffer, exBufPtr, 4096);
      for (let p = 1; p <= pageCount; p++) {
        if (this._wasm.paged_readPageToExchange(p)) {
          fs.writeSync(this._backingFd, nodeBuf, 0, 4096, (p - 1) * 4096);
        }
      }
      try {
        fs.fdatasyncSync(this._backingFd);
      } catch {}
    }
    return flushed;
  }

  /**
   * Returns runtime metrics on buffer pool hit rate, page allocation, and triples count.
   */
  public getMetrics(): StorageMetrics {
    const pageCount = this._wasm.paged_getPageCount?.() ?? 0;
    const totalTriples = this._wasm.paged_getTotalTriples?.() ?? 0;
    const bufferPoolHitRate = this._wasm.paged_getBufferPoolHitRate?.() ?? 1.0;

    return {
      pageCount,
      totalTriples,
      bufferPoolHitRate,
      allocatedMemoryBytes: pageCount * 4096,
    };
  }

  /**
   * Closes attached backing file descriptor.
   */
  public close(): void {
    this.flush();
    if (this._backingFd !== null) {
      try {
        fs.closeSync(this._backingFd);
      } catch {}
      this._backingFd = null;
    }
  }
}
