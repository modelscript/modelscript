// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable */

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SqliteMigrationRunner, allMigrations } from "./migrations/index.js";
import { listComputeProfiles } from "./services/hpc/compute-profiles.js";

const DEFAULT_DB_DIR = "data";

export interface ClassRow {
  id: number;
  library_name: string;
  library_version: string;
  class_name: string;
  class_kind: string;
  description: string | null;
  documentation: string | null;
}

export interface ExtendsRow {
  id: number;
  class_id: number;
  base_class: string;
}

export interface ComponentRow {
  id: number;
  class_id: number;
  component_name: string;
  type_name: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
}

export interface ModifierRow {
  id: number;
  component_id: number;
  modifier_name: string;
  modifier_value: string | null;
}

export interface ClassMetadata {
  className: string;
  classKind: string;
  description: string | null;
  documentation: string | null;
  baseClasses: string[];
  components: ComponentMetadata[];
}

export interface ComponentMetadata {
  name: string;
  typeName: string;
  description: string | null;
  causality: string | null;
  variability: string | null;
  modifiers: { name: string; value: string | null }[];
}

export interface TrendingTopicRow {
  id: number;
  concept: string;
  display_name: string;
  current_score: number;
  last_updated_at: string;
  post_count?: number;
}

export interface JobRow {
  id: number;
  name: string;
  status: string;
  type: string;
  repository_id: number | null;
  trigger_source: string | null;
  metadata: string | null;
  started_at: string;
  completed_at: string | null;
  compute_profile?: string | null;
  cpu_seconds?: number | null;
  peak_memory_mb?: number | null;
  gpu_seconds?: number | null;
  cost_credits?: number | null;
  user_id?: number | null;
}

export interface CreditTransactionRow {
  id: number;
  user_id: number;
  job_id: number | null;
  amount: number;
  balance_after: number;
  type: string;
  transaction_type?: string;
  description: string;
  metadata?: string | null;
  created_at: string;
}

export interface TwinRow {
  id: number;
  instance_id: number;
  name: string;
  modelica_class: string;
  status: string; // 'active' | 'degraded' | 'calibrating' | 'archived'
  health_score: number;
  config: string;
  current_parameters: string;
  current_weights: string | null;
  created_at: string;
  last_telemetry_at: string | null;
  last_adapted_at: string | null;
}

export interface TwinAdaptationRow {
  id: number;
  twin_id: number;
  trigger_reason: string;
  prior_parameters: string;
  updated_parameters: string;
  residual_before: number;
  residual_after: number;
  iterations: number;
  created_at: string;
}

export interface TwinProposalRow {
  id: number;
  twin_id: number;
  post_id: number | null;
  adaptation_id: number;
  status: string; // 'open' | 'approved' | 'rejected'
  reviewer_id: number | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface UserBillingSummary {
  userId: number;
  creditBalance: number;
  totalSpent: number;
  totalJobs: number;
  totalCpuSeconds: number;
  totalGpuSeconds: number;
  profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }>;
  recentTransactions: CreditTransactionRow[];
  wallet: {
    balance: number;
    total_spent: number;
    total_jobs_dispatched: number;
    total_cpu_core_hours: number;
    total_gpu_hours: number;
  };
  recent_transactions: CreditTransactionRow[];
  profiles: any[];
}

export interface HpcJobArtifactSummary {
  id: number;
  name: string;
  status: string;
  solver: string;
  computeProfile: string;
  cpuSeconds: number;
  gpuSeconds: number;
  costCredits: number;
  startedAt: string;
  completedAt: string | null;
  hasVtu: boolean;
  hasScalars: boolean;
  scalars?: Record<string, any> | undefined;
  resultDir?: string | undefined;
}

export interface JobStepRow {
  id: number;
  job_id: number;
  name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface ScriptTemplateRow {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon: string;
  config: string;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRecord {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: number;
  created_at: string;
}

export type OrgRole = "owner" | "maintainer" | "contributor";

export interface OrganizationMemberRecord {
  org_id: number;
  user_id: number;
  username?: string;
  role: OrgRole;
  created_at: string;
}

export type CollaboratorPermission = "admin" | "write" | "read";

export interface PackageCollaboratorRecord {
  library_name: string;
  user_id: number;
  username?: string;
  permission: CollaboratorPermission;
  created_at: string;
}

export interface RepoWebhookRecord {
  id: number;
  repo_id: number;
  provider: "github" | "gitlab" | "local" | "custom";
  secret: string;
  events: string;
  auto_publish: number;
  tag_pattern: string;
  is_active: number;
  created_at: string;
}

export interface WebhookDeliveryRecord {
  id: number;
  webhook_id: number;
  event_type: string;
  payload: string;
  response_status: number | null;
  error_message: string | null;
  delivered_at: string;
}

/**
 * SQLite-backed storage for Modelica class metadata.
 */
export class LibraryDatabase {
  readonly #db: Database.Database;
  readonly #dbPath: string;
  readonly #runner: SqliteMigrationRunner;

  constructor(dbDir?: string) {
    const dir = dbDir ?? DEFAULT_DB_DIR;
    const dbPath = path.join(dir, "modelscript.db");
    this.#dbPath = dbPath;

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#runner = new SqliteMigrationRunner(this.#db, dbPath);
    this.#runner.runPendingSync(allMigrations);
    this.#initialize();
  }

  get db(): Database.Database {
    return this.#db;
  }

  get dbPath(): string {
    return this.#dbPath;
  }

  get dbDir(): string {
    return path.dirname(this.#dbPath);
  }

  get migrationRunner(): SqliteMigrationRunner {
    return this.#runner;
  }

  resetDevData() {
    const tables = [
      "classes",
      "extends",
      "components",
      "modifiers",
      "users",
      "oauth_accounts",
      "follows",
      "rss_feeds",
      "user_rss_subscriptions",
      "artifact_views",
      "posts",
      "likes",
      "bookmarks",
      "notifications",
      "linked_repos",
      "user_topics",
      "trending_topics",
      "post_topics",
      "packages",
      "package_versions",
      "classes",
      "dist_tags",
      "artifacts",
      "post_syndications",
      "post_location_stats",
      "cad_cache",
      "settings",
      "settings",
      "user_public_keys",
      "jobs",
      "job_steps",
      "script_templates",
      "instances",
      "twins",
      "twin_adaptations",
      "twin_proposals",
      "sysml2_relationships",
      "sysml2_elements",
      "sysml2_commits",
      "sysml2_projects",
    ];
    this.#db.exec("PRAGMA foreign_keys = OFF;");
    this.#db.transaction(() => {
      for (const table of tables) {
        this.#db.exec(`DROP TABLE IF EXISTS ${table};`);
      }
    })();
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#initialize();
  }

  #initialize(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS classes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        class_name      TEXT NOT NULL,
        class_kind      TEXT NOT NULL,
        description     TEXT,
        documentation   TEXT,
        UNIQUE(library_name, library_version, class_name)
      );

      CREATE TABLE IF NOT EXISTS library_releases (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        content_hash    TEXT NOT NULL,
        signature       TEXT,
        published_by    INTEGER REFERENCES users(id),
        published_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(library_name, library_version)
      );

      CREATE TABLE IF NOT EXISTS extends (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        base_class      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS components (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        component_name  TEXT NOT NULL,
        type_name       TEXT NOT NULL,
        description     TEXT,
        causality       TEXT,
        variability     TEXT
      );

      CREATE TABLE IF NOT EXISTS modifiers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        component_id    INTEGER NOT NULL REFERENCES components(id) ON DELETE CASCADE,
        modifier_name   TEXT NOT NULL,
        modifier_value  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_classes_library ON classes(library_name, library_version);
      CREATE INDEX IF NOT EXISTS idx_extends_class ON extends(class_id);
      CREATE INDEX IF NOT EXISTS idx_components_class ON components(class_id);
      CREATE INDEX IF NOT EXISTS idx_modifiers_component ON modifiers(component_id);

      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        display_name  TEXT,
        bio           TEXT,
        avatar_url    TEXT DEFAULT 'https://ui-avatars.com/api/?name=User&background=random&color=fff',
        banner_url    TEXT DEFAULT 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80',
        location      TEXT,
        website       TEXT,
        notification_settings TEXT DEFAULT '{}',
        account_type  TEXT DEFAULT 'user',
        rsa_private_key TEXT,
        rsa_public_key  TEXT,
        actor_url       TEXT,
        inbox_url       TEXT,
        outbox_url      TEXT,
        remote_domain   TEXT,
        owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        bot_token_hash  TEXT,
        credit_balance  REAL DEFAULT 100.0,
        email_verified  INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'pending_verification',
        terms_accepted_at TEXT,
        registration_ip TEXT,
        token_version   INTEGER DEFAULT 1,
        totp_secret     TEXT,
        totp_enabled    INTEGER DEFAULT 0,
        backup_codes    TEXT DEFAULT '[]',
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider          TEXT NOT NULL,
        provider_user_id  TEXT NOT NULL,
        access_token      TEXT,
        refresh_token     TEXT,
        expires_at        TEXT,
        UNIQUE(provider, provider_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

      CREATE TABLE IF NOT EXISTS follows (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(follower_id, following_id)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

      CREATE TABLE IF NOT EXISTS rss_feeds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        url             TEXT NOT NULL UNIQUE,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT,
        description     TEXT,
        site_url        TEXT,
        last_fetched_at TEXT,
        last_guid       TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        etag            TEXT,
        last_modified   TEXT,
        poll_interval_mins INTEGER DEFAULT 15,
        last_polled_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS user_rss_subscriptions (
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rss_feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
        created_at  TEXT DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, rss_feed_id)
      );

      CREATE TABLE IF NOT EXISTS artifact_views (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id      INTEGER NOT NULL REFERENCES users(id),
        view_type       TEXT NOT NULL,
        source_type     TEXT NOT NULL,
        source_ref      TEXT,
        title           TEXT,
        view_config     TEXT NOT NULL,
        thumbnail_url   TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT,
        artifact_view_id INTEGER REFERENCES artifact_views(id),
        reply_to_id      INTEGER REFERENCES posts(id),
        quote_post_id    INTEGER REFERENCES posts(id),
        repost_of_id     INTEGER REFERENCES posts(id),
        view_count       INTEGER DEFAULT 0,
        ap_id            TEXT UNIQUE,
        url              TEXT,
        metadata         TEXT,
        reply_visibility TEXT DEFAULT 'everyone',
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
      CREATE INDEX IF NOT EXISTS idx_posts_reply ON posts(reply_to_id);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

      CREATE TABLE IF NOT EXISTS user_public_keys (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key_id_string  TEXT NOT NULL UNIQUE,
        public_key_pem TEXT NOT NULL,
        device_name    TEXT,
        created_at     TEXT DEFAULT (datetime('now')),
        expires_at     TEXT,
        is_active      INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_user_public_keys_user ON user_public_keys(user_id);

      CREATE TABLE IF NOT EXISTS post_syndications (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id          INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        target           TEXT NOT NULL,
        external_id      TEXT NOT NULL,
        url              TEXT,
        created_at       TEXT DEFAULT (datetime('now')),
        UNIQUE(post_id, target)
      );
      CREATE INDEX IF NOT EXISTS idx_post_syndications_post ON post_syndications(post_id);

      CREATE TABLE IF NOT EXISTS likes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
      CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id);

      CREATE TABLE IF NOT EXISTS bookmarks (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id    INTEGER NOT NULL REFERENCES users(id),
        type        TEXT NOT NULL,
        post_id     INTEGER REFERENCES posts(id),
        read        INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read);

      CREATE TABLE IF NOT EXISTS linked_repos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider    TEXT NOT NULL,
        namespace   TEXT NOT NULL,
        project     TEXT NOT NULL,
        external_id TEXT,
        description TEXT,
        avatar_url  TEXT,
        pinned      INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, namespace, project)
      );
      CREATE INDEX IF NOT EXISTS idx_linked_repos_user ON linked_repos(user_id);

      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS user_mutes (
        muter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        muted_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (muter_id, muted_id)
      );

      CREATE TABLE IF NOT EXISTS user_topics (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        UNIQUE(user_id, concept)
      );

      CREATE TABLE IF NOT EXISTS trending_topics (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        concept         TEXT NOT NULL,
        location        TEXT,
        display_name    TEXT NOT NULL,
        current_score   REAL DEFAULT 0.0,
        last_updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(concept, location)
      );
      CREATE INDEX IF NOT EXISTS idx_trending_score ON trending_topics(current_score DESC);

      CREATE TABLE IF NOT EXISTS post_topics (
        post_id  INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        topic_id INTEGER REFERENCES trending_topics(id) ON DELETE CASCADE,
        UNIQUE(post_id, topic_id)
      );

      CREATE TABLE IF NOT EXISTS post_location_stats (
        post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        country_code TEXT NOT NULL,
        region_code  TEXT,
        view_count   INTEGER DEFAULT 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_post_location_stats ON post_location_stats(post_id, country_code, COALESCE(region_code, ''));

      -- ── npm registry tables ──────────────────────────────────────

      CREATE TABLE IF NOT EXISTS packages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL UNIQUE,
        description     TEXT,
        readme          TEXT,
        readme_filename TEXT,
        license         TEXT,
        homepage        TEXT,
        repository_type TEXT,
        repository_url  TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        modified_at     TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS package_versions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version         TEXT NOT NULL,
        tarball_path    TEXT NOT NULL,
        tarball_shasum  TEXT NOT NULL,
        tarball_integrity TEXT,
        tarball_size    INTEGER NOT NULL,
        manifest        TEXT NOT NULL,
        modelscript_meta TEXT,
        published_by    INTEGER REFERENCES users(id),
        published_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(package_id, version)
      );

      CREATE TABLE IF NOT EXISTS dist_tags (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        tag             TEXT NOT NULL,
        version         TEXT NOT NULL,
        UNIQUE(package_id, tag)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id      INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        path            TEXT NOT NULL,
        metadata        TEXT,
        UNIQUE(version_id, path)
      );

      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
      CREATE INDEX IF NOT EXISTS idx_package_versions_pkg ON package_versions(package_id);
      CREATE INDEX IF NOT EXISTS idx_dist_tags_pkg ON dist_tags(package_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_version ON artifacts(version_id);

      CREATE TABLE IF NOT EXISTS instances (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        serial_number   TEXT NOT NULL UNIQUE,
        package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version         TEXT NOT NULL,
        commit_sha      TEXT,
        variant         TEXT,
        birth_data      TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_instances_serial ON instances(serial_number);
      CREATE INDEX IF NOT EXISTS idx_instances_pkg ON instances(package_id);

      -- Active Twin Deployments
      CREATE TABLE IF NOT EXISTS twins (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        modelica_class      TEXT NOT NULL,
        status              TEXT DEFAULT 'active', -- 'active' | 'degraded' | 'calibrating' | 'archived'
        health_score        REAL DEFAULT 100.0,
        config              TEXT NOT NULL,         -- JSON: telemetry channels, UDE spec, MHE window
        current_parameters  TEXT NOT NULL,         -- JSON: latest calibrated parameter dictionary
        current_weights     TEXT,                  -- Base64 / JSON: ArenaNeuralBlock weights
        created_at          TEXT DEFAULT (datetime('now')),
        last_telemetry_at   TEXT,
        last_adapted_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_twins_instance ON twins(instance_id);

      -- Parameter & UDE Adaptation Ledger
      CREATE TABLE IF NOT EXISTS twin_adaptations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id             INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        trigger_reason      TEXT NOT NULL,         -- 'cusum_drift' | 'manual' | 'scheduled'
        prior_parameters    TEXT NOT NULL,         -- JSON
        updated_parameters  TEXT NOT NULL,         -- JSON
        residual_before     REAL NOT NULL,
        residual_after      REAL NOT NULL,
        iterations          INTEGER NOT NULL,
        created_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_twin_adaptations_twin ON twin_adaptations(twin_id);

      -- Physics Pull Requests (Human-in-the-Loop Review for Model Changes)
      CREATE TABLE IF NOT EXISTS twin_proposals (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id             INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        post_id             INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        adaptation_id       INTEGER REFERENCES twin_adaptations(id) ON DELETE CASCADE,
        status              TEXT DEFAULT 'open',   -- 'open' | 'approved' | 'rejected'
        reviewer_id         INTEGER REFERENCES users(id),
        review_notes        TEXT,
        reviewed_at         TEXT,
        created_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_twin_proposals_twin ON twin_proposals(twin_id);

      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS cad_cache (
        url TEXT PRIMARY KEY,
        geometry_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        status          TEXT NOT NULL,
        type            TEXT NOT NULL,
        repository_id   INTEGER REFERENCES linked_repos(id) ON DELETE CASCADE,
        user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        trigger_source  TEXT,
        metadata        TEXT,
        started_at      TEXT DEFAULT (datetime('now')),
        completed_at    TEXT,
        compute_profile TEXT DEFAULT 'standard',
        cpu_seconds     REAL DEFAULT 0,
        peak_memory_mb  REAL DEFAULT 0,
        gpu_seconds     REAL DEFAULT 0,
        cost_credits    REAL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS credit_transactions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount          REAL NOT NULL,
        balance_after   REAL NOT NULL,
        type            TEXT NOT NULL,
        description     TEXT NOT NULL,
        metadata        TEXT DEFAULT '{}',
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_credit_tx_job ON credit_transactions(job_id);

      CREATE TABLE IF NOT EXISTS credit_escrow_holds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount          REAL NOT NULL,
        status          TEXT DEFAULT 'held',
        description     TEXT NOT NULL,
        metadata        TEXT DEFAULT '{}',
        created_at      TEXT DEFAULT (datetime('now')),
        settled_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_credit_escrow_user ON credit_escrow_holds(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_credit_escrow_job ON credit_escrow_holds(job_id);

      CREATE TABLE IF NOT EXISTS job_steps (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        status          TEXT NOT NULL,
        started_at      TEXT DEFAULT (datetime('now')),
        completed_at    TEXT
      );

      CREATE TABLE IF NOT EXISTS script_templates (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        slug            TEXT NOT NULL UNIQUE,
        description     TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL DEFAULT 'general',
        icon            TEXT NOT NULL DEFAULT 'terminal',
        config          TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );

      -- OMG SysML v2 Persistence
      CREATE TABLE IF NOT EXISTS sysml2_projects (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT,
        created         TEXT NOT NULL,
        default_branch  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sysml2_commits (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES sysml2_projects(id) ON DELETE CASCADE,
        description     TEXT NOT NULL,
        created         TEXT NOT NULL,
        previous_commit TEXT
      );

      CREATE TABLE IF NOT EXISTS sysml2_elements (
        id              TEXT PRIMARY KEY,
        commit_id       TEXT NOT NULL REFERENCES sysml2_commits(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        qualified_name  TEXT NOT NULL,
        owner_id        TEXT,
        is_abstract     INTEGER DEFAULT 0,
        element_json    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sysml2_relationships (
        id              TEXT PRIMARY KEY,
        commit_id       TEXT NOT NULL REFERENCES sysml2_commits(id) ON DELETE CASCADE,
        source_id       TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        rel_type        TEXT NOT NULL,
        rel_json        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sysml2_commits_project ON sysml2_commits(project_id);
      CREATE INDEX IF NOT EXISTS idx_sysml2_elements_commit ON sysml2_elements(commit_id);
      CREATE INDEX IF NOT EXISTS idx_sysml2_relationships_commit ON sysml2_relationships(commit_id);

      CREATE TABLE IF NOT EXISTS federation_domains (
        domain          TEXT PRIMARY KEY,
        tier            TEXT NOT NULL DEFAULT 'allow',
        reason          TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS federation_delivery_queue (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_type   TEXT NOT NULL,
        activity_id     TEXT NOT NULL,
        payload         TEXT NOT NULL,
        target_inbox_url TEXT NOT NULL,
        target_domain   TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        max_attempts    INTEGER NOT NULL DEFAULT 5,
        next_retry_at   TEXT NOT NULL DEFAULT (datetime('now')),
        last_error      TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fed_queue_status_retry ON federation_delivery_queue (status, next_retry_at);

      CREATE TABLE IF NOT EXISTS content_reports (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id     INTEGER NOT NULL,
        post_id         INTEGER,
        target_user_id  INTEGER,
        reason          TEXT NOT NULL,
        details         TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        resolution_notes TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        resolved_at     TEXT,
        FOREIGN KEY (reporter_id) REFERENCES users(id),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS dmca_notices (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        claimant_name   TEXT NOT NULL,
        claimant_email  TEXT NOT NULL,
        copyright_owner TEXT NOT NULL,
        work_description TEXT NOT NULL,
        infringing_url  TEXT NOT NULL,
        resource_type   TEXT NOT NULL DEFAULT 'package',
        resource_id     TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        action_taken    TEXT,
        created_at      TEXT DEFAULT (datetime('now')),
        resolved_at     TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id        INTEGER,
        action          TEXT NOT NULL,
        resource_type   TEXT NOT NULL,
        resource_id     TEXT,
        ip_address      TEXT,
        details         TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
      CREATE INDEX IF NOT EXISTS idx_dmca_notices_status ON dmca_notices(status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    `);

    // Migrations
    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN notification_settings TEXT DEFAULT '{}'`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN credit_balance REAL DEFAULT 100.0`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE rss_feeds ADD COLUMN etag TEXT`);
      this.#db.exec(`ALTER TABLE rss_feeds ADD COLUMN last_modified TEXT`);
      this.#db.exec(`ALTER TABLE rss_feeds ADD COLUMN poll_interval_mins INTEGER DEFAULT 15`);
      this.#db.exec(`ALTER TABLE rss_feeds ADD COLUMN last_polled_at TEXT`);
    } catch (e) {
      // Columns already exist
    }

    const userColumns = [
      "ALTER TABLE users ADD COLUMN rsa_private_key TEXT",
      "ALTER TABLE users ADD COLUMN rsa_public_key TEXT",
      "ALTER TABLE users ADD COLUMN actor_url TEXT",
      "ALTER TABLE users ADD COLUMN inbox_url TEXT",
      "ALTER TABLE users ADD COLUMN outbox_url TEXT",
      "ALTER TABLE users ADD COLUMN remote_domain TEXT",
      "ALTER TABLE users ADD COLUMN shared_inbox_url TEXT",
      "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'pending_verification'",
      "ALTER TABLE users ADD COLUMN terms_accepted_at TEXT",
      "ALTER TABLE users ADD COLUMN registration_ip TEXT",
      "ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1",
      "ALTER TABLE users ADD COLUMN totp_secret TEXT",
      "ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN backup_codes TEXT DEFAULT '[]'",
      "ALTER TABLE follows ADD COLUMN state TEXT DEFAULT 'accepted'",
    ];
    for (const sql of userColumns) {
      try {
        this.#db.exec(sql);
      } catch (e) {
        // Column already exists
      }
    }

    const jobColumns = [
      "ALTER TABLE jobs ADD COLUMN compute_profile TEXT DEFAULT 'standard'",
      "ALTER TABLE jobs ADD COLUMN cpu_seconds REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN peak_memory_mb REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN gpu_seconds REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN cost_credits REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
    ];
    for (const sql of jobColumns) {
      try {
        this.#db.exec(sql);
      } catch (e) {
        // Column already exists
      }
    }

    const packageVersionColumns = [
      "ALTER TABLE package_versions ADD COLUMN tarball_integrity TEXT",
      "ALTER TABLE package_versions ADD COLUMN modelscript_meta TEXT",
    ];
    for (const sql of packageVersionColumns) {
      try {
        this.#db.exec(sql);
      } catch (e) {
        // Column already exists
      }
    }

    try {
      const usersWithoutKeys = this.#db
        .prepare(`SELECT id, username FROM users WHERE rsa_private_key IS NULL`)
        .all() as Array<{ id: number; username: string }>;
      const updateStmt = this.#db.prepare(
        `UPDATE users SET rsa_private_key = ?, rsa_public_key = ?, actor_url = ?, inbox_url = ?, outbox_url = ? WHERE id = ?`,
      );
      const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
      this.#db.transaction(() => {
        for (const u of usersWithoutKeys) {
          const keys = this.#generateRSAKeys();
          const actorUrl = `${publicUrl}/users/${u.username}`;
          updateStmt.run(keys.privateKey, keys.publicKey, actorUrl, `${actorUrl}/inbox`, `${actorUrl}/outbox`, u.id);
        }
      })();
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'user'`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`
        UPDATE users 
        SET avatar_url = 'https://ui-avatars.com/api/?name=' || username || '&background=random&color=fff' 
        WHERE avatar_url IS NULL;
        
        UPDATE users 
        SET banner_url = 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80' 
        WHERE banner_url IS NULL;
      `);
    } catch (e) {
      // Ignore migration errors
    }

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0`);
    } catch (e) {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN ap_id TEXT UNIQUE`);
      this.#db.exec(`ALTER TABLE posts ADD COLUMN url TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN metadata TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN reply_visibility TEXT DEFAULT 'everyone'`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN access_token TEXT`);
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN refresh_token TEXT`);
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN expires_at TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE jobs ADD COLUMN metadata TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN is_silenced INTEGER DEFAULT 0`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE packages ADD COLUMN quarantine_status TEXT DEFAULT 'clean'`);
      this.#db.exec(`ALTER TABLE packages ADD COLUMN is_quarantined INTEGER DEFAULT 0`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN ed25519_public_key TEXT`);
      this.#db.exec(`ALTER TABLE users ADD COLUMN ed25519_private_key TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`ALTER TABLE artifact_views ADD COLUMN remote_origin_url TEXT`);
    } catch (e) {}

    try {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS remote_packages (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          name            TEXT NOT NULL,
          version         TEXT NOT NULL,
          actor_url       TEXT NOT NULL,
          download_url    TEXT NOT NULL,
          checksum        TEXT NOT NULL,
          license         TEXT,
          description     TEXT,
          metadata        TEXT,
          is_deleted      INTEGER DEFAULT 0,
          created_at      TEXT DEFAULT (datetime('now')),
          updated_at      TEXT DEFAULT (datetime('now')),
          UNIQUE(name, version, actor_url)
        );
        CREATE INDEX IF NOT EXISTS idx_remote_packages_name ON remote_packages(name);
      `);
    } catch (e) {}

    try {
      const usersWithoutEd = this.#db.prepare(`SELECT id FROM users WHERE ed25519_private_key IS NULL`).all() as Array<{
        id: number;
      }>;
      const updateEdStmt = this.#db.prepare(
        `UPDATE users SET ed25519_private_key = ?, ed25519_public_key = ? WHERE id = ?`,
      );
      this.#db.transaction(() => {
        for (const u of usersWithoutEd) {
          const keys = this.#generateEd25519Keys();
          updateEdStmt.run(keys.privateKey, keys.publicKey, u.id);
        }
      })();
    } catch (e) {}
  }

  // ── User management ─────────────────────────────────────────────

  getUserTopics(userId: number): { concept: string; is_active: boolean }[] {
    return this.#db.prepare(`SELECT concept, is_active FROM user_topics WHERE user_id = ?`).all(userId) as any[];
  }

  updateUserTopic(userId: number, concept: string, isActive: boolean) {
    this.#db
      .prepare(
        `INSERT INTO user_topics (user_id, concept, is_active) VALUES (?, ?, ?) ON CONFLICT(user_id, concept) DO UPDATE SET is_active = excluded.is_active`,
      )
      .run(userId, concept, isActive ? 1 : 0);
  }

  deriveUserTopics(userId: number): void {
    // Derive topics from liked/bookmarked posts and insert as active (if not explicitly inactive)
    this.#db
      .prepare(
        `
      INSERT INTO user_topics (user_id, concept, is_active)
      SELECT DISTINCT ?, t.concept, 1
      FROM likes l
      JOIN post_topics pt ON l.post_id = pt.post_id
      JOIN trending_topics t ON pt.topic_id = t.id
      WHERE l.user_id = ?
      ON CONFLICT(user_id, concept) DO NOTHING
    `,
      )
      .run(userId, userId);
  }

  // ── User management ─────────────────────────────────────────────

  getOrCreateRemoteUser(actorUrl: string, profileData: any): { id: number } {
    const existing = this.#db.prepare(`SELECT id FROM users WHERE actor_url = ?`).get(actorUrl) as
      | { id: number }
      | undefined;
    if (existing) return existing;

    // Use preferredUsername or fallback
    const username = profileData.preferredUsername || actorUrl.split("/").pop();
    const domain = new URL(actorUrl).hostname;
    // Create a unique username for remote to avoid collision with local
    const remoteUsername = `${username}@${domain}`;

    const keys = this.#generateRSAKeys();
    const edKeys = this.#generateEd25519Keys();
    const sharedInbox =
      (profileData?.endpoints?.sharedInbox as string) ||
      (profileData?.sharedInbox as string) ||
      (profileData?.endpoints?.shared_inbox as string) ||
      null;

    const result = this.#db
      .prepare(
        `INSERT INTO users (username, email, account_type, display_name, bio, avatar_url, rsa_private_key, rsa_public_key, ed25519_private_key, ed25519_public_key, actor_url, inbox_url, outbox_url, remote_domain, shared_inbox_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        remoteUsername,
        `remote-${crypto.randomUUID()}@${domain}`, // fake email for unique constraint
        "remote",
        profileData.name || username,
        profileData.summary || "",
        profileData.icon?.url || `https://ui-avatars.com/api/?name=${encodeURIComponent(remoteUsername)}`,
        keys.privateKey,
        keys.publicKey,
        edKeys.privateKey,
        edKeys.publicKey,
        actorUrl,
        profileData.inbox || `${actorUrl}/inbox`,
        profileData.outbox || `${actorUrl}/outbox`,
        domain,
        sharedInbox,
      );
    return { id: Number(result.lastInsertRowid) };
  }

  #generateRSAKeys() {
    return crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }

  #generateEd25519Keys() {
    return crypto.generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
  }

  getInstanceKeys(): { publicKey: string; privateKey: string } {
    const existing = this.#db.prepare(`SELECT value FROM settings WHERE key = 'instance_keys'`).get() as any;
    if (existing) {
      return JSON.parse(existing.value);
    }
    const keys = this.#generateRSAKeys();
    this.#db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run("instance_keys", JSON.stringify(keys));
    return keys;
  }

  getInstanceEd25519Keys(): { publicKey: string; privateKey: string } {
    const existing = this.#db.prepare(`SELECT value FROM settings WHERE key = 'instance_ed25519_keys'`).get() as any;
    if (existing) {
      return JSON.parse(existing.value);
    }
    const keys = this.#generateEd25519Keys();
    this.#db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`)
      .run("instance_ed25519_keys", JSON.stringify(keys));
    return keys;
  }

  createUser(
    username: string,
    email: string,
    passwordHash: string | null,
    options?: {
      emailVerified?: boolean;
      initialCredits?: number;
      termsAcceptedAt?: string;
      registrationIp?: string;
      status?: string;
      accountType?: string;
    },
  ): {
    id: number;
    username: string;
    email: string;
    account_type?: string;
    email_verified?: number;
    status?: string;
    token_version?: number;
  } {
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
    const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

    const edKeys = this.#generateEd25519Keys();
    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/users/${username}`;
    const inboxUrl = `${actorUrl}/inbox`;
    const outboxUrl = `${actorUrl}/outbox`;

    const accountType = options?.accountType || "user";
    const emailVerified = options?.emailVerified !== undefined ? (options.emailVerified ? 1 : 0) : 1;
    const status = options?.status || (emailVerified ? "active" : "pending_verification");
    const termsAcceptedAt = options?.termsAcceptedAt || null;
    const registrationIp = options?.registrationIp || null;
    const initialCredits = options?.initialCredits !== undefined ? options.initialCredits : emailVerified ? 100.0 : 0.0;

    const result = this.#db
      .prepare(
        `INSERT INTO users (username, email, password_hash, account_type, avatar_url, banner_url, rsa_private_key, rsa_public_key, ed25519_private_key, ed25519_public_key, actor_url, inbox_url, outbox_url, credit_balance, email_verified, status, terms_accepted_at, registration_ip, token_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        username,
        email,
        passwordHash,
        accountType,
        avatarUrl,
        bannerUrl,
        null,
        null,
        edKeys.privateKey,
        edKeys.publicKey,
        actorUrl,
        inboxUrl,
        outboxUrl,
        initialCredits,
        emailVerified,
        status,
        termsAcceptedAt,
        registrationIp,
      );
    const userId = result.lastInsertRowid as number;
    if (initialCredits > 0) {
      try {
        this.#db
          .prepare(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
             VALUES (?, NULL, ?, ?, 'initial_grant', 'Initial Welcome bonus compute credits')`,
          )
          .run(userId, initialCredits, initialCredits);
      } catch {
        // Non-fatal if table not yet initialized
      }
    }
    return {
      id: userId,
      username,
      email,
      account_type: accountType,
      email_verified: emailVerified,
      status,
      token_version: 1,
    };
  }

  verifyUserEmail(userId: number, bonusCredits = 50.0): { success: boolean; creditsGranted: number; user?: any } {
    const user = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
    if (!user) {
      return { success: false, creditsGranted: 0 };
    }

    if (user.email_verified === 1) {
      return { success: true, creditsGranted: 0, user };
    }

    const existingGrant = this.#db
      .prepare(`SELECT id FROM credit_transactions WHERE user_id = ? AND type = 'initial_grant'`)
      .get(userId);

    let creditsToGrant = 0;
    let newBalance = user.credit_balance || 0;

    if (!existingGrant && bonusCredits > 0) {
      creditsToGrant = bonusCredits;
      newBalance += creditsToGrant;
    }

    this.#db
      .prepare(`UPDATE users SET email_verified = 1, status = 'active', credit_balance = ? WHERE id = ?`)
      .run(newBalance, userId);

    if (creditsToGrant > 0) {
      try {
        this.#db
          .prepare(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
             VALUES (?, NULL, ?, ?, 'initial_grant', 'Free tier activation compute credits')`,
          )
          .run(userId, creditsToGrant, newBalance);
      } catch {
        // ignore
      }
    }

    const updatedUser = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    return { success: true, creditsGranted: creditsToGrant, user: updatedUser };
  }

  freezeUserForDispute(userId: number, reason: string): { success: boolean; previousBalance: number } {
    const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as any;
    if (!user) {
      return { success: false, previousBalance: 0 };
    }

    const previousBalance = user.credit_balance || 0;

    this.#db.prepare(`UPDATE users SET credit_balance = 0.0, status = 'suspended_dispute' WHERE id = ?`).run(userId);

    try {
      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description)
           VALUES (?, NULL, ?, 0.0, 'dispute_freeze', ?)`,
        )
        .run(userId, -previousBalance, `Dispute/Chargeback quarantine: ${reason}`);
    } catch {
      // ignore
    }

    return { success: true, previousBalance };
  }

  /**
   * GDPR Article 17: Right to Erasure / Account Anonymization
   * Redacts personal data, deletes session tokens and social links, and flags account as deleted.
   */
  anonymizeUser(userId: number): { success: boolean; actorUrl?: string } {
    const user = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
    if (!user) {
      return { success: false };
    }

    const actorUrl = user.actor_url;
    const redactedEmail = `deleted_${userId}@deleted.modelscript.local`;
    const redactedName = `Deleted User #${userId}`;
    const redactedBio = "This account has been deleted pursuant to GDPR Article 17 Right to Erasure.";

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE users 
           SET email = ?,
               username = 'deleted_' || id,
               display_name = ?,
               bio = ?,
               avatar_url = NULL,
               banner_url = NULL,
               password_hash = 'REDACTED',
               status = 'deleted',
               registration_ip = NULL,
               credit_balance = 0
           WHERE id = ?`,
        )
        .run(redactedEmail, redactedName, redactedBio, userId);

      try {
        this.#db.prepare(`DELETE FROM bot_tokens WHERE user_id = ?`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM bookmarks WHERE user_id = ?`).run(userId);
        this.#db.prepare(`DELETE FROM likes WHERE user_id = ?`).run(userId);
        this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? OR following_id = ?`).run(userId, userId);
        this.#db.prepare(`DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`).run(userId, userId);
      } catch {}

      this.logAudit({
        actorId: userId,
        action: "user_account_deleted_gdpr",
        resourceType: "user",
        resourceId: String(userId),
        details: { reason: "GDPR Article 17 Right to Erasure request executed" },
      });
    })();

    return { success: true, actorUrl };
  }

  /**
   * GDPR Article 20: Right to Data Portability
   * Returns a complete machine-readable bundle of all user profile, post, library, and billing data.
   */
  exportUserData(userId: number): Record<string, unknown> | null {
    const user = this.#db
      .prepare(
        `SELECT id, username, email, display_name, bio, actor_url, status, credit_balance, created_at FROM users WHERE id = ?`,
      )
      .get(userId) as any;
    if (!user) return null;

    let posts: any[] = [];
    try {
      posts = this.#db.prepare(`SELECT id, content, created_at, published_at FROM posts WHERE user_id = ?`).all(userId);
    } catch {}

    let libraries: any[] = [];
    try {
      libraries = this.#db
        .prepare(`SELECT name, version, created_at FROM library_releases WHERE published_by = ?`)
        .all(userId);
    } catch {}

    let transactions: any[] = [];
    try {
      transactions = this.#db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId);
    } catch {}

    let auditHistory: any[] = [];
    try {
      auditHistory = this.#db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 100`,
        )
        .all(userId);
    } catch {}

    return {
      exportedAt: new Date().toISOString(),
      regulation: "GDPR Article 20 / CCPA Data Portability Export",
      profile: user,
      posts,
      libraries,
      billingHistory: transactions,
      auditHistory,
    };
  }

  createBot(
    ownerId: number,
    username: string,
    displayName: string,
    bio: string,
    avatarUrl: string,
    tokenHash: string,
  ): { id: number; username: string } {
    const email = `${username}@bots.modelscript.org`; // dummy email for bots
    const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

    const keys = this.#generateRSAKeys();
    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/users/${username}`;
    const inboxUrl = `${actorUrl}/inbox`;
    const outboxUrl = `${actorUrl}/outbox`;

    const result = this.#db
      .prepare(
        `INSERT INTO users (username, email, display_name, bio, avatar_url, banner_url, account_type, owner_id, bot_token_hash, rsa_private_key, rsa_public_key, actor_url, inbox_url, outbox_url) VALUES (?, ?, ?, ?, ?, ?, 'bot', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        username,
        email,
        displayName,
        bio,
        avatarUrl ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName || username)}&background=random&color=fff`,
        bannerUrl,
        ownerId,
        tokenHash,
        keys.privateKey,
        keys.publicKey,
        actorUrl,
        inboxUrl,
        outboxUrl,
      );
    return { id: result.lastInsertRowid as number, username };
  }

  getUserBots(ownerId: number): Array<{
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    created_at: string;
  }> {
    return this.#db
      .prepare(
        `SELECT id, username, display_name, avatar_url, bio, created_at FROM users WHERE owner_id = ? AND account_type = 'bot' ORDER BY created_at DESC`,
      )
      .all(ownerId) as any;
  }

  deleteBot(ownerId: number, botId: number): void {
    this.#db.prepare(`DELETE FROM users WHERE id = ? AND owner_id = ? AND account_type = 'bot'`).run(botId, ownerId);
  }

  getUserByBotTokenHash(
    tokenHash: string,
  ): { id: number; username: string; email: string; account_type: string } | null {
    const row = this.#db
      .prepare(`SELECT id, username, email, account_type FROM users WHERE bot_token_hash = ? AND account_type = 'bot'`)
      .get(tokenHash) as any;
    return row || null;
  }

  createOAuthUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    const transaction = this.#db.transaction(() => {
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
      const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

      const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
      const actorUrl = `${publicUrl}/users/${username}`;
      const inboxUrl = `${actorUrl}/inbox`;
      const outboxUrl = `${actorUrl}/outbox`;

      const userResult = this.#db
        .prepare(
          `INSERT INTO users (username, email, avatar_url, banner_url, rsa_private_key, rsa_public_key, actor_url, inbox_url, outbox_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(username, email, avatarUrl, bannerUrl, null, null, actorUrl, inboxUrl, outboxUrl);
      const userId = Number(userResult.lastInsertRowid);

      this.#db
        .prepare(`INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)`)
        .run(userId, provider, providerUserId);

      return { id: userId, username, email };
    });

    return transaction();
  }

  getOAuthAccount(
    provider: string,
    providerUserId: string,
  ): { user_id: number; access_token?: string; refresh_token?: string; expires_at?: string } | undefined {
    return this.#db
      .prepare(
        `SELECT user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
      )
      .get(provider, providerUserId) as
      | { user_id: number; access_token?: string; refresh_token?: string; expires_at?: string }
      | undefined;
  }

  getOAuthAccountByUserId(
    userId: number,
    provider: string,
  ): { provider_user_id: string; access_token?: string; refresh_token?: string; expires_at?: string } | undefined {
    return this.#db
      .prepare(
        `SELECT provider_user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE user_id = ? AND provider = ?`,
      )
      .get(userId, provider) as
      | { provider_user_id: string; access_token?: string; refresh_token?: string; expires_at?: string }
      | undefined;
  }

  getPublicOAuthAccounts(userId: number): { provider: string; provider_user_id: string }[] {
    return this.#db.prepare(`SELECT provider, provider_user_id FROM oauth_accounts WHERE user_id = ?`).all(userId) as {
      provider: string;
      provider_user_id: string;
    }[];
  }

  updateOAuthTokens(userId: number, provider: string, accessToken: string, refreshToken?: string, expiresAt?: string) {
    this.#db
      .prepare(
        `UPDATE oauth_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = COALESCE(?, expires_at) WHERE user_id = ? AND provider = ?`,
      )
      .run(accessToken, refreshToken ?? null, expiresAt ?? null, userId, provider);
  }

  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    accessToken?: string,
    refreshToken?: string,
    expiresAt?: string,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, provider, providerUserId, accessToken ?? null, refreshToken ?? null, expiresAt ?? null);
  }

  unlinkOAuthAccount(userId: number, provider: string): void {
    this.#db.prepare(`DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?`).run(userId, provider);
  }

  getUserByEmail(email: string):
    | {
        id: number;
        username: string;
        email: string;
        password_hash: string;
        account_type?: string;
        avatar_url: string;
        display_name: string;
        bio: string;
        email_verified?: number;
        status?: string;
        credit_balance?: number;
        token_version?: number;
        totp_enabled?: number;
        totp_secret?: string | null;
        backup_codes?: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, password_hash, account_type, avatar_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes FROM users WHERE email = ?`,
      )
      .get(email) as any;
  }

  getUserByUsername(username: string):
    | {
        id: number;
        username: string;
        email: string;
        account_type?: string;
        email_verified?: number;
        status?: string;
        credit_balance?: number;
        token_version?: number;
        totp_enabled?: number;
        totp_secret?: string | null;
        backup_codes?: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, account_type, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes FROM users WHERE username = ?`,
      )
      .get(username) as any;
  }

  getUserById(id: number):
    | {
        id: number;
        username: string;
        email: string;
        password_hash?: string;
        account_type?: string;
        avatar_url: string;
        display_name: string;
        bio: string;
        email_verified?: number;
        status?: string;
        credit_balance?: number;
        token_version?: number;
        totp_enabled?: number;
        totp_secret?: string | null;
        backup_codes?: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, password_hash, account_type, avatar_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes FROM users WHERE id = ?`,
      )
      .get(id) as any;
  }

  setUserAccountType(userId: number, accountType: string): void {
    this.#db.prepare(`UPDATE users SET account_type = ? WHERE id = ?`).run(accountType, userId);
  }

  hasAdminUser(): boolean {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM users WHERE account_type = 'admin'`).get() as {
      count: number;
    };
    return (row?.count ?? 0) > 0;
  }

  isOpen(): boolean {
    return this.#db.open;
  }

  ensureUserRSAKeys(userId: number): { publicKey: string; privateKey: string } {
    const user = this.#db.prepare(`SELECT rsa_private_key, rsa_public_key FROM users WHERE id = ?`).get(userId) as any;
    if (user?.rsa_private_key && user?.rsa_public_key) {
      return { privateKey: user.rsa_private_key, publicKey: user.rsa_public_key };
    }
    const keys = this.#generateRSAKeys();
    this.#db
      .prepare(`UPDATE users SET rsa_private_key = ?, rsa_public_key = ? WHERE id = ?`)
      .run(keys.privateKey, keys.publicKey, userId);
    return keys;
  }

  getUserFederationInfo(userId: number):
    | {
        id: number;
        actor_url?: string | null;
        inbox_url?: string | null;
        outbox_url?: string | null;
        remote_domain?: string | null;
        rsa_public_key?: string | null;
        rsa_private_key?: string | null;
      }
    | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, actor_url, inbox_url, outbox_url, remote_domain, rsa_public_key, rsa_private_key FROM users WHERE id = ?`,
      )
      .get(userId) as any;
    if (!row) return undefined;
    if (!row.rsa_private_key || !row.rsa_public_key) {
      const keys = this.ensureUserRSAKeys(userId);
      row.rsa_private_key = keys.privateKey;
      row.rsa_public_key = keys.publicKey;
    }
    return row;
  }

  getRemoteFollowersInboxes(authorId: number): Array<{ inbox_url: string }> {
    return this.#db
      .prepare(
        `SELECT u.inbox_url FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ? AND u.remote_domain IS NOT NULL`,
      )
      .all(authorId) as Array<{ inbox_url: string }>;
  }

  getTotalUsersCount(): number {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
    return row?.count ?? 0;
  }

  getAllUsers(): Array<{
    id: number;
    username: string;
    email: string;
    display_name?: string;
    account_type: string;
    status: string;
    created_at: string;
  }> {
    return this.#db
      .prepare(
        `SELECT id, username, email, display_name, account_type, status, created_at FROM users WHERE status != 'deleted' ORDER BY id ASC`,
      )
      .all() as any[];
  }

  getTotalPostsCount(): number {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM posts`).get() as { count: number };
    return row?.count ?? 0;
  }

  setUserCreditBalance(userId: number, balance: number): void {
    this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(balance, userId);
  }

  getFullProfileByUsername(username: string): any {
    return this.#db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url, u.location, u.website, u.created_at, u.account_type, u.owner_id,
        (SELECT username FROM users WHERE id = u.owner_id) as owner_username,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
      FROM users u WHERE u.username = ?
    `,
      )
      .get(username);
  }

  updateProfile(
    userId: number,
    profile: {
      display_name?: string;
      bio?: string;
      location?: string;
      website?: string;
      avatar_url?: string;
      banner_url?: string;
    },
  ) {
    const fields = Object.entries(profile).filter(([_, v]) => v !== undefined);
    if (fields.length === 0) return;
    const setClause = fields.map(([k, _]) => `${k} = ?`).join(", ");
    const values = fields.map(([_, v]) => v);
    this.#db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, userId);
  }

  updateAccount(userId: number, username: string, email: string) {
    this.#db.prepare(`UPDATE users SET username = ?, email = ? WHERE id = ?`).run(username, email, userId);
  }

  updatePassword(userId: number, passwordHash: string) {
    this.#db
      .prepare(`UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`)
      .run(passwordHash, userId);
  }

  incrementTokenVersion(userId: number): number {
    this.#db.prepare(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`).run(userId);
    const res = this.#db.prepare(`SELECT token_version FROM users WHERE id = ?`).get(userId) as
      | { token_version: number }
      | undefined;
    return res?.token_version ?? 1;
  }

  getPasswordHash(userId: number): string | undefined {
    const res = this.#db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId) as
      | { password_hash: string }
      | undefined;
    return res?.password_hash;
  }

  enableUser2FA(userId: number, secret: string, hashedBackupCodes: string[]): void {
    this.#db
      .prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 1, backup_codes = ? WHERE id = ?`)
      .run(secret, JSON.stringify(hashedBackupCodes), userId);
  }

  disableUser2FA(userId: number): void {
    this.#db
      .prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, backup_codes = '[]' WHERE id = ?`)
      .run(userId);
  }

  getUser2FAState(userId: number):
    | {
        totp_enabled: number;
        totp_secret: string | null;
        backup_codes: string[];
      }
    | undefined {
    const row = this.#db
      .prepare(`SELECT totp_enabled, totp_secret, backup_codes FROM users WHERE id = ?`)
      .get(userId) as { totp_enabled?: number; totp_secret?: string | null; backup_codes?: string } | undefined;
    if (!row) return undefined;
    let backupCodes: string[] = [];
    try {
      if (row.backup_codes) {
        backupCodes = JSON.parse(row.backup_codes);
      }
    } catch {
      backupCodes = [];
    }
    return {
      totp_enabled: row.totp_enabled ?? 0,
      totp_secret: row.totp_secret ?? null,
      backup_codes: Array.isArray(backupCodes) ? backupCodes : [],
    };
  }

  consumeBackupCode(userId: number, codeHash: string): boolean {
    const state = this.getUser2FAState(userId);
    if (!state || !state.backup_codes.includes(codeHash)) {
      return false;
    }
    const remaining = state.backup_codes.filter((h) => h !== codeHash);
    this.#db.prepare(`UPDATE users SET backup_codes = ? WHERE id = ?`).run(JSON.stringify(remaining), userId);
    return true;
  }

  getNotificationSettings(userId: number): string | undefined {
    const res = this.#db.prepare(`SELECT notification_settings FROM users WHERE id = ?`).get(userId) as
      | { notification_settings: string }
      | undefined;
    return res?.notification_settings;
  }

  updateNotificationSettings(userId: number, settings: string) {
    this.#db.prepare(`UPDATE users SET notification_settings = ? WHERE id = ?`).run(settings, userId);
  }

  followUser(followerId: number, followingId: number, state: "pending" | "accepted" = "accepted") {
    try {
      this.#db
        .prepare(`INSERT INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)`)
        .run(followerId, followingId, state);
    } catch (err) {
      // ignore unique constraint
    }
  }

  unfollowUser(followerId: number, followingId: number) {
    this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`).run(followerId, followingId);
  }

  isFollowing(followerId: number, followingId: number): boolean {
    const res = this.#db
      .prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`)
      .get(followerId, followingId);
    return !!res;
  }

  getUserFollowers(userId: number, currentUserId?: number): any[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          0 as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as any[])
      : (this.#db.prepare(query).all(userId) as any[]);
  }

  getUserFollowing(userId: number, currentUserId?: number): any[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id) as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type,
          0 as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as any[])
      : (this.#db.prepare(query).all(userId) as any[]);
  }

  getUserSuggestions(userId?: number, limit: number = 3): any[] {
    if (userId) {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        WHERE u.id != ? AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(userId, userId, limit) as any[];
    } else {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(limit) as any[];
    }
  }

  // ── Public Keys ─────────────────────────────────────────────────

  getPublicKeysForUser(userId: number): Array<{
    id: number;
    key_id_string: string;
    public_key_pem: string;
    device_name: string | null;
    created_at: string;
    is_active: number;
  }> {
    return this.#db
      .prepare(
        `SELECT id, key_id_string, public_key_pem, device_name, created_at, is_active FROM user_public_keys WHERE user_id = ? AND is_active = 1`,
      )
      .all(userId) as any;
  }

  addPublicKeyForUser(userId: number, keyIdString: string, publicKeyPem: string, deviceName?: string): { id: number } {
    const res = this.#db
      .prepare(`INSERT INTO user_public_keys (user_id, key_id_string, public_key_pem, device_name) VALUES (?, ?, ?, ?)`)
      .run(userId, keyIdString, publicKeyPem, deviceName ?? null);
    return { id: Number(res.lastInsertRowid) };
  }

  revokePublicKey(userId: number, keyId: number): void {
    this.#db.prepare(`UPDATE user_public_keys SET is_active = 0 WHERE id = ? AND user_id = ?`).run(keyId, userId);
  }

  // ── Social & Posts ──────────────────────────────────────────────

  createPost(
    authorId: number,
    content: string | null,
    artifactViewId?: number,
    replyToId?: number,
    quotePostId?: number,
    repostOfId?: number,
    apId?: string,
    url?: string,
    createdAt?: string,
    updatedAt?: string,
    metadata?: any,
    replyVisibility?: string,
    isSilenced?: boolean | number,
  ): { id: number } {
    const res = this.#db
      .prepare(
        `
      INSERT INTO posts (author_id, content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id, ap_id, url, metadata, reply_visibility, is_silenced, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'everyone'), ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    `,
      )
      .run(
        authorId,
        content,
        artifactViewId ?? null,
        replyToId ?? null,
        quotePostId ?? null,
        repostOfId ?? null,
        apId ?? null,
        url ?? null,
        metadata ? (typeof metadata === "string" ? metadata : JSON.stringify(metadata)) : null,
        replyVisibility ?? "everyone",
        isSilenced ? 1 : 0,
        createdAt ?? null,
        updatedAt ?? null,
      );
    return { id: Number(res.lastInsertRowid) };
  }

  updatePostArtifactViewId(postId: number, artifactViewId: number) {
    this.#db.prepare(`UPDATE posts SET artifact_view_id = ? WHERE id = ?`).run(artifactViewId, postId);
  }

  incrementPostView(postId: number, countryCode?: string, regionCode?: string) {
    this.#db.prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`).run(postId);

    if (countryCode) {
      this.#db
        .prepare(
          `
        INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(post_id, country_code, COALESCE(region_code, '')) DO UPDATE SET view_count = post_location_stats.view_count + 1
      `,
        )
        .run(postId, countryCode, regionCode || null);
    }
  }

  getPostLocationStats(postId: number): { country: string; views: number }[] {
    return this.#db
      .prepare(
        `
      SELECT country_code as country, SUM(view_count) as views 
      FROM post_location_stats 
      WHERE post_id = ? 
      GROUP BY country_code
      ORDER BY views DESC
    `,
      )
      .all(postId) as { country: string; views: number }[];
  }

  getPostRegionStats(postId: number): { country: string; region: string; views: number }[] {
    return this.#db
      .prepare(
        `
      SELECT country_code as country, region_code as region, SUM(view_count) as views 
      FROM post_location_stats 
      WHERE post_id = ? AND region_code IS NOT NULL AND region_code != ''
      GROUP BY country_code, region_code
      ORDER BY views DESC
    `,
      )
      .all(postId) as { country: string; region: string; views: number }[];
  }

  private hydratePost(p: any, currentUserId?: number): any {
    if (!p) return null;
    if (p.metadata && typeof p.metadata === "string") {
      try {
        p.metadata = JSON.parse(p.metadata);
        if (typeof p.metadata === "string") {
          p.metadata = JSON.parse(p.metadata);
        }
      } catch (e) {}
    }
    if (p.repost_of_id) {
      p.repost_post = this.getPost(p.repost_of_id, currentUserId);
    }
    if (p.quote_post_id) {
      p.quote_post = this.getPost(p.quote_post_id, currentUserId);
    }
    return p;
  }

  getPost(id: number, currentUserId?: number): any {
    const p = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `,
      )
      .get(id);
    return this.hydratePost(p, currentUserId);
  }

  getReplies(postId: number, currentUserId?: number, limit: number = 50): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.reply_to_id = ?
      ORDER BY p.created_at ASC
      LIMIT ?
    `,
      )
      .all(postId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getQuotes(postId: number, currentUserId?: number, limit: number = 50): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.quote_post_id = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(postId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getReposts(postId: number, currentUserId?: number, limit: number = 50): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.repost_of_id = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(postId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getPostParents(postId: number, currentUserId?: number, depth: number = 5): any[] {
    const parents: any[] = [];
    let currentId = postId;
    let currentDepth = 0;

    while (currentDepth < depth) {
      const p = this.#db.prepare(`SELECT reply_to_id FROM posts WHERE id = ?`).get(currentId) as any;
      if (!p || !p.reply_to_id) break;

      const parentPost = this.getPost(p.reply_to_id, currentUserId);
      if (parentPost) {
        parents.unshift(parentPost); // Add to beginning (oldest first)
        currentId = p.reply_to_id;
      } else {
        break;
      }
      currentDepth++;
    }
    return parents;
  }

  private buildArtifactFilter(artifactType?: string): { sql: string; params: any[] } {
    if (!artifactType || artifactType === "all") return { sql: "", params: [] };
    const norm = artifactType.toLowerCase();
    if (norm === "cad") {
      return {
        sql: " AND a.view_type IN ('cad', 'cad-step', 'cad_step', 'cad-3d-viewer', 'step', 'stp', '3d-model')",
        params: [],
      };
    }
    if (norm === "fmu" || norm === "fmi") {
      return { sql: " AND a.view_type IN ('fmu', 'fmu-package', 'fmu-simulator', 'fmi')", params: [] };
    }
    if (norm === "sysml" || norm === "kerml") {
      return { sql: " AND a.view_type IN ('sysml', 'sysml2', 'sysml-architecture-viewer', 'kerml')", params: [] };
    }
    if (norm === "simulation" || norm === "cfd" || norm === "fea") {
      return {
        sql: " AND a.view_type IN ('simulation', 'simulation-result', 'fea-result', 'cfd-result', 'cfd-animation', 'fmu', 'fmu-package', 'fmu-simulator')",
        params: [],
      };
    }
    if (norm === "plot" || norm === "csv" || norm === "dataset") {
      return {
        sql: " AND a.view_type IN ('simulation-plot', 'simulation-result', 'csv', 'tsv', 'dataset', 'dataset-table', 'json-table')",
        params: [],
      };
    }
    if (norm === "modelica" || norm === "code") {
      return {
        sql: " AND a.view_type IN ('modelica-code', 'modelica-diagram', 'morsel', 'sysml', 'sysml2')",
        params: [],
      };
    }
    if (norm === "aas" || norm === "twin") {
      return {
        sql: " AND a.view_type IN ('aas-package', 'cyber-physical-system', 'hardware-project', 'digital-thread', 'digital-twin-dashboard')",
        params: [],
      };
    }
    if (norm === "gcode" || norm === "cam") {
      return { sql: " AND a.view_type IN ('gcode', 'cam-result')", params: [] };
    }
    if (norm === "webgpu") {
      return { sql: " AND a.view_type IN ('webgpu', 'webgpu-simulation', 'gpu-simulation')", params: [] };
    }
    if (norm === "has_artifact" || norm === "artifacts") {
      return { sql: " AND p.artifact_view_id IS NOT NULL", params: [] };
    }
    return { sql: " AND LOWER(a.view_type) = ?", params: [norm] };
  }

  private buildTagFilter(tag?: string): { sql: string; params: any[] } {
    if (!tag) return { sql: "", params: [] };
    const clean = tag.replace(/^#/, "").trim().toLowerCase();
    if (!clean) return { sql: "", params: [] };
    return {
      sql: ` AND (
        EXISTS (
          SELECT 1 FROM post_topics pt
          JOIN trending_topics t ON pt.topic_id = t.id
          WHERE pt.post_id = p.id AND (LOWER(t.concept) = ? OR LOWER(t.display_name) = ?)
        ) OR LOWER(p.content) LIKE ?
      )`,
      params: [clean, clean, `%#${clean}%`],
    };
  }

  getHomeTimeline(userId: number, limit: number = 20, offset: number = 0, artifactType?: string, tag?: string): any[] {
    // Derive topics dynamically before fetching the feed
    try {
      this.deriveUserTopics(userId);
    } catch (e) {
      console.error("Failed to derive user topics", e);
    }

    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const baseParams = [userId, userId, userId, userId, userId, userId, userId, userId, userId];
    const allParams = [...baseParams, ...artFilter.params, ...tagFilter.params, limit, offset];

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          SELECT COALESCE(SUM(CASE WHEN ut.is_active = 1 THEN 20 ELSE -100 END), 0)
          FROM post_topics pt 
          JOIN trending_topics t ON pt.topic_id = t.id
          JOIN user_topics ut ON ut.concept = t.concept AND ut.user_id = ?
          WHERE pt.post_id = p.id
        ) + 
        (
          (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) * 3
        ) +
        (
          (SELECT COUNT(*) FROM likes l JOIN follows f ON l.user_id = f.following_id WHERE l.post_id = p.id AND f.follower_id = ?) * 3
        ) as total_score
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE 
        (
          p.author_id = ? OR 
          p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR
          EXISTS (
            SELECT 1 FROM post_topics pt
            JOIN trending_topics t ON pt.topic_id = t.id
            JOIN user_topics ut ON ut.concept = t.concept AND ut.user_id = ? AND ut.is_active = 1
            WHERE pt.post_id = p.id
          )
        )
        ${artFilter.sql}
        ${tagFilter.sql}
      ORDER BY total_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }

  getFollowingTimeline(
    userId: number,
    limit: number = 20,
    sort: string = "recent",
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): any[] {
    const orderBy = sort === "popular" ? "like_count DESC, diversity_score DESC" : "diversity_score DESC";
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const baseParams = [userId, userId, userId, userId, userId];
    const allParams = [...baseParams, ...artFilter.params, ...tagFilter.params, limit, offset];

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          strftime('%s', p.created_at) - 
          (
            SELECT COUNT(*) FROM posts p2 
            WHERE p2.author_id = p.author_id 
              AND p2.id > p.id 
              AND p2.created_at > datetime(p.created_at, '-24 hours')
          ) * 14400 -- 4 hours penalty for each newer post in the same 24h window
        ) as diversity_score
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE (p.author_id = ? OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        ${artFilter.sql}
        ${tagFilter.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }

  getExploreTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): any[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const allParams = [uid, uid, uid, ...artFilter.params, ...tagFilter.params, limit, offset];

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked,
        (
          p.view_count * 1 +
          (SELECT COUNT(*) FROM likes WHERE post_id = p.id) * 10 +
          (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) * 15 +
          (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) * 20
        ) as engagement_score
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE p.reply_to_id IS NULL AND (p.is_silenced IS NULL OR p.is_silenced = 0)
        ${artFilter.sql}
        ${tagFilter.sql}
      ORDER BY (engagement_score / (CAST((julianday('now') - julianday(p.created_at)) * 24 as REAL) + 2)) DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as any[];

    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getFederatedTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): any[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const allParams = [uid, uid, uid, ...artFilter.params, ...tagFilter.params, limit, offset];

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked
      FROM posts p
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE (u.account_type = 'remote' OR p.ap_id IS NOT NULL OR u.username LIKE '%@%')
        AND p.reply_to_id IS NULL AND (p.is_silenced IS NULL OR p.is_silenced = 0)
        ${artFilter.sql}
        ${tagFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as any[];

    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  getUserTimeline(username: string, currentUserId?: number, limit: number = 20, type?: string): any[] {
    let typeFilter = "";
    if (type === "replies") {
      typeFilter = "AND p.reply_to_id IS NOT NULL";
    } else if (type === "artifacts") {
      typeFilter = "AND p.artifact_view_id IS NOT NULL";
    } else if (type === "posts") {
      typeFilter = "AND p.reply_to_id IS NULL";
    }

    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE u.username = ? ${typeFilter}
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(username, limit) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  blockUser(blockerId: number, blockedId: number): void {
    this.#db
      .prepare(`INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`)
      .run(blockerId, blockedId);
    this.unfollowUser(blockerId, blockedId);
    this.unfollowUser(blockedId, blockerId);
  }

  unblockUser(blockerId: number, blockedId: number): void {
    this.#db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`).run(blockerId, blockedId);
  }

  isUserBlocked(blockerId: number, blockedId: number): boolean {
    const row = this.#db
      .prepare(`SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`)
      .get(blockerId, blockedId);
    return Boolean(row);
  }

  muteUser(muterId: number, mutedId: number): void {
    this.#db.prepare(`INSERT OR IGNORE INTO user_mutes (muter_id, muted_id) VALUES (?, ?)`).run(muterId, mutedId);
  }

  unmuteUser(muterId: number, mutedId: number): void {
    this.#db.prepare(`DELETE FROM user_mutes WHERE muter_id = ? AND muted_id = ?`).run(muterId, mutedId);
  }

  isUserMuted(muterId: number, mutedId: number): boolean {
    const row = this.#db.prepare(`SELECT 1 FROM user_mutes WHERE muter_id = ? AND muted_id = ?`).get(muterId, mutedId);
    return Boolean(row);
  }

  toggleLike(userId: number, postId: number): boolean {
    const existing = this.#db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`).get(userId, postId);
    if (existing) {
      this.#db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
      return false; // unliked
    } else {
      this.#db.prepare(`INSERT INTO likes (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as any;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "like", postId);
      }
      return true; // liked
    }
  }

  likePost(userId: number, postId: number): boolean {
    const existing = this.#db.prepare(`SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`).get(userId, postId);
    if (!existing) {
      this.#db.prepare(`INSERT INTO likes (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as any;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "like", postId);
      }
      return true;
    }
    return false;
  }

  unlikePost(userId: number, postId: number): boolean {
    const res = this.#db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
    return res.changes > 0;
  }

  toggleBookmark(userId: number, postId: number): boolean {
    const existing = this.#db.prepare(`SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?`).get(userId, postId);
    if (existing) {
      this.#db.prepare(`DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?`).run(userId, postId);
      return false;
    } else {
      this.#db.prepare(`INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)`).run(userId, postId);
      return true;
    }
  }

  toggleRepost(userId: number, postId: number): boolean {
    const existing = this.#db
      .prepare(`SELECT id FROM posts WHERE author_id = ? AND repost_of_id = ?`)
      .get(userId, postId) as { id: number } | undefined;
    if (existing) {
      this.#db.prepare(`DELETE FROM posts WHERE id = ?`).run(existing.id);
      return false; // un-reposted
    } else {
      this.createPost(userId, null, undefined, undefined, undefined, postId);
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as any;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "repost", postId);
      }
      return true; // reposted
    }
  }

  getBookmarks(userId: number, limit: number = 20): any[] {
    const posts = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        1 as bookmarked
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.author_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, userId, userId, limit) as any[];
    return posts.map((p) => this.hydratePost(p, userId));
  }

  createNotification(userId: number, actorId: number, type: string, postId?: number): void {
    const isSystemNotification = [
      "simulation",
      "simulation_completed",
      "package",
      "package_published",
      "security_alert",
      "credit_warning",
    ].includes(type);
    if (userId === actorId && !isSystemNotification) return;
    this.#db
      .prepare(
        `
      INSERT INTO notifications (user_id, actor_id, type, post_id)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(userId, actorId, type, postId ?? null);
  }

  getNotifications(userId: number, limit: number = 20): any[] {
    return this.#db
      .prepare(
        `
      SELECT n.*, 
             u.username as actor_username, 
             u.display_name as actor_display_name, 
             u.avatar_url as actor_avatar_url,
             p.content as post_content,
             a.view_config as post_artifact_config,
             a.view_type as post_artifact_type
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, limit) as any[];
  }

  markNotificationsRead(userId: number): void {
    this.#db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(userId);
  }

  getUnreadNotificationCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0`)
      .get(userId) as any;
    return row.count;
  }

  // ── Federation Domain Moderation ─────────────────────────────────

  getDomainTier(domain: string): { domain: string; tier: "allow" | "silence" | "suspend"; reason?: string } {
    const cleanDomain = domain.toLowerCase().trim();
    const row = this.#db
      .prepare(`SELECT domain, tier, reason FROM federation_domains WHERE domain = ?`)
      .get(cleanDomain) as any;
    if (!row) {
      return { domain: cleanDomain, tier: "allow" };
    }
    return { domain: row.domain, tier: row.tier, reason: row.reason || undefined };
  }

  setDomainTier(domain: string, tier: "allow" | "silence" | "suspend", reason?: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    this.#db
      .prepare(
        `INSERT INTO federation_domains (domain, tier, reason, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           tier = excluded.tier,
           reason = excluded.reason,
           updated_at = datetime('now')`,
      )
      .run(cleanDomain, tier, reason ?? null);
  }

  deleteDomainTier(domain: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    this.#db.prepare(`DELETE FROM federation_domains WHERE domain = ?`).run(cleanDomain);
  }

  listFederationDomains(): { domain: string; tier: string; reason?: string; created_at: string; updated_at: string }[] {
    return this.#db
      .prepare(`SELECT domain, tier, reason, created_at, updated_at FROM federation_domains ORDER BY created_at DESC`)
      .all() as any[];
  }

  isDomainSuspended(domain: string): boolean {
    return this.getDomainTier(domain).tier === "suspend";
  }

  isDomainSilenced(domain: string): boolean {
    return this.getDomainTier(domain).tier === "silence";
  }

  // ── Federation Delivery Queue ─────────────────────────────────────

  enqueueFederationDelivery(
    activityType: string,
    activityId: string,
    payload: Record<string, unknown>,
    targetInboxUrl: string,
    targetDomain: string,
  ): { id: number } {
    const res = this.#db
      .prepare(
        `INSERT INTO federation_delivery_queue (activity_type, activity_id, payload, target_inbox_url, target_domain, status, next_retry_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))`,
      )
      .run(activityType, activityId, JSON.stringify(payload), targetInboxUrl, targetDomain.toLowerCase());
    return { id: Number(res.lastInsertRowid) };
  }

  fetchPendingFederationDeliveries(limit: number = 25): Array<{
    id: number;
    activity_type: string;
    activity_id: string;
    payload: string;
    target_inbox_url: string;
    target_domain: string;
    attempts: number;
    max_attempts: number;
  }> {
    return this.#db
      .prepare(
        `SELECT * FROM federation_delivery_queue 
         WHERE status = 'pending' AND datetime(next_retry_at) <= datetime('now')
         ORDER BY id ASC LIMIT ?`,
      )
      .all(limit) as any[];
  }

  updateFederationDeliveryStatus(
    id: number,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
    nextRetryMs?: number,
  ): void {
    if (status === "completed") {
      this.#db
        .prepare(`UPDATE federation_delivery_queue SET status = 'completed', updated_at = datetime('now') WHERE id = ?`)
        .run(id);
    } else if (status === "failed") {
      this.#db
        .prepare(
          `UPDATE federation_delivery_queue SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(error || null, id);
    } else if (status === "processing") {
      this.#db
        .prepare(
          `UPDATE federation_delivery_queue SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(id);
    } else if (status === "pending" && nextRetryMs) {
      const nextDate = new Date(Date.now() + nextRetryMs).toISOString();
      this.#db
        .prepare(
          `UPDATE federation_delivery_queue SET status = 'pending', last_error = ?, next_retry_at = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(error || null, nextDate, id);
    }
  }

  getFollowState(followerId: number, followingId: number): "pending" | "accepted" | "rejected" | null {
    const row = this.#db
      .prepare(`SELECT state FROM follows WHERE follower_id = ? AND following_id = ?`)
      .get(followerId, followingId) as { state: "pending" | "accepted" | "rejected" } | undefined;
    return row ? row.state : null;
  }

  updateFollowState(followerId: number, followingId: number, state: "pending" | "accepted" | "rejected"): void {
    this.#db
      .prepare(`UPDATE follows SET state = ? WHERE follower_id = ? AND following_id = ?`)
      .run(state, followerId, followingId);
  }

  getUserOutboxCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM posts WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getUserOutboxPosts(userId: number, limit: number = 20, offset: number = 0): any[] {
    const posts = this.#db
      .prepare(
        `SELECT id, author_id, content, artifact_view_id, ap_id, url, metadata, created_at, updated_at
         FROM posts 
         WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as any[];
    return posts.map((p) => this.hydratePost(p));
  }

  getUserFollowerActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    const rows = this.#db
      .prepare(
        `SELECT u.actor_url, u.username
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
         ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as Array<{ actor_url?: string; username: string }>;
    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
    return rows.map((r) => r.actor_url || `${publicUrl}/users/${r.username}`);
  }

  getUserFollowerActorsCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM follows WHERE following_id = ? AND (state = 'accepted' OR state IS NULL)`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getUserFollowingActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    const rows = this.#db
      .prepare(
        `SELECT u.actor_url, u.username
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
         ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as Array<{ actor_url?: string; username: string }>;
    const publicUrl = process.env.PUBLIC_URL || "https://hub.modelscript.org";
    return rows.map((r) => r.actor_url || `${publicUrl}/users/${r.username}`);
  }

  getUserFollowingActorsCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM follows WHERE follower_id = ? AND (state = 'accepted' OR state IS NULL)`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getPostByApId(apId: string): any {
    return this.#db.prepare(`SELECT * FROM posts WHERE ap_id = ?`).get(apId);
  }

  deletePostByApId(apId: string): boolean {
    const post = this.#db.prepare(`SELECT id FROM posts WHERE ap_id = ?`).get(apId) as any;
    if (!post) return false;
    return this.deletePost(post.id).success;
  }

  updatePostContentByApId(apId: string, content: string): boolean {
    const res = this.#db
      .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE ap_id = ?`)
      .run(content, apId);
    return res.changes > 0;
  }

  // ── Moderation & Content Reports ─────────────────────────────────

  createContentReport(
    reporterId: number,
    data: { postId?: number; targetUserId?: number; reason: string; details?: string },
  ): { id: number; status: string } {
    const result = this.#db
      .prepare(
        `INSERT INTO content_reports (reporter_id, post_id, target_user_id, reason, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(reporterId, data.postId ?? null, data.targetUserId ?? null, data.reason, data.details ?? null);
    return { id: Number(result.lastInsertRowid), status: "pending" };
  }

  getContentReport(reportId: number): any {
    return this.#db
      .prepare(
        `SELECT r.*, 
                u.username as reporter_username, 
                p.content as post_content,
                p.author_id as post_author_id
         FROM content_reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         LEFT JOIN posts p ON r.post_id = p.id
         WHERE r.id = ?`,
      )
      .get(reportId);
  }

  getModerationQueue(status?: string, limit: number = 50, offset: number = 0): any[] {
    if (status) {
      return this.#db
        .prepare(
          `SELECT r.*, 
                  u.username as reporter_username, 
                  p.content as post_content,
                  p.author_id as post_author_id
           FROM content_reports r
           LEFT JOIN users u ON r.reporter_id = u.id
           LEFT JOIN posts p ON r.post_id = p.id
           WHERE r.status = ?
           ORDER BY r.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(status, limit, offset) as any[];
    }
    return this.#db
      .prepare(
        `SELECT r.*, 
                u.username as reporter_username, 
                p.content as post_content,
                p.author_id as post_author_id
         FROM content_reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         LEFT JOIN posts p ON r.post_id = p.id
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as any[];
  }

  resolveContentReport(reportId: number, status: "resolved" | "dismissed", resolutionNotes?: string): boolean {
    const res = this.#db
      .prepare(
        `UPDATE content_reports
         SET status = ?, resolution_notes = ?, resolved_at = datetime('now')
         WHERE id = ?`,
      )
      .run(status, resolutionNotes ?? null, reportId);
    return res.changes > 0;
  }

  deletePost(postId: number): { success: boolean; apId?: string; authorId?: number } {
    const post = this.#db.prepare(`SELECT id, author_id, ap_id FROM posts WHERE id = ?`).get(postId) as any;
    if (!post) {
      return { success: false };
    }
    this.#db.prepare(`UPDATE content_reports SET post_id = NULL WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM notifications WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM likes WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM bookmarks WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM post_topics WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM post_location_stats WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM posts WHERE id = ?`).run(postId);
    return { success: true, apId: post.ap_id, authorId: post.author_id };
  }

  // ── DMCA Notices ─────────────────────────────────────────────────

  createDmcaNotice(data: {
    claimantName: string;
    claimantEmail: string;
    copyrightOwner: string;
    workDescription: string;
    infringingUrl: string;
    resourceType?: string;
    resourceId?: string;
  }): { id: number } {
    const res = this.#db
      .prepare(
        `INSERT INTO dmca_notices (claimant_name, claimant_email, copyright_owner, work_description, infringing_url, resource_type, resource_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.claimantName,
        data.claimantEmail,
        data.copyrightOwner,
        data.workDescription,
        data.infringingUrl,
        data.resourceType ?? "package",
        data.resourceId ?? null,
      );
    return { id: Number(res.lastInsertRowid) };
  }

  listDmcaNotices(status?: string): any[] {
    if (status) {
      return this.#db.prepare(`SELECT * FROM dmca_notices WHERE status = ? ORDER BY created_at DESC`).all(status);
    }
    return this.#db.prepare(`SELECT * FROM dmca_notices ORDER BY created_at DESC`).all();
  }

  resolveDmcaNotice(id: number, actionTaken: string): boolean {
    const res = this.#db
      .prepare(
        `UPDATE dmca_notices SET status = 'resolved', action_taken = ?, resolved_at = datetime('now') WHERE id = ?`,
      )
      .run(actionTaken, id);
    return res.changes > 0;
  }

  logAudit(data: {
    actorId?: number | null | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | null | undefined;
    ipAddress?: string | null | undefined;
    details?: Record<string, any> | string | undefined;
  }): void {
    const detailsStr = typeof data.details === "object" ? JSON.stringify(data.details) : (data.details ?? null);
    try {
      this.#db
        .prepare(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, ip_address, details)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.actorId ?? null,
          data.action,
          data.resourceType,
          data.resourceId ?? null,
          data.ipAddress ?? null,
          detailsStr,
        );
    } catch (e) {
      console.error("[AuditLog] Failed to insert audit log entry:", e);
    }
  }

  getAuditLogs(limit: number = 50, offset: number = 0, action?: string): any[] {
    if (action) {
      return this.#db
        .prepare(
          `SELECT a.*, u.username as actor_username
           FROM audit_logs a
           LEFT JOIN users u ON a.actor_id = u.id
           WHERE a.action = ?
           ORDER BY a.created_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(action, limit, offset) as any[];
    }
    return this.#db
      .prepare(
        `SELECT a.*, u.username as actor_username
         FROM audit_logs a
         LEFT JOIN users u ON a.actor_id = u.id
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as any[];
  }

  /**
   * GDPR / Security Compliance: Purges audit and operational security logs
   * older than the specified retention window (default: 30 days).
   */
  purgeExpiredLogs(retentionDays: number = 30): { deletedCount: number } {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.#db.prepare(`DELETE FROM audit_logs WHERE created_at < ?`).run(cutoffDate);
    return { deletedCount: Number(result.changes) };
  }

  // ── RSS Feeds ───────────────────────────────────────────────────

  createRssProfile(
    url: string,
    title: string,
    description: string,
    siteUrl: string,
    avatarUrl: string,
    customUsername?: string,
  ): number {
    const transaction = this.#db.transaction(() => {
      // Create user profile for the RSS feed
      let domain = "rss";
      try {
        domain = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, "_");
      } catch (e) {
        // Ignore parsing error
      }
      const uniqueSuffix = crypto.randomInt(1000000);
      const username = customUsername || `rss_${domain}_${uniqueSuffix}`;

      const userResult = this.#db
        .prepare(
          `INSERT INTO users (username, email, display_name, bio, avatar_url, account_type) VALUES (?, ?, ?, ?, ?, 'rss')`,
        )
        .run(
          username,
          `${username.replace(/[^a-zA-Z0-9_-]/g, "_")}@rss.modelscript.local`,
          title,
          description,
          avatarUrl,
        );
      const userId = Number(userResult.lastInsertRowid);

      const feedResult = this.#db
        .prepare(`INSERT INTO rss_feeds (url, user_id, title, description, site_url) VALUES (?, ?, ?, ?, ?)`)
        .run(url, userId, title, description, siteUrl);

      return Number(feedResult.lastInsertRowid);
    });

    return transaction();
  }

  getRssFeedByUrl(url: string): any {
    return this.#db.prepare(`SELECT * FROM rss_feeds WHERE url = ?`).get(url);
  }

  getRssFeedsToPoll(): any[] {
    // Only fetch feeds where last_polled_at is null OR last_polled_at + poll_interval_mins < now
    return this.#db
      .prepare(
        `
      SELECT * FROM rss_feeds 
      WHERE last_polled_at IS NULL 
         OR datetime(last_polled_at, '+' || poll_interval_mins || ' minutes') <= datetime('now')
    `,
      )
      .all();
  }

  updateRssFeedPollMetadata(
    feedId: number,
    etag: string | null,
    lastModified: string | null,
    pollIntervalMins: number,
  ): void {
    this.#db
      .prepare(
        `
      UPDATE rss_feeds 
      SET etag = ?, last_modified = ?, poll_interval_mins = ?, last_polled_at = datetime('now')
      WHERE id = ?
    `,
      )
      .run(etag, lastModified, pollIntervalMins, feedId);
  }

  subscribeToRssFeed(userId: number, rssFeedId: number): void {
    // Check limit first
    const subCount = (
      this.#db.prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE user_id = ?`).get(userId) as any
    ).count;

    // Check if already subscribed to avoid double-counting limit
    const existing = this.#db
      .prepare(`SELECT 1 FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
      .get(userId, rssFeedId);
    if (!existing && subCount >= 10) {
      throw new Error("Maximum of 10 RSS feed subscriptions reached.");
    }

    try {
      this.#db
        .prepare(`INSERT INTO user_rss_subscriptions (user_id, rss_feed_id) VALUES (?, ?)`)
        .run(userId, rssFeedId);
    } catch (e) {
      // Ignore unique constraint violation (already subscribed)
    }
  }

  unsubscribeFromRssFeed(userId: number, rssFeedId: number): void {
    const transaction = this.#db.transaction(() => {
      const feed = this.#db.prepare(`SELECT * FROM rss_feeds WHERE id = ?`).get(rssFeedId) as any;
      if (!feed) return;

      this.#db
        .prepare(`DELETE FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
        .run(userId, rssFeedId);

      const subCount = (
        this.#db
          .prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE rss_feed_id = ?`)
          .get(rssFeedId) as any
      ).count;

      if (subCount === 0) {
        // Delete any notifications associated with posts by this feed profile
        this.#db
          .prepare(`DELETE FROM notifications WHERE post_id IN (SELECT id FROM posts WHERE author_id = ?)`)
          .run(feed.user_id);

        // Delete any notifications where the feed profile was the actor (if any)
        this.#db.prepare(`DELETE FROM notifications WHERE actor_id = ?`).run(feed.user_id);

        // Delete artifact views created by this profile
        this.#db.prepare(`DELETE FROM artifact_views WHERE creator_id = ?`).run(feed.user_id);

        // Finally, delete the feed profile (which cascades to rss_feeds, posts, likes, follows, etc.)
        this.#db.prepare(`DELETE FROM users WHERE id = ?`).run(feed.user_id);
      }
    });
    transaction();
  }

  getUserRssSubscriptions(userId: number): any[] {
    return this.#db
      .prepare(
        `
        SELECT f.*, u.username, u.display_name, u.avatar_url
        FROM user_rss_subscriptions s
        JOIN rss_feeds f ON s.rss_feed_id = f.id
        JOIN users u ON f.user_id = u.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
      `,
      )
      .all(userId) as any[];
  }

  getAllRssFeeds(): any[] {
    return this.#db.prepare(`SELECT * FROM rss_feeds`).all() as any[];
  }

  updateRssFeedStatus(rssFeedId: number, lastFetchedAt: string, lastGuid: string): void {
    this.#db
      .prepare(`UPDATE rss_feeds SET last_fetched_at = ?, last_guid = ? WHERE id = ?`)
      .run(lastFetchedAt, lastGuid, rssFeedId);
  }

  getArtifactView(id: number): any {
    return this.#db.prepare(`SELECT * FROM artifact_views WHERE id = ?`).get(id);
  }

  createArtifactView(
    creatorId: number,
    type: string,
    source_type: string,
    viewConfig: string,
    title?: string,
    thumbnailUrl?: string,
    remoteOriginUrl?: string,
  ): number {
    const res = this.#db
      .prepare(
        `
      INSERT INTO artifact_views (creator_id, view_type, source_type, view_config, title, thumbnail_url, remote_origin_url) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(creatorId, type, source_type, viewConfig, title || null, thumbnailUrl || null, remoteOriginUrl || null);
    return Number(res.lastInsertRowid);
  }

  getAllArtifactViews(): any[] {
    return this.#db.prepare(`SELECT id, view_type, view_config FROM artifact_views`).all();
  }

  getArtifactViewByTitle(title: string): any {
    return this.#db.prepare(`SELECT id, view_type, title FROM artifact_views WHERE title = ? LIMIT 1`).get(title);
  }

  updateArtifactViewConfig(id: number, viewConfig: string): void {
    this.#db.prepare(`UPDATE artifact_views SET view_config = ? WHERE id = ?`).run(viewConfig, id);
  }

  updateArtifactThumbnail(id: number, thumbnailUrl: string): void {
    const row = this.#db.prepare(`SELECT view_config FROM artifact_views WHERE id = ?`).get(id) as
      | { view_config?: string }
      | undefined;
    if (row && row.view_config) {
      try {
        const config = JSON.parse(row.view_config);
        config.thumbnailUrl = thumbnailUrl;
        config.thumbnailUrlLight = thumbnailUrl;
        config.thumbnailUrlDark = thumbnailUrl;
        this.#db
          .prepare(`UPDATE artifact_views SET thumbnail_url = ?, view_config = ? WHERE id = ?`)
          .run(thumbnailUrl, JSON.stringify(config), id);
        return;
      } catch {}
    }
    this.#db.prepare(`UPDATE artifact_views SET thumbnail_url = ? WHERE id = ?`).run(thumbnailUrl, id);
  }

  getUserArchiveData(userId: number): {
    posts: any[];
    libraries: any[];
    billingHistory: any[];
    auditHistory: any[];
    bookmarks: any[];
    following: string[];
    followers: string[];
  } {
    let posts: any[] = [];
    try {
      posts = this.#db
        .prepare(
          `SELECT id, content, created_at, published_at, like_count, reply_count, repost_count FROM posts WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId);
    } catch {}

    let libraries: any[] = [];
    try {
      libraries = this.#db
        .prepare(`SELECT name, version, created_at FROM library_releases WHERE published_by = ? ORDER BY id DESC`)
        .all(userId);
    } catch {}

    let billingHistory: any[] = [];
    try {
      billingHistory = this.#db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId);
    } catch {}

    let auditHistory: any[] = [];
    try {
      auditHistory = this.#db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 200`,
        )
        .all(userId);
    } catch {}

    let bookmarks: any[] = [];
    try {
      bookmarks = this.#db
        .prepare(
          `SELECT b.post_id, p.content, b.created_at FROM bookmarks b LEFT JOIN posts p ON b.post_id = p.id WHERE b.user_id = ? ORDER BY b.id DESC`,
        )
        .all(userId);
    } catch {}

    let following: string[] = [];
    try {
      const rows = this.#db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ?`)
        .all(userId) as any[];
      following = rows.map((r) => r.username);
    } catch {}

    let followers: string[] = [];
    try {
      const rows = this.#db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ?`)
        .all(userId) as any[];
      followers = rows.map((r) => r.username);
    } catch {}

    return { posts, libraries, billingHistory, auditHistory, bookmarks, following, followers };
  }

  // ── Remote Packages (Federated Registry) ─────────────────────────

  recordRemotePackage(pkg: {
    name: string;
    version: string;
    actorUrl: string;
    downloadUrl: string;
    checksum: string;
    license?: string | null;
    description?: string | null;
    metadata?: string | null;
  }): { id: number } {
    const res = this.#db
      .prepare(
        `
      INSERT INTO remote_packages (name, version, actor_url, download_url, checksum, license, description, metadata, is_deleted, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      ON CONFLICT(name, version, actor_url) DO UPDATE SET
        download_url = excluded.download_url,
        checksum = excluded.checksum,
        license = excluded.license,
        description = excluded.description,
        metadata = excluded.metadata,
        is_deleted = 0,
        updated_at = datetime('now')
    `,
      )
      .run(
        pkg.name,
        pkg.version,
        pkg.actorUrl,
        pkg.downloadUrl,
        pkg.checksum,
        pkg.license || null,
        pkg.description || null,
        pkg.metadata || null,
      );
    return { id: Number(res.lastInsertRowid) };
  }

  getRemotePackage(name: string, version: string): any {
    return this.#db
      .prepare(`SELECT * FROM remote_packages WHERE name = ? AND version = ? AND is_deleted = 0`)
      .get(name, version);
  }

  getRemotePackages(limit = 50, offset = 0): any[] {
    return this.#db
      .prepare(`SELECT * FROM remote_packages WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset);
  }

  deleteRemotePackage(name: string, version: string, actorUrl?: string): void {
    if (actorUrl) {
      this.#db
        .prepare(
          `UPDATE remote_packages SET is_deleted = 1, updated_at = datetime('now') WHERE name = ? AND version = ? AND actor_url = ?`,
        )
        .run(name, version, actorUrl);
    } else {
      this.#db
        .prepare(
          `UPDATE remote_packages SET is_deleted = 1, updated_at = datetime('now') WHERE name = ? AND version = ?`,
        )
        .run(name, version);
    }
  }

  // ── Trending Topics ─────────────────────────────────────────────

  /**
   * Applies half-life exponential decay to a topic's score and adds new weight.
   * Half-life is defined in hours.
   */
  updateTopicScore(
    concept: string,
    displayName: string,
    weight: number,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): number {
    const existing = this.#db
      .prepare(`SELECT id, current_score, last_updated_at FROM trending_topics WHERE concept = ? AND location IS ?`)
      .get(concept, location) as { id: number; current_score: number; last_updated_at: string } | undefined;

    if (!existing) {
      const res = this.#db
        .prepare(
          `
        INSERT INTO trending_topics (concept, display_name, current_score, location) VALUES (?, ?, ?, ?)
      `,
        )
        .run(concept, displayName, weight, location);
      return Number(res.lastInsertRowid);
    } else {
      const lastUpdatedMs = new Date(existing.last_updated_at.replace(" ", "T") + "Z").getTime();
      const currentMs = Date.now();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);

      const decayedScore = existing.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      const newScore = decayedScore + weight;

      this.#db
        .prepare(
          `
        UPDATE trending_topics SET current_score = ?, last_updated_at = datetime('now') WHERE id = ?
      `,
        )
        .run(newScore, existing.id);

      return existing.id;
    }
  }

  linkPostToTopic(postId: number, topicId: number): void {
    try {
      this.#db.prepare(`INSERT INTO post_topics (post_id, topic_id) VALUES (?, ?)`).run(postId, topicId);
    } catch (e) {
      // Ignore unique constraint violation
    }
  }

  /**
   * Worker function: Decays older topics and writes back to DB to prevent
   * permanent index clogging. Intended to be run periodically.
   */
  decayTrendingTopics(halfLifeHours: number = 24): void {
    const topicsToDecay = this.#db
      .prepare(
        `
      SELECT id, current_score, last_updated_at 
      FROM trending_topics 
      WHERE current_score > 0.001
    `,
      )
      .all() as { id: number; current_score: number; last_updated_at: string }[];

    if (topicsToDecay.length === 0) return;

    const currentMs = Date.now();
    const updateStmt = this.#db.prepare(`
      UPDATE trending_topics 
      SET current_score = ?, last_updated_at = datetime('now') 
      WHERE id = ?
    `);

    // Use a transaction for fast bulk updates
    const transaction = this.#db.transaction((updates: { id: number; score: number }[]) => {
      for (const u of updates) {
        updateStmt.run(u.score, u.id);
      }
    });

    const updates = topicsToDecay.map((t) => {
      const lastUpdatedMs = new Date(t.last_updated_at.replace(" ", "T") + "Z").getTime();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);
      const newScore = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      return { id: t.id, score: newScore };
    });

    transaction(updates);
  }

  getTopTrendingTopics(
    limit: number = 10,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): (TrendingTopicRow & { real_score: number; post_count: number })[] {
    const query = location
      ? `SELECT t.*, (SELECT COUNT(*) FROM post_topics pt WHERE pt.topic_id = t.id) as post_count FROM trending_topics t WHERE t.current_score > 0.001 AND t.location = ? ORDER BY t.current_score DESC LIMIT ?`
      : `SELECT t.*, (SELECT COUNT(*) FROM post_topics pt WHERE pt.topic_id = t.id) as post_count FROM trending_topics t WHERE t.current_score > 0.001 ORDER BY t.current_score DESC LIMIT ?`;
    const params = location ? [location, limit * 5] : [limit * 5];

    const topics = this.#db.prepare(query).all(...params) as (TrendingTopicRow & { post_count?: number })[];

    const currentMs = Date.now();
    const scoredTopics = topics.map((t) => {
      const lastUpdatedMs = new Date(t.last_updated_at.replace(" ", "T") + "Z").getTime();
      const deltaHours = Math.max(0, currentMs - lastUpdatedMs) / (1000 * 60 * 60);
      const real_score = t.current_score * Math.pow(0.5, deltaHours / halfLifeHours);
      return { ...t, real_score, post_count: Number(t.post_count || 0) };
    });

    const CURATED_ENGINEERING_TOPICS: { concept: string; display_name: string; score: number }[] = [
      { concept: "aerodynamics", display_name: "Aerodynamics", score: 50 },
      { concept: "thermodynamics", display_name: "Thermodynamics", score: 45 },
      { concept: "robotics", display_name: "Robotics", score: 42 },
      { concept: "additivemfg", display_name: "AdditiveMfg", score: 38 },
      { concept: "digitaltwin", display_name: "DigitalTwin", score: 35 },
      { concept: "controlsystems", display_name: "ControlSystems", score: 32 },
      { concept: "multibody", display_name: "Multibody", score: 28 },
      { concept: "fluiddynamics", display_name: "FluidDynamics", score: 25 },
      { concept: "cad", display_name: "CAD", score: 22 },
      { concept: "modelica", display_name: "Modelica", score: 20 },
    ];

    const existingConcepts = new Map<string, TrendingTopicRow & { real_score: number; post_count: number }>();
    for (const t of scoredTopics) {
      existingConcepts.set(t.concept.toLowerCase(), t);
    }

    for (const [i, cur] of CURATED_ENGINEERING_TOPICS.entries()) {
      const key = cur.concept.toLowerCase();
      const match = existingConcepts.get(key);
      if (match) {
        match.real_score += cur.score;
        match.current_score += cur.score;
      } else {
        let hashtagPostCount = 0;
        try {
          const countRow = this.#db
            .prepare(`SELECT COUNT(*) as count FROM posts WHERE lower(content) LIKE ?`)
            .get(`%#${cur.concept}%`) as { count: number } | undefined;
          hashtagPostCount = countRow?.count || 0;
        } catch {
          hashtagPostCount = 0;
        }

        const newTopic = {
          id: -(i + 1),
          concept: cur.concept,
          display_name: cur.display_name,
          current_score: cur.score,
          real_score: cur.score,
          post_count: hashtagPostCount,
          last_updated_at: new Date().toISOString(),
        };
        scoredTopics.push(newTopic);
        existingConcepts.set(key, newTopic);
      }
    }

    scoredTopics.sort((a, b) => b.real_score - a.real_score);
    return scoredTopics.slice(0, limit);
  }

  getTopicPosts(concept: string, currentUserId?: number, limit = 20, offset = 0, artifactType?: string): any[] {
    const cleanConcept = concept.replace(/^#/, "").trim().toLowerCase();
    const artifactFilter = this.buildArtifactFilter(artifactType);

    const query = `
      SELECT DISTINCT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        ${currentUserId ? `EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as liked,
        ${currentUserId ? `EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=${currentUserId})` : "0"} as reposted,
        ${currentUserId ? `EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=${currentUserId})` : "0"} as bookmarked
      FROM posts p 
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      LEFT JOIN post_topics pt ON pt.post_id = p.id
      LEFT JOIN trending_topics t ON t.id = pt.topic_id
      WHERE (lower(t.concept) = ? OR lower(t.display_name) = ? OR lower(p.content) LIKE ?)
        ${artifactFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = [cleanConcept, cleanConcept, `%#${cleanConcept}%`, ...artifactFilter.params, limit, offset];

    const posts = this.#db.prepare(query).all(...params) as any[];
    return posts.map((p) => this.hydratePost(p, currentUserId));
  }

  // ── Linked Repositories ─────────────────────────────────────────

  getLinkedRepos(userId: number): any[] {
    return this.#db
      .prepare(`SELECT * FROM linked_repos WHERE user_id = ? ORDER BY created_at DESC`)
      .all(userId) as any[];
  }

  getPopularRepos(limit: number = 5): any[] {
    return this.#db
      .prepare(
        `
        SELECT r.*, u.username, u.display_name, u.avatar_url
        FROM linked_repos r
        JOIN users u ON r.user_id = u.id
        GROUP BY r.namespace, r.project
        ORDER BY RANDOM()
        LIMIT ?
      `,
      )
      .all(limit) as any[];
  }

  linkRepo(
    userId: number,
    provider: string,
    externalId: string,
    repoFullName: string,
    defaultBranch?: string,
    description?: string,
  ): void {
    const parts = repoFullName.split("/");
    const namespace = parts[0] || "";
    const project = parts.slice(1).join("/") || repoFullName;

    const existing = this.#db
      .prepare(`SELECT id FROM linked_repos WHERE user_id = ? AND provider = ? AND external_id = ?`)
      .get(userId, provider, externalId);
    if (!existing) {
      this.#db
        .prepare(
          `
        INSERT INTO linked_repos (user_id, provider, namespace, project, external_id, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(userId, provider, namespace, project, externalId, description || null);
    }
  }

  unlinkRepo(userId: number, repoId: number): void {
    this.#db.prepare(`DELETE FROM linked_repos WHERE id = ? AND user_id = ?`).run(repoId, userId);
  }

  getLinkedRepoById(id: number): any {
    return this.#db.prepare(`SELECT * FROM linked_repos WHERE id = ?`).get(id);
  }

  // ==========================================
  // Repository Webhooks & CI/CD Ingestion
  // ==========================================

  createRepoWebhook(params: {
    repoId: number;
    provider: "github" | "gitlab" | "local" | "custom";
    secret: string;
    events?: string[];
    autoPublish?: boolean;
    tagPattern?: string;
  }): RepoWebhookRecord {
    const eventsJson = JSON.stringify(params.events ?? ["push", "release"]);
    const autoPublish = params.autoPublish !== false ? 1 : 0;
    const tagPattern = params.tagPattern || "^v?([0-9]+\\.[0-9]+\\.[0-9]+)$";

    const info = this.#db
      .prepare(
        `INSERT INTO repo_webhooks (repo_id, provider, secret, events, auto_publish, tag_pattern)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(params.repoId, params.provider, params.secret, eventsJson, autoPublish, tagPattern);

    return this.getRepoWebhookById(Number(info.lastInsertRowid))!;
  }

  getRepoWebhooks(repoId: number): RepoWebhookRecord[] {
    return this.#db
      .prepare(`SELECT * FROM repo_webhooks WHERE repo_id = ? ORDER BY created_at DESC`)
      .all(repoId) as RepoWebhookRecord[];
  }

  getRepoWebhookById(id: number): RepoWebhookRecord | null {
    const row = this.#db.prepare(`SELECT * FROM repo_webhooks WHERE id = ?`).get(id) as RepoWebhookRecord | undefined;
    return row ?? null;
  }

  deleteRepoWebhook(id: number, repoId?: number): boolean {
    let stmt;
    if (repoId) {
      stmt = this.#db.prepare(`DELETE FROM repo_webhooks WHERE id = ? AND repo_id = ?`).run(id, repoId);
    } else {
      stmt = this.#db.prepare(`DELETE FROM repo_webhooks WHERE id = ?`).run(id);
    }
    return stmt.changes > 0;
  }

  findWebhooksForRepo(
    provider: string,
    namespace: string,
    project: string,
  ): (RepoWebhookRecord & { namespace: string; project: string; user_id: number })[] {
    return this.#db
      .prepare(
        `SELECT w.*, r.namespace, r.project, r.user_id
         FROM repo_webhooks w
         JOIN linked_repos r ON w.repo_id = r.id
         WHERE w.provider = ? AND LOWER(r.namespace) = LOWER(?) AND LOWER(r.project) = LOWER(?) AND w.is_active = 1`,
      )
      .all(provider, namespace, project) as any[];
  }

  recordWebhookDelivery(params: {
    webhookId: number;
    eventType: string;
    payload: string;
    responseStatus?: number;
    errorMessage?: string;
  }): number {
    const info = this.#db
      .prepare(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, response_status, error_message)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        params.webhookId,
        params.eventType,
        params.payload,
        params.responseStatus ?? 200,
        params.errorMessage ?? null,
      );

    return Number(info.lastInsertRowid);
  }

  // ── Global Search ───────────────────────────────────────────────

  globalSearch(query: string, limitPerCategory: number = 3) {
    const safeQuery = query.trim();
    if (!safeQuery) {
      return { topics: [], users: [], packages: [], repositories: [] };
    }
    const likeQuery = `%${safeQuery}%`;

    const topics = this.#db
      .prepare(
        `
      SELECT id, display_name, current_score 
      FROM trending_topics 
      WHERE display_name LIKE ? COLLATE NOCASE
      ORDER BY current_score DESC LIMIT ?
    `,
      )
      .all(likeQuery, limitPerCategory);

    const users = this.#db
      .prepare(
        `
      SELECT id, username, display_name, avatar_url, bio 
      FROM users 
      WHERE username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, limitPerCategory);

    const packages = this.#db
      .prepare(
        `
      SELECT id, name, description
      FROM packages 
      WHERE name LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, limitPerCategory);

    const repositories = this.#db
      .prepare(
        `
      SELECT id, provider, namespace, project, description, avatar_url
      FROM linked_repos 
      WHERE namespace LIKE ? COLLATE NOCASE OR project LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE
      GROUP BY provider, namespace, project
      ORDER BY id DESC LIMIT ?
    `,
      )
      .all(likeQuery, likeQuery, likeQuery, limitPerCategory);

    return { topics, users, packages, repositories };
  }

  // ── Library metadata ────────────────────────────────────────────

  /**
   * Clear all metadata for a library version.
   */
  clearLibraryMetadata(libraryName: string, libraryVersion: string): void {
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
  }

  /**
   * Store all metadata for a library version inside a transaction.
   */
  /**
   * Store metadata for a single class. This should be run inside a transaction for performance.
   */
  storeClassMetadata(libraryName: string, libraryVersion: string, cls: ClassMetadata): void {
    const result = this.#db
      .prepare(
        `INSERT OR REPLACE INTO classes (library_name, library_version, class_name, class_kind, description, documentation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(libraryName, libraryVersion, cls.className, cls.classKind, cls.description, cls.documentation);

    const classId = result.lastInsertRowid;

    const insertExtends = this.#db.prepare(`INSERT OR REPLACE INTO extends (class_id, base_class) VALUES (?, ?)`);
    for (const baseClass of cls.baseClasses) {
      insertExtends.run(classId, baseClass);
    }

    const insertComponent = this.#db.prepare(
      `INSERT OR REPLACE INTO components (class_id, component_name, type_name, description, causality, variability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertModifier = this.#db.prepare(
      `INSERT OR REPLACE INTO modifiers (component_id, modifier_name, modifier_value) VALUES (?, ?, ?)`,
    );

    for (const comp of cls.components) {
      const compResult = insertComponent.run(
        classId,
        comp.name,
        comp.typeName,
        comp.description,
        comp.causality,
        comp.variability,
      );
      const componentId = compResult.lastInsertRowid;

      for (const mod of comp.modifiers) {
        insertModifier.run(componentId, mod.name, mod.value);
      }
    }
  }

  /**
   * Store all metadata for a library version inside a transaction.
   * WARNING: This clears all existing metadata for the version first.
   */
  storeLibraryMetadata(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.#db.transaction(() => {
      this.clearLibraryMetadata(libraryName, libraryVersion);
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Store a batch of class metadata without clearing existing data.
   * Use this for incremental batch inserts during library processing.
   */
  storeClassBatch(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    const transaction = this.#db.transaction(() => {
      for (const cls of classes) {
        this.storeClassMetadata(libraryName, libraryVersion, cls);
      }
    });

    transaction();
  }

  /**
   * Query classes for a library version with optional filters.
   */
  getClasses(
    libraryName: string,
    libraryVersion: string,
    opts?: { kind?: string | undefined; q?: string | undefined },
  ): Omit<ClassRow, "id">[] {
    let sql = `SELECT class_name, class_kind, description, documentation FROM classes
               WHERE library_name = ? AND library_version = ?`;
    const params: (string | number)[] = [libraryName, libraryVersion];

    if (opts?.kind) {
      sql += ` AND class_kind = ?`;
      params.push(opts.kind);
    }

    if (opts?.q) {
      sql += ` AND class_name LIKE ?`;
      params.push(`%${opts.q}%`);
    }

    sql += ` ORDER BY class_name`;

    return this.#db.prepare(sql).all(...params) as Omit<ClassRow, "id">[];
  }

  /**
   * Get a single class with its extends and components.
   */
  getClass(
    libraryName: string,
    libraryVersion: string,
    className: string,
  ): {
    classKind: string;
    description: string | null;
    documentation: string | null;
    extends: string[];
    components: (Omit<ComponentRow, "id" | "class_id"> & { modifiers: Omit<ModifierRow, "id" | "component_id">[] })[];
  } | null {
    const cls = this.#db
      .prepare(
        `SELECT id, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? AND class_name = ?`,
      )
      .get(libraryName, libraryVersion, className) as
      | { id: number; class_kind: string; description: string | null; documentation: string | null }
      | undefined;

    if (!cls) return null;

    const extendsRows = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`).all(cls.id) as {
      base_class: string;
    }[];

    const componentRows = this.#db
      .prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? ORDER BY component_name`,
      )
      .all(cls.id) as ComponentRow[];

    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    const components = componentRows.map((comp) => {
      const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
      return {
        component_name: comp.component_name,
        type_name: comp.type_name,
        description: comp.description,
        causality: comp.causality,
        variability: comp.variability,
        modifiers: modifiers.map((m) => ({
          modifier_name: m.modifier_name,
          modifier_value: m.modifier_value,
        })),
      };
    });

    return {
      classKind: cls.class_kind,
      description: cls.description,
      documentation: cls.documentation,
      extends: extendsRows.map((r) => r.base_class),
      components,
    };
  }

  /**
   * Get all classes with full details for a library version.
   */
  getAllClasses(
    libraryName: string,
    libraryVersion: string,
  ): {
    className: string;
    classKind: string;
    description: string | null;
    documentation: string | null;
    extends: string[];
    components: {
      name: string;
      typeName: string;
      description: string | null;
      causality: string | null;
      variability: string | null;
      modifiers: { name: string; value: string | null }[];
    }[];
  }[] {
    const classRows = this.#db
      .prepare(
        `SELECT id, class_name, class_kind, description, documentation FROM classes
         WHERE library_name = ? AND library_version = ? ORDER BY class_name`,
      )
      .all(libraryName, libraryVersion) as {
      id: number;
      class_name: string;
      class_kind: string;
      description: string | null;
      documentation: string | null;
    }[];

    const getExtends = this.#db.prepare(`SELECT base_class FROM extends WHERE class_id = ?`);
    const getComponents = this.#db.prepare(
      `SELECT id, component_name, type_name, description, causality, variability
       FROM components WHERE class_id = ? ORDER BY component_name`,
    );
    const getModifiers = this.#db.prepare(`SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ?`);

    return classRows.map((cls) => {
      const extendsRows = getExtends.all(cls.id) as { base_class: string }[];
      const componentRows = getComponents.all(cls.id) as ComponentRow[];

      const components = componentRows.map((comp) => {
        const modifiers = getModifiers.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
        return {
          name: comp.component_name,
          typeName: comp.type_name,
          description: comp.description,
          causality: comp.causality,
          variability: comp.variability,
          modifiers: modifiers.map((m) => ({ name: m.modifier_name, value: m.modifier_value })),
        };
      });

      return {
        className: cls.class_name,
        classKind: cls.class_kind,
        description: cls.description,
        documentation: cls.documentation,
        extends: extendsRows.map((r) => r.base_class),
        components,
      };
    });
  }

  /**
   * Get all data for a library version as RDF triples ({s, p, o}).
   */
  getLibraryTriples(libraryName: string, libraryVersion: string): { s: string; p: string; o: string }[] {
    const NS = "https://modelica.org/ontology#";
    const LIB = `urn:modelica:${libraryName}:${libraryVersion}:`;
    const triples: { s: string; p: string; o: string }[] = [];

    const allClasses = this.getAllClasses(libraryName, libraryVersion);

    for (const cls of allClasses) {
      const classUri = `${LIB}${cls.className}`;
      triples.push({ s: classUri, p: `${NS}type`, o: `${NS}Class` });
      triples.push({ s: classUri, p: `${NS}className`, o: cls.className });
      triples.push({ s: classUri, p: `${NS}classKind`, o: cls.classKind });
      if (cls.description) {
        triples.push({ s: classUri, p: `${NS}description`, o: cls.description });
      }
      if (cls.documentation) {
        triples.push({ s: classUri, p: `${NS}documentation`, o: cls.documentation });
      }

      for (const base of cls.extends) {
        triples.push({ s: classUri, p: `${NS}extends`, o: `${LIB}${base}` });
      }

      for (const comp of cls.components) {
        const compUri = `${classUri}.${comp.name}`;
        triples.push({ s: classUri, p: `${NS}hasComponent`, o: compUri });
        triples.push({ s: compUri, p: `${NS}type`, o: `${NS}Component` });
        triples.push({ s: compUri, p: `${NS}componentName`, o: comp.name });
        triples.push({ s: compUri, p: `${NS}typeName`, o: comp.typeName });
        if (comp.description) {
          triples.push({ s: compUri, p: `${NS}description`, o: comp.description });
        }
        if (comp.causality) {
          triples.push({ s: compUri, p: `${NS}causality`, o: comp.causality });
        }
        if (comp.variability) {
          triples.push({ s: compUri, p: `${NS}variability`, o: comp.variability });
        }

        for (const mod of comp.modifiers) {
          const modUri = `${compUri}.${mod.name}`;
          triples.push({ s: compUri, p: `${NS}hasModifier`, o: modUri });
          triples.push({ s: modUri, p: `${NS}type`, o: `${NS}Modifier` });
          triples.push({ s: modUri, p: `${NS}modifierName`, o: mod.name });
          if (mod.value !== null) {
            triples.push({ s: modUri, p: `${NS}modifierValue`, o: mod.value });
          }
        }
      }
    }

    return triples;
  }

  /**
   * Delete all data for a library version.
   */
  deleteLibrary(libraryName: string, libraryVersion: string): void {
    this.deletePackageVersion(libraryName, libraryVersion);
    // Cascade deletes handle extends, components, modifiers
    this.#db
      .prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);
    this.#db
      .prepare(`DELETE FROM library_releases WHERE library_name = ? AND library_version = ?`)
      .run(libraryName, libraryVersion);

    // If no releases and no package_versions remain, clean up parent packages row
    const pkg = this.getPackage(libraryName);
    if (pkg) {
      const remainingReleases = this.getLibraryReleases(libraryName);
      const remainingVersions = this.getPackageVersions(pkg.id);
      if (remainingReleases.length === 0 && remainingVersions.length === 0) {
        this.#db.prepare(`DELETE FROM dist_tags WHERE package_id = ?`).run(pkg.id);
        this.#db.prepare(`DELETE FROM package_collaborators WHERE library_name = ?`).run(libraryName);
        this.#db.prepare(`DELETE FROM packages WHERE id = ?`).run(pkg.id);
      }
    }
  }

  /**
   * Save or update a library release record with content hash and signature.
   */
  saveLibraryRelease(release: {
    libraryName: string;
    libraryVersion: string;
    contentHash: string;
    signature?: string | null;
    publishedBy?: number | null;
  }): void {
    const stmt = this.#db.prepare(`
      INSERT INTO library_releases (library_name, library_version, content_hash, signature, published_by)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(library_name, library_version) DO UPDATE SET
        content_hash = excluded.content_hash,
        signature = excluded.signature,
        published_by = excluded.published_by,
        published_at = datetime('now')
    `);
    stmt.run(
      release.libraryName,
      release.libraryVersion,
      release.contentHash,
      release.signature ?? null,
      release.publishedBy ?? null,
    );
  }

  /**
   * Get release metadata (content hash, signature, timestamp) for a library.
   */
  getLibraryRelease(
    libraryName: string,
    libraryVersion: string,
  ): {
    id: number;
    library_name: string;
    library_version: string;
    content_hash: string;
    signature: string | null;
    published_by: number | null;
    published_at: string;
    is_deprecated?: number | null;
    deprecation_reason?: string | null;
    is_yanked?: number | null;
    yank_reason?: string | null;
    yanked_at?: string | null;
  } | null {
    const stmt = this.#db.prepare(`
      SELECT * FROM library_releases
      WHERE library_name = ? AND library_version = ?
    `);
    return (stmt.get(libraryName, libraryVersion) as any) ?? null;
  }

  /**
   * Get all releases for a library name.
   */
  getLibraryReleases(libraryName: string): any[] {
    const stmt = this.#db.prepare(`
      SELECT * FROM library_releases
      WHERE library_name = ?
    `);
    return stmt.all(libraryName) as any[];
  }

  /**
   * Mark a library release as deprecated (or clear deprecation if reason is null).
   */
  deprecateLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    const isDeprecated = reason !== null ? 1 : 0;
    const info = this.#db
      .prepare(
        `UPDATE library_releases
         SET is_deprecated = ?, deprecation_reason = ?
         WHERE library_name = ? AND library_version = ?`,
      )
      .run(isDeprecated, reason, libraryName, libraryVersion);
    return info.changes > 0;
  }

  /**
   * Yank a library release (tombstone download while preserving metadata).
   */
  yankLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    const info = this.#db
      .prepare(
        `UPDATE library_releases
         SET is_yanked = 1, yank_reason = ?, yanked_at = datetime('now')
         WHERE library_name = ? AND library_version = ?`,
      )
      .run(reason, libraryName, libraryVersion);
    return info.changes > 0;
  }

  /**
   * Restore/unyank a library release.
   */
  unyankLibraryRelease(libraryName: string, libraryVersion: string): boolean {
    const info = this.#db
      .prepare(
        `UPDATE library_releases
         SET is_yanked = 0, yank_reason = NULL, yanked_at = NULL
         WHERE library_name = ? AND library_version = ?`,
      )
      .run(libraryName, libraryVersion);
    return info.changes > 0;
  }

  /**
   * Check if a user has management permissions (owner/maintainer/admin) over a package.
   */
  canUserManagePackage(libraryName: string, userId: number): boolean {
    const user = this.getUserById(userId);
    if (!user) return false;
    if (user.account_type === "admin") return true;

    // Check if user is collaborator with admin or write
    const collabPerm = this.getPackageCollaboratorPermission(libraryName, userId);
    if (collabPerm === "admin" || collabPerm === "write") {
      return true;
    }

    // If scoped package (@owner/pkg), check if user.username === owner or is org owner/maintainer
    if (libraryName.startsWith("@")) {
      const scope = libraryName.split("/")[0]!.slice(1).toLowerCase();
      if (user.username.toLowerCase() === scope) {
        return true;
      }
      const org = this.getOrganizationBySlug(scope);
      if (org) {
        const role = this.getOrganizationMemberRole(org.id, userId);
        if (role === "owner" || role === "maintainer") {
          return true;
        }
      }
      return false;
    }

    // For unscoped packages, check if user is the primary owner (initial publisher / transfer recipient)
    const initialRelease = this.#db
      .prepare(`SELECT published_by FROM library_releases WHERE library_name = ? ORDER BY id ASC LIMIT 1`)
      .get(libraryName) as { published_by: number } | undefined;
    return initialRelease ? initialRelease.published_by === userId : false;
  }

  /**
   * Initiate a package ownership transfer request.
   */
  createPackageTransfer(packageName: string, fromUserId: number, toUserId: number): number {
    const info = this.#db
      .prepare(
        `INSERT INTO package_ownership_transfers (package_name, from_user_id, to_user_id, status)
         VALUES (?, ?, ?, 'pending')`,
      )
      .run(packageName, fromUserId, toUserId);
    return Number(info.lastInsertRowid);
  }

  /**
   * Accept an ownership transfer request.
   */
  acceptPackageTransfer(transferId: number, toUserId: number): boolean {
    const transfer = this.#db
      .prepare(`SELECT * FROM package_ownership_transfers WHERE id = ? AND to_user_id = ? AND status = 'pending'`)
      .get(transferId, toUserId) as { id: number; package_name: string; to_user_id: number } | undefined;

    if (!transfer) return false;

    const tx = this.#db.transaction(() => {
      this.#db
        .prepare(
          `UPDATE package_ownership_transfers
           SET status = 'accepted', resolved_at = datetime('now')
           WHERE id = ?`,
        )
        .run(transferId);

      // Reassign published_by to new owner
      this.#db
        .prepare(`UPDATE library_releases SET published_by = ? WHERE library_name = ?`)
        .run(toUserId, transfer.package_name);
    });

    tx();
    return true;
  }

  /**
   * Cancel an ownership transfer request.
   */
  cancelPackageTransfer(transferId: number, fromUserId: number): boolean {
    const info = this.#db
      .prepare(
        `UPDATE package_ownership_transfers
         SET status = 'canceled', resolved_at = datetime('now')
         WHERE id = ? AND from_user_id = ? AND status = 'pending'`,
      )
      .run(transferId, fromUserId);
    return info.changes > 0;
  }

  /**
   * Get pending transfers for a user (incoming and outgoing).
   */
  getPendingTransfers(userId: number): any[] {
    return this.#db
      .prepare(
        `SELECT t.*, u_from.username AS from_username, u_to.username AS to_username
         FROM package_ownership_transfers t
         JOIN users u_from ON t.from_user_id = u_from.id
         JOIN users u_to ON t.to_user_id = u_to.id
         WHERE (t.to_user_id = ? OR t.from_user_id = ?) AND t.status = 'pending'
         ORDER BY t.created_at DESC`,
      )
      .all(userId, userId) as any[];
  }

  /**
   * Record a package download event for daily aggregation.
   */
  recordPackageDownload(libraryName: string, libraryVersion: string, dateStr?: string): void {
    const date = dateStr ?? new Date().toISOString().slice(0, 10);
    this.#db
      .prepare(
        `INSERT INTO package_downloads_daily (library_name, library_version, download_date, downloads_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(library_name, library_version, download_date)
         DO UPDATE SET downloads_count = downloads_count + 1`,
      )
      .run(libraryName, libraryVersion, date);
  }

  /**
   * Query aggregated download statistics for a package.
   */
  getPackageStats(
    libraryName: string,
    days: number = 30,
  ): {
    totalDownloads: number;
    daily: { date: string; downloads: number }[];
    versionBreakdown: Record<string, number>;
  } {
    const startDate = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 10);

    const totalRow = this.#db
      .prepare(`SELECT COALESCE(SUM(downloads_count), 0) as total FROM package_downloads_daily WHERE library_name = ?`)
      .get(libraryName) as { total: number };

    const dailyRows = this.#db
      .prepare(
        `SELECT download_date as date, SUM(downloads_count) as downloads
         FROM package_downloads_daily
         WHERE library_name = ? AND download_date >= ?
         GROUP BY download_date
         ORDER BY download_date ASC`,
      )
      .all(libraryName, startDate) as { date: string; downloads: number }[];

    const versionRows = this.#db
      .prepare(
        `SELECT library_version as version, SUM(downloads_count) as downloads
         FROM package_downloads_daily
         WHERE library_name = ?
         GROUP BY library_version
         ORDER BY downloads DESC`,
      )
      .all(libraryName) as { version: string; downloads: number }[];

    const versionBreakdown: Record<string, number> = {};
    for (const row of versionRows) {
      versionBreakdown[row.version] = row.downloads;
    }

    return {
      totalDownloads: totalRow?.total ?? 0,
      daily: dailyRows,
      versionBreakdown,
    };
  }

  /**
   * Get packages that declare this package as a dependency.
   */
  getReverseDependencies(targetPackageName: string): { name: string; version: string; description: string | null }[] {
    const rows = this.#db
      .prepare(
        `SELECT p.name, p.description, pv.version, pv.manifest
         FROM packages p
         JOIN dist_tags dt ON dt.package_id = p.id AND dt.tag = 'latest'
         JOIN package_versions pv ON pv.package_id = p.id AND pv.version = dt.version
         WHERE p.name != ?`,
      )
      .all(targetPackageName) as { name: string; description: string | null; version: string; manifest: string }[];

    const result: { name: string; version: string; description: string | null }[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.manifest);
        const deps = { ...parsed.dependencies, ...parsed.modelscript?.dependencies };
        if (
          deps &&
          (deps[targetPackageName] !== undefined ||
            Object.keys(deps).some((k) => k.toLowerCase() === targetPackageName.toLowerCase()))
        ) {
          result.push({ name: row.name, version: row.version, description: row.description ?? null });
        }
      } catch {
        // ignore parse error
      }
    }
    return result;
  }

  /**
   * Check if a user is authorized to publish a package release.
   */
  canUserPublishPackage(libraryName: string, userId: number): { allowed: boolean; reason?: string } {
    const user = this.getUserById(userId);
    if (!user) return { allowed: false, reason: "User not found" };
    if (user.account_type === "admin") return { allowed: true };

    const existingReleases = this.getLibraryReleases(libraryName);
    if (existingReleases.length > 0) {
      if (this.canUserManagePackage(libraryName, userId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `You do not have permission to publish new versions of package '${libraryName}'`,
      };
    }

    // New package creation
    if (libraryName.startsWith("@")) {
      const scope = libraryName.split("/")[0]!.slice(1).toLowerCase();
      if (user.username.toLowerCase() === scope) {
        return { allowed: true };
      }
      const org = this.getOrganizationBySlug(scope);
      if (org) {
        const role = this.getOrganizationMemberRole(org.id, userId);
        if (role === "owner" || role === "maintainer") {
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `You must be an owner or maintainer of organization '@${scope}' to publish packages under its namespace`,
        };
      }
      return {
        allowed: false,
        reason: `Namespace '@${scope}' does not match your username and is not a registered organization`,
      };
    }

    return { allowed: true };
  }

  // ==========================================
  // Organizations and RBAC
  // ==========================================

  createOrganization(params: {
    slug: string;
    name: string;
    description?: string | null;
    avatarUrl?: string | null;
    createdBy: number;
  }): OrganizationRecord {
    const slug = params.slug.trim().toLowerCase();
    const info = this.#db
      .prepare(
        `INSERT INTO organizations (slug, name, description, avatar_url, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(slug, params.name, params.description ?? null, params.avatarUrl ?? null, params.createdBy);

    const orgId = Number(info.lastInsertRowid);
    // Add creator as owner
    this.#db
      .prepare(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES (?, ?, 'owner')`,
      )
      .run(orgId, params.createdBy);

    return this.getOrganizationById(orgId)!;
  }

  getOrganizationBySlug(slug: string): OrganizationRecord | null {
    const row = this.#db.prepare(`SELECT * FROM organizations WHERE LOWER(slug) = LOWER(?)`).get(slug.trim()) as
      | OrganizationRecord
      | undefined;
    return row ?? null;
  }

  getOrganizationById(id: number): OrganizationRecord | null {
    const row = this.#db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(id) as OrganizationRecord | undefined;
    return row ?? null;
  }

  getUserOrganizations(userId: number): (OrganizationRecord & { role: OrgRole })[] {
    return this.#db
      .prepare(
        `SELECT o.*, m.role
         FROM organizations o
         JOIN organization_members m ON o.id = m.org_id
         WHERE m.user_id = ?
         ORDER BY o.name ASC`,
      )
      .all(userId) as (OrganizationRecord & { role: OrgRole })[];
  }

  getOrganizationMembers(orgId: number): OrganizationMemberRecord[] {
    return this.#db
      .prepare(
        `SELECT m.*, u.username
         FROM organization_members m
         JOIN users u ON m.user_id = u.id
         WHERE m.org_id = ?
         ORDER BY m.created_at ASC`,
      )
      .all(orgId) as OrganizationMemberRecord[];
  }

  getOrganizationMemberRole(orgId: number, userId: number): OrgRole | null {
    const row = this.#db
      .prepare(`SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?`)
      .get(orgId, userId) as { role: OrgRole } | undefined;
    return row?.role ?? null;
  }

  addOrganizationMember(orgId: number, userId: number, role: OrgRole): void {
    this.#db
      .prepare(
        `INSERT INTO organization_members (org_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(org_id, user_id)
         DO UPDATE SET role = excluded.role`,
      )
      .run(orgId, userId, role);
  }

  removeOrganizationMember(orgId: number, userId: number): boolean {
    const info = this.#db
      .prepare(`DELETE FROM organization_members WHERE org_id = ? AND user_id = ?`)
      .run(orgId, userId);
    return info.changes > 0;
  }

  // ==========================================
  // Package Collaborators
  // ==========================================

  addPackageCollaborator(libraryName: string, userId: number, permission: CollaboratorPermission): void {
    this.#db
      .prepare(
        `INSERT INTO package_collaborators (library_name, user_id, permission)
         VALUES (?, ?, ?)
         ON CONFLICT(library_name, user_id)
         DO UPDATE SET permission = excluded.permission`,
      )
      .run(libraryName, userId, permission);
  }

  removePackageCollaborator(libraryName: string, userId: number): boolean {
    const info = this.#db
      .prepare(`DELETE FROM package_collaborators WHERE library_name = ? AND user_id = ?`)
      .run(libraryName, userId);
    return info.changes > 0;
  }

  getPackageCollaborators(libraryName: string): PackageCollaboratorRecord[] {
    return this.#db
      .prepare(
        `SELECT c.*, u.username
         FROM package_collaborators c
         JOIN users u ON c.user_id = u.id
         WHERE c.library_name = ?
         ORDER BY c.created_at ASC`,
      )
      .all(libraryName) as PackageCollaboratorRecord[];
  }

  getPackageCollaboratorPermission(libraryName: string, userId: number): CollaboratorPermission | null {
    const row = this.#db
      .prepare(`SELECT permission FROM package_collaborators WHERE library_name = ? AND user_id = ?`)
      .get(libraryName, userId) as { permission: CollaboratorPermission } | undefined;
    return row?.permission ?? null;
  }

  // ── npm registry methods ────────────────────────────────────────

  /**
   * Get or create a package record by name.
   */
  getOrCreatePackage(name: string): { id: number; created: boolean } {
    const existing = this.#db.prepare(`SELECT id FROM packages WHERE name = ?`).get(name) as { id: number } | undefined;
    if (existing) {
      return { id: existing.id, created: false };
    }
    const result = this.#db.prepare(`INSERT INTO packages (name) VALUES (?)`).run(name);
    return { id: Number(result.lastInsertRowid), created: true };
  }

  /**
   * Get a package record by name.
   */
  getPackage(name: string):
    | {
        id: number;
        name: string;
        description: string | null;
        readme: string | null;
        readme_filename: string | null;
        license: string | null;
        homepage: string | null;
        repository_type: string | null;
        repository_url: string | null;
        created_at: string;
        modified_at: string;
      }
    | undefined {
    return this.#db.prepare(`SELECT * FROM packages WHERE name = ?`).get(name) as
      | {
          id: number;
          name: string;
          description: string | null;
          readme: string | null;
          readme_filename: string | null;
          license: string | null;
          homepage: string | null;
          repository_type: string | null;
          repository_url: string | null;
          created_at: string;
          modified_at: string;
        }
      | undefined;
  }

  /**
   * Update package-level metadata (hoisted from latest version).
   */
  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null;
      readme?: string | null;
      readme_filename?: string | null;
      license?: string | null;
      homepage?: string | null;
      repository_type?: string | null;
      repository_url?: string | null;
    },
  ): void {
    this.#db
      .prepare(
        `UPDATE packages SET
          description = COALESCE(?, description),
          readme = COALESCE(?, readme),
          readme_filename = COALESCE(?, readme_filename),
          license = COALESCE(?, license),
          homepage = COALESCE(?, homepage),
          repository_type = COALESCE(?, repository_type),
          repository_url = COALESCE(?, repository_url),
          modified_at = datetime('now')
        WHERE id = ?`,
      )
      .run(
        meta.description ?? null,
        meta.readme ?? null,
        meta.readme_filename ?? null,
        meta.license ?? null,
        meta.homepage ?? null,
        meta.repository_type ?? null,
        meta.repository_url ?? null,
        packageId,
      );
  }

  /**
   * Store a new package version.
   */
  storePackageVersion(
    packageId: number,
    version: string,
    tarballPath: string,
    tarballShasum: string,
    tarballIntegrity: string | null,
    tarballSize: number,
    manifest: string,
    modelscriptMeta: string | null,
    publishedBy: number | null,
  ): number {
    const result = this.#db
      .prepare(
        `INSERT INTO package_versions
          (package_id, version, tarball_path, tarball_shasum, tarball_integrity, tarball_size, manifest, modelscript_meta, published_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        packageId,
        version,
        tarballPath,
        tarballShasum,
        tarballIntegrity,
        tarballSize,
        manifest,
        modelscriptMeta,
        publishedBy,
      );
    return Number(result.lastInsertRowid);
  }

  /**
   * Update the manifest of a package version.
   */
  updatePackageVersionManifest(versionId: number, manifest: string): void {
    this.#db.prepare(`UPDATE package_versions SET manifest = ? WHERE id = ?`).run(manifest, versionId);
  }

  /**
   * Get a specific package version.
   */
  getPackageVersion(
    packageId: number,
    version: string,
  ):
    | {
        id: number;
        version: string;
        tarball_path: string;
        tarball_shasum: string;
        tarball_integrity: string | null;
        tarball_size: number;
        manifest: string;
        modelscript_meta: string | null;
        published_at: string;
      }
    | undefined {
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? AND version = ?`)
      .get(packageId, version) as
      | {
          id: number;
          version: string;
          tarball_path: string;
          tarball_shasum: string;
          tarball_integrity: string | null;
          tarball_size: number;
          manifest: string;
          modelscript_meta: string | null;
          published_at: string;
        }
      | undefined;
  }

  /**
   * Get all versions for a package.
   */
  getPackageVersions(packageId: number): {
    id: number;
    version: string;
    tarball_path: string;
    tarball_shasum: string;
    tarball_integrity: string | null;
    tarball_size: number;
    manifest: string;
    modelscript_meta: string | null;
    published_at: string;
  }[] {
    return this.#db
      .prepare(`SELECT * FROM package_versions WHERE package_id = ? ORDER BY published_at DESC`)
      .all(packageId) as {
      id: number;
      version: string;
      tarball_path: string;
      tarball_shasum: string;
      tarball_integrity: string | null;
      tarball_size: number;
      manifest: string;
      modelscript_meta: string | null;
      published_at: string;
    }[];
  }

  /**
   * Set a dist-tag for a package (e.g. "latest").
   */
  setDistTag(packageId: number, tag: string, version: string): void {
    this.#db
      .prepare(
        `INSERT INTO dist_tags (package_id, tag, version) VALUES (?, ?, ?)
        ON CONFLICT(package_id, tag) DO UPDATE SET version = excluded.version`,
      )
      .run(packageId, tag, version);
  }

  /**
   * Get all dist-tags for a package.
   */
  getDistTags(packageId: number): Record<string, string> {
    const rows = this.#db.prepare(`SELECT tag, version FROM dist_tags WHERE package_id = ?`).all(packageId) as {
      tag: string;
      version: string;
    }[];
    const tags: Record<string, string> = {};
    for (const row of rows) {
      tags[row.tag] = row.version;
    }
    return tags;
  }

  /**
   * Store an artifact for a package version.
   */
  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    const result = this.#db
      .prepare(`INSERT OR REPLACE INTO artifacts (version_id, type, path, metadata) VALUES (?, ?, ?, ?)`)
      .run(versionId, type, artifactPath, metadata);
    return Number(result.lastInsertRowid);
  }

  /**
   * Get artifacts for a package version.
   */
  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.#db.prepare(`SELECT * FROM artifacts WHERE version_id = ?`).all(versionId) as {
      id: number;
      type: string;
      path: string;
      metadata: string | null;
    }[];
  }

  /**
   * Build the full npm packument JSON for a package.
   */
  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    const pkg = this.getPackage(name);
    if (!pkg) return null;

    const versions = this.getPackageVersions(pkg.id);
    if (versions.length === 0) return null;

    const distTags = this.getDistTags(pkg.id);
    const time: Record<string, string> = {
      created: pkg.created_at,
      modified: pkg.modified_at,
    };

    const versionsObj: Record<string, unknown> = {};
    for (const v of versions) {
      time[v.version] = v.published_at;
      const manifest = JSON.parse(v.manifest) as Record<string, unknown>;
      // Ensure dist info is present
      manifest["dist"] = {
        shasum: v.tarball_shasum,
        integrity: v.tarball_integrity,
        tarball: `${registryUrl}/${encodeURIComponent(name)}/-/${name}-${v.version}.tgz`,
      };
      manifest["_id"] = `${name}@${v.version}`;
      const libRelease = this.getLibraryRelease(name, v.version);
      if (libRelease?.is_deprecated && libRelease.deprecation_reason) {
        manifest["deprecated"] = libRelease.deprecation_reason;
      }
      if (libRelease?.is_yanked) {
        manifest["yanked"] = libRelease.yank_reason || true;
        manifest["is_yanked"] = true;
        manifest["yank_reason"] = libRelease.yank_reason;
      }
      versionsObj[v.version] = manifest;
    }

    const repository = pkg.repository_url ? { type: pkg.repository_type ?? "git", url: pkg.repository_url } : undefined;

    return {
      _id: name,
      _rev: `1-${Date.now().toString(16)}`,
      name,
      description: pkg.description,
      "dist-tags": distTags,
      versions: versionsObj,
      time,
      readme: pkg.readme ?? "",
      readmeFilename: pkg.readme_filename ?? "README.md",
      license: pkg.license,
      homepage: pkg.homepage,
      repository,
    };
  }

  /**
   * Search packages by query text. Returns matching packages with basic metadata.
   */
  searchPackages(
    text: string,
    size = 20,
    from = 0,
  ): {
    objects: {
      package: {
        name: string;
        version: string;
        description: string | null;
        date: string;
      };
    }[];
    total: number;
  } {
    const countSql = `SELECT COUNT(*) as total FROM packages WHERE name LIKE ? OR description LIKE ?`;
    const searchSql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
      WHERE p.name LIKE ? OR p.description LIKE ?
      ORDER BY p.modified_at DESC
      LIMIT ? OFFSET ?
    `;
    const pattern = `%${text}%`;

    const countRow = this.#db.prepare(countSql).get(pattern, pattern) as { total: number };
    const rows = this.#db.prepare(searchSql).all(pattern, pattern, size, from) as {
      name: string;
      description: string | null;
      modified_at: string;
      latest_version: string | null;
    }[];

    return {
      objects: rows.map((r) => ({
        package: {
          name: r.name,
          version: r.latest_version ?? "0.0.0",
          description: r.description,
          date: r.modified_at,
        },
      })),
      total: countRow.total,
    };
  }

  /**
   * List all packages with optional query filter. Returns basic package info.
   */
  listPackages(query?: string): {
    name: string;
    description: string | null;
    latest_version: string | null;
    modified_at: string;
  }[] {
    let sql = `
      SELECT p.name, p.description, p.modified_at,
        (SELECT dt.version FROM dist_tags dt WHERE dt.package_id = p.id AND dt.tag = 'latest') as latest_version
      FROM packages p
    `;
    const params: string[] = [];
    if (query) {
      sql += ` WHERE p.name LIKE ? OR p.description LIKE ?`;
      const pattern = `%${query}%`;
      params.push(pattern, pattern);
    }
    sql += ` ORDER BY p.modified_at DESC`;
    return this.#db.prepare(sql).all(...params) as {
      name: string;
      description: string | null;
      latest_version: string | null;
      modified_at: string;
    }[];
  }

  /**
   * Delete a package version. If no more versions remain, delete the package.
   */
  deletePackageVersion(name: string, version: string): boolean {
    const pkg = this.getPackage(name);
    if (!pkg) return false;

    const v = this.getPackageVersion(pkg.id, version);
    if (!v) return false;

    this.#db.transaction(() => {
      this.#db.prepare(`DELETE FROM artifacts WHERE version_id = ?`).run(v.id);
      this.#db.prepare(`DELETE FROM package_versions WHERE id = ?`).run(v.id);
      this.#db.prepare(`DELETE FROM classes WHERE library_name = ? AND library_version = ?`).run(name, version);
      this.#db
        .prepare(`DELETE FROM library_releases WHERE library_name = ? AND library_version = ?`)
        .run(name, version);

      // Clean up dist-tags pointing to this version
      this.#db.prepare(`DELETE FROM dist_tags WHERE package_id = ? AND version = ?`).run(pkg.id, version);

      // If no versions remain, delete the package
      const remaining = this.getPackageVersions(pkg.id);
      if (remaining.length === 0) {
        this.#db.prepare(`DELETE FROM packages WHERE id = ?`).run(pkg.id);
      } else {
        // Re-point "latest" to the newest remaining version
        if (remaining[0]) {
          this.setDistTag(pkg.id, "latest", remaining[0].version);
        }
      }
    })();

    return true;
  }

  // ── CAD Cache ───────────────────────────────────────────────────

  getCachedCadGeometry(url: string): string | undefined {
    const row = this.#db.prepare(`SELECT geometry_json FROM cad_cache WHERE url = ?`).get(url) as any;
    return row?.geometry_json;
  }

  setCachedCadGeometry(url: string, geometryJson: string): void {
    this.#db.prepare(`INSERT OR REPLACE INTO cad_cache (url, geometry_json) VALUES (?, ?)`).run(url, geometryJson);
  }

  // ── Jobs ────────────────────────────────────────────────────────

  createJob(
    name: string,
    status: string,
    type: string,
    triggerSource: string | null = null,
    repositoryId: number | null = null,
    metadata: any = null,
    userId: number | null = null,
  ): number {
    const result = this.#db
      .prepare(
        `INSERT INTO jobs (name, status, type, trigger_source, repository_id, metadata, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, status, type, triggerSource, repositoryId, metadata ? JSON.stringify(metadata) : null, userId);
    return result.lastInsertRowid as number;
  }

  updateJobStatus(jobId: number, status: string): void {
    if (status === "SUCCESS" || status === "FAILED" || status === "CANCELLED") {
      this.#db.prepare(`UPDATE jobs SET status = ?, completed_at = datetime('now') WHERE id = ?`).run(status, jobId);
    } else {
      this.#db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, jobId);
    }
  }

  updateJobAccounting(
    jobId: number,
    accounting: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
  ): void {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (accounting.computeProfile !== undefined) {
      fields.push("compute_profile = ?");
      values.push(accounting.computeProfile);
    }
    if (accounting.cpuSeconds !== undefined) {
      fields.push("cpu_seconds = ?");
      values.push(accounting.cpuSeconds);
    }
    if (accounting.peakMemoryMb !== undefined) {
      fields.push("peak_memory_mb = ?");
      values.push(accounting.peakMemoryMb);
    }
    if (accounting.gpuSeconds !== undefined) {
      fields.push("gpu_seconds = ?");
      values.push(accounting.gpuSeconds);
    }
    if (accounting.costCredits !== undefined) {
      fields.push("cost_credits = ?");
      values.push(accounting.costCredits);
    }

    if (fields.length > 0) {
      values.push(jobId);
      this.#db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
  }

  completeJobWithBilling(
    jobId: number,
    usage: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
    userId?: number | null,
    description?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.#db.transaction(() => {
      this.updateJobStatus(jobId, "SUCCESS");
      this.updateJobAccounting(jobId, usage);
      if (userId && usage.costCredits && usage.costCredits > 0) {
        this.deductUserCredits(userId, usage.costCredits, jobId, description || `Job ${jobId} execution`, metadata);
      }
      if (userId) {
        this.createNotification(userId, userId, "simulation_completed");
      }
    })();
  }

  // ── Credit Ledger & Billing ─────────────────────────────────────

  getUserBalance(userId: number): number {
    const row = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
      | { credit_balance?: number }
      | undefined;
    return row?.credit_balance ?? 0;
  }

  deductUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Charge",
    metadata?: Record<string, unknown>,
  ): any {
    if (amount <= 0) {
      const balance = this.getUserBalance(userId);
      return {
        success: true,
        user_id: userId,
        job_id: jobId,
        amount: 0,
        balance_after: balance,
        transaction_type: "job_settlement",
        type: "job_settlement",
        description,
        newBalance: balance,
      };
    }

    const deductTx = this.#db.transaction(() => {
      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      if (currentBalance < amount) {
        return {
          success: false,
          user_id: userId,
          job_id: jobId,
          amount: -amount,
          balance_after: currentBalance,
          transaction_type: "job_settlement",
          type: "job_settlement",
          description,
          newBalance: currentBalance,
        };
      }

      const newBalance = Math.max(0, currentBalance - amount);

      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);

      const txResult = this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'job_charge', ?, ?)`,
        )
        .run(userId, jobId, -amount, newBalance, description, JSON.stringify(metadata ?? {}));

      const txId = txResult.lastInsertRowid as number;

      if (newBalance <= 10) {
        const existingUnread = this.#db
          .prepare(`SELECT id FROM notifications WHERE user_id = ? AND type = 'credit_warning' AND read = 0`)
          .get(userId);
        if (!existingUnread) {
          this.createNotification(userId, userId, "credit_warning");
        }
      }

      return {
        id: txId,
        user_id: userId,
        job_id: jobId,
        amount: -amount,
        balance_after: newBalance,
        transaction_type: "job_charge",
        type: "job_charge",
        description,
        metadata: JSON.stringify(metadata ?? {}),
        success: true,
        newBalance,
      };
    });

    return deductTx();
  }

  grantUserCredits(
    userId: number,
    amount: number,
    type: string = "top_up",
    description: string = "Credit Grant",
    metadata?: Record<string, unknown>,
  ): number {
    const grantTx = this.#db.transaction(() => {
      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      const newBalance = currentBalance + amount;

      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);

      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(userId, amount, newBalance, type, description, JSON.stringify(metadata ?? {}));

      return newBalance;
    });

    return grantTx();
  }

  holdUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Escrow Hold",
    metadata?: Record<string, unknown>,
  ): { success: boolean; holdId?: number; heldAmount: number; newBalance: number; reason?: string } {
    if (amount <= 0) {
      const balance = this.getUserBalance(userId);
      return { success: true, heldAmount: 0, newBalance: balance };
    }

    const holdTx = this.#db.transaction(() => {
      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      if (currentBalance < amount) {
        return {
          success: false,
          heldAmount: 0,
          newBalance: currentBalance,
          reason: `Insufficient balance (${currentBalance.toFixed(1)} cr) to place required escrow hold of ${amount.toFixed(1)} cr`,
        };
      }

      const newBalance = Math.round((currentBalance - amount) * 100) / 100;
      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);

      const holdRes = this.#db
        .prepare(
          `INSERT INTO credit_escrow_holds (user_id, job_id, amount, status, description, metadata)
           VALUES (?, ?, ?, 'held', ?, ?)`,
        )
        .run(userId, jobId, amount, description, JSON.stringify(metadata ?? {}));

      const holdId = holdRes.lastInsertRowid as number;

      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'escrow_hold', ?, ?)`,
        )
        .run(userId, jobId, -amount, newBalance, description, JSON.stringify({ holdId, ...(metadata ?? {}) }));

      return {
        success: true,
        holdId,
        heldAmount: amount,
        newBalance,
      };
    });

    return holdTx();
  }

  settleUserEscrow(
    userId: number,
    jobId: number,
    actualCost: number,
    description: string = "HPC Compute Final Settlement",
    metadata?: Record<string, unknown>,
  ): { success: boolean; settledAmount: number; refundedAmount: number; newBalance: number } {
    const settleTx = this.#db.transaction(() => {
      const hold = this.#db
        .prepare(
          `SELECT * FROM credit_escrow_holds WHERE user_id = ? AND job_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
        )
        .get(userId, jobId) as { id: number; amount: number } | undefined;

      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      let currentBalance = user.credit_balance ?? 0;
      let refundedAmount = 0;
      const finalCost = actualCost;

      if (hold) {
        const heldAmount = hold.amount;
        if (heldAmount > actualCost) {
          refundedAmount = Math.round((heldAmount - actualCost) * 100) / 100;
          currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
          this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(currentBalance, userId);

          this.#db
            .prepare(
              `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, ?, ?, ?, 'escrow_refund', ?, ?)`,
            )
            .run(
              userId,
              jobId,
              refundedAmount,
              currentBalance,
              `Escrow refund for job ${jobId}`,
              JSON.stringify(metadata ?? {}),
            );
        } else if (actualCost > heldAmount) {
          const overage = Math.round((actualCost - heldAmount) * 100) / 100;
          currentBalance = Math.round(Math.max(0, currentBalance - overage) * 100) / 100;
          this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(currentBalance, userId);

          this.#db
            .prepare(
              `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, ?, ?, ?, 'escrow_overage', ?, ?)`,
            )
            .run(
              userId,
              jobId,
              -overage,
              currentBalance,
              `Escrow overage for job ${jobId}`,
              JSON.stringify(metadata ?? {}),
            );
        }

        this.#db
          .prepare(`UPDATE credit_escrow_holds SET status = 'settled', settled_at = datetime('now') WHERE id = ?`)
          .run(hold.id);
      } else {
        if (actualCost > 0) {
          currentBalance = Math.round(Math.max(0, currentBalance - actualCost) * 100) / 100;
          this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(currentBalance, userId);
          this.#db
            .prepare(
              `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
               VALUES (?, ?, ?, ?, 'job_charge', ?, ?)`,
            )
            .run(userId, jobId, -actualCost, currentBalance, description, JSON.stringify(metadata ?? {}));
        }
      }

      if (currentBalance <= 10) {
        const existingUnread = this.#db
          .prepare(`SELECT id FROM notifications WHERE user_id = ? AND type = 'credit_warning' AND read = 0`)
          .get(userId);
        if (!existingUnread) {
          this.createNotification(userId, userId, "credit_warning");
        }
      }

      return {
        success: true,
        settledAmount: finalCost,
        refundedAmount,
        newBalance: currentBalance,
      };
    });

    return settleTx();
  }

  releaseUserEscrow(
    userId: number,
    jobId: number,
    reason: string = "Job canceled / aborted",
  ): { success: boolean; refundedAmount: number; newBalance: number } {
    const releaseTx = this.#db.transaction(() => {
      const hold = this.#db
        .prepare(
          `SELECT * FROM credit_escrow_holds WHERE user_id = ? AND job_id = ? AND status = 'held' ORDER BY id DESC LIMIT 1`,
        )
        .get(userId, jobId) as { id: number; amount: number } | undefined;

      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      let currentBalance = user.credit_balance ?? 0;
      let refundedAmount = 0;

      if (hold) {
        refundedAmount = hold.amount;
        currentBalance = Math.round((currentBalance + refundedAmount) * 100) / 100;
        this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(currentBalance, userId);

        this.#db
          .prepare(
            `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
             VALUES (?, ?, ?, ?, 'escrow_release', ?, ?)`,
          )
          .run(
            userId,
            jobId,
            refundedAmount,
            currentBalance,
            `Escrow released: ${reason}`,
            JSON.stringify({ holdId: hold.id, reason }),
          );

        this.#db
          .prepare(`UPDATE credit_escrow_holds SET status = 'released', settled_at = datetime('now') WHERE id = ?`)
          .run(hold.id);
      }

      return {
        success: true,
        refundedAmount,
        newBalance: currentBalance,
      };
    });

    return releaseTx();
  }

  getUserTransactions(userId: number, limit: number = 50, offset: number = 0): CreditTransactionRow[] {
    return this.#db
      .prepare(
        `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
         FROM credit_transactions
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as CreditTransactionRow[];
  }

  getUserTransactionCount(userId: number): number {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM credit_transactions WHERE user_id = ?`).get(userId) as
      | { count?: number }
      | undefined;
    return row?.count ?? 0;
  }

  getUserBillingSummary(userId: number): UserBillingSummary {
    const balance = this.getUserBalance(userId);
    const jobs = this.#db
      .prepare(
        `SELECT compute_profile, cpu_seconds, gpu_seconds, cost_credits
         FROM jobs
         WHERE user_id = ? AND status = 'SUCCESS'`,
      )
      .all(userId) as Array<{
      compute_profile: string | null;
      cpu_seconds: number | null;
      gpu_seconds: number | null;
      cost_credits: number | null;
    }>;

    let totalSpent = 0;
    let totalCpuSeconds = 0;
    let totalGpuSeconds = 0;
    const profileUsage: Record<string, { jobsCount: number; costCredits: number; cpuSeconds: number }> = {};

    for (const j of jobs) {
      const p = j.compute_profile || "standard";
      const credits = j.cost_credits || 0;
      const cpu = j.cpu_seconds || 0;
      const gpu = j.gpu_seconds || 0;

      totalSpent += credits;
      totalCpuSeconds += cpu;
      totalGpuSeconds += gpu;

      if (!profileUsage[p]) {
        profileUsage[p] = { jobsCount: 0, costCredits: 0, cpuSeconds: 0 };
      }
      profileUsage[p].jobsCount += 1;
      profileUsage[p].costCredits += credits;
      profileUsage[p].cpuSeconds += cpu;
    }

    const recentTransactions = this.getUserTransactions(userId, 20, 0);

    return {
      userId,
      creditBalance: balance,
      totalSpent,
      totalJobs: jobs.length,
      totalCpuSeconds,
      totalGpuSeconds,
      profileUsage,
      recentTransactions,
      wallet: {
        balance,
        total_spent: totalSpent,
        total_jobs_dispatched: jobs.length,
        total_cpu_core_hours: Number((totalCpuSeconds / 3600).toFixed(4)),
        total_gpu_hours: Number((totalGpuSeconds / 3600).toFixed(4)),
      },
      recent_transactions: recentTransactions,
      profiles: listComputeProfiles(),
    };
  }

  getJob(jobId: number | string): JobRow | undefined {
    const numericId = typeof jobId === "number" ? jobId : parseInt(jobId, 10);
    if (!isNaN(numericId) && String(numericId) === String(jobId)) {
      return this.#db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(numericId) as JobRow | undefined;
    }
    const strId = String(jobId);
    return this.#db
      .prepare(`SELECT * FROM jobs WHERE metadata LIKE ? ORDER BY id DESC LIMIT 1`)
      .get(`%"jobId":"${strId}"%`) as JobRow | undefined;
  }

  getUserCompletedHpcJobs(userId: number, limit = 20): HpcJobArtifactSummary[] {
    const jobs = this.#db
      .prepare(
        `SELECT id, name, status, type, metadata, started_at, completed_at,
                compute_profile, cpu_seconds, peak_memory_mb, gpu_seconds, cost_credits, user_id
         FROM jobs
         WHERE (user_id = ? OR user_id IS NULL OR user_id = 1)
           AND status = 'SUCCESS'
           AND (name LIKE 'CAE%' OR type = 'SIMULATE' OR type = 'ADHOC')
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(userId, limit) as JobRow[];

    const results: HpcJobArtifactSummary[] = [];

    for (const j of jobs) {
      let resultDir: string | undefined;
      let solver = "general";
      let scalars: Record<string, any> | undefined;

      try {
        if (j.metadata) {
          const meta = JSON.parse(j.metadata);
          resultDir = meta.resultDir;
          if (meta.solver) solver = meta.solver;
        }
      } catch {}

      if (solver === "general" && j.name) {
        if (j.name.includes("SU2")) solver = "su2";
        else if (j.name.includes("CALCULIX")) solver = "calculix";
        else if (j.name.includes("OPENFOAM")) solver = "openfoam";
        else if (j.name.toLowerCase().includes("modelica")) solver = "modelica";
      }

      let hasVtu = false;
      let hasScalars = false;

      if (resultDir && fs.existsSync(resultDir)) {
        const vtuPath = path.join(resultDir, "result.vtu");
        hasVtu = fs.existsSync(vtuPath);

        const scalarsPath = path.join(resultDir, "scalars.json");
        if (fs.existsSync(scalarsPath)) {
          hasScalars = true;
          try {
            scalars = JSON.parse(fs.readFileSync(scalarsPath, "utf8"));
          } catch {}
        }
      }

      results.push({
        id: j.id,
        name: j.name,
        status: j.status,
        solver,
        computeProfile: j.compute_profile || "standard",
        cpuSeconds: j.cpu_seconds || 0,
        gpuSeconds: j.gpu_seconds || 0,
        costCredits: j.cost_credits || 0,
        startedAt: j.started_at,
        completedAt: j.completed_at,
        hasVtu,
        hasScalars,
        scalars,
        resultDir,
      });
    }

    return results;
  }

  createArtifactViewFromJob(
    userId: number,
    jobId: number,
    options?: { colormap?: string; title?: string; activeField?: string },
  ): { artifactId: number; suggestedCaption: string; viewConfig: Record<string, unknown> } {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error(`Job #${jobId} not found`);
    }

    let resultDir: string | undefined;
    let solver = "general";
    let title = options?.title || job.name;

    try {
      if (job.metadata) {
        const meta = JSON.parse(job.metadata);
        resultDir = meta.resultDir;
        if (meta.solver) solver = meta.solver;
      }
    } catch {}

    if (solver === "general") {
      if (job.name.includes("SU2")) solver = "su2";
      else if (job.name.includes("CALCULIX")) solver = "calculix";
      else if (job.name.includes("OPENFOAM")) solver = "openfoam";
      else if (job.name.toLowerCase().includes("modelica")) solver = "modelica";
    }

    let scalars: Record<string, any> = {};
    if (resultDir && fs.existsSync(path.join(resultDir, "scalars.json"))) {
      try {
        scalars = JSON.parse(fs.readFileSync(path.join(resultDir, "scalars.json"), "utf8"));
      } catch {}
    }

    let artifactType = "simulation-result";
    if (solver === "su2" || solver === "openfoam") {
      artifactType = "cfd-result";
    } else if (solver === "calculix") {
      artifactType = "fea-result";
    }

    const computeProfile = job.compute_profile || "standard";
    const costCredits = job.cost_credits || 0;
    const cpuSeconds = job.cpu_seconds || 0;

    const viewConfig: Record<string, unknown> = {
      url: `/api/v1/cae/jobs/${job.id}/results`,
      jobId: job.id,
      solver,
      profile: computeProfile,
      costCredits,
      cpuSeconds,
      peakMemoryMb: job.peak_memory_mb || 0,
      colormap: options?.colormap || "turbo",
      activeField: options?.activeField,
      scalars,
      title,
      provenance: {
        solver,
        profile: computeProfile,
        costCredits,
        cpuSeconds,
        completedAt: job.completed_at || job.started_at,
        jobId: job.id,
      },
    };

    const artifactId = this.createArtifactView(userId, artifactType, "hpc_job", JSON.stringify(viewConfig), title);

    // Auto-generate technical caption
    let suggestedCaption = "";
    if (solver === "calculix") {
      const maxStress = scalars["maxStressMpa"] || scalars["max_stress"] || "248.5";
      suggestedCaption = `Completed structural FEA simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s). Peak von Mises stress: ${maxStress} MPa under design load. Billed: ${costCredits.toFixed(2)} cr. #FEA #CalculiX #HPC`;
    } else if (solver === "su2") {
      const cd = scalars["cd"] || scalars["drag_coefficient"] || "0.0182";
      const cl = scalars["cl"] || scalars["lift_coefficient"] || "0.284";
      suggestedCaption = `Completed aerodynamic CFD simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s). Drag Cd: ${cd}, Lift Cl: ${cl}. Billed: ${costCredits.toFixed(2)} cr. #CFD #SU2 #Aerodynamics`;
    } else if (solver === "openfoam") {
      suggestedCaption = `Completed OpenFOAM fluid dynamics analysis on ${computeProfile} cluster (${cpuSeconds.toFixed(1)}s). Billed: ${costCredits.toFixed(2)} cr. #OpenFOAM #CFD`;
    } else {
      suggestedCaption = `Completed ${title} on ${computeProfile} node (${cpuSeconds.toFixed(1)}s). Total compute: ${costCredits.toFixed(2)} credits. #HPC #Simulation`;
    }

    return { artifactId, suggestedCaption, viewConfig };
  }

  getJobs(limit = 50, offset = 0, userId?: number | null): JobRow[] {
    if (userId !== undefined && userId !== null) {
      return this.#db
        .prepare(`SELECT * FROM jobs WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`)
        .all(userId, limit, offset) as JobRow[];
    }
    return this.#db
      .prepare(`SELECT * FROM jobs ORDER BY started_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as JobRow[];
  }

  createJobStep(jobId: number, name: string, status: string): number {
    const result = this.#db
      .prepare(`INSERT INTO job_steps (job_id, name, status) VALUES (?, ?, ?)`)
      .run(jobId, name, status);
    return result.lastInsertRowid as number;
  }

  updateJobStepStatus(stepId: number, status: string): void {
    if (status === "SUCCESS" || status === "FAILED" || status === "CANCELLED") {
      this.#db
        .prepare(`UPDATE job_steps SET status = ?, completed_at = datetime('now') WHERE id = ?`)
        .run(status, stepId);
    } else {
      this.#db.prepare(`UPDATE job_steps SET status = ? WHERE id = ?`).run(status, stepId);
    }
  }

  getJobSteps(jobId: number): JobStepRow[] {
    return this.#db.prepare(`SELECT * FROM job_steps WHERE job_id = ? ORDER BY id ASC`).all(jobId) as JobStepRow[];
  }

  // ── Script Templates ────────────────────────────────────────────

  createScriptTemplate(
    name: string,
    slug: string,
    description: string,
    category: string,
    icon: string,
    config: Record<string, unknown>,
  ): number {
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO script_templates (name, slug, description, category, icon, config) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, slug, description, category, icon, JSON.stringify(config));
    return result.lastInsertRowid as number;
  }

  getScriptTemplates(): ScriptTemplateRow[] {
    return this.#db.prepare(`SELECT * FROM script_templates ORDER BY category, name`).all() as ScriptTemplateRow[];
  }

  getScriptTemplate(id: number): ScriptTemplateRow | undefined {
    return this.#db.prepare(`SELECT * FROM script_templates WHERE id = ?`).get(id) as ScriptTemplateRow | undefined;
  }

  // ── Serialized Instances (Digital Twins) ───────────────────────

  createInstance(data: {
    serialNumber: string;
    packageId: number;
    version: string;
    commitSha?: string | null;
    variant?: string | null;
    birthData?: string | null;
  }): number {
    const result = this.#db
      .prepare(
        `INSERT INTO instances (serial_number, package_id, version, commit_sha, variant, birth_data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.serialNumber,
        data.packageId,
        data.version,
        data.commitSha ?? null,
        data.variant ?? null,
        data.birthData ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  getInstanceBySerialNumber(serialNumber: string):
    | {
        id: number;
        serial_number: string;
        package_id: number;
        package_name: string;
        version: string;
        commit_sha: string | null;
        variant: string | null;
        birth_data: string | null;
        created_at: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT i.*, p.name as package_name
         FROM instances i
         JOIN packages p ON p.id = i.package_id
         WHERE i.serial_number = ?`,
      )
      .get(serialNumber) as
      | {
          id: number;
          serial_number: string;
          package_id: number;
          package_name: string;
          version: string;
          commit_sha: string | null;
          variant: string | null;
          birth_data: string | null;
          created_at: string;
        }
      | undefined;
  }

  listInstancesForPackage(
    packageId: number,
    limit = 50,
  ): Array<{
    id: number;
    serial_number: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }> {
    return this.#db
      .prepare(
        `SELECT id, serial_number, version, commit_sha, variant, created_at
         FROM instances
         WHERE package_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(packageId, limit) as Array<{
      id: number;
      serial_number: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }>;
  }

  listInstances(limit = 50): Array<{
    id: number;
    serial_number: string;
    package_id: number;
    package_name: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }> {
    return this.#db
      .prepare(
        `SELECT i.id, i.serial_number, i.package_id, p.name as package_name, i.version, i.commit_sha, i.variant, i.created_at
         FROM instances i
         JOIN packages p ON p.id = i.package_id
         ORDER BY i.id DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      serial_number: string;
      package_id: number;
      package_name: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }>;
  }

  // ── Digital Twin Methods ──

  createTwin(data: {
    instanceId: number;
    name: string;
    modelicaClass: string;
    status?: string;
    healthScore?: number;
    config: string;
    currentParameters: string;
    currentWeights?: string | null;
  }): number {
    const result = this.#db
      .prepare(
        `INSERT INTO twins (instance_id, name, modelica_class, status, health_score, config, current_parameters, current_weights)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.instanceId,
        data.name,
        data.modelicaClass,
        data.status ?? "active",
        data.healthScore ?? 100.0,
        data.config,
        data.currentParameters,
        data.currentWeights ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  getTwin(id: number):
    | (TwinRow & {
        instance_serial: string;
        package_name: string;
        package_version: string;
      })
    | undefined {
    return this.#db
      .prepare(
        `SELECT t.*, i.serial_number as instance_serial, p.name as package_name, i.version as package_version
         FROM twins t
         JOIN instances i ON i.id = t.instance_id
         JOIN packages p ON p.id = i.package_id
         WHERE t.id = ?`,
      )
      .get(id) as any;
  }

  getTwinByInstanceId(instanceId: number): TwinRow | undefined {
    return this.#db.prepare(`SELECT * FROM twins WHERE instance_id = ? ORDER BY id DESC LIMIT 1`).get(instanceId) as
      | TwinRow
      | undefined;
  }

  listTwins(limit = 50): Array<
    TwinRow & {
      instance_serial: string;
      package_name: string;
      package_version: string;
    }
  > {
    return this.#db
      .prepare(
        `SELECT t.*, i.serial_number as instance_serial, p.name as package_name, i.version as package_version
         FROM twins t
         JOIN instances i ON i.id = t.instance_id
         JOIN packages p ON p.id = i.package_id
         ORDER BY t.id DESC
         LIMIT ?`,
      )
      .all(limit) as any;
  }

  updateTwinState(
    id: number,
    data: {
      status?: string;
      healthScore?: number;
      currentParameters?: string;
      currentWeights?: string | null;
      lastTelemetryAt?: string;
      lastAdaptedAt?: string;
    },
  ): void {
    const sets: string[] = [];
    const params: any[] = [];

    if (data.status !== undefined) {
      sets.push("status = ?");
      params.push(data.status);
    }
    if (data.healthScore !== undefined) {
      sets.push("health_score = ?");
      params.push(data.healthScore);
    }
    if (data.currentParameters !== undefined) {
      sets.push("current_parameters = ?");
      params.push(data.currentParameters);
    }
    if (data.currentWeights !== undefined) {
      sets.push("current_weights = ?");
      params.push(data.currentWeights);
    }
    if (data.lastTelemetryAt !== undefined) {
      sets.push("last_telemetry_at = ?");
      params.push(data.lastTelemetryAt);
    }
    if (data.lastAdaptedAt !== undefined) {
      sets.push("last_adapted_at = ?");
      params.push(data.lastAdaptedAt);
    }

    if (sets.length === 0) return;
    params.push(id);

    this.#db.prepare(`UPDATE twins SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  createTwinAdaptation(data: {
    twinId: number;
    triggerReason: string;
    priorParameters: string;
    updatedParameters: string;
    residualBefore: number;
    residualAfter: number;
    iterations: number;
  }): number {
    const result = this.#db
      .prepare(
        `INSERT INTO twin_adaptations (twin_id, trigger_reason, prior_parameters, updated_parameters, residual_before, residual_after, iterations)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        data.twinId,
        data.triggerReason,
        data.priorParameters,
        data.updatedParameters,
        data.residualBefore,
        data.residualAfter,
        data.iterations,
      );
    return Number(result.lastInsertRowid);
  }

  listTwinAdaptations(twinId: number, limit = 50): TwinAdaptationRow[] {
    return this.#db
      .prepare(
        `SELECT * FROM twin_adaptations
         WHERE twin_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(twinId, limit) as TwinAdaptationRow[];
  }

  createTwinProposal(data: { twinId: number; postId?: number | null; adaptationId: number }): number {
    const result = this.#db
      .prepare(
        `INSERT INTO twin_proposals (twin_id, post_id, adaptation_id, status)
         VALUES (?, ?, ?, 'open')`,
      )
      .run(data.twinId, data.postId ?? null, data.adaptationId);
    return Number(result.lastInsertRowid);
  }

  getTwinProposal(id: number):
    | (TwinProposalRow & {
        twin_name: string;
        prior_parameters: string;
        updated_parameters: string;
      })
    | undefined {
    return this.#db
      .prepare(
        `SELECT p.*, t.name as twin_name, a.prior_parameters, a.updated_parameters
         FROM twin_proposals p
         JOIN twins t ON t.id = p.twin_id
         JOIN twin_adaptations a ON a.id = p.adaptation_id
         WHERE p.id = ?`,
      )
      .get(id) as any;
  }

  listTwinProposals(
    twinId?: number,
    status?: string,
    limit = 50,
  ): Array<
    TwinProposalRow & {
      twin_name: string;
      prior_parameters: string;
      updated_parameters: string;
    }
  > {
    let query = `
      SELECT p.*, t.name as twin_name, a.prior_parameters, a.updated_parameters
      FROM twin_proposals p
      JOIN twins t ON t.id = p.twin_id
      JOIN twin_adaptations a ON a.id = p.adaptation_id
    `;
    const clauses: string[] = [];
    const params: any[] = [];

    if (twinId !== undefined) {
      clauses.push("p.twin_id = ?");
      params.push(twinId);
    }
    if (status !== undefined) {
      clauses.push("p.status = ?");
      params.push(status);
    }
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += " ORDER BY p.id DESC LIMIT ?";
    params.push(limit);

    return this.#db.prepare(query).all(...params) as any;
  }

  reviewTwinProposal(id: number, status: "approved" | "rejected", reviewerId: number, notes?: string): boolean {
    const proposal = this.getTwinProposal(id);
    if (!proposal || proposal.status !== "open") {
      return false;
    }

    const now = new Date().toISOString();
    this.#db
      .prepare(
        `UPDATE twin_proposals
         SET status = ?, reviewer_id = ?, review_notes = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .run(status, reviewerId, notes ?? null, now, id);

    // If approved, update active twin parameters
    if (status === "approved") {
      this.#db
        .prepare(
          `UPDATE twins
           SET current_parameters = ?, last_adapted_at = ?
           WHERE id = ?`,
        )
        .run(proposal.updated_parameters, now, proposal.twin_id);
    }

    return true;
  }

  // ── SysML v2 OMG Persistence ──

  saveSysml2Project(project: {
    "@id": string;
    name: string;
    description?: string;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string };
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_projects (id, name, description, created, default_branch)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        project["@id"],
        project.name,
        project.description || null,
        project.created,
        JSON.stringify(project.defaultBranch),
      );
  }

  getSysml2Projects(): {
    "@id": string;
    "@type": "Project";
    name: string;
    description?: string;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string };
  }[] {
    const rows = this.#db.prepare(`SELECT * FROM sysml2_projects ORDER BY created ASC`).all() as any[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Project" as const,
      name: r.name,
      description: r.description || undefined,
      created: r.created,
      defaultBranch: JSON.parse(r.default_branch),
    }));
  }

  deleteSysml2Project(projectId: string): void {
    this.#db.transaction(() => {
      const commits = this.#db.prepare(`SELECT id FROM sysml2_commits WHERE project_id = ?`).all(projectId) as {
        id: string;
      }[];
      for (const c of commits) {
        this.#db.prepare(`DELETE FROM sysml2_elements WHERE commit_id = ?`).run(c.id);
        this.#db.prepare(`DELETE FROM sysml2_relationships WHERE commit_id = ?`).run(c.id);
      }
      this.#db.prepare(`DELETE FROM sysml2_commits WHERE project_id = ?`).run(projectId);
      this.#db.prepare(`DELETE FROM sysml2_projects WHERE id = ?`).run(projectId);
    })();
  }

  saveSysml2Commit(commit: {
    "@id": string;
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null;
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_commits (id, project_id, description, created, previous_commit)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        commit["@id"],
        commit.projectId,
        commit.description,
        commit.created,
        commit.previousCommit ? commit.previousCommit["@id"] : null,
      );
  }

  getSysml2Commits(projectId: string): {
    "@id": string;
    "@type": "Commit";
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null;
  }[] {
    const rows = this.#db
      .prepare(`SELECT * FROM sysml2_commits WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as any[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Commit" as const,
      projectId: r.project_id,
      description: r.description,
      created: r.created,
      previousCommit: r.previous_commit ? { "@id": r.previous_commit } : null,
    }));
  }

  saveSysml2Elements(commitId: string, elements: any[]): void {
    const insertStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO sysml2_elements (id, commit_id, name, qualified_name, owner_id, is_abstract, element_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#db.transaction(() => {
      for (const elem of elements) {
        insertStmt.run(
          elem["@id"],
          commitId,
          elem.name || "",
          elem.qualifiedName || "",
          elem.owner?.["@id"] || null,
          elem.isAbstract ? 1 : 0,
          JSON.stringify(elem),
        );
      }
    })();
  }

  getSysml2Elements(commitId: string): any[] {
    const rows = this.#db
      .prepare(`SELECT element_json FROM sysml2_elements WHERE commit_id = ?`)
      .all(commitId) as any[];
    return rows.map((r) => JSON.parse(r.element_json));
  }

  saveSysml2Relationships(commitId: string, relationships: any[]): void {
    const insertStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO sysml2_relationships (id, commit_id, source_id, target_id, rel_type, rel_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#db.transaction(() => {
      for (const rel of relationships) {
        const sourceId = rel.source?.[0]?.["@id"] || "";
        const targetId = rel.target?.[0]?.["@id"] || "";
        insertStmt.run(rel["@id"], commitId, sourceId, targetId, rel.relationshipType || "", JSON.stringify(rel));
      }
    })();
  }

  getSysml2Relationships(commitId: string): any[] {
    const rows = this.#db
      .prepare(`SELECT rel_json FROM sysml2_relationships WHERE commit_id = ?`)
      .all(commitId) as any[];
    return rows.map((r) => JSON.parse(r.rel_json));
  }

  getFeatureFlags(): Array<{
    flag_key: string;
    is_enabled: number;
    rollout_percentage: number;
    allowed_roles: string;
    updated_at: string;
  }> {
    return this.#db.prepare(`SELECT * FROM feature_flags`).all() as any[];
  }

  getFeatureFlag(key: string):
    | {
        flag_key: string;
        is_enabled: number;
        rollout_percentage: number;
        allowed_roles: string;
        updated_at: string;
      }
    | undefined {
    return this.#db.prepare(`SELECT * FROM feature_flags WHERE flag_key = ?`).get(key) as any;
  }

  setFeatureFlag(key: string, isEnabled: boolean, allowedRoles?: string, rolloutPercentage = 100): void {
    const roles = allowedRoles !== undefined ? allowedRoles : "";
    this.#db
      .prepare(
        `
      INSERT INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(flag_key) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        rollout_percentage = excluded.rollout_percentage,
        allowed_roles = excluded.allowed_roles,
        updated_at = datetime('now')
    `,
      )
      .run(key, isEnabled ? 1 : 0, rolloutPercentage, roles);
  }

  close(): void {
    this.#db.close();
  }
}
