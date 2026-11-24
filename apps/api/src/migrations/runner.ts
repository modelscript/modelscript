// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ArchiveTableOptions,
  ArchiveTableResult,
  Migration,
  MigrationContext,
  MigrationRecord,
  MigrationStatus,
  RecreateTableOptions,
} from "./types.js";

export function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function computeMigrationChecksum(migration: Migration): string {
  return crypto.createHash("sha256").update(`${migration.name}:${migration.up.toString()}`).digest("hex");
}

/**
 * Translates SQLite-flavored DDL statements to PostgreSQL-compatible SQL for dual-dialect migrations.
 * Returns null if the statement is strictly SQLite-only (e.g., PRAGMA or FTS5 virtual tables).
 */
export function translateSqliteSqlToPostgres(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return null;
  if (/^PRAGMA\b/i.test(trimmed)) return null;

  let out = trimmed
    // Strip SQLite FTS5 virtual tables and triggers that rely on FTS5
    .replace(/CREATE\s+VIRTUAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+[^;]+USING\s+fts5\s*\([^;]*\)\s*;/gi, "")
    .replace(/CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+[^;]*_fts[^;]*BEGIN[\s\S]*?END\s*;/gi, "")
    // AUTOINCREMENT -> SERIAL
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "SERIAL PRIMARY KEY")
    // datetime('now') -> CURRENT_TIMESTAMP
    .replace(/DEFAULT\s*\(\s*datetime\s*\(\s*'now'\s*\)\s*\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/DEFAULT\s+datetime\s*\(\s*'now'\s*\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP")
    // BLOB -> BYTEA
    .replace(/\bBLOB\b/g, "BYTEA")
    // INSERT OR IGNORE -> INSERT ... ON CONFLICT DO NOTHING (simple single-statement fallback)
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");

  out = out.trim();
  return out.length > 0 ? out : null;
}

export function rewriteBindParamsToPostgres(sql: string): string {
  let idx = 0;
  let inSingleQuote = false;
  let result = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (ch === "'") {
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === "?" && !inSingleQuote) {
      idx++;
      result += `$${idx}`;
    } else {
      result += ch;
    }
  }
  return result;
}

export interface SqliteMigrationRunnerHooks {
  onBeforeMigration?: () => void;
  onAfterMigration?: () => void;
}

export class SqliteMigrationRunner {
  readonly #db: Database.Database;
  readonly #dbPath: string | undefined;
  readonly #hooks: SqliteMigrationRunnerHooks | undefined;

  constructor(db: Database.Database, dbPath?: string, hooks?: SqliteMigrationRunnerHooks) {
    this.#db = db;
    this.#dbPath = dbPath;
    this.#hooks = hooks;
    this.#ensureLedgerTable();
  }

  #ensureLedgerTable(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS _modelscript_migrations (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL UNIQUE,
        checksum     TEXT NOT NULL,
        applied_at   TEXT DEFAULT (datetime('now')),
        execution_ms INTEGER NOT NULL
      );
    `);
  }

  #createContext(): MigrationContext {
    return {
      dialect: "sqlite",
      execute: (sql: string, params?: unknown[]) => {
        if (params && params.length > 0) {
          this.#db.prepare(sql).run(...params);
        } else {
          this.#db.exec(sql);
        }
      },
      query: <T = unknown>(sql: string, params?: unknown[]): T[] => {
        if (params && params.length > 0) {
          return this.#db.prepare(sql).all(...params) as T[];
        }
        return this.#db.prepare(sql).all() as T[];
      },
      getTableColumns: (table: string): string[] => {
        const safeTable = quoteIdent(table);
        const rows = this.#db.prepare(`PRAGMA table_info(${safeTable})`).all() as { name: string }[];
        return rows.map((r) => r.name);
      },
      addColumnIfNotExists: (table: string, column: string, definition: string): void => {
        const safeTable = quoteIdent(table);
        const rows = this.#db.prepare(`PRAGMA table_info(${safeTable})`).all() as { name: string }[];
        if (!rows.some((r) => r.name === column)) {
          this.#db.exec(`ALTER TABLE ${safeTable} ADD COLUMN ${quoteIdent(column)} ${definition};`);
        }
      },
      dropColumnIfExists: (table: string, column: string): void => {
        const safeTable = quoteIdent(table);
        const rows = this.#db.prepare(`PRAGMA table_info(${safeTable})`).all() as { name: string }[];
        if (rows.some((r) => r.name === column)) {
          this.#db.exec(`ALTER TABLE ${safeTable} DROP COLUMN ${quoteIdent(column)};`);
        }
      },
      recreateTable: (options: RecreateTableOptions) => {
        const { table, newSchemaSql, columnMapping, copyWhere } = options;
        const tempOldTable = `__old_${table}_${Date.now()}`;
        const safeTable = quoteIdent(table);
        const safeTempOld = quoteIdent(tempOldTable);

        // 1. Rename existing table to temp table
        this.#db.exec(`ALTER TABLE ${safeTable} RENAME TO ${safeTempOld};`);

        // 2. Create the replacement table
        this.#db.exec(newSchemaSql);

        // 3. Inspect columns of both tables
        const oldCols = (this.#db.prepare(`PRAGMA table_info(${safeTempOld})`).all() as { name: string }[]).map(
          (c) => c.name,
        );
        const newCols = (this.#db.prepare(`PRAGMA table_info(${safeTable})`).all() as { name: string }[]).map(
          (c) => c.name,
        );

        let targetCols: string[] = [];
        let sourceExprs: string[] = [];

        if (columnMapping) {
          for (const [oldCol, newCol] of Object.entries(columnMapping)) {
            if (oldCols.includes(oldCol) && newCols.includes(newCol)) {
              targetCols.push(quoteIdent(newCol));
              sourceExprs.push(quoteIdent(oldCol));
            }
          }
        } else {
          const common = oldCols.filter((col) => newCols.includes(col));
          targetCols = common.map((c) => quoteIdent(c));
          sourceExprs = common.map((c) => quoteIdent(c));
        }

        if (targetCols.length > 0) {
          const whereClause = copyWhere ? ` WHERE ${copyWhere}` : "";
          this.#db.exec(`
            INSERT INTO ${safeTable} (${targetCols.join(", ")})
            SELECT ${sourceExprs.join(", ")} FROM ${safeTempOld}${whereClause};
          `);
        }

        // 4. Drop temporary table
        this.#db.exec(`DROP TABLE ${safeTempOld};`);
      },
      archiveTable: (options: string | ArchiveTableOptions): ArchiveTableResult => {
        const opts: ArchiveTableOptions = typeof options === "string" ? { table: options } : options;
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T.]/g, "")
          .slice(0, 14);
        const archiveTable = opts.archiveName || `_archived_${opts.table}_${timestamp}`;
        const dropOriginal = opts.dropOriginal !== false;
        const safeTable = quoteIdent(opts.table);
        const safeArchive = quoteIdent(archiveTable);

        const exists = this.#db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(opts.table);
        if (!exists) {
          return { archiveTable, rowCount: 0, archivedAt: new Date().toISOString() };
        }

        const countRow = this.#db.prepare(`SELECT COUNT(*) as count FROM ${safeTable}`).get() as { count: number };
        const rowCount = countRow ? Number(countRow.count) : 0;

        this.#db.exec(`CREATE TABLE IF NOT EXISTS ${safeArchive} AS SELECT * FROM ${safeTable};`);

        if (dropOriginal) {
          this.#db.exec(`DROP TABLE IF EXISTS ${safeTable};`);
        }

        return {
          archiveTable,
          rowCount,
          archivedAt: new Date().toISOString(),
        };
      },
    };
  }

  getApplied(): MigrationRecord[] {
    this.#ensureLedgerTable();
    return this.#db
      .prepare(`SELECT id, name, checksum, applied_at, execution_ms FROM _modelscript_migrations ORDER BY id ASC`)
      .all() as MigrationRecord[];
  }

  getStatus(allMigrations: Migration[]): MigrationStatus {
    const rawApplied = this.getApplied();
    const migrationMap = new Map(allMigrations.map((m) => [m.name, m]));
    let checksumMatch = true;
    const applied = rawApplied.map((record) => {
      const def = migrationMap.get(record.name);
      if (!def) {
        checksumMatch = false;
        return { ...record, checksumMatch: false };
      }
      const expectedChecksum = crypto.createHash("sha256").update(`${def.name}:${def.up.toString()}`).digest("hex");
      const matches = record.checksum === expectedChecksum;
      if (!matches) {
        checksumMatch = false;
      }
      return { ...record, checksumMatch: matches };
    });
    const appliedNames = new Set(applied.map((m) => m.name));
    const pending = allMigrations.filter((m) => !appliedNames.has(m.name));
    const currentVersion = applied.length > 0 ? applied[applied.length - 1]!.name : null;
    const targetVersion = allMigrations.length > 0 ? allMigrations[allMigrations.length - 1]!.name : null;
    const pendingCount = pending.length;

    return { applied, pending, currentVersion, targetVersion, pendingCount, checksumMatch };
  }

  async createBackup(): Promise<string | null> {
    if (!this.#dbPath || !fs.existsSync(this.#dbPath)) {
      return null;
    }

    const timestamp = Date.now();
    const backupDir = path.dirname(this.#dbPath);
    const backupName = `${path.basename(this.#dbPath)}.bak-${timestamp}`;
    const backupPath = path.join(backupDir, backupName);

    try {
      await this.#db.backup(backupPath);
      return backupPath;
    } catch (err) {
      console.warn("[MigrationRunner] Pre-flight backup warning:", err);
      return null;
    }
  }

  #reconcileSquashedLedger(allMigrations: Migration[]): void {
    const legacyPreSquashNames = new Set([
      "0002_feature_flags",
      "0003_package_lifecycle",
      "0004_package_analytics",
      "0005_organizations_and_rbac",
      "0006_repo_webhooks",
      "0007_auth_security_hardening",
      "0008_auth_totp_and_audit",
      "0009_notifications_metadata",
      "0010_thread_governance",
      "0011_concurrent_engineering",
      "0012_granular_api_tokens",
      "0013_social_llm_bots",
      "0014_bot_byok",
      "0015_repo_bot_reviews",
      "0016_solutions",
      "0017_commercial_hardening",
      "0018_unified_page_analytics",
      "0019_instance_admin_lifecycle",
      "0020_ansatz_onboarding_and_referrals",
      "0021_schema_consolidation",
      "0022_instance_invites_columns",
      "0023_mastodon_platform_parity",
    ]);
    const hasConsolidatedBaseline =
      allMigrations.length >= 1 &&
      allMigrations[0]?.name === "0001_baseline_schema" &&
      !allMigrations.some((m) => legacyPreSquashNames.has(m.name));
    if (!hasConsolidatedBaseline) {
      return;
    }
    this.#ensureLedgerTable();
    const legacyRow = this.#db
      .prepare(
        `SELECT 1 FROM _modelscript_migrations WHERE name IN (
          '0002_feature_flags',
          '0003_package_lifecycle',
          '0004_package_analytics',
          '0005_organizations_and_rbac',
          '0006_repo_webhooks',
          '0007_auth_security_hardening',
          '0008_auth_totp_and_audit',
          '0009_notifications_metadata',
          '0010_thread_governance',
          '0011_concurrent_engineering',
          '0012_granular_api_tokens',
          '0013_social_llm_bots',
          '0014_bot_byok',
          '0015_repo_bot_reviews',
          '0016_solutions',
          '0017_commercial_hardening',
          '0018_unified_page_analytics',
          '0019_instance_admin_lifecycle',
          '0020_ansatz_onboarding_and_referrals',
          '0021_schema_consolidation',
          '0022_instance_invites_columns',
          '0023_mastodon_platform_parity'
        ) LIMIT 1`,
      )
      .get();
    if (legacyRow) {
      this.#db.exec(`DELETE FROM _modelscript_migrations;`);
    }
  }

  runPendingSync(
    allMigrations: Migration[],
    options?: { dryRun?: boolean | undefined; skipBackup?: boolean | undefined; silent?: boolean | undefined },
  ): { appliedCount: number; backupPath?: string | null | undefined } {
    if (!options?.dryRun) {
      this.#reconcileSquashedLedger(allMigrations);
    }
    const { pending } = this.getStatus(allMigrations);

    if (pending.length === 0) {
      return { appliedCount: 0, backupPath: null };
    }

    if (options?.dryRun) {
      return { appliedCount: pending.length, backupPath: null };
    }

    let backupPath: string | null = null;
    if (
      !options?.skipBackup &&
      this.#dbPath &&
      this.#dbPath !== ":memory:" &&
      fs.existsSync(this.#dbPath) &&
      fs.statSync(this.#dbPath).size > 0
    ) {
      const timestamp = Date.now();
      const backupDir = path.dirname(this.#dbPath);
      const backupName = `${path.basename(this.#dbPath)}.bak-${timestamp}`;
      backupPath = path.join(backupDir, backupName);
      try {
        this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        this.#db.prepare("VACUUM INTO ?").run(backupPath);
      } catch (err) {
        console.warn("[MigrationRunner] Pre-flight sync backup warning:", err);
        backupPath = null;
      }
    }

    const context = this.#createContext();

    const checkStmt = this.#db.prepare(`
      SELECT 1 FROM _modelscript_migrations WHERE name = ?
    `);

    const recordStmt = this.#db.prepare(`
      INSERT OR IGNORE INTO _modelscript_migrations (name, checksum, execution_ms)
      VALUES (?, ?, ?)
    `);

    this.#hooks?.onBeforeMigration?.();
    try {
      let actuallyAppliedCount = 0;
      for (const migration of pending) {
        const startTime = Date.now();
        const checksum = crypto
          .createHash("sha256")
          .update(`${migration.name}:${migration.up.toString()}`)
          .digest("hex");
        let applied = false;

        const tx = this.#db.transaction(() => {
          // Concurrency guard: check if another process applied this migration in the interim
          const already = checkStmt.get(migration.name);
          if (already) {
            return;
          }
          migration.up(context);
          const duration = Date.now() - startTime;
          recordStmt.run(migration.name, checksum, duration);
          applied = true;
        });
        tx.immediate();
        if (applied) {
          actuallyAppliedCount++;
          if (!options?.silent) {
            console.log(`[MigrationRunner] Applied migration: ${migration.name} (${Date.now() - startTime}ms)`);
          }
        }
      }

      this.verifyIntegrity();
      return { appliedCount: actuallyAppliedCount, backupPath };
    } finally {
      this.#hooks?.onAfterMigration?.();
    }
  }

  rollbackLastSync(
    allMigrations: Migration[],
    options?: { silent?: boolean | undefined },
  ): { rolledBack: string | null } {
    const applied = this.getApplied();
    if (applied.length === 0) {
      return { rolledBack: null };
    }

    const lastApplied = applied[applied.length - 1]!;
    const migration = allMigrations.find((m) => m.name === lastApplied.name);

    if (!migration) {
      throw new Error(`Cannot rollback '${lastApplied.name}': Migration definition not found`);
    }

    if (!migration.down) {
      throw new Error(`Cannot rollback '${lastApplied.name}': No down() method defined on migration`);
    }

    const context = this.#createContext();
    const deleteStmt = this.#db.prepare(`DELETE FROM _modelscript_migrations WHERE name = ?`);

    this.#hooks?.onBeforeMigration?.();
    try {
      const tx = this.#db.transaction(() => {
        migration.down!(context);
        deleteStmt.run(lastApplied.name);
      });
      tx.immediate();

      if (!options?.silent) {
        console.log(`[MigrationRunner] Rolled back migration: ${lastApplied.name}`);
      }

      this.verifyIntegrity();
      return { rolledBack: lastApplied.name };
    } finally {
      this.#hooks?.onAfterMigration?.();
    }
  }

  async rollbackLast(
    allMigrations: Migration[],
    options?: { skipBackup?: boolean | undefined; silent?: boolean | undefined },
  ): Promise<{ rolledBack: string | null; backupPath: string | null }> {
    let backupPath: string | null = null;
    if (!options?.skipBackup) {
      backupPath = await this.createBackup();
      if (backupPath && !options?.silent) {
        console.log(`[MigrationRunner] Created pre-flight backup snapshot at: ${backupPath}`);
      }
    }

    const result = this.rollbackLastSync(allMigrations, options);
    return { rolledBack: result.rolledBack, backupPath };
  }

  migrateDownSync(
    targetMigrationName: string,
    allMigrations: Migration[],
    options?: { silent?: boolean | undefined },
  ): { rolledBackCount: number } {
    let count = 0;
    while (true) {
      const applied = this.getApplied();
      if (applied.length === 0) break;
      const current = applied[applied.length - 1]!;
      if (current.name === targetMigrationName) break;

      this.rollbackLastSync(allMigrations, options);
      count++;
    }
    return { rolledBackCount: count };
  }

  async runPending(
    allMigrations: Migration[],
    options?: { dryRun?: boolean | undefined; skipBackup?: boolean | undefined; silent?: boolean | undefined },
  ): Promise<{ appliedCount: number; backupPath: string | null }> {
    if (!options?.dryRun) {
      this.#reconcileSquashedLedger(allMigrations);
    }
    const { pending } = this.getStatus(allMigrations);

    if (pending.length === 0) {
      return { appliedCount: 0, backupPath: null };
    }

    if (options?.dryRun) {
      return { appliedCount: pending.length, backupPath: null };
    }

    let backupPath: string | null = null;
    if (!options?.skipBackup) {
      backupPath = await this.createBackup();
      if (backupPath && !options?.silent) {
        console.log(`[MigrationRunner] Created pre-flight backup snapshot at: ${backupPath}`);
      }
    }

    try {
      const result = this.runPendingSync(allMigrations, { ...options, skipBackup: true });
      return { appliedCount: result.appliedCount, backupPath };
    } catch (err) {
      if (!options?.silent) {
        console.error(`[MigrationRunner] Migration execution failed!`, err);
        if (backupPath) {
          console.error(`[MigrationRunner] Pre-flight backup is preserved at: ${backupPath}`);
        }
      }
      throw err;
    }
  }

  verifyIntegrity(): { foreignKeysOk: boolean; integrityOk: boolean } {
    const fkErrors = this.#db.prepare("PRAGMA foreign_key_check").all();
    const integrity = this.#db.prepare("PRAGMA integrity_check").get() as
      { integrity_check?: string | undefined } | undefined;

    const foreignKeysOk = !fkErrors || fkErrors.length === 0;
    const integrityOk = integrity?.integrity_check === "ok";

    if (!foreignKeysOk) {
      console.warn("[MigrationRunner] Foreign key check found inconsistencies:", fkErrors);
    }

    return { foreignKeysOk, integrityOk };
  }
}

export interface PostgresClientLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  connect?(): Promise<{
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
    release(): void;
  }>;
}

export class PostgresMigrationRunner {
  readonly #pool: PostgresClientLike;

  constructor(pool: PostgresClientLike) {
    this.#pool = pool;
  }

  async ensureLedgerTable(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS _modelscript_migrations (
        id           SERIAL PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE,
        checksum     TEXT NOT NULL,
        applied_at   TIMESTAMPTZ DEFAULT NOW(),
        execution_ms INTEGER NOT NULL
      );
    `);
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    await this.ensureLedgerTable();
    const res = await this.#pool.query(
      `SELECT id, name, checksum, applied_at, execution_ms FROM _modelscript_migrations ORDER BY id ASC`,
    );
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      id: Number(r["id"]),
      name: String(r["name"]),
      checksum: String(r["checksum"]),
      applied_at: r["applied_at"] instanceof Date ? (r["applied_at"] as Date).toISOString() : String(r["applied_at"]),
      execution_ms: Number(r["execution_ms"]),
    }));
  }

  async getStatus(migrations: Migration[]): Promise<MigrationStatus> {
    const applied = await this.getAppliedMigrations();
    const appliedNames = new Set(applied.map((a) => a.name));
    const pending = migrations.filter((m) => !appliedNames.has(m.name));
    let checksumMatch = true;

    for (const app of applied) {
      const def = migrations.find((m) => m.name === app.name);
      if (def) {
        const sum = computeMigrationChecksum(def);
        if (app.checksum && app.checksum !== sum) {
          app.checksumMatch = false;
          checksumMatch = false;
        } else {
          app.checksumMatch = true;
        }
      }
    }

    return {
      applied,
      pending,
      currentVersion: applied.length > 0 ? applied[applied.length - 1]!.name : null,
      targetVersion: migrations.length > 0 ? migrations[migrations.length - 1]!.name : null,
      pendingCount: pending.length,
      checksumMatch,
    };
  }

  #buildPgContext(client: PostgresClientLike, pendingOps: Array<() => Promise<void>>): MigrationContext {
    const enqueueSql = (rawSql: string, params?: unknown[]): Promise<void> => {
      const translated = translateSqliteSqlToPostgres(rawSql);
      if (!translated) return Promise.resolve();
      const pgSql = params && params.length > 0 ? rewriteBindParamsToPostgres(translated) : translated;
      let resolveOp!: () => void;
      let rejectOp!: (err: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolveOp = res;
        rejectOp = rej;
      });
      pendingOps.push(async () => {
        try {
          if (params && params.length > 0) {
            await client.query(pgSql, params);
          } else {
            await client.query(pgSql);
          }
          resolveOp();
        } catch (err) {
          rejectOp(err);
          throw err;
        }
      });
      return promise;
    };

    return {
      dialect: "postgres",
      execute: (sql: string, params?: unknown[]) => enqueueSql(sql, params),
      query: async <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> => {
        const translated = translateSqliteSqlToPostgres(sql);
        if (!translated) return [];
        const pgSql = params && params.length > 0 ? rewriteBindParamsToPostgres(translated) : translated;
        const res = params && params.length > 0 ? await client.query(pgSql, params) : await client.query(pgSql);
        return res.rows as T[];
      },
      getTableColumns: async (table: string): Promise<string[]> => {
        const res = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        return (res.rows as { column_name: string }[]).map((r) => r.column_name);
      },
      addColumnIfNotExists: (table: string, column: string, definition: string) => {
        const safeTable = quoteIdent(table);
        const safeCol = quoteIdent(column);
        return enqueueSql(`ALTER TABLE ${safeTable} ADD COLUMN IF NOT EXISTS ${safeCol} ${definition};`);
      },
      dropColumnIfExists: (table: string, column: string) => {
        const safeTable = quoteIdent(table);
        const safeCol = quoteIdent(column);
        return enqueueSql(`ALTER TABLE ${safeTable} DROP COLUMN IF EXISTS ${safeCol};`);
      },
      recreateTable: (_opts: RecreateTableOptions) => {
        throw new Error("recreateTable is not supported on PostgreSQL; use standard ALTER TABLE");
      },
      archiveTable: async (options: string | ArchiveTableOptions): Promise<ArchiveTableResult> => {
        const opts: ArchiveTableOptions = typeof options === "string" ? { table: options } : options;
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T.]/g, "")
          .slice(0, 14);
        const archiveTable = opts.archiveName || `_archived_${opts.table}_${timestamp}`;
        const dropOriginal = opts.dropOriginal !== false;
        const safeTable = quoteIdent(opts.table);
        const safeArchive = quoteIdent(archiveTable);

        const existsRes = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
          [opts.table],
        );
        if (existsRes.rows.length === 0) {
          return { archiveTable, rowCount: 0, archivedAt: new Date().toISOString() };
        }
        const countRes = await client.query(`SELECT COUNT(*)::int AS count FROM ${safeTable}`);
        const rowCount = Number((countRes.rows[0] as { count?: number } | undefined)?.count ?? 0);
        await client.query(`CREATE TABLE IF NOT EXISTS ${safeArchive} AS SELECT * FROM ${safeTable};`);
        if (dropOriginal) {
          await client.query(`DROP TABLE IF EXISTS ${safeTable};`);
        }
        return { archiveTable, rowCount, archivedAt: new Date().toISOString() };
      },
    };
  }

  async runPending(
    migrations: Migration[],
    options?: { dryRun?: boolean; silent?: boolean },
  ): Promise<{ appliedCount: number }> {
    await this.ensureLedgerTable();
    const status = await this.getStatus(migrations);
    if (options?.dryRun || status.pending.length === 0) {
      return { appliedCount: status.pending.length };
    }

    let appliedCount = 0;
    for (const migration of status.pending) {
      const client = typeof this.#pool.connect === "function" ? await this.#pool.connect() : this.#pool;
      try {
        await client.query("BEGIN");
        const start = Date.now();
        const pendingOps: Array<() => Promise<void>> = [];
        const ctx = this.#buildPgContext(client, pendingOps);

        await migration.up(ctx);
        for (const op of pendingOps) {
          await op();
        }

        const duration = Date.now() - start;
        const checksum = computeMigrationChecksum(migration);
        await client.query(`INSERT INTO _modelscript_migrations (name, checksum, execution_ms) VALUES ($1, $2, $3)`, [
          migration.name,
          checksum,
          duration,
        ]);
        await client.query("COMMIT");
        appliedCount++;
        if (!options?.silent) {
          console.log(`[PostgresMigrationRunner] Applied migration: ${migration.name} (${duration}ms)`);
        }
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        if ("release" in client && typeof (client as { release?: () => void }).release === "function") {
          (client as { release: () => void }).release();
        }
      }
    }
    return { appliedCount };
  }

  async rollbackLast(migrations: Migration[], options?: { silent?: boolean }): Promise<{ rolledBack: string | null }> {
    await this.ensureLedgerTable();
    const applied = await this.getAppliedMigrations();
    if (applied.length === 0) return { rolledBack: null };

    const last = applied[applied.length - 1]!;
    const def = migrations.find((m) => m.name === last.name);
    if (!def || !def.down) {
      throw new Error(`Migration '${last.name}' does not define a down() rollback handler.`);
    }

    const client = typeof this.#pool.connect === "function" ? await this.#pool.connect() : this.#pool;
    try {
      await client.query("BEGIN");
      const pendingOps: Array<() => Promise<void>> = [];
      const ctx = this.#buildPgContext(client, pendingOps);
      await def.down(ctx);
      for (const op of pendingOps) {
        await op();
      }
      await client.query(`DELETE FROM _modelscript_migrations WHERE name = $1`, [last.name]);
      await client.query("COMMIT");
      if (!options?.silent) {
        console.log(`[PostgresMigrationRunner] Rolled back migration: ${last.name}`);
      }
      return { rolledBack: last.name };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      if ("release" in client && typeof (client as { release?: () => void }).release === "function") {
        (client as { release: () => void }).release();
      }
    }
  }
}
