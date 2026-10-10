// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0010: Migration = {
  id: "0010_thread_governance",
  name: "0010_thread_governance",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS thread_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        proposed_by TEXT NOT NULL,
        diff_summary TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at DATETIME,
        resolved_by TEXT,
        review_comment TEXT
      );
    `);

    ctx.execute(`
      CREATE TABLE IF NOT EXISTS thread_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        proposal_id INTEGER REFERENCES thread_proposals(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        safety_standard TEXT,
        checksum TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_thread_proposals_thread_status ON thread_proposals(thread_id, status);
    `);

    ctx.execute(`
      CREATE INDEX IF NOT EXISTS idx_thread_audit_log_thread_created ON thread_audit_log(thread_id, created_at);
    `);
  },
  down(ctx: MigrationContext) {
    ctx.execute("DROP TABLE IF EXISTS thread_audit_log;");
    ctx.execute("DROP TABLE IF EXISTS thread_proposals;");
  },
};
