// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

export const migration0023: Migration = {
  id: "0023",
  name: "0023_mastodon_platform_parity",
  up(ctx: MigrationContext) {
    ctx.execute(`
      CREATE TABLE IF NOT EXISTS federation_relays (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        inbox_url           TEXT NOT NULL UNIQUE,
        actor_url           TEXT NOT NULL,
        domain              TEXT NOT NULL DEFAULT 'unknown',
        state               TEXT NOT NULL DEFAULT 'pending',
        follow_activity_id  TEXT,
        forwarded_count     INTEGER NOT NULL DEFAULT 0,
        received_count      INTEGER NOT NULL DEFAULT 0,
        last_activity_at    TEXT,
        last_error          TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_federation_relays_state ON federation_relays(state);

      CREATE TABLE IF NOT EXISTS instance_rules (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        text        TEXT NOT NULL,
        hint        TEXT,
        category    TEXT NOT NULL DEFAULT 'conduct',
        priority    INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        is_active   INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_instance_rules_order ON instance_rules(priority, id);

      CREATE TABLE IF NOT EXISTS account_warnings (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        moderator_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        report_id       INTEGER REFERENCES content_reports(id) ON DELETE SET NULL,
        action          TEXT NOT NULL DEFAULT 'warn',
        text            TEXT NOT NULL,
        rule_ids        TEXT NOT NULL DEFAULT '[]',
        post_ids        TEXT NOT NULL DEFAULT '[]',
        acknowledged_at TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_account_warnings_user ON account_warnings(target_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS staff_notes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_staff_notes_target ON staff_notes(target_type, target_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS ip_blocks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        cidr        TEXT NOT NULL UNIQUE,
        severity    TEXT NOT NULL DEFAULT 'no_sign_up',
        comment     TEXT,
        created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ip_blocks_severity ON ip_blocks(severity);

      CREATE TABLE IF NOT EXISTS canonical_email_blocks (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_email_hash  TEXT NOT NULL UNIQUE,
        canonical_email_hint  TEXT,
        reason                TEXT,
        created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_canonical_email_blocks_hash ON canonical_email_blocks(canonical_email_hash);

      CREATE TABLE IF NOT EXISTS content_filters (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title         TEXT NOT NULL,
        context       TEXT NOT NULL DEFAULT '["home","public","notifications","thread","account"]',
        filter_action TEXT NOT NULL DEFAULT 'warn',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        expires_at    TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_content_filters_user ON content_filters(user_id);

      CREATE TABLE IF NOT EXISTS remote_artifact_cache (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        source_url       TEXT NOT NULL UNIQUE,
        remote_domain    TEXT NOT NULL,
        media_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
        byte_size        INTEGER NOT NULL DEFAULT 0,
        sha256           TEXT NOT NULL,
        local_path       TEXT,
        data_blob        BLOB,
        last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_artifact_cache_domain ON remote_artifact_cache(remote_domain);
      CREATE INDEX IF NOT EXISTS idx_remote_artifact_cache_accessed ON remote_artifact_cache(last_accessed_at);

      CREATE TABLE IF NOT EXISTS post_polls (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id       INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
        options_json  TEXT NOT NULL,
        multiple      INTEGER NOT NULL DEFAULT 0,
        expires_at    TEXT,
        closed        INTEGER NOT NULL DEFAULT 0,
        votes_count   INTEGER NOT NULL DEFAULT 0,
        voters_count  INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS post_poll_votes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id         INTEGER NOT NULL REFERENCES post_polls(id) ON DELETE CASCADE,
        post_id         INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        voter_user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
        voter_actor_url TEXT,
        option_index    INTEGER NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_post_poll_votes_post ON post_poll_votes(post_id);
      CREATE INDEX IF NOT EXISTS idx_post_poll_votes_poll ON post_poll_votes(poll_id);

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint    TEXT NOT NULL,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        alerts_json TEXT NOT NULL DEFAULT '{"mention":true,"reply":true,"repost":true,"follow":true,"poll":true,"hpc":true,"admin_report":true}',
        policy      TEXT NOT NULL DEFAULT 'all',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, endpoint)
      );
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    `);

    const alterStatements = [
      // Granular federation_domains moderation & availability tracking
      "ALTER TABLE federation_domains ADD COLUMN reject_media INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN reject_reports INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN obfuscate INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN public_comment TEXT",
      "ALTER TABLE federation_domains ADD COLUMN private_comment TEXT",
      "ALTER TABLE federation_domains ADD COLUMN unavailable_since TEXT",
      "ALTER TABLE federation_domains ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN last_seen_at TEXT",

      // User privacy, discovery, migration, and PropertyValue profile fields
      "ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE users ADD COLUMN indexable INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE users ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN also_known_as TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE users ADD COLUMN moved_to_actor_url TEXT",
      "ALTER TABLE users ADD COLUMN profile_fields TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE users ADD COLUMN default_post_visibility TEXT NOT NULL DEFAULT 'public'",

      // Post visibility scopes (public, unlisted, followers, direct)
      "ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",

      // Structured rule citations on content reports
      "ALTER TABLE content_reports ADD COLUMN rule_ids TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE content_reports ADD COLUMN category TEXT NOT NULL DEFAULT 'other'",

      // Trending topics pre-moderation review state
      "ALTER TABLE trending_topics ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'",
      "ALTER TABLE trending_topics ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL",
      "ALTER TABLE trending_topics ADD COLUMN reviewed_at TEXT",
    ];

    for (const stmt of alterStatements) {
      try {
        ctx.execute(stmt);
      } catch {
        // Column already exists
      }
    }
  },
  down(_ctx: MigrationContext) {
    // Non-destructive rollback for SQLite column additions
  },
};
