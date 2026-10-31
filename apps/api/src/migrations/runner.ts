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

export class SqliteMigrationRunner {
  readonly #db: Database.Database;
  readonly #dbPath: string | undefined;

  constructor(db: Database.Database, dbPath?: string) {
    this.#db = db;
    this.#dbPath = dbPath;
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

  runPendingSync(
    allMigrations: Migration[],
    options?: { dryRun?: boolean | undefined; skipBackup?: boolean | undefined; silent?: boolean | undefined },
  ): { appliedCount: number; backupPath?: string | null | undefined } {
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

    let actuallyAppliedCount = 0;
    for (const migration of pending) {
      const startTime = Date.now();
      const checksum = crypto.createHash("sha256").update(`${migration.name}:${migration.up.toString()}`).digest("hex");
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
