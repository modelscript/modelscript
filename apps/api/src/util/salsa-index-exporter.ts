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
  `);

  const insertSymbol = db.prepare(`INSERT OR REPLACE INTO symbols (id, data) VALUES (?, ?)`);
  const insertMemo = db.prepare(`INSERT OR REPLACE INTO memos (key, data) VALUES (?, ?)`);

  const transaction = db.transaction(() => {
    // Dump symbols
    for (const [id, entry] of engine.index.symbols.entries()) {
      insertSymbol.run(id, JSON.stringify(entry));
    }

    // Dump memos
    for (const [key, memo] of engine.dumpMemos().entries()) {
      insertMemo.run(key, JSON.stringify(memo));
    }
  });

  transaction();
  db.close();
}
