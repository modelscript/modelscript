// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import type { LibraryDatabase } from "../../database.js";

/**
 * Base repository encapsulating direct SQLite queries, statements, and transaction scopes.
 */
export abstract class BaseRepository {
  protected readonly db: Database.Database;
  protected readonly facade: LibraryDatabase;
  readonly #stmtCache = new Map<string, Database.Statement>();
  static readonly #MAX_STMT_CACHE = 256;

  constructor(db: Database.Database, facade: LibraryDatabase) {
    this.db = db;
    this.facade = facade;
  }

  protected prepare(sql: string): Database.Statement {
    let stmt = this.#stmtCache.get(sql);
    if (!stmt) {
      if (this.#stmtCache.size >= BaseRepository.#MAX_STMT_CACHE) {
        const oldestKey = this.#stmtCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.#stmtCache.delete(oldestKey);
        }
      }
      stmt = this.db.prepare(sql);
      this.#stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  protected run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.prepare(sql).run(...params);
  }

  protected get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }

  protected all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  protected transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  protected immediateTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}
