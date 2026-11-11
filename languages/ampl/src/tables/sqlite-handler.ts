// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Native SQLite Table Driver (`table ... IN/OUT "SQLITE" ...`).
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function getSqliteDatabaseClass(): any {
  try {
    const { DatabaseSync } = require("node:sqlite");
    return DatabaseSync;
  } catch (err) {
    throw new Error(
      `Native SQLite table driver requires 'node:sqlite' (Node.js v22+). Error: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
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
    const query = `SELECT * FROM "${tableName}"`;
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
    const firstRow = rows[0]!;
    const cols = Object.keys(firstRow);

    const colDefs = cols
      .map((c) => {
        const val = firstRow[c];
        const typeStr = typeof val === "number" ? "REAL" : "TEXT";
        return `"${c}" ${typeStr}`;
      })
      .join(", ");

    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs});`);

    const placeholders = cols.map(() => "?").join(", ");
    const insertStmt = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders});`);

    db.exec("BEGIN TRANSACTION;");
    for (const row of rows) {
      const vals = cols.map((c) => {
        const v = row[c];
        return v !== undefined ? v : null;
      });
      insertStmt.run(...vals);
    }
    db.exec("COMMIT;");
  } finally {
    db.close();
  }
}
