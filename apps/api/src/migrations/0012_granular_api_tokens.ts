// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0012: Migration = {
  id: "0012_granular_api_tokens",
  name: "0012_granular_api_tokens",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        token_prefix    TEXT NOT NULL,
        token_hash      TEXT NOT NULL UNIQUE,
        scopes          TEXT NOT NULL,
        package_pattern TEXT DEFAULT '*',
        expires_at      TEXT,
        last_used_at    TEXT,
        last_used_ip    TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP TABLE IF EXISTS api_tokens;");
  },
};
