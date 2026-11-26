// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Edge OPFS Mini-DiskANN Cache for Offline Browser / IDE WebLLM Retrieval.
 *
 * Stores compact INT8-quantized engineering memory chunks in browser OPFS (with graceful
 * in-memory fallback when OPFS is unavailable), enabling sub-10ms local RAG for local
 * WebLLM SLMs without requiring a network round-trip to `apps/api`.
 */

export interface EdgeMemoryChunk {
  chunkId: string;
  sourceUri: string;
  dialect: string;
  content: string;
  symbolTags: string[];
  formalVerified: boolean;
  int8Vector: number[];
  quantScale: number;
}

export interface EdgeMemoryHit {
  chunkId: string;
  sourceUri: string;
  dialect: string;
  content: string;
  formalVerified: boolean;
  score: number;
}

function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function embedQueryLocal(text: string, dim = 64): Float32Array {
  const vec = new Float32Array(dim);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const tok of tokens) {
    const idx = fnv1a32(`w:${tok}`) % dim;
    const sign = (fnv1a32(`w:${tok}#s`) & 1) === 0 ? 1 : -1;
    vec[idx] = vec[idx]! + sign;
  }
  let normSq = 0;
  for (let i = 0; i < dim; i++) normSq += vec[i]! * vec[i]!;
  const norm = Math.sqrt(normSq);
  if (norm > 1e-12) {
    for (let i = 0; i < dim; i++) vec[i] = vec[i]! / norm;
  }
  return vec;
}

export function quantizeLocalInt8(vec: Float32Array): { int8Vector: number[]; quantScale: number } {
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 1e-12 ? maxAbs / 127 : 1;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! / scale)));
  }
  return { int8Vector: out, quantScale: scale };
}

export class EdgeOpfsMiniDiskAnn {
  private readonly chunks = new Map<string, EdgeMemoryChunk>();

  constructor(
    private readonly dim = 64,
    private readonly opfsFileName = "ansatz-mini-diskann.json",
  ) {}

  public upsert(
    chunk: Omit<EdgeMemoryChunk, "int8Vector" | "quantScale"> & { int8Vector?: number[]; quantScale?: number },
  ): void {
    let int8Vector = chunk.int8Vector;
    let quantScale = chunk.quantScale;
    if (!int8Vector || int8Vector.length === 0) {
      const q = quantizeLocalInt8(embedQueryLocal(`${chunk.content} ${chunk.symbolTags.join(" ")}`, this.dim));
      int8Vector = q.int8Vector;
      quantScale = q.quantScale;
    }
    this.chunks.set(chunk.chunkId, {
      chunkId: chunk.chunkId,
      sourceUri: chunk.sourceUri,
      dialect: chunk.dialect.toLowerCase(),
      content: chunk.content,
      symbolTags: chunk.symbolTags,
      formalVerified: chunk.formalVerified,
      int8Vector,
      quantScale: quantScale ?? 1,
    });
  }

  public query(textQuery: string, options?: { dialect?: string; topK?: number }): EdgeMemoryHit[] {
    const topK = Math.max(1, Math.min(20, options?.topK ?? 4));
    const dialect = options?.dialect?.trim().toLowerCase();
    const qVec = embedQueryLocal(textQuery, this.dim);
    const terms = new Set((textQuery.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length >= 2));

    const hits: EdgeMemoryHit[] = [];
    for (const ch of this.chunks.values()) {
      if (dialect && ch.dialect !== dialect && ch.dialect !== "markdown") continue;
      let dot = 0;
      const len = Math.min(qVec.length, ch.int8Vector.length);
      for (let i = 0; i < len; i++) {
        dot += qVec[i]! * (ch.int8Vector[i]! * ch.quantScale);
      }
      let symHits = 0;
      for (const tag of ch.symbolTags) {
        if (terms.has(tag.toLowerCase())) symHits++;
      }
      const score = dot + Math.min(0.25, symHits * 0.08) + (ch.formalVerified ? 0.05 : 0);
      hits.push({
        chunkId: ch.chunkId,
        sourceUri: ch.sourceUri,
        dialect: ch.dialect,
        content: ch.content,
        formalVerified: ch.formalVerified,
        score: Number(score.toFixed(4)),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  public async persistToOpfs(): Promise<boolean> {
    try {
      const storage = (
        globalThis.navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }
      )?.storage;
      if (!storage?.getDirectory) return false;
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle(this.opfsFileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(Array.from(this.chunks.values())));
      await writable.close();
      return true;
    } catch {
      return false;
    }
  }

  public async hydrateFromOpfs(): Promise<number> {
    try {
      const storage = (
        globalThis.navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } }
      )?.storage;
      if (!storage?.getDirectory) return 0;
      const root = await storage.getDirectory();
      const handle = await root.getFileHandle(this.opfsFileName);
      const file = await handle.getFile();
      const parsed = JSON.parse(await file.text()) as EdgeMemoryChunk[];
      for (const ch of parsed) {
        this.chunks.set(ch.chunkId, ch);
      }
      return parsed.length;
    } catch {
      return 0;
    }
  }

  public size(): number {
    return this.chunks.size;
  }
}
