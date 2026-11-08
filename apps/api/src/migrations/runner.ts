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
      recreateTable: (options: RecreateTableOptions) => {
        const { table, newSchemaSql, columnMapping, copyWhere } = options;
        const tempOldTable = `__old_${table}_${Date.now()}`;

        // 1. Rename existing table to temp table
        this.#db.exec(`ALTER TABLE "${table}" RENAME TO "${tempOldTable}";`);

        // 2. Create the replacement table
        this.#db.exec(newSchemaSql);

        // 3. Inspect columns of both tables
        const oldCols = (this.#db.prepare(`PRAGMA table_info("${tempOldTable}")`).all() as { name: string }[]).map(
          (c) => c.name,
        );
        const newCols = (this.#db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map(
          (c) => c.name,
        );

        let targetCols: string[] = [];
        let sourceExprs: string[] = [];

        if (columnMapping) {
          for (const [oldCol, newCol] of Object.entries(columnMapping)) {
            if (oldCols.includes(oldCol) && newCols.includes(newCol)) {
              targetCols.push(`"${newCol}"`);
              sourceExprs.push(`"${oldCol}"`);
            }
          }
        } else {
          const common = oldCols.filter((col) => newCols.includes(col));
          targetCols = common.map((c) => `"${c}"`);
          sourceExprs = common.map((c) => `"${c}"`);
        }

        if (targetCols.length > 0) {
          const whereClause = copyWhere ? ` WHERE ${copyWhere}` : "";
          this.#db.exec(`
            INSERT INTO "${table}" (${targetCols.join(", ")})
            SELECT ${sourceExprs.join(", ")} FROM "${tempOldTable}"${whereClause};
          `);
        }

        // 4. Drop temporary table
        this.#db.exec(`DROP TABLE "${tempOldTable}";`);
      },
      archiveTable: (options: string | ArchiveTableOptions): ArchiveTableResult => {
        const opts: ArchiveTableOptions = typeof options === "string" ? { table: options } : options;
        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T.]/g, "")
          .slice(0, 14);
        const archiveTable = opts.archiveName || `_archived_${opts.table}_${timestamp}`;
        const dropOriginal = opts.dropOriginal !== false;

        const exists = this.#db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(opts.table);
        if (!exists) {
          return { archiveTable, rowCount: 0, archivedAt: new Date().toISOString() };
        }

        const countRow = this.#db.prepare(`SELECT COUNT(*) as count FROM "${opts.table}"`).get() as { count: number };
        const rowCount = countRow ? Number(countRow.count) : 0;

        this.#db.exec(`CREATE TABLE IF NOT EXISTS "${archiveTable}" AS SELECT * FROM "${opts.table}";`);

        if (dropOriginal) {
          this.#db.exec(`DROP TABLE IF EXISTS "${opts.table}";`);
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
    const hasConsolidatedBaseline = allMigrations.length === 1 && allMigrations[0]?.name === "0001_baseline_schema";
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
        fs.copyFileSync(this.#dbPath, backupPath);
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
      | { integrity_check?: string | undefined }
      | undefined;

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
        const sum = crypto
          .createHash("sha256")
          .update(def.name + (def.id || ""))
          .digest("hex");
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
        const ctx: MigrationContext = {
          dialect: "postgres",
          execute: async (sql: string, params?: unknown[]) => {
            if (params && params.length > 0) {
              await client.query(sql, params);
            } else {
              await client.query(sql);
            }
          },
          query: async <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> => {
            const res = params && params.length > 0 ? await client.query(sql, params) : await client.query(sql);
            return res.rows as T[];
          },
          recreateTable: (_opts: RecreateTableOptions) => {
            throw new Error("recreateTable is not supported on PostgreSQL; use standard ALTER TABLE");
          },
          archiveTable: (_opts: string | ArchiveTableOptions): ArchiveTableResult => {
            throw new Error("archiveTable is not implemented for PostgreSQL");
          },
        };

        await migration.up(ctx);
        const duration = Date.now() - start;
        const checksum = crypto
          .createHash("sha256")
          .update(migration.name + (migration.id || ""))
          .digest("hex");
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
}
