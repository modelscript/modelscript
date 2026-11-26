// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Browser OPFS Streaming DataLoader for Dynamic-m Compiled Dataset Shards.
 *
 * Streams content-addressed `m_init`-bucketed shards from `/api/v1/memory/datasets/shards/:shardId`
 * via HTTP `Range` (206 Partial Content) into the browser's Origin Private File System (OPFS) so
 * multi-GB engineering datasets never exhaust JS heap RAM, with graceful in-memory fallback when
 * OPFS is unavailable (e.g., private browsing or Node test environments).
 */

export interface RemoteDatasetShardInfo {
  shardId: string;
  recipeName: string;
  recipeVersion: string;
  datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe";
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  downloadUrl: string;
}

export interface CompiledHypergraphShardRow {
  example_id: string;
  uri: string;
  dialect: string;
  m_init: number;
  token_ids: number[];
  group_ids: number[];
  rel_type_ids: number[];
  rel_signs: number[];
  /** Optional embedded source text when shard rows carry inline source for OPFS Scrubber hydration. */
  source?: string | undefined;
  formal_cert: {
    gate1_glr: boolean;
    gate2_units: boolean;
    gate3_smt: boolean;
    gate4_dae: boolean;
    cad_clearance: boolean | null;
  } | null;
}

export interface OpfsMiniBatch {
  shardId: string;
  mBatchMax: number;
  examples: CompiledHypergraphShardRow[];
}

export interface OpfsStreamProgress {
  shardId: string;
  bytesDownloaded: number;
  totalBytes: number;
  cachedInOpfs: boolean;
}

const DEFAULT_RANGE_CHUNK_BYTES = 256 * 1024; // 256 KiB per HTTP Range request

export class BrowserOpfsDatasetLoader {
  private readonly memoryCache = new Map<string, Uint8Array>();

  constructor(private readonly apiBaseUrl = "") {}

  private async getOpfsShardsDir(): Promise<FileSystemDirectoryHandle | null> {
    try {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle("modelscript-dataset-shards", { create: true });
    } catch {
      return null;
    }
  }

  /** Lists available compiled `m_init`-bucketed shards from the Package/Memory API. */
  public async listShards(filter?: { recipeName?: string; dialect?: string }): Promise<RemoteDatasetShardInfo[]> {
    const qs = new URLSearchParams();
    if (filter?.recipeName) qs.set("recipeName", filter.recipeName);
    if (filter?.dialect) qs.set("dialect", filter.dialect);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(`${this.apiBaseUrl}/api/v1/memory/datasets/shards${suffix}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Failed to list dataset shards (HTTP ${res.status})`);
    const data = (await res.json()) as { shards?: RemoteDatasetShardInfo[] };
    return Array.isArray(data.shards) ? data.shards : [];
  }

  /**
   * Streams a shard via HTTP `Range` requests and caches it in OPFS (or in-memory fallback).
   * Returns raw UTF-8 text of the cached shard.
   */
  public async ensureShardCached(
    shard: RemoteDatasetShardInfo,
    onProgress?: (progress: OpfsStreamProgress) => void,
    chunkBytes = DEFAULT_RANGE_CHUNK_BYTES,
  ): Promise<string> {
    const decoder = new TextDecoder("utf-8");
    const opfsDir = await this.getOpfsShardsDir();
    const fileName = `${shard.shardId}.jsonl`;

    // 1. Check OPFS cache hit first
    if (opfsDir) {
      try {
        const existingHandle = await opfsDir.getFileHandle(fileName, { create: false });
        const existingFile = await existingHandle.getFile();
        if (existingFile.size === shard.byteSize && shard.byteSize > 0) {
          onProgress?.({
            shardId: shard.shardId,
            bytesDownloaded: existingFile.size,
            totalBytes: shard.byteSize,
            cachedInOpfs: true,
          });
          return await existingFile.text();
        }
      } catch {
        // Not cached yet
      }
    } else if (this.memoryCache.has(shard.shardId)) {
      const bytes = this.memoryCache.get(shard.shardId)!;
      onProgress?.({
        shardId: shard.shardId,
        bytesDownloaded: bytes.byteLength,
        totalBytes: bytes.byteLength,
        cachedInOpfs: false,
      });
      return decoder.decode(bytes);
    }

    // 2. Stream via HTTP Range requests (206 Partial Content)
    const totalBytes = Math.max(0, shard.byteSize);
    const url = shard.downloadUrl.startsWith("http") ? shard.downloadUrl : `${this.apiBaseUrl}${shard.downloadUrl}`;

    const chunks: Uint8Array[] = [];
    let offset = 0;

    if (totalBytes === 0) {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Shard download failed (HTTP ${res.status})`);
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      offset = buf.byteLength;
    } else {
      while (offset < totalBytes) {
        const end = Math.min(totalBytes - 1, offset + chunkBytes - 1);
        const res = await fetch(url, {
          credentials: "include",
          headers: { Range: `bytes=${offset}-${end}` },
        });
        if (res.status !== 206 && res.status !== 200) {
          throw new Error(`Shard range request failed (HTTP ${res.status})`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        chunks.push(buf);
        offset += buf.byteLength;
        onProgress?.({
          shardId: shard.shardId,
          bytesDownloaded: offset,
          totalBytes,
          cachedInOpfs: Boolean(opfsDir),
        });
        if (res.status === 200 || buf.byteLength === 0) break;
      }
    }

    const merged = new Uint8Array(offset);
    let cursor = 0;
    for (const c of chunks) {
      merged.set(c, cursor);
      cursor += c.byteLength;
    }

    // 3. Persist to OPFS (or memory fallback)
    if (opfsDir) {
      try {
        const handle = await opfsDir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(merged);
        await writable.close();
      } catch {
        this.memoryCache.set(shard.shardId, merged);
      }
    } else {
      this.memoryCache.set(shard.shardId, merged);
    }

    return decoder.decode(merged);
  }

  /**
   * Streams and yields `m_init`-bucketed mini-batches ready for browser WebGPU LoRA / W_q training.
   */
  public async *streamMiniBatches(
    shard: RemoteDatasetShardInfo,
    batchSize: number,
    mCap = 32,
    onProgress?: (progress: OpfsStreamProgress) => void,
  ): AsyncGenerator<OpfsMiniBatch> {
    const rawText = await this.ensureShardCached(shard, onProgress);
    const rows: CompiledHypergraphShardRow[] = [];
    for (const line of rawText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed) as CompiledHypergraphShardRow);
      } catch {
        // skip malformed line
      }
    }

    // Sort by m_init inside the shard for optimal WebGPU bucket utilization
    rows.sort((a, b) => a.m_init - b.m_init);
    const safeBatch = Math.max(1, Math.floor(batchSize));
    for (let i = 0; i < rows.length; i += safeBatch) {
      const slice = rows.slice(i, i + safeBatch);
      const mBatchMax = slice.reduce((acc, r) => Math.max(acc, Math.min(r.m_init, mCap)), 0);
      yield {
        shardId: shard.shardId,
        mBatchMax,
        examples: slice,
      };
    }
  }
}
