// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Migration, MigrationContext, MigrationRecord, MigrationStatus } from "./types.js";

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

  getApplied(): MigrationRecord[] {
    return this.#db
      .prepare(`SELECT id, name, checksum, applied_at, execution_ms FROM _modelscript_migrations ORDER BY id ASC`)
      .all() as MigrationRecord[];
  }

  getStatus(allMigrations: Migration[]): MigrationStatus {
    const applied = this.getApplied();
    const appliedNames = new Set(applied.map((m) => m.name));
    const pending = allMigrations.filter((m) => !appliedNames.has(m.name));
    const currentVersion = applied.length > 0 ? applied[applied.length - 1]!.name : null;

    return { applied, pending, currentVersion };
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

  runPendingSync(allMigrations: Migration[], options?: { dryRun?: boolean }): { appliedCount: number } {
    const { pending } = this.getStatus(allMigrations);

    if (pending.length === 0) {
      return { appliedCount: 0 };
    }

    if (options?.dryRun) {
      return { appliedCount: pending.length };
    }

    const context: MigrationContext = {
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
    };

    const recordStmt = this.#db.prepare(`
      INSERT INTO _modelscript_migrations (name, checksum, execution_ms)
      VALUES (?, ?, ?)
    `);

    for (const migration of pending) {
      const startTime = Date.now();
      const checksum = crypto.createHash("sha256").update(migration.name).digest("hex");

      const tx = this.#db.transaction(() => {
        migration.up(context);
        const duration = Date.now() - startTime;
        recordStmt.run(migration.name, checksum, duration);
      });
      tx();
      console.log(`[MigrationRunner] Applied migration: ${migration.name} (${Date.now() - startTime}ms)`);
    }

    this.verifyIntegrity();
    return { appliedCount: pending.length };
  }

  async runPending(
    allMigrations: Migration[],
    options?: { dryRun?: boolean; skipBackup?: boolean },
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
      if (backupPath) {
        console.log(`[MigrationRunner] Created pre-flight backup snapshot at: ${backupPath}`);
      }
    }

    try {
      const result = this.runPendingSync(allMigrations, options);
      return { appliedCount: result.appliedCount, backupPath };
    } catch (err) {
      console.error(`[MigrationRunner] Migration execution failed!`, err);
      if (backupPath) {
        console.error(`[MigrationRunner] Pre-flight backup is preserved at: ${backupPath}`);
      }
      throw err;
    }
  }

  verifyIntegrity(): { foreignKeysOk: boolean; integrityOk: boolean } {
    const fkErrors = this.#db.prepare("PRAGMA foreign_key_check").all();
    const integrity = this.#db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;

    const foreignKeysOk = !fkErrors || fkErrors.length === 0;
    const integrityOk = integrity?.integrity_check === "ok";

    if (!foreignKeysOk) {
      console.warn("[MigrationRunner] Foreign key check found inconsistencies:", fkErrors);
    }

    return { foreignKeysOk, integrityOk };
  }
}
