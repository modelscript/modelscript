// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Native SQLite Table Driver (`table ... IN/OUT "SQLITE" ...`).
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

interface SqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  run(...params: unknown[]): void;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

type SqliteDatabaseCtor = new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;

function getSqliteDatabaseClass(): SqliteDatabaseCtor {
  try {
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: SqliteDatabaseCtor };
    return DatabaseSync;
  } catch (err) {
    throw new Error(
      `Native SQLite table driver requires 'node:sqlite' (Node.js v22+). Error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function quoteSqliteIdent(ident: string): string {
  if (!ident || ident.includes("\0")) {
    throw new Error(`Invalid SQLite identifier: ${JSON.stringify(ident)}`);
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

/**
 * Reads row records from a SQLite database file.
 */
export function readSqliteTableRows(
  dbFilePath: string,
  tableName: string,
  baseDir?: string,
): Record<string, string | number>[] {
  const DatabaseSync = getSqliteDatabaseClass();
  const absPath = baseDir ? path.resolve(baseDir, dbFilePath) : path.resolve(dbFilePath);
  const db = new DatabaseSync(absPath);

  try {
    const quotedTable = quoteSqliteIdent(tableName);
    const query = `SELECT * FROM ${quotedTable}`;
    const stmt = db.prepare(query);
    const results = stmt.all();
    return results as Record<string, string | number>[];
  } finally {
    db.close();
  }
}

/**
 * Writes row records into a SQLite database file, creating the table if it does not exist.
 */
export function writeSqliteTableRows(
  dbFilePath: string,
  tableName: string,
  rows: Record<string, string | number>[],
  baseDir?: string,
): void {
  if (rows.length === 0) return;

  const DatabaseSync = getSqliteDatabaseClass();
  const absPath = baseDir ? path.resolve(baseDir, dbFilePath) : path.resolve(dbFilePath);
  const db = new DatabaseSync(absPath);

  try {
    const quotedTable = quoteSqliteIdent(tableName);
    const firstRow = rows[0]!;
    const cols = Object.keys(firstRow);
    if (cols.length === 0) return;

    const colDefs = cols
      .map((c) => {
        const val = firstRow[c];
        const typeStr = typeof val === "number" ? "REAL" : "TEXT";
        return `${quoteSqliteIdent(c)} ${typeStr}`;
      })
      .join(", ");

    db.exec(`CREATE TABLE IF NOT EXISTS ${quotedTable} (${colDefs});`);

    const placeholders = cols.map(() => "?").join(", ");
    const insertStmt = db.prepare(`INSERT INTO ${quotedTable} VALUES (${placeholders});`);

    db.exec("BEGIN TRANSACTION;");
    try {
      for (const row of rows) {
        const vals = cols.map((c) => {
          const v = row[c];
          return v !== undefined ? v : null;
        });
        insertStmt.run(...vals);
      }
      db.exec("COMMIT;");
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // Ignore rollback failure when transaction is already closed
      }
      throw err;
    }
  } finally {
    db.close();
  }
}
