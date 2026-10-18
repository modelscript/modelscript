// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0011: Migration = {
  id: "0011_concurrent_engineering",
  name: "0011_concurrent_engineering",
  up(ctx: MigrationContext) {
    // 1. OMG SysML v2 Branches & Tags
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS sysml2_branches (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        name            TEXT NOT NULL,
        head_commit_id  TEXT,
        created         TEXT NOT NULL,
        UNIQUE(project_id, name)
      );
    `);

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_sysml2_branches_project ON sysml2_branches(project_id);
    `);

    ctx.execute(`
      CREATE TABLE IF NOT EXISTS sysml2_tags (
        id               TEXT PRIMARY KEY,
        project_id       TEXT NOT NULL,
        name             TEXT NOT NULL,
        tagged_commit_id TEXT NOT NULL,
        created          TEXT NOT NULL,
        UNIQUE(project_id, name)
      );
    `);

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_sysml2_tags_project ON sysml2_tags(project_id);
    `);

    // 2. Persistent Digital Thread Hypergraph Snapshots & Conflict Registry
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS thread_snapshots (
        workspace_id    TEXT PRIMARY KEY,
        serialized_json TEXT NOT NULL,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    ctx.execute(`
      CREATE TABLE IF NOT EXISTS thread_conflicts (
        conflict_id     TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL DEFAULT 'default',
        slot            INTEGER NOT NULL,
        source_domain   TEXT NOT NULL,
        source_value    REAL NOT NULL,
        source_unit     TEXT NOT NULL,
        target_domain   TEXT NOT NULL,
        target_value    REAL NOT NULL,
        target_unit     TEXT NOT NULL,
        min_bound       REAL NOT NULL,
        max_bound       REAL NOT NULL,
        status          TEXT NOT NULL DEFAULT 'conflicted',
        resolved_value  REAL,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_thread_conflicts_workspace ON thread_conflicts(workspace_id, status);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP TABLE IF EXISTS thread_conflicts;");
    ctx.execute("DROP TABLE IF EXISTS thread_snapshots;");
    ctx.execute("DROP TABLE IF EXISTS sysml2_tags;");
    ctx.execute("DROP TABLE IF EXISTS sysml2_branches;");
  },
};
