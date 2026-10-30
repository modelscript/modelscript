// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import type { LibraryDatabase } from "../../database.js";

/**
 * Base repository encapsulating direct SQLite queries, statements, and transaction scopes.
 */
export abstract class BaseRepository {
  protected readonly db: Database.Database;
  protected readonly facade: LibraryDatabase;

  constructor(db: Database.Database, facade: LibraryDatabase) {
    this.db = db;
    this.facade = facade;
  }

  protected run(sql: string, ...params: unknown[]): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }

  protected get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  protected all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  protected transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
