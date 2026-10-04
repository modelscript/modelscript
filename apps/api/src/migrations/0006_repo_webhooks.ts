// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0006: Migration = {
  id: "0006_repo_webhooks",
  name: "0006_repo_webhooks",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS repo_webhooks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id         INTEGER NOT NULL REFERENCES linked_repos(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL CHECK(provider IN ('github', 'gitlab', 'local', 'custom')),
        secret          TEXT NOT NULL,
        events          TEXT NOT NULL DEFAULT '["push", "release"]',
        auto_publish    INTEGER DEFAULT 1,
        tag_pattern     TEXT DEFAULT '^v?([0-9]+\\\\.[0-9]+\\\\.[0-9]+)$',
        is_active       INTEGER DEFAULT 1,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_repo_webhooks_repo ON repo_webhooks(repo_id);

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id      INTEGER NOT NULL REFERENCES repo_webhooks(id) ON DELETE CASCADE,
        event_type      TEXT NOT NULL,
        payload         TEXT NOT NULL,
        response_status INTEGER,
        error_message   TEXT,
        delivered_at    TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh ON webhook_deliveries(webhook_id);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS webhook_deliveries;
      DROP TABLE IF EXISTS repo_webhooks;
    `);
  },
};
