import type { QueryCacheStore } from "@modelscript/polyglot";
import type { Memo } from "@modelscript/polyglot/runtime";
import Database from "better-sqlite3";

/**
 * SQLite-backed implementation of QueryCacheStore for Node.js environments.
 */
export class SQLiteQueryCacheStore implements QueryCacheStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memos (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);
  }

  async getMemo(key: string): Promise<Memo | undefined> {
    const row = this.db.prepare(`SELECT data FROM memos WHERE key = ?`).get(key) as { data: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.data) as Memo;
    } catch {
      return undefined;
    }
  }

  async getMemos(keys: string[]): Promise<Map<string, Memo>> {
    const result = new Map<string, Memo>();
    if (keys.length === 0) return result;

    // SQLite has a limit on parameters (usually 999 or 32766), so batching might be needed for very large requests.
    // For preflight, assuming manageable chunks.
    const CHUNK_SIZE = 500;

    for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
      const chunk = keys.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const rows = this.db.prepare(`SELECT key, data FROM memos WHERE key IN (${placeholders})`).all(...chunk) as {
        key: string;
        data: string;
      }[];

      for (const row of rows) {
        try {
          result.set(row.key, JSON.parse(row.data) as Memo);
        } catch {
          // Ignore malformed JSON
        }
      }
    }

    return result;
  }

  async setMemo(key: string, memo: Memo): Promise<void> {
    this.db.prepare(`INSERT OR REPLACE INTO memos (key, data) VALUES (?, ?)`).run(key, JSON.stringify(memo));
  }

  async setMemos(memos: Map<string, Memo>): Promise<void> {
    const insert = this.db.prepare(`INSERT OR REPLACE INTO memos (key, data) VALUES (?, ?)`);
    const transaction = this.db.transaction((memosMap: Map<string, Memo>) => {
      for (const [key, memo] of memosMap.entries()) {
        insert.run(key, JSON.stringify(memo));
      }
    });
    transaction(memos);
  }

  async deleteMemo(key: string): Promise<void> {
    this.db.prepare(`DELETE FROM memos WHERE key = ?`).run(key);
  }

  async clearMemos(): Promise<void> {
    this.db.exec(`DELETE FROM memos`);
  }
}
