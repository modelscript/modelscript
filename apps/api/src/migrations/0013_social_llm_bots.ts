// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0013: Migration = {
  id: "0013_social_llm_bots",
  name: "0013_social_llm_bots",
  up(ctx: MigrationContext) {
    const addColumn = (col: string) => {
      try {
        ctx.execute(`ALTER TABLE users ADD COLUMN ${col};`);
      } catch {
        // Column may already exist
      }
    };
    addColumn("bot_scopes TEXT DEFAULT 'social:read,social:write'");
    addColumn("bot_system_prompt TEXT");
    addColumn("bot_model TEXT DEFAULT 'gemini-1.5-flash'");
    addColumn("bot_last_used_at TEXT");

    ctx.execute(`
      CREATE TABLE IF NOT EXISTS bot_mention_queue (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id         INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
        attempts        INTEGER NOT NULL DEFAULT 0,
        error           TEXT,
        response_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_pending ON bot_mention_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_bot ON bot_mention_queue(bot_id);
      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_post ON bot_mention_queue(post_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS bot_mention_queue;
    `);
  },
};
