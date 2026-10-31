// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Migration, MigrationContext } from "./types.js";

function stripAnno(raw: string): string | null {
  const cleaned = raw
    .replace(/\s*\bannotation\s*\([\s\S]*$/i, "")
    .trim()
    .replace(/^"|"$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export const migration0021: Migration = {
  id: "0021",
  name: "0021_schema_consolidation",
  up(ctx: MigrationContext) {
    ctx.execute(`
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

      CREATE TABLE IF NOT EXISTS artifacts (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id      INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
        type            TEXT NOT NULL,
        path            TEXT NOT NULL,
        metadata        TEXT,
        UNIQUE(version_id, path)
      );
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

      CREATE TABLE IF NOT EXISTS twins (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id         INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        modelica_class      TEXT NOT NULL,
        status              TEXT DEFAULT 'active',
        health_score        REAL DEFAULT 100.0,
        config              TEXT NOT NULL,
        current_parameters  TEXT NOT NULL,
        current_weights     TEXT,
        created_at          TEXT DEFAULT (datetime('now')),
        last_telemetry_at   TEXT,
        last_adapted_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_twins_instance ON twins(instance_id);

      CREATE TABLE IF NOT EXISTS twin_adaptations (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id             INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        trigger_reason      TEXT NOT NULL,
        prior_parameters    TEXT NOT NULL,
        updated_parameters  TEXT NOT NULL,
        residual_before     REAL NOT NULL,
        residual_after      REAL NOT NULL,
        iterations          INTEGER NOT NULL,
        created_at          TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_twin_adaptations_twin ON twin_adaptations(twin_id);

      CREATE TABLE IF NOT EXISTS twin_proposals (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id             INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        post_id             INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        adaptation_id       INTEGER REFERENCES twin_adaptations(id) ON DELETE CASCADE,
        status              TEXT DEFAULT 'open',
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
        rejection_reason TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_submissions(email);

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

    const alterStatements = [
      "ALTER TABLE notifications ADD COLUMN metadata TEXT",
      "ALTER TABLE users ADD COLUMN notification_settings TEXT DEFAULT '{}'",
      "ALTER TABLE users ADD COLUMN credit_balance REAL DEFAULT 100.0",
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
      "ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'user'",
      "ALTER TABLE users ADD COLUMN ed25519_public_key TEXT",
      "ALTER TABLE users ADD COLUMN ed25519_private_key TEXT",
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
      "ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0",
      "ALTER TABLE posts ADD COLUMN ap_id TEXT UNIQUE",
      "ALTER TABLE posts ADD COLUMN url TEXT",
      "ALTER TABLE posts ADD COLUMN metadata TEXT",
      "ALTER TABLE posts ADD COLUMN reply_visibility TEXT DEFAULT 'everyone'",
      "ALTER TABLE posts ADD COLUMN is_silenced INTEGER DEFAULT 0",
      "ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT",
      "ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT",
      "ALTER TABLE jobs ADD COLUMN compute_profile TEXT DEFAULT 'standard'",
      "ALTER TABLE jobs ADD COLUMN cpu_seconds REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN peak_memory_mb REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN gpu_seconds REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN cost_credits REAL DEFAULT 0",
      "ALTER TABLE jobs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
      "ALTER TABLE jobs ADD COLUMN metadata TEXT",
      "ALTER TABLE package_versions ADD COLUMN tarball_integrity TEXT",
      "ALTER TABLE package_versions ADD COLUMN modelscript_meta TEXT",
      "ALTER TABLE oauth_accounts ADD COLUMN access_token TEXT",
      "ALTER TABLE oauth_accounts ADD COLUMN refresh_token TEXT",
      "ALTER TABLE oauth_accounts ADD COLUMN expires_at TEXT",
      "ALTER TABLE packages ADD COLUMN quarantine_status TEXT DEFAULT 'clean'",
      "ALTER TABLE packages ADD COLUMN is_quarantined INTEGER DEFAULT 0",
      "ALTER TABLE artifact_views ADD COLUMN remote_origin_url TEXT",
      "ALTER TABLE sysml2_commits ADD COLUMN merged_commit TEXT",
      "ALTER TABLE organizations ADD COLUMN credit_balance REAL NOT NULL DEFAULT 0.0",
      "ALTER TABLE organizations ADD COLUMN total_spent REAL NOT NULL DEFAULT 0.0",
      "ALTER TABLE waitlist_submissions ADD COLUMN rejection_reason TEXT",
    ];

    for (const stmt of alterStatements) {
      try {
        ctx.execute(stmt);
      } catch {
        // Column already exists
      }
    }

    // One-time cleanup of legacy Modelica description strings containing raw annotation(...) blocks
    try {
      const dirtyClasses = ctx.query<{ id: number; description: string }>(
        `SELECT id, description FROM classes WHERE description LIKE '%annotation(%' OR description LIKE '%annotation (%'`,
      );
      if (Array.isArray(dirtyClasses)) {
        for (const row of dirtyClasses) {
          ctx.execute(`UPDATE classes SET description = ? WHERE id = ?`, [stripAnno(row.description), row.id]);
        }
      }

      const dirtyComps = ctx.query<{ id: number; description: string }>(
        `SELECT id, description FROM components WHERE description LIKE '%annotation(%' OR description LIKE '%annotation (%'`,
      );
      if (Array.isArray(dirtyComps)) {
        for (const row of dirtyComps) {
          ctx.execute(`UPDATE components SET description = ? WHERE id = ?`, [stripAnno(row.description), row.id]);
        }
      }

      ctx.execute(`
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
      // Ignore if classes/components/modifiers tables are not populated yet
    }
  },
  down(_ctx: MigrationContext) {
    // Consolidation migration is non-destructive on rollback to preserve core data tables
  },
};
