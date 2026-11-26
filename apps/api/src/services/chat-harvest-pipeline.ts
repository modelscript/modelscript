// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AI Chatbox Interaction Trace Logger, Zero-Touch Verified-Fix Harvester & Social Arena Escalator.
 *
 * Closes the automated feedback flywheel:
 *   1. Redacts secrets/PII before recording `ai_interaction_traces` (respecting tenant scope & opt-in).
 *   2. Processes explicit feedback (`up`/`down`, failure tags) and implicit edit outcomes
 *      (`accepted`, `reverted`, `manual_fixed`).
 *   3. Zero-touch harvests Gate 1–4 verified fixes into DiskANN (`rlhf-verified-fix`) and
 *      awards contribution credits + Merkle-SLSA provenance nodes.
 *   4. Escalates unresolved high-Δ_t or failing chat turns into `rlhf_challenges` under
 *      matching domain `rlhf_campaigns`, and evaluates `living_recipe_triggers`.
 */

import { compileRelationalHypergraph, type FormalCertificateSummary, type TenantScope } from "@modelscript/runtime";
import crypto from "node:crypto";
import type { LibraryDatabase } from "../database.js";
import { evaluateFormalGatesForCandidate } from "../routes/rlhf-arena.js";
import type { DiskAnnMemoryService } from "./diskann-memory.js";
import { recordProvenanceNode } from "./provenance-attribution.js";

const SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[a-zA-Z0-9_-]{16,})\b/g,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
  /\b(gho_[a-zA-Z0-9]{20,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
];

export function redactSensitivePromptText(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED_SECRET]");
  }
  return out.slice(0, 8000);
}

export interface RecordChatTraceInput {
  traceId?: string | undefined;
  sessionId?: string | undefined;
  userId?: number | null | undefined;
  orgId?: number | null | undefined;
  tenantScope?: TenantScope | undefined;
  dialect?: string | undefined;
  computeDial?: string | undefined;
  modelRef?: string | undefined;
  adapterRef?: string | null | undefined;
  prompt: string;
  responseText: string;
  deltaTBefore?: number | null | undefined;
  deltaTAfter?: number | null | undefined;
  gateInitial?: FormalCertificateSummary | null | undefined;
  gateFinal?: FormalCertificateSummary | null | undefined;
  allowTrainingOptIn?: boolean | undefined;
  creditsCharged?: number | undefined;
}

export function recordChatInteractionTrace(
  database: LibraryDatabase,
  input: RecordChatTraceInput,
): { traceId: string; promptHash: string } {
  const traceId = input.traceId?.trim() || `tr_${crypto.randomBytes(12).toString("hex")}`;
  const redacted = redactSensitivePromptText(input.prompt);
  const promptHash = crypto.createHash("sha256").update(redacted, "utf8").digest("hex");
  const tenantScope: TenantScope = input.tenantScope ?? (input.orgId ? "org" : "public");
  const allowOptIn = input.allowTrainingOptIn === true ? 1 : 0;

  database.db
    .prepare(
      `INSERT INTO ai_interaction_traces (
         trace_id, session_id, user_id, org_id, tenant_scope, dialect, compute_dial,
         model_ref, adapter_ref, prompt_hash, redacted_prompt, response_text,
         delta_t_before, delta_t_after, gate1_to_4_initial_json, gate1_to_4_final_json,
         allow_training_opt_in, credits_charged
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(trace_id) DO UPDATE SET
         response_text = excluded.response_text,
         delta_t_after = COALESCE(excluded.delta_t_after, ai_interaction_traces.delta_t_after),
         gate1_to_4_final_json = COALESCE(excluded.gate1_to_4_final_json, ai_interaction_traces.gate1_to_4_final_json),
         credits_charged = excluded.credits_charged,
         updated_at = datetime('now')`,
    )
    .run(
      traceId,
      input.sessionId ?? "",
      input.userId ?? null,
      input.orgId ?? null,
      tenantScope,
      (input.dialect ?? "modelica").toLowerCase(),
      input.computeDial ?? "auto-escalate",
      input.modelRef ?? "",
      input.adapterRef ?? null,
      promptHash,
      redacted,
      input.responseText.slice(0, 16000),
      input.deltaTBefore ?? null,
      input.deltaTAfter ?? null,
      input.gateInitial ? JSON.stringify(input.gateInitial) : null,
      input.gateFinal ? JSON.stringify(input.gateFinal) : null,
      allowOptIn,
      input.creditsCharged ?? 0,
    );

  return { traceId, promptHash };
}

export interface ChatFeedbackPayload {
  userRating?: "up" | "down" | null | undefined;
  failureTags?: string[] | undefined;
  editOutcome?: "none" | "accepted" | "reverted" | "manual_fixed" | undefined;
  userFixedCode?: string | undefined;
  allowTrainingOptIn?: boolean | undefined;
}

export interface ChatFeedbackResult {
  traceId: string;
  updated: boolean;
  harvestedToDiskAnn: boolean;
  harvestedChunkId?: string | undefined;
  provenanceCid?: string | undefined;
  creditsAwarded: number;
  formalCert?: FormalCertificateSummary | undefined;
  livingRecipeReady: Array<{ triggerId: number; recipeName: string; dialect: string; pendingVerifiedCount: number }>;
}

/**
 * Applies explicit (`up`/`down`, tags) and implicit (`accepted`/`reverted`/`manual_fixed`)
 * feedback to a chat trace, and automatically harvests Gate 1–4 verified fixes into DiskANN.
 */
export function processChatFeedbackAndHarvest(
  database: LibraryDatabase,
  traceId: string,
  actorUserId: number | null,
  feedback: ChatFeedbackPayload,
  diskann?: DiskAnnMemoryService,
): ChatFeedbackResult {
  const row = database.db.prepare(`SELECT * FROM ai_interaction_traces WHERE trace_id = ?`).get(traceId) as
    | {
        trace_id: string;
        user_id: number | null;
        org_id: number | null;
        tenant_scope: TenantScope;
        dialect: string;
        redacted_prompt: string;
        response_text: string;
        edit_outcome: string;
        harvested_shard_id: string | null;
        allow_training_opt_in: number;
      }
    | undefined;

  if (!row) {
    return {
      traceId,
      updated: false,
      harvestedToDiskAnn: false,
      creditsAwarded: 0,
      livingRecipeReady: [],
    };
  }

  const nextOutcome = feedback.editOutcome ?? (row.edit_outcome as "none" | "accepted" | "reverted" | "manual_fixed");
  const nextOptIn =
    feedback.allowTrainingOptIn !== undefined ? (feedback.allowTrainingOptIn ? 1 : 0) : row.allow_training_opt_in;
  const tags = Array.isArray(feedback.failureTags)
    ? feedback.failureTags.filter((t): t is string => typeof t === "string").slice(0, 12)
    : [];

  let formalCert: FormalCertificateSummary | undefined;
  let harvestedToDiskAnn = false;
  let harvestedChunkId: string | undefined;
  let provenanceCid: string | undefined;
  let creditsAwarded = 0;

  const candidateVerifiedCode =
    feedback.userFixedCode?.trim() ||
    (nextOutcome === "accepted" && feedback.userRating === "up" ? row.response_text.trim() : "");

  if (candidateVerifiedCode && nextOptIn === 1) {
    formalCert = evaluateFormalGatesForCandidate(candidateVerifiedCode, row.dialect);
    const allGatesPassed =
      formalCert.gate1GlrSyntax &&
      formalCert.gate2QudvUnits &&
      formalCert.gate3SmtFeasibility &&
      formalCert.gate4DaeBalance;

    if (allGatesPassed && diskann && !row.harvested_shard_id) {
      harvestedChunkId = diskann.upsertChunk({
        sourceKind: "rlhf-verified-fix",
        sourceUri: `chat://verified-fix/${traceId}`,
        dialect: row.dialect,
        content: candidateVerifiedCode,
        formalVerified: true,
        tenantScope: row.tenant_scope,
        orgId: row.org_id,
        authorUserId: actorUserId ?? row.user_id,
      });
      harvestedToDiskAnn = true;

      const provNode = recordProvenanceNode(database, {
        nodeKind: "verified-fix",
        refId: `chat://verified-fix/${traceId}`,
        authorUserId: actorUserId ?? row.user_id,
        orgId: row.org_id,
        governance: {
          allowRag: true,
          allowPretrain: row.tenant_scope === "public",
          allowPosttrain: true,
          tenantScope: row.tenant_scope,
        },
      });
      provenanceCid = provNode.cid;

      // Award +15 credits for a newly contributed Gate 1–4 verified manual repair
      const recipientId = actorUserId ?? row.user_id;
      if (nextOutcome === "manual_fixed" && recipientId && typeof database.grantUserCredits === "function") {
        creditsAwarded = 15;
        try {
          database.grantUserCredits(
            recipientId,
            creditsAwarded,
            "chat_verified_fix_contribution",
            `Verified chat fix contribution (${row.dialect}) for trace ${traceId}`,
            { traceId, chunkId: harvestedChunkId, provenanceCid },
          );
          database.db
            .prepare(
              `INSERT INTO attribution_royalty_ledger (
                 recipient_user_id, artifact_cid, reason, amount_credits, metadata_json
               ) VALUES (?, ?, 'fix_it_bounty', ?, ?)`,
            )
            .run(recipientId, provenanceCid, creditsAwarded, JSON.stringify({ traceId, dialect: row.dialect }));
        } catch {
          // Best-effort credit award
        }
      }
    }
  }

  database.db
    .prepare(
      `UPDATE ai_interaction_traces
       SET user_rating = COALESCE(?, user_rating),
           failure_tags_json = CASE WHEN ? != '[]' THEN ? ELSE failure_tags_json END,
           edit_outcome = ?,
           user_fixed_code = COALESCE(?, user_fixed_code),
           gate1_to_4_final_json = COALESCE(?, gate1_to_4_final_json),
           allow_training_opt_in = ?,
           harvested_shard_id = COALESCE(?, harvested_shard_id),
           updated_at = datetime('now')
       WHERE trace_id = ?`,
    )
    .run(
      feedback.userRating ?? null,
      JSON.stringify(tags),
      JSON.stringify(tags),
      nextOutcome,
      feedback.userFixedCode ?? null,
      formalCert ? JSON.stringify(formalCert) : null,
      nextOptIn,
      harvestedChunkId ? `diskann:${harvestedChunkId}` : null,
      traceId,
    );

  const livingRecipeReady = checkLivingRecipeTriggers(database, row.dialect);

  return {
    traceId,
    updated: true,
    harvestedToDiskAnn,
    ...(harvestedChunkId ? { harvestedChunkId } : {}),
    ...(provenanceCid ? { provenanceCid } : {}),
    creditsAwarded,
    ...(formalCert ? { formalCert } : {}),
    livingRecipeReady,
  };
}

/**
 * Escalates a failing or high-uncertainty AI chat trace directly into an RLHF Arena challenge
 * routed to an active domain campaign.
 */
export function escalateTraceToRlhfArena(
  database: LibraryDatabase,
  traceId: string,
  userId: number | null,
  options?: {
    title?: string | undefined;
    challengeType?: "fix_it_bounty" | "pairwise_arena" | "tolerance_labeling" | undefined;
    campaignId?: number | null | undefined;
  },
): { challengeId: number; campaignId: number | null; dialect: string } | null {
  const trace = database.db.prepare(`SELECT * FROM ai_interaction_traces WHERE trace_id = ?`).get(traceId) as
    | {
        trace_id: string;
        dialect: string;
        redacted_prompt: string;
        response_text: string;
        delta_t_before: number | null;
        delta_t_after: number | null;
        escalated_challenge_id: number | null;
      }
    | undefined;

  if (!trace) return null;
  if (trace.escalated_challenge_id) {
    const existing = database.db
      .prepare(`SELECT id, campaign_id, dialect FROM rlhf_challenges WHERE id = ?`)
      .get(trace.escalated_challenge_id) as { id: number; campaign_id: number | null; dialect: string } | undefined;
    if (existing) {
      return { challengeId: existing.id, campaignId: existing.campaign_id, dialect: existing.dialect };
    }
  }

  let resolvedCampaignId = options?.campaignId ?? null;
  if (resolvedCampaignId == null) {
    const activeCamp = database.db
      .prepare(
        `SELECT id FROM rlhf_campaigns
         WHERE status = 'active' AND (dialect = ? OR dialect = 'polyglot')
         ORDER BY CASE WHEN dialect = ? THEN 0 ELSE 1 END, id DESC
         LIMIT 1`,
      )
      .get(trace.dialect, trace.dialect) as { id: number } | undefined;
    resolvedCampaignId = activeCamp?.id ?? null;
  }

  const challengeType = options?.challengeType ?? "fix_it_bounty";
  const deltaT = Math.max(0.25, trace.delta_t_after ?? trace.delta_t_before ?? 0.65);
  const title =
    options?.title?.trim() || `Chatbox Escalation (${trace.dialect}): ${trace.redacted_prompt.slice(0, 72)}`;
  const cert = evaluateFormalGatesForCandidate(trace.response_text, trace.dialect);
  const hg = compileRelationalHypergraph({
    source: trace.response_text || trace.redacted_prompt,
    uri: `chat://trace/${traceId}.${trace.dialect}`,
    dialect: trace.dialect,
    formalCert: cert,
  });

  let challengeId = 0;
  database.db.transaction(() => {
    const ins = database.db
      .prepare(
        `INSERT INTO rlhf_challenges (
           created_by, challenge_type, dialect, title, prompt, source_code,
           delta_t_trigger, campaign_id, priority_score, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        userId,
        challengeType,
        trace.dialect,
        title,
        trace.redacted_prompt,
        trace.response_text,
        deltaT,
        resolvedCampaignId,
        Number((deltaT * 100 + 25).toFixed(2)),
      );
    challengeId = Number(ins.lastInsertRowid);

    database.db
      .prepare(
        `INSERT INTO rlhf_candidates (
           challenge_id, label, code, dialect, formal_cert_json, m_init, token_count, hypergraph_groups_json
         ) VALUES (?, 'AI Draft A', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        challengeId,
        trace.response_text,
        trace.dialect,
        JSON.stringify(cert),
        hg.mInit,
        hg.tokenIds.length,
        JSON.stringify(hg.groups),
      );

    database.db
      .prepare(
        `UPDATE ai_interaction_traces SET escalated_challenge_id = ?, updated_at = datetime('now') WHERE trace_id = ?`,
      )
      .run(challengeId, traceId);
  })();

  return { challengeId, campaignId: resolvedCampaignId, dialect: trace.dialect };
}

/**
 * Checks enabled `living_recipe_triggers` for a dialect and returns triggers whose
 * threshold of newly harvested verified chat fixes / RLHF consensus items has been met.
 */
export function checkLivingRecipeTriggers(
  database: LibraryDatabase,
  dialect: string,
): Array<{ triggerId: number; recipeName: string; dialect: string; pendingVerifiedCount: number }> {
  try {
    const triggers = database.db
      .prepare(
        `SELECT id, recipe_name, dialect, threshold_count, last_triggered_at
         FROM living_recipe_triggers
         WHERE enabled = 1 AND (dialect = ? OR dialect = 'polyglot')`,
      )
      .all(dialect.toLowerCase()) as Array<{
      id: number;
      recipe_name: string;
      dialect: string;
      threshold_count: number;
      last_triggered_at: string | null;
    }>;

    const ready: Array<{ triggerId: number; recipeName: string; dialect: string; pendingVerifiedCount: number }> = [];
    for (const trig of triggers) {
      const since = trig.last_triggered_at ?? "1970-01-01 00:00:00";
      const countRow = database.db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ai_interaction_traces
           WHERE harvested_shard_id IS NOT NULL
             AND updated_at > ?
             AND (? = 'polyglot' OR dialect = ?)`,
        )
        .get(since, trig.dialect, trig.dialect) as { cnt: number };
      const pendingVerifiedCount = Number(countRow?.cnt ?? 0);
      if (pendingVerifiedCount >= trig.threshold_count) {
        ready.push({
          triggerId: trig.id,
          recipeName: trig.recipe_name,
          dialect: trig.dialect,
          pendingVerifiedCount,
        });
      }
    }
    return ready;
  } catch {
    return [];
  }
}
