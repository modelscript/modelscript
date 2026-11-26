// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0008: Crowd-Sourced Engineering RLHF Arena & Relational Hypergraph Annotation tables.
 *
 * Supports:
 *   - `pairwise_arena` (A/B preference over live CAD/DAE/code candidates with formal gate badges)
 *   - `fix_it_bounty` (verified patch submissions checked by the formal compiler gates)
 *   - `tolerance_labeling` (crowd-sourced `group_id` / `rel_sign` / tolerance overrides)
 *   - Honeypot calibration and domain-weighted annotator reputation
 */
export const rlhfArenaMigration: Migration = {
  id: "0008_rlhf_arena",
  name: "0008_rlhf_arena",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS rlhf_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        challenge_type TEXT NOT NULL CHECK (challenge_type IN ('pairwise_arena', 'fix_it_bounty', 'tolerance_labeling')),
        dialect TEXT NOT NULL DEFAULT 'modelica',
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        source_code TEXT,
        delta_t_trigger REAL,
        is_honeypot INTEGER NOT NULL DEFAULT 0,
        gold_answer_json TEXT,
        ai_governance_json TEXT NOT NULL DEFAULT '{"allowRag":true,"allowPretrain":false,"allowPosttrain":true,"tenantScope":"public"}',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_dialect ON rlhf_challenges(dialect, status);
      CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_post ON rlhf_challenges(post_id);

      CREATE TABLE IF NOT EXISTS rlhf_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_id INTEGER NOT NULL REFERENCES rlhf_challenges(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        code TEXT NOT NULL,
        dialect TEXT NOT NULL,
        artifact_id TEXT,
        formal_cert_json TEXT NOT NULL,
        m_init INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        hypergraph_groups_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rlhf_candidates_challenge ON rlhf_candidates(challenge_id);

      CREATE TABLE IF NOT EXISTS rlhf_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_id INTEGER NOT NULL REFERENCES rlhf_challenges(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        preferred_candidate_id INTEGER REFERENCES rlhf_candidates(id) ON DELETE SET NULL,
        preference_outcome TEXT NOT NULL DEFAULT 'candidate' CHECK (preference_outcome IN ('candidate', 'tie', 'both_bad')),
        rationale_tags_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        fixed_code TEXT,
        fixed_formal_cert_json TEXT,
        hypergraph_overrides_json TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        honeypot_passed INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(challenge_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rlhf_annotations_challenge ON rlhf_annotations(challenge_id);
      CREATE INDEX IF NOT EXISTS idx_rlhf_annotations_user ON rlhf_annotations(user_id);

      CREATE TABLE IF NOT EXISTS rlhf_annotator_reputation (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        domain TEXT NOT NULL DEFAULT 'general',
        trust_score REAL NOT NULL DEFAULT 1.0,
        total_annotations INTEGER NOT NULL DEFAULT 0,
        honeypot_hits INTEGER NOT NULL DEFAULT 0,
        honeypot_misses INTEGER NOT NULL DEFAULT 0,
        verified_fixes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, domain)
      );
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS rlhf_annotator_reputation;
      DROP TABLE IF EXISTS rlhf_annotations;
      DROP TABLE IF EXISTS rlhf_candidates;
      DROP TABLE IF EXISTS rlhf_challenges;
    `);
  },
};
