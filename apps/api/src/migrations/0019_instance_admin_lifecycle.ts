// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0019: Migration = {
  id: "0019_instance_admin_lifecycle",
  name: "0019_instance_admin_lifecycle",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS instance_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS instance_invites (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        code            TEXT NOT NULL UNIQUE,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        max_uses        INTEGER NOT NULL DEFAULT 1,
        used_count      INTEGER NOT NULL DEFAULT 0,
        uses_count      INTEGER NOT NULL DEFAULT 0,
        initial_credits REAL NOT NULL DEFAULT 100.0,
        assigned_role   TEXT NOT NULL DEFAULT 'user',
        note            TEXT,
        expires_at      TEXT,
        revoked         INTEGER NOT NULL DEFAULT 0,
        revoked_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_instance_invites_code ON instance_invites(code);

      CREATE TABLE IF NOT EXISTS quarantined_resources (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type   TEXT NOT NULL,
        resource_id     TEXT NOT NULL,
        reason          TEXT NOT NULL,
        dmca_notice_id  INTEGER REFERENCES dmca_notices(id) ON DELETE SET NULL,
        quarantined_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'quarantined',
        counter_notice  TEXT,
        restore_after   TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        restored_at     TEXT,
        UNIQUE(resource_type, resource_id)
      );
      CREATE INDEX IF NOT EXISTS idx_quarantined_resources_status ON quarantined_resources(status, resource_type);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute(`
      DROP TABLE IF EXISTS quarantined_resources;
      DROP TABLE IF EXISTS instance_invites;
      DROP TABLE IF EXISTS instance_settings;
    `);
  },
};
