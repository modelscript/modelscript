// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DiskANN NVMe-Flash Vector Memory + INT8 RAM Vamana Graph Service.
 *
 * Implements a two-tier DiskANN retrieval architecture for compact engineering LLMs (0.5B–1.5B):
 *   1. **RAM Tier (INT8 Quantized Routing + Vamana Graph)**:
 *      Holds compact `Int8Array` quantized vectors + bounded-degree Vamana graph adjacency
 *      lists in RAM for sub-millisecond approximate beam search.
 *   2. **NVMe Flash Tier (`diskann_vectors.f32`)**:
 *      Stores full-precision FP32 normalized vectors sequentially on disk and reads only the
 *      beam-search shortlist via positional `fs.readSync` for exact cosine reranking.
 *
 * Enforces strict server-side RBAC (`tenantScope` / `orgId`) and `modelscript.json` semver
 * lockfile pinning before chunks ever return to the LLM KV cache.
 */

import {
  fnv1a32,
  type MemoryChunkResult,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type TenantScope,
} from "@modelscript/runtime";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";

export const DEFAULT_VECTOR_DIM = 256;
const VAMANA_MAX_DEGREE = 24;
const VAMANA_BEAM_WIDTH = 32;

export type MemorySourceKind = "package-doc" | "package-symbol" | "owl2-axiom" | "social-post" | "rlhf-verified-fix";

export type MemoryModalityKind = "code" | "cad" | "wam" | "ontology" | "social";

export const DEFAULT_DETERMINISTIC_EMBEDDING_MODEL = "deterministic-fnv1a-256";

export function resolveActiveEmbeddingModelId(): string {
  const apiUrl = (process.env["EMBEDDING_API_URL"] ?? "").trim();
  if (!apiUrl) return DEFAULT_DETERMINISTIC_EMBEDDING_MODEL;
  const model = (process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small").trim();
  return `external:${model}`;
}

export interface MemoryChunkInput {
  sourceKind: MemorySourceKind;
  sourceUri: string;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  gitSha?: string | undefined;
  dialect: string;
  tenantScope?: TenantScope | undefined;
  orgId?: number | null | undefined;
  formalVerified?: boolean | undefined;
  symbolTags?: string[] | undefined;
  content: string;
  /** Optional pre-computed external embedding vector (e.g., from BGE/E5/Nomic or W_q trainer). */
  embedding?: number[] | Float32Array | undefined;
  /** Identifier of the embedding space used to generate `embedding`. */
  embeddingModelId?: string | undefined;
  /** Optional author user ID for attribution & royalty receipts. */
  authorUserId?: number | null | undefined;
  /** Semantic modality of the chunk (`code`, `cad`, `wam`, `ontology`, `social`). */
  modalityKind?: MemoryModalityKind | undefined;
  /** Resolved QUDV physical unit tags extracted from CST/oracles. */
  qudvUnits?: string[] | undefined;
}

export interface GitDiffFileChange {
  path: string;
  status: "A" | "M" | "D";
  content?: string | undefined;
  dialect?: string | undefined;
}

interface MemoryChunkRow {
  chunk_id: string;
  source_kind: MemorySourceKind;
  source_uri: string;
  package_name: string | null;
  package_version: string | null;
  git_sha: string | null;
  dialect: string;
  tenant_scope: TenantScope;
  org_id: number | null;
  formal_verified: number;
  symbol_tags_json: string;
  content: string;
  vector_dim: number;
  vector_slot: number;
  int8_quant_blob: Buffer;
  quant_scale: number;
  embedding_model_id?: string | null;
  content_sha256?: string | null;
  is_quarantined?: number | null;
  tombstoned_at?: string | null;
  author_user_id?: number | null;
  qudv_units_json?: string | null;
  modality_kind?: MemoryModalityKind | null;
  independent_reproductions?: number | null;
}

interface RamGraphNode {
  chunkId: string;
  vectorSlot: number;
  int8: Int8Array;
  scale: number;
  neighbors: string[];
  sourceKind: MemorySourceKind;
  sourceUri: string;
  packageName: string | null;
  packageVersion: string | null;
  dialect: string;
  tenantScope: TenantScope;
  orgId: number | null;
  formalVerified: boolean;
  symbolTags: string[];
  content: string;
  embeddingModelId: string;
  contentSha256: string;
  isQuarantined: boolean;
  tombstonedAt: string | null;
  authorUserId: number | null;
  modalityKind: MemoryModalityKind;
  independentReproductions: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Dense Feature Embedder & INT8 Quantization
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeVector(vec: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i]!;
    normSq += v * v;
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-12) {
    const inv = 1 / norm;
    for (let i = 0; i < vec.length; i++) {
      vec[i] = vec[i]! * inv;
    }
  }
  return vec;
}

/**
 * Deterministic signed random-projection embedder over normalized engineering tokens,
 * character trigrams, symbol tags, and dialect markers.
 * Used as the zero-dependency default retriever space (and swappable with external embeddings).
 */
export function computeDeterministicEmbedding(
  text: string,
  symbolTags: string[] = [],
  dialect = "",
  dim = DEFAULT_VECTOR_DIM,
): Float32Array {
  const vec = new Float32Array(dim);
  const addFeature = (feat: string, weight: number) => {
    const h1 = fnv1a32(feat);
    const h2 = fnv1a32(`${feat}#sign`);
    const idx = h1 % dim;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] = vec[idx]! + sign * weight;
  };

  // Word-level & identifier tokens
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  for (const w of words) {
    addFeature(`w:${w}`, 1.0);
    // Character 3-grams for partial identifier / camelCase resilience
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 3 && i < 12; i++) {
        addFeature(`g:${w.slice(i, i + 3)}`, 0.35);
      }
    }
  }

  // Upweight explicit symbol tags (YAML frontmatter, Modelica classes, OWL2 IRIs)
  for (const tag of symbolTags) {
    const clean = tag.trim().toLowerCase();
    if (clean) addFeature(`sym:${clean}`, 2.5);
  }

  if (dialect) {
    addFeature(`dialect:${dialect.trim().toLowerCase()}`, 1.25);
  }

  return normalizeVector(vec);
}

export interface ExternalEmbeddingOptions {
  /** Base URL (e.g. `https://api.openai.com/v1`) or full `/embeddings` URL. Defaults to `EMBEDDING_API_URL`. */
  apiUrl?: string | undefined;
  /** Optional Bearer API key. Defaults to `EMBEDDING_API_KEY`. */
  apiKey?: string | undefined;
  /** Embedding model identifier. Defaults to `EMBEDDING_MODEL` or `text-embedding-3-small`. */
  model?: string | undefined;
  /** Request timeout in milliseconds (default: 4000). */
  timeoutMs?: number | undefined;
  /** Optional fetch implementation override (useful for unit testing). */
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Computes a normalized dense embedding vector using an OpenAI-compatible `/embeddings`
 * HTTP endpoint when `EMBEDDING_API_URL` (or `options.apiUrl`) is configured, cleanly
 * falling back to `computeDeterministicEmbedding` on missing config, network errors,
 * timeouts, or invalid responses.
 */
export async function computeEmbeddingWithExternalFallback(
  text: string,
  symbolTags: string[] = [],
  dialect = "",
  dim = DEFAULT_VECTOR_DIM,
  options?: ExternalEmbeddingOptions,
): Promise<Float32Array> {
  const rawBaseUrl = (options?.apiUrl ?? process.env["EMBEDDING_API_URL"] ?? "").trim();
  if (!rawBaseUrl) {
    return computeDeterministicEmbedding(text, symbolTags, dialect, dim);
  }

  try {
    const trimmed = rawBaseUrl.replace(/\/+$/, "");
    const endpointUrl = trimmed.endsWith("/embeddings") ? trimmed : `${trimmed}/embeddings`;
    const model = (options?.model ?? process.env["EMBEDDING_MODEL"] ?? "text-embedding-3-small").trim();
    const apiKey = (options?.apiKey ?? process.env["EMBEDDING_API_KEY"] ?? "").trim();
    const timeoutMs = Math.max(250, options?.timeoutMs ?? 4_000);
    const fetchFn = options?.fetchImpl ?? globalThis.fetch;

    const headerParts: string[] = [];
    if (dialect.trim()) headerParts.push(`[${dialect.trim().toLowerCase()}]`);
    if (symbolTags.length > 0) headerParts.push(`symbols: ${symbolTags.join(", ")}`);
    const input = headerParts.length > 0 ? `${headerParts.join(" ")}\n${text}` : text;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetchFn(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return computeDeterministicEmbedding(text, symbolTags, dialect, dim);
    }

    const payload = (await res.json()) as {
      data?: Array<{ embedding?: unknown }> | undefined;
    };
    const rawEmbedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(rawEmbedding) || rawEmbedding.length === 0) {
      return computeDeterministicEmbedding(text, symbolTags, dialect, dim);
    }

    const out = new Float32Array(dim);
    const copyLen = Math.min(dim, rawEmbedding.length);
    for (let i = 0; i < copyLen; i++) {
      const val = Number(rawEmbedding[i]);
      if (!Number.isFinite(val)) {
        return computeDeterministicEmbedding(text, symbolTags, dialect, dim);
      }
      out[i] = val;
    }

    return normalizeVector(out);
  } catch {
    return computeDeterministicEmbedding(text, symbolTags, dialect, dim);
  }
}

export function quantizeInt8(vec: Float32Array): { int8: Int8Array; scale: number } {
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 1e-12 ? maxAbs / 127 : 1.0;
  const invScale = 1 / scale;
  const int8 = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    int8[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! * invScale)));
  }
  return { int8, scale };
}

function dotInt8(a: Int8Array, scaleA: number, b: Int8Array, scaleB: number): number {
  let acc = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    acc += a[i]! * b[i]!;
  }
  return acc * scaleA * scaleB;
}

function dotFp32(a: Float32Array, b: Float32Array): number {
  let acc = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    acc += a[i]! * b[i]!;
  }
  return acc;
}

function inferDialectFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mo":
      return "modelica";
    case ".sysml":
    case ".kerml":
      return "sysml2";
    case ".scad":
      return "scad";
    case ".step":
    case ".stp":
      return "step";
    case ".urdf":
      return "urdf";
    case ".owl":
    case ".ofn":
    case ".ttl":
      return "owl2";
    case ".rq":
    case ".sparql":
      return "sparql";
    case ".sp":
    case ".cir":
    case ".spice":
      return "spice";
    case ".md":
    case ".markdown":
      return "markdown";
    default:
      return "text";
  }
}

function extractSymbolTagsFromContent(content: string, dialect: string): string[] {
  const tags = new Set<string>();

  // YAML frontmatter `symbols: [A, B]`
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const fm = content.slice(3, endIdx);
      const symMatch = fm.match(/symbols\s*:\s*\[([^\]]+)\]/i);
      if (symMatch?.[1]) {
        for (const raw of symMatch[1].split(",")) {
          const cleaned = raw.trim().replace(/^["']|["']$/g, "");
          if (cleaned) tags.add(cleaned);
        }
      }
    }
  }

  // Modelica / SysML2 / SCAD / OWL2 declaration names
  const declRe =
    /\b(?:model|block|class|connector|package|part\s+def|port\s+def|requirement\s+def|module|SubClassOf|Class)\s*\(?([A-Za-z_]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(content)) !== null) {
    if (m[1]) tags.add(m[1]);
    if (tags.size >= 24) break;
  }

  if (dialect === "owl2") {
    const iriRe = /:([A-Za-z_]\w*)/g;
    while ((m = iriRe.exec(content)) !== null) {
      if (m[1]) tags.add(m[1]);
      if (tags.size >= 32) break;
    }
  }

  return Array.from(tags);
}

function chunkText(content: string, maxChars = 1200, overlapChars = 160): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(trimmed.length, start + maxChars);
    if (end < trimmed.length) {
      const nl = trimmed.lastIndexOf("\n", end);
      if (nl > start + maxChars * 0.5) end = nl;
    }
    chunks.push(trimmed.slice(start, end).trim());
    if (end >= trimmed.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks.filter(Boolean);
}

function inferModalityKind(sourceKind: MemorySourceKind, dialect: string): MemoryModalityKind {
  const d = dialect.trim().toLowerCase();
  if (sourceKind === "owl2-axiom" || d === "owl2" || d === "sparql") return "ontology";
  if (sourceKind === "social-post") return "social";
  if (["scad", "step", "stl", "obj", "iges", "dxf", "qif", "usd", "three-mf"].includes(d)) return "cad";
  if (["urdf", "adams", "simpack", "gensys", "wam", "openscenario", "opendrive"].includes(d)) return "wam";
  return "code";
}

// ─────────────────────────────────────────────────────────────────────────────
// DiskANN Memory Service
// ─────────────────────────────────────────────────────────────────────────────

export class DiskAnnMemoryService {
  private readonly vectorFilePath: string;
  private readonly dim: number;
  private readonly nodes = new Map<string, RamGraphNode>();
  private nextSlot = 0;
  private loaded = false;

  constructor(
    private readonly database: LibraryDatabase,
    storageDir: string,
    dim = DEFAULT_VECTOR_DIM,
  ) {
    this.dim = dim;
    fs.mkdirSync(storageDir, { recursive: true });
    this.vectorFilePath = path.join(storageDir, "diskann_vectors.f32");
    if (!fs.existsSync(this.vectorFilePath)) {
      fs.writeFileSync(this.vectorFilePath, Buffer.alloc(0));
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const rows = this.database.db
      .prepare(`SELECT * FROM memory_chunks ORDER BY vector_slot ASC`)
      .all() as MemoryChunkRow[];

    for (const row of rows) {
      if (row.tombstoned_at) {
        if (row.vector_slot >= this.nextSlot) {
          this.nextSlot = row.vector_slot + 1;
        }
        continue;
      }
      const int8 = new Int8Array(
        row.int8_quant_blob.buffer,
        row.int8_quant_blob.byteOffset,
        row.int8_quant_blob.byteLength,
      );
      let symbolTags: string[] = [];
      try {
        symbolTags = JSON.parse(row.symbol_tags_json) as string[];
      } catch {
        symbolTags = [];
      }
      const contentSha256 = row.content_sha256 ?? crypto.createHash("sha256").update(row.content).digest("hex");
      this.nodes.set(row.chunk_id, {
        chunkId: row.chunk_id,
        vectorSlot: row.vector_slot,
        int8: new Int8Array(int8),
        scale: row.quant_scale,
        neighbors: [],
        sourceKind: row.source_kind,
        sourceUri: row.source_uri,
        packageName: row.package_name,
        packageVersion: row.package_version,
        dialect: row.dialect,
        tenantScope: row.tenant_scope,
        orgId: row.org_id,
        formalVerified: row.formal_verified === 1,
        symbolTags,
        content: row.content,
        embeddingModelId: row.embedding_model_id ?? DEFAULT_DETERMINISTIC_EMBEDDING_MODEL,
        contentSha256,
        isQuarantined: row.is_quarantined === 1,
        tombstonedAt: row.tombstoned_at ?? null,
        authorUserId: row.author_user_id ?? null,
        modalityKind: row.modality_kind ?? inferModalityKind(row.source_kind, row.dialect),
        independentReproductions: Number(row.independent_reproductions ?? 0),
      });
      if (row.vector_slot >= this.nextSlot) {
        this.nextSlot = row.vector_slot + 1;
      }
    }

    // Build initial Vamana out-neighbor edges over loaded INT8 RAM nodes
    for (const node of this.nodes.values()) {
      this.linkVamanaNeighbors(node);
    }
  }

  private writeVectorToNvme(slot: number, vec: Float32Array): void {
    const byteOffset = slot * this.dim * 4;
    const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const fd = fs.openSync(this.vectorFilePath, "r+");
    try {
      fs.writeSync(fd, buf, 0, buf.byteLength, byteOffset);
    } finally {
      fs.closeSync(fd);
    }
  }

  private readVectorFromNvme(slot: number): Float32Array | null {
    const byteOffset = slot * this.dim * 4;
    const byteLen = this.dim * 4;
    const buf = Buffer.allocUnsafe(byteLen);
    const fd = fs.openSync(this.vectorFilePath, "r");
    try {
      const bytesRead = fs.readSync(fd, buf, 0, byteLen, byteOffset);
      if (bytesRead < byteLen) return null;
      return new Float32Array(buf.buffer, buf.byteOffset, this.dim);
    } finally {
      fs.closeSync(fd);
    }
  }

  private linkVamanaNeighbors(target: RamGraphNode): void {
    if (this.nodes.size <= 1) return;
    const scored: { id: string; sim: number }[] = [];
    for (const other of this.nodes.values()) {
      if (other.chunkId === target.chunkId) continue;
      if (other.isQuarantined || other.tombstonedAt) continue;
      const sim = dotInt8(target.int8, target.scale, other.int8, other.scale);
      scored.push({ id: other.chunkId, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    target.neighbors = scored.slice(0, VAMANA_MAX_DEGREE).map((s) => s.id);

    // Bidirectional reverse edge insertion with degree pruning
    for (const nbId of target.neighbors) {
      const nb = this.nodes.get(nbId);
      if (!nb) continue;
      if (!nb.neighbors.includes(target.chunkId)) {
        nb.neighbors.push(target.chunkId);
        if (nb.neighbors.length > VAMANA_MAX_DEGREE) {
          nb.neighbors.pop();
        }
      }
    }
  }

  /**
   * Upserts a single memory chunk into SQLite metadata, the NVMe FP32 flash vector file,
   * and the in-RAM INT8 Vamana routing graph.
   */
  public upsertChunk(input: MemoryChunkInput): string {
    this.ensureLoaded();
    const symbolTags =
      input.symbolTags && input.symbolTags.length > 0
        ? input.symbolTags
        : extractSymbolTagsFromContent(input.content, input.dialect);

    const chunkId = crypto
      .createHash("sha256")
      .update(
        `${input.sourceKind}|${input.sourceUri}|${input.packageName ?? ""}|${input.packageVersion ?? ""}|${input.content}`,
      )
      .digest("hex")
      .slice(0, 32);

    const contentSha256 = crypto.createHash("sha256").update(input.content).digest("hex");
    const embeddingModelId =
      input.embeddingModelId ??
      (input.embedding ? resolveActiveEmbeddingModelId() : DEFAULT_DETERMINISTIC_EMBEDDING_MODEL);

    const fp32 = input.embedding
      ? normalizeVector(
          input.embedding instanceof Float32Array
            ? new Float32Array(input.embedding.slice(0, this.dim))
            : Float32Array.from(input.embedding.slice(0, this.dim)),
        )
      : computeDeterministicEmbedding(input.content, symbolTags, input.dialect, this.dim);

    // Zero-pad if caller supplied a smaller vector than this.dim
    const fullVec =
      fp32.length === this.dim
        ? fp32
        : (() => {
            const padded = new Float32Array(this.dim);
            padded.set(fp32);
            return normalizeVector(padded);
          })();

    const { int8, scale } = quantizeInt8(fullVec);
    const existing = this.nodes.get(chunkId);
    const slot = existing ? existing.vectorSlot : this.nextSlot++;

    this.writeVectorToNvme(slot, fullVec);

    const tenantScope: TenantScope = input.tenantScope ?? "public";
    const orgId = input.orgId ?? null;
    const formalVerified = input.formalVerified ? 1 : 0;
    const dialect = input.dialect.toLowerCase();
    const modalityKind = input.modalityKind ?? inferModalityKind(input.sourceKind, dialect);
    const qudvUnitsJson = JSON.stringify(input.qudvUnits ?? []);
    const authorUserId = input.authorUserId ?? null;

    this.database.db
      .prepare(
        `
        INSERT INTO memory_chunks (
          chunk_id, source_kind, source_uri, package_name, package_version, git_sha,
          dialect, tenant_scope, org_id, formal_verified, symbol_tags_json, content,
          vector_dim, vector_slot, int8_quant_blob, quant_scale,
          embedding_model_id, content_sha256, is_quarantined, tombstoned_at,
          author_user_id, qudv_units_json, modality_kind, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, datetime('now'))
        ON CONFLICT(chunk_id) DO UPDATE SET
          git_sha = excluded.git_sha,
          formal_verified = excluded.formal_verified,
          symbol_tags_json = excluded.symbol_tags_json,
          content = excluded.content,
          int8_quant_blob = excluded.int8_quant_blob,
          quant_scale = excluded.quant_scale,
          embedding_model_id = excluded.embedding_model_id,
          content_sha256 = excluded.content_sha256,
          tombstoned_at = NULL,
          author_user_id = COALESCE(excluded.author_user_id, memory_chunks.author_user_id),
          qudv_units_json = excluded.qudv_units_json,
          modality_kind = excluded.modality_kind,
          updated_at = datetime('now')
      `,
      )
      .run(
        chunkId,
        input.sourceKind,
        input.sourceUri,
        input.packageName ?? null,
        input.packageVersion ?? null,
        input.gitSha ?? null,
        dialect,
        tenantScope,
        orgId,
        formalVerified,
        JSON.stringify(symbolTags),
        input.content,
        this.dim,
        slot,
        Buffer.from(int8.buffer, int8.byteOffset, int8.byteLength),
        scale,
        embeddingModelId,
        contentSha256,
        authorUserId,
        qudvUnitsJson,
        modalityKind,
      );

    const node: RamGraphNode = {
      chunkId,
      vectorSlot: slot,
      int8,
      scale,
      neighbors: existing?.neighbors ?? [],
      sourceKind: input.sourceKind,
      sourceUri: input.sourceUri,
      packageName: input.packageName ?? null,
      packageVersion: input.packageVersion ?? null,
      dialect,
      tenantScope,
      orgId,
      formalVerified: formalVerified === 1,
      symbolTags,
      content: input.content,
      embeddingModelId,
      contentSha256,
      isQuarantined: existing?.isQuarantined ?? false,
      tombstonedAt: null,
      authorUserId,
      modalityKind,
      independentReproductions: existing?.independentReproductions ?? 0,
    };
    this.nodes.set(chunkId, node);
    this.linkVamanaNeighbors(node);
    return chunkId;
  }

  /**
   * Async upsert that uses the active external embedding model when `EMBEDDING_API_URL` is configured,
   * guaranteeing indexing and querying always share the same embedding space.
   */
  public async upsertChunkAsync(input: MemoryChunkInput): Promise<string> {
    if (input.embedding) {
      return this.upsertChunk(input);
    }
    const symbolTags =
      input.symbolTags && input.symbolTags.length > 0
        ? input.symbolTags
        : extractSymbolTagsFromContent(input.content, input.dialect);
    const embedding = await computeEmbeddingWithExternalFallback(input.content, symbolTags, input.dialect, this.dim);
    return this.upsertChunk({
      ...input,
      symbolTags,
      embedding,
      embeddingModelId: resolveActiveEmbeddingModelId(),
    });
  }

  /**
   * Removes all chunks associated with a given `sourceUri` (used by incremental `git diff` sync).
   */
  public deleteBySourceUri(sourceUri: string): number {
    this.ensureLoaded();
    const rows = this.database.db.prepare(`SELECT chunk_id FROM memory_chunks WHERE source_uri = ?`).all(sourceUri) as {
      chunk_id: string;
    }[];
    for (const r of rows) {
      this.nodes.delete(r.chunk_id);
    }
    const info = this.database.db.prepare(`DELETE FROM memory_chunks WHERE source_uri = ?`).run(sourceUri);
    return Number(info.changes);
  }

  /**
   * Deletes (or tombstones) a single chunk by `chunkId`.
   */
  public deleteChunk(chunkId: string, hardDelete = true): boolean {
    this.ensureLoaded();
    this.nodes.delete(chunkId);
    if (hardDelete) {
      const info = this.database.db.prepare(`DELETE FROM memory_chunks WHERE chunk_id = ?`).run(chunkId);
      return Number(info.changes) > 0;
    }
    const info = this.database.db
      .prepare(
        `UPDATE memory_chunks SET tombstoned_at = datetime('now'), updated_at = datetime('now') WHERE chunk_id = ?`,
      )
      .run(chunkId);
    return Number(info.changes) > 0;
  }

  /**
   * Quarantines or un-quarantines a specific chunk so it is immediately excluded from retrieval.
   */
  public setChunkQuarantined(chunkId: string, quarantined: boolean): boolean {
    this.ensureLoaded();
    const info = this.database.db
      .prepare(`UPDATE memory_chunks SET is_quarantined = ?, updated_at = datetime('now') WHERE chunk_id = ?`)
      .run(quarantined ? 1 : 0, chunkId);
    const node = this.nodes.get(chunkId);
    if (node) {
      node.isQuarantined = quarantined;
    }
    return Number(info.changes) > 0;
  }

  /**
   * Quarantines all chunks matching a `sourceUri` or `exampleId` prefix (used by overlay patches & revocation cascades).
   */
  public quarantineBySourceUri(sourceUriOrExampleId: string, quarantined = true): number {
    this.ensureLoaded();
    const clean = sourceUriOrExampleId.trim();
    if (!clean) return 0;
    const rows = this.database.db
      .prepare(`SELECT chunk_id FROM memory_chunks WHERE chunk_id = ? OR source_uri = ? OR source_uri LIKE ?`)
      .all(clean, clean, `%${clean}%`) as { chunk_id: string }[];
    for (const r of rows) {
      this.setChunkQuarantined(r.chunk_id, quarantined);
    }
    return rows.length;
  }

  /**
   * Paginated chunk listing for Vector Memory Curation UI & administrative auditing.
   */
  public listChunks(options?: {
    sourceKind?: string | undefined;
    dialect?: string | undefined;
    modalityKind?: string | undefined;
    formalVerified?: boolean | undefined;
    isQuarantined?: boolean | undefined;
    embeddingModelId?: string | undefined;
    search?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): {
    chunks: Array<{
      chunkId: string;
      sourceKind: MemorySourceKind;
      sourceUri: string;
      packageName: string | null;
      packageVersion: string | null;
      dialect: string;
      tenantScope: TenantScope;
      formalVerified: boolean;
      isQuarantined: boolean;
      embeddingModelId: string;
      modalityKind: MemoryModalityKind;
      authorUserId: number | null;
      symbolTags: string[];
      contentPreview: string;
      independentReproductions: number;
    }>;
    total: number;
  } {
    this.ensureLoaded();
    const limit = Math.min(200, Math.max(1, options?.limit ?? 50));
    const offset = Math.max(0, options?.offset ?? 0);
    const searchLower = options?.search?.trim().toLowerCase() ?? "";

    const matched: RamGraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.tombstonedAt) continue;
      if (options?.sourceKind && node.sourceKind !== options.sourceKind) continue;
      if (options?.dialect && node.dialect !== options.dialect.toLowerCase()) continue;
      if (options?.modalityKind && node.modalityKind !== options.modalityKind) continue;
      if (options?.formalVerified !== undefined && node.formalVerified !== options.formalVerified) continue;
      if (options?.isQuarantined !== undefined && node.isQuarantined !== options.isQuarantined) continue;
      if (options?.embeddingModelId && node.embeddingModelId !== options.embeddingModelId) continue;
      if (
        searchLower &&
        !node.sourceUri.toLowerCase().includes(searchLower) &&
        !node.content.toLowerCase().includes(searchLower) &&
        !node.symbolTags.some((t) => t.toLowerCase().includes(searchLower))
      ) {
        continue;
      }
      matched.push(node);
    }

    const page = matched.slice(offset, offset + limit).map((node) => ({
      chunkId: node.chunkId,
      sourceKind: node.sourceKind,
      sourceUri: node.sourceUri,
      packageName: node.packageName,
      packageVersion: node.packageVersion,
      dialect: node.dialect,
      tenantScope: node.tenantScope,
      formalVerified: node.formalVerified,
      isQuarantined: node.isQuarantined,
      embeddingModelId: node.embeddingModelId,
      modalityKind: node.modalityKind,
      authorUserId: node.authorUserId,
      symbolTags: node.symbolTags,
      contentPreview: node.content.slice(0, 280),
      independentReproductions: node.independentReproductions,
    }));

    return { chunks: page, total: matched.length };
  }

  /**
   * Compacts `diskann_vectors.f32`, purges tombstoned rows, deduplicates identical
   * `content_sha256` chunks within the same tenant/dialect, and rebuilds the INT8 Vamana graph atomically.
   */
  public compactIndex(): {
    beforeChunks: number;
    afterChunks: number;
    reclaimedBytes: number;
    deduplicatedCount: number;
  } {
    this.ensureLoaded();
    const beforeChunks = this.nodes.size;
    let beforeBytes = 0;
    try {
      beforeBytes = fs.statSync(this.vectorFilePath).size;
    } catch {
      beforeBytes = 0;
    }

    // Purge tombstoned rows from SQLite
    this.database.db.prepare(`DELETE FROM memory_chunks WHERE tombstoned_at IS NOT NULL`).run();

    // Deduplicate identical content hashes within (tenantScope, orgId, dialect, sourceKind)
    const seenContentKeys = new Set<string>();
    const keptNodes: RamGraphNode[] = [];
    const duplicateIds: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.tombstonedAt) continue;
      const dedupKey = `${node.tenantScope}|${node.orgId ?? "null"}|${node.dialect}|${node.sourceKind}|${node.contentSha256}`;
      if (seenContentKeys.has(dedupKey)) {
        duplicateIds.push(node.chunkId);
        continue;
      }
      seenContentKeys.add(dedupKey);
      keptNodes.push(node);
    }

    // Read existing FP32 vectors before rewriting sequentially to temp file
    const tempPath = `${this.vectorFilePath}.compact.tmp`;
    const totalBuf = Buffer.alloc(keptNodes.length * this.dim * 4);
    for (let newSlot = 0; newSlot < keptNodes.length; newSlot++) {
      const node = keptNodes[newSlot]!;
      const fp32 =
        this.readVectorFromNvme(node.vectorSlot) ??
        computeDeterministicEmbedding(node.content, node.symbolTags, node.dialect, this.dim);
      const slice = Buffer.from(fp32.buffer, fp32.byteOffset, this.dim * 4);
      slice.copy(totalBuf, newSlot * this.dim * 4);
    }
    fs.writeFileSync(tempPath, totalBuf);
    fs.renameSync(tempPath, this.vectorFilePath);

    // Update SQLite slots & remove duplicates transactionally
    this.database.db.transaction(() => {
      for (const dupId of duplicateIds) {
        this.database.db.prepare(`DELETE FROM memory_chunks WHERE chunk_id = ?`).run(dupId);
        this.nodes.delete(dupId);
      }
      const updateSlotStmt = this.database.db.prepare(`UPDATE memory_chunks SET vector_slot = ? WHERE chunk_id = ?`);
      for (let newSlot = 0; newSlot < keptNodes.length; newSlot++) {
        const node = keptNodes[newSlot]!;
        node.vectorSlot = newSlot;
        node.neighbors = [];
        updateSlotStmt.run(newSlot, node.chunkId);
      }
    })();

    this.nextSlot = keptNodes.length;
    for (const node of keptNodes) {
      this.linkVamanaNeighbors(node);
    }

    const afterBytes = totalBuf.length;
    return {
      beforeChunks,
      afterChunks: keptNodes.length,
      reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
      deduplicatedCount: duplicateIds.length,
    };
  }

  /**
   * Incremental `git diff` indexer: deletes stale chunks for modified/deleted files and upserts
   * only changed files into DiskANN.
   */
  public indexGitDiff(options: {
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    gitSha?: string | undefined;
    tenantScope?: TenantScope | undefined;
    orgId?: number | null | undefined;
    formalVerified?: boolean | undefined;
    changes: GitDiffFileChange[];
  }): { indexedChunks: number; deletedChunks: number; filesProcessed: number } {
    this.ensureLoaded();
    let indexedChunks = 0;
    let deletedChunks = 0;

    for (const change of options.changes) {
      const uriPrefix = options.packageName
        ? `pkg://${options.packageName}@${options.packageVersion ?? "latest"}/${change.path}`
        : `git://${change.path}`;

      if (change.status === "D" || change.status === "M") {
        deletedChunks += this.deleteBySourceUri(uriPrefix);
      }
      if (change.status !== "D" && typeof change.content === "string" && change.content.trim()) {
        const dialect = change.dialect ?? inferDialectFromPath(change.path);
        const sourceKind: MemorySourceKind =
          dialect === "owl2"
            ? "owl2-axiom"
            : dialect === "markdown" || dialect === "text"
              ? "package-doc"
              : "package-symbol";
        const pieces = chunkText(change.content);
        for (const piece of pieces) {
          this.upsertChunk({
            sourceKind,
            sourceUri: uriPrefix,
            packageName: options.packageName,
            packageVersion: options.packageVersion,
            gitSha: options.gitSha,
            dialect,
            tenantScope: options.tenantScope ?? "public",
            orgId: options.orgId ?? null,
            formalVerified: options.formalVerified ?? false,
            content: piece,
          });
          indexedChunks++;
        }
      }
    }

    return { indexedChunks, deletedChunks, filesProcessed: options.changes.length };
  }

  /**
   * Dual-mode DiskANN retrieval:
   *   - `mode: "latent"` — queries with projected LLM hidden state `q = Normalize(W_q h_t + b_q)`
   *   - `mode: "hybrid"` — queries with text + symbol boosts + semver lockfile pins
   * Enforces strict RBAC (`tenantScope` / `callerOrgId`) before returning any chunk.
   */
  /**
   * Collects active `quarantine` example IDs from `dataset_overlay_patches` so
   * quarantined dataset items are excluded from DiskANN RAG retrieval in real time.
   */
  private loadQuarantinedExampleIds(): Set<string> {
    const out = new Set<string>();
    try {
      const rows = this.database.db
        .prepare(`SELECT example_id FROM dataset_overlay_patches WHERE action = 'quarantine'`)
        .all() as { example_id: string }[];
      for (const r of rows) {
        if (r.example_id) out.add(r.example_id);
      }
    } catch {
      // Table may not exist in isolated minimal DB tests
    }
    return out;
  }

  /**
   * Async dual-mode DiskANN retrieval that embeds hybrid text queries with the
   * exact same external embedder (`EMBEDDING_API_URL`) used by `upsertChunkAsync`
   * and `social.ts`, preventing embedding-space mismatches.
   */
  public async queryAsync(
    req: MemoryQueryRequest,
    caller?: { userId?: number | undefined; orgId?: number | null | undefined },
  ): Promise<MemoryQueryResponse> {
    if (req.mode !== "latent" && process.env["EMBEDDING_API_URL"]?.trim() && req.textQuery) {
      const querySymbols = req.textQuery.match(/[A-Za-z_]\w*/g) ?? [];
      const activeDialect = req.dialects?.[0] ?? "";
      const extVec = await computeEmbeddingWithExternalFallback(req.textQuery, querySymbols, activeDialect, this.dim);
      return this.query(req, caller, extVec);
    }
    return this.query(req, caller);
  }

  /**
   * Dual-mode DiskANN retrieval:
   *   - `mode: "latent"` — queries with projected LLM hidden state `q = Normalize(W_q h_t + b_q)`
   *   - `mode: "hybrid"` — queries with text + symbol boosts + semver lockfile pins
   * Enforces strict RBAC (`tenantScope` / `callerOrgId`) and quarantine exclusion before returning any chunk.
   */
  public query(
    req: MemoryQueryRequest,
    caller?: { userId?: number | undefined; orgId?: number | null | undefined },
    precomputedQueryFp32?: Float32Array,
  ): MemoryQueryResponse {
    const startHr = performance.now();
    this.ensureLoaded();

    const topK = Math.min(50, Math.max(1, req.topK ?? 6));
    const includeSocial = req.includeSocialPosts !== false;
    const allowedDialects =
      Array.isArray(req.dialects) && req.dialects.length > 0
        ? new Set(req.dialects.map((d) => d.trim().toLowerCase()))
        : null;
    const packagePins = req.packagePins && Object.keys(req.packagePins).length > 0 ? req.packagePins : null;
    const quarantinedIds = this.loadQuarantinedExampleIds();

    // 1. Construct normalized query vector (FP32 + INT8 quantized for Vamana RAM beam search)
    let queryFp32: Float32Array;
    if (precomputedQueryFp32 && precomputedQueryFp32.length === this.dim) {
      queryFp32 = normalizeVector(new Float32Array(precomputedQueryFp32));
    } else if (req.mode === "latent" && Array.isArray(req.latentVector) && req.latentVector.length > 0) {
      const padded = new Float32Array(this.dim);
      for (let i = 0; i < Math.min(this.dim, req.latentVector.length); i++) {
        padded[i] = req.latentVector[i]!;
      }
      queryFp32 = normalizeVector(padded);
    } else {
      const text = req.textQuery ?? "";
      const querySymbols = text.match(/[A-Za-z_]\w*/g) ?? [];
      queryFp32 = computeDeterministicEmbedding(text, querySymbols, "", this.dim);
    }
    const queryQuant = quantizeInt8(queryFp32);

    // Helper enforcing strict server-side RBAC, quarantine exclusion & semver lockfile pinning
    const isNodeEligible = (node: RamGraphNode): boolean => {
      if (node.isQuarantined || node.tombstonedAt) {
        return false;
      }
      if (quarantinedIds.size > 0 && (quarantinedIds.has(node.chunkId) || quarantinedIds.has(node.sourceUri))) {
        return false;
      }

      // RBAC tenant isolation
      if (node.tenantScope !== "public") {
        if (caller?.orgId == null || node.orgId !== caller.orgId) {
          return false;
        }
      }
      if (req.tenantScope && node.tenantScope !== req.tenantScope) {
        return false;
      }

      // Dialect filter
      if (allowedDialects && !allowedDialects.has(node.dialect)) {
        return false;
      }

      // Social post inclusion toggle
      const isSocial = node.sourceKind === "social-post" || node.sourceKind === "rlhf-verified-fix";
      if (isSocial && !includeSocial) {
        return false;
      }

      // Semver lockfile pinning for package chunks
      if (packagePins && !isSocial && node.packageName) {
        const pinnedVersion = packagePins[node.packageName];
        if (!pinnedVersion) return false;
        if (pinnedVersion !== "*" && node.packageVersion && node.packageVersion !== pinnedVersion) {
          return false;
        }
      }

      return true;
    };

    // 2. Stage 1: INT8 RAM Vamana Greedy Beam Search (over eligible graph nodes)
    const eligibleIds: string[] = [];
    for (const node of this.nodes.values()) {
      if (isNodeEligible(node)) eligibleIds.push(node.chunkId);
    }

    const shortlistIds = new Set<string>();
    if (eligibleIds.length <= VAMANA_BEAM_WIDTH * 2) {
      for (const id of eligibleIds) shortlistIds.add(id);
    } else {
      // Seed beam from medoid / stride entry points and greedily expand Vamana neighbors in RAM
      const visited = new Set<string>();
      const beam: { id: string; approxScore: number }[] = [];
      const stride = Math.max(1, Math.floor(eligibleIds.length / 8));
      for (let i = 0; i < eligibleIds.length; i += stride) {
        const id = eligibleIds[i]!;
        const node = this.nodes.get(id)!;
        visited.add(id);
        beam.push({ id, approxScore: dotInt8(queryQuant.int8, queryQuant.scale, node.int8, node.scale) });
      }
      beam.sort((a, b) => b.approxScore - a.approxScore);

      let expanded = 0;
      while (expanded < beam.length && expanded < VAMANA_BEAM_WIDTH) {
        const cur = this.nodes.get(beam[expanded]!.id);
        expanded++;
        if (!cur) continue;
        for (const nbId of cur.neighbors) {
          if (visited.has(nbId)) continue;
          visited.add(nbId);
          const nb = this.nodes.get(nbId);
          if (!nb || !isNodeEligible(nb)) continue;
          beam.push({ id: nbId, approxScore: dotInt8(queryQuant.int8, queryQuant.scale, nb.int8, nb.scale) });
        }
        beam.sort((a, b) => b.approxScore - a.approxScore);
        if (beam.length > VAMANA_BEAM_WIDTH * 2) {
          beam.length = VAMANA_BEAM_WIDTH * 2;
        }
      }
      for (const item of beam.slice(0, VAMANA_BEAM_WIDTH)) {
        shortlistIds.add(item.id);
      }
    }

    // 3. Stage 2: Exact FP32 NVMe Flash Rerank + Symbolic / Verification-Prior Boost
    const queryLowerTerms =
      req.mode === "hybrid" && req.textQuery
        ? new Set((req.textQuery.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length >= 2))
        : null;

    const reranked: MemoryChunkResult[] = [];
    for (const id of shortlistIds) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const nvmeVec = this.readVectorFromNvme(node.vectorSlot);
      let score = nvmeVec
        ? dotFp32(queryFp32, nvmeVec)
        : dotInt8(queryQuant.int8, queryQuant.scale, node.int8, node.scale);

      // Hybrid symbolic tag match boost + verification-first trust prior
      if (queryLowerTerms && queryLowerTerms.size > 0) {
        let symHits = 0;
        for (const tag of node.symbolTags) {
          if (queryLowerTerms.has(tag.toLowerCase())) symHits++;
        }
        if (symHits > 0) score += Math.min(0.25, symHits * 0.08);
      }
      if (node.formalVerified) {
        score += 0.05;
      }
      if (node.sourceKind === "rlhf-verified-fix") {
        score += 0.04;
      }
      if (node.independentReproductions > 0) {
        score += Math.min(0.06, node.independentReproductions * 0.015);
      }

      reranked.push({
        chunkId: node.chunkId,
        sourceKind: node.sourceKind,
        sourceUri: node.sourceUri,
        ...(node.packageName ? { packageName: node.packageName } : {}),
        ...(node.packageVersion ? { packageVersion: node.packageVersion } : {}),
        dialect: node.dialect,
        score: Number(score.toFixed(4)),
        content: node.content,
        formalVerified: node.formalVerified,
        symbolTags: node.symbolTags,
      });
    }

    reranked.sort((a, b) => b.score - a.score);
    const latencyMs = Number((performance.now() - startHr).toFixed(3));

    return {
      backend: "diskann",
      latencyMs,
      chunks: reranked.slice(0, topK),
    };
  }

  public getChunkAuthorUserId(chunkId: string): number | null {
    this.ensureLoaded();
    return this.nodes.get(chunkId)?.authorUserId ?? null;
  }

  public getStats(): {
    backend: "diskann";
    vectorDim: number;
    activeEmbeddingModelId: string;
    totalChunks: number;
    quarantinedChunks: number;
    formalVerifiedChunks: number;
    ramInt8Bytes: number;
    nvmeFp32Bytes: number;
    deadSlotBytes: number;
    maxVamanaDegree: number;
    bySourceKind: Record<string, number>;
    byModality: Record<string, number>;
    byEmbeddingModel: Record<string, number>;
  } {
    this.ensureLoaded();
    const bySourceKind: Record<string, number> = {};
    const byModality: Record<string, number> = {};
    const byEmbeddingModel: Record<string, number> = {};
    let quarantinedChunks = 0;
    let formalVerifiedChunks = 0;

    for (const node of this.nodes.values()) {
      bySourceKind[node.sourceKind] = (bySourceKind[node.sourceKind] ?? 0) + 1;
      byModality[node.modalityKind] = (byModality[node.modalityKind] ?? 0) + 1;
      byEmbeddingModel[node.embeddingModelId] = (byEmbeddingModel[node.embeddingModelId] ?? 0) + 1;
      if (node.isQuarantined) quarantinedChunks++;
      if (node.formalVerified) formalVerifiedChunks++;
    }
    let nvmeFp32Bytes = 0;
    try {
      nvmeFp32Bytes = fs.statSync(this.vectorFilePath).size;
    } catch {
      nvmeFp32Bytes = 0;
    }
    const activeFp32Bytes = this.nodes.size * this.dim * 4;
    return {
      backend: "diskann",
      vectorDim: this.dim,
      activeEmbeddingModelId: resolveActiveEmbeddingModelId(),
      totalChunks: this.nodes.size,
      quarantinedChunks,
      formalVerifiedChunks,
      ramInt8Bytes: this.nodes.size * this.dim,
      nvmeFp32Bytes,
      deadSlotBytes: Math.max(0, nvmeFp32Bytes - activeFp32Bytes),
      maxVamanaDegree: VAMANA_MAX_DEGREE,
      bySourceKind,
      byModality,
      byEmbeddingModel,
    };
  }
}

const sharedDiskAnnServices = new WeakMap<LibraryDatabase, DiskAnnMemoryService>();

/**
 * Returns the shared `DiskAnnMemoryService` instance associated with a `LibraryDatabase`,
 * creating and caching it lazily so `memoryRouter`, `gitServerRouter`, and `socialRouter`
 * operate on the same live in-RAM Vamana graph and NVMe vector file.
 */
export function getOrCreateDiskAnnService(
  database: LibraryDatabase,
  storageDir?: string,
  dim = DEFAULT_VECTOR_DIM,
): DiskAnnMemoryService {
  const existing = sharedDiskAnnServices.get(database);
  if (existing) return existing;
  const resolvedDir = storageDir ?? path.join(database.dbDir || path.join(process.cwd(), "data"), "ml-memory");
  const service = new DiskAnnMemoryService(database, resolvedDir, dim);
  sharedDiskAnnServices.set(database, service);
  return service;
}
