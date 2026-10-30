// SPDX-License-Identifier: AGPL-3.0-or-later

export type DatabaseDialect = "sqlite" | "postgres";

export interface RecreateTableOptions {
  table: string;
  newSchemaSql: string;
  columnMapping?: Record<string, string>;
  copyWhere?: string;
}

export interface ArchiveTableOptions {
  table: string;
  archiveName?: string;
  dropOriginal?: boolean;
}

export interface ArchiveTableResult {
  archiveTable: string;
  rowCount: number;
  archivedAt: string;
}

export interface MigrationContext {
  dialect: DatabaseDialect;
  execute(sql: string, params?: unknown[]): void | Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): T[] | Promise<T[]>;
  recreateTable(options: RecreateTableOptions): void;
  archiveTable(options: string | ArchiveTableOptions): ArchiveTableResult;
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
  targetVersion: string | null;
  pendingCount: number;
}
