// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0006: Persist SysML v2 project ownership across API server restarts.
 * Compatible with both SQLite and PostgreSQL.
 */
export const sysml2ProjectOwnersMigration: Migration = {
  id: "0006_sysml2_project_owners",
  name: "0006_sysml2_project_owners",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS sysml2_project_owners (
        project_id TEXT PRIMARY KEY,
        owner_id   INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP TABLE IF EXISTS sysml2_project_owners;");
  },
};
