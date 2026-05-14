import type { QueryEngine } from "@modelscript/polyglot";
import Database from "better-sqlite3";

/**
 * Serializes a QueryEngine's state (SymbolIndex and Memos) into a SQLite database.
 * This generated artifact can be served by the registry and hydrated by edge clients.
 */
export async function exportSalsaIndex(engine: QueryEngine, dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memos (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertSymbol = db.prepare(`INSERT OR REPLACE INTO symbols (id, data) VALUES (?, ?)`);
  const insertMemo = db.prepare(`INSERT OR REPLACE INTO memos (key, data) VALUES (?, ?)`);
  const insertMeta = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);

  const transaction = db.transaction(() => {
    // Schema version for forward compatibility
    insertMeta.run("schema_version", "1");
    insertMeta.run("created_at", new Date().toISOString());

    // Dump symbols
    for (const [id, entry] of engine.index.symbols.entries()) {
      insertSymbol.run(id, JSON.stringify(entry));
    }

    // Dump memos — only those whose values survive JSON serialization.
    // Many queries produce live object instances (ModelicaClassInstance, etc.)
    // that contain circular references and closures.
    let exported = 0;
    let skipped = 0;
    for (const [key, memo] of engine.dumpMemos().entries()) {
      try {
        const serialized = JSON.stringify(memo);
        insertMemo.run(key, serialized);
        exported++;
      } catch {
        skipped++;
      }
    }
    if (skipped > 0) {
      console.log(`[salsa-export] Exported ${exported} memos, skipped ${skipped} non-serializable`);
    }
  });

  transaction();
  db.close();
}
