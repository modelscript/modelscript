// SPDX-License-Identifier: AGPL-3.0-or-later

export type DatabaseDialect = "sqlite" | "postgres";

export interface MigrationContext {
  dialect: DatabaseDialect;
  execute(sql: string, params?: unknown[]): void | Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): T[] | Promise<T[]>;
}

export interface Migration {
  id: string;
  name: string;
  up(ctx: MigrationContext): void | Promise<void>;
  down?(ctx: MigrationContext): void | Promise<void>;
}

export interface MigrationRecord {
  id: number;
  name: string;
  checksum: string;
  applied_at: string;
  execution_ms: number;
}

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: Migration[];
  currentVersion: string | null;
}
