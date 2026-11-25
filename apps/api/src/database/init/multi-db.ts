// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SqliteMemoryBudget {
  mmapSize: number;
  cacheSize: number;
}

export function resolveDefaultDbDir(): string {
  const envDir =
    process.env["DB_DIR"] ||
    process.env["DATA_DIR"] ||
    (process.env["DB_PATH"] ? path.dirname(process.env["DB_PATH"]) : undefined);
  if (envDir) {
    return envDir;
  }
  try {
    const repoRootData = path.resolve(import.meta.dirname, "../../../../../data");
    if (fs.existsSync(path.join(repoRootData, "modelscript.db"))) {
      return repoRootData;
    }
    const applianceData = "/app/apps/api/data";
    if (fs.existsSync(applianceData)) {
      return applianceData;
    }
  } catch {
    // Fallback to relative data directory
  }
  return "data";
}

export function resolveSqliteMemoryBudget(): SqliteMemoryBudget {
  const isLowMem = os.totalmem() <= 2.5 * 1024 * 1024 * 1024;
  const envMmapSize = process.env["SQLITE_MMAP_SIZE_MB"]
    ? Number(process.env["SQLITE_MMAP_SIZE_MB"]) * 1024 * 1024
    : undefined;
  const envCacheSize = process.env["SQLITE_CACHE_SIZE_KB"] ? -Number(process.env["SQLITE_CACHE_SIZE_KB"]) : undefined;
  return {
    mmapSize: envMmapSize ?? (isLowMem ? 33554432 : 134217728),
    cacheSize: envCacheSize ?? (isLowMem ? -16000 : -32000),
  };
}

export function applyCommonSqlitePragmas(db: Database.Database, options?: { foreignKeys?: boolean }): void {
  const { mmapSize, cacheSize } = resolveSqliteMemoryBudget();
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma(`mmap_size = ${mmapSize}`);
  db.pragma(`cache_size = ${cacheSize}`);
  if (options?.foreignKeys) {
    db.pragma("foreign_keys = ON");
  }
  db.pragma("busy_timeout = 5000");
}

export function ensureOpenAlexDbFile(parentDir: string): string {
  const openalexDbPath = process.env["OPENALEX_DB_PATH"] || path.join(parentDir, "openalex.db");
  const openalexParentDir = path.dirname(openalexDbPath);
  if (!fs.existsSync(openalexParentDir)) {
    fs.mkdirSync(openalexParentDir, { recursive: true });
  }
  if (!fs.existsSync(openalexDbPath)) {
    try {
      fs.closeSync(fs.openSync(openalexDbPath, "a"));
    } catch {
      // Best-effort pre-create; SQLite creates the file on lazy open
    }
  }
  return openalexDbPath;
}

export function openPrimaryDatabase(
  dbPath: string,
  callbacks: {
    onInvalidateAuditCache: () => void;
    onInvalidateSettingsCache: () => void;
  },
): Database.Database {
  const db = new Database(dbPath);
  applyCommonSqlitePragmas(db, { foreignKeys: true });
  db.function("_msx_invalidate_audit_cache", () => {
    callbacks.onInvalidateAuditCache();
    return 0;
  });
  db.function("_msx_invalidate_settings_cache", () => {
    callbacks.onInvalidateSettingsCache();
    return 0;
  });
  return db;
}

export interface SecondaryDatabasesResult {
  auditDb: Database.Database;
  auditDbPath: string;
  analyticsDb: Database.Database;
  analyticsDbPath: string;
}

export function openSecondaryDatabases(params: {
  parentDir: string;
  onInvalidateAuditCache: () => void;
}): SecondaryDatabasesResult {
  const auditDbPath = process.env["AUDIT_DB_PATH"] || path.join(params.parentDir, "audit.db");
  const analyticsDbPath = process.env["ANALYTICS_DB_PATH"] || path.join(params.parentDir, "analytics.db");

  const auditParentDir = path.dirname(auditDbPath);
  if (!fs.existsSync(auditParentDir)) {
    fs.mkdirSync(auditParentDir, { recursive: true });
  }
  const auditDb = new Database(auditDbPath);
  applyCommonSqlitePragmas(auditDb);
  auditDb.function("_msx_invalidate_audit_cache", () => {
    params.onInvalidateAuditCache();
    return 0;
  });
  auditDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id      INTEGER,
      action        TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id   TEXT,
      ip_address    TEXT,
      details       TEXT,
      prev_hash     TEXT,
      entry_hash    TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE TEMP TRIGGER IF NOT EXISTS _msx_audit_update_trg
    AFTER UPDATE ON audit_logs
    BEGIN
      SELECT _msx_invalidate_audit_cache();
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS _msx_audit_delete_trg
    AFTER DELETE ON audit_logs
    BEGIN
      SELECT _msx_invalidate_audit_cache();
    END;
  `);

  const analyticsParentDir = path.dirname(analyticsDbPath);
  if (!fs.existsSync(analyticsParentDir)) {
    fs.mkdirSync(analyticsParentDir, { recursive: true });
  }
  const analyticsDb = new Database(analyticsDbPath);
  applyCommonSqlitePragmas(analyticsDb);
  analyticsDb.exec(`
    CREATE TABLE IF NOT EXISTS page_views_daily (
      view_date       TEXT NOT NULL,
      surface         TEXT NOT NULL DEFAULT 'web',
      path            TEXT NOT NULL,
      views_count     INTEGER NOT NULL DEFAULT 0,
      unique_visitors INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (view_date, surface, path)
    );
    CREATE INDEX IF NOT EXISTS idx_page_views_daily_date ON page_views_daily(view_date, surface);
    CREATE INDEX IF NOT EXISTS idx_page_views_daily_path ON page_views_daily(path);

    CREATE TABLE IF NOT EXISTS page_location_stats_daily (
      view_date    TEXT NOT NULL,
      surface      TEXT NOT NULL DEFAULT 'web',
      country_code TEXT NOT NULL,
      region_code  TEXT NOT NULL DEFAULT '',
      views_count  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (view_date, surface, country_code, region_code)
    );
    CREATE INDEX IF NOT EXISTS idx_page_loc_daily_date ON page_location_stats_daily(view_date, surface);

    CREATE TABLE IF NOT EXISTS package_downloads_daily (
      library_name    TEXT NOT NULL,
      library_version TEXT NOT NULL,
      download_date   TEXT NOT NULL,
      downloads_count INTEGER DEFAULT 0,
      PRIMARY KEY (library_name, library_version, download_date)
    );
    CREATE INDEX IF NOT EXISTS idx_pkg_dl_lookup ON package_downloads_daily(library_name, download_date);

    CREATE TABLE IF NOT EXISTS post_location_stats (
      post_id      TEXT NOT NULL,
      country_code TEXT NOT NULL,
      region_code  TEXT,
      view_count   INTEGER DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_location_stats ON post_location_stats(post_id, country_code, COALESCE(region_code, ''));
  `);

  return { auditDb, auditDbPath, analyticsDb, analyticsDbPath };
}

export function attachSecondaryDbCloseHook(
  primaryDb: Database.Database,
  getSecondaryDbs: () => {
    auditDb: Database.Database | null;
    analyticsDb: Database.Database | null;
    openalexDb: Database.Database | null;
  },
): void {
  const origClose = primaryDb.close.bind(primaryDb);
  primaryDb.close = () => {
    const { auditDb, analyticsDb, openalexDb } = getSecondaryDbs();
    try {
      auditDb?.close();
    } catch {
      // Best-effort secondary DB close
    }
    try {
      analyticsDb?.close();
    } catch {
      // Best-effort secondary DB close
    }
    try {
      openalexDb?.close();
    } catch {
      // Best-effort secondary DB close
    }
    return origClose();
  };
}

export function openOpenAlexDatabase(openalexDbPath: string): Database.Database {
  const db = new Database(openalexDbPath);
  applyCommonSqlitePragmas(db);

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scholarly_works (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        urn TEXT NOT NULL UNIQUE,
        openalex_id TEXT,
        doi TEXT,
        arxiv_id TEXT,
        pmid TEXT,
        isbn TEXT,
        ansatz_entity_type TEXT,
        ansatz_entity_id TEXT,
        title TEXT NOT NULL,
        subtitle TEXT,
        abstract TEXT,
        work_type TEXT NOT NULL DEFAULT 'article',
        publication_year INTEGER,
        publication_date TEXT,
        venue_name TEXT,
        venue_issn TEXT,
        publisher TEXT,
        volume TEXT,
        issue TEXT,
        pages TEXT,
        language TEXT DEFAULT 'en',
        license TEXT,
        is_oa INTEGER NOT NULL DEFAULT 0,
        oa_status TEXT,
        oa_url TEXT,
        local_pdf_url TEXT,
        local_artifact_id INTEGER,
        external_locations_json TEXT NOT NULL DEFAULT '[]',
        authors_json TEXT NOT NULL DEFAULT '[]',
        concepts_json TEXT NOT NULL DEFAULT '[]',
        cited_by_count INTEGER NOT NULL DEFAULT 0,
        references_count INTEGER NOT NULL DEFAULT 0,
        counts_by_year_json TEXT NOT NULL DEFAULT '[]',
        referenced_urns_json TEXT NOT NULL DEFAULT '[]',
        related_urns_json TEXT NOT NULL DEFAULT '[]',
        citation_key TEXT NOT NULL,
        canonical_url TEXT,
        fwci REAL,
        partition_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_scholarly_works_openalex ON scholarly_works(openalex_id);
      CREATE INDEX IF NOT EXISTS idx_scholarly_works_doi ON scholarly_works(doi);
      CREATE INDEX IF NOT EXISTS idx_scholarly_works_arxiv ON scholarly_works(arxiv_id);
      CREATE INDEX IF NOT EXISTS idx_scholarly_works_cite_key ON scholarly_works(citation_key);
      CREATE INDEX IF NOT EXISTS idx_scholarly_works_year ON scholarly_works(publication_year);
      CREATE INDEX IF NOT EXISTS idx_scholarly_works_partition ON scholarly_works(partition_url);

      CREATE VIRTUAL TABLE IF NOT EXISTS scholarly_works_fts USING fts5(
        urn UNINDEXED,
        title,
        subtitle,
        abstract,
        authors_json,
        concepts_json,
        venue_name,
        citation_key,
        doi,
        content='scholarly_works',
        content_rowid='id',
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS trg_scholarly_works_fts_ai AFTER INSERT ON scholarly_works BEGIN
        INSERT INTO scholarly_works_fts(rowid, urn, title, subtitle, abstract, authors_json, concepts_json, venue_name, citation_key, doi)
        VALUES (
          new.id,
          new.urn,
          COALESCE(new.title, ''),
          COALESCE(new.subtitle, ''),
          COALESCE(new.abstract, ''),
          COALESCE(new.authors_json, ''),
          COALESCE(new.concepts_json, ''),
          COALESCE(new.venue_name, ''),
          COALESCE(new.citation_key, ''),
          COALESCE(new.doi, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_scholarly_works_fts_ad AFTER DELETE ON scholarly_works BEGIN
        INSERT INTO scholarly_works_fts(scholarly_works_fts, rowid, urn, title, subtitle, abstract, authors_json, concepts_json, venue_name, citation_key, doi)
        VALUES (
          'delete',
          old.id,
          old.urn,
          COALESCE(old.title, ''),
          COALESCE(old.subtitle, ''),
          COALESCE(old.abstract, ''),
          COALESCE(old.authors_json, ''),
          COALESCE(old.concepts_json, ''),
          COALESCE(old.venue_name, ''),
          COALESCE(old.citation_key, ''),
          COALESCE(old.doi, '')
        );
      END;

      CREATE TRIGGER IF NOT EXISTS trg_scholarly_works_fts_au AFTER UPDATE ON scholarly_works BEGIN
        INSERT INTO scholarly_works_fts(scholarly_works_fts, rowid, urn, title, subtitle, abstract, authors_json, concepts_json, venue_name, citation_key, doi)
        VALUES (
          'delete',
          old.id,
          old.urn,
          COALESCE(old.title, ''),
          COALESCE(old.subtitle, ''),
          COALESCE(old.abstract, ''),
          COALESCE(old.authors_json, ''),
          COALESCE(old.concepts_json, ''),
          COALESCE(old.venue_name, ''),
          COALESCE(old.citation_key, ''),
          COALESCE(old.doi, '')
        );
        INSERT INTO scholarly_works_fts(rowid, urn, title, subtitle, abstract, authors_json, concepts_json, venue_name, citation_key, doi)
        VALUES (
          new.id,
          new.urn,
          COALESCE(new.title, ''),
          COALESCE(new.subtitle, ''),
          COALESCE(new.abstract, ''),
          COALESCE(new.authors_json, ''),
          COALESCE(new.concepts_json, ''),
          COALESCE(new.venue_name, ''),
          COALESCE(new.citation_key, ''),
          COALESCE(new.doi, '')
        );
      END;

      CREATE TABLE IF NOT EXISTS openalex_s3_partitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL DEFAULT 'works',
        s3_url TEXT NOT NULL UNIQUE,
        https_url TEXT NOT NULL,
        updated_date TEXT,
        part_name TEXT NOT NULL,
        content_length INTEGER NOT NULL DEFAULT 0,
        record_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unloaded',
        imported_count INTEGER NOT NULL DEFAULT 0,
        scanned_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        filter_config_json TEXT NOT NULL DEFAULT '{}',
        last_loaded_at TEXT,
        last_duration_ms INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_openalex_partitions_status ON openalex_s3_partitions(status);
      CREATE INDEX IF NOT EXISTS idx_openalex_partitions_date ON openalex_s3_partitions(updated_date);
    `);
  } catch {
    // Idempotent OpenAlex partition table initialization
  }

  return db;
}

export function dropMultiDbAttachedViews(db: Database.Database, isMultiDb: boolean): void {
  if (!isMultiDb) return;
  try {
    db.exec(`
      DROP VIEW IF EXISTS temp.audit_logs;
      DROP VIEW IF EXISTS temp.page_views_daily;
      DROP VIEW IF EXISTS temp.page_location_stats_daily;
      DROP VIEW IF EXISTS temp.package_downloads_daily;
      DROP VIEW IF EXISTS temp.post_location_stats;
    `);
  } catch {
    // Temp views may not be attached yet
  }
}

export function setupMultiDbAttached(
  db: Database.Database,
  options: {
    isMultiDb: boolean;
    auditDbPath: string | null;
    analyticsDbPath: string | null;
  },
): void {
  if (!options.isMultiDb || !options.auditDbPath || !options.analyticsDbPath) return;

  const attached = db.pragma("database_list") as { seq: number; name: string; file: string }[];
  if (!attached.some((d) => d.name === "audit")) {
    db.prepare(`ATTACH DATABASE ? AS audit`).run(options.auditDbPath);
  }
  if (!attached.some((d) => d.name === "analytics")) {
    db.prepare(`ATTACH DATABASE ? AS analytics`).run(options.analyticsDbPath);
  }

  try {
    const hasMainAudit = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
    if (hasMainAudit) {
      db.exec("INSERT OR IGNORE INTO audit.audit_logs SELECT * FROM main.audit_logs;");
    }
  } catch {
    // Legacy main.audit_logs migration is optional
  }

  try {
    const hasMainPv = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_views_daily'").get();
    if (hasMainPv) {
      db.exec("INSERT OR IGNORE INTO analytics.page_views_daily SELECT * FROM main.page_views_daily;");
      db.exec(
        "INSERT OR IGNORE INTO analytics.page_location_stats_daily SELECT * FROM main.page_location_stats_daily;",
      );
      db.exec("INSERT OR IGNORE INTO analytics.package_downloads_daily SELECT * FROM main.package_downloads_daily;");
      db.exec("INSERT OR IGNORE INTO analytics.post_location_stats SELECT * FROM main.post_location_stats;");
    }
  } catch {
    // Legacy main analytics migration is optional
  }

  db.exec(`
    CREATE TEMP VIEW IF NOT EXISTS audit_logs AS SELECT * FROM audit.audit_logs;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_audit_logs_ins INSTEAD OF INSERT ON audit_logs BEGIN
      INSERT INTO audit.audit_logs (id, actor_id, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash, created_at)
      VALUES (new.id, new.actor_id, new.action, new.resource_type, new.resource_id, new.ip_address, new.details, new.prev_hash, new.entry_hash, COALESCE(new.created_at, datetime('now')));
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_audit_logs_upd INSTEAD OF UPDATE ON audit_logs BEGIN
      UPDATE audit.audit_logs
      SET actor_id = new.actor_id, action = new.action, resource_type = new.resource_type, resource_id = new.resource_id,
          ip_address = new.ip_address, details = new.details, prev_hash = new.prev_hash, entry_hash = new.entry_hash, created_at = new.created_at
      WHERE id = old.id;
      SELECT _msx_invalidate_audit_cache();
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_audit_logs_del INSTEAD OF DELETE ON audit_logs BEGIN
      DELETE FROM audit.audit_logs WHERE id = old.id;
      SELECT _msx_invalidate_audit_cache();
    END;

    CREATE TEMP VIEW IF NOT EXISTS page_views_daily AS SELECT * FROM analytics.page_views_daily;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_page_views_ins INSTEAD OF INSERT ON page_views_daily BEGIN
      INSERT INTO analytics.page_views_daily (view_date, surface, path, views_count, unique_visitors)
      VALUES (new.view_date, new.surface, new.path, new.views_count, new.unique_visitors)
      ON CONFLICT(view_date, surface, path) DO UPDATE SET
        views_count = page_views_daily.views_count + excluded.views_count,
        unique_visitors = page_views_daily.unique_visitors + excluded.unique_visitors;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_page_views_del INSTEAD OF DELETE ON page_views_daily BEGIN
      DELETE FROM analytics.page_views_daily WHERE view_date = old.view_date AND surface = old.surface AND path = old.path;
    END;

    CREATE TEMP VIEW IF NOT EXISTS page_location_stats_daily AS SELECT * FROM analytics.page_location_stats_daily;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_page_loc_ins INSTEAD OF INSERT ON page_location_stats_daily BEGIN
      INSERT INTO analytics.page_location_stats_daily (view_date, surface, country_code, region_code, views_count)
      VALUES (new.view_date, new.surface, new.country_code, new.region_code, new.views_count)
      ON CONFLICT(view_date, surface, country_code, region_code) DO UPDATE SET
        views_count = page_location_stats_daily.views_count + excluded.views_count;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_page_loc_del INSTEAD OF DELETE ON page_location_stats_daily BEGIN
      DELETE FROM analytics.page_location_stats_daily WHERE view_date = old.view_date AND surface = old.surface AND country_code = old.country_code AND region_code = old.region_code;
    END;

    CREATE TEMP VIEW IF NOT EXISTS package_downloads_daily AS SELECT * FROM analytics.package_downloads_daily;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_pkg_dl_ins INSTEAD OF INSERT ON package_downloads_daily BEGIN
      INSERT INTO analytics.package_downloads_daily (library_name, library_version, download_date, downloads_count)
      VALUES (new.library_name, new.library_version, new.download_date, new.downloads_count)
      ON CONFLICT(library_name, library_version, download_date) DO UPDATE SET
        downloads_count = package_downloads_daily.downloads_count + excluded.downloads_count;
    END;

    CREATE TEMP VIEW IF NOT EXISTS post_location_stats AS SELECT * FROM analytics.post_location_stats;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_post_loc_ins INSTEAD OF INSERT ON post_location_stats BEGIN
      INSERT INTO analytics.post_location_stats (post_id, country_code, region_code, view_count)
      VALUES (new.post_id, new.country_code, new.region_code, new.view_count)
      ON CONFLICT(post_id, country_code, COALESCE(region_code, '')) DO UPDATE SET
        view_count = post_location_stats.view_count + excluded.view_count;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_post_loc_del INSTEAD OF DELETE ON post_location_stats BEGIN
      DELETE FROM analytics.post_location_stats WHERE post_id = old.post_id;
    END;
  `);
}
