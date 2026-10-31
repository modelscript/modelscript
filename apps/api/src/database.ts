// SPDX-License-Identifier: AGPL-3.0-or-later

import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BillingRepository,
  PackageRepository,
  ReferralRepository,
  UserRepository,
} from "./database/repositories/index.js";
import type {
  AccountWarningRow,
  AdminUserSummaryRow,
  ArtifactViewRow,
  AuditLogRow,
  CanonicalEmailBlockRow,
  ContentFilterKeyword,
  ContentFilterMatch,
  ContentFilterRow,
  ContentReportRow,
  DmcaNoticeRow,
  FederationRelayRow,
  InstanceRuleRow,
  IpBlockRow,
  LibraryReleaseRow,
  LinkedRepoRow,
  NotificationRow,
  PackageTransferRow,
  PostMetadata,
  PostPollOption,
  PostPollView,
  PostRow,
  PostVisibility,
  ProfileField,
  PushSubscriptionRow,
  RemoteActorProfile,
  RemoteArtifactCacheRow,
  RemotePackageRow,
  RssFeedRow,
  SolutionReleaseRow,
  SolutionRow,
  StaffNoteRow,
  UserArchiveData,
  UserFederationInfo,
  UserReferralRow,
  UserRow,
  WaitlistSubmissionRow,
} from "./database/types.js";
import { SqliteMigrationRunner, allMigrations } from "./migrations/index.js";
import { AnalyticsBuffer, type BatchAnalyticsPayload } from "./services/analytics-buffer.js";
import { listComputeProfiles } from "./services/hpc/compute-profiles.js";
import type { ComputeProfile } from "./services/hpc/hpc-types.js";
import {
  defaultMailer,
  type DigestNotificationItem,
  type EmailTemplateDefinition,
  type EmailTemplateId,
  type EmailTemplateOverride,
  type EmailThemeConfig,
  type MailerDriver,
  type MailerDriverPreference,
  type SmtpTlsMode,
} from "./services/mailer.js";
import { S3StorageDriver } from "./storage/s3-driver.js";
import { canonicalizeEmail, hashCanonicalEmail, ipMatchesCidr, redactEmailHint } from "./util/email-filter.js";
import {
  decryptSecretAtRest,
  decryptTotpSecret,
  encryptSecretAtRest,
  encryptTotpSecret,
  maskSecretPreview,
} from "./util/totp.js";

export type {
  AdminUserSummaryRow,
  ArtifactViewRow,
  AuditLogRow,
  ContentReportRow,
  DmcaNoticeRow,
  LibraryReleaseRow,
  LinkedRepoRow,
  NotificationRow,
  PackageTransferRow,
  PostMetadata,
  PostRow,
  RemoteActorProfile,
  RemotePackageRow,
  RssFeedRow,
  SolutionReleaseRow,
  SolutionRow,
  UserArchiveData,
  UserFederationInfo,
  UserRow,
};

function resolveDefaultDbDir(): string {
  const envDir =
    process.env["DB_DIR"] ||
    process.env["DATA_DIR"] ||
    (process.env["DB_PATH"] ? path.dirname(process.env["DB_PATH"]) : undefined);
  if (envDir) {
    return envDir;
  }
  try {
    const repoRootData = path.resolve(import.meta.dirname, "../../../data");
    if (fs.existsSync(path.join(repoRootData, "modelscript.db"))) {
      return repoRootData;
    }
    const applianceData = "/app/apps/api/data";
    if (fs.existsSync(applianceData)) {
      return applianceData;
    }
  } catch {
    // fallback
  }
  return "data";
}

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
  post_count?: number | undefined;
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
  compute_profile?: string | null | undefined;
  cpu_seconds?: number | null | undefined;
  peak_memory_mb?: number | null | undefined;
  gpu_seconds?: number | null | undefined;
  cost_credits?: number | null | undefined;
  user_id?: number | null | undefined;
}

export interface CreditTransactionRow {
  id: number;
  user_id: number;
  job_id: number | null;
  amount: number;
  balance_after: number;
  type: string;
  transaction_type?: string | undefined;
  description: string;
  metadata?: string | null | undefined;
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
  profiles: ComputeProfile[];
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
  scalars?: Record<string, unknown> | undefined;
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
  username?: string | undefined;
  role: OrgRole;
  created_at: string;
}

export type CollaboratorPermission = "admin" | "write" | "read";

export interface PackageCollaboratorRecord {
  library_name: string;
  user_id: number;
  username?: string | undefined;
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

export interface RawAccountWarningRow {
  id: number;
  target_user_id: number;
  actor_id: number | null;
  action: AccountWarningRow["action"];
  text: string;
  report_id: number | null;
  rule_ids: string | number[];
  post_ids: string | number[];
  acknowledged_at: string | null;
  created_at: string;
  actor_username?: string | null;
  target_username?: string | null;
}

export interface RawContentFilterRow {
  id: number;
  user_id: number | null;
  title: string;
  context: string | ContentFilterRow["context"];
  filter_action: ContentFilterRow["filter_action"];
  keywords_json: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * SQLite-backed storage for Modelica class metadata.
 */
export class LibraryDatabase {
  readonly #db: Database.Database;
  readonly #dbPath: string;
  readonly #runner: SqliteMigrationRunner;
  #auditChainCache: {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    headHash: string | null;
    brokenAtId?: number | undefined;
    secretUsed?: string | undefined;
  } | null = null;
  #pendingBackupReplications = new Set<Promise<void>>();
  readonly referrals: ReferralRepository;
  readonly users: UserRepository;
  readonly packages: PackageRepository;
  readonly billing: BillingRepository;
  readonly analyticsBuffer: AnalyticsBuffer;

  constructor(dbDir?: string) {
    const dir = dbDir ?? resolveDefaultDbDir();
    const dbPath = dir.endsWith(".db") ? dir : path.join(dir, "modelscript.db");
    const parentDir = dir.endsWith(".db") ? path.dirname(dir) : dir;
    this.#dbPath = dbPath;

    // Ensure directory exists
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#db.pragma("synchronous = NORMAL");
    this.#db.pragma("temp_store = MEMORY");
    this.#db.pragma("mmap_size = 268435456"); // 256 MB memory-mapped I/O
    this.#db.pragma("cache_size = -64000"); // 64 MB RAM cache
    this.#db.pragma("foreign_keys = ON");
    this.#db.pragma("busy_timeout = 5000");
    this.#db.function("_msx_invalidate_audit_cache", () => {
      this.#auditChainCache = null;
      return 0;
    });
    this.#runner = new SqliteMigrationRunner(this.#db, dbPath);
    this.#runner.runPendingSync(allMigrations);
    this.#initialize();

    this.referrals = new ReferralRepository(this.#db, this);
    this.users = new UserRepository(this.#db, this);
    this.packages = new PackageRepository(this.#db, this);
    this.billing = new BillingRepository(this.#db, this);
    this.analyticsBuffer = new AnalyticsBuffer(this);
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
    this.analyticsBuffer?.clear();
    this.#auditChainCache = null;
    this.#db.exec("PRAGMA foreign_keys = OFF;");
    const rows = this.#db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];
    this.#db.transaction(() => {
      for (const { name } of rows) {
        const safeName = name.replace(/"/g, '""');
        this.#db.exec(`DROP TABLE IF EXISTS "${safeName}";`);
      }
    })();
    this.#runner.runPendingSync(allMigrations, { silent: true });
    this.#initialize();
    this.#db.exec("PRAGMA foreign_keys = ON;");
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
        avatar_url    TEXT DEFAULT '/default-avatar.svg',
        banner_url    TEXT DEFAULT '',
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
        onboarding_completed INTEGER DEFAULT 0,
        engineering_persona TEXT,
        invites_remaining INTEGER DEFAULT 5,
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
      CREATE INDEX IF NOT EXISTS idx_posts_repost ON posts(repost_of_id);
      CREATE INDEX IF NOT EXISTS idx_posts_quote ON posts(quote_post_id);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, state);

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
        metadata    TEXT,
        read        INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read);
      CREATE INDEX IF NOT EXISTS idx_notifs_type_user ON notifications(user_id, type, read);
      CREATE INDEX IF NOT EXISTS idx_notifs_post ON notifications(post_id);

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
      CREATE INDEX IF NOT EXISTS idx_post_topics_topic ON post_topics(topic_id);

      CREATE TABLE IF NOT EXISTS post_location_stats (
        post_id      INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        country_code TEXT NOT NULL,
        region_code  TEXT,
        view_count   INTEGER DEFAULT 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_post_location_stats ON post_location_stats(post_id, country_code, COALESCE(region_code, ''));

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

      CREATE TABLE IF NOT EXISTS stripe_processed_events (
        event_id          TEXT PRIMARY KEY,
        payment_intent_id TEXT UNIQUE,
        user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        amount_credits    REAL NOT NULL DEFAULT 0,
        processed_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_processed_pi ON stripe_processed_events(payment_intent_id);

      CREATE TABLE IF NOT EXISTS morsel_snippets (
        id           TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        dialect      TEXT NOT NULL DEFAULT 'modelica',
        title        TEXT,
        creator_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_morsel_snippets_created ON morsel_snippets(created_at);

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
        previous_commit TEXT,
        merged_commit   TEXT
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
        target_type     TEXT,
        target_resource_id TEXT,
        reason          TEXT NOT NULL,
        details         TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        resolution_notes TEXT,
        action_taken    TEXT,
        content_snapshot TEXT,
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
        prev_hash       TEXT,
        entry_hash      TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
      CREATE INDEX IF NOT EXISTS idx_dmca_notices_status ON dmca_notices(status);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

      CREATE TABLE IF NOT EXISTS pending_totp_secrets (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret     TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS instance_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS instance_invites (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        code            TEXT NOT NULL UNIQUE,
        created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        max_uses        INTEGER NOT NULL DEFAULT 1,
        used_count      INTEGER NOT NULL DEFAULT 0,
        initial_credits REAL NOT NULL DEFAULT 100.0,
        assigned_role   TEXT NOT NULL DEFAULT 'user',
        note            TEXT,
        expires_at      TEXT,
        revoked_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_instance_invites_code ON instance_invites(code);

      CREATE TABLE IF NOT EXISTS quarantined_resources (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type   TEXT NOT NULL,
        resource_id     TEXT NOT NULL,
        reason          TEXT NOT NULL,
        dmca_notice_id  INTEGER REFERENCES dmca_notices(id) ON DELETE SET NULL,
        quarantined_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'quarantined',
        counter_notice  TEXT,
        restore_after   TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        restored_at     TEXT,
        UNIQUE(resource_type, resource_id)
      );

      CREATE INDEX IF NOT EXISTS idx_quarantined_resources_status ON quarantined_resources(status);

      CREATE TABLE IF NOT EXISTS user_referrals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referee_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        invite_id       INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        reward_granted  INTEGER NOT NULL DEFAULT 0,
        reward_amount   REAL NOT NULL DEFAULT 0.0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referrer ON user_referrals(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referee ON user_referrals(referee_id);

      CREATE TABLE IF NOT EXISTS waitlist_submissions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        email           TEXT NOT NULL UNIQUE,
        full_name       TEXT,
        organization    TEXT,
        discipline      TEXT,
        portfolio_url   TEXT,
        statement       TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        invite_code_id  INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        ip_address      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_submissions(email);
    `);

    // Migrations
    try {
      this.#db.exec(`ALTER TABLE notifications ADD COLUMN metadata TEXT`);
    } catch {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN notification_settings TEXT DEFAULT '{}'`);
    } catch {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN credit_balance REAL DEFAULT 100.0`);
    } catch {
      // Column already exists
    }

    const userColumns = [
      "ALTER TABLE rss_feeds ADD COLUMN description TEXT",
      "ALTER TABLE rss_feeds ADD COLUMN etag TEXT",
      "ALTER TABLE rss_feeds ADD COLUMN last_modified TEXT",
      "ALTER TABLE rss_feeds ADD COLUMN poll_interval_mins INTEGER DEFAULT 15",
      "ALTER TABLE rss_feeds ADD COLUMN last_polled_at TEXT",
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
      "ALTER TABLE users ADD COLUMN bot_token_hash TEXT",
      "ALTER TABLE follows ADD COLUMN state TEXT DEFAULT 'accepted'",
      "ALTER TABLE linked_repos ADD COLUMN visibility TEXT DEFAULT 'public'",
      "ALTER TABLE linked_repos ADD COLUMN default_branch TEXT DEFAULT 'main'",
      "ALTER TABLE linked_repos ADD COLUMN social_preview_url TEXT",
      "ALTER TABLE content_reports ADD COLUMN action_taken TEXT",
      "ALTER TABLE content_reports ADD COLUMN content_snapshot TEXT",
      "ALTER TABLE content_reports ADD COLUMN target_type TEXT",
      "ALTER TABLE content_reports ADD COLUMN target_resource_id TEXT",
      "ALTER TABLE posts ADD COLUMN is_sensitive INTEGER DEFAULT 0",
      "ALTER TABLE posts ADD COLUMN content_warning TEXT",
      "ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT",
      "ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT",
    ];
    for (const sql of userColumns) {
      try {
        this.#db.exec(sql);
      } catch {
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
      } catch {
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
      } catch {
        // Column already exists
      }
    }

    try {
      const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
      const usersWithoutActorUrl = this.#db.prepare(`SELECT id, username FROM users WHERE actor_url IS NULL`).all() as {
        id: number;
        username: string;
      }[];
      if (usersWithoutActorUrl.length > 0) {
        const updateActorStmt = this.#db.prepare(
          `UPDATE users SET actor_url = ?, inbox_url = ?, outbox_url = ? WHERE id = ?`,
        );
        this.#db.transaction(() => {
          for (const u of usersWithoutActorUrl) {
            const actorUrl = `${publicUrl}/users/${u.username}`;
            updateActorStmt.run(actorUrl, `${actorUrl}/inbox`, `${actorUrl}/outbox`, u.id);
          }
        })();
      }

      const usersWithoutKeys = this.#db
        .prepare(`SELECT id, username FROM users WHERE rsa_private_key IS NULL LIMIT 5`)
        .all() as { id: number; username: string }[];
      const updateStmt = this.#db.prepare(
        `UPDATE users SET rsa_private_key = ?, rsa_public_key = ?, actor_url = COALESCE(actor_url, ?), inbox_url = COALESCE(inbox_url, ?), outbox_url = COALESCE(outbox_url, ?) WHERE id = ?`,
      );
      this.#db.transaction(() => {
        for (const u of usersWithoutKeys) {
          const keys = this.#generateRSAKeys();
          const actorUrl = `${publicUrl}/users/${u.username}`;
          updateStmt.run(keys.privateKey, keys.publicKey, actorUrl, `${actorUrl}/inbox`, `${actorUrl}/outbox`, u.id);
        }
      })();
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'user'`);
    } catch {
      // Column already exists
    }

    try {
      this.#db.exec(`
        UPDATE users 
        SET avatar_url = 'https://ui-avatars.com/api/?name=' || username || '&background=random&color=fff' 
        WHERE avatar_url IS NULL;
        
        UPDATE users 
        SET banner_url = '/banners/omar.png' 
        WHERE banner_url IS NULL OR banner_url = '';
      `);
    } catch {
      // Ignore migration errors
    }

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0`);
    } catch {
      // Column already exists
    }

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN ap_id TEXT UNIQUE`);
      this.#db.exec(`ALTER TABLE posts ADD COLUMN url TEXT`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN metadata TEXT`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN reply_visibility TEXT DEFAULT 'everyone'`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN access_token TEXT`);
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN refresh_token TEXT`);
      this.#db.exec(`ALTER TABLE oauth_accounts ADD COLUMN expires_at TEXT`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE jobs ADD COLUMN metadata TEXT`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE posts ADD COLUMN is_silenced INTEGER DEFAULT 0`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE packages ADD COLUMN quarantine_status TEXT DEFAULT 'clean'`);
      this.#db.exec(`ALTER TABLE packages ADD COLUMN is_quarantined INTEGER DEFAULT 0`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE users ADD COLUMN ed25519_public_key TEXT`);
      this.#db.exec(`ALTER TABLE users ADD COLUMN ed25519_private_key TEXT`);
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE artifact_views ADD COLUMN remote_origin_url TEXT`);
    } catch {}

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
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE sysml2_commits ADD COLUMN merged_commit TEXT`);
    } catch {}

    try {
      const usersWithoutEd = this.#db
        .prepare(`SELECT id FROM users WHERE ed25519_private_key IS NULL LIMIT 10`)
        .all() as {
        id: number;
      }[];
      const updateEdStmt = this.#db.prepare(
        `UPDATE users SET ed25519_private_key = ?, ed25519_public_key = ? WHERE id = ?`,
      );
      this.#db.transaction(() => {
        for (const u of usersWithoutEd) {
          const keys = this.#generateEd25519Keys();
          updateEdStmt.run(keys.privateKey, keys.publicKey, u.id);
        }
      })();
    } catch {}

    try {
      this.#db.exec(`ALTER TABLE organizations ADD COLUMN credit_balance REAL NOT NULL DEFAULT 0.0`);
    } catch {}
    try {
      this.#db.exec(`ALTER TABLE organizations ADD COLUMN total_spent REAL NOT NULL DEFAULT 0.0`);
    } catch {}
    try {
      this.#db.exec(`ALTER TABLE waitlist_submissions ADD COLUMN rejection_reason TEXT`);
    } catch {}
    try {
      this.#db.exec(`ALTER TABLE instance_invites ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0`);
    } catch {}
    try {
      this.#db.exec(`ALTER TABLE instance_invites ADD COLUMN uses_count INTEGER NOT NULL DEFAULT 0`);
    } catch {}
    try {
      this.#db.exec(`ALTER TABLE instance_invites ADD COLUMN revoked_at TEXT`);
    } catch {}
    try {
      this.#db.exec(`
        UPDATE instance_invites SET used_count = uses_count WHERE used_count = 0 AND uses_count > 0;
        UPDATE instance_invites SET uses_count = used_count WHERE uses_count = 0 AND used_count > 0;
      `);
    } catch {}
    try {
      this.#db.exec(`
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
    } catch {}
  }

  // ── User management ─────────────────────────────────────────────

  getUserTopics(userId: number): { concept: string; is_active: boolean }[] {
    return this.#db.prepare(`SELECT concept, is_active FROM user_topics WHERE user_id = ?`).all(userId) as {
      concept: string;
      is_active: boolean;
    }[];
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

  getOrCreateRemoteUser(actorUrl: string, profileData?: RemoteActorProfile): { id: number } {
    const existing = this.#db.prepare(`SELECT id FROM users WHERE actor_url = ?`).get(actorUrl) as
      | { id: number }
      | undefined;
    if (existing) {
      if (profileData) {
        this.updateRemoteActorProfile(actorUrl, profileData);
      }
      return existing;
    }

    // Use preferredUsername or fallback
    const username = profileData?.preferredUsername || actorUrl.split("/").pop();
    const domain = new URL(actorUrl).hostname;
    // Create a unique username for remote to avoid collision with local
    const remoteUsername = `${username}@${domain}`;

    const keys = this.#generateRSAKeys();
    const edKeys = this.#generateEd25519Keys();
    const sharedInbox =
      profileData?.endpoints?.sharedInbox || profileData?.sharedInbox || profileData?.endpoints?.shared_inbox || null;

    const discoverable = profileData?.["discoverable"] === false ? 0 : 1;
    const indexable = profileData?.["indexable"] === false ? 0 : 1;
    const locked = profileData?.["manuallyApprovesFollowers"] === true ? 1 : 0;
    const alsoKnownAs = Array.isArray(profileData?.["alsoKnownAs"]) ? JSON.stringify(profileData["alsoKnownAs"]) : "[]";
    const movedTo = typeof profileData?.["movedTo"] === "string" ? profileData["movedTo"] : null;
    const rawAttachments = Array.isArray(profileData?.["attachment"]) ? profileData["attachment"] : [];
    const profileFields: ProfileField[] = rawAttachments
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object" && a["type"] === "PropertyValue"))
      .map((a) => ({
        name: String(a["name"] || ""),
        value: String(a["value"] || ""),
        verified_at: typeof a["verified_at"] === "string" ? a["verified_at"] : null,
      }))
      .slice(0, 8);

    const result = this.#db
      .prepare(
        `INSERT INTO users (username, email, account_type, display_name, bio, avatar_url, rsa_private_key, rsa_public_key, ed25519_private_key, ed25519_public_key, actor_url, inbox_url, outbox_url, remote_domain, shared_inbox_url, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        remoteUsername,
        `remote-${crypto.randomUUID()}@${domain}`, // fake email for unique constraint
        "remote",
        profileData?.name || username,
        profileData?.summary || "",
        profileData?.icon?.url || "",
        keys.privateKey,
        keys.publicKey,
        edKeys.privateKey,
        edKeys.publicKey,
        actorUrl,
        profileData?.inbox || `${actorUrl}/inbox`,
        profileData?.outbox || `${actorUrl}/outbox`,
        domain,
        sharedInbox,
        discoverable,
        indexable,
        locked,
        alsoKnownAs,
        movedTo,
        JSON.stringify(profileFields),
      );
    return { id: Number(result.lastInsertRowid) };
  }

  updateRemoteActorProfile(actorUrl: string, profileData: RemoteActorProfile): boolean {
    const existing = this.#db.prepare(`SELECT id FROM users WHERE actor_url = ?`).get(actorUrl) as
      | { id: number }
      | undefined;
    if (!existing) return false;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (typeof profileData.name === "string") {
      updates.push("display_name = ?");
      params.push(profileData.name);
    }
    if (typeof profileData.summary === "string") {
      updates.push("bio = ?");
      params.push(profileData.summary);
    }
    if (profileData.icon?.url) {
      updates.push("avatar_url = ?");
      params.push(profileData.icon.url);
    }
    const imageObj = profileData["image"] as { url?: string } | undefined;
    if (imageObj?.url) {
      updates.push("banner_url = ?");
      params.push(imageObj.url);
    }
    if (typeof profileData.inbox === "string") {
      updates.push("inbox_url = ?");
      params.push(profileData.inbox);
    }
    const sharedInbox =
      profileData.endpoints?.sharedInbox || profileData.sharedInbox || profileData.endpoints?.shared_inbox;
    if (typeof sharedInbox === "string") {
      updates.push("shared_inbox_url = ?");
      params.push(sharedInbox);
    }
    if (typeof profileData["discoverable"] === "boolean") {
      updates.push("discoverable = ?");
      params.push(profileData["discoverable"] ? 1 : 0);
    }
    if (typeof profileData["indexable"] === "boolean") {
      updates.push("indexable = ?");
      params.push(profileData["indexable"] ? 1 : 0);
    }
    if (typeof profileData["manuallyApprovesFollowers"] === "boolean") {
      updates.push("locked = ?");
      params.push(profileData["manuallyApprovesFollowers"] ? 1 : 0);
    }
    if (Array.isArray(profileData["alsoKnownAs"])) {
      updates.push("also_known_as = ?");
      params.push(JSON.stringify(profileData["alsoKnownAs"].map(String)));
    }
    if (typeof profileData["movedTo"] === "string") {
      updates.push("moved_to_actor_url = ?");
      params.push(profileData["movedTo"]);
    }
    if (Array.isArray(profileData["attachment"])) {
      const profileFields: ProfileField[] = profileData["attachment"]
        .filter((a): a is Record<string, unknown> =>
          Boolean(a && typeof a === "object" && a["type"] === "PropertyValue"),
        )
        .map((a) => ({
          name: String(a["name"] || ""),
          value: String(a["value"] || ""),
          verified_at: typeof a["verified_at"] === "string" ? a["verified_at"] : null,
        }))
        .slice(0, 8);
      updates.push("profile_fields = ?");
      params.push(JSON.stringify(profileFields));
    }
    const pubKeyObj = profileData["publicKey"] as { publicKeyPem?: string } | undefined;
    if (typeof pubKeyObj?.publicKeyPem === "string") {
      updates.push("rsa_public_key = ?");
      params.push(pubKeyObj.publicKeyPem);
    }

    if (updates.length === 0) return false;
    params.push(existing.id);
    const res = this.#db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return res.changes > 0;
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
    const existing = this.#db.prepare(`SELECT value FROM settings WHERE key = 'instance_keys'`).get() as
      | { value: string }
      | undefined;
    if (existing) {
      return JSON.parse(existing.value) as { publicKey: string; privateKey: string };
    }
    const keys = this.#generateRSAKeys();
    this.#db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run("instance_keys", JSON.stringify(keys));
    return keys;
  }

  getInstanceEd25519Keys(): { publicKey: string; privateKey: string } {
    const existing = this.#db.prepare(`SELECT value FROM settings WHERE key = 'instance_ed25519_keys'`).get() as
      | { value: string }
      | undefined;
    if (existing) {
      return JSON.parse(existing.value) as { publicKey: string; privateKey: string };
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
      emailVerified?: boolean | undefined;
      initialCredits?: number | undefined;
      termsAcceptedAt?: string | undefined;
      registrationIp?: string | undefined;
      status?: string | undefined;
      accountType?: string | undefined;
    },
  ): {
    id: number;
    username: string;
    email: string;
    account_type?: string | undefined;
    email_verified?: number | undefined;
    status?: string | undefined;
    token_version?: number | undefined;
  } {
    const avatarUrl = "";
    const bannerUrl = "";

    const edKeys = this.#generateEd25519Keys();
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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

  verifyUserEmail(
    userId: number,
    bonusCredits = 50.0,
  ): { success: boolean; creditsGranted: number; user?: UserRow | undefined } {
    const user = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
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
      .prepare(
        `UPDATE users
         SET email_verified = 1,
             status = CASE WHEN status IN ('suspended', 'banned', 'frozen', 'suspended_dispute', 'deleted') THEN status ELSE 'active' END,
             credit_balance = ?
         WHERE id = ?`,
      )
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

    const updatedUser = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
    return { success: true, creditsGranted: creditsToGrant, user: updatedUser };
  }

  setUserEmailVerified(userId: number, verified: boolean): void {
    this.#db.prepare(`UPDATE users SET email_verified = ? WHERE id = ?`).run(verified ? 1 : 0, userId);
  }

  freezeUserForDispute(userId: number, reason: string): { success: boolean; previousBalance: number } {
    const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
      | { credit_balance?: number | undefined }
      | undefined;
    if (!user) {
      return { success: false, previousBalance: 0 };
    }

    const previousBalance = Math.round((user.credit_balance || 0) * 100) / 100;

    this.#db
      .prepare(
        `UPDATE users SET credit_balance = 0.0, status = 'suspended_dispute', token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`,
      )
      .run(userId);

    try {
      this.#db
        .prepare(
          `UPDATE credit_escrow_holds SET status = 'frozen_dispute', settled_at = datetime('now') WHERE user_id = ? AND status = 'held'`,
        )
        .run(userId);
    } catch {
      // ignore
    }

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

    try {
      this.logAudit({
        actorId: userId,
        action: "user_dispute_frozen",
        resourceType: "user",
        resourceId: String(userId),
        details: { reason, previousBalance },
      });
    } catch {
      // ignore
    }

    return { success: true, previousBalance };
  }

  /**
   * GDPR Article 17: Right to Erasure / Account Anonymization
   * Redacts personal data, deletes session tokens and social links, and flags account as deleted.
   */
  anonymizeUser(userId: number): { success: boolean; actorUrl?: string | undefined } {
    const user = this.#db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as UserRow | undefined;
    if (!user) {
      return { success: false };
    }

    const actorUrl = user.actor_url ?? undefined;
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
               credit_balance = 0,
               token_version = COALESCE(token_version, 1) + 1,
               totp_secret = NULL,
               totp_enabled = 0,
               backup_codes = NULL,
               rsa_private_key = NULL,
               rsa_public_key = NULL,
               ed25519_private_key = NULL,
               ed25519_public_key = NULL
           WHERE id = ?`,
        )
        .run(redactedEmail, redactedName, redactedBio, userId);

      try {
        this.#db.prepare(`DELETE FROM users WHERE owner_id = ? AND account_type = 'bot'`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM api_tokens WHERE user_id = ?`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM pending_totp_secrets WHERE user_id = ?`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM oauth_accounts WHERE user_id = ?`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM user_public_keys WHERE user_id = ?`).run(userId);
      } catch {}

      try {
        this.#db.prepare(`DELETE FROM bookmarks WHERE user_id = ?`).run(userId);
        this.#db.prepare(`DELETE FROM likes WHERE user_id = ?`).run(userId);
        this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? OR following_id = ?`).run(userId, userId);
        this.#db.prepare(`DELETE FROM notifications WHERE user_id = ? OR actor_id = ?`).run(userId, userId);
        this.#db.prepare(`DELETE FROM user_mutes WHERE muter_id = ? OR muted_id = ?`).run(userId, userId);
        this.#db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?`).run(userId, userId);
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
      .get(userId) as UserRow | undefined;
    if (!user) return null;

    let posts: Record<string, unknown>[] = [];
    try {
      posts = this.#db.prepare(`SELECT id, content, created_at FROM posts WHERE author_id = ?`).all(userId) as Record<
        string,
        unknown
      >[];
    } catch {}

    let libraries: Record<string, unknown>[] = [];
    try {
      libraries = this.#db
        .prepare(
          `SELECT p.name, pv.version, pv.published_at as created_at
           FROM package_versions pv
           JOIN packages p ON pv.package_id = p.id
           WHERE pv.published_by = ?`,
        )
        .all(userId) as Record<string, unknown>[];
    } catch {}

    let transactions: Record<string, unknown>[] = [];
    try {
      transactions = this.#db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as Record<string, unknown>[];
    } catch {}

    let auditHistory: Record<string, unknown>[] = [];
    try {
      auditHistory = this.#db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 100`,
        )
        .all(userId) as Record<string, unknown>[];
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
    scopes: string = "social:read,social:write",
    systemPrompt: string = "",
    model: string = "gemini-1.5-flash",
    apiKey: string = "",
    endpointUrl: string = "",
  ): { id: number; username: string } {
    const email = `${username}@bots.modelscript.org`; // dummy email for bots
    const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

    const keys = this.#generateRSAKeys();
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    const actorUrl = `${publicUrl}/users/${username}`;
    const inboxUrl = `${actorUrl}/inbox`;
    const outboxUrl = `${actorUrl}/outbox`;

    const result = this.#db
      .prepare(
        `INSERT INTO users (username, email, display_name, bio, avatar_url, banner_url, account_type, owner_id, bot_token_hash, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, rsa_private_key, rsa_public_key, actor_url, inbox_url, outbox_url) VALUES (?, ?, ?, ?, ?, ?, 'bot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        scopes,
        systemPrompt,
        model,
        apiKey,
        endpointUrl,
        keys.privateKey,
        keys.publicKey,
        actorUrl,
        inboxUrl,
        outboxUrl,
      );
    return { id: result.lastInsertRowid as number, username };
  }

  getUserBots(ownerId: number): {
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes?: string | undefined;
    bot_system_prompt?: string | undefined;
    bot_model?: string | undefined;
    bot_api_key?: string | undefined;
    bot_endpoint_url?: string | undefined;
    bot_last_used_at?: string | undefined;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT id, username, display_name, avatar_url, bio, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, bot_last_used_at, created_at FROM users WHERE owner_id = ? AND account_type = 'bot' ORDER BY created_at DESC`,
      )
      .all(ownerId) as {
      id: number;
      username: string;
      display_name: string;
      avatar_url: string;
      bio: string;
      bot_scopes?: string | undefined;
      bot_system_prompt?: string | undefined;
      bot_model?: string | undefined;
      bot_api_key?: string | undefined;
      bot_endpoint_url?: string | undefined;
      bot_last_used_at?: string | undefined;
      created_at: string;
    }[];
  }

  getBotById(botId: number): {
    id: number;
    owner_id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes: string;
    bot_system_prompt: string;
    bot_model: string;
    bot_api_key: string | null;
    bot_endpoint_url: string | null;
    bot_last_used_at: string | null;
  } | null {
    const row = this.#db
      .prepare(
        `SELECT id, owner_id, username, display_name, avatar_url, bio, bot_scopes, bot_system_prompt, bot_model, bot_api_key, bot_endpoint_url, bot_last_used_at FROM users WHERE id = ? AND account_type = 'bot'`,
      )
      .get(botId) as
      | {
          id: number;
          owner_id: number;
          username: string;
          display_name: string;
          avatar_url: string;
          bio: string;
          bot_scopes: string;
          bot_system_prompt: string;
          bot_model: string;
          bot_api_key: string | null;
          bot_endpoint_url: string | null;
          bot_last_used_at: string | null;
        }
      | undefined;
    return row || null;
  }

  updateBotSettings(
    ownerId: number,
    botId: number,
    updates: {
      displayName?: string | undefined;
      bio?: string | undefined;
      avatarUrl?: string | undefined;
      scopes?: string | undefined;
      systemPrompt?: string | undefined;
      model?: string | undefined;
      apiKey?: string | undefined;
      endpointUrl?: string | undefined;
    },
  ): void {
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (updates.displayName !== undefined) {
      fields.push("display_name = ?");
      values.push(updates.displayName);
    }
    if (updates.bio !== undefined) {
      fields.push("bio = ?");
      values.push(updates.bio);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(updates.avatarUrl);
    }
    if (updates.scopes !== undefined) {
      fields.push("bot_scopes = ?");
      values.push(updates.scopes);
    }
    if (updates.systemPrompt !== undefined) {
      fields.push("bot_system_prompt = ?");
      values.push(updates.systemPrompt);
    }
    if (updates.model !== undefined) {
      fields.push("bot_model = ?");
      values.push(updates.model);
    }
    if (updates.apiKey !== undefined) {
      fields.push("bot_api_key = ?");
      values.push(updates.apiKey);
    }
    if (updates.endpointUrl !== undefined) {
      fields.push("bot_endpoint_url = ?");
      values.push(updates.endpointUrl);
    }
    if (fields.length === 0) return;
    values.push(botId, ownerId);
    this.#db
      .prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ? AND owner_id = ? AND account_type = 'bot'`)
      .run(...values);
  }

  touchBotLastUsed(botId: number): void {
    this.#db
      .prepare(`UPDATE users SET bot_last_used_at = datetime('now') WHERE id = ? AND account_type = 'bot'`)
      .run(botId);
  }

  deleteBot(ownerId: number, botId: number): void {
    this.#db.prepare(`DELETE FROM users WHERE id = ? AND owner_id = ? AND account_type = 'bot'`).run(botId, ownerId);
  }

  getUserByBotTokenHash(tokenHash: string): {
    id: number;
    owner_id: number;
    username: string;
    email: string;
    account_type: string;
    bot_scopes: string;
    status?: string | undefined;
  } | null {
    const row = this.#db
      .prepare(
        `SELECT id, owner_id, username, email, account_type, bot_scopes, status FROM users WHERE bot_token_hash = ? AND account_type = 'bot'`,
      )
      .get(tokenHash) as
      | {
          id: number;
          owner_id: number;
          username: string;
          email: string;
          account_type: string;
          bot_scopes: string;
          status?: string | undefined;
        }
      | undefined;
    return row || null;
  }

  /* ── Bot Mention Queue Operations ── */
  enqueueBotMention(botId: number, postId: number, authorId: number): number {
    const result = this.#db
      .prepare(`INSERT INTO bot_mention_queue (bot_id, post_id, author_id, status) VALUES (?, ?, ?, 'pending')`)
      .run(botId, postId, authorId);
    return result.lastInsertRowid as number;
  }

  getPendingBotMentions(limit: number = 10): {
    id: number;
    bot_id: number;
    post_id: number;
    author_id: number;
    status: string;
    attempts: number;
    error: string | null;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT id, bot_id, post_id, author_id, status, attempts, error, created_at FROM bot_mention_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      bot_id: number;
      post_id: number;
      author_id: number;
      status: string;
      attempts: number;
      error: string | null;
      created_at: string;
    }[];
  }

  updateBotMentionStatus(
    queueId: number,
    status: "processing" | "completed" | "failed",
    options?: { error?: string | undefined; responsePostId?: number | undefined },
  ): void {
    if (status === "processing") {
      this.#db
        .prepare(
          `UPDATE bot_mention_queue SET status = 'processing', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(queueId);
    } else if (status === "completed") {
      this.#db
        .prepare(
          `UPDATE bot_mention_queue SET status = 'completed', response_post_id = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(options?.responsePostId ?? null, queueId);
    } else if (status === "failed") {
      this.#db
        .prepare(`UPDATE bot_mention_queue SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(options?.error ?? "Unknown error", queueId);
    }
  }

  registerFederatedUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    const transaction = this.#db.transaction(() => {
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=fff`;
      const bannerUrl = `https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80`;

      const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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

  createOAuthUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    return this.registerFederatedUser(username, email, provider, providerUserId);
  }

  getOAuthAccount(
    provider: string,
    providerUserId: string,
  ):
    | {
        user_id: number;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
      )
      .get(provider, providerUserId) as
      | {
          user_id: number;
          access_token?: string | undefined;
          refresh_token?: string | undefined;
          expires_at?: string | undefined;
        }
      | undefined;
  }

  getOAuthAccountByUserId(
    userId: number,
    provider: string,
  ):
    | {
        provider_user_id: string;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT provider_user_id, access_token, refresh_token, expires_at FROM oauth_accounts WHERE user_id = ? AND provider = ?`,
      )
      .get(userId, provider) as
      | {
          provider_user_id: string;
          access_token?: string | undefined;
          refresh_token?: string | undefined;
          expires_at?: string | undefined;
        }
      | undefined;
  }

  getPublicOAuthAccounts(userId: number): { provider: string; provider_user_id: string }[] {
    return this.#db.prepare(`SELECT provider, provider_user_id FROM oauth_accounts WHERE user_id = ?`).all(userId) as {
      provider: string;
      provider_user_id: string;
    }[];
  }

  updateOAuthTokens(
    userId: number,
    provider: string,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: string | null,
  ) {
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
    accessToken?: string | null,
    refreshToken?: string | null,
    expiresAt?: string | null,
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

  getUserByEmail(email: string): UserRow | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE email = ?`,
      )
      .get(email) as UserRow | undefined;
  }

  getUserByUsername(username: string): UserRow | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE username = ?`,
      )
      .get(username) as UserRow | undefined;
  }

  getUserById(id: number): UserRow | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, password_hash, account_type, avatar_url, banner_url, display_name, bio, email_verified, status, credit_balance, token_version, totp_enabled, totp_secret, backup_codes, actor_url, inbox_url, outbox_url, remote_domain, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE id = ?`,
      )
      .get(id) as UserRow | undefined;
  }

  getUserByActorUrl(actorUrl: string): UserRow | undefined {
    return this.#db
      .prepare(
        `SELECT id, username, email, account_type, avatar_url, banner_url, display_name, bio, status, actor_url, inbox_url, outbox_url, remote_domain, rsa_public_key, ed25519_public_key, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE actor_url = ?`,
      )
      .get(actorUrl) as UserRow | undefined;
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
    const user = this.#db.prepare(`SELECT rsa_private_key, rsa_public_key FROM users WHERE id = ?`).get(userId) as
      | { rsa_private_key?: string | null | undefined; rsa_public_key?: string | null | undefined }
      | undefined;
    if (user?.rsa_private_key && user?.rsa_public_key) {
      return { privateKey: user.rsa_private_key, publicKey: user.rsa_public_key };
    }
    const keys = this.#generateRSAKeys();
    this.#db
      .prepare(`UPDATE users SET rsa_private_key = ?, rsa_public_key = ? WHERE id = ?`)
      .run(keys.privateKey, keys.publicKey, userId);
    return keys;
  }

  getUserFederationInfo(userId: number): UserFederationInfo | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, actor_url, inbox_url, outbox_url, remote_domain, rsa_public_key, rsa_private_key, ed25519_public_key, ed25519_private_key, discoverable, indexable, locked, also_known_as, moved_to_actor_url, profile_fields, default_post_visibility FROM users WHERE id = ?`,
      )
      .get(userId) as UserFederationInfo | undefined;
    if (!row) return undefined;
    if (!row.rsa_private_key || !row.rsa_public_key) {
      const keys = this.ensureUserRSAKeys(userId);
      row.rsa_private_key = keys.privateKey;
      row.rsa_public_key = keys.publicKey;
    }
    return row;
  }

  getRemoteFollowersInboxes(authorId: number): {
    inbox_url: string;
    shared_inbox_url?: string | null | undefined;
    remote_domain?: string | null | undefined;
  }[] {
    return this.#db
      .prepare(
        `SELECT u.inbox_url, u.shared_inbox_url, u.remote_domain FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ? AND u.remote_domain IS NOT NULL AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(authorId) as {
      inbox_url: string;
      shared_inbox_url?: string | null | undefined;
      remote_domain?: string | null | undefined;
    }[];
  }

  getTotalUsersCount(): number {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
    return row?.count ?? 0;
  }

  getAllUsers(): {
    id: number;
    username: string;
    email: string;
    display_name?: string | undefined;
    account_type: string;
    status: string;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT id, username, email, display_name, account_type, status, created_at FROM users WHERE status != 'deleted' ORDER BY id ASC`,
      )
      .all() as {
      id: number;
      username: string;
      email: string;
      display_name?: string | undefined;
      account_type: string;
      status: string;
      created_at: string;
    }[];
  }

  getTotalPostsCount(): number {
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM posts`).get() as { count: number };
    return row?.count ?? 0;
  }

  setUserCreditBalance(userId: number, balance: number): void {
    this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(balance, userId);
  }

  getFullProfileByUsername(username: string): UserRow | undefined {
    return this.#db
      .prepare(
        `
      SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url, u.banner_url, u.location, u.website, u.created_at, u.account_type, u.owner_id,
        u.actor_url, u.remote_domain,
        COALESCE(u.discoverable, 1) as discoverable,
        COALESCE(u.indexable, 1) as indexable,
        COALESCE(u.locked, 0) as locked,
        COALESCE(u.also_known_as, '[]') as also_known_as,
        u.moved_to_actor_url,
        COALESCE(u.profile_fields, '[]') as profile_fields,
        COALESCE(u.default_post_visibility, 'public') as default_post_visibility,
        (SELECT username FROM users WHERE id = u.owner_id) as owner_username,
        (SELECT COUNT(*) FROM follows WHERE following_id = u.id AND (state = 'accepted' OR state IS NULL)) as follower_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = u.id AND (state = 'accepted' OR state IS NULL)) as following_count,
        (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
      FROM users u WHERE u.username = ?
    `,
      )
      .get(username) as UserRow | undefined;
  }

  updateProfile(
    userId: number,
    profile: {
      display_name?: string | undefined;
      bio?: string | undefined;
      location?: string | undefined;
      website?: string | undefined;
      avatar_url?: string | undefined;
      banner_url?: string | undefined;
      discoverable?: boolean | number | undefined;
      indexable?: boolean | number | undefined;
      locked?: boolean | number | undefined;
      also_known_as?: string | string[] | undefined;
      moved_to_actor_url?: string | null | undefined;
      profile_fields?: string | ProfileField[] | undefined;
      default_post_visibility?: PostVisibility | string | undefined;
    },
  ) {
    const ALLOWED_PROFILE_COLUMNS = new Set([
      "display_name",
      "bio",
      "location",
      "website",
      "avatar_url",
      "banner_url",
      "discoverable",
      "indexable",
      "locked",
      "also_known_as",
      "moved_to_actor_url",
      "profile_fields",
      "default_post_visibility",
    ]);
    const fields = Object.entries(profile).filter(([k, v]) => ALLOWED_PROFILE_COLUMNS.has(k) && v !== undefined);
    if (fields.length === 0) return;
    const setClause = fields.map(([k]) => `${k} = ?`).join(", ");
    const values = fields.map(([k, v]) => {
      if (k === "discoverable" || k === "indexable" || k === "locked") {
        return v ? 1 : 0;
      }
      if ((k === "also_known_as" || k === "profile_fields") && typeof v !== "string") {
        return JSON.stringify(v);
      }
      return v;
    });
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

  setPendingTotpSecret(userId: number, secret: string, expiresAt: number): void {
    const encrypted = encryptTotpSecret(secret);
    this.#db
      .prepare(`INSERT OR REPLACE INTO pending_totp_secrets (user_id, secret, expires_at) VALUES (?, ?, ?)`)
      .run(userId, encrypted, expiresAt);
  }

  getPendingTotpSecret(userId: number): string | undefined {
    const row = this.#db
      .prepare(`SELECT secret, expires_at FROM pending_totp_secrets WHERE user_id = ?`)
      .get(userId) as { secret: string; expires_at: number } | undefined;
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.deletePendingTotpSecret(userId);
      return undefined;
    }
    try {
      return decryptTotpSecret(row.secret);
    } catch {
      return row.secret;
    }
  }

  deletePendingTotpSecret(userId: number): void {
    this.#db.prepare(`DELETE FROM pending_totp_secrets WHERE user_id = ?`).run(userId);
  }

  enableUser2FA(userId: number, secret: string, hashedBackupCodes: string[]): void {
    const encrypted = encryptTotpSecret(secret);
    this.#db
      .prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 1, backup_codes = ? WHERE id = ?`)
      .run(encrypted, JSON.stringify(hashedBackupCodes), userId);
    this.deletePendingTotpSecret(userId);
  }

  disableUser2FA(userId: number): void {
    this.#db
      .prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, backup_codes = '[]' WHERE id = ?`)
      .run(userId);
    this.deletePendingTotpSecret(userId);
  }

  setUserBackupCodes(userId: number, hashedBackupCodes: string[]): void {
    this.#db.prepare(`UPDATE users SET backup_codes = ? WHERE id = ?`).run(JSON.stringify(hashedBackupCodes), userId);
  }

  getRemainingBackupCodeCount(userId: number): number {
    const state = this.getUser2FAState(userId);
    return state?.backup_codes?.length ?? 0;
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
      .get(userId) as
      | {
          totp_enabled?: number | undefined;
          totp_secret?: string | null | undefined;
          backup_codes?: string | undefined;
        }
      | undefined;
    if (!row) return undefined;
    let backupCodes: string[] = [];
    try {
      if (row.backup_codes) {
        backupCodes = JSON.parse(row.backup_codes) as string[];
      }
    } catch {
      backupCodes = [];
    }
    let plainSecret: string | null = row.totp_secret ?? null;
    if (plainSecret) {
      try {
        plainSecret = decryptTotpSecret(plainSecret);
      } catch {
        // Fallback to raw value if decryption fails
      }
    }
    return {
      totp_enabled: row.totp_enabled ?? 0,
      totp_secret: plainSecret,
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
        .prepare(
          `INSERT INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)
           ON CONFLICT(follower_id, following_id) DO UPDATE SET state = excluded.state`,
        )
        .run(followerId, followingId, state);
    } catch {
      // ignore unique constraint
    }
  }

  unfollowUser(followerId: number, followingId: number) {
    this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`).run(followerId, followingId);
  }

  isFollowing(followerId: number, followingId: number): boolean {
    const res = this.#db
      .prepare(
        `SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND (state = 'accepted' OR state IS NULL)`,
      )
      .get(followerId, followingId);
    return !!res;
  }

  hasPendingFollowRequest(followerId: number, followingId: number): boolean {
    const res = this.#db
      .prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ? AND state = 'pending'`)
      .get(followerId, followingId);
    return !!res;
  }

  getUserFollowers(userId: number, currentUserId?: number): UserRow[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain, u.inbox_url,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id AND (state = 'accepted' OR state IS NULL)) as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain, u.inbox_url,
          0 as is_following
        FROM follows f
        JOIN users u ON f.follower_id = u.id
        WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as UserRow[])
      : (this.#db.prepare(query).all(userId) as UserRow[]);
  }

  getUserFollowing(userId: number, currentUserId?: number): UserRow[] {
    const query = currentUserId
      ? `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain,
          EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id AND (state = 'accepted' OR state IS NULL)) as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `
      : `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio, u.account_type, u.actor_url, u.remote_domain,
          0 as is_following
        FROM follows f
        JOIN users u ON f.following_id = u.id
        WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
        ORDER BY f.created_at DESC
      `;
    return currentUserId
      ? (this.#db.prepare(query).all(currentUserId, userId) as UserRow[])
      : (this.#db.prepare(query).all(userId) as UserRow[]);
  }

  getUserSuggestions(userId?: number, limit: number = 3): UserRow[] {
    if (userId) {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        WHERE u.id != ?
          AND COALESCE(u.discoverable, 1) = 1
          AND COALESCE(u.status, 'active') = 'active'
          AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(userId, userId, limit) as UserRow[];
    } else {
      return this.#db
        .prepare(
          `
        SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio
        FROM users u
        WHERE COALESCE(u.discoverable, 1) = 1
          AND COALESCE(u.status, 'active') = 'active'
        ORDER BY RANDOM() LIMIT ?
      `,
        )
        .all(limit) as UserRow[];
    }
  }

  // ── Public Keys ─────────────────────────────────────────────────

  getPublicKeysForUser(userId: number): {
    id: number;
    key_id_string: string;
    public_key_pem: string;
    device_name: string | null;
    created_at: string;
    is_active: number;
  }[] {
    return this.#db
      .prepare(
        `SELECT id, key_id_string, public_key_pem, device_name, created_at, is_active FROM user_public_keys WHERE user_id = ? AND is_active = 1`,
      )
      .all(userId) as {
      id: number;
      key_id_string: string;
      public_key_pem: string;
      device_name: string | null;
      created_at: string;
      is_active: number;
    }[];
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
    metadata?: PostMetadata | string | null,
    replyVisibility?: string,
    isSilenced?: boolean | number,
    isSensitiveOrVisibility?: boolean | number | PostVisibility | string,
    contentWarning?: string | null,
    visibility?: PostVisibility | string,
  ): {
    id: number;
    visibility: PostVisibility;
    autoFiltered?: boolean;
    autoFilterAction?: string;
    is_sensitive?: number;
    content_warning?: string | null;
  } {
    const resolvedVisibilityArg =
      visibility ?? (typeof isSensitiveOrVisibility === "string" ? isSensitiveOrVisibility : undefined);
    const resolvedIsSensitive =
      typeof isSensitiveOrVisibility === "boolean" || typeof isSensitiveOrVisibility === "number"
        ? isSensitiveOrVisibility
          ? 1
          : 0
        : contentWarning
          ? 1
          : 0;
    let effectiveVisibility: PostVisibility = "public";
    if (
      resolvedVisibilityArg === "public" ||
      resolvedVisibilityArg === "unlisted" ||
      resolvedVisibilityArg === "followers" ||
      resolvedVisibilityArg === "direct"
    ) {
      effectiveVisibility = resolvedVisibilityArg;
    } else {
      try {
        const userVis = this.#db.prepare(`SELECT default_post_visibility FROM users WHERE id = ?`).get(authorId) as
          | { default_post_visibility?: string | null }
          | undefined;
        const dv = userVis?.default_post_visibility;
        if (dv === "public" || dv === "unlisted" || dv === "followers" || dv === "direct") {
          effectiveVisibility = dv;
        }
      } catch {
        effectiveVisibility = "public";
      }
    }

    const res = this.#db
      .prepare(
        `
      INSERT INTO posts (author_id, content, artifact_view_id, reply_to_id, quote_post_id, repost_of_id, ap_id, url, metadata, visibility, reply_visibility, is_silenced, is_sensitive, content_warning, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'everyone'), ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
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
        effectiveVisibility,
        replyVisibility ?? "everyone",
        isSilenced ? 1 : 0,
        resolvedIsSensitive,
        contentWarning ?? null,
        createdAt ?? null,
        updatedAt ?? null,
      );
    const postId = Number(res.lastInsertRowid);

    if (content && content.trim().length > 0) {
      try {
        const settings = this.getInstanceSettings();
        if (settings.autoFilterKeywords.length > 0) {
          const lowerContent = content.toLowerCase();
          let matchedTerm: string | null = null;
          for (const rawPattern of settings.autoFilterKeywords) {
            const term = rawPattern.trim();
            if (!term) continue;
            const regexMatch = term.match(/^\/(.+)\/([gimsuy]*)$/);
            if (regexMatch) {
              try {
                const re = new RegExp(regexMatch[1]!, regexMatch[2] || "i");
                if (re.test(content)) {
                  matchedTerm = term;
                  break;
                }
              } catch {
                // fallback to literal match
              }
            }
            if (lowerContent.includes(term.toLowerCase())) {
              matchedTerm = term;
              break;
            }
          }

          if (matchedTerm) {
            const action = settings.autoFilterAction;
            let cwText: string | null = null;
            let isSensitive = 0;
            if (action === "silence") {
              this.silencePost(postId, true);
            } else if (action === "quarantine") {
              this.quarantineResource({
                resourceType: "post",
                resourceId: String(postId),
                reason: `Automated filter match: '${matchedTerm}'`,
              });
              cwText = `Automated filter match: '${matchedTerm}'`;
              isSensitive = 1;
              this.markPostSensitive(postId, true, cwText);
            } else {
              cwText = `Automated filter match: '${matchedTerm}'`;
              isSensitive = 1;
              this.markPostSensitive(postId, true, cwText);
            }
            return {
              id: postId,
              autoFiltered: true,
              autoFilterAction: action,
              is_sensitive: isSensitive,
              content_warning: cwText,
              visibility: effectiveVisibility,
            };
          }
        }
      } catch {
        // Non-fatal if settings table not initialized in isolated unit test
      }
    }

    return { id: postId, visibility: effectiveVisibility };
  }

  updatePostArtifactViewId(postId: number, artifactViewId: number) {
    this.#db.prepare(`UPDATE posts SET artifact_view_id = ? WHERE id = ?`).run(artifactViewId, postId);
  }

  updatePost(
    postId: number,
    updates: {
      content?: string | null | undefined;
      artifactViewId?: number | null | undefined;
      metadata?: PostMetadata | string | null | undefined;
      replyVisibility?: string | undefined;
    },
  ): void {
    const existing = this.#db
      .prepare(`SELECT content, artifact_view_id, metadata, reply_visibility FROM posts WHERE id = ?`)
      .get(postId) as
      | {
          content: string | null;
          artifact_view_id: number | null;
          metadata: string | null;
          reply_visibility: string;
        }
      | undefined;
    if (!existing) return;

    const nextContent = updates.content !== undefined ? updates.content : existing.content;
    const nextArtifactViewId =
      updates.artifactViewId !== undefined ? updates.artifactViewId : existing.artifact_view_id;
    const nextMetadata =
      updates.metadata !== undefined
        ? typeof updates.metadata === "string"
          ? updates.metadata
          : JSON.stringify(updates.metadata)
        : existing.metadata;
    const nextReplyVisibility =
      updates.replyVisibility !== undefined ? updates.replyVisibility : existing.reply_visibility;

    this.#db
      .prepare(
        `UPDATE posts
         SET content = ?, artifact_view_id = ?, metadata = ?, reply_visibility = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextContent ?? null, nextArtifactViewId ?? null, nextMetadata ?? null, nextReplyVisibility, postId);
  }

  flushAnalyticsBatch(batch: BatchAnalyticsPayload): void {
    if (
      batch.postViews.length === 0 &&
      batch.postLocationViews.length === 0 &&
      batch.pageViews.length === 0 &&
      batch.pageLocationViews.length === 0 &&
      batch.packageDownloads.length === 0
    ) {
      return;
    }

    const tx = this.#db.transaction(() => {
      const postExistsStmt = this.#db.prepare(`SELECT 1 FROM posts WHERE id = ?`);

      if (batch.postViews.length > 0) {
        const stmt = this.#db.prepare(`UPDATE posts SET view_count = view_count + ? WHERE id = ?`);
        for (const [postId, delta] of batch.postViews) {
          if (!postExistsStmt.get(postId)) continue;
          stmt.run(delta, postId);
        }
      }

      if (batch.postLocationViews.length > 0) {
        const stmt = this.#db.prepare(`
          INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(post_id, country_code, COALESCE(region_code, ''))
          DO UPDATE SET view_count = post_location_stats.view_count + excluded.view_count
        `);
        for (const item of batch.postLocationViews) {
          if (!postExistsStmt.get(item.postId)) continue;
          stmt.run(item.postId, item.countryCode, item.regionCode, item.count);
        }
      }

      if (batch.pageViews.length > 0) {
        const stmt = this.#db.prepare(`
          INSERT INTO page_views_daily (view_date, surface, path, views_count, unique_visitors)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(view_date, surface, path) DO UPDATE SET
            views_count = page_views_daily.views_count + excluded.views_count,
            unique_visitors = page_views_daily.unique_visitors + excluded.unique_visitors
        `);
        for (const item of batch.pageViews) {
          stmt.run(item.viewDate, item.surface, item.path, item.views, item.uniques);
        }
      }

      if (batch.pageLocationViews.length > 0) {
        const stmt = this.#db.prepare(`
          INSERT INTO page_location_stats_daily (view_date, surface, country_code, region_code, views_count)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(view_date, surface, country_code, region_code) DO UPDATE SET
            views_count = page_location_stats_daily.views_count + excluded.views_count
        `);
        for (const item of batch.pageLocationViews) {
          stmt.run(item.viewDate, item.surface, item.countryCode, item.regionCode, item.count);
        }
      }

      if (batch.packageDownloads.length > 0) {
        const stmt = this.#db.prepare(`
          INSERT INTO package_downloads_daily (library_name, library_version, download_date, downloads_count)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(library_name, library_version, download_date)
          DO UPDATE SET downloads_count = package_downloads_daily.downloads_count + excluded.downloads_count
        `);
        for (const item of batch.packageDownloads) {
          stmt.run(item.libraryName, item.libraryVersion, item.downloadDate, item.count);
        }
      }
    });

    tx();
  }

  incrementPostView(postId: number, countryCode?: string, regionCode?: string) {
    if (this.analyticsBuffer) {
      this.analyticsBuffer.incrementPostView(postId, countryCode, regionCode);
      return;
    }

    this.#db.prepare(`UPDATE posts SET view_count = view_count + 1 WHERE id = ?`).run(postId);

    const normCountry = countryCode ? countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        regionCode && /^[A-Za-z0-9]{1,6}$/.test(regionCode.trim()) ? regionCode.trim().toUpperCase() : null;
      this.#db
        .prepare(
          `
        INSERT INTO post_location_stats (post_id, country_code, region_code, view_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(post_id, country_code, COALESCE(region_code, '')) DO UPDATE SET view_count = post_location_stats.view_count + 1
      `,
        )
        .run(postId, normCountry, normRegion);
    }
  }

  getPostLocationStats(postId: number): { country: string; views: number }[] {
    if (this.analyticsBuffer?.hasPostPending(postId)) {
      this.analyticsBuffer.flushSync();
    }
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
    if (this.analyticsBuffer?.hasPostPending(postId)) {
      this.analyticsBuffer.flushSync();
    }
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

  recordPageView(params: {
    surface: "web" | "docs";
    path: string;
    isUniqueVisitor?: boolean | undefined;
    countryCode?: string | undefined;
    regionCode?: string | undefined;
    date?: string | undefined;
  }): void {
    if (this.analyticsBuffer) {
      this.analyticsBuffer.recordPageView(params);
      return;
    }

    const viewDate =
      params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : new Date().toISOString().slice(0, 10);
    const surface: "web" | "docs" = params.surface === "docs" ? "docs" : "web";
    let cleanPath =
      String(params.path || "/")
        .split("?")[0]
        ?.split("#")[0]
        ?.trim() || "/";
    if (!cleanPath.startsWith("/")) {
      cleanPath = "/" + cleanPath;
    }
    while (cleanPath.length > 1 && cleanPath.endsWith("/")) {
      cleanPath = cleanPath.slice(0, -1);
    }
    if (cleanPath.length > 256) {
      cleanPath = cleanPath.slice(0, 256);
    }

    const uniqueInc = params.isUniqueVisitor ? 1 : 0;

    this.#db
      .prepare(
        `
        INSERT INTO page_views_daily (view_date, surface, path, views_count, unique_visitors)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(view_date, surface, path) DO UPDATE SET
          views_count = page_views_daily.views_count + 1,
          unique_visitors = page_views_daily.unique_visitors + excluded.unique_visitors
      `,
      )
      .run(viewDate, surface, cleanPath, uniqueInc);

    const normCountry = params.countryCode ? params.countryCode.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(normCountry)) {
      const normRegion =
        params.regionCode && /^[A-Za-z0-9]{1,6}$/.test(params.regionCode.trim())
          ? params.regionCode.trim().toUpperCase()
          : "";
      this.#db
        .prepare(
          `
          INSERT INTO page_location_stats_daily (view_date, surface, country_code, region_code, views_count)
          VALUES (?, ?, ?, ?, 1)
          ON CONFLICT(view_date, surface, country_code, region_code) DO UPDATE SET
            views_count = page_location_stats_daily.views_count + 1
        `,
        )
        .run(viewDate, surface, normCountry, normRegion);
    }
  }

  getPageAnalyticsSummary(
    days = 30,
    surface?: "web" | "docs",
  ): {
    totalViews: number;
    uniqueVisitors: number;
    webViews: number;
    docsViews: number;
    postViewsTotal: number;
    packageDownloadsTotal: number;
    daily: { date: string; views: number; uniqueVisitors: number; webViews: number; docsViews: number }[];
    topPages: { surface: "web" | "docs"; path: string; views: number; uniqueVisitors: number }[];
    locationStats: { country: string; views: number }[];
    regionStats: { country: string; region: string; views: number }[];
  } {
    this.analyticsBuffer?.flushSync();
    const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
    const cutoff = new Date(Date.now() - (safeDays - 1) * 86_400_000).toISOString().slice(0, 10);
    const hasSurface = surface === "web" || surface === "docs";

    const totalsRow = this.#db
      .prepare(
        `
        SELECT
          COALESCE(SUM(views_count), 0) AS totalViews,
          COALESCE(SUM(unique_visitors), 0) AS uniqueVisitors,
          COALESCE(SUM(CASE WHEN surface = 'web' THEN views_count ELSE 0 END), 0) AS webViews,
          COALESCE(SUM(CASE WHEN surface = 'docs' THEN views_count ELSE 0 END), 0) AS docsViews
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
      `,
      )
      .get(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      totalViews: number;
      uniqueVisitors: number;
      webViews: number;
      docsViews: number;
    };

    const dailyRows = this.#db
      .prepare(
        `
        SELECT
          view_date AS date,
          SUM(views_count) AS views,
          SUM(unique_visitors) AS uniqueVisitors,
          SUM(CASE WHEN surface = 'web' THEN views_count ELSE 0 END) AS webViews,
          SUM(CASE WHEN surface = 'docs' THEN views_count ELSE 0 END) AS docsViews
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY view_date
        ORDER BY view_date ASC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      date: string;
      views: number;
      uniqueVisitors: number;
      webViews: number;
      docsViews: number;
    }[];

    const topPages = this.#db
      .prepare(
        `
        SELECT
          surface,
          path,
          SUM(views_count) AS views,
          SUM(unique_visitors) AS uniqueVisitors
        FROM page_views_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY surface, path
        ORDER BY views DESC, uniqueVisitors DESC
        LIMIT 25
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as {
      surface: "web" | "docs";
      path: string;
      views: number;
      uniqueVisitors: number;
    }[];

    const locationStats = this.#db
      .prepare(
        `
        SELECT country_code AS country, SUM(views_count) AS views
        FROM page_location_stats_daily
        WHERE view_date >= ? ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY country_code
        ORDER BY views DESC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as { country: string; views: number }[];

    const regionStats = this.#db
      .prepare(
        `
        SELECT country_code AS country, region_code AS region, SUM(views_count) AS views
        FROM page_location_stats_daily
        WHERE view_date >= ? AND region_code != '' ${hasSurface ? "AND surface = ?" : ""}
        GROUP BY country_code, region_code
        ORDER BY views DESC
      `,
      )
      .all(...(hasSurface ? [cutoff, surface] : [cutoff])) as { country: string; region: string; views: number }[];

    const postViewsRow = this.#db.prepare(`SELECT COALESCE(SUM(view_count), 0) AS total FROM posts`).get() as {
      total: number;
    };
    const pkgDlRow = this.#db
      .prepare(
        `SELECT COALESCE(SUM(downloads_count), 0) AS total FROM package_downloads_daily WHERE download_date >= ?`,
      )
      .get(cutoff) as { total: number };

    return {
      totalViews: totalsRow.totalViews || 0,
      uniqueVisitors: totalsRow.uniqueVisitors || 0,
      webViews: totalsRow.webViews || 0,
      docsViews: totalsRow.docsViews || 0,
      postViewsTotal: postViewsRow?.total || 0,
      packageDownloadsTotal: pkgDlRow?.total || 0,
      daily: dailyRows,
      topPages,
      locationStats,
      regionStats,
    };
  }

  prunePageAnalytics(retainDays: number): {
    deletedDailyRows: number;
    deletedLocationRows: number;
    cutoffDate: string;
  } {
    const safeDays = Math.max(0, Math.floor(retainDays));
    const cutoffDate =
      safeDays === 0 ? "9999-12-31" : new Date(Date.now() - safeDays * 86_400_000).toISOString().slice(0, 10);

    const r1 = this.#db.prepare(`DELETE FROM page_views_daily WHERE view_date < ?`).run(cutoffDate);
    const r2 = this.#db.prepare(`DELETE FROM page_location_stats_daily WHERE view_date < ?`).run(cutoffDate);
    return {
      deletedDailyRows: r1.changes,
      deletedLocationRows: r2.changes,
      cutoffDate,
    };
  }

  private hydratePost(
    p: (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined }) | null | undefined,
    currentUserId?: number,
    depth: number = 0,
  ): PostRow | null {
    if (!p) return null;
    if (p.metadata && typeof p.metadata === "string") {
      try {
        p.metadata = JSON.parse(p.metadata) as PostMetadata | string;
        if (typeof p.metadata === "string") {
          p.metadata = JSON.parse(p.metadata) as PostMetadata;
        }
      } catch {}
    }
    const meta = p.metadata && typeof p.metadata === "object" ? p.metadata : undefined;
    if (meta) {
      if (!p.client_signature && meta.clientSignature) {
        p.client_signature = meta.clientSignature;
      }
      if (!p.key_id_string && meta.keyIdString) {
        p.key_id_string = meta.keyIdString;
      }
      if (!p.content_warning && typeof meta.contentWarning === "string" && meta.contentWarning.trim()) {
        p.content_warning = meta.contentWarning.trim();
      }
    }
    if (p.content_warning && !p.is_sensitive) {
      p.is_sensitive = 1;
    }
    if (p.artifact_view_id && !p.artifact_view) {
      p.artifact_view = this.getArtifactView(p.artifact_view_id) ?? null;
    }
    const extraArtifactIds = new Set<number>();
    if (p.artifact_view_id) {
      extraArtifactIds.add(Number(p.artifact_view_id));
    }
    if (Array.isArray(meta?.notebook?.artifactIds)) {
      for (const aid of meta.notebook.artifactIds) {
        if (Number.isFinite(Number(aid))) extraArtifactIds.add(Number(aid));
      }
    }
    if (Array.isArray(meta?.notebook?.cells)) {
      for (const cell of meta.notebook.cells) {
        if (cell?.type === "artifact" && Number.isFinite(Number(cell.artifactId))) {
          extraArtifactIds.add(Number(cell.artifactId));
        }
      }
    }
    if (typeof p.content === "string" && p.content.includes("::artifact")) {
      const directiveRe = /::artifact(?:\[[^\]]*\])?\{([^}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = directiveRe.exec(p.content)) !== null) {
        const idMatch = (match[1] || "").match(/(?:^|\s)id\s*=\s*["']?(\d+)["']?/);
        if (idMatch && idMatch[1]) {
          extraArtifactIds.add(Number(idMatch[1]));
        }
      }
    }
    if (extraArtifactIds.size > 0) {
      const viewsMap: Record<number, ArtifactViewRow> = {};
      for (const aid of extraArtifactIds) {
        const view = aid === p.artifact_view_id && p.artifact_view ? p.artifact_view : this.getArtifactView(aid);
        if (view) {
          viewsMap[aid] = view;
        }
      }
      p.artifact_views = viewsMap;
    }
    p.visibility = ((p as { visibility?: string }).visibility as PostVisibility) || "public";
    const poll = this.getPostPoll(p.id, currentUserId);
    if (poll) {
      p.poll = poll;
    }
    if (depth < 2) {
      if (p.repost_of_id && p.repost_of_id !== p.id) {
        p.repost_post = this.getPost(p.repost_of_id, currentUserId, depth + 1);
      }
      if (p.quote_post_id && p.quote_post_id !== p.id) {
        p.quote_post = this.getPost(p.quote_post_id, currentUserId, depth + 1);
      }
    }
    return p as PostRow;
  }

  getPost(id: number, currentUserId?: number, depth: number = 0): PostRow | null {
    if (this.analyticsBuffer?.hasPostPending(id)) {
      this.analyticsBuffer.flushSync();
    }
    const uid = currentUserId || -1;
    const p = this.#db
      .prepare(
        `
      SELECT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `,
      )
      .get(uid, uid, uid, id) as
      | (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined })
      | undefined;
    return this.hydratePost(p, currentUserId, depth);
  }

  getReplies(postId: number, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "thread");
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.reply_to_id = ?
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at ASC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, ...visFilter.params, ...modFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = posts.map((p) => this.hydratePost(p, currentUserId)!);
    return this.applyContentFiltersToPosts(hydrated, "thread", currentUserId);
  }

  getQuotes(postId: number, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.quote_post_id = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return posts.map((p) => this.hydratePost(p, currentUserId)!);
  }

  getReposts(postId: number, currentUserId?: number, limit: number = 50): PostRow[] {
    const uid = currentUserId || -1;
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.repost_of_id = ?
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, postId, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return posts.map((p) => this.hydratePost(p, currentUserId)!);
  }

  getPostParents(postId: number, currentUserId?: number, depth: number = 5): PostRow[] {
    const parents: PostRow[] = [];
    let currentId = postId;
    let currentDepth = 0;

    while (currentDepth < depth) {
      const p = this.#db.prepare(`SELECT reply_to_id FROM posts WHERE id = ?`).get(currentId) as
        | { reply_to_id: number | null }
        | undefined;
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

  private buildArtifactFilter(artifactType?: string): { sql: string; params: (string | number)[] } {
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
    if (norm === "notebook" || norm === "notebooks") {
      return {
        sql: " AND (p.metadata LIKE '%\"isNotebook\":true%' OR p.content LIKE '%::artifact%')",
        params: [],
      };
    }
    return { sql: " AND LOWER(a.view_type) = ?", params: [norm] };
  }

  private buildTagFilter(tag?: string): { sql: string; params: (string | number)[] } {
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

  private buildMuteBlockFilter(userId?: number): { sql: string; params: (string | number)[] } {
    if (!userId || userId <= 0) return { sql: "", params: [] };
    return {
      sql: ` AND p.author_id NOT IN (SELECT muted_id FROM user_mutes WHERE muter_id = ?)
        AND p.author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
        AND p.author_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)`,
      params: [userId, userId, userId],
    };
  }

  private buildVisibilityFilter(
    currentUserId?: number,
    scope: "home" | "following" | "public" | "outbox" | "profile" | "thread" = "public",
  ): { sql: string; params: (string | number)[] } {
    if (scope === "public") {
      return {
        sql: " AND COALESCE(p.visibility, 'public') = 'public'",
        params: [],
      };
    }
    if (scope === "outbox") {
      return {
        sql: " AND COALESCE(p.visibility, 'public') IN ('public', 'unlisted')",
        params: [],
      };
    }
    if (!currentUserId || currentUserId <= 0) {
      return {
        sql: " AND COALESCE(p.visibility, 'public') IN ('public', 'unlisted')",
        params: [],
      };
    }
    return {
      sql: ` AND (
        COALESCE(p.visibility, 'public') IN ('public', 'unlisted')
        OR p.author_id = ?
        OR (COALESCE(p.visibility, 'public') = 'followers' AND p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?))
        OR (COALESCE(p.visibility, 'public') = 'direct' AND EXISTS (
          SELECT 1 FROM users uv WHERE uv.id = ? AND LOWER(COALESCE(p.content, '')) LIKE '%@' || LOWER(uv.username) || '%'
        ))
      )`,
      params: [currentUserId, currentUserId, currentUserId],
    };
  }

  getHomeTimeline(
    userId: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    try {
      const hasTopics = this.#db.prepare(`SELECT 1 FROM user_topics WHERE user_id = ? LIMIT 1`).get(userId);
      if (!hasTopics) {
        this.deriveUserTopics(userId);
      }
    } catch (e) {
      console.error("Failed to derive user topics", e);
    }

    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(userId);
    const visFilter = this.buildVisibilityFilter(userId, "home");
    const baseParams = [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId];
    const allParams = [
      ...baseParams,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

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
          p.author_id IN (SELECT f.user_id FROM user_rss_subscriptions s JOIN rss_feeds f ON s.rss_feed_id = f.id WHERE s.user_id = ?) OR
          (
            COALESCE(p.visibility, 'public') = 'public' AND
            EXISTS (
              SELECT 1 FROM post_topics pt
              JOIN trending_topics t ON pt.topic_id = t.id
              JOIN user_topics ut ON ut.concept = t.concept AND ut.user_id = ? AND ut.is_active = 1
              WHERE pt.post_id = p.id
            )
          )
        )
        ${artFilter.sql}
        ${tagFilter.sql}
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY total_score DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = posts.map((p) => this.hydratePost(p, userId)!);
    return this.applyContentFiltersToPosts(hydrated, "home", userId);
  }

  getFollowingTimeline(
    userId: number,
    limit: number = 20,
    sort: string = "recent",
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    const orderBy = sort === "popular" ? "like_count DESC, diversity_score DESC" : "diversity_score DESC";
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(userId);
    const visFilter = this.buildVisibilityFilter(userId, "following");
    const baseParams = [userId, userId, userId, userId, userId, userId];
    const allParams = [
      ...baseParams,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

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
      WHERE (
        p.author_id = ? OR
        p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?) OR
        p.author_id IN (SELECT f.user_id FROM user_rss_subscriptions s JOIN rss_feeds f ON s.rss_feed_id = f.id WHERE s.user_id = ?)
      )
        ${artFilter.sql}
        ${tagFilter.sql}
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = posts.map((p) => this.hydratePost(p, userId)!);
    return this.applyContentFiltersToPosts(hydrated, "home", userId);
  }

  getExploreTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "public");
    const allParams = [
      uid,
      uid,
      uid,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

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
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY (engagement_score / (CAST((julianday('now') - julianday(p.created_at)) * 24 as REAL) + 2)) DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];

    const hydrated = posts.map((p) => this.hydratePost(p, currentUserId)!);
    return this.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  getFederatedTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    const uid = currentUserId || -1;
    const artFilter = this.buildArtifactFilter(artifactType);
    const tagFilter = this.buildTagFilter(tag);
    const modFilter = this.buildMuteBlockFilter(currentUserId);
    const visFilter = this.buildVisibilityFilter(currentUserId, "public");
    const allParams = [
      uid,
      uid,
      uid,
      ...artFilter.params,
      ...tagFilter.params,
      ...visFilter.params,
      ...modFilter.params,
      limit,
      offset,
    ];

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
        ${visFilter.sql}
        ${modFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...allParams) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];

    const hydrated = posts.map((p) => this.hydratePost(p, currentUserId)!);
    return this.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  getUserTimeline(username: string, currentUserId?: number, limit: number = 20, type?: string): PostRow[] {
    let typeFilter = "";
    if (type === "replies") {
      typeFilter = "AND p.reply_to_id IS NOT NULL";
    } else if (type === "artifacts") {
      typeFilter = "AND p.artifact_view_id IS NOT NULL";
    } else if (type === "posts") {
      typeFilter = "AND p.reply_to_id IS NULL";
    }

    const uid = currentUserId || -1;
    const visFilter = this.buildVisibilityFilter(currentUserId, "profile");
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
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE u.username = ? ${typeFilter}
        ${visFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ?
    `,
      )
      .all(uid, uid, uid, username, ...visFilter.params, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = posts.map((p) => this.hydratePost(p, currentUserId)!);
    return this.applyContentFiltersToPosts(hydrated, "account", currentUserId);
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
      try {
        this.deriveUserTopics(userId);
      } catch {}
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as
        | { author_id: number }
        | undefined;
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
      try {
        this.deriveUserTopics(userId);
      } catch {}
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as
        | { author_id: number }
        | undefined;
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
      const post = this.#db.prepare(`SELECT author_id FROM posts WHERE id = ?`).get(postId) as
        | { author_id: number }
        | undefined;
      if (post && post.author_id !== userId) {
        this.createNotification(post.author_id, userId, "repost", postId);
      }
      return true; // reposted
    }
  }

  getBookmarks(userId: number, limit: number = 20): PostRow[] {
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
      .all(userId, userId, userId, limit) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return posts.map((p) => this.hydratePost(p, userId)!);
  }

  createNotification(
    userId: number,
    actorId: number,
    type: string,
    postId?: number | null,
    metadata?: Record<string, unknown> | string | null,
  ): void {
    const isSystemNotification = [
      "simulation",
      "simulation_completed",
      "simulation_failed",
      "package",
      "package_published",
      "package_yanked",
      "security_alert",
      "credit_warning",
    ].includes(type);
    if (userId === actorId && !isSystemNotification) return;

    if (!isSystemNotification) {
      try {
        if (
          this.isUserBlocked(userId, actorId) ||
          this.isUserBlocked(actorId, userId) ||
          this.isUserMuted(userId, actorId)
        ) {
          return;
        }
      } catch {}
    }

    let parsedSettings: Record<string, unknown> | null = null;
    try {
      const rawSettings = this.getNotificationSettings(userId);
      if (rawSettings) {
        const parsed: unknown = JSON.parse(rawSettings);
        if (parsed && typeof parsed === "object") {
          parsedSettings = parsed as Record<string, unknown>;
        }
      }
    } catch {}

    // security_alert notifications are non-mutable and always delivered
    if (type !== "security_alert" && parsedSettings) {
      if (parsedSettings[type] === false || parsedSettings[`${type}s`] === false) {
        return;
      }
      type NotificationEventsConfig = {
        social?: {
          mentions?: boolean;
          replies?: boolean;
          follows?: boolean;
          reposts?: boolean;
        };
        engineering?: {
          packageUpdates?: boolean;
        };
        computeHpc?: {
          jobCompleted?: boolean;
          jobFailed?: boolean;
          quotaThresholdAlert?: boolean;
        };
      };
      const ev = parsedSettings["events"] as NotificationEventsConfig | undefined;
      if (ev && typeof ev === "object") {
        if (type === "mention" && ev.social?.mentions === false) return;
        if (type === "reply" && ev.social?.replies === false) return;
        if (type === "follow" && ev.social?.follows === false) return;
        if (type === "repost" && ev.social?.reposts === false) return;
        if (
          (type === "package" || type === "package_published" || type === "package_yanked") &&
          ev.engineering?.packageUpdates === false
        ) {
          return;
        }
        if ((type === "simulation" || type === "simulation_completed") && ev.computeHpc?.jobCompleted === false) {
          return;
        }
        if (type === "simulation_failed" && ev.computeHpc?.jobFailed === false) return;
        if (type === "credit_warning" && ev.computeHpc?.quotaThresholdAlert === false) return;
      }
    }

    let metadataObj: Record<string, unknown> | null = null;
    let metadataStr: string | null = null;
    if (metadata) {
      if (typeof metadata === "string") {
        metadataStr = metadata;
        try {
          metadataObj = JSON.parse(metadata) as Record<string, unknown>;
        } catch {}
      } else {
        metadataObj = metadata;
        metadataStr = JSON.stringify(metadata);
      }
    }

    const deliveryChannels = parsedSettings?.["deliveryChannels"] as
      | { inApp?: boolean; emailNotifications?: boolean }
      | undefined;
    const inAppEnabled = type === "security_alert" || deliveryChannels?.inApp !== false;
    if (inAppEnabled) {
      try {
        this.#db
          .prepare(
            `
          INSERT INTO notifications (user_id, actor_id, type, post_id, metadata)
          VALUES (?, ?, ?, ?, ?)
        `,
          )
          .run(userId, actorId, type, postId ?? null, metadataStr);
      } catch {
        this.#db
          .prepare(
            `
          INSERT INTO notifications (user_id, actor_id, type, post_id)
          VALUES (?, ?, ?, ?)
        `,
          )
          .run(userId, actorId, type, postId ?? null);
      }
    }

    // Dispatch instant email notification when opted in (or for security_alert unless skipEmail is set)
    try {
      const emailNotificationsOptIn =
        deliveryChannels?.emailNotifications === true &&
        (parsedSettings?.["emailDigestFrequency"] ?? "instant") === "instant";
      const shouldEmail =
        (type === "security_alert" && metadataObj?.["skipEmail"] !== true && emailNotificationsOptIn) ||
        (type !== "security_alert" && emailNotificationsOptIn);
      if (shouldEmail) {
        const recipient = this.getUserById(userId);
        if (recipient?.email && (recipient.email_verified === 1 || type === "security_alert")) {
          const rawInstanceName = this.getInstanceSettings().instanceName?.trim();
          const instanceName = rawInstanceName || "Ansatz";
          const richCopy = this.formatSocialNotificationCopy(type, actorId, postId ?? null, metadataObj, instanceName);
          void defaultMailer
            .sendNotificationEmail(recipient.email, {
              username: recipient.username,
              type,
              title: richCopy.title,
              body: richCopy.body,
              link: richCopy.link,
              instanceName,
              actorHandle: richCopy.actorHandle,
              actorDisplayName: richCopy.actorDisplayName,
              postSnippet: richCopy.postSnippet,
              ctaLabel: richCopy.ctaLabel,
            })
            .catch(() => {});
        }
      }
    } catch {}
  }

  private formatSocialNotificationCopy(
    type: string,
    actorId: number,
    postId: number | null,
    metadataObj: Record<string, unknown> | null,
    instanceName: string,
  ): {
    title: string;
    body: string;
    link: string;
    actorHandle?: string | undefined;
    actorDisplayName?: string | undefined;
    postSnippet?: string | undefined;
    ctaLabel?: string | undefined;
  } {
    const actor = actorId > 0 ? this.getUserById(actorId) : undefined;
    const actorHandle = actor?.username ? `@${actor.username}` : "Someone";
    const actorDisplayName = actor?.display_name?.trim() || actorHandle;
    const actorLabel =
      actor?.display_name?.trim() && actor.display_name.trim() !== actor.username
        ? `${actorHandle} (${actor.display_name.trim()})`
        : actorHandle;

    let postSnippet: string | undefined;
    if (postId) {
      try {
        const postRow = this.#db.prepare(`SELECT content FROM posts WHERE id = ?`).get(postId) as
          | { content: string | null }
          | undefined;
        if (postRow?.content) {
          const cleaned = postRow.content
            .replace(/::artifact(?:\[[^\]]*\])?\{[^}]*\}/g, "")
            .replace(/\s+/g, " ")
            .trim();
          if (cleaned) {
            postSnippet = cleaned.length > 180 ? `${cleaned.slice(0, 177)}...` : cleaned;
          }
        }
      } catch {}
    } else if (type === "follow" && actor?.bio) {
      const cleanedBio = actor.bio.replace(/\s+/g, " ").trim();
      if (cleanedBio) {
        postSnippet = cleanedBio.length > 160 ? `${cleanedBio.slice(0, 157)}...` : cleanedBio;
      }
    }

    const explicitTitle =
      (typeof metadataObj?.["title"] === "string" && metadataObj["title"].trim()) ||
      (typeof metadataObj?.["message"] === "string" && metadataObj["message"].trim()) ||
      "";
    const explicitDesc =
      typeof metadataObj?.["description"] === "string" && metadataObj["description"].trim()
        ? metadataObj["description"].trim()
        : "";
    const explicitLink =
      typeof metadataObj?.["link"] === "string" && metadataObj["link"].trim() ? metadataObj["link"].trim() : "";

    let defaultTitle = `New ${type.replace(/_/g, " ")} notification`;
    let defaultBody = `You have a new ${type.replace(/_/g, " ")} notification on ${instanceName}.`;
    let defaultLink = postId ? `/post/${postId}` : "/notifications";
    let ctaLabel = `View in ${instanceName}`;

    if (type === "follow") {
      defaultTitle = `${actorHandle} started following you on ${instanceName}`;
      defaultBody = `${actorLabel} is now following your engineering updates and publications on ${instanceName}.`;
      defaultLink = actor?.username ? `/u/${actor.username}` : "/notifications";
      ctaLabel = actor?.username ? `View ${actorHandle}'s Profile` : `View Profile`;
    } else if (type === "like") {
      defaultTitle = `${actorHandle} liked your post`;
      defaultBody = `${actorLabel} liked your post on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "repost") {
      defaultTitle = `${actorHandle} reposted your post`;
      defaultBody = `${actorLabel} shared your post with their followers on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "reply") {
      defaultTitle = `${actorHandle} replied to your post`;
      defaultBody = `${actorLabel} replied to your discussion thread on ${instanceName}.`;
      ctaLabel = "View Conversation";
    } else if (type === "mention") {
      defaultTitle = `${actorHandle} mentioned you in a post`;
      defaultBody = `${actorLabel} mentioned you in a post on ${instanceName}.`;
      ctaLabel = "View Post";
    } else if (type === "package" || type === "package_published") {
      const pkgName = typeof metadataObj?.["packageName"] === "string" ? metadataObj["packageName"] : "";
      defaultTitle = pkgName
        ? `Package ${pkgName} published on ${instanceName}`
        : `New package release on ${instanceName}`;
      defaultBody = pkgName
        ? `A new release of '${pkgName}' is now available in the ${instanceName} registry.`
        : `A package you follow has published a new release on ${instanceName}.`;
      ctaLabel = "View Package";
    } else if (type === "simulation" || type === "simulation_completed") {
      defaultTitle = `Simulation job completed on ${instanceName}`;
      defaultBody = `Your simulation run finished executing and results are ready for inspection.`;
      ctaLabel = "View Simulation Results";
    } else if (type === "simulation_failed") {
      defaultTitle = `Simulation job failed on ${instanceName}`;
      defaultBody = `Your simulation run encountered an error during solver execution.`;
      ctaLabel = "Inspect Solver Diagnostics";
    } else if (type === "credit_warning") {
      defaultTitle = `Compute credit balance alert on ${instanceName}`;
      defaultBody = `Your compute credit balance has crossed your configured alert threshold.`;
      defaultLink = "/settings";
      ctaLabel = "Manage Compute Credits";
    }

    return {
      title: explicitTitle || defaultTitle,
      body: explicitDesc || defaultBody,
      link: explicitLink || defaultLink,
      actorHandle,
      actorDisplayName,
      postSnippet,
      ctaLabel,
    };
  }

  public async dispatchEmailDigests(frequencyFilter?: "daily" | "weekly"): Promise<{
    dispatchedUsers: number;
    totalItemsCompiled: number;
    results: { userId: number; username: string; email: string; frequency: "daily" | "weekly"; itemCount: number }[];
  }> {
    const rawInstanceName = this.getInstanceSettings().instanceName?.trim() || "Ansatz";
    const rows = this.#db
      .prepare(
        `SELECT id, username, email, email_verified, notification_settings
         FROM users
         WHERE email IS NOT NULL AND email != '' AND email_verified = 1 AND status = 'active'`,
      )
      .all() as {
      id: number;
      username: string;
      email: string;
      email_verified: number;
      notification_settings: string | null;
    }[];

    const results: {
      userId: number;
      username: string;
      email: string;
      frequency: "daily" | "weekly";
      itemCount: number;
    }[] = [];
    let totalItemsCompiled = 0;

    for (const row of rows) {
      if (!row.notification_settings) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.notification_settings) as Record<string, unknown>;
      } catch {
        continue;
      }
      const deliveryChannels = parsed?.["deliveryChannels"] as { emailNotifications?: boolean } | undefined;
      if (deliveryChannels?.emailNotifications !== true) continue;
      const freq = parsed?.["emailDigestFrequency"];
      if (freq !== "daily" && freq !== "weekly") continue;
      if (frequencyFilter && freq !== frequencyFilter) continue;

      const unreadRows = this.#db
        .prepare(
          `SELECT id, actor_id, type, post_id, metadata, created_at
           FROM notifications
           WHERE user_id = ? AND read = 0
           ORDER BY created_at DESC
           LIMIT 15`,
        )
        .all(row.id) as {
        id: number;
        actor_id: number;
        type: string;
        post_id: number | null;
        metadata: string | null;
        created_at: string;
      }[];

      if (unreadRows.length === 0) continue;

      const items: DigestNotificationItem[] = unreadRows.map((n) => {
        let metaObj: Record<string, unknown> | null = null;
        if (n.metadata) {
          try {
            metaObj = JSON.parse(n.metadata) as Record<string, unknown>;
          } catch {}
        }
        const rich = this.formatSocialNotificationCopy(n.type, n.actor_id, n.post_id, metaObj, rawInstanceName);
        return {
          type: n.type,
          title: rich.title,
          snippet: rich.postSnippet,
          link: rich.link,
          createdAt: n.created_at,
        };
      });

      const sendRes = await defaultMailer.sendDigestEmail(row.email, {
        username: row.username,
        frequency: freq,
        items,
        instanceName: rawInstanceName,
      });

      if (sendRes.success) {
        totalItemsCompiled += items.length;
        results.push({
          userId: row.id,
          username: row.username,
          email: row.email,
          frequency: freq,
          itemCount: items.length,
        });
      }
    }

    return {
      dispatchedUsers: results.length,
      totalItemsCompiled,
      results,
    };
  }

  getNotifications(userId: number, limit: number = 20, category?: string): NotificationRow[] {
    let typeClause = "";
    if (category === "engineering") {
      typeClause = "AND n.type IN ('simulation', 'simulation_completed', 'simulation_failed')";
    } else if (category === "packages") {
      typeClause = "AND n.type IN ('package', 'package_published', 'package_yanked')";
    } else if (category === "social" || category === "mentions") {
      typeClause = "AND n.type IN ('mention', 'reply', 'like', 'repost', 'follow')";
    } else if (category === "system") {
      typeClause = "AND n.type IN ('security_alert', 'credit_warning')";
    }

    const rows = this.#db
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
      WHERE n.user_id = ? ${typeClause}
      ORDER BY n.created_at DESC
      LIMIT ?
    `,
      )
      .all(userId, limit) as NotificationRow[];

    return rows.map((r) => {
      if (r.metadata && typeof r.metadata === "string") {
        try {
          r.metadata = JSON.parse(r.metadata) as Record<string, unknown>;
        } catch {
          // Keep as string
        }
      }
      return r;
    });
  }

  markNotificationsRead(userId: number, category?: string): void {
    let typeClause = "";
    if (category === "engineering") {
      typeClause = "AND type IN ('simulation', 'simulation_completed', 'simulation_failed')";
    } else if (category === "packages") {
      typeClause = "AND type IN ('package', 'package_published', 'package_yanked')";
    } else if (category === "social" || category === "mentions") {
      typeClause = "AND type IN ('mention', 'reply', 'like', 'repost', 'follow')";
    } else if (category === "system") {
      typeClause = "AND type IN ('security_alert', 'credit_warning')";
    }
    this.#db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0 ${typeClause}`).run(userId);
  }

  getUnreadNotificationCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0`)
      .get(userId) as { count: number };
    return row.count;
  }

  // ── Federation Domain Moderation ─────────────────────────────────

  getDomainTier(domain: string): {
    domain: string;
    tier: "allow" | "silence" | "suspend";
    reason?: string | undefined;
    rejectMedia: boolean;
    rejectReports: boolean;
    obfuscate: boolean;
    publicComment?: string | null | undefined;
    privateComment?: string | null | undefined;
    unavailableSince?: string | null | undefined;
    consecutiveFailures: number;
    lastSeenAt?: string | null | undefined;
  } {
    const cleanDomain = domain.toLowerCase().trim();
    const row = this.#db
      .prepare(
        `SELECT domain, tier, reason, reject_media, reject_reports, obfuscate, public_comment, private_comment,
                unavailable_since, consecutive_failures, last_seen_at
         FROM federation_domains WHERE domain = ?`,
      )
      .get(cleanDomain) as
      | {
          domain: string;
          tier: "allow" | "silence" | "suspend";
          reason: string | null;
          reject_media?: number | null;
          reject_reports?: number | null;
          obfuscate?: number | null;
          public_comment?: string | null;
          private_comment?: string | null;
          unavailable_since?: string | null;
          consecutive_failures?: number | null;
          last_seen_at?: string | null;
        }
      | undefined;
    if (!row) {
      return {
        domain: cleanDomain,
        tier: "allow",
        rejectMedia: false,
        rejectReports: false,
        obfuscate: false,
        consecutiveFailures: 0,
      };
    }
    return {
      domain: row.domain,
      tier: row.tier,
      reason: row.reason || undefined,
      rejectMedia: Boolean(row.reject_media),
      rejectReports: Boolean(row.reject_reports),
      obfuscate: Boolean(row.obfuscate),
      publicComment: row.public_comment ?? row.reason ?? null,
      privateComment: row.private_comment ?? null,
      unavailableSince: row.unavailable_since ?? null,
      consecutiveFailures: Number(row.consecutive_failures ?? 0),
      lastSeenAt: row.last_seen_at ?? null,
    };
  }

  setDomainTier(
    domain: string,
    tier: "allow" | "silence" | "suspend",
    reason?: string,
    options?: {
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    },
  ): void {
    const cleanDomain = domain.toLowerCase().trim();
    const existing = this.getDomainTier(cleanDomain);
    const rejectMedia =
      options?.rejectMedia !== undefined ? (options.rejectMedia ? 1 : 0) : existing.rejectMedia ? 1 : 0;
    const rejectReports =
      options?.rejectReports !== undefined ? (options.rejectReports ? 1 : 0) : existing.rejectReports ? 1 : 0;
    const obfuscate = options?.obfuscate !== undefined ? (options.obfuscate ? 1 : 0) : existing.obfuscate ? 1 : 0;
    const publicComment =
      options?.publicComment !== undefined ? options.publicComment : (reason ?? existing.publicComment ?? null);
    const privateComment =
      options?.privateComment !== undefined ? options.privateComment : (existing.privateComment ?? null);
    const effectiveReason = reason ?? publicComment ?? existing.reason ?? null;

    this.#db
      .prepare(
        `INSERT INTO federation_domains (domain, tier, reason, reject_media, reject_reports, obfuscate, public_comment, private_comment, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           tier = excluded.tier,
           reason = excluded.reason,
           reject_media = excluded.reject_media,
           reject_reports = excluded.reject_reports,
           obfuscate = excluded.obfuscate,
           public_comment = excluded.public_comment,
           private_comment = excluded.private_comment,
           updated_at = datetime('now')`,
      )
      .run(cleanDomain, tier, effectiveReason, rejectMedia, rejectReports, obfuscate, publicComment, privateComment);
  }

  deleteDomainTier(domain: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    this.#db.prepare(`DELETE FROM federation_domains WHERE domain = ?`).run(cleanDomain);
  }

  listFederationDomains(): {
    domain: string;
    tier: string;
    reason?: string | undefined;
    reject_media: number;
    reject_reports: number;
    obfuscate: number;
    public_comment: string | null;
    private_comment: string | null;
    unavailable_since: string | null;
    consecutive_failures: number;
    last_seen_at: string | null;
    created_at: string;
    updated_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT domain, tier, reason,
                COALESCE(reject_media, 0) as reject_media,
                COALESCE(reject_reports, 0) as reject_reports,
                COALESCE(obfuscate, 0) as obfuscate,
                public_comment, private_comment,
                unavailable_since,
                COALESCE(consecutive_failures, 0) as consecutive_failures,
                last_seen_at,
                created_at, updated_at
         FROM federation_domains
         ORDER BY created_at DESC`,
      )
      .all() as {
      domain: string;
      tier: string;
      reason?: string | undefined;
      reject_media: number;
      reject_reports: number;
      obfuscate: number;
      public_comment: string | null;
      private_comment: string | null;
      unavailable_since: string | null;
      consecutive_failures: number;
      last_seen_at: string | null;
      created_at: string;
      updated_at: string;
    }[];
  }

  isDomainSuspended(domain: string): boolean {
    return this.getDomainTier(domain).tier === "suspend";
  }

  isDomainSilenced(domain: string): boolean {
    return this.getDomainTier(domain).tier === "silence";
  }

  isDomainAllowedForFederation(domain: string): boolean {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return false;
    const settings = this.getInstanceSettings();
    if (settings.federationMode === "disabled") {
      return false;
    }
    if (settings.federationMode === "allowlist") {
      const row = this.#db.prepare(`SELECT tier FROM federation_domains WHERE domain = ?`).get(cleanDomain) as
        | { tier: string }
        | undefined;
      return row?.tier === "allow";
    }
    return !this.isDomainSuspended(cleanDomain);
  }

  exportFederationDomains(format: "json" | "csv" = "json"): string {
    const domains = this.listFederationDomains();
    if (format === "csv") {
      const header = "#domain,#severity,#reject_media,#reject_reports,#public_comment,#obfuscate";
      const rows = domains.map((d) => {
        const severity = d.tier === "suspend" ? "suspend" : d.tier === "silence" ? "silence" : "allow";
        const comment = (d.public_comment ?? d.reason ?? "").replace(/"/g, '""');
        return `${d.domain},${severity},${Boolean(d.reject_media)},${Boolean(d.reject_reports)},"${comment}",${Boolean(d.obfuscate)}`;
      });
      return [header, ...rows].join("\n");
    }
    return JSON.stringify(
      domains.map((d) => ({
        domain: d.domain,
        tier: d.tier,
        reason: d.reason ?? d.public_comment ?? "",
        rejectMedia: Boolean(d.reject_media),
        rejectReports: Boolean(d.reject_reports),
        obfuscate: Boolean(d.obfuscate),
        publicComment: d.public_comment ?? d.reason ?? "",
        privateComment: d.private_comment ?? "",
        updatedAt: d.updated_at,
      })),
      null,
      2,
    );
  }

  importFederationDomains(
    entries: {
      domain: string;
      tier?: "allow" | "silence" | "suspend";
      reason?: string | null | undefined;
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    }[],
    mode: "merge" | "replace" = "merge",
  ): { importedCount: number } {
    let importedCount = 0;
    const tx = this.#db.transaction(() => {
      if (mode === "replace") {
        this.#db.prepare(`DELETE FROM federation_domains`).run();
      }
      for (const entry of entries) {
        const cleanDomain = (entry.domain || "").toLowerCase().trim();
        if (!cleanDomain || cleanDomain.startsWith("#")) continue;
        const normalizedTier =
          entry.tier === "suspend" || entry.tier === "silence" || entry.tier === "allow" ? entry.tier : "suspend";
        this.setDomainTier(cleanDomain, normalizedTier, entry.reason ?? undefined, {
          rejectMedia: entry.rejectMedia,
          rejectReports: entry.rejectReports,
          obfuscate: entry.obfuscate,
          publicComment: entry.publicComment ?? entry.reason,
          privateComment: entry.privateComment,
        });
        importedCount++;
      }
    });
    tx();
    return { importedCount };
  }

  // ── Federation Delivery Queue ─────────────────────────────────────

  enqueueFederationDelivery(
    activityType: string,
    activityId: string,
    payload: Record<string, unknown>,
    targetInboxUrl: string,
    targetDomain: string,
  ): { id: number; skipped?: boolean } {
    const cleanDomain = targetDomain.toLowerCase().trim();
    if (this.isDomainSuspended(cleanDomain) || this.isDomainUnavailable(cleanDomain)) {
      return { id: 0, skipped: true };
    }
    const res = this.#db
      .prepare(
        `INSERT INTO federation_delivery_queue (activity_type, activity_id, payload, target_inbox_url, target_domain, status, next_retry_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'), datetime('now'))`,
      )
      .run(activityType, activityId, JSON.stringify(payload), targetInboxUrl, cleanDomain);
    return { id: Number(res.lastInsertRowid) };
  }

  fetchPendingFederationDeliveries(limit: number = 25): {
    id: number;
    activity_type: string;
    activity_id: string;
    payload: string;
    target_inbox_url: string;
    target_domain: string;
    attempts: number;
    max_attempts: number;
  }[] {
    return this.#db
      .prepare(
        `SELECT * FROM federation_delivery_queue 
         WHERE status = 'pending' AND datetime(next_retry_at) <= datetime('now')
         ORDER BY id ASC LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      activity_type: string;
      activity_id: string;
      payload: string;
      target_inbox_url: string;
      target_domain: string;
      attempts: number;
      max_attempts: number;
    }[];
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

  getFederationQueueStats(): {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const rows = this.#db
      .prepare(`SELECT status, COUNT(*) as count FROM federation_delivery_queue GROUP BY status`)
      .all() as { status: string; count: number }[];
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    for (const r of rows) {
      if (r.status === "pending") stats.pending = r.count;
      else if (r.status === "processing") stats.processing = r.count;
      else if (r.status === "completed") stats.completed = r.count;
      else if (r.status === "failed") stats.failed = r.count;
      stats.total += r.count;
    }
    return stats;
  }

  listFederationDeliveries(
    status?: string,
    domain?: string,
    limit: number = 50,
  ): {
    id: number;
    activity_type: string;
    activity_id: string;
    payload: string;
    target_inbox_url: string;
    target_domain: string;
    attempts: number;
    max_attempts: number;
    next_retry_at: string;
    last_error: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    if (domain && domain.trim()) {
      clauses.push("LOWER(target_domain) LIKE ?");
      params.push(`%${domain.trim().toLowerCase()}%`);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    return this.#db
      .prepare(
        `SELECT id, activity_type, activity_id, payload, target_inbox_url, target_domain, attempts, max_attempts, next_retry_at, last_error, status, created_at, updated_at
         FROM federation_delivery_queue
         ${whereSql}
         ORDER BY id DESC LIMIT ?`,
      )
      .all(...params) as {
      id: number;
      activity_type: string;
      activity_id: string;
      payload: string;
      target_inbox_url: string;
      target_domain: string;
      attempts: number;
      max_attempts: number;
      next_retry_at: string;
      last_error: string | null;
      status: string;
      created_at: string;
      updated_at: string;
    }[];
  }

  retryFailedFederationDeliveries(domain?: string): { retriedCount: number } {
    if (domain && domain.trim()) {
      const cleanDomain = domain.trim().toLowerCase();
      this.#db
        .prepare(
          `UPDATE federation_domains SET unavailable_since = NULL, consecutive_failures = 0 WHERE LOWER(domain) = ?`,
        )
        .run(cleanDomain);
      const res = this.#db
        .prepare(
          `UPDATE federation_delivery_queue
           SET status = 'pending', attempts = 0, next_retry_at = datetime('now'), updated_at = datetime('now')
           WHERE status = 'failed' AND LOWER(target_domain) = ?`,
        )
        .run(cleanDomain);
      return { retriedCount: Number(res.changes) };
    }
    const res = this.#db
      .prepare(
        `UPDATE federation_delivery_queue
         SET status = 'pending', attempts = 0, next_retry_at = datetime('now'), updated_at = datetime('now')
         WHERE status = 'failed'`,
      )
      .run();
    return { retriedCount: Number(res.changes) };
  }

  purgeFederationDeliveries(status?: string, domain?: string): { deletedCount: number } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("status = ?");
      params.push(status);
    }
    if (domain && domain.trim()) {
      clauses.push("LOWER(target_domain) = ?");
      params.push(domain.trim().toLowerCase());
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = this.#db.prepare(`DELETE FROM federation_delivery_queue ${whereSql}`).run(...params);
    return { deletedCount: Number(res.changes) };
  }

  getFederationDomainHealth(): {
    domain: string;
    tier: "allow" | "silence" | "suspend";
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
    maxAttempts: number;
    lastError: string | null;
    lastUpdatedAt: string | null;
    unavailableSince: string | null;
    consecutiveFailures: number;
    lastSeenAt: string | null;
  }[] {
    const rows = this.#db
      .prepare(
        `SELECT LOWER(q.target_domain) as domain,
                COALESCE(d.tier, 'allow') as tier,
                SUM(CASE WHEN q.status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN q.status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN q.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN q.status = 'failed' THEN 1 ELSE 0 END) as failed,
                COUNT(*) as total,
                MAX(q.attempts) as max_attempts,
                MAX(q.last_error) as last_error,
                MAX(q.updated_at) as last_updated_at,
                MAX(d.unavailable_since) as unavailable_since,
                COALESCE(MAX(d.consecutive_failures), 0) as consecutive_failures,
                MAX(d.last_seen_at) as last_seen_at
         FROM federation_delivery_queue q
         LEFT JOIN federation_domains d ON LOWER(d.domain) = LOWER(q.target_domain)
         GROUP BY LOWER(q.target_domain)
         ORDER BY failed DESC, pending DESC, total DESC`,
      )
      .all() as {
      domain: string;
      tier: string;
      pending: number;
      processing: number;
      completed: number;
      failed: number;
      total: number;
      max_attempts: number;
      last_error: string | null;
      last_updated_at: string | null;
      unavailable_since: string | null;
      consecutive_failures: number;
      last_seen_at: string | null;
    }[];

    return rows.map((r) => ({
      domain: r.domain,
      tier: r.tier === "suspend" || r.tier === "silence" ? r.tier : "allow",
      pending: Number(r.pending || 0),
      processing: Number(r.processing || 0),
      completed: Number(r.completed || 0),
      failed: Number(r.failed || 0),
      total: Number(r.total || 0),
      maxAttempts: Number(r.max_attempts || 0),
      lastError: r.last_error ?? null,
      lastUpdatedAt: r.last_updated_at ?? null,
      unavailableSince: r.unavailable_since ?? null,
      consecutiveFailures: Number(r.consecutive_failures || 0),
      lastSeenAt: r.last_seen_at ?? null,
    }));
  }

  circuitBreakFederationDomain(
    domain: string,
    tier: "silence" | "suspend" = "suspend",
    reason?: string,
  ): {
    domain: string;
    tier: "silence" | "suspend";
    purgedDeliveries: number;
  } {
    const cleanDomain = domain.trim().toLowerCase();
    if (!cleanDomain) {
      throw new Error("A valid target domain is required");
    }
    this.setDomainTier(
      cleanDomain,
      tier,
      reason || `Circuit-breaker tripped for unresponsive/dead peer '${cleanDomain}'`,
    );
    const { deletedCount } = this.purgeFederationDeliveries(undefined, cleanDomain);
    return {
      domain: cleanDomain,
      tier,
      purgedDeliveries: deletedCount,
    };
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
      .prepare(
        `SELECT COUNT(*) as count FROM posts
         WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0
           AND COALESCE(visibility, 'public') IN ('public', 'unlisted')`,
      )
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getUserOutboxPosts(userId: number, limit: number = 20, offset: number = 0): PostRow[] {
    const posts = this.#db
      .prepare(
        `SELECT id, author_id, content, artifact_view_id, ap_id, url, metadata, visibility, created_at, updated_at
         FROM posts 
         WHERE author_id = ? AND repost_of_id IS NULL AND is_silenced = 0
           AND COALESCE(visibility, 'public') IN ('public', 'unlisted')
         ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    return posts.map((p) => this.hydratePost(p)!);
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
      .all(userId, limit, offset) as { actor_url?: string | undefined; username: string }[];
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
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
         JOIN users u ON f.following_id = u.id
         WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)
         ORDER BY f.id DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, limit, offset) as { actor_url?: string | undefined; username: string }[];
    const publicUrl = process.env["PUBLIC_URL"] || "https://hub.modelscript.org";
    return rows.map((r) => r.actor_url || `${publicUrl}/users/${r.username}`);
  }

  getUserFollowingActorsCount(userId: number): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) as count FROM follows WHERE follower_id = ? AND (state = 'accepted' OR state IS NULL)`)
      .get(userId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getPostByApId(apId: string): PostRow | undefined {
    const direct = this.#db.prepare(`SELECT * FROM posts WHERE ap_id = ?`).get(apId) as PostRow | undefined;
    if (direct) return direct;
    const localMatch = apId.match(/\/users\/[^/]+\/posts\/(\d+)\/?$/) || apId.match(/\/posts\/(\d+)\/?$/);
    if (localMatch && localMatch[1]) {
      const localId = Number(localMatch[1]);
      if (Number.isFinite(localId)) {
        return this.#db.prepare(`SELECT * FROM posts WHERE id = ?`).get(localId) as PostRow | undefined;
      }
    }
    return undefined;
  }

  deletePostByApId(apId: string, expectedAuthorId?: number): boolean {
    const post = this.#db.prepare(`SELECT id, author_id FROM posts WHERE ap_id = ?`).get(apId) as
      | { id: number; author_id: number }
      | undefined;
    if (!post) return false;
    if (expectedAuthorId !== undefined && post.author_id !== expectedAuthorId) {
      return false;
    }
    return this.deletePost(post.id).success;
  }

  updatePostContentByApId(apId: string, content: string, expectedAuthorId?: number): boolean {
    if (expectedAuthorId !== undefined) {
      const res = this.#db
        .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE ap_id = ? AND author_id = ?`)
        .run(content, apId, expectedAuthorId);
      return res.changes > 0;
    }
    const res = this.#db
      .prepare(`UPDATE posts SET content = ?, updated_at = datetime('now') WHERE ap_id = ?`)
      .run(content, apId);
    return res.changes > 0;
  }

  // ── Moderation & Content Reports ─────────────────────────────────

  #hydrateContentReport(raw: ContentReportRow): ContentReportRow {
    let snapshot: {
      targetType?: string | undefined;
      targetResourceId?: string | null | undefined;
      postId?: number | null | undefined;
      postContent?: string | null | undefined;
      authorId?: number | null | undefined;
      authorUsername?: string | null | undefined;
      authorDomain?: string | null | undefined;
      apId?: string | null | undefined;
    } | null = null;

    if (raw.content_snapshot && typeof raw.content_snapshot === "string") {
      try {
        snapshot = JSON.parse(raw.content_snapshot);
      } catch {
        snapshot = null;
      }
    }

    let parsedRuleIds: number[] = [];
    if (Array.isArray(raw.rule_ids)) {
      parsedRuleIds = raw.rule_ids.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    } else if (typeof raw.rule_ids === "string" && raw.rule_ids.trim()) {
      try {
        const arr = JSON.parse(raw.rule_ids);
        if (Array.isArray(arr)) {
          parsedRuleIds = arr.map((n) => Number(n)).filter((n) => Number.isFinite(n));
        }
      } catch {}
    }

    const postContent = raw.post_content ?? snapshot?.postContent ?? null;
    const postAuthorId = raw.post_author_id ?? snapshot?.authorId ?? raw.target_user_id ?? null;
    const authorUsername = raw.author_username || raw.target_username || snapshot?.authorUsername || null;
    const targetUsername = raw.target_username || raw.author_username || snapshot?.authorUsername || null;
    const authorDomain = raw.author_domain || snapshot?.authorDomain || null;
    const targetType = raw.target_type || snapshot?.targetType || (raw.post_id != null ? "post" : "user");
    const targetResourceId =
      raw.target_resource_id ??
      snapshot?.targetResourceId ??
      (raw.post_id != null ? String(raw.post_id) : raw.target_user_id != null ? String(raw.target_user_id) : null);

    return {
      ...raw,
      post_content: postContent,
      post_author_id: postAuthorId,
      author_username: authorUsername,
      target_username: targetUsername,
      author_domain: authorDomain,
      target_type: targetType,
      target_resource_id: targetResourceId,
      rule_ids: parsedRuleIds,
      category: raw.category || "other",
    };
  }

  createContentReport(
    reporterId: number,
    data: {
      postId?: number | undefined;
      targetUserId?: number | undefined;
      targetType?: "post" | "user" | "package" | "repo" | "appeal" | string | undefined;
      targetResourceId?: string | undefined;
      reason: string;
      details?: string | undefined;
      ruleIds?: number[] | undefined;
      category?: string | undefined;
    },
  ): { id: number; status: string; autoQuarantined?: boolean } {
    let effectiveTargetUserId = data.targetUserId ?? null;
    const resolvedTargetType = data.targetType || (data.postId ? "post" : "user");
    const resolvedResourceId =
      data.targetResourceId ??
      (data.postId != null
        ? String(data.postId)
        : effectiveTargetUserId != null
          ? String(effectiveTargetUserId)
          : null);

    let snapshotObj: Record<string, unknown> = {
      targetType: resolvedTargetType,
      targetResourceId: resolvedResourceId,
      capturedAt: new Date().toISOString(),
    };

    if (data.postId) {
      const postInfo = this.#db
        .prepare(
          `SELECT p.id, p.content, p.author_id, p.ap_id, p.created_at, u.username, u.remote_domain
           FROM posts p
           LEFT JOIN users u ON p.author_id = u.id
           WHERE p.id = ?`,
        )
        .get(data.postId) as
        | {
            id: number;
            content: string | null;
            author_id: number;
            ap_id: string | null;
            created_at: string;
            username: string | null;
            remote_domain: string | null;
          }
        | undefined;

      if (postInfo) {
        if (!effectiveTargetUserId) {
          effectiveTargetUserId = postInfo.author_id;
        }
        snapshotObj = {
          targetType: resolvedTargetType,
          targetResourceId: resolvedResourceId,
          postId: postInfo.id,
          postContent: postInfo.content,
          authorId: postInfo.author_id,
          authorUsername: postInfo.username,
          authorDomain: postInfo.remote_domain,
          apId: postInfo.ap_id,
          postCreatedAt: postInfo.created_at,
          capturedAt: new Date().toISOString(),
        };
      }
    } else if (effectiveTargetUserId) {
      const userInfo = this.#db
        .prepare(`SELECT id, username, display_name, bio, remote_domain, status FROM users WHERE id = ?`)
        .get(effectiveTargetUserId) as
        | {
            id: number;
            username: string;
            display_name: string | null;
            bio: string | null;
            remote_domain: string | null;
            status: string | null;
          }
        | undefined;
      if (userInfo) {
        snapshotObj = {
          targetType: resolvedTargetType,
          targetResourceId: resolvedResourceId,
          authorId: userInfo.id,
          authorUsername: userInfo.username,
          authorDomain: userInfo.remote_domain,
          displayName: userInfo.display_name,
          bio: userInfo.bio,
          userStatus: userInfo.status,
          capturedAt: new Date().toISOString(),
        };
      }
    }

    const ruleIdsJson = Array.isArray(data.ruleIds)
      ? JSON.stringify(data.ruleIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      : "[]";
    const category = data.category || (Array.isArray(data.ruleIds) && data.ruleIds.length > 0 ? "violation" : "other");

    const result = this.#db
      .prepare(
        `INSERT INTO content_reports (reporter_id, post_id, target_user_id, target_type, target_resource_id, reason, details, content_snapshot, rule_ids, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reporterId,
        data.postId ?? null,
        effectiveTargetUserId,
        resolvedTargetType,
        resolvedResourceId,
        data.reason,
        data.details ?? null,
        JSON.stringify(snapshotObj),
        ruleIdsJson,
        category,
      );

    let autoQuarantined = false;
    try {
      const settings = this.getInstanceSettings();
      const threshold = settings.autoQuarantineReportThreshold;
      if (threshold > 0 && resolvedTargetType && resolvedResourceId) {
        const countRow = this.#db
          .prepare(
            `SELECT COUNT(DISTINCT reporter_id) as c
             FROM content_reports
             WHERE status = 'pending'
               AND ((? IS NOT NULL AND post_id = ?) OR (target_type = ? AND target_resource_id = ?))`,
          )
          .get(data.postId ?? null, data.postId ?? null, resolvedTargetType, resolvedResourceId) as
          | { c: number }
          | undefined;
        const distinctReporters = countRow?.c ?? 0;
        if (distinctReporters >= threshold) {
          this.quarantineResource({
            resourceType: resolvedTargetType,
            resourceId: resolvedResourceId,
            reason: `Auto-quarantined after reaching threshold of ${threshold} distinct user reports`,
          });
          if (resolvedTargetType === "post" && data.postId) {
            this.#db
              .prepare(
                `UPDATE posts
                 SET content_warning = COALESCE(content_warning, '[Auto-Quarantined Pending Moderator Review]')
                 WHERE id = ?`,
              )
              .run(data.postId);
          }
          autoQuarantined = true;
        }
      }
    } catch {
      // Non-fatal if settings table not initialized in isolated unit test
    }

    return { id: Number(result.lastInsertRowid), status: "pending", autoQuarantined };
  }

  getContentReport(reportId: number): ContentReportRow | undefined {
    const row = this.#db
      .prepare(
        `SELECT r.*, 
                u.username as reporter_username, 
                p.content as post_content,
                p.author_id as post_author_id,
                author_u.username as author_username,
                target_u.username as target_username,
                COALESCE(author_u.remote_domain, target_u.remote_domain) as author_domain
         FROM content_reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         LEFT JOIN posts p ON r.post_id = p.id
         LEFT JOIN users author_u ON p.author_id = author_u.id
         LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
         WHERE r.id = ?`,
      )
      .get(reportId) as ContentReportRow | undefined;
    return row ? this.#hydrateContentReport(row) : undefined;
  }

  getModerationQueue(
    status?: string,
    limit: number = 50,
    offset: number = 0,
    targetType?: string,
    search?: string,
  ): ContentReportRow[] {
    const baseQuery = `
      SELECT r.*, 
             u.username as reporter_username, 
             p.content as post_content,
             p.author_id as post_author_id,
             author_u.username as author_username,
             target_u.username as target_username,
             COALESCE(author_u.remote_domain, target_u.remote_domain) as author_domain,
             (
               SELECT COUNT(*) FROM content_reports r2
               WHERE (r.post_id IS NOT NULL AND r2.post_id = r.post_id)
                  OR (r.post_id IS NULL AND r.target_resource_id IS NOT NULL AND r2.target_resource_id = r.target_resource_id)
                  OR (r.post_id IS NULL AND r.target_user_id IS NOT NULL AND r2.target_user_id = r.target_user_id)
             ) as target_report_count,
             (
               SELECT COUNT(*) FROM content_reports r3
               WHERE r3.status = 'resolved'
                 AND COALESCE(r3.target_user_id, 0) = COALESCE(r.target_user_id, p.author_id, -1)
             ) as author_prior_violations
      FROM content_reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      LEFT JOIN posts p ON r.post_id = p.id
      LEFT JOIN users author_u ON p.author_id = author_u.id
      LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
    `;

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (status && status !== "all") {
      clauses.push("r.status = ?");
      params.push(status);
    }
    if (targetType && targetType !== "all") {
      if (targetType === "post") {
        clauses.push("(r.target_type = 'post' OR (r.target_type IS NULL AND r.post_id IS NOT NULL))");
      } else {
        clauses.push("r.target_type = ?");
        params.push(targetType);
      }
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(r.reason, '')) LIKE ? OR LOWER(COALESCE(r.details, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(target_u.username, '')) LIKE ? OR LOWER(COALESCE(r.target_resource_id, '')) LIKE ?)",
      );
      params.push(q, q, q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.#db
      .prepare(`${baseQuery} ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ContentReportRow[];

    return rows.map((r) => this.#hydrateContentReport(r));
  }

  getModerationQueueCount(status?: string, targetType?: string, search?: string): number {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status && status !== "all") {
      clauses.push("r.status = ?");
      params.push(status);
    }
    if (targetType && targetType !== "all") {
      if (targetType === "post") {
        clauses.push("(r.target_type = 'post' OR (r.target_type IS NULL AND r.post_id IS NOT NULL))");
      } else {
        clauses.push("r.target_type = ?");
        params.push(targetType);
      }
    }
    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      clauses.push(
        "(LOWER(COALESCE(r.reason, '')) LIKE ? OR LOWER(COALESCE(r.details, '')) LIKE ? OR LOWER(COALESCE(p.content, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(target_u.username, '')) LIKE ? OR LOWER(COALESCE(r.target_resource_id, '')) LIKE ?)",
      );
      params.push(q, q, q, q, q, q);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) as c
         FROM content_reports r
         LEFT JOIN users u ON r.reporter_id = u.id
         LEFT JOIN posts p ON r.post_id = p.id
         LEFT JOIN users target_u ON COALESCE(r.target_user_id, p.author_id) = target_u.id
         ${whereSql}`,
      )
      .get(...params) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  resolveContentReport(
    reportId: number,
    status: "resolved" | "dismissed",
    resolutionNotes?: string,
    actionTaken?: string,
    resolveAllForTarget?: boolean,
  ): boolean {
    const current = this.getContentReport(reportId);
    const res = this.#db
      .prepare(
        `UPDATE content_reports
         SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
         WHERE id = ?`,
      )
      .run(status, resolutionNotes ?? null, actionTaken ?? null, reportId);

    if (resolveAllForTarget && current) {
      if (current.post_id) {
        this.#db
          .prepare(
            `UPDATE content_reports
             SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
             WHERE post_id = ? AND status = 'pending' AND id != ?`,
          )
          .run(status, resolutionNotes ?? null, actionTaken ?? null, current.post_id, reportId);
      } else if (current.target_user_id) {
        this.#db
          .prepare(
            `UPDATE content_reports
             SET status = ?, resolution_notes = ?, action_taken = COALESCE(?, action_taken), resolved_at = datetime('now')
             WHERE target_user_id = ? AND post_id IS NULL AND status = 'pending' AND id != ?`,
          )
          .run(status, resolutionNotes ?? null, actionTaken ?? null, current.target_user_id, reportId);
      }
    }

    return res.changes > 0;
  }

  silencePost(postId: number, silenced: boolean = true): boolean {
    const res = this.#db
      .prepare(`UPDATE posts SET is_silenced = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(silenced ? 1 : 0, postId);
    return res.changes > 0;
  }

  markPostSensitive(postId: number, isSensitive: boolean = true, contentWarning?: string | null): boolean {
    const cw = isSensitive ? contentWarning?.trim() || "Sensitive content flagged by moderation" : null;
    const res = this.#db
      .prepare(
        `UPDATE posts
         SET is_sensitive = ?,
             content_warning = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(isSensitive ? 1 : 0, cw, postId);
    return res.changes > 0;
  }

  deletePost(postId: number): { success: boolean; apId?: string | undefined; authorId?: number | undefined } {
    const post = this.#db
      .prepare(
        `SELECT p.id, p.author_id, p.ap_id, p.content, p.created_at, u.username, u.remote_domain
         FROM posts p
         LEFT JOIN users u ON p.author_id = u.id
         WHERE p.id = ?`,
      )
      .get(postId) as
      | {
          id: number;
          author_id: number;
          ap_id: string | null;
          content: string | null;
          created_at: string;
          username: string | null;
          remote_domain: string | null;
        }
      | undefined;
    if (!post) {
      return { success: false };
    }
    const fallbackSnapshot = JSON.stringify({
      targetType: "post",
      postId: post.id,
      postContent: post.content,
      authorId: post.author_id,
      authorUsername: post.username,
      authorDomain: post.remote_domain,
      apId: post.ap_id,
      postCreatedAt: post.created_at,
      deletedAt: new Date().toISOString(),
    });
    this.#db
      .prepare(
        `UPDATE content_reports
         SET post_id = NULL,
             target_user_id = COALESCE(target_user_id, ?),
             content_snapshot = COALESCE(content_snapshot, ?)
         WHERE post_id = ?`,
      )
      .run(post.author_id, fallbackSnapshot, postId);
    this.#db.prepare(`DELETE FROM notifications WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM likes WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM bookmarks WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM post_topics WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM post_location_stats WHERE post_id = ?`).run(postId);
    this.#db.prepare(`DELETE FROM posts WHERE id = ?`).run(postId);
    return { success: true, apId: post.ap_id ?? undefined, authorId: post.author_id };
  }

  // ── DMCA Notices & Universal Resource Quarantine ──────────────────

  createDmcaNotice(data: {
    claimantName: string;
    claimantEmail: string;
    copyrightOwner: string;
    workDescription: string;
    infringingUrl: string;
    resourceType?: string | undefined;
    resourceId?: string | undefined;
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

  listDmcaNotices(status?: string): DmcaNoticeRow[] {
    if (status) {
      return this.#db
        .prepare(`SELECT * FROM dmca_notices WHERE status = ? ORDER BY created_at DESC`)
        .all(status) as DmcaNoticeRow[];
    }
    return this.#db.prepare(`SELECT * FROM dmca_notices ORDER BY created_at DESC`).all() as DmcaNoticeRow[];
  }

  getDmcaNotice(id: number): DmcaNoticeRow | undefined {
    return this.#db.prepare(`SELECT * FROM dmca_notices WHERE id = ?`).get(id) as DmcaNoticeRow | undefined;
  }

  resolveDmcaNotice(id: number, actionTaken: string, status: "resolved" | "rejected" = "resolved"): boolean {
    const res = this.#db
      .prepare(`UPDATE dmca_notices SET status = ?, action_taken = ?, resolved_at = datetime('now') WHERE id = ?`)
      .run(status, actionTaken, id);
    return res.changes > 0;
  }

  quarantineResource(data: {
    resourceType: string;
    resourceId: string;
    reason: string;
    dmcaNoticeId?: number | null | undefined;
    quarantinedBy?: number | null | undefined;
    counterNotice?: string | null | undefined;
    restoreAfter?: string | null | undefined;
  }): { id: number; resourceType: string; resourceId: string } {
    const cleanType = data.resourceType.trim().toLowerCase() || "package";
    const cleanId = data.resourceId.trim();
    this.#db
      .prepare(
        `INSERT INTO quarantined_resources (resource_type, resource_id, reason, dmca_notice_id, quarantined_by, status, counter_notice, restore_after, created_at, restored_at)
         VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, datetime('now'), NULL)
         ON CONFLICT(resource_type, resource_id) DO UPDATE SET
           reason = excluded.reason,
           dmca_notice_id = COALESCE(excluded.dmca_notice_id, quarantined_resources.dmca_notice_id),
           quarantined_by = excluded.quarantined_by,
           status = 'quarantined',
           counter_notice = COALESCE(excluded.counter_notice, quarantined_resources.counter_notice),
           restore_after = COALESCE(excluded.restore_after, quarantined_resources.restore_after),
           restored_at = NULL`,
      )
      .run(
        cleanType,
        cleanId,
        data.reason,
        data.dmcaNoticeId ?? null,
        data.quarantinedBy ?? null,
        data.counterNotice ?? null,
        data.restoreAfter ?? null,
      );
    const row = this.#db
      .prepare(`SELECT id FROM quarantined_resources WHERE resource_type = ? AND resource_id = ?`)
      .get(cleanType, cleanId) as { id: number } | undefined;
    return { id: row?.id ?? 0, resourceType: cleanType, resourceId: cleanId };
  }

  restoreQuarantinedResource(resourceType: string, resourceId: string): boolean {
    const res = this.#db
      .prepare(
        `UPDATE quarantined_resources
         SET status = 'restored', restored_at = datetime('now')
         WHERE resource_type = ? AND resource_id = ? AND status = 'quarantined'`,
      )
      .run(resourceType.trim().toLowerCase(), resourceId.trim());
    return res.changes > 0;
  }

  isResourceQuarantined(resourceType: string, resourceId: string): boolean {
    const row = this.#db
      .prepare(
        `SELECT 1 FROM quarantined_resources
         WHERE resource_type = ? AND resource_id = ? AND status = 'quarantined'`,
      )
      .get(resourceType.trim().toLowerCase(), resourceId.trim());
    return Boolean(row);
  }

  listQuarantinedResources(status?: string): {
    id: number;
    resource_type: string;
    resource_id: string;
    reason: string;
    dmca_notice_id: number | null;
    quarantined_by: number | null;
    status: string;
    counter_notice: string | null;
    restore_after: string | null;
    created_at: string;
    restored_at: string | null;
  }[] {
    if (status && status !== "all") {
      return this.#db
        .prepare(`SELECT * FROM quarantined_resources WHERE status = ? ORDER BY created_at DESC`)
        .all(status) as {
        id: number;
        resource_type: string;
        resource_id: string;
        reason: string;
        dmca_notice_id: number | null;
        quarantined_by: number | null;
        status: string;
        counter_notice: string | null;
        restore_after: string | null;
        created_at: string;
        restored_at: string | null;
      }[];
    }
    return this.#db.prepare(`SELECT * FROM quarantined_resources ORDER BY created_at DESC`).all() as {
      id: number;
      resource_type: string;
      resource_id: string;
      reason: string;
      dmca_notice_id: number | null;
      quarantined_by: number | null;
      status: string;
      counter_notice: string | null;
      restore_after: string | null;
      created_at: string;
      restored_at: string | null;
    }[];
  }

  fileDmcaCounterNotice(noticeId: number, counterNoticeText: string): { success: boolean; restoreAfter: string } {
    const notice = this.getDmcaNotice(noticeId);
    const restoreAfter = new Date(Date.now() + 14 * 86_400_000).toISOString();
    if (!notice) {
      return { success: false, restoreAfter };
    }
    const updatedAction = `${notice.action_taken ? `${notice.action_taken} | ` : ""}Counter-Notice filed: ${counterNoticeText} (Eligible for restoration after ${restoreAfter.slice(0, 10)})`;
    this.#db.prepare(`UPDATE dmca_notices SET action_taken = ? WHERE id = ?`).run(updatedAction, noticeId);
    this.#db
      .prepare(
        `UPDATE quarantined_resources
         SET counter_notice = ?, restore_after = ?
         WHERE dmca_notice_id = ?`,
      )
      .run(counterNoticeText, restoreAfter, noticeId);
    return { success: true, restoreAfter };
  }

  // ── Admin Overview & User Governance ─────────────────────────────

  getAdminPendingCounts(): {
    pendingReports: number;
    pendingDmca: number;
    failedDeliveries: number;
    suspendedDomains: number;
    restrictedUsers: number;
  } {
    const pendingReports =
      (
        this.#db.prepare(`SELECT COUNT(*) as c FROM content_reports WHERE status = 'pending'`).get() as
          | { c: number }
          | undefined
      )?.c ?? 0;
    const pendingDmca =
      (
        this.#db.prepare(`SELECT COUNT(*) as c FROM dmca_notices WHERE status = 'pending'`).get() as
          | { c: number }
          | undefined
      )?.c ?? 0;
    const failedDeliveries =
      (
        this.#db.prepare(`SELECT COUNT(*) as c FROM federation_delivery_queue WHERE status = 'failed'`).get() as
          | { c: number }
          | undefined
      )?.c ?? 0;
    const suspendedDomains =
      (
        this.#db.prepare(`SELECT COUNT(*) as c FROM federation_domains WHERE tier IN ('silence', 'suspend')`).get() as
          | { c: number }
          | undefined
      )?.c ?? 0;
    const restrictedUsers =
      (
        this.#db.prepare(`SELECT COUNT(*) as c FROM users WHERE status IN ('frozen', 'suspended')`).get() as
          | { c: number }
          | undefined
      )?.c ?? 0;
    return {
      pendingReports,
      pendingDmca,
      failedDeliveries,
      suspendedDomains,
      restrictedUsers,
    };
  }

  listUsersForAdmin(options?: {
    query?: string | undefined;
    status?: string | undefined;
    role?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): {
    users: AdminUserSummaryRow[];
    total: number;
    statusBreakdown: {
      active: number;
      frozen: number;
      suspended: number;
      admins: number;
      moderators: number;
      auditors: number;
    };
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.query && options.query.trim()) {
      const q = `%${options.query.trim().toLowerCase()}%`;
      clauses.push(`(LOWER(u.username) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.display_name, '')) LIKE ?)`);
      params.push(q, q, q);
    }
    if (options?.status && options.status !== "all") {
      clauses.push(`COALESCE(u.status, 'active') = ?`);
      params.push(options.status);
    }
    if (options?.role && options.role !== "all") {
      clauses.push(`COALESCE(u.account_type, 'user') = ?`);
      params.push(options.role);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const totalRow = this.#db.prepare(`SELECT COUNT(*) as c FROM users u ${whereSql}`).get(...params) as
      | { c: number }
      | undefined;
    const total = totalRow?.c ?? 0;

    const breakdownRow = this.#db
      .prepare(
        `SELECT
           SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status = 'frozen' THEN 1 ELSE 0 END) as frozen,
           SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
           SUM(CASE WHEN account_type = 'admin' THEN 1 ELSE 0 END) as admins,
           SUM(CASE WHEN account_type = 'moderator' THEN 1 ELSE 0 END) as moderators,
           SUM(CASE WHEN account_type = 'auditor' THEN 1 ELSE 0 END) as auditors
         FROM users`,
      )
      .get() as
      | {
          active: number | null;
          frozen: number | null;
          suspended: number | null;
          admins: number | null;
          moderators: number | null;
          auditors: number | null;
        }
      | undefined;

    const limit = Math.min(100, Math.max(1, options?.limit || 50));
    const offset = Math.max(0, options?.offset || 0);

    const users = this.#db
      .prepare(
        `SELECT u.id,
                u.username,
                u.email,
                u.display_name,
                COALESCE(u.account_type, 'user') as account_type,
                COALESCE(u.status, 'active') as status,
                COALESCE(u.email_verified, 0) as email_verified,
                COALESCE(u.totp_enabled, 0) as totp_enabled,
                COALESCE(u.credit_balance, 0) as credit_balance,
                u.remote_domain,
                u.created_at,
                (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) as post_count,
                (SELECT COUNT(*) FROM content_reports r WHERE r.target_user_id = u.id) as report_count,
                (SELECT COUNT(*) FROM content_reports r WHERE r.target_user_id = u.id AND r.status = 'resolved') as resolved_violation_count
         FROM users u
         ${whereSql}
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AdminUserSummaryRow[];

    return {
      users,
      total,
      statusBreakdown: {
        active: Number(breakdownRow?.active ?? 0),
        frozen: Number(breakdownRow?.frozen ?? 0),
        suspended: Number(breakdownRow?.suspended ?? 0),
        admins: Number(breakdownRow?.admins ?? 0),
        moderators: Number(breakdownRow?.moderators ?? 0),
        auditors: Number(breakdownRow?.auditors ?? 0),
      },
    };
  }

  moderateUserAccount(
    userId: number,
    options: {
      status?: "active" | "frozen" | "suspended" | "pending_verification" | undefined;
      role?: "user" | "moderator" | "auditor" | "admin" | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
    },
  ): {
    success: boolean;
    purgedPostCount: number;
    sessionsRevoked: boolean;
  } {
    const user = this.getUserById(userId);
    if (!user) {
      return { success: false, purgedPostCount: 0, sessionsRevoked: false };
    }

    if (options.status) {
      this.#db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(options.status, userId);
    }
    if (options.role) {
      this.#db.prepare(`UPDATE users SET account_type = ? WHERE id = ?`).run(options.role, userId);
    }

    const shouldRevoke =
      Boolean(options.revokeSessions) || options.status === "suspended" || options.status === "frozen";
    if (shouldRevoke) {
      this.#db.prepare(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?`).run(userId);
    }

    let purgedPostCount = 0;
    if (options.purgePosts) {
      const userPostIds = this.#db.prepare(`SELECT id FROM posts WHERE author_id = ?`).all(userId) as {
        id: number;
      }[];
      for (const p of userPostIds) {
        if (this.deletePost(p.id).success) {
          purgedPostCount++;
        }
      }
    }

    return {
      success: true,
      purgedPostCount,
      sessionsRevoked: shouldRevoke,
    };
  }

  adjustUserCreditsForAdmin(
    userId: number,
    deltaCredits: number,
    reason: string,
  ): {
    success: boolean;
    userId: number;
    previousBalance: number;
    newBalance: number;
  } {
    const user = this.getUserById(userId);
    if (!user) {
      return { success: false, userId, previousBalance: 0, newBalance: 0 };
    }
    const previousBalance = Number(user.credit_balance ?? 0);
    const newBalance = Math.max(0, Number((previousBalance + deltaCredits).toFixed(4)));
    const txType = deltaCredits >= 0 ? "admin_grant" : "admin_deduction";

    const tx = this.#db.transaction(() => {
      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);
      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, amount, balance_after, type, description)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(userId, deltaCredits, newBalance, txType, reason || "Administrator compute wallet adjustment");
    });
    tx();

    return {
      success: true,
      userId,
      previousBalance,
      newBalance,
    };
  }

  static #hashAuditIpToken(ipAddress?: string | null): string {
    if (!ipAddress) return "";
    if (ipAddress.startsWith("REDACTED:")) {
      return ipAddress.slice("REDACTED:".length);
    }
    return crypto.createHash("sha256").update(`msx-audit-ip-v1:${ipAddress}`).digest("hex").slice(0, 16);
  }

  logAudit(data: {
    actorId?: number | null | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | null | undefined;
    ipAddress?: string | null | undefined;
    details?: Record<string, unknown> | string | undefined;
  }): void {
    const detailsStr = typeof data.details === "object" ? JSON.stringify(data.details) : (data.details ?? null);
    try {
      const insertAuditTx = this.#db.transaction(() => {
        const prevRow = this.#db
          .prepare(`SELECT entry_hash FROM audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1`)
          .get() as { entry_hash: string } | undefined;
        const prevHash = prevRow?.entry_hash || "GENESIS";
        const ipToken = LibraryDatabase.#hashAuditIpToken(data.ipAddress);
        const actorIdStr =
          typeof data.actorId === "number" && Number.isFinite(data.actorId) ? String(data.actorId) : "";
        const rawResourceId = data.resourceId ? String(data.resourceId) : "";
        const resourceIdStr = rawResourceId.replace(/[^a-zA-Z0-9_.-]/g, "");
        const canonicalPayload = [
          prevHash,
          actorIdStr,
          data.action,
          data.resourceType,
          resourceIdStr,
          ipToken,
          detailsStr ?? "",
        ].join("|");
        const auditSecret = process.env["AUDIT_HMAC_SECRET"]?.trim() || "msx-audit-chain-v1";
        const entryHash = crypto.createHmac("sha256", auditSecret).update(canonicalPayload).digest("hex");

        this.#db
          .prepare(
            `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.actorId ?? null,
            data.action,
            data.resourceType,
            data.resourceId ?? null,
            data.ipAddress ?? null,
            detailsStr,
            prevHash,
            entryHash,
          );

        if (
          this.#auditChainCache &&
          this.#auditChainCache.valid &&
          this.#auditChainCache.secretUsed === auditSecret &&
          (this.#auditChainCache.headHash ?? "GENESIS") === prevHash
        ) {
          this.#auditChainCache = {
            valid: true,
            totalEntries: this.#auditChainCache.totalEntries + 1,
            verifiedEntries: this.#auditChainCache.verifiedEntries + 1,
            headHash: entryHash,
            secretUsed: auditSecret,
          };
        } else {
          this.#auditChainCache = null;
        }
      });
      insertAuditTx.immediate();
    } catch (e) {
      this.#auditChainCache = null;
      console.error("[AuditLog] Failed to insert audit log entry:", e);
    }
  }

  verifyAuditLogChain(): {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    headHash: string | null;
    brokenAtId?: number | undefined;
  } {
    const auditSecret = process.env["AUDIT_HMAC_SECRET"]?.trim() || "msx-audit-chain-v1";
    if (this.#auditChainCache && this.#auditChainCache.secretUsed === auditSecret) {
      const { secretUsed: _s, ...cached } = this.#auditChainCache;
      return { ...cached };
    }

    const rows = this.#db
      .prepare(
        `SELECT id, actor_id, action, resource_type, resource_id, ip_address, details, prev_hash, entry_hash
         FROM audit_logs
         ORDER BY id ASC`,
      )
      .all() as AuditLogRow[];

    let verifiedEntries = 0;
    let expectedPrevHash: string | null = null;
    let headHash: string | null = null;

    for (const row of rows) {
      if (!row.entry_hash) {
        continue;
      }
      const prevHash: string = expectedPrevHash ?? row.prev_hash ?? "GENESIS";
      if (expectedPrevHash !== null && row.prev_hash !== expectedPrevHash) {
        const brokenResult = {
          valid: false,
          totalEntries: rows.length,
          verifiedEntries,
          headHash,
          brokenAtId: row.id,
        };
        this.#auditChainCache = { ...brokenResult, secretUsed: auditSecret };
        return { ...brokenResult };
      }
      const ipToken = LibraryDatabase.#hashAuditIpToken(row.ip_address);
      const tokenPayload: string = [
        prevHash,
        String(row.actor_id ?? ""),
        row.action,
        row.resource_type,
        String(row.resource_id ?? ""),
        ipToken,
        row.details ?? "",
      ].join("|");
      const recomputedHmac: string = crypto.createHmac("sha256", auditSecret).update(tokenPayload).digest("hex");
      const recomputedDefaultHmac: string =
        auditSecret !== "msx-audit-chain-v1"
          ? crypto.createHmac("sha256", "msx-audit-chain-v1").update(tokenPayload).digest("hex")
          : recomputedHmac;
      const recomputedTokenHash: string = crypto.createHash("sha256").update(tokenPayload).digest("hex");

      const legacyPayload: string = [
        prevHash,
        String(row.actor_id ?? ""),
        row.action,
        row.resource_type,
        String(row.resource_id ?? ""),
        String(row.ip_address ?? ""),
        row.details ?? "",
      ].join("|");
      const recomputedLegacyHash: string = crypto.createHash("sha256").update(legacyPayload).digest("hex");

      if (
        recomputedHmac !== row.entry_hash &&
        recomputedDefaultHmac !== row.entry_hash &&
        recomputedTokenHash !== row.entry_hash &&
        recomputedLegacyHash !== row.entry_hash
      ) {
        const brokenResult = {
          valid: false,
          totalEntries: rows.length,
          verifiedEntries,
          headHash,
          brokenAtId: row.id,
        };
        this.#auditChainCache = { ...brokenResult, secretUsed: auditSecret };
        return { ...brokenResult };
      }
      verifiedEntries++;
      expectedPrevHash = row.entry_hash;
      headHash = row.entry_hash;
    }

    const validResult = {
      valid: true,
      totalEntries: rows.length,
      verifiedEntries,
      headHash,
    };
    this.#auditChainCache = { ...validResult, secretUsed: auditSecret };
    return { ...validResult };
  }

  getAuditLogs(limit: number = 50, offset: number = 0, action?: string, resourceType?: string): AuditLogRow[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (action && action.trim()) {
      clauses.push(`(a.action = ? OR LOWER(a.action) LIKE ?)`);
      params.push(action.trim(), `%${action.trim().toLowerCase()}%`);
    }
    if (resourceType && resourceType.trim() && resourceType !== "all") {
      clauses.push(`a.resource_type = ?`);
      params.push(resourceType.trim());
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.#db
      .prepare(
        `SELECT a.*, u.username as actor_username
         FROM audit_logs a
         LEFT JOIN users u ON a.actor_id = u.id
         ${whereSql}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as AuditLogRow[];
  }

  /**
   * GDPR / Security Compliance: Redacts raw IP addresses on audit log entries
   * older than the specified retention window (default: 30 days) while preserving
   * the cryptographic SHA-256 hash chain (`REDACTED:<ipToken>`).
   */
  purgeExpiredLogs(retentionDays: number = 30): { deletedCount: number; redactedCount: number } {
    const cutoffMs = retentionDays <= 0 ? Date.now() + 60_000 : Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(cutoffMs).toISOString().replace("T", " ").slice(0, 19);
    const expiredRows = this.#db
      .prepare(
        `SELECT id, ip_address FROM audit_logs
         WHERE created_at <= ? AND ip_address IS NOT NULL AND ip_address != '' AND ip_address NOT LIKE 'REDACTED:%'`,
      )
      .all(cutoffDate) as { id: number; ip_address: string }[];

    let redactedCount = 0;
    const updateStmt = this.#db.prepare(`UPDATE audit_logs SET ip_address = ? WHERE id = ?`);
    const tx = this.#db.transaction(() => {
      for (const row of expiredRows) {
        const token = LibraryDatabase.#hashAuditIpToken(row.ip_address);
        updateStmt.run(`REDACTED:${token}`, row.id);
        redactedCount++;
      }
    });
    tx();
    this.#auditChainCache = null;
    return { deletedCount: redactedCount, redactedCount };
  }

  getAuditLogsCount(action?: string, resourceType?: string): number {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (action && action.trim()) {
      clauses.push(`(a.action = ? OR LOWER(a.action) LIKE ?)`);
      params.push(action.trim(), `%${action.trim().toLowerCase()}%`);
    }
    if (resourceType && resourceType.trim() && resourceType !== "all") {
      clauses.push(`a.resource_type = ?`);
      params.push(resourceType.trim());
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.#db.prepare(`SELECT COUNT(*) as c FROM audit_logs a ${whereSql}`).get(...params) as
      | { c: number }
      | undefined;
    return row?.c ?? 0;
  }

  // ── Instance Settings, Invites & System Diagnostics ──────────────

  getInstanceSettings(): {
    instanceName: string;
    instanceBadge: string;
    instanceTagline: string;
    instanceDescription: string;
    contactEmail: string;
    brandLogoUrl: string;
    brandLogoDarkUrl: string;
    brandFaviconUrl: string;
    brandAccentColor: string;
    docsBaseUrl: string;
    showPoweredBy: boolean;
    registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
    allowedEmailDomains: string[];
    federationMode: "open" | "allowlist" | "disabled" | "mesh" | "consortium";
    maintenanceMode: boolean;
    maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown";
    maintenanceEta: string;
    maintenanceStartedAt: string;
    announcementBanner: string;
    announcementLevel: "info" | "warning" | "critical";
    autoQuarantineReportThreshold: number;
    backupRetentionCount: number;
    autoBackupIntervalHours: number;
    autoFilterKeywords: string[];
    autoFilterAction: "cw" | "silence" | "quarantine";
    customTermsMarkdown: string;
    customPrivacyMarkdown: string;
    requireAdmin2FA: boolean;
    waitlistEnabled: boolean;
    userInvitesEnabled: boolean;
    userDefaultInviteCount: number;
    academicFastTrackEnabled: boolean;
    academicDomainPatterns: string[];
    onboardingWizardEnabled: boolean;
    ingressMode: "direct" | "cloudflare";
    cloudflareTunnelConfigured: boolean;
    authorizedFetchEnabled: boolean;
    federatedTimelinePublic: boolean;
    domainBlocksPublic: boolean;
    trendingRequiresApproval: boolean;
    remoteContentRetentionDays: number;
    remoteMediaCacheRetentionDays: number;
    autoCircuitBreakThreshold: number;
    artifactCdnHost: string;
    lockedByEnv: string[];
  } {
    const rows = this.#db.prepare(`SELECT key, value FROM instance_settings`).all() as { key: string; value: string }[];
    const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));

    const lockedByEnv: string[] = [];
    if (process.env["MSX_INSTANCE_NAME"]) lockedByEnv.push("instanceName");
    if (process.env["MSX_INSTANCE_BADGE"] !== undefined) lockedByEnv.push("instanceBadge");
    if (process.env["MSX_INSTANCE_TAGLINE"]) lockedByEnv.push("instanceTagline");
    if (process.env["MSX_BRAND_LOGO_URL"]) lockedByEnv.push("brandLogoUrl");
    if (process.env["MSX_BRAND_LOGO_DARK_URL"]) lockedByEnv.push("brandLogoDarkUrl");
    if (process.env["MSX_BRAND_FAVICON_URL"]) lockedByEnv.push("brandFaviconUrl");
    if (process.env["MSX_BRAND_ACCENT_COLOR"]) lockedByEnv.push("brandAccentColor");
    if (process.env["MSX_DOCS_BASE_URL"]) lockedByEnv.push("docsBaseUrl");
    if (process.env["MSX_SHOW_POWERED_BY"] !== undefined) lockedByEnv.push("showPoweredBy");
    if (process.env["MSX_REGISTRATION_MODE"]) lockedByEnv.push("registrationMode");
    if (process.env["MSX_ALLOWED_EMAIL_DOMAINS"] || process.env["ALLOWED_EMAIL_DOMAINS"]) {
      lockedByEnv.push("allowedEmailDomains");
    }
    if (
      process.env["MSX_FEDERATION_MODE"] ||
      process.env["FEDERATION_MODE"] ||
      process.env["AIRGAP_ENFORCED"] === "true" ||
      process.env["ENTERPRISE_APPLIANCE"] === "true"
    ) {
      lockedByEnv.push("federationMode");
    }
    if (process.env["MSX_REQUIRE_ADMIN_2FA"] !== undefined) lockedByEnv.push("requireAdmin2FA");
    if (process.env["MSX_WAITLIST_ENABLED"] !== undefined) lockedByEnv.push("waitlistEnabled");
    if (process.env["MSX_USER_INVITES_ENABLED"] !== undefined) lockedByEnv.push("userInvitesEnabled");
    if (process.env["MSX_USER_DEFAULT_INVITES"] !== undefined) lockedByEnv.push("userDefaultInviteCount");
    if (process.env["MSX_ACADEMIC_FAST_TRACK"] !== undefined) lockedByEnv.push("academicFastTrackEnabled");
    if (process.env["MSX_ONBOARDING_WIZARD_ENABLED"] !== undefined) lockedByEnv.push("onboardingWizardEnabled");
    if (process.env["MSX_INGRESS_MODE"]) lockedByEnv.push("ingressMode");
    if (process.env["MSX_MAINTENANCE_MODE"] !== undefined) {
      lockedByEnv.push("maintenanceMode", "maintenanceLevel");
    }
    if (process.env["MSX_AUTHORIZED_FETCH"] !== undefined || process.env["AUTHORIZED_FETCH"] !== undefined) {
      lockedByEnv.push("authorizedFetchEnabled");
    }

    const storedTunnelToken = (map.get("cloudflare_tunnel_token") || map.get("tunnelToken") || "").trim();
    const envTunnelToken = (process.env["CLOUDFLARE_TUNNEL_TOKEN"] || "").trim();
    const cloudflareTunnelConfigured = Boolean(envTunnelToken || storedTunnelToken);
    const rawIngressMode = (
      process.env["MSX_INGRESS_MODE"] ||
      map.get("ingress_mode") ||
      map.get("ingressMode") ||
      (cloudflareTunnelConfigured ? "cloudflare" : "direct")
    )
      .trim()
      .toLowerCase();
    const ingressMode: "direct" | "cloudflare" = rawIngressMode === "cloudflare" ? "cloudflare" : "direct";

    const rawRegMode = process.env["MSX_REGISTRATION_MODE"] || map.get("registrationMode") || "open";
    const registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed" =
      rawRegMode === "invite_only" || rawRegMode === "domain_allowlist" || rawRegMode === "closed"
        ? rawRegMode
        : "open";

    const isAirgapDefault = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";
    const rawFedMode =
      process.env["MSX_FEDERATION_MODE"] ||
      process.env["FEDERATION_MODE"] ||
      map.get("federationMode") ||
      (isAirgapDefault ? "disabled" : "open");
    const federationMode: "open" | "allowlist" | "disabled" | "mesh" | "consortium" =
      rawFedMode === "allowlist" || rawFedMode === "disabled" || rawFedMode === "mesh" || rawFedMode === "consortium"
        ? rawFedMode
        : "open";

    let allowedEmailDomains: string[] = [];
    try {
      const rawDomains =
        process.env["MSX_ALLOWED_EMAIL_DOMAINS"] ||
        process.env["ALLOWED_EMAIL_DOMAINS"] ||
        map.get("allowedEmailDomains") ||
        "[]";
      if (rawDomains.trim().startsWith("[")) {
        const parsed = JSON.parse(rawDomains);
        if (Array.isArray(parsed)) {
          allowedEmailDomains = parsed.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
        }
      } else {
        allowedEmailDomains = rawDomains
          .split(/[,\s]+/)
          .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
          .filter(Boolean);
      }
    } catch {
      allowedEmailDomains = [];
    }

    let autoFilterKeywords: string[] = [];
    try {
      const rawKeywords = map.get("autoFilterKeywords") || "[]";
      if (rawKeywords.trim().startsWith("[")) {
        const parsed = JSON.parse(rawKeywords);
        if (Array.isArray(parsed)) {
          autoFilterKeywords = parsed.map((k) => String(k).trim()).filter(Boolean);
        }
      } else {
        autoFilterKeywords = rawKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
      }
    } catch {
      autoFilterKeywords = [];
    }

    const rawFilterAction = map.get("autoFilterAction") || "cw";
    const autoFilterAction: "cw" | "silence" | "quarantine" =
      rawFilterAction === "silence" || rawFilterAction === "quarantine" ? rawFilterAction : "cw";

    const rawLevel = map.get("announcementLevel") || "info";
    const announcementLevel: "info" | "warning" | "critical" =
      rawLevel === "warning" || rawLevel === "critical" ? rawLevel : "info";

    const rawAutoBackup = map.get("autoBackupIntervalHours");
    const parsedAutoBackup = rawAutoBackup !== undefined ? Number.parseInt(rawAutoBackup, 10) : 24;

    const airgapDefaultDocs =
      process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true"
        ? "/docs"
        : "https://modelscript.org";

    const showPoweredBy =
      process.env["MSX_SHOW_POWERED_BY"] !== undefined
        ? process.env["MSX_SHOW_POWERED_BY"] !== "false"
        : map.has("showPoweredBy")
          ? map.get("showPoweredBy") !== "false"
          : true;

    const envMaint = process.env["MSX_MAINTENANCE_MODE"]?.trim().toLowerCase();
    const dbMaintBool = map.get("maintenanceMode") === "true";
    const dbMaintLevel = map.get("maintenanceLevel") || (dbMaintBool ? "read_only" : "off");

    let maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown" = "off";
    if (envMaint !== undefined && envMaint !== "") {
      if (envMaint === "lockdown" || envMaint === "hard") {
        maintenanceLevel = "lockdown";
      } else if (envMaint === "scheduled") {
        maintenanceLevel = "scheduled";
      } else if (envMaint === "true" || envMaint === "1" || envMaint === "read_only" || envMaint === "readonly") {
        maintenanceLevel = "read_only";
      } else {
        maintenanceLevel = "off";
      }
    } else if (dbMaintLevel === "scheduled" || dbMaintLevel === "read_only" || dbMaintLevel === "lockdown") {
      maintenanceLevel = dbMaintLevel;
    } else if (dbMaintBool) {
      maintenanceLevel = "read_only";
    }

    const maintenanceMode = maintenanceLevel === "read_only" || maintenanceLevel === "lockdown";

    const waitlistEnabled =
      process.env["MSX_WAITLIST_ENABLED"] !== undefined
        ? process.env["MSX_WAITLIST_ENABLED"] === "true"
        : map.get("waitlistEnabled") === "true";

    const userInvitesEnabled =
      process.env["MSX_USER_INVITES_ENABLED"] !== undefined
        ? process.env["MSX_USER_INVITES_ENABLED"] === "true"
        : map.get("userInvitesEnabled") === "true";

    const userDefaultInviteCount = Math.max(
      0,
      Number.parseInt(process.env["MSX_USER_DEFAULT_INVITES"] || map.get("userDefaultInviteCount") || "5", 10) || 5,
    );

    const academicFastTrackEnabled =
      process.env["MSX_ACADEMIC_FAST_TRACK"] !== undefined
        ? process.env["MSX_ACADEMIC_FAST_TRACK"] === "true"
        : map.get("academicFastTrackEnabled") === "true";

    let academicDomainPatterns: string[] = ["edu", "ac.uk", "dlr.de", "nasa.gov", "cern.ch"];
    try {
      const rawAcademic = map.get("academicDomainPatterns");
      if (rawAcademic) {
        if (rawAcademic.trim().startsWith("[")) {
          const parsed = JSON.parse(rawAcademic);
          if (Array.isArray(parsed)) {
            academicDomainPatterns = parsed.map((p) => String(p).trim().toLowerCase()).filter(Boolean);
          }
        } else {
          academicDomainPatterns = rawAcademic
            .split(/[,\s]+/)
            .map((p) => p.trim().toLowerCase().replace(/^@/, ""))
            .filter(Boolean);
        }
      }
    } catch {
      // Keep default
    }

    const onboardingWizardEnabled =
      process.env["MSX_ONBOARDING_WIZARD_ENABLED"] !== undefined
        ? process.env["MSX_ONBOARDING_WIZARD_ENABLED"] === "true"
        : map.get("onboardingWizardEnabled") === "true";

    const rawAuthFetch =
      process.env["MSX_AUTHORIZED_FETCH"] ?? process.env["AUTHORIZED_FETCH"] ?? map.get("authorizedFetchEnabled");
    const authorizedFetchEnabled = rawAuthFetch === "true" || rawAuthFetch === "1";

    const rawFedTimelinePublic = process.env["MSX_FEDERATED_TIMELINE_PUBLIC"] ?? map.get("federatedTimelinePublic");
    const federatedTimelinePublic = rawFedTimelinePublic !== undefined ? rawFedTimelinePublic !== "false" : true;

    const rawDomainBlocksPublic = process.env["MSX_DOMAIN_BLOCKS_PUBLIC"] ?? map.get("domainBlocksPublic");
    const domainBlocksPublic = rawDomainBlocksPublic !== undefined ? rawDomainBlocksPublic !== "false" : true;

    const rawTrendingApproval = process.env["MSX_TRENDING_REQUIRES_APPROVAL"] ?? map.get("trendingRequiresApproval");
    const trendingRequiresApproval = rawTrendingApproval === "true" || rawTrendingApproval === "1";

    const remoteContentRetentionDays = Math.max(
      0,
      Number.parseInt(map.get("remoteContentRetentionDays") || "90", 10) || 90,
    );
    const remoteMediaCacheRetentionDays = Math.max(
      0,
      Number.parseInt(map.get("remoteMediaCacheRetentionDays") || "14", 10) || 14,
    );
    const autoCircuitBreakThreshold = Math.max(
      0,
      Number.parseInt(map.get("autoCircuitBreakThreshold") || "5", 10) || 5,
    );
    const artifactCdnHost = (process.env["MSX_ARTIFACT_CDN_HOST"] || map.get("artifactCdnHost") || "").trim();

    return {
      instanceName:
        process.env["ANSATZ_INSTANCE_NAME"] || process.env["MSX_INSTANCE_NAME"] || map.get("instanceName") || "Ansatz",
      instanceBadge:
        process.env["ANSATZ_INSTANCE_BADGE"] ?? process.env["MSX_INSTANCE_BADGE"] ?? map.get("instanceBadge") ?? "",
      instanceTagline:
        process.env["ANSATZ_INSTANCE_TAGLINE"] ||
        process.env["MSX_INSTANCE_TAGLINE"] ||
        map.get("instanceTagline") ||
        "The Federated Scientific & Engineering Network",
      instanceDescription:
        map.get("instanceDescription") ||
        "Federated polyglot engineering simulation, Modelica, SysML v2, and digital twin platform.",
      contactEmail:
        process.env["ANSATZ_CONTACT_EMAIL"] ||
        process.env["MSX_CONTACT_EMAIL"] ||
        map.get("contactEmail") ||
        "admin@ansatz.social",
      brandLogoUrl:
        process.env["ANSATZ_BRAND_LOGO_URL"] || process.env["MSX_BRAND_LOGO_URL"] || map.get("brandLogoUrl") || "",
      brandLogoDarkUrl:
        process.env["ANSATZ_BRAND_LOGO_DARK_URL"] ||
        process.env["MSX_BRAND_LOGO_DARK_URL"] ||
        map.get("brandLogoDarkUrl") ||
        "",
      brandFaviconUrl:
        process.env["ANSATZ_BRAND_FAVICON_URL"] ||
        process.env["MSX_BRAND_FAVICON_URL"] ||
        map.get("brandFaviconUrl") ||
        "",
      brandAccentColor:
        process.env["ANSATZ_BRAND_ACCENT_COLOR"] ||
        process.env["MSX_BRAND_ACCENT_COLOR"] ||
        map.get("brandAccentColor") ||
        "",
      docsBaseUrl: process.env["MSX_DOCS_BASE_URL"] || map.get("docsBaseUrl") || airgapDefaultDocs,
      showPoweredBy,
      registrationMode,
      allowedEmailDomains,
      federationMode,
      maintenanceMode,
      maintenanceLevel,
      maintenanceEta: process.env["MSX_MAINTENANCE_ETA"] || map.get("maintenanceEta") || "",
      maintenanceStartedAt: map.get("maintenanceStartedAt") || "",
      announcementBanner: map.get("announcementBanner") || "",
      announcementLevel,
      autoQuarantineReportThreshold: Math.max(
        0,
        Number.parseInt(map.get("autoQuarantineReportThreshold") || "5", 10) || 5,
      ),
      backupRetentionCount: Math.max(1, Number.parseInt(map.get("backupRetentionCount") || "7", 10) || 7),
      autoBackupIntervalHours: Number.isNaN(parsedAutoBackup) ? 24 : Math.max(0, parsedAutoBackup),
      autoFilterKeywords,
      autoFilterAction,
      customTermsMarkdown: map.get("customTermsMarkdown") || "",
      customPrivacyMarkdown: map.get("customPrivacyMarkdown") || "",
      requireAdmin2FA:
        process.env["MSX_REQUIRE_ADMIN_2FA"] !== undefined
          ? process.env["MSX_REQUIRE_ADMIN_2FA"] === "true"
          : map.get("requireAdmin2FA") === "true",
      waitlistEnabled,
      userInvitesEnabled,
      userDefaultInviteCount,
      academicFastTrackEnabled,
      academicDomainPatterns,
      onboardingWizardEnabled,
      ingressMode,
      cloudflareTunnelConfigured,
      authorizedFetchEnabled,
      federatedTimelinePublic,
      domainBlocksPublic,
      trendingRequiresApproval,
      remoteContentRetentionDays,
      remoteMediaCacheRetentionDays,
      autoCircuitBreakThreshold,
      artifactCdnHost,
      lockedByEnv,
    };
  }

  getMaintenanceState(): {
    mode: "off" | "scheduled" | "read_only" | "lockdown";
    active: boolean;
    eta: string;
    startedAt: string;
    banner: string;
  } {
    const settings = this.getInstanceSettings();
    return {
      mode: settings.maintenanceLevel,
      active: settings.maintenanceMode,
      eta: settings.maintenanceEta,
      startedAt: settings.maintenanceStartedAt,
      banner: settings.announcementBanner,
    };
  }

  updateInstanceSettings(
    patch: Record<string, unknown>,
    actorId: number | null = null,
  ): ReturnType<LibraryDatabase["getInstanceSettings"]> {
    const normalizedPatch: Record<string, unknown> = { ...patch };

    const rawIngressPatch = normalizedPatch["ingressMode"] ?? normalizedPatch["ingress_mode"];
    if (rawIngressPatch !== undefined) {
      const modeVal = String(rawIngressPatch).trim().toLowerCase() === "cloudflare" ? "cloudflare" : "direct";
      normalizedPatch["ingressMode"] = modeVal;
      normalizedPatch["ingress_mode"] = modeVal;
    }

    const rawTunnelTokenPatch = normalizedPatch["tunnelToken"] ?? normalizedPatch["cloudflare_tunnel_token"];
    if (rawTunnelTokenPatch !== undefined) {
      const tokenVal = String(rawTunnelTokenPatch).trim();
      normalizedPatch["cloudflare_tunnel_token"] = tokenVal;
      delete normalizedPatch["tunnelToken"];
    }

    // Synchronize maintenanceMode boolean and maintenanceLevel enum seamlessly
    if (normalizedPatch["maintenanceLevel"] !== undefined) {
      const lvl = String(normalizedPatch["maintenanceLevel"]);
      if (lvl === "read_only" || lvl === "lockdown") {
        normalizedPatch["maintenanceMode"] = true;
        if (!normalizedPatch["maintenanceStartedAt"]) {
          const prev = this.getInstanceSettings();
          if (!prev.maintenanceMode) {
            normalizedPatch["maintenanceStartedAt"] = new Date().toISOString();
          }
        }
      } else {
        normalizedPatch["maintenanceMode"] = false;
        if (lvl === "off") {
          normalizedPatch["maintenanceStartedAt"] = "";
        }
      }
    } else if (normalizedPatch["maintenanceMode"] !== undefined) {
      const enabled = Boolean(normalizedPatch["maintenanceMode"]);
      const prev = this.getInstanceSettings();
      if (enabled) {
        if (prev.maintenanceLevel !== "lockdown") {
          normalizedPatch["maintenanceLevel"] = "read_only";
        }
        if (!prev.maintenanceMode && !normalizedPatch["maintenanceStartedAt"]) {
          normalizedPatch["maintenanceStartedAt"] = new Date().toISOString();
        }
      } else {
        normalizedPatch["maintenanceLevel"] = "off";
        normalizedPatch["maintenanceStartedAt"] = "";
      }
    }

    const allowedKeys = [
      "instanceName",
      "instanceBadge",
      "instanceTagline",
      "instanceDescription",
      "contactEmail",
      "brandLogoUrl",
      "brandLogoDarkUrl",
      "brandFaviconUrl",
      "brandAccentColor",
      "docsBaseUrl",
      "showPoweredBy",
      "registrationMode",
      "allowedEmailDomains",
      "federationMode",
      "maintenanceMode",
      "maintenanceLevel",
      "maintenanceEta",
      "maintenanceStartedAt",
      "announcementBanner",
      "announcementLevel",
      "autoQuarantineReportThreshold",
      "backupRetentionCount",
      "autoBackupIntervalHours",
      "autoFilterKeywords",
      "autoFilterAction",
      "customTermsMarkdown",
      "customPrivacyMarkdown",
      "requireAdmin2FA",
      "waitlistEnabled",
      "userInvitesEnabled",
      "userDefaultInviteCount",
      "academicFastTrackEnabled",
      "academicDomainPatterns",
      "onboardingWizardEnabled",
      "ingressMode",
      "ingress_mode",
      "cloudflare_tunnel_token",
      "authorizedFetchEnabled",
      "federatedTimelinePublic",
      "domainBlocksPublic",
      "trendingRequiresApproval",
      "remoteContentRetentionDays",
      "remoteMediaCacheRetentionDays",
      "autoCircuitBreakThreshold",
      "artifactCdnHost",
    ];
    const upsertStmt = this.#db.prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    );

    const tx = this.#db.transaction(() => {
      for (const key of allowedKeys) {
        if (normalizedPatch[key] === undefined) continue;
        const val = normalizedPatch[key];
        const serialized = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
        upsertStmt.run(key, serialized, actorId);
      }
    });
    tx();
    this.syncMailerFromDatabase();
    return this.getInstanceSettings();
  }

  public syncMailerFromDatabase(): void {
    try {
      const rows = this.#db.prepare(`SELECT key, value FROM instance_settings`).all() as {
        key: string;
        value: string;
      }[];
      const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
      const instanceSettings = this.getInstanceSettings();

      const rawDriver = (map.get("emailDriver") || "auto").trim().toLowerCase();
      const driver: MailerDriverPreference =
        rawDriver === "console" || rawDriver === "smtp" || rawDriver === "sendgrid" || rawDriver === "resend"
          ? rawDriver
          : "auto";

      const rawTls = (map.get("smtpTlsMode") || "starttls").trim().toLowerCase();
      const smtpTlsMode: SmtpTlsMode = rawTls === "implicit" || rawTls === "none" ? rawTls : "starttls";

      let smtpPass: string | undefined;
      const encSmtpPass = map.get("smtpPassEncrypted");
      if (encSmtpPass) {
        try {
          smtpPass = decryptSecretAtRest(encSmtpPass);
        } catch {}
      }

      let sendgridApiKey: string | undefined;
      const encSendgrid = map.get("sendgridApiKeyEncrypted");
      if (encSendgrid) {
        try {
          sendgridApiKey = decryptSecretAtRest(encSendgrid);
        } catch {}
      }

      let resendApiKey: string | undefined;
      const encResend = map.get("resendApiKeyEncrypted");
      if (encResend) {
        try {
          resendApiKey = decryptSecretAtRest(encResend);
        } catch {}
      }

      let templates: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {};
      const rawTemplates = map.get("emailTemplatesJson");
      if (rawTemplates) {
        try {
          const parsed = JSON.parse(rawTemplates);
          if (parsed && typeof parsed === "object") {
            templates = parsed as Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
          }
        } catch {}
      }

      defaultMailer.configure({
        driver,
        fromName: map.get("emailFromName") || `${instanceSettings.instanceName} Security`,
        fromEmail: map.get("emailFromEmail") || "noreply@ansatz.social",
        replyTo: map.get("emailReplyTo") || instanceSettings.contactEmail || undefined,
        smtpHost: map.get("smtpHost") || undefined,
        smtpPort: map.get("smtpPort") ? Number.parseInt(map.get("smtpPort")!, 10) || 587 : 587,
        smtpUser: map.get("smtpUser") || undefined,
        smtpPass,
        smtpTlsMode,
        smtpTlsRejectUnauthorized: map.get("smtpTlsRejectUnauthorized") !== "false",
        smtpCaCertPath: map.get("smtpCaCertPath") || undefined,
        sendgridApiKey,
        resendApiKey,
        instanceName: instanceSettings.instanceName,
        theme: {
          headerBgColor: map.get("emailHeaderBgColor") || "#0f172a",
          accentColor: map.get("emailAccentColor") || instanceSettings.brandAccentColor || "#2563eb",
          logoUrl: map.get("emailLogoUrl") || instanceSettings.brandLogoUrl || "",
          footerText: map.get("emailFooterText") || "",
        },
        templates,
      });
    } catch {
      // Non-fatal if instance_settings is not yet initialized
    }
  }

  public getEmailConfig(): {
    driver: MailerDriverPreference;
    activeDriver: MailerDriver;
    configuredForLiveDelivery: boolean;
    airgapEnforced: boolean;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPassConfigured: boolean;
    smtpPassMasked: string;
    smtpTlsMode: SmtpTlsMode;
    smtpTlsRejectUnauthorized: boolean;
    smtpCaCertPath: string;
    sendgridApiKeyConfigured: boolean;
    sendgridApiKeyMasked: string;
    resendApiKeyConfigured: boolean;
    resendApiKeyMasked: string;
    theme: Required<EmailThemeConfig>;
    templates: Record<EmailTemplateId, EmailTemplateDefinition>;
    defaultTemplates: Record<EmailTemplateId, EmailTemplateDefinition>;
    templateOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
    lockedByEnv: string[];
  } {
    this.syncMailerFromDatabase();
    const rows = this.#db.prepare(`SELECT key, value FROM instance_settings`).all() as {
      key: string;
      value: string;
    }[];
    const map = new Map<string, string>(rows.map((r) => [r.key, r.value]));
    const instanceSettings = this.getInstanceSettings();

    const lockedByEnv: string[] = [];
    if (process.env["EMAIL_FROM"]) lockedByEnv.push("fromEmail", "fromName");
    if (process.env["EMAIL_REPLY_TO"]) lockedByEnv.push("replyTo");
    if (process.env["SMTP_HOST"]) lockedByEnv.push("smtpHost");
    if (process.env["SMTP_PORT"]) lockedByEnv.push("smtpPort");
    if (process.env["SMTP_USER"]) lockedByEnv.push("smtpUser");
    if (process.env["SMTP_PASS"]) lockedByEnv.push("smtpPass");
    if (process.env["SMTP_SECURE"] || process.env["SMTP_IGNORE_STARTTLS"]) lockedByEnv.push("smtpTlsMode");
    if (process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== undefined) lockedByEnv.push("smtpTlsRejectUnauthorized");
    if (process.env["SMTP_CA_CERT_PATH"]) lockedByEnv.push("smtpCaCertPath");
    if (process.env["SENDGRID_API_KEY"]) lockedByEnv.push("sendgridApiKey");
    if (process.env["RESEND_API_KEY"]) lockedByEnv.push("resendApiKey");

    const rawDriver = (map.get("emailDriver") || "auto").trim().toLowerCase();
    const driver: MailerDriverPreference =
      rawDriver === "console" || rawDriver === "smtp" || rawDriver === "sendgrid" || rawDriver === "resend"
        ? rawDriver
        : "auto";

    const smtpPort = Number.parseInt(process.env["SMTP_PORT"] || map.get("smtpPort") || "587", 10) || 587;
    const rawTls = (map.get("smtpTlsMode") || (smtpPort === 465 ? "implicit" : "starttls")).trim().toLowerCase();
    const smtpTlsMode: SmtpTlsMode =
      process.env["SMTP_SECURE"] === "true"
        ? "implicit"
        : process.env["SMTP_IGNORE_STARTTLS"] === "true"
          ? "none"
          : rawTls === "implicit" || rawTls === "none"
            ? rawTls
            : "starttls";

    const rawSmtpPass = process.env["SMTP_PASS"] || map.get("smtpPassEncrypted") || "";
    const rawSendgridKey = process.env["SENDGRID_API_KEY"] || map.get("sendgridApiKeyEncrypted") || "";
    const rawResendKey = process.env["RESEND_API_KEY"] || map.get("resendApiKeyEncrypted") || "";

    let templateOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {};
    const rawTemplates = map.get("emailTemplatesJson");
    if (rawTemplates) {
      try {
        const parsed = JSON.parse(rawTemplates);
        if (parsed && typeof parsed === "object") {
          templateOverrides = parsed as Partial<Record<EmailTemplateId, EmailTemplateOverride>>;
        }
      } catch {}
    }

    return {
      driver,
      activeDriver: defaultMailer.getDriver(),
      configuredForLiveDelivery: defaultMailer.isConfiguredForLiveDelivery(),
      airgapEnforced: process.env["AIRGAP_ENFORCED"] === "true",
      fromName: map.get("emailFromName") || `${instanceSettings.instanceName} Security`,
      fromEmail: process.env["EMAIL_FROM"] || map.get("emailFromEmail") || "noreply@ansatz.social",
      replyTo: process.env["EMAIL_REPLY_TO"] || map.get("emailReplyTo") || instanceSettings.contactEmail || "",
      smtpHost: process.env["SMTP_HOST"] || map.get("smtpHost") || "",
      smtpPort,
      smtpUser: process.env["SMTP_USER"] || map.get("smtpUser") || "",
      smtpPassConfigured: Boolean(rawSmtpPass),
      smtpPassMasked: maskSecretPreview(rawSmtpPass),
      smtpTlsMode,
      smtpTlsRejectUnauthorized:
        process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== undefined
          ? process.env["SMTP_TLS_REJECT_UNAUTHORIZED"] !== "false"
          : map.get("smtpTlsRejectUnauthorized") !== "false",
      smtpCaCertPath: process.env["SMTP_CA_CERT_PATH"] || map.get("smtpCaCertPath") || "",
      sendgridApiKeyConfigured: Boolean(rawSendgridKey),
      sendgridApiKeyMasked: maskSecretPreview(rawSendgridKey),
      resendApiKeyConfigured: Boolean(rawResendKey),
      resendApiKeyMasked: maskSecretPreview(rawResendKey),
      theme: {
        headerBgColor: map.get("emailHeaderBgColor") || "#0f172a",
        accentColor: map.get("emailAccentColor") || instanceSettings.brandAccentColor || "#2563eb",
        logoUrl: map.get("emailLogoUrl") || instanceSettings.brandLogoUrl || "",
        footerText: map.get("emailFooterText") || "",
      },
      templates: defaultMailer.getEffectiveTemplates(),
      defaultTemplates: defaultMailer.getDefaultTemplates(),
      templateOverrides,
      lockedByEnv,
    };
  }

  public updateEmailConfig(
    patch: Record<string, unknown>,
    actorId: number | null = null,
  ): ReturnType<LibraryDatabase["getEmailConfig"]> {
    const upsertStmt = this.#db.prepare(
      `INSERT INTO instance_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_by = excluded.updated_by,
         updated_at = datetime('now')`,
    );
    const deleteStmt = this.#db.prepare(`DELETE FROM instance_settings WHERE key = ?`);

    const current = this.getEmailConfig();
    let nextOverrides: Partial<Record<EmailTemplateId, EmailTemplateOverride>> = {
      ...current.templateOverrides,
    };

    const tx = this.#db.transaction(() => {
      if (typeof patch["driver"] === "string") {
        upsertStmt.run("emailDriver", patch["driver"].trim().toLowerCase(), actorId);
      }
      if (typeof patch["fromName"] === "string") {
        upsertStmt.run("emailFromName", patch["fromName"].trim(), actorId);
      }
      if (typeof patch["fromEmail"] === "string") {
        upsertStmt.run("emailFromEmail", patch["fromEmail"].trim(), actorId);
      }
      if (typeof patch["replyTo"] === "string") {
        upsertStmt.run("emailReplyTo", patch["replyTo"].trim(), actorId);
      }
      if (typeof patch["smtpHost"] === "string") {
        upsertStmt.run("smtpHost", patch["smtpHost"].trim(), actorId);
      }
      if (patch["smtpPort"] !== undefined) {
        const port = Math.max(1, Math.min(65535, Number.parseInt(String(patch["smtpPort"]), 10) || 587));
        upsertStmt.run("smtpPort", String(port), actorId);
      }
      if (typeof patch["smtpUser"] === "string") {
        upsertStmt.run("smtpUser", patch["smtpUser"].trim(), actorId);
      }
      if (typeof patch["smtpTlsMode"] === "string") {
        upsertStmt.run("smtpTlsMode", patch["smtpTlsMode"].trim().toLowerCase(), actorId);
      }
      if (patch["smtpTlsRejectUnauthorized"] !== undefined) {
        upsertStmt.run("smtpTlsRejectUnauthorized", String(Boolean(patch["smtpTlsRejectUnauthorized"])), actorId);
      }
      if (typeof patch["smtpCaCertPath"] === "string") {
        upsertStmt.run("smtpCaCertPath", patch["smtpCaCertPath"].trim(), actorId);
      }

      // Encrypted secrets at rest
      if (patch["clearSmtpPass"] === true) {
        deleteStmt.run("smtpPassEncrypted");
      } else if (typeof patch["smtpPass"] === "string" && patch["smtpPass"].trim()) {
        upsertStmt.run("smtpPassEncrypted", encryptSecretAtRest(patch["smtpPass"].trim()), actorId);
      }

      if (patch["clearSendgridApiKey"] === true) {
        deleteStmt.run("sendgridApiKeyEncrypted");
      } else if (typeof patch["sendgridApiKey"] === "string" && patch["sendgridApiKey"].trim()) {
        upsertStmt.run("sendgridApiKeyEncrypted", encryptSecretAtRest(patch["sendgridApiKey"].trim()), actorId);
      }

      if (patch["clearResendApiKey"] === true) {
        deleteStmt.run("resendApiKeyEncrypted");
      } else if (typeof patch["resendApiKey"] === "string" && patch["resendApiKey"].trim()) {
        upsertStmt.run("resendApiKeyEncrypted", encryptSecretAtRest(patch["resendApiKey"].trim()), actorId);
      }

      // Theme settings
      if (patch["theme"] && typeof patch["theme"] === "object") {
        const theme = patch["theme"] as Record<string, unknown>;
        if (typeof theme["headerBgColor"] === "string") {
          upsertStmt.run("emailHeaderBgColor", theme["headerBgColor"].trim(), actorId);
        }
        if (typeof theme["accentColor"] === "string") {
          upsertStmt.run("emailAccentColor", theme["accentColor"].trim(), actorId);
        }
        if (typeof theme["logoUrl"] === "string") {
          upsertStmt.run("emailLogoUrl", theme["logoUrl"].trim(), actorId);
        }
        if (typeof theme["footerText"] === "string") {
          upsertStmt.run("emailFooterText", theme["footerText"].trim(), actorId);
        }
      }

      // Template overrides & reset support
      if (typeof patch["resetTemplateId"] === "string") {
        const resetId = patch["resetTemplateId"] as EmailTemplateId;
        const { [resetId]: _removed, ...rest } = nextOverrides;
        nextOverrides = rest;
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), actorId);
      }
      if (patch["resetAllTemplates"] === true) {
        nextOverrides = {};
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), actorId);
      }
      if (patch["templates"] && typeof patch["templates"] === "object") {
        const incoming = patch["templates"] as Record<string, EmailTemplateOverride>;
        for (const [tplId, ov] of Object.entries(incoming)) {
          if (!ov || typeof ov !== "object") continue;
          const validIds: EmailTemplateId[] = [
            "verification",
            "password_reset",
            "invite",
            "security_alert",
            "social_notification",
            "digest",
          ];
          if (!validIds.includes(tplId as EmailTemplateId)) continue;
          nextOverrides[tplId as EmailTemplateId] = {
            ...(nextOverrides[tplId as EmailTemplateId] || {}),
            ...(ov.subject !== undefined ? { subject: String(ov.subject) } : {}),
            ...(ov.heading !== undefined ? { heading: String(ov.heading) } : {}),
            ...(ov.body !== undefined ? { body: String(ov.body) } : {}),
            ...(ov.ctaLabel !== undefined ? { ctaLabel: String(ov.ctaLabel) } : {}),
            ...(ov.enabled !== undefined ? { enabled: Boolean(ov.enabled) } : {}),
          };
        }
        upsertStmt.run("emailTemplatesJson", JSON.stringify(nextOverrides), actorId);
      }
    });

    tx();
    return this.getEmailConfig();
  }

  getPreflightChecks(): {
    allPassed: boolean;
    warningCount: number;
    checks: {
      id: string;
      label: string;
      status: "ok" | "warning" | "error";
      detail: string;
    }[];
  } {
    const checks: {
      id: string;
      label: string;
      status: "ok" | "warning" | "error";
      detail: string;
    }[] = [];

    // 1. Data directory writable
    let dataDirWritable = false;
    try {
      fs.accessSync(this.dbDir, fs.constants.W_OK);
      dataDirWritable = true;
    } catch {
      dataDirWritable = false;
    }
    checks.push({
      id: "data_dir_writable",
      label: "Data Volume Writable",
      status: dataDirWritable ? "ok" : "error",
      detail: dataDirWritable
        ? `SQLite directory '${this.dbDir}' is writable.`
        : `Directory '${this.dbDir}' is not writable.`,
    });

    // 2. SQLite WAL mode
    let walEnabled = false;
    try {
      const mode = String(this.#db.pragma("journal_mode", { simple: true }) || "").toLowerCase();
      walEnabled = mode === "wal" || mode === "memory";
    } catch {
      walEnabled = false;
    }
    checks.push({
      id: "sqlite_wal",
      label: "SQLite WAL Journal Mode",
      status: walEnabled ? "ok" : "warning",
      detail: walEnabled
        ? "Write-Ahead Logging (WAL) is active for concurrent reads and hot backups."
        : "SQLite is not running in WAL mode.",
    });

    // 3. PUBLIC_URL configured
    const publicUrl = process.env["PUBLIC_URL"] || "";
    const isHttpsPublicUrl = publicUrl.startsWith("https://") && !publicUrl.includes("localhost");
    checks.push({
      id: "public_url",
      label: "Public Origin URL (PUBLIC_URL)",
      status: isHttpsPublicUrl ? "ok" : "warning",
      detail: isHttpsPublicUrl
        ? `Configured as '${publicUrl}'.`
        : publicUrl
          ? `Set to '${publicUrl}' (HTTPS domain recommended for ActivityPub federation).`
          : "PUBLIC_URL env var not set; defaulting to https://ansatz.social.",
    });

    // 4. JWT_SECRET hardened
    const jwtSecret = process.env["JWT_SECRET"] || "";
    const jwtHardened = jwtSecret.length >= 24 && !jwtSecret.includes("dev-secret");
    checks.push({
      id: "jwt_secret",
      label: "JWT Session Signing Secret",
      status: jwtHardened ? "ok" : "warning",
      detail: jwtHardened
        ? "Custom high-entropy JWT_SECRET is configured."
        : "Using default development JWT secret; set JWT_SECRET (>= 32 chars) in production.",
    });

    // 5. Outbound Mailer configured
    const mailerConfigured = Boolean(
      process.env["SMTP_HOST"] || process.env["SENDGRID_API_KEY"] || process.env["RESEND_API_KEY"],
    );
    checks.push({
      id: "outbound_mailer",
      label: "Outbound Transactional Mailer",
      status: mailerConfigured ? "ok" : "warning",
      detail: mailerConfigured
        ? `Live mail driver configured (${process.env["SENDGRID_API_KEY"] ? "SendGrid" : process.env["RESEND_API_KEY"] ? "Resend" : "SMTP"}).`
        : "Using console mail driver; set SMTP_HOST, SENDGRID_API_KEY, or RESEND_API_KEY for live email delivery.",
    });

    // 6. Instance Ed25519 signing keys
    let keysReady = false;
    try {
      const keys = this.getInstanceKeys();
      keysReady = Boolean(keys?.publicKey && keys?.privateKey);
    } catch {
      keysReady = false;
    }
    checks.push({
      id: "instance_keys",
      label: "Instance Cryptographic Keys",
      status: keysReady ? "ok" : "error",
      detail: keysReady
        ? "Ed25519 package provenance & federation signing keys provisioned."
        : "Instance cryptographic keys could not be initialized.",
    });

    const hasError = checks.some((c) => c.status === "error");
    const warningCount = checks.filter((c) => c.status === "warning").length;
    return {
      allPassed: !hasError,
      warningCount,
      checks,
    };
  }

  exportEnvConfigSnippet(): {
    envText: string;
    envSnippet: string;
    dockerComposeSnippet: string;
    generatedAt: string;
  } {
    const s = this.getInstanceSettings();
    const rawRows = this.#db
      .prepare(`SELECT key, value FROM instance_settings WHERE key IN ('cloudflare_tunnel_token', 'tunnelToken')`)
      .all() as { key: string; value: string }[];
    const storedToken =
      rawRows.find((r) => r.key === "cloudflare_tunnel_token")?.value ||
      rawRows.find((r) => r.key === "tunnelToken")?.value ||
      "";
    const tunnelTokenVal = process.env["CLOUDFLARE_TUNNEL_TOKEN"]?.trim() || storedToken.trim();
    const publicUrl = process.env["PUBLIC_URL"] || "https://ansatz.social";
    const generatedAt = new Date().toISOString();
    const escapeEnvValue = (val: string): string => val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const envLines = [
      `# ${s.instanceName} — Declarative Instance & White-Label Configuration`,
      `# Generated at ${generatedAt}`,
      `NODE_ENV=production`,
      `PUBLIC_URL=${publicUrl}`,
      `MSX_INSTANCE_NAME="${escapeEnvValue(s.instanceName)}"`,
      `MSX_INSTANCE_BADGE="${escapeEnvValue(s.instanceBadge)}"`,
      `MSX_INSTANCE_TAGLINE="${escapeEnvValue(s.instanceTagline)}"`,
      `MSX_CONTACT_EMAIL="${escapeEnvValue(s.contactEmail)}"`,
      `MSX_BRAND_LOGO_URL="${escapeEnvValue(s.brandLogoUrl)}"`,
      `MSX_BRAND_LOGO_DARK_URL="${escapeEnvValue(s.brandLogoDarkUrl)}"`,
      `MSX_BRAND_FAVICON_URL="${escapeEnvValue(s.brandFaviconUrl)}"`,
      `MSX_BRAND_ACCENT_COLOR="${escapeEnvValue(s.brandAccentColor)}"`,
      `MSX_DOCS_BASE_URL="${escapeEnvValue(s.docsBaseUrl)}"`,
      `MSX_SHOW_POWERED_BY=${s.showPoweredBy ? "true" : "false"}`,
      `MSX_REGISTRATION_MODE=${s.registrationMode}`,
      `MODELSCRIPT_REGISTRATION_MODE=${s.registrationMode}`,
      `MSX_FEDERATION_MODE=${s.federationMode}`,
      `MSX_INGRESS_MODE=${s.ingressMode}`,
      `CLOUDFLARE_TUNNEL_TOKEN=${tunnelTokenVal}`,
      `JWT_SECRET=${process.env["JWT_SECRET"] ? "<REDACTED_CUSTOM_JWT_SECRET>" : crypto.randomBytes(32).toString("hex")}`,
      `SMTP_HOST=${process.env["SMTP_HOST"] || "smtp.example.org"}`,
      `SMTP_PORT=${process.env["SMTP_PORT"] || "587"}`,
      `EMAIL_FROM="${escapeEnvValue(s.instanceName)} <${s.contactEmail}>"`,
    ];

    const dockerComposeLines = [
      `services:`,
      `  ansatz-node:`,
      `    image: ghcr.io/modelscript/api-ce:latest`,
      `    restart: unless-stopped`,
      `    ports:`,
      `      - "3000:3000"`,
      `    volumes:`,
      `      - ./data:/app/apps/api/data`,
      `    environment:`,
      `      NODE_ENV: "production"`,
      `      PUBLIC_URL: "${publicUrl}"`,
      `      MSX_INSTANCE_NAME: "${escapeEnvValue(s.instanceName)}"`,
      `      MSX_INSTANCE_BADGE: "${escapeEnvValue(s.instanceBadge)}"`,
      `      MSX_INSTANCE_TAGLINE: "${escapeEnvValue(s.instanceTagline)}"`,
      `      MSX_CONTACT_EMAIL: "${escapeEnvValue(s.contactEmail)}"`,
      `      MSX_DOCS_BASE_URL: "${escapeEnvValue(s.docsBaseUrl)}"`,
      `      MSX_SHOW_POWERED_BY: "${s.showPoweredBy ? "true" : "false"}"`,
      `      MSX_REGISTRATION_MODE: "${s.registrationMode}"`,
      `      MSX_FEDERATION_MODE: "${s.federationMode}"`,
      `      MSX_INGRESS_MODE: "${s.ingressMode}"`,
    ];
    if (tunnelTokenVal) {
      dockerComposeLines.push(`      CLOUDFLARE_TUNNEL_TOKEN: "${escapeEnvValue(tunnelTokenVal)}"`);
    }

    const envStr = envLines.join("\n");
    return {
      envText: envStr,
      envSnippet: envStr,
      dockerComposeSnippet: dockerComposeLines.join("\n"),
      generatedAt,
    };
  }

  isSetupCompleted(): boolean {
    const row = this.#db.prepare(`SELECT value FROM instance_settings WHERE key = 'setupCompleted'`).get() as
      | { value: string }
      | undefined;
    return row?.value === "true";
  }

  isSetupForceReopened(): boolean {
    const row = this.#db.prepare(`SELECT value FROM instance_settings WHERE key = 'setupCompleted'`).get() as
      | { value: string }
      | undefined;
    return row?.value === "reopen";
  }

  resetSetupWizard(actorId: number | null = null): void {
    this.#db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by, updated_at)
         VALUES ('setupCompleted', 'reopen', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = 'reopen',
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`,
      )
      .run(actorId);
  }

  markSetupCompleted(actorId: number | null = null): void {
    this.#db
      .prepare(
        `INSERT INTO instance_settings (key, value, updated_by, updated_at)
         VALUES ('setupCompleted', 'true', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           value = 'true',
           updated_by = excluded.updated_by,
           updated_at = datetime('now')`,
      )
      .run(actorId);
  }

  isInstanceInitialized(): boolean {
    if (this.isSetupForceReopened()) return false;
    return this.hasAdminUser() || this.isSetupCompleted();
  }

  getSetupStatus(): {
    needsSetup: boolean;
    hasAdmin: boolean;
    setupCompleted: boolean;
    reopened: boolean;
    userCount: number;
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    preflight: ReturnType<LibraryDatabase["getPreflightChecks"]>;
  } {
    const hasAdmin = this.hasAdminUser();
    const explicitSetupCompleted = this.isSetupCompleted();
    const reopened = this.isSetupForceReopened();
    const needsSetup = reopened || (!hasAdmin && !explicitSetupCompleted);
    return {
      needsSetup,
      hasAdmin: reopened ? false : hasAdmin,
      setupCompleted: reopened ? false : explicitSetupCompleted || hasAdmin,
      reopened,
      userCount: this.getTotalUsersCount(),
      settings: this.getInstanceSettings(),
      preflight: this.getPreflightChecks(),
    };
  }

  createInstanceInvite(options?: {
    code?: string | undefined;
    createdBy?: number | null | undefined;
    maxUses?: number | undefined;
    initialCredits?: number | undefined;
    assignedRole?: string | undefined;
    note?: string | undefined;
    expiresInDays?: number | undefined;
  }): {
    id: number;
    code: string;
    createdBy: number | null;
    maxUses: number;
    usedCount: number;
    usesCount: number;
    initialCredits: number;
    assignedRole: string;
    note: string | null;
    expiresAt: string | null;
    revoked: boolean;
    createdAt: string;
  } {
    const rawCode = options?.code?.trim() || `msx-inv-${crypto.randomBytes(4).toString("hex")}`;
    const maxUses = Math.max(1, Math.min(10000, Number(options?.maxUses) || 1));
    const initialCredits = options?.initialCredits !== undefined ? Math.max(0, Number(options.initialCredits)) : 100.0;
    const assignedRole =
      options?.assignedRole && ["user", "moderator", "auditor", "admin"].includes(options.assignedRole)
        ? options.assignedRole
        : "user";
    const note = options?.note?.trim() || null;
    const expiresAt =
      options?.expiresInDays && Number(options.expiresInDays) > 0
        ? new Date(Date.now() + Number(options.expiresInDays) * 86_400_000).toISOString()
        : null;

    const res = this.#db
      .prepare(
        `INSERT INTO instance_invites (code, created_by, max_uses, used_count, initial_credits, assigned_role, note, expires_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(rawCode, options?.createdBy ?? null, maxUses, initialCredits, assignedRole, note, expiresAt);

    return {
      id: Number(res.lastInsertRowid),
      code: rawCode,
      createdBy: options?.createdBy ?? null,
      maxUses,
      usedCount: 0,
      usesCount: 0,
      initialCredits,
      assignedRole,
      note,
      expiresAt,
      revoked: false,
      createdAt: new Date().toISOString(),
    };
  }

  listInstanceInvites(): {
    id: number;
    code: string;
    created_by: number | null;
    createdBy: number | null;
    creator_username: string | null;
    max_uses: number;
    maxUses: number;
    used_count: number;
    usesCount: number;
    initial_credits: number;
    assigned_role: string;
    note: string | null;
    expires_at: string | null;
    expiresAt: string | null;
    revoked_at: string | null;
    revoked: boolean;
    created_at: string;
    createdAt: string;
  }[] {
    const rows = this.#db
      .prepare(
        `SELECT i.*, u.username as creator_username
         FROM instance_invites i
         LEFT JOIN users u ON i.created_by = u.id
         ORDER BY i.id DESC`,
      )
      .all() as {
      id: number;
      code: string;
      created_by: number | null;
      creator_username: string | null;
      max_uses: number;
      used_count: number;
      initial_credits: number;
      assigned_role: string;
      note: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      ...r,
      createdBy: r.created_by,
      maxUses: r.max_uses,
      usesCount: r.used_count,
      expiresAt: r.expires_at,
      revoked: Boolean(r.revoked_at),
      createdAt: r.created_at,
    }));
  }

  revokeInstanceInvite(id: number): boolean {
    const res = this.#db
      .prepare(`UPDATE instance_invites SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
      .run(id);
    return res.changes > 0;
  }

  // ── User Referrals, Golden Tickets & Waitlist ──────────────

  getUserOnboardingStatus(userId: number) {
    return this.referrals.getUserOnboardingStatus(userId);
  }

  completeUserOnboarding(userId: number, persona?: string): boolean {
    return this.referrals.completeUserOnboarding(userId, persona);
  }

  recordUserReferral(
    referrerId: number,
    refereeId: number,
    inviteId: number | null = null,
    rewardAmount = 50.0,
  ): UserReferralRow {
    return this.referrals.recordUserReferral(referrerId, refereeId, inviteId, rewardAmount);
  }

  getUserReferrals(referrerId: number): UserReferralRow[] {
    return this.referrals.getUserReferrals(referrerId);
  }

  getReferralByReferee(refereeId: number): UserReferralRow | undefined {
    return this.referrals.getReferralByReferee(refereeId);
  }

  grantReferralReward(refereeId: number): boolean {
    return this.referrals.grantReferralReward(refereeId);
  }

  generateUserGoldenTicket(
    userId: number,
    note?: string,
    initialCredits = 100,
  ): ReturnType<LibraryDatabase["createInstanceInvite"]> {
    return this.referrals.generateUserGoldenTicket(userId, note, initialCredits);
  }

  getUserInvites(userId: number): ReturnType<LibraryDatabase["listInstanceInvites"]> {
    return this.referrals.getUserInvites(userId);
  }

  createWaitlistSubmission(data: {
    email: string;
    full_name?: string | null;
    organization?: string | null;
    discipline?: string | null;
    portfolio_url?: string | null;
    statement?: string | null;
    ip_address?: string | null;
  }): WaitlistSubmissionRow {
    return this.referrals.createWaitlistSubmission(data);
  }

  getWaitlistSubmissions(options?: {
    status?: "pending" | "approved" | "rejected";
    limit?: number;
    offset?: number;
  }): WaitlistSubmissionRow[] {
    return this.referrals.getWaitlistSubmissions(options);
  }

  getWaitlistSubmissionById(id: number): WaitlistSubmissionRow | undefined {
    return this.referrals.getWaitlistSubmissionById(id);
  }

  getWaitlistSubmissionByEmail(email: string): WaitlistSubmissionRow | undefined {
    return this.referrals.getWaitlistSubmissionByEmail(email);
  }

  approveWaitlistSubmission(
    id: number,
    approvedBy: number | null = null,
  ): {
    success: boolean;
    submission?: WaitlistSubmissionRow | undefined;
    inviteCode?: string | undefined;
  } {
    return this.referrals.approveWaitlistSubmission(id, approvedBy);
  }

  rejectWaitlistSubmission(id: number, approvedBy: number | null = null, reason: string | null = null): boolean {
    return this.referrals.rejectWaitlistSubmission(id, approvedBy, reason);
  }

  getSystemDiagnostics(): {
    dbSizeBytes: number;
    walSizeBytes: number;
    counts: {
      users: number;
      posts: number;
      packages: number;
      repositories: number;
      jobs: number;
      auditLogs: number;
      pendingReports: number;
      quarantinedResources: number;
    };
    backups: {
      count: number;
      totalBytes: number;
      latestAt: string | null;
    };
    jobQueue: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
  } {
    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    try {
      const dbPath = this.#dbPath;
      if (fs.existsSync(dbPath)) dbSizeBytes = fs.statSync(dbPath).size;
      const walPath = `${dbPath}-wal`;
      if (fs.existsSync(walPath)) walSizeBytes = fs.statSync(walPath).size;
    } catch {
      // Ignore stat errors for in-memory DBs
    }

    const countTable = (sql: string): number => {
      try {
        const r = this.#db.prepare(sql).get() as { c: number } | undefined;
        return r?.c ?? 0;
      } catch {
        return 0;
      }
    };

    const backups = this.listBackups();
    const totalBackupBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);

    return {
      dbSizeBytes,
      walSizeBytes,
      counts: {
        users: countTable("SELECT COUNT(*) as c FROM users"),
        posts: countTable("SELECT COUNT(*) as c FROM posts"),
        packages: countTable("SELECT COUNT(*) as c FROM packages"),
        repositories: countTable("SELECT COUNT(*) as c FROM git_repos"),
        jobs: countTable("SELECT COUNT(*) as c FROM jobs"),
        auditLogs: countTable("SELECT COUNT(*) as c FROM audit_logs"),
        pendingReports: countTable("SELECT COUNT(*) as c FROM content_reports WHERE status = 'pending'"),
        quarantinedResources: countTable(
          "SELECT COUNT(*) as c FROM quarantined_resources WHERE status = 'quarantined'",
        ),
      },
      backups: {
        count: backups.length,
        totalBytes: totalBackupBytes,
        latestAt: backups[0]?.createdAt ?? null,
      },
      jobQueue: {
        pending: countTable("SELECT COUNT(*) as c FROM jobs WHERE status IN ('PENDING', 'QUEUED')"),
        running: countTable("SELECT COUNT(*) as c FROM jobs WHERE status = 'RUNNING'"),
        completed: countTable("SELECT COUNT(*) as c FROM jobs WHERE status = 'SUCCESS'"),
        failed: countTable("SELECT COUNT(*) as c FROM jobs WHERE status IN ('FAILED', 'ERROR', 'CANCELLED')"),
      },
    };
  }

  validateAndConsumeInstanceInvite(code: string): {
    valid: boolean;
    reason?: string | undefined;
    invite?:
      | {
          id: number;
          code: string;
          initialCredits: number;
          assignedRole: string;
          createdBy?: number | null | undefined;
        }
      | undefined;
  } {
    const cleanCode = code.trim();
    if (!cleanCode) {
      return { valid: false, reason: "Invite code is required" };
    }
    const row = this.#db.prepare(`SELECT * FROM instance_invites WHERE code = ?`).get(cleanCode) as
      | {
          id: number;
          code: string;
          created_by: number | null;
          max_uses: number;
          used_count: number;
          initial_credits: number;
          assigned_role: string;
          expires_at: string | null;
          revoked_at: string | null;
        }
      | undefined;

    if (!row) {
      return { valid: false, reason: "Invalid registration invite code" };
    }
    if (row.revoked_at) {
      return { valid: false, reason: "This registration invite code has been revoked" };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { valid: false, reason: "This registration invite code has expired" };
    }
    if (row.used_count >= row.max_uses) {
      return { valid: false, reason: "This registration invite code has reached its maximum uses" };
    }

    this.#db.prepare(`UPDATE instance_invites SET used_count = used_count + 1 WHERE id = ?`).run(row.id);

    return {
      valid: true,
      invite: {
        id: row.id,
        code: row.code,
        createdBy: row.created_by ?? null,
        initialCredits: Number(row.initial_credits ?? 100),
        assignedRole: row.assigned_role || "user",
      },
    };
  }

  getUserForensicsForAdmin(userId: number): {
    user: {
      id: number;
      username: string;
      email: string | null;
      display_name: string | null;
      account_type: string;
      status: string;
      credit_balance: number;
      total_spent: number;
      remote_domain: string | null;
      email_verified: number;
      totp_enabled: number;
      created_at: string;
    };
    recentPosts: {
      id: number;
      content: string;
      content_warning: string | null;
      visibility: string;
      created_at: string;
    }[];
    publishedPackages: {
      name: string;
      description: string | null;
      created_at: string;
    }[];
    recentTransactions: {
      id: number;
      amount: number;
      balance_after: number;
      type: string;
      description: string | null;
      created_at: string;
    }[];
    recentAuditLogs: {
      id: number;
      action: string;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      created_at: string;
    }[];
    reportsAgainstUser: {
      id: number;
      reason: string;
      status: string;
      target_type: string | null;
      created_at: string;
    }[];
    warnings: AccountWarningRow[];
    accountWarnings: AccountWarningRow[];
    staffNotes: StaffNoteRow[];
  } | null {
    const user = this.#db
      .prepare(
        `SELECT id, username, email, display_name, COALESCE(account_type, 'user') as account_type,
                COALESCE(status, 'active') as status,
                COALESCE(credit_balance, 0) as credit_balance,
                COALESCE((SELECT SUM(ABS(amount)) FROM credit_transactions ct WHERE ct.user_id = users.id AND ct.amount < 0), 0) as total_spent,
                remote_domain, COALESCE(email_verified, 0) as email_verified,
                COALESCE(totp_enabled, 0) as totp_enabled, created_at
         FROM users WHERE id = ?`,
      )
      .get(userId) as
      | {
          id: number;
          username: string;
          email: string | null;
          display_name: string | null;
          account_type: string;
          status: string;
          credit_balance: number;
          total_spent: number;
          remote_domain: string | null;
          email_verified: number;
          totp_enabled: number;
          created_at: string;
        }
      | undefined;

    if (!user) return null;

    const recentPosts = this.#db
      .prepare(
        `SELECT id, content, content_warning,
                COALESCE(visibility, reply_visibility, 'public') as visibility,
                created_at
         FROM posts WHERE author_id = ? ORDER BY id DESC LIMIT 10`,
      )
      .all(userId) as {
      id: number;
      content: string;
      content_warning: string | null;
      visibility: string;
      created_at: string;
    }[];

    let publishedPackages: { name: string; description: string | null; created_at: string }[] = [];
    try {
      publishedPackages = this.#db
        .prepare(
          `SELECT DISTINCT p.name, p.description, p.created_at
           FROM packages p
           JOIN package_versions pv ON pv.package_id = p.id
           WHERE pv.published_by = ?
           ORDER BY p.id DESC LIMIT 10`,
        )
        .all(userId) as { name: string; description: string | null; created_at: string }[];
    } catch {
      publishedPackages = [];
    }

    const recentTransactions = this.#db
      .prepare(
        `SELECT id, amount, balance_after, type, description, created_at
         FROM credit_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 10`,
      )
      .all(userId) as {
      id: number;
      amount: number;
      balance_after: number;
      type: string;
      description: string | null;
      created_at: string;
    }[];

    const recentAuditLogs = this.#db
      .prepare(
        `SELECT id, action, resource_type, resource_id, ip_address, created_at
         FROM audit_logs
         WHERE actor_id = ? OR (resource_type = 'user' AND resource_id = ?)
         ORDER BY id DESC LIMIT 15`,
      )
      .all(userId, String(userId)) as {
      id: number;
      action: string;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      created_at: string;
    }[];

    const reportsAgainstUser = this.#db
      .prepare(
        `SELECT r.id, r.reason, r.status, r.target_type, r.created_at
         FROM content_reports r
         LEFT JOIN posts p ON r.post_id = p.id
         WHERE r.target_user_id = ? OR p.author_id = ?
         ORDER BY r.id DESC LIMIT 10`,
      )
      .all(userId, userId) as {
      id: number;
      reason: string;
      status: string;
      target_type: string | null;
      created_at: string;
    }[];

    const warnings = this.listAccountWarnings(userId);
    return {
      user,
      recentPosts,
      publishedPackages,
      recentTransactions,
      recentAuditLogs,
      reportsAgainstUser,
      warnings,
      accountWarnings: warnings,
      staffNotes: this.listStaffNotes("user", String(userId)),
    };
  }

  exportInstanceBundle(): {
    formatVersion: number;
    exportedAt: string;
    snapshot: {
      fileName: string;
      sizeBytes: number;
      sha256: string;
    };
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    federationDomains: ReturnType<LibraryDatabase["listFederationDomains"]>;
    quarantinedResources: ReturnType<LibraryDatabase["listQuarantinedResources"]>;
    featureFlags: ReturnType<LibraryDatabase["getFeatureFlags"]>;
    packageCount: number;
    userCount: number;
    bundleSha256: string;
  } {
    const snapshot = this.createHotBackup("bundle-export");
    const settings = this.getInstanceSettings();
    const federationDomains = this.listFederationDomains();
    const quarantinedResources = this.listQuarantinedResources();
    const featureFlags = this.getFeatureFlags();
    const diag = this.getSystemDiagnostics();

    const payloadWithoutHash = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: {
        fileName: snapshot.fileName,
        sizeBytes: snapshot.sizeBytes,
        sha256: snapshot.sha256,
      },
      settings,
      federationDomains,
      quarantinedResources,
      featureFlags,
      packageCount: diag.counts.packages,
      userCount: diag.counts.users,
    };
    const bundleSha256 = crypto.createHash("sha256").update(JSON.stringify(payloadWithoutHash)).digest("hex");

    return {
      ...payloadWithoutHash,
      bundleSha256,
    };
  }

  importInstanceBundle(
    bundle: {
      settings?: Record<string, unknown> | undefined;
      federationDomains?:
        | { domain: string; tier?: "allow" | "silence" | "suspend"; reason?: string | null }[]
        | undefined;
      featureFlags?:
        | { flag_key: string; is_enabled: number | boolean; allowed_roles?: string; rollout_percentage?: number }[]
        | undefined;
      quarantinedResources?: { resource_type: string; resource_id: string; reason: string }[] | undefined;
    },
    actorId: number | null = null,
  ): {
    success: boolean;
    settingsUpdated: boolean;
    importedDomains: number;
    importedFlags: number;
    importedQuarantines: number;
  } {
    let settingsUpdated = false;
    if (bundle.settings && typeof bundle.settings === "object") {
      this.updateInstanceSettings(bundle.settings, actorId);
      settingsUpdated = true;
    }

    let importedDomains = 0;
    if (Array.isArray(bundle.federationDomains) && bundle.federationDomains.length > 0) {
      const res = this.importFederationDomains(bundle.federationDomains, "merge");
      importedDomains = res.importedCount;
    }

    let importedFlags = 0;
    if (Array.isArray(bundle.featureFlags)) {
      for (const f of bundle.featureFlags) {
        if (!f.flag_key) continue;
        this.setFeatureFlag(
          String(f.flag_key),
          Boolean(f.is_enabled),
          f.allowed_roles ?? "",
          typeof f.rollout_percentage === "number" ? f.rollout_percentage : 100,
        );
        importedFlags++;
      }
    }

    let importedQuarantines = 0;
    if (Array.isArray(bundle.quarantinedResources)) {
      for (const q of bundle.quarantinedResources) {
        if (!q.resource_type || !q.resource_id) continue;
        this.quarantineResource({
          resourceType: String(q.resource_type),
          resourceId: String(q.resource_id),
          reason: String(q.reason || "Imported from instance migration bundle"),
          quarantinedBy: actorId,
        });
        importedQuarantines++;
      }
    }

    return {
      success: true,
      settingsUpdated,
      importedDomains,
      importedFlags,
      importedQuarantines,
    };
  }

  recordActivityPubMigration(data: {
    sourceActorUri: string;
    targetActorUri: string;
    alsoKnownAs?: string[] | undefined;
    actorId?: number | null | undefined;
  }): {
    activityId: string;
    type: "Move";
    actor: string;
    object: string;
    target: string;
    alsoKnownAs: string[];
    queuedDeliveries: number;
  } {
    let cleanSourceUri = data.sourceActorUri;
    while (cleanSourceUri.endsWith("/")) {
      cleanSourceUri = cleanSourceUri.slice(0, -1);
    }
    const activityId = `${cleanSourceUri}#move-${Date.now()}`;
    const activityPayload = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityId,
      type: "Move",
      actor: data.sourceActorUri,
      object: data.sourceActorUri,
      target: data.targetActorUri,
      alsoKnownAs: data.alsoKnownAs ?? [data.targetActorUri],
      published: new Date().toISOString(),
    };

    // Enqueue Move activity to all known active peer federation domains
    const domains = this.listFederationDomains().filter((d) => d.tier === "allow");
    let queuedDeliveries = 0;
    for (const d of domains) {
      this.enqueueFederationDelivery("Move", activityId, activityPayload, `https://${d.domain}/inbox`, d.domain);
      queuedDeliveries++;
    }

    return {
      activityId,
      type: "Move",
      actor: data.sourceActorUri,
      object: data.sourceActorUri,
      target: data.targetActorUri,
      alsoKnownAs: activityPayload.alsoKnownAs,
      queuedDeliveries,
    };
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
      } catch {
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

  getRssFeedByUrl(url: string): RssFeedRow | undefined {
    return this.#db.prepare(`SELECT * FROM rss_feeds WHERE url = ?`).get(url) as RssFeedRow | undefined;
  }

  getRssFeedsToPoll(): RssFeedRow[] {
    // Only fetch feeds where last_polled_at is null OR last_polled_at + poll_interval_mins < now
    return this.#db
      .prepare(
        `
      SELECT * FROM rss_feeds 
      WHERE last_polled_at IS NULL 
         OR datetime(last_polled_at, '+' || poll_interval_mins || ' minutes') <= datetime('now')
    `,
      )
      .all() as RssFeedRow[];
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
      this.#db.prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE user_id = ?`).get(userId) as {
        count: number;
      }
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
    } catch {
      // Ignore unique constraint violation (already subscribed)
    }
  }

  unsubscribeFromRssFeed(userId: number, rssFeedId: number): void {
    const transaction = this.#db.transaction(() => {
      const feed = this.#db.prepare(`SELECT * FROM rss_feeds WHERE id = ?`).get(rssFeedId) as RssFeedRow | undefined;
      if (!feed) return;

      this.#db
        .prepare(`DELETE FROM user_rss_subscriptions WHERE user_id = ? AND rss_feed_id = ?`)
        .run(userId, rssFeedId);

      const subCount = (
        this.#db
          .prepare(`SELECT COUNT(*) as count FROM user_rss_subscriptions WHERE rss_feed_id = ?`)
          .get(rssFeedId) as { count: number }
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

  getUserRssSubscriptions(userId: number): RssFeedRow[] {
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
      .all(userId) as RssFeedRow[];
  }

  getAllRssFeeds(): RssFeedRow[] {
    return this.#db.prepare(`SELECT * FROM rss_feeds`).all() as RssFeedRow[];
  }

  updateRssFeedStatus(rssFeedId: number, lastFetchedAt: string, lastGuid: string | null): void {
    this.#db
      .prepare(`UPDATE rss_feeds SET last_fetched_at = ?, last_guid = ? WHERE id = ?`)
      .run(lastFetchedAt, lastGuid, rssFeedId);
  }

  getArtifactView(id: number): ArtifactViewRow | undefined {
    return this.#db.prepare(`SELECT * FROM artifact_views WHERE id = ?`).get(id) as ArtifactViewRow | undefined;
  }

  createArtifactView(
    creatorId: number,
    type: string,
    source_type: string,
    viewConfig: string,
    title?: string | null | undefined,
    thumbnailUrl?: string | null | undefined,
    remoteOriginUrl?: string | null | undefined,
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

  getAllArtifactViews(): ArtifactViewRow[] {
    return this.#db.prepare(`SELECT id, view_type, view_config FROM artifact_views`).all() as ArtifactViewRow[];
  }

  getArtifactViewByTitle(title: string): ArtifactViewRow | undefined {
    return this.#db.prepare(`SELECT id, view_type, title FROM artifact_views WHERE title = ? LIMIT 1`).get(title) as
      | ArtifactViewRow
      | undefined;
  }

  updateArtifactViewConfig(id: number, viewConfig: string): void {
    this.#db.prepare(`UPDATE artifact_views SET view_config = ? WHERE id = ?`).run(viewConfig, id);
  }

  updateArtifactThumbnail(id: number, thumbnailUrl: string, thumbnailUrlDark?: string): void {
    const darkUrl = thumbnailUrlDark || thumbnailUrl;
    try {
      this.#db
        .prepare(
          `UPDATE artifact_views
           SET thumbnail_url = ?,
               view_config = CASE
                 WHEN view_config IS NOT NULL AND json_valid(view_config)
                 THEN json_set(view_config, '$.thumbnailUrl', ?, '$.thumbnailUrlLight', ?, '$.thumbnailUrlDark', ?)
                 ELSE view_config
               END
           WHERE id = ?`,
        )
        .run(thumbnailUrl, thumbnailUrl, thumbnailUrl, darkUrl, id);
      return;
    } catch {}
    this.#db.prepare(`UPDATE artifact_views SET thumbnail_url = ? WHERE id = ?`).run(thumbnailUrl, id);
  }

  updateArtifactThumbnailsByTitle(title: string, thumbnailUrl: string, thumbnailUrlDark?: string): number {
    const darkUrl = thumbnailUrlDark || thumbnailUrl;
    try {
      const res = this.#db
        .prepare(
          `UPDATE artifact_views
           SET thumbnail_url = ?,
               view_config = CASE
                 WHEN view_config IS NOT NULL AND json_valid(view_config)
                 THEN json_set(view_config, '$.thumbnailUrl', ?, '$.thumbnailUrlLight', ?, '$.thumbnailUrlDark', ?)
                 ELSE view_config
               END
           WHERE title = ?`,
        )
        .run(thumbnailUrl, thumbnailUrl, thumbnailUrl, darkUrl, title);
      return res.changes;
    } catch {
      const res = this.#db
        .prepare(`UPDATE artifact_views SET thumbnail_url = ? WHERE title = ?`)
        .run(thumbnailUrl, title);
      return res.changes;
    }
  }

  getUserArchiveData(userId: number): UserArchiveData {
    let posts: UserArchiveData["posts"] = [];
    try {
      posts = this.#db
        .prepare(
          `SELECT p.id, p.content, p.created_at,
             (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
             (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
             (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count
           FROM posts p WHERE p.author_id = ? ORDER BY p.id DESC`,
        )
        .all(userId) as UserArchiveData["posts"];
    } catch {}

    let libraries: UserArchiveData["libraries"] = [];
    try {
      libraries = this.#db
        .prepare(
          `SELECT p.name, pv.version, pv.published_at as created_at
           FROM package_versions pv
           JOIN packages p ON pv.package_id = p.id
           WHERE pv.published_by = ?
           ORDER BY pv.id DESC`,
        )
        .all(userId) as UserArchiveData["libraries"];
    } catch {}

    let billingHistory: UserArchiveData["billingHistory"] = [];
    try {
      billingHistory = this.#db
        .prepare(
          `SELECT id, amount, balance_after, type, description, created_at FROM credit_transactions WHERE user_id = ? ORDER BY id DESC`,
        )
        .all(userId) as UserArchiveData["billingHistory"];
    } catch {}

    let auditHistory: UserArchiveData["auditHistory"] = [];
    try {
      auditHistory = this.#db
        .prepare(
          `SELECT action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_id = ? ORDER BY id DESC LIMIT 200`,
        )
        .all(userId) as UserArchiveData["auditHistory"];
    } catch {}

    let bookmarks: UserArchiveData["bookmarks"] = [];
    try {
      bookmarks = this.#db
        .prepare(
          `SELECT b.post_id, p.content, b.created_at FROM bookmarks b LEFT JOIN posts p ON b.post_id = p.id WHERE b.user_id = ? ORDER BY b.id DESC`,
        )
        .all(userId) as UserArchiveData["bookmarks"];
    } catch {}

    let following: string[] = [];
    try {
      const rows = this.#db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ?`)
        .all(userId) as { username: string }[];
      following = rows.map((r) => r.username);
    } catch {}

    let followers: string[] = [];
    try {
      const rows = this.#db
        .prepare(`SELECT u.username FROM follows f JOIN users u ON f.follower_id = u.id WHERE f.following_id = ?`)
        .all(userId) as { username: string }[];
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
    license?: string | null | undefined;
    description?: string | null | undefined;
    metadata?: string | null | undefined;
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

  getRemotePackage(name: string, version: string): RemotePackageRow | undefined {
    return this.#db
      .prepare(`SELECT * FROM remote_packages WHERE name = ? AND version = ? AND is_deleted = 0`)
      .get(name, version) as RemotePackageRow | undefined;
  }

  getRemotePackages(limit = 50, offset = 0): RemotePackageRow[] {
    return this.#db
      .prepare(`SELECT * FROM remote_packages WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as RemotePackageRow[];
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
      let initialReviewStatus = "approved";
      try {
        if (this.getInstanceSettings().trendingRequiresApproval) {
          initialReviewStatus = "pending";
        }
      } catch {}
      const res = this.#db
        .prepare(
          `
        INSERT INTO trending_topics (concept, display_name, current_score, location, review_status) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(concept, displayName, weight, location, initialReviewStatus);
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
    } catch {
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
    let requiresApproval = false;
    try {
      requiresApproval = this.getInstanceSettings().trendingRequiresApproval;
    } catch {}
    const reviewClause = requiresApproval
      ? `AND COALESCE(t.review_status, 'approved') = 'approved'`
      : `AND COALESCE(t.review_status, 'approved') != 'rejected'`;
    const query = location
      ? `SELECT t.*, (SELECT COUNT(*) FROM post_topics pt WHERE pt.topic_id = t.id) as post_count FROM trending_topics t WHERE t.current_score > 0.001 ${reviewClause} AND t.location = ? ORDER BY t.current_score DESC LIMIT ?`
      : `SELECT t.*, (SELECT COUNT(*) FROM post_topics pt WHERE pt.topic_id = t.id) as post_count FROM trending_topics t WHERE t.current_score > 0.001 ${reviewClause} ORDER BY t.current_score DESC LIMIT ?`;
    const params = location ? [location, limit * 5] : [limit * 5];

    const topics = this.#db.prepare(query).all(...params) as (TrendingTopicRow & { post_count?: number | undefined })[];

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

    const missingCurated = CURATED_ENGINEERING_TOPICS.filter((cur) => !existingConcepts.has(cur.concept.toLowerCase()));
    const curatedPostCounts = new Map<string, number>();

    if (missingCurated.length > 0) {
      try {
        const placeholders = missingCurated.map(() => "?").join(", ");
        const indexedRows = this.#db
          .prepare(
            `SELECT LOWER(t.concept) as concept, COUNT(pt.post_id) as count
             FROM trending_topics t
             JOIN post_topics pt ON pt.topic_id = t.id
             WHERE LOWER(t.concept) IN (${placeholders})
             GROUP BY LOWER(t.concept)`,
          )
          .all(...missingCurated.map((c) => c.concept.toLowerCase())) as { concept: string; count: number }[];
        for (const r of indexedRows) {
          curatedPostCounts.set(r.concept, Number(r.count || 0));
        }

        const unindexedCurated = missingCurated.filter((c) => !curatedPostCounts.has(c.concept.toLowerCase()));
        if (unindexedCurated.length > 0) {
          const sumExprs = unindexedCurated
            .map((_, idx) => `COALESCE(SUM(CASE WHEN lower(content) LIKE ? THEN 1 ELSE 0 END), 0) as c_${idx}`)
            .join(", ");
          const sumRow = this.#db
            .prepare(`SELECT ${sumExprs} FROM posts`)
            .get(...unindexedCurated.map((c) => `%#${c.concept.toLowerCase()}%`)) as Record<string, number> | undefined;
          if (sumRow) {
            for (const [idx, c] of unindexedCurated.entries()) {
              curatedPostCounts.set(c.concept.toLowerCase(), Number(sumRow[`c_${idx}`] || 0));
            }
          }
        }
      } catch {
        // Fallback to 0 counts on error
      }
    }

    if (!requiresApproval) {
      for (const [i, cur] of CURATED_ENGINEERING_TOPICS.entries()) {
        const key = cur.concept.toLowerCase();
        const match = existingConcepts.get(key);
        if (match) {
          match.real_score += cur.score;
          match.current_score += cur.score;
        } else {
          const hashtagPostCount = curatedPostCounts.get(key) || 0;
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
    }

    scoredTopics.sort((a, b) => b.real_score - a.real_score);
    return scoredTopics.slice(0, limit);
  }

  getTopicPosts(concept: string, currentUserId?: number, limit = 20, offset = 0, artifactType?: string): PostRow[] {
    const cleanConcept = concept.replace(/^#/, "").trim().toLowerCase();
    const artifactFilter = this.buildArtifactFilter(artifactType);
    const visFilter = this.buildVisibilityFilter(currentUserId, "public");
    const uid = currentUserId || -1;

    const query = `
      SELECT DISTINCT p.*, u.username, u.display_name, u.avatar_url, u.account_type,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM posts WHERE reply_to_id = p.id) as reply_count,
        (SELECT COUNT(*) FROM posts WHERE repost_of_id = p.id) as repost_count,
        EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) as liked,
        EXISTS(SELECT 1 FROM posts WHERE repost_of_id=p.id AND author_id=?) as reposted,
        EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) as bookmarked
      FROM posts p 
      JOIN users u ON p.author_id = u.id
      LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
      LEFT JOIN post_topics pt ON pt.post_id = p.id
      LEFT JOIN trending_topics t ON t.id = pt.topic_id
      WHERE (lower(t.concept) = ? OR lower(t.display_name) = ? OR lower(p.content) LIKE ?)
        ${visFilter.sql}
        ${artifactFilter.sql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = [
      uid,
      uid,
      uid,
      cleanConcept,
      cleanConcept,
      `%#${cleanConcept}%`,
      ...visFilter.params,
      ...artifactFilter.params,
      limit,
      offset,
    ];

    const posts = this.#db.prepare(query).all(...params) as (Omit<PostRow, "metadata"> & {
      metadata?: PostMetadata | string | null | undefined;
    })[];
    const hydrated = posts.map((p) => this.hydratePost(p, currentUserId)!);
    return this.applyContentFiltersToPosts(hydrated, "public", currentUserId);
  }

  // ── Linked Repositories ─────────────────────────────────────────

  getLinkedRepos(userId: number): LinkedRepoRow[] {
    return this.#db
      .prepare(
        `
        SELECT r.*, u.username, u.display_name, COALESCE(r.avatar_url, u.avatar_url) as avatar_url
        FROM linked_repos r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.user_id = ?
        ORDER BY r.pinned DESC, r.id ASC
      `,
      )
      .all(userId) as LinkedRepoRow[];
  }

  getUserRepos(userId: number): LinkedRepoRow[] {
    return this.getLinkedRepos(userId);
  }

  getPopularRepos(limit: number = 5): LinkedRepoRow[] {
    return this.#db
      .prepare(
        `
        SELECT r.*, u.username, u.display_name, COALESCE(r.avatar_url, u.avatar_url) as avatar_url
        FROM linked_repos r
        JOIN users u ON r.user_id = u.id
        WHERE COALESCE(r.visibility, 'public') = 'public'
        GROUP BY r.provider, r.namespace, r.project
        ORDER BY r.pinned DESC, r.id ASC
        LIMIT ?
      `,
      )
      .all(limit) as LinkedRepoRow[];
  }

  linkRepo(
    userId: number,
    provider: string,
    externalId: string,
    repoFullName: string,
    defaultBranch?: string,
    description?: string,
    avatarUrl?: string,
  ): LinkedRepoRow | undefined {
    const parts = repoFullName.split("/");
    const namespace = parts[0] || "";
    const project = parts.slice(1).join("/") || repoFullName;
    const branch = defaultBranch || "main";

    const matchingRows = this.#db
      .prepare(
        `SELECT id FROM linked_repos
         WHERE user_id = ? AND ((? != '' AND external_id = ?) OR (provider = ? AND namespace = ? AND project = ?))
         ORDER BY CASE WHEN provider = ? AND namespace = ? AND project = ? THEN 0 ELSE 1 END, id ASC`,
      )
      .all(userId, externalId || "", externalId || "", provider, namespace, project, provider, namespace, project) as {
      id: number;
    }[];
    const existing = matchingRows[0];
    if (matchingRows.length > 1 && existing) {
      const deleteDuplicate = this.#db.prepare(`DELETE FROM linked_repos WHERE id = ?`);
      for (let i = 1; i < matchingRows.length; i++) {
        const dup = matchingRows[i];
        if (dup) {
          deleteDuplicate.run(dup.id);
        }
      }
    }
    if (!existing) {
      const info = this.#db
        .prepare(
          `
        INSERT INTO linked_repos (user_id, provider, namespace, project, external_id, default_branch, description, avatar_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(userId, provider, namespace, project, externalId, branch, description || null, avatarUrl || null);
      return this.getLinkedRepoById(Number(info.lastInsertRowid));
    } else {
      this.#db
        .prepare(
          `
        UPDATE linked_repos
        SET provider = ?,
            namespace = ?,
            project = ?,
            external_id = COALESCE(?, external_id),
            default_branch = COALESCE(?, default_branch),
            description = COALESCE(?, description),
            avatar_url = COALESCE(?, avatar_url)
        WHERE id = ?
      `,
        )
        .run(
          provider,
          namespace,
          project,
          externalId || null,
          defaultBranch || null,
          description || null,
          avatarUrl || null,
          existing.id,
        );
      return this.getLinkedRepoById(existing.id);
    }
  }

  unlinkRepo(userId: number, repoIdOrName: number | string): void {
    const idStr = String(repoIdOrName);
    const numId = Number(repoIdOrName);
    if (!Number.isNaN(numId) && Number.isFinite(numId)) {
      this.#db
        .prepare(`DELETE FROM linked_repos WHERE (id = ? OR external_id = ?) AND user_id = ?`)
        .run(numId, idStr, userId);
    } else {
      this.#db
        .prepare(
          `DELETE FROM linked_repos WHERE (external_id = ? OR (namespace || '/' || project) = ? OR project = ?) AND user_id = ?`,
        )
        .run(idStr, idStr, idStr, userId);
    }
  }

  updateLinkedRepo(
    userId: number,
    repoIdOrName: number | string,
    updates: {
      name?: string | undefined;
      repo_full_name?: string | undefined;
      visibility?: string | undefined;
      default_branch?: string | undefined;
      social_preview_url?: string | undefined;
      description?: string | undefined;
    },
  ): LinkedRepoRow | undefined {
    const idStr = String(repoIdOrName);
    const numId = Number(repoIdOrName);
    const existing = (
      !Number.isNaN(numId) && Number.isFinite(numId)
        ? this.#db
            .prepare(`SELECT * FROM linked_repos WHERE (id = ? OR external_id = ?) AND user_id = ?`)
            .get(numId, idStr, userId)
        : this.#db
            .prepare(
              `SELECT * FROM linked_repos WHERE (external_id = ? OR (namespace || '/' || project) = ? OR project = ?) AND user_id = ?`,
            )
            .get(idStr, idStr, idStr, userId)
    ) as LinkedRepoRow | undefined;

    if (!existing) return undefined;

    let nextNamespace = existing.namespace;
    let nextProject = existing.project;
    if (updates.repo_full_name) {
      const parts = updates.repo_full_name.split("/");
      nextNamespace = parts[0] || existing.namespace;
      nextProject = parts.slice(1).join("/") || updates.name || existing.project;
    } else if (updates.name) {
      nextProject = updates.name;
    }

    this.#db
      .prepare(
        `UPDATE linked_repos
         SET namespace = ?,
             project = ?,
             visibility = COALESCE(?, visibility),
             default_branch = COALESCE(?, default_branch),
             social_preview_url = COALESCE(?, social_preview_url),
             description = COALESCE(?, description),
             avatar_url = COALESCE(?, avatar_url)
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        nextNamespace,
        nextProject,
        updates.visibility ?? null,
        updates.default_branch ?? null,
        updates.social_preview_url ?? null,
        updates.description ?? null,
        updates.social_preview_url ?? null,
        existing.id,
        userId,
      );

    return this.getLinkedRepoById(existing.id);
  }

  getLinkedRepoById(idOrSlug: number | string, preferredUserId?: number): LinkedRepoRow | undefined {
    const idStr = String(idOrSlug).trim();
    const numId = Number(idStr);
    if (!Number.isNaN(numId) && Number.isFinite(numId) && /^\d+$/.test(idStr)) {
      const byPk = this.#db.prepare(`SELECT * FROM linked_repos WHERE id = ?`).get(numId) as LinkedRepoRow | undefined;
      if (byPk) return byPk;
    }
    if (preferredUserId !== undefined) {
      const byUserSlug = this.#db
        .prepare(
          `SELECT * FROM linked_repos
           WHERE user_id = ? AND (external_id = ? OR LOWER(namespace || '/' || project) = LOWER(?) OR LOWER(project) = LOWER(?))
           ORDER BY id ASC LIMIT 1`,
        )
        .get(preferredUserId, idStr, idStr, idStr) as LinkedRepoRow | undefined;
      if (byUserSlug) return byUserSlug;
    }
    return this.#db
      .prepare(
        `SELECT * FROM linked_repos
         WHERE external_id = ? OR LOWER(namespace || '/' || project) = LOWER(?) OR LOWER(project) = LOWER(?)
         ORDER BY id ASC LIMIT 1`,
      )
      .get(idStr, idStr, idStr) as LinkedRepoRow | undefined;
  }

  // ==========================================
  // Repository Webhooks & CI/CD Ingestion
  // ==========================================

  createRepoWebhook(params: {
    repoId: number;
    provider: "github" | "gitlab" | "local" | "custom";
    secret: string;
    events?: string[] | undefined;
    autoPublish?: boolean | undefined;
    tagPattern?: string | undefined;
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
      .all(provider, namespace, project) as (RepoWebhookRecord & {
      namespace: string;
      project: string;
      user_id: number;
    })[];
  }

  recordWebhookDelivery(params: {
    webhookId: number;
    eventType: string;
    payload: string;
    responseStatus?: number | undefined;
    errorMessage?: string | undefined;
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

  // ==========================================
  // Repository Bot Reviews
  // ==========================================

  createRepoBotReview(params: {
    repoId: number;
    botId: number;
    prNumber?: number | undefined;
    commitSha?: string | undefined;
    verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    summary: string;
    issuesJson?: string | undefined;
    postId?: number | undefined;
  }): { id: number } {
    const result = this.#db
      .prepare(
        `INSERT INTO repo_bot_reviews (repo_id, bot_id, pr_number, commit_sha, verdict, summary, issues_json, post_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.repoId,
        params.botId,
        params.prNumber ?? null,
        params.commitSha ?? null,
        params.verdict,
        params.summary,
        params.issuesJson ?? null,
        params.postId ?? null,
      );

    return { id: Number(result.lastInsertRowid) };
  }

  getRepoBotReviews(
    repoId: number,
    limit: number = 50,
  ): {
    id: number;
    repo_id: number;
    bot_id: number;
    bot_username: string;
    bot_display_name: string;
    pr_number: number | null;
    commit_sha: string | null;
    verdict: string;
    summary: string;
    issues_json: string | null;
    post_id: number | null;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT r.*, u.username as bot_username, u.display_name as bot_display_name
         FROM repo_bot_reviews r
         JOIN users u ON r.bot_id = u.id
         WHERE r.repo_id = ?
         ORDER BY r.created_at DESC
         LIMIT ?`,
      )
      .all(repoId, limit) as {
      id: number;
      repo_id: number;
      bot_id: number;
      bot_username: string;
      bot_display_name: string;
      pr_number: number | null;
      commit_sha: string | null;
      verdict: string;
      summary: string;
      issues_json: string | null;
      post_id: number | null;
      created_at: string;
    }[];
  }

  getRepoBotReviewById(id: number):
    | {
        id: number;
        repo_id: number;
        bot_id: number;
        bot_username: string;
        bot_display_name: string;
        pr_number: number | null;
        commit_sha: string | null;
        verdict: string;
        summary: string;
        issues_json: string | null;
        post_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT r.*, u.username as bot_username, u.display_name as bot_display_name
         FROM repo_bot_reviews r
         JOIN users u ON r.bot_id = u.id
         WHERE r.id = ?`,
      )
      .get(id) as
      | {
          id: number;
          repo_id: number;
          bot_id: number;
          bot_username: string;
          bot_display_name: string;
          pr_number: number | null;
          commit_sha: string | null;
          verdict: string;
          summary: string;
          issues_json: string | null;
          post_id: number | null;
          created_at: string;
        }
      | undefined;
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
      WHERE (username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)
        AND COALESCE(indexable, 1) = 1
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
   * Count indexed classes for a library version without loading documentation/row payloads.
   */
  getClassCount(libraryName: string, libraryVersion: string): number {
    const row = this.#db
      .prepare(`SELECT COUNT(*) AS cnt FROM classes WHERE library_name = ? AND library_version = ?`)
      .get(libraryName, libraryVersion) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /**
   * Check whether a specific class exists for a library version without loading component relations.
   */
  hasClass(libraryName: string, libraryVersion: string, className: string): boolean {
    const row = this.#db
      .prepare(`SELECT 1 AS ok FROM classes WHERE library_name = ? AND library_version = ? AND class_name = ? LIMIT 1`)
      .get(libraryName, libraryVersion, className) as { ok: number } | undefined;
    return Boolean(row);
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
    signature?: string | null | undefined;
    publishedBy?: number | null | undefined;
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
  getLibraryRelease(libraryName: string, libraryVersion: string): LibraryReleaseRow | null {
    const stmt = this.#db.prepare(`
      SELECT * FROM library_releases
      WHERE library_name = ? AND library_version = ?
    `);
    return (stmt.get(libraryName, libraryVersion) as LibraryReleaseRow | undefined) ?? null;
  }

  /**
   * Get all releases for a library name.
   */
  getLibraryReleases(libraryName: string): LibraryReleaseRow[] {
    const stmt = this.#db.prepare(`
      SELECT * FROM library_releases
      WHERE library_name = ?
    `);
    return stmt.all(libraryName) as LibraryReleaseRow[];
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
   * Check if a user has administrative permissions (owner/org-maintainer/admin collaborator) over a package.
   * Excludes 'write' collaborators from destructive/ownership/collaborator-management actions.
   */
  canUserAdministerPackage(libraryName: string, userId: number): boolean {
    const user = this.getUserById(userId);
    if (!user) return false;
    if (user.account_type === "admin") return true;

    const collabPerm = this.getPackageCollaboratorPermission(libraryName, userId);
    if (collabPerm === "admin") {
      return true;
    }

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
  getPendingTransfers(userId: number): PackageTransferRow[] {
    return this.#db
      .prepare(
        `SELECT t.*, u_from.username AS from_username, u_to.username AS to_username
         FROM package_ownership_transfers t
         JOIN users u_from ON t.from_user_id = u_from.id
         JOIN users u_to ON t.to_user_id = u_to.id
         WHERE (t.to_user_id = ? OR t.from_user_id = ?) AND t.status = 'pending'
         ORDER BY t.created_at DESC`,
      )
      .all(userId, userId) as PackageTransferRow[];
  }

  /**
   * Record a package download event for daily aggregation.
   */
  recordPackageDownload(libraryName: string, libraryVersion: string, dateStr?: string): void {
    if (this.analyticsBuffer) {
      this.analyticsBuffer.recordPackageDownload(libraryName, libraryVersion, dateStr);
      return;
    }
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
    this.analyticsBuffer?.flushSync();
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
  canUserPublishPackage(libraryName: string, userId: number): { allowed: boolean; reason?: string | undefined } {
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
    description?: string | null | undefined;
    avatarUrl?: string | null | undefined;
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

  getOrgMemberRole(orgId: number, userId: number): OrgRole | null {
    return this.getOrganizationMemberRole(orgId, userId);
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
      description?: string | null | undefined;
      readme?: string | null | undefined;
      readme_filename?: string | null | undefined;
      license?: string | null | undefined;
      homepage?: string | null | undefined;
      repository_type?: string | null | undefined;
      repository_url?: string | null | undefined;
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
    const row = this.#db.prepare(`SELECT geometry_json FROM cad_cache WHERE url = ?`).get(url) as
      | { geometry_json?: string | undefined }
      | undefined;
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
    metadata: Record<string, unknown> | null = null,
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
      | { credit_balance?: number | undefined }
      | undefined;
    return row?.credit_balance ?? 0;
  }

  deductUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Charge",
    metadata?: Record<string, unknown>,
  ): {
    id?: number | undefined;
    success: boolean;
    user_id: number;
    job_id: number | null;
    amount: number;
    balance_after: number;
    transaction_type: string;
    type: string;
    description: string;
    metadata?: string | undefined;
    newBalance: number;
  } {
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
        | { credit_balance?: number | undefined }
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

      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round(Math.max(0, currentBalance - roundedAmount) * 100) / 100;

      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);

      const txResult = this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'job_charge', ?, ?)`,
        )
        .run(userId, jobId, -roundedAmount, newBalance, description, JSON.stringify(metadata ?? {}));

      const txId = txResult.lastInsertRowid as number;

      if (newBalance <= 10) {
        const existingUnread = this.#db
          .prepare(`SELECT id FROM notifications WHERE user_id = ? AND type = 'credit_warning' AND read = 0`)
          .get(userId);
        if (!existingUnread) {
          this.createNotification(userId, userId, "credit_warning", null, {
            balance: newBalance,
            threshold: 10,
            message: `Your compute balance is ${newBalance} credits (below threshold of 10).`,
          });
        }
      }

      return {
        id: txId,
        user_id: userId,
        job_id: jobId,
        amount: -roundedAmount,
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
        | { credit_balance?: number | undefined }
        | undefined;

      if (!user) {
        throw new Error(`User with ID ${userId} not found`);
      }

      const currentBalance = user.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round((currentBalance + roundedAmount) * 100) / 100;

      this.#db.prepare(`UPDATE users SET credit_balance = ? WHERE id = ?`).run(newBalance, userId);

      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(userId, roundedAmount, newBalance, type, description, JSON.stringify(metadata ?? {}));

      return newBalance;
    });

    return grantTx();
  }

  hasProcessedStripeEvent(eventId?: string | null, paymentIntentId?: string | null): boolean {
    if (eventId) {
      const row = this.#db.prepare(`SELECT event_id FROM stripe_processed_events WHERE event_id = ?`).get(eventId);
      if (row) return true;
    }
    if (paymentIntentId) {
      const row = this.#db
        .prepare(`SELECT event_id FROM stripe_processed_events WHERE payment_intent_id = ?`)
        .get(paymentIntentId);
      if (row) return true;
    }
    return false;
  }

  recordProcessedStripeEvent(
    eventId: string,
    paymentIntentId: string | null,
    userId: number | null,
    amountCredits: number,
  ): boolean {
    try {
      this.#db
        .prepare(
          `INSERT INTO stripe_processed_events (event_id, payment_intent_id, user_id, amount_credits)
           VALUES (?, ?, ?, ?)`,
        )
        .run(eventId, paymentIntentId, userId, Math.round(amountCredits * 100) / 100);
      return true;
    } catch {
      return false;
    }
  }

  saveMorselSnippet(
    payloadJson: string,
    dialect: string = "modelica",
    title?: string | null,
    creatorId?: number | null,
  ): string {
    const id = crypto.createHash("sha256").update(payloadJson).digest("hex").slice(0, 16);
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO morsel_snippets (id, payload_json, dialect, title, creator_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, payloadJson, dialect || "modelica", title ?? null, creatorId ?? null);
    return id;
  }

  getMorselSnippet(id: string):
    | {
        id: string;
        payload_json: string;
        dialect: string;
        title: string | null;
        creator_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.#db
      .prepare(`SELECT id, payload_json, dialect, title, creator_id, created_at FROM morsel_snippets WHERE id = ?`)
      .get(id) as
      | {
          id: string;
          payload_json: string;
          dialect: string;
          title: string | null;
          creator_id: number | null;
          created_at: string;
        }
      | undefined;
  }

  holdUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Escrow Hold",
    metadata?: Record<string, unknown>,
  ): {
    success: boolean;
    holdId?: number | undefined;
    heldAmount: number;
    newBalance: number;
    reason?: string | undefined;
  } {
    if (amount <= 0) {
      const balance = this.getUserBalance(userId);
      return { success: true, heldAmount: 0, newBalance: balance };
    }

    const holdTx = this.#db.transaction(() => {
      const user = this.#db.prepare(`SELECT credit_balance FROM users WHERE id = ?`).get(userId) as
        | { credit_balance?: number | undefined }
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
        | { credit_balance?: number | undefined }
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
          this.createNotification(userId, userId, "credit_warning", null, {
            balance: currentBalance,
            threshold: 10,
            message: `Your compute balance is ${currentBalance} credits (below threshold of 10).`,
          });
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
        | { credit_balance?: number | undefined }
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

  releaseAllHeldEscrowsOnShutdown(): number {
    try {
      const heldRows = this.#db
        .prepare(`SELECT id, user_id, job_id, amount FROM credit_escrow_holds WHERE status = 'held'`)
        .all() as { id: number; user_id: number; job_id: number; amount: number }[];
      let releasedCount = 0;
      for (const row of heldRows) {
        try {
          this.releaseUserEscrow(row.user_id, row.job_id, "Server shutdown recovery");
          releasedCount++;
        } catch {}
      }
      this.#db
        .prepare(
          `UPDATE jobs SET status = 'CANCELLED', completed_at = datetime('now') WHERE status IN ('RUNNING', 'QUEUED', 'PENDING')`,
        )
        .run();
      return releasedCount;
    } catch {
      return 0;
    }
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
      | { count?: number | undefined }
      | undefined;
    return row?.count ?? 0;
  }

  getCreditTransactionById(txId: number): CreditTransactionRow | undefined {
    return this.#db
      .prepare(
        `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
         FROM credit_transactions
         WHERE id = ?`,
      )
      .get(txId) as CreditTransactionRow | undefined;
  }

  getOrgBalance(orgId: number): number {
    const row = this.#db.prepare(`SELECT credit_balance FROM organizations WHERE id = ?`).get(orgId) as
      | { credit_balance?: number | undefined }
      | undefined;
    return row?.credit_balance ?? 0;
  }

  grantOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    description: string = "Organization Shared Wallet Top-Up",
    metadata?: Record<string, unknown>,
  ): number {
    const grantTx = this.#db.transaction(() => {
      const org = this.#db
        .prepare(`SELECT id, credit_balance, created_by FROM organizations WHERE id = ?`)
        .get(orgId) as { id: number; credit_balance?: number | undefined; created_by?: number | undefined } | undefined;
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }

      const currentBalance = org.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      const newBalance = Math.round((currentBalance + roundedAmount) * 100) / 100;

      this.#db.prepare(`UPDATE organizations SET credit_balance = ? WHERE id = ?`).run(newBalance, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, NULL, ?, ?, 'org_top_up', ?, ?)`,
        )
        .run(effectiveUserId, roundedAmount, newBalance, description, JSON.stringify({ orgId, ...(metadata ?? {}) }));

      return newBalance;
    });
    return grantTx();
  }

  deductOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    jobId: number | null = null,
    description: string = "Organization Compute Charge",
    metadata?: Record<string, unknown>,
  ): { success: boolean; newBalance: number; amount: number } {
    if (amount <= 0) {
      return { success: true, newBalance: this.getOrgBalance(orgId), amount: 0 };
    }
    const deductTx = this.#db.transaction(() => {
      const org = this.#db
        .prepare(`SELECT id, credit_balance, total_spent, created_by FROM organizations WHERE id = ?`)
        .get(orgId) as
        | {
            id: number;
            credit_balance?: number | undefined;
            total_spent?: number | undefined;
            created_by?: number | undefined;
          }
        | undefined;
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }
      const currentBalance = org.credit_balance ?? 0;
      const roundedAmount = Math.round(amount * 100) / 100;
      if (currentBalance < roundedAmount) {
        return { success: false, newBalance: currentBalance, amount: -roundedAmount };
      }
      const newBalance = Math.round(Math.max(0, currentBalance - roundedAmount) * 100) / 100;
      const newTotalSpent = Math.round(((org.total_spent ?? 0) + roundedAmount) * 100) / 100;

      this.#db
        .prepare(`UPDATE organizations SET credit_balance = ?, total_spent = ? WHERE id = ?`)
        .run(newBalance, newTotalSpent, orgId);

      const effectiveUserId = actorUserId ?? org.created_by ?? 1;
      this.#db
        .prepare(
          `INSERT INTO credit_transactions (user_id, job_id, amount, balance_after, type, description, metadata)
           VALUES (?, ?, ?, ?, 'org_job_charge', ?, ?)`,
        )
        .run(
          effectiveUserId,
          jobId,
          -roundedAmount,
          newBalance,
          description,
          JSON.stringify({ orgId, ...(metadata ?? {}) }),
        );

      return { success: true, newBalance, amount: -roundedAmount };
    });
    return deductTx();
  }

  getOrgWalletSummary(orgId: number): {
    orgId: number;
    name: string;
    slug: string;
    balance: number;
    totalSpent: number;
    transactions: CreditTransactionRow[];
  } | null {
    const org = this.#db
      .prepare(`SELECT id, name, slug, credit_balance, total_spent FROM organizations WHERE id = ?`)
      .get(orgId) as
      | {
          id: number;
          name: string;
          slug: string;
          credit_balance?: number | undefined;
          total_spent?: number | undefined;
        }
      | undefined;
    if (!org) return null;

    const transactions = this.#db
      .prepare(
        `SELECT id, user_id, job_id, amount, balance_after, type, type as transaction_type, description, metadata, created_at
         FROM credit_transactions
         WHERE json_valid(metadata) AND CAST(json_extract(metadata, '$.orgId') AS INTEGER) = ?
         ORDER BY id DESC
         LIMIT 50`,
      )
      .all(orgId) as CreditTransactionRow[];

    return {
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      balance: org.credit_balance ?? 0,
      totalSpent: org.total_spent ?? 0,
      transactions,
    };
  }

  #readOrComputeBackupSha256(backupPath: string): string {
    const sidecarPath = `${backupPath}.sha256`;
    try {
      if (fs.existsSync(sidecarPath)) {
        const cached = fs.readFileSync(sidecarPath, "utf8").trim().split(/\s+/)[0] || "";
        if (/^[a-f0-9]{64}$/i.test(cached)) {
          return cached.toLowerCase();
        }
      }
      const computed = crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
      try {
        fs.writeFileSync(sidecarPath, computed, "utf8");
      } catch {
        // Ignore if directory is read-only
      }
      return computed;
    } catch {
      return "";
    }
  }

  async waitForPendingBackupReplications(): Promise<void> {
    await Promise.allSettled([...this.#pendingBackupReplications]);
  }

  async #replicateBackupToS3(backupPath: string, shaPath: string): Promise<void> {
    const bucket = process.env["S3_BUCKET"]?.trim();
    if (!bucket) return;
    try {
      const driver = new S3StorageDriver({
        bucket,
        region: process.env["S3_REGION"] || process.env["AWS_REGION"] || "us-east-1",
        endpoint: process.env["S3_ENDPOINT"] || undefined,
        accessKeyId: process.env["S3_ACCESS_KEY_ID"] || process.env["AWS_ACCESS_KEY_ID"] || undefined,
        secretAccessKey: process.env["S3_SECRET_ACCESS_KEY"] || process.env["AWS_SECRET_ACCESS_KEY"] || undefined,
        forcePathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
      });
      const fileName = path.basename(backupPath);
      const dbBuffer = await fs.promises.readFile(backupPath);
      await driver.write(`backups/${fileName}`, dbBuffer, { contentType: "application/x-sqlite3" });
      if (fs.existsSync(shaPath)) {
        const shaBuffer = await fs.promises.readFile(shaPath);
        await driver.write(`backups/${path.basename(shaPath)}`, shaBuffer, { contentType: "text/plain" });
      }
    } catch (err) {
      console.warn(
        "[HotBackup] S3 backup replication failed for %s:",
        path.basename(backupPath),
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  createHotBackup(customLabel?: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } {
    const backupDir = path.resolve(this.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const safeLabel = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}` : "";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `modelscript-backup-${timestamp}${safeLabel}.db`;
    const backupPath = path.resolve(backupDir, fileName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid backup path");
    }

    // Checkpoint WAL and perform online consistent snapshot using parameterized VACUUM INTO
    this.#db.prepare("VACUUM INTO ?").run(backupPath);

    const stats = fs.statSync(backupPath);
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(backupPath)).digest("hex");
    const shaPath = `${backupPath}.sha256`;
    try {
      fs.writeFileSync(shaPath, sha256, "utf8");
    } catch {
      // Ignore sidecar write error
    }

    if (process.env["STORAGE_BACKEND"] === "s3" && process.env["S3_BUCKET"]?.trim()) {
      const p = this.#replicateBackupToS3(backupPath, shaPath).finally(() => {
        this.#pendingBackupReplications.delete(p);
      });
      this.#pendingBackupReplications.add(p);
    }

    return {
      fileName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };
  }

  listBackups(): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  }[] {
    const backupDir = path.join(this.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      return [];
    }
    return fs
      .readdirSync(backupDir)
      .filter((name) => name.endsWith(".db"))
      .map((fileName) => {
        const backupPath = path.join(backupDir, fileName);
        const stats = fs.statSync(backupPath);
        const sha256 = this.#readOrComputeBackupSha256(backupPath);
        return {
          fileName,
          backupPath,
          sizeBytes: stats.size,
          createdAt: stats.mtime.toISOString(),
          sha256,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getBackupByFileName(fileName: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } | null {
    const cleanName = path.basename(fileName.trim());
    if (!cleanName || cleanName !== fileName.trim() || !cleanName.endsWith(".db")) {
      return null;
    }
    const backupDir = path.resolve(this.dbDir, "backups");
    const backupPath = path.resolve(backupDir, cleanName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(backupPath)) {
      return null;
    }
    const stats = fs.statSync(backupPath);
    const sha256 = this.#readOrComputeBackupSha256(backupPath);
    return {
      fileName: cleanName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };
  }

  deleteBackup(fileName: string): boolean {
    const backup = this.getBackupByFileName(fileName);
    if (!backup) return false;
    try {
      fs.unlinkSync(backup.backupPath);
      const sidecarPath = `${backup.backupPath}.sha256`;
      if (fs.existsSync(sidecarPath)) {
        try {
          fs.unlinkSync(sidecarPath);
        } catch {
          // Ignore sidecar unlink error
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  pruneBackups(keepCount: number = 7): { deletedCount: number; deletedFiles: string[] } {
    const safeKeep = Math.max(1, Math.min(100, Math.floor(keepCount)));
    const all = this.listBackups();
    if (all.length <= safeKeep) {
      return { deletedCount: 0, deletedFiles: [] };
    }
    const toDelete = all.slice(safeKeep);
    const deletedFiles: string[] = [];
    for (const item of toDelete) {
      if (this.deleteBackup(item.fileName)) {
        deletedFiles.push(item.fileName);
      }
    }
    return { deletedCount: deletedFiles.length, deletedFiles };
  }

  restoreFromBackup(fileName: string): {
    success: boolean;
    restoredFrom: string;
    preRestoreBackup: string;
    tablesRestored: number;
  } {
    const target = this.getBackupByFileName(fileName);
    if (!target) {
      throw new Error(`Backup snapshot '${fileName}' not found.`);
    }

    // 1. Verify integrity of the target backup snapshot before touching the live database
    const verifyDb = new Database(target.backupPath, { readonly: true });
    try {
      const check = verifyDb.pragma("integrity_check") as { integrity_check: string }[];
      const isOk = check.length === 1 && check[0]?.integrity_check === "ok";
      if (!isOk) {
        throw new Error(`Backup snapshot '${fileName}' failed SQLite integrity_check.`);
      }
    } finally {
      verifyDb.close();
    }

    // 2. Create an automatic pre-restore safety snapshot
    const preRestore = this.createHotBackup("pre-restore");

    // Clear in-memory analytics buffer and cached audit log state before replacing tables
    this.analyticsBuffer?.clear();
    this.#auditChainCache = null;

    // 3. Perform online atomic table restoration from the attached backup snapshot
    this.#db.pragma("foreign_keys = OFF");
    this.#db.prepare(`ATTACH DATABASE ? AS restore_src`).run(target.backupPath);
    let tablesRestored = 0;
    try {
      const mainTables = (
        this.#db
          .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
          .all() as { name: string }[]
      ).map((r) => r.name);

      const srcTables = new Set(
        (
          this.#db
            .prepare(`SELECT name FROM restore_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
            .all() as { name: string }[]
        ).map((r) => r.name),
      );

      const restoreTx = this.#db.transaction(() => {
        for (const table of mainTables) {
          if (!/^[a-zA-Z0-9_]+$/.test(table)) continue;
          // Always clear main table even if it didn't exist in the older backup snapshot
          this.#db.prepare(`DELETE FROM main."${table}"`).run();
          if (!srcTables.has(table)) continue;

          const mainCols = (this.#db.prepare(`PRAGMA main.table_info("${table}")`).all() as { name: string }[]).map(
            (c) => c.name,
          );
          const srcCols = new Set(
            (this.#db.prepare(`PRAGMA restore_src.table_info("${table}")`).all() as { name: string }[]).map(
              (c) => c.name,
            ),
          );
          const sharedCols = mainCols.filter((c) => srcCols.has(c) && /^[a-zA-Z0-9_]+$/.test(c));
          if (sharedCols.length === 0) continue;

          const colList = sharedCols.map((c) => `"${c}"`).join(", ");
          this.#db
            .prepare(`INSERT INTO main."${table}" (${colList}) SELECT ${colList} FROM restore_src."${table}"`)
            .run();
          tablesRestored++;
        }
      });
      restoreTx.immediate();
    } finally {
      try {
        this.#db.prepare(`DETACH DATABASE restore_src`).run();
      } catch {
        // Ignore if already detached
      }
      this.#db.pragma("foreign_keys = ON");
    }

    // Re-run any migrations that were not yet applied in the restored snapshot
    this.#runner.runPendingSync(allMigrations, { silent: true, skipBackup: true });
    this.#auditChainCache = null;

    return {
      success: true,
      restoredFrom: target.fileName,
      preRestoreBackup: preRestore.fileName,
      tablesRestored,
    };
  }

  saveUploadedBackup(
    fileBuffer: Buffer,
    customLabel?: string,
    restoreImmediately?: boolean,
  ): {
    backup: {
      fileName: string;
      backupPath: string;
      sizeBytes: number;
      createdAt: string;
      sha256: string;
    };
    restoreResult?: ReturnType<LibraryDatabase["restoreFromBackup"]> | undefined;
  } {
    if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 100) {
      throw new Error("Uploaded file is empty or too small to be a valid SQLite database.");
    }
    const headerStr = fileBuffer.subarray(0, 16).toString("utf8");
    if (headerStr !== "SQLite format 3\0") {
      throw new Error("Uploaded file does not have a valid SQLite 3 binary header ('SQLite format 3').");
    }

    const backupDir = path.resolve(this.dbDir, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const cleanLabel = customLabel ? `-${customLabel.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28)}` : "-uploaded";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `modelscript-backup-${timestamp}${cleanLabel}.db`;
    const backupPath = path.resolve(backupDir, fileName);
    const rel = path.relative(backupDir, backupPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Invalid backup destination path.");
    }

    fs.writeFileSync(backupPath, fileBuffer);

    try {
      const verifyDb = new Database(backupPath, { readonly: true });
      try {
        const check = verifyDb.pragma("integrity_check") as { integrity_check: string }[];
        const isOk = check.length === 1 && check[0]?.integrity_check === "ok";
        if (!isOk) {
          throw new Error("Uploaded SQLite file failed PRAGMA integrity_check.");
        }
      } finally {
        verifyDb.close();
      }
    } catch (err) {
      try {
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      } catch {
        // ignore unlink error
      }
      throw err instanceof Error ? err : new Error("Uploaded SQLite snapshot failed integrity verification.");
    }

    const stats = fs.statSync(backupPath);
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    try {
      fs.writeFileSync(`${backupPath}.sha256`, sha256, "utf8");
    } catch {
      // Ignore sidecar write error
    }
    const backup = {
      fileName,
      backupPath,
      sizeBytes: stats.size,
      createdAt: stats.mtime.toISOString(),
      sha256,
    };

    const restoreResult = restoreImmediately ? this.restoreFromBackup(fileName) : undefined;
    return {
      backup,
      restoreResult,
    };
  }

  getUserBillingSummary(userId: number): UserBillingSummary {
    const balance = this.getUserBalance(userId);
    const jobs = this.#db
      .prepare(
        `SELECT compute_profile, cpu_seconds, gpu_seconds, cost_credits
         FROM jobs
         WHERE user_id = ? AND status = 'SUCCESS'`,
      )
      .all(userId) as {
      compute_profile: string | null;
      cpu_seconds: number | null;
      gpu_seconds: number | null;
      cost_credits: number | null;
    }[];

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
    const isProd = process.env["NODE_ENV"] === "production";
    const whereUser = isProd ? "user_id = ?" : "(user_id = ? OR user_id IS NULL OR user_id = 1)";
    const jobs = this.#db
      .prepare(
        `SELECT id, name, status, type, metadata, started_at, completed_at,
                compute_profile, cpu_seconds, peak_memory_mb, gpu_seconds, cost_credits, user_id
         FROM jobs
         WHERE ${whereUser}
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
      let scalars: Record<string, unknown> | undefined;

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
            scalars = JSON.parse(fs.readFileSync(scalarsPath, "utf8")) as Record<string, unknown>;
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
    options?: { colormap?: string | undefined; title?: string | undefined; activeField?: string | undefined },
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

    let scalars: Record<string, unknown> = {};
    if (resultDir && fs.existsSync(path.join(resultDir, "scalars.json"))) {
      try {
        scalars = JSON.parse(fs.readFileSync(path.join(resultDir, "scalars.json"), "utf8")) as Record<string, unknown>;
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

    const defaultJobThumbnail: string | undefined = undefined;

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
      thumbnailUrl: defaultJobThumbnail,
      thumbnailUrlLight: defaultJobThumbnail,
      thumbnailUrlDark: defaultJobThumbnail,
      provenance: {
        solver,
        profile: computeProfile,
        costCredits,
        cpuSeconds,
        completedAt: job.completed_at || job.started_at,
        jobId: job.id,
      },
    };

    const artifactId = this.createArtifactView(
      userId,
      artifactType,
      "hpc_job",
      JSON.stringify(viewConfig),
      title,
      defaultJobThumbnail,
    );

    // Auto-generate technical caption using only verified scalar outputs
    let suggestedCaption = "";
    if (solver === "calculix") {
      const maxStress = scalars["maxStressMpa"] ?? scalars["max_stress"];
      const stressNote =
        maxStress !== undefined && maxStress !== null
          ? ` Peak von Mises stress: ${maxStress} MPa under design load.`
          : "";
      suggestedCaption = `Completed structural FEA simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s).${stressNote} Billed: ${costCredits.toFixed(2)} cr. #FEA #CalculiX #HPC`;
    } else if (solver === "su2") {
      const cd = scalars["cd"] ?? scalars["drag_coefficient"];
      const cl = scalars["cl"] ?? scalars["lift_coefficient"];
      const aeroNote = cd !== undefined && cl !== undefined ? ` Drag Cd: ${cd}, Lift Cl: ${cl}.` : "";
      suggestedCaption = `Completed aerodynamic CFD simulation on ${computeProfile} node (${cpuSeconds.toFixed(1)}s).${aeroNote} Billed: ${costCredits.toFixed(2)} cr. #CFD #SU2 #Aerodynamics`;
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

  // ── Script & Study Templates ────────────────────────────────────

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
        `INSERT INTO script_templates (name, slug, description, category, icon, config, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(slug) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           category = excluded.category,
           icon = excluded.icon,
           config = excluded.config,
           updated_at = datetime('now')`,
      )
      .run(name, slug, description, category, icon, JSON.stringify(config));
    return Number(result.lastInsertRowid);
  }

  getScriptTemplates(): ScriptTemplateRow[] {
    return this.#db.prepare(`SELECT * FROM script_templates ORDER BY category, name`).all() as ScriptTemplateRow[];
  }

  getScriptTemplate(id: number): ScriptTemplateRow | undefined {
    return this.#db.prepare(`SELECT * FROM script_templates WHERE id = ?`).get(id) as ScriptTemplateRow | undefined;
  }

  getScriptTemplateBySlugOrId(idOrSlug: number | string): ScriptTemplateRow | undefined {
    const numId = typeof idOrSlug === "number" ? idOrSlug : parseInt(String(idOrSlug), 10);
    if (!Number.isNaN(numId) && String(numId) === String(idOrSlug)) {
      const byId = this.getScriptTemplate(numId);
      if (byId) return byId;
    }
    return this.#db.prepare(`SELECT * FROM script_templates WHERE slug = ? LIMIT 1`).get(String(idOrSlug)) as
      | ScriptTemplateRow
      | undefined;
  }

  updateJobMetadata(jobId: number, patch: Record<string, unknown>): void {
    const existing = this.getJob(jobId);
    if (!existing) return;
    let currentMeta: Record<string, unknown> = {};
    try {
      if (existing.metadata) {
        currentMeta = JSON.parse(existing.metadata) as Record<string, unknown>;
      }
    } catch {}
    const merged = { ...currentMeta, ...patch };
    this.#db.prepare(`UPDATE jobs SET metadata = ? WHERE id = ?`).run(JSON.stringify(merged), existing.id);
  }

  getPackageStudyArtifacts(): {
    artifactId: number;
    packageName: string;
    packageVersion: string;
    path: string;
    metadata: Record<string, unknown>;
  }[] {
    try {
      const rows = this.#db
        .prepare(
          `SELECT a.id AS artifactId, p.name AS packageName, pv.version AS packageVersion, a.path, a.metadata
           FROM artifacts a
           JOIN package_versions pv ON pv.id = a.version_id
           JOIN packages p ON p.id = pv.package_id
           WHERE a.type = 'study-template'
           ORDER BY pv.published_at DESC
           LIMIT 100`,
        )
        .all() as {
        artifactId: number;
        packageName: string;
        packageVersion: string;
        path: string;
        metadata: string | null;
      }[];
      return rows.map((r) => {
        let meta: Record<string, unknown> = {};
        try {
          if (r.metadata) meta = JSON.parse(r.metadata) as Record<string, unknown>;
        } catch {}
        return {
          artifactId: r.artifactId,
          packageName: r.packageName,
          packageVersion: r.packageVersion,
          path: r.path,
          metadata: meta,
        };
      });
    } catch {
      return [];
    }
  }

  searchIndexedModelsForStudy(opts?: { q?: string | undefined; limit?: number | undefined }): {
    libraryName: string;
    libraryVersion: string;
    className: string;
    classKind: string;
    description: string | null;
    components: {
      name: string;
      typeName: string;
      variability: string | null;
      causality: string | null;
      description: string | null;
      defaultValue: string | null;
    }[];
  }[] {
    const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 100);
    const q = opts?.q?.trim();
    try {
      let sql = `SELECT id, library_name, library_version, class_name, class_kind, description
                 FROM classes
                 WHERE class_kind IN ('model', 'block', 'class', 'cad-assembly', 'part')`;
      const params: (string | number)[] = [];
      if (q) {
        sql += ` AND (class_name LIKE ? OR library_name LIKE ? OR description LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      sql += ` ORDER BY id DESC LIMIT ?`;
      params.push(limit);

      const classRows = this.#db.prepare(sql).all(...params) as ClassRow[];
      const getComps = this.#db.prepare(
        `SELECT id, component_name, type_name, description, causality, variability
         FROM components WHERE class_id = ? LIMIT 30`,
      );
      const getMods = this.#db.prepare(
        `SELECT modifier_name, modifier_value FROM modifiers WHERE component_id = ? LIMIT 5`,
      );

      return classRows.map((c) => {
        const comps = getComps.all(c.id) as ComponentRow[];
        return {
          libraryName: c.library_name,
          libraryVersion: c.library_version,
          className: c.class_name,
          classKind: c.class_kind,
          description: c.description,
          components: comps.map((comp) => {
            const mods = getMods.all(comp.id) as { modifier_name: string; modifier_value: string | null }[];
            const startMod = mods.find((m) => m.modifier_name === "start" || m.modifier_name === "value");
            return {
              name: comp.component_name,
              typeName: comp.type_name,
              variability: comp.variability,
              causality: comp.causality,
              description: comp.description,
              defaultValue: startMod?.modifier_value ?? null,
            };
          }),
        };
      });
    } catch {
      return [];
    }
  }

  // ── Serialized Instances (Digital Twins) ───────────────────────

  createInstance(data: {
    serialNumber: string;
    packageId: number;
    version: string;
    commitSha?: string | null | undefined;
    variant?: string | null | undefined;
    birthData?: string | null | undefined;
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
  ): {
    id: number;
    serial_number: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT id, serial_number, version, commit_sha, variant, created_at
         FROM instances
         WHERE package_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(packageId, limit) as {
      id: number;
      serial_number: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }[];
  }

  listInstances(limit = 50): {
    id: number;
    serial_number: string;
    package_id: number;
    package_name: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT i.id, i.serial_number, i.package_id, p.name as package_name, i.version, i.commit_sha, i.variant, i.created_at
         FROM instances i
         JOIN packages p ON p.id = i.package_id
         ORDER BY i.id DESC
         LIMIT ?`,
      )
      .all(limit) as {
      id: number;
      serial_number: string;
      package_id: number;
      package_name: string;
      version: string;
      commit_sha: string | null;
      variant: string | null;
      created_at: string;
    }[];
  }

  // ── Digital Twin Methods ──

  createTwin(data: {
    instanceId: number;
    name: string;
    modelicaClass: string;
    status?: string | undefined;
    healthScore?: number | undefined;
    config: string;
    currentParameters: string;
    currentWeights?: string | null | undefined;
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
      .get(id) as
      | (TwinRow & {
          instance_serial: string;
          package_name: string;
          package_version: string;
        })
      | undefined;
  }

  getTwinByInstanceId(instanceId: number): TwinRow | undefined {
    return this.#db.prepare(`SELECT * FROM twins WHERE instance_id = ? ORDER BY id DESC LIMIT 1`).get(instanceId) as
      | TwinRow
      | undefined;
  }

  listTwins(limit = 50): (TwinRow & {
    instance_serial: string;
    package_name: string;
    package_version: string;
  })[] {
    return this.#db
      .prepare(
        `SELECT t.*, i.serial_number as instance_serial, p.name as package_name, i.version as package_version
         FROM twins t
         JOIN instances i ON i.id = t.instance_id
         JOIN packages p ON p.id = i.package_id
         ORDER BY t.id DESC
         LIMIT ?`,
      )
      .all(limit) as (TwinRow & {
      instance_serial: string;
      package_name: string;
      package_version: string;
    })[];
  }

  updateTwinState(
    id: number,
    data: {
      status?: string | undefined;
      healthScore?: number | undefined;
      currentParameters?: string | undefined;
      currentWeights?: string | null | undefined;
      lastTelemetryAt?: string | undefined;
      lastAdaptedAt?: string | undefined;
    },
  ): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];

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

  createTwinProposal(data: { twinId: number; postId?: number | null | undefined; adaptationId: number }): number {
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
      .get(id) as
      | (TwinProposalRow & {
          twin_name: string;
          prior_parameters: string;
          updated_parameters: string;
        })
      | undefined;
  }

  listTwinProposals(
    twinId?: number,
    status?: string,
    limit = 50,
  ): (TwinProposalRow & {
    twin_name: string;
    prior_parameters: string;
    updated_parameters: string;
  })[] {
    let query = `
      SELECT p.*, t.name as twin_name, a.prior_parameters, a.updated_parameters
      FROM twin_proposals p
      JOIN twins t ON t.id = p.twin_id
      JOIN twin_adaptations a ON a.id = p.adaptation_id
    `;
    const clauses: string[] = [];
    const params: (string | number)[] = [];

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

    return this.#db.prepare(query).all(...params) as (TwinProposalRow & {
      twin_name: string;
      prior_parameters: string;
      updated_parameters: string;
    })[];
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
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
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
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
  }[] {
    const rows = this.#db.prepare(`SELECT * FROM sysml2_projects ORDER BY created ASC`).all() as {
      id: string;
      name: string;
      description: string | null;
      created: string;
      default_branch: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Project" as const,
      name: r.name,
      description: r.description || undefined,
      created: r.created,
      defaultBranch: JSON.parse(r.default_branch) as {
        "@id": string;
        name: string;
        headCommitId?: string | undefined;
      },
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
      this.#db.prepare(`DELETE FROM sysml2_tags WHERE project_id = ?`).run(projectId);
      this.#db.prepare(`DELETE FROM sysml2_branches WHERE project_id = ?`).run(projectId);
      this.#db.prepare(`DELETE FROM sysml2_commits WHERE project_id = ?`).run(projectId);
      this.#db.prepare(`DELETE FROM sysml2_projects WHERE id = ?`).run(projectId);
    })();
  }

  saveSysml2Branch(branch: {
    "@id": string;
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_branches (id, project_id, name, head_commit_id, created)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(branch["@id"], branch.projectId, branch.name, branch.headCommitId || null, branch.created);
  }

  getSysml2Branches(projectId: string): {
    "@id": string;
    "@type": "Branch";
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }[] {
    const rows = this.#db
      .prepare(`SELECT * FROM sysml2_branches WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      name: string;
      head_commit_id: string | null;
      created: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Branch" as const,
      projectId: r.project_id,
      name: r.name,
      headCommitId: r.head_commit_id || undefined,
      created: r.created,
    }));
  }

  deleteSysml2Branch(projectId: string, branchId: string): boolean {
    const res = this.#db
      .prepare(`DELETE FROM sysml2_branches WHERE project_id = ? AND id = ?`)
      .run(projectId, branchId);
    return res.changes > 0;
  }

  saveSysml2Tag(tag: {
    "@id": string;
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_tags (id, project_id, name, tagged_commit_id, created)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tag["@id"], tag.projectId, tag.name, tag.taggedCommit["@id"], tag.created);
  }

  getSysml2Tags(projectId: string): {
    "@id": string;
    "@type": "Tag";
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }[] {
    const rows = this.#db
      .prepare(`SELECT * FROM sysml2_tags WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      name: string;
      tagged_commit_id: string;
      created: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Tag" as const,
      projectId: r.project_id,
      name: r.name,
      taggedCommit: { "@id": r.tagged_commit_id },
      created: r.created,
    }));
  }

  saveSysml2Commit(commit: {
    "@id": string;
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_commits (id, project_id, description, created, previous_commit, merged_commit)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commit["@id"],
        commit.projectId,
        commit.description,
        commit.created,
        commit.previousCommit ? commit.previousCommit["@id"] : null,
        commit.mergedCommit ? commit.mergedCommit["@id"] : null,
      );
  }

  getSysml2Commits(projectId: string): {
    "@id": string;
    "@type": "Commit";
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }[] {
    const rows = this.#db
      .prepare(`SELECT * FROM sysml2_commits WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      description: string;
      created: string;
      previous_commit: string | null;
      merged_commit: string | null;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Commit" as const,
      projectId: r.project_id,
      description: r.description,
      created: r.created,
      previousCommit: r.previous_commit ? { "@id": r.previous_commit } : null,
      ...(r.merged_commit ? { mergedCommit: { "@id": r.merged_commit } } : {}),
    }));
  }

  saveSysml2Elements(commitId: string, elements: Record<string, unknown>[]): void {
    const insertStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO sysml2_elements (id, commit_id, name, qualified_name, owner_id, is_abstract, element_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#db.transaction(() => {
      for (const elem of elements) {
        const owner = elem["owner"] as { "@id"?: string | undefined } | null | undefined;
        insertStmt.run(
          elem["@id"] as string,
          commitId,
          (elem["name"] as string | undefined) || "",
          (elem["qualifiedName"] as string | undefined) || "",
          owner?.["@id"] || null,
          elem["isAbstract"] ? 1 : 0,
          JSON.stringify(elem),
        );
      }
    })();
  }

  getSysml2Elements(commitId: string): Record<string, unknown>[] {
    const rows = this.#db.prepare(`SELECT element_json FROM sysml2_elements WHERE commit_id = ?`).all(commitId) as {
      element_json: string;
    }[];
    return rows.map((r) => JSON.parse(r.element_json) as Record<string, unknown>);
  }

  saveSysml2Relationships(commitId: string, relationships: Record<string, unknown>[]): void {
    const insertStmt = this.#db.prepare(`
      INSERT OR REPLACE INTO sysml2_relationships (id, commit_id, source_id, target_id, rel_type, rel_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#db.transaction(() => {
      for (const rel of relationships) {
        const source = rel["source"] as { "@id"?: string | undefined }[] | undefined;
        const target = rel["target"] as { "@id"?: string | undefined }[] | undefined;
        const sourceId = source?.[0]?.["@id"] || "";
        const targetId = target?.[0]?.["@id"] || "";
        insertStmt.run(
          rel["@id"] as string,
          commitId,
          sourceId,
          targetId,
          (rel["relationshipType"] as string | undefined) || "",
          JSON.stringify(rel),
        );
      }
    })();
  }

  getSysml2Relationships(commitId: string): Record<string, unknown>[] {
    const rows = this.#db.prepare(`SELECT rel_json FROM sysml2_relationships WHERE commit_id = ?`).all(commitId) as {
      rel_json: string;
    }[];
    return rows.map((r) => JSON.parse(r.rel_json) as Record<string, unknown>);
  }

  getFeatureFlags(): {
    flag_key: string;
    is_enabled: number;
    rollout_percentage: number;
    allowed_roles: string;
    updated_at: string;
  }[] {
    return this.#db.prepare(`SELECT * FROM feature_flags`).all() as {
      flag_key: string;
      is_enabled: number;
      rollout_percentage: number;
      allowed_roles: string;
      updated_at: string;
    }[];
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
    return this.#db.prepare(`SELECT * FROM feature_flags WHERE flag_key = ?`).get(key) as
      | {
          flag_key: string;
          is_enabled: number;
          rollout_percentage: number;
          allowed_roles: string;
          updated_at: string;
        }
      | undefined;
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

  createThreadProposal(proposal: {
    threadId: string;
    title: string;
    description?: string | undefined;
    proposedBy: string;
    diffSummary: string | object;
    safetyStandard?: string | undefined;
  }): ThreadProposal {
    const diffStr =
      typeof proposal.diffSummary === "object" ? JSON.stringify(proposal.diffSummary) : proposal.diffSummary;
    const stmt = this.#db.prepare(`
      INSERT INTO thread_proposals (thread_id, title, description, status, proposed_by, diff_summary, created_at)
      VALUES (?, ?, ?, 'open', ?, ?, datetime('now'))
    `);
    const res = stmt.run(proposal.threadId, proposal.title, proposal.description || null, proposal.proposedBy, diffStr);
    const newId = Number(res.lastInsertRowid);

    this.logThreadAudit({
      threadId: proposal.threadId,
      proposalId: newId,
      action: "proposal_created",
      actor: proposal.proposedBy,
      safetyStandard: proposal.safetyStandard || "ISO-26262",
      metadata: { title: proposal.title, diffSummary: proposal.diffSummary },
    });

    return this.getThreadProposalById(newId)!;
  }

  getThreadProposalById(id: number): ThreadProposal | undefined {
    return this.#db.prepare(`SELECT * FROM thread_proposals WHERE id = ?`).get(id) as ThreadProposal | undefined;
  }

  getThreadProposals(threadId?: string, status?: string): ThreadProposal[] {
    let sql = `SELECT * FROM thread_proposals WHERE 1=1`;
    const params: string[] = [];
    if (threadId) {
      sql += ` AND thread_id = ?`;
      params.push(threadId);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC`;
    return this.#db.prepare(sql).all(...params) as ThreadProposal[];
  }

  reviewThreadProposal(
    id: number,
    status: "approved" | "rejected" | "applied",
    resolvedBy: string,
    comment?: string,
    safetyStandard?: string,
  ): ThreadProposal | undefined {
    const existing = this.getThreadProposalById(id);
    if (!existing) return undefined;

    this.#db
      .prepare(
        `
      UPDATE thread_proposals
      SET status = ?, resolved_at = datetime('now'), resolved_by = ?, review_comment = ?
      WHERE id = ?
    `,
      )
      .run(status, resolvedBy, comment || null, id);

    this.logThreadAudit({
      threadId: existing.thread_id,
      proposalId: id,
      action: `proposal_${status}`,
      actor: resolvedBy,
      safetyStandard: safetyStandard || "ISO-26262",
      metadata: { comment, previousStatus: existing.status, newStatus: status },
    });

    return this.getThreadProposalById(id);
  }

  logThreadAudit(entry: {
    threadId: string;
    proposalId?: number | null | undefined;
    action: string;
    actor: string;
    safetyStandard?: string | null | undefined;
    metadata?: string | object | undefined;
  }): ThreadAuditLogEntry {
    const last = this.#db
      .prepare(`SELECT checksum FROM thread_audit_log WHERE thread_id = ? ORDER BY id DESC LIMIT 1`)
      .get(entry.threadId) as { checksum: string } | undefined;
    const prevChecksum = last?.checksum || "GENESIS_ROOT";

    const metaStr = entry.metadata
      ? typeof entry.metadata === "object"
        ? JSON.stringify(entry.metadata)
        : entry.metadata
      : null;

    // Cryptographic hash chaining: SHA256(prevChecksum + fields)
    const raw = `${prevChecksum}:${entry.threadId}:${entry.proposalId ?? ""}:${entry.action}:${entry.actor}:${entry.safetyStandard ?? ""}:${metaStr ?? ""}`;
    const checksum = crypto.createHash("sha256").update(raw).digest("hex");

    const stmt = this.#db.prepare(`
      INSERT INTO thread_audit_log (thread_id, proposal_id, action, actor, safety_standard, checksum, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const res = stmt.run(
      entry.threadId,
      entry.proposalId ?? null,
      entry.action,
      entry.actor,
      entry.safetyStandard ?? null,
      checksum,
      metaStr,
    );

    return this.#db
      .prepare(`SELECT * FROM thread_audit_log WHERE id = ?`)
      .get(res.lastInsertRowid) as ThreadAuditLogEntry;
  }

  getThreadAuditLogs(threadId?: string): ThreadAuditLogEntry[] {
    if (threadId) {
      return this.#db
        .prepare(`SELECT * FROM thread_audit_log WHERE thread_id = ? ORDER BY id ASC`)
        .all(threadId) as ThreadAuditLogEntry[];
    }
    return this.#db.prepare(`SELECT * FROM thread_audit_log ORDER BY id ASC`).all() as ThreadAuditLogEntry[];
  }

  verifyThreadAuditChain(threadId: string): { valid: boolean; totalEntries: number; brokenAtId?: number | undefined } {
    const logs = this.getThreadAuditLogs(threadId);
    let prevChecksum = "GENESIS_ROOT";

    for (const log of logs) {
      const raw = `${prevChecksum}:${log.thread_id}:${log.proposal_id ?? ""}:${log.action}:${log.actor}:${log.safety_standard ?? ""}:${log.metadata ?? ""}`;
      const expectedChecksum = crypto.createHash("sha256").update(raw).digest("hex");
      if (log.checksum !== expectedChecksum) {
        return { valid: false, totalEntries: logs.length, brokenAtId: log.id };
      }
      prevChecksum = log.checksum;
    }

    return { valid: true, totalEntries: logs.length };
  }

  saveThreadSnapshot(
    serializedJson: string,
    metadataMap?: Map<string, unknown> | Record<string, unknown>,
    workspaceId = "default",
  ): void {
    let metaObj: Record<string, unknown> = {};
    if (metadataMap instanceof Map) {
      metaObj = Object.fromEntries(metadataMap.entries());
    } else if (metadataMap && typeof metadataMap === "object") {
      metaObj = metadataMap;
    }
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO thread_snapshots (workspace_id, serialized_json, metadata_json, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(workspaceId, serializedJson, JSON.stringify(metaObj));
  }

  loadThreadSnapshot(workspaceId = "default"): {
    serializedJson: string;
    metadata: Record<string, unknown>;
    updatedAt: string;
  } | null {
    const row = this.#db.prepare(`SELECT * FROM thread_snapshots WHERE workspace_id = ?`).get(workspaceId) as
      | {
          serialized_json: string;
          metadata_json: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return {
      serializedJson: row.serialized_json,
      metadata,
      updatedAt: row.updated_at,
    };
  }

  saveThreadConflict(conflict: {
    conflictId: string;
    workspaceId?: string | undefined;
    slot: number;
    sourceDomain: string;
    sourceValue: number;
    sourceUnit: string;
    targetDomain: string;
    targetValue: number;
    targetUnit: string;
    min: number;
    max: number;
    status?: "conflicted" | "resolved" | undefined;
    resolvedValue?: number | null | undefined;
  }): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO thread_conflicts (
          conflict_id, workspace_id, slot, source_domain, source_value, source_unit,
          target_domain, target_value, target_unit, min_bound, max_bound, status, resolved_value, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        conflict.conflictId,
        conflict.workspaceId || "default",
        conflict.slot,
        conflict.sourceDomain,
        conflict.sourceValue,
        conflict.sourceUnit,
        conflict.targetDomain,
        conflict.targetValue,
        conflict.targetUnit,
        conflict.min,
        conflict.max,
        conflict.status || "conflicted",
        conflict.resolvedValue ?? null,
      );
  }

  getThreadConflicts(workspaceId = "default", status?: string): ThreadConflictRecord[] {
    let sql = `SELECT * FROM thread_conflicts WHERE workspace_id = ?`;
    const params: string[] = [workspaceId];
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY updated_at DESC`;
    const rows = this.#db.prepare(sql).all(...params) as {
      conflict_id: string;
      workspace_id: string;
      slot: number;
      source_domain: string;
      source_value: number;
      source_unit: string;
      target_domain: string;
      target_value: number;
      target_unit: string;
      min_bound: number;
      max_bound: number;
      status: "conflicted" | "resolved";
      resolved_value: number | null;
      updated_at: string;
    }[];
    return rows.map((r) => ({
      conflictId: r.conflict_id,
      workspaceId: r.workspace_id,
      slot: r.slot,
      sourceDomain: r.source_domain,
      sourceValue: r.source_value,
      sourceUnit: r.source_unit,
      targetDomain: r.target_domain,
      targetValue: r.target_value,
      targetUnit: r.target_unit,
      min: r.min_bound,
      max: r.max_bound,
      status: r.status,
      resolvedValue: r.resolved_value,
      updatedAt: r.updated_at,
    }));
  }

  resolveThreadConflict(conflictId: string, resolvedValue: number): void {
    this.#db
      .prepare(
        `UPDATE thread_conflicts
         SET status = 'resolved', resolved_value = ?, updated_at = datetime('now')
         WHERE conflict_id = ?`,
      )
      .run(resolvedValue, conflictId);
  }

  // ── Granular API Tokens ──────────────────────────────────────────

  createApiKey(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    const scopesJson = JSON.stringify(params.scopes);
    const pattern = params.packagePattern || "*";
    const result = this.#db
      .prepare(
        `INSERT INTO api_tokens (user_id, name, token_prefix, token_hash, scopes, package_pattern, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.userId,
        params.name,
        params.tokenPrefix,
        params.tokenHash,
        scopesJson,
        pattern,
        params.expiresAt ?? null,
      );
    return Number(result.lastInsertRowid);
  }

  createApiToken(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.createApiKey(params);
  }

  getApiTokenByHash(tokenHash: string): ApiTokenRecord | null {
    const row = this.#db
      .prepare(
        `SELECT id, user_id, name, token_prefix, token_hash, scopes, package_pattern, expires_at, last_used_at, last_used_ip, created_at
         FROM api_tokens
         WHERE token_hash = ?`,
      )
      .get(tokenHash) as (Omit<ApiTokenRecord, "scopes"> & { scopes: string }) | undefined;
    if (!row) return null;
    let scopes: string[] = [];
    try {
      scopes = JSON.parse(row.scopes) as string[];
    } catch {
      scopes = [];
    }
    return {
      ...row,
      scopes,
    };
  }

  listApiTokens(userId: number): Omit<ApiTokenRecord, "token_hash">[] {
    const rows = this.#db
      .prepare(
        `SELECT id, user_id, name, token_prefix, scopes, package_pattern, expires_at, last_used_at, last_used_ip, created_at
         FROM api_tokens
         WHERE user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(userId) as (Omit<ApiTokenRecord, "token_hash" | "scopes"> & { scopes: string })[];

    return rows.map((r) => {
      let scopes: string[] = [];
      try {
        scopes = JSON.parse(r.scopes) as string[];
      } catch {
        scopes = [];
      }
      return {
        ...r,
        scopes,
      };
    });
  }

  deleteApiToken(tokenId: number, userId: number): boolean {
    const res = this.#db.prepare(`DELETE FROM api_tokens WHERE id = ? AND user_id = ?`).run(tokenId, userId);
    return res.changes > 0;
  }

  touchApiToken(tokenId: number, ip?: string): void {
    try {
      this.#db
        .prepare(`UPDATE api_tokens SET last_used_at = datetime('now'), last_used_ip = ? WHERE id = ?`)
        .run(ip ?? null, tokenId);
    } catch {
      // non-critical
    }
  }

  getUserSolutions(username: string): SolutionRow[] {
    const user = this.getUserByUsername(username);
    if (!user) return [];
    try {
      const rows = this.#db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            (SELECT version FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as latest_version,
            (SELECT bundle_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as bundle_url,
            (SELECT tauri_windows_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_windows_url,
            (SELECT tauri_linux_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_linux_url,
            (SELECT tauri_darwin_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_darwin_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.user_id = ? AND s.is_public = 1
          ORDER BY s.updated_at DESC`,
        )
        .all(user.id) as (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null })[];

      return rows.map((r) => ({
        ...r,
        supported_formats: JSON.parse(r.supported_formats || "[]") as string[],
      }));
    } catch {
      return [];
    }
  }

  getAllPublicSolutions(): SolutionRow[] {
    try {
      const rows = this.#db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url,
            (SELECT version FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as latest_version,
            (SELECT bundle_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as bundle_url,
            (SELECT tauri_windows_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_windows_url,
            (SELECT tauri_linux_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_linux_url,
            (SELECT tauri_darwin_url FROM solution_releases WHERE solution_id = s.id ORDER BY id DESC LIMIT 1) as tauri_darwin_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.is_public = 1
          ORDER BY s.updated_at DESC
          LIMIT 50`,
        )
        .all() as (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null })[];

      return rows.map((r) => ({
        ...r,
        supported_formats: JSON.parse(r.supported_formats || "[]") as string[],
      }));
    } catch {
      return [];
    }
  }

  getSolution(
    authorUsername: string,
    slug: string,
  ): {
    solution: SolutionRow;
    release: SolutionReleaseRow | null;
  } | null {
    const user = this.getUserByUsername(authorUsername);
    if (!user) return null;
    try {
      const solution = this.#db
        .prepare(
          `SELECT s.*, u.username as author_username, u.display_name as author_display_name, u.avatar_url as author_avatar_url
          FROM solutions s
          JOIN users u ON s.user_id = u.id
          WHERE s.user_id = ? AND s.slug = ?`,
        )
        .get(user.id, slug) as
        | (Omit<SolutionRow, "supported_formats"> & { supported_formats: string | null })
        | undefined;

      if (!solution) return null;

      const latestRelease = this.#db
        .prepare(`SELECT * FROM solution_releases WHERE solution_id = ? ORDER BY id DESC LIMIT 1`)
        .get(solution.id) as SolutionReleaseRow | undefined;

      return {
        solution: {
          ...solution,
          supported_formats: JSON.parse(solution.supported_formats || "[]") as string[],
        },
        release: latestRelease
          ? {
              ...latestRelease,
              manifest: latestRelease.manifest_json
                ? (JSON.parse(latestRelease.manifest_json) as Record<string, unknown>)
                : null,
            }
          : null,
      };
    } catch {
      return null;
    }
  }

  getSolutionReleases(authorUsername: string, slug: string): SolutionReleaseRow[] {
    const user = this.getUserByUsername(authorUsername);
    if (!user) return [];
    try {
      const solution = this.#db
        .prepare(`SELECT id FROM solutions WHERE user_id = ? AND slug = ?`)
        .get(user.id, slug) as { id: number } | undefined;
      if (!solution) return [];

      return this.#db
        .prepare(`SELECT * FROM solution_releases WHERE solution_id = ? ORDER BY id DESC`)
        .all(solution.id) as SolutionReleaseRow[];
    } catch {
      return [];
    }
  }

  createOrUpdateSolution(
    userId: number,
    data: {
      slug: string;
      name: string;
      description?: string | undefined;
      category?: string | undefined;
      icon?: string | undefined;
      supported_formats?: string[] | undefined;
      repo_id?: number | undefined;
    },
  ): number {
    const existing = this.#db
      .prepare(`SELECT id FROM solutions WHERE user_id = ? AND slug = ?`)
      .get(userId, data.slug) as { id: number } | undefined;

    const formatsJson = JSON.stringify(data.supported_formats || []);

    if (existing) {
      this.#db
        .prepare(
          `UPDATE solutions SET
            name = ?,
            description = ?,
            category = ?,
            icon = ?,
            supported_formats = ?,
            repo_id = COALESCE(?, repo_id),
            updated_at = datetime('now')
          WHERE id = ?`,
        )
        .run(
          data.name,
          data.description ?? null,
          data.category ?? "Engineering Application",
          data.icon ?? "cpu",
          formatsJson,
          data.repo_id ?? null,
          existing.id,
        );
      return existing.id;
    } else {
      const res = this.#db
        .prepare(
          `INSERT INTO solutions (user_id, repo_id, slug, name, description, category, icon, supported_formats)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          data.repo_id ?? null,
          data.slug,
          data.name,
          data.description ?? null,
          data.category ?? "Engineering Application",
          data.icon ?? "cpu",
          formatsJson,
        );
      return res.lastInsertRowid as number;
    }
  }

  createSolutionRelease(
    solutionId: number,
    data: {
      version: string;
      changelog?: string | undefined;
      bundle_url: string;
      tauri_windows_url?: string | undefined;
      tauri_linux_url?: string | undefined;
      tauri_darwin_url?: string | undefined;
      manifest_json?: string | undefined;
    },
  ): number {
    const existing = this.#db
      .prepare(`SELECT id FROM solution_releases WHERE solution_id = ? AND version = ?`)
      .get(solutionId, data.version) as { id: number } | undefined;

    if (existing) {
      this.#db
        .prepare(
          `UPDATE solution_releases SET
            changelog = ?,
            bundle_url = ?,
            tauri_windows_url = ?,
            tauri_linux_url = ?,
            tauri_darwin_url = ?,
            manifest_json = ?
          WHERE id = ?`,
        )
        .run(
          data.changelog ?? null,
          data.bundle_url,
          data.tauri_windows_url ?? null,
          data.tauri_linux_url ?? null,
          data.tauri_darwin_url ?? null,
          data.manifest_json ?? null,
          existing.id,
        );
      return existing.id;
    } else {
      const res = this.#db
        .prepare(
          `INSERT INTO solution_releases (solution_id, version, changelog, bundle_url, tauri_windows_url, tauri_linux_url, tauri_darwin_url, manifest_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          solutionId,
          data.version,
          data.changelog ?? null,
          data.bundle_url,
          data.tauri_windows_url ?? null,
          data.tauri_linux_url ?? null,
          data.tauri_darwin_url ?? null,
          data.manifest_json ?? null,
        );
      return res.lastInsertRowid as number;
    }
  }

  // ── Domain Availability, Auto-Circuit-Breaking & Transparency ────

  recordDomainDeliverySuccess(domain: string): void {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return;
    try {
      this.#db
        .prepare(
          `INSERT INTO federation_domains (domain, tier, unavailable_since, consecutive_failures, last_seen_at, updated_at)
           VALUES (?, 'allow', NULL, 0, datetime('now'), datetime('now'))
           ON CONFLICT(domain) DO UPDATE SET
             unavailable_since = NULL,
             consecutive_failures = 0,
             last_seen_at = datetime('now'),
             updated_at = datetime('now')`,
        )
        .run(cleanDomain);
    } catch {
      // Ignore if table not yet migrated in isolated unit test
    }
  }

  recordDomainDeliveryFailure(
    domain: string,
    errorMessage?: string,
  ): { consecutiveFailures: number; unavailableSince: string | null } {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return { consecutiveFailures: 0, unavailableSince: null };

    let threshold = 5;
    try {
      threshold = Math.max(1, this.getInstanceSettings().autoCircuitBreakThreshold || 5);
    } catch {}

    const existing = this.getDomainTier(cleanDomain);
    const nextFailures = (existing.consecutiveFailures || 0) + 1;
    const shouldMarkUnavailable = nextFailures >= threshold;
    const nowIso = new Date().toISOString();
    const unavailableSince = shouldMarkUnavailable ? existing.unavailableSince || nowIso : null;

    this.#db
      .prepare(
        `INSERT INTO federation_domains (domain, tier, reason, unavailable_since, consecutive_failures, updated_at)
         VALUES (?, 'allow', ?, ?, ?, datetime('now'))
         ON CONFLICT(domain) DO UPDATE SET
           unavailable_since = COALESCE(federation_domains.unavailable_since, excluded.unavailable_since),
           consecutive_failures = excluded.consecutive_failures,
           private_comment = COALESCE(federation_domains.private_comment, excluded.reason),
           updated_at = datetime('now')`,
      )
      .run(
        cleanDomain,
        errorMessage ? `Delivery failure: ${errorMessage.slice(0, 200)}` : null,
        unavailableSince,
        nextFailures,
      );

    const updated = this.getDomainTier(cleanDomain);
    return {
      consecutiveFailures: updated.consecutiveFailures,
      unavailableSince: updated.unavailableSince ?? null,
    };
  }

  isDomainUnavailable(domain: string): boolean {
    const cleanDomain = domain.toLowerCase().trim();
    if (!cleanDomain) return false;
    const tierInfo = this.getDomainTier(cleanDomain);
    if (!tierInfo.unavailableSince) return false;
    // Allow automatic cooldown probe after 6 hours
    const unavailableMs = new Date(tierInfo.unavailableSince).getTime();
    if (Number.isFinite(unavailableMs) && Date.now() - unavailableMs > 6 * 3600 * 1000) {
      return false;
    }
    return true;
  }

  static obfuscateDomainName(domain: string): string {
    const parts = domain.split(".");
    return parts
      .map((part, idx) => {
        if (idx === parts.length - 1 || part.length <= 2) return part;
        return `${part[0]}${"*".repeat(Math.min(5, part.length - 2))}${part[part.length - 1]}`;
      })
      .join(".");
  }

  listPublicDomainBlocks(): {
    domain: string;
    digest: string;
    severity: "silence" | "suspend";
    comment: string;
  }[] {
    const rows = this.listFederationDomains().filter((d) => d.tier === "silence" || d.tier === "suspend");
    return rows.map((d) => {
      const digest = crypto.createHash("sha256").update(d.domain.toLowerCase()).digest("hex");
      const displayDomain = d.obfuscate ? LibraryDatabase.obfuscateDomainName(d.domain) : d.domain;
      return {
        domain: displayDomain,
        digest,
        severity: d.tier === "suspend" ? "suspend" : "silence",
        comment: d.public_comment ?? d.reason ?? "",
      };
    });
  }

  listKnownPeers(): string[] {
    const peerSet = new Set<string>();
    const domainRows = this.#db.prepare(`SELECT domain FROM federation_domains WHERE tier != 'suspend'`).all() as {
      domain: string;
    }[];
    for (const r of domainRows) {
      if (r.domain) peerSet.add(r.domain.toLowerCase());
    }
    const userDomains = this.#db
      .prepare(`SELECT DISTINCT remote_domain FROM users WHERE remote_domain IS NOT NULL AND remote_domain != ''`)
      .all() as { remote_domain: string }[];
    for (const u of userDomains) {
      const dom = u.remote_domain.toLowerCase();
      if (!this.isDomainSuspended(dom)) {
        peerSet.add(dom);
      }
    }
    return Array.from(peerSet).sort();
  }

  // ── ActivityPub Relays (FEP-ae97) ────────────────────────────────

  listFederationRelays(): FederationRelayRow[] {
    return this.#db.prepare(`SELECT * FROM federation_relays ORDER BY id DESC`).all() as FederationRelayRow[];
  }

  getFederationRelayById(id: number): FederationRelayRow | undefined {
    return this.#db.prepare(`SELECT * FROM federation_relays WHERE id = ?`).get(id) as FederationRelayRow | undefined;
  }

  getFederationRelayByActor(actorUrl: string): FederationRelayRow | undefined {
    return this.#db
      .prepare(`SELECT * FROM federation_relays WHERE actor_url = ? OR inbox_url = ?`)
      .get(actorUrl.trim(), actorUrl.trim()) as FederationRelayRow | undefined;
  }

  addFederationRelay(
    inboxUrl: string,
    actorUrl?: string,
    followActivityId?: string,
    state: "pending" | "accepted" | "rejected" | "paused" = "pending",
  ): FederationRelayRow {
    const cleanInbox = inboxUrl.trim();
    const cleanActor = (actorUrl || cleanInbox.replace(/\/inbox\/?$/, "/actor")).trim();
    let domain = "unknown";
    try {
      domain = new URL(cleanInbox).hostname.toLowerCase();
    } catch {}

    this.#db
      .prepare(
        `INSERT INTO federation_relays (inbox_url, actor_url, domain, state, follow_activity_id, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(inbox_url) DO UPDATE SET
           actor_url = excluded.actor_url,
           state = excluded.state,
           follow_activity_id = COALESCE(excluded.follow_activity_id, federation_relays.follow_activity_id),
           updated_at = datetime('now')`,
      )
      .run(cleanInbox, cleanActor, domain, state, followActivityId ?? null);

    return this.#db
      .prepare(`SELECT * FROM federation_relays WHERE inbox_url = ?`)
      .get(cleanInbox) as FederationRelayRow;
  }

  updateFederationRelayState(
    idOrActorUrl: number | string,
    state: "pending" | "accepted" | "rejected" | "paused",
    lastError?: string | null,
  ): FederationRelayRow | undefined {
    if (typeof idOrActorUrl === "number") {
      this.#db
        .prepare(
          `UPDATE federation_relays
           SET state = ?, last_error = COALESCE(?, last_error), updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(state, lastError === undefined ? null : lastError, idOrActorUrl);
      return this.getFederationRelayById(idOrActorUrl);
    }
    const clean = idOrActorUrl.trim();
    this.#db
      .prepare(
        `UPDATE federation_relays
         SET state = ?, last_error = COALESCE(?, last_error), updated_at = datetime('now')
         WHERE actor_url = ? OR inbox_url = ?`,
      )
      .run(state, lastError === undefined ? null : lastError, clean, clean);
    return this.getFederationRelayByActor(clean);
  }

  deleteFederationRelay(id: number): FederationRelayRow | undefined {
    const existing = this.getFederationRelayById(id);
    if (!existing) return undefined;
    this.#db.prepare(`DELETE FROM federation_relays WHERE id = ?`).run(id);
    return existing;
  }

  incrementRelayStats(idOrActorUrl: number | string, direction: "forwarded" | "received"): void {
    const col = direction === "forwarded" ? "forwarded_count" : "received_count";
    if (typeof idOrActorUrl === "number") {
      this.#db
        .prepare(`UPDATE federation_relays SET ${col} = ${col} + 1, updated_at = datetime('now') WHERE id = ?`)
        .run(idOrActorUrl);
    } else {
      this.#db
        .prepare(
          `UPDATE federation_relays SET ${col} = ${col} + 1, updated_at = datetime('now') WHERE actor_url = ? OR inbox_url = ?`,
        )
        .run(idOrActorUrl, idOrActorUrl);
    }
  }

  // ── Structured Instance Rules ────────────────────────────────────

  listInstanceRules(): InstanceRuleRow[] {
    return this.#db.prepare(`SELECT * FROM instance_rules ORDER BY priority ASC, id ASC`).all() as InstanceRuleRow[];
  }

  createInstanceRule(text: string, hint?: string | null, priority?: number): InstanceRuleRow {
    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error("Rule text is required");
    }
    const effectivePriority =
      typeof priority === "number" && Number.isFinite(priority) ? priority : this.listInstanceRules().length + 1;
    const res = this.#db
      .prepare(
        `INSERT INTO instance_rules (text, hint, priority, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(cleanText, hint?.trim() || null, effectivePriority);
    return this.#db
      .prepare(`SELECT * FROM instance_rules WHERE id = ?`)
      .get(Number(res.lastInsertRowid)) as InstanceRuleRow;
  }

  updateInstanceRule(
    id: number,
    updates: { text?: string | undefined; hint?: string | null | undefined; priority?: number | undefined },
  ): InstanceRuleRow | undefined {
    const existing = this.#db.prepare(`SELECT * FROM instance_rules WHERE id = ?`).get(id) as
      | InstanceRuleRow
      | undefined;
    if (!existing) return undefined;

    const nextText = updates.text !== undefined ? updates.text.trim() : existing.text;
    const nextHint = updates.hint !== undefined ? (updates.hint ? updates.hint.trim() : null) : existing.hint;
    const nextPriority = updates.priority !== undefined ? Number(updates.priority) : existing.priority;

    this.#db
      .prepare(
        `UPDATE instance_rules
         SET text = ?, hint = ?, priority = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextText, nextHint, nextPriority, id);

    return this.#db.prepare(`SELECT * FROM instance_rules WHERE id = ?`).get(id) as InstanceRuleRow | undefined;
  }

  deleteInstanceRule(id: number): boolean {
    const res = this.#db.prepare(`DELETE FROM instance_rules WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  // ── Account Warnings & Strikes ───────────────────────────────────

  #hydrateAccountWarning(row: RawAccountWarningRow): AccountWarningRow {
    let ruleIds: number[] = [];
    if (Array.isArray(row.rule_ids)) {
      ruleIds = row.rule_ids;
    } else if (typeof row.rule_ids === "string") {
      try {
        const parsed = JSON.parse(row.rule_ids);
        if (Array.isArray(parsed)) ruleIds = parsed.map(Number).filter(Number.isFinite);
      } catch {}
    }
    let postIds: number[] = [];
    if (Array.isArray(row.post_ids)) {
      postIds = row.post_ids;
    } else if (typeof row.post_ids === "string") {
      try {
        const parsed = JSON.parse(row.post_ids);
        if (Array.isArray(parsed)) postIds = parsed.map(Number).filter(Number.isFinite);
      } catch {}
    }
    return {
      id: row.id,
      target_user_id: row.target_user_id,
      actor_id: row.actor_id,
      action: row.action,
      text: row.text,
      report_id: row.report_id,
      rule_ids: ruleIds,
      post_ids: postIds,
      acknowledged_at: row.acknowledged_at,
      created_at: row.created_at,
      actor_username: row.actor_username ?? null,
      target_username: row.target_username ?? null,
    };
  }

  createAccountWarning(params: {
    targetUserId: number;
    actorId?: number | null | undefined;
    moderatorId?: number | null | undefined;
    action?: AccountWarningRow["action"] | string | undefined;
    text: string;
    reportId?: number | null | undefined;
    ruleIds?: number[] | undefined;
    postIds?: number[] | undefined;
  }): AccountWarningRow {
    const validActions = [
      "none",
      "disable",
      "mark_statuses_sensitive",
      "delete_statuses",
      "silence",
      "suspend",
      "warn",
    ] as const;
    const action: AccountWarningRow["action"] =
      params.action && (validActions as readonly string[]).includes(params.action)
        ? (params.action as AccountWarningRow["action"])
        : "warn";
    const ruleIdsJson = JSON.stringify((params.ruleIds || []).map(Number).filter(Number.isFinite));
    const postIdsJson = JSON.stringify((params.postIds || []).map(Number).filter(Number.isFinite));
    const effectiveActorId = params.actorId ?? params.moderatorId ?? null;

    const res = this.#db
      .prepare(
        `INSERT INTO account_warnings (target_user_id, actor_id, action, text, report_id, rule_ids, post_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        params.targetUserId,
        effectiveActorId,
        action,
        params.text.trim(),
        params.reportId ?? null,
        ruleIdsJson,
        postIdsJson,
      );

    const warningId = Number(res.lastInsertRowid);
    this.createNotification(
      params.targetUserId,
      effectiveActorId || params.targetUserId,
      "moderation_warning",
      undefined,
      {
        warningId,
        action,
        text: params.text.trim(),
        ruleIds: params.ruleIds || [],
      },
    );

    const row = this.#db
      .prepare(
        `SELECT w.*, u.username as target_username, a.username as actor_username
         FROM account_warnings w
         LEFT JOIN users u ON w.target_user_id = u.id
         LEFT JOIN users a ON w.actor_id = a.id
         WHERE w.id = ?`,
      )
      .get(warningId) as RawAccountWarningRow;
    return this.#hydrateAccountWarning(row);
  }

  listAccountWarnings(targetUserId?: number): AccountWarningRow[] {
    if (typeof targetUserId === "number") {
      const rows = this.#db
        .prepare(
          `SELECT w.*, u.username as target_username, a.username as actor_username
           FROM account_warnings w
           LEFT JOIN users u ON w.target_user_id = u.id
           LEFT JOIN users a ON w.actor_id = a.id
           WHERE w.target_user_id = ?
           ORDER BY w.id DESC`,
        )
        .all(targetUserId) as RawAccountWarningRow[];
      return rows.map((r) => this.#hydrateAccountWarning(r));
    }
    const rows = this.#db
      .prepare(
        `SELECT w.*, u.username as target_username, a.username as actor_username
         FROM account_warnings w
         LEFT JOIN users u ON w.target_user_id = u.id
         LEFT JOIN users a ON w.actor_id = a.id
         ORDER BY w.id DESC LIMIT 100`,
      )
      .all() as RawAccountWarningRow[];
    return rows.map((r) => this.#hydrateAccountWarning(r));
  }

  acknowledgeAccountWarning(warningId: number, userId: number): boolean {
    const res = this.#db
      .prepare(
        `UPDATE account_warnings
         SET acknowledged_at = datetime('now')
         WHERE id = ? AND target_user_id = ? AND acknowledged_at IS NULL`,
      )
      .run(warningId, userId);
    return res.changes > 0;
  }

  // ── Internal Staff Notes ─────────────────────────────────────────

  createStaffNote(
    targetType: "user" | "domain" | "report",
    targetId: string,
    authorId: number,
    content: string,
  ): StaffNoteRow {
    const cleanContent = content.trim();
    if (!cleanContent) {
      throw new Error("Staff note content is required");
    }
    const res = this.#db
      .prepare(
        `INSERT INTO staff_notes (target_type, target_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(targetType, String(targetId).trim(), authorId, cleanContent);
    const noteId = Number(res.lastInsertRowid);
    return this.#db
      .prepare(
        `SELECT n.*, u.username as author_username
         FROM staff_notes n
         LEFT JOIN users u ON n.author_id = u.id
         WHERE n.id = ?`,
      )
      .get(noteId) as StaffNoteRow;
  }

  listStaffNotes(targetType: "user" | "domain" | "report", targetId?: string): StaffNoteRow[] {
    if (targetId !== undefined && targetId.trim() !== "") {
      return this.#db
        .prepare(
          `SELECT n.*, u.username as author_username
           FROM staff_notes n
           LEFT JOIN users u ON n.author_id = u.id
           WHERE n.target_type = ? AND n.target_id = ?
           ORDER BY n.id DESC`,
        )
        .all(targetType, String(targetId).trim()) as StaffNoteRow[];
    }
    return this.#db
      .prepare(
        `SELECT n.*, u.username as author_username
         FROM staff_notes n
         LEFT JOIN users u ON n.author_id = u.id
         WHERE n.target_type = ?
         ORDER BY n.id DESC LIMIT 100`,
      )
      .all(targetType) as StaffNoteRow[];
  }

  deleteStaffNote(noteId: number): boolean {
    const res = this.#db.prepare(`DELETE FROM staff_notes WHERE id = ?`).run(noteId);
    return res.changes > 0;
  }

  // ── IP Blocks & Canonical Email Blocks ───────────────────────────

  listIpBlocks(): IpBlockRow[] {
    return this.#db
      .prepare(
        `SELECT * FROM ip_blocks
         WHERE expires_at IS NULL OR datetime(expires_at) > datetime('now')
         ORDER BY id DESC`,
      )
      .all() as IpBlockRow[];
  }

  createIpBlock(
    paramsOrCidr:
      | string
      | {
          cidr: string;
          severity?: IpBlockRow["severity"] | undefined;
          comment?: string | null | undefined;
          createdBy?: number | null | undefined;
          expiresAt?: string | null | undefined;
        },
    severityArg?: IpBlockRow["severity"],
    commentArg?: string | null,
    expiresAtArg?: string | null,
    createdByArg?: number | null,
  ): IpBlockRow {
    const params =
      typeof paramsOrCidr === "string"
        ? {
            cidr: paramsOrCidr,
            severity: severityArg,
            comment: commentArg,
            expiresAt: expiresAtArg,
            createdBy: createdByArg,
          }
        : paramsOrCidr;
    const cleanCidr = params.cidr.trim();
    if (!cleanCidr) {
      throw new Error("CIDR or IP address is required");
    }
    const severity = params.severity || "no_sign_up";
    this.#db
      .prepare(
        `INSERT INTO ip_blocks (cidr, severity, comment, created_by, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(cidr) DO UPDATE SET
           severity = excluded.severity,
           comment = excluded.comment,
           expires_at = excluded.expires_at,
           updated_at = datetime('now')`,
      )
      .run(cleanCidr, severity, params.comment?.trim() || null, params.createdBy ?? null, params.expiresAt ?? null);

    return this.#db.prepare(`SELECT * FROM ip_blocks WHERE cidr = ?`).get(cleanCidr) as IpBlockRow;
  }

  deleteIpBlock(id: number): boolean {
    const res = this.#db.prepare(`DELETE FROM ip_blocks WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  checkIpBlock(clientIp?: string | null): IpBlockRow | null {
    if (!clientIp || !clientIp.trim()) return null;
    const blocks = this.listIpBlocks();
    for (const block of blocks) {
      if (ipMatchesCidr(clientIp, block.cidr)) {
        return block;
      }
    }
    return null;
  }

  listCanonicalEmailBlocks(): CanonicalEmailBlockRow[] {
    return this.#db.prepare(`SELECT * FROM canonical_email_blocks ORDER BY id DESC`).all() as CanonicalEmailBlockRow[];
  }

  createCanonicalEmailBlock(
    emailOrHash: string,
    reason?: string | null,
    createdBy?: number | null,
  ): CanonicalEmailBlockRow {
    const raw = emailOrHash.trim();
    const isDirectHash = /^[a-f0-9]{64}$/i.test(raw);
    const emailHash = isDirectHash ? raw.toLowerCase() : hashCanonicalEmail(raw);
    const emailHint = isDirectHash ? `${raw.slice(0, 8)}…` : redactEmailHint(canonicalizeEmail(raw));

    this.#db
      .prepare(
        `INSERT INTO canonical_email_blocks (canonical_email_hash, canonical_email_hint, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(canonical_email_hash) DO UPDATE SET
           reason = COALESCE(excluded.reason, canonical_email_blocks.reason)`,
      )
      .run(emailHash, emailHint, reason?.trim() || null, createdBy ?? null);

    return this.#db
      .prepare(`SELECT * FROM canonical_email_blocks WHERE canonical_email_hash = ?`)
      .get(emailHash) as CanonicalEmailBlockRow;
  }

  deleteCanonicalEmailBlock(id: number): boolean {
    const res = this.#db.prepare(`DELETE FROM canonical_email_blocks WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  isCanonicalEmailBlocked(email: string): {
    blocked: boolean;
    reason?: string | undefined;
    block?: CanonicalEmailBlockRow | undefined;
  } {
    const hash = hashCanonicalEmail(email);
    const row = this.#db.prepare(`SELECT * FROM canonical_email_blocks WHERE canonical_email_hash = ?`).get(hash) as
      | CanonicalEmailBlockRow
      | undefined;
    if (!row) return { blocked: false };
    return {
      blocked: true,
      reason: row.reason || "This email address has been blocked by instance administration",
      block: row,
    };
  }

  // ── Mastodon v2 Content Filters ──────────────────────────────────

  #hydrateContentFilter(row: RawContentFilterRow): ContentFilterRow {
    let context: ContentFilterRow["context"] = ["home", "public", "notifications", "thread", "account"];
    if (Array.isArray(row.context)) {
      context = row.context;
    } else if (typeof row.context === "string") {
      try {
        const parsed = JSON.parse(row.context);
        if (Array.isArray(parsed)) context = parsed;
      } catch {}
    }

    let keywords: ContentFilterKeyword[] = [];
    if (typeof row.keywords_json === "string") {
      try {
        const parsed = JSON.parse(row.keywords_json);
        if (Array.isArray(parsed)) {
          keywords = parsed
            .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
            .map((k) => ({
              keyword: String(k.keyword).trim(),
              whole_word: k.whole_word !== false,
            }));
        }
      } catch {}
    }

    return {
      id: row.id,
      user_id: row.user_id,
      title: row.title,
      context,
      contexts: context,
      filter_action: row.filter_action,
      keywords,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listContentFilters(userId?: number | null): ContentFilterRow[] {
    if (typeof userId === "number" && userId > 0) {
      const rows = this.#db
        .prepare(
          `SELECT * FROM content_filters
           WHERE (user_id = ? OR user_id IS NULL)
             AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
           ORDER BY id DESC`,
        )
        .all(userId) as RawContentFilterRow[];
      return rows.map((r) => this.#hydrateContentFilter(r));
    }
    const rows = this.#db
      .prepare(
        `SELECT * FROM content_filters
         WHERE user_id IS NULL
           AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
         ORDER BY id DESC`,
      )
      .all() as RawContentFilterRow[];
    return rows.map((r) => this.#hydrateContentFilter(r));
  }

  getContentFilter(id: number): ContentFilterRow | undefined {
    const row = this.#db.prepare(`SELECT * FROM content_filters WHERE id = ?`).get(id) as
      | RawContentFilterRow
      | undefined;
    return row ? this.#hydrateContentFilter(row) : undefined;
  }

  createContentFilter(params: {
    userId?: number | null | undefined;
    title: string;
    context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
    filterAction?: "warn" | "hide" | "drop" | undefined;
    keywords: { keyword: string; whole_word?: boolean | undefined }[];
    expiresAt?: string | null | undefined;
  }): ContentFilterRow {
    const cleanTitle = params.title.trim();
    if (!cleanTitle) {
      throw new Error("Filter title is required");
    }
    const context =
      Array.isArray(params.context) && params.context.length > 0
        ? params.context
        : (["home", "public", "notifications", "thread", "account"] as const);
    const filterAction = params.filterAction || "warn";
    const normalizedKeywords: ContentFilterKeyword[] = (params.keywords || [])
      .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
      .map((k) => ({
        keyword: k.keyword.trim(),
        whole_word: k.whole_word !== false,
      }));

    const res = this.#db
      .prepare(
        `INSERT INTO content_filters (user_id, title, context, filter_action, keywords_json, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        params.userId ?? null,
        cleanTitle,
        JSON.stringify(context),
        filterAction,
        JSON.stringify(normalizedKeywords),
        params.expiresAt ?? null,
      );

    return this.getContentFilter(Number(res.lastInsertRowid))!;
  }

  updateContentFilter(
    id: number,
    userId: number | null,
    updates: {
      title?: string | undefined;
      context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
      filterAction?: "warn" | "hide" | "drop" | undefined;
      keywords?: { keyword: string; whole_word?: boolean | undefined }[] | undefined;
      expiresAt?: string | null | undefined;
    },
  ): ContentFilterRow | undefined {
    const existing = this.getContentFilter(id);
    if (!existing) return undefined;
    if (userId !== null && existing.user_id !== userId) {
      return undefined;
    }

    const nextTitle = updates.title !== undefined ? updates.title.trim() : existing.title;
    const nextContext = updates.context !== undefined ? updates.context : existing.context;
    const nextAction = updates.filterAction !== undefined ? updates.filterAction : existing.filter_action;
    const nextKeywords =
      updates.keywords !== undefined
        ? updates.keywords
            .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
            .map((k) => ({ keyword: k.keyword.trim(), whole_word: k.whole_word !== false }))
        : existing.keywords;
    const nextExpiresAt = updates.expiresAt !== undefined ? updates.expiresAt : existing.expires_at;

    this.#db
      .prepare(
        `UPDATE content_filters
         SET title = ?, context = ?, filter_action = ?, keywords_json = ?, expires_at = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextTitle, JSON.stringify(nextContext), nextAction, JSON.stringify(nextKeywords), nextExpiresAt, id);

    return this.getContentFilter(id);
  }

  deleteContentFilter(id: number, userId?: number | null): boolean {
    if (typeof userId === "number") {
      const res = this.#db.prepare(`DELETE FROM content_filters WHERE id = ? AND user_id = ?`).run(id, userId);
      return res.changes > 0;
    }
    const res = this.#db.prepare(`DELETE FROM content_filters WHERE id = ?`).run(id);
    return res.changes > 0;
  }

  applyContentFiltersToPosts(
    posts: PostRow[],
    context: "home" | "public" | "notifications" | "thread" | "account",
    currentUserId?: number,
  ): PostRow[] {
    if (posts.length === 0) return posts;
    let filters: ContentFilterRow[] = [];
    try {
      filters = this.listContentFilters(currentUserId).filter((f) => f.context.includes(context));
    } catch {
      return posts;
    }
    if (filters.length === 0) return posts;

    const result: PostRow[] = [];
    for (const post of posts) {
      const haystack = `${post.content || ""} ${post.content_warning || ""}`.toLowerCase();
      const matched: ContentFilterMatch[] = [];
      let shouldDrop = false;

      for (const filter of filters) {
        const keywordMatches: string[] = [];
        for (const kw of filter.keywords) {
          const term = kw.keyword.toLowerCase();
          if (!term) continue;
          if (kw.whole_word) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, "i");
            if (re.test(haystack)) {
              keywordMatches.push(kw.keyword);
            }
          } else if (haystack.includes(term)) {
            keywordMatches.push(kw.keyword);
          }
        }
        if (keywordMatches.length > 0) {
          if (filter.filter_action === "drop" || filter.filter_action === "hide") {
            shouldDrop = true;
          }
          matched.push({
            filter_id: filter.id,
            title: filter.title,
            filter_action: filter.filter_action,
            keyword_matches: keywordMatches,
            filter: {
              id: filter.id,
              title: filter.title,
              context: filter.context,
              filter_action: filter.filter_action,
            },
          });
        }
      }

      if (shouldDrop) {
        continue;
      }
      if (matched.length > 0) {
        post.filtered = matched;
        if (!post.content_warning) {
          post.content_warning = `Filtered: ${matched.map((m) => m.title).join(", ")}`;
          post.is_sensitive = 1;
        }
      }
      result.push(post);
    }
    return result;
  }

  // ── Federated Polls (`Question`) ─────────────────────────────────

  createPostPoll(
    postId: number,
    options: (string | { title: string; votes_count?: number })[],
    expiresAt?: string | null,
    multiple: boolean = false,
  ): PostPollView {
    const normalizedOptions: PostPollOption[] = options
      .map((opt) =>
        typeof opt === "string"
          ? { title: opt.trim(), votes_count: 0 }
          : { title: String(opt.title || "").trim(), votes_count: Number(opt.votes_count || 0) },
      )
      .filter((o) => o.title.length > 0);

    if (normalizedOptions.length < 2) {
      throw new Error("A poll must include at least 2 options");
    }

    const totalVotes = normalizedOptions.reduce((sum, o) => sum + o.votes_count, 0);
    this.#db
      .prepare(
        `INSERT INTO post_polls (post_id, options_json, expires_at, multiple, votes_count, voters_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(post_id) DO UPDATE SET
           options_json = excluded.options_json,
           expires_at = excluded.expires_at,
           multiple = excluded.multiple,
           votes_count = excluded.votes_count`,
      )
      .run(postId, JSON.stringify(normalizedOptions), expiresAt ?? null, multiple ? 1 : 0, totalVotes, totalVotes);

    return this.getPostPoll(postId)!;
  }

  getPostPoll(postId: number, currentUserId?: number): PostPollView | null {
    try {
      const row = this.#db.prepare(`SELECT * FROM post_polls WHERE post_id = ?`).get(postId) as
        | {
            id: number;
            post_id: number;
            options_json: string;
            expires_at: string | null;
            multiple: number;
            votes_count: number;
            voters_count: number;
          }
        | undefined;
      if (!row) return null;

      let options: PostPollOption[] = [];
      try {
        const parsed = JSON.parse(row.options_json);
        if (Array.isArray(parsed)) {
          options = parsed.map((o) => ({
            title: String(o.title || ""),
            votes_count: Number(o.votes_count || 0),
          }));
        }
      } catch {}

      const ownVotes: number[] = [];
      if (currentUserId && currentUserId > 0) {
        const voteRows = this.#db
          .prepare(`SELECT option_index FROM post_poll_votes WHERE poll_id = ? AND voter_user_id = ?`)
          .all(row.id, currentUserId) as { option_index: number }[];
        for (const v of voteRows) {
          ownVotes.push(Number(v.option_index));
        }
      }

      const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() <= Date.now());
      return {
        id: row.id,
        post_id: row.post_id,
        expires_at: row.expires_at,
        expired,
        multiple: Boolean(row.multiple),
        votes_count: Number(row.votes_count || 0),
        voters_count: Number(row.voters_count || 0),
        voted: ownVotes.length > 0,
        own_votes: ownVotes,
        options,
      };
    } catch {
      return null;
    }
  }

  votePostPoll(
    postId: number,
    choices: number[],
    voterUserId?: number | null,
    voterActorUrl?: string | null,
  ): PostPollView {
    const poll = this.getPostPoll(postId, voterUserId ?? undefined);
    if (!poll) {
      throw new Error("Poll not found for this post");
    }
    if (poll.expired) {
      throw new Error("This poll has already expired");
    }
    const uniqueChoices = Array.from(new Set(choices.map((c) => Number(c)))).filter(
      (idx) => Number.isInteger(idx) && idx >= 0 && idx < poll.options.length,
    );
    if (uniqueChoices.length === 0) {
      throw new Error("At least one valid poll option index is required");
    }
    if (!poll.multiple && uniqueChoices.length > 1) {
      throw new Error("This poll does not allow multiple choices");
    }

    const tx = this.#db.transaction(() => {
      if (voterUserId) {
        const existingVote = this.#db
          .prepare(`SELECT 1 FROM post_poll_votes WHERE poll_id = ? AND voter_user_id = ? LIMIT 1`)
          .get(poll.id, voterUserId);
        if (existingVote) {
          throw new Error("You have already voted in this poll");
        }
      } else if (voterActorUrl) {
        const existingRemote = this.#db
          .prepare(`SELECT 1 FROM post_poll_votes WHERE poll_id = ? AND voter_actor_url = ? LIMIT 1`)
          .get(poll.id, voterActorUrl);
        if (existingRemote) {
          return;
        }
      }

      const insertVote = this.#db.prepare(
        `INSERT INTO post_poll_votes (poll_id, post_id, voter_user_id, voter_actor_url, option_index, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      );
      const updatedOptions = poll.options.map((o) => ({ ...o }));
      for (const choiceIdx of uniqueChoices) {
        insertVote.run(poll.id, postId, voterUserId ?? null, voterActorUrl ?? null, choiceIdx);
        const opt = updatedOptions[choiceIdx];
        if (opt) {
          opt.votes_count += 1;
        }
      }

      const nextVotesCount = updatedOptions.reduce((sum, o) => sum + o.votes_count, 0);
      this.#db
        .prepare(
          `UPDATE post_polls
           SET options_json = ?, votes_count = ?, voters_count = voters_count + 1
           WHERE id = ?`,
        )
        .run(JSON.stringify(updatedOptions), nextVotesCount, poll.id);
    });
    tx();

    return this.getPostPoll(postId, voterUserId ?? undefined)!;
  }

  // ── Follow Requests (Locked Accounts) ────────────────────────────

  getPendingFollowRequests(userId: number): {
    id: number;
    follower_id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    actor_url: string | null;
    inbox_url: string | null;
    created_at: string;
  }[] {
    return this.#db
      .prepare(
        `SELECT f.id, f.follower_id, u.username, u.display_name, u.avatar_url, u.bio, u.actor_url, u.inbox_url, f.created_at
         FROM follows f
         JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND f.state = 'pending'
         ORDER BY f.id DESC`,
      )
      .all(userId) as {
      id: number;
      follower_id: number;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
      bio: string | null;
      actor_url: string | null;
      inbox_url: string | null;
      created_at: string;
    }[];
  }

  acceptFollowRequest(followingId: number, followerId: number): boolean {
    const res = this.#db
      .prepare(`UPDATE follows SET state = 'accepted' WHERE following_id = ? AND follower_id = ?`)
      .run(followingId, followerId);
    if (res.changes > 0) {
      this.createNotification(followerId, followingId, "follow_accepted");
      return true;
    }
    return false;
  }

  rejectFollowRequest(followingId: number, followerId: number): boolean {
    const res = this.#db
      .prepare(`DELETE FROM follows WHERE following_id = ? AND follower_id = ? AND state = 'pending'`)
      .run(followingId, followerId);
    return res.changes > 0;
  }

  // ── Account Migration, Key Rotation & Social Graph Portability ───

  rotateUserKeys(userId: number): { publicKey: string } {
    const { publicKey, privateKey } = this.#generateRSAKeys();
    this.#db
      .prepare(`UPDATE users SET public_key = ?, private_key = ? WHERE id = ?`)
      .run(publicKey, privateKey, userId);
    return { publicKey };
  }

  setUserAliases(userId: number, alsoKnownAs: string[]): string[] {
    const normalized = Array.from(new Set(alsoKnownAs.map((u) => String(u || "").trim()).filter((u) => u.length > 0)));
    this.#db.prepare(`UPDATE users SET also_known_as = ? WHERE id = ?`).run(JSON.stringify(normalized), userId);
    return normalized;
  }

  initiateLocalUserMove(
    userId: number,
    targetActorUrl: string,
  ): { movedToActorUrl: string; migratedLocalFollowers: number } {
    const cleanTarget = targetActorUrl.trim();
    if (!cleanTarget) {
      throw new Error("Target actor URL is required");
    }
    this.#db.prepare(`UPDATE users SET moved_to_actor_url = ? WHERE id = ?`).run(cleanTarget, userId);

    // If the target actor already exists locally, migrate local followers immediately
    let migratedLocalFollowers = 0;
    const targetUser = this.getUserByActorUrl(cleanTarget);
    if (targetUser && targetUser.id !== userId) {
      const followers = this.#db
        .prepare(`SELECT follower_id, state FROM follows WHERE following_id = ?`)
        .all(userId) as { follower_id: number; state: string | null }[];
      const insertFollow = this.#db.prepare(
        `INSERT OR IGNORE INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)`,
      );
      const deleteOld = this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`);
      const tx = this.#db.transaction(() => {
        for (const f of followers) {
          if (f.follower_id === targetUser.id) continue;
          insertFollow.run(f.follower_id, targetUser.id, f.state || "accepted");
          deleteOld.run(f.follower_id, userId);
          migratedLocalFollowers++;
        }
      });
      tx();
    }

    return { movedToActorUrl: cleanTarget, migratedLocalFollowers };
  }

  executeInboundActorMove(
    sourceActorUrl: string,
    targetActorUrl: string,
    targetAlsoKnownAs: string[],
    targetProfile?: {
      username?: string | undefined;
      displayName?: string | undefined;
      inboxUrl?: string | undefined;
      sharedInboxUrl?: string | undefined;
      publicKey?: string | undefined;
    },
  ): { success: boolean; reason?: string | undefined; migratedFollowers: number } {
    const cleanSource = sourceActorUrl.trim();
    const cleanTarget = targetActorUrl.trim();
    if (!cleanSource || !cleanTarget || cleanSource === cleanTarget) {
      return { success: false, reason: "Invalid source or target actor URL", migratedFollowers: 0 };
    }

    // Verify bidirectional alsoKnownAs claim per ActivityPub Move specification
    const normalizedAliases = targetAlsoKnownAs.map((a) => a.trim().replace(/\/$/, ""));
    if (!normalizedAliases.includes(cleanSource.replace(/\/$/, ""))) {
      return {
        success: false,
        reason: `Target actor '${cleanTarget}' does not list source '${cleanSource}' in alsoKnownAs`,
        migratedFollowers: 0,
      };
    }

    const sourceUser = this.getUserByActorUrl(cleanSource);
    if (!sourceUser) {
      return { success: false, reason: "Source actor not found", migratedFollowers: 0 };
    }

    let targetUser = this.getUserByActorUrl(cleanTarget);
    if (!targetUser) {
      let username = targetProfile?.username || "migrated_actor";
      try {
        const parsed = new URL(cleanTarget);
        const pathParts = parsed.pathname.split("/").filter(Boolean);
        username = targetProfile?.username || pathParts[pathParts.length - 1] || "migrated_actor";
      } catch {}
      const created = this.getOrCreateRemoteUser(cleanTarget, {
        preferredUsername: username,
        name: targetProfile?.displayName,
        inbox: targetProfile?.inboxUrl || `${cleanTarget.replace(/\/$/, "")}/inbox`,
        sharedInbox: targetProfile?.sharedInboxUrl,
        publicKey: targetProfile?.publicKey || "",
        alsoKnownAs: targetAlsoKnownAs,
      });
      const fetched = this.getUserById(created.id);
      if (!fetched) {
        return { success: false, reason: "Failed to initialize target remote user", migratedFollowers: 0 };
      }
      targetUser = fetched;
    }

    let migratedFollowers = 0;
    const tx = this.#db.transaction(() => {
      this.#db.prepare(`UPDATE users SET moved_to_actor_url = ? WHERE id = ?`).run(cleanTarget, sourceUser.id);
      const followers = this.#db
        .prepare(`SELECT follower_id, state FROM follows WHERE following_id = ?`)
        .all(sourceUser.id) as { follower_id: number; state: string | null }[];
      const insertFollow = this.#db.prepare(
        `INSERT OR IGNORE INTO follows (follower_id, following_id, state) VALUES (?, ?, ?)`,
      );
      const deleteOld = this.#db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`);
      for (const f of followers) {
        if (f.follower_id === targetUser!.id) continue;
        insertFollow.run(f.follower_id, targetUser!.id, f.state || "accepted");
        deleteOld.run(f.follower_id, sourceUser.id);
        migratedFollowers++;
      }
    });
    tx();

    return { success: true, migratedFollowers };
  }

  exportUserSocialGraph(userId: number): {
    following: string[];
    followers: string[];
    blocks: string[];
    mutes: string[];
    bookmarks: number[];
    followingCsv: string;
    blocksCsv: string;
    mutesCsv: string;
  } {
    const followingRows = this.#db
      .prepare(
        `SELECT u.username, u.remote_domain
         FROM follows f JOIN users u ON f.following_id = u.id
         WHERE f.follower_id = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(userId) as { username: string; remote_domain: string | null }[];
    const following = followingRows.map((r) =>
      r.username.includes("@") || !r.remote_domain ? r.username : `${r.username}@${r.remote_domain}`,
    );

    const followerRows = this.#db
      .prepare(
        `SELECT u.username, u.remote_domain
         FROM follows f JOIN users u ON f.follower_id = u.id
         WHERE f.following_id = ? AND (f.state = 'accepted' OR f.state IS NULL)`,
      )
      .all(userId) as { username: string; remote_domain: string | null }[];
    const followers = followerRows.map((r) =>
      r.username.includes("@") || !r.remote_domain ? r.username : `${r.username}@${r.remote_domain}`,
    );

    const blockRows = this.#db
      .prepare(`SELECT u.username FROM user_blocks b JOIN users u ON b.blocked_id = u.id WHERE b.blocker_id = ?`)
      .all(userId) as { username: string }[];
    const blocks = blockRows.map((r) => r.username);

    const muteRows = this.#db
      .prepare(`SELECT u.username FROM user_mutes m JOIN users u ON m.muted_id = u.id WHERE m.muter_id = ?`)
      .all(userId) as { username: string }[];
    const mutes = muteRows.map((r) => r.username);

    const bookmarkRows = this.#db
      .prepare(`SELECT post_id FROM bookmarks WHERE user_id = ? ORDER BY id DESC`)
      .all(userId) as { post_id: number }[];
    const bookmarks = bookmarkRows.map((r) => Number(r.post_id));

    const followingCsv = [
      "Account address,Show boosts,Notify on new posts,Languages",
      ...following.map((acct) => `${acct},true,false,`),
    ].join("\n");
    const blocksCsv = ["Account address", ...blocks].join("\n");
    const mutesCsv = ["Account address,Hide notifications", ...mutes.map((acct) => `${acct},true`)].join("\n");

    return {
      following,
      followers,
      blocks,
      mutes,
      bookmarks,
      followingCsv,
      blocksCsv,
      mutesCsv,
    };
  }

  importUserSocialGraph(
    userId: number,
    data: {
      following?: string[] | undefined;
      blocks?: string[] | undefined;
      mutes?: string[] | undefined;
      mode?: "merge" | "replace" | "overwrite" | undefined;
    },
    modeArg: "merge" | "replace" | "overwrite" = "merge",
  ): {
    importedFollowing: number;
    importedBlocks: number;
    importedMutes: number;
  } {
    const effectiveMode =
      data.mode === "overwrite" || data.mode === "replace" || modeArg === "overwrite" || modeArg === "replace"
        ? "replace"
        : "merge";
    let importedFollowing = 0;
    let importedBlocks = 0;
    let importedMutes = 0;

    const resolveOrCreateTarget = (rawHandle: string): number | null => {
      const clean = rawHandle.trim().replace(/^@/, "").split(",")[0]?.trim() || "";
      if (!clean || clean === "Account address") return null;
      const existing = this.getUserByUsername(clean) || this.getUserByActorUrl(clean);
      if (existing) return existing.id;
      if (clean.includes("@")) {
        const [uname, dom] = clean.split("@");
        if (uname && dom) {
          const byLocal = this.getUserByUsername(uname);
          if (byLocal) return byLocal.id;
          const actorUrl = `https://${dom.toLowerCase()}/users/${uname}`;
          const remote = this.getOrCreateRemoteUser(actorUrl, {
            preferredUsername: uname,
            inbox: `https://${dom.toLowerCase()}/users/${uname}/inbox`,
            publicKey: "",
          });
          return remote.id;
        }
      }
      return null;
    };

    const tx = this.#db.transaction(() => {
      if (Array.isArray(data.following)) {
        if (effectiveMode === "replace") {
          this.#db.prepare(`DELETE FROM follows WHERE follower_id = ?`).run(userId);
        }
        for (const handle of data.following) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.followUser(userId, targetId, "accepted");
            importedFollowing++;
          }
        }
      }

      if (Array.isArray(data.blocks)) {
        if (effectiveMode === "replace") {
          this.#db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ?`).run(userId);
        }
        for (const handle of data.blocks) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.blockUser(userId, targetId);
            importedBlocks++;
          }
        }
      }

      if (Array.isArray(data.mutes)) {
        if (effectiveMode === "replace") {
          this.#db.prepare(`DELETE FROM user_mutes WHERE muter_id = ?`).run(userId);
        }
        for (const handle of data.mutes) {
          const targetId = resolveOrCreateTarget(handle);
          if (targetId && targetId !== userId) {
            this.muteUser(userId, targetId);
            importedMutes++;
          }
        }
      }
    });
    tx();

    return { importedFollowing, importedBlocks, importedMutes };
  }

  // ── Remote Media Cache Proxy & Retention Pruning ─────────────────

  getCachedRemoteArtifact(sourceUrl: string): RemoteArtifactCacheRow | undefined {
    const clean = sourceUrl.trim();
    const row = this.#db
      .prepare(
        `SELECT * FROM remote_artifact_cache
         WHERE source_url = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
      )
      .get(clean) as RemoteArtifactCacheRow | undefined;
    if (row) {
      this.#db.prepare(`UPDATE remote_artifact_cache SET last_accessed_at = datetime('now') WHERE id = ?`).run(row.id);
    }
    return row;
  }

  putCachedRemoteArtifact(entry: {
    sourceUrl: string;
    remoteDomain: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
    data: Buffer;
    ttlDays?: number | undefined;
  }): RemoteArtifactCacheRow {
    const ttlDays = entry.ttlDays ?? (this.getInstanceSettings().remoteMediaCacheRetentionDays || 14);
    const expiresAt = new Date(Date.now() + Math.max(1, ttlDays) * 86_400_000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    this.#db
      .prepare(
        `INSERT INTO remote_artifact_cache (source_url, remote_domain, media_type, byte_size, sha256, data_blob, last_accessed_at, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
         ON CONFLICT(source_url) DO UPDATE SET
           media_type = excluded.media_type,
           byte_size = excluded.byte_size,
           sha256 = excluded.sha256,
           data_blob = excluded.data_blob,
           last_accessed_at = datetime('now'),
           expires_at = excluded.expires_at`,
      )
      .run(
        entry.sourceUrl.trim(),
        entry.remoteDomain.toLowerCase().trim(),
        entry.mediaType,
        entry.byteSize,
        entry.sha256,
        entry.data,
        expiresAt,
      );

    return this.#db
      .prepare(`SELECT * FROM remote_artifact_cache WHERE source_url = ?`)
      .get(entry.sourceUrl.trim()) as RemoteArtifactCacheRow;
  }

  pruneRemoteMediaCache(olderThanDays?: number): { deletedFiles: number; freedBytes: number } {
    const days = olderThanDays ?? this.getInstanceSettings().remoteMediaCacheRetentionDays ?? 14;
    const cutoff =
      days <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const statsRow = this.#db
      .prepare(
        `SELECT COUNT(*) as c, COALESCE(SUM(byte_size), 0) as totalBytes
         FROM remote_artifact_cache
         WHERE last_accessed_at <= ? OR (expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now'))`,
      )
      .get(cutoff) as { c: number; totalBytes: number } | undefined;

    const res = this.#db
      .prepare(
        `DELETE FROM remote_artifact_cache
         WHERE last_accessed_at <= ? OR (expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now'))`,
      )
      .run(cutoff);

    return {
      deletedFiles: Number(res.changes || statsRow?.c || 0),
      freedBytes: Number(statsRow?.totalBytes || 0),
    };
  }

  pruneRemoteContent(olderThanDays?: number): { deletedPosts: number } {
    const days = olderThanDays ?? this.getInstanceSettings().remoteContentRetentionDays ?? 90;
    const cutoff =
      days <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - days * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const res = this.#db
      .prepare(
        `DELETE FROM posts
         WHERE created_at <= ?
           AND (ap_id IS NOT NULL OR author_id IN (SELECT id FROM users WHERE account_type = 'remote' OR remote_domain IS NOT NULL))
           AND id NOT IN (SELECT DISTINCT post_id FROM likes WHERE post_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT post_id FROM bookmarks WHERE post_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT reply_to_id FROM posts WHERE reply_to_id IS NOT NULL)
           AND id NOT IN (SELECT DISTINCT repost_of_id FROM posts WHERE repost_of_id IS NOT NULL)`,
      )
      .run(cutoff);

    return { deletedPosts: Number(res.changes) };
  }

  pruneRemoteAccounts(olderThanDays: number = 90): { deletedAccounts: number } {
    const cutoff =
      olderThanDays <= 0
        ? "9999-12-31 23:59:59"
        : new Date(Date.now() - olderThanDays * 86_400_000).toISOString().replace("T", " ").slice(0, 19);

    const res = this.#db
      .prepare(
        `DELETE FROM users
         WHERE (account_type = 'remote' OR remote_domain IS NOT NULL)
           AND created_at <= ?
           AND id NOT IN (SELECT following_id FROM follows)
           AND id NOT IN (SELECT follower_id FROM follows)
           AND id NOT IN (SELECT author_id FROM posts)`,
      )
      .run(cutoff);

    return { deletedAccounts: Number(res.changes) };
  }

  // ── Trending Topic Moderation ────────────────────────────────────

  listTrendingTopicsForAdmin(reviewStatus?: string, limit: number = 50): TrendingTopicRow[] {
    if (reviewStatus && reviewStatus !== "all") {
      return this.#db
        .prepare(
          `SELECT * FROM trending_topics
           WHERE COALESCE(review_status, 'approved') = ?
           ORDER BY current_score DESC LIMIT ?`,
        )
        .all(reviewStatus, limit) as TrendingTopicRow[];
    }
    return this.#db
      .prepare(`SELECT * FROM trending_topics ORDER BY current_score DESC LIMIT ?`)
      .all(limit) as TrendingTopicRow[];
  }

  reviewTrendingTopic(
    topicId: number,
    status: "pending" | "approved" | "rejected",
    reviewerId?: number | null,
  ): TrendingTopicRow | undefined {
    this.#db
      .prepare(
        `UPDATE trending_topics
         SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now')
         WHERE id = ?`,
      )
      .run(status, reviewerId ?? null, topicId);
    return this.#db.prepare(`SELECT * FROM trending_topics WHERE id = ?`).get(topicId) as TrendingTopicRow | undefined;
  }

  // ── Web Push Subscriptions (RFC 8030) ────────────────────────────

  listPushSubscriptions(userId: number): PushSubscriptionRow[] {
    return this.#db
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC`)
      .all(userId) as PushSubscriptionRow[];
  }

  upsertPushSubscription(
    userId: number,
    endpoint: string,
    p256dh: string,
    auth: string,
    alerts: Record<string, boolean> = {
      mention: true,
      follow: true,
      reblog: true,
      favourite: true,
      poll: true,
    },
    policy: string = "all",
  ): PushSubscriptionRow {
    const cleanEndpoint = endpoint.trim();
    if (!cleanEndpoint) {
      throw new Error("Push subscription endpoint URL is required");
    }
    this.#db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, alerts_json, policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           alerts_json = excluded.alerts_json,
           policy = excluded.policy,
           updated_at = datetime('now')`,
      )
      .run(userId, cleanEndpoint, p256dh, auth, JSON.stringify(alerts), policy);

    return this.#db
      .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
      .get(userId, cleanEndpoint) as PushSubscriptionRow;
  }

  deletePushSubscription(userId: number, idOrEndpoint: number | string): boolean {
    if (typeof idOrEndpoint === "number") {
      const res = this.#db
        .prepare(`DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?`)
        .run(idOrEndpoint, userId);
      return res.changes > 0;
    }
    const res = this.#db
      .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`)
      .run(idOrEndpoint.trim(), userId);
    return res.changes > 0;
  }

  close(): void {
    if (this.analyticsBuffer) {
      this.analyticsBuffer.stop();
      this.analyticsBuffer.flushSync();
    }
    this.#db.close();
  }
}

export interface ApiTokenRecord {
  id: number;
  user_id: number;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string[];
  package_pattern: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface ThreadConflictRecord {
  conflictId: string;
  workspaceId: string;
  slot: number;
  sourceDomain: string;
  sourceValue: number;
  sourceUnit: string;
  targetDomain: string;
  targetValue: number;
  targetUnit: string;
  min: number;
  max: number;
  status: "conflicted" | "resolved";
  resolvedValue: number | null;
  updatedAt: string;
}

export interface ThreadProposal {
  id: number;
  thread_id: string;
  title: string;
  description: string | null;
  status: "open" | "approved" | "rejected" | "applied";
  proposed_by: string;
  diff_summary: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  review_comment: string | null;
}

export interface ThreadAuditLogEntry {
  id: number;
  thread_id: string;
  proposal_id: number | null;
  action: string;
  actor: string;
  safety_standard: string | null;
  checksum: string;
  metadata: string | null;
  created_at: string;
}

export type {
  AccountWarningRow,
  CanonicalEmailBlockRow,
  ContentFilterKeyword,
  ContentFilterMatch,
  ContentFilterRow,
  FederationRelayRow,
  InstanceRuleRow,
  IpBlockRow,
  PostPollOption,
  PostPollView,
  PostVisibility,
  ProfileField,
  PushSubscriptionRow,
  RemoteArtifactCacheRow,
  StaffNoteRow,
  UserReferralRow,
  WaitlistSubmissionRow,
} from "./database/types.js";
export type Database = LibraryDatabase;
