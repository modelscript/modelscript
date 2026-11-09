// SPDX-License-Identifier: AGPL-3.0-or-later

import { FEATURE_FLAGS } from "../feature-flags.js";
import type { Migration, MigrationContext } from "./types.js";

function stripAnno(raw: string): string | null {
  const cleaned = raw
    .replace(/\s*\bannotation\s*\([\s\S]*$/i, "")
    .trim()
    .replace(/^"|"$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Consolidated 0.1.0 baseline schema for ModelScript.
 * Incorporates all core metadata, registry, federation, governance, digital thread,
 * billing, analytics, and instance administration tables.
 */
export const baselineMigration: Migration = {
  id: "0001_baseline",
  name: "0001_baseline_schema",
  up(ctx: MigrationContext) {
    ctx.execute(`
      -- ── Core Modelica & Polyglot Library Metadata ────────────────

      CREATE TABLE IF NOT EXISTS classes (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        class_name      TEXT NOT NULL,
        class_kind      TEXT NOT NULL,
        description     TEXT,
        documentation   TEXT,
        icon_hash       TEXT,
        diagram_hash    TEXT,
        UNIQUE(library_name, library_version, class_name)
      );

      CREATE TABLE IF NOT EXISTS users (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        username                TEXT NOT NULL UNIQUE,
        email                   TEXT NOT NULL UNIQUE,
        password_hash           TEXT,
        display_name            TEXT,
        bio                     TEXT,
        avatar_url              TEXT DEFAULT 'https://ui-avatars.com/api/?name=User&background=random&color=fff',
        banner_url              TEXT DEFAULT 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?auto=format&fit=crop&w=1200&q=80',
        location                TEXT,
        website                 TEXT,
        notification_settings   TEXT DEFAULT '{}',
        account_type            TEXT DEFAULT 'user',
        owner_id                INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at              TEXT DEFAULT (datetime('now')),
        updated_at              TEXT DEFAULT (datetime('now')),
        rsa_private_key         TEXT,
        rsa_public_key          TEXT,
        actor_url               TEXT,
        inbox_url               TEXT,
        outbox_url              TEXT,
        shared_inbox_url        TEXT,
        remote_domain           TEXT,
        email_verified          INTEGER DEFAULT 0,
        verification_token      TEXT,
        verification_sent_at    TEXT,
        status                  TEXT DEFAULT 'active',
        credit_balance          REAL DEFAULT 100.0,
        terms_accepted_at       TEXT,
        registration_ip         TEXT,
        ed25519_public_key      TEXT,
        ed25519_private_key     TEXT,
        bot_token_hash          TEXT,
        token_version           INTEGER DEFAULT 1,
        totp_secret             TEXT,
        totp_enabled            INTEGER DEFAULT 0,
        backup_codes            TEXT DEFAULT '[]',
        bot_scopes              TEXT DEFAULT 'social:read,social:write',
        bot_system_prompt       TEXT,
        bot_model               TEXT DEFAULT 'gemini-1.5-flash',
        bot_last_used_at        TEXT,
        bot_api_key             TEXT,
        bot_endpoint_url        TEXT,
        onboarding_completed    INTEGER DEFAULT 0,
        engineering_persona     TEXT,
        invites_remaining       INTEGER DEFAULT 5,
        discoverable            INTEGER NOT NULL DEFAULT 1,
        indexable               INTEGER NOT NULL DEFAULT 1,
        locked                  INTEGER NOT NULL DEFAULT 0,
        also_known_as           TEXT NOT NULL DEFAULT '[]',
        moved_to_actor_url      TEXT,
        profile_fields          TEXT NOT NULL DEFAULT '[]',
        default_post_visibility TEXT NOT NULL DEFAULT 'public',
        signing_verified        INTEGER NOT NULL DEFAULT 0,
        signing_policy_strict   INTEGER NOT NULL DEFAULT 0,
        branch_tip_oid          TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_actor_url ON users(actor_url);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

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

      CREATE TABLE IF NOT EXISTS library_releases (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        library_name       TEXT NOT NULL,
        library_version    TEXT NOT NULL,
        content_hash       TEXT NOT NULL,
        signature          TEXT,
        published_by       INTEGER REFERENCES users(id),
        published_at       TEXT DEFAULT (datetime('now')),
        is_deprecated      INTEGER DEFAULT 0,
        deprecation_reason TEXT,
        is_yanked          INTEGER DEFAULT 0,
        yank_reason        TEXT,
        yanked_at          TEXT,
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

      -- ── Auth, OAuth, Keys & Tokens ───────────────────────────────

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider         TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        access_token     TEXT,
        refresh_token    TEXT,
        expires_at       TEXT,
        created_at       TEXT DEFAULT (datetime('now')),
        UNIQUE(provider, provider_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);

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

      CREATE TABLE IF NOT EXISTS pending_totp_secrets (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret     TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_tokens (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        token_prefix    TEXT NOT NULL,
        token_hash      TEXT NOT NULL UNIQUE,
        scopes          TEXT NOT NULL,
        package_pattern TEXT DEFAULT '*',
        expires_at      TEXT,
        last_used_at    TEXT,
        last_used_ip    TEXT,
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

      CREATE TABLE IF NOT EXISTS git_sync_map (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        path         TEXT NOT NULL,
        entity_type  TEXT NOT NULL,
        entity_id    TEXT NOT NULL,
        content_sha  TEXT,
        updated_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_git_sync_map_user ON git_sync_map(user_id);

      CREATE TABLE IF NOT EXISTS account_signing_keys (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key_multibase   TEXT NOT NULL,
        public_key_openssh     TEXT NOT NULL,
        fingerprint_sha256     TEXT NOT NULL UNIQUE,
        algo                   TEXT NOT NULL DEFAULT 'ed25519',
        label                  TEXT,
        trust_level            TEXT NOT NULL DEFAULT 'hardware_or_cli',
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        activated_at           TEXT NOT NULL DEFAULT (datetime('now')),
        revoked_at             TEXT,
        revoked_reason         TEXT,
        prev_key_id            INTEGER REFERENCES account_signing_keys(id),
        rotation_proof         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_account_signing_keys_user ON account_signing_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_account_signing_keys_fp ON account_signing_keys(fingerprint_sha256);

      CREATE TABLE IF NOT EXISTS account_key_log (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event        TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        prev_hash    TEXT NOT NULL,
        entry_hash   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_account_key_log_user ON account_key_log(user_id);

      CREATE TABLE IF NOT EXISTS signed_post_evidence (
        post_id      TEXT NOT NULL,
        rev          INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT NOT NULL,
        proof_json   TEXT NOT NULL,
        key_id       INTEGER REFERENCES account_signing_keys(id),
        commit_oid   TEXT,
        received_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (post_id, rev)
      );
      CREATE INDEX IF NOT EXISTS idx_signed_post_evidence_post ON signed_post_evidence(post_id);

      CREATE TABLE IF NOT EXISTS banned_signing_keys (
        fingerprint_sha256 TEXT PRIMARY KEY,
        reason             TEXT NOT NULL,
        banned_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- ── Social Graph, Posts, Feeds & Polls ───────────────────────

      CREATE TABLE IF NOT EXISTS follows (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        follower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state         TEXT DEFAULT 'accepted',
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(follower_id, following_id)
      );
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id, state);

      CREATE TABLE IF NOT EXISTS rss_feeds (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        url                TEXT NOT NULL UNIQUE,
        title              TEXT,
        description        TEXT,
        site_url           TEXT,
        last_fetched_at    TEXT,
        last_guid          TEXT,
        user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at         TEXT DEFAULT (datetime('now')),
        etag               TEXT,
        last_modified      TEXT,
        poll_interval_mins INTEGER DEFAULT 15,
        last_polled_at     TEXT
      );

      CREATE TABLE IF NOT EXISTS user_rss_subscriptions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rss_feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
        created_at  TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, rss_feed_id)
      );

      CREATE TABLE IF NOT EXISTS artifact_views (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        view_type         TEXT NOT NULL,
        source_type       TEXT NOT NULL,
        source_ref        TEXT,
        view_config       TEXT NOT NULL,
        title             TEXT,
        thumbnail_url     TEXT,
        remote_origin_url TEXT,
        created_at        TEXT DEFAULT (datetime('now')),
        updated_at        TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS posts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content          TEXT,
        artifact_view_id INTEGER REFERENCES artifact_views(id) ON DELETE SET NULL,
        reply_to_id      INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        quote_post_id    INTEGER REFERENCES posts(id),
        repost_of_id     INTEGER REFERENCES posts(id),
        like_count       INTEGER DEFAULT 0,
        reply_count      INTEGER DEFAULT 0,
        repost_count     INTEGER DEFAULT 0,
        view_count       INTEGER DEFAULT 0,
        ap_id            TEXT UNIQUE,
        url              TEXT,
        metadata         TEXT,
        reply_visibility TEXT DEFAULT 'everyone',
        visibility       TEXT NOT NULL DEFAULT 'public',
        is_silenced      INTEGER DEFAULT 0,
        is_sensitive     INTEGER DEFAULT 0,
        content_warning  TEXT,
        space_id         TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now')),
        published_at     TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
      CREATE INDEX IF NOT EXISTS idx_posts_reply ON posts(reply_to_id);
      CREATE INDEX IF NOT EXISTS idx_posts_repost ON posts(repost_of_id);
      CREATE INDEX IF NOT EXISTS idx_posts_quote ON posts(quote_post_id);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_reply_created ON posts(reply_to_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_repost_created ON posts(repost_of_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON posts(visibility, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_space ON posts(space_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS post_mentions (
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_post_mentions_user ON post_mentions(user_id);
      CREATE INDEX IF NOT EXISTS idx_post_mentions_post ON post_mentions(post_id);

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

      CREATE TABLE IF NOT EXISTS post_syndications (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        target      TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url         TEXT,
        created_at  TEXT DEFAULT (datetime('now')),
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

      CREATE TRIGGER IF NOT EXISTS trg_likes_insert AFTER INSERT ON likes BEGIN
        UPDATE posts SET like_count = like_count + 1 WHERE id = new.post_id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_likes_delete AFTER DELETE ON likes BEGIN
        UPDATE posts SET like_count = MAX(0, like_count - 1) WHERE id = old.post_id;
      END;

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
        archived    INTEGER DEFAULT 0,
        starred     INTEGER DEFAULT 0,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, read);
      CREATE INDEX IF NOT EXISTS idx_notifs_type_user ON notifications(user_id, type, read);
      CREATE INDEX IF NOT EXISTS idx_notifs_post ON notifications(post_id);

      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS user_mutes (
        muter_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        muted_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (muter_id, muted_id)
      );

      CREATE TABLE IF NOT EXISTS user_topics (
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        concept   TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        UNIQUE(user_id, concept)
      );

      CREATE TABLE IF NOT EXISTS trending_topics (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        concept         TEXT NOT NULL,
        location        TEXT,
        display_name    TEXT NOT NULL,
        current_score   REAL DEFAULT 0.0,
        review_status   TEXT NOT NULL DEFAULT 'approved',
        reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at     TEXT,
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

      CREATE TABLE IF NOT EXISTS bot_mention_queue (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id          INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status           TEXT NOT NULL DEFAULT 'pending',
        attempts         INTEGER NOT NULL DEFAULT 0,
        error            TEXT,
        response_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_pending ON bot_mention_queue(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_bot ON bot_mention_queue(bot_id);
      CREATE INDEX IF NOT EXISTS idx_bot_mention_queue_post ON bot_mention_queue(post_id);

      -- ── Repositories, Webhooks, Reviews & Solutions ──────────────

      CREATE TABLE IF NOT EXISTS linked_repos (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider           TEXT NOT NULL,
        namespace          TEXT NOT NULL,
        project            TEXT NOT NULL,
        external_id        TEXT,
        description        TEXT,
        avatar_url         TEXT,
        pinned             INTEGER DEFAULT 0,
        visibility         TEXT DEFAULT 'public',
        default_branch     TEXT DEFAULT 'main',
        social_preview_url TEXT,
        space_id           TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at         TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, provider, namespace, project)
      );
      CREATE INDEX IF NOT EXISTS idx_linked_repos_user ON linked_repos(user_id);
      CREATE INDEX IF NOT EXISTS idx_linked_repos_space ON linked_repos(space_id);

      CREATE TABLE IF NOT EXISTS repo_webhooks (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id         INTEGER NOT NULL REFERENCES linked_repos(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL CHECK(provider IN ('github', 'gitlab', 'local', 'custom')),
        secret          TEXT NOT NULL,
        events          TEXT NOT NULL DEFAULT '["push", "release"]',
        auto_publish    INTEGER DEFAULT 1,
        tag_pattern     TEXT DEFAULT '^v?([0-9]+\\.[0-9]+\\.[0-9]+)$',
        is_active       INTEGER DEFAULT 1,
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_repo_webhooks_repo ON repo_webhooks(repo_id);

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id      INTEGER NOT NULL REFERENCES repo_webhooks(id) ON DELETE CASCADE,
        event_type      TEXT NOT NULL,
        payload         TEXT NOT NULL,
        response_status INTEGER,
        error_message   TEXT,
        delivered_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh ON webhook_deliveries(webhook_id);

      CREATE TABLE IF NOT EXISTS repo_bot_reviews (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id     INTEGER NOT NULL REFERENCES linked_repos(id) ON DELETE CASCADE,
        bot_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pr_number   INTEGER,
        commit_sha  TEXT,
        verdict     TEXT NOT NULL DEFAULT 'COMMENT',
        summary     TEXT NOT NULL,
        issues_json TEXT,
        post_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        created_at  TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_repo_bot_reviews_repo ON repo_bot_reviews(repo_id);
      CREATE INDEX IF NOT EXISTS idx_repo_bot_reviews_bot ON repo_bot_reviews(bot_id);

      CREATE TABLE IF NOT EXISTS solutions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        repo_id           INTEGER REFERENCES linked_repos(id) ON DELETE SET NULL,
        slug              TEXT NOT NULL,
        name              TEXT NOT NULL,
        description       TEXT,
        category          TEXT DEFAULT 'Engineering Application',
        icon              TEXT DEFAULT 'cpu',
        supported_formats TEXT DEFAULT '[]',
        is_public         INTEGER DEFAULT 1,
        space_id          TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at        TEXT DEFAULT (datetime('now')),
        updated_at        TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_solutions_user ON solutions(user_id);
      CREATE INDEX IF NOT EXISTS idx_solutions_slug ON solutions(slug);
      CREATE INDEX IF NOT EXISTS idx_solutions_space ON solutions(space_id);

      CREATE TABLE IF NOT EXISTS solution_releases (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        solution_id       INTEGER NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
        version           TEXT NOT NULL,
        changelog         TEXT,
        bundle_url        TEXT NOT NULL,
        tauri_windows_url TEXT,
        tauri_linux_url   TEXT,
        tauri_darwin_url  TEXT,
        manifest_json     TEXT,
        created_at        TEXT DEFAULT (datetime('now')),
        UNIQUE(solution_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_solution_releases_sol ON solution_releases(solution_id);

      -- ── Packages, Registry, RBAC & Organizations ─────────────────

      CREATE TABLE IF NOT EXISTS packages (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL UNIQUE,
        description       TEXT,
        readme            TEXT,
        readme_filename   TEXT,
        license           TEXT,
        homepage          TEXT,
        repository_type   TEXT,
        repository_url    TEXT,
        quarantine_status TEXT DEFAULT 'clean',
        is_quarantined    INTEGER DEFAULT 0,
        space_id          TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at        TEXT DEFAULT (datetime('now')),
        modified_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
      CREATE INDEX IF NOT EXISTS idx_packages_space ON packages(space_id);

      CREATE TABLE IF NOT EXISTS package_versions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id        INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version           TEXT NOT NULL,
        tarball_path      TEXT NOT NULL,
        tarball_shasum    TEXT NOT NULL,
        tarball_integrity TEXT,
        tarball_size      INTEGER NOT NULL,
        manifest          TEXT NOT NULL,
        modelscript_meta  TEXT,
        published_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        published_at      TEXT DEFAULT (datetime('now')),
        UNIQUE(package_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_package_versions_pkg ON package_versions(package_id);

      CREATE TABLE IF NOT EXISTS dist_tags (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL,
        version    TEXT NOT NULL,
        UNIQUE(package_id, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_dist_tags_pkg ON dist_tags(package_id);

      CREATE TABLE IF NOT EXISTS artifacts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES package_versions(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        path       TEXT NOT NULL,
        metadata   TEXT,
        UNIQUE(version_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_version ON artifacts(version_id);

      CREATE TABLE IF NOT EXISTS remote_packages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        version      TEXT NOT NULL,
        actor_url    TEXT NOT NULL,
        download_url TEXT NOT NULL,
        checksum     TEXT NOT NULL,
        license      TEXT,
        description  TEXT,
        metadata     TEXT,
        is_deleted   INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now')),
        updated_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(name, version, actor_url)
      );
      CREATE INDEX IF NOT EXISTS idx_remote_packages_name ON remote_packages(name);

      CREATE TABLE IF NOT EXISTS package_ownership_transfers (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        package_name TEXT NOT NULL,
        from_user_id INTEGER NOT NULL REFERENCES users(id),
        to_user_id   INTEGER NOT NULL REFERENCES users(id),
        status       TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'canceled')),
        created_at   TEXT DEFAULT (datetime('now')),
        resolved_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pkg_transfer_to ON package_ownership_transfers(to_user_id, status);

      CREATE TABLE IF NOT EXISTS package_downloads_daily (
        library_name    TEXT NOT NULL,
        library_version TEXT NOT NULL,
        download_date   TEXT NOT NULL,
        downloads_count INTEGER DEFAULT 0,
        PRIMARY KEY (library_name, library_version, download_date)
      );
      CREATE INDEX IF NOT EXISTS idx_pkg_dl_lookup ON package_downloads_daily(library_name, download_date);

      CREATE TABLE IF NOT EXISTS organizations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        slug            TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        display_name    TEXT,
        description     TEXT,
        website         TEXT,
        billing_email   TEXT,
        avatar_url      TEXT,
        banner_url      TEXT,
        location        TEXT,
        industry_preset TEXT DEFAULT 'systems_general',
        is_verified     INTEGER NOT NULL DEFAULT 0,
        credit_balance  REAL NOT NULL DEFAULT 0.0,
        total_spent     REAL NOT NULL DEFAULT 0.0,
        created_by      INTEGER NOT NULL REFERENCES users(id),
        created_at      TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

      CREATE TABLE IF NOT EXISTS organization_members (
        org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK(role IN ('owner', 'maintainer', 'contributor')),
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (org_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

      -- ── Ansatz Spaces (Polymorphic User & Organization Containers) ──────────────
      CREATE TABLE IF NOT EXISTS spaces (
        id                TEXT PRIMARY KEY,
        slug              TEXT NOT NULL,
        name              TEXT NOT NULL,
        tagline           TEXT,
        description       TEXT,
        owner_type        TEXT NOT NULL CHECK(owner_type IN ('user', 'organization')),
        user_id           INTEGER REFERENCES users(id) ON DELETE CASCADE,
        organization_id   INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
        domain_preset     TEXT NOT NULL DEFAULT 'systems_general',
        visibility        TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'unlisted', 'internal', 'private')),
        avatar_url        TEXT,
        banner_url        TEXT,
        default_branch    TEXT NOT NULL DEFAULT 'main',
        git_repo_path     TEXT,
        enabled_tabs_json TEXT NOT NULL DEFAULT '["feed","chat","docs","articles","repos","packages","plm","twins"]',
        settings_json     TEXT NOT NULL DEFAULT '{}',
        follower_count    INTEGER NOT NULL DEFAULT 0,
        member_count      INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT DEFAULT (datetime('now')),
        updated_at        TEXT DEFAULT (datetime('now')),
        CONSTRAINT chk_space_owner CHECK (
          (owner_type = 'user' AND user_id IS NOT NULL AND organization_id IS NULL) OR
          (owner_type = 'organization' AND organization_id IS NOT NULL AND user_id IS NULL)
        ),
        CONSTRAINT uq_space_user_slug UNIQUE(user_id, slug),
        CONSTRAINT uq_space_org_slug UNIQUE(organization_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_spaces_user ON spaces(user_id);
      CREATE INDEX IF NOT EXISTS idx_spaces_org ON spaces(organization_id);
      CREATE INDEX IF NOT EXISTS idx_spaces_preset ON spaces(domain_preset);
      CREATE INDEX IF NOT EXISTS idx_spaces_visibility ON spaces(visibility);

      -- ── Space Members & Engineering RBAC ────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS space_members (
        space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'contributor' CHECK(role IN ('owner', 'lead_engineer', 'approver', 'contributor', 'reviewer', 'viewer')),
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (space_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

      -- ── Space Followers (Activity Stream & Fediverse Subscriptions) ─────────────
      CREATE TABLE IF NOT EXISTS space_follows (
        space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (space_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_space_follows_user ON space_follows(user_id);

      -- ── Space Living Docs / CMS Pages (Git-Backed Index) ────────────────────────
      CREATE TABLE IF NOT EXISTS space_pages (
        id                      TEXT PRIMARY KEY,
        space_id                TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        slug                    TEXT NOT NULL,
        title                   TEXT NOT NULL,
        summary                 TEXT,
        content_markdown        TEXT NOT NULL DEFAULT '',
        path_in_git             TEXT NOT NULL,
        parent_id               TEXT REFERENCES space_pages(id) ON DELETE SET NULL,
        order_index             INTEGER NOT NULL DEFAULT 0,
        last_commit_sha         TEXT,
        author_user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_published            INTEGER NOT NULL DEFAULT 1,
        embedded_artifacts_json TEXT NOT NULL DEFAULT '[]',
        created_at              TEXT DEFAULT (datetime('now')),
        updated_at              TEXT DEFAULT (datetime('now')),
        CONSTRAINT uq_space_page_slug UNIQUE(space_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_space_pages_space ON space_pages(space_id, order_index);

      -- ── Space Real-Time Chat Channels (Slack / Discord Model) ───────────────────
      CREATE TABLE IF NOT EXISTS space_channels (
        id         TEXT PRIMARY KEY,
        space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        slug       TEXT NOT NULL,
        name       TEXT NOT NULL,
        topic      TEXT,
        kind       TEXT NOT NULL DEFAULT 'text' CHECK(kind IN ('text', 'announcement', 'bot_feed', 'telemetry', 'ecr_review')),
        position   INTEGER NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        CONSTRAINT uq_space_channel_slug UNIQUE(space_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_space_channels_space ON space_channels(space_id, position);

      -- ── Space Real-Time Chat Messages ───────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS space_messages (
        id                      TEXT PRIMARY KEY,
        channel_id              TEXT NOT NULL REFERENCES space_channels(id) ON DELETE CASCADE,
        space_id                TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        author_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
        sender_type             TEXT NOT NULL DEFAULT 'user' CHECK(sender_type IN ('user', 'bot', 'telemetry_hook', 'ci_runner')),
        sender_name             TEXT,
        content                 TEXT NOT NULL,
        reply_to_id             TEXT REFERENCES space_messages(id) ON DELETE SET NULL,
        thread_reply_count      INTEGER NOT NULL DEFAULT 0,
        attachments_json        TEXT NOT NULL DEFAULT '[]',
        embedded_artifacts_json TEXT NOT NULL DEFAULT '[]',
        reactions_json          TEXT NOT NULL DEFAULT '{}',
        promoted_target_type    TEXT,
        promoted_target_id      TEXT,
        created_at              TEXT DEFAULT (datetime('now')),
        edited_at               TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_space_messages_channel ON space_messages(channel_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_space_messages_space ON space_messages(space_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_space_messages_reply ON space_messages(reply_to_id);

      -- ── Space Channel Read State & Unread Counters ──────────────────────────────
      CREATE TABLE IF NOT EXISTS space_channel_reads (
        channel_id            TEXT NOT NULL REFERENCES space_channels(id) ON DELETE CASCADE,
        user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_message_id  TEXT,
        unread_mentions_count INTEGER NOT NULL DEFAULT 0,
        last_read_at          TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (channel_id, user_id)
      );

      -- ── Space PLM Engineering Change Orders (ECO / ECR Proposals) ───────────────
      CREATE TABLE IF NOT EXISTS space_eco_proposals (
        id                      TEXT PRIMARY KEY,
        space_id                TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
        eco_number              INTEGER NOT NULL,
        title                   TEXT NOT NULL,
        description             TEXT NOT NULL DEFAULT '',
        status                  TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('draft', 'open', 'in_review', 'approved', 'merged', 'rejected')),
        severity                TEXT NOT NULL DEFAULT 'standard' CHECK(severity IN ('minor', 'standard', 'major', 'safety_critical')),
        source_branch           TEXT NOT NULL DEFAULT 'feature/change',
        target_branch           TEXT NOT NULL DEFAULT 'main',
        author_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
        impacted_models_json    TEXT NOT NULL DEFAULT '[]',
        simulation_gate_status  TEXT NOT NULL DEFAULT 'pending' CHECK(simulation_gate_status IN ('pending', 'running', 'passed', 'failed')),
        simulation_summary_json TEXT NOT NULL DEFAULT '{}',
        promoted_from_msg_id    TEXT,
        created_at              TEXT DEFAULT (datetime('now')),
        updated_at              TEXT DEFAULT (datetime('now')),
        CONSTRAINT uq_space_eco_num UNIQUE(space_id, eco_number)
      );
      CREATE INDEX IF NOT EXISTS idx_space_ecos_space ON space_eco_proposals(space_id, status);

      -- ── Space PLM Cryptographic Approvals (21 CFR Part 11 / ISO 26262 / NERC) ──
      CREATE TABLE IF NOT EXISTS space_eco_approvals (
        eco_id        TEXT NOT NULL REFERENCES space_eco_proposals(id) ON DELETE CASCADE,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role          TEXT NOT NULL,
        decision      TEXT NOT NULL CHECK(decision IN ('approved', 'changes_requested', 'rejected')),
        comment       TEXT,
        signature_hex TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (eco_id, user_id)
      );

      -- ── Space Problem Reports & Engineering Issues (ECR) ──────────────────────
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
        created_at           TEXT DEFAULT (datetime('now')),
        updated_at           TEXT DEFAULT (datetime('now')),
        CONSTRAINT uq_space_issue_num UNIQUE(space_id, issue_number)
      );
      CREATE INDEX IF NOT EXISTS idx_space_issues_space ON space_issues(space_id, status);

      CREATE TABLE IF NOT EXISTS space_issue_comments (
        id         TEXT PRIMARY KEY,
        issue_id   TEXT NOT NULL REFERENCES space_issues(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_space_issue_comments_issue ON space_issue_comments(issue_id);

      CREATE TABLE IF NOT EXISTS package_collaborators (
        library_name TEXT NOT NULL,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission   TEXT NOT NULL CHECK(permission IN ('admin', 'write', 'read')),
        created_at   TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (library_name, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pkg_collab_user ON package_collaborators(user_id);

      -- ── Digital Twins, Instances, Jobs, Billing & Snippets ───────

      CREATE TABLE IF NOT EXISTS instances (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        serial_number TEXT NOT NULL UNIQUE,
        package_id    INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
        version       TEXT NOT NULL,
        commit_sha    TEXT,
        variant       TEXT,
        birth_data    TEXT,
        created_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_instances_serial ON instances(serial_number);
      CREATE INDEX IF NOT EXISTS idx_instances_pkg ON instances(package_id);

      CREATE TABLE IF NOT EXISTS twins (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id        INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
        name               TEXT NOT NULL,
        modelica_class     TEXT NOT NULL,
        status             TEXT DEFAULT 'active',
        health_score       REAL DEFAULT 100.0,
        config             TEXT NOT NULL,
        current_parameters TEXT NOT NULL,
        current_weights    TEXT,
        space_id           TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at         TEXT DEFAULT (datetime('now')),
        last_telemetry_at  TEXT,
        last_adapted_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_twins_instance ON twins(instance_id);
      CREATE INDEX IF NOT EXISTS idx_twins_space ON twins(space_id);

      CREATE TABLE IF NOT EXISTS twin_adaptations (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id            INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        trigger_reason     TEXT NOT NULL,
        prior_parameters   TEXT NOT NULL,
        updated_parameters TEXT NOT NULL,
        residual_before    REAL NOT NULL,
        residual_after     REAL NOT NULL,
        iterations         INTEGER NOT NULL,
        created_at         TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_twin_adaptations_twin ON twin_adaptations(twin_id);

      CREATE TABLE IF NOT EXISTS twin_proposals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        twin_id       INTEGER NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
        post_id       INTEGER REFERENCES posts(id) ON DELETE SET NULL,
        adaptation_id INTEGER REFERENCES twin_adaptations(id) ON DELETE CASCADE,
        status        TEXT DEFAULT 'open',
        reviewer_id   INTEGER REFERENCES users(id),
        review_notes  TEXT,
        reviewed_at   TEXT,
        created_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_twin_proposals_twin ON twin_proposals(twin_id);

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

      CREATE TABLE IF NOT EXISTS job_steps (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        status       TEXT NOT NULL,
        started_at   TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS credit_transactions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id        INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount        REAL NOT NULL,
        balance_after REAL NOT NULL,
        type          TEXT NOT NULL,
        description   TEXT NOT NULL,
        metadata      TEXT DEFAULT '{}',
        created_at    TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_credit_tx_job ON credit_transactions(job_id);

      CREATE TABLE IF NOT EXISTS credit_escrow_holds (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
        amount      REAL NOT NULL,
        status      TEXT DEFAULT 'held',
        description TEXT NOT NULL,
        metadata    TEXT DEFAULT '{}',
        created_at  TEXT DEFAULT (datetime('now')),
        settled_at  TEXT
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

      CREATE TABLE IF NOT EXISTS script_templates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        category    TEXT NOT NULL DEFAULT 'general',
        icon        TEXT NOT NULL DEFAULT 'terminal',
        config      TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS cad_cache (
        url           TEXT PRIMARY KEY,
        geometry_json TEXT NOT NULL,
        created_at    TEXT DEFAULT (datetime('now'))
      );

      -- ── SysML v2 & Concurrent Engineering Digital Thread ─────────

      CREATE TABLE IF NOT EXISTS sysml2_projects (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        created        TEXT NOT NULL,
        default_branch TEXT NOT NULL,
        space_id       TEXT REFERENCES spaces(id) ON DELETE SET NULL
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
        id             TEXT PRIMARY KEY,
        commit_id      TEXT NOT NULL REFERENCES sysml2_commits(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        qualified_name TEXT NOT NULL,
        owner_id       TEXT,
        is_abstract    INTEGER DEFAULT 0,
        element_json   TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sysml2_relationships (
        id        TEXT PRIMARY KEY,
        commit_id TEXT NOT NULL REFERENCES sysml2_commits(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        rel_type  TEXT NOT NULL,
        rel_json  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sysml2_commits_project ON sysml2_commits(project_id);
      CREATE INDEX IF NOT EXISTS idx_sysml2_elements_commit ON sysml2_elements(commit_id);
      CREATE INDEX IF NOT EXISTS idx_sysml2_relationships_commit ON sysml2_relationships(commit_id);

      CREATE TABLE IF NOT EXISTS sysml2_branches (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL,
        name           TEXT NOT NULL,
        head_commit_id TEXT,
        created        TEXT NOT NULL,
        UNIQUE(project_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_sysml2_branches_project ON sysml2_branches(project_id);

      CREATE TABLE IF NOT EXISTS sysml2_tags (
        id               TEXT PRIMARY KEY,
        project_id       TEXT NOT NULL,
        name             TEXT NOT NULL,
        tagged_commit_id TEXT NOT NULL,
        created          TEXT NOT NULL,
        UNIQUE(project_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_sysml2_tags_project ON sysml2_tags(project_id);

      CREATE TABLE IF NOT EXISTS thread_proposals (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id      TEXT NOT NULL,
        title          TEXT NOT NULL,
        description    TEXT,
        status         TEXT NOT NULL DEFAULT 'open',
        proposed_by    TEXT NOT NULL,
        diff_summary   TEXT NOT NULL,
        space_id       TEXT REFERENCES spaces(id) ON DELETE SET NULL,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolved_at    DATETIME,
        resolved_by    TEXT,
        review_comment TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_thread_proposals_thread_status ON thread_proposals(thread_id, status);

      CREATE TABLE IF NOT EXISTS thread_audit_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id       TEXT NOT NULL,
        proposal_id     INTEGER REFERENCES thread_proposals(id),
        action          TEXT NOT NULL,
        actor           TEXT NOT NULL,
        safety_standard TEXT,
        checksum        TEXT NOT NULL,
        metadata        TEXT,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_thread_audit_log_thread_created ON thread_audit_log(thread_id, created_at);

      CREATE TABLE IF NOT EXISTS thread_snapshots (
        workspace_id    TEXT PRIMARY KEY,
        serialized_json TEXT NOT NULL,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS thread_conflicts (
        conflict_id    TEXT PRIMARY KEY,
        workspace_id   TEXT NOT NULL DEFAULT 'default',
        slot           INTEGER NOT NULL,
        source_domain  TEXT NOT NULL,
        source_value   REAL NOT NULL,
        source_unit    TEXT NOT NULL,
        target_domain  TEXT NOT NULL,
        target_value   REAL NOT NULL,
        target_unit    TEXT NOT NULL,
        min_bound      REAL NOT NULL,
        max_bound      REAL NOT NULL,
        status         TEXT NOT NULL DEFAULT 'conflicted',
        resolved_value REAL,
        updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_thread_conflicts_workspace ON thread_conflicts(workspace_id, status);

      -- ── Analytics, Federation, Moderation & Instance Lifecycle ───

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

      CREATE TABLE IF NOT EXISTS feature_flags (
        flag_key           TEXT PRIMARY KEY,
        is_enabled         INTEGER NOT NULL,
        rollout_percentage INTEGER DEFAULT 100,
        allowed_roles      TEXT,
        updated_at         TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);

      CREATE TABLE IF NOT EXISTS federation_domains (
        domain               TEXT PRIMARY KEY,
        tier                 TEXT NOT NULL DEFAULT 'allow',
        reason               TEXT,
        reject_media         INTEGER NOT NULL DEFAULT 0,
        reject_reports       INTEGER NOT NULL DEFAULT 0,
        obfuscate            INTEGER NOT NULL DEFAULT 0,
        public_comment       TEXT,
        private_comment      TEXT,
        unavailable_since    TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_seen_at         TEXT,
        created_at           TEXT DEFAULT (datetime('now')),
        updated_at           TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS federation_delivery_queue (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_type    TEXT NOT NULL,
        activity_id      TEXT NOT NULL,
        payload          TEXT NOT NULL,
        target_inbox_url TEXT NOT NULL,
        target_domain    TEXT NOT NULL,
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 5,
        next_retry_at    TEXT NOT NULL DEFAULT (datetime('now')),
        last_error       TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        created_at       TEXT DEFAULT (datetime('now')),
        updated_at       TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fed_queue_status_retry ON federation_delivery_queue(status, next_retry_at);

      CREATE TABLE IF NOT EXISTS federation_relays (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        inbox_url          TEXT NOT NULL UNIQUE,
        actor_url          TEXT NOT NULL,
        domain             TEXT NOT NULL DEFAULT 'unknown',
        state              TEXT NOT NULL DEFAULT 'pending',
        follow_activity_id TEXT,
        forwarded_count    INTEGER NOT NULL DEFAULT 0,
        received_count     INTEGER NOT NULL DEFAULT 0,
        last_activity_at   TEXT,
        last_error         TEXT,
        created_at         TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_federation_relays_state ON federation_relays(state);

      CREATE TABLE IF NOT EXISTS federated_oauth_clients (
        domain        TEXT PRIMARY KEY,
        client_id     TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        registered_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS content_reports (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_id        INTEGER NOT NULL,
        post_id            INTEGER,
        target_user_id     INTEGER,
        target_type        TEXT,
        target_resource_id TEXT,
        reason             TEXT NOT NULL,
        details            TEXT,
        status             TEXT NOT NULL DEFAULT 'pending',
        resolution_notes   TEXT,
        action_taken       TEXT,
        content_snapshot   TEXT,
        rule_ids           TEXT NOT NULL DEFAULT '[]',
        category           TEXT NOT NULL DEFAULT 'other',
        created_at         TEXT DEFAULT (datetime('now')),
        resolved_at        TEXT,
        FOREIGN KEY (reporter_id) REFERENCES users(id),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);

      CREATE TABLE IF NOT EXISTS dmca_notices (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        claimant_name    TEXT NOT NULL,
        claimant_email   TEXT NOT NULL,
        copyright_owner  TEXT NOT NULL,
        work_description TEXT NOT NULL,
        infringing_url   TEXT NOT NULL,
        resource_type    TEXT NOT NULL DEFAULT 'package',
        resource_id      TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        action_taken     TEXT,
        created_at       TEXT DEFAULT (datetime('now')),
        resolved_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dmca_notices_status ON dmca_notices(status);

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
        uses_count      INTEGER NOT NULL DEFAULT 0,
        initial_credits REAL NOT NULL DEFAULT 100.0,
        assigned_role   TEXT NOT NULL DEFAULT 'user',
        note            TEXT,
        expires_at      TEXT,
        revoked         INTEGER NOT NULL DEFAULT 0,
        revoked_at      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_instance_invites_code ON instance_invites(code);

      CREATE TABLE IF NOT EXISTS quarantined_resources (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_type  TEXT NOT NULL,
        resource_id    TEXT NOT NULL,
        reason         TEXT NOT NULL,
        dmca_notice_id INTEGER REFERENCES dmca_notices(id) ON DELETE SET NULL,
        quarantined_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status         TEXT NOT NULL DEFAULT 'quarantined',
        counter_notice TEXT,
        restore_after  TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
        restored_at    TEXT,
        UNIQUE(resource_type, resource_id)
      );
      CREATE INDEX IF NOT EXISTS idx_quarantined_resources_status ON quarantined_resources(status, resource_type);

      CREATE TABLE IF NOT EXISTS user_referrals (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referee_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        invite_id      INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        reward_granted INTEGER NOT NULL DEFAULT 0,
        reward_amount  REAL NOT NULL DEFAULT 0.0,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referrer ON user_referrals(referrer_id);
      CREATE INDEX IF NOT EXISTS idx_user_referrals_referee ON user_referrals(referee_id);

      CREATE TABLE IF NOT EXISTS waitlist_submissions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        email            TEXT NOT NULL UNIQUE,
        full_name        TEXT,
        organization     TEXT,
        discipline       TEXT,
        portfolio_url    TEXT,
        statement        TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        approved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
        invite_code_id   INTEGER REFERENCES instance_invites(id) ON DELETE SET NULL,
        ip_address       TEXT,
        rejection_reason TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist_submissions(status);
      CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_submissions(email);

      CREATE TABLE IF NOT EXISTS instance_rules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        text       TEXT NOT NULL,
        hint       TEXT,
        category   TEXT NOT NULL DEFAULT 'conduct',
        priority   INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cidr       TEXT NOT NULL UNIQUE,
        severity   TEXT NOT NULL DEFAULT 'no_sign_up',
        comment    TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ip_blocks_severity ON ip_blocks(severity);

      CREATE TABLE IF NOT EXISTS canonical_email_blocks (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_email_hash TEXT NOT NULL UNIQUE,
        canonical_email_hint TEXT,
        reason               TEXT,
        created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at           TEXT NOT NULL DEFAULT (datetime('now'))
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

      -- ── Performance & Case-Insensitive Lookup Indexes ────────────
      CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks(post_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id);
      CREATE INDEX IF NOT EXISTS idx_content_reports_post ON content_reports(post_id);
      CREATE INDEX IF NOT EXISTS idx_content_reports_target_user ON content_reports(target_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_lower_username ON users(LOWER(username));
      CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users(LOWER(email));
    `);

    // Seed feature flag defaults
    for (const flag of Object.values(FEATURE_FLAGS)) {
      const allowedRoles = flag.allowedRoles ? flag.allowedRoles.join(",") : "";
      ctx.execute(
        `INSERT OR IGNORE INTO feature_flags (flag_key, is_enabled, rollout_percentage, allowed_roles, updated_at)
         VALUES ('${flag.key}', ${flag.defaultValue ? 1 : 0}, 100, '${allowedRoles}', datetime('now'));`,
      );
    }

    // Idempotent column reconciliation for existing pre-0.1.0 databases
    const alterStatements = [
      "ALTER TABLE library_releases ADD COLUMN is_deprecated INTEGER DEFAULT 0",
      "ALTER TABLE library_releases ADD COLUMN deprecation_reason TEXT",
      "ALTER TABLE library_releases ADD COLUMN is_yanked INTEGER DEFAULT 0",
      "ALTER TABLE library_releases ADD COLUMN yank_reason TEXT",
      "ALTER TABLE library_releases ADD COLUMN yanked_at TEXT",
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
      "ALTER TABLE users ADD COLUMN bot_scopes TEXT DEFAULT 'social:read,social:write'",
      "ALTER TABLE users ADD COLUMN bot_system_prompt TEXT",
      "ALTER TABLE users ADD COLUMN bot_model TEXT DEFAULT 'gemini-1.5-flash'",
      "ALTER TABLE users ADD COLUMN bot_last_used_at TEXT",
      "ALTER TABLE users ADD COLUMN bot_api_key TEXT",
      "ALTER TABLE users ADD COLUMN bot_endpoint_url TEXT",
      "ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN engineering_persona TEXT",
      "ALTER TABLE users ADD COLUMN invites_remaining INTEGER DEFAULT 5",
      "ALTER TABLE users ADD COLUMN account_type TEXT DEFAULT 'user'",
      "ALTER TABLE users ADD COLUMN ed25519_public_key TEXT",
      "ALTER TABLE users ADD COLUMN ed25519_private_key TEXT",
      "ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE users ADD COLUMN indexable INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE users ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN also_known_as TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE users ADD COLUMN moved_to_actor_url TEXT",
      "ALTER TABLE users ADD COLUMN profile_fields TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE users ADD COLUMN default_post_visibility TEXT NOT NULL DEFAULT 'public'",
      "ALTER TABLE follows ADD COLUMN state TEXT DEFAULT 'accepted'",
      "ALTER TABLE linked_repos ADD COLUMN visibility TEXT DEFAULT 'public'",
      "ALTER TABLE linked_repos ADD COLUMN default_branch TEXT DEFAULT 'main'",
      "ALTER TABLE linked_repos ADD COLUMN social_preview_url TEXT",
      "ALTER TABLE content_reports ADD COLUMN action_taken TEXT",
      "ALTER TABLE content_reports ADD COLUMN content_snapshot TEXT",
      "ALTER TABLE content_reports ADD COLUMN target_type TEXT",
      "ALTER TABLE content_reports ADD COLUMN target_resource_id TEXT",
      "ALTER TABLE content_reports ADD COLUMN rule_ids TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE content_reports ADD COLUMN category TEXT NOT NULL DEFAULT 'other'",
      "ALTER TABLE posts ADD COLUMN is_sensitive INTEGER DEFAULT 0",
      "ALTER TABLE posts ADD COLUMN content_warning TEXT",
      "ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0",
      "ALTER TABLE posts ADD COLUMN ap_id TEXT UNIQUE",
      "ALTER TABLE posts ADD COLUMN url TEXT",
      "ALTER TABLE posts ADD COLUMN metadata TEXT",
      "ALTER TABLE posts ADD COLUMN reply_visibility TEXT DEFAULT 'everyone'",
      "ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
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
      "ALTER TABLE artifact_views ADD COLUMN source_ref TEXT",
      "ALTER TABLE artifact_views ADD COLUMN remote_origin_url TEXT",
      "ALTER TABLE artifact_views ADD COLUMN updated_at TEXT",
      "ALTER TABLE sysml2_commits ADD COLUMN merged_commit TEXT",
      "ALTER TABLE organizations ADD COLUMN credit_balance REAL NOT NULL DEFAULT 0.0",
      "ALTER TABLE organizations ADD COLUMN total_spent REAL NOT NULL DEFAULT 0.0",
      "ALTER TABLE organizations ADD COLUMN display_name TEXT",
      "ALTER TABLE organizations ADD COLUMN website TEXT",
      "ALTER TABLE organizations ADD COLUMN billing_email TEXT",
      "ALTER TABLE waitlist_submissions ADD COLUMN rejection_reason TEXT",
      "ALTER TABLE instance_invites ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE instance_invites ADD COLUMN uses_count INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE instance_invites ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE instance_invites ADD COLUMN revoked_at TEXT",
      "ALTER TABLE quarantined_resources ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
      "ALTER TABLE federation_domains ADD COLUMN reject_media INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN reject_reports INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN obfuscate INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN public_comment TEXT",
      "ALTER TABLE federation_domains ADD COLUMN private_comment TEXT",
      "ALTER TABLE federation_domains ADD COLUMN unavailable_since TEXT",
      "ALTER TABLE federation_domains ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE federation_domains ADD COLUMN last_seen_at TEXT",
      "ALTER TABLE trending_topics ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved'",
      "ALTER TABLE trending_topics ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL",
      "ALTER TABLE trending_topics ADD COLUMN reviewed_at TEXT",
      "ALTER TABLE classes ADD COLUMN icon_hash TEXT",
      "ALTER TABLE classes ADD COLUMN diagram_hash TEXT",
      "ALTER TABLE users ADD COLUMN signing_verified INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN signing_policy_strict INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN branch_tip_oid TEXT",
      "ALTER TABLE organizations ADD COLUMN banner_url TEXT",
      "ALTER TABLE organizations ADD COLUMN location TEXT",
      "ALTER TABLE organizations ADD COLUMN industry_preset TEXT DEFAULT 'systems_general'",
      "ALTER TABLE organizations ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE posts ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE linked_repos ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE packages ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE solutions ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE twins ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE sysml2_projects ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE thread_proposals ADD COLUMN space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL",
      "ALTER TABLE notifications ADD COLUMN archived INTEGER DEFAULT 0",
      "ALTER TABLE notifications ADD COLUMN starred INTEGER DEFAULT 0",
    ];

    for (const stmt of alterStatements) {
      try {
        ctx.execute(stmt);
      } catch {
        // Column already exists
      }
    }

    try {
      ctx.execute(`
        UPDATE instance_invites SET used_count = uses_count WHERE used_count = 0 AND uses_count > 0;
        UPDATE instance_invites SET uses_count = used_count WHERE uses_count = 0 AND used_count > 0;
      `);
    } catch {}

    // Sanitize any legacy Modelica description strings containing raw annotation(...) blocks
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
    // Baseline 0.1.0 schema is non-destructive on rollback to preserve core data tables
  },
};
