// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0014: AI Chatbox Interaction Traces & Signed Retrieval Receipts.
 *
 * Adds:
 *   - `ai_interaction_traces`: privacy-aware telemetry from Ansatz AI chatbox turns,
 *     capturing uncertainty (Δ_t), formal gate results, edit outcomes, user feedback,
 *     and links to auto-harvested DPO shards or escalated RLHF challenges.
 *   - `ai_retrieval_receipts`: tamper-evident attribution receipts recording which
 *     DiskANN memory chunks assisted each chat turn and their Δ_t collapse contribution.
 */
export const aiInteractionTracesAndFeedbackMigration: Migration = {
  id: "0014_ai_interaction_traces_and_feedback",
  name: "0014_ai_interaction_traces_and_feedback",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS ai_interaction_traces (
        trace_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL DEFAULT '',
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        org_id INTEGER DEFAULT NULL,
        tenant_scope TEXT NOT NULL DEFAULT 'public'
          CHECK (tenant_scope IN ('public', 'org', 'project-private')),
        dialect TEXT NOT NULL DEFAULT 'modelica',
        compute_dial TEXT NOT NULL DEFAULT 'auto-escalate',
        model_ref TEXT NOT NULL DEFAULT '',
        adapter_ref TEXT DEFAULT NULL,
        prompt_hash TEXT NOT NULL,
        redacted_prompt TEXT NOT NULL DEFAULT '',
        response_text TEXT NOT NULL DEFAULT '',
        delta_t_before REAL DEFAULT NULL,
        delta_t_after REAL DEFAULT NULL,
        gate1_to_4_initial_json TEXT DEFAULT NULL,
        gate1_to_4_final_json TEXT DEFAULT NULL,
        edit_outcome TEXT NOT NULL DEFAULT 'none'
          CHECK (edit_outcome IN ('none', 'accepted', 'reverted', 'manual_fixed')),
        user_fixed_code TEXT DEFAULT NULL,
        user_rating TEXT DEFAULT NULL
          CHECK (user_rating IS NULL OR user_rating IN ('up', 'down')),
        failure_tags_json TEXT NOT NULL DEFAULT '[]',
        escalated_challenge_id INTEGER REFERENCES rlhf_challenges(id) ON DELETE SET NULL,
        harvested_shard_id TEXT DEFAULT NULL,
        allow_training_opt_in INTEGER NOT NULL DEFAULT 0,
        credits_charged REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ai_traces_user ON ai_interaction_traces(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_traces_dialect ON ai_interaction_traces(dialect, tenant_scope, allow_training_opt_in);
      CREATE INDEX IF NOT EXISTS idx_ai_traces_harvest ON ai_interaction_traces(edit_outcome, harvested_shard_id);
      CREATE INDEX IF NOT EXISTS idx_ai_traces_escalated ON ai_interaction_traces(escalated_challenge_id);

      CREATE TABLE IF NOT EXISTS ai_retrieval_receipts (
        receipt_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL REFERENCES ai_interaction_traces(trace_id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        package_name TEXT DEFAULT NULL,
        source_uri TEXT NOT NULL DEFAULT '',
        similarity_score REAL NOT NULL DEFAULT 0.0,
        delta_t_reduction REAL NOT NULL DEFAULT 0.0,
        receipt_sig TEXT NOT NULL DEFAULT '',
        settled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_ai_receipts_trace ON ai_retrieval_receipts(trace_id);
      CREATE INDEX IF NOT EXISTS idx_ai_receipts_author ON ai_retrieval_receipts(author_user_id, settled);
      CREATE INDEX IF NOT EXISTS idx_ai_receipts_chunk ON ai_retrieval_receipts(chunk_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP INDEX IF EXISTS idx_ai_receipts_chunk;
      DROP INDEX IF EXISTS idx_ai_receipts_author;
      DROP INDEX IF EXISTS idx_ai_receipts_trace;
      DROP TABLE IF EXISTS ai_retrieval_receipts;
      DROP INDEX IF EXISTS idx_ai_traces_escalated;
      DROP INDEX IF EXISTS idx_ai_traces_harvest;
      DROP INDEX IF EXISTS idx_ai_traces_dialect;
      DROP INDEX IF EXISTS idx_ai_traces_user;
      DROP TABLE IF EXISTS ai_interaction_traces;
    `);
  },
};
