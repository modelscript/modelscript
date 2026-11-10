// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

/**
 * Migration 0002: Add external issue provider tracking (Jira, GitHub, GitLab, Polarion)
 * to space_issues table.
 */
export const spaceIssuesExternalMigration: Migration = {
  id: "0002_space_issues_external",
  name: "0002_space_issues_external",
  up(ctx: MigrationContext) {
    const rawCols = ctx.query<{ name: string }>("PRAGMA table_info(space_issues)");
    const cols = Array.isArray(rawCols) ? rawCols.map((c) => c.name) : [];
    if (!cols.includes("external_source")) {
      ctx.execute("ALTER TABLE space_issues ADD COLUMN external_source TEXT DEFAULT NULL;");
    }
    if (!cols.includes("external_key")) {
      ctx.execute("ALTER TABLE space_issues ADD COLUMN external_key TEXT DEFAULT NULL;");
    }
    if (!cols.includes("external_url")) {
      ctx.execute("ALTER TABLE space_issues ADD COLUMN external_url TEXT DEFAULT NULL;");
    }
    if (!cols.includes("external_updated_at")) {
      ctx.execute("ALTER TABLE space_issues ADD COLUMN external_updated_at TEXT DEFAULT NULL;");
    }
    if (!cols.includes("sync_status")) {
      ctx.execute("ALTER TABLE space_issues ADD COLUMN sync_status TEXT DEFAULT 'synced';");
    }
    ctx.execute(
      "CREATE INDEX IF NOT EXISTS idx_space_issues_external ON space_issues(space_id, external_source, external_key);",
    );
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP INDEX IF EXISTS idx_space_issues_external;");
    const rawCols = ctx.query<{ name: string }>("PRAGMA table_info(space_issues)");
    const cols = Array.isArray(rawCols) ? rawCols.map((c) => c.name) : [];
    for (const col of ["sync_status", "external_updated_at", "external_url", "external_key", "external_source"]) {
      if (cols.includes(col)) {
        ctx.execute(`ALTER TABLE space_issues DROP COLUMN ${col};`);
      }
    }
  },
};
