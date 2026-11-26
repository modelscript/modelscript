// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import semver from "semver";
import { FEATURE_FLAGS } from "../../feature-flags.js";
import { generateEd25519Keys, generateRSAKeys } from "../repositories/user-lifecycle.js";

export interface SchemaReconcileOptions {
  isMultiDb: boolean;
  setupMultiDbAttached: () => void;
  setDistTag: (packageId: number, tag: string, version: string) => void;
}

function backfillActivityPubAndEd25519Keys(db: Database.Database): void {
  try {
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    const usersWithoutActorUrl = db.prepare(`SELECT id, username FROM users WHERE actor_url IS NULL`).all() as {
      id: number;
      username: string;
    }[];
    if (usersWithoutActorUrl.length > 0) {
      const updateActorStmt = db.prepare(`UPDATE users SET actor_url = ?, inbox_url = ?, outbox_url = ? WHERE id = ?`);
      db.transaction(() => {
        for (const u of usersWithoutActorUrl) {
          const actorUrl = `${publicUrl}/users/${u.username}`;
          updateActorStmt.run(actorUrl, `${actorUrl}/inbox`, `${actorUrl}/outbox`, u.id);
        }
      })();
    }

    const usersWithoutKeys = db
      .prepare(`SELECT id, username FROM users WHERE rsa_private_key IS NULL LIMIT 5`)
      .all() as { id: number; username: string }[];
    const updateStmt = db.prepare(
      `UPDATE users SET rsa_private_key = ?, rsa_public_key = ?, actor_url = COALESCE(actor_url, ?), inbox_url = COALESCE(inbox_url, ?), outbox_url = COALESCE(outbox_url, ?) WHERE id = ?`,
    );
    db.transaction(() => {
      for (const u of usersWithoutKeys) {
        const keys = generateRSAKeys();
        const actorUrl = `${publicUrl}/users/${u.username}`;
        updateStmt.run(keys.privateKey, keys.publicKey, actorUrl, `${actorUrl}/inbox`, `${actorUrl}/outbox`, u.id);
      }
    })();
  } catch {
    // Best-effort ActivityPub RSA key backfill
  }

  try {
    const usersWithoutEd = db.prepare(`SELECT id FROM users WHERE ed25519_private_key IS NULL LIMIT 10`).all() as {
      id: number;
    }[];
    const updateEdStmt = db.prepare(`UPDATE users SET ed25519_private_key = ?, ed25519_public_key = ? WHERE id = ?`);
    db.transaction(() => {
      for (const u of usersWithoutEd) {
        const keys = generateEd25519Keys();
        updateEdStmt.run(keys.privateKey, keys.publicKey, u.id);
      }
    })();
  } catch {
    // Best-effort Ed25519 key backfill
  }
}

function ensureCoreTriggersAndCounters(db: Database.Database, isMultiDb: boolean): void {
  try {
    db.exec(
      `
      CREATE TABLE IF NOT EXISTS post_mentions (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_post_mentions_user ON post_mentions(user_id);
      CREATE INDEX IF NOT EXISTS idx_post_mentions_post ON post_mentions(post_id);
      CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_reply_created ON posts(reply_to_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_repost_created ON posts(repost_of_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON posts(visibility, created_at DESC);

      CREATE TRIGGER IF NOT EXISTS trg_likes_insert AFTER INSERT ON likes BEGIN
        UPDATE posts SET like_count = like_count + 1 WHERE id = new.post_id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_likes_delete AFTER DELETE ON likes BEGIN
        UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = old.post_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_posts_reply_insert AFTER INSERT ON posts WHEN new.reply_to_id IS NOT NULL BEGIN
        UPDATE posts SET reply_count = reply_count + 1 WHERE id = new.reply_to_id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_posts_reply_delete AFTER DELETE ON posts WHEN old.reply_to_id IS NOT NULL BEGIN
        UPDATE posts SET reply_count = MAX(0, reply_count - 1) WHERE id = old.reply_to_id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_posts_repost_insert AFTER INSERT ON posts WHEN new.repost_of_id IS NOT NULL BEGIN
        UPDATE posts SET repost_count = repost_count + 1 WHERE id = new.repost_of_id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_posts_repost_delete AFTER DELETE ON posts WHEN old.repost_of_id IS NOT NULL BEGIN
        UPDATE posts SET repost_count = MAX(0, repost_count - 1) WHERE id = old.repost_of_id;
      END;
      ` +
        (!isMultiDb
          ? `
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
      `
          : "") +
        `
      CREATE TEMP TRIGGER IF NOT EXISTS _msx_settings_insert_trg
      AFTER INSERT ON instance_settings
      BEGIN
        SELECT _msx_invalidate_settings_cache();
      END;
      CREATE TEMP TRIGGER IF NOT EXISTS _msx_settings_update_trg
      AFTER UPDATE ON instance_settings
      BEGIN
        SELECT _msx_invalidate_settings_cache();
      END;
      CREATE TEMP TRIGGER IF NOT EXISTS _msx_settings_delete_trg
      AFTER DELETE ON instance_settings
      BEGIN
        SELECT _msx_invalidate_settings_cache();
      END;
    `,
    );
  } catch {
    // Idempotent trigger/index initialization
  }

  try {
    // Reconcile and backfill like_count, reply_count, repost_count if unpopulated
    db.exec(`
      UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id) WHERE like_count = 0 AND EXISTS (SELECT 1 FROM likes WHERE likes.post_id = posts.id);
      UPDATE posts SET reply_count = (SELECT COUNT(*) FROM posts p2 WHERE p2.reply_to_id = posts.id) WHERE reply_count = 0 AND EXISTS (SELECT 1 FROM posts p2 WHERE p2.reply_to_id = posts.id);
      UPDATE posts SET repost_count = (SELECT COUNT(*) FROM posts p3 WHERE p3.repost_of_id = posts.id) WHERE repost_count = 0 AND EXISTS (SELECT 1 FROM posts p3 WHERE p3.repost_of_id = posts.id);
    `);
  } catch {
    // Best-effort post counter backfill
  }
}

function reconcileLegacyColumns(db: Database.Database): void {
  try {
    const classCols = (db.prepare(`PRAGMA table_info(classes)`).all() as { name: string }[]).map((c) => c.name);
    if (!classCols.includes("icon_hash")) {
      db.exec(`ALTER TABLE classes ADD COLUMN icon_hash TEXT;`);
    }
    if (!classCols.includes("diagram_hash")) {
      db.exec(`ALTER TABLE classes ADD COLUMN diagram_hash TEXT;`);
    }
  } catch {
    // Idempotent classes column migration
  }

  try {
    const userCols = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((c) => c.name);
    if (!userCols.includes("signing_verified")) {
      db.exec(`ALTER TABLE users ADD COLUMN signing_verified INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userCols.includes("signing_policy_strict")) {
      db.exec(`ALTER TABLE users ADD COLUMN signing_policy_strict INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!userCols.includes("branch_tip_oid")) {
      db.exec(`ALTER TABLE users ADD COLUMN branch_tip_oid TEXT;`);
    }
    db.exec(`DELETE FROM _modelscript_migrations WHERE name = '0002_account_signing_keys';`);
  } catch {
    // Idempotent users signing column migration
  }

  try {
    const notifCols = (db.prepare(`PRAGMA table_info(notifications)`).all() as { name: string }[]).map((c) => c.name);
    if (!notifCols.includes("archived")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN archived INTEGER DEFAULT 0;`);
    }
    if (!notifCols.includes("starred")) {
      db.exec(`ALTER TABLE notifications ADD COLUMN starred INTEGER DEFAULT 0;`);
    }
  } catch {
    // Idempotent notifications column migration
  }

  try {
    const issueCols = (db.prepare(`PRAGMA table_info(space_issues)`).all() as { name: string }[]).map((c) => c.name);
    if (!issueCols.includes("external_source")) {
      db.exec(`ALTER TABLE space_issues ADD COLUMN external_source TEXT DEFAULT NULL;`);
    }
    if (!issueCols.includes("external_key")) {
      db.exec(`ALTER TABLE space_issues ADD COLUMN external_key TEXT DEFAULT NULL;`);
    }
    if (!issueCols.includes("external_url")) {
      db.exec(`ALTER TABLE space_issues ADD COLUMN external_url TEXT DEFAULT NULL;`);
    }
    if (!issueCols.includes("external_updated_at")) {
      db.exec(`ALTER TABLE space_issues ADD COLUMN external_updated_at TEXT DEFAULT NULL;`);
    }
    if (!issueCols.includes("sync_status")) {
      db.exec(`ALTER TABLE space_issues ADD COLUMN sync_status TEXT DEFAULT 'synced';`);
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_space_issues_external ON space_issues(space_id, external_source, external_key);`,
    );
  } catch {
    // Idempotent space_issues column migration
  }

  try {
    const txCols = (db.prepare(`PRAGMA table_info(credit_transactions)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (txCols.length > 0) {
      if (!txCols.includes("org_id")) {
        db.exec(
          `ALTER TABLE credit_transactions ADD COLUMN org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;`,
        );
        db.exec(`
          UPDATE credit_transactions
          SET org_id = CAST(json_extract(metadata, '$.orgId') AS INTEGER)
          WHERE org_id IS NULL
            AND json_valid(metadata)
            AND json_extract(metadata, '$.orgId') IS NOT NULL;
        `);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_org_id ON credit_transactions(org_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_personal ON credit_transactions(user_id, org_id, id DESC);
      `);
    }
  } catch {
    // Idempotent credit_transactions org_id column migration
  }

  try {
    const holdCols = (db.prepare(`PRAGMA table_info(credit_escrow_holds)`).all() as { name: string }[]).map(
      (c) => c.name,
    );
    if (holdCols.length > 0) {
      if (!holdCols.includes("org_id")) {
        db.exec(
          `ALTER TABLE credit_escrow_holds ADD COLUMN org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL;`,
        );
        db.exec(`
          UPDATE credit_escrow_holds
          SET org_id = CAST(json_extract(metadata, '$.orgId') AS INTEGER)
          WHERE org_id IS NULL
            AND json_valid(metadata)
            AND json_extract(metadata, '$.orgId') IS NOT NULL;
        `);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_credit_escrow_holds_org_status ON credit_escrow_holds(org_id, job_id, status);
      `);
      try {
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_escrow_holds_active_unique
          ON credit_escrow_holds(job_id, COALESCE(org_id, 0), user_id)
          WHERE status = 'held' AND job_id IS NOT NULL;
        `);
      } catch {
        // Skip unique active-hold index if legacy duplicate held rows exist
      }
    }
  } catch {
    // Idempotent credit_escrow_holds org_id column migration
  }
}

function sanitizeLegacyDescriptionsAndModifiers(db: Database.Database): void {
  // Sanitize any previously indexed class/component descriptions that leaked raw Modelica annotation(...) clauses
  // or annotation-internal modifier rows (Placement, Dialog, Icon, Documentation, etc.).
  try {
    const stripAnno = (raw: string): string | null => {
      const cleaned = raw
        .replace(/\s*\bannotation\s*\([\s\S]*$/i, "")
        .trim()
        .replace(/^"|"$/g, "")
        .trim();
      return cleaned.length > 0 ? cleaned : null;
    };
    const dirtyClasses = db
      .prepare(
        `SELECT id, description FROM classes WHERE description LIKE '%annotation(%' OR description LIKE '%annotation (%'`,
      )
      .all() as Array<{ id: number; description: string }>;
    const dirtyComps = db
      .prepare(
        `SELECT id, description FROM components WHERE description LIKE '%annotation(%' OR description LIKE '%annotation (%'`,
      )
      .all() as Array<{ id: number; description: string }>;
    if (dirtyClasses.length > 0 || dirtyComps.length > 0) {
      const updClass = db.prepare(`UPDATE classes SET description = ? WHERE id = ?`);
      const updComp = db.prepare(`UPDATE components SET description = ? WHERE id = ?`);
      db.transaction(() => {
        for (const row of dirtyClasses) {
          updClass.run(stripAnno(row.description), row.id);
        }
        for (const row of dirtyComps) {
          updComp.run(stripAnno(row.description), row.id);
        }
      })();
    }
    db.exec(`
      DELETE FROM modifiers
      WHERE modifier_name IN (
        'Placement', 'Dialog', 'Icon', 'Diagram', 'Documentation',
        'Evaluate', 'HideResult', 'choices', 'DynamicSelect',
        'Line', 'Text', 'Rectangle', 'Ellipse', 'Polygon', 'Bitmap',
        'coordinateSystem', 'graphics', 'smoothOrder', 'version'
      );
      UPDATE components SET causality = NULL WHERE type_name = 'import' AND causality = 'connector';
    `);
  } catch {
    // Best-effort legacy description sanitization
  }
}

function reconcilePackageDistTagsAndMetadata(
  db: Database.Database,
  setDistTag: (packageId: number, tag: string, version: string) => void,
): void {
  // Self-healing: Reconcile dist_tags so 'latest' always points to the highest semver version
  try {
    const allPkgs = db.prepare(`SELECT id, name FROM packages`).all() as { id: number; name: string }[];
    for (const p of allPkgs) {
      const verRows = db.prepare(`SELECT version FROM package_versions WHERE package_id = ?`).all(p.id) as {
        version: string;
      }[];
      if (verRows.length > 0) {
        const sorted = verRows
          .map((r) => r.version)
          .sort((a, b) => {
            if (semver.valid(a) && semver.valid(b)) return semver.rcompare(a, b);
            return b.localeCompare(a);
          });
        const highestVer = sorted[0]!;
        const currentLatestRow = db
          .prepare(`SELECT version FROM dist_tags WHERE package_id = ? AND tag = 'latest'`)
          .get(p.id) as { version: string } | undefined;
        if (
          !currentLatestRow ||
          (semver.valid(highestVer) &&
            semver.valid(currentLatestRow.version) &&
            semver.gt(highestVer, currentLatestRow.version))
        ) {
          setDistTag(p.id, "latest", highestVer);
        }
      }
    }
  } catch {
    // Best-effort dist_tags self-healing
  }

  // Self-healing: Reconcile package description and readme with the latest tagged version
  try {
    db.exec(`
      UPDATE packages
      SET description = (
        SELECT json_extract(pv.manifest, '$.description')
        FROM dist_tags dt
        JOIN package_versions pv ON pv.package_id = dt.package_id AND pv.version = dt.version
        WHERE dt.package_id = packages.id AND dt.tag = 'latest' AND json_extract(pv.manifest, '$.description') IS NOT NULL
      )
      WHERE EXISTS (
        SELECT 1 FROM dist_tags dt
        JOIN package_versions pv ON pv.package_id = dt.package_id AND pv.version = dt.version
        WHERE dt.package_id = packages.id AND dt.tag = 'latest' AND json_extract(pv.manifest, '$.description') IS NOT NULL
      );

      UPDATE packages
      SET readme = (
        SELECT c.documentation
        FROM dist_tags dt
        JOIN classes c ON c.library_name = packages.name AND c.library_version = dt.version AND c.class_name = packages.name
        WHERE dt.package_id = packages.id AND dt.tag = 'latest' AND c.documentation IS NOT NULL
      )
      WHERE packages.name = 'Modelica' AND EXISTS (
        SELECT 1 FROM dist_tags dt
        JOIN classes c ON c.library_name = packages.name AND c.library_version = dt.version AND c.class_name = packages.name
        WHERE dt.package_id = packages.id AND dt.tag = 'latest' AND c.documentation IS NOT NULL
      );
    `);
  } catch {
    // Best-effort package readme/description reconciliation
  }
}

function reconcileFeatureFlags(db: Database.Database): void {
  // Reconcile feature flags table with code-level definitions and reset legacy defaults
  try {
    const insertFlagStmt = db.prepare(
      `INSERT OR IGNORE INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
       VALUES (?, ?, 100, ?, datetime('now'))`,
    );
    for (const flag of Object.values(FEATURE_FLAGS)) {
      const allowedRoles = flag.allowedRoles ? flag.allowedRoles.join(",") : "";
      insertFlagStmt.run(flag.key, flag.defaultValue ? 1 : 0, allowedRoles);
    }

    // Reconcile git_repositories and repositories flags in existing databases where pre-0.1.0 seeded them as enabled
    db.prepare(
      `UPDATE feature_flags
       SET is_enabled = 0, allowed_roles = 'admin,beta_tester', updated_at = datetime('now')
       WHERE flag_key IN ('git_repositories', 'repositories')
         AND (allowed_roles = '' OR allowed_roles IS NULL)`,
    ).run();

    // Ensure references and scientific_references are initialized and disabled
    db.prepare(
      `INSERT INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
       VALUES ('references', 0, 100, 'admin,beta_tester', datetime('now'))
       ON CONFLICT(flag_key) DO NOTHING`,
    ).run();
    db.prepare(
      `INSERT INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
       VALUES ('scientific_references', 0, 100, 'admin,beta_tester', datetime('now'))
       ON CONFLICT(flag_key) DO NOTHING`,
    ).run();

    // Reconcile spaces_hub and space_chat flags in existing databases where previously seeded as enabled
    db.prepare(
      `UPDATE feature_flags
       SET is_enabled = 0, allowed_roles = 'admin,beta_tester', updated_at = datetime('now')
       WHERE flag_key IN ('spaces_hub', 'space_chat', 'spaces', 'chat')
         AND (allowed_roles = 'admin,beta_tester,user,guest' OR allowed_roles = '' OR allowed_roles IS NULL)`,
    ).run();
  } catch {
    // Best-effort feature flag reconciliation
  }
}

function ensureReferenceAndSpaceTables(db: Database.Database): void {
  // Initialize user-scoped Reference Collections & Post Citations in primary DB (modelscript.db)
  try {
    const refLibMaster = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reference_library_items'`)
      .get() as { sql?: string } | undefined;
    if (refLibMaster?.sql && refLibMaster.sql.includes("REFERENCES scholarly_works")) {
      db.pragma("foreign_keys = OFF");
      db.exec(`
        DROP TABLE IF EXISTS reference_library_items;
        DROP TABLE IF EXISTS post_citations;
        DROP TABLE IF EXISTS scholarly_works;
      `);
      db.pragma("foreign_keys = ON");
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS reference_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        description TEXT,
        color TEXT NOT NULL DEFAULT '#1d9bf0',
        icon TEXT NOT NULL DEFAULT 'folder',
        is_public INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER REFERENCES reference_collections(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, slug)
      );

      CREATE INDEX IF NOT EXISTS idx_reference_collections_user ON reference_collections(user_id);

      CREATE TABLE IF NOT EXISTS reference_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_id INTEGER NOT NULL,
        collection_id INTEGER REFERENCES reference_collections(id) ON DELETE SET NULL,
        reading_status TEXT NOT NULL DEFAULT 'to_read',
        rating INTEGER,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        custom_citation_key TEXT,
        local_pdf_url TEXT,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, work_id)
      );

      CREATE INDEX IF NOT EXISTS idx_reference_library_user ON reference_library_items(user_id);
      CREATE INDEX IF NOT EXISTS idx_reference_library_collection ON reference_library_items(collection_id);

      CREATE TABLE IF NOT EXISTS post_citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        work_id INTEGER,
        urn TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(post_id, urn)
      );

      CREATE INDEX IF NOT EXISTS idx_post_citations_urn ON post_citations(urn);
      CREATE INDEX IF NOT EXISTS idx_post_citations_work ON post_citations(work_id);

      CREATE TABLE IF NOT EXISTS federated_oauth_clients (
        domain TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS username_history (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        old_username TEXT NOT NULL,
        new_username TEXT NOT NULL,
        changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_username_history_user_id ON username_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_username_history_changed_at ON username_history(changed_at);

      CREATE TABLE IF NOT EXISTS user_account_locations (
        user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        confirmed_country_code  TEXT,
        confirmed_region_code   TEXT,
        candidate_country_code  TEXT,
        candidate_region_code   TEXT,
        candidate_streak        INTEGER NOT NULL DEFAULT 0,
        candidate_first_seen_at TEXT,
        candidate_last_seen_at  TEXT,
        total_requests          INTEGER NOT NULL DEFAULT 0,
        last_request_at         TEXT,
        updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_account_locations_country ON user_account_locations(confirmed_country_code);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks(post_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id);
      CREATE INDEX IF NOT EXISTS idx_content_reports_post ON content_reports(post_id);
      CREATE INDEX IF NOT EXISTS idx_content_reports_target_user ON content_reports(target_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users(LOWER(username));
      CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users(LOWER(email));

      CREATE TABLE IF NOT EXISTS space_issues (
        id                   TEXT PRIMARY KEY,
        space_id             TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        issue_number         INTEGER NOT NULL,
        title                TEXT NOT NULL,
        description          TEXT NOT NULL DEFAULT '',
        status               TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
        severity             TEXT NOT NULL DEFAULT 'standard' CHECK(severity IN ('minor', 'standard', 'major', 'safety_critical')),
        author_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
        impacted_models_json TEXT NOT NULL DEFAULT '[]',
        labels_json          TEXT NOT NULL DEFAULT '[]',
        linked_pr_number     INTEGER,
        closed_at            TEXT,
        external_source      TEXT DEFAULT NULL,
        external_key         TEXT DEFAULT NULL,
        external_url         TEXT DEFAULT NULL,
        external_updated_at  TEXT DEFAULT NULL,
        sync_status          TEXT DEFAULT 'synced',
        created_at           TEXT DEFAULT (datetime('now')),
        updated_at           TEXT DEFAULT (datetime('now')),
        CONSTRAINT uq_space_issue_num UNIQUE(space_id, issue_number)
      );
      CREATE INDEX IF NOT EXISTS idx_space_issues_space ON space_issues(space_id, status);
      CREATE INDEX IF NOT EXISTS idx_space_issues_external ON space_issues(space_id, external_source, external_key);

      CREATE TABLE IF NOT EXISTS space_issue_comments (
        id         TEXT PRIMARY KEY,
        issue_id   TEXT NOT NULL REFERENCES space_issues(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_space_issue_comments_issue ON space_issue_comments(issue_id);

      CREATE TABLE IF NOT EXISTS space_workflow_runs (
        id              TEXT PRIMARY KEY,
        space_id        TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        eco_id          TEXT REFERENCES space_eco_proposals(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL DEFAULT 'github',
        workflow_file   TEXT NOT NULL,
        workflow_name   TEXT NOT NULL,
        trigger_event   TEXT NOT NULL DEFAULT 'eco',
        commit_sha      TEXT,
        ref             TEXT,
        status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'passed', 'failed', 'cancelled')),
        conclusion      TEXT,
        started_at      TEXT DEFAULT (datetime('now')),
        completed_at    TEXT,
        duration_ms     INTEGER DEFAULT 0,
        jobs_json       TEXT NOT NULL DEFAULT '[]',
        artifacts_json  TEXT NOT NULL DEFAULT '[]',
        summary_json    TEXT NOT NULL DEFAULT '{}',
        logs_text       TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_space_workflow_runs_eco ON space_workflow_runs(eco_id);
      CREATE INDEX IF NOT EXISTS idx_space_workflow_runs_space ON space_workflow_runs(space_id, status);
      CREATE INDEX IF NOT EXISTS idx_space_workflow_runs_sha ON space_workflow_runs(space_id, commit_sha);
    `);
  } catch {
    // Idempotent space_workflow_runs table initialization
  }
}

function purgeLegacyToyPackages(db: Database.Database): void {
  // Purge legacy toy packages and non-Modelica packages from packages table
  try {
    db.exec(`
      DELETE FROM packages WHERE name LIKE '@modelscript/example-%'
        OR name LIKE '@examples/%';
    `);
    if (process.env["STDLIB_PACKS"] !== "all") {
      db.exec(`
        DELETE FROM packages WHERE name IN (
          'EPANET-Benchmark-Networks',
          'Standard-Robots',
          'SysML',
          'USGS-Groundwater-Aquifers',
          'SPICE-Standard',
          'AUTOSAR-Metamodels',
          'STEP-Fasteners',
          'BioModels-Curated-Core'
        );
      `);
    }
  } catch {
    // Best-effort legacy package cleanup
  }
}

export function reconcileDatabaseSchema(db: Database.Database, options: SchemaReconcileOptions): void {
  try {
    options.setupMultiDbAttached();
  } catch {
    // Multi-DB attachment may fail on ephemeral in-memory databases
  }

  backfillActivityPubAndEd25519Keys(db);
  ensureCoreTriggersAndCounters(db, options.isMultiDb);
  reconcileLegacyColumns(db);
  sanitizeLegacyDescriptionsAndModifiers(db);
  reconcilePackageDistTagsAndMetadata(db, options.setDistTag);
  reconcileFeatureFlags(db);
  // Dedicated OpenAlex Database (openalex.db) is initialized lazily via LibraryDatabase.openalexDb
  ensureReferenceAndSpaceTables(db);
  purgeLegacyToyPackages(db);
}
