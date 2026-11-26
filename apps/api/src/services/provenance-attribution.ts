// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Merkle-SLSA Provenance DAG, Three-Layer Attribution Engine & Creator Royalty Ledger.
 *
 * Implements:
 *   1. Content-addressed `provenance_nodes` signed with the instance's persistent Ed25519 key.
 *   2. Signed `ai_retrieval_receipts` recording DiskANN chunk contributions weighted by Δ_t reduction.
 *   3. Normalized `attribution_weights` (`structural`, `retrieval_delta`, `lora_datainf`, `rlhf_trust`).
 *   4. Automated royalty splits & RLHF campaign bounty settlement into `attribution_royalty_ledger`
 *      and `BillingRepository` (`credit_transactions`).
 *   5. Cryptographic revocation cascades across DiskANN chunks, overlay patches, and LoRA adapters.
 */

import type { AiGovernancePolicy, MemoryChunkResult } from "@modelscript/runtime";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import type { DiskAnnMemoryService } from "./diskann-memory.js";
import { getDefaultDatasetSigningKeyPair } from "./federated-diskann.js";
import { encodeMultibase } from "./git-sync/base58.js";
import { canonicalizeJson } from "./git-sync/jcs.js";

export type ProvenanceNodeKind =
  | "source-commit"
  | "package-release"
  | "social-post"
  | "verified-fix"
  | "rlhf-annotation"
  | "overlay-patch"
  | "dataset-shard"
  | "memory-shard"
  | "training-run"
  | "model-weights"
  | "eval-attestation"
  | "wam-fmu";

export type AttributionMethod = "structural" | "retrieval_delta" | "lora_datainf" | "rlhf_trust";

export type RoyaltyReason =
  "retrieval_receipt" | "shard_royalty" | "campaign_bounty" | "fix_it_bounty" | "recipe_royalty" | "model_royalty";

export interface RecordProvenanceNodeInput {
  nodeKind: ProvenanceNodeKind;
  refId: string;
  parentCids?: string[] | undefined;
  authorUserId?: number | null | undefined;
  orgId?: number | null | undefined;
  governance?: Partial<AiGovernancePolicy> & {
    royaltyBps?: number | undefined;
    licenseTier?: "open-attribution" | "commercial-revshare" | "org-private" | undefined;
  };
}

export interface ProvenanceNodeRecord {
  cid: string;
  nodeKind: ProvenanceNodeKind;
  refId: string;
  parentCids: string[];
  authorUserId: number | null;
  orgId: number | null;
  governance: Record<string, unknown>;
  ed25519Sig: string;
  signerPubkey: string;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}

export interface RetrievalReceiptRecord {
  receiptId: string;
  traceId: string;
  chunkId: string;
  authorUserId: number | null;
  packageName: string | null;
  sourceUri: string;
  similarityScore: number;
  deltaTReduction: number;
  receiptSig: string;
}

function signCanonicalBytes(
  database: LibraryDatabase,
  payload: Record<string, unknown>,
): {
  sig: string;
  signerPubkey: string;
} {
  const kp = getDefaultDatasetSigningKeyPair(database);
  const privObj = crypto.createPrivateKey(kp.privateKeyPem);
  const canonical = canonicalizeJson(payload);
  const digest = crypto.createHash("sha256").update(canonical, "utf8").digest();
  const sig = encodeMultibase(crypto.sign(null, digest, privObj));
  return { sig, signerPubkey: kp.publicKeyMultibase };
}

/**
 * Records an immutable, content-addressed, Ed25519-signed node in the Merkle-SLSA provenance DAG.
 */
export function recordProvenanceNode(
  database: LibraryDatabase,
  input: RecordProvenanceNodeInput,
): ProvenanceNodeRecord {
  const parentCids = Array.from(new Set((input.parentCids ?? []).filter(Boolean))).sort();
  const governance = input.governance ?? {};
  const cidPayload = {
    nodeKind: input.nodeKind,
    refId: input.refId,
    parentCids,
    authorUserId: input.authorUserId ?? null,
    orgId: input.orgId ?? null,
    governance,
  };
  const cid =
    "cid:msx:" + crypto.createHash("sha256").update(canonicalizeJson(cidPayload), "utf8").digest("hex").slice(0, 40);
  const { sig, signerPubkey } = signCanonicalBytes(database, { cid, ...cidPayload });

  database.db
    .prepare(
      `INSERT OR IGNORE INTO provenance_nodes (
         cid, node_kind, ref_id, parent_cids_json, author_user_id, org_id,
         governance_json, ed25519_sig, signer_pubkey
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      cid,
      input.nodeKind,
      input.refId,
      JSON.stringify(parentCids),
      input.authorUserId ?? null,
      input.orgId ?? null,
      JSON.stringify(governance),
      sig,
      signerPubkey,
    );

  return {
    cid,
    nodeKind: input.nodeKind,
    refId: input.refId,
    parentCids,
    authorUserId: input.authorUserId ?? null,
    orgId: input.orgId ?? null,
    governance,
    ed25519Sig: sig,
    signerPubkey,
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Issues signed `ai_retrieval_receipts` for DiskANN chunks retrieved during a chat turn,
 * attributing uncertainty reduction Δ_t_before - Δ_t_after across chunks by score share.
 */
export function issueRetrievalReceipts(
  database: LibraryDatabase,
  options: {
    traceId: string;
    chunks: MemoryChunkResult[];
    deltaTBefore?: number | undefined;
    deltaTAfter?: number | undefined;
    diskann?: DiskAnnMemoryService | undefined;
  },
): RetrievalReceiptRecord[] {
  if (!options.chunks || options.chunks.length === 0) return [];
  const totalReduction = Math.max(0, (options.deltaTBefore ?? 0) - (options.deltaTAfter ?? 0));
  const totalScore = options.chunks.reduce((acc, c) => acc + Math.max(0.001, c.score), 0);
  const receipts: RetrievalReceiptRecord[] = [];

  const insertStmt = database.db.prepare(
    `INSERT OR IGNORE INTO ai_retrieval_receipts (
       receipt_id, trace_id, chunk_id, author_user_id, package_name, source_uri,
       similarity_score, delta_t_reduction, receipt_sig
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const chunk of options.chunks) {
    const share = Math.max(0.001, chunk.score) / totalScore;
    const deltaTReduction = Number((totalReduction * share).toFixed(6));
    const authorUserId = options.diskann?.getChunkAuthorUserId(chunk.chunkId) ?? null;
    const receiptId =
      "rcpt_" + crypto.createHash("sha256").update(`${options.traceId}|${chunk.chunkId}`).digest("hex").slice(0, 24);
    const { sig } = signCanonicalBytes(database, {
      receiptId,
      traceId: options.traceId,
      chunkId: chunk.chunkId,
      authorUserId,
      similarityScore: chunk.score,
      deltaTReduction,
    });

    insertStmt.run(
      receiptId,
      options.traceId,
      chunk.chunkId,
      authorUserId,
      chunk.packageName ?? null,
      chunk.sourceUri,
      chunk.score,
      deltaTReduction,
      sig,
    );

    receipts.push({
      receiptId,
      traceId: options.traceId,
      chunkId: chunk.chunkId,
      authorUserId,
      packageName: chunk.packageName ?? null,
      sourceUri: chunk.sourceUri,
      similarityScore: chunk.score,
      deltaTReduction,
      receiptSig: sig,
    });
  }

  return receipts;
}

/**
 * Persists normalized contributor weights (`sum == 1.0`) for a dataset shard or model CID.
 */
export function recordAttributionWeights(
  database: LibraryDatabase,
  artifactCid: string,
  entries: Array<{
    contributorUserId: number;
    sourceCid?: string | null | undefined;
    method: AttributionMethod;
    rawWeight: number;
  }>,
): number {
  const positive = entries.filter((e) => Number.isFinite(e.rawWeight) && e.rawWeight > 0);
  if (positive.length === 0) return 0;
  const total = positive.reduce((sum, e) => sum + e.rawWeight, 0);
  const stmt = database.db.prepare(
    `INSERT INTO attribution_weights (
       artifact_cid, contributor_user_id, source_cid, method, weight
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(artifact_cid, contributor_user_id, source_cid, method) DO UPDATE SET
       weight = excluded.weight,
       computed_at = datetime('now')`,
  );

  database.db.transaction(() => {
    for (const e of positive) {
      stmt.run(
        artifactCid,
        e.contributorUserId,
        e.sourceCid ?? null,
        e.method,
        Number((e.rawWeight / total).toFixed(6)),
      );
    }
  })();

  return positive.length;
}

/**
 * Distributes creator royalty credits from an AI chat or model inference spend across
 * cited `ai_retrieval_receipts` and/or model `attribution_weights`, settling directly
 * into `attribution_royalty_ledger` and recipient credit wallets.
 */
export function distributeCreditRoyalties(
  database: LibraryDatabase,
  options: {
    spendCredits: number;
    payerUserId?: number | null | undefined;
    traceId?: string | undefined;
    artifactCid?: string | undefined;
    royaltyRate?: number | undefined;
    sourceCreditTxId?: number | null | undefined;
  },
): { totalDistributed: number; payouts: Array<{ recipientUserId: number; amount: number; reason: RoyaltyReason }> } {
  const rate = Math.max(0, Math.min(0.5, options.royaltyRate ?? 0.2));
  const royaltyPool = Number((options.spendCredits * rate).toFixed(6));
  if (royaltyPool <= 0.0001) {
    return { totalDistributed: 0, payouts: [] };
  }

  const payouts: Array<{ recipientUserId: number; amount: number; reason: RoyaltyReason; cid: string | null }> = [];

  // 1. Retrieval receipt payouts (weighted by similarity + Δ_t reduction)
  if (options.traceId) {
    const receipts = database.db
      .prepare(
        `SELECT receipt_id, chunk_id, author_user_id, similarity_score, delta_t_reduction
         FROM ai_retrieval_receipts
         WHERE trace_id = ? AND settled = 0 AND author_user_id IS NOT NULL`,
      )
      .all(options.traceId) as Array<{
      receipt_id: string;
      chunk_id: string;
      author_user_id: number;
      similarity_score: number;
      delta_t_reduction: number;
    }>;

    const eligible = receipts.filter((r) => r.author_user_id !== options.payerUserId);
    if (eligible.length > 0) {
      const weights = eligible.map((r) => Math.max(0.01, r.similarity_score + r.delta_t_reduction * 2));
      const sumW = weights.reduce((a, b) => a + b, 0);
      const retrievalPool = options.artifactCid ? royaltyPool * 0.6 : royaltyPool;
      for (let i = 0; i < eligible.length; i++) {
        const r = eligible[i]!;
        const amt = Number(((retrievalPool * weights[i]!) / sumW).toFixed(6));
        if (amt > 0.00001) {
          payouts.push({
            recipientUserId: r.author_user_id,
            amount: amt,
            reason: "retrieval_receipt",
            cid: r.chunk_id,
          });
        }
      }
      database.db.prepare(`UPDATE ai_retrieval_receipts SET settled = 1 WHERE trace_id = ?`).run(options.traceId);
    }
  }

  // 2. Artifact / model weight attribution payouts
  if (options.artifactCid) {
    const attrRows = database.db
      .prepare(`SELECT contributor_user_id, weight FROM attribution_weights WHERE artifact_cid = ?`)
      .all(options.artifactCid) as Array<{ contributor_user_id: number; weight: number }>;
    const eligible = attrRows.filter((a) => a.contributor_user_id !== options.payerUserId && a.weight > 0);
    if (eligible.length > 0) {
      const sumW = eligible.reduce((s, a) => s + a.weight, 0);
      const modelPool = payouts.length > 0 ? royaltyPool * 0.4 : royaltyPool;
      for (const a of eligible) {
        const amt = Number(((modelPool * a.weight) / sumW).toFixed(6));
        if (amt > 0.00001) {
          payouts.push({
            recipientUserId: a.contributor_user_id,
            amount: amt,
            reason: "model_royalty",
            cid: options.artifactCid,
          });
        }
      }
    }
  }

  if (payouts.length === 0) {
    return { totalDistributed: 0, payouts: [] };
  }

  const insertLedger = database.db.prepare(
    `INSERT INTO attribution_royalty_ledger (
       source_credit_tx_id, recipient_user_id, artifact_cid, reason, amount_credits, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let totalDistributed = 0;
  for (const p of payouts) {
    insertLedger.run(
      options.sourceCreditTxId ?? null,
      p.recipientUserId,
      p.cid,
      p.reason,
      p.amount,
      JSON.stringify({ traceId: options.traceId ?? null, artifactCid: options.artifactCid ?? null }),
    );
    if (typeof database.grantUserCredits === "function") {
      try {
        database.grantUserCredits(
          p.recipientUserId,
          p.amount,
          `attribution_${p.reason}`,
          `Creator attribution royalty (${p.reason})`,
          { traceId: options.traceId, artifactCid: p.cid },
        );
      } catch {
        // Ledger entry remains durable for batch settlement
      }
    }
    totalDistributed += p.amount;
  }

  return {
    totalDistributed: Number(totalDistributed.toFixed(6)),
    payouts: payouts.map((p) => ({
      recipientUserId: p.recipientUserId,
      amount: p.amount,
      reason: p.reason,
    })),
  };
}

/**
 * Settles `rlhf_campaigns.bounty_points` across agreeing annotators when a challenge reaches
 * `consensus_reached` or `adjudicated`, idempotently guarded via `attribution_royalty_ledger`.
 */
export function settleCampaignBounty(
  database: LibraryDatabase,
  challengeId: number,
  winningCandidateId: number | null,
): { settled: boolean; totalPointsAwarded: number; recipients: number } {
  const challenge = database.db
    .prepare(`SELECT id, campaign_id, dialect FROM rlhf_challenges WHERE id = ?`)
    .get(challengeId) as { id: number; campaign_id: number | null; dialect: string } | undefined;
  if (!challenge || challenge.campaign_id == null) {
    return { settled: false, totalPointsAwarded: 0, recipients: 0 };
  }

  const campaign = database.db
    .prepare(`SELECT id, slug, bounty_points FROM rlhf_campaigns WHERE id = ?`)
    .get(challenge.campaign_id) as { id: number; slug: string; bounty_points: number } | undefined;
  if (!campaign || !(campaign.bounty_points > 0)) {
    return { settled: false, totalPointsAwarded: 0, recipients: 0 };
  }

  const artifactCid = `rlhf:campaign:${campaign.id}:challenge:${challengeId}`;
  const alreadySettled = database.db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM attribution_royalty_ledger
       WHERE artifact_cid = ? AND reason = 'campaign_bounty'`,
    )
    .get(artifactCid) as { cnt: number };
  if (alreadySettled.cnt > 0) {
    return { settled: false, totalPointsAwarded: 0, recipients: 0 };
  }

  const annotations = database.db
    .prepare(
      `SELECT user_id, preferred_candidate_id, weight
       FROM rlhf_annotations
       WHERE challenge_id = ?`,
    )
    .all(challengeId) as Array<{
    user_id: number;
    preferred_candidate_id: number | null;
    weight: number;
  }>;

  const agreeing =
    winningCandidateId != null
      ? annotations.filter((a) => a.preferred_candidate_id === winningCandidateId)
      : annotations;
  if (agreeing.length === 0) {
    return { settled: false, totalPointsAwarded: 0, recipients: 0 };
  }

  const totalWeight = agreeing.reduce((s, a) => s + Math.max(0.1, a.weight), 0);
  const insertLedger = database.db.prepare(
    `INSERT INTO attribution_royalty_ledger (
       recipient_user_id, artifact_cid, reason, amount_credits, metadata_json
     ) VALUES (?, ?, 'campaign_bounty', ?, ?)`,
  );

  let totalPointsAwarded = 0;
  for (const a of agreeing) {
    const share = Math.max(0.1, a.weight) / totalWeight;
    const reward = Number((campaign.bounty_points * share).toFixed(4));
    if (reward <= 0) continue;
    insertLedger.run(
      a.user_id,
      artifactCid,
      reward,
      JSON.stringify({ campaignId: campaign.id, campaignSlug: campaign.slug, challengeId, dialect: challenge.dialect }),
    );
    if (typeof database.grantUserCredits === "function") {
      try {
        database.grantUserCredits(
          a.user_id,
          reward,
          "rlhf_campaign_bounty",
          `RLHF campaign bounty (${campaign.slug}) for challenge #${challengeId}`,
          { campaignId: campaign.id, challengeId, dialect: challenge.dialect },
        );
      } catch {
        // Ledger remains durable
      }
    }
    totalPointsAwarded += reward;
  }

  return {
    settled: true,
    totalPointsAwarded: Number(totalPointsAwarded.toFixed(4)),
    recipients: agreeing.length,
  };
}

/**
 * Executes a cryptographic revocation cascade for a provenance CID:
 *   1. Marks `provenance_nodes.revoked_at`,
 *   2. Quarantines matching DiskANN chunks immediately,
 *   3. Inserts `quarantine` overlay patches for downstream datasets,
 *   4. Flags dependent registered models (`revocation_status = 'revocation_pending'`).
 */
export function executeRevocationCascade(
  database: LibraryDatabase,
  cid: string,
  reason: string,
  actorUserId?: number | null,
  diskann?: DiskAnnMemoryService,
): {
  revokedCids: string[];
  quarantinedChunks: number;
  flaggedModels: number;
} {
  const node = database.db.prepare(`SELECT * FROM provenance_nodes WHERE cid = ?`).get(cid) as
    { cid: string; node_kind: string; ref_id: string } | undefined;
  if (!node) {
    return { revokedCids: [], quarantinedChunks: 0, flaggedModels: 0 };
  }

  // BFS downstream dependent provenance nodes
  const allNodes = database.db
    .prepare(`SELECT cid, node_kind, ref_id, parent_cids_json FROM provenance_nodes`)
    .all() as Array<{ cid: string; node_kind: string; ref_id: string; parent_cids_json: string }>;

  const childrenMap = new Map<string, typeof allNodes>();
  for (const n of allNodes) {
    let parents: string[] = [];
    try {
      parents = JSON.parse(n.parent_cids_json) as string[];
    } catch {
      parents = [];
    }
    for (const p of parents) {
      const list = childrenMap.get(p) ?? [];
      list.push(n);
      childrenMap.set(p, list);
    }
  }

  const visited = new Set<string>([node.cid]);
  const queue = [node];
  const impactedNodes: Array<{ cid: string; node_kind: string; ref_id: string }> = [node];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of childrenMap.get(cur.cid) ?? []) {
      if (!visited.has(child.cid)) {
        visited.add(child.cid);
        impactedNodes.push(child);
        queue.push(child);
      }
    }
  }

  const revokeStmt = database.db.prepare(
    `UPDATE provenance_nodes
     SET revoked_at = COALESCE(revoked_at, datetime('now')),
         revocation_reason = COALESCE(revocation_reason, ?)
     WHERE cid = ?`,
  );
  const flagModelStmt = database.db.prepare(
    `UPDATE model_registry_entries
     SET revocation_status = 'revocation_pending', updated_at = datetime('now')
     WHERE (name || '@' || version) = ? OR name = ?`,
  );

  let quarantinedChunks = 0;
  let flaggedModels = 0;

  database.db.transaction(() => {
    for (const impacted of impactedNodes) {
      revokeStmt.run(reason, impacted.cid);
      if (diskann) {
        quarantinedChunks += diskann.quarantineBySourceUri(impacted.ref_id, true);
      }
      if (impacted.node_kind === "model-weights") {
        const res = flagModelStmt.run(impacted.ref_id, impacted.ref_id);
        flaggedModels += Number(res.changes);
      }
      if (
        impacted.node_kind === "source-commit" ||
        impacted.node_kind === "verified-fix" ||
        impacted.node_kind === "social-post"
      ) {
        try {
          database.db
            .prepare(
              `INSERT INTO dataset_overlay_patches (
                 recipe_name, example_id, action, reason, created_by
               ) VALUES ('*', ?, 'quarantine', ?, ?)`,
            )
            .run(impacted.ref_id, `Revocation cascade (${cid}): ${reason}`, actorUserId ?? null);
        } catch {
          // Best-effort overlay insert
        }
      }
    }
  })();

  return {
    revokedCids: impactedNodes.map((n) => n.cid),
    quarantinedChunks,
    flaggedModels,
  };
}

/**
 * Aggregates creator attribution earnings, retrieval receipts, and RLHF bounties for a user.
 */
export function getCreatorEarningsSummary(
  database: LibraryDatabase,
  userId: number,
): {
  userId: number;
  totalEarnedCredits: number;
  byReason: Record<string, number>;
  retrievalReceiptCount: number;
  attributedArtifactsCount: number;
  recentPayouts: Array<{
    id: number;
    reason: string;
    artifactCid: string | null;
    amountCredits: number;
    createdAt: string;
  }>;
} {
  const rows = database.db
    .prepare(
      `SELECT id, reason, artifact_cid, amount_credits, created_at
       FROM attribution_royalty_ledger
       WHERE recipient_user_id = ?
       ORDER BY id DESC
       LIMIT 100`,
    )
    .all(userId) as Array<{
    id: number;
    reason: string;
    artifact_cid: string | null;
    amount_credits: number;
    created_at: string;
  }>;

  const byReason: Record<string, number> = {};
  let totalEarnedCredits = 0;
  for (const r of rows) {
    byReason[r.reason] = Number(((byReason[r.reason] ?? 0) + r.amount_credits).toFixed(6));
    totalEarnedCredits += r.amount_credits;
  }

  const receiptRow = database.db
    .prepare(`SELECT COUNT(*) AS cnt FROM ai_retrieval_receipts WHERE author_user_id = ?`)
    .get(userId) as { cnt: number };
  const attrRow = database.db
    .prepare(`SELECT COUNT(DISTINCT artifact_cid) AS cnt FROM attribution_weights WHERE contributor_user_id = ?`)
    .get(userId) as { cnt: number };

  return {
    userId,
    totalEarnedCredits: Number(totalEarnedCredits.toFixed(6)),
    byReason,
    retrievalReceiptCount: Number(receiptRow?.cnt ?? 0),
    attributedArtifactsCount: Number(attrRow?.cnt ?? 0),
    recentPayouts: rows.slice(0, 25).map((r) => ({
      id: r.id,
      reason: r.reason,
      artifactCid: r.artifact_cid,
      amountCredits: r.amount_credits,
      createdAt: r.created_at,
    })),
  };
}
