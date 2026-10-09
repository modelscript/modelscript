// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const baselineMigration: Migration = {
  id: "0001_baseline",
  name: "0001_baseline_schema",
  up(ctx: MigrationContext) {
    ctx.execute(`
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
        owner_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now')),
        rsa_private_key TEXT,
        rsa_public_key  TEXT,
        actor_url       TEXT,
        inbox_url       TEXT,
        outbox_url      TEXT,
        shared_inbox_url TEXT,
        remote_domain   TEXT,
        email_verified  INTEGER DEFAULT 0,
        verification_token TEXT,
        verification_sent_at TEXT,
        status        TEXT DEFAULT 'active',
        credit_balance REAL DEFAULT 100.0,
        terms_accepted_at TEXT,
        registration_ip TEXT,
        ed25519_public_key TEXT,
        ed25519_private_key TEXT,
        token_version INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_actor_url ON users(actor_url);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider      TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        access_token  TEXT,
        refresh_token TEXT,
        expires_at    TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(provider, provider_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

      CREATE TABLE IF NOT EXISTS follows (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state         TEXT DEFAULT 'accepted',
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(follower_id, following_id)
      );

      CREATE TABLE IF NOT EXISTS rss_feeds (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        url             TEXT NOT NULL UNIQUE,
        title           TEXT,
        site_url        TEXT,
        last_fetched_at TEXT,
        last_guid       TEXT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_rss_subscriptions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rss_feed_id     INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
        created_at      TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, rss_feed_id)
      );

      CREATE TABLE IF NOT EXISTS artifact_views (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        view_type       TEXT NOT NULL,
        source_type     TEXT NOT NULL,
        view_config     TEXT NOT NULL,
        title           TEXT,
        thumbnail_url   TEXT,
        remote_origin_url TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT,
        artifact_view_id INTEGER REFERENCES artifact_views(id) ON DELETE SET NULL,
        reply_to_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        quote_post_id   INTEGER REFERENCES posts(id),
        repost_of_id    INTEGER REFERENCES posts(id),
        like_count      INTEGER DEFAULT 0,
        reply_count     INTEGER DEFAULT 0,
        repost_count    INTEGER DEFAULT 0,
        view_count      INTEGER DEFAULT 0,
        ap_id           TEXT UNIQUE,
        url             TEXT,
        metadata        TEXT,
        reply_visibility TEXT DEFAULT 'everyone',
        is_silenced     INTEGER DEFAULT 0,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now')),
        published_at    TEXT DEFAULT (datetime('now'))
      );

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
        quarantine_status TEXT DEFAULT 'clean',
        is_quarantined  INTEGER DEFAULT 0,
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
        published_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
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

      CREATE TABLE IF NOT EXISTS jobs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        status          TEXT NOT NULL,
        type            TEXT NOT NULL,
        repository_id   INTEGER,
        trigger_source  TEXT,
        compute_profile TEXT DEFAULT 'standard',
        cpu_seconds     REAL DEFAULT 0,
        peak_memory_mb  REAL DEFAULT 0,
        gpu_seconds     REAL DEFAULT 0,
        cost_credits    REAL DEFAULT 0,
        user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
        metadata        TEXT,
        started_at      TEXT DEFAULT (datetime('now')),
        completed_at    TEXT
      );

      CREATE TABLE IF NOT EXISTS credit_transactions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount          REAL NOT NULL,
        balance_after   REAL NOT NULL,
        type            TEXT NOT NULL,
        description     TEXT NOT NULL,
        metadata        TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );

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
  },
};
