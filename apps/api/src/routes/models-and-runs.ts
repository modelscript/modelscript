// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Model Registry, Live Training Runs Telemetry, Formal-Proof-Gated Promotion,
 * and Chunked Multipart Weight Storage API.
 *
 * Mounted at:
 *   - `/api/v1/runs`   (`runsRouter(database)`)
 *   - `/api/v1/models` (`modelsRouter(database, storageDir)`)
 */

import {
  DEFAULT_DYNAMIC_M_CONFIG,
  diffEvalReports,
  generatePyTorchSlurmRecipeExport,
  type EvalReportRegressionDiff,
  type FormalModelEvalReport,
} from "@modelscript/runtime";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { checkLivingRecipeTriggers } from "../services/chat-harvest-pipeline.js";
import { getDefaultDatasetSigningKeyPair, type DatasetManifestProof } from "../services/federated-diskann.js";
import { decodeMultibase, encodeMultibase } from "../services/git-sync/base58.js";
import { canonicalizeJson } from "../services/git-sync/jcs.js";
import { publicErrorMessage } from "../utils/http-error.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────────────────

export type ModelRegistryKind = "model-core" | "lora-adapter" | "projection-head";
export type ModelPromotionStage = "draft" | "staging" | "production" | "deprecated";
export type TrainingRunBackend = "webgpu" | "pytorch" | "slurm";
export type TrainingRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

const VALID_MODEL_KINDS = new Set<ModelRegistryKind>(["model-core", "lora-adapter", "projection-head"]);
const VALID_PROMOTION_STAGES = new Set<ModelPromotionStage>(["draft", "staging", "production", "deprecated"]);
const VALID_PROMOTION_TARGETS = new Set<Exclude<ModelPromotionStage, "draft">>(["staging", "production", "deprecated"]);
const VALID_BACKENDS = new Set<TrainingRunBackend>(["webgpu", "pytorch", "slurm"]);
const VALID_RUN_STATUSES = new Set<TrainingRunStatus>([
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
const VALID_STATUS_TRANSITIONS = new Set<Exclude<TrainingRunStatus, "queued">>([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);

interface ModelRegistryRow {
  id: number;
  name: string;
  version: string;
  kind: ModelRegistryKind;
  base_model_ref: string | null;
  recipe_name: string | null;
  recipe_version: string | null;
  promotion_stage: ModelPromotionStage;
  parameter_scale: string | null;
  lora_rank: number | null;
  projection_layer_index: number | null;
  retriever_embedding_dim: number | null;
  memory_contract_json: string | null;
  eval_report_json: string | null;
  zonotope_cert_json: string | null;
  ed25519_proof_json: string | null;
  weight_sha256: string | null;
  weight_bytes: number;
  storage_key: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TrainingRunRow {
  id: number;
  run_uid: string;
  recipe_name: string;
  recipe_version: string;
  model_name: string | null;
  backend: TrainingRunBackend;
  status: TrainingRunStatus;
  hyperparams_json: string;
  shard_ids_json: string;
  slurm_job_id: string | null;
  latest_checkpoint_key: string | null;
  eval_report_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TrainingRunMetricRow {
  id: number;
  run_id: number;
  step: number;
  epoch: number | null;
  center_loss: number | null;
  worst_case_loss: number | null;
  m_active: number | null;
  max_spread_delta_t: number | null;
  pruned_count: number;
  merged_count: number;
  expanded_count: number;
  girard_cap_count: number;
  gate1_to_4_pass_rate: number | null;
  ece: number | null;
  wq_recall_at_k: number | null;
  extra_json: string;
  recorded_at: string;
}

export interface StoredPromotionProof {
  attestation: Record<string, unknown>;
  proof: DatasetManifestProof;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ed25519 Promotion Attestation Helpers (`eddsa-jcs-2022`)
// ─────────────────────────────────────────────────────────────────────────────

function extractEd25519PublicKeyMultibase(pubKeyObj: crypto.KeyObject): string {
  const spkiDer = pubKeyObj.export({ type: "spki", format: "der" });
  const rawPub32 = spkiDer.subarray(ED25519_SPKI_PREFIX.length);
  return encodeMultibase(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPub32]));
}

function ed25519PublicKeyFromMultibase(publicKeyMultibase: string): crypto.KeyObject {
  const decoded = decodeMultibase(publicKeyMultibase);
  const rawPub32 = decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01 ? decoded.subarray(2) : decoded;
  if (rawPub32.length !== 32) {
    throw new Error("Invalid Ed25519 multibase public key length.");
  }
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
  return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
}

export function signPromotionAttestationEd25519(
  payload: Record<string, unknown>,
  options?: {
    privateKeyPem?: string | undefined;
    verificationMethod?: string | undefined;
    created?: string | undefined;
  },
): StoredPromotionProof {
  const privKeyObj = options?.privateKeyPem
    ? crypto.createPrivateKey(options.privateKeyPem)
    : crypto.createPrivateKey(getDefaultDatasetSigningKeyPair().privateKeyPem);
  if (privKeyObj.asymmetricKeyType !== "ed25519") {
    throw new Error(`Unsupported signing key type '${String(privKeyObj.asymmetricKeyType)}'; expected 'ed25519'.`);
  }

  const pubKeyObj = crypto.createPublicKey(privKeyObj);
  const publicKeyMultibase = extractEd25519PublicKeyMultibase(pubKeyObj);
  const publicKeyPem = pubKeyObj.export({ type: "spki", format: "pem" }).toString();

  const cleanPayload: Record<string, unknown> = { ...payload };
  delete cleanPayload["proof"];
  const docHash = crypto.createHash("sha256").update(canonicalizeJson(cleanPayload), "utf8").digest();

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
    attestation: cleanPayload,
    proof: {
      ...proofConfig,
      publicKeyMultibase,
      publicKeyPem,
      payloadSha256: docHash.toString("hex"),
      proofValue: encodeMultibase(signatureBytes),
    },
  };
}

export function verifyPromotionAttestationEd25519(stored: Partial<StoredPromotionProof>): {
  valid: boolean;
  error?: string;
  payloadSha256?: string;
  publicKeyMultibase?: string;
} {
  const payload = stored.attestation;
  const proof = stored.proof;
  if (!payload || typeof payload !== "object" || !proof || typeof proof !== "object") {
    return { valid: false, error: "Missing attestation payload or proof." };
  }
  if (proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022") {
    return { valid: false, error: "Unsupported proof type or cryptosuite (expected eddsa-jcs-2022)." };
  }
  if (!proof.proofValue || !proof.created || !proof.verificationMethod) {
    return { valid: false, error: "Missing required proof fields." };
  }

  let pubKeyObj: crypto.KeyObject;
  try {
    if (proof.publicKeyMultibase) {
      pubKeyObj = ed25519PublicKeyFromMultibase(proof.publicKeyMultibase);
    } else if (proof.publicKeyPem) {
      pubKeyObj = crypto.createPublicKey(proof.publicKeyPem);
    } else {
      return { valid: false, error: "No public key present in proof." };
    }
  } catch (err) {
    return { valid: false, error: `Invalid public key: ${err instanceof Error ? err.message : String(err)}` };
  }

  const cleanPayload: Record<string, unknown> = { ...payload };
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
      publicKeyMultibase: extractEd25519PublicKeyMultibase(pubKeyObj),
    };
  } catch (err) {
    return { valid: false, error: `Malformed signature: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization & Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function optionalFiniteNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isFinite(n) ? n : null;
}

function optionalNonNegInt(val: unknown, fallback: number): number {
  if (val === undefined || val === null) return fallback;
  const n = typeof val === "number" ? val : Number(val);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || "model";
}

function mapTrainingRunRow(row: TrainingRunRow) {
  return {
    id: row.id,
    runUid: row.run_uid,
    recipeName: row.recipe_name,
    recipeVersion: row.recipe_version,
    modelName: row.model_name,
    backend: row.backend,
    status: row.status,
    hyperparams: parseJsonSafe<Record<string, unknown>>(row.hyperparams_json, {}),
    shardIds: parseJsonSafe<string[]>(row.shard_ids_json, []),
    slurmJobId: row.slurm_job_id,
    latestCheckpointKey: row.latest_checkpoint_key,
    evalReport: parseJsonSafe<FormalModelEvalReport | Record<string, unknown> | null>(row.eval_report_json, null),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingRunMetricRow(row: TrainingRunMetricRow) {
  return {
    id: row.id,
    runId: row.run_id,
    step: row.step,
    epoch: row.epoch,
    centerLoss: row.center_loss,
    worstCaseLoss: row.worst_case_loss,
    mActive: row.m_active,
    maxSpreadDeltaT: row.max_spread_delta_t,
    prunedCount: row.pruned_count,
    mergedCount: row.merged_count,
    expandedCount: row.expanded_count,
    girardCapCount: row.girard_cap_count,
    gate1To4PassRate: row.gate1_to_4_pass_rate,
    ece: row.ece,
    wqRecallAtK: row.wq_recall_at_k,
    extra: parseJsonSafe<Record<string, unknown>>(row.extra_json, {}),
    recordedAt: row.recorded_at,
  };
}

function mapModelRegistryRow(row: ModelRegistryRow) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    kind: row.kind,
    baseModelRef: row.base_model_ref,
    recipeName: row.recipe_name,
    recipeVersion: row.recipe_version,
    promotionStage: row.promotion_stage,
    parameterScale: row.parameter_scale,
    loraRank: row.lora_rank,
    projectionLayerIndex: row.projection_layer_index,
    retrieverEmbeddingDim: row.retriever_embedding_dim,
    memoryContract: parseJsonSafe<Record<string, unknown> | null>(row.memory_contract_json, null),
    evalReport: parseJsonSafe<FormalModelEvalReport | null>(row.eval_report_json, null),
    zonotopeCert: parseJsonSafe<Record<string, unknown> | null>(row.zonotope_cert_json, null),
    ed25519Proof: parseJsonSafe<StoredPromotionProof | null>(row.ed25519_proof_json, null),
    weightSha256: row.weight_sha256,
    weightBytes: row.weight_bytes,
    storageKey: row.storage_key,
    weightsDownloadUrl: row.storage_key
      ? `/api/v1/models/${encodeURIComponent(row.name)}/${encodeURIComponent(row.version)}/weights`
      : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolves a `baseModelRef` string such as `my-core@1.0.0`, `@org/my-core@1.0.0`,
 * or bare `my-core` against `model_registry_entries`.
 */
function lookupBaseModelRef(database: LibraryDatabase, baseModelRef: string): ModelRegistryRow | undefined {
  const trimmed = baseModelRef.trim();
  if (!trimmed) return undefined;

  const lastAt = trimmed.lastIndexOf("@");
  if (lastAt > 0) {
    const refName = trimmed.slice(0, lastAt).trim();
    const refVersion = trimmed.slice(lastAt + 1).trim();
    if (refName && refVersion) {
      return database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(refName, refVersion) as ModelRegistryRow | undefined;
    }
  }

  return database.db
    .prepare(`SELECT * FROM model_registry_entries WHERE name = ? ORDER BY id DESC LIMIT 1`)
    .get(trimmed) as ModelRegistryRow | undefined;
}

function isFormalEvalReportLike(value: unknown): value is FormalModelEvalReport {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj["promoted"] === "boolean";
}

function normalizeEvalReportForDiff(report: FormalModelEvalReport): FormalModelEvalReport {
  return {
    promoted: Boolean(report.promoted),
    totalCases:
      typeof report.totalCases === "number"
        ? report.totalCases
        : Array.isArray(report.perCase)
          ? report.perCase.length
          : 0,
    formalGatePassRate: typeof report.formalGatePassRate === "number" ? report.formalGatePassRate : 0,
    nonTrivialPassRate: typeof report.nonTrivialPassRate === "number" ? report.nonTrivialPassRate : 0,
    rewardHackingRate: typeof report.rewardHackingRate === "number" ? report.rewardHackingRate : 0,
    diskAnnRecallAtK: typeof report.diskAnnRecallAtK === "number" ? report.diskAnnRecallAtK : 0,
    calibration:
      report.calibration && typeof report.calibration === "object"
        ? report.calibration
        : {
            ece: 0,
            meanSpreadOnErrors: 0,
            meanSpreadOnValid: 0,
            separationGap: 0,
            sampleCount: 0,
          },
    failureReasons: Array.isArray(report.failureReasons) ? report.failureReasons : [],
    perCase: Array.isArray(report.perCase) ? report.perCase : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Live Training Runs Telemetry Router (`/api/v1/runs`)
// ─────────────────────────────────────────────────────────────────────────────

export function runsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

  /**
   * POST /api/v1/runs
   * Creates a new training run record (`run_uid`).
   */
  router.post("/", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const recipeName =
        typeof body["recipeName"] === "string"
          ? body["recipeName"].trim()
          : typeof body["recipe_name"] === "string"
            ? body["recipe_name"].trim()
            : "";
      if (!recipeName) {
        return res.status(400).json({ error: "recipeName is required." });
      }

      const recipeVersionRaw = body["recipeVersion"] ?? body["recipe_version"];
      const recipeVersion =
        typeof recipeVersionRaw === "string" && recipeVersionRaw.trim() ? recipeVersionRaw.trim() : "0.1.0";

      const backendRaw = typeof body["backend"] === "string" ? body["backend"].trim().toLowerCase() : "";
      if (!VALID_BACKENDS.has(backendRaw as TrainingRunBackend)) {
        return res.status(400).json({ error: "backend must be one of: webgpu, pytorch, slurm." });
      }
      const backend = backendRaw as TrainingRunBackend;

      const statusRaw = typeof body["status"] === "string" ? body["status"].trim().toLowerCase() : "queued";
      if (!VALID_RUN_STATUSES.has(statusRaw as TrainingRunStatus)) {
        return res.status(400).json({
          error: "status must be one of: queued, running, paused, completed, failed, cancelled.",
        });
      }
      const status = statusRaw as TrainingRunStatus;

      const runUidRaw = body["runUid"] ?? body["run_uid"];
      const runUid =
        typeof runUidRaw === "string" && runUidRaw.trim()
          ? runUidRaw.trim()
          : `run_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

      const modelNameRaw = body["modelName"] ?? body["model_name"];
      const modelName = typeof modelNameRaw === "string" && modelNameRaw.trim() ? modelNameRaw.trim() : null;

      const hyperparams =
        body["hyperparams"] && typeof body["hyperparams"] === "object" && !Array.isArray(body["hyperparams"])
          ? (body["hyperparams"] as Record<string, unknown>)
          : {};

      const shardIdsRaw = body["shardIds"] ?? body["shard_ids"];
      const shardIds = Array.isArray(shardIdsRaw) ? shardIdsRaw.map((s) => String(s)) : [];

      const slurmJobIdRaw = body["slurmJobId"] ?? body["slurm_job_id"];
      const slurmJobId = typeof slurmJobIdRaw === "string" && slurmJobIdRaw.trim() ? slurmJobIdRaw.trim() : null;

      const latestCheckpointKeyRaw = body["latestCheckpointKey"] ?? body["latest_checkpoint_key"];
      const latestCheckpointKey =
        typeof latestCheckpointKeyRaw === "string" && latestCheckpointKeyRaw.trim()
          ? latestCheckpointKeyRaw.trim()
          : null;

      const evalReportRaw = body["evalReport"] ?? body["eval_report"];
      const evalReportJson = evalReportRaw && typeof evalReportRaw === "object" ? JSON.stringify(evalReportRaw) : null;

      const nowIso = new Date().toISOString();
      const startedAt = status === "running" ? nowIso : null;
      const finishedAt = status === "completed" || status === "failed" || status === "cancelled" ? nowIso : null;

      const existing = database.db.prepare(`SELECT id FROM training_runs WHERE run_uid = ?`).get(runUid) as
        { id: number } | undefined;
      if (existing) {
        return res.status(409).json({ error: `Training run '${runUid}' already exists.` });
      }

      const info = database.db
        .prepare(
          `INSERT INTO training_runs (
             run_uid, recipe_name, recipe_version, model_name, backend, status,
             hyperparams_json, shard_ids_json, slurm_job_id, latest_checkpoint_key,
             eval_report_json, started_at, finished_at, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runUid,
          recipeName,
          recipeVersion,
          modelName,
          backend,
          status,
          JSON.stringify(hyperparams),
          JSON.stringify(shardIds),
          slurmJobId,
          latestCheckpointKey,
          evalReportJson,
          startedAt,
          finishedAt,
          req.user?.id ?? null,
        );

      const inserted = database.db
        .prepare(`SELECT * FROM training_runs WHERE id = ?`)
        .get(Number(info.lastInsertRowid)) as TrainingRunRow;

      return res.status(201).json({ run: mapTrainingRunRow(inserted) });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to create training run") });
    }
  });

  /**
   * GET /api/v1/runs
   * Lists training runs filtered by optional `status`, `recipeName`, `backend`.
   */
  router.get("/", optionalAuth, (req: Request, res: Response) => {
    try {
      const status = typeof req.query["status"] === "string" ? req.query["status"].trim().toLowerCase() : undefined;
      const recipeName =
        typeof req.query["recipeName"] === "string"
          ? req.query["recipeName"].trim()
          : typeof req.query["recipe_name"] === "string"
            ? req.query["recipe_name"].trim()
            : undefined;
      const backend = typeof req.query["backend"] === "string" ? req.query["backend"].trim().toLowerCase() : undefined;

      const limitRaw = typeof req.query["limit"] === "string" ? Number(req.query["limit"]) : 100;
      const offsetRaw = typeof req.query["offset"] === "string" ? Number(req.query["offset"]) : 0;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

      const where: string[] = [];
      const params: unknown[] = [];

      if (status) {
        if (!VALID_RUN_STATUSES.has(status as TrainingRunStatus)) {
          return res.status(400).json({ error: `Invalid status filter '${status}'.` });
        }
        where.push("status = ?");
        params.push(status);
      }
      if (recipeName) {
        where.push("recipe_name = ?");
        params.push(recipeName);
      }
      if (backend) {
        if (!VALID_BACKENDS.has(backend as TrainingRunBackend)) {
          return res.status(400).json({ error: `Invalid backend filter '${backend}'.` });
        }
        where.push("backend = ?");
        params.push(backend);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = database.db
        .prepare(`SELECT * FROM training_runs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as TrainingRunRow[];

      const countRow = database.db
        .prepare(`SELECT COUNT(*) AS cnt FROM training_runs ${whereClause}`)
        .get(...params) as { cnt: number };

      return res.json({
        runs: rows.map(mapTrainingRunRow),
        total: countRow.cnt,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list training runs") });
    }
  });

  /**
   * GET /api/v1/runs/living-triggers
   * Lists configured continuous "Living Recipe" triggers.
   */
  router.get("/living-triggers", optionalAuth, (req: Request, res: Response) => {
    try {
      const dialect = typeof req.query["dialect"] === "string" ? req.query["dialect"].trim().toLowerCase() : undefined;
      const rows = dialect
        ? database.db
            .prepare(`SELECT * FROM living_recipe_triggers WHERE dialect IN ('polyglot', ?) ORDER BY id DESC`)
            .all(dialect)
        : database.db.prepare(`SELECT * FROM living_recipe_triggers ORDER BY id DESC`).all();
      return res.json({ triggers: rows, total: rows.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list living recipe triggers") });
    }
  });

  /**
   * POST /api/v1/runs/living-triggers
   * Creates or updates a continuous "Living Recipe" trigger that spawns post-train runs when
   * verified chat fixes or RLHF consensus counts cross threshold.
   */
  router.post("/living-triggers", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const recipeName = typeof body["recipeName"] === "string" ? body["recipeName"].trim() : "";
      const dialect =
        typeof body["dialect"] === "string" && body["dialect"].trim()
          ? body["dialect"].trim().toLowerCase()
          : "polyglot";
      const triggerKind =
        body["triggerKind"] === "campaign_complete" || body["triggerKind"] === "manual"
          ? body["triggerKind"]
          : "verified_pair_threshold";
      const thresholdCount = Math.max(1, Number(body["thresholdCount"] ?? 25) || 25);
      const targetBaseModel =
        typeof body["targetBaseModel"] === "string" && body["targetBaseModel"].trim()
          ? body["targetBaseModel"].trim()
          : "Qwen/Qwen2.5-Coder-1.5B";
      const targetBackend =
        body["targetBackend"] === "webgpu" || body["targetBackend"] === "slurm" ? body["targetBackend"] : "pytorch";
      const autoPromoteStaging = body["autoPromoteStaging"] !== false ? 1 : 0;

      if (!recipeName) {
        return res.status(400).json({ error: "recipeName is required." });
      }

      database.db
        .prepare(
          `INSERT INTO living_recipe_triggers (
             recipe_name, dialect, trigger_kind, threshold_count, target_base_model,
             target_backend, auto_promote_staging, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(recipe_name, dialect, trigger_kind) DO UPDATE SET
             threshold_count = excluded.threshold_count,
             target_base_model = excluded.target_base_model,
             target_backend = excluded.target_backend,
             auto_promote_staging = excluded.auto_promote_staging,
             enabled = 1,
             updated_at = datetime('now')`,
        )
        .run(
          recipeName,
          dialect,
          triggerKind,
          thresholdCount,
          targetBaseModel,
          targetBackend,
          autoPromoteStaging,
          req.user!.id,
        );

      const trigger = database.db
        .prepare(`SELECT * FROM living_recipe_triggers WHERE recipe_name = ? AND dialect = ? AND trigger_kind = ?`)
        .get(recipeName, dialect, triggerKind);
      return res.status(201).json({ success: true, trigger });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to save living recipe trigger") });
    }
  });

  /**
   * POST /api/v1/runs/living-triggers/evaluate
   * Evaluates enabled living triggers for a dialect and auto-spawns queued training runs for ready recipes.
   */
  router.post("/living-triggers/evaluate", requireAuth, (req: Request, res: Response) => {
    try {
      const dialect =
        typeof (req.body as { dialect?: unknown })?.dialect === "string"
          ? String((req.body as { dialect: string }).dialect)
              .trim()
              .toLowerCase()
          : "polyglot";
      const ready = checkLivingRecipeTriggers(database, dialect);
      const spawnedRuns: Array<{
        triggerId: number;
        runUid: string;
        recipeName: string;
        pendingVerifiedCount: number;
      }> = [];

      for (const item of ready) {
        const trig = database.db.prepare(`SELECT * FROM living_recipe_triggers WHERE id = ?`).get(item.triggerId) as
          | {
              id: number;
              recipe_name: string;
              dialect: string;
              target_base_model: string;
              target_backend: TrainingRunBackend;
            }
          | undefined;
        if (!trig) continue;
        const runUid = `run_live_${crypto.randomBytes(8).toString("hex")}`;
        database.db
          .prepare(
            `INSERT INTO training_runs (
               run_uid, recipe_name, recipe_version, model_name, backend, status, hyperparams_json, created_by
             ) VALUES (?, ?, 'auto', ?, ?, 'queued', ?, ?)`,
          )
          .run(
            runUid,
            trig.recipe_name,
            trig.target_base_model,
            trig.target_backend,
            JSON.stringify({
              triggeredByLivingRecipeId: trig.id,
              dialect: trig.dialect,
              pendingVerifiedCount: item.pendingVerifiedCount,
            }),
            req.user!.id,
          );
        database.db
          .prepare(
            `UPDATE living_recipe_triggers
             SET last_run_uid = ?, last_triggered_at = datetime('now'), updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(runUid, trig.id);
        spawnedRuns.push({
          triggerId: trig.id,
          runUid,
          recipeName: trig.recipe_name,
          pendingVerifiedCount: item.pendingVerifiedCount,
        });
      }

      return res.json({ evaluatedDialect: dialect, readyCount: ready.length, spawnedRuns });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to evaluate living recipe triggers") });
    }
  });

  /**
   * GET /api/v1/runs/:runUid
   * Returns full training run metadata plus ordered `metrics[]` time-series.
   */
  router.get("/:runUid", optionalAuth, (req: Request, res: Response) => {
    try {
      const runUid = String(req.params["runUid"] ?? "").trim();
      if (!runUid) {
        return res.status(400).json({ error: "runUid is required." });
      }

      const row = database.db.prepare(`SELECT * FROM training_runs WHERE run_uid = ?`).get(runUid) as
        TrainingRunRow | undefined;
      if (!row) {
        return res.status(404).json({ error: `Training run '${runUid}' not found.` });
      }

      const metricRows = database.db
        .prepare(`SELECT * FROM training_run_metrics WHERE run_id = ? ORDER BY step ASC, id ASC`)
        .all(row.id) as TrainingRunMetricRow[];

      return res.json({
        run: mapTrainingRunRow(row),
        metrics: metricRows.map(mapTrainingRunMetricRow),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to inspect training run") });
    }
  });

  /**
   * POST /api/v1/runs/:runUid/metrics
   * Appends step-level Dynamic-m generator lifecycle and formal gate telemetry.
   */
  router.post("/:runUid/metrics", requireAuth, (req: Request, res: Response) => {
    try {
      const runUid = String(req.params["runUid"] ?? "").trim();
      if (!runUid) {
        return res.status(400).json({ error: "runUid is required." });
      }

      const run = database.db.prepare(`SELECT * FROM training_runs WHERE run_uid = ?`).get(runUid) as
        TrainingRunRow | undefined;
      if (!run) {
        return res.status(404).json({ error: `Training run '${runUid}' not found.` });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const stepVal = optionalFiniteNumber(body["step"]);
      if (stepVal === null || !Number.isInteger(stepVal) || stepVal < 0) {
        return res.status(400).json({ error: "step must be a non-negative integer." });
      }

      const epoch = optionalFiniteNumber(body["epoch"]);
      const centerLoss = optionalFiniteNumber(body["centerLoss"] ?? body["center_loss"]);
      const worstCaseLoss = optionalFiniteNumber(body["worstCaseLoss"] ?? body["worst_case_loss"]);
      const mActiveNum = optionalFiniteNumber(body["mActive"] ?? body["m_active"]);
      const mActive = mActiveNum !== null ? Math.floor(mActiveNum) : null;
      const maxSpreadDeltaT = optionalFiniteNumber(body["maxSpreadDeltaT"] ?? body["max_spread_delta_t"]);
      const prunedCount = optionalNonNegInt(body["prunedCount"] ?? body["pruned_count"], 0);
      const mergedCount = optionalNonNegInt(body["mergedCount"] ?? body["merged_count"], 0);
      const expandedCount = optionalNonNegInt(body["expandedCount"] ?? body["expanded_count"], 0);
      const girardCapCount = optionalNonNegInt(body["girardCapCount"] ?? body["girard_cap_count"], 0);
      const gate1To4PassRate = optionalFiniteNumber(body["gate1To4PassRate"] ?? body["gate1_to_4_pass_rate"]);
      const ece = optionalFiniteNumber(body["ece"]);
      const wqRecallAtK = optionalFiniteNumber(body["wqRecallAtK"] ?? body["wq_recall_at_k"]);
      const extraRaw = body["extra"] ?? body["extra_json"];
      const extraJson =
        extraRaw && typeof extraRaw === "object" && !Array.isArray(extraRaw) ? JSON.stringify(extraRaw) : "{}";

      const info = database.db
        .prepare(
          `INSERT INTO training_run_metrics (
             run_id, step, epoch, center_loss, worst_case_loss, m_active, max_spread_delta_t,
             pruned_count, merged_count, expanded_count, girard_cap_count,
             gate1_to_4_pass_rate, ece, wq_recall_at_k, extra_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          run.id,
          stepVal,
          epoch,
          centerLoss,
          worstCaseLoss,
          mActive,
          maxSpreadDeltaT,
          prunedCount,
          mergedCount,
          expandedCount,
          girardCapCount,
          gate1To4PassRate,
          ece,
          wqRecallAtK,
          extraJson,
        );

      database.db.prepare(`UPDATE training_runs SET updated_at = datetime('now') WHERE id = ?`).run(run.id);

      const inserted = database.db
        .prepare(`SELECT * FROM training_run_metrics WHERE id = ?`)
        .get(Number(info.lastInsertRowid)) as TrainingRunMetricRow;

      return res.status(201).json({ metric: mapTrainingRunMetricRow(inserted) });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to record training run metric") });
    }
  });

  /**
   * POST /api/v1/runs/:runUid/status
   * Transitions training run status (`running|paused|completed|failed|cancelled`) with optional
   * `evalReport`, `latestCheckpointKey`, and `slurmJobId`.
   */
  router.post("/:runUid/status", requireAuth, (req: Request, res: Response) => {
    try {
      const runUid = String(req.params["runUid"] ?? "").trim();
      if (!runUid) {
        return res.status(400).json({ error: "runUid is required." });
      }

      const run = database.db.prepare(`SELECT * FROM training_runs WHERE run_uid = ?`).get(runUid) as
        TrainingRunRow | undefined;
      if (!run) {
        return res.status(404).json({ error: `Training run '${runUid}' not found.` });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const nextStatusRaw = typeof body["status"] === "string" ? body["status"].trim().toLowerCase() : "";
      if (!VALID_STATUS_TRANSITIONS.has(nextStatusRaw as Exclude<TrainingRunStatus, "queued">)) {
        return res.status(400).json({
          error: "status must be one of: running, paused, completed, failed, cancelled.",
        });
      }
      const nextStatus = nextStatusRaw as Exclude<TrainingRunStatus, "queued">;

      const nowIso = new Date().toISOString();
      const startedAt = run.started_at ?? (nextStatus === "running" ? nowIso : null);
      const finishedAt =
        nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled" ? nowIso : run.finished_at;

      const latestCheckpointKeyRaw = body["latestCheckpointKey"] ?? body["latest_checkpoint_key"];
      const latestCheckpointKey =
        typeof latestCheckpointKeyRaw === "string" ? latestCheckpointKeyRaw.trim() || null : run.latest_checkpoint_key;

      const slurmJobIdRaw = body["slurmJobId"] ?? body["slurm_job_id"];
      const slurmJobId = typeof slurmJobIdRaw === "string" ? slurmJobIdRaw.trim() || null : run.slurm_job_id;

      const evalReportRaw = body["evalReport"] ?? body["eval_report"];
      const evalReportJson =
        evalReportRaw && typeof evalReportRaw === "object" ? JSON.stringify(evalReportRaw) : run.eval_report_json;

      database.db
        .prepare(
          `UPDATE training_runs
           SET status = ?,
               latest_checkpoint_key = ?,
               slurm_job_id = ?,
               eval_report_json = ?,
               started_at = ?,
               finished_at = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(nextStatus, latestCheckpointKey, slurmJobId, evalReportJson, startedAt, finishedAt, run.id);

      const updated = database.db.prepare(`SELECT * FROM training_runs WHERE id = ?`).get(run.id) as TrainingRunRow;

      return res.json({ run: mapTrainingRunRow(updated) });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to update training run status") });
    }
  });

  /**
   * POST /api/v1/runs/:runUid/dispatch
   * Compiles an executable dispatch plan (Slurm sbatch script, PyTorch CLI command, or Browser WebGPU OPFS bundle)
   * and transitions the run to `running`.
   */
  router.post("/:runUid/dispatch", requireAuth, (req: Request, res: Response) => {
    try {
      const runUid = String(req.params["runUid"] ?? "").trim();
      if (!runUid) return res.status(400).json({ error: "runUid is required." });

      const run = database.db.prepare(`SELECT * FROM training_runs WHERE run_uid = ?`).get(runUid) as
        TrainingRunRow | undefined;
      if (!run) {
        return res.status(404).json({ error: "Training run not found." });
      }

      const hyperparams = parseJsonSafe<Record<string, unknown>>(run.hyperparams_json, {});
      const shardIds = parseJsonSafe<string[]>(run.shard_ids_json, []);
      const baseModel =
        typeof hyperparams["baseModel"] === "string" && hyperparams["baseModel"].trim()
          ? hyperparams["baseModel"].trim()
          : run.model_name || "Qwen/Qwen2.5-Coder-1.5B";
      const loraRank = Math.max(2, Number(hyperparams["loraRank"] ?? 16) || 16);
      const apiBaseUrl =
        typeof (req.body as { apiBaseUrl?: unknown })?.apiBaseUrl === "string"
          ? String((req.body as { apiBaseUrl: string }).apiBaseUrl).trim()
          : `${req.protocol}://${req.get("host") || "localhost:3000"}`;

      const slurmExport = generatePyTorchSlurmRecipeExport({
        recipeName: run.recipe_name,
        recipeVersion: run.recipe_version,
        targetModel: {
          baseModel,
          parameterScale: typeof hyperparams["parameterScale"] === "string" ? hyperparams["parameterScale"] : "1.5B",
          mode:
            hyperparams["mode"] === "projection-head-align" || hyperparams["mode"] === "posttrain-qlora"
              ? hyperparams["mode"]
              : "posttrain-lora",
          loraRank,
        },
        dynamicM: DEFAULT_DYNAMIC_M_CONFIG,
        memoryApiUrl: `${apiBaseUrl}/api/v1/memory/query`,
        shardIds,
      });

      const dispatchPlan =
        run.backend === "webgpu"
          ? {
              backend: "webgpu" as const,
              mode: "browser-opfs-micro-lora",
              shardUrls: shardIds.map((id) => `/api/v1/memory/datasets/shards/${id}`),
              metricsIngestUrl: `/api/v1/runs/${encodeURIComponent(runUid)}/metrics`,
              statusUrl: `/api/v1/runs/${encodeURIComponent(runUid)}/status`,
              editorLaunchUrl: `/editor?mode=training-studio&run=webgpu&runUid=${encodeURIComponent(runUid)}`,
            }
          : {
              backend: run.backend,
              mode: run.backend === "slurm" ? "slurm-sbatch" : "pytorch-cli",
              cliCommand: `python3 -m modelscript_trainer.train_dynamic_m --base-model ${JSON.stringify(baseModel)} --lora-rank ${loraRank} --run-api-url ${JSON.stringify(apiBaseUrl)} --run-uid ${JSON.stringify(runUid)} --export-targets mlc-webgpu,gguf,onnx,peft --output-dir ./checkpoints/${runUid}`,
              slurmScript: slurmExport.slurmScript,
              manifestJson: slurmExport.manifestJson,
              metricsIngestUrl: `${apiBaseUrl}/api/v1/runs/${encodeURIComponent(runUid)}/metrics`,
            };

      const nowIso = new Date().toISOString();
      database.db
        .prepare(
          `UPDATE training_runs
           SET status = 'running',
               started_at = COALESCE(started_at, ?),
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(nowIso, run.id);

      const updated = database.db.prepare(`SELECT * FROM training_runs WHERE id = ?`).get(run.id) as TrainingRunRow;

      return res.json({
        success: true,
        run: mapTrainingRunRow(updated),
        dispatchPlan,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to dispatch training run") });
    }
  });

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Model Registry & Chunked Multipart Weight Storage Router (`/api/v1/models`)
// ─────────────────────────────────────────────────────────────────────────────

export function modelsRouter(database: LibraryDatabase, storageDir: string): Router {
  const router = createRouter();
  const resolvedStorageDir = path.resolve(storageDir);
  const weightsBaseDir = path.resolve(resolvedStorageDir, "model-weights");
  const weightsTmpDir = path.resolve(weightsBaseDir, "tmp");

  /**
   * GET /api/v1/models
   * Lists registered models filtered by optional `kind`, `promotionStage`, `name`.
   */
  router.get("/", optionalAuth, (req: Request, res: Response, next) => {
    // Allow Ansatz Registry Streaming Catalog queries (`/api/v1/models?includeSvg=1|domain=...|package=...|subpackage=...|q=...`)
    // to fall through to `registryCatalogRouter`.
    if (
      req.query["includeSvg"] !== undefined ||
      req.query["domain"] !== undefined ||
      req.query["subpackage"] !== undefined ||
      req.query["package"] !== undefined ||
      req.query["q"] !== undefined
    ) {
      next();
      return;
    }
    try {
      const kind = typeof req.query["kind"] === "string" ? req.query["kind"].trim().toLowerCase() : undefined;
      const promotionStage =
        typeof req.query["promotionStage"] === "string"
          ? req.query["promotionStage"].trim().toLowerCase()
          : typeof req.query["promotion_stage"] === "string"
            ? req.query["promotion_stage"].trim().toLowerCase()
            : undefined;
      const name = typeof req.query["name"] === "string" ? req.query["name"].trim() : undefined;

      const limitRaw = typeof req.query["limit"] === "string" ? Number(req.query["limit"]) : 100;
      const offsetRaw = typeof req.query["offset"] === "string" ? Number(req.query["offset"]) : 0;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

      const where: string[] = [];
      const params: unknown[] = [];

      if (kind) {
        if (!VALID_MODEL_KINDS.has(kind as ModelRegistryKind)) {
          return res.status(400).json({ error: `Invalid kind filter '${kind}'.` });
        }
        where.push("kind = ?");
        params.push(kind);
      }
      if (promotionStage) {
        if (!VALID_PROMOTION_STAGES.has(promotionStage as ModelPromotionStage)) {
          return res.status(400).json({ error: `Invalid promotionStage filter '${promotionStage}'.` });
        }
        where.push("promotion_stage = ?");
        params.push(promotionStage);
      }
      if (name) {
        where.push("name = ?");
        params.push(name);
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const rows = database.db
        .prepare(
          `SELECT * FROM model_registry_entries ${whereClause} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as ModelRegistryRow[];

      const countRow = database.db
        .prepare(`SELECT COUNT(*) AS cnt FROM model_registry_entries ${whereClause}`)
        .get(...params) as { cnt: number };

      return res.json({
        models: rows.map(mapModelRegistryRow),
        total: countRow.cnt,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list models") });
    }
  });

  /**
   * POST /api/v1/models
   * Registers a `model-core`, `lora-adapter`, or `projection-head` entry with compatibility validation.
   */
  router.post("/", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      const version = typeof body["version"] === "string" ? body["version"].trim() : "";
      const kindRaw = typeof body["kind"] === "string" ? body["kind"].trim().toLowerCase() : "";

      if (!name) {
        return res.status(400).json({ error: "name is required." });
      }
      if (!version) {
        return res.status(400).json({ error: "version is required." });
      }
      if (!VALID_MODEL_KINDS.has(kindRaw as ModelRegistryKind)) {
        return res.status(400).json({
          error: "kind must be one of: model-core, lora-adapter, projection-head.",
        });
      }
      const kind = kindRaw as ModelRegistryKind;

      const baseModelRefRaw = body["baseModelRef"] ?? body["base_model_ref"];
      const baseModelRef =
        typeof baseModelRefRaw === "string" && baseModelRefRaw.trim() ? baseModelRefRaw.trim() : null;

      const recipeNameRaw = body["recipeName"] ?? body["recipe_name"];
      const recipeName = typeof recipeNameRaw === "string" && recipeNameRaw.trim() ? recipeNameRaw.trim() : null;

      const recipeVersionRaw = body["recipeVersion"] ?? body["recipe_version"];
      const recipeVersion =
        typeof recipeVersionRaw === "string" && recipeVersionRaw.trim() ? recipeVersionRaw.trim() : null;

      const parameterScaleRaw = body["parameterScale"] ?? body["parameter_scale"];
      const parameterScale =
        typeof parameterScaleRaw === "string" && parameterScaleRaw.trim() ? parameterScaleRaw.trim() : null;

      const loraRankRaw = body["loraRank"] ?? body["lora_rank"];
      const loraRank = optionalFiniteNumber(loraRankRaw);
      if (
        loraRankRaw !== undefined &&
        loraRankRaw !== null &&
        (loraRank === null || !Number.isInteger(loraRank) || loraRank <= 0)
      ) {
        return res.status(400).json({ error: "loraRank must be a positive integer." });
      }

      const projLayerRaw = body["projectionLayerIndex"] ?? body["projection_layer_index"];
      const projectionLayerIndex = optionalFiniteNumber(projLayerRaw);
      if (
        projLayerRaw !== undefined &&
        projLayerRaw !== null &&
        (projectionLayerIndex === null || !Number.isInteger(projectionLayerIndex) || projectionLayerIndex < 0)
      ) {
        return res.status(400).json({ error: "projectionLayerIndex must be a non-negative integer." });
      }

      const retrieverDimRaw = body["retrieverEmbeddingDim"] ?? body["retriever_embedding_dim"];
      const retrieverEmbeddingDim = optionalFiniteNumber(retrieverDimRaw);
      if (
        retrieverDimRaw !== undefined &&
        retrieverDimRaw !== null &&
        (retrieverEmbeddingDim === null || !Number.isInteger(retrieverEmbeddingDim) || retrieverEmbeddingDim <= 0)
      ) {
        return res.status(400).json({ error: "retrieverEmbeddingDim must be a positive integer (> 0)." });
      }

      const memoryContractRaw = body["memoryContract"] ?? body["memory_contract"];
      const memoryContract =
        memoryContractRaw && typeof memoryContractRaw === "object" && !Array.isArray(memoryContractRaw)
          ? (memoryContractRaw as Record<string, unknown>)
          : null;

      const evalReportRaw = body["evalReport"] ?? body["eval_report"];
      const evalReport =
        evalReportRaw && typeof evalReportRaw === "object" && !Array.isArray(evalReportRaw)
          ? (evalReportRaw as Record<string, unknown>)
          : null;

      const zonotopeCertRaw = body["zonotopeCert"] ?? body["zonotope_cert"];
      const zonotopeCert =
        zonotopeCertRaw && typeof zonotopeCertRaw === "object" && !Array.isArray(zonotopeCertRaw)
          ? (zonotopeCertRaw as Record<string, unknown>)
          : null;

      // Compatibility checks
      const compatibilityCheck: {
        compatible: boolean;
        checkedBaseModelRef: string | null;
        resolvedBaseModel?: { name: string; version: string; kind: ModelRegistryKind } | undefined;
        notes: string[];
      } = {
        compatible: true,
        checkedBaseModelRef: baseModelRef,
        notes: [],
      };

      if (kind === "lora-adapter" && baseModelRef) {
        const baseRow = lookupBaseModelRef(database, baseModelRef);
        if (baseRow) {
          compatibilityCheck.resolvedBaseModel = {
            name: baseRow.name,
            version: baseRow.version,
            kind: baseRow.kind,
          };
          if (baseRow.kind !== "model-core") {
            return res.status(400).json({
              error: `LoRA adapter baseModelRef '${baseModelRef}' resolved to kind '${baseRow.kind}', expected 'model-core'.`,
            });
          }
          if (
            parameterScale &&
            baseRow.parameter_scale &&
            parameterScale.toLowerCase() !== baseRow.parameter_scale.toLowerCase()
          ) {
            return res.status(400).json({
              error: `LoRA adapter parameterScale '${parameterScale}' is incompatible with base model-core '${baseRow.name}@${baseRow.version}' parameterScale '${baseRow.parameter_scale}'.`,
            });
          }
          if (
            retrieverEmbeddingDim !== null &&
            baseRow.retriever_embedding_dim !== null &&
            retrieverEmbeddingDim !== baseRow.retriever_embedding_dim
          ) {
            return res.status(400).json({
              error: `LoRA adapter retrieverEmbeddingDim (${retrieverEmbeddingDim}) does not match base model-core retrieverEmbeddingDim (${baseRow.retriever_embedding_dim}).`,
            });
          }
          compatibilityCheck.notes.push(
            `Validated compatibility against registered model-core '${baseRow.name}@${baseRow.version}'.`,
          );
        } else {
          compatibilityCheck.notes.push(
            `Base model ref '${baseModelRef}' is not registered locally; skipped registry cross-check.`,
          );
        }
      }

      if (kind === "projection-head") {
        if (retrieverEmbeddingDim !== null && retrieverEmbeddingDim <= 0) {
          return res.status(400).json({
            error: "Projection head retrieverEmbeddingDim must be greater than 0.",
          });
        }
        if (baseModelRef) {
          const baseRow = lookupBaseModelRef(database, baseModelRef);
          if (baseRow) {
            compatibilityCheck.resolvedBaseModel = {
              name: baseRow.name,
              version: baseRow.version,
              kind: baseRow.kind,
            };
            if (baseRow.kind !== "model-core") {
              return res.status(400).json({
                error: `Projection head baseModelRef '${baseModelRef}' resolved to kind '${baseRow.kind}', expected 'model-core'.`,
              });
            }
            if (
              retrieverEmbeddingDim !== null &&
              baseRow.retriever_embedding_dim !== null &&
              retrieverEmbeddingDim !== baseRow.retriever_embedding_dim
            ) {
              return res.status(400).json({
                error: `Projection head retrieverEmbeddingDim (${retrieverEmbeddingDim}) does not match base model-core retrieverEmbeddingDim (${baseRow.retriever_embedding_dim}).`,
              });
            }
          }
        }
      }

      const existing = database.db
        .prepare(`SELECT id FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as { id: number } | undefined;
      if (existing) {
        return res.status(409).json({ error: `Model '${name}@${version}' already exists.` });
      }

      const info = database.db
        .prepare(
          `INSERT INTO model_registry_entries (
             name, version, kind, base_model_ref, recipe_name, recipe_version,
             promotion_stage, parameter_scale, lora_rank, projection_layer_index,
             retriever_embedding_dim, memory_contract_json, eval_report_json,
             zonotope_cert_json, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          version,
          kind,
          baseModelRef,
          recipeName,
          recipeVersion,
          parameterScale,
          loraRank,
          projectionLayerIndex,
          retrieverEmbeddingDim,
          memoryContract ? JSON.stringify(memoryContract) : null,
          evalReport ? JSON.stringify(evalReport) : null,
          zonotopeCert ? JSON.stringify(zonotopeCert) : null,
          req.user?.id ?? null,
        );

      const inserted = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE id = ?`)
        .get(Number(info.lastInsertRowid)) as ModelRegistryRow;

      return res.status(201).json({
        model: mapModelRegistryRow(inserted),
        compatibilityCheck,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to register model") });
    }
  });

  /**
   * GET /api/v1/models/:name/:version
   * Returns full certified model card metadata.
   */
  router.get("/:name/:version", optionalAuth, (req: Request, res: Response) => {
    try {
      const name = String(req.params["name"] ?? "").trim();
      const version = String(req.params["version"] ?? "").trim();
      if (!name || !version) {
        return res.status(400).json({ error: "name and version are required." });
      }

      const row = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as ModelRegistryRow | undefined;
      if (!row) {
        return res.status(404).json({ error: `Model '${name}@${version}' not found.` });
      }

      return res.json({ model: mapModelRegistryRow(row) });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to fetch model metadata") });
    }
  });

  /**
   * POST /api/v1/models/:name/:version/promote
   * Formal-Proof-Gated Promotion (`draft -> staging -> production` or `deprecated`).
   */
  router.post("/:name/:version/promote", requireAuth, (req: Request, res: Response) => {
    try {
      const name = String(req.params["name"] ?? "").trim();
      const version = String(req.params["version"] ?? "").trim();
      if (!name || !version) {
        return res.status(400).json({ error: "name and version are required." });
      }

      const row = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as ModelRegistryRow | undefined;
      if (!row) {
        return res.status(404).json({ error: `Model '${name}@${version}' not found.` });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const targetStageRaw =
        typeof body["targetStage"] === "string"
          ? body["targetStage"].trim().toLowerCase()
          : typeof body["stage"] === "string"
            ? body["stage"].trim().toLowerCase()
            : "";

      if (!VALID_PROMOTION_TARGETS.has(targetStageRaw as Exclude<ModelPromotionStage, "draft">)) {
        return res.status(400).json({
          error: "targetStage must be one of: staging, production, deprecated.",
        });
      }
      const targetStage = targetStageRaw as Exclude<ModelPromotionStage, "draft">;

      const storedEvalReport = parseJsonSafe<FormalModelEvalReport | null>(row.eval_report_json, null);
      const bodyEvalReportRaw = body["evalReport"] ?? body["eval_report"];
      const effectiveEvalReport = isFormalEvalReportLike(bodyEvalReportRaw) ? bodyEvalReportRaw : storedEvalReport;

      let regressionDiff: EvalReportRegressionDiff | undefined;

      if (targetStage === "staging" || targetStage === "production") {
        if (!effectiveEvalReport || !isFormalEvalReportLike(effectiveEvalReport)) {
          return res.status(422).json({
            error: `Formal evaluation report is required to promote '${name}@${version}' to '${targetStage}'.`,
            promoted: false,
            failureReasons: ["Missing formal evaluation report (evalReport)."],
          });
        }

        if (effectiveEvalReport.promoted !== true) {
          const failureReasons =
            Array.isArray(effectiveEvalReport.failureReasons) && effectiveEvalReport.failureReasons.length > 0
              ? effectiveEvalReport.failureReasons
              : ["Formal evaluation report did not pass promotion gate (promoted !== true)."];
          return res.status(422).json({
            error: `Formal evaluation gate rejected promotion of '${name}@${version}' to '${targetStage}'.`,
            promoted: false,
            failureReasons,
          });
        }
      }

      if (targetStage === "production" && effectiveEvalReport) {
        const existingProd = database.db
          .prepare(
            `SELECT * FROM model_registry_entries
             WHERE name = ? AND promotion_stage = 'production' AND version != ?
             ORDER BY updated_at DESC, id DESC
             LIMIT 1`,
          )
          .get(name, version) as ModelRegistryRow | undefined;

        if (existingProd && existingProd.eval_report_json) {
          const prevReport = parseJsonSafe<FormalModelEvalReport | null>(existingProd.eval_report_json, null);
          if (prevReport && isFormalEvalReportLike(prevReport)) {
            regressionDiff = diffEvalReports(
              normalizeEvalReportForDiff(prevReport),
              normalizeEvalReportForDiff(effectiveEvalReport),
            );
            if (regressionDiff.flippedPassToFail.length > 0) {
              return res.status(422).json({
                error: `Production promotion blocked: '${name}@${version}' regressed relative to production version '${existingProd.version}'.`,
                promoted: false,
                previousProductionVersion: existingProd.version,
                regressionDiff,
                failureReasons: [
                  `Regressed ${regressionDiff.flippedPassToFail.length} benchmark case(s) from pass to fail: ${regressionDiff.flippedPassToFail.join(", ")}`,
                ],
              });
            }
          }
        }
      }

      const zonotopeCertRaw = body["zonotopeCert"] ?? body["zonotope_cert"];
      const nextZonotopeCertJson =
        zonotopeCertRaw && typeof zonotopeCertRaw === "object"
          ? JSON.stringify(zonotopeCertRaw)
          : row.zonotope_cert_json;

      const nextEvalReportJson =
        bodyEvalReportRaw && typeof bodyEvalReportRaw === "object"
          ? JSON.stringify(bodyEvalReportRaw)
          : row.eval_report_json;

      const nowIso = new Date().toISOString();
      const attestationPayload: Record<string, unknown> = {
        attestationType: "ModelPromotionAttestation",
        modelName: row.name,
        modelVersion: row.version,
        kind: row.kind,
        fromStage: row.promotion_stage,
        toStage: targetStage,
        weightSha256: row.weight_sha256,
        evalSummary: effectiveEvalReport
          ? {
              promoted: effectiveEvalReport.promoted,
              totalCases: effectiveEvalReport.totalCases,
              formalGatePassRate: effectiveEvalReport.formalGatePassRate,
              nonTrivialPassRate: effectiveEvalReport.nonTrivialPassRate,
              rewardHackingRate: effectiveEvalReport.rewardHackingRate,
              diskAnnRecallAtK: effectiveEvalReport.diskAnnRecallAtK,
              ece: effectiveEvalReport.calibration?.ece ?? null,
            }
          : null,
        promotedBy: req.user?.username ?? String(req.user?.id ?? "system"),
        promotedAt: nowIso,
      };

      const privateKeyPem = typeof body["privateKeyPem"] === "string" ? body["privateKeyPem"] : undefined;
      const verificationMethod =
        typeof body["verificationMethod"] === "string" ? body["verificationMethod"] : undefined;

      const signed = signPromotionAttestationEd25519(attestationPayload, {
        privateKeyPem,
        verificationMethod,
        created: nowIso,
      });

      database.db
        .prepare(
          `UPDATE model_registry_entries
           SET promotion_stage = ?,
               eval_report_json = ?,
               zonotope_cert_json = ?,
               ed25519_proof_json = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(targetStage, nextEvalReportJson, nextZonotopeCertJson, JSON.stringify(signed), row.id);

      const updated = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE id = ?`)
        .get(row.id) as ModelRegistryRow;

      return res.json({
        model: mapModelRegistryRow(updated),
        attestation: signed.attestation,
        proof: signed.proof,
        ...(regressionDiff ? { regressionDiff } : {}),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to promote model") });
    }
  });

  /**
   * POST /api/v1/models/:name/:version/weights/upload-chunk
   * Stores an individual base64-encoded weight chunk under
   * `<storageDir>/model-weights/tmp/<uploadId>/<chunkIndex>`.
   */
  router.post("/:name/:version/weights/upload-chunk", requireAuth, (req: Request, res: Response) => {
    try {
      const name = String(req.params["name"] ?? "").trim();
      const version = String(req.params["version"] ?? "").trim();
      const row = database.db
        .prepare(`SELECT id FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as { id: number } | undefined;
      if (!row) {
        return res.status(404).json({ error: `Model '${name}@${version}' not found.` });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const uploadId = typeof body["uploadId"] === "string" ? body["uploadId"].trim() : "";
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(uploadId)) {
        return res.status(400).json({
          error: "uploadId must be 1–128 alphanumeric, '.', '_', or '-' characters.",
        });
      }

      const chunkIndex = optionalFiniteNumber(body["chunkIndex"]);
      if (chunkIndex === null || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100_000) {
        return res.status(400).json({ error: "chunkIndex must be a non-negative integer." });
      }

      const dataBase64 = body["dataBase64"];
      if (typeof dataBase64 !== "string") {
        return res.status(400).json({ error: "dataBase64 string is required." });
      }

      const buf = Buffer.from(dataBase64, "base64");
      const uploadDir = path.resolve(weightsTmpDir, uploadId);
      if (!uploadDir.startsWith(weightsTmpDir + path.sep)) {
        return res.status(400).json({ error: "Invalid uploadId path." });
      }

      fs.mkdirSync(uploadDir, { recursive: true });
      const chunkPath = path.join(uploadDir, String(chunkIndex));
      fs.writeFileSync(chunkPath, buf);

      const chunkSha256 = crypto.createHash("sha256").update(buf).digest("hex");
      return res.status(200).json({
        uploadId,
        chunkIndex,
        chunkBytes: buf.length,
        chunkSha256,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to upload weight chunk") });
    }
  });

  /**
   * POST /api/v1/models/:name/:version/weights/complete
   * Re-assembles chunks in numeric index order into `<storageDir>/model-weights/<safeName>-<version>.bin`,
   * verifies optional `expectedSha256`, and updates `weight_sha256`, `weight_bytes`, `storage_key`.
   */
  router.post("/:name/:version/weights/complete", requireAuth, (req: Request, res: Response) => {
    try {
      const name = String(req.params["name"] ?? "").trim();
      const version = String(req.params["version"] ?? "").trim();
      const row = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as ModelRegistryRow | undefined;
      if (!row) {
        return res.status(404).json({ error: `Model '${name}@${version}' not found.` });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const uploadId = typeof body["uploadId"] === "string" ? body["uploadId"].trim() : "";
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(uploadId)) {
        return res.status(400).json({
          error: "uploadId must be 1–128 alphanumeric, '.', '_', or '-' characters.",
        });
      }

      const expectedSha256Raw = body["expectedSha256"] ?? body["expected_sha256"];
      const expectedSha256 =
        typeof expectedSha256Raw === "string" && expectedSha256Raw.trim()
          ? expectedSha256Raw.trim().toLowerCase()
          : undefined;

      const totalChunksRaw = body["totalChunks"] ?? body["total_chunks"];
      const totalChunks = optionalFiniteNumber(totalChunksRaw);

      const uploadDir = path.resolve(weightsTmpDir, uploadId);
      if (!uploadDir.startsWith(weightsTmpDir + path.sep) || !fs.existsSync(uploadDir)) {
        return res.status(400).json({ error: `No uploaded chunks found for uploadId '${uploadId}'.` });
      }

      const entries = fs.readdirSync(uploadDir).filter((f) => /^\d+$/.test(f));
      if (entries.length === 0) {
        return res.status(400).json({ error: `Upload '${uploadId}' contains zero chunks.` });
      }

      const chunkIndices = entries.map((f) => Number(f)).sort((a, b) => a - b);
      if (totalChunks !== null) {
        if (!Number.isInteger(totalChunks) || totalChunks <= 0 || chunkIndices.length !== totalChunks) {
          return res.status(400).json({
            error: `Expected ${totalChunks} chunks, found ${chunkIndices.length}.`,
          });
        }
        for (let i = 0; i < totalChunks; i++) {
          if (chunkIndices[i] !== i) {
            return res.status(400).json({ error: `Missing chunkIndex ${i} in upload '${uploadId}'.` });
          }
        }
      }

      fs.mkdirSync(weightsBaseDir, { recursive: true });
      const safeName = sanitizePathSegment(name);
      const safeVersion = sanitizePathSegment(version);
      const finalFileName = `${safeName}-${safeVersion}.bin`;
      const finalPath = path.resolve(weightsBaseDir, finalFileName);
      if (!finalPath.startsWith(weightsBaseDir + path.sep)) {
        return res.status(400).json({ error: "Invalid model weight path." });
      }

      const stagingPath = path.resolve(weightsBaseDir, `${finalFileName}.assembling-${uploadId}-${Date.now()}`);
      const hasher = crypto.createHash("sha256");
      let totalBytes = 0;

      const outFd = fs.openSync(stagingPath, "w");
      try {
        for (const idx of chunkIndices) {
          const chunkPath = path.join(uploadDir, String(idx));
          const chunkBuf = fs.readFileSync(chunkPath);
          fs.writeSync(outFd, chunkBuf);
          hasher.update(chunkBuf);
          totalBytes += chunkBuf.length;
        }
      } catch (err) {
        fs.closeSync(outFd);
        fs.rmSync(stagingPath, { force: true });
        throw err;
      }
      fs.closeSync(outFd);

      const actualSha256 = hasher.digest("hex");
      if (expectedSha256 && actualSha256 !== expectedSha256) {
        fs.rmSync(stagingPath, { force: true });
        return res.status(400).json({
          error: "Weight SHA-256 checksum mismatch.",
          expectedSha256,
          actualSha256,
        });
      }

      fs.renameSync(stagingPath, finalPath);
      fs.rmSync(uploadDir, { recursive: true, force: true });

      const storageKey = path.posix.join("model-weights", finalFileName);
      database.db
        .prepare(
          `UPDATE model_registry_entries
           SET weight_sha256 = ?,
               weight_bytes = ?,
               storage_key = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(actualSha256, totalBytes, storageKey, row.id);

      const updated = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE id = ?`)
        .get(row.id) as ModelRegistryRow;

      return res.json({
        model: mapModelRegistryRow(updated),
        weightSha256: actualSha256,
        weightBytes: totalBytes,
        storageKey,
        chunksAssembled: chunkIndices.length,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to complete weight upload") });
    }
  });

  /**
   * GET /api/v1/models/:name/:version/weights
   * Streams model weights with HTTP `Range` (206 Partial Content) support and `ETag` (`weight_sha256`).
   */
  router.get("/:name/:version/weights", optionalAuth, (req: Request, res: Response) => {
    try {
      const name = String(req.params["name"] ?? "").trim();
      const version = String(req.params["version"] ?? "").trim();
      const row = database.db
        .prepare(`SELECT * FROM model_registry_entries WHERE name = ? AND version = ?`)
        .get(name, version) as ModelRegistryRow | undefined;
      if (!row) {
        return res.status(404).json({ error: `Model '${name}@${version}' not found.` });
      }
      if (!row.storage_key) {
        return res.status(404).json({ error: `Model '${name}@${version}' has no uploaded weights.` });
      }

      const absPath = path.resolve(resolvedStorageDir, row.storage_key);
      if (!absPath.startsWith(resolvedStorageDir + path.sep) || !fs.existsSync(absPath)) {
        return res.status(404).json({ error: "Model weight file missing on storage." });
      }

      const stat = fs.statSync(absPath);
      const total = stat.size;
      const etag = row.weight_sha256 ? `"${row.weight_sha256}"` : undefined;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "application/octet-stream");
      if (etag) {
        res.setHeader("ETag", etag);
        res.setHeader("X-Model-Weight-Sha256", row.weight_sha256!);
      }

      const rangeHeader = req.headers.range;
      if (!rangeHeader && etag && req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (!match) {
          res.setHeader("Content-Range", `bytes */${total}`);
          return res.status(416).end();
        }
        const startStr = match[1] ?? "";
        const endStr = match[2] ?? "";
        let start: number;
        let end: number;

        if (startStr === "" && endStr !== "") {
          const suffixLen = Number(endStr);
          if (!Number.isFinite(suffixLen) || suffixLen <= 0 || total === 0) {
            res.setHeader("Content-Range", `bytes */${total}`);
            return res.status(416).end();
          }
          start = Math.max(0, total - suffixLen);
          end = total - 1;
        } else {
          start = startStr ? Number(startStr) : 0;
          end = endStr ? Math.min(total - 1, Number(endStr)) : total - 1;
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= total) {
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
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to stream model weights") });
    }
  });

  return router;
}
