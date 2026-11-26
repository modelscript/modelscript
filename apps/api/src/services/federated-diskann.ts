// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Federated DiskANN Query Coordinator & Ed25519 Signed Dataset Manifest Service.
 *
 * Implements Tier 3 Federation primitives for Ansatz nodes:
 *   1. Cryptographic Ed25519 (`eddsa-jcs-2022`) signing & verification for
 *      `dataset-pretrain`, `dataset-posttrain`, and `training-recipe` manifests.
 *   2. Federated DiskANN fan-out retrieval across trusted peer Ansatz instances
 *      with strict `tenantScope: "public"` isolation, `chunkId` deduplication,
 *      `originInstance` attribution, and per-peer latency telemetry.
 */

import type { MemoryChunkResult, MemoryQueryRequest } from "@modelscript/runtime";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { assertSafePublicUrl } from "../util/ssrf.js";
import type { DiskAnnMemoryService } from "./diskann-memory.js";
import { decodeMultibase, encodeMultibase } from "./git-sync/base58.js";
import { canonicalizeJson } from "./git-sync/jcs.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);

export const SIGNED_DATASET_KINDS = ["dataset-pretrain", "dataset-posttrain", "training-recipe"] as const;

export type SignedDatasetKind = (typeof SIGNED_DATASET_KINDS)[number];

export interface DatasetSigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyMultibase: string;
  fingerprintSha256: string;
}

export interface DatasetManifestShardEntry {
  shardId: string;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
  downloadUrl?: string | undefined;
}

export interface DatasetManifestPayload {
  datasetKind: SignedDatasetKind;
  recipeName: string;
  recipeVersion: string;
  originInstance?: string | undefined;
  shards?: DatasetManifestShardEntry[] | undefined;
  sourceLockfile?: Record<string, string> | undefined;
  formalCertSummary?:
    | {
        gate1?: boolean | undefined;
        gate2?: boolean | undefined;
        gate3?: boolean | undefined;
        gate4?: boolean | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface DatasetManifestProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  publicKeyMultibase: string;
  publicKeyPem: string;
  payloadSha256: string;
  proofValue: string;
}

export interface SignedDatasetManifest {
  manifest: DatasetManifestPayload;
  proof: DatasetManifestProof;
}

export interface SignDatasetManifestOptions {
  privateKeyPem?: string | crypto.KeyObject | undefined;
  verificationMethod?: string | undefined;
  created?: string | undefined;
}

export interface VerifyDatasetManifestOptions {
  expectedPublicKeyPem?: string | crypto.KeyObject | undefined;
  expectedPublicKeyMultibase?: string | undefined;
  trustedPublicKeys?: string[] | undefined;
}

export interface DatasetManifestVerificationResult {
  valid: boolean;
  error?: string | undefined;
  datasetKind?: SignedDatasetKind | undefined;
  payloadSha256?: string | undefined;
  publicKeyMultibase?: string | undefined;
  verificationMethod?: string | undefined;
}

function isValidSignedDatasetKind(kind: unknown): kind is SignedDatasetKind {
  return typeof kind === "string" && (SIGNED_DATASET_KINDS as readonly string[]).includes(kind);
}

function extractRawEd25519PublicKey(pubKeyObj: crypto.KeyObject): Buffer {
  if (pubKeyObj.asymmetricKeyType !== "ed25519") {
    throw new Error(`Expected Ed25519 key, got '${String(pubKeyObj.asymmetricKeyType)}'`);
  }
  const spkiDer = pubKeyObj.export({ type: "spki", format: "der" });
  if (spkiDer.length !== ED25519_SPKI_PREFIX.length + 32) {
    throw new Error("Unexpected Ed25519 SPKI DER length");
  }
  return Buffer.from(spkiDer.subarray(ED25519_SPKI_PREFIX.length));
}

function publicKeyFromMultibase(publicKeyMultibase: string): crypto.KeyObject {
  const decoded = decodeMultibase(publicKeyMultibase);
  const rawPub32 = decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01 ? decoded.subarray(2) : decoded;
  if (rawPub32.length !== 32) {
    throw new Error("Invalid Ed25519 multibase public key length");
  }
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(rawPub32)]);
  return crypto.createPublicKey({ key: spkiDer, format: "der", type: "spki" });
}

function publicKeyToMultibase(pubKeyObj: crypto.KeyObject): string {
  const rawPub32 = extractRawEd25519PublicKey(pubKeyObj);
  return encodeMultibase(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPub32]));
}

function sanitizeManifestForCanonicalization(manifest: DatasetManifestPayload): DatasetManifestPayload {
  const copy = { ...manifest };
  delete copy["proof"];
  return copy;
}

/**
 * Generates a fresh Ed25519 keypair formatted for dataset manifest signing and W3C Multikey verification.
 */
export function generateDatasetSigningKeyPair(): DatasetSigningKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const rawPub32 = extractRawEd25519PublicKey(publicKey);
  const publicKeyMultibase = encodeMultibase(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPub32]));
  const fingerprintSha256 = crypto.createHash("sha256").update(rawPub32).digest("hex");
  return {
    privateKeyPem,
    publicKeyPem,
    publicKeyMultibase,
    fingerprintSha256,
  };
}

let cachedDefaultKeyPair: DatasetSigningKeyPair | null = null;
const cachedDbKeyPairs = new WeakMap<LibraryDatabase, DatasetSigningKeyPair>();

/**
 * Returns the node's default Ed25519 dataset manifest signing keypair, loading from:
 *   1. `FEDERATED_DATASET_SIGNING_PRIVATE_KEY_PEM` environment variable if configured,
 *   2. `persistent_signing_keys` table in `database` (surviving process restarts), or
 *   3. Lazily generating and persisting a new Ed25519 keypair into `persistent_signing_keys`.
 */
export function getDefaultDatasetSigningKeyPair(
  database?: LibraryDatabase,
  keyPurpose = "federated-dataset-signing",
): DatasetSigningKeyPair {
  const envPriv = process.env["FEDERATED_DATASET_SIGNING_PRIVATE_KEY_PEM"]?.trim();
  if (envPriv) {
    const privObj = crypto.createPrivateKey(envPriv);
    const pubObj = crypto.createPublicKey(privObj);
    const rawPub32 = extractRawEd25519PublicKey(pubObj);
    return {
      privateKeyPem: privObj.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKeyPem: pubObj.export({ type: "spki", format: "pem" }).toString(),
      publicKeyMultibase: encodeMultibase(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPub32])),
      fingerprintSha256: crypto.createHash("sha256").update(rawPub32).digest("hex"),
    };
  }

  if (database && database.isOpen()) {
    const cachedForDb = cachedDbKeyPairs.get(database);
    if (cachedForDb && keyPurpose === "federated-dataset-signing") {
      return cachedForDb;
    }
    try {
      const row = database.db
        .prepare(
          `SELECT private_key_pem, public_key_pem, public_key_multibase, fingerprint_sha256
           FROM persistent_signing_keys WHERE key_purpose = ?`,
        )
        .get(keyPurpose) as
        | {
            private_key_pem: string;
            public_key_pem: string;
            public_key_multibase: string;
            fingerprint_sha256: string;
          }
        | undefined;
      if (row) {
        const pair: DatasetSigningKeyPair = {
          privateKeyPem: row.private_key_pem,
          publicKeyPem: row.public_key_pem,
          publicKeyMultibase: row.public_key_multibase,
          fingerprintSha256: row.fingerprint_sha256,
        };
        if (keyPurpose === "federated-dataset-signing") {
          cachedDbKeyPairs.set(database, pair);
        }
        return pair;
      }

      const fresh = generateDatasetSigningKeyPair();
      database.db
        .prepare(
          `INSERT OR IGNORE INTO persistent_signing_keys (
             key_purpose, algorithm, private_key_pem, public_key_pem, public_key_multibase, fingerprint_sha256
           ) VALUES (?, 'ed25519', ?, ?, ?, ?)`,
        )
        .run(keyPurpose, fresh.privateKeyPem, fresh.publicKeyPem, fresh.publicKeyMultibase, fresh.fingerprintSha256);
      if (keyPurpose === "federated-dataset-signing") {
        cachedDbKeyPairs.set(database, fresh);
      }
      return fresh;
    } catch {
      // Fallback to in-memory cache if table does not exist in isolated unit tests
    }
  }

  if (!cachedDefaultKeyPair) {
    cachedDefaultKeyPair = generateDatasetSigningKeyPair();
  }
  return cachedDefaultKeyPair;
}

/**
 * Cryptographically signs a `dataset-pretrain`, `dataset-posttrain`, or `training-recipe`
 * manifest using Ed25519 + RFC 8785 JCS (`eddsa-jcs-2022`), matching `federation-signing.ts`.
 */
export function signDatasetManifestEd25519(
  manifest: DatasetManifestPayload,
  options?: SignDatasetManifestOptions,
): SignedDatasetManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Dataset manifest object is required.");
  }
  if (!isValidSignedDatasetKind(manifest.datasetKind)) {
    throw new Error(
      `Invalid datasetKind '${String(manifest.datasetKind)}'. Must be one of: ${SIGNED_DATASET_KINDS.join(", ")}.`,
    );
  }
  if (typeof manifest.recipeName !== "string" || !manifest.recipeName.trim()) {
    throw new Error("Manifest recipeName is required.");
  }
  if (typeof manifest.recipeVersion !== "string" || !manifest.recipeVersion.trim()) {
    throw new Error("Manifest recipeVersion is required.");
  }

  const privKeyObj = options?.privateKeyPem
    ? typeof options.privateKeyPem === "string"
      ? crypto.createPrivateKey(options.privateKeyPem)
      : options.privateKeyPem
    : crypto.createPrivateKey(getDefaultDatasetSigningKeyPair().privateKeyPem);

  if (privKeyObj.asymmetricKeyType !== "ed25519") {
    throw new Error(`Unsupported signing key type '${String(privKeyObj.asymmetricKeyType)}'; expected 'ed25519'.`);
  }

  const pubKeyObj = crypto.createPublicKey(privKeyObj);
  const publicKeyMultibase = publicKeyToMultibase(pubKeyObj);
  const publicKeyPem = pubKeyObj.export({ type: "spki", format: "pem" }).toString();

  const cleanManifest = sanitizeManifestForCanonicalization(manifest);
  const canonicalManifest = canonicalizeJson(cleanManifest);
  const docHash = crypto.createHash("sha256").update(canonicalManifest, "utf8").digest();

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
  const proofValue = encodeMultibase(signatureBytes);

  return {
    manifest: cleanManifest,
    proof: {
      ...proofConfig,
      publicKeyMultibase,
      publicKeyPem,
      payloadSha256: docHash.toString("hex"),
      proofValue,
    },
  };
}

/**
 * Verifies an Ed25519 (`eddsa-jcs-2022`) signed dataset manifest, rejecting payload tampering,
 * proof metadata mutation, unsupported dataset kinds, key mismatches, or untrusted signers.
 */
export function verifyDatasetManifestEd25519(
  signed: { manifest?: DatasetManifestPayload | undefined; proof?: Partial<DatasetManifestProof> | undefined },
  options?: VerifyDatasetManifestOptions,
): DatasetManifestVerificationResult {
  if (!signed || typeof signed !== "object") {
    return { valid: false, error: "Signed dataset manifest payload is required." };
  }
  const { manifest, proof } = signed;
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, error: "Missing dataset manifest object." };
  }
  if (!isValidSignedDatasetKind(manifest.datasetKind)) {
    return {
      valid: false,
      error: `Unsupported datasetKind '${String(manifest.datasetKind)}'. Expected one of: ${SIGNED_DATASET_KINDS.join(", ")}.`,
    };
  }
  if (!proof || typeof proof !== "object") {
    return { valid: false, error: "Missing cryptographic proof object." };
  }
  if (proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022") {
    return { valid: false, error: `Unsupported cryptosuite '${String(proof.cryptosuite)}'.` };
  }
  if (proof.proofPurpose !== "assertionMethod") {
    return { valid: false, error: `Invalid proofPurpose '${String(proof.proofPurpose)}'.` };
  }
  if (typeof proof.proofValue !== "string" || !proof.proofValue.startsWith("z")) {
    return { valid: false, error: "Invalid proofValue format (must be multibase base58btc starting with 'z')." };
  }
  if (typeof proof.created !== "string" || !proof.created.trim()) {
    return { valid: false, error: "Missing proof creation timestamp." };
  }
  if (typeof proof.verificationMethod !== "string" || !proof.verificationMethod.trim()) {
    return { valid: false, error: "Missing proof verificationMethod." };
  }

  try {
    let pubKeyObj: crypto.KeyObject | null = null;

    if (options?.expectedPublicKeyPem) {
      pubKeyObj =
        typeof options.expectedPublicKeyPem === "string"
          ? crypto.createPublicKey(options.expectedPublicKeyPem)
          : options.expectedPublicKeyPem;
    } else if (options?.expectedPublicKeyMultibase) {
      pubKeyObj = publicKeyFromMultibase(options.expectedPublicKeyMultibase);
    } else if (typeof proof.publicKeyMultibase === "string" && proof.publicKeyMultibase.startsWith("z")) {
      pubKeyObj = publicKeyFromMultibase(proof.publicKeyMultibase);
    } else if (typeof proof.publicKeyPem === "string" && proof.publicKeyPem.trim()) {
      pubKeyObj = crypto.createPublicKey(proof.publicKeyPem);
    }

    if (!pubKeyObj) {
      return { valid: false, error: "No Ed25519 public key provided for verification." };
    }

    const resolvedMultibase = publicKeyToMultibase(pubKeyObj);
    const resolvedPem = pubKeyObj.export({ type: "spki", format: "pem" }).toString();

    // Ensure embedded public key fields (if both supplied) are consistent with the verification key
    if (proof.publicKeyMultibase && proof.publicKeyMultibase !== resolvedMultibase) {
      return { valid: false, error: "Proof publicKeyMultibase does not match expected signing key." };
    }
    if (proof.publicKeyPem) {
      const proofPemObj = crypto.createPublicKey(proof.publicKeyPem);
      if (publicKeyToMultibase(proofPemObj) !== resolvedMultibase) {
        return { valid: false, error: "Proof publicKeyPem does not match expected signing key." };
      }
    }

    // Optional allowlist of trusted peer public keys (multibase or PEM)
    if (options?.trustedPublicKeys && options.trustedPublicKeys.length > 0) {
      const trusted = options.trustedPublicKeys.some((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return false;
        if (trimmed === resolvedMultibase || trimmed === resolvedPem.trim()) return true;
        try {
          const parsed = trimmed.startsWith("z") ? publicKeyFromMultibase(trimmed) : crypto.createPublicKey(trimmed);
          return publicKeyToMultibase(parsed) === resolvedMultibase;
        } catch {
          return false;
        }
      });
      if (!trusted) {
        return { valid: false, error: "Manifest signer key is not in trustedPublicKeys allowlist." };
      }
    }

    const cleanManifest = sanitizeManifestForCanonicalization(manifest);
    const canonicalManifest = canonicalizeJson(cleanManifest);
    const docHash = crypto.createHash("sha256").update(canonicalManifest, "utf8").digest();
    const computedSha256 = docHash.toString("hex");

    if (typeof proof.payloadSha256 === "string" && proof.payloadSha256 !== computedSha256) {
      return { valid: false, error: "Manifest SHA-256 digest mismatch (tampered payload)." };
    }

    const proofConfig = {
      type: proof.type,
      cryptosuite: proof.cryptosuite,
      created: proof.created,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
    };
    const configHash = crypto.createHash("sha256").update(canonicalizeJson(proofConfig), "utf8").digest();
    const signingData = Buffer.concat([configHash, docHash]);
    const sigBytes = decodeMultibase(proof.proofValue);

    const isValid = crypto.verify(null, signingData, pubKeyObj, sigBytes);
    if (!isValid) {
      return { valid: false, error: "Ed25519 cryptographic signature verification failed." };
    }

    return {
      valid: true,
      datasetKind: manifest.datasetKind,
      payloadSha256: computedSha256,
      publicKeyMultibase: resolvedMultibase,
      verificationMethod: proof.verificationMethod,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Manifest verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Federated DiskANN Coordinator
// ─────────────────────────────────────────────────────────────────────────────

export interface FederatedMemoryPeer {
  peerUrl: string;
  label?: string | undefined;
  publicKeyMultibase?: string | undefined;
  enabled: boolean;
  addedAt: string;
  lastSeenAt?: string | undefined;
  lastLatencyMs?: number | undefined;
}

interface FederatedPeerDbRow {
  peer_url: string;
  label: string | null;
  public_key_multibase: string | null;
  enabled: number;
  added_at: string;
  last_seen_at: string | null;
  last_latency_ms: number | null;
}

export interface FederatedMemoryChunkResult extends MemoryChunkResult {
  originInstance: string;
}

export interface FederatedPeerQueryStatus {
  peerUrl: string;
  label?: string | undefined;
  status: "ok" | "error" | "timeout";
  latencyMs: number;
  returnedChunks: number;
  error?: string | undefined;
}

export interface FederatedMemoryQueryRequest extends MemoryQueryRequest {
  /** Optional subset of registered trusted peer URLs to query. */
  peerUrls?: string[] | undefined;
  /** Per-peer timeout in milliseconds (default: 4000). */
  peerTimeoutMs?: number | undefined;
}

export interface FederatedMemoryQueryResponse {
  backend: "diskann-federated";
  localInstance: string;
  enforcedTenantScope: "public";
  latencyMs: number;
  localLatencyMs: number;
  peersQueried: number;
  peerStats: FederatedPeerQueryStatus[];
  chunks: FederatedMemoryChunkResult[];
}

export interface FederatedDiskAnnCoordinatorOptions {
  localInstanceId?: string | undefined;
  peerTimeoutMs?: number | undefined;
  allowLocalPeers?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class FederatedDiskAnnCoordinator {
  private readonly localInstanceId: string;
  private readonly defaultPeerTimeoutMs: number;
  private readonly allowLocalPeers: boolean;
  private readonly fetchImpl: typeof fetch;
  private tableInitialized = false;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly localMemory: DiskAnnMemoryService,
    options?: FederatedDiskAnnCoordinatorOptions,
  ) {
    this.localInstanceId = (options?.localInstanceId ?? process.env["PUBLIC_URL"] ?? "local")
      .trim()
      .replace(/\/+$/, "");
    this.defaultPeerTimeoutMs = Math.max(250, options?.peerTimeoutMs ?? 4_000);
    this.allowLocalPeers =
      options?.allowLocalPeers ??
      (process.env["NODE_ENV"] === "test" || process.env["ALLOW_LOCAL_FEDERATED_PEERS"] === "true");
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  }

  public getLocalInstanceId(): string {
    return this.localInstanceId;
  }

  private ensureTable(): void {
    if (this.tableInitialized) return;
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS federated_memory_peers (
        peer_url TEXT PRIMARY KEY,
        label TEXT,
        public_key_multibase TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT,
        last_latency_ms REAL
      );
    `);
    this.tableInitialized = true;
  }

  public normalizeAndValidatePeerUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new Error("peerUrl is required.");
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("Invalid peerUrl format.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported peerUrl protocol '${parsed.protocol}'.`);
    }
    if (parsed.username || parsed.password) {
      throw new Error("peerUrl must not contain embedded credentials.");
    }
    const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    if (!this.allowLocalPeers) {
      assertSafePublicUrl(normalized);
    }
    return normalized;
  }

  public listPeers(includeDisabled = true): FederatedMemoryPeer[] {
    this.ensureTable();
    const sql = includeDisabled
      ? `SELECT * FROM federated_memory_peers ORDER BY added_at ASC, peer_url ASC`
      : `SELECT * FROM federated_memory_peers WHERE enabled = 1 ORDER BY added_at ASC, peer_url ASC`;
    const rows = this.database.db.prepare(sql).all() as FederatedPeerDbRow[];
    return rows.map((row) => ({
      peerUrl: row.peer_url,
      ...(row.label ? { label: row.label } : {}),
      ...(row.public_key_multibase ? { publicKeyMultibase: row.public_key_multibase } : {}),
      enabled: row.enabled === 1,
      addedAt: row.added_at,
      ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
      ...(row.last_latency_ms != null ? { lastLatencyMs: row.last_latency_ms } : {}),
    }));
  }

  public addPeer(input: {
    peerUrl: string;
    label?: string | undefined;
    publicKeyMultibase?: string | undefined;
    enabled?: boolean | undefined;
  }): FederatedMemoryPeer {
    this.ensureTable();
    const normalizedUrl = this.normalizeAndValidatePeerUrl(input.peerUrl);
    const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : null;
    const pubKey =
      typeof input.publicKeyMultibase === "string" && input.publicKeyMultibase.trim()
        ? input.publicKeyMultibase.trim()
        : null;
    const enabled = input.enabled === false ? 0 : 1;

    this.database.db
      .prepare(
        `
        INSERT INTO federated_memory_peers (peer_url, label, public_key_multibase, enabled)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(peer_url) DO UPDATE SET
          label = COALESCE(excluded.label, federated_memory_peers.label),
          public_key_multibase = COALESCE(excluded.public_key_multibase, federated_memory_peers.public_key_multibase),
          enabled = excluded.enabled
        `,
      )
      .run(normalizedUrl, label, pubKey, enabled);

    const row = this.database.db
      .prepare(`SELECT * FROM federated_memory_peers WHERE peer_url = ?`)
      .get(normalizedUrl) as FederatedPeerDbRow;

    return {
      peerUrl: row.peer_url,
      ...(row.label ? { label: row.label } : {}),
      ...(row.public_key_multibase ? { publicKeyMultibase: row.public_key_multibase } : {}),
      enabled: row.enabled === 1,
      addedAt: row.added_at,
      ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
      ...(row.last_latency_ms != null ? { lastLatencyMs: row.last_latency_ms } : {}),
    };
  }

  public removePeer(peerUrl: string): boolean {
    this.ensureTable();
    const normalized = peerUrl.trim().replace(/\/+$/, "");
    const info = this.database.db.prepare(`DELETE FROM federated_memory_peers WHERE peer_url = ?`).run(normalized);
    return Number(info.changes) > 0;
  }

  /**
   * Executes a federated DiskANN fan-out query across the local DiskANN index and all
   * enabled trusted peer Ansatz nodes.
   *
   * SECURITY INVARIANT:
   *   Both local federated retrieval and outbound peer requests strictly enforce
   *   `tenantScope: "public"`. Private `org` or `private` chunks and caller org/auth
   *   headers are NEVER queried or transmitted across federation boundaries.
   */
  public async queryFederated(req: FederatedMemoryQueryRequest): Promise<FederatedMemoryQueryResponse> {
    const startHr = performance.now();
    this.ensureTable();

    const topK = Math.min(50, Math.max(1, req.topK ?? 6));
    const peerTimeoutMs = Math.max(250, req.peerTimeoutMs ?? this.defaultPeerTimeoutMs);

    // Build a strictly sanitized public-only MemoryQueryRequest (never forwards private org scope)
    const sanitizedPublicQuery: MemoryQueryRequest = {
      mode: req.mode === "latent" ? "latent" : "hybrid",
      ...(req.mode === "latent" && Array.isArray(req.latentVector) ? { latentVector: req.latentVector } : {}),
      ...(req.mode !== "latent" && typeof req.textQuery === "string" ? { textQuery: req.textQuery } : {}),
      ...(req.embedderId ? { embedderId: req.embedderId } : {}),
      ...(req.embedderHash ? { embedderHash: req.embedderHash } : {}),
      ...(req.packagePins ? { packagePins: req.packagePins } : {}),
      ...(req.dialects ? { dialects: req.dialects } : {}),
      ...(req.includeSocialPosts !== undefined ? { includeSocialPosts: req.includeSocialPosts } : {}),
      topK,
      tenantScope: "public",
    };

    // 1. Query local DiskANN strictly within public scope (no caller orgId passed)
    const localResponse = this.localMemory.query(sanitizedPublicQuery, {});
    const mergedByChunkId = new Map<string, FederatedMemoryChunkResult>();

    for (const chunk of localResponse.chunks) {
      mergedByChunkId.set(chunk.chunkId, {
        ...chunk,
        originNode: this.localInstanceId,
        originInstance: this.localInstanceId,
      });
    }

    // 2. Select enabled trusted peers (optionally narrowed by requested peerUrls subset)
    let peers = this.listPeers(false);
    if (Array.isArray(req.peerUrls) && req.peerUrls.length > 0) {
      const requestedSet = new Set(req.peerUrls.map((u) => u.trim().replace(/\/+$/, "")));
      peers = peers.filter((p) => requestedSet.has(p.peerUrl));
    }

    // 3. Fan out POST <peer>/api/v1/memory/query in parallel with strict public-only payload
    const peerPromises = peers.map(
      async (
        peer,
      ): Promise<{
        status: FederatedPeerQueryStatus;
        chunks: FederatedMemoryChunkResult[];
      }> => {
        const peerStart = performance.now();
        const targetUrl = `${peer.peerUrl}/api/v1/memory/query`;
        try {
          if (!this.allowLocalPeers) {
            assertSafePublicUrl(targetUrl);
          }
          const res = await this.fetchImpl(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Ansatz-Federation": "diskann-public-v1",
            },
            body: JSON.stringify(sanitizedPublicQuery),
            signal: AbortSignal.timeout(peerTimeoutMs),
          });

          const peerLatencyMs = Number((performance.now() - peerStart).toFixed(3));
          if (!res.ok) {
            return {
              status: {
                peerUrl: peer.peerUrl,
                ...(peer.label ? { label: peer.label } : {}),
                status: "error",
                latencyMs: peerLatencyMs,
                returnedChunks: 0,
                error: `HTTP ${res.status}`,
              },
              chunks: [],
            };
          }

          const body = (await res.json()) as { chunks?: unknown };
          const rawChunks = Array.isArray(body?.chunks) ? body.chunks : [];
          const sanitizedChunks: FederatedMemoryChunkResult[] = [];

          for (const item of rawChunks) {
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            // Defense-in-depth: drop any chunk claiming non-public tenantScope
            if (typeof rec["tenantScope"] === "string" && rec["tenantScope"] !== "public") {
              continue;
            }
            if (typeof rec["chunkId"] !== "string" || typeof rec["content"] !== "string") {
              continue;
            }
            const score = Number(rec["score"]);
            if (!Number.isFinite(score)) continue;

            sanitizedChunks.push({
              chunkId: rec["chunkId"],
              sourceKind: (typeof rec["sourceKind"] === "string"
                ? rec["sourceKind"]
                : "package-doc") as MemoryChunkResult["sourceKind"],
              sourceUri:
                typeof rec["sourceUri"] === "string" ? rec["sourceUri"] : `${peer.peerUrl}/chunk/${rec["chunkId"]}`,
              ...(typeof rec["packageName"] === "string" ? { packageName: rec["packageName"] } : {}),
              ...(typeof rec["packageVersion"] === "string" ? { packageVersion: rec["packageVersion"] } : {}),
              ...(typeof rec["dialect"] === "string" ? { dialect: rec["dialect"] } : {}),
              score: Number(score.toFixed(4)),
              content: rec["content"],
              formalVerified: Boolean(rec["formalVerified"]),
              symbolTags: Array.isArray(rec["symbolTags"])
                ? rec["symbolTags"].filter((t): t is string => typeof t === "string")
                : [],
              originNode: peer.peerUrl,
              originInstance: peer.peerUrl,
            });
          }

          try {
            if (this.database.isOpen()) {
              this.database.db
                .prepare(
                  `UPDATE federated_memory_peers SET last_seen_at = datetime('now'), last_latency_ms = ? WHERE peer_url = ?`,
                )
                .run(peerLatencyMs, peer.peerUrl);
            }
          } catch {
            // Best-effort telemetry update
          }

          return {
            status: {
              peerUrl: peer.peerUrl,
              ...(peer.label ? { label: peer.label } : {}),
              status: "ok",
              latencyMs: peerLatencyMs,
              returnedChunks: sanitizedChunks.length,
            },
            chunks: sanitizedChunks,
          };
        } catch (err) {
          const peerLatencyMs = Number((performance.now() - peerStart).toFixed(3));
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          return {
            status: {
              peerUrl: peer.peerUrl,
              ...(peer.label ? { label: peer.label } : {}),
              status: isTimeout ? "timeout" : "error",
              latencyMs: peerLatencyMs,
              returnedChunks: 0,
              error: err instanceof Error ? err.message : String(err),
            },
            chunks: [],
          };
        }
      },
    );

    const settled = await Promise.all(peerPromises);
    const peerStats: FederatedPeerQueryStatus[] = [];

    for (const outcome of settled) {
      peerStats.push(outcome.status);
      for (const chunk of outcome.chunks) {
        const existing = mergedByChunkId.get(chunk.chunkId);
        // Deduplicate by chunkId; retain highest-scoring copy (preferring local on ties)
        if (!existing || chunk.score > existing.score) {
          mergedByChunkId.set(chunk.chunkId, chunk);
        }
      }
    }

    const mergedChunks = Array.from(mergedByChunkId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const totalLatencyMs = Number((performance.now() - startHr).toFixed(3));

    return {
      backend: "diskann-federated",
      localInstance: this.localInstanceId,
      enforcedTenantScope: "public",
      latencyMs: totalLatencyMs,
      localLatencyMs: localResponse.latencyMs,
      peersQueried: peers.length,
      peerStats,
      chunks: mergedChunks,
    };
  }
}
