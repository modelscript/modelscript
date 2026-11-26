// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DiskANN Decoupled Engineering Memory & Dynamic-m Dataset Shard API.
 *
 * Mounted at `/api/v1/memory`:
 *   - `POST /query`                    : Dual-mode DiskANN retrieval (`latent` W_q h_t + b_q or `hybrid` text+semver pins)
 *   - `POST /index/git-diff`           : Incremental `git diff` sync into DiskANN (packages, Markdown, OWL2)
 *   - `POST /index/social`             : Index verified social posts & RLHF Fix-It solutions into DiskANN
 *   - `POST /datasets/compile`         : Compile raw files into deterministic `m_init`-bucketed JSONL shards
 *   - `GET  /datasets/shards`          : List compiled dataset shards
 *   - `GET  /datasets/shards/:shardId` : Stream shard with HTTP `Range` (206 Partial Content) for Browser OPFS
 *   - `GET  /stats`                    : DiskANN RAM INT8 vs NVMe FP32 storage telemetry
 *   - `POST /federated/query`          : Federated public-only DiskANN fan-out query across trusted peer nodes
 *   - `GET  /federated/peers`          : List trusted federated DiskANN peers
 *   - `POST /federated/peers`          : Register/update a trusted federated DiskANN peer
 *   - `POST /federated/sign-manifest`  : Ed25519 sign a dataset/training-recipe/memory-shard manifest (`eddsa-jcs-2022`)
 *   - `POST /federated/verify-manifest`: Verify an Ed25519 signed dataset/training-recipe/memory-shard manifest
 *   - `POST /federated/attest`         : Record a signed `FederatedVerificationAttestation` & increment independentReproductions
 *   - `GET  /leaderboards`             : Domain leaderboards for verified `training-recipe` entries ranked by Pass@1 * Gate1To4PassRate
 */

import {
  validateMemoryShardCompatibility,
  type AiGovernancePolicy,
  type FederatedVerificationAttestation,
  type MemoryQueryRequest,
  type MemoryShardContract,
  type TenantScope,
} from "@modelscript/runtime";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { compileDatasetShards, type RawDatasetFileInput } from "../services/dataset-compiler.js";
import {
  getOrCreateDiskAnnService,
  type GitDiffFileChange,
  type MemorySourceKind,
} from "../services/diskann-memory.js";
import {
  FederatedDiskAnnCoordinator,
  getDefaultDatasetSigningKeyPair,
  signDatasetManifestEd25519,
  verifyDatasetManifestEd25519,
  type DatasetManifestPayload,
  type DatasetManifestProof,
  type FederatedMemoryQueryRequest,
} from "../services/federated-diskann.js";
import { decodeMultibase, encodeMultibase } from "../services/git-sync/base58.js";
import { canonicalizeJson } from "../services/git-sync/jcs.js";
import { publicErrorMessage } from "../utils/http-error.js";

type ExtendedDatasetKind = "dataset-pretrain" | "dataset-posttrain" | "training-recipe" | "memory-shard";

interface ShardDbRow {
  shard_id: string;
  recipe_name: string;
  recipe_version: string;
  dataset_kind: ExtendedDatasetKind;
  dialect: string;
  m_min: number;
  m_max: number;
  example_count: number;
  storage_path: string;
  byte_size: number;
  tenant_scope: TenantScope;
  provenance_json: string;
  created_at: string;
}

interface MemoryShardManifestDbRow {
  shard_id: string;
  recipe_name: string;
  recipe_version: string;
  dataset_kind: "memory-shard";
  dialect: string;
  origin_node: string;
  signer_pubkey: string;
  memory_contract_json: string;
  ai_governance_json: string;
  example_count: number;
  byte_size: number;
  tenant_scope: TenantScope;
  provenance_json: string;
  created_at: string;
}

interface AttestationCountRow {
  independent_reproductions: number;
  total_attestations: number;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);

function extractEd25519PublicKeyMultibase(pubKeyObj: crypto.KeyObject): string {
  const spkiDer = pubKeyObj.export({ type: "spki", format: "der" });
  const rawPub32 = spkiDer.subarray(ED25519_SPKI_PREFIX.length);
  return encodeMultibase(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPub32]));
}

function ed25519PublicKeyFromMultibase(publicKeyMultibase: string): crypto.KeyObject {
  const decoded = decodeMultibase(publicKeyMultibase);
  const rawPub32 = decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01 ? decoded.subarray(2) : decoded;
  if (rawPub32.length !== 32) {
    throw new Error("Invalid Ed25519 multibase public key length");
  }
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
  return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
}

function signGenericPayloadEd25519(
  payload: Record<string, unknown>,
  options?: {
    privateKeyPem?: string | undefined;
    verificationMethod?: string | undefined;
    created?: string | undefined;
  },
): { payload: Record<string, unknown>; proof: DatasetManifestProof } {
  const privKeyObj = options?.privateKeyPem
    ? crypto.createPrivateKey(options.privateKeyPem)
    : crypto.createPrivateKey(getDefaultDatasetSigningKeyPair().privateKeyPem);
  if (privKeyObj.asymmetricKeyType !== "ed25519") {
    throw new Error(`Unsupported signing key type '${String(privKeyObj.asymmetricKeyType)}'; expected 'ed25519'.`);
  }
  const pubKeyObj = crypto.createPublicKey(privKeyObj);
  const publicKeyMultibase = extractEd25519PublicKeyMultibase(pubKeyObj);
  const publicKeyPem = pubKeyObj.export({ type: "spki", format: "pem" }).toString();

  const cleanPayload = { ...payload };
  delete cleanPayload["proof"];
  const canonicalPayload = canonicalizeJson(cleanPayload);
  const docHash = crypto.createHash("sha256").update(canonicalPayload, "utf8").digest();

  const created = options?.created ?? new Date().toISOString();
  const verificationMethod =
    options?.verificationMethod?.trim() || `did:key:${publicKeyMultibase}#${publicKeyMultibase}`;
  const proofConfig = {
    type: "DataIntegrityProof" as const,
    cryptosuite: "eddsa-jcs-2022" as const,
    created,
    verificationMethod,
    proofPurpose: "assertionMethod" as const,
  };
  const configHash = crypto.createHash("sha256").update(canonicalizeJson(proofConfig), "utf8").digest();
  const signingData = Buffer.concat([configHash, docHash]);
  const signatureBytes = crypto.sign(null, signingData, privKeyObj);

  return {
    payload: cleanPayload,
    proof: {
      ...proofConfig,
      publicKeyMultibase,
      publicKeyPem,
      payloadSha256: docHash.toString("hex"),
      proofValue: encodeMultibase(signatureBytes),
    },
  };
}

function verifyGenericPayloadEd25519(
  payload: Record<string, unknown>,
  proof: Partial<DatasetManifestProof>,
  options?: {
    expectedPublicKeyPem?: string | undefined;
    expectedPublicKeyMultibase?: string | undefined;
    trustedPublicKeys?: string[] | undefined;
  },
): {
  valid: boolean;
  error?: string;
  payloadSha256?: string;
  publicKeyMultibase?: string;
  verificationMethod?: string;
} {
  if (proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022") {
    return { valid: false, error: "Unsupported proof type or cryptosuite (expected eddsa-jcs-2022)." };
  }
  if (!proof.proofValue || !proof.created || !proof.verificationMethod) {
    return { valid: false, error: "Missing required proof fields (created, verificationMethod, proofValue)." };
  }

  let pubKeyObj: crypto.KeyObject;
  try {
    if (options?.expectedPublicKeyPem) {
      pubKeyObj = crypto.createPublicKey(options.expectedPublicKeyPem);
    } else if (options?.expectedPublicKeyMultibase) {
      pubKeyObj = ed25519PublicKeyFromMultibase(options.expectedPublicKeyMultibase);
    } else if (proof.publicKeyMultibase) {
      pubKeyObj = ed25519PublicKeyFromMultibase(proof.publicKeyMultibase);
    } else if (proof.publicKeyPem) {
      pubKeyObj = crypto.createPublicKey(proof.publicKeyPem);
    } else {
      return { valid: false, error: "No public key available to verify Ed25519 proof." };
    }
  } catch (err) {
    return { valid: false, error: `Invalid public key: ${err instanceof Error ? err.message : String(err)}` };
  }

  const resolvedMultibase = extractEd25519PublicKeyMultibase(pubKeyObj);
  if (options?.trustedPublicKeys && options.trustedPublicKeys.length > 0) {
    if (!options.trustedPublicKeys.includes(resolvedMultibase)) {
      return { valid: false, error: `Signer public key '${resolvedMultibase}' is not in trustedPublicKeys.` };
    }
  }

  const cleanPayload = { ...payload };
  delete cleanPayload["proof"];
  const docHash = crypto.createHash("sha256").update(canonicalizeJson(cleanPayload), "utf8").digest();
  const payloadSha256 = docHash.toString("hex");
  if (proof.payloadSha256 && proof.payloadSha256 !== payloadSha256) {
    return { valid: false, error: "Payload SHA-256 mismatch." };
  }

  const proofConfig = {
    type: proof.type,
    cryptosuite: proof.cryptosuite,
    created: proof.created,
    verificationMethod: proof.verificationMethod,
    proofPurpose: proof.proofPurpose ?? "assertionMethod",
  };
  const configHash = crypto.createHash("sha256").update(canonicalizeJson(proofConfig), "utf8").digest();
  const signingData = Buffer.concat([configHash, docHash]);

  try {
    const signatureBytes = decodeMultibase(proof.proofValue);
    const verified = crypto.verify(null, signingData, pubKeyObj, signatureBytes);
    if (!verified) {
      return { valid: false, error: "Ed25519 signature verification failed." };
    }
    return {
      valid: true,
      payloadSha256,
      publicKeyMultibase: resolvedMultibase,
      verificationMethod: proof.verificationMethod,
    };
  } catch (err) {
    return { valid: false, error: `Malformed signature: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parses a parameter scale label (e.g. "0.5B", "1.5B", "500M", "0.5B-1.5B", "7B") into billions.
 */
function parseParameterScaleBillions(raw: string): number | null {
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  // Handle ranges like "0.5B-1.5B" by taking the upper bound
  const parts = s
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  const target = parts[parts.length - 1] ?? s;
  const match = target.match(/^(\d+(?:\.\d+)?)\s*([BMK]?)$/);
  if (!match) return null;
  const val = Number(match[1]);
  if (!Number.isFinite(val)) return null;
  const unit = match[2];
  if (unit === "M") return val / 1000;
  if (unit === "K") return val / 1_000_000;
  return val;
}

function matchesParameterScaleTier(entryScale: string, filterRaw: string): boolean {
  const filter = filterRaw.trim();
  if (!filter || filter.toLowerCase() === "all") return true;
  const opMatch = filter.match(/^(<=|>=|<|>)\s*(.+)$/);
  if (opMatch) {
    const op = opMatch[1]!;
    const thresholdB = parseParameterScaleBillions(opMatch[2]!);
    const entryB = parseParameterScaleBillions(entryScale);
    if (thresholdB === null || entryB === null) return false;
    if (op === "<") return entryB < thresholdB;
    if (op === "<=") return entryB <= thresholdB;
    if (op === ">") return entryB > thresholdB;
    if (op === ">=") return entryB >= thresholdB;
  }
  if (entryScale.trim().toLowerCase() === filter.toLowerCase()) return true;
  const filterB = parseParameterScaleBillions(filter);
  const entryB = parseParameterScaleBillions(entryScale);
  return filterB !== null && entryB !== null && Math.abs(entryB - filterB) < 1e-6;
}

export function memoryRouter(database: LibraryDatabase, storageDir: string): Router {
  const router = createRouter();
  const mlStorageDir = path.join(storageDir, "ml-memory");
  const diskann = getOrCreateDiskAnnService(database, mlStorageDir);
  const federated = new FederatedDiskAnnCoordinator(database, diskann);

  // Lazily ensure memory-shard manifest & federated verification attestation tables exist
  database.db.exec(`
    CREATE TABLE IF NOT EXISTS memory_shard_manifests (
      shard_id TEXT PRIMARY KEY,
      recipe_name TEXT NOT NULL,
      recipe_version TEXT NOT NULL DEFAULT '0.1.0',
      dataset_kind TEXT NOT NULL DEFAULT 'memory-shard',
      dialect TEXT NOT NULL DEFAULT 'polyglot',
      origin_node TEXT NOT NULL DEFAULT 'local',
      signer_pubkey TEXT NOT NULL DEFAULT '',
      memory_contract_json TEXT NOT NULL,
      ai_governance_json TEXT NOT NULL,
      example_count INTEGER NOT NULL DEFAULT 0,
      byte_size INTEGER NOT NULL DEFAULT 0,
      tenant_scope TEXT NOT NULL DEFAULT 'public',
      provenance_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_shard_manifests_name ON memory_shard_manifests(recipe_name, recipe_version);

    CREATE TABLE IF NOT EXISTS federated_verification_attestations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_release_id TEXT NOT NULL,
      manifest_cid TEXT NOT NULL,
      verifier_node TEXT NOT NULL,
      verifier_pubkey TEXT NOT NULL,
      gate1 INTEGER NOT NULL DEFAULT 0,
      gate2 INTEGER NOT NULL DEFAULT 0,
      gate3 INTEGER NOT NULL DEFAULT 0,
      gate4 INTEGER NOT NULL DEFAULT 0,
      all_gates_passed INTEGER NOT NULL DEFAULT 0,
      verified_at_iso TEXT NOT NULL,
      proof_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(target_release_id, verifier_node, verifier_pubkey)
    );
    CREATE INDEX IF NOT EXISTS idx_fed_attest_release ON federated_verification_attestations(target_release_id);
    CREATE INDEX IF NOT EXISTS idx_fed_attest_cid ON federated_verification_attestations(manifest_cid);
  `);

  const resolveCallerOrgId = (req: Request): number | null => {
    const rawHeader = req.headers["x-modelscript-org-id"];
    if (typeof rawHeader === "string" && /^\d+$/.test(rawHeader)) {
      return Number(rawHeader);
    }
    return null;
  };

  /**
   * POST /api/v1/memory/query
   * Dual-mode DiskANN retrieval (latent vector q = Normalize(W_q h_t + b_q) or hybrid text+semver pins).
   * Enforces `validateMemoryShardCompatibility` whenever registered `memory-shard` manifests carry a
   * `memoryContract` or the request supplies `embedderId`, `embedderHash`, or `memoryPins`.
   */
  router.post("/query", optionalAuth, async (req: Request, res: Response) => {
    try {
      const body = req.body as Partial<MemoryQueryRequest>;
      const mode = body.mode === "latent" ? "latent" : "hybrid";
      if (mode === "latent" && (!Array.isArray(body.latentVector) || body.latentVector.length === 0)) {
        return res.status(400).json({ error: "latentVector array is required when mode === 'latent'." });
      }
      if (mode === "hybrid" && (typeof body.textQuery !== "string" || !body.textQuery.trim())) {
        return res.status(400).json({ error: "textQuery string is required when mode === 'hybrid'." });
      }

      const hasContractParams = Boolean(
        body.embedderId || body.embedderHash || (Array.isArray(body.memoryPins) && body.memoryPins.length > 0),
      );

      const registeredShards = database.db
        .prepare(`SELECT * FROM memory_shard_manifests ORDER BY created_at DESC`)
        .all() as MemoryShardManifestDbRow[];

      const shardsWithContracts = registeredShards
        .map((row) => ({
          row,
          memoryContract: safeJsonParse<MemoryShardContract | null>(row.memory_contract_json, null),
          aiGovernance: safeJsonParse<AiGovernancePolicy>(row.ai_governance_json, {
            allowRag: true,
            allowPretrain: false,
            allowPosttrain: false,
            tenantScope: row.tenant_scope,
          }),
        }))
        .filter(
          (
            entry,
          ): entry is {
            row: MemoryShardManifestDbRow;
            memoryContract: MemoryShardContract;
            aiGovernance: AiGovernancePolicy;
          } => Boolean(entry.memoryContract && typeof entry.memoryContract.embedderId === "string"),
        );

      const compatibleShards: {
        shardId: string;
        packageName: string;
        version: string;
        originNode: string;
        embedderId: string;
      }[] = [];
      const incompatibleShards: {
        shardId: string;
        packageName: string;
        version: string;
        originNode: string;
        signerPubkey: string;
        reasons: string[];
      }[] = [];

      const shouldEnforceCompatibility = hasContractParams || (shardsWithContracts.length > 0 && mode === "latent");

      if (shouldEnforceCompatibility) {
        if (shardsWithContracts.length === 0 && Array.isArray(body.memoryPins) && body.memoryPins.length > 0) {
          return res.status(400).json({
            error: "No registered memory shard matches the requested memoryPins.",
            reasons: ["No registered memory-shard manifests are available to satisfy memoryPins."],
            incompatibleShards: [],
          });
        }

        for (const entry of shardsWithContracts) {
          const check = validateMemoryShardCompatibility(
            {
              mode,
              embedderId: body.embedderId,
              embedderHash: body.embedderHash,
              latentVector: body.latentVector,
              memoryPins: body.memoryPins,
            },
            {
              originNode: entry.row.origin_node,
              packageName: entry.row.recipe_name,
              signerPubkey: entry.row.signer_pubkey,
              aiGovernance: entry.aiGovernance,
              memoryContract: entry.memoryContract,
            },
          );
          if (check.compatible) {
            compatibleShards.push({
              shardId: entry.row.shard_id,
              packageName: entry.row.recipe_name,
              version: entry.row.recipe_version,
              originNode: entry.row.origin_node,
              embedderId: entry.memoryContract.embedderId,
            });
          } else {
            incompatibleShards.push({
              shardId: entry.row.shard_id,
              packageName: entry.row.recipe_name,
              version: entry.row.recipe_version,
              originNode: entry.row.origin_node,
              signerPubkey: entry.row.signer_pubkey,
              reasons: check.reasons,
            });
          }
        }

        if (shardsWithContracts.length > 0 && compatibleShards.length === 0) {
          const allReasons = incompatibleShards.flatMap((s) => s.reasons);
          return res.status(400).json({
            error: "Memory query is incompatible with all registered memory shards.",
            reasons: allReasons,
            incompatibleShards,
          });
        }
      }

      const response = await diskann.queryAsync(
        {
          mode,
          latentVector: body.latentVector,
          embedderId: body.embedderId,
          embedderHash: body.embedderHash,
          textQuery: body.textQuery,
          packagePins: body.packagePins,
          memoryPins: body.memoryPins,
          dialects: body.dialects,
          includeSocialPosts: body.includeSocialPosts,
          topK: body.topK,
          tenantScope: body.tenantScope,
        },
        {
          userId: req.user?.id,
          orgId: resolveCallerOrgId(req),
        },
      );

      // Filter out chunks belonging exclusively to incompatible memory shards
      let filteredChunks = response.chunks;
      if (incompatibleShards.length > 0) {
        const compatiblePkgNames = new Set(compatibleShards.map((s) => s.packageName));
        const blockedPkgNames = new Set(
          incompatibleShards.map((s) => s.packageName).filter((name) => !compatiblePkgNames.has(name)),
        );
        if (blockedPkgNames.size > 0) {
          filteredChunks = response.chunks.filter(
            (chunk) => !chunk.packageName || !blockedPkgNames.has(chunk.packageName),
          );
        }
      }

      return res.json({
        ...response,
        ...(body.embedderId ? { embedderId: body.embedderId } : {}),
        chunks: filteredChunks,
        ...(shouldEnforceCompatibility && shardsWithContracts.length > 0
          ? {
              shardCompatibility: {
                compatibleShards,
                incompatibleShards,
              },
            }
          : {}),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to query DiskANN memory") });
    }
  });

  /**
   * POST /api/v1/memory/index/git-diff
   * Incrementally indexes added/modified files and removes deleted files from DiskANN.
   */
  router.post("/index/git-diff", requireAuth, (req: Request, res: Response) => {
    try {
      const body = req.body as {
        packageName?: string | undefined;
        packageVersion?: string | undefined;
        gitSha?: string | undefined;
        tenantScope?: TenantScope | undefined;
        orgId?: number | null | undefined;
        formalVerified?: boolean | undefined;
        aiGovernance?: AiGovernancePolicy | undefined;
        changes?: GitDiffFileChange[] | undefined;
      };

      if (body.aiGovernance?.allowRag === false) {
        return res.json({
          skipped: true,
          reason: "aiGovernance.allowRag is false",
          indexedChunks: 0,
          deletedChunks: 0,
        });
      }
      if (!Array.isArray(body.changes) || body.changes.length === 0) {
        return res.status(400).json({ error: "changes array is required." });
      }

      const result = diskann.indexGitDiff({
        packageName: body.packageName,
        packageVersion: body.packageVersion,
        gitSha: body.gitSha,
        tenantScope: body.tenantScope ?? body.aiGovernance?.tenantScope ?? "public",
        orgId: body.orgId ?? resolveCallerOrgId(req),
        formalVerified: body.formalVerified ?? false,
        changes: body.changes,
      });
      return res.json({ success: true, backend: "diskann", ...result });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to index git diff into DiskANN") });
    }
  });

  /**
   * POST /api/v1/memory/index/social
   * Indexes verified social posts, engineering threads, or RLHF Fix-It solutions into DiskANN.
   */
  router.post("/index/social", requireAuth, (req: Request, res: Response) => {
    try {
      const body = req.body as {
        sourceKind?: "social-post" | "rlhf-verified-fix" | undefined;
        sourceUri?: string | undefined;
        dialect?: string | undefined;
        content?: string | undefined;
        symbolTags?: string[] | undefined;
        formalVerified?: boolean | undefined;
        tenantScope?: TenantScope | undefined;
        orgId?: number | null | undefined;
        embedding?: number[] | undefined;
      };

      if (typeof body.content !== "string" || !body.content.trim()) {
        return res.status(400).json({ error: "content is required." });
      }
      const sourceKind: MemorySourceKind =
        body.sourceKind === "rlhf-verified-fix" ? "rlhf-verified-fix" : "social-post";
      const sourceUri =
        typeof body.sourceUri === "string" && body.sourceUri.trim()
          ? body.sourceUri.trim()
          : `social://post/${Date.now()}`;

      const chunkId = diskann.upsertChunk({
        sourceKind,
        sourceUri,
        dialect: body.dialect ?? "markdown",
        content: body.content,
        symbolTags: body.symbolTags,
        formalVerified: body.formalVerified ?? sourceKind === "rlhf-verified-fix",
        tenantScope: body.tenantScope ?? "public",
        orgId: body.orgId ?? resolveCallerOrgId(req),
        embedding: body.embedding,
      });

      return res.status(201).json({ success: true, backend: "diskann", chunkId, sourceUri });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to index social content into DiskANN") });
    }
  });

  /**
   * POST /api/v1/memory/datasets/compile
   * Compiles raw files into deterministic, m_init-bucketed 4-column dataset shards,
   * or registers a `memory-shard` manifest with its `MemoryShardContract` and indexes its files into DiskANN.
   */
  router.post("/datasets/compile", requireAuth, (req: Request, res: Response) => {
    try {
      const body = req.body as {
        recipeName?: string | undefined;
        recipeVersion?: string | undefined;
        datasetKind?: ExtendedDatasetKind | undefined;
        files?: RawDatasetFileInput[] | undefined;
        aiGovernance?: AiGovernancePolicy | undefined;
        requireFormalPass?: boolean | undefined;
        examplesPerShard?: number | undefined;
        mCap?: number | undefined;
        sourceLockfile?: Record<string, string> | undefined;
        /** Memory-shard specific contract & provenance fields */
        memoryContract?: MemoryShardContract | undefined;
        originNode?: string | undefined;
        signerPubkey?: string | undefined;
        /** Training-recipe leaderboard & domain benchmark metadata */
        domain?: string | undefined;
        parameterScale?: string | undefined;
        targetModel?: { baseModel?: string; parameterScale?: string; mode?: string } | undefined;
        benchmarkMetrics?:
          | {
              passAt1?: number | undefined;
              gate1To4PassRate?: number | undefined;
              memoryHitRate?: number | undefined;
              medianLatencyMs?: number | undefined;
              evaluationSuite?: string | undefined;
            }
          | undefined;
        passAt1?: number | undefined;
        gate1To4PassRate?: number | undefined;
        releaseId?: string | undefined;
      };

      if (typeof body.recipeName !== "string" || !body.recipeName.trim()) {
        return res.status(400).json({ error: "recipeName is required." });
      }
      const recipeName = body.recipeName.trim();
      const recipeVersion = (typeof body.recipeVersion === "string" && body.recipeVersion.trim()) || "0.1.0";
      const datasetKind: ExtendedDatasetKind = body.datasetKind ?? "training-recipe";

      if (datasetKind === "memory-shard") {
        const governance: AiGovernancePolicy = body.aiGovernance ?? {
          allowRag: true,
          allowPretrain: false,
          allowPosttrain: false,
          tenantScope: "public",
        };
        if (!governance.allowRag) {
          return res
            .status(403)
            .json({ error: `Governance policy blocks memory-shard registration for '${recipeName}'.` });
        }

        const memoryContract: MemoryShardContract = body.memoryContract ?? {
          embedderId: "ansatz-embed-v1",
          embedderHash: "sha256:deterministic-256",
          dimension: 256,
          quantization: "int8-diskann",
          sourcePackages: [],
        };
        if (
          typeof memoryContract.embedderId !== "string" ||
          !memoryContract.embedderId.trim() ||
          typeof memoryContract.embedderHash !== "string" ||
          !memoryContract.embedderHash.trim() ||
          typeof memoryContract.dimension !== "number" ||
          memoryContract.dimension <= 0
        ) {
          return res.status(400).json({
            error: "memoryContract must include non-empty embedderId, embedderHash, and positive dimension.",
          });
        }

        const originNode =
          (typeof body.originNode === "string" && body.originNode.trim()) || federated.getLocalInstanceId();
        const signerPubkey =
          (typeof body.signerPubkey === "string" && body.signerPubkey.trim()) ||
          getDefaultDatasetSigningKeyPair().publicKeyMultibase;
        const files = Array.isArray(body.files) ? body.files : [];

        let indexedChunks = 0;
        let totalBytes = 0;
        if (files.length > 0) {
          const diffRes = diskann.indexGitDiff({
            packageName: recipeName,
            packageVersion: recipeVersion,
            tenantScope: governance.tenantScope,
            orgId: resolveCallerOrgId(req),
            formalVerified: true,
            changes: files.map((f) => {
              totalBytes += Buffer.byteLength(f.source ?? "", "utf8");
              return {
                path: f.uri,
                status: "M" as const,
                content: f.source,
                dialect: f.dialect,
              };
            }),
          });
          indexedChunks = diffRes.indexedChunks;
        }

        const uniqueDialects = Array.from(new Set(files.map((f) => f.dialect).filter(Boolean)));
        const dialect = uniqueDialects.length === 1 ? uniqueDialects[0]! : body.domain?.trim() || "polyglot";
        const shardId = crypto
          .createHash("sha256")
          .update(
            canonicalizeJson({
              datasetKind: "memory-shard",
              recipeName,
              recipeVersion,
              originNode,
              signerPubkey,
              memoryContract,
              fileUris: files.map((f) => f.uri).sort(),
            }),
            "utf8",
          )
          .digest("hex");

        const provenance = {
          compilerVersion: "modelscript-memory-shard-v1",
          memoryBackend: "diskann",
          releaseId: body.releaseId ?? `${recipeName}@${recipeVersion}`,
          originNode,
          signerPubkey,
          memoryContract,
          sourceLockfile: body.sourceLockfile ?? {},
          aiGovernance: governance,
          independentReproductions: 0,
        };

        database.db
          .prepare(
            `
            INSERT INTO memory_shard_manifests (
              shard_id, recipe_name, recipe_version, dataset_kind, dialect,
              origin_node, signer_pubkey, memory_contract_json, ai_governance_json,
              example_count, byte_size, tenant_scope, provenance_json
            ) VALUES (?, ?, ?, 'memory-shard', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(shard_id) DO UPDATE SET
              origin_node = excluded.origin_node,
              signer_pubkey = excluded.signer_pubkey,
              memory_contract_json = excluded.memory_contract_json,
              ai_governance_json = excluded.ai_governance_json,
              example_count = excluded.example_count,
              byte_size = excluded.byte_size,
              provenance_json = excluded.provenance_json
          `,
          )
          .run(
            shardId,
            recipeName,
            recipeVersion,
            dialect,
            originNode,
            signerPubkey,
            JSON.stringify(memoryContract),
            JSON.stringify(governance),
            files.length,
            totalBytes,
            governance.tenantScope,
            JSON.stringify(provenance),
          );

        return res.status(201).json({
          recipeName,
          recipeVersion,
          datasetKind: "memory-shard",
          shardId,
          originNode,
          signerPubkey,
          memoryContract,
          indexedChunks,
          totalInputFiles: files.length,
          shards: [
            {
              shardId,
              recipeName,
              recipeVersion,
              datasetKind: "memory-shard",
              dialect,
              originNode,
              signerPubkey,
              memoryContract,
              exampleCount: files.length,
              byteSize: totalBytes,
              provenance,
            },
          ],
        });
      }

      if (!Array.isArray(body.files) || body.files.length === 0) {
        return res.status(400).json({ error: "files array is required." });
      }

      const result = compileDatasetShards(database, mlStorageDir, {
        recipeName,
        recipeVersion,
        datasetKind,
        files: body.files,
        aiGovernance: body.aiGovernance,
        requireFormalPass: body.requireFormalPass,
        examplesPerShard: body.examplesPerShard,
        mCap: body.mCap,
        sourceLockfile: body.sourceLockfile,
        applyOverlayPatches: (body as { applyOverlayPatches?: boolean | undefined }).applyOverlayPatches,
      });

      // Enrich compiled shard provenance with domain, parameterScale, and benchmarkMetrics for leaderboards
      const passAt1 =
        typeof body.benchmarkMetrics?.passAt1 === "number"
          ? body.benchmarkMetrics.passAt1
          : typeof body.passAt1 === "number"
            ? body.passAt1
            : undefined;
      const gate1To4PassRate =
        typeof body.benchmarkMetrics?.gate1To4PassRate === "number"
          ? body.benchmarkMetrics.gate1To4PassRate
          : typeof body.gate1To4PassRate === "number"
            ? body.gate1To4PassRate
            : result.totalInputFiles > 0
              ? Number((result.verifiedExamples / result.totalInputFiles).toFixed(6))
              : 1;
      const resolvedScale = body.parameterScale ?? body.targetModel?.parameterScale ?? "1.5B";
      const resolvedReleaseId = body.releaseId ?? `${recipeName}@${recipeVersion}`;

      const updateProvStmt = database.db.prepare(
        `UPDATE compiled_dataset_shards SET provenance_json = ? WHERE shard_id = ?`,
      );
      for (const shard of result.shards) {
        const enriched = {
          ...shard.provenance,
          releaseId: resolvedReleaseId,
          ...(body.domain ? { domain: body.domain.trim().toLowerCase() } : {}),
          parameterScale: resolvedScale,
          ...(body.targetModel ? { targetModel: body.targetModel } : {}),
          benchmarkMetrics: {
            ...(body.benchmarkMetrics ?? {}),
            ...(passAt1 !== undefined ? { passAt1 } : {}),
            gate1To4PassRate,
          },
          verifiedExamples: result.verifiedExamples,
          totalInputFiles: result.totalInputFiles,
          independentReproductions: 0,
        };
        shard.provenance = enriched;
        updateProvStmt.run(JSON.stringify(enriched), shard.shardId);
      }

      return res.status(201).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Governance policy blocks")) {
        return res.status(403).json({ error: msg });
      }
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to compile dataset shards") });
    }
  });

  /**
   * GET /api/v1/memory/datasets/shards
   */
  router.get("/datasets/shards", optionalAuth, (req: Request, res: Response) => {
    try {
      const recipeName = typeof req.query["recipeName"] === "string" ? req.query["recipeName"].trim() : undefined;
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const datasetKind = typeof req.query["datasetKind"] === "string" ? req.query["datasetKind"].trim() : undefined;

      const callerOrgId = resolveCallerOrgId(req);
      const canAccessPrivateScope = Boolean(
        req.user &&
        (req.user.role === "admin" ||
          req.user.accountType === "admin" ||
          req.user.account_type === "admin" ||
          (callerOrgId !== null && Boolean(database.getOrgMemberRole(callerOrgId, req.user.id)))),
      );
      const includePrivate = canAccessPrivateScope && req.query["includePrivate"] === "true";

      const where: string[] = includePrivate ? [] : ["tenant_scope = 'public'"];
      const params: unknown[] = [];
      if (recipeName) {
        where.push("recipe_name = ?");
        params.push(recipeName);
      }
      if (dialect) {
        where.push("dialect = ?");
        params.push(dialect);
      }
      if (datasetKind && datasetKind !== "memory-shard") {
        where.push("dataset_kind = ?");
        params.push(datasetKind);
      }
      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

      const datasetShards =
        datasetKind === "memory-shard"
          ? []
          : (
              database.db
                .prepare(`SELECT * FROM compiled_dataset_shards ${whereClause} ORDER BY m_min ASC, created_at DESC`)
                .all(...params) as ShardDbRow[]
            ).map((r) => ({
              shardId: r.shard_id,
              recipeName: r.recipe_name,
              recipeVersion: r.recipe_version,
              datasetKind: r.dataset_kind,
              dialect: r.dialect,
              mMin: r.m_min,
              mMax: r.m_max,
              exampleCount: r.example_count,
              byteSize: r.byte_size,
              tenantScope: r.tenant_scope,
              provenance: safeJsonParse<Record<string, unknown>>(r.provenance_json, {}),
              downloadUrl: `/api/v1/memory/datasets/shards/${r.shard_id}`,
              createdAt: r.created_at,
            }));

      const memWhere: string[] = includePrivate ? [] : ["tenant_scope = 'public'"];
      const memParams: unknown[] = [];
      if (recipeName) {
        memWhere.push("recipe_name = ?");
        memParams.push(recipeName);
      }
      if (dialect) {
        memWhere.push("dialect = ?");
        memParams.push(dialect);
      }
      const memWhereClause = memWhere.length > 0 ? `WHERE ${memWhere.join(" AND ")}` : "";

      const memoryShards =
        datasetKind && datasetKind !== "memory-shard"
          ? []
          : (
              database.db
                .prepare(`SELECT * FROM memory_shard_manifests ${memWhereClause} ORDER BY created_at DESC`)
                .all(...memParams) as MemoryShardManifestDbRow[]
            ).map((r) => ({
              shardId: r.shard_id,
              recipeName: r.recipe_name,
              recipeVersion: r.recipe_version,
              datasetKind: r.dataset_kind,
              dialect: r.dialect,
              mMin: 0,
              mMax: 0,
              exampleCount: r.example_count,
              byteSize: r.byte_size,
              tenantScope: r.tenant_scope,
              originNode: r.origin_node,
              signerPubkey: r.signer_pubkey,
              memoryContract: safeJsonParse<MemoryShardContract | null>(r.memory_contract_json, null),
              provenance: safeJsonParse<Record<string, unknown>>(r.provenance_json, {}),
              downloadUrl: `/api/v1/memory/datasets/shards/${r.shard_id}`,
              createdAt: r.created_at,
            }));

      const shards = [...datasetShards, ...memoryShards];
      return res.json({ shards, total: shards.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list dataset shards") });
    }
  });

  /**
   * GET /api/v1/memory/datasets/shards/:shardId
   * Streams compiled shard with HTTP `Range` support (206 Partial Content) for Browser OPFS DataLoaders.
   */
  router.get("/datasets/shards/:shardId", optionalAuth, (req: Request, res: Response) => {
    try {
      const shardId = String(req.params["shardId"] ?? "").trim();
      if (!/^[a-f0-9]{16,64}$/i.test(shardId)) {
        return res.status(400).json({ error: "Invalid shardId format." });
      }

      const row = database.db.prepare(`SELECT * FROM compiled_dataset_shards WHERE shard_id = ?`).get(shardId) as
        ShardDbRow | undefined;
      if (!row) {
        return res.status(404).json({ error: "Dataset shard not found." });
      }
      if (row.tenant_scope !== "public") {
        const callerOrgId = resolveCallerOrgId(req);
        const authorized = Boolean(
          req.user &&
          (req.user.role === "admin" ||
            req.user.accountType === "admin" ||
            req.user.account_type === "admin" ||
            (callerOrgId !== null && Boolean(database.getOrgMemberRole(callerOrgId, req.user.id)))),
        );
        if (!authorized) {
          return res.status(404).json({ error: "Dataset shard not found." });
        }
      }

      const absPath = path.resolve(mlStorageDir, row.storage_path);
      if (!absPath.startsWith(path.resolve(mlStorageDir)) || !fs.existsSync(absPath)) {
        return res.status(404).json({ error: "Dataset shard file missing on storage." });
      }

      const stat = fs.statSync(absPath);
      const total = stat.size;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("ETag", `"${shardId}"`);

      const rangeHeader = req.headers.range;
      if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
        const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
        const start = startStr ? Number(startStr) : 0;
        const end = endStr ? Math.min(total - 1, Number(endStr)) : total - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          res.setHeader("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        const chunkLen = end - start + 1;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", String(chunkLen));
        const fd = fs.openSync(absPath, "r");
        try {
          const buf = Buffer.allocUnsafe(chunkLen);
          fs.readSync(fd, buf, 0, chunkLen, start);
          return res.send(buf);
        } finally {
          fs.closeSync(fd);
        }
      }

      res.setHeader("Content-Length", String(total));
      return res.send(fs.readFileSync(absPath));
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to stream dataset shard") });
    }
  });

  /**
   * GET /api/v1/memory/stats
   */
  router.get("/stats", optionalAuth, (_req: Request, res: Response) => {
    try {
      return res.json(diskann.getStats());
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to fetch DiskANN stats") });
    }
  });

  /**
   * POST /api/v1/memory/federated/query
   * Federated public-only DiskANN fan-out query across local memory and trusted peer Ansatz nodes.
   * Strictly enforces `tenantScope: "public"` and never forwards private org scope or credentials.
   */
  router.post("/federated/query", optionalAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Partial<FederatedMemoryQueryRequest>;
      const mode = body.mode === "latent" ? "latent" : "hybrid";
      if (mode === "latent" && (!Array.isArray(body.latentVector) || body.latentVector.length === 0)) {
        return res.status(400).json({ error: "latentVector array is required when mode === 'latent'." });
      }
      if (mode === "hybrid" && (typeof body.textQuery !== "string" || !body.textQuery.trim())) {
        return res.status(400).json({ error: "textQuery string is required when mode === 'hybrid'." });
      }

      const response = await federated.queryFederated({
        mode,
        latentVector: body.latentVector,
        embedderId: body.embedderId,
        embedderHash: body.embedderHash,
        textQuery: body.textQuery,
        packagePins: body.packagePins,
        dialects: body.dialects,
        includeSocialPosts: body.includeSocialPosts,
        topK: body.topK,
        tenantScope: "public",
        peerUrls: Array.isArray(body.peerUrls) ? body.peerUrls.map(String) : undefined,
        peerTimeoutMs: typeof body.peerTimeoutMs === "number" ? body.peerTimeoutMs : undefined,
      });
      return res.json(response);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to execute federated DiskANN query") });
    }
  });

  /**
   * GET /api/v1/memory/federated/peers
   * Lists trusted federated DiskANN peer Ansatz nodes.
   */
  router.get("/federated/peers", optionalAuth, (_req: Request, res: Response) => {
    try {
      const peers = federated.listPeers(true);
      return res.json({
        localInstance: federated.getLocalInstanceId(),
        peers,
        total: peers.length,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list federated memory peers") });
    }
  });

  /**
   * POST /api/v1/memory/federated/peers
   * Registers or updates a trusted peer Ansatz node URL for federated DiskANN fan-out.
   */
  router.post("/federated/peers", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        peerUrl?: unknown;
        label?: unknown;
        publicKeyMultibase?: unknown;
        enabled?: unknown;
      };
      if (typeof body.peerUrl !== "string" || !body.peerUrl.trim()) {
        return res.status(400).json({ error: "peerUrl string is required." });
      }

      const peer = federated.addPeer({
        peerUrl: body.peerUrl,
        label: typeof body.label === "string" ? body.label : undefined,
        publicKeyMultibase: typeof body.publicKeyMultibase === "string" ? body.publicKeyMultibase : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      });
      return res.status(201).json({ success: true, peer });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("peerUrl") ||
        msg.includes("Invalid") ||
        msg.includes("Forbidden") ||
        msg.includes("Unsupported") ||
        msg.includes("Air-Gap")
      ) {
        return res.status(400).json({ error: msg });
      }
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to register federated memory peer") });
    }
  });

  /**
   * POST /api/v1/memory/federated/sign-manifest
   * Cryptographically signs a `dataset-pretrain`, `dataset-posttrain`, `training-recipe`,
   * or `memory-shard` manifest using Ed25519 (`eddsa-jcs-2022`).
   */
  router.post("/federated/sign-manifest", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        manifest?: (Omit<DatasetManifestPayload, "datasetKind"> & { datasetKind: ExtendedDatasetKind }) | undefined;
        privateKeyPem?: string | undefined;
        verificationMethod?: string | undefined;
        created?: string | undefined;
      };
      if (!body.manifest || typeof body.manifest !== "object") {
        return res.status(400).json({ error: "manifest object is required." });
      }

      if (body.manifest.datasetKind === "memory-shard") {
        if (typeof body.manifest["recipeName"] !== "string" || !body.manifest["recipeName"].trim()) {
          return res.status(400).json({ error: "Manifest recipeName is required." });
        }
        if (typeof body.manifest["recipeVersion"] !== "string" || !body.manifest["recipeVersion"].trim()) {
          return res.status(400).json({ error: "Manifest recipeVersion is required." });
        }
        const signed = signGenericPayloadEd25519(body.manifest as Record<string, unknown>, {
          privateKeyPem: typeof body.privateKeyPem === "string" ? body.privateKeyPem : undefined,
          verificationMethod: typeof body.verificationMethod === "string" ? body.verificationMethod : undefined,
          created: typeof body.created === "string" ? body.created : undefined,
        });
        return res.status(200).json({ manifest: signed.payload, proof: signed.proof });
      }

      const signed = signDatasetManifestEd25519(body.manifest as DatasetManifestPayload, {
        privateKeyPem: typeof body.privateKeyPem === "string" ? body.privateKeyPem : undefined,
        verificationMethod: typeof body.verificationMethod === "string" ? body.verificationMethod : undefined,
        created: typeof body.created === "string" ? body.created : undefined,
      });
      return res.status(200).json(signed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Invalid datasetKind") || msg.includes("required") || msg.includes("Unsupported signing key")) {
        return res.status(400).json({ error: msg });
      }
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to sign dataset manifest") });
    }
  });

  /**
   * POST /api/v1/memory/federated/verify-manifest
   * Verifies an Ed25519 (`eddsa-jcs-2022`) signed dataset or `memory-shard` manifest.
   */
  router.post("/federated/verify-manifest", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        manifest?: (Omit<DatasetManifestPayload, "datasetKind"> & { datasetKind: ExtendedDatasetKind }) | undefined;
        proof?: Partial<DatasetManifestProof> | undefined;
        expectedPublicKeyPem?: string | undefined;
        expectedPublicKeyMultibase?: string | undefined;
        trustedPublicKeys?: string[] | undefined;
      };
      if (!body.manifest || typeof body.manifest !== "object" || !body.proof || typeof body.proof !== "object") {
        return res.status(400).json({ error: "manifest and proof objects are required." });
      }

      const verifyOpts = {
        expectedPublicKeyPem: typeof body.expectedPublicKeyPem === "string" ? body.expectedPublicKeyPem : undefined,
        expectedPublicKeyMultibase:
          typeof body.expectedPublicKeyMultibase === "string" ? body.expectedPublicKeyMultibase : undefined,
        trustedPublicKeys: Array.isArray(body.trustedPublicKeys)
          ? body.trustedPublicKeys.filter((k): k is string => typeof k === "string")
          : undefined,
      };

      if (body.manifest.datasetKind === "memory-shard") {
        const verification = verifyGenericPayloadEd25519(
          body.manifest as Record<string, unknown>,
          body.proof,
          verifyOpts,
        );
        return res.status(200).json({
          ...verification,
          datasetKind: "memory-shard",
        });
      }

      const verification = verifyDatasetManifestEd25519(
        { manifest: body.manifest as DatasetManifestPayload, proof: body.proof },
        verifyOpts,
      );
      return res.status(200).json(verification);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to verify dataset manifest") });
    }
  });

  /**
   * POST /api/v1/memory/federated/attest
   * Records a signed `FederatedVerificationAttestation` from an independent peer node and
   * increments `independentReproductions` for the target release / manifest.
   */
  router.post("/federated/attest", requireAuth, (req: Request, res: Response) => {
    try {
      const rawBody = (req.body ?? {}) as {
        attestation?: Partial<FederatedVerificationAttestation> | undefined;
        proof?: Partial<DatasetManifestProof> | undefined;
      } & Partial<FederatedVerificationAttestation>;

      const rawAttest = rawBody.attestation && typeof rawBody.attestation === "object" ? rawBody.attestation : rawBody;
      const attestType = rawAttest.type ?? "ansatz:VerificationAttestation";
      if (attestType !== "ansatz:VerificationAttestation") {
        return res.status(400).json({ error: "attestation.type must be 'ansatz:VerificationAttestation'." });
      }

      const targetReleaseId = typeof rawAttest.targetReleaseId === "string" ? rawAttest.targetReleaseId.trim() : "";
      const manifestCid = typeof rawAttest.manifestCid === "string" ? rawAttest.manifestCid.trim() : "";
      const verifierNode = typeof rawAttest.verifierNode === "string" ? rawAttest.verifierNode.trim() : "";
      const verifierPubkey = typeof rawAttest.verifierPubkey === "string" ? rawAttest.verifierPubkey.trim() : "";
      const passedGates = rawAttest.passedGates;

      if (!targetReleaseId || !manifestCid || !verifierNode || !verifierPubkey) {
        return res.status(400).json({
          error: "targetReleaseId, manifestCid, verifierNode, and verifierPubkey are required.",
        });
      }
      if (
        !passedGates ||
        typeof passedGates.gate1 !== "boolean" ||
        typeof passedGates.gate2 !== "boolean" ||
        typeof passedGates.gate3 !== "boolean" ||
        typeof passedGates.gate4 !== "boolean"
      ) {
        return res.status(400).json({
          error: "passedGates with boolean gate1, gate2, gate3, and gate4 is required.",
        });
      }

      const attestation: FederatedVerificationAttestation = {
        type: "ansatz:VerificationAttestation",
        targetReleaseId,
        manifestCid,
        verifierNode,
        verifierPubkey,
        passedGates: {
          gate1: passedGates.gate1,
          gate2: passedGates.gate2,
          gate3: passedGates.gate3,
          gate4: passedGates.gate4,
        },
        verifiedAtIso:
          typeof rawAttest.verifiedAtIso === "string" && rawAttest.verifiedAtIso.trim()
            ? rawAttest.verifiedAtIso.trim()
            : new Date().toISOString(),
      };

      // If an Ed25519 proof accompanies the attestation, cryptographically verify it
      if (rawBody.proof && typeof rawBody.proof === "object") {
        const proofCheck = verifyGenericPayloadEd25519(
          attestation as unknown as Record<string, unknown>,
          rawBody.proof,
          { expectedPublicKeyMultibase: verifierPubkey },
        );
        if (!proofCheck.valid) {
          return res.status(400).json({
            error: proofCheck.error ?? "Invalid Ed25519 attestation proof.",
          });
        }
      }

      const allGatesPassed =
        attestation.passedGates.gate1 &&
        attestation.passedGates.gate2 &&
        attestation.passedGates.gate3 &&
        attestation.passedGates.gate4;

      database.db
        .prepare(
          `
          INSERT INTO federated_verification_attestations (
            target_release_id, manifest_cid, verifier_node, verifier_pubkey,
            gate1, gate2, gate3, gate4, all_gates_passed, verified_at_iso, proof_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(target_release_id, verifier_node, verifier_pubkey) DO UPDATE SET
            manifest_cid = excluded.manifest_cid,
            gate1 = excluded.gate1,
            gate2 = excluded.gate2,
            gate3 = excluded.gate3,
            gate4 = excluded.gate4,
            all_gates_passed = excluded.all_gates_passed,
            verified_at_iso = excluded.verified_at_iso,
            proof_json = excluded.proof_json
        `,
        )
        .run(
          attestation.targetReleaseId,
          attestation.manifestCid,
          attestation.verifierNode,
          attestation.verifierPubkey,
          attestation.passedGates.gate1 ? 1 : 0,
          attestation.passedGates.gate2 ? 1 : 0,
          attestation.passedGates.gate3 ? 1 : 0,
          attestation.passedGates.gate4 ? 1 : 0,
          allGatesPassed ? 1 : 0,
          attestation.verifiedAtIso,
          rawBody.proof ? JSON.stringify(rawBody.proof) : null,
        );

      const counts = database.db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN all_gates_passed = 1 THEN 1 ELSE 0 END) AS independent_reproductions,
            COUNT(*) AS total_attestations
          FROM federated_verification_attestations
          WHERE target_release_id = ? OR manifest_cid = ?
        `,
        )
        .get(attestation.targetReleaseId, attestation.manifestCid) as AttestationCountRow | undefined;

      const independentReproductions = Number(counts?.independent_reproductions ?? 0);
      const totalAttestations = Number(counts?.total_attestations ?? 0);

      // Propagate updated independentReproductions into matching compiled_dataset_shards & memory_shard_manifests
      const matchingDatasetRows = database.db
        .prepare(
          `
          SELECT shard_id, provenance_json FROM compiled_dataset_shards
          WHERE shard_id = ? OR (recipe_name || '@' || recipe_version) = ?
        `,
        )
        .all(attestation.manifestCid, attestation.targetReleaseId) as {
        shard_id: string;
        provenance_json: string;
      }[];
      const updateDatasetProv = database.db.prepare(
        `UPDATE compiled_dataset_shards SET provenance_json = ? WHERE shard_id = ?`,
      );
      for (const row of matchingDatasetRows) {
        const prov = safeJsonParse<Record<string, unknown>>(row.provenance_json, {});
        prov["independentReproductions"] = independentReproductions;
        updateDatasetProv.run(JSON.stringify(prov), row.shard_id);
      }

      const matchingMemoryRows = database.db
        .prepare(
          `
          SELECT shard_id, provenance_json FROM memory_shard_manifests
          WHERE shard_id = ? OR (recipe_name || '@' || recipe_version) = ?
        `,
        )
        .all(attestation.manifestCid, attestation.targetReleaseId) as {
        shard_id: string;
        provenance_json: string;
      }[];
      const updateMemoryProv = database.db.prepare(
        `UPDATE memory_shard_manifests SET provenance_json = ? WHERE shard_id = ?`,
      );
      for (const row of matchingMemoryRows) {
        const prov = safeJsonParse<Record<string, unknown>>(row.provenance_json, {});
        prov["independentReproductions"] = independentReproductions;
        updateMemoryProv.run(JSON.stringify(prov), row.shard_id);
      }

      return res.status(201).json({
        success: true,
        attestation,
        allGatesPassed,
        independentReproductions,
        totalAttestations,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to record federated attestation") });
    }
  });

  /**
   * GET /api/v1/memory/leaderboards
   * Returns verified `training-recipe` entries ranked by `Pass@1 * Gate1To4PassRate`,
   * filterable by `domain` and `parameterScale` tier (e.g., `<1.5B`, `<=1.5B`, `<3B`, `<10B`).
   */
  router.get("/leaderboards", optionalAuth, (req: Request, res: Response) => {
    try {
      const domainFilter =
        typeof req.query["domain"] === "string" && req.query["domain"].trim()
          ? req.query["domain"].trim().toLowerCase()
          : undefined;
      const scaleFilter =
        typeof req.query["parameterScale"] === "string" && req.query["parameterScale"].trim()
          ? req.query["parameterScale"].trim()
          : undefined;

      const rows = database.db
        .prepare(
          `
          SELECT * FROM compiled_dataset_shards
          WHERE dataset_kind = 'training-recipe' AND tenant_scope = 'public'
          ORDER BY created_at DESC
        `,
        )
        .all() as ShardDbRow[];

      const countAttestStmt = database.db.prepare(`
        SELECT COUNT(*) AS cnt FROM federated_verification_attestations
        WHERE all_gates_passed = 1 AND (target_release_id = ? OR manifest_cid = ?)
      `);

      // Aggregate shards by (recipe_name, recipe_version)
      const grouped = new Map<
        string,
        {
          recipeName: string;
          recipeVersion: string;
          releaseId: string;
          domain: string;
          dialects: Set<string>;
          parameterScale: string;
          passAt1: number;
          gate1To4PassRate: number;
          independentReproductions: number;
          shardIds: string[];
          totalExamples: number;
          createdAt: string;
        }
      >();

      for (const row of rows) {
        const key = `${row.recipe_name}@${row.recipe_version}`;
        const prov = safeJsonParse<Record<string, unknown>>(row.provenance_json, {});
        const metrics = (prov["benchmarkMetrics"] as Record<string, unknown> | undefined) ?? {};
        const targetModel = (prov["targetModel"] as Record<string, unknown> | undefined) ?? {};

        const releaseId = typeof prov["releaseId"] === "string" ? prov["releaseId"] : key;
        const domain =
          typeof prov["domain"] === "string" && prov["domain"].trim()
            ? prov["domain"].trim().toLowerCase()
            : row.dialect.toLowerCase();
        const parameterScale =
          typeof prov["parameterScale"] === "string"
            ? prov["parameterScale"]
            : typeof targetModel["parameterScale"] === "string"
              ? targetModel["parameterScale"]
              : typeof prov["targetModelScale"] === "string"
                ? prov["targetModelScale"]
                : "1.5B";

        const passAt1 =
          typeof metrics["passAt1"] === "number"
            ? metrics["passAt1"]
            : typeof prov["passAt1"] === "number"
              ? prov["passAt1"]
              : 0;
        const gate1To4PassRate =
          typeof metrics["gate1To4PassRate"] === "number"
            ? metrics["gate1To4PassRate"]
            : typeof prov["gate1To4PassRate"] === "number"
              ? prov["gate1To4PassRate"]
              : 1;

        const attestRow = countAttestStmt.get(releaseId, row.shard_id) as { cnt?: number } | undefined;
        const dbAttestCount = Number(attestRow?.cnt ?? 0);
        const provAttestCount =
          typeof prov["independentReproductions"] === "number" ? prov["independentReproductions"] : 0;
        const independentReproductions = Math.max(dbAttestCount, provAttestCount);

        const existing = grouped.get(key);
        if (!existing) {
          const dialects = new Set<string>([row.dialect.toLowerCase()]);
          if (Array.isArray(prov["dialects"])) {
            for (const d of prov["dialects"]) {
              if (typeof d === "string") dialects.add(d.toLowerCase());
            }
          }
          grouped.set(key, {
            recipeName: row.recipe_name,
            recipeVersion: row.recipe_version,
            releaseId,
            domain,
            dialects,
            parameterScale,
            passAt1,
            gate1To4PassRate,
            independentReproductions,
            shardIds: [row.shard_id],
            totalExamples: row.example_count,
            createdAt: row.created_at,
          });
        } else {
          existing.shardIds.push(row.shard_id);
          existing.totalExamples += row.example_count;
          existing.dialects.add(row.dialect.toLowerCase());
          existing.independentReproductions = Math.max(existing.independentReproductions, independentReproductions);
        }
      }

      const entries = Array.from(grouped.values())
        .filter((entry) => {
          if (domainFilter && domainFilter !== "all") {
            if (entry.domain !== domainFilter && !entry.dialects.has(domainFilter)) {
              return false;
            }
          }
          if (scaleFilter && !matchesParameterScaleTier(entry.parameterScale, scaleFilter)) {
            return false;
          }
          return true;
        })
        .map((entry) => {
          const efficiencyAdjustedScore = Number((entry.passAt1 * entry.gate1To4PassRate).toFixed(6));
          return {
            recipeName: entry.recipeName,
            recipeVersion: entry.recipeVersion,
            releaseId: entry.releaseId,
            domain: entry.domain,
            dialects: Array.from(entry.dialects),
            parameterScale: entry.parameterScale,
            passAt1: entry.passAt1,
            gate1To4PassRate: entry.gate1To4PassRate,
            score: efficiencyAdjustedScore,
            efficiencyAdjustedScore,
            independentReproductions: entry.independentReproductions,
            shardCount: entry.shardIds.length,
            totalExamples: entry.totalExamples,
            createdAt: entry.createdAt,
          };
        })
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.independentReproductions !== a.independentReproductions) {
            return b.independentReproductions - a.independentReproductions;
          }
          return a.recipeName.localeCompare(b.recipeName);
        })
        .map((entry, idx) => ({
          rank: idx + 1,
          ...entry,
        }));

      return res.json({
        entries,
        total: entries.length,
        rankingFormula: "Pass@1 * Gate1To4PassRate",
        filters: {
          domain: domainFilter ?? null,
          parameterScale: scaleFilter ?? null,
        },
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to compute domain leaderboards") });
    }
  });

  /**
   * GET /api/v1/memory/chunks
   * Lists DiskANN memory chunks with optional filters for curation, quarantine auditing, and search.
   */
  router.get("/chunks", optionalAuth, (req: Request, res: Response) => {
    try {
      const sourceKind = typeof req.query["sourceKind"] === "string" ? req.query["sourceKind"].trim() : undefined;
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim() : undefined;
      const modalityKind = typeof req.query["modalityKind"] === "string" ? req.query["modalityKind"].trim() : undefined;
      const embeddingModelId =
        typeof req.query["embeddingModelId"] === "string" ? req.query["embeddingModelId"].trim() : undefined;
      const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;
      const formalVerified =
        req.query["formalVerified"] === "true" ? true : req.query["formalVerified"] === "false" ? false : undefined;
      const isQuarantined =
        req.query["isQuarantined"] === "true" ? true : req.query["isQuarantined"] === "false" ? false : undefined;
      const limit = Number(req.query["limit"] ?? 50) || 50;
      const offset = Number(req.query["offset"] ?? 0) || 0;

      const result = diskann.listChunks({
        sourceKind,
        dialect,
        modalityKind,
        formalVerified,
        isQuarantined,
        embeddingModelId,
        search,
        limit,
        offset,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list DiskANN memory chunks") });
    }
  });

  /**
   * POST /api/v1/memory/chunks/:chunkId/quarantine
   * Quarantines or restores a DiskANN memory chunk so it is immediately excluded from RAG retrieval.
   */
  router.post("/chunks/:chunkId/quarantine", requireAuth, (req: Request, res: Response) => {
    try {
      const chunkId = String(req.params["chunkId"] ?? "").trim();
      if (!chunkId) return res.status(400).json({ error: "chunkId is required." });
      const quarantined = (req.body as { quarantined?: boolean } | undefined)?.quarantined !== false;
      const updated = diskann.setChunkQuarantined(chunkId, quarantined);
      if (!updated) {
        return res.status(404).json({ error: "Memory chunk not found." });
      }
      return res.json({ success: true, chunkId, isQuarantined: quarantined });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to update chunk quarantine state") });
    }
  });

  /**
   * DELETE /api/v1/memory/chunks/:chunkId
   * Deletes or tombstones a DiskANN memory chunk.
   */
  router.delete("/chunks/:chunkId", requireAuth, (req: Request, res: Response) => {
    try {
      const chunkId = String(req.params["chunkId"] ?? "").trim();
      if (!chunkId) return res.status(400).json({ error: "chunkId is required." });
      const hardDelete = req.query["hard"] !== "false";
      const deleted = diskann.deleteChunk(chunkId, hardDelete);
      if (!deleted) {
        return res.status(404).json({ error: "Memory chunk not found." });
      }
      return res.json({ success: true, chunkId, deleted: true, hardDelete });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to delete memory chunk") });
    }
  });

  /**
   * POST /api/v1/memory/compact
   * Compacts `diskann_vectors.f32`, purges tombstones, deduplicates content hashes, and rebuilds Vamana edges.
   */
  router.post("/compact", requireAuth, (_req: Request, res: Response) => {
    try {
      const result = diskann.compactIndex();
      return res.json({ success: true, backend: "diskann", ...result });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to compact DiskANN index") });
    }
  });

  /**
   * DELETE /api/v1/memory/federated/peers
   * Removes a peer Ansatz node from `federated_memory_peers`.
   */
  router.delete("/federated/peers", requireAuth, (req: Request, res: Response) => {
    try {
      const rawUrl =
        (typeof req.body?.peerUrl === "string" && req.body.peerUrl.trim()) ||
        (typeof req.query["peerUrl"] === "string" && req.query["peerUrl"].trim()) ||
        "";
      if (!rawUrl) {
        return res.status(400).json({ error: "peerUrl is required." });
      }
      const removed = federated.removePeer(rawUrl);
      if (!removed) {
        return res.status(404).json({ error: "Federated peer not found." });
      }
      return res.json({ success: true, removed: true, peerUrl: rawUrl });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to remove federated memory peer") });
    }
  });

  return router;
}
