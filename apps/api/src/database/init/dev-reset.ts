// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import { type SqliteMigrationRunner, allMigrations } from "../../migrations/index.js";

export interface ResetDevDatabaseParams {
  db: Database.Database;
  openalexDb: Database.Database | null;
  auditDb: Database.Database | null;
  analyticsDb: Database.Database | null;
  runner: SqliteMigrationRunner;
  onBeforeReset: () => void;
  onAfterMigrations: () => void;
}

export function resetDevDatabase(params: ResetDevDatabaseParams): void {
  const { db, openalexDb, auditDb, analyticsDb, runner, onBeforeReset, onAfterMigrations } = params;

  onBeforeReset();
  db.exec("PRAGMA foreign_keys = OFF;");
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
    name: string;
  }[];
  db.transaction(() => {
    for (const { name } of rows) {
      const safeName = name.replace(/"/g, '""');
      db.exec(`DROP TABLE IF EXISTS main."${safeName}";`);
    }
  })();

  if (openalexDb && openalexDb.open) {
    try {
      openalexDb.exec(`
        DROP TRIGGER IF EXISTS trg_scholarly_works_fts_ai;
        DROP TRIGGER IF EXISTS trg_scholarly_works_fts_ad;
        DROP TRIGGER IF EXISTS trg_scholarly_works_fts_au;
        DROP TABLE IF EXISTS scholarly_works_fts;
        DROP TABLE IF EXISTS scholarly_works;
        DROP TABLE IF EXISTS openalex_s3_partitions;
      `);
    } catch {
      // Best-effort OpenAlex reset during dev wipe
    }
  }

  if (auditDb) {
    try {
      auditDb.exec(`DELETE FROM audit_logs;`);
    } catch {
      // Best-effort audit DB clear during dev wipe
    }
  }

  if (analyticsDb) {
    try {
      analyticsDb.exec(`
        DELETE FROM page_views_daily;
        DELETE FROM page_location_stats_daily;
        DELETE FROM package_downloads_daily;
        DELETE FROM post_location_stats;
      `);
    } catch {
      // Best-effort analytics DB clear during dev wipe
    }
  }

  runner.runPendingSync(allMigrations, { silent: true });
  onAfterMigrations();
  db.exec("PRAGMA foreign_keys = ON;");
}
