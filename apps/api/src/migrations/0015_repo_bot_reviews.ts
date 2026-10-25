// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0015: Migration = {
  id: "0015_repo_bot_reviews",
  name: "0015_repo_bot_reviews",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS repo_bot_reviews (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id         INTEGER NOT NULL REFERENCES linked_repos(id) ON DELETE CASCADE,
        bot_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pr_number       INTEGER,
        commit_sha      TEXT,
        verdict         TEXT NOT NULL DEFAULT 'COMMENT', -- 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
        summary         TEXT NOT NULL,
        issues_json     TEXT,
        post_id         INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_repo_bot_reviews_repo ON repo_bot_reviews(repo_id);
      CREATE INDEX IF NOT EXISTS idx_repo_bot_reviews_bot ON repo_bot_reviews(bot_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS repo_bot_reviews;
    `);
  },
};
