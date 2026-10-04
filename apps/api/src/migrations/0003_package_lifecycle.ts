// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const packageLifecycleMigration: Migration = {
  id: "0003_package_lifecycle",
  name: "0003_package_lifecycle",
  up(ctx: MigrationContext) {
    // Add deprecation and yanking columns to library_releases
    try {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN is_deprecated INTEGER DEFAULT 0;");
    } catch {
      // Column may already exist
    }
    try {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN deprecation_reason TEXT;");
    } catch {
      // Column may already exist
    }
    try {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN is_yanked INTEGER DEFAULT 0;");
    } catch {
      // Column may already exist
    }
    try {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN yank_reason TEXT;");
    } catch {
      // Column may already exist
    }
    try {
      ctx.execute("ALTER TABLE library_releases ADD COLUMN yanked_at TEXT;");
    } catch {
      // Column may already exist
    }

    // Create ownership transfer table
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS package_ownership_transfers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_name    TEXT NOT NULL,
        from_user_id    INTEGER NOT NULL REFERENCES users(id),
        to_user_id      INTEGER NOT NULL REFERENCES users(id),
        status          TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'canceled')),
        created_at      TEXT DEFAULT (datetime('now')),
        resolved_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pkg_transfer_to ON package_ownership_transfers(to_user_id, status);
    `);
  },
};
