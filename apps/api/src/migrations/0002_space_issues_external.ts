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
    ctx.addColumnIfNotExists("space_issues", "external_source", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("space_issues", "external_key", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("space_issues", "external_url", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("space_issues", "external_updated_at", "TEXT DEFAULT NULL");
    ctx.addColumnIfNotExists("space_issues", "sync_status", "TEXT DEFAULT 'synced'");
    ctx.execute(
      "CREATE INDEX IF NOT EXISTS idx_space_issues_external ON space_issues(space_id, external_source, external_key);",
    );
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP INDEX IF EXISTS idx_space_issues_external;");
    for (const col of ["sync_status", "external_updated_at", "external_url", "external_key", "external_source"]) {
      ctx.dropColumnIfExists("space_issues", col);
    }
  },
};
