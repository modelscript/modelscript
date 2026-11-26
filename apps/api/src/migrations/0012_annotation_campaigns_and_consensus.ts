// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0012: RLHF Annotation Campaigns, Challenge Skips/Flags, Priority Queue & Set-Aware Consensus.
 *
 * Adds:
 *   - `rlhf_campaigns`: structured annotation sprints with target counts, consensus quorum/threshold, and bounties
 *   - `rlhf_challenge_skips`: per-user skip/flag records to prevent re-serving skipped/flagged challenges
 *   - Idempotent columns on `rlhf_challenges`: `campaign_id`, `priority_score`, `consensus_status`,
 *     `winning_candidate_id`, `adjudicated_by`, `adjudication_notes`, `skip_count`, `flag_count`
 */
export const annotationCampaignsAndConsensusMigration: Migration = {
  id: "0012_annotation_campaigns_and_consensus",
  name: "0012_annotation_campaigns_and_consensus",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS rlhf_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        dialect TEXT NOT NULL DEFAULT 'polyglot',
        challenge_type TEXT NOT NULL DEFAULT 'pairwise_arena'
          CHECK (challenge_type IN ('pairwise_arena', 'fix_it_bounty', 'tolerance_labeling', 'mixed')),
        target_annotations INTEGER NOT NULL DEFAULT 50,
        completed_annotations INTEGER NOT NULL DEFAULT 0,
        consensus_min_votes INTEGER NOT NULL DEFAULT 3,
        consensus_agreement_threshold REAL NOT NULL DEFAULT 0.75,
        bounty_points INTEGER NOT NULL DEFAULT 10,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rlhf_campaigns_status ON rlhf_campaigns(status, dialect);
      CREATE INDEX IF NOT EXISTS idx_rlhf_campaigns_slug ON rlhf_campaigns(slug);

      CREATE TABLE IF NOT EXISTS rlhf_challenge_skips (
        challenge_id INTEGER NOT NULL REFERENCES rlhf_challenges(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason TEXT NOT NULL DEFAULT '',
        is_flag INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (challenge_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rlhf_challenge_skips_user ON rlhf_challenge_skips(user_id);
      CREATE INDEX IF NOT EXISTS idx_rlhf_challenge_skips_flag ON rlhf_challenge_skips(challenge_id, is_flag);
    `);

    const challengeColumns: [string, string][] = [
      ["campaign_id", "INTEGER REFERENCES rlhf_campaigns(id) ON DELETE SET NULL"],
      ["priority_score", "REAL NOT NULL DEFAULT 0.0"],
      ["consensus_status", "TEXT NOT NULL DEFAULT 'pending'"],
      ["winning_candidate_id", "INTEGER REFERENCES rlhf_candidates(id) ON DELETE SET NULL"],
      ["adjudicated_by", "INTEGER REFERENCES users(id) ON DELETE SET NULL"],
      ["adjudication_notes", "TEXT DEFAULT NULL"],
      ["skip_count", "INTEGER NOT NULL DEFAULT 0"],
      ["flag_count", "INTEGER NOT NULL DEFAULT 0"],
    ];

    if (ctx.dialect === "sqlite") {
      const existingRows = ctx.query<{ name: string }>("PRAGMA table_info(rlhf_challenges)") as {
        name: string;
      }[];
      const existingCols = new Set(existingRows.map((row) => row.name));
      for (const [col, definition] of challengeColumns) {
        if (!existingCols.has(col)) {
          ctx.execute(`ALTER TABLE rlhf_challenges ADD COLUMN ${col} ${definition};`);
        }
      }
    } else {
      for (const [col, definition] of challengeColumns) {
        ctx.addColumnIfNotExists("rlhf_challenges", col, definition);
      }
    }

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_priority
        ON rlhf_challenges(status, consensus_status, priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_rlhf_challenges_campaign
        ON rlhf_challenges(campaign_id, status);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP INDEX IF EXISTS idx_rlhf_challenges_campaign;
      DROP INDEX IF EXISTS idx_rlhf_challenges_priority;
      DROP TABLE IF EXISTS rlhf_challenge_skips;
      DROP TABLE IF EXISTS rlhf_campaigns;
    `);
    for (const col of [
      "flag_count",
      "skip_count",
      "adjudication_notes",
      "adjudicated_by",
      "winning_candidate_id",
      "consensus_status",
      "priority_score",
      "campaign_id",
    ]) {
      ctx.dropColumnIfExists("rlhf_challenges", col);
    }
  },
};
